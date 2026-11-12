-- Ryntra City: the Arena opens — the Ring's duels and ratings on the server (CITY-217).
--
-- PREPARED 2026-11-08 as a file only. Not applied to any Supabase project:
-- It stands on `20261027230000_ring_v1.sql` (apply that one first). Without
-- both, production keeps the Ring and its duels closed: `lib/ring/ready.ts`
-- and `lib/ring/duel/ready.ts` refuse to open on one instance's memory.
--
-- WHAT THIS FILE DOES
--   * One `ring_` table in `private`, row level security forced, no policies
--     and every grant revoked: the duels — the whole record the server plays
--     and shows (log, rules, the judge's receipts, and until the end the
--     phrases of Duo Crack), who started it, who sat in it, and what its
--     models may spend and did spend.
--   * Opening a duel and the day's limits are one step under one lock: an
--     account starts at most so many duels a day, an agent plays at most so
--     many, and the duels of a UTC day spend at most the deployment's ceiling
--     on models (`RYNTRA_RING_DAILY_USD`) — a live duel holds its most, a
--     finished one counts what it spent.
--   * A finished duel is never written again: a duel the reader found stalled
--     and voided stays void when a late harness comes back.
--   * For the Arena: an owner's active agents, the rivals of an agent's class
--     for a rated duel, the board of a format, a rating written only at the
--     game count the server read (two duels at once never lose a game), and
--     an agent's live sealed key handed back to the server for one match.
--     The key stays sealed (AES-256-GCM, `lib/ring/seal.ts`); only the server,
--     with `RYNTRA_RING_SEAL_SECRET`, opens it.
--   * Every server function is gated by the app secret
--     (`private.beta_check_secret`), runs with an empty search path and is
--     granted to `anon` alone, as in `ring_v1`.
--
-- WHAT IT DOES NOT DO
--   No money, no stake, no pool, no prize: every duel plays for nothing
--   (`money: "none"`). Nothing is
--   deleted.

begin;

-- ---------------------------------------------------------------- duels --

create table private.ring_duels (
  id text primary key check (id ~ '^duel-[A-Za-z0-9-]{8,64}$'),
  -- `a:<account id>`: who started it.
  owner text not null check (char_length(owner) between 3 and 140),
  -- The two seats: an agent's id, or a house sparring agent's name.
  seat_a text not null check (seat_a ~ '^[A-Za-z0-9._:-]{1,64}$'),
  seat_b text not null check (seat_b ~ '^[A-Za-z0-9._:-]{1,64}$'),
  format text not null check (format in ('duo-crack', 'market-replay')),
  status text not null check (status in ('live', 'done', 'void')),
  record jsonb not null check (jsonb_typeof(record) = 'object' and pg_column_size(record) <= 262144),
  -- The most its models may spend, micro-dollars: held against the day's
  -- ceiling while it is live.
  reserved_micro_usd bigint not null check (reserved_micro_usd between 0 and 10000000),
  -- What its models did spend, once it is over.
  spent_micro_usd bigint check (spent_micro_usd is null or spent_micro_usd between 0 and 10000000),
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create index ring_duels_created_idx on private.ring_duels (created_at desc);
create index ring_duels_owner_idx on private.ring_duels (owner, created_at);
create index ring_duels_seat_a_idx on private.ring_duels (seat_a, created_at);
create index ring_duels_seat_b_idx on private.ring_duels (seat_b, created_at);

alter table private.ring_duels enable row level security;
alter table private.ring_duels force row level security;

revoke all privileges on table private.ring_duels from public, anon, authenticated, service_role;

-- ------------------------------------------------------ the server's API --

-- A new duel, with the day's limits checked under one lock: two starts at
-- once never both pass a limit only one of them fits under.
create function public.ring_duel_open(
  p_secret text,
  p_id text,
  p_owner text,
  p_seat_a text,
  p_seat_b text,
  p_format text,
  p_record jsonb,
  p_reserved bigint,
  p_agents text[],
  p_since timestamptz,
  p_day timestamptz,
  p_per_owner integer,
  p_per_agent integer,
  p_cap bigint,
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agent text;
  v_spent bigint;
  v_owner_spent bigint;
begin
  perform private.beta_check_secret(p_secret);
  if p_now is null or p_since is null or p_day is null or p_reserved is null or p_cap is null
     or p_per_owner is null or p_per_agent is null or p_reserved < 0 or p_cap < 0 then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;
  perform pg_advisory_xact_lock(hashtext('private.ring_duels:open'));
  -- A retried start (the same id) answers «exists» before any limit is counted: a copy sent at once never reads as «full».
  if exists (select 1 from private.ring_duels d where d.id = p_id) then
    return jsonb_build_object('ok', true, 'opened', false, 'error', 'exists');
  end if;
  if (select count(*) from private.ring_duels d where d.owner = p_owner and d.created_at >= p_since) >= p_per_owner then
    return jsonb_build_object('ok', true, 'opened', false, 'error', 'rate_limited');
  end if;
  foreach v_agent in array coalesce(p_agents, array[]::text[]) loop
    if (select count(*) from private.ring_duels d
         where (d.seat_a = v_agent or d.seat_b = v_agent) and d.created_at >= p_since) >= p_per_agent then
      return jsonb_build_object('ok', true, 'opened', false, 'error', 'rate_limited');
    end if;
  end loop;
  if p_reserved > 0 then
    select coalesce(sum(coalesce(d.spent_micro_usd, d.reserved_micro_usd)), 0) into v_spent
      from private.ring_duels d
     where d.created_at >= p_day;
    if v_spent + p_reserved > p_cap then
      return jsonb_build_object('ok', true, 'opened', false, 'error', 'daily_cap');
    end if;
    -- One account's part: a quarter of the day's ceiling, or its first duel (`ownerOverShare` in service.ts).
    select coalesce(sum(coalesce(d.spent_micro_usd, d.reserved_micro_usd)), 0) into v_owner_spent
      from private.ring_duels d
     where d.created_at >= p_day and d.owner = p_owner;
    if v_owner_spent > 0 and v_owner_spent + p_reserved > p_cap / 4 then
      return jsonb_build_object('ok', true, 'opened', false, 'error', 'daily_cap');
    end if;
  end if;
  insert into private.ring_duels (id, owner, seat_a, seat_b, format, status, record, reserved_micro_usd, created_at, updated_at)
  values (p_id, p_owner, p_seat_a, p_seat_b, p_format, 'live', p_record, p_reserved, p_now, p_now)
  on conflict (id) do nothing;
  if not found then
    return jsonb_build_object('ok', true, 'opened', false, 'error', 'exists');
  end if;
  return jsonb_build_object('ok', true, 'opened', true);
end;
$$;

-- The duel as it goes on: written only while it is live here.
create function public.ring_duel_put(p_secret text, p_id text, p_status text, p_record jsonb, p_spent bigint, p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.beta_check_secret(p_secret);
  if p_now is null or p_status not in ('live', 'done', 'void') then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;
  update private.ring_duels
     set status = p_status,
         record = p_record,
         spent_micro_usd = case when p_status = 'live' then null else coalesce(p_spent, reserved_micro_usd) end,
         updated_at = p_now
   where id = p_id and status = 'live';
  return jsonb_build_object('ok', true, 'written', found);
end;
$$;

create function public.ring_duel_get(p_secret text, p_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_record jsonb;
begin
  perform private.beta_check_secret(p_secret);
  select d.record into v_record from private.ring_duels d where d.id = p_id;
  return jsonb_build_object('ok', true, 'record', v_record);
end;
$$;

create function public.ring_duel_recent(p_secret text, p_limit integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.beta_check_secret(p_secret);
  return jsonb_build_object('ok', true, 'records', (
    select coalesce(jsonb_agg(x.record order by x.created_at desc), '[]'::jsonb)
      from (select d.record, d.created_at from private.ring_duels d
             order by d.created_at desc limit least(greatest(coalesce(p_limit, 12), 1), 50)) x
  ));
end;
$$;

-- Duels since a moment that this owner started, or that this agent sat in.
create function public.ring_duel_count(p_secret text, p_owner text, p_agent text, p_since timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.beta_check_secret(p_secret);
  return jsonb_build_object('ok', true, 'count', (
    select count(*)::integer from private.ring_duels d
     where d.created_at >= p_since
       and (p_owner is null or d.owner = p_owner)
       and (p_agent is null or d.seat_a = p_agent or d.seat_b = p_agent)
  ));
end;
$$;

-- What the duels since a moment spent on models, the live ones at their most.
create function public.ring_duel_spent(p_secret text, p_since timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.beta_check_secret(p_secret);
  return jsonb_build_object('ok', true, 'spent', (
    select coalesce(sum(coalesce(d.spent_micro_usd, d.reserved_micro_usd)), 0)::bigint
      from private.ring_duels d where d.created_at >= p_since
  ));
end;
$$;

-- --------------------------------------------------------- the Arena --

-- An owner's active agents, oldest first.
create function public.ring_mine(p_secret text, p_owner text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.beta_check_secret(p_secret);
  return jsonb_build_object('ok', true, 'rows', (
    select coalesce(jsonb_agg(private.ring_agent_json(a) order by a.created_at, a.id), '[]'::jsonb)
      from private.ring_agents a
     where a.owner = p_owner and a.status = 'active'
  ));
end;
$$;

-- A rating row as the server reads it.
create function private.ring_rating_json(x private.ring_ratings)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select case when x.agent_id is null then null else jsonb_build_object(
    'format', x.format, 'rating', x.rating, 'games', x.games, 'wins', x.wins, 'draws', x.draws,
    'losses', x.losses, 'info', x.info) end;
$$;

revoke all on function private.ring_rating_json(private.ring_ratings) from public, anon, authenticated, service_role;

-- Active agents of other owners in one class that can play a format, the
-- closest to a rating first: the rivals a rated duel is drawn from.
create function public.ring_rivals(p_secret text, p_owner text, p_weight text, p_format text, p_near double precision, p_limit integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.beta_check_secret(p_secret);
  return jsonb_build_object('ok', true, 'rows', (
    select coalesce(jsonb_agg(jsonb_build_object('agent', private.ring_agent_json(y.a), 'rating', private.ring_rating_json(y.x))
                              order by y.gap, y.created_at), '[]'::jsonb)
      from (
        select a, x, a.created_at, abs(coalesce(x.rating, 1200) - coalesce(p_near, 1200)) as gap
          from private.ring_agents a
          left join private.ring_ratings x
            on x.agent_id = a.id and x.format = p_format and x.model_id = a.model_id and x.provider = a.provider
         where a.status = 'active' and a.key_state = 'live' and a.owner <> p_owner and a.weight = p_weight and p_format = any (a.formats)
         order by gap, a.created_at
         limit least(greatest(coalesce(p_limit, 8), 1), 50)
      ) y
  ));
end;
$$;

-- The board of a format: active agents with a rated game on their brain, best first.
create function public.ring_board(p_secret text, p_format text, p_limit integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.beta_check_secret(p_secret);
  return jsonb_build_object('ok', true, 'rows', (
    select coalesce(jsonb_agg(jsonb_build_object('agent', private.ring_agent_json(y.a), 'rating', private.ring_rating_json(y.x))
                              order by y.rating desc, y.games desc), '[]'::jsonb)
      from (
        select a, x, x.rating, x.games
          from private.ring_agents a
          join private.ring_ratings x
            on x.agent_id = a.id and x.format = p_format and x.model_id = a.model_id and x.provider = a.provider
         where a.status = 'active' and x.games > 0
         order by x.rating desc, x.games desc
         limit least(greatest(coalesce(p_limit, 50), 1), 100)
      ) y
  ));
end;
$$;

-- A rating row after a rated duel, written only if the row still has the
-- games the server read (`p_before`): a second duel finishing at once reads
-- again and tries again, so no game is lost.
create function public.ring_rate(
  p_secret text,
  p_agent uuid,
  p_format text,
  p_model text,
  p_provider text,
  p_before integer,
  p_rating double precision,
  p_games integer,
  p_wins integer,
  p_draws integer,
  p_losses integer,
  p_info double precision,
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.beta_check_secret(p_secret);
  if p_now is null or p_before is null or p_games <> p_before + 1 then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;
  if p_before = 0 then
    insert into private.ring_ratings (agent_id, format, model_id, provider, rating, games, wins, draws, losses, info, updated_at)
    values (p_agent, p_format, p_model, p_provider, p_rating, p_games, p_wins, p_draws, p_losses, p_info, p_now)
    on conflict (agent_id, format, model_id, provider) do nothing;
  else
    update private.ring_ratings
       set rating = p_rating, games = p_games, wins = p_wins, draws = p_draws, losses = p_losses, info = p_info, updated_at = p_now
     where agent_id = p_agent and format = p_format and model_id = p_model and provider = p_provider and games = p_before;
  end if;
  return jsonb_build_object('ok', true, 'written', found);
end;
$$;

-- The agent's live key, still sealed, for the server to open for one match.
create function public.ring_key_sealed(p_secret text, p_agent uuid, p_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sealed text;
begin
  perform private.beta_check_secret(p_secret);
  select k.sealed into v_sealed
    from private.ring_keys k
    join private.ring_agents a on a.id = k.agent_id
   where k.agent_id = p_agent and k.hash = p_hash and k.retired_at is null
     and a.status = 'active' and a.key_state = 'live' and a.key_hash = p_hash;
  return jsonb_build_object('ok', true, 'sealed', v_sealed);
end;
$$;

revoke all on function public.ring_duel_open(text, text, text, text, text, text, jsonb, bigint, text[], timestamptz, timestamptz, integer, integer, bigint, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.ring_duel_put(text, text, text, jsonb, bigint, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.ring_duel_get(text, text) from public, anon, authenticated, service_role;
revoke all on function public.ring_duel_recent(text, integer) from public, anon, authenticated, service_role;
revoke all on function public.ring_duel_count(text, text, text, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.ring_duel_spent(text, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.ring_mine(text, text) from public, anon, authenticated, service_role;
revoke all on function public.ring_rivals(text, text, text, text, double precision, integer) from public, anon, authenticated, service_role;
revoke all on function public.ring_board(text, text, integer) from public, anon, authenticated, service_role;
revoke all on function public.ring_rate(text, uuid, text, text, text, integer, double precision, integer, integer, integer, integer, double precision, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.ring_key_sealed(text, uuid, text) from public, anon, authenticated, service_role;

grant execute on function public.ring_duel_open(text, text, text, text, text, text, jsonb, bigint, text[], timestamptz, timestamptz, integer, integer, bigint, timestamptz) to anon;
grant execute on function public.ring_duel_put(text, text, text, jsonb, bigint, timestamptz) to anon;
grant execute on function public.ring_duel_get(text, text) to anon;
grant execute on function public.ring_duel_recent(text, integer) to anon;
grant execute on function public.ring_duel_count(text, text, text, timestamptz) to anon;
grant execute on function public.ring_duel_spent(text, timestamptz) to anon;
grant execute on function public.ring_mine(text, text) to anon;
grant execute on function public.ring_rivals(text, text, text, text, double precision, integer) to anon;
grant execute on function public.ring_board(text, text, integer) to anon;
grant execute on function public.ring_rate(text, uuid, text, text, text, integer, double precision, integer, integer, integer, integer, double precision, timestamptz) to anon;
grant execute on function public.ring_key_sealed(text, uuid, text) to anon;

commit;
