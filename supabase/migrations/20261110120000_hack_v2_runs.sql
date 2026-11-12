-- Ryntra City: the Arena's third door, Hack — the agents' runs on the server (CITY-238).
--
-- PREPARED 2026-11-10 as a file only. Not applied to any Supabase project:
-- It stands on `20261108180000_hack_v1.sql` (the orders and the takes) and on
-- `private.beta_check_secret`. Without it no agent's run starts: a take stands
-- and its run answers «unavailable». The operator's check of the machine
-- (`GET /api/arena/hack/machine`) says so before the door is opened.
--
-- WHAT THIS FILE DOES
--   * One `hack_runs` table in `private`, row level security forced, no
--     policies and every grant revoked: an agent's run on an order — the
--     journal the harness writes turn by turn, how it ended, the finding it
--     filed, and what its models may spend and did spend.
--   * Every write is one step under a lock:
--       - a run starts only for an agent that took the order (the same owner,
--         the same side), under the order's row lock;
--       - one run of an agent on an order at a time; a run that ended void —
--         the machine's or the network's fault, never the agent's — may be
--         started again, three times in all, and every attempt's spend counts;
--       - the day's ceiling on Hack's models, under one lock for the day: a
--         live run holds the most it may spend, a finished one what it spent;
--         a start that would go over the ceiling, or over one owner's quarter
--         of it once that owner has spent anything, is refused and nothing is
--         written;
--       - a run is written only while it is still running here: one a reader
--         voided as stalled stays void, whatever its harness writes later.
--   * Every server function is gated by the app secret
--     (`private.beta_check_secret`), runs with an empty search path and is
--     granted to `anon` alone, as in `hack_v1`.
--
-- WHAT IT DOES NOT DO
--   No money: the ceiling is on what the models cost Ryntra, not a prize. No key, no prompt and no
--   model's words are kept: a journal holds the tools' results on the copy.

begin;

create table private.hack_runs (
  order_id text not null references private.hack_orders (id),
  hunter text not null check (hunter ~ '^[A-Za-z0-9._:-]{1,64}$'),
  -- 1 for the first run of this agent on this order; a void run played again is the next.
  attempt integer not null check (attempt between 1 and 3),
  owner text not null check (owner ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  role text not null check (role in ('attacker', 'defender')),
  status text not null check (status in ('running', 'done')),
  -- How it ended (`AgentResult` in city/lib/arena/hack/runner/brain.ts); null while it runs.
  result text check (result is null or result in ('submitted', 'stopped', 'fault', 'void', 'out_of_budget', 'over_turns', 'aborted')),
  -- The run as the server keeps it (`RunRecord`); the columns here are laid over it when it is read.
  record jsonb not null check (jsonb_typeof(record) = 'object' and pg_column_size(record) <= 524288),
  -- Micro-dollars: the most its models may spend, and what they spent once it is over.
  reserved bigint not null check (reserved >= 0),
  spent bigint check (spent is null or spent >= 0),
  started_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (order_id, hunter, attempt),
  check ((status = 'running') = (result is null)),
  check (status = 'done' or spent is null)
);

create index hack_runs_started_idx on private.hack_runs (started_at);
create index hack_runs_owner_idx on private.hack_runs (owner, started_at);

alter table private.hack_runs enable row level security;
alter table private.hack_runs force row level security;

revoke all privileges on table private.hack_runs from public, anon, authenticated, service_role;

-- A run as the server reads it (`runOf` in city/lib/arena/hack/runs/supabase.ts).
create function private.hack_run_json(r private.hack_runs)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'record', r.record,
    'status', r.status,
    'result', r.result,
    'attempt', r.attempt,
    'reserved', r.reserved,
    'spent', r.spent,
    'startedAt', private.hack_ms(r.started_at),
    'updatedAt', private.hack_ms(r.updated_at)
  );
$$;

revoke all on function private.hack_run_json(private.hack_runs) from public, anon, authenticated, service_role;

-- A new run. Under the order's row lock: the agent took the order (the same
-- owner, the same side), and no run of it is live or finished — only a void
-- one is played again, three attempts in all. Under the day's lock: the
-- models' spend since the day's start (live runs at their most) with this
-- run's most stays within the ceiling, and one owner that has spent anything
-- stays within a quarter of it.
create function public.hack_run_start(
  p_secret text,
  p_order text,
  p_hunter text,
  p_owner text,
  p_role text,
  p_record jsonb,
  p_reserved bigint,
  p_day timestamptz,
  p_cap bigint,
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r private.hack_orders%rowtype;
  v_last private.hack_runs%rowtype;
  v_attempt integer := 1;
  v_day bigint;
  v_owner bigint;
begin
  perform private.beta_check_secret(p_secret);
  if p_now is null or p_order is null or p_hunter is null or p_owner is null or p_day is null
     or p_role is null or p_role not in ('attacker', 'defender')
     or p_reserved is null or p_reserved < 0 or p_cap is null or p_cap < 0
     or jsonb_typeof(p_record) is distinct from 'object'
     or p_record ->> 'order' is distinct from p_order or p_record ->> 'hunter' is distinct from p_hunter
     or p_record ->> 'owner' is distinct from p_owner then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;
  select * into r from private.hack_orders o where o.id = p_order for update;
  if not found or not exists (
    select 1 from private.hack_takes k
     where k.order_id = p_order and k.hunter = p_hunter and k.owner = p_owner and k.role = p_role
  ) then
    return jsonb_build_object('ok', true, 'started', false, 'error', 'not_taken');
  end if;
  select * into v_last from private.hack_runs x
   where x.order_id = p_order and x.hunter = p_hunter order by x.attempt desc limit 1;
  if found then
    if v_last.status = 'running' or v_last.result is distinct from 'void' or v_last.attempt >= 3 then
      return jsonb_build_object('ok', true, 'started', false, 'error', 'exists');
    end if;
    v_attempt := v_last.attempt + 1;
  end if;
  if p_reserved > 0 then
    perform pg_advisory_xact_lock(hashtextextended('hack:runs:day', 0));
    select coalesce(sum(coalesce(x.spent, x.reserved)), 0) into v_day from private.hack_runs x where x.started_at >= p_day;
    if v_day + p_reserved > p_cap then
      return jsonb_build_object('ok', true, 'started', false, 'error', 'daily_cap');
    end if;
    select coalesce(sum(coalesce(x.spent, x.reserved)), 0) into v_owner
      from private.hack_runs x where x.owner = p_owner and x.started_at >= p_day;
    if v_owner > 0 and v_owner + p_reserved > p_cap / 4 then
      return jsonb_build_object('ok', true, 'started', false, 'error', 'daily_cap');
    end if;
  end if;
  insert into private.hack_runs (order_id, hunter, attempt, owner, role, status, result, record, reserved, spent, started_at, updated_at)
  values (p_order, p_hunter, v_attempt, p_owner, p_role, 'running', null, p_record, p_reserved, null, p_now, p_now);
  return jsonb_build_object('ok', true, 'started', true, 'attempt', v_attempt);
end;
$$;

-- The run as it goes on, written only while this attempt is still running
-- here. Once it is over its spend is what was measured, or — when nothing
-- was — the most it was allowed.
create function public.hack_run_put(
  p_secret text,
  p_order text,
  p_hunter text,
  p_attempt integer,
  p_status text,
  p_result text,
  p_record jsonb,
  p_spent bigint,
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows integer;
begin
  perform private.beta_check_secret(p_secret);
  if p_now is null or p_order is null or p_hunter is null or p_attempt is null
     or p_status is null or p_status not in ('running', 'done') or (p_status = 'running') <> (p_result is null)
     or (p_spent is not null and p_spent < 0)
     or jsonb_typeof(p_record) is distinct from 'object'
     or p_record ->> 'order' is distinct from p_order or p_record ->> 'hunter' is distinct from p_hunter then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;
  update private.hack_runs x
     set status = p_status,
         result = p_result,
         record = p_record,
         spent = case when p_status = 'done' then coalesce(p_spent, x.reserved) else null end,
         updated_at = p_now
   where x.order_id = p_order and x.hunter = p_hunter and x.attempt = p_attempt and x.status = 'running';
  get diagnostics v_rows = row_count;
  return jsonb_build_object('ok', true, 'written', v_rows = 1);
end;
$$;

-- The agent's latest run on the order.
create function public.hack_run_get(p_secret text, p_order text, p_hunter text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  x private.hack_runs%rowtype;
begin
  perform private.beta_check_secret(p_secret);
  select * into x from private.hack_runs k
   where k.order_id = p_order and k.hunter = p_hunter order by k.attempt desc limit 1;
  if not found then
    return jsonb_build_object('ok', true, 'run', null);
  end if;
  return jsonb_build_object('ok', true, 'run', private.hack_run_json(x));
end;
$$;

-- What the runs started since a moment spent on models, the live ones at their most.
create function public.hack_run_spent(p_secret text, p_since timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.beta_check_secret(p_secret);
  return jsonb_build_object('ok', true, 'spent', (
    select coalesce(sum(coalesce(x.spent, x.reserved)), 0) from private.hack_runs x where x.started_at >= p_since
  ));
end;
$$;

revoke all on function public.hack_run_start(text, text, text, text, text, jsonb, bigint, timestamptz, bigint, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.hack_run_put(text, text, text, integer, text, text, jsonb, bigint, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.hack_run_get(text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.hack_run_spent(text, timestamptz) from public, anon, authenticated, service_role;

grant execute on function public.hack_run_start(text, text, text, text, text, jsonb, bigint, timestamptz, bigint, timestamptz) to anon;
grant execute on function public.hack_run_put(text, text, text, integer, text, text, jsonb, bigint, timestamptz) to anon;
grant execute on function public.hack_run_get(text, text, text) to anon;
grant execute on function public.hack_run_spent(text, timestamptz) to anon;

commit;
