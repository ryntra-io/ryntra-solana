-- Ryntra: the agent's week on paper — its own store, apart from the agent's book.
--
-- PREPARED 2026-11-20 as a file only. Not applied to any Supabase project.
-- Until it is applied the paper route and the paper cron answer that paper is
-- not open (`lib/mandate/paper/supabase-store.ts`: a function that is not
-- there is a store that did not answer); nothing else changes.
--
-- WHAT THIS FILE DOES
--   * Two tables, nothing else of the schema touched:
--     `private.agent_paper_weeks` — one row per paper agent, keyed by the
--     sha256 of the week's key — an HMAC of the proven wallet under the
--     server's key, which the person's browser holds (never the key itself,
--     never the wallet's address): its plan, coin and budget, its paper trades
--     and its paper result, as one JSON document the server checks on every
--     read (`lib/mandate/paper/model.ts` `paperAgentOf`). A version number
--     moves on each write, so two cron passes never both trade one agent.
--     Row level security forced, no policies, every grant revoked.
--     `private.agent_paper_starts` — the ledger of start attempts, one row per
--     attempt: an HMAC of the caller's address the server computes (never the
--     address itself) and the time. It holds a day at most: every admission
--     sweeps what is older. It bounds starts per caller and for everyone, so a
--     start that spends live quotes cannot be repeated from a cold instance
--     past the limit (the route's in-memory window forgets on every start).
--   * The server reads and writes only through the six
--     `public.agent_paper_*` functions below, each gated by the app secret
--     (`private.beta_check_secret`) and each one transaction, as the pools'
--     store does (`20261120150000_pro_pools_store_v1.sql`). None takes a
--     table's name or a statement.
--   * One advisory lock per network (`agent_paper:<network>`) serialises the
--     admission and the start, so two starts at once never both pass a count
--     (as `launch_set_save` in `20261120190000_launch_sets_v1.sql`).
--
-- WHAT IT DOES NOT DO
--   No money, no key, no transaction, no wallet, no person's name, no address: a paper
--   run of public prices. It shares nothing with the agent's book, its
--   mandates or its signatures — paper and money never mix. No existing
--   table, function or row is changed.

begin;

create table private.agent_paper_weeks (
  id text primary key check (id ~ '^[0-9a-f]{64}$'),
  network text not null check (network in ('mainnet')),
  status text not null check (status in ('working', 'paused', 'done', 'ended', 'live')),
  doc jsonb not null check (jsonb_typeof(doc) = 'object'),
  version integer not null check (version >= 1),
  started_at timestamptz not null,
  updated_at timestamptz not null,
  check (doc->>'id' = id),
  check (doc->>'status' = status),
  check (doc->>'kind' = 'paper')
);

-- The agents a pass trades for, the longest untouched first.
create index agent_paper_weeks_due_idx on private.agent_paper_weeks (network, updated_at) where status in ('working', 'paused');

alter table private.agent_paper_weeks enable row level security;
alter table private.agent_paper_weeks force row level security;
revoke all privileges on table private.agent_paper_weeks from public, anon, authenticated, service_role;

-- Start attempts: who (an HMAC the server computes of the caller's address) and when; a day at most.
create table private.agent_paper_starts (
  who text not null check (who ~ '^[0-9a-f]{64}$'),
  network text not null check (network in ('mainnet')),
  at timestamptz not null
);

create index agent_paper_starts_who_idx on private.agent_paper_starts (network, who, at);
create index agent_paper_starts_at_idx on private.agent_paper_starts (network, at);

alter table private.agent_paper_starts enable row level security;
alter table private.agent_paper_starts force row level security;
revoke all privileges on table private.agent_paper_starts from public, anon, authenticated, service_role;

-- ------------------------------------------------------- the server's API --

-- One paper agent by its id, with its version; row is null when there is none.
create function public.agent_paper_get(p_secret text, p_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row private.agent_paper_weeks;
begin
  perform private.beta_check_secret(p_secret);
  if p_id is null or p_id !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;
  select * into v_row from private.agent_paper_weeks w where w.id = p_id;
  if not found then
    return jsonb_build_object('ok', true, 'row', null);
  end if;
  return jsonb_build_object('ok', true, 'row', jsonb_build_object('doc', v_row.doc, 'version', v_row.version));
end;
$$;

-- May this caller start a paper week now? Answered under the network's lock, before the server spends a single quote:
--   'full'    — the store holds p_limit weeks at work;
--   'limited' — this caller started 3 in the last hour or 8 in the last day;
--   'busy'    — everyone together started 240 in the last hour (not this caller's doing — said so);
--   'ok'      — admitted, and the attempt is counted whether or not the start goes on to succeed.
-- Attempts older than a day are swept first.
create function public.agent_paper_admit(p_secret text, p_network text, p_who text, p_limit integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_limit integer := greatest(1, least(coalesce(p_limit, 2000), 20000));
begin
  perform private.beta_check_secret(p_secret);
  if p_network is distinct from 'mainnet' or p_who is null or p_who !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('agent_paper:' || p_network, 0));
  delete from private.agent_paper_starts s where s.network = p_network and s.at < v_now - interval '1 day';
  if (select count(*) from private.agent_paper_weeks w where w.network = p_network and w.status in ('working', 'paused')) >= v_limit then
    return jsonb_build_object('ok', true, 'answer', 'full');
  end if;
  if (select count(*) from private.agent_paper_starts s where s.network = p_network and s.who = p_who and s.at >= v_now - interval '1 hour') >= 3
     or (select count(*) from private.agent_paper_starts s where s.network = p_network and s.who = p_who) >= 8 then
    return jsonb_build_object('ok', true, 'answer', 'limited');
  end if;
  if (select count(*) from private.agent_paper_starts s where s.network = p_network and s.at >= v_now - interval '1 hour') >= 240 then
    return jsonb_build_object('ok', true, 'answer', 'busy');
  end if;
  insert into private.agent_paper_starts (who, network, at) values (p_who, p_network, v_now);
  return jsonb_build_object('ok', true, 'answer', 'ok');
end;
$$;

-- A new week for this id: refused while one of its weeks is at work ('working'), or while the store holds p_limit at work
-- ('full'); a week that ended is replaced. The document arrives at work. The count runs under the network's lock, the
-- admission's own, so starts at once never both take the last place.
create function public.agent_paper_start(p_secret text, p_id text, p_network text, p_status text, p_doc jsonb, p_limit integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_limit integer := greatest(1, least(coalesce(p_limit, 2000), 20000));
  v_row private.agent_paper_weeks;
begin
  perform private.beta_check_secret(p_secret);
  if p_id is null or p_id !~ '^[0-9a-f]{64}$' or p_network is distinct from 'mainnet' or p_status is distinct from 'working'
     or p_doc is null or jsonb_typeof(p_doc) <> 'object' or p_doc->>'id' is distinct from p_id or p_doc->>'status' is distinct from 'working'
     or p_doc->>'kind' is distinct from 'paper' or pg_column_size(p_doc) > 65536 then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('agent_paper:' || p_network, 0));
  select * into v_row from private.agent_paper_weeks w where w.id = p_id for update;
  if found and v_row.status in ('working', 'paused') then
    return jsonb_build_object('ok', true, 'answer', 'working');
  end if;
  if (select count(*) from private.agent_paper_weeks w where w.network = p_network and w.status in ('working', 'paused')) >= v_limit then
    return jsonb_build_object('ok', true, 'answer', 'full');
  end if;
  insert into private.agent_paper_weeks as w (id, network, status, doc, version, started_at, updated_at)
  values (p_id, p_network, 'working', p_doc, 1, v_now, v_now)
  on conflict (id) do update
     set network = excluded.network, status = excluded.status, doc = excluded.doc, version = w.version + 1,
         started_at = excluded.started_at, updated_at = excluded.updated_at;
  return jsonb_build_object('ok', true, 'answer', 'started');
end;
$$;

-- The agent written over the version it was read at; written is false when another pass wrote first.
create function public.agent_paper_put(p_secret text, p_id text, p_network text, p_status text, p_doc jsonb, p_version integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_version integer;
begin
  perform private.beta_check_secret(p_secret);
  if p_id is null or p_id !~ '^[0-9a-f]{64}$' or p_network is distinct from 'mainnet'
     or p_status is null or p_status not in ('working', 'paused', 'done', 'ended', 'live')
     or p_doc is null or jsonb_typeof(p_doc) <> 'object' or p_doc->>'id' is distinct from p_id or p_doc->>'status' is distinct from p_status
     or p_doc->>'kind' is distinct from 'paper' or pg_column_size(p_doc) > 65536 or p_version is null or p_version < 1 then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;
  update private.agent_paper_weeks w
     set status = p_status, doc = p_doc, version = w.version + 1, updated_at = v_now
   where w.id = p_id and w.network = p_network and w.version = p_version
  returning w.version into v_version;
  if not found then
    return jsonb_build_object('ok', true, 'written', false);
  end if;
  return jsonb_build_object('ok', true, 'written', true, 'version', v_version);
end;
$$;

-- The paper agents at work on a network — trading, or paused only because a price was not read — the longest untouched first.
create function public.agent_paper_due(p_secret text, p_network text, p_limit integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 40), 200));
begin
  perform private.beta_check_secret(p_secret);
  if p_network is distinct from 'mainnet' then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;
  return jsonb_build_object('ok', true, 'rows', coalesce((
    select jsonb_agg(jsonb_build_object('doc', d.doc, 'version', d.version) order by d.updated_at)
      from (
        select w.doc, w.version, w.updated_at
          from private.agent_paper_weeks w
         where w.network = p_network
           and (w.status = 'working' or (w.status = 'paused' and w.doc->>'pausedBy' = 'unread'))
         order by w.updated_at
         limit v_limit
      ) d
  ), '[]'::jsonb));
end;
$$;

-- The weeks that ended (done, ended, live) and stayed untouched for p_days (at least 30): gone; start attempts older than a
-- day with them.
create function public.agent_paper_purge(p_secret text, p_days integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_days integer := greatest(30, least(coalesce(p_days, 90), 3650));
  v_gone integer;
begin
  perform private.beta_check_secret(p_secret);
  delete from private.agent_paper_weeks w
   where w.status in ('done', 'ended', 'live') and w.updated_at < clock_timestamp() - make_interval(days => v_days);
  get diagnostics v_gone = row_count;
  delete from private.agent_paper_starts s where s.at < clock_timestamp() - interval '1 day';
  return jsonb_build_object('ok', true, 'gone', v_gone);
end;
$$;

revoke all on function public.agent_paper_get(text, text) from public, anon, authenticated, service_role;
revoke all on function public.agent_paper_admit(text, text, text, integer) from public, anon, authenticated, service_role;
revoke all on function public.agent_paper_start(text, text, text, text, jsonb, integer) from public, anon, authenticated, service_role;
revoke all on function public.agent_paper_put(text, text, text, text, jsonb, integer) from public, anon, authenticated, service_role;
revoke all on function public.agent_paper_due(text, text, integer) from public, anon, authenticated, service_role;
revoke all on function public.agent_paper_purge(text, integer) from public, anon, authenticated, service_role;

grant execute on function public.agent_paper_get(text, text) to anon;
grant execute on function public.agent_paper_admit(text, text, text, integer) to anon;
grant execute on function public.agent_paper_start(text, text, text, text, jsonb, integer) to anon;
grant execute on function public.agent_paper_put(text, text, text, text, jsonb, integer) to anon;
grant execute on function public.agent_paper_due(text, text, integer) to anon;
grant execute on function public.agent_paper_purge(text, integer) to anon;

commit;
