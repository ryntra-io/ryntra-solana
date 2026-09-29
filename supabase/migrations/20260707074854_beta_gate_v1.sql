-- Repo mirror of the migration applied to Supabase project `ryntra` (lbphobwqzwdkbmyedlwb).
-- Beta Access Gate: users, tasks, referrals, access + secret-gated SECURITY DEFINER API.
-- All app access goes through beta_* functions that require the app secret
-- (stored in private.app_config, unreadable via PostgREST). Tables have RLS with no policies.
-- NOTE: the actual secret value is NOT in git — it lives in private.app_config and in the
-- BETA_APP_SECRET env var (Vercel + .env.local). In the applied migration the insert below
-- carried the real value.

create schema if not exists private;

create table if not exists private.app_config (
  key text primary key,
  value text not null
);

insert into private.app_config (key, value)
values ('beta_secret', '<BETA_APP_SECRET — redacted in repo>')
on conflict (key) do update set value = excluded.value;

revoke all on schema private from anon, authenticated;
revoke all on private.app_config from anon, authenticated;

-- ---------- tables ----------

create table if not exists public.beta_users (
  id uuid primary key default gen_random_uuid(),
  telegram_id bigint unique not null,
  telegram_username text,
  first_name text,
  language text not null default 'en',
  wallet_address text,
  x_username text,
  proof_code text unique,
  referral_code text unique not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.beta_tasks (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.beta_users(id) on delete cascade,
  task_type text not null check (task_type in ('telegram_join','arcus_referral','x_follow')),
  status text not null default 'pending' check (status in ('pending','submitted','verified','rejected')),
  verified_at timestamptz,
  metadata jsonb,
  unique (user_id, task_type)
);

create table if not exists public.beta_referrals (
  id bigint generated always as identity primary key,
  inviter_user_id uuid not null references public.beta_users(id) on delete cascade,
  invited_user_id uuid not null unique references public.beta_users(id) on delete cascade,
  source text not null default 'telegram_deeplink',
  created_at timestamptz not null default now()
);

create table if not exists public.beta_access (
  user_id uuid primary key references public.beta_users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','telegram_verified','arcus_submitted','x_verified','beta_approved','priority')),
  priority_score int not null default 0,
  approved_at timestamptz,
  notes text,
  updated_at timestamptz not null default now()
);

create table if not exists public.telegram_updates (
  update_id bigint primary key,
  received_at timestamptz not null default now()
);

create index if not exists beta_users_telegram_id_idx on public.beta_users (telegram_id);
create index if not exists beta_tasks_user_idx on public.beta_tasks (user_id);
create index if not exists beta_referrals_inviter_idx on public.beta_referrals (inviter_user_id);

alter table public.beta_users enable row level security;
alter table public.beta_tasks enable row level security;
alter table public.beta_referrals enable row level security;
alter table public.beta_access enable row level security;
alter table public.telegram_updates enable row level security;
-- no policies: tables are unreachable with the anon key; only definer functions below touch them.

-- ---------- helpers ----------

create or replace function private.beta_check_secret(p_secret text) returns void
language plpgsql security definer set search_path = private, public as $$
begin
  if p_secret is distinct from (select value from private.app_config where key = 'beta_secret') then
    raise exception 'forbidden';
  end if;
end $$;

create or replace function private.beta_recompute(p_user_id uuid) returns void
language plpgsql security definer set search_path = public, private as $$
declare
  v_tg bool; v_arc bool; v_x bool; v_invites int; v_status text; v_score int;
begin
  select exists(select 1 from beta_tasks where user_id = p_user_id and task_type = 'telegram_join' and status = 'verified') into v_tg;
  select exists(select 1 from beta_tasks where user_id = p_user_id and task_type = 'arcus_referral' and status in ('submitted','verified')) into v_arc;
  select exists(select 1 from beta_tasks where user_id = p_user_id and task_type = 'x_follow' and status = 'verified') into v_x;
  select count(*) into v_invites
    from beta_referrals r
    join beta_tasks t on t.user_id = r.invited_user_id and t.task_type = 'telegram_join' and t.status = 'verified'
    where r.inviter_user_id = p_user_id;

  v_score := (case when v_tg then 1 else 0 end)
           + (case when v_arc then 2 else 0 end)
           + (case when v_x then 1 else 0 end)
           + v_invites * 2;

  v_status := case
    when v_tg and v_arc and v_x and v_invites >= 1 then 'priority'
    when v_tg and v_arc and v_x then 'beta_approved'
    when v_tg and v_x then 'x_verified'
    when v_tg and v_arc then 'arcus_submitted'
    when v_tg then 'telegram_verified'
    else 'pending'
  end;

  insert into beta_access (user_id, status, priority_score, approved_at, updated_at)
  values (p_user_id, v_status, v_score, case when v_status in ('beta_approved','priority') then now() end, now())
  on conflict (user_id) do update
    set status = excluded.status,
        priority_score = excluded.priority_score,
        approved_at = coalesce(beta_access.approved_at, excluded.approved_at),
        updated_at = now();
end $$;

create or replace function private.beta_state_json(p_user_id uuid) returns jsonb
language sql security definer set search_path = public, private as $$
  select jsonb_build_object(
    'user', (select jsonb_build_object(
        'telegram_id', u.telegram_id, 'username', u.telegram_username, 'first_name', u.first_name,
        'language', u.language, 'wallet_address', u.wallet_address, 'proof_code', u.proof_code,
        'referral_code', u.referral_code, 'created_at', u.created_at)
      from beta_users u where u.id = p_user_id),
    'tasks', (select coalesce(jsonb_object_agg(t.task_type, jsonb_build_object('status', t.status, 'verified_at', t.verified_at)), '{}'::jsonb)
      from beta_tasks t where t.user_id = p_user_id),
    'access', (select jsonb_build_object('status', a.status, 'priority_score', a.priority_score, 'approved_at', a.approved_at)
      from beta_access a where a.user_id = p_user_id),
    'invites', (select jsonb_build_object(
        'total', count(*),
        'valid', count(*) filter (where exists(select 1 from beta_tasks t where t.user_id = r.invited_user_id and t.task_type = 'telegram_join' and t.status = 'verified')))
      from beta_referrals r where r.inviter_user_id = p_user_id)
  );
$$;

-- ---------- public RPC surface (called with anon key + app secret) ----------

create or replace function public.beta_upsert_user(
  p_secret text, p_telegram_id bigint, p_username text, p_first_name text, p_language text, p_inviter_ref text default null
) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare
  v_id uuid; v_inviter uuid; v_new bool := false;
begin
  perform private.beta_check_secret(p_secret);

  select id into v_id from beta_users where telegram_id = p_telegram_id;
  if v_id is null then
    insert into beta_users (telegram_id, telegram_username, first_name, language, referral_code, proof_code)
    values (
      p_telegram_id, nullif(p_username,''), nullif(p_first_name,''),
      case when p_language in ('en','uk','ru') then p_language else 'en' end,
      upper(substr(md5(p_telegram_id::text || gen_random_uuid()::text), 1, 8)),
      'RYNTRA-' || upper(substr(md5(gen_random_uuid()::text), 1, 4))
    ) returning id into v_id;
    v_new := true;
    insert into beta_tasks (user_id, task_type) values
      (v_id, 'telegram_join'), (v_id, 'arcus_referral'), (v_id, 'x_follow')
    on conflict do nothing;
  else
    update beta_users set
      telegram_username = coalesce(nullif(p_username,''), telegram_username),
      first_name = coalesce(nullif(p_first_name,''), first_name),
      language = case when p_language in ('en','uk','ru') then p_language else language end,
      updated_at = now()
    where id = v_id;
  end if;

  if v_new and p_inviter_ref is not null then
    select id into v_inviter from beta_users where referral_code = upper(p_inviter_ref) and id <> v_id;
    if v_inviter is not null then
      insert into beta_referrals (inviter_user_id, invited_user_id) values (v_inviter, v_id)
      on conflict (invited_user_id) do nothing;
      perform private.beta_recompute(v_inviter);
    end if;
  end if;

  perform private.beta_recompute(v_id);
  return private.beta_state_json(v_id) || jsonb_build_object('is_new', v_new);
end $$;

create or replace function public.beta_set_task(
  p_secret text, p_telegram_id bigint, p_task text, p_status text, p_metadata jsonb default null
) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare v_id uuid;
begin
  perform private.beta_check_secret(p_secret);
  select id into v_id from beta_users where telegram_id = p_telegram_id;
  if v_id is null then raise exception 'user not found'; end if;
  update beta_tasks set
    status = p_status,
    verified_at = case when p_status = 'verified' then now() else verified_at end,
    metadata = coalesce(p_metadata, metadata)
  where user_id = v_id and task_type = p_task;
  perform private.beta_recompute(v_id);
  if p_task = 'telegram_join' then
    perform private.beta_recompute(r.inviter_user_id) from beta_referrals r where r.invited_user_id = v_id;
  end if;
  return private.beta_state_json(v_id);
end $$;

create or replace function public.beta_set_wallet(p_secret text, p_telegram_id bigint, p_wallet text) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare v_id uuid;
begin
  perform private.beta_check_secret(p_secret);
  select id into v_id from beta_users where telegram_id = p_telegram_id;
  if v_id is null then raise exception 'user not found'; end if;
  if p_wallet !~ '^0x[a-fA-F0-9]{40}$' then raise exception 'bad wallet'; end if;
  update beta_users set wallet_address = p_wallet, updated_at = now() where id = v_id;
  update beta_tasks set status = 'submitted', metadata = jsonb_build_object('wallet', p_wallet, 'submitted_at', now())
    where user_id = v_id and task_type = 'arcus_referral' and status <> 'verified';
  perform private.beta_recompute(v_id);
  return private.beta_state_json(v_id);
end $$;

create or replace function public.beta_get_state(p_secret text, p_telegram_id bigint) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare v_id uuid;
begin
  perform private.beta_check_secret(p_secret);
  select id into v_id from beta_users where telegram_id = p_telegram_id;
  if v_id is null then return null; end if;
  return private.beta_state_json(v_id);
end $$;

create or replace function public.beta_mark_update(p_secret text, p_update_id bigint) returns boolean
language plpgsql security definer set search_path = public, private as $$
begin
  perform private.beta_check_secret(p_secret);
  insert into telegram_updates (update_id) values (p_update_id) on conflict do nothing;
  return found; -- true = first time seen, false = duplicate
end $$;

create or replace function public.beta_metrics(p_secret text) returns jsonb
language plpgsql security definer set search_path = public, private as $$
begin
  perform private.beta_check_secret(p_secret);
  return jsonb_build_object(
    'users_total', (select count(*) from beta_users),
    'by_status', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) from (select status, count(*) n from beta_access group by status) s),
    'tasks', jsonb_build_object(
      'telegram_verified', (select count(*) from beta_tasks where task_type='telegram_join' and status='verified'),
      'arcus_submitted', (select count(*) from beta_tasks where task_type='arcus_referral' and status in ('submitted','verified')),
      'x_verified', (select count(*) from beta_tasks where task_type='x_follow' and status='verified')),
    'referrals_total', (select count(*) from beta_referrals),
    'daily_new_users_14d', (select coalesce(jsonb_object_agg(d, n), '{}'::jsonb) from (
      select to_char(created_at at time zone 'utc', 'YYYY-MM-DD') d, count(*) n
      from beta_users where created_at > now() - interval '14 days' group by 1 order by 1) t),
    'cta_events_14d', (select coalesce(jsonb_object_agg(name, n), '{}'::jsonb) from (
      select name, count(*) n from events where created_at > now() - interval '14 days' group by name) e)
  );
end $$;

-- lock down execution: anon may call only these entry points
revoke all on function private.beta_check_secret(text) from public, anon, authenticated;
revoke all on function private.beta_recompute(uuid) from public, anon, authenticated;
revoke all on function private.beta_state_json(uuid) from public, anon, authenticated;
grant execute on function public.beta_upsert_user(text, bigint, text, text, text, text) to anon;
grant execute on function public.beta_set_task(text, bigint, text, text, jsonb) to anon;
grant execute on function public.beta_set_wallet(text, bigint, text) to anon;
grant execute on function public.beta_get_state(text, bigint) to anon;
grant execute on function public.beta_mark_update(text, bigint) to anon;
grant execute on function public.beta_metrics(text) to anon;
