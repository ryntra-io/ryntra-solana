-- Ryntra: the rollback of 20261120190100_agent_paper_week_v1.sql — the paper agents' store, gone.
--
-- PREPARED 2026-11-20 as a file only. It removes the five `public.agent_paper_*`
-- functions and `private.agent_paper_weeks` with every paper week in it. Paper weeks are paper: no money, no key, no
-- wallet, nothing of the agent's book. After it the paper route and cron answer that paper is not open.

begin;

drop function if exists public.agent_paper_purge(text, integer);
drop function if exists public.agent_paper_due(text, text, integer);
drop function if exists public.agent_paper_put(text, text, text, text, jsonb, integer);
drop function if exists public.agent_paper_start(text, text, text, text, jsonb, integer);
drop function if exists public.agent_paper_get(text, text);
drop table if exists private.agent_paper_weeks;

commit;
