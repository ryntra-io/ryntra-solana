-- RYN-ADMIN-002 feedback inbox.
-- APPLIED to production project lbphobwqzwdkbmyedlwb via SQL Editor on
-- 2026-08-30 by the founder. Result: Success. No rows returned.
-- Live RPC probe the same day: admin_feedback_open_count n=0; list empty;
-- wrong secret denied.
--
-- Invariants:
--   * private tables; ENABLE + FORCE RLS; no policies; ACL revoked
--   * SECURITY DEFINER RPCs have empty search_path and the beta secret gate
--   * no wallet balance, P&L or trade size columns
--   * message body is support data, not an analytics event

begin;

create table private.feedback_threads (
  id uuid primary key default gen_random_uuid(),
  public_ref text not null unique check (public_ref ~ '^RYN-FB-[0-9A-F]{8}$'),
  source text not null check (source in ('site', 'app', 'bot')),
  category text not null check (category in ('bug', 'idea', 'security', 'other')),
  status text not null check (status in ('OPEN', 'WAITING', 'CLOSED')),
  priority text not null check (priority in ('NORMAL', 'SECURITY')),
  telegram_id bigint check (telegram_id is null or telegram_id > 0),
  locale text,
  route text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create index feedback_threads_updated_idx
  on private.feedback_threads (updated_at desc, created_at desc);

create table private.feedback_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references private.feedback_threads(id) on delete restrict,
  author text not null check (author in ('user', 'admin')),
  body text not null check (char_length(btrim(body)) between 2 and 4000),
  delivery_outcome text
    check (delivery_outcome in ('pending', 'sent', 'failed', 'blocked', 'not_applicable')),
  created_at timestamptz not null default clock_timestamp()
);

create index feedback_messages_thread_idx
  on private.feedback_messages (thread_id, created_at);

create table private.feedback_drafts (
  telegram_id bigint primary key check (telegram_id > 0),
  category text not null check (category in ('bug', 'idea', 'security', 'other')),
  created_at timestamptz not null default clock_timestamp()
);

alter table private.feedback_threads enable row level security;
alter table private.feedback_threads force row level security;
alter table private.feedback_messages enable row level security;
alter table private.feedback_messages force row level security;
alter table private.feedback_drafts enable row level security;
alter table private.feedback_drafts force row level security;

revoke all privileges on table
  private.feedback_threads,
  private.feedback_messages,
  private.feedback_drafts
from public, anon, authenticated, service_role;

create function public.admin_feedback_open(
  p_secret text,
  p_source text,
  p_category text,
  p_body text,
  p_telegram_id bigint,
  p_locale text,
  p_route text,
  p_public_ref text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_priority text;
  v_status text := 'OPEN';
begin
  perform private.beta_check_secret(p_secret);
  if p_source not in ('site', 'app', 'bot') then
    return jsonb_build_object('ok', false, 'error', 'bad_source');
  end if;
  if p_category not in ('bug', 'idea', 'security', 'other') then
    return jsonb_build_object('ok', false, 'error', 'bad_category');
  end if;
  if p_public_ref is null or p_public_ref !~ '^RYN-FB-[0-9A-F]{8}$' then
    return jsonb_build_object('ok', false, 'error', 'bad_ref');
  end if;
  if p_body is null or char_length(btrim(p_body)) < 10 or char_length(p_body) > 4000 then
    return jsonb_build_object('ok', false, 'error', 'bad_body');
  end if;
  v_priority := case when p_category = 'security' then 'SECURITY' else 'NORMAL' end;
  insert into private.feedback_threads (
    public_ref, source, category, status, priority, telegram_id, locale, route
  ) values (
    p_public_ref, p_source, p_category, v_status, v_priority,
    case when p_telegram_id is not null and p_telegram_id > 0 then p_telegram_id else null end,
    nullif(btrim(coalesce(p_locale, '')), ''),
    nullif(btrim(coalesce(p_route, '')), '')
  )
  returning id into v_id;
  insert into private.feedback_messages (thread_id, author, body, delivery_outcome)
  values (v_id, 'user', btrim(p_body), 'not_applicable');
  if p_telegram_id is not null and p_telegram_id > 0 then
    delete from private.feedback_drafts where telegram_id = p_telegram_id;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id, 'public_ref', p_public_ref, 'priority', v_priority);
end;
$$;

create function public.admin_feedback_list(p_secret text, p_limit integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.beta_check_secret(p_secret);
  return coalesce((
    select jsonb_agg(row_to_json(t)::jsonb)
      from (
        select
          th.id,
          th.public_ref,
          th.source,
          th.category,
          th.status,
          th.priority,
          th.telegram_id,
          th.locale,
          th.created_at,
          th.updated_at,
          left(coalesce((
            select m.body from private.feedback_messages m
             where m.thread_id = th.id
             order by m.created_at
             limit 1
          ), ''), 80) as preview
          from private.feedback_threads th
         order by th.priority desc, th.updated_at desc
         limit least(greatest(coalesce(p_limit, 50), 1), 200)
      ) t
  ), '[]'::jsonb);
end;
$$;

create function public.admin_feedback_get(p_secret text, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_thread jsonb;
  v_messages jsonb;
begin
  perform private.beta_check_secret(p_secret);
  select jsonb_build_object(
    'id', th.id,
    'public_ref', th.public_ref,
    'source', th.source,
    'category', th.category,
    'status', th.status,
    'priority', th.priority,
    'telegram_id', th.telegram_id,
    'locale', th.locale,
    'route', th.route,
    'created_at', th.created_at,
    'updated_at', th.updated_at
  ) into v_thread
    from private.feedback_threads th
   where th.id = p_id;
  if v_thread is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', m.id,
    'author', m.author,
    'body', m.body,
    'delivery_outcome', m.delivery_outcome,
    'created_at', m.created_at
  ) order by m.created_at), '[]'::jsonb)
    into v_messages
    from private.feedback_messages m
   where m.thread_id = p_id;
  return jsonb_build_object('ok', true, 'thread', v_thread, 'messages', v_messages);
end;
$$;

create function public.admin_feedback_reply(
  p_secret text,
  p_id uuid,
  p_body text,
  p_actor bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_telegram bigint;
  v_msg uuid;
begin
  perform private.beta_check_secret(p_secret);
  if p_body is null or char_length(btrim(p_body)) < 2 or char_length(p_body) > 4000 then
    return jsonb_build_object('ok', false, 'error', 'bad_body');
  end if;
  select telegram_id into v_telegram from private.feedback_threads where id = p_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  insert into private.feedback_messages (thread_id, author, body, delivery_outcome)
  values (p_id, 'admin', btrim(p_body), case when v_telegram is null then 'not_applicable' else 'pending' end)
  returning id into v_msg;
  update private.feedback_threads
     set status = 'WAITING', updated_at = clock_timestamp()
   where id = p_id;
  return jsonb_build_object(
    'ok', true,
    'message_id', v_msg,
    'telegram_id', v_telegram,
    'needs_bot', v_telegram is not null
  );
end;
$$;

create function public.admin_feedback_delivery(
  p_secret text,
  p_message_id uuid,
  p_outcome text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.beta_check_secret(p_secret);
  if p_outcome not in ('sent', 'failed', 'blocked', 'not_applicable') then
    return jsonb_build_object('ok', false, 'error', 'bad_outcome');
  end if;
  update private.feedback_messages
     set delivery_outcome = p_outcome
   where id = p_message_id and author = 'admin';
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

create function public.admin_feedback_set_state(
  p_secret text,
  p_id uuid,
  p_status text,
  p_reason text,
  p_actor bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.beta_check_secret(p_secret);
  if p_status not in ('OPEN', 'WAITING', 'CLOSED') then
    return jsonb_build_object('ok', false, 'error', 'bad_status');
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 3 then
    return jsonb_build_object('ok', false, 'error', 'bad_reason');
  end if;
  update private.feedback_threads
     set status = p_status, updated_at = clock_timestamp()
   where id = p_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  return jsonb_build_object('ok', true, 'status', p_status);
end;
$$;

create function public.admin_feedback_open_count(p_secret text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  perform private.beta_check_secret(p_secret);
  select count(*)::integer into v_n
    from private.feedback_threads
   where status in ('OPEN', 'WAITING');
  return jsonb_build_object('ok', true, 'n', v_n);
end;
$$;

create function public.admin_feedback_draft_set(
  p_secret text,
  p_telegram_id bigint,
  p_category text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.beta_check_secret(p_secret);
  if p_telegram_id is null or p_telegram_id <= 0 then
    return jsonb_build_object('ok', false, 'error', 'bad_user');
  end if;
  if p_category not in ('bug', 'idea', 'security', 'other') then
    return jsonb_build_object('ok', false, 'error', 'bad_category');
  end if;
  insert into private.feedback_drafts (telegram_id, category, created_at)
  values (p_telegram_id, p_category, clock_timestamp())
  on conflict (telegram_id) do update
    set category = excluded.category, created_at = clock_timestamp();
  return jsonb_build_object('ok', true, 'category', p_category);
end;
$$;

create function public.admin_feedback_draft_get(p_secret text, p_telegram_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_category text;
begin
  perform private.beta_check_secret(p_secret);
  select category into v_category
    from private.feedback_drafts
   where telegram_id = p_telegram_id
     and created_at > clock_timestamp() - interval '30 minutes';
  if not found then
    return jsonb_build_object('ok', true, 'category', null);
  end if;
  return jsonb_build_object('ok', true, 'category', v_category);
end;
$$;

revoke all on function
  public.admin_feedback_open(text, text, text, text, bigint, text, text, text),
  public.admin_feedback_list(text, integer),
  public.admin_feedback_get(text, uuid),
  public.admin_feedback_reply(text, uuid, text, bigint),
  public.admin_feedback_delivery(text, uuid, text),
  public.admin_feedback_set_state(text, uuid, text, text, bigint),
  public.admin_feedback_open_count(text),
  public.admin_feedback_draft_set(text, bigint, text),
  public.admin_feedback_draft_get(text, bigint)
from public, authenticated, service_role;

grant execute on function
  public.admin_feedback_open(text, text, text, text, bigint, text, text, text),
  public.admin_feedback_list(text, integer),
  public.admin_feedback_get(text, uuid),
  public.admin_feedback_reply(text, uuid, text, bigint),
  public.admin_feedback_delivery(text, uuid, text),
  public.admin_feedback_set_state(text, uuid, text, text, bigint),
  public.admin_feedback_open_count(text),
  public.admin_feedback_draft_set(text, bigint, text),
  public.admin_feedback_draft_get(text, bigint)
to anon;

commit;
