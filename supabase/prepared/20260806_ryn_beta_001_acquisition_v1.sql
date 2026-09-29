-- RYN-BETA-001 · prepared, NOT APPLIED to production.
--
-- Acquisition attribution and funnel events for the X -> Telegram -> first-value path.
--
-- Design boundaries this file must keep:
--   * analytics is descriptive. Nothing here grants access, priority, status or reward.
--   * first touch is immutable: the primary key makes a later touch a no-op, so a race
--     cannot rewrite where a user came from.
--   * no raw public identity is stored. No IP, no X handle, no Telegram username, no
--     wallet address, no referrer, no message text. Rows key on the internal user UUID.
--   * erasure cascades: deleting a beta user deletes their acquisition record and events.
--   * every input is validated server-side against a closed grammar and enum.
--   * no dynamic SQL anywhere; `search_path` is empty and every name is fully qualified.
--
-- Until this is applied under a separate explicit approval, `lib/growth/attribution.ts`
-- receives a PostgREST error for these functions, reports it sampled, and returns
-- `unavailable`. Access and the paper workflow are unaffected by design.
--
-- ROLLBACK / RECOVERY
--   Reverting only the contract, keeping collected rows:
--     drop function if exists public.beta_record_acquisition_touch(text, bigint, text, text, text, text);
--     drop function if exists public.beta_record_funnel_event(text, bigint, text, text, text);
--     drop function if exists public.beta_acquisition_counts(text);
--   Full removal, destroying collected rows:
--     drop table if exists public.beta_funnel_event;
--     drop table if exists public.beta_acquisition_touch;
--   Neither step touches beta_users, beta_tasks, beta_access or any product table, so a
--   rollback cannot remove a user's access. Application callers degrade to `unavailable`.

begin;

-- ---------------------------------------------------------------- tables

/* One row per user: the first acquisition touch, and only the first. */
create table if not exists public.beta_acquisition_touch (
  user_id     uuid primary key references public.beta_users(id) on delete cascade,
  source      text        not null,
  campaign_id text        not null,
  content_id  text        not null,
  variant_id  text        not null,
  created_at  timestamptz not null default now(),
  constraint beta_acquisition_touch_source_chk
    check (source in ('x')),
  constraint beta_acquisition_touch_campaign_chk
    check (campaign_id ~ '^[A-Za-z0-9-]{1,16}$'),
  constraint beta_acquisition_touch_content_chk
    check (content_id ~ '^[A-Za-z0-9-]{1,16}$'),
  constraint beta_acquisition_touch_variant_chk
    check (variant_id ~ '^[A-Za-z0-9-]{1,16}$')
);

/* One row per (user, event, dedupe scope). The unique constraint is the deduplication:
   retries and concurrent calls collapse onto it rather than onto application logic. */
create table if not exists public.beta_funnel_event (
  id             uuid        primary key default gen_random_uuid(),
  user_id        uuid        not null references public.beta_users(id) on delete cascade,
  event          text        not null,
  first_value_id text,
  dedupe_key     text        not null,
  created_at     timestamptz not null default now(),
  constraint beta_funnel_event_name_chk
    check (event in ('bot_start', 'access_confirmed', 'first_value_started', 'first_value_completed')),
  constraint beta_funnel_event_first_value_chk
    check (
      (event in ('first_value_started', 'first_value_completed') and first_value_id = 'paper_plan')
      or (event in ('bot_start', 'access_confirmed') and first_value_id is null)
    ),
  constraint beta_funnel_event_dedupe_chk
    check (dedupe_key ~ '^[A-Za-z0-9_-]{1,64}$'),
  constraint beta_funnel_event_unique unique (user_id, event, dedupe_key)
);

create index if not exists beta_funnel_event_user_idx on public.beta_funnel_event (user_id);
create index if not exists beta_acquisition_touch_campaign_idx
  on public.beta_acquisition_touch (campaign_id, content_id, variant_id);

-- ---------------------------------------------------------------- access control

/* Fail closed: RLS on, FORCE so the owner is not exempt, and deliberately no policies.
   Every legitimate read and write goes through the secret-gated functions below. */
alter table public.beta_acquisition_touch enable row level security;
alter table public.beta_acquisition_touch force row level security;
alter table public.beta_funnel_event enable row level security;
alter table public.beta_funnel_event force row level security;

revoke all on public.beta_acquisition_touch from anon, authenticated;
revoke all on public.beta_funnel_event from anon, authenticated;

-- ---------------------------------------------------------------- functions

/**
 * Records the first acquisition touch. A later touch is a no-op, not an update — the
 * primary key decides, so first touch survives races and retries alike.
 *
 * Returns 'recorded' on the first touch and 'duplicate' afterwards. An unknown user is an
 * exception rather than a silent write, so a bad caller cannot invent acquisition rows.
 */
create or replace function public.beta_record_acquisition_touch(
  p_secret      text,
  p_telegram_id bigint,
  p_source      text,
  p_campaign_id text,
  p_content_id  text,
  p_variant_id  text
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_inserted int;
begin
  perform private.beta_check_secret(p_secret);

  if p_source is distinct from 'x' then
    raise exception 'unsupported source';
  end if;
  if p_campaign_id !~ '^[A-Za-z0-9-]{1,16}$'
     or p_content_id !~ '^[A-Za-z0-9-]{1,16}$'
     or p_variant_id !~ '^[A-Za-z0-9-]{1,16}$' then
    raise exception 'invalid campaign component';
  end if;

  select id into v_user_id from public.beta_users where telegram_id = p_telegram_id;
  if v_user_id is null then raise exception 'user not found'; end if;

  insert into public.beta_acquisition_touch (user_id, source, campaign_id, content_id, variant_id)
  values (v_user_id, p_source, p_campaign_id, p_content_id, p_variant_id)
  on conflict (user_id) do nothing;

  get diagnostics v_inserted = row_count;
  return case when v_inserted > 0 then 'recorded' else 'duplicate' end;
end $$;

/**
 * Records one funnel event, deduplicated on (user, event, dedupe key).
 *
 * The once-per-user events are enforced here rather than trusted from the caller: the
 * dedupe key is overwritten with a constant, so no client can create a second
 * `first_value_completed` by varying it.
 */
create or replace function public.beta_record_funnel_event(
  p_secret         text,
  p_telegram_id    bigint,
  p_event          text,
  p_first_value_id text,
  p_dedupe_key     text
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_key     text;
  v_fv      text;
  v_inserted int;
begin
  perform private.beta_check_secret(p_secret);

  if p_event not in ('bot_start', 'access_confirmed', 'first_value_started', 'first_value_completed') then
    raise exception 'unknown event';
  end if;

  /* Once per user, whatever the caller sends. */
  if p_event in ('access_confirmed', 'first_value_started', 'first_value_completed') then
    v_key := 'once';
  else
    v_key := coalesce(p_dedupe_key, 'once');
  end if;
  if v_key !~ '^[A-Za-z0-9_-]{1,64}$' then
    raise exception 'invalid dedupe key';
  end if;

  /* The first-value identifier is derived, never accepted, so an event cannot be
     relabelled into a different first value by a caller. */
  if p_event in ('first_value_started', 'first_value_completed') then
    v_fv := 'paper_plan';
  else
    v_fv := null;
  end if;

  select id into v_user_id from public.beta_users where telegram_id = p_telegram_id;
  if v_user_id is null then raise exception 'user not found'; end if;

  insert into public.beta_funnel_event (user_id, event, first_value_id, dedupe_key)
  values (v_user_id, p_event, v_fv, v_key)
  on conflict (user_id, event, dedupe_key) do nothing;

  get diagnostics v_inserted = row_count;
  return case when v_inserted > 0 then 'recorded' else 'duplicate' end;
end $$;

/**
 * Aggregate counts by campaign, content, variant and stage. Counts only — no rates, so
 * nothing here can divide by a zero or missing denominator, and no row exposes a user.
 *
 * Users with no recorded touch are grouped under a null campaign rather than dropped,
 * because silently omitting them would overstate how much of the funnel is attributed.
 */
create or replace function public.beta_acquisition_counts(p_secret text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_out jsonb;
begin
  perform private.beta_check_secret(p_secret);

  select coalesce(jsonb_agg(row_to_json(r)::jsonb order by r.campaign_id, r.content_id, r.variant_id, r.event), '[]'::jsonb)
    into v_out
  from (
    select
      t.campaign_id,
      t.content_id,
      t.variant_id,
      e.event,
      count(*) as events
    from public.beta_funnel_event e
    left join public.beta_acquisition_touch t on t.user_id = e.user_id
    group by t.campaign_id, t.content_id, t.variant_id, e.event
  ) r;

  return v_out;
end $$;

-- Anon-only, matching the existing beta_* RPC pattern: the app-secret gate above is the
-- real boundary, and a leaked anon key alone grants nothing.
revoke all on function public.beta_record_acquisition_touch(text, bigint, text, text, text, text) from public;
revoke all on function public.beta_record_funnel_event(text, bigint, text, text, text) from public;
revoke all on function public.beta_acquisition_counts(text) from public;
grant execute on function public.beta_record_acquisition_touch(text, bigint, text, text, text, text) to anon;
grant execute on function public.beta_record_funnel_event(text, bigint, text, text, text) to anon;
grant execute on function public.beta_acquisition_counts(text) to anon;

commit;
