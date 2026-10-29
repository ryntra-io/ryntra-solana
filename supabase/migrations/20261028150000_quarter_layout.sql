-- Ryntra City: a quarter's free layout (CITY-55, decision 72), on top of `world_v1`.
--
-- PREPARED 2026-10-28 as a file only. Not applied to any Supabase project:
-- Checked on a throwaway local PostgreSQL 16 with the Supabase roles and a
-- hostile default-grant posture, after `world_v1` and `world_away` (see
-- `lib/world/layout-sql.test.mjs`).
--
-- The file's name leaves out «world» on purpose: `lib/world/sql.test.mjs` lists
-- the world's migration files by that word, and that list belongs to an open
-- pull request (CITY-19). Its table and functions are `world_` like the rest.
--
-- WHAT THIS FILE DOES
--   * `private.world_layouts` keeps one layout per quarter: the pieces as the
--     server checked them (`lib/world/layout.ts`, `planLayout`) and a version
--     of its own, so free building never races a build of the quarter.
--   * The row goes with its quarter (and moves with it when a guest joins an
--     account, since the quarter keeps its id).
--   * `public.world_layout` reads it; `public.world_commit_layout` writes the
--     whole layout, only by the quarter's owner and only at the version the
--     person saw. Both are gated by the app secret, like every world function.
--
-- WHAT IT DOES NOT DO
--   No points, no task of the day, no money: a layout is how a quarter looks.
--   A sign's words are kept for the owner; the server leaves them out of what
--   anyone else reads until CITY-73 cleans foreign text.
--
-- UNTIL IT IS APPLIED
--   The rest of the world works as before; the layout routes answer 503 and
--   the city keeps the pieces on screen until a save goes through.

begin;

create table private.world_layouts (
  quarter_id uuid primary key references public.world_quarters(id) on delete cascade,
  pieces jsonb not null check (
    jsonb_typeof(pieces) = 'array'
    and jsonb_array_length(pieces) <= 120
    and octet_length(pieces::text) <= 12000
  ),
  version integer not null check (version >= 1),
  updated_at timestamptz not null
);

alter table private.world_layouts enable row level security;
alter table private.world_layouts force row level security;

revoke all privileges on table private.world_layouts from public, anon, authenticated, service_role;

-- A quarter's layout; version 0 and no pieces while nothing was saved.
create function public.world_layout(p_secret text, p_quarter_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  l private.world_layouts%rowtype;
begin
  perform private.beta_check_secret(p_secret);
  if not exists (select 1 from public.world_quarters q where q.id = p_quarter_id) then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  select * into l from private.world_layouts where quarter_id = p_quarter_id;
  if l.quarter_id is null then
    return jsonb_build_object('ok', true, 'layout', jsonb_build_object(
      'quarterId', p_quarter_id, 'pieces', '[]'::jsonb, 'version', 0, 'updatedAt', null));
  end if;
  return jsonb_build_object('ok', true, 'layout', jsonb_build_object(
    'quarterId', l.quarter_id, 'pieces', l.pieces, 'version', l.version, 'updatedAt', private.world_iso(l.updated_at)));
end;
$$;

-- The whole layout of a quarter, by its owner, at the version they saw. A
-- stale version answers with the layout as it is now.
create function public.world_commit_layout(
  p_secret text,
  p_resident_id uuid,
  p_quarter_id uuid,
  p_version integer,
  p_pieces jsonb,
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  q public.world_quarters%rowtype;
  l private.world_layouts%rowtype;
  v_current integer;
begin
  perform private.beta_check_secret(p_secret);
  select * into q from public.world_quarters where id = p_quarter_id for share;
  if q.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if q.owner_id is distinct from p_resident_id then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;
  if p_pieces is null or jsonb_typeof(p_pieces) <> 'array' or p_version is null or p_version < 0 then
    return jsonb_build_object('ok', false, 'error', 'bad_layout');
  end if;
  select * into l from private.world_layouts where quarter_id = p_quarter_id for update;
  v_current := coalesce(l.version, 0);
  if v_current <> p_version then
    return jsonb_build_object('ok', false, 'error', 'version', 'layout', public.world_layout(p_secret, p_quarter_id) -> 'layout');
  end if;
  if l.quarter_id is null then
    begin
      insert into private.world_layouts (quarter_id, pieces, version, updated_at)
      values (p_quarter_id, p_pieces, 1, p_now)
      returning * into l;
    exception when unique_violation then
      -- The first save of this quarter landed a moment earlier from another request.
      return jsonb_build_object('ok', false, 'error', 'version', 'layout', public.world_layout(p_secret, p_quarter_id) -> 'layout');
    end;
  else
    update private.world_layouts
       set pieces = p_pieces, version = l.version + 1, updated_at = p_now
     where quarter_id = p_quarter_id
    returning * into l;
  end if;
  return jsonb_build_object('ok', true, 'layout', jsonb_build_object(
    'quarterId', l.quarter_id, 'pieces', l.pieces, 'version', l.version, 'updatedAt', private.world_iso(l.updated_at)));
end;
$$;

revoke all on function public.world_layout(text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.world_commit_layout(text, uuid, uuid, integer, jsonb, timestamptz) from public, anon, authenticated, service_role;

grant execute on function public.world_layout(text, uuid) to anon;
grant execute on function public.world_commit_layout(text, uuid, uuid, integer, jsonb, timestamptz) to anon;

commit;
