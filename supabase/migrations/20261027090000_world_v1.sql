-- Ryntra City: the living world on the server.
--
-- PREPARED 2026-10-27 as a file only. Not applied to any Supabase project:
-- Checked on a throwaway local PostgreSQL 16 with the Supabase roles and a
-- hostile default-grant posture (see `lib/world/sql.test.mjs`).
--
-- WHAT THIS FILE DOES
--   * Residents, quarters, buildings, the points ledger, the day's tasks,
--     visits, crews, world events and frozen worlds, each in a `world_` table.
--   * Quarters and buildings are readable by anyone (RLS select policy for
--     `anon` and `authenticated`); nobody but the server writes them.
--   * Everything else lives in `private` with row level security forced, no
--     policies and every grant revoked.
--   * The server writes only through the `public.world_*` functions below,
--     each gated by the app secret (`private.beta_check_secret`), the same
--     way every other server function of Ryntra is.
--   * Two small tables serve the routes: `world_requests` keeps the answer of
--     each `Idempotency-Key`, `world_limits` counts requests per window.
--
-- WHAT IT DOES NOT DO
--   No money: a building keeps only a reference to an object of the engine or
--   the chain. Points come only from the reasons in the list; there is no
--   reason for trading volume or for the number of launches.

begin;

-- ------------------------------------------------------------ residents --

create table private.world_residents (
  id uuid primary key,
  account_id uuid unique references public.beta_users(id) on delete cascade,
  guest_salt text check (guest_salt is null or guest_salt ~ '^[0-9a-f]{32}$'),
  display_name text check (display_name is null or char_length(display_name) between 1 and 32),
  home_quarter_id uuid not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  check (account_id is not null or guest_salt is not null)
);

-- -------------------------------------------------------------- quarters --

create table public.world_quarters (
  id uuid primary key,
  owner_id uuid not null references private.world_residents(id) on delete cascade,
  district text not null check (district in ('docks', 'downtown', 'harbor', 'heights', 'arrivals')),
  street text not null check (street ~ '^[a-z0-9-]{1,40}$'),
  cell_x integer not null check (cell_x between -100000 and 100000),
  cell_z integer not null check (cell_z between -100000 and 100000),
  level smallint not null default 1 check (level between 1 and 10),
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (district, street, cell_x, cell_z)
);

create index world_quarters_owner_idx on public.world_quarters (owner_id);
create index world_quarters_district_idx on public.world_quarters (district, id);

alter table private.world_residents
  add constraint world_residents_home_fk foreign key (home_quarter_id)
  references public.world_quarters(id) deferrable initially deferred;

create sequence private.world_arrivals_seq as bigint minvalue 0 start with 0;

-- ------------------------------------------------------------- buildings --

create table public.world_buildings (
  id uuid primary key default gen_random_uuid(),
  quarter_id uuid not null references public.world_quarters(id) on delete cascade,
  slot smallint not null check (slot between 0 and 63),
  kind text not null check (kind in (
    'home', 'coin_tower', 'harbor', 'workshop', 'crew_hq',
    'garage', 'oracle', 'showcase', 'billboard', 'decor'
  )),
  level smallint not null default 1 check (level between 1 and 5),
  modules text[] not null check (
    cardinality(modules) between 1 and 12
    and array_to_string(modules, ',') ~ '^[a-z]+\.[a-z0-9_]+(,[a-z]+\.[a-z0-9_]+)*$'
  ),
  -- The public form of the link. A prediction book is kept without the
  -- owner's account id: anyone may read this table.
  link jsonb check (link is null or (
    jsonb_typeof(link) = 'object'
    and link->>'kind' in ('mint', 'lp_position', 'strategy', 'team', 'agent', 'prediction_book')
    and not (link ? 'accountId')
    and pg_column_size(link) <= 512
  )),
  link_key text generated always as (
    case
      when link is null or link->>'kind' = 'prediction_book' then null
      else (link->>'kind') || ':' || coalesce(link->>'mint', link->>'position', link->>'strategyId', link->>'teamId', link->>'agentId')
    end
  ) stored,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (quarter_id, slot)
);

-- One building in the whole city shows one engine object.
create unique index world_buildings_link_idx on public.world_buildings (link_key) where link_key is not null;

-- ----------------------------------------------------------- points ledger --

create table private.world_points (
  id bigint generated always as identity primary key,
  resident_id uuid not null references private.world_residents(id) on delete cascade,
  delta integer not null check (delta between 1 and 10000),
  reason text not null check (reason in (
    'task_done', 'survival_7', 'survival_30', 'survival_90', 'holders_kept',
    'lp_in_range_days', 'visitors_verified', 'coop_contribution', 'war_participation'
  )),
  source_ref text not null check (char_length(source_ref) between 1 and 200),
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 200),
  at timestamptz not null,
  unique (resident_id, idempotency_key)
);

create index world_points_recent_idx on private.world_points (resident_id, at desc);

-- -------------------------------------------------------- the day's tasks --

create table private.world_daily_tasks (
  resident_id uuid not null references private.world_residents(id) on delete cascade,
  day date not null,
  kind text not null check (kind in ('add_floor', 'light_street', 'run', 'visit_quarters', 'coop_build')),
  progress integer not null default 0 check (progress >= 0),
  goal integer not null check (goal between 1 and 100),
  done_at timestamptz,
  primary key (resident_id, day, kind),
  check (progress <= goal)
);

-- ---------------------------------------------------------------- visits --

create table private.world_visits (
  visitor_id uuid not null references private.world_residents(id) on delete cascade,
  quarter_id uuid not null references public.world_quarters(id) on delete cascade,
  day date not null,
  verified_human boolean not null default false,
  at timestamptz not null,
  primary key (visitor_id, quarter_id, day)
);

create index world_visits_quarter_idx on private.world_visits (quarter_id, day);

-- ----------------------------------------------------------------- crews --

create table private.world_crews (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 40),
  street text not null unique check (street ~ '^[a-z0-9-]{1,40}$'),
  hq_building_id uuid references public.world_buildings(id) on delete set null,
  team_id text check (team_id is null or team_id ~ '^[0-9a-f]{24}$'),
  created_at timestamptz not null default clock_timestamp()
);

-- ---------------------------------------------------------------- events --

create table private.world_events (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null,
  source text not null check (source in ('market', 'engine', 'world')),
  kind text not null check (kind in ('pump', 'flare', 'launch', 'graduate', 'survival', 'claim', 'build', 'visit', 'war')),
  subject text not null check (char_length(subject) between 1 and 64),
  source_at timestamptz,
  district text check (district is null or district in ('docks', 'downtown', 'harbor', 'heights', 'arrivals')),
  actor_id uuid references private.world_residents(id) on delete set null,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 4096)
);

create index world_events_subject_idx on private.world_events (subject, source_at desc);
create index world_events_district_idx on private.world_events (district, source_at desc);
create index world_events_time_idx on private.world_events (source_at desc);
create index world_events_actor_idx on private.world_events (actor_id);

-- -------------------------------------------------------- frozen worlds --

create table private.world_versions (
  id uuid primary key default gen_random_uuid(),
  day date not null,
  seed text not null check (seed ~ '^[A-Za-z0-9_-]{1,64}$'),
  towers jsonb not null check (jsonb_typeof(towers) = 'array' and pg_column_size(towers) <= 1048576),
  created_at timestamptz not null,
  unique (day, seed)
);

-- ------------------------------------------------- idempotency and limits --

create table private.world_requests (
  scope text not null check (char_length(scope) between 1 and 100),
  route text not null check (route ~ '^[a-z]{1,20}$'),
  key text not null check (key ~ '^[A-Za-z0-9_:.-]{8,128}$'),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  status smallint check (status is null or status between 200 and 599),
  body jsonb check (body is null or pg_column_size(body) <= 65536),
  created_at timestamptz not null,
  completed_at timestamptz,
  primary key (scope, route, key)
);

create index world_requests_created_idx on private.world_requests (created_at);

create table private.world_limits (
  bucket text not null check (char_length(bucket) between 1 and 160),
  window_start timestamptz not null,
  hits integer not null check (hits >= 0),
  primary key (bucket, window_start)
);

create index world_limits_window_idx on private.world_limits (window_start);

-- ------------------------------------------------------------ the locks --

alter table private.world_residents enable row level security;
alter table private.world_residents force row level security;
alter table public.world_quarters enable row level security;
alter table public.world_quarters force row level security;
alter table public.world_buildings enable row level security;
alter table public.world_buildings force row level security;
alter table private.world_points enable row level security;
alter table private.world_points force row level security;
alter table private.world_daily_tasks enable row level security;
alter table private.world_daily_tasks force row level security;
alter table private.world_visits enable row level security;
alter table private.world_visits force row level security;
alter table private.world_crews enable row level security;
alter table private.world_crews force row level security;
alter table private.world_events enable row level security;
alter table private.world_events force row level security;
alter table private.world_versions enable row level security;
alter table private.world_versions force row level security;
alter table private.world_requests enable row level security;
alter table private.world_requests force row level security;
alter table private.world_limits enable row level security;
alter table private.world_limits force row level security;

revoke all privileges on table
  private.world_residents, public.world_quarters, public.world_buildings, private.world_points,
  private.world_daily_tasks, private.world_visits, private.world_crews, private.world_events,
  private.world_versions, private.world_requests, private.world_limits
  from public, anon, authenticated, service_role;
revoke all privileges on sequence private.world_arrivals_seq from public, anon, authenticated, service_role;

-- Quarters and buildings: anyone reads, nobody but the server writes.
grant select on table public.world_quarters, public.world_buildings to anon, authenticated;

create policy world_quarters_read on public.world_quarters
  for select to anon, authenticated using (true);
create policy world_buildings_read on public.world_buildings
  for select to anon, authenticated using (true);

-- --------------------------------------------------------------- helpers --

create function private.world_iso(p_at timestamptz)
returns text
language sql
stable
set search_path = ''
as $$
  select to_char(p_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
$$;

create function private.world_quarter_json(q public.world_quarters)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', q.id, 'ownerId', q.owner_id, 'district', q.district, 'street', q.street,
    'cell', jsonb_build_object('x', q.cell_x, 'z', q.cell_z),
    'level', q.level, 'version', q.version, 'updatedAt', private.world_iso(q.updated_at)
  );
$$;

create function private.world_building_json(b public.world_buildings)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', b.id, 'quarterId', b.quarter_id, 'slot', b.slot, 'kind', b.kind, 'level', b.level,
    'modules', to_jsonb(b.modules), 'link', b.link, 'updatedAt', private.world_iso(b.updated_at)
  );
$$;

create function private.world_resident_json(r private.world_residents)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', r.id, 'accountId', r.account_id, 'displayName', r.display_name,
    'homeQuarterId', r.home_quarter_id, 'createdAt', private.world_iso(r.created_at)
  );
$$;

create function private.world_buildings_json(p_quarter_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(private.world_building_json(b) order by b.slot), '[]'::jsonb)
    from public.world_buildings b where b.quarter_id = p_quarter_id;
$$;

create function private.world_tasks_json(p_resident_id uuid, p_day date)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'residentId', t.resident_id, 'day', t.day, 'kind', t.kind, 'progress', t.progress,
    'goal', t.goal, 'doneAt', case when t.done_at is null then null else private.world_iso(t.done_at) end
  ) order by t.kind), '[]'::jsonb)
    from private.world_daily_tasks t where t.resident_id = p_resident_id and t.day = p_day;
$$;

create function private.world_points_total(p_resident_id uuid)
returns integer
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(p.delta), 0)::integer from private.world_points p where p.resident_id = p_resident_id;
$$;

-- The quarter level a total reaches: how many thresholds it passed.
create function private.world_level_of(p_total integer, p_levels jsonb)
returns integer
language sql
immutable
set search_path = ''
as $$
  select greatest(1, least(10, (select count(*)::integer from jsonb_array_elements_text(p_levels) t where t::integer <= p_total)));
$$;

-- Levels follow points and only go up.
create function private.world_relevel(p_resident_id uuid, p_levels jsonb, p_now timestamptz)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_level integer := private.world_level_of(private.world_points_total(p_resident_id), p_levels);
begin
  update public.world_quarters
     set level = v_level, updated_at = p_now
   where owner_id = p_resident_id and level < v_level;
end;
$$;

-- One award per key per resident; returns whether it was new.
create function private.world_award(
  p_resident_id uuid, p_reason text, p_delta integer, p_source_ref text, p_key text,
  p_levels jsonb, p_now timestamptz
)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_rows integer;
begin
  insert into private.world_points (resident_id, delta, reason, source_ref, idempotency_key, at)
  values (p_resident_id, p_delta, p_reason, p_source_ref, p_key, p_now)
  on conflict (resident_id, idempotency_key) do nothing;
  get diagnostics v_rows = row_count;
  if v_rows > 0 then
    perform private.world_relevel(p_resident_id, p_levels, p_now);
  end if;
  return v_rows > 0;
end;
$$;

-- Move a task of the day forward; the step that reaches the goal pays once.
create function private.world_progress(
  p_resident_id uuid, p_day date, p_kind text, p_delta integer, p_goal integer,
  p_points integer, p_levels jsonb, p_now timestamptz
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  t private.world_daily_tasks%rowtype;
begin
  if p_delta is null or p_delta <= 0 then
    return;
  end if;
  insert into private.world_daily_tasks as d (resident_id, day, kind, progress, goal)
  values (p_resident_id, p_day, p_kind, least(p_delta, p_goal), p_goal)
  on conflict (resident_id, day, kind)
  do update set progress = least(d.goal, d.progress + p_delta)
  returning * into t;
  if t.progress >= t.goal and t.done_at is null then
    update private.world_daily_tasks set done_at = p_now
     where resident_id = p_resident_id and day = p_day and kind = p_kind;
    perform private.world_award(p_resident_id, 'task_done', p_points, p_kind,
      'task_done:' || to_char(p_day, 'YYYY-MM-DD') || ':' || p_kind, p_levels, p_now);
  end if;
end;
$$;

create function private.world_event(
  p_source text, p_kind text, p_subject text, p_source_at timestamptz, p_district text,
  p_actor_id uuid, p_payload jsonb, p_now timestamptz
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  e private.world_events%rowtype;
begin
  insert into private.world_events (at, source, kind, subject, source_at, district, actor_id, payload)
  values (p_now, p_source, p_kind, p_subject, p_source_at, p_district, p_actor_id, coalesce(p_payload, '{}'::jsonb))
  returning * into e;
  return jsonb_build_object(
    'id', e.id, 'at', private.world_iso(e.at), 'source', e.source, 'kind', e.kind, 'subject', e.subject,
    'sourceAt', case when e.source_at is null then null else private.world_iso(e.source_at) end, 'payload', e.payload
  );
end;
$$;

revoke all on function private.world_iso(timestamptz) from public, anon, authenticated, service_role;
revoke all on function private.world_quarter_json(public.world_quarters) from public, anon, authenticated, service_role;
revoke all on function private.world_building_json(public.world_buildings) from public, anon, authenticated, service_role;
revoke all on function private.world_resident_json(private.world_residents) from public, anon, authenticated, service_role;
revoke all on function private.world_buildings_json(uuid) from public, anon, authenticated, service_role;
revoke all on function private.world_tasks_json(uuid, date) from public, anon, authenticated, service_role;
revoke all on function private.world_points_total(uuid) from public, anon, authenticated, service_role;
revoke all on function private.world_level_of(integer, jsonb) from public, anon, authenticated, service_role;
revoke all on function private.world_relevel(uuid, jsonb, timestamptz) from public, anon, authenticated, service_role;
revoke all on function private.world_award(uuid, text, integer, text, text, jsonb, timestamptz) from public, anon, authenticated, service_role;
revoke all on function private.world_progress(uuid, date, text, integer, integer, integer, jsonb, timestamptz) from public, anon, authenticated, service_role;
revoke all on function private.world_event(text, text, text, timestamptz, text, uuid, jsonb, timestamptz) from public, anon, authenticated, service_role;

-- ------------------------------------------------------- the server's API --

-- A resident by id or by account, with the guest salt the server needs to
-- check a guest key. Never sent to a browser.
create function public.world_resident(p_secret text, p_id uuid default null, p_account_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r private.world_residents%rowtype;
begin
  perform private.beta_check_secret(p_secret);
  if p_id is not null then
    select * into r from private.world_residents where id = p_id;
  elsif p_account_id is not null then
    select * into r from private.world_residents where account_id = p_account_id;
  end if;
  if r.id is null then
    return jsonb_build_object('ok', true, 'resident', null);
  end if;
  return jsonb_build_object('ok', true, 'resident', private.world_resident_json(r) || jsonb_build_object('guestSalt', r.guest_salt));
end;
$$;

-- A place on the newcomers' street. An account that already has a resident
-- gets it back; a guest is made with its salt; the account must exist.
create function public.world_claim(
  p_secret text,
  p_account_id uuid,
  p_guest_salt text,
  p_display_name text,
  p_street_length integer,
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r private.world_residents%rowtype;
  q public.world_quarters%rowtype;
  v_resident uuid := gen_random_uuid();
  v_quarter uuid := gen_random_uuid();
  v_k bigint;
  v_street text;
begin
  perform private.beta_check_secret(p_secret);
  if (p_account_id is null) = (p_guest_salt is null) then
    return jsonb_build_object('ok', false, 'error', 'bad_identity');
  end if;
  if p_street_length is null or p_street_length not between 1 and 1000 then
    return jsonb_build_object('ok', false, 'error', 'bad_street');
  end if;
  if p_account_id is not null then
    select * into r from private.world_residents where account_id = p_account_id;
    if found then
      select * into q from public.world_quarters where id = r.home_quarter_id;
      return jsonb_build_object('ok', true, 'created', false,
        'resident', private.world_resident_json(r), 'quarter', private.world_quarter_json(q));
    end if;
    if not exists (select 1 from public.beta_users u where u.id = p_account_id) then
      return jsonb_build_object('ok', false, 'error', 'no_account');
    end if;
  end if;

  v_k := nextval('private.world_arrivals_seq');
  v_street := 'arrivals-' || (v_k / p_street_length + 1);
  begin
    insert into private.world_residents (id, account_id, guest_salt, display_name, home_quarter_id, created_at, updated_at)
    values (v_resident, p_account_id, p_guest_salt, nullif(btrim(p_display_name), ''), v_quarter, p_now, p_now)
    returning * into r;
  exception when unique_violation then
    -- The same account claimed at the same moment from another request.
    select * into r from private.world_residents where account_id = p_account_id;
    select * into q from public.world_quarters where id = r.home_quarter_id;
    return jsonb_build_object('ok', true, 'created', false,
      'resident', private.world_resident_json(r), 'quarter', private.world_quarter_json(q));
  end;
  insert into public.world_quarters (id, owner_id, district, street, cell_x, cell_z, created_at, updated_at)
  values (v_quarter, v_resident, 'arrivals', v_street, (v_k % p_street_length)::integer, (v_k / p_street_length)::integer, p_now, p_now)
  returning * into q;
  perform private.world_event('world', 'claim', q.id::text, p_now, q.district, v_resident,
    jsonb_build_object('street', q.street), p_now);
  return jsonb_build_object('ok', true, 'created', true,
    'resident', private.world_resident_json(r), 'quarter', private.world_quarter_json(q));
end;
$$;

-- After a wallet sign-in the guest joins the account. With no resident yet,
-- the guest simply becomes the account's resident. Otherwise everything moves
-- to the account's resident: quarters, points, tasks and visits; a point or
-- task the account already has for the same key or day stays counted once.
-- The home becomes the quarter with more buildings.
create function public.world_merge_guest(
  p_secret text,
  p_guest_id uuid,
  p_account_id uuid,
  p_levels jsonb,
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  g private.world_residents%rowtype;
  r private.world_residents%rowtype;
  v_guest_home integer;
  v_account_home integer;
begin
  perform private.beta_check_secret(p_secret);
  select * into g from private.world_residents where id = p_guest_id for update;
  select * into r from private.world_residents where account_id = p_account_id for update;

  if g.id is null or g.account_id is not null or g.guest_salt is null then
    return jsonb_build_object('ok', true, 'merged', false,
      'resident', case when r.id is null then null else private.world_resident_json(r) end);
  end if;

  if r.id is null then
    if not exists (select 1 from public.beta_users u where u.id = p_account_id) then
      return jsonb_build_object('ok', false, 'error', 'no_account');
    end if;
    update private.world_residents
       set account_id = p_account_id, guest_salt = null, updated_at = p_now
     where id = g.id
     returning * into r;
    return jsonb_build_object('ok', true, 'merged', true, 'resident', private.world_resident_json(r));
  end if;

  update private.world_points p set resident_id = r.id
   where p.resident_id = g.id
     and not exists (select 1 from private.world_points x where x.resident_id = r.id and x.idempotency_key = p.idempotency_key);

  update private.world_daily_tasks t
     set progress = greatest(t.progress, o.progress),
         done_at = case when t.done_at is null then o.done_at when o.done_at is null then t.done_at else least(t.done_at, o.done_at) end
    from private.world_daily_tasks o
   where o.resident_id = g.id and t.resident_id = r.id and t.day = o.day and t.kind = o.kind;
  update private.world_daily_tasks t set resident_id = r.id
   where t.resident_id = g.id
     and not exists (select 1 from private.world_daily_tasks x where x.resident_id = r.id and x.day = t.day and x.kind = t.kind);

  update private.world_visits v set visitor_id = r.id
   where v.visitor_id = g.id
     and not exists (select 1 from private.world_visits x where x.visitor_id = r.id and x.quarter_id = v.quarter_id and x.day = v.day);

  update public.world_quarters set owner_id = r.id, updated_at = p_now where owner_id = g.id;
  update private.world_events set actor_id = r.id where actor_id = g.id;

  select count(*) into v_guest_home from public.world_buildings where quarter_id = g.home_quarter_id;
  select count(*) into v_account_home from public.world_buildings where quarter_id = r.home_quarter_id;
  update private.world_residents
     set home_quarter_id = case when v_guest_home > v_account_home then g.home_quarter_id else home_quarter_id end,
         updated_at = p_now
   where id = r.id
   returning * into r;

  delete from private.world_residents where id = g.id;
  perform private.world_relevel(r.id, p_levels, p_now);
  return jsonb_build_object('ok', true, 'merged', true, 'resident', private.world_resident_json(r));
end;
$$;

create function public.world_quarter(p_secret text, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  q public.world_quarters%rowtype;
begin
  perform private.beta_check_secret(p_secret);
  select * into q from public.world_quarters where id = p_id;
  if not found then
    return jsonb_build_object('ok', true, 'quarter', null);
  end if;
  return jsonb_build_object('ok', true, 'quarter', private.world_quarter_json(q), 'buildings', private.world_buildings_json(q.id));
end;
$$;

-- A district page by quarter id, small enough to draw from far away.
create function public.world_district(p_secret text, p_district text, p_after uuid, p_limit integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 100), 500));
  v_rows jsonb;
  v_count integer;
begin
  perform private.beta_check_secret(p_secret);
  with page as (
    select q.* from public.world_quarters q
     where q.district = p_district and (p_after is null or q.id > p_after)
     order by q.id
     limit v_limit + 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id, 'ownerId', p.owner_id, 'street', p.street,
      'cell', jsonb_build_object('x', p.cell_x, 'z', p.cell_z), 'level', p.level,
      'buildings', (
        select coalesce(jsonb_agg(jsonb_build_object('slot', b.slot, 'kind', b.kind, 'level', b.level) order by b.slot), '[]'::jsonb)
          from public.world_buildings b where b.quarter_id = p.id
      )
    ) order by p.id), '[]'::jsonb), count(*)
    into v_rows, v_count
    from page p;
  if v_count > v_limit then
    v_rows := v_rows - v_limit;
    return jsonb_build_object('ok', true, 'quarters', v_rows, 'nextCursor', v_rows->(v_limit - 1)->>'id');
  end if;
  return jsonb_build_object('ok', true, 'quarters', v_rows, 'nextCursor', null);
end;
$$;

-- Everything `GET /api/world/me` shows, in one read.
create function public.world_me(p_secret text, p_resident_id uuid, p_day date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r private.world_residents%rowtype;
  q public.world_quarters%rowtype;
begin
  perform private.beta_check_secret(p_secret);
  select * into r from private.world_residents where id = p_resident_id;
  if not found then
    return jsonb_build_object('ok', true, 'me', null);
  end if;
  select * into q from public.world_quarters where id = r.home_quarter_id;
  return jsonb_build_object('ok', true, 'me', jsonb_build_object(
    'resident', private.world_resident_json(r),
    'quarter', private.world_quarter_json(q),
    'buildings', private.world_buildings_json(q.id),
    'quarters', (
      select jsonb_agg(private.world_quarter_json(o) order by (o.id = r.home_quarter_id) desc, o.created_at, o.id)
        from public.world_quarters o where o.owner_id = r.id
    ),
    'points', jsonb_build_object(
      'total', private.world_points_total(r.id),
      'recent', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'residentId', p.resident_id, 'delta', p.delta, 'reason', p.reason, 'sourceRef', p.source_ref,
          'idempotencyKey', p.idempotency_key, 'at', private.world_iso(p.at)
        ) order by p.at desc, p.id desc), '[]'::jsonb)
          from (select * from private.world_points where resident_id = r.id order by at desc, id desc limit 20) p
      )
    ),
    'tasks', private.world_tasks_json(r.id, p_day)
  ));
end;
$$;

-- A build, written only if the quarter is still at the version the person saw.
-- The checks ran on the server against that version; the version proves
-- nothing changed in between.
create function public.world_commit_build(
  p_secret text,
  p_resident_id uuid,
  p_quarter_id uuid,
  p_version integer,
  p_slot integer,
  p_kind text,
  p_level integer,
  p_modules jsonb,
  p_day date,
  p_progress jsonb,
  p_task_points integer,
  p_levels jsonb,
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  q public.world_quarters%rowtype;
  b public.world_buildings%rowtype;
  v_item jsonb;
begin
  perform private.beta_check_secret(p_secret);
  select * into q from public.world_quarters where id = p_quarter_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if q.owner_id <> p_resident_id then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;
  if q.version <> p_version then
    return jsonb_build_object('ok', false, 'error', 'version',
      'quarter', private.world_quarter_json(q), 'buildings', private.world_buildings_json(q.id));
  end if;
  select * into b from public.world_buildings where quarter_id = q.id and slot = p_slot;
  if found and b.kind <> p_kind and b.link is not null then
    return jsonb_build_object('ok', false, 'error', 'linked');
  end if;

  update public.world_quarters set version = version + 1, updated_at = p_now where id = q.id returning * into q;
  insert into public.world_buildings as w (quarter_id, slot, kind, level, modules, link, created_at, updated_at)
  values (q.id, p_slot, p_kind, p_level, array(select jsonb_array_elements_text(p_modules)), null, p_now, p_now)
  on conflict (quarter_id, slot) do update
     set kind = excluded.kind, level = excluded.level, modules = excluded.modules,
         link = case when w.kind = excluded.kind then w.link else null end,
         updated_at = p_now
  returning * into b;

  for v_item in select * from jsonb_array_elements(coalesce(p_progress, '[]'::jsonb)) loop
    perform private.world_progress(p_resident_id, p_day, v_item->>'kind', (v_item->>'delta')::integer,
      (v_item->>'goal')::integer, p_task_points, p_levels, p_now);
  end loop;

  perform private.world_event('world', 'build', q.id::text, p_now, q.district, p_resident_id,
    jsonb_build_object('street', q.street, 'slot', b.slot, 'kind', b.kind, 'level', b.level), p_now);
  select * into q from public.world_quarters where id = q.id;
  return jsonb_build_object('ok', true,
    'quarter', private.world_quarter_json(q),
    'building', private.world_building_json(b),
    'tasks', private.world_tasks_json(p_resident_id, p_day),
    'pointsTotal', private.world_points_total(p_resident_id));
end;
$$;

-- A link (or its removal) on the building in a slot, at the version seen.
-- The server proved ownership of the object before this call.
create function public.world_commit_link(
  p_secret text,
  p_resident_id uuid,
  p_quarter_id uuid,
  p_version integer,
  p_slot integer,
  p_link jsonb,
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  q public.world_quarters%rowtype;
  b public.world_buildings%rowtype;
begin
  perform private.beta_check_secret(p_secret);
  select * into q from public.world_quarters where id = p_quarter_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if q.owner_id <> p_resident_id then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;
  if q.version <> p_version then
    return jsonb_build_object('ok', false, 'error', 'version',
      'quarter', private.world_quarter_json(q), 'buildings', private.world_buildings_json(q.id));
  end if;
  select * into b from public.world_buildings where quarter_id = q.id and slot = p_slot;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'no_building');
  end if;
  begin
    update public.world_buildings set link = p_link, updated_at = p_now where id = b.id returning * into b;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'link_taken');
  end;
  update public.world_quarters set version = version + 1, updated_at = p_now where id = q.id returning * into q;
  perform private.world_event('world', 'build', q.id::text, p_now, q.district, p_resident_id,
    jsonb_build_object('street', q.street, 'slot', b.slot, 'action', 'link', 'linkKind', b.link->>'kind'), p_now);
  return jsonb_build_object('ok', true, 'quarter', private.world_quarter_json(q), 'building', private.world_building_json(b));
end;
$$;

-- One visit per visitor, quarter and day. One's own quarter is never counted.
create function public.world_visit(
  p_secret text,
  p_visitor_id uuid,
  p_quarter_id uuid,
  p_day date,
  p_verified boolean,
  p_progress jsonb,
  p_task_points integer,
  p_levels jsonb,
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  q public.world_quarters%rowtype;
  v private.world_visits%rowtype;
  v_rows integer;
begin
  perform private.beta_check_secret(p_secret);
  select * into q from public.world_quarters where id = p_quarter_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if q.owner_id = p_visitor_id then
    return jsonb_build_object('ok', true, 'counted', false, 'reason', 'own_quarter', 'visit', null);
  end if;
  insert into private.world_visits (visitor_id, quarter_id, day, verified_human, at)
  values (p_visitor_id, p_quarter_id, p_day, coalesce(p_verified, false), p_now)
  on conflict (visitor_id, quarter_id, day) do nothing;
  get diagnostics v_rows = row_count;
  select * into v from private.world_visits where visitor_id = p_visitor_id and quarter_id = p_quarter_id and day = p_day;
  if v_rows > 0 then
    if p_progress is not null then
      perform private.world_progress(p_visitor_id, p_day, p_progress->>'kind', (p_progress->>'delta')::integer,
        (p_progress->>'goal')::integer, p_task_points, p_levels, p_now);
    end if;
    perform private.world_event('world', 'visit', q.id::text, p_now, q.district, p_visitor_id,
      jsonb_build_object('street', q.street, 'verifiedHuman', v.verified_human), p_now);
  end if;
  return jsonb_build_object('ok', true, 'counted', v_rows > 0,
    'reason', case when v_rows > 0 then 'counted' else 'already_today' end,
    'visit', jsonb_build_object('visitorId', v.visitor_id, 'quarterId', v.quarter_id, 'day', v.day, 'verifiedHuman', v.verified_human));
end;
$$;

-- Points for a real step, from the server only. The reason must be in the
-- list (the table refuses any other); the key makes it pay once.
create function public.world_award(
  p_secret text,
  p_resident_id uuid,
  p_reason text,
  p_delta integer,
  p_source_ref text,
  p_key text,
  p_levels jsonb,
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_awarded boolean;
begin
  perform private.beta_check_secret(p_secret);
  if not exists (select 1 from private.world_residents where id = p_resident_id) then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  v_awarded := private.world_award(p_resident_id, p_reason, p_delta, p_source_ref, p_key, p_levels, p_now);
  return jsonb_build_object('ok', true, 'awarded', v_awarded, 'total', private.world_points_total(p_resident_id));
end;
$$;

-- «While you were away»: what happened to my quarters, in my district and in
-- the city since a moment, newest first. My own steps are not news to me.
create function public.world_away(p_secret text, p_resident_id uuid, p_since timestamptz, p_until timestamptz, p_limit integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r private.world_residents%rowtype;
  v_district text;
begin
  perform private.beta_check_secret(p_secret);
  select * into r from private.world_residents where id = p_resident_id;
  if not found then
    return jsonb_build_object('ok', true, 'events', null);
  end if;
  select district into v_district from public.world_quarters where id = r.home_quarter_id;
  return jsonb_build_object('ok', true, 'events', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', e.id, 'at', private.world_iso(e.at), 'source', e.source, 'kind', e.kind, 'subject', e.subject,
      'sourceAt', private.world_iso(e.source_at), 'payload', e.payload
    ) order by e.source_at desc, e.id), '[]'::jsonb)
      from (
        select * from private.world_events x
         where x.source_at is not null and x.source_at > p_since and x.source_at <= p_until
           and x.actor_id is distinct from r.id
           and (
             x.subject in (select o.id::text from public.world_quarters o where o.owner_id = r.id)
             or x.district = v_district
             or (x.district is null and x.source <> 'world')
           )
         order by x.source_at desc, x.id
         limit greatest(1, least(coalesce(p_limit, 100), 200))
      ) e
  ));
end;
$$;

-- An event of the market or the engine, for the city's feed.
create function public.world_record_event(
  p_secret text,
  p_source text,
  p_kind text,
  p_subject text,
  p_source_at timestamptz,
  p_district text,
  p_payload jsonb,
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.beta_check_secret(p_secret);
  return jsonb_build_object('ok', true, 'event',
    private.world_event(p_source, p_kind, p_subject, p_source_at, p_district, null, p_payload, p_now));
end;
$$;

create function public.world_version(p_secret text, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v private.world_versions%rowtype;
begin
  perform private.beta_check_secret(p_secret);
  select * into v from private.world_versions where id = p_id;
  if not found then
    return jsonb_build_object('ok', true, 'version', null);
  end if;
  return jsonb_build_object('ok', true, 'version', jsonb_build_object(
    'id', v.id, 'day', v.day, 'seed', v.seed, 'towers', v.towers, 'createdAt', private.world_iso(v.created_at)));
end;
$$;

-- Freeze the city of a day once per seed; asking again returns the first one.
create function public.world_freeze_version(p_secret text, p_day date, p_seed text, p_towers jsonb, p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v private.world_versions%rowtype;
  v_rows integer;
begin
  perform private.beta_check_secret(p_secret);
  insert into private.world_versions (day, seed, towers, created_at)
  values (p_day, p_seed, p_towers, p_now)
  on conflict (day, seed) do nothing;
  get diagnostics v_rows = row_count;
  select * into v from private.world_versions where day = p_day and seed = p_seed;
  return jsonb_build_object('ok', true, 'created', v_rows > 0, 'version', jsonb_build_object(
    'id', v.id, 'day', v.day, 'seed', v.seed, 'towers', v.towers, 'createdAt', private.world_iso(v.created_at)));
end;
$$;

-- An Idempotency-Key: new, a replay of the stored answer, the same key with
-- another request, or one still running. A key that never finished is taken
-- over after a minute; an answer is kept for a day.
create function public.world_request_begin(
  p_secret text,
  p_scope text,
  p_route text,
  p_key text,
  p_hash text,
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  x private.world_requests%rowtype;
  v_rows integer;
begin
  perform private.beta_check_secret(p_secret);
  delete from private.world_requests
   where ctid in (select ctid from private.world_requests where created_at < p_now - interval '1 day' limit 100);
  insert into private.world_requests (scope, route, key, request_hash, created_at)
  values (p_scope, p_route, p_key, p_hash, p_now)
  on conflict (scope, route, key) do nothing;
  get diagnostics v_rows = row_count;
  if v_rows > 0 then
    return jsonb_build_object('ok', true, 'state', 'new');
  end if;
  select * into x from private.world_requests where scope = p_scope and route = p_route and key = p_key for update;
  if x.request_hash <> p_hash then
    return jsonb_build_object('ok', true, 'state', 'mismatch');
  end if;
  if x.completed_at is null then
    if x.created_at < p_now - interval '1 minute' then
      update private.world_requests set created_at = p_now
       where scope = p_scope and route = p_route and key = p_key;
      return jsonb_build_object('ok', true, 'state', 'new');
    end if;
    return jsonb_build_object('ok', true, 'state', 'pending');
  end if;
  return jsonb_build_object('ok', true, 'state', 'replay', 'status', x.status, 'body', x.body);
end;
$$;

create function public.world_request_finish(
  p_secret text,
  p_scope text,
  p_route text,
  p_key text,
  p_status integer,
  p_body jsonb,
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.beta_check_secret(p_secret);
  update private.world_requests
     set status = p_status, body = p_body, completed_at = p_now
   where scope = p_scope and route = p_route and key = p_key and completed_at is null;
  return jsonb_build_object('ok', true);
end;
$$;

create function public.world_request_abandon(p_secret text, p_scope text, p_route text, p_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.beta_check_secret(p_secret);
  delete from private.world_requests
   where scope = p_scope and route = p_route and key = p_key and completed_at is null;
  return jsonb_build_object('ok', true);
end;
$$;

-- One more request in a fixed window; refused above the limit.
create function public.world_limit_hit(
  p_secret text,
  p_bucket text,
  p_window_seconds integer,
  p_max integer,
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_start timestamptz;
  v_hits integer;
begin
  perform private.beta_check_secret(p_secret);
  if p_window_seconds is null or p_window_seconds not between 1 and 86400 or p_max is null or p_max < 1 then
    return jsonb_build_object('ok', false, 'error', 'bad_limit');
  end if;
  v_start := to_timestamp(floor(extract(epoch from p_now) / p_window_seconds) * p_window_seconds);
  delete from private.world_limits
   where ctid in (select ctid from private.world_limits where window_start < p_now - interval '1 day' limit 100);
  insert into private.world_limits as l (bucket, window_start, hits)
  values (p_bucket, v_start, 1)
  on conflict (bucket, window_start) do update set hits = l.hits + 1
  returning hits into v_hits;
  return jsonb_build_object('ok', true, 'allowed', v_hits <= p_max,
    'retryAfterSeconds', greatest(1, ceil(extract(epoch from (v_start + make_interval(secs => p_window_seconds) - p_now)))::integer));
end;
$$;

revoke all on function public.world_resident(text, uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.world_claim(text, uuid, text, text, integer, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.world_merge_guest(text, uuid, uuid, jsonb, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.world_quarter(text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.world_district(text, text, uuid, integer) from public, anon, authenticated, service_role;
revoke all on function public.world_me(text, uuid, date) from public, anon, authenticated, service_role;
revoke all on function public.world_commit_build(text, uuid, uuid, integer, integer, text, integer, jsonb, date, jsonb, integer, jsonb, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.world_commit_link(text, uuid, uuid, integer, integer, jsonb, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.world_visit(text, uuid, uuid, date, boolean, jsonb, integer, jsonb, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.world_award(text, uuid, text, integer, text, text, jsonb, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.world_away(text, uuid, timestamptz, timestamptz, integer) from public, anon, authenticated, service_role;
revoke all on function public.world_record_event(text, text, text, text, timestamptz, text, jsonb, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.world_version(text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.world_freeze_version(text, date, text, jsonb, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.world_request_begin(text, text, text, text, text, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.world_request_finish(text, text, text, text, integer, jsonb, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.world_request_abandon(text, text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.world_limit_hit(text, text, integer, integer, timestamptz) from public, anon, authenticated, service_role;

grant execute on function public.world_resident(text, uuid, uuid) to anon;
grant execute on function public.world_claim(text, uuid, text, text, integer, timestamptz) to anon;
grant execute on function public.world_merge_guest(text, uuid, uuid, jsonb, timestamptz) to anon;
grant execute on function public.world_quarter(text, uuid) to anon;
grant execute on function public.world_district(text, text, uuid, integer) to anon;
grant execute on function public.world_me(text, uuid, date) to anon;
grant execute on function public.world_commit_build(text, uuid, uuid, integer, integer, text, integer, jsonb, date, jsonb, integer, jsonb, timestamptz) to anon;
grant execute on function public.world_commit_link(text, uuid, uuid, integer, integer, jsonb, timestamptz) to anon;
grant execute on function public.world_visit(text, uuid, uuid, date, boolean, jsonb, integer, jsonb, timestamptz) to anon;
grant execute on function public.world_award(text, uuid, text, integer, text, text, jsonb, timestamptz) to anon;
grant execute on function public.world_away(text, uuid, timestamptz, timestamptz, integer) to anon;
grant execute on function public.world_record_event(text, text, text, text, timestamptz, text, jsonb, timestamptz) to anon;
grant execute on function public.world_version(text, uuid) to anon;
grant execute on function public.world_freeze_version(text, date, text, jsonb, timestamptz) to anon;
grant execute on function public.world_request_begin(text, text, text, text, text, timestamptz) to anon;
grant execute on function public.world_request_finish(text, text, text, text, integer, jsonb, timestamptz) to anon;
grant execute on function public.world_request_abandon(text, text, text, text) to anon;
grant execute on function public.world_limit_hit(text, text, integer, integer, timestamptz) to anon;

commit;
