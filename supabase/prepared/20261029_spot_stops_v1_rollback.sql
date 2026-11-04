-- Rollback of `supabase/migrations/20261029200000_spot_stops_v1.sql` (CITY-149).
-- PREPARED 2026-10-29 as a file only.
-- It drops every stop kept under a wallet: an intent, never money.

begin;

drop function if exists public.spot_stops_list(text, text, timestamptz);
drop function if exists public.spot_stops_create(text, jsonb, integer, timestamptz);
drop function if exists public.spot_stops_cancel(text, text, text, timestamptz);
drop function if exists public.spot_stops_finish(text, text, text, timestamptz);
drop function if exists public.spot_stops_due(text, timestamptz, integer);
drop function if exists public.spot_stops_reach(text, text, text, timestamptz);
drop function if exists public.spot_stops_untold(text, integer);
drop function if exists public.spot_stops_told(text, text, timestamptz);
drop function if exists public.spot_stops_expire(text, timestamptz, integer);
drop function if exists private.spot_stops_json(private.spot_stops);
drop function if exists private.spot_stops_at(bigint);
drop function if exists private.spot_stops_ms(timestamptz);
drop table if exists private.spot_stops;

commit;
