-- Acesso próprio do Ponto: convite, e-mail + PIN e recuperação por e-mail.
-- Preserva os usuários e as senhas do Meu Celeiro.
begin;
create schema ponto_private;
revoke all on schema ponto_private from public, anon, authenticated;
grant usage on schema ponto_private to service_role;
alter table public.ponto_profiles add column contact_email text not null default '';

create table public.ponto_memberships (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table public.ponto_memberships enable row level security;
revoke all on public.ponto_memberships from public, anon, authenticated;
grant select on public.ponto_memberships to authenticated;
grant all on public.ponto_memberships to service_role;
create policy ponto_member_select on public.ponto_memberships for select to authenticated
  using (user_id = (select auth.uid()) and not (select coalesce((auth.jwt()->>'is_anonymous')::boolean,false)));
insert into public.ponto_memberships select user_id from public.ponto_profiles;

create table ponto_private.accounts (
  email text primary key check (email=lower(trim(email)) and length(email)<=254),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  legacy_user_id uuid unique,
  internal_email text unique,
  pin_salt text not null,
  pin_hash text not null
);
-- Somente os perfis que já existiam são reconhecidos como contas antigas.
insert into ponto_private.accounts(email,user_id,legacy_user_id,pin_salt,pin_hash)
select lower(trim(u.email)), p.user_id, p.user_id, p.pin_salt, p.pin_hash
from public.ponto_profiles p join auth.users u on u.id=p.user_id where u.email is not null;
update public.ponto_profiles p set contact_email=a.email from ponto_private.accounts a where a.user_id=p.user_id;

create table ponto_private.invites (
  token_hash text primary key,
  created_by uuid not null references auth.users(id),
  expires_at timestamptz not null default now()+interval '7 days',
  used_by uuid references auth.users(id),
  used_at timestamptz
);
create index ponto_invites_creator on ponto_private.invites(created_by);
create index ponto_invites_used_by on ponto_private.invites(used_by);
create table ponto_private.limits (
  key text primary key, hits integer not null, expires_at timestamptz not null
);
create table ponto_private.recovery (
  email text primary key references ponto_private.accounts(email) on delete cascade,
  code_hash text not null, expires_at timestamptz not null, attempts integer not null default 0
);
alter table ponto_private.accounts enable row level security;
alter table ponto_private.invites enable row level security;
alter table ponto_private.limits enable row level security;
alter table ponto_private.recovery enable row level security;
revoke all on all tables in schema ponto_private from public,anon,authenticated;
grant all on all tables in schema ponto_private to service_role;
create policy ponto_accounts_service on ponto_private.accounts to service_role using (true) with check (true);
create policy ponto_invites_service on ponto_private.invites to service_role using (true) with check (true);
create policy ponto_limits_service on ponto_private.limits to service_role using (true) with check (true);
create policy ponto_recovery_service on ponto_private.recovery to service_role using (true) with check (true);
create index ponto_limits_expiry on ponto_private.limits(expires_at);
grant all on public.ponto_profiles,public.ponto_entries to service_role;

-- Restritiva: as políticas anteriores continuam exigindo dono e sessão não anônima.
create policy ponto_profiles_invitation on public.ponto_profiles as restrictive for all to authenticated
  using (not (select coalesce((auth.jwt()->>'is_anonymous')::boolean,false)) and exists(select 1 from public.ponto_memberships m where m.user_id=(select auth.uid())))
  with check (not (select coalesce((auth.jwt()->>'is_anonymous')::boolean,false)) and exists(select 1 from public.ponto_memberships m where m.user_id=(select auth.uid())));
create policy ponto_entries_invitation on public.ponto_entries as restrictive for all to authenticated
  using (not (select coalesce((auth.jwt()->>'is_anonymous')::boolean,false)) and exists(select 1 from public.ponto_memberships m where m.user_id=(select auth.uid())))
  with check (not (select coalesce((auth.jwt()->>'is_anonymous')::boolean,false)) and exists(select 1 from public.ponto_memberships m where m.user_id=(select auth.uid())));
revoke update on public.ponto_profiles from authenticated;
grant update(display_name) on public.ponto_profiles to authenticated;

-- RPC exclusivamente de servidor. SECURITY INVOKER: não eleva privilégios.
create function public.ponto_auth_storage(action text, payload jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
  a ponto_private.accounts%rowtype;
  invitation ponto_private.invites%rowtype;
  recovery_row ponto_private.recovery%rowtype;
  result jsonb;
  hits integer;
  uid uuid;
begin
  if action='limit' then
    -- Limpa dados temporários antigos em pequenas requisições de manutenção.
    delete from ponto_private.limits where expires_at < now()-interval '1 day';
    insert into ponto_private.limits(key,hits,expires_at)
      values(payload->>'key',1,now()+make_interval(secs=>(payload->>'seconds')::integer))
    on conflict(key) do update set
      hits=case when ponto_private.limits.expires_at<=now() then 1 else ponto_private.limits.hits+1 end,
      expires_at=case when ponto_private.limits.expires_at<=now() then excluded.expires_at else ponto_private.limits.expires_at end
    returning ponto_private.limits.hits into hits;
    return to_jsonb(hits<=(payload->>'max')::integer);
  elsif action='clear_limit' then
    delete from ponto_private.limits where key=payload->>'key'; return 'true';
  elsif action='account' then
    select * into a from ponto_private.accounts where
      ((payload ? 'email') and email=payload->>'email') or
      ((payload ? 'user_id') and (user_id=(payload->>'user_id')::uuid or legacy_user_id=(payload->>'user_id')::uuid));
    return case when found then to_jsonb(a) else 'null'::jsonb end;
  elsif action='invite_create' then
    uid=(payload->>'user_id')::uuid;
    if not exists(select 1 from public.ponto_memberships where user_id=uid) then raise exception 'Conta sem acesso ao Ponto'; end if;
    insert into ponto_private.invites(token_hash,created_by) values(payload->>'token_hash',uid)
      returning jsonb_build_object('expires_at',expires_at) into result;
    return result;
  elsif action='invite_info' then
    select * into invitation from ponto_private.invites where token_hash=payload->>'token_hash' and used_at is null and expires_at>now();
    if not found then return 'null'; end if;
    return jsonb_build_object('expires_at',invitation.expires_at,'inviter',
      (select display_name from public.ponto_profiles where user_id=invitation.created_by));
  elsif action='register' then
    select * into invitation from ponto_private.invites where token_hash=payload->>'token_hash' for update;
    if not found or invitation.used_at is not null or invitation.expires_at<=now() then raise exception 'Convite inválido, vencido ou já utilizado'; end if;
    uid=(payload->>'user_id')::uuid;
    insert into ponto_private.accounts(email,user_id,internal_email,pin_salt,pin_hash)
      values(payload->>'email',uid,payload->>'internal_email',payload->>'pin_salt',payload->>'pin_hash');
    insert into public.ponto_memberships values(uid);
    insert into public.ponto_profiles(user_id,display_name,contact_email,pin_salt,pin_hash)
      values(uid,payload->>'name',payload->>'email',payload->>'pin_salt',payload->>'pin_hash');
    update ponto_private.invites set used_by=uid,used_at=now() where token_hash=invitation.token_hash;
    return 'true';
  elsif action='bind_legacy' then
    select * into a from ponto_private.accounts where email=payload->>'email' for update;
    if not found or a.internal_email is not null or a.user_id<>(payload->>'previous_id')::uuid then raise exception 'Conta atualizada em outra sessão. Entre novamente'; end if;
    uid=(payload->>'user_id')::uuid;
    -- Move apenas dados do Ponto; a identidade e os dados do Celeiro ficam intactos.
    update public.ponto_entries set user_id=uid where user_id=a.user_id;
    update public.ponto_profiles set user_id=uid where user_id=a.user_id;
    update ponto_private.invites set created_by=uid where created_by=a.user_id;
    insert into public.ponto_memberships values(uid);
    delete from public.ponto_memberships where user_id=a.user_id;
    update ponto_private.accounts set user_id=uid,internal_email=payload->>'internal_email' where email=a.email returning to_jsonb(accounts) into result;
    return result;
  elsif action='profile' then
    uid=(payload->>'user_id')::uuid;
    select * into a from ponto_private.accounts where user_id=uid for update;
    if not found then raise exception 'Conta sem acesso ao Ponto'; end if;
    if payload ? 'pin_hash' then
      update ponto_private.accounts set pin_salt=payload->>'pin_salt',pin_hash=payload->>'pin_hash' where email=a.email;
      update public.ponto_profiles set pin_salt=payload->>'pin_salt',pin_hash=payload->>'pin_hash' where user_id=uid;
    end if;
    update public.ponto_profiles set display_name=payload->>'name' where user_id=uid returning to_jsonb(ponto_profiles) into result;
    return result;
  elsif action='recovery_start' then
    insert into ponto_private.recovery(email,code_hash,expires_at) values(payload->>'email',payload->>'code_hash',now()+interval '15 minutes')
    on conflict(email) do update set code_hash=excluded.code_hash,expires_at=excluded.expires_at,attempts=0;
    return 'true';
  elsif action='recovery_finish' then
    select * into recovery_row from ponto_private.recovery where email=payload->>'email' for update;
    if not found or recovery_row.expires_at<=now() or recovery_row.attempts>=5 then return 'null'; end if;
    if recovery_row.code_hash<>payload->>'code_hash' then
      update ponto_private.recovery set attempts=attempts+1 where email=recovery_row.email; return 'null';
    end if;
    select * into a from ponto_private.accounts where email=recovery_row.email for update;
    delete from ponto_private.recovery where email=recovery_row.email;
    update ponto_private.accounts set pin_salt=payload->>'pin_salt',pin_hash=payload->>'pin_hash' where email=a.email returning * into a;
    update public.ponto_profiles set pin_salt=a.pin_salt,pin_hash=a.pin_hash where user_id=a.user_id;
    return to_jsonb(a);
  end if;
  raise exception 'Operação inválida';
end;
$$;
revoke all on function public.ponto_auth_storage(text,jsonb) from public,anon,authenticated;
grant execute on function public.ponto_auth_storage(text,jsonb) to service_role;
commit;
