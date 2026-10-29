-- EXE-2 — the action and budget ledger. PREPARED ONLY; the operator applies it (a production database migration).
--
-- Where: the Postgres the Guard store's DATABASE_URL names — the database that holds public.guard_objects.
-- Not a new table: the ledger's six collections live in guard_objects like every other Guard collection
-- (lib/core/actions/model.ts maps spec §14.1 onto them), and the code works without this file.
--
-- What it adds is the database's own word for two promises the code makes:
--   1. Rows of actionEvents, actionIdempotency and actionTransactions are written once: an UPDATE or DELETE of one,
--      or an UPDATE that would turn another row into one, is refused (raise_exception, P0001). The ledger only ever
--      inserts them (INSERT … ON CONFLICT DO NOTHING fires no UPDATE trigger). Not covered: TRUNCATE of the whole table,
--      and a superuser session with session_replication_role = replica — both are operator acts outside the app.
--   2. A budget never holds more than its limit: for actionBudgets, reservedRaw + spentRaw <= limitRaw, all integers of
--      base units. The ledger's compare-and-set writes already keep this; the check makes a bad write fail in the
--      database too.
--
-- Safe to run twice. No existing row is changed; no row of these collections exists before the ledger writes one.
-- Locks: the first transaction (triggers, the constraint NOT VALID) holds ACCESS EXCLUSIVE on guard_objects only for
-- the catalog change — no scan. Waiting for that lock holds the money paths queued behind it for at most lock_timeout
-- (5 s); then it fails instead (run again). VALIDATE runs alone afterwards under SHARE UPDATE EXCLUSIVE: reads and
-- writes go on during its scan. Run the file as it is (psql -f, without -1 and without a wrapping transaction): a single
-- wrapping transaction would hold the first lock through the scan.
-- Rollback: 20261025_exe_2_action_ledger_v1_rollback.sql.

set lock_timeout = '5s';

begin;

create or replace function public.guard_objects_action_ledger_once()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'guard_objects: % rows are written once (EXE-2 action ledger)',
    coalesce(old.collection, new.collection);
end;
$$;

drop trigger if exists guard_objects_action_ledger_once_update on public.guard_objects;
create trigger guard_objects_action_ledger_once_update
  before update on public.guard_objects
  for each row
  when (old.collection in ('actionEvents', 'actionIdempotency', 'actionTransactions')
     or new.collection in ('actionEvents', 'actionIdempotency', 'actionTransactions'))
  execute function public.guard_objects_action_ledger_once();

drop trigger if exists guard_objects_action_ledger_once_delete on public.guard_objects;
create trigger guard_objects_action_ledger_once_delete
  before delete on public.guard_objects
  for each row
  when (old.collection in ('actionEvents', 'actionIdempotency', 'actionTransactions'))
  execute function public.guard_objects_action_ledger_once();

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'guard_objects_action_budget_within_limit'
       and conrelid = 'public.guard_objects'::regclass
  ) then
    alter table public.guard_objects add constraint guard_objects_action_budget_within_limit check (
      collection <> 'actionBudgets' or (
        case
          when (value ->> 'limitRaw') ~ '^(0|[1-9][0-9]{0,39})$'
           and (value ->> 'reservedRaw') ~ '^(0|[1-9][0-9]{0,39})$'
           and (value ->> 'spentRaw') ~ '^(0|[1-9][0-9]{0,39})$'
          then (value ->> 'reservedRaw')::numeric + (value ->> 'spentRaw')::numeric <= (value ->> 'limitRaw')::numeric
          else false
        end
      )
    ) not valid;
  end if;
end;
$$;

commit;

alter table public.guard_objects validate constraint guard_objects_action_budget_within_limit;

reset lock_timeout;

-- Check after applying (each must say what is written beside it):
--   select tgname from pg_trigger where tgrelid = 'public.guard_objects'::regclass and tgname like 'guard_objects_action_ledger_%';
--     → guard_objects_action_ledger_once_delete, guard_objects_action_ledger_once_update
--   select convalidated from pg_constraint where conname = 'guard_objects_action_budget_within_limit';  → t
