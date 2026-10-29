-- Ryntra City: the X publisher's ledger (task CITY-39).
--
-- PREPARED 2026-10-27 as a file only. Not applied to any Supabase project:
-- It needs the drafts queue of CITY-3 first
-- (`20261027150000_city_moments_drafts_v1.sql`). Checked on a throwaway local
-- PostgreSQL 16 with the Supabase roles and a hostile default-grant posture
-- (see `city/lib/x/sql.test.mjs`).
--
-- WHAT THIS FILE DOES
--   * One row per post the publisher set out to make: the slot of the day it
--     took (`2026-10-27 18:00`, local time), the draft, the hashes of the
--     words and of the clip, whether the words hold a link, what the post
--     costs, and what became of it (`sending` -> `sent` | `failed` | `unsure`).
--   * The rules that keep the city from posting twice are unique indexes, so
--     a refusal is atomic: a slot is taken once; while a post is `sending`,
--     `sent` or `unsure` (it may have gone out), no other row may carry the
--     same words or the same clip.
--   * Nor a near-duplicate: a row whose words have the same shape (the words
--     once numbers and links are taken out) as a live row started in the last
--     20 hours is refused. That check runs in the reserve function before the
--     insert; two passes at once are in the same slot, which its index settles.
--   * Everything lives in `private` with row level security forced, no
--     policies and every grant revoked. The server reads and writes only
--     through the `public.x_post*` functions below, each gated by the app
--     secret (`private.beta_check_secret`).
--
-- WHAT IT DOES NOT DO
--   No keys: no X credential has a column. Nothing here talks to X.

begin;

create table private.x_posts (
  slot text primary key check (slot ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}$'),
  day date not null,
  draft_id uuid not null references private.moments_drafts(id) on delete restrict,
  text_hash text not null check (text_hash ~ '^[0-9a-f]{64}$'),
  shape_hash text not null check (shape_hash ~ '^[0-9a-f]{64}$'),
  media_hash text check (media_hash is null or media_hash ~ '^[0-9a-f]{64}$'),
  link boolean not null,
  cost_usd numeric(8, 5) not null check (cost_usd >= 0 and cost_usd <= 10),
  status text not null default 'sending' check (status in ('sending', 'sent', 'failed', 'unsure')),
  post_id text check (post_id is null or post_id ~ '^[0-9]{1,30}$'),
  error text check (error is null or char_length(error) <= 300),
  started_at timestamptz not null,
  done_at timestamptz,
  check (to_char(day, 'YYYY-MM-DD') = left(slot, 10)),
  check ((status = 'sending') = (done_at is null)),
  check ((status = 'sent') = (post_id is not null))
);

create index x_posts_day_idx on private.x_posts (day, slot);
create unique index x_posts_live_text_idx on private.x_posts (text_hash)
  where status in ('sending', 'sent', 'unsure');
create unique index x_posts_live_media_idx on private.x_posts (media_hash)
  where media_hash is not null and status in ('sending', 'sent', 'unsure');
create index x_posts_live_shape_idx on private.x_posts (shape_hash, started_at desc)
  where status in ('sending', 'sent', 'unsure');

alter table private.x_posts enable row level security;
alter table private.x_posts force row level security;

revoke all privileges on table private.x_posts from public, anon, authenticated, service_role;

create function private.x_post_json(r private.x_posts)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'slot', r.slot, 'day', to_char(r.day, 'YYYY-MM-DD'), 'draftId', r.draft_id, 'textHash', r.text_hash,
    'shapeHash', r.shape_hash, 'mediaHash', r.media_hash, 'link', r.link, 'costUsd', r.cost_usd, 'status', r.status, 'postId', r.post_id,
    'error', r.error, 'startedAt', private.moments_iso(r.started_at), 'doneAt', private.moments_iso(r.done_at)
  );
$$;

revoke all on function private.x_post_json(private.x_posts) from public, anon, authenticated, service_role;

-- Takes a slot for a draft, or names what is in the way, in this order:
-- `slot` (taken), `text` or `media` (a live post has the same words or
-- clip), `shape` (a live post started in the last 20 hours has the same
-- shape). The unique indexes settle a race the checks before the insert
-- cannot see.
create function public.x_post_reserve(
  p_secret text,
  p_slot text,
  p_day date,
  p_draft_id uuid,
  p_text_hash text,
  p_shape_hash text,
  p_media_hash text,
  p_link boolean,
  p_cost_usd numeric,
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r private.x_posts%rowtype;
  v_draft uuid;
begin
  perform private.beta_check_secret(p_secret);
  select draft_id into v_draft from private.x_posts where slot = p_slot;
  if v_draft is not null then
    return jsonb_build_object('ok', false, 'error', 'slot', 'draftId', v_draft);
  end if;
  select draft_id into v_draft from private.x_posts
   where text_hash = p_text_hash and status in ('sending', 'sent', 'unsure') limit 1;
  if v_draft is not null then
    return jsonb_build_object('ok', false, 'error', 'text', 'draftId', v_draft);
  end if;
  if p_media_hash is not null then
    select draft_id into v_draft from private.x_posts
     where media_hash = p_media_hash and status in ('sending', 'sent', 'unsure') limit 1;
    if v_draft is not null then
      return jsonb_build_object('ok', false, 'error', 'media', 'draftId', v_draft);
    end if;
  end if;
  select draft_id into v_draft from private.x_posts
   where shape_hash = p_shape_hash and status in ('sending', 'sent', 'unsure')
     and started_at > p_now - interval '20 hours'
   order by started_at desc limit 1;
  if v_draft is not null then
    return jsonb_build_object('ok', false, 'error', 'shape', 'draftId', v_draft);
  end if;
  begin
    insert into private.x_posts (slot, day, draft_id, text_hash, shape_hash, media_hash, link, cost_usd, started_at)
    values (p_slot, p_day, p_draft_id, p_text_hash, p_shape_hash, p_media_hash, p_link, p_cost_usd, p_now)
    returning * into r;
    return jsonb_build_object('ok', true, 'post', private.x_post_json(r));
  exception when unique_violation then
    select draft_id into v_draft from private.x_posts where slot = p_slot;
    if v_draft is not null then
      return jsonb_build_object('ok', false, 'error', 'slot', 'draftId', v_draft);
    end if;
    select draft_id into v_draft from private.x_posts
     where text_hash = p_text_hash and status in ('sending', 'sent', 'unsure');
    if v_draft is not null then
      return jsonb_build_object('ok', false, 'error', 'text', 'draftId', v_draft);
    end if;
    select draft_id into v_draft from private.x_posts
     where media_hash = p_media_hash and status in ('sending', 'sent', 'unsure');
    return jsonb_build_object('ok', false, 'error', 'media', 'draftId', v_draft);
  end;
end;
$$;

-- What became of a post; only a `sending` row moves.
create function public.x_post_finish(p_secret text, p_slot text, p_status text, p_post_id text, p_error text, p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r private.x_posts%rowtype;
begin
  perform private.beta_check_secret(p_secret);
  if p_status not in ('sent', 'failed', 'unsure') then
    return jsonb_build_object('ok', false, 'error', 'bad_status');
  end if;
  update private.x_posts
     set status = p_status, post_id = p_post_id, error = left(p_error, 300), done_at = p_now
   where slot = p_slot and status = 'sending'
  returning * into r;
  if r.slot is null then
    select * into r from private.x_posts where slot = p_slot;
  end if;
  return jsonb_build_object('ok', true, 'post', case when r.slot is null then null else private.x_post_json(r) end);
end;
$$;

-- The rows of one local day, by slot.
create function public.x_posts_day(p_secret text, p_day date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.beta_check_secret(p_secret);
  return jsonb_build_object('ok', true, 'posts', coalesce((
    select jsonb_agg(private.x_post_json(p) order by p.slot) from private.x_posts p where p.day = p_day
  ), '[]'::jsonb));
end;
$$;

revoke all on function public.x_post_reserve(text, text, date, uuid, text, text, text, boolean, numeric, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.x_post_finish(text, text, text, text, text, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.x_posts_day(text, date) from public, anon, authenticated, service_role;

grant execute on function public.x_post_reserve(text, text, date, uuid, text, text, text, boolean, numeric, timestamptz) to anon;
grant execute on function public.x_post_finish(text, text, text, text, text, timestamptz) to anon;
grant execute on function public.x_posts_day(text, date) to anon;

commit;
