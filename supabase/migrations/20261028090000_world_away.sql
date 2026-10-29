-- Ryntra City: «While you were away» (CITY-18), on top of `world_v1`.
--
-- PREPARED 2026-10-27 as a file only. Not applied to any Supabase project:
-- Checked on a throwaway local PostgreSQL 16 with the Supabase roles and a
-- hostile default-grant posture, after `world_v1` (see `lib/world/sql.test.mjs`
-- and `lib/world/store.test.mjs`).
--
-- WHAT THIS FILE DOES
--   * `world_away` keeps what is mine from being crowded out by the city:
--     events of my quarters and of the engine objects my buildings show come
--     first, up to the limit; my district and the city fill what is left. The
--     answer is still newest first, in the same shape.
--   * Consent for the report on other channels, the assistant's Telegram and
--     push, kept per resident in `world_away_consent`: off until the person
--     turns a channel on, and only a resident with an account (a wallet
--     sign-in) may. The row goes with its resident.
--
-- WHAT IT DOES NOT DO
--   Nothing is sent: not by this file, not by the server. A sender reads the
--   consent later, in a task of its own. No money, as in `world_v1`.
--
-- UNTIL IT IS APPLIED
--   The server keeps working on `world_v1` alone: `away` answers with the old
--   function, and the consent routes answer 503 without changing anything.

begin;

-- -------------------------------------------------------------- consent --

create table private.world_away_consent (
  resident_id uuid primary key references private.world_residents(id) on delete cascade,
  telegram boolean not null default false,
  push boolean not null default false,
  updated_at timestamptz not null
);

alter table private.world_away_consent enable row level security;
alter table private.world_away_consent force row level security;

revoke all privileges on table private.world_away_consent from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------- away --

-- «While you were away»: what happened to my quarters and to the engine
-- objects my buildings show, in my district and in the city, since a moment.
-- What is mine comes first, up to the limit; the rest fills it. Newest first.
-- My own steps are not news to me.
create or replace function public.world_away(p_secret text, p_resident_id uuid, p_since timestamptz, p_until timestamptz, p_limit integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r private.world_residents%rowtype;
  v_district text;
  v_quarters text[];
  v_objects text[];
begin
  perform private.beta_check_secret(p_secret);
  select * into r from private.world_residents where id = p_resident_id;
  if not found then
    return jsonb_build_object('ok', true, 'events', null);
  end if;
  select district into v_district from public.world_quarters where id = r.home_quarter_id;
  select coalesce(array_agg(o.id::text), '{}') into v_quarters from public.world_quarters o where o.owner_id = r.id;
  -- `link_key` is `<kind>:<subject>`; a prediction book has none.
  select coalesce(array_agg(split_part(b.link_key, ':', 2)), '{}') into v_objects
    from public.world_buildings b
   where b.link_key is not null and b.quarter_id in (select o.id from public.world_quarters o where o.owner_id = r.id);
  return jsonb_build_object('ok', true, 'events', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', e.id, 'at', private.world_iso(e.at), 'source', e.source, 'kind', e.kind, 'subject', e.subject,
      'sourceAt', private.world_iso(e.source_at), 'payload', e.payload
    ) order by e.source_at desc, e.id), '[]'::jsonb)
      from (
        select x.*
          from private.world_events x
         where x.source_at is not null and x.source_at > p_since and x.source_at <= p_until
           and x.actor_id is distinct from r.id
           and (
             x.subject = any (v_quarters)
             or x.subject = any (v_objects)
             or x.district = v_district
             or (x.district is null and x.source <> 'world')
           )
         order by (x.subject = any (v_quarters) or x.subject = any (v_objects)) desc, x.source_at desc, x.id
         limit greatest(1, least(coalesce(p_limit, 100), 200))
      ) e
  ));
end;
$$;

-- The channels a resident let the report reach; never chosen is all off.
create function public.world_consent(p_secret text, p_resident_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c private.world_away_consent%rowtype;
begin
  perform private.beta_check_secret(p_secret);
  if not exists (select 1 from private.world_residents where id = p_resident_id) then
    return jsonb_build_object('ok', true, 'consent', null);
  end if;
  select * into c from private.world_away_consent where resident_id = p_resident_id;
  if not found then
    return jsonb_build_object('ok', true, 'consent', jsonb_build_object('telegram', false, 'push', false, 'updatedAt', null));
  end if;
  return jsonb_build_object('ok', true, 'consent',
    jsonb_build_object('telegram', c.telegram, 'push', c.push, 'updatedAt', private.world_iso(c.updated_at)));
end;
$$;

-- Turn channels on or off; a null leaves a channel as it is. Only a resident
-- with an account consents: a guest has no channel to be reached on.
create function public.world_set_consent(p_secret text, p_resident_id uuid, p_telegram boolean, p_push boolean, p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r private.world_residents%rowtype;
  c private.world_away_consent%rowtype;
begin
  perform private.beta_check_secret(p_secret);
  select * into r from private.world_residents where id = p_resident_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if r.account_id is null then
    return jsonb_build_object('ok', false, 'error', 'account_required');
  end if;
  insert into private.world_away_consent as a (resident_id, telegram, push, updated_at)
  values (r.id, coalesce(p_telegram, false), coalesce(p_push, false), p_now)
  on conflict (resident_id) do update
    set telegram = coalesce(p_telegram, a.telegram),
        push = coalesce(p_push, a.push),
        updated_at = p_now
  returning * into c;
  return jsonb_build_object('ok', true, 'consent',
    jsonb_build_object('telegram', c.telegram, 'push', c.push, 'updatedAt', private.world_iso(c.updated_at)));
end;
$$;

revoke all on function public.world_away(text, uuid, timestamptz, timestamptz, integer) from public, anon, authenticated, service_role;
revoke all on function public.world_consent(text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.world_set_consent(text, uuid, boolean, boolean, timestamptz) from public, anon, authenticated, service_role;

grant execute on function public.world_away(text, uuid, timestamptz, timestamptz, integer) to anon;
grant execute on function public.world_consent(text, uuid) to anon;
grant execute on function public.world_set_consent(text, uuid, boolean, boolean, timestamptz) to anon;

commit;
