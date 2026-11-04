-- Ryntra: «Like the Captain» — the ledger of strategy copies and their daily record (CITY-99).
--
-- PREPARED 2026-10-31 as a file only. Not applied to any Supabase project:
-- production migrations are applied through MCP Supabase, only when the project's owner says so.
-- Without it the ledger does not count in production: `city/lib/earn/captain.server.ts`
-- keeps the copies route shut on one instance's memory, the daily pass waits, and
-- the city shows no strategy card — none has a record yet.
--
-- WHAT THIS FILE DOES
--   * `private.city_captain_copies`: a position the city reported as a copy of a
--     recipe (a SOL pier and a style) — who, where, which recipe, when reported —
--     and what the daily pass made of it from the chain (its entry, fees seen
--     leaving, its last result, whether it closed), as one checked JSON record.
--     Who, where and which recipe are columns and never change after the report.
--   * `private.city_captain_points`: one point a day per strategy — its live
--     copies summed: kept coins at today's prices, the result against them, fees.
--   * Row level security forced, no policies, every grant revoked. The server
--     reads and writes only through the `public.city_captain_*` functions below,
--     each gated by the app secret (`private.beta_check_secret`) and each one
--     transaction, the same way the stops' are (`20261029200000_spot_stops_v1.sql`).
--   * A wallet's reports are taken one at a time (an advisory lock on the wallet):
--     its daily limit holds across instances.
--
-- WHAT IT DOES NOT DO
--   No money, no key, no transaction. A copy is a public position read from the
--   chain; every deposit is signed by the person's own wallet.

begin;

create table private.city_captain_copies (
  address text primary key check (address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  owner text not null check (owner ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  pool text not null check (pool ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  style text not null check (style in ('calm', 'balanced', 'dense')),
  added_at timestamptz not null,
  confirmed boolean not null default false,
  record jsonb not null check (jsonb_typeof(record) = 'object' and octet_length(record::text) <= 4096),
  updated_at timestamptz not null
);

create index city_captain_copies_owner_idx on private.city_captain_copies (owner, added_at desc);
create index city_captain_copies_pending_idx on private.city_captain_copies (added_at) where not confirmed;

create table private.city_captain_points (
  strategy text not null check (strategy ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}:(calm|balanced|dense)$'),
  day date not null,
  record jsonb not null check (jsonb_typeof(record) = 'object' and octet_length(record::text) <= 1024),
  primary key (strategy, day)
);

alter table private.city_captain_copies enable row level security;
alter table private.city_captain_copies force row level security;
revoke all privileges on table private.city_captain_copies from public, anon, authenticated, service_role;
alter table private.city_captain_points enable row level security;
alter table private.city_captain_points force row level security;
revoke all privileges on table private.city_captain_points from public, anon, authenticated, service_role;

-- A copy as the server reads it: the stored record with who, where and which recipe from the columns.
create function private.city_captain_copy_json(r private.city_captain_copies)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select r.record || jsonb_build_object(
    'position', r.address,
    'owner', r.owner,
    'pool', r.pool,
    'style', r.style,
    'addedAt', floor(extract(epoch from r.added_at) * 1000)::bigint
  );
$$;

revoke all on function private.city_captain_copy_json(private.city_captain_copies) from public, anon, authenticated, service_role;

-- ------------------------------------------------------- the server's API --

-- Keeps a reported copy unless the position is known, the wallet reported p_max today, or p_pending_max wait unconfirmed.
create function public.city_captain_report(p_secret text, p_copy jsonb, p_max integer, p_pending_max integer, p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner text := p_copy->>'owner';
  v_today integer;
  v_pending integer;
begin
  perform private.beta_check_secret(p_secret);
  if v_owner is null or p_copy->>'position' is null or p_max is null or p_max < 1 or p_pending_max is null or p_now is null then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;
  if exists (select 1 from private.city_captain_copies c where c.address = p_copy->>'position') then
    return jsonb_build_object('ok', true, 'state', 'known');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('city_captain:' || v_owner, 0));
  select count(*)::integer into v_today from private.city_captain_copies c
   where c.owner = v_owner and c.added_at > p_now - interval '1 day';
  select count(*)::integer into v_pending from private.city_captain_copies c where not c.confirmed;
  if v_today >= p_max or v_pending >= p_pending_max then
    return jsonb_build_object('ok', true, 'state', 'limit');
  end if;
  insert into private.city_captain_copies (address, owner, pool, style, added_at, confirmed, record, updated_at)
  values (
    p_copy->>'position', v_owner, p_copy->>'pool', p_copy->>'style', p_now, false,
    jsonb_build_object('entry', null, 'claimedUsd', 0, 'seenFees', null, 'closedAt', null, 'last', null), p_now
  )
  on conflict (address) do nothing;
  return jsonb_build_object('ok', true, 'state', case when found then 'added' else 'known' end);
end;
$$;

-- Every copy kept, the oldest report first.
create function public.city_captain_copies(p_secret text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.beta_check_secret(p_secret);
  return jsonb_build_object('ok', true, 'copies', (
    select coalesce(jsonb_agg(private.city_captain_copy_json(c) order by c.added_at), '[]'::jsonb)
      from private.city_captain_copies c
  ));
end;
$$;

-- A pass's work: each copy's record replaced (who, where and which recipe stay the columns'); unconfirmed ones dropped.
create function public.city_captain_save(p_secret text, p_updated jsonb, p_dropped jsonb, p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
begin
  perform private.beta_check_secret(p_secret);
  if jsonb_typeof(p_updated) <> 'array' or jsonb_typeof(p_dropped) <> 'array' or p_now is null then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;
  for v_item in select value from jsonb_array_elements(p_updated) loop
    update private.city_captain_copies c
       set record = jsonb_build_object(
             'entry', v_item->'entry',
             'claimedUsd', coalesce(v_item->'claimedUsd', '0'::jsonb),
             'seenFees', v_item->'seenFees',
             'closedAt', v_item->'closedAt',
             'last', v_item->'last'
           ),
           confirmed = jsonb_typeof(v_item->'entry') = 'object',
           updated_at = p_now
     where c.address = v_item->>'position';
  end loop;
  delete from private.city_captain_copies c
   where not c.confirmed
     and c.address in (select value #>> '{}' from jsonb_array_elements(p_dropped));
  return jsonb_build_object('ok', true);
end;
$$;

-- The day's points; a later pass on the same day replaces its strategy's point.
create function public.city_captain_points_put(p_secret text, p_points jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.beta_check_secret(p_secret);
  if jsonb_typeof(p_points) <> 'array' then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;
  insert into private.city_captain_points (strategy, day, record)
  select p->>'strategy', (p->>'day')::date, p from jsonb_array_elements(p_points) p
  on conflict (strategy, day) do update set record = excluded.record;
  return jsonb_build_object('ok', true);
end;
$$;

-- Points from p_since on, oldest first.
create function public.city_captain_points(p_secret text, p_since date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.beta_check_secret(p_secret);
  return jsonb_build_object('ok', true, 'points', (
    select coalesce(jsonb_agg(p.record order by p.day), '[]'::jsonb)
      from private.city_captain_points p
     where p.day >= p_since
  ));
end;
$$;

revoke all on function public.city_captain_report(text, jsonb, integer, integer, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.city_captain_copies(text) from public, anon, authenticated, service_role;
revoke all on function public.city_captain_save(text, jsonb, jsonb, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.city_captain_points_put(text, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.city_captain_points(text, date) from public, anon, authenticated, service_role;

grant execute on function public.city_captain_report(text, jsonb, integer, integer, timestamptz) to anon;
grant execute on function public.city_captain_copies(text) to anon;
grant execute on function public.city_captain_save(text, jsonb, jsonb, timestamptz) to anon;
grant execute on function public.city_captain_points_put(text, jsonb) to anon;
grant execute on function public.city_captain_points(text, date) to anon;

commit;
