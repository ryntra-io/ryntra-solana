-- Ryntra City: points for a crack of a free vault (CITY-19, decisions 71 and 72).
--
-- PREPARED 2026-10-27 as a file only. Not applied to any Supabase project:
-- Checked on a throwaway local PostgreSQL 16
-- with the Supabase roles (see `lib/world/sql.test.mjs`).
--
-- WHAT THIS FILE DOES
--   * Adds `vault_crack` to the reasons the points ledger accepts. A free vault
--     pays by the vault — practice 10 · 20 · 40 once ever, the daily vault 15
--     once a day (`lib/city-economy/points.ts`); the server writes it through
--     the existing `public.world_award`, once per key.
--
-- WHAT IT DOES NOT DO
--   No new table, column or function, and no money. A paid vault pays no
--   points; there is still no reason for trading volume or for the number of
--   launches. Rows already in the ledger all keep a reason from the list.

begin;

alter table private.world_points drop constraint world_points_reason_check;
alter table private.world_points add constraint world_points_reason_check check (reason in (
  'task_done', 'survival_7', 'survival_30', 'survival_90', 'holders_kept',
  'lp_in_range_days', 'visitors_verified', 'coop_contribution', 'war_participation', 'vault_crack'
));

commit;
