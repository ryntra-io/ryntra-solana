-- Ryntra: «Contacts» and «Autopay».
--
-- PREPARED 2026-11-20 as a file only. Not applied to any Supabase project.
-- Until it is applied the routes answer UNAVAILABLE (a function that is not
-- there is a store that did not answer) and the screens say so; nothing reads
-- an empty book as «no contacts».
--
-- WHAT THIS FILE DOES
--   * Five tables in the `private` schema, nothing else of the schema touched:
--     `private.contacts` — a wallet's address book: a name, an address or a
--       `.skr` name, a short note. One row per (wallet, address).
--     `private.contact_nonces` — every nonce a wallet's signed change spent,
--       so one signature changes the book once (kept a day).
--     `private.autopays` — an autopay the person signed: the record the server
--       read back from the chain (public addresses and numbers only), its state.
--     `private.autopay_payments` — one row per window of an autopay: claimed
--       by the executor before it builds the payment, its signature written
--       before the payment leaves, then what became of it. The primary key is
--       the rule that a window is never paid twice; a claim that never got a
--       signature lapses and its window may be claimed again, a signature the
--       chain never saw is read again until its blockhash is past.
--     `private.autopay_events` — the log the drive's notifications read: started, paid, failed, missed, ended, stopped.
--     Row level security forced on all five, no policies, every grant revoked.
--   * The executor's queue is `private.autopays.next_at` and its index: only
--     the autopays whose moment has come, the earliest first.
--   * The server reads and writes only through the twelve `public.contacts_*`
--     and `public.autopay_*` functions below, each gated by the app secret
--     (`private.beta_check_secret`) and each one transaction, the same way the
--     stops' and the pools' are. None takes a table's name or a statement.
--
-- WHAT IT DOES NOT DO
--   No key, no signature, no transaction: the money moves only on chain, inside
--   the policy the person signed. The wallet's signature over a contact change
--   is checked by the server before it calls here; this file keeps the nonce.
--   No existing table, function or row is changed.
--
-- ROLLBACK: `supabase/prepared/20261121_city_307_contacts_autopay_v1_rollback.sql`.

begin;

-- ------------------------------------------------------------- contacts --

create table private.contacts (
  owner text not null check (owner ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  id uuid not null,
  name text not null check (char_length(name) between 1 and 40),
  target text not null check (target ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' or target ~ '^[a-z0-9_-]{1,63}\.skr$'),
  note text check (note is null or char_length(note) between 1 and 120),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (owner, id),
  unique (owner, target)
);

create table private.contact_nonces (
  owner text not null check (owner ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  nonce text not null check (nonce ~ '^[A-Za-z0-9]{16,64}$'),
  used_at timestamptz not null,
  primary key (owner, nonce)
);

create index contact_nonces_used_idx on private.contact_nonces (used_at);

alter table private.contacts enable row level security;
alter table private.contacts force row level security;
revoke all privileges on table private.contacts from public, anon, authenticated, service_role;

alter table private.contact_nonces enable row level security;
alter table private.contact_nonces force row level security;
revoke all privileges on table private.contact_nonces from public, anon, authenticated, service_role;

create function private.contact_json(c private.contacts)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', c.id,
    'name', c.name,
    'to', c.target,
    'note', c.note,
    'createdAt', to_char(c.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'updatedAt', to_char(c.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
$$;

revoke all on function private.contact_json(private.contacts) from public, anon, authenticated, service_role;

-- A wallet's contacts, the newest change first.
create function public.contacts_list(p_secret text, p_owner text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.beta_check_secret(p_secret);
  if p_owner is null or p_owner !~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;
  return jsonb_build_object(
    'ok', true,
    'contacts', coalesce((
      select jsonb_agg(private.contact_json(c) order by c.updated_at desc, c.id)
        from private.contacts c
       where c.owner = p_owner
    ), '[]'::jsonb)
  );
end;
$$;

-- One change the wallet signed (the server checked the signature): the nonce is
-- spent and the change made in the same transaction, so a signature works once.
create function public.contacts_change(
  p_secret text,
  p_owner text,
  p_action text,
  p_id text,
  p_name text,
  p_to text,
  p_note text,
  p_nonce text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_id uuid;
  v_row private.contacts;
begin
  perform private.beta_check_secret(p_secret);
  if p_owner is null or p_owner !~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'
     or p_nonce is null or p_nonce !~ '^[A-Za-z0-9]{16,64}$'
     or p_action is null or p_action not in ('add', 'edit', 'remove')
     or p_id is null or p_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;
  v_id := p_id::uuid;

  delete from private.contact_nonces n where n.owner = p_owner and n.used_at < v_now - interval '1 day';
  insert into private.contact_nonces (owner, nonce, used_at) values (p_owner, p_nonce, v_now)
  on conflict (owner, nonce) do nothing;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'replayed');
  end if;

  if p_action = 'remove' then
    delete from private.contacts c where c.owner = p_owner and c.id = v_id;
    if not found then
      return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
    return jsonb_build_object('ok', true, 'contact', null);
  end if;

  begin
    if p_action = 'add' then
      if (select count(*) from private.contacts c where c.owner = p_owner) >= 200 then
        return jsonb_build_object('ok', false, 'error', 'full');
      end if;
      insert into private.contacts (owner, id, name, target, note, created_at, updated_at)
      values (p_owner, v_id, p_name, p_to, p_note, v_now, v_now)
      returning * into v_row;
    else
      update private.contacts c
         set name = p_name, target = p_to, note = p_note, updated_at = v_now
       where c.owner = p_owner and c.id = v_id
      returning * into v_row;
      if not found then
        return jsonb_build_object('ok', false, 'error', 'not_found');
      end if;
    end if;
  exception
    when unique_violation then
      return jsonb_build_object('ok', false, 'error', 'taken');
    when check_violation then
      return jsonb_build_object('ok', false, 'error', 'bad_request');
  end;
  return jsonb_build_object('ok', true, 'contact', private.contact_json(v_row));
end;
$$;

-- -------------------------------------------------------------- autopay --

create table private.autopays (
  network text not null check (network in ('devnet', 'mainnet')),
  id uuid not null,
  owner text not null check (owner ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  policy text not null check (policy ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  -- The record as the server read it back from the chain: public addresses and numbers.
  record jsonb not null check (jsonb_typeof(record) = 'object'),
  count integer not null check (count between 1 and 400),
  -- The schedule's own numbers, read from the record: window k is [start_at + k·period, start_at + (k+1)·period).
  start_at timestamptz not null,
  period_seconds integer not null check (period_seconds in (86400, 604800, 2592000)),
  ends_at timestamptz not null,
  status text not null check (status in ('working', 'stopped', 'ended')),
  -- When the executor looks at this autopay next: the window that opens, a payment on its way, the end. Null — nothing
  -- is left to do (stopped or ended, nothing on its way). The executor's queue is this column and its index, never the
  -- table's age: an autopay that starts in a year waits in it and holds no one up.
  next_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (network, id),
  unique (network, policy),
  check (record ->> 'owner' = owner and record ->> 'policy' = policy and record ->> 'id' = id::text and record ->> 'network' = network),
  check (ends_at = start_at + (count::bigint * period_seconds) * interval '1 second')
);

create index autopays_owner_idx on private.autopays (network, owner, created_at desc);
create index autopays_due_idx on private.autopays (network, next_at) where next_at is not null;

-- One row per window. «sending» is a payment on its way: claimed by one executor's pass (`attempts` counts the claims,
-- and only the latest may sign — a fence for a pass that outlived its claim); its signature, once there, was written
-- before the transaction left. `check_at` — without a signature, when the claim lapses and the window may be claimed
-- again; with one, when the executor reads the chain for it again. `valid_height` — the last block height its blockhash
-- is good for: past it, a signature the chain never saw can never land.
create table private.autopay_payments (
  network text not null,
  autopay_id uuid not null,
  window_index integer not null check (window_index between 0 and 399),
  state text not null check (state in ('sending', 'paid', 'failed', 'missed')),
  signature text check (signature is null or signature ~ '^[1-9A-HJ-NP-Za-km-z]{64,100}$'),
  attempts integer not null default 0 check (attempts >= 0),
  valid_height bigint check (valid_height is null or valid_height > 0),
  check_at timestamptz,
  claimed_at timestamptz not null,
  settled_at timestamptz,
  primary key (network, autopay_id, window_index),
  foreign key (network, autopay_id) references private.autopays (network, id) on delete cascade,
  check ((state = 'sending') = (check_at is not null)),
  check (signature is null or valid_height is not null or state <> 'sending')
);

create table private.autopay_events (
  id bigint generated always as identity primary key,
  network text not null check (network in ('devnet', 'mainnet')),
  autopay_id uuid not null,
  kind text not null check (kind in ('started', 'paid', 'failed', 'missed', 'ended', 'stopped')),
  window_index integer,
  signature text,
  at timestamptz not null,
  foreign key (network, autopay_id) references private.autopays (network, id) on delete cascade
);

create index autopay_events_network_idx on private.autopay_events (network, id);

alter table private.autopays enable row level security;
alter table private.autopays force row level security;
revoke all privileges on table private.autopays from public, anon, authenticated, service_role;

alter table private.autopay_payments enable row level security;
alter table private.autopay_payments force row level security;
revoke all privileges on table private.autopay_payments from public, anon, authenticated, service_role;

alter table private.autopay_events enable row level security;
alter table private.autopay_events force row level security;
revoke all privileges on table private.autopay_events from public, anon, authenticated, service_role;

-- An autopay as the server reads it: the record, its state and each window's payment.
create function private.autopay_json(a private.autopays)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select a.record || jsonb_build_object(
    'status', a.status,
    'updatedAt', to_char(a.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'window', p.window_index,
        'state', p.state,
        'signature', p.signature,
        'at', to_char(coalesce(p.settled_at, p.claimed_at) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'attempts', p.attempts,
        'checkAt', case when p.check_at is null then null else to_char(p.check_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
        'validHeight', p.valid_height
      ) order by p.window_index)
        from private.autopay_payments p
       where p.network = a.network and p.autopay_id = a.id
    ), '[]'::jsonb)
  );
$$;

revoke all on function private.autopay_json(private.autopays) from public, anon, authenticated, service_role;

-- When the executor looks at an autopay next, from its own numbers: the earliest of a payment on its way (its
-- `check_at`), the window open now if it has no row yet (else the next one), and the end. Called by every function that
-- changes an autopay or its payments, in the same transaction.
create function private.autopay_refresh(p_network text, p_id uuid, p_now timestamptz)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_a private.autopays;
  v_k bigint;
  v_open timestamptz;
  v_pending timestamptz;
begin
  select * into v_a from private.autopays a where a.network = p_network and a.id = p_id;
  if not found then
    return;
  end if;
  select min(p.check_at) into v_pending
    from private.autopay_payments p
   where p.network = p_network and p.autopay_id = p_id and p.state = 'sending';
  if v_a.status <> 'working' then
    v_open := null;
  elsif p_now < v_a.start_at then
    v_open := v_a.start_at;
  else
    v_k := floor(extract(epoch from (p_now - v_a.start_at)) / v_a.period_seconds)::bigint;
    if v_k >= v_a.count then
      v_open := v_a.ends_at;
    elsif exists (select 1 from private.autopay_payments p where p.network = p_network and p.autopay_id = p_id and p.window_index = v_k) then
      v_open := least(v_a.start_at + ((v_k + 1) * v_a.period_seconds) * interval '1 second', v_a.ends_at);
    else
      v_open := v_a.start_at + (v_k * v_a.period_seconds) * interval '1 second';
    end if;
  end if;
  -- `least` passes over a null: null only when both are.
  update private.autopays a set next_at = least(v_open, v_pending) where a.network = p_network and a.id = p_id;
end;
$$;

revoke all on function private.autopay_refresh(text, uuid, timestamptz) from public, anon, authenticated, service_role;

-- A new autopay, once its policy is on chain; the same id or policy twice is the same autopay.
create function public.autopay_put(p_secret text, p_network text, p_record jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_id uuid;
  v_period integer;
  v_start timestamptz;
begin
  perform private.beta_check_secret(p_secret);
  if p_network is null or p_network not in ('devnet', 'mainnet') or p_record is null or jsonb_typeof(p_record) <> 'object'
     or p_record ->> 'network' is distinct from p_network
     or coalesce(p_record ->> 'id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or jsonb_typeof(p_record -> 'count') <> 'number'
     or coalesce(p_record ->> 'startAt', '') !~ '^[0-9]{1,12}$'
     or coalesce(p_record ->> 'endsAt', '') !~ '^[0-9]{1,12}$'
     or coalesce(p_record ->> 'every', '') not in ('day', 'week', 'month') then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;
  v_id := (p_record ->> 'id')::uuid;
  v_period := case p_record ->> 'every' when 'day' then 86400 when 'week' then 604800 else 2592000 end;
  v_start := to_timestamp((p_record ->> 'startAt')::bigint);
  begin
    insert into private.autopays (network, id, owner, policy, record, count, start_at, period_seconds, ends_at, status, next_at, created_at, updated_at)
    values (
      p_network, v_id, p_record ->> 'owner', p_record ->> 'policy', p_record - 'payments' - 'status' - 'updatedAt', (p_record ->> 'count')::integer,
      v_start, v_period, to_timestamp((p_record ->> 'endsAt')::bigint), 'working', v_start, v_now, v_now
    )
    on conflict do nothing;
  exception
    when check_violation or numeric_value_out_of_range or invalid_text_representation then
      return jsonb_build_object('ok', false, 'error', 'bad_request');
  end;
  if not found then
    return jsonb_build_object('ok', true, 'exists', true);
  end if;
  insert into private.autopay_events (network, autopay_id, kind, window_index, signature, at) values (p_network, v_id, 'started', null, null, v_now);
  return jsonb_build_object('ok', true, 'exists', false);
end;
$$;

-- A wallet's autopays, the newest first.
create function public.autopay_list(p_secret text, p_network text, p_owner text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.beta_check_secret(p_secret);
  if p_network is null or p_network not in ('devnet', 'mainnet') or p_owner is null or p_owner !~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;
  return jsonb_build_object(
    'ok', true,
    'autopays', coalesce((
      select jsonb_agg(private.autopay_json(a) order by a.created_at desc)
        from (select * from private.autopays x where x.network = p_network and x.owner = p_owner order by x.created_at desc limit 100) a
    ), '[]'::jsonb)
  );
end;
$$;

-- One autopay of a wallet.
create function public.autopay_one(p_secret text, p_network text, p_owner text, p_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row private.autopays;
begin
  perform private.beta_check_secret(p_secret);
  if p_network is null or p_network not in ('devnet', 'mainnet') or p_owner is null
     or p_id is null or p_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;
  select * into v_row from private.autopays a where a.network = p_network and a.id = p_id::uuid and a.owner = p_owner;
  if not found then
    return jsonb_build_object('ok', true, 'autopay', null);
  end if;
  return jsonb_build_object('ok', true, 'autopay', private.autopay_json(v_row));
end;
$$;

-- The executor's batch: the autopays whose moment has come (`next_at` passed), the earliest first, at most `p_limit`.
-- Each one taken is held for `p_hold` seconds (its `next_at` moved on), so an overlapping pass takes others; whatever the
-- pass then does sets `next_at` again from the autopay's own numbers, and an autopay the pass never reached comes back
-- when the hold ends.
create function public.autopay_due(p_secret text, p_network text, p_limit integer, p_hold integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 200));
  v_hold integer := greatest(30, least(coalesce(p_hold, 90), 600));
  v_list jsonb;
begin
  perform private.beta_check_secret(p_secret);
  if p_network is null or p_network not in ('devnet', 'mainnet') then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;
  with picked as (
    select x.network, x.id, x.next_at
      from private.autopays x
     where x.network = p_network and x.next_at is not null and x.next_at <= v_now
     order by x.next_at, x.id
     limit v_limit
       for update skip locked
  ), held as (
    update private.autopays a
       set next_at = v_now + v_hold * interval '1 second'
      from picked p
     where a.network = p.network and a.id = p.id
    returning a.id, p.next_at as due_at
  )
  select coalesce(jsonb_agg(private.autopay_json(x) order by h.due_at, x.id), '[]'::jsonb)
    into v_list
    from held h
    join private.autopays x on x.network = p_network and x.id = h.id;
  return jsonb_build_object('ok', true, 'autopays', v_list);
end;
$$;

-- The executor claims a window's payment before it builds it: a window with no row, or one whose unsigned claim has
-- lapsed (nothing was ever sent for it), and only the window open now. The answer names the attempt: only that attempt
-- may write its signature (`autopay_sign`).
create function public.autopay_claim(p_secret text, p_network text, p_id text, p_window integer, p_hold integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_hold integer := greatest(30, least(coalesce(p_hold, 120), 600));
  v_a private.autopays;
  v_open timestamptz;
  v_attempt integer;
begin
  perform private.beta_check_secret(p_secret);
  if p_network is null or p_network not in ('devnet', 'mainnet')
     or p_id is null or p_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or p_window is null or p_window < 0 then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;
  select * into v_a from private.autopays a where a.network = p_network and a.id = p_id::uuid and a.status = 'working' for update;
  if not found or p_window >= v_a.count then
    return jsonb_build_object('ok', true, 'claimed', false);
  end if;
  -- The chain's clock and the database's differ by a little; a window ahead or one closed is never claimed.
  v_open := v_a.start_at + (p_window::bigint * v_a.period_seconds) * interval '1 second';
  if v_open > v_now + interval '5 minutes' or v_open + v_a.period_seconds * interval '1 second' <= v_now - interval '5 minutes' then
    return jsonb_build_object('ok', true, 'claimed', false);
  end if;
  insert into private.autopay_payments as p (network, autopay_id, window_index, state, signature, attempts, valid_height, check_at, claimed_at)
  values (p_network, p_id::uuid, p_window, 'sending', null, 1, null, v_now + v_hold * interval '1 second', v_now)
  on conflict (network, autopay_id, window_index) do update
     set attempts = p.attempts + 1, claimed_at = v_now, check_at = excluded.check_at, valid_height = null
   where p.state = 'sending' and p.signature is null and p.check_at <= v_now
  returning p.attempts into v_attempt;
  if v_attempt is null then
    return jsonb_build_object('ok', true, 'claimed', false);
  end if;
  perform private.autopay_refresh(p_network, p_id::uuid, v_now);
  return jsonb_build_object('ok', true, 'claimed', true, 'attempt', v_attempt);
end;
$$;

-- The signature of a claimed window's payment, written before the transaction leaves: only by the claim's latest
-- attempt, only while the autopay works. Not written — not sent.
create function public.autopay_sign(p_secret text, p_network text, p_id text, p_window integer, p_attempt integer, p_signature text, p_valid_height bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_signed boolean;
begin
  perform private.beta_check_secret(p_secret);
  if p_network is null or p_network not in ('devnet', 'mainnet')
     or p_id is null or p_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or p_window is null or p_window < 0 or p_attempt is null or p_attempt < 1
     or p_signature is null or p_signature !~ '^[1-9A-HJ-NP-Za-km-z]{64,100}$' or p_valid_height is null or p_valid_height <= 0 then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;
  perform 1 from private.autopays a where a.network = p_network and a.id = p_id::uuid and a.status = 'working' for share;
  if not found then
    return jsonb_build_object('ok', true, 'signed', false);
  end if;
  update private.autopay_payments p
     set signature = p_signature, valid_height = p_valid_height, check_at = v_now + interval '20 seconds'
   where p.network = p_network and p.autopay_id = p_id::uuid and p.window_index = p_window
     and p.state = 'sending' and p.signature is null and p.attempts = p_attempt;
  v_signed := found;
  if v_signed then
    perform private.autopay_refresh(p_network, p_id::uuid, v_now);
  end if;
  return jsonb_build_object('ok', true, 'signed', v_signed);
end;
$$;

-- A payment on its way that did not happen gives its window back: an unsigned claim after a passing failure (named by
-- its attempt), or a signed one the chain never saw once its blockhash is past (named by its signature). While the
-- window is open and the autopay works, it may be claimed again after `p_retry` seconds; otherwise it is missed.
create function public.autopay_release(p_secret text, p_network text, p_id text, p_window integer, p_attempt integer, p_signature text, p_retry integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_retry integer := greatest(5, least(coalesce(p_retry, 30), 3600));
  v_a private.autopays;
  v_close timestamptz;
begin
  perform private.beta_check_secret(p_secret);
  if p_network is null or p_network not in ('devnet', 'mainnet')
     or p_id is null or p_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or p_window is null or p_window < 0
     or (p_signature is null and p_attempt is null) or (p_signature is not null and p_signature !~ '^[1-9A-HJ-NP-Za-km-z]{64,100}$') then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;
  select * into v_a from private.autopays a where a.network = p_network and a.id = p_id::uuid for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  perform 1 from private.autopay_payments p
   where p.network = p_network and p.autopay_id = p_id::uuid and p.window_index = p_window and p.state = 'sending'
     and (case when p_signature is null then p.signature is null and p.attempts = p_attempt else p.signature = p_signature end)
     for update;
  if not found then
    return jsonb_build_object('ok', true, 'released', false);
  end if;
  v_close := v_a.start_at + ((p_window::bigint + 1) * v_a.period_seconds) * interval '1 second';
  if v_close <= v_now or v_a.status <> 'working' then
    update private.autopay_payments p
       set state = 'missed', signature = null, valid_height = null, check_at = null, settled_at = v_now
     where p.network = p_network and p.autopay_id = p_id::uuid and p.window_index = p_window;
    insert into private.autopay_events (network, autopay_id, kind, window_index, signature, at) values (p_network, p_id::uuid, 'missed', p_window, null, v_now);
    perform private.autopay_refresh(p_network, p_id::uuid, v_now);
    return jsonb_build_object('ok', true, 'released', true, 'state', 'missed');
  end if;
  update private.autopay_payments p
     set signature = null, valid_height = null, check_at = v_now + v_retry * interval '1 second'
   where p.network = p_network and p.autopay_id = p_id::uuid and p.window_index = p_window;
  perform private.autopay_refresh(p_network, p_id::uuid, v_now);
  return jsonb_build_object('ok', true, 'released', true, 'state', 'sending');
end;
$$;

-- What became of a window's payment. Paid or failed — a payment on its way, named by its signature (or, unsigned, by its
-- attempt: the executor's own refusal). Missed — a closed window with no row, or with an unsigned claim that lapsed.
-- Each change is an event for the drive.
create function public.autopay_settle(p_secret text, p_network text, p_id text, p_window integer, p_state text, p_signature text, p_attempt integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_a private.autopays;
  v_changed boolean;
begin
  perform private.beta_check_secret(p_secret);
  if p_network is null or p_network not in ('devnet', 'mainnet')
     or p_id is null or p_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or p_window is null or p_window < 0 or p_state is null or p_state not in ('paid', 'failed', 'missed')
     or (p_signature is not null and p_signature !~ '^[1-9A-HJ-NP-Za-km-z]{64,100}$')
     or (p_state = 'paid' and p_signature is null)
     or (p_state = 'failed' and p_signature is null and p_attempt is null) then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;
  select * into v_a from private.autopays a where a.network = p_network and a.id = p_id::uuid for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if p_state = 'missed' then
    if p_window >= v_a.count or v_a.start_at + ((p_window::bigint + 1) * v_a.period_seconds) * interval '1 second' > v_now + interval '5 minutes' then
      return jsonb_build_object('ok', true, 'changed', false);
    end if;
    insert into private.autopay_payments as p (network, autopay_id, window_index, state, signature, attempts, valid_height, check_at, claimed_at, settled_at)
    values (p_network, p_id::uuid, p_window, 'missed', null, 0, null, null, v_now, v_now)
    on conflict (network, autopay_id, window_index) do update
       set state = 'missed', check_at = null, settled_at = v_now
     where p.state = 'sending' and p.signature is null and p.check_at <= v_now;
    v_changed := found;
  else
    update private.autopay_payments p
       set state = p_state, signature = coalesce(p_signature, p.signature), check_at = null, settled_at = v_now
     where p.network = p_network and p.autopay_id = p_id::uuid and p.window_index = p_window and p.state = 'sending'
       and ((p_signature is not null and p.signature = p_signature) or (p_signature is null and p.signature is null and p.attempts = p_attempt));
    v_changed := found;
  end if;
  if v_changed then
    insert into private.autopay_events (network, autopay_id, kind, window_index, signature, at)
    values (p_network, p_id::uuid, p_state, p_window, p_signature, v_now);
    perform private.autopay_refresh(p_network, p_id::uuid, v_now);
  end if;
  return jsonb_build_object('ok', true, 'changed', v_changed);
end;
$$;

-- A working autopay stopped by its owner (p_owner names them) or ended by its schedule. An end comes only once the last
-- window has closed and no signed payment is still on its way; an unsigned claim dies with the autopay (nothing was sent
-- for it, and `autopay_sign` refuses it from now on) — at the end it is a missed window, at «Stop» it simply goes.
create function public.autopay_status(p_secret text, p_network text, p_id text, p_status text, p_owner text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_a private.autopays;
begin
  perform private.beta_check_secret(p_secret);
  if p_network is null or p_network not in ('devnet', 'mainnet')
     or p_id is null or p_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or p_status is null or p_status not in ('stopped', 'ended') then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;
  select * into v_a from private.autopays a
   where a.network = p_network and a.id = p_id::uuid and a.status = 'working' and (p_owner is null or a.owner = p_owner)
     for update;
  if not found then
    return jsonb_build_object('ok', true, 'changed', false);
  end if;
  if p_status = 'ended' then
    if v_now < v_a.ends_at - interval '5 minutes'
       or exists (select 1 from private.autopay_payments p where p.network = p_network and p.autopay_id = v_a.id and p.state = 'sending' and p.signature is not null) then
      return jsonb_build_object('ok', true, 'changed', false);
    end if;
    with gone as (
      update private.autopay_payments p
         set state = 'missed', check_at = null, settled_at = v_now
       where p.network = p_network and p.autopay_id = v_a.id and p.state = 'sending' and p.signature is null
      returning p.window_index
    )
    insert into private.autopay_events (network, autopay_id, kind, window_index, signature, at)
    select p_network, v_a.id, 'missed', g.window_index, null, v_now from gone g;
  else
    delete from private.autopay_payments p where p.network = p_network and p.autopay_id = v_a.id and p.state = 'sending' and p.signature is null;
  end if;
  update private.autopays a set status = p_status, updated_at = v_now where a.network = p_network and a.id = v_a.id;
  insert into private.autopay_events (network, autopay_id, kind, window_index, signature, at) values (p_network, v_a.id, p_status, null, null, v_now);
  perform private.autopay_refresh(p_network, v_a.id, v_now);
  return jsonb_build_object('ok', true, 'changed', true);
end;
$$;

-- The event log after an id, the oldest first, with what the drive says: who, to whom, how much.
create function public.autopay_events(p_secret text, p_network text, p_after bigint, p_limit integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 100), 500));
begin
  perform private.beta_check_secret(p_secret);
  if p_network is null or p_network not in ('devnet', 'mainnet') then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;
  return jsonb_build_object(
    'ok', true,
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id,
        'network', e.network,
        'kind', e.kind,
        'autopayId', e.autopay_id,
        'owner', a.owner,
        'recipient', a.record ->> 'recipient',
        'label', a.record ->> 'label',
        'coin', a.record ->> 'coin',
        'amount', a.record ->> 'amount',
        'window', e.window_index,
        'signature', e.signature,
        'at', to_char(e.at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      ) order by e.id)
        from (select * from private.autopay_events x where x.network = p_network and x.id > coalesce(p_after, 0) order by x.id limit v_limit) e
        join private.autopays a on a.network = e.network and a.id = e.autopay_id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.contacts_list(text, text) from public, anon, authenticated, service_role;
revoke all on function public.contacts_change(text, text, text, text, text, text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.autopay_put(text, text, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.autopay_list(text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.autopay_one(text, text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.autopay_due(text, text, integer, integer) from public, anon, authenticated, service_role;
revoke all on function public.autopay_claim(text, text, text, integer, integer) from public, anon, authenticated, service_role;
revoke all on function public.autopay_sign(text, text, text, integer, integer, text, bigint) from public, anon, authenticated, service_role;
revoke all on function public.autopay_release(text, text, text, integer, integer, text, integer) from public, anon, authenticated, service_role;
revoke all on function public.autopay_settle(text, text, text, integer, text, text, integer) from public, anon, authenticated, service_role;
revoke all on function public.autopay_status(text, text, text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.autopay_events(text, text, bigint, integer) from public, anon, authenticated, service_role;

grant execute on function public.contacts_list(text, text) to anon;
grant execute on function public.contacts_change(text, text, text, text, text, text, text, text) to anon;
grant execute on function public.autopay_put(text, text, jsonb) to anon;
grant execute on function public.autopay_list(text, text, text) to anon;
grant execute on function public.autopay_one(text, text, text, text) to anon;
grant execute on function public.autopay_due(text, text, integer, integer) to anon;
grant execute on function public.autopay_claim(text, text, text, integer, integer) to anon;
grant execute on function public.autopay_sign(text, text, text, integer, integer, text, bigint) to anon;
grant execute on function public.autopay_release(text, text, text, integer, integer, text, integer) to anon;
grant execute on function public.autopay_settle(text, text, text, integer, text, text, integer) to anon;
grant execute on function public.autopay_status(text, text, text, text, text) to anon;
grant execute on function public.autopay_events(text, text, bigint, integer) to anon;

commit;
