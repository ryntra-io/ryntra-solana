-- Ryntra: rollback of «Contacts» and «Autopay».
--
-- PREPARED 2026-11-20 as a file only; applied, if ever.
-- It removes the functions and the five tables of the migration and
-- nothing else. The money never lived here: an autopay's funds stay in the
-- person's vault on chain, and «Stop» (their own signature) brings them back
-- with or without these rows. Run it only after every autopay is stopped or
-- ended — a working policy on chain outlives this file, and the executor would
-- no longer pay it.

begin;

drop function if exists public.autopay_events(text, text, bigint, integer);
drop function if exists public.autopay_status(text, text, text, text, text);
drop function if exists public.autopay_settle(text, text, text, integer, text, text, integer);
drop function if exists public.autopay_release(text, text, text, integer, integer, text, integer);
drop function if exists public.autopay_sign(text, text, text, integer, integer, text, bigint);
drop function if exists public.autopay_claim(text, text, text, integer, integer);
drop function if exists public.autopay_due(text, text, integer, integer);
drop function if exists public.autopay_one(text, text, text, text);
drop function if exists public.autopay_list(text, text, text);
drop function if exists public.autopay_put(text, text, jsonb);
drop function if exists private.autopay_refresh(text, uuid, timestamptz);
drop function if exists private.autopay_json(private.autopays);
drop function if exists public.contacts_change(text, text, text, text, text, text, text, text);
drop function if exists public.contacts_list(text, text);
drop function if exists private.contact_json(private.contacts);

drop table if exists private.autopay_events;
drop table if exists private.autopay_payments;
drop table if exists private.autopays;
drop table if exists private.contact_nonces;
drop table if exists private.contacts;

commit;
