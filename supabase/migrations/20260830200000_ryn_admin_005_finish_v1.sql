-- Admin Control Center finish: notification preferences.
-- NOT applied to production. Applied by hand in the SQL Editor on
-- project lbphobwqzwdkbmyedlwb, and on no other database.
--
-- Notification preferences. Missing rows stay eligible for product updates.
-- service_security cannot be stored as false.

begin;

create table private.notification_preferences (
  telegram_id bigint primary key check (telegram_id > 0),
  product_updates boolean not null default true,
  beta_access boolean not null default true,
  strategy_receipt_alerts boolean not null default false,
  service_security boolean not null default true check (service_security = true),
  updated_at timestamptz not null default clock_timestamp()
);

alter table private.notification_preferences enable row level security;
alter table private.notification_preferences force row level security;

revoke all privileges on table private.notification_preferences
from public, anon, authenticated, service_role;

create function public.admin_prefs_get(p_secret text, p_telegram_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row private.notification_preferences%rowtype;
begin
  perform private.beta_check_secret(p_secret);
  if p_telegram_id is null or p_telegram_id <= 0 then
    return jsonb_build_object('ok', false, 'error', 'bad_user');
  end if;
  select * into v_row from private.notification_preferences where telegram_id = p_telegram_id;
  if not found then
    return jsonb_build_object(
      'ok', true,
      'product_updates', true,
      'beta_access', true,
      'strategy_receipt_alerts', false,
      'service_security', true,
      'stored', false
    );
  end if;
  return jsonb_build_object(
    'ok', true,
    'product_updates', v_row.product_updates,
    'beta_access', v_row.beta_access,
    'strategy_receipt_alerts', v_row.strategy_receipt_alerts,
    'service_security', true,
    'stored', true
  );
end;
$$;

create function public.admin_prefs_set(
  p_secret text,
  p_telegram_id bigint,
  p_product_updates boolean,
  p_beta_access boolean,
  p_strategy_receipt_alerts boolean
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
  insert into private.notification_preferences (
    telegram_id, product_updates, beta_access, strategy_receipt_alerts, service_security, updated_at
  ) values (
    p_telegram_id, coalesce(p_product_updates, true), coalesce(p_beta_access, true),
    coalesce(p_strategy_receipt_alerts, false), true, clock_timestamp()
  )
  on conflict (telegram_id) do update
    set product_updates = excluded.product_updates,
        beta_access = excluded.beta_access,
        strategy_receipt_alerts = excluded.strategy_receipt_alerts,
        service_security = true,
        updated_at = clock_timestamp();
  return jsonb_build_object('ok', true, 'service_security', true);
end;
$$;

revoke all on function
  public.admin_prefs_get(text, bigint),
  public.admin_prefs_set(text, bigint, boolean, boolean, boolean)
from public, authenticated, service_role;

grant execute on function
  public.admin_prefs_get(text, bigint),
  public.admin_prefs_set(text, bigint, boolean, boolean, boolean)
to anon;

-- Missing preference rows stay eligible for product_updates so enqueue
-- does not silently go to zero. Only an explicit false opts out.

create or replace function public.admin_broadcast_preview(p_secret text, p_audience text)
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
       )
       and not exists (
         select 1 from private.notification_preferences p
          where p.telegram_id = u.telegram_id
            and p.product_updates is false
       );
  else
    select count(*)::integer into v_n
      from public.beta_users u
     where u.telegram_id is not null and u.telegram_id > 0
       and not exists (
         select 1 from private.notification_preferences p
          where p.telegram_id = u.telegram_id
            and p.product_updates is false
       );
  end if;
  return jsonb_build_object('ok', true, 'n', coalesce(v_n, 0));
end;
$$;

create or replace function public.admin_broadcast_enqueue(
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
       and not exists (
         select 1 from private.notification_preferences p
          where p.telegram_id = u.telegram_id
            and p.product_updates is false
       )
    on conflict (campaign_id, telegram_id) do nothing;
  else
    insert into private.broadcast_deliveries (campaign_id, telegram_id, state)
    select p_id, u.telegram_id, 'QUEUED'
      from public.beta_users u
     where u.telegram_id is not null and u.telegram_id > 0
       and not exists (
         select 1 from private.notification_preferences p
          where p.telegram_id = u.telegram_id
            and p.product_updates is false
       )
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

grant execute on function
  public.admin_broadcast_preview(text, text),
  public.admin_broadcast_enqueue(text, uuid, bigint, timestamptz)
to anon;

commit;
