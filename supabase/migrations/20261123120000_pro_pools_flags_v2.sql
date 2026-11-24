-- Ryntra: the DLMM Pro pools' tape without timeouts — flags in place of reading JSON, the day counted in the database.
--
-- PREPARED 2026-11-23 as a file only. Not applied to any Supabase project.
-- Until it is applied the server goes on as before: a function that is not
-- there is answered by the old path (`lib/pro-pools/supabase-store.ts`).
-- It needs `20261120150000_pro_pools_store_v1.sql` applied first.
--
-- WHY
--   `public.pro_pool_txs_recent` timed out on the server's 8 s transport about
--   1 100 times a day (≈ 3 % of its calls):
--   * the day of a pool was counted in the server, so each count pulled up to
--     5 000 whole transactions (≈ 4 MB) out of the database;
--   * «with a trade» and «with an order» were told by reading every row's JSON
--     (`jsonb_path_exists`) over the whole pool: 2.7 s on a pool of 21 000
--     rows, for no row at all.
--
-- WHAT THIS FILE DOES
--   * Two generated columns on `private.pro_pool_txs`, written by the database
--     itself from `records`: `has_trade` (a trade in the transaction) and
--     `has_order` (an order placed or collected). Each with a partial index on
--     the pool's newest rows, and one more on the rows not read yet. Adding a
--     stored column rewrites the table once: `lock_timeout` makes the file
--     give up rather than queue behind the indexer.
--   * `public.pro_pool_txs_recent` — the same arguments and the same answer;
--     the kind is told by the flags, each kind its own statement, so each
--     uses its own index.
--   * `public.pro_pool_day` — a pool's day counted where the rows are: the
--     transactions of the span, the trades, volume, fees, orders placed and
--     collected (the side of a collected order from its placing, else from its
--     payout — `lib/pro-pools/tape.ts` `fillOf`, statement for statement), the
--     first and last price. Raw sums as decimal strings; the dollars at the
--     coins' price now stay the server's (`statsOfTally`).
--   * `public.pro_pool_fills` — the newest transactions holding an order
--     collected with a part filled, and the sides of the orders in them.
--   * Two private helpers, immutable, executable by no role of the API.
--
-- WHAT IT DOES NOT DO
--   No money, no key, no transaction, no person's data. No row is written or
--   deleted; the tables' rules (row security forced, no grant) stay as they
--   are. No function of v1 changes its arguments or its answer.

begin;

set local lock_timeout = '10s';

alter table private.pro_pool_txs
  add column has_trade boolean not null generated always as ((records -> 'trades' -> 0) is not null) stored,
  add column has_order boolean not null generated always as ((records -> 'placed' -> 0) is not null or (records -> 'collects' -> 0) is not null) stored;

-- The newest transactions of a pool with a trade, and with an order.
create index pro_pool_txs_trades_idx on private.pro_pool_txs (network, pool, slot desc, signature desc) where has_trade;
create index pro_pool_txs_orders_idx on private.pro_pool_txs (network, pool, slot desc, signature desc) where has_order;
-- What of a pool is still to read; and its read transactions by when they landed — the day counted.
create index pro_pool_txs_pending_idx on private.pro_pool_txs (network, pool) where state <> 'read';
create index pro_pool_txs_day_idx on private.pro_pool_txs (network, pool, block_time) where state = 'read';

-- ------------------------------------------------------------- helpers --

-- A list of the records, or none where it is not one.
create function private.pro_pool_list(p_value jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case when jsonb_typeof(p_value) = 'array' then p_value else '[]'::jsonb end;
$$;

-- What a collected order filled: filled, partial, unfilled, or null where neither its placing (p_side) nor its payout
-- tells. `lib/pro-pools/tape.ts` `sideOfPayout` and `fillOf`, statement for statement.
create function private.pro_pool_fill_state(p_collect jsonb, p_side text, p_collected_in text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_bonus_x numeric := (p_collect ->> 'bonusXRaw')::numeric;
  v_bonus_y numeric := (p_collect ->> 'bonusYRaw')::numeric;
  v_x numeric := (p_collect ->> 'paidXRaw')::numeric - v_bonus_x;
  v_y numeric := (p_collect ->> 'paidYRaw')::numeric - v_bonus_y;
  v_referral numeric := coalesce((p_collect ->> 'referralRaw')::numeric, 0);
  v_referral_x boolean := coalesce(p_collect ->> 'referralToken' = 'x', false) and v_referral > 0;
  v_referral_y boolean := coalesce(p_collect ->> 'referralToken' = 'y', false) and v_referral > 0;
  v_side text := p_side;
  v_fee_x boolean;
  v_fee_y boolean;
  v_proceeds numeric;
  v_unfilled numeric;
begin
  if v_x is null or v_y is null then
    return null;
  end if;
  if v_side is null and v_bonus_x + v_bonus_y + v_referral > 0 then
    -- A fee means a fill, and a fill pays the other coin: Y for an ask, X for a bid.
    if v_x = 0 and v_y > 0 then
      v_side := 'ask';
    elsif v_y = 0 and v_x > 0 then
      v_side := 'bid';
    elsif p_collected_in = 'output' then
      -- In the output coin the fee is X for an ask and Y for a bid.
      v_fee_x := v_bonus_x > 0 or v_referral_x;
      v_fee_y := v_bonus_y > 0 or v_referral_y;
      if v_fee_x and not v_fee_y then
        v_side := 'ask';
      elsif v_fee_y and not v_fee_x then
        v_side := 'bid';
      end if;
    end if;
  end if;
  if v_side is null then
    return case when v_x > 0 and v_y > 0 then 'partial' when v_x = 0 and v_y = 0 then 'unfilled' end;
  end if;
  v_proceeds := case when v_side = 'ask' then v_y else v_x end;
  v_unfilled := case when v_side = 'ask' then v_x else v_y end;
  return case when v_proceeds > 0 then case when v_unfilled > 0 then 'partial' else 'filled' end else 'unfilled' end;
end;
$$;

revoke all on function private.pro_pool_list(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.pro_pool_fill_state(jsonb, text, text) from public, anon, authenticated, service_role;

-- ------------------------------------------------------- the server's API --

-- The newest read transactions of a pool (p_kind: any, those with a trade, those with an order placed or collected),
-- landed since p_since where given, and how many of that span are still not read — p_tries misses is the node's refusal.
-- The same arguments and answer as v1; the kind is told by the flags.
create or replace function public.pro_pool_txs_recent(p_secret text, p_network text, p_pool text, p_kind text, p_since timestamptz, p_limit integer, p_tries integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
set jit = off
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 100), 5000));
  v_tries integer := greatest(1, coalesce(p_tries, 3));
  v_txs jsonb;
  v_pending integer;
  v_refused integer;
begin
  perform private.beta_check_secret(p_secret);
  if p_kind is null or p_kind not in ('any', 'trades', 'orders') then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;
  if p_kind = 'trades' then
    select jsonb_agg(r.records order by r.slot desc, r.signature desc) into v_txs
      from (
        select t.records, t.slot, t.signature
          from private.pro_pool_txs t
         where t.network = p_network and t.pool = p_pool and t.has_trade
           and (p_since is null or t.block_time is null or t.block_time >= p_since)
         order by t.slot desc, t.signature desc
         limit v_limit
      ) r;
  elsif p_kind = 'orders' then
    select jsonb_agg(r.records order by r.slot desc, r.signature desc) into v_txs
      from (
        select t.records, t.slot, t.signature
          from private.pro_pool_txs t
         where t.network = p_network and t.pool = p_pool and t.has_order
           and (p_since is null or t.block_time is null or t.block_time >= p_since)
         order by t.slot desc, t.signature desc
         limit v_limit
      ) r;
  else
    select jsonb_agg(r.records order by r.slot desc, r.signature desc) into v_txs
      from (
        select t.records, t.slot, t.signature
          from private.pro_pool_txs t
         where t.network = p_network and t.pool = p_pool and t.state = 'read'
           and (p_since is null or t.block_time is null or t.block_time >= p_since)
         order by t.slot desc, t.signature desc
         limit v_limit
      ) r;
  end if;
  select count(*)::integer, (count(*) filter (where t.misses >= v_tries))::integer into v_pending, v_refused
    from private.pro_pool_txs t
   where t.network = p_network and t.pool = p_pool and t.state <> 'read'
     and (p_since is null or t.block_time is null or t.block_time >= p_since);
  return jsonb_build_object('ok', true, 'txs', coalesce(v_txs, '[]'::jsonb), 'pending', v_pending, 'refused', v_refused);
end;
$$;

-- A pool's day counted from its read transactions landed since p_since (a transaction with no time counts): how many,
-- whether one created the pool, the oldest and newest time, how many of the span are still not read (p_tries misses is
-- the node's refusal), and the tally of its trades, orders and prices. p_collected_in — the pool's fee coin, for the
-- side of a collected order whose placing is not kept.
create function public.pro_pool_day(p_secret text, p_network text, p_pool text, p_since timestamptz, p_tries integer, p_collected_in text)
returns jsonb
language plpgsql
security definer
set search_path = ''
set jit = off
as $$
declare
  v_tries integer := greatest(1, coalesce(p_tries, 3));
  v_head jsonb;
  v_trades jsonb;
  v_first jsonb;
  v_last jsonb;
  v_orders jsonb;
  v_pending integer;
  v_refused integer;
begin
  perform private.beta_check_secret(p_secret);
  if p_network is null or p_pool is null or p_since is null or p_collected_in is null or p_collected_in not in ('output', 'tokenY') then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;

  -- The span's read transactions: how many, whether one created the pool, the oldest and newest time, orders placed.
  select jsonb_build_object(
           'transactions', count(*)::integer,
           'created', coalesce(bool_or(d.records -> 'created' = 'true'::jsonb), false),
           'oldest', floor(extract(epoch from min(d.block_time)))::bigint,
           'newest', floor(extract(epoch from max(d.block_time)))::bigint,
           'placed', coalesce(sum(jsonb_array_length(private.pro_pool_list(d.records -> 'placed'))) filter (where d.has_order), 0)::integer
         ) into v_head
    from private.pro_pool_txs d
   where d.network = p_network and d.pool = p_pool and d.state = 'read'
     and (d.block_time is null or d.block_time >= p_since);

  -- Its trades: a transaction with a trade holds a list of them (`has_trade`), each read once into typed fields.
  select jsonb_build_object(
           'trades', count(*)::integer,
           'buys', (count(*) filter (where x.side = 'buy'))::integer,
           'sells', (count(*) filter (where x.side = 'sell'))::integer,
           'wallets', count(distinct x.wallet)::integer,
           'filling', (count(*) filter (where x.filled is not null))::integer,
           'coinRaw', coalesce(sum(x."coinRaw"), 0)::text,
           'quoteRaw', coalesce(sum(x."quoteRaw"), 0)::text,
           'fees', jsonb_build_object(
             'total', jsonb_build_object('xRaw', coalesce(sum(f."totalRaw") filter (where f.token = 'x'), 0)::text, 'yRaw', coalesce(sum(f."totalRaw") filter (where f.token = 'y'), 0)::text),
             'lp', jsonb_build_object('xRaw', coalesce(sum(f."lpRaw") filter (where f.token = 'x'), 0)::text, 'yRaw', coalesce(sum(f."lpRaw") filter (where f.token = 'y'), 0)::text),
             'orders', jsonb_build_object('xRaw', coalesce(sum(f."ordersRaw") filter (where f.token = 'x'), 0)::text, 'yRaw', coalesce(sum(f."ordersRaw") filter (where f.token = 'y'), 0)::text),
             'protocol', jsonb_build_object('xRaw', coalesce(sum(f."protocolRaw") filter (where f.token = 'x'), 0)::text, 'yRaw', coalesce(sum(f."protocolRaw") filter (where f.token = 'y'), 0)::text),
             'referral', jsonb_build_object('xRaw', coalesce(sum(f."referralRaw") filter (where f.token = 'x'), 0)::text, 'yRaw', coalesce(sum(f."referralRaw") filter (where f.token = 'y'), 0)::text),
             'partner', jsonb_build_object('xRaw', coalesce(sum(f."partnerRaw") filter (where f.token = 'x'), 0)::text, 'yRaw', coalesce(sum(f."partnerRaw") filter (where f.token = 'y'), 0)::text)
           )
         ) into v_trades
    from private.pro_pool_txs d
   cross join lateral jsonb_to_recordset(d.records -> 'trades') as x(side text, wallet text, filled text, "coinRaw" numeric, "quoteRaw" numeric, fee jsonb)
   cross join lateral jsonb_to_record(x.fee) as f(token text, "totalRaw" numeric, "lpRaw" numeric, "ordersRaw" numeric, "protocolRaw" numeric, "referralRaw" numeric, "partnerRaw" numeric)
   where d.network = p_network and d.pool = p_pool and d.state = 'read' and d.has_trade
     and (d.block_time is null or d.block_time >= p_since);

  -- The pool's price after the span's first and last priced trade: the oldest transaction's first, the newest's last.
  select x.price into v_first
    from private.pro_pool_txs d
   cross join lateral rows from (jsonb_to_recordset(d.records -> 'trades') as ("poolPrice" jsonb)) with ordinality as x(price, at)
   where d.network = p_network and d.pool = p_pool and d.has_trade
     and (d.block_time is null or d.block_time >= p_since)
     and jsonb_typeof(x.price) = 'number'
   order by d.slot, d.signature, x.at
   limit 1;
  select x.price into v_last
    from private.pro_pool_txs d
   cross join lateral rows from (jsonb_to_recordset(d.records -> 'trades') as ("poolPrice" jsonb)) with ordinality as x(price, at)
   where d.network = p_network and d.pool = p_pool and d.has_trade
     and (d.block_time is null or d.block_time >= p_since)
     and jsonb_typeof(x.price) = 'number'
   order by d.slot desc, d.signature desc, x.at desc
   limit 1;

  -- The orders collected in the span (only a transaction with an order holds one), each with the side of its placing
  -- where one is kept — the oldest — else none, and what it filled.
  with collect as materialized (
    select x.value as c
      from private.pro_pool_txs d
     cross join lateral jsonb_array_elements(private.pro_pool_list(d.records -> 'collects')) as x(value)
     where d.network = p_network and d.pool = p_pool and d.has_order
       and (d.block_time is null or d.block_time >= p_since)
  ),
  opening as (
    select distinct on (p.value ->> 'order') p.value ->> 'order' as id, p.value ->> 'side' as side
      from private.pro_pool_txs o
     cross join lateral jsonb_array_elements(private.pro_pool_list(o.records -> 'placed')) as p(value)
     where o.network = p_network and o.pool = p_pool and o.has_order
       and p.value ->> 'order' in (select k.c ->> 'order' from collect k)
     order by p.value ->> 'order', o.slot, o.signature
  ),
  fill as (
    select k.c, private.pro_pool_fill_state(k.c, s.side, p_collected_in) as state
      from collect k
      left join opening s on s.id = k.c ->> 'order'
  )
  select jsonb_build_object(
           'filled', (count(*) filter (where f.state = 'filled'))::integer,
           'partial', (count(*) filter (where f.state = 'partial'))::integer,
           'unfilled', (count(*) filter (where f.state = 'unfilled'))::integer,
           'unknown', (count(*) filter (where f.state is null))::integer,
           'bonusPaid', jsonb_build_object('xRaw', coalesce(sum((f.c ->> 'bonusXRaw')::numeric), 0)::text, 'yRaw', coalesce(sum((f.c ->> 'bonusYRaw')::numeric), 0)::text),
           'referralPaid', jsonb_build_object(
             'xRaw', coalesce(sum((f.c ->> 'referralRaw')::numeric) filter (where f.c ->> 'referralToken' = 'x'), 0)::text,
             'yRaw', coalesce(sum((f.c ->> 'referralRaw')::numeric) filter (where f.c ->> 'referralToken' = 'y'), 0)::text
           )
         ) into v_orders
    from fill f;

  select count(*)::integer, (count(*) filter (where u.misses >= v_tries))::integer into v_pending, v_refused
    from private.pro_pool_txs u
   where u.network = p_network and u.pool = p_pool and u.state <> 'read'
     and (u.block_time is null or u.block_time >= p_since);

  return jsonb_build_object(
    'ok', true,
    'transactions', v_head -> 'transactions',
    'created', v_head -> 'created',
    'oldest', v_head -> 'oldest',
    'newest', v_head -> 'newest',
    'pending', v_pending,
    'refused', v_refused,
    'tally', v_trades
      || jsonb_build_object('placed', v_head -> 'placed', 'priceFirst', coalesce(v_first, 'null'::jsonb), 'priceLast', coalesce(v_last, 'null'::jsonb))
      || v_orders
  );
end;
$$;

-- The newest p_limit transactions of a pool holding an order collected with a part filled — whole or a part, its side
-- from its placing where one is kept, else from its payout — and the sides of the orders collected in them.
create function public.pro_pool_fills(p_secret text, p_network text, p_pool text, p_collected_in text, p_limit integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
set jit = off
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 1000));
  v_txs jsonb;
  v_sides jsonb;
begin
  perform private.beta_check_secret(p_secret);
  if p_network is null or p_pool is null or p_collected_in is null or p_collected_in not in ('output', 'tokenY') then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;
  with opening as materialized (
    select distinct on (p.value ->> 'order') p.value ->> 'order' as id, p.value ->> 'side' as side
      from private.pro_pool_txs o
     cross join lateral jsonb_array_elements(private.pro_pool_list(o.records -> 'placed')) as p(value)
     where o.network = p_network and o.pool = p_pool and o.has_order
     order by p.value ->> 'order', o.slot, o.signature
  ),
  hit as materialized (
    select distinct o.slot, o.signature
      from private.pro_pool_txs o
     cross join lateral jsonb_array_elements(private.pro_pool_list(o.records -> 'collects')) as c(value)
      left join opening s on s.id = c.value ->> 'order'
     where o.network = p_network and o.pool = p_pool and o.has_order
       and private.pro_pool_fill_state(c.value, s.side, p_collected_in) in ('filled', 'partial')
     order by o.slot desc, o.signature desc
     limit v_limit
  ),
  hit_txs as materialized (
    select o.slot, o.signature, o.records
      from private.pro_pool_txs o
      join hit h on h.slot = o.slot and h.signature = o.signature
     where o.network = p_network and o.pool = p_pool
  )
  select (select jsonb_agg(t.records order by t.slot desc, t.signature desc) from hit_txs t),
         (select jsonb_object_agg(s.id, s.side)
            from opening s
           where s.id in (select c.value ->> 'order' from hit_txs t cross join lateral jsonb_array_elements(private.pro_pool_list(t.records -> 'collects')) as c(value)))
    into v_txs, v_sides;
  return jsonb_build_object('ok', true, 'txs', coalesce(v_txs, '[]'::jsonb), 'sides', coalesce(v_sides, '{}'::jsonb));
end;
$$;

revoke all on function public.pro_pool_txs_recent(text, text, text, text, timestamptz, integer, integer) from public, anon, authenticated, service_role;
revoke all on function public.pro_pool_day(text, text, text, timestamptz, integer, text) from public, anon, authenticated, service_role;
revoke all on function public.pro_pool_fills(text, text, text, text, integer) from public, anon, authenticated, service_role;

grant execute on function public.pro_pool_txs_recent(text, text, text, text, timestamptz, integer, integer) to anon;
grant execute on function public.pro_pool_day(text, text, text, timestamptz, integer, text) to anon;
grant execute on function public.pro_pool_fills(text, text, text, text, integer) to anon;

commit;
