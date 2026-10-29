-- EXE-2 rollback — removes the database's refusals added by 20261025_exe_2_action_ledger_v1.sql. PREPARED ONLY.
-- No row is touched: the ledger's rows stay, and the code keeps writing them only by insert and compare-and-set.
begin;
drop trigger if exists guard_objects_action_ledger_once_update on public.guard_objects;
drop trigger if exists guard_objects_action_ledger_once_delete on public.guard_objects;
drop function if exists public.guard_objects_action_ledger_once();
alter table public.guard_objects drop constraint if exists guard_objects_action_budget_within_limit;
commit;
