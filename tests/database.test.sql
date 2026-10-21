-- Testes no banco descartável criado pelo workflow. A transação é desfeita.
begin;
insert into auth.users(id) values ('00000000-0000-4000-a000-000000000001'),('00000000-0000-4000-a000-000000000002');
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-a000-000000000001';
insert into public.ponto_profiles(user_id,display_name) values (auth.uid(),'Conta A');
insert into public.ponto_entries(id,user_id,work_date,start_time,end_time) values ('10000000-0000-4000-a000-000000000001',auth.uid(),'2026-10-19','13:00','18:00');
do $$ begin
  begin
    insert into public.ponto_entries(user_id,work_date,start_time,end_time) values (auth.uid(),'2026-10-19','17:00','19:00');
    raise exception 'Sobreposição não foi rejeitada';
  exception when exclusion_violation then null;
  end;
  begin
    insert into public.ponto_entries(user_id,work_date,start_time,end_time) values (auth.uid(),'2026-10-19','18:00','13:00');
    raise exception 'Turno invertido não foi rejeitado';
  exception when check_violation then null;
  end;
  begin
    insert into public.ponto_profiles(user_id) values ('00000000-0000-4000-a000-000000000002');
    raise exception 'RLS permitiu criar perfil de outra conta';
  exception when insufficient_privilege then null;
  end;
end $$;
-- Intervalos adjacentes são válidos.
insert into public.ponto_entries(user_id,work_date,start_time,end_time) values (auth.uid(),'2026-10-19','18:00','19:00');
do $$ declare previous_time timestamptz; next_time timestamptz; begin
  select updated_at into previous_time from public.ponto_entries where id='10000000-0000-4000-a000-000000000001';
  update public.ponto_entries set note='Edição' where id='10000000-0000-4000-a000-000000000001' returning updated_at into next_time;
  if next_time<=previous_time then raise exception 'Atualização não alterou updated_at'; end if;
  begin
    update public.ponto_entries set user_id='00000000-0000-4000-a000-000000000002' where id='10000000-0000-4000-a000-000000000001';
    raise exception 'RLS permitiu transferir registro para outra conta';
  exception when insufficient_privilege then null;
  end;
end $$;
set local request.jwt.claim.sub = '00000000-0000-4000-a000-000000000002';
insert into public.ponto_profiles(user_id,display_name) values (auth.uid(),'Conta B');
-- Outra conta pode ter seu próprio registro no mesmo horário.
insert into public.ponto_entries(user_id,work_date,start_time,end_time) values (auth.uid(),'2026-10-19','13:00','18:00');
do $$ declare affected integer; begin
  if (select count(*) from public.ponto_entries)<>1 then raise exception 'RLS expôs registros de outra conta'; end if;
  if (select count(*) from public.ponto_profiles)<>1 then raise exception 'RLS expôs perfis de outra conta'; end if;
  update public.ponto_entries set note='Inválido' where id='10000000-0000-4000-a000-000000000001';
  get diagnostics affected = row_count;
  if affected<>0 then raise exception 'RLS permitiu editar outra conta'; end if;
  delete from public.ponto_entries where id='10000000-0000-4000-a000-000000000001';
  get diagnostics affected = row_count;
  if affected<>0 then raise exception 'RLS permitiu excluir outra conta'; end if;
end $$;
set local request.jwt.claim.is_anonymous = 'true';
do $$ begin
  if (select count(*) from public.ponto_entries)<>0 then raise exception 'Sessão anônima autenticada conseguiu ler entradas'; end if;
  if (select count(*) from public.ponto_profiles)<>0 then raise exception 'Sessão anônima autenticada conseguiu ler perfis'; end if;
  begin
    insert into public.ponto_entries(user_id,work_date,start_time,end_time) values (auth.uid(),'2026-10-19','19:00','20:00');
    raise exception 'Sessão anônima autenticada conseguiu gravar entrada';
  exception when insufficient_privilege then null;
  end;
end $$;
set local role anon;
do $$ begin
  begin
    perform user_id from public.ponto_entries;
    raise exception 'Acesso anônimo não foi rejeitado';
  exception when insufficient_privilege then null;
  end;
end $$;
rollback;
select 'Esquema, horários e isolamento entre contas: OK' as validation;
