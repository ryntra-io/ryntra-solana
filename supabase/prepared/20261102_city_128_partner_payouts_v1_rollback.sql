-- CITY-128 — rollback of 20261102_city_128_partner_payouts_v1.sql. PREPARED ONLY; the operator applies it.
-- Removes the refusal to rewrite a partner payout statement; the statements themselves stay as they are.

set lock_timeout = '5s';

begin;
drop trigger if exists guard_objects_partner_payout_fixed_update on public.guard_objects;
drop trigger if exists guard_objects_partner_payout_fixed_delete on public.guard_objects;
drop function if exists public.guard_objects_partner_payout_fixed();
commit;

reset lock_timeout;
