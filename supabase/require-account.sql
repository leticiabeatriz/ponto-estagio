-- Restringe o Ponto a contas permanentes, preservando o Meu Celeiro.
begin;
alter policy ponto_profiles_select on public.ponto_profiles using (user_id = (select auth.uid()) and not (select coalesce((auth.jwt()->>'is_anonymous')::boolean, false)));
alter policy ponto_profiles_insert on public.ponto_profiles with check (user_id = (select auth.uid()) and not (select coalesce((auth.jwt()->>'is_anonymous')::boolean, false)));
alter policy ponto_profiles_update on public.ponto_profiles using (user_id = (select auth.uid()) and not (select coalesce((auth.jwt()->>'is_anonymous')::boolean, false))) with check (user_id = (select auth.uid()) and not (select coalesce((auth.jwt()->>'is_anonymous')::boolean, false)));
alter policy ponto_entries_select on public.ponto_entries using (user_id = (select auth.uid()) and not (select coalesce((auth.jwt()->>'is_anonymous')::boolean, false)));
alter policy ponto_entries_insert on public.ponto_entries with check (user_id = (select auth.uid()) and not (select coalesce((auth.jwt()->>'is_anonymous')::boolean, false)));
alter policy ponto_entries_update on public.ponto_entries using (user_id = (select auth.uid()) and not (select coalesce((auth.jwt()->>'is_anonymous')::boolean, false))) with check (user_id = (select auth.uid()) and not (select coalesce((auth.jwt()->>'is_anonymous')::boolean, false)));
alter policy ponto_entries_delete on public.ponto_entries using (user_id = (select auth.uid()) and not (select coalesce((auth.jwt()->>'is_anonymous')::boolean, false)));
commit;
