-- Admin Broadcast Center.
-- NOT applied to production. Applied by hand in the SQL Editor on
-- project lbphobwqzwdkbmyedlwb, and on no other database.
--
-- Invariants:
--   * private tables; ENABLE + FORCE RLS; no policies; ACL revoked
--   * SECURITY DEFINER RPCs have empty search_path and the beta secret gate
--   * no wallet balance, P&L, trade size or read-receipt columns
--   * enqueue refuses a campaign that has not been owner-tested

begin;

create table private.broadcast_campaigns (
  id uuid primary key default gen_random_uuid(),
  public_ref text not null unique check (public_ref ~ '^RYN-BC-[0-9A-F]{8}$'),
  name text not null check (char_length(btrim(name)) between 2 and 80),
  audience text not null check (audience in ('verified', 'all')),
  state text not null check (state in (
    'DRAFT', 'READY', 'SCHEDULED', 'QUEUED', 'SENDING', 'COMPLETED', 'PARTIAL', 'CANCELLED'
  )),
  body text not null check (char_length(btrim(body)) between 2 and 3500),
  cta text,
  test_sent_at timestamptz,
  scheduled_at timestamptz,
  created_by bigint not null check (created_by > 0),
  queued_count integer not null default 0,
  sent_count integer not null default 0,
  failed_count integer not null default 0,
  blocked_count integer not null default 0,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create index broadcast_campaigns_updated_idx
  on private.broadcast_campaigns (updated_at desc, created_at desc);

create table private.broadcast_deliveries (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references private.broadcast_campaigns(id) on delete restrict,
  telegram_id bigint not null check (telegram_id > 0),
  state text not null check (state in ('QUEUED', 'SENT', 'RETRY', 'FAILED', 'BLOCKED', 'SENDING')),
  attempts integer not null default 0 check (attempts >= 0),
  last_error_class text check (last_error_class in ('blocked', 'retry', 'failed') or last_error_class is null),
  retry_after timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  unique (campaign_id, telegram_id)
);

create index broadcast_deliveries_claim_idx
  on private.broadcast_deliveries (state, retry_after, created_at);

alter table private.broadcast_campaigns enable row level security;
alter table private.broadcast_campaigns force row level security;
alter table private.broadcast_deliveries enable row level security;
alter table private.broadcast_deliveries force row level security;

revoke all privileges on table
  private.broadcast_campaigns,
  private.broadcast_deliveries
from public, anon, authenticated, service_role;

create function public.admin_broadcast_create(
  p_secret text,
  p_name text,
  p_audience text,
  p_body text,
  p_cta text,
  p_public_ref text,
  p_actor bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform private.beta_check_secret(p_secret);
  if p_actor is null or p_actor <= 0 then
    return jsonb_build_object('ok', false, 'error', 'bad_actor');
  end if;
  if p_name is null or char_length(btrim(p_name)) < 2 or char_length(btrim(p_name)) > 80 then
    return jsonb_build_object('ok', false, 'error', 'bad_name');
  end if;
  if p_audience not in ('verified', 'all') then
    return jsonb_build_object('ok', false, 'error', 'bad_audience');
  end if;
  if p_body is null or char_length(btrim(p_body)) < 2 or char_length(p_body) > 3500 then
    return jsonb_build_object('ok', false, 'error', 'bad_body');
  end if;
  if p_public_ref is null or p_public_ref !~ '^RYN-BC-[0-9A-F]{8}$' then
    return jsonb_build_object('ok', false, 'error', 'bad_ref');
  end if;
  insert into private.broadcast_campaigns (
    public_ref, name, audience, state, body, cta, created_by
  ) values (
    p_public_ref, btrim(p_name), p_audience, 'DRAFT', btrim(p_body),
    nullif(btrim(coalesce(p_cta, '')), ''), p_actor
  )
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'public_ref', p_public_ref, 'state', 'DRAFT');
end;
$$;

create function public.admin_broadcast_list(p_secret text, p_limit integer)
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
          id, public_ref, name, audience, state, body,
          queued_count, sent_count, failed_count, blocked_count,
          test_sent_at, scheduled_at, created_at, updated_at
          from private.broadcast_campaigns
         order by updated_at desc
         limit least(greatest(coalesce(p_limit, 50), 1), 100)
      ) t
  ), '[]'::jsonb);
end;
$$;

create function public.admin_broadcast_get(p_secret text, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
begin
  perform private.beta_check_secret(p_secret);
  select row_to_json(c)::jsonb into v_row
    from private.broadcast_campaigns c
   where c.id = p_id;
  if v_row is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  return jsonb_build_object('ok', true, 'campaign', v_row);
end;
$$;

create function public.admin_broadcast_update(
  p_secret text,
  p_id uuid,
  p_name text,
  p_audience text,
  p_body text,
  p_cta text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state text;
begin
  perform private.beta_check_secret(p_secret);
  select state into v_state from private.broadcast_campaigns where id = p_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if v_state not in ('DRAFT', 'READY') then
    return jsonb_build_object('ok', false, 'error', 'frozen');
  end if;
  if p_name is null or char_length(btrim(p_name)) < 2 or char_length(btrim(p_name)) > 80 then
    return jsonb_build_object('ok', false, 'error', 'bad_name');
  end if;
  if p_audience not in ('verified', 'all') then
    return jsonb_build_object('ok', false, 'error', 'bad_audience');
  end if;
  if p_body is null or char_length(btrim(p_body)) < 2 or char_length(p_body) > 3500 then
    return jsonb_build_object('ok', false, 'error', 'bad_body');
  end if;
  update private.broadcast_campaigns
     set name = btrim(p_name),
         audience = p_audience,
         body = btrim(p_body),
         cta = nullif(btrim(coalesce(p_cta, '')), ''),
         state = 'DRAFT',
         test_sent_at = null,
         updated_at = clock_timestamp()
   where id = p_id;
  return jsonb_build_object('ok', true, 'state', 'DRAFT');
end;
$$;

create function public.admin_broadcast_mark_tested(
  p_secret text,
  p_id uuid,
  p_actor bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state text;
begin
  perform private.beta_check_secret(p_secret);
  if p_actor is null or p_actor <= 0 then
    return jsonb_build_object('ok', false, 'error', 'bad_actor');
  end if;
  select state into v_state from private.broadcast_campaigns where id = p_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if v_state not in ('DRAFT', 'READY') then
    return jsonb_build_object('ok', false, 'error', 'frozen');
  end if;
  update private.broadcast_campaigns
     set state = 'READY',
         test_sent_at = clock_timestamp(),
         updated_at = clock_timestamp()
   where id = p_id;
  return jsonb_build_object('ok', true, 'state', 'READY');
end;
$$;

create function public.admin_broadcast_preview(p_secret text, p_audience text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  perform private.beta_check_secret(p_secret);
  if p_audience not in ('verified', 'all') then
    return jsonb_build_object('ok', false, 'error', 'bad_audience');
  end if;
  if p_audience = 'verified' then
    select count(*)::integer into v_n
      from public.beta_users u
     where u.telegram_id is not null and u.telegram_id > 0
       and exists (
       select 1 from public.beta_tasks t
        where t.user_id = u.id
          and t.task_type = 'telegram_join'
          and t.status = 'verified'
     );
  else
    select count(*)::integer into v_n
      from public.beta_users u
     where u.telegram_id is not null and u.telegram_id > 0;
  end if;
  return jsonb_build_object('ok', true, 'n', coalesce(v_n, 0));
end;
$$;

create function public.admin_broadcast_enqueue(
  p_secret text,
  p_id uuid,
  p_actor bigint,
  p_scheduled_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row private.broadcast_campaigns%rowtype;
  v_n integer;
  v_state text;
begin
  perform private.beta_check_secret(p_secret);
  if p_actor is null or p_actor <= 0 then
    return jsonb_build_object('ok', false, 'error', 'bad_actor');
  end if;
  select * into v_row from private.broadcast_campaigns where id = p_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if v_row.state <> 'READY' or v_row.test_sent_at is null then
    return jsonb_build_object('ok', false, 'error', 'test_required');
  end if;
  if v_row.audience = 'verified' then
    insert into private.broadcast_deliveries (campaign_id, telegram_id, state)
    select p_id, u.telegram_id, 'QUEUED'
      from public.beta_users u
     where u.telegram_id is not null and u.telegram_id > 0
       and exists (
       select 1 from public.beta_tasks t
        where t.user_id = u.id
          and t.task_type = 'telegram_join'
          and t.status = 'verified'
     )
    on conflict (campaign_id, telegram_id) do nothing;
  else
    insert into private.broadcast_deliveries (campaign_id, telegram_id, state)
    select p_id, u.telegram_id, 'QUEUED'
      from public.beta_users u
     where u.telegram_id is not null and u.telegram_id > 0
    on conflict (campaign_id, telegram_id) do nothing;
  end if;
  select count(*)::integer into v_n
    from private.broadcast_deliveries
   where campaign_id = p_id;
  if v_n = 0 then
    return jsonb_build_object('ok', false, 'error', 'no_targets');
  end if;
  if p_scheduled_at is not null and p_scheduled_at > clock_timestamp() then
    v_state := 'SCHEDULED';
  else
    v_state := 'QUEUED';
  end if;
  update private.broadcast_campaigns
     set state = v_state,
         scheduled_at = p_scheduled_at,
         queued_count = v_n,
         updated_at = clock_timestamp()
   where id = p_id;
  return jsonb_build_object('ok', true, 'state', v_state, 'n', v_n);
end;
$$;

create function public.admin_broadcast_cancel(
  p_secret text,
  p_id uuid,
  p_actor bigint,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state text;
begin
  perform private.beta_check_secret(p_secret);
  if p_actor is null or p_actor <= 0 then
    return jsonb_build_object('ok', false, 'error', 'bad_actor');
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 2 then
    return jsonb_build_object('ok', false, 'error', 'bad_reason');
  end if;
  select state into v_state from private.broadcast_campaigns where id = p_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if v_state not in ('DRAFT', 'READY', 'SCHEDULED', 'QUEUED', 'SENDING') then
    return jsonb_build_object('ok', false, 'error', 'frozen');
  end if;
  update private.broadcast_campaigns
     set state = 'CANCELLED', updated_at = clock_timestamp()
   where id = p_id;
  return jsonb_build_object('ok', true, 'state', 'CANCELLED');
end;
$$;

create function public.admin_broadcast_due(p_secret text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.beta_check_secret(p_secret);
  update private.broadcast_campaigns
     set state = 'QUEUED', updated_at = clock_timestamp()
   where state = 'SCHEDULED'
     and scheduled_at is not null
     and scheduled_at <= clock_timestamp();
  return jsonb_build_object('ok', true);
end;
$$;

create function public.admin_broadcast_claim_batch(p_secret text, p_limit integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer;
begin
  perform private.beta_check_secret(p_secret);
  v_limit := least(greatest(coalesce(p_limit, 25), 1), 40);
  return coalesce((
    with picked as (
      select d.id
        from private.broadcast_deliveries d
        join private.broadcast_campaigns c on c.id = d.campaign_id
       where c.state in ('QUEUED', 'SENDING')
         and d.state in ('QUEUED', 'RETRY')
         and (d.retry_after is null or d.retry_after <= clock_timestamp())
       order by d.created_at
       limit v_limit
       for update of d skip locked
    ),
    marked as (
      update private.broadcast_deliveries d
         set state = 'SENDING', attempts = d.attempts + 1
        from picked p
       where d.id = p.id
      returning d.id, d.campaign_id, d.telegram_id
    )
    select jsonb_agg(jsonb_build_object(
      'id', m.id,
      'campaign_id', m.campaign_id,
      'telegram_id', m.telegram_id,
      'body', c.body
    ))
      from marked m
      join private.broadcast_campaigns c on c.id = m.campaign_id
  ), '[]'::jsonb);
end;
$$;

create function public.admin_broadcast_delivery_set(
  p_secret text,
  p_id uuid,
  p_state text,
  p_error_class text,
  p_retry_after timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.beta_check_secret(p_secret);
  if p_state not in ('SENT', 'RETRY', 'FAILED', 'BLOCKED') then
    return jsonb_build_object('ok', false, 'error', 'bad_state');
  end if;
  if p_error_class is not null and p_error_class not in ('blocked', 'retry', 'failed') then
    return jsonb_build_object('ok', false, 'error', 'bad_class');
  end if;
  update private.broadcast_deliveries
     set state = p_state,
         last_error_class = p_error_class,
         retry_after = p_retry_after,
         sent_at = case when p_state = 'SENT' then clock_timestamp() else sent_at end
   where id = p_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  return jsonb_build_object('ok', true, 'state', p_state);
end;
$$;

create function public.admin_broadcast_rollup(p_secret text, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_queued integer;
  v_sent integer;
  v_failed integer;
  v_blocked integer;
  v_state text;
  v_next text;
begin
  perform private.beta_check_secret(p_secret);
  select state into v_state from private.broadcast_campaigns where id = p_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  select
    count(*) filter (where state in ('QUEUED', 'RETRY', 'SENDING'))::integer,
    count(*) filter (where state = 'SENT')::integer,
    count(*) filter (where state = 'FAILED')::integer,
    count(*) filter (where state = 'BLOCKED')::integer
    into v_queued, v_sent, v_failed, v_blocked
    from private.broadcast_deliveries
   where campaign_id = p_id;
  v_next := v_state;
  if v_state <> 'CANCELLED' then
    if coalesce(v_queued, 0) = 0 and (coalesce(v_sent, 0) + coalesce(v_failed, 0) + coalesce(v_blocked, 0)) > 0 then
      v_next := case
        when coalesce(v_failed, 0) + coalesce(v_blocked, 0) = 0 then 'COMPLETED'
        else 'PARTIAL'
      end;
    elsif coalesce(v_sent, 0) + coalesce(v_failed, 0) + coalesce(v_blocked, 0) > 0 then
      v_next := 'SENDING';
    elsif v_state in ('QUEUED', 'SENDING') then
      v_next := 'QUEUED';
    end if;
  end if;
  update private.broadcast_campaigns
     set queued_count = coalesce(v_queued, 0),
         sent_count = coalesce(v_sent, 0),
         failed_count = coalesce(v_failed, 0),
         blocked_count = coalesce(v_blocked, 0),
         state = v_next,
         updated_at = clock_timestamp()
   where id = p_id;
  return jsonb_build_object(
    'ok', true,
    'state', v_next,
    'queued', coalesce(v_queued, 0),
    'sent', coalesce(v_sent, 0),
    'failed', coalesce(v_failed, 0),
    'blocked', coalesce(v_blocked, 0)
  );
end;
$$;

revoke all on function
  public.admin_broadcast_create(text, text, text, text, text, text, bigint),
  public.admin_broadcast_list(text, integer),
  public.admin_broadcast_get(text, uuid),
  public.admin_broadcast_update(text, uuid, text, text, text, text),
  public.admin_broadcast_mark_tested(text, uuid, bigint),
  public.admin_broadcast_preview(text, text),
  public.admin_broadcast_enqueue(text, uuid, bigint, timestamptz),
  public.admin_broadcast_cancel(text, uuid, bigint, text),
  public.admin_broadcast_due(text),
  public.admin_broadcast_claim_batch(text, integer),
  public.admin_broadcast_delivery_set(text, uuid, text, text, timestamptz),
  public.admin_broadcast_rollup(text, uuid)
from public, authenticated, service_role;

grant execute on function
  public.admin_broadcast_create(text, text, text, text, text, text, bigint),
  public.admin_broadcast_list(text, integer),
  public.admin_broadcast_get(text, uuid),
  public.admin_broadcast_update(text, uuid, text, text, text, text),
  public.admin_broadcast_mark_tested(text, uuid, bigint),
  public.admin_broadcast_preview(text, text),
  public.admin_broadcast_enqueue(text, uuid, bigint, timestamptz),
  public.admin_broadcast_cancel(text, uuid, bigint, text),
  public.admin_broadcast_due(text),
  public.admin_broadcast_claim_batch(text, integer),
  public.admin_broadcast_delivery_set(text, uuid, text, text, timestamptz),
  public.admin_broadcast_rollup(text, uuid)
to anon;

commit;
