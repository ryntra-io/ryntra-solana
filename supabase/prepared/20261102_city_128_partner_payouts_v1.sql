-- CITY-128 — the partners' weekly payout statements. PREPARED ONLY; the operator applies it (a production database migration).
--
-- Where: the Postgres the Guard store's DATABASE_URL names — the database that holds public.guard_objects.
-- Not a new table: the statements live in guard_objects as the collection partnerPayoutWeeks (lib/partner-payouts/),
-- and the code works without this file.
--
-- What it adds is the database's own word for the promise the code makes: once a week's statement is written, what it
-- counted — its lines (each partner's share, pay and carry, and the operations it credited), its totals and its week —
-- never changes. Only its state (PREPARED → PROPOSED → PAID, or VOID), its proposal and rolledInto move, by
-- compare-and-set. An UPDATE that changes lines, totals or week, or a DELETE of a statement, is refused
-- (raise_exception, P0001). Not covered: TRUNCATE of the whole table, and a superuser session with
-- session_replication_role = replica — operator acts outside the app.
--
-- Safe to run twice. No existing row is changed. Locks: ACCESS EXCLUSIVE on guard_objects only for the catalog change,
-- at most lock_timeout (5 s) of waiting; then it fails instead (run again). Run as it is (psql -f).
-- Rollback: 20261102_city_128_partner_payouts_v1_rollback.sql.

set lock_timeout = '5s';

begin;

create or replace function public.guard_objects_partner_payout_fixed()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'guard_objects: partnerPayoutWeeks statements are never deleted (CITY-128)';
  end if;
  if old.collection <> new.collection
     or (old.value -> 'lines') is distinct from (new.value -> 'lines')
     or (old.value -> 'totals') is distinct from (new.value -> 'totals')
     or (old.value ->> 'week') is distinct from (new.value ->> 'week') then
    raise exception 'guard_objects: a partnerPayoutWeeks statement''s lines are written once (CITY-128)';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_objects_partner_payout_fixed_update on public.guard_objects;
create trigger guard_objects_partner_payout_fixed_update
  before update on public.guard_objects
  for each row
  when (old.collection = 'partnerPayoutWeeks' or new.collection = 'partnerPayoutWeeks')
  execute function public.guard_objects_partner_payout_fixed();

drop trigger if exists guard_objects_partner_payout_fixed_delete on public.guard_objects;
create trigger guard_objects_partner_payout_fixed_delete
  before delete on public.guard_objects
  for each row
  when (old.collection = 'partnerPayoutWeeks')
  execute function public.guard_objects_partner_payout_fixed();

commit;

reset lock_timeout;

-- Check after applying:
--   select tgname from pg_trigger where tgrelid = 'public.guard_objects'::regclass and tgname like 'guard_objects_partner_payout_%';
--   → two rows.
