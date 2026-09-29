-- ============================================================================
-- REVIEWED RYN-SLAB-002 non-destructive containment rollback.
-- Production drill executed 2026-07-21, then forward recovery restored access.
--
-- This incident action removes every client execution/data privilege introduced
-- by the Strategy Lab candidate. It deliberately does not DROP, DELETE, UPDATE,
-- TRUNCATE, disable RLS, or alter persisted evidence. Owner inspection remains
-- possible for diagnosis and a separately reviewed forward repair.
-- ============================================================================

begin;

revoke all on function public.strategy_lab_append_version(text,bigint,uuid,text,jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.strategy_lab_append_run(text,bigint,uuid,text,uuid,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,text,text)
  from public, anon, authenticated, service_role;
revoke all on function public.strategy_lab_append_proposal(text,bigint,uuid,text,uuid,uuid,uuid,text,text,jsonb,jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.strategy_lab_list(text,bigint,integer,timestamptz,uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.strategy_lab_get(text,bigint,uuid,integer,integer,integer,timestamptz,uuid,timestamptz,uuid,timestamptz,uuid)
  from public, anon, authenticated, service_role;

revoke all privileges on table
  private.strategy_lab_strategies,
  private.strategy_lab_versions,
  private.strategy_lab_deliveries,
  private.strategy_lab_experiments,
  private.strategy_lab_imports,
  private.strategy_lab_trades,
  private.strategy_lab_evidence_reports,
  private.strategy_lab_proposals
from public, anon, authenticated, service_role;

-- UUID-only Strategy Lab tables own no sequences. Assert that remains true so a
-- future schema change cannot silently make this containment incomplete.
do $$
begin
  if exists (
    select 1
    from pg_catalog.pg_class as s
    join pg_catalog.pg_depend as d on d.objid = s.oid and d.deptype in ('a','i')
    join pg_catalog.pg_class as t on t.oid = d.refobjid
    join pg_catalog.pg_namespace as n on n.oid = t.relnamespace
    where s.relkind = 'S' and n.nspname = 'private' and t.relname like 'strategy_lab_%'
  ) then
    raise exception 'Strategy Lab containment requires explicit sequence revocation';
  end if;
end;
$$;

commit;
