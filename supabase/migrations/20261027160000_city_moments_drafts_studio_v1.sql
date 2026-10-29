-- Ryntra City: studio posts in the queue of post drafts for X (task CITY-38).
--
-- PREPARED 2026-10-28 as a file only. Not applied to any Supabase project:
-- production migrations are applied as a deliberate, separate step, through MCP Supabase,
-- after `20261027150000_city_moments_drafts_v1.sql` (CITY-3), which it needs.
-- The CITY-3 file stays as it was merged, so this one works whether or not
-- that one has been applied already.
--
-- WHAT THIS FILE DOES
--   * Lets a draft be of a fifth kind, `studio`: a post of the studio for X
--     (the tower of the hour, JUST IN, Launch Night, the week's billboard,
--     the banner), its facts in the draft's moment, its clip sent by the
--     studio's batch script. Nothing else changes: the same table, the same
--     locks, the same server functions, the switch untouched.
--
-- WHAT IT DOES NOT DO
--   No keys and no posting. No grant, no policy, no new function.

begin;

alter table private.moments_drafts drop constraint moments_drafts_kind_check;
alter table private.moments_drafts add constraint moments_drafts_kind_check
  check (kind in ('launch', 'graduate', 'bigx', 'agent', 'studio'));

commit;
