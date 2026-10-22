-- Fixtures somente nesta transação; compatível com Supabase e Postgres do CI.
begin;
insert into auth.users(id,email) values
 ('00000000-0000-4000-a001-000000000001','ponto-test-legacy@example.invalid'),
 ('00000000-0000-4000-a001-000000000002','ponto-test-outsider@example.invalid'),
 ('00000000-0000-4000-a001-000000000003','ponto-test-internal@example.invalid'),
 ('00000000-0000-4000-a001-000000000004','ponto-test-invited@example.invalid');
insert into public.ponto_profiles(user_id,display_name) values('00000000-0000-4000-a001-000000000001','Original');
insert into public.ponto_memberships values('00000000-0000-4000-a001-000000000001');
insert into public.ponto_entries(user_id,work_date,start_time,end_time) values('00000000-0000-4000-a001-000000000001','2026-10-19','13:00','18:00');
insert into ponto_private.accounts(email,user_id,legacy_user_id,pin_salt,pin_hash) values
 ('ponto-test-legacy@example.invalid','00000000-0000-4000-a001-000000000001','00000000-0000-4000-a001-000000000001','','');
set local role service_role;
select public.ponto_auth_storage('invite_create','{"user_id":"00000000-0000-4000-a001-000000000001","token_hash":"test-invite"}');
select public.ponto_auth_storage('bind_legacy','{"email":"ponto-test-legacy@example.invalid","previous_id":"00000000-0000-4000-a001-000000000001","user_id":"00000000-0000-4000-a001-000000000003","internal_email":"ponto-test-internal@example.invalid"}');
do $$ begin
  if not exists(select 1 from public.ponto_profiles where user_id='00000000-0000-4000-a001-000000000003' and display_name='Original') then raise exception 'Perfil perdido na transição'; end if;
  if not exists(select 1 from public.ponto_entries where user_id='00000000-0000-4000-a001-000000000003') then raise exception 'Registros perdidos na transição'; end if;
  if exists(select 1 from public.ponto_memberships where user_id='00000000-0000-4000-a001-000000000001') then raise exception 'Identidade antiga continua membro'; end if;
end $$;
select public.ponto_auth_storage('register',jsonb_build_object('token_hash','test-invite','email','ponto-test-invited@example.invalid','name','Convidada','user_id','00000000-0000-4000-a001-000000000004','internal_email','ponto-test-invited@example.invalid','pin_salt','AAAAAAAAAAAAAAAAAAAAAA==','pin_hash',repeat('A',43)||'='));
do $$ begin
  if public.ponto_auth_storage('invite_info','{"token_hash":"test-invite"}')<>'null'::jsonb then raise exception 'Convite usado ainda válido'; end if;
  begin
    perform public.ponto_auth_storage('register',jsonb_build_object('token_hash','test-invite','email','second@example.invalid','name','Outra','user_id','00000000-0000-4000-a001-000000000002','pin_salt','','pin_hash',''));
    raise exception 'Convite usado duas vezes';
  exception when raise_exception then if sqlerrm='Convite usado duas vezes' then raise; end if; end;
  if not public.ponto_auth_storage('limit','{"key":"fixture","max":1,"seconds":60}')::boolean then raise exception 'Primeira tentativa bloqueada'; end if;
  if public.ponto_auth_storage('limit','{"key":"fixture","max":1,"seconds":60}')::boolean then raise exception 'Limite ignorado'; end if;
end $$;
select public.ponto_auth_storage('recovery_start','{"email":"ponto-test-invited@example.invalid","code_hash":"correct"}');
do $$ begin
  if public.ponto_auth_storage('recovery_finish','{"email":"ponto-test-invited@example.invalid","code_hash":"wrong"}')<>'null'::jsonb then raise exception 'Código errado aceito'; end if;
end $$;
select public.ponto_auth_storage('recovery_finish',jsonb_build_object('email','ponto-test-invited@example.invalid','code_hash','correct','pin_salt','BBBBBBBBBBBBBBBBBBBBBB==','pin_hash',repeat('B',43)||'='));
do $$ begin
  if public.ponto_auth_storage('recovery_finish','{"email":"ponto-test-invited@example.invalid","code_hash":"correct"}')<>'null'::jsonb then raise exception 'Recuperação reutilizada'; end if;
end $$;
set local role authenticated;
set local request.jwt.claim.sub='00000000-0000-4000-a001-000000000002';
do $$ begin
  if exists(select 1 from public.ponto_profiles) then raise exception 'Sem convite viu perfis'; end if;
  begin
    insert into public.ponto_profiles(user_id) values(auth.uid());raise exception 'Cadastro sem convite aceito';
  exception when insufficient_privilege then null; end;
  begin
    perform public.ponto_auth_storage('account','{"email":"ponto-test-legacy@example.invalid"}');raise exception 'RPC interna exposta';
  exception when insufficient_privilege then null; end;
  begin
    perform * from ponto_private.accounts;raise exception 'Credenciais expostas';
  exception when insufficient_privilege then null; end;
end $$;
set local request.jwt.claim.sub='00000000-0000-4000-a001-000000000004';
do $$ begin
  if (select count(*) from public.ponto_profiles)<>1 then raise exception 'Isolamento de perfis falhou'; end if;
  if exists(select 1 from public.ponto_entries) then raise exception 'Convidada viu registros antigos'; end if;
  begin
    update public.ponto_profiles set contact_email='attacker@example.invalid' where user_id=auth.uid();raise exception 'E-mail alterado pelo cliente';
  exception when insufficient_privilege then null; end;
end $$;
insert into public.ponto_entries(user_id,work_date,start_time,end_time) values(auth.uid(),'2026-10-19','13:00','18:00');
rollback;
select 'Convites, migração, privacidade, limites e recuperação: OK' as validation;
