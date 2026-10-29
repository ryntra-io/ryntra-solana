-- Ryntra City: the queue of post drafts for X (task CITY-3).
--
-- PREPARED 2026-10-27 as a file only. Not applied to any Supabase project:
-- Checked on a throwaway local PostgreSQL 16 with the Supabase roles and a
-- hostile default-grant posture (see `city/lib/moments/drafts/sql.test.mjs`).
--
-- WHAT THIS FILE DOES
--   * One draft per happening of the city (a Ryntra launch, its move into the
--     skyline, a big x, an agent's find): its words, its link, the moment the
--     clip is filmed from, and the clip itself once the city has filmed it.
--   * A person approves a ready draft, or all ready drafts at once, or
--     rejects it. The switch that lets a sender post approved drafts is one
--     row, off when this file runs.
--   * Everything lives in `private` with row level security forced, no
--     policies and every grant revoked. The server reads and writes only
--     through the `public.moments_*` functions below, each gated by the app
--     secret (`private.beta_check_secret`), as every other server function
--     of Ryntra is.
--
-- WHAT IT DOES NOT DO
--   No keys and no posting: nothing here holds an X credential or talks to X.
--   A draft becomes `sent` only when a sender reports it, and no sender is
--   connected until the owner says so. Before a sender is asked, the draft is
--   claimed (`approved` -> `sending`) in one UPDATE, so two deliveries at once
--   never post it twice; a draft a crash leaves in `sending` stays there.

begin;

-- ---------------------------------------------------------------- drafts --

create table private.moments_drafts (
  id uuid primary key default gen_random_uuid(),
  event_id text not null unique check (char_length(event_id) between 1 and 200),
  kind text not null check (kind in ('launch', 'graduate', 'bigx', 'agent')),
  moment jsonb not null check (jsonb_typeof(moment) = 'object' and pg_column_size(moment) <= 4096),
  text text not null check (char_length(text) between 1 and 600),
  link text not null check (link ~ '^https://[a-z0-9.-]+/' and char_length(link) <= 300),
  status text not null default 'filming' check (status in ('filming', 'ready', 'approved', 'rejected', 'sending', 'sent', 'failed')),
  media_type text check (media_type is null or media_type in ('video/mp4', 'image/png', 'image/jpeg')),
  media_bytes integer check (media_bytes is null or media_bytes between 1 and 4194304),
  decided_by text check (decided_by is null or char_length(decided_by) between 1 and 80),
  decided_at timestamptz,
  note text check (note is null or char_length(note) <= 300),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  check ((media_type is null) = (media_bytes is null)),
  check (status = 'filming' or media_type is not null),
  check ((status in ('approved', 'rejected', 'sending', 'sent', 'failed')) = (decided_at is not null))
);

create index moments_drafts_recent_idx on private.moments_drafts (created_at desc, id desc);
create index moments_drafts_status_idx on private.moments_drafts (status, created_at desc);

-- The clip (or the card) of a draft, apart from the queue, so a list never
-- reads megabytes.
create table private.moments_media (
  draft_id uuid primary key references private.moments_drafts(id) on delete cascade,
  type text not null check (type in ('video/mp4', 'image/png', 'image/jpeg')),
  bytes bytea not null check (octet_length(bytes) between 1 and 4194304),
  created_at timestamptz not null
);

-- The kill switch: one row, off.
create table private.moments_switch (
  id boolean primary key default true check (id),
  autopost_on boolean not null default false,
  changed_by text check (changed_by is null or char_length(changed_by) between 1 and 80),
  changed_at timestamptz
);

insert into private.moments_switch (id, autopost_on) values (true, false);

-- ------------------------------------------------------------- the locks --

alter table private.moments_drafts enable row level security;
alter table private.moments_drafts force row level security;
alter table private.moments_media enable row level security;
alter table private.moments_media force row level security;
alter table private.moments_switch enable row level security;
alter table private.moments_switch force row level security;

revoke all privileges on table private.moments_drafts, private.moments_media, private.moments_switch
  from public, anon, authenticated, service_role;

-- --------------------------------------------------------------- helpers --

create function private.moments_iso(p_at timestamptz)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_at is null then null else to_char(p_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end;
$$;

create function private.moments_draft_json(r private.moments_drafts)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', r.id, 'eventId', r.event_id, 'kind', r.kind, 'moment', r.moment, 'text', r.text, 'link', r.link,
    'status', r.status,
    'media', case when r.media_type is null then null else jsonb_build_object('type', r.media_type, 'bytes', r.media_bytes) end,
    'decidedBy', r.decided_by, 'decidedAt', private.moments_iso(r.decided_at), 'note', r.note,
    'createdAt', private.moments_iso(r.created_at), 'updatedAt', private.moments_iso(r.updated_at)
  );
$$;

create function private.moments_switch_json()
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (select jsonb_build_object('on', s.autopost_on, 'changedBy', s.changed_by, 'changedAt', private.moments_iso(s.changed_at))
       from private.moments_switch s where s.id),
    jsonb_build_object('on', false, 'changedBy', null, 'changedAt', null)
  );
$$;

revoke all on function private.moments_iso(timestamptz) from public, anon, authenticated, service_role;
revoke all on function private.moments_draft_json(private.moments_drafts) from public, anon, authenticated, service_role;
revoke all on function private.moments_switch_json() from public, anon, authenticated, service_role;

-- ------------------------------------------------------- the server's API --

-- The draft of an event, or the one already made for it.
create function public.moments_draft_put(
  p_secret text,
  p_event_id text,
  p_kind text,
  p_moment jsonb,
  p_text text,
  p_link text,
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r private.moments_drafts%rowtype;
begin
  perform private.beta_check_secret(p_secret);
  insert into private.moments_drafts (event_id, kind, moment, text, link, created_at, updated_at)
  values (p_event_id, p_kind, p_moment, p_text, p_link, p_now, p_now)
  on conflict (event_id) do nothing
  returning * into r;
  if r.id is not null then
    return jsonb_build_object('ok', true, 'created', true, 'draft', private.moments_draft_json(r));
  end if;
  select * into r from private.moments_drafts where event_id = p_event_id;
  return jsonb_build_object('ok', true, 'created', false, 'draft', private.moments_draft_json(r));
end;
$$;

-- The queue, newest first.
create function public.moments_drafts_list(p_secret text, p_status text, p_limit integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.beta_check_secret(p_secret);
  return jsonb_build_object('ok', true, 'drafts', coalesce((
    select jsonb_agg(private.moments_draft_json(d) order by d.created_at desc, d.id desc)
      from private.moments_drafts d
     where d.id in (
       select id from private.moments_drafts
        where p_status is null or status = p_status
        order by created_at desc, id desc
        limit least(greatest(coalesce(p_limit, 50), 1), 200)
     )
  ), '[]'::jsonb));
end;
$$;

create function public.moments_draft_get(p_secret text, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r private.moments_drafts%rowtype;
begin
  perform private.beta_check_secret(p_secret);
  select * into r from private.moments_drafts where id = p_id;
  return jsonb_build_object('ok', true, 'draft', case when r.id is null then null else private.moments_draft_json(r) end);
end;
$$;

-- Approves or rejects a draft that is ready; anything else is refused.
create function public.moments_draft_decide(p_secret text, p_id uuid, p_decision text, p_by text, p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r private.moments_drafts%rowtype;
begin
  perform private.beta_check_secret(p_secret);
  if p_decision not in ('approved', 'rejected') then
    return jsonb_build_object('ok', false, 'error', 'bad_decision');
  end if;
  update private.moments_drafts
     set status = p_decision, decided_by = p_by, decided_at = p_now, updated_at = p_now
   where id = p_id and status = 'ready'
  returning * into r;
  if r.id is not null then
    return jsonb_build_object('ok', true, 'draft', private.moments_draft_json(r));
  end if;
  if exists (select 1 from private.moments_drafts where id = p_id) then
    return jsonb_build_object('ok', false, 'error', 'not_ready');
  end if;
  return jsonb_build_object('ok', false, 'error', 'not_found');
end;
$$;

-- Approves every ready draft at once.
create function public.moments_drafts_approve_all(p_secret text, p_by text, p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  perform private.beta_check_secret(p_secret);
  with done as (
    update private.moments_drafts
       set status = 'approved', decided_by = p_by, decided_at = p_now, updated_at = p_now
     where status = 'ready'
    returning id
  )
  select coalesce(array_agg(id), '{}') into v_ids from done;
  return jsonb_build_object('ok', true, 'drafts', coalesce((
    select jsonb_agg(private.moments_draft_json(d) order by d.created_at desc, d.id desc)
      from private.moments_drafts d where d.id = any(v_ids)
  ), '[]'::jsonb));
end;
$$;

-- The clip (or card) of a draft not yet decided; the draft is then ready.
create function public.moments_draft_media_put(p_secret text, p_id uuid, p_type text, p_base64 text, p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r private.moments_drafts%rowtype;
  v_bytes bytea;
begin
  perform private.beta_check_secret(p_secret);
  select * into r from private.moments_drafts where id = p_id for update;
  if r.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if r.status not in ('filming', 'ready') then
    return jsonb_build_object('ok', false, 'error', 'decided');
  end if;
  v_bytes := decode(p_base64, 'base64');
  insert into private.moments_media (draft_id, type, bytes, created_at)
  values (p_id, p_type, v_bytes, p_now)
  on conflict (draft_id) do update set type = excluded.type, bytes = excluded.bytes, created_at = excluded.created_at;
  update private.moments_drafts
     set status = 'ready', media_type = p_type, media_bytes = octet_length(v_bytes), updated_at = p_now
   where id = p_id
  returning * into r;
  return jsonb_build_object('ok', true, 'draft', private.moments_draft_json(r));
end;
$$;

create function public.moments_draft_media_get(p_secret text, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  m private.moments_media%rowtype;
begin
  perform private.beta_check_secret(p_secret);
  select * into m from private.moments_media where draft_id = p_id;
  if m.draft_id is null then
    return jsonb_build_object('ok', true, 'media', null);
  end if;
  return jsonb_build_object('ok', true, 'media', jsonb_build_object('type', m.type, 'base64', encode(m.bytes, 'base64')));
end;
$$;

-- Claims an approved draft for sending, only while the switch is on: one
-- UPDATE ... RETURNING, so of two deliveries at once one gets the row and the
-- other gets null (the second waits on the row lock, then finds `sending`).
create function public.moments_draft_claim(p_secret text, p_id uuid, p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r private.moments_drafts%rowtype;
begin
  perform private.beta_check_secret(p_secret);
  update private.moments_drafts d
     set status = 'sending', updated_at = p_now
   where d.id = p_id and d.status = 'approved'
     and exists (select 1 from private.moments_switch s where s.id and s.autopost_on)
  returning d.* into r;
  return jsonb_build_object('ok', true, 'draft', case when r.id is null then null else private.moments_draft_json(r) end);
end;
$$;

-- What became of a claimed draft when a sender was asked. Only a `sending`
-- draft moves; `approved` puts it back in line with the sender's note.
create function public.moments_draft_delivered(p_secret text, p_id uuid, p_status text, p_note text, p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r private.moments_drafts%rowtype;
begin
  perform private.beta_check_secret(p_secret);
  if p_status not in ('sent', 'failed', 'approved') then
    return jsonb_build_object('ok', false, 'error', 'bad_status');
  end if;
  update private.moments_drafts
     set status = p_status, note = left(p_note, 300), updated_at = p_now
   where id = p_id and status = 'sending'
  returning * into r;
  if r.id is null then
    select * into r from private.moments_drafts where id = p_id;
  end if;
  return jsonb_build_object('ok', true, 'draft', case when r.id is null then null else private.moments_draft_json(r) end);
end;
$$;

create function public.moments_switch_get(p_secret text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.beta_check_secret(p_secret);
  return jsonb_build_object('ok', true, 'switch', private.moments_switch_json());
end;
$$;

create function public.moments_switch_set(p_secret text, p_on boolean, p_by text, p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.beta_check_secret(p_secret);
  if p_on is null then
    return jsonb_build_object('ok', false, 'error', 'bad_switch');
  end if;
  insert into private.moments_switch (id, autopost_on, changed_by, changed_at)
  values (true, p_on, p_by, p_now)
  on conflict (id) do update set autopost_on = excluded.autopost_on, changed_by = excluded.changed_by, changed_at = excluded.changed_at;
  return jsonb_build_object('ok', true, 'switch', private.moments_switch_json());
end;
$$;

revoke all on function public.moments_draft_put(text, text, text, jsonb, text, text, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.moments_drafts_list(text, text, integer) from public, anon, authenticated, service_role;
revoke all on function public.moments_draft_get(text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.moments_draft_decide(text, uuid, text, text, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.moments_drafts_approve_all(text, text, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.moments_draft_media_put(text, uuid, text, text, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.moments_draft_media_get(text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.moments_draft_claim(text, uuid, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.moments_draft_delivered(text, uuid, text, text, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.moments_switch_get(text) from public, anon, authenticated, service_role;
revoke all on function public.moments_switch_set(text, boolean, text, timestamptz) from public, anon, authenticated, service_role;

grant execute on function public.moments_draft_put(text, text, text, jsonb, text, text, timestamptz) to anon;
grant execute on function public.moments_drafts_list(text, text, integer) to anon;
grant execute on function public.moments_draft_get(text, uuid) to anon;
grant execute on function public.moments_draft_decide(text, uuid, text, text, timestamptz) to anon;
grant execute on function public.moments_drafts_approve_all(text, text, timestamptz) to anon;
grant execute on function public.moments_draft_media_put(text, uuid, text, text, timestamptz) to anon;
grant execute on function public.moments_draft_media_get(text, uuid) to anon;
grant execute on function public.moments_draft_claim(text, uuid, timestamptz) to anon;
grant execute on function public.moments_draft_delivered(text, uuid, text, text, timestamptz) to anon;
grant execute on function public.moments_switch_get(text) to anon;
grant execute on function public.moments_switch_set(text, boolean, text, timestamptz) to anon;

commit;
