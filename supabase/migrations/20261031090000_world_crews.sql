-- Ryntra City: crews are streets (CITY-20, decision 71), on top of `world_v1`.
--
-- PREPARED 2026-10-29 as a file only. Not applied to any Supabase project:
-- Checked as text by `lib/world/crew-sql.test.mjs`; on a throwaway local
-- PostgreSQL 16 with the Supabase roles when WORLD_TEST_DATABASE_URL is set.
--
-- WHAT THIS FILE DOES
--   * `private.world_crews` (from `world_v1`, empty until now) gains a colour,
--     the row of Arrivals the crew holds and an invite code.
--   * `private.world_crew_members` makes a quarter a member: a member is a
--     quarter, not a resident, so a guest's crew follows their quarter into an
--     account. A member's quarter stands on the crew's row, north side.
--   * `private.world_crew_gifts` keeps what members give the headquarters: a
--     module or points, each kind once a person a day. Points given stay in the
--     giver's total (a quarter never loses a level); they cannot be given twice.
--   * `private.world_next_arrival` is the newcomers' next lot, past every street
--     a crew holds, under one advisory lock; `public.world_claim` is replaced
--     with the same signature and body to use it, so a claim never lands on a
--     crew's street.
--   * Seven server functions, each gated by the app secret: a crew is made with
--     its street and its first member, a join takes the next free lot only
--     while the crew has room, a leave sends the quarter back to a newcomers'
--     street, and the last one out ends the crew.
--
-- WHAT IT DOES NOT DO
--   No money, no transaction, no points paid: a gift moves nothing but the
--   headquarters' units. The week's score (CITY-21) is counted by the server
--   from the members' builds, visits and gifts it returns; nothing is bought.
--
-- UNTIL IT IS APPLIED
--   The crew routes answer 503 (or 404 while `NEXT_PUBLIC_RYNTRA_CITY_CREWS` is
--   not `open`); the rest of the world works as before.

begin;

alter table private.world_crews
  add column colour text not null default 'cyan'
    check (colour in ('cyan', 'sky', 'periwinkle', 'lilac', 'orchid', 'rose', 'lime', 'pearl')),
  add column row_z integer unique check (row_z between 0 and 100000),
  add column invite text unique check (invite ~ '^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$');

create table private.world_crew_members (
  quarter_id uuid primary key references public.world_quarters(id) on delete cascade,
  crew_id uuid not null references private.world_crews(id) on delete cascade,
  joined_at timestamptz not null
);

create index world_crew_members_crew_idx on private.world_crew_members (crew_id);

create table private.world_crew_gifts (
  id bigint generated always as identity primary key,
  -- A gift outlives its crew, so points once given are never given again.
  crew_id uuid references private.world_crews(id) on delete set null,
  resident_id uuid not null references private.world_residents(id) on delete cascade,
  kind text not null check (kind in ('module', 'points')),
  module text check (module is null or module ~ '^[a-z]+\.[a-z]+$'),
  points integer not null default 0 check (points between 0 and 100),
  units integer not null check (units between 1 and 100),
  day date not null,
  at timestamptz not null,
  unique (resident_id, day, kind),
  check ((kind = 'module') = (module is not null)),
  check ((kind = 'points') = (points > 0))
);

create index world_crew_gifts_crew_idx on private.world_crew_gifts (crew_id, at desc);

alter table private.world_crew_members enable row level security;
alter table private.world_crew_members force row level security;
alter table private.world_crew_gifts enable row level security;
alter table private.world_crew_gifts force row level security;

revoke all privileges on table private.world_crew_members, private.world_crew_gifts from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------- helpers --

-- The newcomers' next lot as a running number, past every street a crew
-- holds. One lock serialises it with a crew taking a street.
create function private.world_next_arrival(p_street_length integer)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  v_k bigint;
begin
  perform pg_advisory_xact_lock(7201020);
  v_k := nextval('private.world_arrivals_seq');
  while exists (select 1 from private.world_crews c where c.row_z = v_k / p_street_length) loop
    perform setval('private.world_arrivals_seq', (v_k / p_street_length + 1) * p_street_length, false);
    v_k := nextval('private.world_arrivals_seq');
  end loop;
  return v_k;
end;
$$;

-- A quarter onto a lot of Arrivals: only its street and cell change, and its
-- version, so a build sent before the move meets it.
create function private.world_move_quarter(p_quarter_id uuid, p_x integer, p_z integer, p_now timestamptz)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  q public.world_quarters%rowtype;
begin
  update public.world_quarters
     set district = 'arrivals', street = 'arrivals-' || (p_z + 1), cell_x = p_x, cell_z = p_z,
         version = version + 1, updated_at = p_now
   where id = p_quarter_id
  returning * into q;
  return private.world_quarter_json(q);
end;
$$;

-- The crew a resident is in, through any of their quarters.
create function private.world_crew_of(p_resident_id uuid)
returns uuid
language sql
stable
set search_path = ''
as $$
  select m.crew_id
    from private.world_crew_members m
    join public.world_quarters q on q.id = m.quarter_id
   where q.owner_id = p_resident_id
   order by m.joined_at
   limit 1;
$$;

-- A crew as anyone may read it: no people, no invite.
create function private.world_crew_street_json(c private.world_crews)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'crew', jsonb_build_object('id', c.id, 'name', c.name, 'colour', c.colour, 'street', c.street, 'row', c.row_z,
                               'invite', '', 'createdAt', private.world_iso(c.created_at)),
    'members', (select count(*) from private.world_crew_members m where m.crew_id = c.id),
    'units', coalesce((select sum(g.units) from private.world_crew_gifts g where g.crew_id = c.id), 0),
    'given', coalesce((select jsonb_agg(x.module order by x.at desc) from (
               select g.module, g.at from private.world_crew_gifts g
                where g.crew_id = c.id and g.module is not null order by g.at desc limit 16) x), '[]'::jsonb)
  );
$$;

revoke all on function private.world_next_arrival(integer) from public, anon, authenticated, service_role;
revoke all on function private.world_move_quarter(uuid, integer, integer, timestamptz) from public, anon, authenticated, service_role;
revoke all on function private.world_crew_of(uuid) from public, anon, authenticated, service_role;
revoke all on function private.world_crew_street_json(private.world_crews) from public, anon, authenticated, service_role;

-- --------------------------------------------- a claim steps over crews --

-- `world_v1`'s claim, line for line, with the newcomers' next lot taken from
-- `world_next_arrival` so it never lands on a crew's street.
create or replace function public.world_claim(
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

  v_k := private.world_next_arrival(p_street_length);
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

-- ------------------------------------------------------- the server's API --

-- My crew, read for me: the street, its people, the headquarters' units and
-- modules, what I gave and may still give, and the week's actions.
create function public.world_crew_mine(p_secret text, p_resident_id uuid, p_day date, p_since timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r private.world_residents%rowtype;
  q public.world_quarters%rowtype;
  c private.world_crews%rowtype;
  v_crew uuid;
  v_street jsonb;
begin
  perform private.beta_check_secret(p_secret);
  select * into r from private.world_residents where id = p_resident_id;
  if r.id is null then
    return jsonb_build_object('ok', true, 'crew', null);
  end if;
  v_crew := private.world_crew_of(p_resident_id);
  if v_crew is null then
    return jsonb_build_object('ok', true, 'crew', null);
  end if;
  select * into c from private.world_crews where id = v_crew;
  select * into q from public.world_quarters where id = r.home_quarter_id;
  v_street := private.world_crew_street_json(c);
  return jsonb_build_object('ok', true, 'crew', jsonb_build_object(
    'crew', (v_street -> 'crew') || jsonb_build_object('invite', c.invite),
    'units', v_street -> 'units',
    'given', v_street -> 'given',
    'people', coalesce((select jsonb_agg(jsonb_build_object(
                  'quarterId', mq.id, 'residentId', mr.id, 'displayName', mr.display_name,
                  'verified', mr.account_id is not null, 'lot', mq.cell_x, 'level', mq.level,
                  'joinedAt', private.world_iso(m.joined_at)) order by mq.cell_x)
                from private.world_crew_members m
                join public.world_quarters mq on mq.id = m.quarter_id
                join private.world_residents mr on mr.id = mq.owner_id
               where m.crew_id = c.id), '[]'::jsonb),
    'me', jsonb_build_object(
      'residentId', r.id, 'quarterId', r.home_quarter_id, 'quarterLevel', q.level,
      'pointsTotal', private.world_points_total(r.id),
      'pointsGiven', coalesce((select sum(g.points) from private.world_crew_gifts g where g.resident_id = r.id), 0),
      'gave', jsonb_build_object(
        'module', exists (select 1 from private.world_crew_gifts g where g.resident_id = r.id and g.day = p_day and g.kind = 'module'),
        'points', exists (select 1 from private.world_crew_gifts g where g.resident_id = r.id and g.day = p_day and g.kind = 'points'))),
    'actions', coalesce((select jsonb_agg(a) from (
        select jsonb_build_object('residentId', e.actor_id, 'day', to_char(e.at at time zone 'UTC', 'YYYY-MM-DD'), 'kind', e.kind) as a
          from private.world_events e
         where e.at >= p_since and e.kind in ('build', 'visit')
           and e.actor_id in (select mq.owner_id from private.world_crew_members m
                                join public.world_quarters mq on mq.id = m.quarter_id where m.crew_id = c.id)
        union all
        select jsonb_build_object('residentId', g.resident_id, 'day', to_char(g.day, 'YYYY-MM-DD'), 'kind', 'gift')
          from private.world_crew_gifts g
         where g.crew_id = c.id and g.at >= p_since
         limit 2000) x), '[]'::jsonb)
  ));
end;
$$;

-- Every crew street, nearest the island first.
create function public.world_crew_streets(p_secret text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.beta_check_secret(p_secret);
  return jsonb_build_object('ok', true, 'streets', coalesce((
    select jsonb_agg(private.world_crew_street_json(c) order by c.row_z)
      from private.world_crews c where c.row_z is not null), '[]'::jsonb));
end;
$$;

-- The street behind an invite.
create function public.world_crew_by_invite(p_secret text, p_invite text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c private.world_crews%rowtype;
begin
  perform private.beta_check_secret(p_secret);
  select * into c from private.world_crews where invite = p_invite;
  if c.id is null then
    return jsonb_build_object('ok', true, 'street', null);
  end if;
  return jsonb_build_object('ok', true, 'street', private.world_crew_street_json(c));
end;
$$;

-- A new crew: the first street no newcomer has reached and no crew holds, and
-- my home quarter on its first lot.
create function public.world_crew_create(
  p_secret text,
  p_resident_id uuid,
  p_name text,
  p_colour text,
  p_invite text,
  p_lot integer,
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
  c private.world_crews%rowtype;
  v_last bigint;
  v_called boolean;
  v_next bigint;
  v_row integer;
begin
  perform private.beta_check_secret(p_secret);
  if p_street_length is null or p_street_length not between 1 and 1000 or p_lot is null or p_lot < 0 or p_lot >= p_street_length then
    return jsonb_build_object('ok', false, 'error', 'bad_street');
  end if;
  select * into r from private.world_residents where id = p_resident_id for update;
  if r.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if private.world_crew_of(p_resident_id) is not null then
    return jsonb_build_object('ok', false, 'error', 'in_crew');
  end if;
  if exists (select 1 from private.world_crews where invite = p_invite) then
    return jsonb_build_object('ok', false, 'error', 'invite_taken');
  end if;
  perform pg_advisory_xact_lock(7201020);
  select last_value, is_called into v_last, v_called from private.world_arrivals_seq;
  v_next := case when v_called then v_last + 1 else v_last end;
  v_row := ((v_next + p_street_length - 1) / p_street_length)::integer;
  while exists (select 1 from private.world_crews where row_z = v_row)
     or exists (select 1 from public.world_quarters where district = 'arrivals' and cell_z = v_row) loop
    v_row := v_row + 1;
  end loop;
  insert into private.world_crews (name, street, colour, row_z, invite, created_at)
  values (p_name, 'arrivals-' || (v_row + 1), p_colour, v_row, p_invite, p_now)
  returning * into c;
  insert into private.world_crew_members (quarter_id, crew_id, joined_at) values (r.home_quarter_id, c.id, p_now);
  return jsonb_build_object('ok', true, 'quarter', private.world_move_quarter(r.home_quarter_id, p_lot, v_row, p_now));
end;
$$;

-- My home quarter into the crew's row, on its next free lot, while it has room.
create function public.world_crew_join(p_secret text, p_resident_id uuid, p_invite text, p_limit integer, p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r private.world_residents%rowtype;
  c private.world_crews%rowtype;
  v_lot integer;
begin
  perform private.beta_check_secret(p_secret);
  select * into r from private.world_residents where id = p_resident_id for update;
  if r.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  select * into c from private.world_crews where invite = p_invite for update;
  if c.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if private.world_crew_of(p_resident_id) is not null then
    return jsonb_build_object('ok', false, 'error', 'in_crew');
  end if;
  if (select count(*) from private.world_crew_members m where m.crew_id = c.id) >= p_limit then
    return jsonb_build_object('ok', false, 'error', 'full');
  end if;
  select l into v_lot
    from generate_series(0, 2 * (p_limit - 1), 2) l
   where not exists (select 1 from public.world_quarters q where q.district = 'arrivals' and q.cell_z = c.row_z and q.cell_x = l)
   order by l
   limit 1;
  if v_lot is null then
    return jsonb_build_object('ok', false, 'error', 'full');
  end if;
  insert into private.world_crew_members (quarter_id, crew_id, joined_at) values (r.home_quarter_id, c.id, p_now);
  return jsonb_build_object('ok', true, 'quarter', private.world_move_quarter(r.home_quarter_id, v_lot, c.row_z, p_now));
end;
$$;

-- My quarter back on a newcomers' street; the last one out ends the crew.
create function public.world_crew_leave(p_secret text, p_resident_id uuid, p_street_length integer, p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  m private.world_crew_members%rowtype;
  v_k bigint;
begin
  perform private.beta_check_secret(p_secret);
  if p_street_length is null or p_street_length not between 1 and 1000 then
    return jsonb_build_object('ok', false, 'error', 'bad_street');
  end if;
  select cm.* into m
    from private.world_crew_members cm
    join public.world_quarters q on q.id = cm.quarter_id
   where q.owner_id = p_resident_id
   order by cm.joined_at
   limit 1
   for update of cm;
  if m.quarter_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_in_crew');
  end if;
  delete from private.world_crew_members where quarter_id = m.quarter_id;
  if not exists (select 1 from private.world_crew_members where crew_id = m.crew_id) then
    delete from private.world_crews where id = m.crew_id;
  end if;
  v_k := private.world_next_arrival(p_street_length);
  return jsonb_build_object('ok', true, 'quarter', private.world_move_quarter(
    m.quarter_id, (v_k % p_street_length)::integer, (v_k / p_street_length)::integer, p_now));
end;
$$;

-- A gift towards the headquarters, checked by the server's rules before it
-- comes here: each kind once a person a day, and never more points than the
-- giver has left to give.
create function public.world_crew_gift(
  p_secret text,
  p_resident_id uuid,
  p_kind text,
  p_module text,
  p_points integer,
  p_units integer,
  p_day date,
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r private.world_residents%rowtype;
  v_crew uuid;
  v_given integer;
begin
  perform private.beta_check_secret(p_secret);
  select * into r from private.world_residents where id = p_resident_id for update;
  v_crew := case when r.id is null then null else private.world_crew_of(p_resident_id) end;
  if v_crew is null then
    return jsonb_build_object('ok', false, 'error', 'not_in_crew');
  end if;
  if exists (select 1 from private.world_crew_gifts g where g.resident_id = r.id and g.day = p_day and g.kind = p_kind) then
    return jsonb_build_object('ok', false, 'error', 'today');
  end if;
  if p_kind = 'points' then
    v_given := coalesce((select sum(g.points) from private.world_crew_gifts g where g.resident_id = r.id), 0);
    if v_given + p_points > private.world_points_total(r.id) then
      return jsonb_build_object('ok', false, 'error', 'points');
    end if;
  end if;
  insert into private.world_crew_gifts (crew_id, resident_id, kind, module, points, units, day, at)
  values (v_crew, r.id, p_kind, case when p_kind = 'module' then p_module end,
          case when p_kind = 'points' then p_points else 0 end, p_units, p_day, p_now);
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.world_crew_mine(text, uuid, date, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.world_crew_streets(text) from public, anon, authenticated, service_role;
revoke all on function public.world_crew_by_invite(text, text) from public, anon, authenticated, service_role;
revoke all on function public.world_crew_create(text, uuid, text, text, text, integer, integer, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.world_crew_join(text, uuid, text, integer, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.world_crew_leave(text, uuid, integer, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.world_crew_gift(text, uuid, text, text, integer, integer, date, timestamptz) from public, anon, authenticated, service_role;

grant execute on function public.world_crew_mine(text, uuid, date, timestamptz) to anon;
grant execute on function public.world_crew_streets(text) to anon;
grant execute on function public.world_crew_by_invite(text, text) to anon;
grant execute on function public.world_crew_create(text, uuid, text, text, text, integer, integer, timestamptz) to anon;
grant execute on function public.world_crew_join(text, uuid, text, integer, timestamptz) to anon;
grant execute on function public.world_crew_leave(text, uuid, integer, timestamptz) to anon;
grant execute on function public.world_crew_gift(text, uuid, text, text, integer, integer, date, timestamptz) to anon;

commit;
