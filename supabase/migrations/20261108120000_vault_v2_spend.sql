-- Ryntra City: the Vault opens to people without money (CITY-218) — the
-- day's ceiling on what the guards' model may spend, and a guest's progress
-- handed to the wallet they sign in with.
--
-- PREPARED 2026-11-08 as a file only. Not applied to any Supabase project:
-- It stands on `20261027200000_vault_v1.sql` (applied 28.10) and changes
-- nothing in it. The vault does not open in production without it: every
-- attempt that asks a guard sets its worst case aside here first.
--
-- WHAT THIS FILE DOES
--   * One `vault_` table in `private`, row level security forced, no
--     policies and every grant revoked: what the guards' calls set aside and
--     spent each UTC day, in millionths of a dollar, for guests and for
--     wallets. Kept a week.
--   * `public.vault_spend_reserve` sets a call's worst case aside, or says it
--     does not fit under the day's ceiling (or, for a guest, under the guests'
--     share of it) — one step per day under an advisory lock, so instances
--     never both slip under it. `vault_spend_settle` books the call's real
--     cost against what was set aside, never past the same ceiling (what does
--     not fit comes back as `over`, for the server's log);
--     `vault_spend_read` reads the day.
--   * `public.vault_release` takes a guest's progress out of the books and
--     hands it back, once: the server records it on the wallet the guest just
--     signed in with, crack by crack, through `vault_crack`.
--   * Each function is gated by the app secret, runs with an empty search path
--     and is granted to anon alone, as in vault_v1.
--
-- WHAT IT DOES NOT DO
--   No money moves here: the figures are what Ryntra's model key spent, kept
--   so the guards rest when the day's ceiling is reached. No phrase, no text.

begin;

-- ---------------------------------------------------------------- spend --

create table private.vault_spend (
  day date not null,
  pool text not null check (pool in ('guest', 'wallet')),
  micro_usd bigint not null default 0 check (micro_usd between 0 and 1000000000000),
  updated_at timestamptz not null,
  primary key (day, pool)
);

alter table private.vault_spend enable row level security;
alter table private.vault_spend force row level security;

revoke all privileges on table private.vault_spend from public, anon, authenticated, service_role;

-- --------------------------------------------------------------- helpers --

create function private.vault_spend_json(p_day date)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'guest', coalesce((select s.micro_usd from private.vault_spend s where s.day = p_day and s.pool = 'guest'), 0),
    'wallet', coalesce((select s.micro_usd from private.vault_spend s where s.day = p_day and s.pool = 'wallet'), 0)
  );
$$;

revoke all on function private.vault_spend_json(date) from public, anon, authenticated, service_role;

-- ------------------------------------------------------- the server's API --

-- Sets a call's worst case aside against the day's ceiling, or says it does
-- not fit: the whole day under p_total, and a guest's call also under the
-- guests' share p_guest. One day at a time.
create function public.vault_spend_reserve(
  p_secret text,
  p_day date,
  p_pool text,
  p_micro bigint,
  p_total bigint,
  p_guest bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_guest bigint;
  v_wallet bigint;
begin
  perform private.beta_check_secret(p_secret);
  if p_day is null or p_pool is null or p_pool not in ('guest', 'wallet')
     or p_micro is null or p_micro not between 0 and 100000000
     or p_total is null or p_total not between 0 and 1000000000
     or p_guest is null or p_guest not between 0 and p_total then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('vault-spend:' || to_char(p_day, 'YYYY-MM-DD'), 0));
  delete from private.vault_spend where day < p_day - 7;
  select coalesce(sum(s.micro_usd) filter (where s.pool = 'guest'), 0),
         coalesce(sum(s.micro_usd) filter (where s.pool = 'wallet'), 0)
    into v_guest, v_wallet
    from private.vault_spend s where s.day = p_day;
  if v_guest + v_wallet + p_micro > p_total or (p_pool = 'guest' and v_guest + p_micro > p_guest) then
    return jsonb_build_object('ok', true, 'allowed', false, 'spent', jsonb_build_object('guest', v_guest, 'wallet', v_wallet));
  end if;
  insert into private.vault_spend as s (day, pool, micro_usd, updated_at)
  values (p_day, p_pool, p_micro, now())
  on conflict (day, pool) do update set micro_usd = s.micro_usd + excluded.micro_usd, updated_at = excluded.updated_at;
  return jsonb_build_object('ok', true, 'allowed', true, 'spent', private.vault_spend_json(p_day));
end;
$$;

-- Books what a call cost beyond what was set aside, or gives back what it did
-- not use (a negative delta); never below zero, and never past the day's
-- ceiling p_total (nor, for a guest, past the guests' share p_guest): a
-- model's price may change between the worst case and the call. What does not
-- fit is returned as `over`; the server writes it to its log (`roomOf` in
-- lib/vault/store.ts answers the same).
create function public.vault_spend_settle(
  p_secret text,
  p_day date,
  p_pool text,
  p_delta bigint,
  p_total bigint,
  p_guest bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_guest bigint;
  v_wallet bigint;
  v_booked bigint;
begin
  perform private.beta_check_secret(p_secret);
  if p_day is null or p_pool is null or p_pool not in ('guest', 'wallet')
     or p_delta is null or p_delta not between -100000000 and 100000000
     or p_total is null or p_total not between 0 and 1000000000
     or p_guest is null or p_guest not between 0 and p_total then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('vault-spend:' || to_char(p_day, 'YYYY-MM-DD'), 0));
  v_booked := p_delta;
  if p_delta > 0 then
    select coalesce(sum(s.micro_usd) filter (where s.pool = 'guest'), 0),
           coalesce(sum(s.micro_usd) filter (where s.pool = 'wallet'), 0)
      into v_guest, v_wallet
      from private.vault_spend s where s.day = p_day;
    v_booked := least(p_delta, greatest(0, least(
      p_total - v_guest - v_wallet,
      case when p_pool = 'guest' then p_guest - v_guest else p_total end
    )));
  end if;
  insert into private.vault_spend as s (day, pool, micro_usd, updated_at)
  values (p_day, p_pool, greatest(0, v_booked), now())
  on conflict (day, pool) do update set micro_usd = greatest(0, s.micro_usd + v_booked), updated_at = excluded.updated_at;
  return jsonb_build_object('ok', true, 'over', p_delta - v_booked, 'spent', private.vault_spend_json(p_day));
end;
$$;

create function public.vault_spend_read(p_secret text, p_day date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.beta_check_secret(p_secret);
  if p_day is null then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;
  return jsonb_build_object('ok', true, 'spent', private.vault_spend_json(p_day));
end;
$$;

-- Takes a person's progress out of the books and hands it back, once: two
-- requests at once hand it over once.
create function public.vault_release(p_secret text, p_who text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r private.vault_progress%rowtype;
begin
  perform private.beta_check_secret(p_secret);
  if p_who is null or char_length(p_who) not between 3 and 140 then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;
  delete from private.vault_progress where who = p_who returning * into r;
  if not found then
    return jsonb_build_object('ok', true, 'progress', null);
  end if;
  return jsonb_build_object('ok', true, 'progress', private.vault_progress_json(r));
end;
$$;

revoke all on function public.vault_spend_reserve(text, date, text, bigint, bigint, bigint) from public, anon, authenticated, service_role;
revoke all on function public.vault_spend_settle(text, date, text, bigint, bigint, bigint) from public, anon, authenticated, service_role;
revoke all on function public.vault_spend_read(text, date) from public, anon, authenticated, service_role;
revoke all on function public.vault_release(text, text) from public, anon, authenticated, service_role;

grant execute on function public.vault_spend_reserve(text, date, text, bigint, bigint, bigint) to anon;
grant execute on function public.vault_spend_settle(text, date, text, bigint, bigint, bigint) to anon;
grant execute on function public.vault_spend_read(text, date) to anon;
grant execute on function public.vault_release(text, text) to anon;

commit;
