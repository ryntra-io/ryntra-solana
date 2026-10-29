-- Ryntra City: the Vault's practice (CITY-47) on the server.
--
-- PREPARED 2026-10-27 as a file only. Not applied to any Supabase project:
-- The vault does not open in production without it: `lib/vault/server.ts`
-- refuses to open on one instance's memory.
--
-- WHAT THIS FILE DOES
--   * Four `vault_` tables in `private`, row level security forced, no
--     policies and every grant revoked: attempts for the limits, each
--     person's progress, the public feed, and the answers to request keys.
--   * The server reads and writes only through the `public.vault_*`
--     functions below, each gated by the app secret
--     (`private.beta_check_secret`) and each one transaction, the same way
--     the world's functions are (`20261027090000_world_v1.sql`).
--   * Counting an attempt is one step per key (an advisory lock on the key):
--     every server instance counts the same limits. A crack is recorded on
--     the row as it is, under a row lock: two cracks at once pay once.
--
-- WHAT IT DOES NOT DO
--   No money and no phrase: phrases are made by the server from its secret
--   and never stored; the feed keeps only masked text.

begin;

-- ------------------------------------------------------------- attempts --

-- One row per counted attempt, by person (`g:` guest, `a:` account) and by
-- network (`ip:`). Kept two days: the longest window is the UTC day.
create table private.vault_attempts (
  key text not null check (char_length(key) between 3 and 200),
  ticket uuid not null,
  at timestamptz not null,
  primary key (key, ticket)
);

create index vault_attempts_key_idx on private.vault_attempts (key, at);
create index vault_attempts_at_idx on private.vault_attempts (at);

-- ------------------------------------------------------------- progress --

create table private.vault_progress (
  who text primary key check (char_length(who) between 3 and 140),
  -- Every vault cracked, with the day it was cracked: {"practice-1": "2026-10-27", ...}.
  cracked jsonb not null default '{}'::jsonb check (jsonb_typeof(cracked) = 'object' and pg_column_size(cracked) <= 1024),
  -- Days the daily vault was cracked on, newest first.
  daily_days date[] not null default '{}',
  points integer not null default 0 check (points between 0 and 1000000),
  title text check (title is null or title in ('breaker')),
  updated_at timestamptz not null
);

-- ----------------------------------------------------------------- feed --

create sequence private.vault_feed_seq as bigint;

create table private.vault_feed (
  seq bigint primary key default nextval('private.vault_feed_seq'),
  id text not null unique check (id ~ '^[A-Za-z0-9_-]{1,32}$'),
  vault text not null check (vault in ('practice-1', 'practice-2', 'practice-3', 'daily')),
  at timestamptz not null,
  who_tag text not null check (char_length(who_tag) between 1 and 40),
  outcome text not null check (outcome in ('held', 'leaked', 'caught', 'cracked', 'screened')),
  reply text check (reply is null or char_length(reply) <= 2000),
  pressure double precision not null check (pressure between 0 and 1),
  attempt text not null check (char_length(attempt) <= 4000)
);

create index vault_feed_vault_idx on private.vault_feed (vault, seq desc);
create index vault_feed_at_idx on private.vault_feed (at);

-- -------------------------------------------------------------- answers --

-- The answer to an Idempotency-Key, kept ten minutes, so a retried attempt
-- is never counted twice.
create table private.vault_answers (
  key text primary key check (char_length(key) between 1 and 300),
  body jsonb not null check (pg_column_size(body) <= 65536),
  keep_until timestamptz not null
);

create index vault_answers_until_idx on private.vault_answers (keep_until);

-- ------------------------------------------------------------ the locks --

alter table private.vault_attempts enable row level security;
alter table private.vault_attempts force row level security;
alter table private.vault_progress enable row level security;
alter table private.vault_progress force row level security;
alter table private.vault_feed enable row level security;
alter table private.vault_feed force row level security;
alter table private.vault_answers enable row level security;
alter table private.vault_answers force row level security;

revoke all privileges on table
  private.vault_attempts, private.vault_progress, private.vault_feed, private.vault_answers
  from public, anon, authenticated, service_role;
revoke all privileges on sequence private.vault_feed_seq from public, anon, authenticated, service_role;

-- --------------------------------------------------------------- helpers --

create function private.vault_iso(p_at timestamptz)
returns text
language sql
stable
set search_path = ''
as $$
  select to_char(p_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
$$;

-- The windows the server counts in: [{"name": "minute"|"day", "ms": ..., "limit": ...}].
create function private.vault_windows_ok(p_windows jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  w jsonb;
begin
  if p_windows is null or jsonb_typeof(p_windows) <> 'array' then
    return false;
  end if;
  if jsonb_array_length(p_windows) not between 1 and 4 then
    return false;
  end if;
  for w in select value from jsonb_array_elements(p_windows) loop
    if jsonb_typeof(w) <> 'object'
       or coalesce(w->>'name', '') not in ('minute', 'day')
       or coalesce(w->>'ms', '') !~ '^[0-9]{4,8}$'
       or coalesce(w->>'limit', '') !~ '^[0-9]{1,6}$' then
      return false;
    end if;
    if (w->>'ms')::bigint > 86400000 or (w->>'limit')::integer < 1 then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

-- Each window with the moment it starts: the minute slides, the day is the UTC day.
create function private.vault_windows(p_windows jsonb, p_now timestamptz)
returns table (w_name text, w_ms bigint, w_cap integer, w_since timestamptz)
language sql
stable
set search_path = ''
as $$
  select e.w->>'name',
         (e.w->>'ms')::bigint,
         (e.w->>'limit')::integer,
         case when e.w->>'name' = 'day'
              then date_trunc('day', p_now at time zone 'UTC') at time zone 'UTC'
              else p_now - (e.w->>'ms')::bigint * interval '1 millisecond' end
    from jsonb_array_elements(p_windows) with ordinality as e(w, n)
   order by e.n;
$$;

-- Seconds until a full window has room again: the oldest attempt in a sliding
-- window leaves it; the day ends at midnight UTC.
create function private.vault_wait(p_name text, p_ms bigint, p_first timestamptz, p_now timestamptz)
returns integer
language sql
stable
set search_path = ''
as $$
  select greatest(1, ceil(extract(epoch from (
    case when p_name = 'day'
         then (date_trunc('day', p_now at time zone 'UTC') + interval '1 day') at time zone 'UTC'
         else coalesce(p_first, p_now) + p_ms * interval '1 millisecond' end
  ) - p_now))::integer);
$$;

create function private.vault_progress_json(r private.vault_progress)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'cracked', coalesce(r.cracked, '{}'::jsonb),
    'dailyDays', coalesce((
      select jsonb_agg(to_char(u.d, 'YYYY-MM-DD') order by u.n)
        from unnest(r.daily_days) with ordinality as u(d, n)
    ), '[]'::jsonb),
    'points', coalesce(r.points, 0),
    'title', r.title
  );
$$;

revoke all on function private.vault_iso(timestamptz) from public, anon, authenticated, service_role;
revoke all on function private.vault_windows_ok(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.vault_windows(jsonb, timestamptz) from public, anon, authenticated, service_role;
revoke all on function private.vault_wait(text, bigint, timestamptz, timestamptz) from public, anon, authenticated, service_role;
revoke all on function private.vault_progress_json(private.vault_progress) from public, anon, authenticated, service_role;

-- ------------------------------------------------------- the server's API --

-- Counts one attempt against every window, or says which window is full and
-- how long to wait. One key at a time, so instances never both slip under
-- the limit.
create function public.vault_take(p_secret text, p_key text, p_windows jsonb, p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  w record;
  v_ticket uuid := gen_random_uuid();
  v_count integer;
  v_first timestamptz;
  v_left jsonb := '{}'::jsonb;
begin
  perform private.beta_check_secret(p_secret);
  if p_key is null or char_length(p_key) not between 3 and 200 or p_now is null or not private.vault_windows_ok(p_windows) then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('vault:' || p_key, 0));
  delete from private.vault_attempts
   where ctid in (select ctid from private.vault_attempts where at < p_now - interval '2 days' limit 100);
  for w in select * from private.vault_windows(p_windows, p_now) loop
    select count(*)::integer, min(a.at) into v_count, v_first
      from private.vault_attempts a where a.key = p_key and a.at >= w.w_since;
    if v_count >= w.w_cap then
      return jsonb_build_object('ok', true, 'allowed', false, 'window', w.w_name,
        'retryAfterS', private.vault_wait(w.w_name, w.w_ms, v_first, p_now));
    end if;
  end loop;
  insert into private.vault_attempts (key, ticket, at) values (p_key, v_ticket, p_now);
  for w in select * from private.vault_windows(p_windows, p_now) loop
    select count(*)::integer into v_count
      from private.vault_attempts a where a.key = p_key and a.at >= w.w_since;
    v_left := v_left || jsonb_build_object(w.w_name, greatest(0, w.w_cap - v_count));
  end loop;
  return jsonb_build_object('ok', true, 'allowed', true, 'ticket', v_ticket, 'left', v_left);
end;
$$;

-- Gives back an attempt the guard never answered.
create function public.vault_give_back(p_secret text, p_key text, p_ticket uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.beta_check_secret(p_secret);
  delete from private.vault_attempts where key = p_key and ticket = p_ticket;
  return jsonb_build_object('ok', true);
end;
$$;

-- What is left in every window, without counting anything.
create function public.vault_left(p_secret text, p_key text, p_windows jsonb, p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  w record;
  v_count integer;
  v_first timestamptz;
  v_left jsonb := '{}'::jsonb;
begin
  perform private.beta_check_secret(p_secret);
  if p_key is null or p_now is null or not private.vault_windows_ok(p_windows) then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;
  for w in select * from private.vault_windows(p_windows, p_now) loop
    select count(*)::integer, min(a.at) into v_count, v_first
      from private.vault_attempts a where a.key = p_key and a.at >= w.w_since;
    v_left := v_left || jsonb_build_object(w.w_name, jsonb_build_object(
      'left', greatest(0, w.w_cap - v_count),
      'resetS', case when v_count = 0 then 0 else private.vault_wait(w.w_name, w.w_ms, v_first, p_now) end));
  end loop;
  return jsonb_build_object('ok', true, 'left', v_left);
end;
$$;

create function public.vault_progress(p_secret text, p_who text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r private.vault_progress%rowtype;
begin
  perform private.beta_check_secret(p_secret);
  select * into r from private.vault_progress where who = p_who;
  if not found then
    return jsonb_build_object('ok', true, 'progress',
      jsonb_build_object('cracked', '{}'::jsonb, 'dailyDays', '[]'::jsonb, 'points', 0, 'title', null));
  end if;
  return jsonb_build_object('ok', true, 'progress', private.vault_progress_json(r));
end;
$$;

-- A crack, recorded on the progress as it is now, under the row's lock: a
-- practice level once ever, the daily vault once a day, the title with the
-- last level for a person who has none.
create function public.vault_crack(
  p_secret text,
  p_who text,
  p_vault text,
  p_day date,
  p_points integer,
  p_title text,
  p_keep_days integer,
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r private.vault_progress%rowtype;
  v_day text := to_char(p_day, 'YYYY-MM-DD');
  v_title text := null;
begin
  perform private.beta_check_secret(p_secret);
  if p_who is null or char_length(p_who) not between 3 and 140
     or p_vault is null or p_vault not in ('practice-1', 'practice-2', 'practice-3', 'daily')
     or p_day is null or p_now is null
     or p_points is null or p_points not between 1 and 1000
     or p_keep_days is null or p_keep_days not between 1 and 366
     or (p_title is not null and p_title <> 'breaker') then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;
  insert into private.vault_progress (who, updated_at) values (p_who, p_now)
  on conflict (who) do nothing;
  select * into r from private.vault_progress where who = p_who for update;
  if (p_vault = 'daily' and r.cracked->>'daily' = v_day)
     or (p_vault <> 'daily' and (r.cracked -> p_vault) is not null) then
    return jsonb_build_object('ok', true, 'recorded', false, 'title', null, 'progress', private.vault_progress_json(r));
  end if;
  if p_title is not null and r.title is null then
    v_title := p_title;
  end if;
  update private.vault_progress
     set cracked = r.cracked || jsonb_build_object(p_vault, v_day),
         daily_days = case when p_vault = 'daily'
                           then (array_prepend(p_day, array_remove(r.daily_days, p_day)))[1:p_keep_days]
                           else r.daily_days end,
         points = r.points + p_points,
         title = coalesce(r.title, v_title),
         updated_at = p_now
   where who = p_who
   returning * into r;
  return jsonb_build_object('ok', true, 'recorded', true, 'title', v_title, 'progress', private.vault_progress_json(r));
end;
$$;

-- One entry of a vault's public feed; entries older than a week go.
create function public.vault_push(
  p_secret text,
  p_id text,
  p_vault text,
  p_at timestamptz,
  p_who_tag text,
  p_outcome text,
  p_reply text,
  p_pressure double precision,
  p_attempt text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.beta_check_secret(p_secret);
  delete from private.vault_feed
   where ctid in (select ctid from private.vault_feed where at < p_at - interval '7 days' limit 200);
  insert into private.vault_feed (id, vault, at, who_tag, outcome, reply, pressure, attempt)
  values (p_id, p_vault, p_at, p_who_tag, p_outcome, p_reply, p_pressure, p_attempt)
  on conflict (id) do nothing;
  return jsonb_build_object('ok', true);
end;
$$;

-- A page of a vault's feed, newest first, before an entry if one is named.
create function public.vault_feed(p_secret text, p_vault text, p_limit integer, p_before text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before bigint;
begin
  perform private.beta_check_secret(p_secret);
  if p_before is not null then
    select f.seq into v_before from private.vault_feed f where f.id = p_before and f.vault = p_vault;
    if not found then
      return jsonb_build_object('ok', true, 'entries', '[]'::jsonb);
    end if;
  end if;
  return jsonb_build_object('ok', true, 'entries', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id, 'vault', p.vault, 'at', private.vault_iso(p.at), 'who', p.who_tag, 'outcome', p.outcome,
      'reply', p.reply, 'pressure', p.pressure, 'attempt', p.attempt
    ) order by p.seq desc), '[]'::jsonb)
      from (
        select * from private.vault_feed x
         where x.vault = p_vault and (v_before is null or x.seq < v_before)
         order by x.seq desc
         limit greatest(1, least(coalesce(p_limit, 20), 100))
      ) p
  ));
end;
$$;

create function public.vault_answer(p_secret text, p_key text, p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_body jsonb;
begin
  perform private.beta_check_secret(p_secret);
  select a.body into v_body from private.vault_answers a where a.key = p_key and a.keep_until > p_now;
  return jsonb_build_object('ok', true, 'body', v_body);
end;
$$;

-- Keeps an answer ten minutes; answers past their time go.
create function public.vault_keep_answer(p_secret text, p_key text, p_body jsonb, p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.beta_check_secret(p_secret);
  delete from private.vault_answers
   where ctid in (select ctid from private.vault_answers where keep_until <= p_now limit 100);
  insert into private.vault_answers as a (key, body, keep_until)
  values (p_key, p_body, p_now + interval '10 minutes')
  on conflict (key) do update set body = excluded.body, keep_until = excluded.keep_until;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.vault_take(text, text, jsonb, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.vault_give_back(text, text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.vault_left(text, text, jsonb, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.vault_progress(text, text) from public, anon, authenticated, service_role;
revoke all on function public.vault_crack(text, text, text, date, integer, text, integer, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.vault_push(text, text, text, timestamptz, text, text, text, double precision, text) from public, anon, authenticated, service_role;
revoke all on function public.vault_feed(text, text, integer, text) from public, anon, authenticated, service_role;
revoke all on function public.vault_answer(text, text, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.vault_keep_answer(text, text, jsonb, timestamptz) from public, anon, authenticated, service_role;

grant execute on function public.vault_take(text, text, jsonb, timestamptz) to anon;
grant execute on function public.vault_give_back(text, text, uuid) to anon;
grant execute on function public.vault_left(text, text, jsonb, timestamptz) to anon;
grant execute on function public.vault_progress(text, text) to anon;
grant execute on function public.vault_crack(text, text, text, date, integer, text, integer, timestamptz) to anon;
grant execute on function public.vault_push(text, text, text, timestamptz, text, text, text, double precision, text) to anon;
grant execute on function public.vault_feed(text, text, integer, text) to anon;
grant execute on function public.vault_answer(text, text, timestamptz) to anon;
grant execute on function public.vault_keep_answer(text, text, jsonb, timestamptz) to anon;

commit;
