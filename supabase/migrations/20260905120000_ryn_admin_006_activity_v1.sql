-- RYN-ADMIN-006 account logins, product events and activity reads.
-- APPLIED to production project lbphobwqzwdkbmyedlwb on
-- 2026-09-05 through the Supabase MCP apply_migration, on the founder's
-- instruction in session («ти можеш сам робив оцю міграцію?»), without the
-- begin/commit wrapper (the tool runs the statement set atomically). Never
-- against Neon Guard. Verified immediately after against the live database:
-- both tables present with RLS enabled and forced and no anon/authenticated
-- select; the five public functions SECURITY DEFINER with execute for anon
-- only; the private helper present; zero rows in both stores.
-- Verified locally beforehand on top of every prior migration in PGlite (see
-- the task card and docs/tasks/evidence/RYN-ADMIN-006-verification.md).
--
-- Invariants:
--   * private tables; ENABLE + FORCE RLS; no policies; ACL revoked
--   * SECURITY DEFINER RPCs have empty search_path and the beta secret gate
--   * no wallet address, balance, amount, P&L, hash, prompt, IP or
--     Telegram identifier is stored in an event; the props check refuses them
--   * a login row comes only from the server exchange and is unique per nonce,
--     so a retried or parallel exchange cannot count twice
--   * operator accounts (private.admin_operators) are excluded from every
--     product metric by the reads below; their traffic is reported separately
--   * a missing row is "not collected yet"; a count over an applied store is a
--     measured zero — the reads return coverage so the surface can tell them apart

begin;

-- --------------------------------------------------------------- stores --

create table private.account_logins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.beta_users(id) on delete restrict,
  kind text not null check (kind in ('telegram_link', 'wallet_siwe')),
  admin boolean not null default false,
  target text check (target is null or target in ('admin', 'app', 'beta', 'demo')),
  nonce text unique check (nonce is null or char_length(nonce) between 8 and 128),
  occurred_at timestamptz not null default clock_timestamp()
);

create index account_logins_user_idx
  on private.account_logins (user_id, occurred_at desc);
create index account_logins_occurred_idx
  on private.account_logins (occurred_at desc);

create table private.product_events (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default clock_timestamp(),
  actor_kind text not null check (actor_kind in ('account', 'wallet', 'anonymous')),
  user_id uuid references public.beta_users(id) on delete restrict,
  actor_key text check (actor_key is null or char_length(actor_key) between 8 and 128),
  name text not null check (name ~ '^[a-z][a-z0-9_]{2,47}$'),
  outcome text not null check (outcome in ('ok', 'error', 'refused')),
  error_class text check (error_class is null or error_class ~ '^[a-z][a-z0-9_]{2,63}$'),
  surface text check (surface is null or surface in ('app', 'bot', 'site', 'api')),
  props jsonb not null default '{}'::jsonb
    check (
      jsonb_typeof(props) = 'object'
      and pg_column_size(props) <= 2048
      and not (props ?| array[
        'wallet_address', 'walletAddress', 'wallet', 'address', 'tx_hash', 'txHash',
        'signature', 'amount', 'balance', 'pnl', 'portfolio_value', 'prompt', 'email',
        'telegram_id', 'telegramId', 'username', 'ip'
      ])
    ),
  check (
    (actor_kind = 'account' and user_id is not null and actor_key is null)
    or (actor_kind = 'wallet' and user_id is null and actor_key is not null)
    or (actor_kind = 'anonymous' and user_id is null and actor_key is null)
  )
);

create index product_events_occurred_idx
  on private.product_events (occurred_at desc);
create index product_events_user_idx
  on private.product_events (user_id, occurred_at desc)
  where user_id is not null;
create index product_events_name_idx
  on private.product_events (name, occurred_at desc);

alter table private.account_logins enable row level security;
alter table private.account_logins force row level security;
alter table private.product_events enable row level security;
alter table private.product_events force row level security;

revoke all privileges on table private.account_logins, private.product_events
  from public, anon, authenticated, service_role;

-- -------------------------------------------------------------- helpers --

-- The account an identifier names. Never creates one.
create function private.activity_resolve_user(p_telegram_id bigint, p_wallet text)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_telegram_id is not null and p_telegram_id > 0 then
    select u.id into v_id from public.beta_users u where u.telegram_id = p_telegram_id;
    return v_id;
  end if;
  if p_wallet is not null and p_wallet ~ '^0x[0-9a-fA-F]{40}$' then
    select u.id into v_id from public.beta_users u where u.verified_wallet = lower(p_wallet);
    return v_id;
  end if;
  return null;
end;
$$;

revoke all on function private.activity_resolve_user(bigint, text)
  from public, anon, authenticated, service_role;

-- ------------------------------------------------------------- writers --

create function public.account_login_record(
  p_secret text,
  p_telegram_id bigint,
  p_wallet text,
  p_kind text,
  p_admin boolean,
  p_target text,
  p_nonce text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_first boolean;
  v_inserted integer := 0;
begin
  perform private.beta_check_secret(p_secret);
  if p_kind not in ('telegram_link', 'wallet_siwe') then
    return jsonb_build_object('ok', false, 'error', 'bad_kind');
  end if;
  if p_target is not null and p_target not in ('admin', 'app', 'beta', 'demo') then
    return jsonb_build_object('ok', false, 'error', 'bad_target');
  end if;
  if p_nonce is not null and char_length(p_nonce) not between 8 and 128 then
    return jsonb_build_object('ok', false, 'error', 'bad_nonce');
  end if;
  v_user := private.activity_resolve_user(p_telegram_id, p_wallet);
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  v_first := not exists (select 1 from private.account_logins l where l.user_id = v_user);
  insert into private.account_logins (user_id, kind, admin, target, nonce)
  values (v_user, p_kind, coalesce(p_admin, false), p_target, p_nonce)
  on conflict (nonce) do nothing;
  get diagnostics v_inserted = row_count;
  return jsonb_build_object(
    'ok', true,
    'recorded', v_inserted = 1,
    'first', v_first and v_inserted = 1
  );
end;
$$;

create function public.product_event_append(
  p_secret text,
  p_telegram_id bigint,
  p_wallet text,
  p_actor_kind text,
  p_actor_key text,
  p_name text,
  p_outcome text,
  p_error_class text,
  p_surface text,
  p_props jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
begin
  perform private.beta_check_secret(p_secret);
  if p_actor_kind not in ('account', 'wallet', 'anonymous') then
    return jsonb_build_object('ok', false, 'error', 'bad_actor');
  end if;
  if p_name is null or p_name !~ '^[a-z][a-z0-9_]{2,47}$' then
    return jsonb_build_object('ok', false, 'error', 'bad_name');
  end if;
  if p_outcome not in ('ok', 'error', 'refused') then
    return jsonb_build_object('ok', false, 'error', 'bad_outcome');
  end if;
  if p_actor_kind = 'account' then
    v_user := private.activity_resolve_user(p_telegram_id, p_wallet);
    if v_user is null then
      return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
  end if;
  insert into private.product_events (
    actor_kind, user_id, actor_key, name, outcome, error_class, surface, props
  ) values (
    p_actor_kind,
    case when p_actor_kind = 'account' then v_user else null end,
    case when p_actor_kind = 'wallet' then p_actor_key else null end,
    p_name,
    p_outcome,
    nullif(btrim(coalesce(p_error_class, '')), ''),
    nullif(btrim(coalesce(p_surface, '')), ''),
    coalesce(p_props, '{}'::jsonb)
  );
  return jsonb_build_object('ok', true);
exception
  when check_violation then
    return jsonb_build_object('ok', false, 'error', 'refused_by_check');
end;
$$;

-- --------------------------------------------------------------- reads --

-- Everything the Overview, Analytics and Operations coverage block need, in
-- one read, over product accounts only. `p_now` exists so a test can pin time.
create function public.admin_activity_summary(p_secret text, p_now timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := coalesce(p_now, clock_timestamp());
  v_7d timestamptz;
  v_30d timestamptz;
  v_out jsonb;
begin
  perform private.beta_check_secret(p_secret);
  v_7d := v_now - interval '7 days';
  v_30d := v_now - interval '30 days';

  with ops as (
    select u.id as user_id
      from public.beta_users u
      join private.admin_operators o on o.telegram_id = u.telegram_id
  ),
  -- Product logins: not operator accounts, not admin-panel logins.
  logins as (
    select l.user_id, l.kind, l.occurred_at
      from private.account_logins l
     where l.admin = false
       and l.occurred_at <= v_now
       and not exists (select 1 from ops where ops.user_id = l.user_id)
  ),
  events as (
    select e.user_id, e.actor_kind, e.name, e.outcome, e.error_class, e.occurred_at
      from private.product_events e
     where e.occurred_at <= v_now
       and (e.user_id is null or not exists (select 1 from ops where ops.user_id = e.user_id))
  ),
  first_login as (
    select user_id, min(occurred_at) as first_at from logins group by user_id
  ),
  days as (
    select distinct to_char(occurred_at at time zone 'utc', 'YYYY-MM-DD') as dte from logins where occurred_at > v_30d
    union
    select distinct to_char(occurred_at at time zone 'utc', 'YYYY-MM-DD') from events where occurred_at > v_30d
  ),
  cohort_rows as (
    select
      to_char(date_trunc('week', f.first_at at time zone 'utc'), 'YYYY-MM-DD') as week,
      count(*) as n,
      count(*) filter (where exists (
        select 1 from logins l
         where l.user_id = f.user_id
           and l.occurred_at >= f.first_at + interval '7 days'
           and l.occurred_at < f.first_at + interval '14 days'
      ) or exists (
        select 1 from events e
         where e.user_id = f.user_id and e.actor_kind = 'account' and e.outcome = 'ok'
           and e.occurred_at >= f.first_at + interval '7 days'
           and e.occurred_at < f.first_at + interval '14 days'
      )) as returned,
      bool_and((date_trunc('week', f.first_at at time zone 'utc') + interval '21 days') <= (v_now at time zone 'utc')) as complete
      from first_login f
     where f.first_at > v_now - interval '10 weeks'
     group by 1
  )
  select jsonb_build_object(
    'ok', true,
    'now', v_now,
    'coverage', jsonb_build_object(
      'logins_since', (select min(occurred_at) from private.account_logins),
      'events_since', (select min(occurred_at) from private.product_events),
      'login_rows', (select count(*) from private.account_logins),
      'event_rows', (select count(*) from private.product_events)
    ),
    'operators', jsonb_build_object(
      'accounts', (select count(*) from ops),
      'logins_30d', (
        select count(*) from private.account_logins l
         where l.occurred_at > v_30d and l.occurred_at <= v_now
           and (l.admin or exists (select 1 from ops where ops.user_id = l.user_id))
      )
    ),
    'accounts', jsonb_build_object(
      'total', (select count(*) from public.beta_users u where not exists (select 1 from ops where ops.user_id = u.id)),
      'new_7d', (select count(*) from public.beta_users u where u.created_at > v_7d and u.created_at <= v_now and not exists (select 1 from ops where ops.user_id = u.id)),
      'new_30d', (select count(*) from public.beta_users u where u.created_at > v_30d and u.created_at <= v_now and not exists (select 1 from ops where ops.user_id = u.id)),
      'ever_signed_in', (select count(*) from first_login),
      'signed_in_7d', (select count(distinct user_id) from logins where occurred_at > v_7d),
      'signed_in_30d', (select count(distinct user_id) from logins where occurred_at > v_30d),
      'acted_7d', (select count(distinct user_id) from events where actor_kind = 'account' and outcome = 'ok' and occurred_at > v_7d),
      'acted_30d', (select count(distinct user_id) from events where actor_kind = 'account' and outcome = 'ok' and occurred_at > v_30d),
      'activated', (select count(distinct user_id) from events where actor_kind = 'account' and outcome = 'ok'),
      'with_errors_7d', (select count(distinct user_id) from events where actor_kind = 'account' and outcome = 'error' and occurred_at > v_7d)
    ),
    'logins', jsonb_build_object(
      'count_7d', (select count(*) from logins where occurred_at > v_7d),
      'count_30d', (select count(*) from logins where occurred_at > v_30d),
      'by_kind_30d', (
        select coalesce(jsonb_object_agg(kind, n), '{}'::jsonb)
          from (select kind, count(*) as n from logins where occurred_at > v_30d group by kind) k
      )
    ),
    'events', jsonb_build_object(
      'ok_7d', (select count(*) from events where outcome = 'ok' and occurred_at > v_7d),
      'error_7d', (select count(*) from events where outcome = 'error' and occurred_at > v_7d),
      'refused_7d', (select count(*) from events where outcome = 'refused' and occurred_at > v_7d),
      'ok_30d', (select count(*) from events where outcome = 'ok' and occurred_at > v_30d),
      'error_30d', (select count(*) from events where outcome = 'error' and occurred_at > v_30d),
      'anonymous_ok_30d', (select count(*) from events where actor_kind = 'anonymous' and outcome = 'ok' and occurred_at > v_30d),
      'by_name_30d', (
        select coalesce(jsonb_object_agg(name, n), '{}'::jsonb)
          from (select name, count(*) as n from events where outcome = 'ok' and occurred_at > v_30d group by name) x
      ),
      'error_classes_7d', (
        select coalesce(jsonb_object_agg(coalesce(error_class, 'unclassified'), n), '{}'::jsonb)
          from (select error_class, count(*) as n from events where outcome = 'error' and occurred_at > v_7d group by error_class) x
      )
    ),
    'daily_30d', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'day', d.dte,
        'signed_in', (select count(distinct l.user_id) from logins l where l.occurred_at > v_30d and to_char(l.occurred_at at time zone 'utc', 'YYYY-MM-DD') = d.dte),
        'acted', (select count(distinct e.user_id) from events e where e.actor_kind = 'account' and e.outcome = 'ok' and e.occurred_at > v_30d and to_char(e.occurred_at at time zone 'utc', 'YYYY-MM-DD') = d.dte),
        'errors', (select count(*) from events e where e.outcome = 'error' and e.occurred_at > v_30d and to_char(e.occurred_at at time zone 'utc', 'YYYY-MM-DD') = d.dte)
      ) order by d.dte), '[]'::jsonb)
        from days d
    ),
    'activation_14d', (
      -- Denominator: accounts whose first recorded login is at least 14 days
      -- old. Numerator: those with a permitted ok action inside those 14 days.
      select jsonb_build_object(
        'n', count(*),
        'activated', count(*) filter (where exists (
          select 1 from events e
           where e.user_id = f.user_id and e.actor_kind = 'account' and e.outcome = 'ok'
             and e.occurred_at >= f.first_at and e.occurred_at < f.first_at + interval '14 days'
        ))
      )
        from first_login f
       where f.first_at + interval '14 days' <= v_now
    ),
    'cohorts', (
      -- Week-1 return: a product login or ok action between day 7 and day 14
      -- after the first recorded login. A cohort is complete once its whole
      -- week (Monday, UTC) is at least 14 days old; the surface hides the rest.
      select coalesce(jsonb_agg(jsonb_build_object(
        'week', c.week,
        'n', c.n,
        'returned_w1', c.returned,
        'complete', c.complete
      ) order by c.week), '[]'::jsonb)
        from cohort_rows c
    )
  ) into v_out;

  return v_out;
end;
$$;

-- One account's login and activity truth for the user drawer.
create function public.admin_user_activity(p_secret text, p_telegram_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_operator boolean;
  v_now timestamptz := clock_timestamp();
begin
  perform private.beta_check_secret(p_secret);
  select u.id into v_user from public.beta_users u where u.telegram_id = p_telegram_id;
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  v_operator := exists (select 1 from private.admin_operators o where o.telegram_id = p_telegram_id);
  return jsonb_build_object(
    'ok', true,
    'is_operator', v_operator,
    'first_login_at', (select min(occurred_at) from private.account_logins where user_id = v_user and admin = false),
    'last_login_at', (select max(occurred_at) from private.account_logins where user_id = v_user and admin = false),
    'last_login_kind', (select kind from private.account_logins where user_id = v_user and admin = false order by occurred_at desc limit 1),
    'login_count', (select count(*) from private.account_logins where user_id = v_user and admin = false),
    'admin_login_count', (select count(*) from private.account_logins where user_id = v_user and admin = true),
    'last_activity_at', (select max(occurred_at) from private.product_events where user_id = v_user and outcome = 'ok'),
    'events_30d', (select count(*) from private.product_events where user_id = v_user and outcome = 'ok' and occurred_at > v_now - interval '30 days'),
    'errors_30d', (select count(*) from private.product_events where user_id = v_user and outcome = 'error' and occurred_at > v_now - interval '30 days'),
    'timeline', (
      select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.at desc), '[]'::jsonb)
        from (
          (select l.occurred_at as at, 'login'::text as type, l.kind as name, 'ok'::text as outcome,
                  null::text as error_class, null::text as surface, l.admin as admin, l.target as target
             from private.account_logins l where l.user_id = v_user
            order by l.occurred_at desc limit 40)
          union all
          (select e.occurred_at, 'event', e.name, e.outcome, e.error_class, e.surface, false, null
             from private.product_events e where e.user_id = v_user
            order by e.occurred_at desc limit 40)
        ) t
    )
  );
end;
$$;

-- Users page with filters, sort, offset pagination and a real total.
-- Returns no wallet address, proof code or referral code: the list never needed them.
create function public.admin_users_page(
  p_secret text,
  p_query text,
  p_filter text,
  p_sort text,
  p_dir text,
  p_offset integer,
  p_limit integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_filter text := coalesce(nullif(btrim(p_filter), ''), 'all');
  v_sort text := coalesce(nullif(btrim(p_sort), ''), 'created_at');
  v_desc boolean := coalesce(lower(p_dir), 'desc') <> 'asc';
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_query text := nullif(btrim(coalesce(p_query, '')), '');
  v_out jsonb;
begin
  perform private.beta_check_secret(p_secret);
  if v_filter not in ('all', 'active', 'requested', 'paused', 'revoked', 'expired', 'signed_in_30d', 'never_signed_in', 'operators', 'wallet_linked', 'errors_7d') then
    return jsonb_build_object('ok', false, 'error', 'bad_filter');
  end if;
  if v_sort not in ('created_at', 'last_login_at', 'last_activity_at', 'paper_trades', 'display') then
    return jsonb_build_object('ok', false, 'error', 'bad_sort');
  end if;

  with base as (
    select
      u.telegram_id,
      u.telegram_username,
      u.first_name,
      u.language,
      u.created_at,
      a.status,
      (select jsonb_object_agg(t.task_type, t.status) from public.beta_tasks t where t.user_id = u.id) as tasks,
      (select count(*)::integer from public.beta_referrals r where r.inviter_user_id = u.id) as invites,
      (select count(*)::integer from public.paper_trades p where p.user_id = u.id) as paper_trades,
      (u.wallet_address is not null) as has_watch_address,
      (u.verified_wallet is not null) as wallet_linked,
      exists (select 1 from private.admin_operators o where o.telegram_id = u.telegram_id) as is_operator,
      case
        when c.state = 'REVOKED' then 'REVOKED'
        when c.state = 'EXPIRED' then 'EXPIRED'
        when c.state is not null and c.expires_at is not null and c.expires_at <= v_now then 'EXPIRED'
        when c.state is not null then c.state
        when exists (select 1 from public.beta_tasks t where t.user_id = u.id and t.task_type = 'telegram_join' and t.status = 'verified') then 'ACTIVE'
        else 'REQUESTED'
      end as effective_access,
      case when c.state is not null then 'control' else 'legacy' end as access_source,
      c.expires_at as access_expires_at,
      (select min(l.occurred_at) from private.account_logins l where l.user_id = u.id and l.admin = false) as first_login_at,
      (select max(l.occurred_at) from private.account_logins l where l.user_id = u.id and l.admin = false) as last_login_at,
      (select l.kind from private.account_logins l where l.user_id = u.id and l.admin = false order by l.occurred_at desc limit 1) as last_login_kind,
      (select count(*)::integer from private.account_logins l where l.user_id = u.id and l.admin = false) as login_count,
      (select max(e.occurred_at) from private.product_events e where e.user_id = u.id and e.outcome = 'ok') as last_activity_at,
      (select count(*)::integer from private.product_events e where e.user_id = u.id and e.outcome = 'ok' and e.occurred_at > v_now - interval '30 days') as events_30d,
      (select count(*)::integer from private.product_events e where e.user_id = u.id and e.outcome = 'error' and e.occurred_at > v_now - interval '7 days') as errors_7d,
      lower(coalesce(nullif(u.telegram_username, ''), nullif(u.first_name, ''), u.telegram_id::text)) as display
      from public.beta_users u
      left join public.beta_access a on a.user_id = u.id
      left join private.access_controls c on c.user_id = u.id
     where u.telegram_id is not null
       and (
         v_query is null
         or lower(coalesce(u.telegram_username, '')) like '%' || lower(v_query) || '%'
         or lower(coalesce(u.first_name, '')) like '%' || lower(v_query) || '%'
         or u.telegram_id::text = v_query
         or u.proof_code = upper(v_query)
         or lower(coalesce(u.wallet_address, '')) = lower(v_query)
         or u.verified_wallet = lower(v_query)
       )
  ),
  filtered as (
    select * from base t
     where case v_filter
       when 'active' then t.effective_access = 'ACTIVE'
       when 'requested' then t.effective_access = 'REQUESTED'
       when 'paused' then t.effective_access = 'PAUSED'
       when 'revoked' then t.effective_access = 'REVOKED'
       when 'expired' then t.effective_access = 'EXPIRED'
       when 'signed_in_30d' then t.last_login_at is not null and t.last_login_at > v_now - interval '30 days'
       when 'never_signed_in' then t.first_login_at is null
       when 'operators' then t.is_operator
       when 'wallet_linked' then t.wallet_linked
       when 'errors_7d' then t.errors_7d > 0
       else true
     end
  )
  select jsonb_build_object(
    'ok', true,
    'total', (select count(*) from filtered),
    'offset', v_offset,
    'limit', v_limit,
    'rows', (
      select coalesce(jsonb_agg(row_to_json(x)::jsonb), '[]'::jsonb)
        from (
          select * from filtered t
           order by
             case when v_sort = 'created_at' and v_desc then t.created_at end desc nulls last,
             case when v_sort = 'created_at' and not v_desc then t.created_at end asc nulls last,
             case when v_sort = 'last_login_at' and v_desc then t.last_login_at end desc nulls last,
             case when v_sort = 'last_login_at' and not v_desc then t.last_login_at end asc nulls last,
             case when v_sort = 'last_activity_at' and v_desc then t.last_activity_at end desc nulls last,
             case when v_sort = 'last_activity_at' and not v_desc then t.last_activity_at end asc nulls last,
             case when v_sort = 'paper_trades' and v_desc then t.paper_trades end desc nulls last,
             case when v_sort = 'paper_trades' and not v_desc then t.paper_trades end asc nulls last,
             case when v_sort = 'display' and v_desc then t.display end desc nulls last,
             case when v_sort = 'display' and not v_desc then t.display end asc nulls last,
             t.created_at desc,
             t.telegram_id asc
           offset v_offset
           limit v_limit
        ) x
    )
  ) into v_out;

  return v_out;
end;
$$;

-- --------------------------------------------------------------- grants --

revoke all on function
  public.account_login_record(text, bigint, text, text, boolean, text, text),
  public.product_event_append(text, bigint, text, text, text, text, text, text, text, jsonb),
  public.admin_activity_summary(text, timestamptz),
  public.admin_user_activity(text, bigint),
  public.admin_users_page(text, text, text, text, text, integer, integer)
from public, authenticated, service_role;

grant execute on function
  public.account_login_record(text, bigint, text, text, boolean, text, text),
  public.product_event_append(text, bigint, text, text, text, text, text, text, text, jsonb),
  public.admin_activity_summary(text, timestamptz),
  public.admin_user_activity(text, bigint),
  public.admin_users_page(text, text, text, text, text, integer, integer)
to anon;

commit;
