-- Ryntra: stops on spot under the wallet's account (CITY-149).
--
-- PREPARED 2026-10-29 as a file only. Not applied to any Supabase project:
-- Stops do not open in production without it: `lib/stops/ready.ts` keeps the
-- routes and the cron shut on one instance's memory, and the city keeps its
-- stops on the device until `NEXT_PUBLIC_RYNTRA_CITY_STOPS` says `open`.
--
-- WHAT THIS FILE DOES
--   * One table, `private.spot_stops`: a wallet's stop — the side, the two
--     coins, the amount, the price and the line the engine worked out from
--     them, its expiry, its state, and when the cron checked it, reached it
--     and told the person. Row level security forced, no policies, every
--     grant revoked.
--   * The server reads and writes only through the `public.spot_stops_*`
--     functions below, each gated by the app secret
--     (`private.beta_check_secret`) and each one transaction, the same way
--     the vault's are (`20261027200000_vault_v1.sql`).
--   * A wallet's stops are created one at a time (an advisory lock on the
--     wallet): the limit holds across instances. «Reached» is written by one
--     conditional update: a stop is reached once, however many passes see it.
--
-- WHAT IT DOES NOT DO
--   No money, no key, no transaction. A stop is an intent; the sale it opens
--   is signed by the person's wallet, or nothing is sold.

begin;

create table private.spot_stops (
  id text primary key check (id ~ '^stp_[0-9a-f]{20}$'),
  owner text not null check (owner ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  side text not null check (side in ('buy', 'sell')),
  base_mint text not null check (base_mint ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  base_symbol text not null check (char_length(base_symbol) between 1 and 40),
  base_name text not null check (char_length(base_name) between 1 and 128),
  base_decimals smallint not null check (base_decimals between 0 and 18),
  quote_mint text not null check (quote_mint ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' and quote_mint <> base_mint),
  quote_symbol text not null check (char_length(quote_symbol) between 1 and 40),
  quote_decimals smallint not null check (quote_decimals between 0 and 18),
  amount_raw text not null check (amount_raw ~ '^[1-9][0-9]{0,29}$'),
  price text not null check (price ~ '^[0-9]{1,18}(\.[0-9]{1,18})?$'),
  threshold_raw text not null check (threshold_raw ~ '^[1-9][0-9]{0,39}$'),
  locale text not null check (locale in ('en', 'uk')),
  state text not null check (state in ('watching', 'reached', 'done', 'cancelled', 'expired')),
  created_at timestamptz not null,
  expires_at timestamptz check (expires_at is null or expires_at > created_at),
  reached_at timestamptz,
  reached_out_raw text check (reached_out_raw is null or reached_out_raw ~ '^[0-9]{1,40}$'),
  checked_at timestamptz,
  told_at timestamptz,
  updated_at timestamptz not null,
  check ((state = 'watching') = (reached_at is null) or state in ('cancelled', 'expired'))
);

create index spot_stops_owner_idx on private.spot_stops (owner, created_at desc);
create index spot_stops_due_idx on private.spot_stops (checked_at nulls first, created_at) where state = 'watching';
create index spot_stops_untold_idx on private.spot_stops (reached_at) where state = 'reached' and told_at is null;
create index spot_stops_expiry_idx on private.spot_stops (expires_at) where state in ('watching', 'reached') and expires_at is not null;

alter table private.spot_stops enable row level security;
alter table private.spot_stops force row level security;
revoke all privileges on table private.spot_stops from public, anon, authenticated, service_role;

-- ------------------------------------------------------------- helpers --

create function private.spot_stops_ms(p_at timestamptz)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select case when p_at is null then null else floor(extract(epoch from p_at) * 1000)::bigint end;
$$;

create function private.spot_stops_at(p_ms bigint)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select case when p_ms is null then null else 'epoch'::timestamptz + p_ms * interval '1 millisecond' end;
$$;

-- A stop as the server reads it: the shape of `EngineStop` (`lib/stops/model.ts`).
create function private.spot_stops_json(r private.spot_stops)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', r.id,
    'owner', r.owner,
    'side', r.side,
    'base', jsonb_build_object('mint', r.base_mint, 'symbol', r.base_symbol, 'name', r.base_name, 'decimals', r.base_decimals),
    'quote', jsonb_build_object('mint', r.quote_mint, 'symbol', r.quote_symbol, 'decimals', r.quote_decimals),
    'amountRaw', r.amount_raw,
    'price', r.price,
    'thresholdRaw', r.threshold_raw,
    'locale', r.locale,
    'createdAt', private.spot_stops_ms(r.created_at),
    'expiresAt', private.spot_stops_ms(r.expires_at),
    'state', r.state,
    'reachedAt', private.spot_stops_ms(r.reached_at),
    'reachedOutRaw', r.reached_out_raw,
    'updatedAt', private.spot_stops_ms(r.updated_at)
  );
$$;

revoke all on function private.spot_stops_ms(timestamptz) from public, anon, authenticated, service_role;
revoke all on function private.spot_stops_at(bigint) from public, anon, authenticated, service_role;
revoke all on function private.spot_stops_json(private.spot_stops) from public, anon, authenticated, service_role;

-- ------------------------------------------------------- the server's API --

-- A wallet's stops, newest first: the live ones and those finished in the last thirty days.
create function public.spot_stops_list(p_secret text, p_owner text, p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.beta_check_secret(p_secret);
  return jsonb_build_object('ok', true, 'stops', (
    select coalesce(jsonb_agg(private.spot_stops_json(s) order by s.created_at desc), '[]'::jsonb)
      from private.spot_stops s
     where s.owner = p_owner
       and s.state <> 'cancelled'
       and (s.state in ('watching', 'reached') or s.updated_at >= p_now - interval '30 days')
  ));
end;
$$;

-- Keeps a new stop unless the wallet already has p_max live ones. One wallet at a time.
create function public.spot_stops_create(p_secret text, p_stop jsonb, p_max integer, p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner text := p_stop->>'owner';
  v_live integer;
begin
  perform private.beta_check_secret(p_secret);
  if v_owner is null or p_max is null or p_max < 1 or p_now is null then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('spot_stops:' || v_owner, 0));
  select count(*)::integer into v_live
    from private.spot_stops s
   where s.owner = v_owner and s.state in ('watching', 'reached') and (s.expires_at is null or s.expires_at > p_now);
  if v_live >= p_max then
    return jsonb_build_object('ok', true, 'created', false, 'reason', 'limit');
  end if;
  insert into private.spot_stops (
    id, owner, side, base_mint, base_symbol, base_name, base_decimals, quote_mint, quote_symbol, quote_decimals,
    amount_raw, price, threshold_raw, locale, state, created_at, expires_at, updated_at
  ) values (
    p_stop->>'id', v_owner, p_stop->>'side',
    p_stop->'base'->>'mint', p_stop->'base'->>'symbol', p_stop->'base'->>'name', (p_stop->'base'->>'decimals')::smallint,
    p_stop->'quote'->>'mint', p_stop->'quote'->>'symbol', (p_stop->'quote'->>'decimals')::smallint,
    p_stop->>'amountRaw', p_stop->>'price', p_stop->>'thresholdRaw', p_stop->>'locale', 'watching',
    private.spot_stops_at((p_stop->>'createdAt')::bigint), private.spot_stops_at((p_stop->>'expiresAt')::bigint), p_now
  )
  on conflict (id) do nothing;
  if not found then
    return jsonb_build_object('ok', true, 'created', false, 'reason', 'taken');
  end if;
  return jsonb_build_object('ok', true, 'created', true);
end;
$$;

-- Lets a live stop go; a finished one stays as it is. `stop` is null when the wallet has no such stop.
create function public.spot_stops_cancel(p_secret text, p_owner text, p_id text, p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r private.spot_stops;
begin
  perform private.beta_check_secret(p_secret);
  update private.spot_stops s set state = 'cancelled', updated_at = p_now
   where s.id = p_id and s.owner = p_owner and s.state in ('watching', 'reached')
  returning * into r;
  if not found then
    select * into r from private.spot_stops s where s.id = p_id and s.owner = p_owner;
  end if;
  return jsonb_build_object('ok', true, 'stop', case when r.id is null then null else private.spot_stops_json(r) end);
end;
$$;

-- A reached stop's sale settled.
create function public.spot_stops_finish(p_secret text, p_owner text, p_id text, p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r private.spot_stops;
begin
  perform private.beta_check_secret(p_secret);
  update private.spot_stops s set state = 'done', updated_at = p_now
   where s.id = p_id and s.owner = p_owner and s.state = 'reached'
  returning * into r;
  if not found then
    select * into r from private.spot_stops s where s.id = p_id and s.owner = p_owner;
  end if;
  return jsonb_build_object('ok', true, 'stop', case when r.id is null then null else private.spot_stops_json(r) end);
end;
$$;

-- Up to p_limit watched stops not past their time, the longest unchecked first; each marked checked now.
-- Two passes at once take different rows (skip locked).
create function public.spot_stops_due(p_secret text, p_now timestamptz, p_limit integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stops jsonb;
begin
  perform private.beta_check_secret(p_secret);
  with picked as (
    select s.id from private.spot_stops s
     where s.state = 'watching' and (s.expires_at is null or s.expires_at > p_now)
     order by s.checked_at nulls first, s.created_at
     limit greatest(1, least(coalesce(p_limit, 100), 500))
     for update skip locked
  ), marked as (
    update private.spot_stops s set checked_at = p_now
      from picked where s.id = picked.id
    returning s.*
  )
  select coalesce(jsonb_agg(private.spot_stops_json(m::private.spot_stops) order by m.created_at), '[]'::jsonb)
    into v_stops from marked m;
  return jsonb_build_object('ok', true, 'stops', v_stops);
end;
$$;

-- «Reached», once: true only for the call that turned a watched stop into a reached one.
create function public.spot_stops_reach(p_secret text, p_id text, p_out_raw text, p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.beta_check_secret(p_secret);
  if p_out_raw is null or p_out_raw !~ '^[0-9]{1,40}$' then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;
  update private.spot_stops s set state = 'reached', reached_at = p_now, reached_out_raw = p_out_raw, updated_at = p_now
   where s.id = p_id and s.state = 'watching' and (s.expires_at is null or s.expires_at > p_now);
  return jsonb_build_object('ok', true, 'reached', found);
end;
$$;

-- Reached stops whose person has not been told yet, the oldest first.
create function public.spot_stops_untold(p_secret text, p_limit integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.beta_check_secret(p_secret);
  return jsonb_build_object('ok', true, 'stops', (
    select coalesce(jsonb_agg(private.spot_stops_json(u::private.spot_stops) order by u.reached_at), '[]'::jsonb)
      from (
        select * from private.spot_stops s
         where s.state = 'reached' and s.told_at is null
         order by s.reached_at
         limit greatest(1, least(coalesce(p_limit, 100), 500))
      ) u
  ));
end;
$$;

create function public.spot_stops_told(p_secret text, p_id text, p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.beta_check_secret(p_secret);
  update private.spot_stops s set told_at = p_now where s.id = p_id and s.told_at is null;
  return jsonb_build_object('ok', true);
end;
$$;

-- Watched and reached stops past their time become expired.
create function public.spot_stops_expire(p_secret text, p_now timestamptz, p_limit integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  perform private.beta_check_secret(p_secret);
  with gone as (
    select s.id from private.spot_stops s
     where s.state in ('watching', 'reached') and s.expires_at is not null and s.expires_at <= p_now
     limit greatest(1, least(coalesce(p_limit, 500), 5000))
     for update skip locked
  )
  update private.spot_stops s set state = 'expired', updated_at = p_now from gone where s.id = gone.id;
  get diagnostics v_count = row_count;
  return jsonb_build_object('ok', true, 'expired', v_count);
end;
$$;

revoke all on function public.spot_stops_list(text, text, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.spot_stops_create(text, jsonb, integer, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.spot_stops_cancel(text, text, text, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.spot_stops_finish(text, text, text, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.spot_stops_due(text, timestamptz, integer) from public, anon, authenticated, service_role;
revoke all on function public.spot_stops_reach(text, text, text, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.spot_stops_untold(text, integer) from public, anon, authenticated, service_role;
revoke all on function public.spot_stops_told(text, text, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.spot_stops_expire(text, timestamptz, integer) from public, anon, authenticated, service_role;

grant execute on function public.spot_stops_list(text, text, timestamptz) to anon;
grant execute on function public.spot_stops_create(text, jsonb, integer, timestamptz) to anon;
grant execute on function public.spot_stops_cancel(text, text, text, timestamptz) to anon;
grant execute on function public.spot_stops_finish(text, text, text, timestamptz) to anon;
grant execute on function public.spot_stops_due(text, timestamptz, integer) to anon;
grant execute on function public.spot_stops_reach(text, text, text, timestamptz) to anon;
grant execute on function public.spot_stops_untold(text, integer) to anon;
grant execute on function public.spot_stops_told(text, text, timestamptz) to anon;
grant execute on function public.spot_stops_expire(text, timestamptz, integer) to anon;

commit;
