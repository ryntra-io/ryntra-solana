-- Ryntra City: beacons on towers (CITY-72, decision 74), on top of `world_v1`.
--
-- PREPARED 2026-10-28 as a file only. Not applied to any Supabase project:
-- Checked on a throwaway local PostgreSQL 16 with the Supabase roles, after
-- `world_v1` and `world_away` (see `lib/world/beacons/store.test.mjs`).
--
-- WHAT THIS FILE DOES
--   * `world_beacons` keeps one row an account: the person's beacon rules
--     (checked whole by the server before they are written) and what the
--     rules engine remembers of them. The row goes with its account.
--   * The rules are written only at the revision the person saw; the
--     engine's states only while the rules are still at the revision the
--     server's check read. The check walks the rows page by page.
--
-- WHAT IT DOES NOT DO
--   No money, no price column: a rule is a line a person drew, and every
--   number it is checked against is the city's market read. Nothing is sent
--   from the database; the server's cron tells Telegram.
--
-- UNTIL IT IS APPLIED
--   The beacons route answers 503 and the city keeps a person's beacons on
--   their device; the cron's pass fails quietly and waits for the next one.

begin;

-- -------------------------------------------------------------- beacons --

create table private.world_beacons (
  account_id uuid primary key references public.beta_users(id) on delete cascade,
  revision integer not null check (revision >= 1),
  rules jsonb not null check (jsonb_typeof(rules) = 'array' and jsonb_array_length(rules) <= 30),
  states jsonb not null check (jsonb_typeof(states) = 'object'),
  updated_at timestamptz not null,
  checked_at timestamptz
);

alter table private.world_beacons enable row level security;
alter table private.world_beacons force row level security;

revoke all privileges on table private.world_beacons from public, anon, authenticated, service_role;

-- The checks walk only the rows that have rules, in account order.
create index world_beacons_due_idx on private.world_beacons (account_id) where jsonb_array_length(rules) > 0;

create function private.world_beacon_row(b private.world_beacons)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'accountId', b.account_id, 'revision', b.revision, 'rules', b.rules, 'states', b.states,
    'updatedAt', private.world_iso(b.updated_at)
  );
$$;

-- The account's beacons; revision 0 and no rules before the first write.
create function public.world_beacons(p_secret text, p_account_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b private.world_beacons%rowtype;
begin
  perform private.beta_check_secret(p_secret);
  select * into b from private.world_beacons where account_id = p_account_id;
  if not found then
    return jsonb_build_object('ok', true, 'row', jsonb_build_object(
      'accountId', p_account_id, 'revision', 0, 'rules', '[]'::jsonb, 'states', '{}'::jsonb, 'updatedAt', null));
  end if;
  return jsonb_build_object('ok', true, 'row', private.world_beacon_row(b));
end;
$$;

-- Replace the rules and their states, at the revision the person saw.
create function public.world_set_beacons(p_secret text, p_account_id uuid, p_revision integer, p_rules jsonb, p_states jsonb, p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b private.world_beacons%rowtype;
  v_current integer;
begin
  perform private.beta_check_secret(p_secret);
  if not exists (select 1 from public.beta_users where id = p_account_id) then
    return jsonb_build_object('ok', false, 'error', 'no_account');
  end if;
  if jsonb_typeof(p_rules) is distinct from 'array' or jsonb_array_length(p_rules) > 30 or jsonb_typeof(p_states) is distinct from 'object' then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;
  select * into b from private.world_beacons where account_id = p_account_id for update;
  v_current := coalesce(b.revision, 0);
  if v_current <> p_revision then
    return jsonb_build_object('ok', false, 'error', 'revision', 'row', case when b.account_id is null
      then jsonb_build_object('accountId', p_account_id, 'revision', 0, 'rules', '[]'::jsonb, 'states', '{}'::jsonb, 'updatedAt', null)
      else private.world_beacon_row(b) end);
  end if;
  insert into private.world_beacons as w (account_id, revision, rules, states, updated_at)
  values (p_account_id, 1, p_rules, p_states, p_now)
  on conflict (account_id) do update
    set revision = w.revision + 1, rules = excluded.rules, states = excluded.states, updated_at = excluded.updated_at
  returning * into b;
  return jsonb_build_object('ok', true, 'row', private.world_beacon_row(b));
end;
$$;

-- The rows that have rules, after a cursor, in account order.
create function public.world_beacons_due(p_secret text, p_after uuid, p_limit integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.beta_check_secret(p_secret);
  return jsonb_build_object('ok', true, 'rows', (
    select coalesce(jsonb_agg(private.world_beacon_row(b) order by b.account_id), '[]'::jsonb)
      from (
        select x.*
          from private.world_beacons x
         where jsonb_array_length(x.rules) > 0 and (p_after is null or x.account_id > p_after)
         order by x.account_id
         limit greatest(1, least(coalesce(p_limit, 100), 500))
      ) b
  ));
end;
$$;

-- The engine's states after a check, written only while the rules are still at the revision it read.
create function public.world_beacons_step(p_secret text, p_account_id uuid, p_revision integer, p_states jsonb, p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_written integer;
begin
  perform private.beta_check_secret(p_secret);
  if jsonb_typeof(p_states) is distinct from 'object' then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;
  update private.world_beacons
     set states = p_states, checked_at = p_now
   where account_id = p_account_id and revision = p_revision;
  get diagnostics v_written = row_count;
  return jsonb_build_object('ok', true, 'written', v_written = 1);
end;
$$;

revoke all on function private.world_beacon_row(private.world_beacons) from public, anon, authenticated, service_role;
revoke all on function public.world_beacons(text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.world_set_beacons(text, uuid, integer, jsonb, jsonb, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.world_beacons_due(text, uuid, integer) from public, anon, authenticated, service_role;
revoke all on function public.world_beacons_step(text, uuid, integer, jsonb, timestamptz) from public, anon, authenticated, service_role;

grant execute on function public.world_beacons(text, uuid) to anon;
grant execute on function public.world_set_beacons(text, uuid, integer, jsonb, jsonb, timestamptz) to anon;
grant execute on function public.world_beacons_due(text, uuid, integer) to anon;
grant execute on function public.world_beacons_step(text, uuid, integer, jsonb, timestamptz) to anon;

commit;
