-- Rollback of `supabase/migrations/20261031120000_city_earn_captain_v1.sql` (CITY-99).
-- PREPARED 2026-10-31 as a file only; run only when the project's owner says so. It drops the
-- ledger of strategy copies and their daily record: public positions read from
-- the chain, never money. The city then shows no strategy card.

begin;

drop function if exists public.city_captain_report(text, jsonb, integer, integer, timestamptz);
drop function if exists public.city_captain_copies(text);
drop function if exists public.city_captain_save(text, jsonb, jsonb, timestamptz);
drop function if exists public.city_captain_points_put(text, jsonb);
drop function if exists public.city_captain_points(text, date);
drop function if exists private.city_captain_copy_json(private.city_captain_copies);
drop table if exists private.city_captain_points;
drop table if exists private.city_captain_copies;

commit;
