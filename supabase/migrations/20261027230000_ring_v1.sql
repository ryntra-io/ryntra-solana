-- Ryntra City: the Ring's agents (CITY-50) on the server.
--
-- PREPARED 2026-10-27 as a file only. Not applied to any Supabase project:
-- The Ring does not open in production without it: `lib/ring/ready.ts`
-- refuses to open on one instance's memory.
--
-- WHAT THIS FILE DOES
--   * Four `ring_` tables in `private`, row level security forced, no
--     policies and every grant revoked: the agents, their OpenRouter keys
--     (sealed by the server, never in clear), their ratings, and the answers
--     to request keys.
--   * The server reads and writes only through the `public.ring_*` functions
--     below, each gated by the app secret (`private.beta_check_secret`) and
--     each one transaction, the same way the world's and the vault's are.
--   * One active agent to a garage slot: a partial unique index, so two
--     creates at once give the slot to one. A change or a switch-off takes
--     the agent's row lock and happens only at the version its owner saw.
--   * Ratings are kept per agent, format and brain (model and provider): a new
--     brain starts from the start and the old rows stay. Matches (CITY-51)
--     write them; this file only reads them.
--
-- WHAT IT DOES NOT DO
--   No money, no match, no stake. No function here returns a sealed key:
--   nothing in CITY-50 reads a key back.

begin;

-- --------------------------------------------------------------- agents --

create table private.ring_agents (
  id uuid primary key,
  -- `a:<account id>`: a Ryntra account signed in with a wallet.
  owner text not null check (char_length(owner) between 3 and 140),
  quarter_id text not null check (quarter_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  slot integer not null check (slot between 0 and 63),
  archetype text not null check (archetype in ('guardian', 'fighter', 'tactician', 'scout', 'engineer', 'host')),
  model_id text not null check (char_length(model_id) between 3 and 160),
  model_name text not null check (char_length(model_name) between 1 and 160),
  provider text not null check (provider ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}(/[A-Za-z0-9][A-Za-z0-9._-]{0,31})?$'),
  provider_name text not null check (char_length(provider_name) <= 80),
  weight text not null check (weight in ('light', 'middle', 'heavy')),
  -- One standard match for this agent at its provider's price, micro-dollars.
  match_micro_usd bigint not null check (match_micro_usd between 0 and 2000000),
  formats text[] not null check (formats <@ array['duo-crack', 'code', 'market-replay']::text[] and cardinality(formats) between 1 and 3),
  scenario text not null check (char_length(scenario) <= 2000),
  status text not null check (status in ('active', 'off')),
  key_state text not null check (key_state in ('live', 'quiet', 'off')),
  key_hash text check (key_hash is null or key_hash ~ '^[A-Za-z0-9_-]{8,128}$'),
  key_limit_usd numeric(8, 2) check (key_limit_usd is null or (key_limit_usd > 0 and key_limit_usd <= 100)),
  version integer not null check (version >= 1),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  off_at timestamptz
);

create unique index ring_agents_garage_idx on private.ring_agents (quarter_id, slot) where status = 'active';
create index ring_agents_owner_idx on private.ring_agents (owner, created_at);

-- ----------------------------------------------------------------- keys --

-- Every key ever made for an agent: the OpenRouter hash (not a secret), the
-- key sealed by the server (AES-256-GCM, `lib/ring/seal.ts`), its limit, and
-- when it was retired here and switched off at OpenRouter.
create table private.ring_keys (
  hash text primary key check (hash ~ '^[A-Za-z0-9_-]{8,128}$'),
  agent_id uuid not null references private.ring_agents (id),
  owner text not null check (char_length(owner) between 3 and 140),
  sealed text not null check (char_length(sealed) between 50 and 1500 and sealed ~ '^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{22}$'),
  limit_usd numeric(8, 2) not null check (limit_usd > 0 and limit_usd <= 100),
  made_at timestamptz not null,
  retired_at timestamptz,
  disabled_at timestamptz
);

create index ring_keys_agent_idx on private.ring_keys (agent_id);
create index ring_keys_owner_idx on private.ring_keys (owner, made_at);
-- Retired here but not yet confirmed off at OpenRouter: what a sweep looks at.
create index ring_keys_open_idx on private.ring_keys (retired_at) where retired_at is not null and disabled_at is null;

-- --------------------------------------------------------- dropped keys --

-- A key made for a write that did not hold (a lost race, a version that
-- moved): its secret was never kept, but it counts toward the owner's daily
-- limit, and one OpenRouter did not confirm off stays here for a sweep.
create table private.ring_key_drops (
  hash text primary key check (hash ~ '^[A-Za-z0-9_-]{8,128}$'),
  owner text not null check (char_length(owner) between 3 and 140),
  made_at timestamptz not null,
  disabled_at timestamptz
);

create index ring_key_drops_owner_idx on private.ring_key_drops (owner, made_at);
create index ring_key_drops_open_idx on private.ring_key_drops (made_at) where disabled_at is null;

-- -------------------------------------------------------------- ratings --

create table private.ring_ratings (
  agent_id uuid not null references private.ring_agents (id),
  format text not null check (format in ('duo-crack', 'code', 'market-replay')),
  model_id text not null check (char_length(model_id) between 3 and 160),
  provider text not null check (char_length(provider) between 1 and 96),
  rating double precision not null check (rating between 100 and 3900),
  games integer not null default 0 check (games >= 0),
  wins integer not null default 0 check (wins >= 0),
  draws integer not null default 0 check (draws >= 0),
  losses integer not null default 0 check (losses >= 0),
  -- What the games so far say about the rating (Fisher information).
  info double precision not null default 0 check (info >= 0),
  updated_at timestamptz not null,
  primary key (agent_id, format, model_id, provider),
  check (wins + draws + losses = games)
);

-- -------------------------------------------------------------- answers --

-- The answer to an Idempotency-Key, kept ten minutes, so a retried write is
-- never done twice.
create table private.ring_answers (
  key text primary key check (char_length(key) between 1 and 400),
  body jsonb not null check (pg_column_size(body) <= 65536),
  keep_until timestamptz not null
);

create index ring_answers_until_idx on private.ring_answers (keep_until);

-- ------------------------------------------------------------ the locks --

alter table private.ring_agents enable row level security;
alter table private.ring_agents force row level security;
alter table private.ring_keys enable row level security;
alter table private.ring_keys force row level security;
alter table private.ring_ratings enable row level security;
alter table private.ring_ratings force row level security;
alter table private.ring_answers enable row level security;
alter table private.ring_answers force row level security;
alter table private.ring_key_drops enable row level security;
alter table private.ring_key_drops force row level security;

revoke all privileges on table
  private.ring_agents, private.ring_keys, private.ring_ratings, private.ring_answers, private.ring_key_drops
  from public, anon, authenticated, service_role;

-- --------------------------------------------------------------- helpers --

create function private.ring_iso(p_at timestamptz)
returns text
language sql
stable
set search_path = ''
as $$
  select to_char(p_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
$$;

-- An agent as the server reads it (`agentOf` in lib/ring/supabase-store.ts).
create function private.ring_agent_json(r private.ring_agents)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', r.id,
    'owner', r.owner,
    'quarterId', r.quarter_id,
    'slot', r.slot,
    'archetype', r.archetype,
    'brain', jsonb_build_object(
      'id', r.model_id, 'name', r.model_name, 'provider', r.provider, 'providerName', r.provider_name,
      'weight', r.weight, 'matchMicroUsd', r.match_micro_usd),
    'formats', to_jsonb(r.formats),
    'scenario', r.scenario,
    'status', r.status,
    'key', jsonb_build_object('state', r.key_state, 'hash', r.key_hash, 'limitUsd', r.key_limit_usd),
    'version', r.version,
    'createdAt', private.ring_iso(r.created_at),
    'updatedAt', private.ring_iso(r.updated_at)
  );
$$;

revoke all on function private.ring_iso(timestamptz) from public, anon, authenticated, service_role;
revoke all on function private.ring_agent_json(private.ring_agents) from public, anon, authenticated, service_role;

-- ------------------------------------------------------- the server's API --

create function public.ring_agent(p_secret text, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r private.ring_agents%rowtype;
begin
  perform private.beta_check_secret(p_secret);
  select * into r from private.ring_agents where id = p_id;
  if not found then
    return jsonb_build_object('ok', true, 'agent', null);
  end if;
  return jsonb_build_object('ok', true, 'agent', private.ring_agent_json(r));
end;
$$;

-- The active agent in a garage slot.
create function public.ring_garage(p_secret text, p_quarter text, p_slot integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r private.ring_agents%rowtype;
begin
  perform private.beta_check_secret(p_secret);
  select * into r from private.ring_agents where quarter_id = p_quarter and slot = p_slot and status = 'active';
  if not found then
    return jsonb_build_object('ok', true, 'agent', null);
  end if;
  return jsonb_build_object('ok', true, 'agent', private.ring_agent_json(r));
end;
$$;

-- The rating rows of an agent's brain.
create function public.ring_ratings(p_secret text, p_agent uuid, p_model text, p_provider text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.beta_check_secret(p_secret);
  return jsonb_build_object('ok', true, 'ratings', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'format', x.format, 'rating', x.rating, 'games', x.games, 'wins', x.wins, 'draws', x.draws,
      'losses', x.losses, 'info', x.info
    ) order by x.format), '[]'::jsonb)
      from private.ring_ratings x
     where x.agent_id = p_agent and x.model_id = p_model and x.provider = p_provider
  ));
end;
$$;

-- Agents and keys an owner made since a moment: the daily limits.
create function public.ring_made(p_secret text, p_owner text, p_since timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.beta_check_secret(p_secret);
  return jsonb_build_object('ok', true,
    'agents', (select count(*)::integer from private.ring_agents a where a.owner = p_owner and a.created_at >= p_since),
    'keys', (select count(*)::integer from private.ring_keys k where k.owner = p_owner and k.made_at >= p_since)
          + (select count(*)::integer from private.ring_key_drops d where d.owner = p_owner and d.made_at >= p_since));
end;
$$;

-- A new agent, and its key if one was made. A slot with an active agent
-- refuses it: the partial unique index decides between two creates at once.
create function public.ring_create(
  p_secret text,
  p_id uuid,
  p_owner text,
  p_quarter text,
  p_slot integer,
  p_archetype text,
  p_model_id text,
  p_model_name text,
  p_provider text,
  p_provider_name text,
  p_weight text,
  p_match_micro_usd bigint,
  p_formats text[],
  p_scenario text,
  p_key_hash text,
  p_key_sealed text,
  p_key_limit_usd numeric,
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r private.ring_agents%rowtype;
begin
  perform private.beta_check_secret(p_secret);
  if p_now is null or (p_key_hash is null) <> (p_key_sealed is null) or (p_key_hash is null) <> (p_key_limit_usd is null) then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;
  insert into private.ring_agents (
    id, owner, quarter_id, slot, archetype, model_id, model_name, provider, provider_name, weight, match_micro_usd,
    formats, scenario, status, key_state, key_hash, key_limit_usd, version, created_at, updated_at
  ) values (
    p_id, p_owner, p_quarter, p_slot, p_archetype, p_model_id, p_model_name, p_provider, coalesce(p_provider_name, ''),
    p_weight, p_match_micro_usd, p_formats, p_scenario, 'active',
    case when p_key_hash is null then 'quiet' else 'live' end, p_key_hash, p_key_limit_usd, 1, p_now, p_now
  )
  on conflict (quarter_id, slot) where status = 'active' do nothing
  returning * into r;
  if not found then
    return jsonb_build_object('ok', true, 'created', false, 'error', 'slot_taken');
  end if;
  if p_key_hash is not null then
    insert into private.ring_keys (hash, agent_id, owner, sealed, limit_usd, made_at)
    values (p_key_hash, p_id, p_owner, p_key_sealed, p_key_limit_usd, p_now);
  end if;
  return jsonb_build_object('ok', true, 'created', true, 'agent', private.ring_agent_json(r));
end;
$$;

-- The agent's body, brain and script, at the version its owner saw, under
-- the row's lock. A new key replaces the live one, which is retired here and
-- comes back so the server switches it off at OpenRouter.
create function public.ring_change(
  p_secret text,
  p_id uuid,
  p_owner text,
  p_version integer,
  p_archetype text,
  p_model_id text,
  p_model_name text,
  p_provider text,
  p_provider_name text,
  p_weight text,
  p_match_micro_usd bigint,
  p_formats text[],
  p_scenario text,
  p_key_hash text,
  p_key_sealed text,
  p_key_limit_usd numeric,
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r private.ring_agents%rowtype;
  v_retired text := null;
begin
  perform private.beta_check_secret(p_secret);
  if p_now is null or (p_key_hash is null) <> (p_key_sealed is null) or (p_key_hash is null) <> (p_key_limit_usd is null) then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;
  select * into r from private.ring_agents where id = p_id for update;
  if not found then
    return jsonb_build_object('ok', true, 'changed', false, 'error', 'not_found', 'agent', null);
  end if;
  if r.owner <> p_owner then
    return jsonb_build_object('ok', true, 'changed', false, 'error', 'not_owner', 'agent', null);
  end if;
  if r.status <> 'active' then
    return jsonb_build_object('ok', true, 'changed', false, 'error', 'off', 'agent', private.ring_agent_json(r));
  end if;
  if r.version <> p_version then
    return jsonb_build_object('ok', true, 'changed', false, 'error', 'version', 'agent', private.ring_agent_json(r));
  end if;
  if p_key_hash is not null then
    if r.key_state = 'live' and r.key_hash is not null then
      v_retired := r.key_hash;
      update private.ring_keys set retired_at = p_now where hash = r.key_hash and retired_at is null;
    end if;
    insert into private.ring_keys (hash, agent_id, owner, sealed, limit_usd, made_at)
    values (p_key_hash, p_id, p_owner, p_key_sealed, p_key_limit_usd, p_now);
  end if;
  update private.ring_agents
     set archetype = p_archetype,
         model_id = p_model_id,
         model_name = p_model_name,
         provider = p_provider,
         provider_name = coalesce(p_provider_name, ''),
         weight = p_weight,
         match_micro_usd = p_match_micro_usd,
         formats = p_formats,
         scenario = p_scenario,
         key_state = case when p_key_hash is null then r.key_state else 'live' end,
         key_hash = coalesce(p_key_hash, r.key_hash),
         key_limit_usd = case when p_key_hash is null then r.key_limit_usd else p_key_limit_usd end,
         version = r.version + 1,
         updated_at = p_now
   where id = p_id
   returning * into r;
  return jsonb_build_object('ok', true, 'changed', true, 'agent', private.ring_agent_json(r), 'retired', v_retired);
end;
$$;

-- The agent switched off at the version its owner saw; its slot is free
-- again, its key retired here and handed back to be switched off.
create function public.ring_off(p_secret text, p_id uuid, p_owner text, p_version integer, p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r private.ring_agents%rowtype;
  v_retired text := null;
begin
  perform private.beta_check_secret(p_secret);
  if p_now is null then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;
  select * into r from private.ring_agents where id = p_id for update;
  if not found then
    return jsonb_build_object('ok', true, 'changed', false, 'error', 'not_found', 'agent', null);
  end if;
  if r.owner <> p_owner then
    return jsonb_build_object('ok', true, 'changed', false, 'error', 'not_owner', 'agent', null);
  end if;
  if r.status <> 'active' then
    return jsonb_build_object('ok', true, 'changed', false, 'error', 'off', 'agent', private.ring_agent_json(r));
  end if;
  if r.version <> p_version then
    return jsonb_build_object('ok', true, 'changed', false, 'error', 'version', 'agent', private.ring_agent_json(r));
  end if;
  if r.key_state = 'live' and r.key_hash is not null then
    v_retired := r.key_hash;
    update private.ring_keys set retired_at = p_now where hash = r.key_hash and retired_at is null;
  end if;
  update private.ring_agents
     set status = 'off', key_state = 'off', off_at = p_now, version = r.version + 1, updated_at = p_now
   where id = p_id
   returning * into r;
  return jsonb_build_object('ok', true, 'changed', true, 'agent', private.ring_agent_json(r), 'retired', v_retired);
end;
$$;

-- OpenRouter confirmed the key is off.
create function public.ring_key_disabled(p_secret text, p_hash text, p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.beta_check_secret(p_secret);
  update private.ring_keys
     set disabled_at = p_now, retired_at = coalesce(retired_at, p_now)
   where hash = p_hash and disabled_at is null;
  return jsonb_build_object('ok', true);
end;
$$;

-- A key made for nothing: counted toward the daily limit, kept for a sweep
-- until OpenRouter confirms it off. A key an agent holds is never a dropped one.
create function public.ring_key_dropped(p_secret text, p_hash text, p_owner text, p_disabled boolean, p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.beta_check_secret(p_secret);
  if exists (select 1 from private.ring_keys k where k.hash = p_hash) then
    return jsonb_build_object('ok', true);
  end if;
  insert into private.ring_key_drops (hash, owner, made_at, disabled_at)
  values (p_hash, p_owner, p_now, case when p_disabled then p_now end)
  on conflict (hash) do update set disabled_at = coalesce(private.ring_key_drops.disabled_at, excluded.disabled_at);
  return jsonb_build_object('ok', true);
end;
$$;

create function public.ring_answer(p_secret text, p_key text, p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_body jsonb;
begin
  perform private.beta_check_secret(p_secret);
  select a.body into v_body from private.ring_answers a where a.key = p_key and a.keep_until > p_now;
  return jsonb_build_object('ok', true, 'body', v_body);
end;
$$;

-- Keeps an answer ten minutes; answers past their time go.
create function public.ring_keep_answer(p_secret text, p_key text, p_body jsonb, p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.beta_check_secret(p_secret);
  delete from private.ring_answers
   where ctid in (select ctid from private.ring_answers where keep_until <= p_now limit 100);
  insert into private.ring_answers as a (key, body, keep_until)
  values (p_key, p_body, p_now + interval '10 minutes')
  on conflict (key) do update set body = excluded.body, keep_until = excluded.keep_until;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.ring_agent(text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.ring_garage(text, text, integer) from public, anon, authenticated, service_role;
revoke all on function public.ring_ratings(text, uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function public.ring_made(text, text, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.ring_create(text, uuid, text, text, integer, text, text, text, text, text, text, bigint, text[], text, text, text, numeric, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.ring_change(text, uuid, text, integer, text, text, text, text, text, text, bigint, text[], text, text, text, numeric, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.ring_off(text, uuid, text, integer, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.ring_key_disabled(text, text, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.ring_key_dropped(text, text, text, boolean, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.ring_answer(text, text, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.ring_keep_answer(text, text, jsonb, timestamptz) from public, anon, authenticated, service_role;

grant execute on function public.ring_agent(text, uuid) to anon;
grant execute on function public.ring_garage(text, text, integer) to anon;
grant execute on function public.ring_ratings(text, uuid, text, text) to anon;
grant execute on function public.ring_made(text, text, timestamptz) to anon;
grant execute on function public.ring_create(text, uuid, text, text, integer, text, text, text, text, text, text, bigint, text[], text, text, text, numeric, timestamptz) to anon;
grant execute on function public.ring_change(text, uuid, text, integer, text, text, text, text, text, text, bigint, text[], text, text, text, numeric, timestamptz) to anon;
grant execute on function public.ring_off(text, uuid, text, integer, timestamptz) to anon;
grant execute on function public.ring_key_disabled(text, text, timestamptz) to anon;
grant execute on function public.ring_key_dropped(text, text, text, boolean, timestamptz) to anon;
grant execute on function public.ring_answer(text, text, timestamptz) to anon;
grant execute on function public.ring_keep_answer(text, text, jsonb, timestamptz) to anon;

commit;
