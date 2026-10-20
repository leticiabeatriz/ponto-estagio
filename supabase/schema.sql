-- Executar uma vez no projeto Supabase. As tabelas do Meu Celeiro não são alteradas.
begin;
create extension if not exists btree_gist with schema extensions;
set local search_path = public, extensions;

create table public.ponto_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 80),
  pin_salt text not null default '',
  pin_hash text not null default '',
  constraint ponto_pin_format check (
    (pin_salt = '' and pin_hash = '') or
    (pin_salt ~ '^[A-Za-z0-9+/]{22}==$' and pin_hash ~ '^[A-Za-z0-9+/]{43}=$')
  )
);
create table public.ponto_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  work_date date not null check (work_date between '1900-01-01' and '2200-12-31'),
  start_time time(0) without time zone not null,
  end_time time(0) without time zone not null,
  note text not null default '' check (char_length(note) <= 200),
  updated_at timestamptz not null default clock_timestamp(),
  constraint ponto_valid_time check (end_time > start_time and end_time < '24:00'::time and extract(second from start_time) = 0 and extract(second from end_time) = 0),
  constraint ponto_no_overlap exclude using gist (
    user_id with =,
    tsrange(work_date + start_time, work_date + end_time, '[)') with &&
  )
);
create index ponto_entries_owner_date on public.ponto_entries(user_id,work_date desc,id);
create function public.ponto_touch_updated_at() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  new.updated_at = clock_timestamp();
  return new;
end;
$$;
revoke all on function public.ponto_touch_updated_at() from public, anon, authenticated;
create trigger ponto_entries_updated_at before update on public.ponto_entries
for each row execute function public.ponto_touch_updated_at();

alter table public.ponto_profiles enable row level security;
alter table public.ponto_entries enable row level security;
revoke all on public.ponto_profiles, public.ponto_entries from anon;
grant select,insert,update,delete on public.ponto_profiles, public.ponto_entries to authenticated;

create policy ponto_profiles_select on public.ponto_profiles for select to authenticated using (user_id = (select auth.uid()));
create policy ponto_profiles_insert on public.ponto_profiles for insert to authenticated with check (user_id = (select auth.uid()));
create policy ponto_profiles_update on public.ponto_profiles for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy ponto_entries_select on public.ponto_entries for select to authenticated using (user_id = (select auth.uid()));
create policy ponto_entries_insert on public.ponto_entries for insert to authenticated with check (user_id = (select auth.uid()));
create policy ponto_entries_update on public.ponto_entries for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy ponto_entries_delete on public.ponto_entries for delete to authenticated using (user_id = (select auth.uid()));
commit;
