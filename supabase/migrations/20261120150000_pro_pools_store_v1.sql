-- Ryntra: the tape of the Meteora DLMM Pro pools kept in the database, not in a process's memory.
--
-- PREPARED 2026-11-20 as a file only. Not applied to any Supabase project.
-- Until it is applied the routes answer as before, from the instance's own
-- memory (`lib/pro-pools/answers.server.ts`): a function that is not there is
-- a store that did not answer.
--
-- WHAT THIS FILE DOES
--   * Two tables, nothing else of the schema touched:
--     `private.pro_pool_txs` — one landed transaction of one pool: listed by
--     the node (`unread`), read once (`read`, its records kept as the server
--     decoded them — strings, numbers and flags only), or not given by the
--     node (`lost`, with how many times). A read row never changes.
--     `private.pro_pool_state` — one row per pool: its day counted (volume,
--     fees, trades, limit orders, how deep and why it stops there), where the
--     node's list of its signatures was read to, and the node's refusals in a
--     row. One more row per network (`pool = 'lease'`) is the indexer's
--     lease, so that one indexer runs at a time.
--     Row level security forced on both, no policies, every grant revoked.
--   * The server reads and writes only through the eight `public.pro_pool_*`
--     functions below, each gated by the app secret
--     (`private.beta_check_secret`) and each one transaction, the same way
--     the stops' are (`20261029200000_spot_stops_v1.sql`). None takes a
--     table's name or a statement.
--   * The lease is taken by one conditional update on the database's own
--     clock: two indexers never run together, and a step begins at most once
--     per `p_gap_seconds` — the node's budget of reads holds for every
--     instance at once. Every write asks for the lease's holder.
--
-- WHAT IT DOES NOT DO
--   No money, no key, no transaction, no person's data: public facts of a
--   public chain, read once and kept three days. No existing table, function
--   or row is changed.

begin;

create table private.pro_pool_txs (
  network text not null check (network in ('devnet', 'mainnet')),
  pool text not null check (pool ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  signature text not null check (signature ~ '^[1-9A-HJ-NP-Za-km-z]{32,100}$'),
  slot bigint not null check (slot >= 0),
  block_time timestamptz,
  state text not null check (state in ('unread', 'read', 'lost')),
  misses integer not null default 0 check (misses >= 0),
  lost_at timestamptz,
  records jsonb,
  seen_at timestamptz not null,
  read_at timestamptz,
  primary key (network, pool, signature),
  check ((state = 'read') = (records is not null)),
  check ((state = 'read') = (read_at is not null))
);

-- The newest transactions of a pool.
create index pro_pool_txs_recent_idx on private.pro_pool_txs (network, pool, slot desc);
-- What is still to read, the newest first.
create index pro_pool_txs_unread_idx on private.pro_pool_txs (network, slot desc) where state <> 'read';

create table private.pro_pool_state (
  network text not null check (network in ('devnet', 'mainnet')),
  pool text not null check (pool = 'lease' or pool ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  -- A pool's row: the day counted, the list's cursor, the node's refusals in a row.
  summary jsonb,
  counted_at timestamptz,
  head_signature text,
  tail_signature text,
  tail_time timestamptz,
  list_end boolean not null default false,
  checked_at timestamptz,
  fails integer not null default 0 check (fails >= 0),
  failed_at timestamptz,
  -- The lease's row: who indexes now and until when, when the last step began and ended.
  lease_holder text,
  lease_until timestamptz,
  step_started_at timestamptz,
  step_ended_at timestamptz,
  updated_at timestamptz not null,
  primary key (network, pool)
);

alter table private.pro_pool_txs enable row level security;
alter table private.pro_pool_txs force row level security;
revoke all privileges on table private.pro_pool_txs from public, anon, authenticated, service_role;

alter table private.pro_pool_state enable row level security;
alter table private.pro_pool_state force row level security;
revoke all privileges on table private.pro_pool_state from public, anon, authenticated, service_role;

-- ------------------------------------------------------- the server's API --

-- Takes the network's lease for p_ttl_seconds unless another holds it or a step began less than p_gap_seconds ago.
create function public.pro_pool_lease_take(p_secret text, p_network text, p_holder text, p_ttl_seconds integer, p_gap_seconds integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_ttl integer := greatest(10, least(coalesce(p_ttl_seconds, 90), 600));
  v_gap integer := greatest(0, least(coalesce(p_gap_seconds, 50), 600));
begin
  perform private.beta_check_secret(p_secret);
  if p_network is null or p_network not in ('devnet', 'mainnet') or p_holder is null or char_length(p_holder) not between 8 and 64 then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;
  insert into private.pro_pool_state (network, pool, updated_at) values (p_network, 'lease', v_now)
  on conflict (network, pool) do nothing;
  update private.pro_pool_state s
     set lease_holder = p_holder, lease_until = v_now + make_interval(secs => v_ttl), step_started_at = v_now, updated_at = v_now
   where s.network = p_network and s.pool = 'lease'
     and (s.lease_until is null or s.lease_until <= v_now)
     and (s.step_started_at is null or s.step_started_at <= v_now - make_interval(secs => v_gap));
  return jsonb_build_object('ok', true, 'taken', found);
end;
$$;

-- Frees the lease its holder took; another's lease stays.
create function public.pro_pool_lease_free(p_secret text, p_network text, p_holder text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
begin
  perform private.beta_check_secret(p_secret);
  update private.pro_pool_state s
     set lease_holder = null, lease_until = v_now, step_ended_at = v_now, updated_at = v_now
   where s.network = p_network and s.pool = 'lease' and s.lease_holder = p_holder;
  return jsonb_build_object('ok', true, 'freed', found);
end;
$$;

-- Every pool's state and the indexer's, in one read. Times are milliseconds, ages on the database's own clock.
create function public.pro_pool_states(p_secret text, p_network text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
begin
  perform private.beta_check_secret(p_secret);
  return jsonb_build_object(
    'ok', true,
    'step', (
      select jsonb_build_object(
        'running', l.lease_until is not null and l.lease_until > v_now,
        'startedAgo', floor(extract(epoch from (v_now - l.step_started_at)) * 1000)::bigint,
        'endedAgo', floor(extract(epoch from (v_now - l.step_ended_at)) * 1000)::bigint
      )
        from private.pro_pool_state l
       where l.network = p_network and l.pool = 'lease'
    ),
    'pools', coalesce((
      select jsonb_agg(jsonb_build_object(
        'pool', s.pool,
        'summary', s.summary,
        'head', s.head_signature,
        'tail', s.tail_signature,
        'tailTime', floor(extract(epoch from s.tail_time))::bigint,
        'end', s.list_end,
        'checkedAt', floor(extract(epoch from s.checked_at) * 1000)::bigint,
        'fails', s.fails,
        'failedAt', floor(extract(epoch from s.failed_at) * 1000)::bigint,
        'writtenAgo', floor(extract(epoch from (v_now - s.updated_at)) * 1000)::bigint
      ) order by s.pool)
        from private.pro_pool_state s
       where s.network = p_network and s.pool <> 'lease'
    ), '[]'::jsonb)
  );
end;
$$;

-- Writes a batch of transactions, the pools of p_reset emptied first. A listed one is kept unless known; a read or
-- lost one replaces what is not read yet; a read row never changes. Only for the lease's holder.
create function public.pro_pool_txs_put(p_secret text, p_network text, p_holder text, p_txs jsonb, p_reset jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_count integer := 0;
begin
  perform private.beta_check_secret(p_secret);
  if p_txs is null or jsonb_typeof(p_txs) <> 'array' or jsonb_array_length(p_txs) > 2000
     or (p_reset is not null and jsonb_typeof(p_reset) <> 'array') then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;
  if not exists (
    select 1 from private.pro_pool_state l
     where l.network = p_network and l.pool = 'lease' and l.lease_holder = p_holder and l.lease_until > v_now
  ) then
    return jsonb_build_object('ok', true, 'written', false);
  end if;
  if p_reset is not null then
    delete from private.pro_pool_txs t
     where t.network = p_network and t.pool in (select jsonb_array_elements_text(p_reset));
  end if;
  insert into private.pro_pool_txs as t (network, pool, signature, slot, block_time, state, misses, lost_at, records, seen_at, read_at)
  select p_network, x.pool, x.signature, x.slot, to_timestamp(x."blockTime"), x.state, coalesce(x.misses, 0),
         case when x.state = 'lost' then v_now end,
         case when x.state = 'read' then nullif(x.records, 'null'::jsonb) end,
         v_now,
         case when x.state = 'read' then v_now end
    from jsonb_to_recordset(p_txs) as x(pool text, signature text, slot bigint, "blockTime" double precision, state text, misses integer, records jsonb)
  on conflict (network, pool, signature) do update
     set state = excluded.state, misses = excluded.misses, lost_at = excluded.lost_at, records = excluded.records, read_at = excluded.read_at
   where t.state <> 'read' and excluded.state <> 'unread';
  get diagnostics v_count = row_count;
  return jsonb_build_object('ok', true, 'written', true, 'rows', v_count);
end;
$$;

-- Writes a batch of pools' states; a null summary keeps the one counted before. Only for the lease's holder.
create function public.pro_pool_state_put(p_secret text, p_network text, p_holder text, p_states jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_count integer := 0;
begin
  perform private.beta_check_secret(p_secret);
  if p_states is null or jsonb_typeof(p_states) <> 'array' or jsonb_array_length(p_states) > 1000 then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;
  if not exists (
    select 1 from private.pro_pool_state l
     where l.network = p_network and l.pool = 'lease' and l.lease_holder = p_holder and l.lease_until > v_now
  ) then
    return jsonb_build_object('ok', true, 'written', false);
  end if;
  insert into private.pro_pool_state as s (network, pool, summary, counted_at, head_signature, tail_signature, tail_time, list_end, checked_at, fails, failed_at, updated_at)
  select p_network, x.pool, nullif(x.summary, 'null'::jsonb), (x.summary->>'at')::timestamptz, x.head, x.tail, to_timestamp(x."tailTime"), coalesce(x."end", false),
         to_timestamp(x."checkedAt" / 1000.0), coalesce(x.fails, 0), to_timestamp(x."failedAt" / 1000.0), v_now
    from jsonb_to_recordset(p_states) as x(pool text, summary jsonb, head text, tail text, "tailTime" double precision, "end" boolean, "checkedAt" double precision, fails integer, "failedAt" double precision)
   where x.pool <> 'lease'
  on conflict (network, pool) do update
     set summary = coalesce(excluded.summary, s.summary), counted_at = coalesce(excluded.counted_at, s.counted_at),
         head_signature = excluded.head_signature, tail_signature = excluded.tail_signature, tail_time = excluded.tail_time,
         list_end = excluded.list_end, checked_at = excluded.checked_at, fails = excluded.fails, failed_at = excluded.failed_at,
         updated_at = excluded.updated_at;
  get diagnostics v_count = row_count;
  return jsonb_build_object('ok', true, 'written', true, 'rows', v_count);
end;
$$;

-- The newest read transactions of a pool (p_kind: any, those with a trade, those with an order placed or collected),
-- landed since p_since where given, and how many of that span are still not read — p_tries misses is the node's refusal.
create function public.pro_pool_txs_recent(p_secret text, p_network text, p_pool text, p_kind text, p_since timestamptz, p_limit integer, p_tries integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 100), 5000));
  v_tries integer := greatest(1, coalesce(p_tries, 3));
begin
  perform private.beta_check_secret(p_secret);
  if p_kind is null or p_kind not in ('any', 'trades', 'orders') then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;
  return jsonb_build_object(
    'ok', true,
    'txs', coalesce((
      select jsonb_agg(r.records order by r.slot desc, r.signature desc)
        from (
          select t.records, t.slot, t.signature
            from private.pro_pool_txs t
           where t.network = p_network and t.pool = p_pool and t.state = 'read'
             and (p_since is null or t.block_time is null or t.block_time >= p_since)
             and (
               p_kind = 'any'
               or (p_kind = 'trades' and jsonb_path_exists(t.records, '$.trades[0]'))
               or (p_kind = 'orders' and (jsonb_path_exists(t.records, '$.placed[0]') or jsonb_path_exists(t.records, '$.collects[0]')))
             )
           order by t.slot desc, t.signature desc
           limit v_limit
        ) r
    ), '[]'::jsonb),
    'pending', (
      select count(*)::integer from private.pro_pool_txs t
       where t.network = p_network and t.pool = p_pool and t.state <> 'read'
         and (p_since is null or t.block_time is null or t.block_time >= p_since)
    ),
    'refused', (
      select count(*)::integer from private.pro_pool_txs t
       where t.network = p_network and t.pool = p_pool and t.state <> 'read' and t.misses >= v_tries
         and (p_since is null or t.block_time is null or t.block_time >= p_since)
    )
  );
end;
$$;

-- Transactions not read yet across the network's pools, the newest first.
create function public.pro_pool_txs_unread(p_secret text, p_network text, p_limit integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.beta_check_secret(p_secret);
  return jsonb_build_object('ok', true, 'txs', coalesce((
    select jsonb_agg(jsonb_build_object(
      'pool', u.pool,
      'signature', u.signature,
      'slot', u.slot,
      'blockTime', floor(extract(epoch from u.block_time))::bigint,
      'state', u.state,
      'misses', u.misses,
      'lostAt', floor(extract(epoch from u.lost_at) * 1000)::bigint
    ) order by u.slot desc, u.signature desc)
      from (
        select * from private.pro_pool_txs t
         where t.network = p_network and t.state <> 'read'
         order by t.slot desc, t.signature desc
         limit greatest(1, least(coalesce(p_limit, 1000), 5000))
      ) u
  ), '[]'::jsonb));
end;
$$;

-- Lets go of transactions older than p_days (never fewer than two — the day counted stays whole), the newest p_keep of
-- each pool kept whatever their age, and of pools the indexer no longer writes. Only for the lease's holder.
create function public.pro_pool_purge(p_secret text, p_network text, p_holder text, p_days integer, p_keep integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_before timestamptz := v_now - make_interval(days => greatest(coalesce(p_days, 3), 2));
  v_keep integer := greatest(0, least(coalesce(p_keep, 0), 1000));
  v_txs integer := 0;
  v_pools integer := 0;
begin
  perform private.beta_check_secret(p_secret);
  if not exists (
    select 1 from private.pro_pool_state l
     where l.network = p_network and l.pool = 'lease' and l.lease_holder = p_holder and l.lease_until > v_now
  ) then
    return jsonb_build_object('ok', true, 'purged', false);
  end if;
  delete from private.pro_pool_txs t
   where t.network = p_network
     and coalesce(t.block_time, t.seen_at) < v_before
     and (v_keep = 0 or t.slot < coalesce((
       select k.slot from private.pro_pool_txs k
        where k.network = t.network and k.pool = t.pool
        order by k.slot desc
        offset greatest(v_keep - 1, 0) limit 1
     ), 0));
  get diagnostics v_txs = row_count;
  delete from private.pro_pool_state s
   where s.network = p_network and s.pool <> 'lease' and s.updated_at < v_before;
  get diagnostics v_pools = row_count;
  return jsonb_build_object('ok', true, 'purged', true, 'txs', v_txs, 'pools', v_pools);
end;
$$;

revoke all on function public.pro_pool_lease_take(text, text, text, integer, integer) from public, anon, authenticated, service_role;
revoke all on function public.pro_pool_lease_free(text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.pro_pool_states(text, text) from public, anon, authenticated, service_role;
revoke all on function public.pro_pool_txs_put(text, text, text, jsonb, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.pro_pool_state_put(text, text, text, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.pro_pool_txs_recent(text, text, text, text, timestamptz, integer, integer) from public, anon, authenticated, service_role;
revoke all on function public.pro_pool_txs_unread(text, text, integer) from public, anon, authenticated, service_role;
revoke all on function public.pro_pool_purge(text, text, text, integer, integer) from public, anon, authenticated, service_role;

grant execute on function public.pro_pool_lease_take(text, text, text, integer, integer) to anon;
grant execute on function public.pro_pool_lease_free(text, text, text) to anon;
grant execute on function public.pro_pool_states(text, text) to anon;
grant execute on function public.pro_pool_txs_put(text, text, text, jsonb, jsonb) to anon;
grant execute on function public.pro_pool_state_put(text, text, text, jsonb) to anon;
grant execute on function public.pro_pool_txs_recent(text, text, text, text, timestamptz, integer, integer) to anon;
grant execute on function public.pro_pool_txs_unread(text, text, integer) to anon;
grant execute on function public.pro_pool_purge(text, text, text, integer, integer) to anon;

commit;
