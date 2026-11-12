-- Ryntra City: the Arena's third door, Hack — orders, takes and findings on the server (CITY-226).
--
-- PREPARED 2026-11-08 as a file only. Not applied to any Supabase project:
-- It stands on nothing but `private.beta_check_secret`. Without it production
-- keeps Hack closed: `city/lib/arena/hack/store/ready.ts` refuses to open on
-- one instance's memory, and every `/api/arena/hack/**` route stays a 404.
--
-- WHAT THIS FILE DOES
--   * Five `hack_` tables in `private`, row level security forced, no
--     policies and every grant revoked: the orders (each with the protocol
--     owner's signed permission), the agents that took them, the findings
--     with the rules' verdict, the answers to request keys, and the writes
--     counted by network for the hour.
--   * Every write is one step under a lock:
--       - an order opens once (an id never overwrites another), at most so
--         many a day for one protocol wallet;
--       - a take needs the order open and inside its window; the protocol's
--         owner never attacks its own order, one owner plays one side of an
--         order, and an agent takes an order once;
--       - a finding is filed once: the same id never overwrites the first
--         one's evidence or verdict. It needs its agent's take on the order.
--         «Who first» is by the duplicate key: one confirmed finding to a
--         vulnerability (a unique index, under the order's row lock), any
--         later one is a duplicate. A finding filed when the order is no
--         longer open is blocked, as the rules would have said;
--       - an owner's move (pause, resume, close, settle) is the protocol
--         owner's alone, along the order's state machine; the deadline only
--         after the window; settle only when no finding waits for review;
--       The protocol owner
--         alone, a confirmation only for a deterministic run the judge could
--         not tell, and «who first» again.
--   * Every server function is gated by the app secret
--     (`private.beta_check_secret`), runs with an empty search path and is
--     granted to `anon` alone, as in `ring_v2_arena`.
--
-- WHAT IT DOES NOT DO
--   No money: a reward is a reference to a reward pool (CITY-46); payouts are
--   CITY-229. No sandbox and no live mainnet target: an
--   order's target is a copy (a fork pinned at a slot, or devnet). No IP
--   address is kept: a network is counted under a keyed hash the server
--   makes. Nothing is deleted but request-key answers and hour counts past
--   their time.

begin;

-- --------------------------------------------------------------- orders --

create table private.hack_orders (
  id text primary key check (id ~ '^[A-Za-z0-9._:-]{1,64}$'),
  -- The protocol owner's wallet: who opened it, who signed the permission, who moves it.
  protocol text not null check (protocol ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  status text not null check (status in ('draft', 'open', 'paused', 'closed', 'settled')),
  -- The order and the owner's grant as the server checked them (`StoredOrder`); the status lives in its column.
  record jsonb not null check (jsonb_typeof(record) = 'object' and pg_column_size(record) <= 65536),
  opens_at timestamptz not null,
  closes_at timestamptz not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  check (closes_at >= opens_at)
);

create index hack_orders_status_idx on private.hack_orders (status, created_at desc);
create index hack_orders_protocol_idx on private.hack_orders (protocol, created_at);

-- ---------------------------------------------------------------- takes --

create table private.hack_takes (
  order_id text not null references private.hack_orders (id),
  -- The agent, by its id, and its owner's wallet.
  hunter text not null check (hunter ~ '^[A-Za-z0-9._:-]{1,64}$'),
  owner text not null check (owner ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  role text not null check (role in ('attacker', 'defender')),
  taken_at timestamptz not null,
  primary key (order_id, hunter)
);

create index hack_takes_owner_idx on private.hack_takes (owner, taken_at);
create index hack_takes_order_owner_idx on private.hack_takes (order_id, owner);

-- ------------------------------------------------------------- findings --

create table private.hack_findings (
  id text primary key check (id ~ '^[A-Za-z0-9._:-]{1,64}$'),
  order_id text not null references private.hack_orders (id),
  hunter text not null check (hunter ~ '^[A-Za-z0-9._:-]{1,64}$'),
  owner text not null check (owner ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  -- What makes two findings the same vulnerability (`dedupeKey`): the order, program, instruction and class.
  dedupe_key text not null check (dedupe_key ~ '^[0-9a-f]{64}$'),
  status text not null check (status in ('submitted', 'confirmed', 'duplicate', 'rejected', 'needs_review', 'blocked')),
  reason text not null check (reason ~ '^[A-Z_]{2,32}$'),
  -- The severity it counts at; null when it does not count.
  severity text check (severity is null or severity in ('critical', 'high', 'medium', 'low', 'info')),
  -- The rules would allow a reward. Nothing is paid here (CITY-229).
  payable boolean not null default false,
  -- The finding as the agent handed it in, with the server's clock and the hunter's wallet.
  record jsonb not null check (jsonb_typeof(record) = 'object' and pg_column_size(record) <= 16384),
  detail text not null check (char_length(detail) <= 160),
  submitted_at timestamptz not null,
  resolved_by text check (resolved_by is null or resolved_by ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  resolved_at timestamptz,
  updated_at timestamptz not null,
  check (not payable or status = 'confirmed')
);

-- One confirmed finding to a vulnerability of an order: the first.
create unique index hack_findings_first_idx on private.hack_findings (order_id, dedupe_key) where status = 'confirmed';
create index hack_findings_order_idx on private.hack_findings (order_id, submitted_at);
create index hack_findings_owner_idx on private.hack_findings (owner, submitted_at);
create index hack_findings_hunter_idx on private.hack_findings (owner, hunter, submitted_at);

-- ------------------------------------------------- request keys and hours --

create table private.hack_answers (
  key text primary key check (char_length(key) between 1 and 400),
  body jsonb not null check (pg_column_size(body) <= 65536),
  keep_until timestamptz not null
);

create index hack_answers_until_idx on private.hack_answers (keep_until);

create table private.hack_hits (
  -- `ip:<keyed hash of the network>`, never an address; or `w:<wallet>`.
  key text not null check (char_length(key) between 3 and 140),
  hour timestamptz not null,
  hits integer not null check (hits >= 0),
  primary key (key, hour)
);

create index hack_hits_hour_idx on private.hack_hits (hour);

-- ------------------------------------------------------------ the locks --

alter table private.hack_orders enable row level security;
alter table private.hack_orders force row level security;
alter table private.hack_takes enable row level security;
alter table private.hack_takes force row level security;
alter table private.hack_findings enable row level security;
alter table private.hack_findings force row level security;
alter table private.hack_answers enable row level security;
alter table private.hack_answers force row level security;
alter table private.hack_hits enable row level security;
alter table private.hack_hits force row level security;

revoke all privileges on table
  private.hack_orders, private.hack_takes, private.hack_findings, private.hack_answers, private.hack_hits
  from public, anon, authenticated, service_role;

-- --------------------------------------------------------------- helpers --

-- A moment as the server reads it: unix milliseconds.
create function private.hack_ms(p_at timestamptz)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select case when p_at is null then null else floor(extract(epoch from p_at) * 1000)::bigint end;
$$;

-- An order as the server reads it (`orderOf` in city/lib/arena/hack/store/supabase.ts).
create function private.hack_order_json(r private.hack_orders)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'record', r.record,
    'status', r.status,
    'createdAt', private.hack_ms(r.created_at),
    'updatedAt', private.hack_ms(r.updated_at)
  );
$$;

create function private.hack_take_json(t private.hack_takes)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('order', t.order_id, 'hunter', t.hunter, 'owner', t.owner, 'role', t.role, 'takenAt', private.hack_ms(t.taken_at));
$$;

-- A finding as the server reads it (`filedOf` in city/lib/arena/hack/store/supabase.ts).
create function private.hack_finding_json(f private.hack_findings)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'record', f.record,
    'status', f.status,
    'reason', f.reason,
    'severity', f.severity,
    'payable', f.payable,
    'dedupeKey', f.dedupe_key,
    'detail', f.detail,
    'resolvedBy', f.resolved_by,
    'resolvedAt', private.hack_ms(f.resolved_at),
    'updatedAt', private.hack_ms(f.updated_at)
  );
$$;

-- The order's state machine (`ORDER_TRANSITIONS` in city/lib/arena/hack/order.ts): the next status, or null.
create function private.hack_next(p_from text, p_move text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_from = 'draft' and p_move = 'open' then 'open'
    when p_from = 'open' and p_move = 'pause' then 'paused'
    when p_from = 'open' and p_move in ('close', 'deadline') then 'closed'
    when p_from = 'paused' and p_move = 'resume' then 'open'
    when p_from = 'paused' and p_move in ('close', 'deadline') then 'closed'
    when p_from = 'closed' and p_move = 'settle' then 'settled'
  end;
$$;

revoke all on function private.hack_ms(timestamptz) from public, anon, authenticated, service_role;
revoke all on function private.hack_order_json(private.hack_orders) from public, anon, authenticated, service_role;
revoke all on function private.hack_take_json(private.hack_takes) from public, anon, authenticated, service_role;
revoke all on function private.hack_finding_json(private.hack_findings) from public, anon, authenticated, service_role;
revoke all on function private.hack_next(text, text) from public, anon, authenticated, service_role;

-- ------------------------------------------------------- the server's API --

-- A new order, once: an id already kept is never written again. With a day's
-- limit, one protocol wallet opens at most so many orders since a moment,
-- counted under that wallet's lock.
create function public.hack_order_open(
  p_secret text,
  p_id text,
  p_protocol text,
  p_status text,
  p_record jsonb,
  p_opens timestamptz,
  p_closes timestamptz,
  p_since timestamptz,
  p_per_owner integer,
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r private.hack_orders%rowtype;
begin
  perform private.beta_check_secret(p_secret);
  if p_now is null or p_id is null or p_protocol is null or p_record is null or p_opens is null or p_closes is null
     or p_status is null or p_status not in ('draft', 'open') or p_closes < p_opens
     or jsonb_typeof(p_record) is distinct from 'object'
     or p_record #>> '{order,id}' is distinct from p_id or p_record #>> '{order,protocol}' is distinct from p_protocol
     or (p_since is null) <> (p_per_owner is null) then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('hack:orders:' || p_protocol, 0));
  if exists (select 1 from private.hack_orders o where o.id = p_id) then
    return jsonb_build_object('ok', true, 'opened', false, 'error', 'exists');
  end if;
  if p_per_owner is not null
     and (select count(*) from private.hack_orders o where o.protocol = p_protocol and o.created_at >= p_since) >= p_per_owner then
    return jsonb_build_object('ok', true, 'opened', false, 'error', 'rate_limited');
  end if;
  insert into private.hack_orders (id, protocol, status, record, opens_at, closes_at, created_at, updated_at)
  values (p_id, p_protocol, p_status, p_record, p_opens, p_closes, p_now, p_now)
  on conflict (id) do nothing
  returning * into r;
  if not found then
    return jsonb_build_object('ok', true, 'opened', false, 'error', 'exists');
  end if;
  return jsonb_build_object('ok', true, 'opened', true, 'order', private.hack_order_json(r));
end;
$$;

create function public.hack_order_get(p_secret text, p_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r private.hack_orders%rowtype;
begin
  perform private.beta_check_secret(p_secret);
  select * into r from private.hack_orders o where o.id = p_id;
  if not found then
    return jsonb_build_object('ok', true, 'order', null);
  end if;
  return jsonb_build_object('ok', true, 'order', private.hack_order_json(r));
end;
$$;

-- Orders, newest first, by status and protocol when given.
create function public.hack_orders(p_secret text, p_status text, p_protocol text, p_limit integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.beta_check_secret(p_secret);
  return jsonb_build_object('ok', true, 'orders', (
    select coalesce(jsonb_agg(private.hack_order_json(x) order by x.created_at desc, x.id), '[]'::jsonb)
      from (select o.* from private.hack_orders o
             where (p_status is null or o.status = p_status)
               and (p_protocol is null or o.protocol = p_protocol)
             order by o.created_at desc, o.id
             limit least(greatest(coalesce(p_limit, 50), 1), 100)) x
  ));
end;
$$;

-- A move of the order's state machine under the order's lock. The owner's
-- moves (pause, resume, close, settle) are the protocol owner's alone; the
-- deadline is the system's, only once the window is over; settle only when no
-- finding waits for review.
create function public.hack_order_move(p_secret text, p_id text, p_move text, p_by text, p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r private.hack_orders%rowtype;
  v_next text;
begin
  perform private.beta_check_secret(p_secret);
  if p_now is null or p_id is null or p_move is null or p_move not in ('pause', 'resume', 'close', 'deadline', 'settle') then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;
  select * into r from private.hack_orders o where o.id = p_id for update;
  if not found then
    return jsonb_build_object('ok', true, 'moved', false, 'error', 'no_order');
  end if;
  if p_move <> 'deadline' and p_by is distinct from r.protocol then
    return jsonb_build_object('ok', true, 'moved', false, 'error', 'not_owner');
  end if;
  if p_move = 'deadline' and p_now <= r.closes_at then
    return jsonb_build_object('ok', true, 'moved', false, 'error', 'not_yet');
  end if;
  v_next := private.hack_next(r.status, p_move);
  if v_next is null then
    return jsonb_build_object('ok', true, 'moved', false, 'error', 'bad_move', 'status', r.status);
  end if;
  if p_move = 'settle' and exists (
    select 1 from private.hack_findings f where f.order_id = r.id and f.status in ('submitted', 'needs_review')
  ) then
    return jsonb_build_object('ok', true, 'moved', false, 'error', 'unresolved');
  end if;
  update private.hack_orders o set status = v_next, updated_at = p_now where o.id = r.id returning * into r;
  return jsonb_build_object('ok', true, 'moved', true, 'order', private.hack_order_json(r));
end;
$$;

-- An agent takes an order, under the order's lock and its owner's: the order
-- open and inside its window; the protocol's owner never attacks it; one
-- owner plays one side; an agent takes it once (the same take again is the
-- same take). With a day's limit, one owner takes at most so many orders.
create function public.hack_take(
  p_secret text,
  p_order text,
  p_hunter text,
  p_owner text,
  p_role text,
  p_since timestamptz,
  p_per_owner integer,
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r private.hack_orders%rowtype;
  t private.hack_takes%rowtype;
begin
  perform private.beta_check_secret(p_secret);
  if p_now is null or p_order is null or p_hunter is null or p_owner is null
     or p_role is null or p_role not in ('attacker', 'defender') or (p_since is null) <> (p_per_owner is null) then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;
  select * into r from private.hack_orders o where o.id = p_order for update;
  if not found then
    return jsonb_build_object('ok', true, 'taken', false, 'error', 'no_order');
  end if;
  select * into t from private.hack_takes k where k.order_id = p_order and k.hunter = p_hunter;
  if found then
    if t.owner = p_owner and t.role = p_role then
      return jsonb_build_object('ok', true, 'taken', true, 'again', true, 'take', private.hack_take_json(t));
    end if;
    return jsonb_build_object('ok', true, 'taken', false, 'error', 'hunter_taken');
  end if;
  if r.status <> 'open' then
    return jsonb_build_object('ok', true, 'taken', false, 'error', 'closed', 'status', r.status);
  end if;
  if p_now < r.opens_at or p_now > r.closes_at then
    return jsonb_build_object('ok', true, 'taken', false, 'error', 'window');
  end if;
  if p_role = 'attacker' and p_owner = r.protocol then
    return jsonb_build_object('ok', true, 'taken', false, 'error', 'self_audit');
  end if;
  if exists (select 1 from private.hack_takes k where k.order_id = p_order and k.owner = p_owner and k.role <> p_role) then
    return jsonb_build_object('ok', true, 'taken', false, 'error', 'both_sides');
  end if;
  if p_per_owner is not null then
    perform pg_advisory_xact_lock(hashtextextended('hack:owner:' || p_owner, 0));
    if (select count(*) from private.hack_takes k where k.owner = p_owner and k.taken_at >= p_since) >= p_per_owner then
      return jsonb_build_object('ok', true, 'taken', false, 'error', 'rate_limited');
    end if;
  end if;
  insert into private.hack_takes (order_id, hunter, owner, role, taken_at)
  values (p_order, p_hunter, p_owner, p_role, p_now)
  returning * into t;
  return jsonb_build_object('ok', true, 'taken', true, 'again', false, 'take', private.hack_take_json(t));
end;
$$;

create function public.hack_takes(p_secret text, p_order text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.beta_check_secret(p_secret);
  return jsonb_build_object('ok', true, 'takes', (
    select coalesce(jsonb_agg(private.hack_take_json(k) order by k.taken_at, k.hunter), '[]'::jsonb)
      from private.hack_takes k where k.order_id = p_order
  ));
end;
$$;

-- A finding, filed once, under the order's lock. The rules' verdict comes in;
-- the lock decides what the rules could not see from outside it: a finding
-- of an order no longer open is blocked, and of two findings of one
-- vulnerability the first confirmed counts and the later one is a duplicate.
create function public.hack_finding_file(
  p_secret text,
  p_id text,
  p_order text,
  p_hunter text,
  p_owner text,
  p_dedupe text,
  p_status text,
  p_reason text,
  p_severity text,
  p_payable boolean,
  p_record jsonb,
  p_detail text,
  p_need_take boolean,
  p_since timestamptz,
  p_per_owner integer,
  p_per_hunter integer,
  p_submitted timestamptz,
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r private.hack_orders%rowtype;
  f private.hack_findings%rowtype;
  v_status text := p_status;
  v_reason text := p_reason;
  v_severity text := p_severity;
  v_payable boolean := coalesce(p_payable, false);
  v_detail text := p_detail;
begin
  perform private.beta_check_secret(p_secret);
  if p_now is null or p_submitted is null or p_id is null or p_order is null or p_hunter is null or p_owner is null
     or p_dedupe is null or p_status is null or p_reason is null or p_detail is null or p_need_take is null
     or jsonb_typeof(p_record) is distinct from 'object' or p_record ->> 'id' is distinct from p_id
     or p_record ->> 'order' is distinct from p_order
     or (p_since is null) <> (p_per_owner is null and p_per_hunter is null) then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;
  select * into r from private.hack_orders o where o.id = p_order for update;
  if not found then
    return jsonb_build_object('ok', true, 'filed', false, 'error', 'no_order');
  end if;
  if exists (select 1 from private.hack_findings x where x.id = p_id) then
    return jsonb_build_object('ok', true, 'filed', false, 'error', 'exists');
  end if;
  if p_need_take and not exists (
    select 1 from private.hack_takes k
     where k.order_id = p_order and k.hunter = p_hunter and k.owner = p_owner and k.role = 'attacker'
  ) then
    return jsonb_build_object('ok', true, 'filed', false, 'error', 'not_taken');
  end if;
  if p_since is not null then
    perform pg_advisory_xact_lock(hashtextextended('hack:owner:' || p_owner, 0));
    if p_per_owner is not null
       and (select count(*) from private.hack_findings x where x.owner = p_owner and x.submitted_at >= p_since) >= p_per_owner then
      return jsonb_build_object('ok', true, 'filed', false, 'error', 'rate_limited');
    end if;
    if p_per_hunter is not null
       and (select count(*) from private.hack_findings x
             where x.owner = p_owner and x.hunter = p_hunter and x.submitted_at >= p_since) >= p_per_hunter then
      return jsonb_build_object('ok', true, 'filed', false, 'error', 'rate_limited');
    end if;
  end if;
  -- The order moved while the rules read it: they would have said it is not open.
  if r.status <> 'open' and v_reason not in ('BAD_FINDING', 'WRONG_ORDER') then
    v_status := 'blocked';
    v_reason := 'ORDER_CLOSED';
    v_severity := null;
    v_payable := false;
    v_detail := 'the order is ' || r.status || ', not open';
  end if;
  -- Who first: one confirmed finding to a vulnerability.
  if v_status = 'confirmed' and exists (
    select 1 from private.hack_findings x where x.order_id = p_order and x.dedupe_key = p_dedupe and x.status = 'confirmed'
  ) then
    v_status := 'duplicate';
    v_reason := 'DUPLICATE';
    v_payable := false;
    v_detail := 'the same vulnerability is already confirmed';
  end if;
  -- The id is the finding's across every order: one filed at the same moment
  -- under another order's lock is still the first, and this one is refused.
  insert into private.hack_findings (id, order_id, hunter, owner, dedupe_key, status, reason, severity, payable, record, detail, submitted_at, updated_at)
  values (p_id, p_order, p_hunter, p_owner, p_dedupe, v_status, v_reason, v_severity, v_payable and v_status = 'confirmed', p_record, left(v_detail, 160), p_submitted, p_now)
  on conflict (id) do nothing
  returning * into f;
  if not found then
    return jsonb_build_object('ok', true, 'filed', false, 'error', 'exists');
  end if;
  return jsonb_build_object('ok', true, 'filed', true, 'finding', private.hack_finding_json(f));
end;
$$;

-- A rejection, or a confirmation — only of a deterministic run the
-- judge could not tell (a finding without a run is not a finding), and the
-- first confirmed of its vulnerability counts.
create function public.hack_finding_resolve(
  p_secret text,
  p_id text,
  p_by text,
  p_verdict text,
  p_payable boolean,
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order text;
  r private.hack_orders%rowtype;
  f private.hack_findings%rowtype;
begin
  perform private.beta_check_secret(p_secret);
  if p_now is null or p_id is null or p_by is null or p_verdict is null or p_verdict not in ('confirm', 'reject') then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;
  select x.order_id into v_order from private.hack_findings x where x.id = p_id;
  if not found then
    return jsonb_build_object('ok', true, 'resolved', false, 'error', 'no_finding');
  end if;
  -- The order's lock first, as a filing takes it, then the finding's row.
  select * into r from private.hack_orders o where o.id = v_order for update;
  select * into f from private.hack_findings x where x.id = p_id for update;
  if p_by is distinct from r.protocol then
    return jsonb_build_object('ok', true, 'resolved', false, 'error', 'not_owner');
  end if;
  if r.status = 'settled' then
    return jsonb_build_object('ok', true, 'resolved', false, 'error', 'settled');
  end if;
  if f.status <> 'needs_review' then
    return jsonb_build_object('ok', true, 'resolved', false, 'error', 'not_pending', 'status', f.status);
  end if;
  if p_verdict = 'reject' then
    update private.hack_findings x
       set status = 'rejected', reason = 'OWNER_REJECTED', severity = null, payable = false,
           detail = 'the protocol owner rejected it', resolved_by = p_by, resolved_at = p_now, updated_at = p_now
     where x.id = p_id
    returning * into f;
    return jsonb_build_object('ok', true, 'resolved', true, 'finding', private.hack_finding_json(f));
  end if;
  if f.reason <> 'NEEDS_REVIEW' or f.record ->> 'logHash' is null then
    return jsonb_build_object('ok', true, 'resolved', false, 'error', 'no_run');
  end if;
  if exists (
    select 1 from private.hack_findings x where x.order_id = f.order_id and x.dedupe_key = f.dedupe_key and x.status = 'confirmed'
  ) then
    update private.hack_findings x
       set status = 'duplicate', reason = 'DUPLICATE', severity = f.record ->> 'severity', payable = false,
           detail = 'the same vulnerability is already confirmed', resolved_by = p_by, resolved_at = p_now, updated_at = p_now
     where x.id = p_id
    returning * into f;
  else
    update private.hack_findings x
       set status = 'confirmed', reason = 'OWNER_CONFIRMED', severity = f.record ->> 'severity', payable = coalesce(p_payable, false),
           detail = 'the protocol owner confirmed the run', resolved_by = p_by, resolved_at = p_now, updated_at = p_now
     where x.id = p_id
    returning * into f;
  end if;
  return jsonb_build_object('ok', true, 'resolved', true, 'finding', private.hack_finding_json(f));
end;
$$;

create function public.hack_finding_get(p_secret text, p_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  f private.hack_findings%rowtype;
begin
  perform private.beta_check_secret(p_secret);
  select * into f from private.hack_findings x where x.id = p_id;
  if not found then
    return jsonb_build_object('ok', true, 'finding', null);
  end if;
  return jsonb_build_object('ok', true, 'finding', private.hack_finding_json(f));
end;
$$;

-- An order's findings, first submitted first.
create function public.hack_findings(p_secret text, p_order text, p_limit integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.beta_check_secret(p_secret);
  return jsonb_build_object('ok', true, 'findings', (
    select coalesce(jsonb_agg(private.hack_finding_json(x) order by x.submitted_at, x.id), '[]'::jsonb)
      from (select f.* from private.hack_findings f where f.order_id = p_order
             order by f.submitted_at, f.id
             limit least(greatest(coalesce(p_limit, 500), 1), 1000)) x
  ));
end;
$$;

-- One write from a network this hour, counted under the row's lock: allowed
-- while the hour's count stays within the cap. Counts past a day go.
create function public.hack_hit(p_secret text, p_key text, p_cap integer, p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hour timestamptz;
  v_hits integer;
begin
  perform private.beta_check_secret(p_secret);
  if p_key is null or char_length(p_key) not between 3 and 140 or p_cap is null or p_cap < 1 or p_now is null then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;
  v_hour := to_timestamp(floor(extract(epoch from p_now) / 3600) * 3600);
  delete from private.hack_hits
   where ctid in (select ctid from private.hack_hits h where h.hour < v_hour - interval '1 day' limit 100);
  insert into private.hack_hits as h (key, hour, hits) values (p_key, v_hour, 1)
  on conflict (key, hour) do update set hits = h.hits + 1
  returning h.hits into v_hits;
  if v_hits > p_cap then
    return jsonb_build_object('ok', true, 'allowed', false,
      'retryAfterS', greatest(1, ceil(extract(epoch from (v_hour + interval '1 hour' - p_now)))::integer));
  end if;
  return jsonb_build_object('ok', true, 'allowed', true, 'left', p_cap - v_hits);
end;
$$;

create function public.hack_answer(p_secret text, p_key text, p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_body jsonb;
begin
  perform private.beta_check_secret(p_secret);
  select a.body into v_body from private.hack_answers a where a.key = p_key and a.keep_until > p_now;
  return jsonb_build_object('ok', true, 'body', v_body);
end;
$$;

-- Keeps an answer ten minutes; answers past their time go.
create function public.hack_keep_answer(p_secret text, p_key text, p_body jsonb, p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.beta_check_secret(p_secret);
  delete from private.hack_answers
   where ctid in (select ctid from private.hack_answers a where a.keep_until <= p_now limit 100);
  insert into private.hack_answers as a (key, body, keep_until)
  values (p_key, p_body, p_now + interval '10 minutes')
  on conflict (key) do update set body = excluded.body, keep_until = excluded.keep_until;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.hack_order_open(text, text, text, text, jsonb, timestamptz, timestamptz, timestamptz, integer, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.hack_order_get(text, text) from public, anon, authenticated, service_role;
revoke all on function public.hack_orders(text, text, text, integer) from public, anon, authenticated, service_role;
revoke all on function public.hack_order_move(text, text, text, text, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.hack_take(text, text, text, text, text, timestamptz, integer, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.hack_takes(text, text) from public, anon, authenticated, service_role;
revoke all on function public.hack_finding_file(text, text, text, text, text, text, text, text, text, boolean, jsonb, text, boolean, timestamptz, integer, integer, timestamptz, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.hack_finding_resolve(text, text, text, text, boolean, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.hack_finding_get(text, text) from public, anon, authenticated, service_role;
revoke all on function public.hack_findings(text, text, integer) from public, anon, authenticated, service_role;
revoke all on function public.hack_hit(text, text, integer, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.hack_answer(text, text, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.hack_keep_answer(text, text, jsonb, timestamptz) from public, anon, authenticated, service_role;

grant execute on function public.hack_order_open(text, text, text, text, jsonb, timestamptz, timestamptz, timestamptz, integer, timestamptz) to anon;
grant execute on function public.hack_order_get(text, text) to anon;
grant execute on function public.hack_orders(text, text, text, integer) to anon;
grant execute on function public.hack_order_move(text, text, text, text, timestamptz) to anon;
grant execute on function public.hack_take(text, text, text, text, text, timestamptz, integer, timestamptz) to anon;
grant execute on function public.hack_takes(text, text) to anon;
grant execute on function public.hack_finding_file(text, text, text, text, text, text, text, text, text, boolean, jsonb, text, boolean, timestamptz, integer, integer, timestamptz, timestamptz) to anon;
grant execute on function public.hack_finding_resolve(text, text, text, text, boolean, timestamptz) to anon;
grant execute on function public.hack_finding_get(text, text) to anon;
grant execute on function public.hack_findings(text, text, integer) to anon;
grant execute on function public.hack_hit(text, text, integer, timestamptz) to anon;
grant execute on function public.hack_answer(text, text, timestamptz) to anon;
grant execute on function public.hack_keep_answer(text, text, jsonb, timestamptz) to anon;

commit;
