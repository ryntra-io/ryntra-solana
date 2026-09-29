-- ============================================================================
-- RYN-SLAB-002 reviewed forward recovery after non-destructive containment.
-- Production drill executed successfully 2026-07-21; this remains the recovery runbook.
-- Restores only the five anon PostgREST RPC entry points. It does not grant
-- direct table access, mutate persisted evidence, change RLS, or touch secrets.
-- ============================================================================

begin;

do $$
declare
  v_table_count integer;
  v_function_count integer;
begin
  select count(*) into v_table_count
  from pg_catalog.pg_class as c
  join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
  where n.nspname = 'private'
    and c.relkind = 'r'
    and c.relname like 'strategy_lab_%'
    and c.relrowsecurity
    and c.relforcerowsecurity
    and not exists (select 1 from pg_catalog.pg_policy as p where p.polrelid = c.oid)
    and not pg_catalog.has_table_privilege('public', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
    and not pg_catalog.has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
    and not pg_catalog.has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
    and not pg_catalog.has_table_privilege('service_role', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE');
  if v_table_count <> 8 then
    raise exception 'Strategy Lab access recovery refused: private table boundary mismatch';
  end if;

  select count(*) into v_function_count
  from pg_catalog.pg_proc as p
  join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (
      'strategy_lab_append_version',
      'strategy_lab_append_run',
      'strategy_lab_append_proposal',
      'strategy_lab_list',
      'strategy_lab_get'
    )
    and p.prosecdef
    and pg_catalog.array_to_string(p.proconfig, ',') = 'search_path=""';
  if v_function_count <> 5 then
    raise exception 'Strategy Lab access recovery refused: RPC boundary mismatch';
  end if;
end;
$$;

revoke all on function public.strategy_lab_append_version(
  text,bigint,uuid,text,jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.strategy_lab_append_run(
  text,bigint,uuid,text,uuid,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,text,text
) from public, anon, authenticated, service_role;
revoke all on function public.strategy_lab_append_proposal(
  text,bigint,uuid,text,uuid,uuid,uuid,text,text,jsonb,jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.strategy_lab_list(
  text,bigint,integer,timestamptz,uuid
) from public, anon, authenticated, service_role;
revoke all on function public.strategy_lab_get(
  text,bigint,uuid,integer,integer,integer,timestamptz,uuid,timestamptz,uuid,timestamptz,uuid
) from public, anon, authenticated, service_role;

grant execute on function public.strategy_lab_append_version(
  text,bigint,uuid,text,jsonb
) to anon;
grant execute on function public.strategy_lab_append_run(
  text,bigint,uuid,text,uuid,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,text,text
) to anon;
grant execute on function public.strategy_lab_append_proposal(
  text,bigint,uuid,text,uuid,uuid,uuid,text,text,jsonb,jsonb
) to anon;
grant execute on function public.strategy_lab_list(
  text,bigint,integer,timestamptz,uuid
) to anon;
grant execute on function public.strategy_lab_get(
  text,bigint,uuid,integer,integer,integer,timestamptz,uuid,timestamptz,uuid,timestamptz,uuid
) to anon;

do $$
begin
  if (
    select count(*)
    from pg_catalog.pg_proc as p
    join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname like 'strategy_lab_%'
      and pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
      and not pg_catalog.has_function_privilege('public', p.oid, 'EXECUTE')
      and not pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
      and not pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')
  ) <> 5 then
    raise exception 'Strategy Lab access recovery failed closed: privilege matrix mismatch';
  end if;
end;
$$;

commit;

notify pgrst, 'reload schema';
