-- Verificação administrativa do Supabase real. Tudo é desfeito no ROLLBACK.
-- Usa uma conta existente sem ler e-mail, senha ou tokens.
begin;
do $$ declare account_id uuid; begin
  select id into account_id from auth.users where is_anonymous is not true order by created_at limit 1;
  if account_id is null then raise exception 'Crie uma conta permanente em Authentication antes desta verificação'; end if;
  perform set_config('ponto.test_user',account_id::text,true);
  perform set_config('ponto.test_entry',gen_random_uuid()::text,true);
  perform set_config('request.jwt.claim.sub',account_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',account_id,'role','authenticated','is_anonymous',false)::text,true);
end $$;
set local role authenticated;
insert into public.ponto_profiles(user_id) values (auth.uid()) on conflict(user_id) do nothing;
insert into public.ponto_entries(id,user_id,work_date,start_time,end_time)
values (current_setting('ponto.test_entry')::uuid,auth.uid(),'2199-01-04','13:00','18:00');
do $$ declare changed integer; begin
  if not exists(select 1 from public.ponto_entries where id=current_setting('ponto.test_entry')::uuid) then raise exception 'Leitura do registro criado falhou'; end if;
  update public.ponto_entries set note='Verificação temporária' where id=current_setting('ponto.test_entry')::uuid;
  get diagnostics changed = row_count;
  if changed<>1 then raise exception 'Edição do registro criado falhou'; end if;
  begin
    insert into public.ponto_entries(user_id,work_date,start_time,end_time) values (auth.uid(),'2199-01-04','17:00','19:00');
    raise exception 'Sobreposição não foi rejeitada';
  exception when exclusion_violation then null;
  end;
  begin
    update public.ponto_entries set user_id=gen_random_uuid() where id=current_setting('ponto.test_entry')::uuid;
    raise exception 'Troca de proprietário não foi rejeitada';
  exception when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',auth.uid(),'role','authenticated','is_anonymous',true)::text,true);
  if exists(select 1 from public.ponto_entries where id=current_setting('ponto.test_entry')::uuid) then raise exception 'Sessão anônima autenticada conseguiu ler registro'; end if;
  perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('request.jwt.claim.sub'),'role','authenticated','is_anonymous',false)::text,true);
  if exists(select 1 from public.ponto_entries where id=current_setting('ponto.test_entry')::uuid) then raise exception 'Outra conta conseguiu ler o registro'; end if;
  update public.ponto_entries set note='Inválido' where id=current_setting('ponto.test_entry')::uuid;
  get diagnostics changed = row_count;
  if changed<>0 then raise exception 'Outra conta conseguiu editar o registro'; end if;
  delete from public.ponto_entries where id=current_setting('ponto.test_entry')::uuid;
  get diagnostics changed = row_count;
  if changed<>0 then raise exception 'Outra conta conseguiu excluir o registro'; end if;
  perform set_config('request.jwt.claim.sub',current_setting('ponto.test_user'),true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('ponto.test_user'),'role','authenticated','is_anonymous',false)::text,true);
  delete from public.ponto_entries where id=current_setting('ponto.test_entry')::uuid;
  get diagnostics changed = row_count;
  if changed<>1 then raise exception 'Exclusão do registro criado falhou'; end if;
end $$;
set local role anon;
do $$ begin
  begin
    perform user_id from public.ponto_entries;
    raise exception 'Leitura sem login não foi rejeitada';
  exception when insufficient_privilege then null;
  end;
end $$;
rollback;
select 'OK: criar, ler, editar, excluir, sobreposição e RLS; sem dados de teste persistidos' as validation;
