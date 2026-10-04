-- Admin Control Center, first stage.
-- APPLIED to production project lbphobwqzwdkbmyedlwb via SQL Editor on
-- 2026-08-29. Result: Success. No rows returned.
-- Live RPC probe the same day: admin_operator_status kind=none
-- operator_count=0; audit/access lists empty; wrong secret denied.
--
-- Invariants:
--   * private tables; ENABLE + FORCE RLS; no policies; ACL revoked
--   * admin_audit_events is append-only (UPDATE/DELETE/TRUNCATE rejected)
--   * SECURITY DEFINER RPCs have empty search_path and the beta secret gate
--   * no wallet balance, P&L or trade size columns

begin;

create table private.admin_operators (
  telegram_id bigint primary key check (telegram_id > 0),
  role text not null check (role = 'OWNER'),
  active boolean not null default true,
  display_name text,
  created_at timestamptz not null default clock_timestamp(),
  last_auth_at timestamptz
);

create table private.admin_audit_events (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default clock_timestamp(),
  actor_telegram_id bigint not null check (actor_telegram_id > 0),
  action text not null check (char_length(action) between 3 and 64),
  outcome text not null check (outcome in ('attempt', 'ok', 'rejected', 'failed', 'partial')),
  reason text,
  target_telegram_id bigint,
  payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 16384)
);

create index admin_audit_events_occurred_idx
  on private.admin_audit_events (occurred_at desc, id desc);

create table private.access_controls (
  user_id uuid primary key references public.beta_users(id) on delete restrict,
  state text not null check (state in ('REQUESTED', 'ACTIVE', 'PAUSED', 'REVOKED', 'EXPIRED')),
  reason text not null check (char_length(btrim(reason)) between 3 and 500),
  expires_at timestamptz,
  updated_by bigint not null check (updated_by > 0),
  updated_at timestamptz not null default clock_timestamp()
);

create table private.admin_settings (
  key text primary key check (char_length(key) between 2 and 64),
  value jsonb not null,
  updated_by bigint not null,
  updated_at timestamptz not null default clock_timestamp()
);

alter table private.admin_operators enable row level security;
alter table private.admin_operators force row level security;
alter table private.admin_audit_events enable row level security;
alter table private.admin_audit_events force row level security;
alter table private.access_controls enable row level security;
alter table private.access_controls force row level security;
alter table private.admin_settings enable row level security;
alter table private.admin_settings force row level security;

revoke all privileges on table
  private.admin_operators,
  private.admin_audit_events,
  private.access_controls,
  private.admin_settings
from public, anon, authenticated, service_role;

create function private.admin_audit_reject_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'admin audit events are append-only' using errcode = '55000';
  return null;
end;
$$;

revoke all on function private.admin_audit_reject_mutation()
  from public, anon, authenticated, service_role;

create trigger admin_audit_events_immutable
before update or delete on private.admin_audit_events
for each row execute function private.admin_audit_reject_mutation();
create trigger admin_audit_events_no_truncate
before truncate on private.admin_audit_events
for each statement execute function private.admin_audit_reject_mutation();

create function public.admin_operator_status(p_secret text, p_telegram_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_active boolean;
  v_role text;
  v_count integer;
begin
  perform private.beta_check_secret(p_secret);
  if p_telegram_id is null or p_telegram_id <= 0 then
    return jsonb_build_object('kind', 'none', 'operator_count', -1);
  end if;
  select count(*)::integer into v_count from private.admin_operators;
  select o.active, o.role
    into v_active, v_role
    from private.admin_operators o
   where o.telegram_id = p_telegram_id;
  if found then
    return jsonb_build_object('kind', 'operator', 'active', v_active, 'role', v_role, 'operator_count', v_count);
  end if;
  return jsonb_build_object('kind', 'none', 'operator_count', v_count);
end;
$$;

create function public.admin_operator_bootstrap(p_secret text, p_telegram_id bigint, p_display_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.beta_check_secret(p_secret);
  if p_telegram_id is null or p_telegram_id <= 0 then
    return jsonb_build_object('ok', false, 'error', 'bad_id');
  end if;
  perform pg_advisory_xact_lock(8819001);
  if exists (select 1 from private.admin_operators) then
    return jsonb_build_object('ok', false, 'error', 'already_bootstrapped');
  end if;
  insert into private.admin_operators (telegram_id, role, active, display_name, last_auth_at)
  values (p_telegram_id, 'OWNER', true, nullif(btrim(coalesce(p_display_name, '')), ''), clock_timestamp());
  return jsonb_build_object('ok', true);
end;
$$;

create function public.admin_operator_touch(p_secret text, p_telegram_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.beta_check_secret(p_secret);
  update private.admin_operators
     set last_auth_at = clock_timestamp()
   where telegram_id = p_telegram_id and active = true;
  return jsonb_build_object('ok', found);
end;
$$;

create function public.admin_audit_append(
  p_secret text,
  p_actor_telegram_id bigint,
  p_action text,
  p_outcome text,
  p_reason text,
  p_target_telegram_id bigint,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.beta_check_secret(p_secret);
  if p_actor_telegram_id is null or p_actor_telegram_id <= 0 then
    return jsonb_build_object('ok', false);
  end if;
  insert into private.admin_audit_events (
    actor_telegram_id, action, outcome, reason, target_telegram_id, payload
  ) values (
    p_actor_telegram_id,
    p_action,
    p_outcome,
    nullif(btrim(coalesce(p_reason, '')), ''),
    p_target_telegram_id,
    coalesce(p_payload, '{}'::jsonb)
  );
  return jsonb_build_object('ok', true);
end;
$$;

create function public.admin_audit_list(p_secret text, p_limit integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.beta_check_secret(p_secret);
  return coalesce((
    select jsonb_agg(row_to_json(x))
      from (
        select id, occurred_at, action, outcome, reason, target_telegram_id, payload
          from private.admin_audit_events
         order by occurred_at desc, id desc
         limit least(greatest(coalesce(p_limit, 100), 1), 200)
      ) x
  ), '[]'::jsonb);
end;
$$;

create function public.admin_access_list(p_secret text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.beta_check_secret(p_secret);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'telegram_id', u.telegram_id,
      'state', c.state,
      'expires_at', c.expires_at
    ))
      from private.access_controls c
      join public.beta_users u on u.id = c.user_id
     where u.telegram_id is not null
  ), '[]'::jsonb);
end;
$$;

create function public.admin_access_set(
  p_secret text,
  p_telegram_id bigint,
  p_state text,
  p_reason text,
  p_updated_by bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
begin
  perform private.beta_check_secret(p_secret);
  if p_state not in ('REQUESTED', 'ACTIVE', 'PAUSED', 'REVOKED', 'EXPIRED') then
    return jsonb_build_object('ok', false, 'error', 'bad_state');
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 3 or char_length(btrim(p_reason)) > 500 then
    return jsonb_build_object('ok', false, 'error', 'bad_reason');
  end if;
  select id into v_user_id from public.beta_users where telegram_id = p_telegram_id;
  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  insert into private.access_controls (user_id, state, reason, updated_by, updated_at)
  values (v_user_id, p_state, btrim(p_reason), p_updated_by, clock_timestamp())
  on conflict (user_id) do update
    set state = excluded.state,
        reason = excluded.reason,
        updated_by = excluded.updated_by,
        updated_at = clock_timestamp();
  return jsonb_build_object('ok', true, 'state', p_state);
end;
$$;

create function public.admin_setting_get(p_secret text, p_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_value jsonb;
begin
  perform private.beta_check_secret(p_secret);
  select s.value into v_value from private.admin_settings s where s.key = p_key;
  if not found then
    return jsonb_build_object('ok', true, 'value', null);
  end if;
  if jsonb_typeof(v_value) = 'string' then
    return jsonb_build_object('ok', true, 'value', v_value #>> '{}');
  end if;
  return jsonb_build_object('ok', true, 'value', v_value);
end;
$$;

create function public.admin_setting_set(p_secret text, p_key text, p_value text, p_updated_by bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.beta_check_secret(p_secret);
  if p_key is null or char_length(p_key) < 2 then
    return jsonb_build_object('ok', false);
  end if;
  insert into private.admin_settings (key, value, updated_by, updated_at)
  values (p_key, to_jsonb(p_value), p_updated_by, clock_timestamp())
  on conflict (key) do update
    set value = excluded.value,
        updated_by = excluded.updated_by,
        updated_at = clock_timestamp();
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.admin_operator_status(text, bigint) from public, authenticated, service_role;
revoke all on function public.admin_operator_bootstrap(text, bigint, text) from public, authenticated, service_role;
revoke all on function public.admin_operator_touch(text, bigint) from public, authenticated, service_role;
revoke all on function public.admin_audit_append(text, bigint, text, text, text, bigint, jsonb) from public, authenticated, service_role;
revoke all on function public.admin_audit_list(text, integer) from public, authenticated, service_role;
revoke all on function public.admin_access_list(text) from public, authenticated, service_role;
revoke all on function public.admin_access_set(text, bigint, text, text, bigint) from public, authenticated, service_role;
revoke all on function public.admin_setting_get(text, text) from public, authenticated, service_role;
revoke all on function public.admin_setting_set(text, text, text, bigint) from public, authenticated, service_role;

grant execute on function public.admin_operator_status(text, bigint) to anon;
grant execute on function public.admin_operator_bootstrap(text, bigint, text) to anon;
grant execute on function public.admin_operator_touch(text, bigint) to anon;
grant execute on function public.admin_audit_append(text, bigint, text, text, text, bigint, jsonb) to anon;
grant execute on function public.admin_audit_list(text, integer) to anon;
grant execute on function public.admin_access_list(text) to anon;
grant execute on function public.admin_access_set(text, bigint, text, text, bigint) to anon;
grant execute on function public.admin_setting_get(text, text) to anon;
grant execute on function public.admin_setting_set(text, text, text, bigint) to anon;

commit;
