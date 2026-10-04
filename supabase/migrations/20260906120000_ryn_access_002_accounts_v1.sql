-- Accounts, sessions, wallet links, receipts archive.
--
-- PREPARED 2026-09-06 and verified locally in PGlite against the migration set
-- production actually carries (every file except the unapplied
-- 20260819200000_wallet_account_creation_v1), then APPLIED to production
-- project lbphobwqzwdkbmyedlwb on 2026-09-06 through the
-- Supabase's apply_migration with explicit approval.
-- Every function whose signature changed is dropped by its exact old
-- signature first, so no overload is left for PostgREST to choose between.
--
-- WHAT THIS FILE DOES
--   * `beta_users` becomes the account hub for every identity: the legacy
--     Telegram bot id stays where it is, `auth_user_id` binds the Supabase Auth
--     user that carries email + password, Google and Telegram OpenID Connect
--     identities. An account row needs at least one identity.
--   * `private.account_wallets` holds separately proven wallet links (Solana
--     addresses case-sensitive base58, EVM lowercase hex), one owner per
--     address. The legacy `verified_wallet` column is mirrored, not replaced.
--   * `private.sessions` gives every cookie a row: customer sessions, wallet
--     proof sessions and privileged admin sessions can be revoked, expire on
--     their own absolute and idle limits, and remember when the second factor
--     was last verified.
--   * `private.wallet_receipts` archives private receipts for a proven wallet
--     so they survive a cleared browser; the local vault stays the first copy.
--   * The Telegram-keyed RPCs (paper, live notes, strategy lab, language) gain
--     a `p_account_id` path resolved through `private.account_actor`, so an
--     account without Telegram keeps its plans, notes and settings. The
--     legacy path is byte-for-byte the old one, including its channel-join
--     requirement.
--   * The activity stores learn the new login kinds and the account-id
--     actor; operators are excluded by account as well as by Telegram id.
--
-- WHAT IT DOES NOT DO
--   No data is invented: no synthetic Telegram id, no back-dated logins, no
--   automatic merge of accounts. Wallet proof never creates an account. Nothing
--   here reads or stores passwords, OAuth secrets or second-factor material —
--   Supabase Auth owns those.

begin;

-- ------------------------------------------------------------ accounts --

alter table public.beta_users
  add column if not exists auth_user_id uuid;

create unique index if not exists beta_users_auth_user_idx
  on public.beta_users (auth_user_id)
  where auth_user_id is not null;

alter table public.beta_users
  drop constraint if exists beta_identity_present;

alter table public.beta_users
  add constraint beta_identity_present
  check (telegram_id is not null or verified_wallet is not null or auth_user_id is not null);

-- ------------------------------------------------------ wallet links --

create table private.account_wallets (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.beta_users(id) on delete cascade,
  chain text not null check (chain in ('solana', 'evm')),
  address text not null,
  verified_at timestamptz not null default clock_timestamp(),
  last_used_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  unique (chain, address),
  check (
    (chain = 'evm' and address ~ '^0x[0-9a-f]{40}$')
    or (chain = 'solana' and address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$')
  )
);

create index account_wallets_account_idx on private.account_wallets (account_id);

alter table private.account_wallets enable row level security;
alter table private.account_wallets force row level security;

-- Existing EVM links keep their meaning as wallet links.
insert into private.account_wallets (account_id, chain, address, verified_at)
select u.id, 'evm', u.verified_wallet, coalesce(u.verified_wallet_at, u.updated_at, clock_timestamp())
  from public.beta_users u
 where u.verified_wallet is not null
on conflict (chain, address) do nothing;

-- ---------------------------------------------------------- sessions --

create table private.sessions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references public.beta_users(id) on delete cascade,
  kind text not null check (kind in ('customer', 'wallet', 'admin')),
  method text not null check (method in (
    'telegram_link', 'wallet_siwe', 'email_password', 'email_recovery',
    'google_oidc', 'telegram_oidc', 'solana_siws'
  )),
  wallet_chain text check (wallet_chain is null or wallet_chain in ('solana', 'evm')),
  wallet_address text,
  auth_session_id uuid,
  issued_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  idle_seconds integer check (idle_seconds is null or idle_seconds between 60 and 86400),
  last_seen_at timestamptz not null default clock_timestamp(),
  mfa_verified_at timestamptz,
  revoked_at timestamptz,
  revoked_reason text check (revoked_reason is null or revoked_reason in ('logout', 'logout_all', 'password_reset', 'role_revoked', 'replaced')),
  check (account_id is not null or (kind = 'wallet' and wallet_address is not null)),
  check ((kind = 'wallet') = (wallet_address is not null and account_id is null) or kind <> 'wallet')
);

create index sessions_account_idx on private.sessions (account_id) where revoked_at is null;
create index sessions_expiry_idx on private.sessions (expires_at);

alter table private.sessions enable row level security;
alter table private.sessions force row level security;

-- --------------------------------------------------- receipts archive --

create table private.wallet_receipts (
  id uuid primary key default gen_random_uuid(),
  chain text not null check (chain in ('solana', 'evm')),
  address text not null,
  kind text not null check (kind in ('send', 'swap', 'bridge', 'receive', 'other')),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  payload jsonb not null check (pg_column_size(payload) <= 32768),
  occurred_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  unique (chain, address, content_hash)
);

create index wallet_receipts_owner_idx on private.wallet_receipts (chain, address, created_at desc);

alter table private.wallet_receipts enable row level security;
alter table private.wallet_receipts force row level security;

-- --------------------------------------------- operators by account --

alter table private.admin_operators
  add column if not exists account_id uuid references public.beta_users(id);

create unique index if not exists admin_operators_account_idx
  on private.admin_operators (account_id)
  where account_id is not null;

update private.admin_operators o
   set account_id = u.id
  from public.beta_users u
 where u.telegram_id = o.telegram_id
   and o.account_id is null;

-- ------------------------------------------------------- login kinds --

alter table private.account_logins
  drop constraint if exists account_logins_kind_check;

alter table private.account_logins
  add constraint account_logins_kind_check
  check (kind in ('telegram_link', 'wallet_siwe', 'email_password', 'email_recovery', 'google_oidc', 'telegram_oidc', 'solana_siws'));

revoke all privileges on table private.account_wallets, private.sessions, private.wallet_receipts
  from public, anon, authenticated;

-- ----------------------------------------------------------- helpers --

-- Who an RPC acts for. The account path needs only an existing row; the
-- Telegram path is the legacy resolver of each scope, unchanged.
create function private.account_actor(p_telegram_id bigint, p_account_id uuid, p_scope text)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_account_id is not null then
    select u.id into v_id from public.beta_users u where u.id = p_account_id;
    return v_id;
  end if;
  if p_telegram_id is null then
    return null;
  end if;
  if p_scope in ('strategy_lab', 'paper') then
    select u.id into v_id
      from public.beta_users u
      join public.beta_tasks t on t.user_id = u.id and t.task_type = 'telegram_join' and t.status = 'verified'
     where u.telegram_id = p_telegram_id;
    return v_id;
  end if;
  select u.id into v_id from public.beta_users u where u.telegram_id = p_telegram_id;
  return v_id;
end;
$$;

create function private.account_actor_required(p_telegram_id bigint, p_account_id uuid, p_scope text)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
begin
  v_id := private.account_actor(p_telegram_id, p_account_id, p_scope);
  if v_id is null then raise exception 'not verified'; end if;
  return v_id;
end;
$$;

revoke all on function private.account_actor(bigint, uuid, text) from public, anon, authenticated, service_role;
revoke all on function private.account_actor_required(bigint, uuid, text) from public, anon, authenticated, service_role;

-- ----------------------------------------------------- account RPCs --

-- Resolve or create the account behind a Supabase Auth user.
--   * a row already bound to this auth user wins;
--   * otherwise, when the identity carries a Telegram id and the legacy bot
--     row exists and is unbound, the legacy row is bound (one person, two
--     doors) — a bound legacy row belonging to another auth user is a
--     collision and is refused, never merged;
--   * otherwise a fresh account row is created with the same codes the bot
--     path mints, no Telegram id, the three tasks pending.
create function public.account_resolve_auth(
  p_secret text,
  p_auth_user_id uuid,
  p_telegram_id bigint default null,
  p_display_name text default null,
  p_language text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_bound uuid;
  v_new boolean := false;
  v_linked boolean := false;
begin
  perform private.beta_check_secret(p_secret);
  if p_auth_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'bad_auth_user');
  end if;

  select u.id into v_id from public.beta_users u where u.auth_user_id = p_auth_user_id;

  if v_id is null and p_telegram_id is not null and p_telegram_id > 0 then
    select u.id, u.auth_user_id into v_id, v_bound from public.beta_users u where u.telegram_id = p_telegram_id;
    if v_id is not null then
      if v_bound is not null and v_bound <> p_auth_user_id then
        return jsonb_build_object('ok', false, 'error', 'telegram_claimed');
      end if;
      update public.beta_users
         set auth_user_id = p_auth_user_id,
             first_name = coalesce(first_name, nullif(p_display_name, '')),
             updated_at = now()
       where id = v_id;
      v_linked := true;
    end if;
  end if;

  if v_id is null then
    insert into public.beta_users (telegram_id, auth_user_id, first_name, language, referral_code, proof_code)
    values (
      null,
      p_auth_user_id,
      nullif(p_display_name, ''),
      case when p_language in ('en', 'uk', 'ru') then p_language else 'en' end,
      upper(substr(md5(p_auth_user_id::text || gen_random_uuid()::text), 1, 8)),
      'RYNTRA-' || upper(substr(md5(gen_random_uuid()::text), 1, 4))
    )
    returning id into v_id;
    insert into public.beta_tasks (user_id, task_type) values
      (v_id, 'telegram_join'), (v_id, 'arcus_referral'), (v_id, 'x_follow')
    on conflict do nothing;
    insert into public.beta_access (user_id) values (v_id) on conflict do nothing;
    v_new := true;
  end if;

  return jsonb_build_object('ok', true, 'account_id', v_id, 'is_new', v_new, 'linked_legacy', v_linked);
end;
$$;

-- Bind a Supabase Auth user to an account that already exists (the bootstrap
-- from a legacy Telegram session, or the owner attaching email/Google).
create function public.account_bind_auth(
  p_secret text,
  p_account_id uuid,
  p_auth_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current uuid;
  v_other uuid;
begin
  perform private.beta_check_secret(p_secret);
  select u.auth_user_id into v_current from public.beta_users u where u.id = p_account_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  select u.id into v_other from public.beta_users u where u.auth_user_id = p_auth_user_id and u.id <> p_account_id;
  if v_other is not null then
    return jsonb_build_object('ok', false, 'error', 'auth_user_claimed');
  end if;
  if v_current is not null and v_current <> p_auth_user_id then
    return jsonb_build_object('ok', false, 'error', 'account_bound');
  end if;
  update public.beta_users set auth_user_id = p_auth_user_id, updated_at = now() where id = p_account_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- Which account, if any, an auth user is bound to. Null is an honest answer.
create function public.account_by_auth_user(p_secret text, p_auth_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform private.beta_check_secret(p_secret);
  select u.id into v_id from public.beta_users u where u.auth_user_id = p_auth_user_id;
  return jsonb_build_object('ok', true, 'account_id', v_id);
end;
$$;

-- The account's state by its own id: the same projection the bot path serves.
create function public.beta_state_by_account(p_secret text, p_account_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state jsonb;
begin
  perform private.beta_check_secret(p_secret);
  if not exists (select 1 from public.beta_users u where u.id = p_account_id) then
    return null;
  end if;
  v_state := private.beta_state_json(p_account_id);
  return v_state || jsonb_build_object(
    'account', jsonb_build_object(
      'id', p_account_id,
      'auth_linked', exists (select 1 from public.beta_users u where u.id = p_account_id and u.auth_user_id is not null),
      'telegram_linked', exists (select 1 from public.beta_users u where u.id = p_account_id and u.telegram_id is not null),
      'wallets', (
        select coalesce(jsonb_agg(jsonb_build_object('chain', w.chain, 'address', w.address, 'verified_at', w.verified_at) order by w.verified_at), '[]'::jsonb)
          from private.account_wallets w where w.account_id = p_account_id
      )
    )
  );
end;
$$;

-- Wallet links: one owner per address, proof required by the caller.
create function public.account_wallet_link(
  p_secret text,
  p_account_id uuid,
  p_chain text,
  p_address text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
begin
  perform private.beta_check_secret(p_secret);
  if p_chain not in ('solana', 'evm') then
    return jsonb_build_object('ok', false, 'error', 'bad_chain');
  end if;
  if (p_chain = 'evm' and p_address !~ '^0x[0-9a-f]{40}$')
     or (p_chain = 'solana' and p_address !~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$') then
    return jsonb_build_object('ok', false, 'error', 'bad_address');
  end if;
  if not exists (select 1 from public.beta_users u where u.id = p_account_id) then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  select w.account_id into v_owner from private.account_wallets w where w.chain = p_chain and w.address = p_address;
  if v_owner is not null and v_owner <> p_account_id then
    return jsonb_build_object('ok', false, 'error', 'wallet_taken');
  end if;
  if v_owner is null then
    insert into private.account_wallets (account_id, chain, address) values (p_account_id, p_chain, p_address);
    if p_chain = 'evm' then
      update public.beta_users
         set verified_wallet = p_address, verified_wallet_at = clock_timestamp(), updated_at = now()
       where id = p_account_id and verified_wallet is null;
    end if;
  else
    update private.account_wallets set last_used_at = clock_timestamp() where chain = p_chain and address = p_address;
  end if;
  return jsonb_build_object('ok', true, 'already', v_owner is not null);
end;
$$;

create function public.account_wallet_unlink(
  p_secret text,
  p_account_id uuid,
  p_chain text,
  p_address text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer := 0;
begin
  perform private.beta_check_secret(p_secret);
  delete from private.account_wallets w
   where w.account_id = p_account_id and w.chain = p_chain and w.address = p_address;
  get diagnostics v_deleted = row_count;
  if v_deleted = 0 then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- Which account, if any, proved this address. Null is an honest answer.
create function public.account_by_wallet(p_secret text, p_chain text, p_address text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
begin
  perform private.beta_check_secret(p_secret);
  select w.account_id into v_owner from private.account_wallets w where w.chain = p_chain and w.address = p_address;
  return jsonb_build_object('ok', true, 'account_id', v_owner);
end;
$$;

-- ----------------------------------------------------- session RPCs --

create function public.session_open(
  p_secret text,
  p_kind text,
  p_method text,
  p_account_id uuid default null,
  p_ttl_seconds integer default 2592000,
  p_idle_seconds integer default null,
  p_wallet_chain text default null,
  p_wallet_address text default null,
  p_mfa boolean default false,
  p_auth_session_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_expires timestamptz;
begin
  perform private.beta_check_secret(p_secret);
  if p_kind not in ('customer', 'wallet', 'admin') then
    return jsonb_build_object('ok', false, 'error', 'bad_kind');
  end if;
  if p_ttl_seconds is null or p_ttl_seconds not between 60 and 5184000 then
    return jsonb_build_object('ok', false, 'error', 'bad_ttl');
  end if;
  if p_kind <> 'wallet' and (p_account_id is null or not exists (select 1 from public.beta_users u where u.id = p_account_id)) then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if p_kind = 'wallet' and (p_wallet_address is null or p_wallet_chain is null) then
    return jsonb_build_object('ok', false, 'error', 'bad_wallet');
  end if;
  v_expires := clock_timestamp() + make_interval(secs => p_ttl_seconds);
  insert into private.sessions (
    account_id, kind, method, wallet_chain, wallet_address, auth_session_id,
    expires_at, idle_seconds, mfa_verified_at
  ) values (
    case when p_kind = 'wallet' then null else p_account_id end,
    p_kind, p_method, p_wallet_chain, p_wallet_address, p_auth_session_id,
    v_expires, p_idle_seconds,
    case when coalesce(p_mfa, false) then clock_timestamp() else null end
  )
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'expires_at', v_expires);
end;
$$;

-- One read per request: the session row, then the account's state when there
-- is one. Touches last_seen; an idle session is reported as such and revoked.
create function public.session_resolve(p_secret text, p_id uuid, p_touch boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s private.sessions%rowtype;
  v_now timestamptz := clock_timestamp();
  v_state jsonb;
begin
  perform private.beta_check_secret(p_secret);
  select * into s from private.sessions where id = p_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if s.revoked_at is not null then
    return jsonb_build_object('ok', false, 'error', 'revoked', 'reason', s.revoked_reason);
  end if;
  if s.expires_at <= v_now then
    return jsonb_build_object('ok', false, 'error', 'expired');
  end if;
  if s.idle_seconds is not null and s.last_seen_at + make_interval(secs => s.idle_seconds) <= v_now then
    update private.sessions set revoked_at = v_now, revoked_reason = 'replaced' where id = p_id;
    return jsonb_build_object('ok', false, 'error', 'idle');
  end if;
  if coalesce(p_touch, true) then
    update private.sessions set last_seen_at = v_now where id = p_id;
  end if;
  if s.account_id is not null then
    v_state := private.beta_state_json(s.account_id);
  end if;
  return jsonb_build_object(
    'ok', true,
    'id', s.id,
    'kind', s.kind,
    'method', s.method,
    'account_id', s.account_id,
    'wallet_chain', s.wallet_chain,
    'wallet_address', s.wallet_address,
    'auth_session_id', s.auth_session_id,
    'issued_at', s.issued_at,
    'expires_at', s.expires_at,
    'mfa_verified_at', s.mfa_verified_at,
    'state', v_state,
    'account', case when s.account_id is null then null else jsonb_build_object(
      'auth_user_id', (select u.auth_user_id from public.beta_users u where u.id = s.account_id),
      'telegram_linked', exists (select 1 from public.beta_users u where u.id = s.account_id and u.telegram_id is not null),
      'operator', exists (select 1 from private.admin_operators o where o.active and (o.account_id = s.account_id or o.telegram_id = (select u.telegram_id from public.beta_users u where u.id = s.account_id))),
      'wallets', (
        select coalesce(jsonb_agg(jsonb_build_object('chain', w.chain, 'address', w.address, 'verified_at', w.verified_at) order by w.verified_at), '[]'::jsonb)
          from private.account_wallets w where w.account_id = s.account_id
      )
    ) end
  );
end;
$$;

create function public.session_revoke(p_secret text, p_id uuid, p_reason text default 'logout')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated integer := 0;
begin
  perform private.beta_check_secret(p_secret);
  if p_reason not in ('logout', 'logout_all', 'password_reset', 'role_revoked', 'replaced') then
    return jsonb_build_object('ok', false, 'error', 'bad_reason');
  end if;
  update private.sessions set revoked_at = clock_timestamp(), revoked_reason = p_reason
   where id = p_id and revoked_at is null;
  get diagnostics v_updated = row_count;
  return jsonb_build_object('ok', true, 'revoked', v_updated = 1);
end;
$$;

create function public.session_revoke_account(
  p_secret text,
  p_account_id uuid,
  p_keep uuid default null,
  p_reason text default 'logout_all',
  p_kind text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated integer := 0;
begin
  perform private.beta_check_secret(p_secret);
  if p_reason not in ('logout', 'logout_all', 'password_reset', 'role_revoked', 'replaced') then
    return jsonb_build_object('ok', false, 'error', 'bad_reason');
  end if;
  update private.sessions set revoked_at = clock_timestamp(), revoked_reason = p_reason
   where account_id = p_account_id
     and revoked_at is null
     and (p_keep is null or id <> p_keep)
     and (p_kind is null or kind = p_kind);
  get diagnostics v_updated = row_count;
  return jsonb_build_object('ok', true, 'revoked', v_updated);
end;
$$;

create function public.session_mark_mfa(p_secret text, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated integer := 0;
begin
  perform private.beta_check_secret(p_secret);
  update private.sessions set mfa_verified_at = clock_timestamp()
   where id = p_id and revoked_at is null and expires_at > clock_timestamp();
  get diagnostics v_updated = row_count;
  return jsonb_build_object('ok', v_updated = 1);
end;
$$;

-- The account's live sessions, for the settings page. No addresses of other
-- people, no user agents, no ip: kind, method, when, last seen.
create function public.session_list(p_secret text, p_account_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.beta_check_secret(p_secret);
  return jsonb_build_object('ok', true, 'rows', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id, 'kind', s.kind, 'method', s.method,
      'issued_at', s.issued_at, 'last_seen_at', s.last_seen_at, 'expires_at', s.expires_at,
      'mfa_verified_at', s.mfa_verified_at
    ) order by s.last_seen_at desc), '[]'::jsonb)
      from private.sessions s
     where s.account_id = p_account_id and s.revoked_at is null and s.expires_at > clock_timestamp()
  ));
end;
$$;

-- ---------------------------------------------- wallet receipts RPCs --

create function public.wallet_receipts_put(
  p_secret text,
  p_chain text,
  p_address text,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_inserted integer := 0;
  v_count integer := 0;
begin
  perform private.beta_check_secret(p_secret);
  if p_chain not in ('solana', 'evm') then
    return jsonb_build_object('ok', false, 'error', 'bad_chain');
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 200 then
    return jsonb_build_object('ok', false, 'error', 'bad_rows');
  end if;
  for v_row in select * from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_row) <> 'object'
       or coalesce(v_row->>'kind', '') not in ('send', 'swap', 'bridge', 'receive', 'other')
       or coalesce(v_row->>'content_hash', '') !~ '^[0-9a-f]{64}$'
       or jsonb_typeof(v_row->'payload') <> 'object' then
      continue;
    end if;
    insert into private.wallet_receipts (chain, address, kind, content_hash, payload, occurred_at)
    values (
      p_chain, p_address, v_row->>'kind', v_row->>'content_hash', v_row->'payload',
      nullif(v_row->>'occurred_at', '')::timestamptz
    )
    on conflict (chain, address, content_hash) do nothing;
    get diagnostics v_count = row_count;
    v_inserted := v_inserted + v_count;
  end loop;
  return jsonb_build_object('ok', true, 'inserted', v_inserted);
end;
$$;

create function public.wallet_receipts_list(p_secret text, p_chain text, p_address text, p_limit integer default 100)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.beta_check_secret(p_secret);
  return jsonb_build_object('ok', true, 'rows', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'kind', r.kind, 'content_hash', r.content_hash, 'payload', r.payload,
      'occurred_at', r.occurred_at, 'created_at', r.created_at
    ) order by coalesce(r.occurred_at, r.created_at) desc), '[]'::jsonb)
      from (
        select * from private.wallet_receipts w
         where w.chain = p_chain and w.address = p_address
         order by coalesce(w.occurred_at, w.created_at) desc
         limit least(greatest(coalesce(p_limit, 100), 1), 500)
      ) r
  ));
end;
$$;

-- --------------------------------------------- operators by account --

create function public.admin_operator_by_account(p_secret text, p_account_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o private.admin_operators%rowtype;
begin
  perform private.beta_check_secret(p_secret);
  select * into o
    from private.admin_operators x
   where x.account_id = p_account_id
      or x.telegram_id = (select u.telegram_id from public.beta_users u where u.id = p_account_id and u.telegram_id is not null);
  if not found then
    return jsonb_build_object('ok', true, 'operator', null);
  end if;
  if o.account_id is null then
    update private.admin_operators set account_id = p_account_id where telegram_id = o.telegram_id and account_id is null;
  end if;
  return jsonb_build_object('ok', true, 'operator', jsonb_build_object(
    'telegram_id', o.telegram_id, 'role', o.role, 'active', o.active, 'display_name', o.display_name
  ));
end;
$$;

-- ------------------------------------------------------------- grants --

revoke all on function public.account_resolve_auth(text, uuid, bigint, text, text) from public, anon, authenticated, service_role;
revoke all on function public.account_bind_auth(text, uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.account_by_auth_user(text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.beta_state_by_account(text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.account_wallet_link(text, uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function public.account_wallet_unlink(text, uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function public.account_by_wallet(text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.session_open(text, text, text, uuid, integer, integer, text, text, boolean, uuid) from public, anon, authenticated, service_role;
revoke all on function public.session_resolve(text, uuid, boolean) from public, anon, authenticated, service_role;
revoke all on function public.session_revoke(text, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.session_revoke_account(text, uuid, uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function public.session_mark_mfa(text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.session_list(text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.wallet_receipts_put(text, text, text, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.wallet_receipts_list(text, text, text, integer) from public, anon, authenticated, service_role;
revoke all on function public.admin_operator_by_account(text, uuid) from public, anon, authenticated, service_role;

grant execute on function public.account_resolve_auth(text, uuid, bigint, text, text) to anon;
grant execute on function public.account_bind_auth(text, uuid, uuid) to anon;
grant execute on function public.account_by_auth_user(text, uuid) to anon;
grant execute on function public.beta_state_by_account(text, uuid) to anon;
grant execute on function public.account_wallet_link(text, uuid, text, text) to anon;
grant execute on function public.account_wallet_unlink(text, uuid, text, text) to anon;
grant execute on function public.account_by_wallet(text, text, text) to anon;
grant execute on function public.session_open(text, text, text, uuid, integer, integer, text, text, boolean, uuid) to anon;
grant execute on function public.session_resolve(text, uuid, boolean) to anon;
grant execute on function public.session_revoke(text, uuid, text) to anon;
grant execute on function public.session_revoke_account(text, uuid, uuid, text, text) to anon;
grant execute on function public.session_mark_mfa(text, uuid) to anon;
grant execute on function public.session_list(text, uuid) to anon;
grant execute on function public.wallet_receipts_put(text, text, text, jsonb) to anon;
grant execute on function public.wallet_receipts_list(text, text, text, integer) to anon;
grant execute on function public.admin_operator_by_account(text, uuid) to anon;

-- GENERATED-RPCS-BELOW

-- ---- account-aware variants of the Telegram-keyed RPCs (generated from the repository definitions) ----

create or replace function private.beta_state_json(p_user_id uuid) returns jsonb
language sql security definer set search_path = public, private as $$
  select jsonb_build_object(
    'user', (select jsonb_build_object(
        'id', u.id, 'telegram_id', u.telegram_id, 'username', u.telegram_username, 'first_name', u.first_name,
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
revoke all on function private.beta_state_json(uuid) from public, anon, authenticated, service_role;

drop function if exists public.strategy_lab_append_version(text, bigint, uuid, text, jsonb);
create or replace function public.strategy_lab_append_version(
  p_secret text,
  p_telegram_id bigint,
  p_request_uuid uuid,
  p_payload_hash text,
  p_approval jsonb,
  p_account_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_replay jsonb;
  v_version_id uuid;
  v_parent_id uuid;
  v_strategy_id uuid;
  v_latest_id uuid;
  v_number integer;
  v_title text;
  v_approved_at timestamptz;
  v_result jsonb;
begin
  perform private.beta_check_secret(p_secret);
  v_user := private.account_actor(p_telegram_id, p_account_id, 'strategy_lab');
  if v_user is null then
    raise exception 'unknown or unverified user' using errcode = '22023';
  end if;
  v_replay := private.strategy_lab_replay(v_user, 'version', p_request_uuid, p_payload_hash);
  if v_replay is not null then return v_replay; end if;

  if pg_catalog.jsonb_typeof(p_approval) is distinct from 'object'
     or pg_catalog.pg_column_size(p_approval) > 131072
     or not (p_approval ?& array['schemaVersion','versionId','spec','specHash','approvedAt','parentVersionId','proof'])
     or (p_approval - 'schemaVersion' - 'versionId' - 'spec' - 'specHash' - 'approvedAt' - 'parentVersionId' - 'proof') <> '{}'::jsonb
     or p_approval->>'schemaVersion' <> '1'
     or p_approval->>'versionId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or pg_catalog.jsonb_typeof(p_approval->'spec') is distinct from 'object'
     or pg_catalog.pg_column_size(p_approval->'spec') > 65536
     or p_approval->>'specHash' !~ '^[0-9a-f]{64}$'
     or p_approval->>'approvedAt' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?Z$'
     or pg_catalog.jsonb_typeof(p_approval->'parentVersionId') not in ('string','null')
     or p_approval->>'proof' !~ '^v1\.[0-9a-f]{64}$' then
    raise exception 'invalid approval' using errcode = '22023';
  end if;

  v_version_id := (p_approval->>'versionId')::uuid;
  v_approved_at := (p_approval->>'approvedAt')::timestamptz;
  v_title := btrim(p_approval#>>'{spec,name}');
  if char_length(v_title) not between 3 and 80 then
    raise exception 'invalid approval' using errcode = '22023';
  end if;

  if p_approval->'parentVersionId' = 'null'::jsonb then
    v_parent_id := null;
    v_strategy_id := gen_random_uuid();
    v_number := 1;
    insert into private.strategy_lab_strategies (id, user_id, title)
    values (v_strategy_id, v_user, v_title);
  else
    if p_approval->>'parentVersionId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception 'invalid approval' using errcode = '22023';
    end if;
    v_parent_id := (p_approval->>'parentVersionId')::uuid;
    select v.strategy_id into v_strategy_id
    from private.strategy_lab_versions as v
    where v.id = v_parent_id and v.user_id = v_user;
    if v_strategy_id is null then
      raise exception 'parent version not found' using errcode = '22023';
    end if;
    perform 1 from private.strategy_lab_strategies as s
    where s.id = v_strategy_id and s.user_id = v_user for update;
    select v.id into v_latest_id
    from private.strategy_lab_versions as v
    where v.strategy_id = v_strategy_id and v.user_id = v_user
    order by v.version_number desc
    limit 1;
    if v_latest_id is distinct from v_parent_id then
      raise exception 'stale parent version' using errcode = '22023';
    end if;
    select coalesce(max(v.version_number), 0) + 1 into v_number
    from private.strategy_lab_versions as v
    where v.strategy_id = v_strategy_id and v.user_id = v_user;
  end if;

  insert into private.strategy_lab_versions
    (id, strategy_id, user_id, version_number, parent_version_id, spec, spec_hash, approved_at, proof, approval)
  values (
    v_version_id, v_strategy_id, v_user, v_number, v_parent_id,
    p_approval->'spec', p_approval->>'specHash', v_approved_at,
    p_approval->>'proof', p_approval
  );

  v_result := pg_catalog.jsonb_build_object(
    'strategyId', v_strategy_id,
    'versionId', v_version_id,
    'versionNumber', v_number,
    'approval', p_approval
  );
  return private.strategy_lab_store_delivery(v_user, 'version', p_request_uuid, p_payload_hash, v_result);
end;
$$;
revoke all on function public.strategy_lab_append_version(text, bigint, uuid, text, jsonb, uuid) from public, anon, authenticated, service_role;
grant execute on function public.strategy_lab_append_version(text, bigint, uuid, text, jsonb, uuid) to anon;

drop function if exists public.strategy_lab_append_proposal(text, bigint, uuid, text, uuid, uuid, uuid, text, text, jsonb, jsonb);
create or replace function public.strategy_lab_append_proposal(
  p_secret text,
  p_telegram_id bigint,
  p_request_uuid uuid,
  p_payload_hash text,
  p_version_id uuid,
  p_experiment_id uuid,
  p_evidence_report_id uuid,
  p_evidence_hash text,
  p_source text,
  p_proposal jsonb,
  p_audit jsonb,
  p_account_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_replay jsonb;
  v_strategy uuid;
  v_stored_hash text;
  v_proposal_id uuid := gen_random_uuid();
  v_result jsonb;
begin
  perform private.beta_check_secret(p_secret);
  v_user := private.account_actor(p_telegram_id, p_account_id, 'strategy_lab');
  if v_user is null then
    raise exception 'unknown or unverified user' using errcode = '22023';
  end if;
  v_replay := private.strategy_lab_replay(v_user, 'proposal', p_request_uuid, p_payload_hash);
  if v_replay is not null then return v_replay; end if;

  select e.strategy_id, r.evidence_hash into v_strategy, v_stored_hash
  from private.strategy_lab_experiments as e
  join private.strategy_lab_evidence_reports as r
    on r.experiment_id = e.id and r.strategy_id = e.strategy_id and r.user_id = e.user_id
  where e.id = p_experiment_id
    and e.strategy_version_id = p_version_id
    and e.user_id = v_user
    and r.id = p_evidence_report_id;
  if v_strategy is null
     or v_stored_hash is distinct from p_evidence_hash
     or p_evidence_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'evidence binding mismatch' using errcode = '22023';
  end if;
  if p_source not in ('manual', 'ai')
     or pg_catalog.jsonb_typeof(p_proposal) is distinct from 'object'
     or pg_catalog.pg_column_size(p_proposal) > 65536
     or (p_source = 'manual' and p_audit is not null)
     or (p_source = 'ai' and pg_catalog.jsonb_typeof(p_audit) is distinct from 'object')
     or (p_audit is not null and pg_catalog.pg_column_size(p_audit) > 65536) then
    raise exception 'invalid proposal' using errcode = '22023';
  end if;

  insert into private.strategy_lab_proposals
    (id, user_id, strategy_id, strategy_version_id, experiment_id, evidence_report_id, evidence_hash, source, proposal, audit)
  values (
    v_proposal_id, v_user, v_strategy, p_version_id, p_experiment_id,
    p_evidence_report_id, p_evidence_hash, p_source, p_proposal, p_audit
  );
  v_result := pg_catalog.jsonb_build_object('proposalId', v_proposal_id);
  return private.strategy_lab_store_delivery(v_user, 'proposal', p_request_uuid, p_payload_hash, v_result);
end;
$$;
revoke all on function public.strategy_lab_append_proposal(text, bigint, uuid, text, uuid, uuid, uuid, text, text, jsonb, jsonb, uuid) from public, anon, authenticated, service_role;
grant execute on function public.strategy_lab_append_proposal(text, bigint, uuid, text, uuid, uuid, uuid, text, text, jsonb, jsonb, uuid) to anon;

drop function if exists public.strategy_lab_list(text, bigint, integer, timestamp with time zone, uuid);
create or replace function public.strategy_lab_list(
  p_secret text,
  p_telegram_id bigint,
  p_limit integer default 50,
  p_before_updated_at timestamptz default null,
  p_before_id uuid default null,
  p_account_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_limit integer;
begin
  perform private.beta_check_secret(p_secret);
  v_user := private.account_actor(p_telegram_id, p_account_id, 'strategy_lab');
  if v_user is null then return '[]'::jsonb; end if;
  if (p_before_updated_at is null) <> (p_before_id is null) then
    raise exception 'invalid cursor' using errcode = '22023';
  end if;
  v_limit := greatest(1, least(coalesce(p_limit, 50), 100));
  return coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'strategyId', q.strategy_id,
      'title', q.title,
      'createdAt', q.created_at,
      'updatedAt', q.updated_at,
      'latestVersionId', q.version_id,
      'versionNumber', q.version_number,
      'specHash', q.spec_hash
    ) order by q.updated_at desc, q.strategy_id desc)
    from (
      select s.id as strategy_id,
             coalesce(v.spec->>'name', s.title) as title,
             s.created_at,
             v.recorded_at as updated_at,
             v.id as version_id,
             v.version_number,
             v.spec_hash
      from private.strategy_lab_strategies as s
      join lateral (
        select lv.id, lv.version_number, lv.spec, lv.spec_hash, lv.recorded_at
        from private.strategy_lab_versions as lv
        where lv.strategy_id = s.id and lv.user_id = s.user_id
        order by lv.version_number desc
        limit 1
      ) as v on true
      where s.user_id = v_user
        and (p_before_updated_at is null or (v.recorded_at, s.id) < (p_before_updated_at, p_before_id))
      order by v.recorded_at desc, s.id desc
      limit v_limit
    ) as q
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.strategy_lab_list(text, bigint, integer, timestamp with time zone, uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.strategy_lab_list(text, bigint, integer, timestamp with time zone, uuid, uuid) to anon;

drop function if exists public.strategy_lab_get(text, bigint, uuid, integer, integer, integer, timestamp with time zone, uuid, timestamp with time zone, uuid, timestamp with time zone, uuid);
create or replace function public.strategy_lab_get(
  p_secret text,
  p_telegram_id bigint,
  p_strategy_id uuid,
  p_version_limit integer default 50,
  p_run_limit integer default 50,
  p_proposal_limit integer default 50,
  p_versions_before_recorded_at timestamptz default null,
  p_versions_before_id uuid default null,
  p_runs_before_created_at timestamptz default null,
  p_runs_before_id uuid default null,
  p_proposals_before_created_at timestamptz default null,
  p_proposals_before_id uuid default null,
  p_account_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_strategy private.strategy_lab_strategies%rowtype;
  v_updated timestamptz;
  v_title text;
  v_versions jsonb;
  v_runs jsonb;
  v_proposals jsonb;
begin
  perform private.beta_check_secret(p_secret);
  v_user := private.account_actor(p_telegram_id, p_account_id, 'strategy_lab');
  if v_user is null then return null; end if;
  if (p_versions_before_recorded_at is null) <> (p_versions_before_id is null)
     or (p_runs_before_created_at is null) <> (p_runs_before_id is null)
     or (p_proposals_before_created_at is null) <> (p_proposals_before_id is null) then
    raise exception 'invalid cursor' using errcode = '22023';
  end if;
  select s.* into v_strategy from private.strategy_lab_strategies as s
  where s.id = p_strategy_id and s.user_id = v_user;
  if not found then return null; end if;

  select v.recorded_at, coalesce(v.spec->>'name', v_strategy.title)
  into v_updated, v_title
  from private.strategy_lab_versions as v
  where v.strategy_id = p_strategy_id and v.user_id = v_user
  order by v.version_number desc limit 1;

  select coalesce(pg_catalog.jsonb_agg(q.item order by q.recorded_at desc, q.id desc), '[]'::jsonb)
  into v_versions
  from (
    select v.id, v.recorded_at, pg_catalog.jsonb_build_object(
      'versionId', v.id,
      'versionNumber', v.version_number,
      'parentVersionId', v.parent_version_id,
      'spec', v.spec,
      'specHash', v.spec_hash,
      'approvedAt', v.approved_at,
      'approval', v.approval,
      'recordedAt', v.recorded_at
    ) as item
    from private.strategy_lab_versions as v
    where v.strategy_id = p_strategy_id and v.user_id = v_user
      and (p_versions_before_recorded_at is null
        or (v.recorded_at, v.id) < (p_versions_before_recorded_at, p_versions_before_id))
    order by v.recorded_at desc, v.id desc
    limit greatest(1, least(coalesce(p_version_limit, 50), 100))
  ) as q;

  select coalesce(pg_catalog.jsonb_agg(q.item order by q.created_at desc, q.id desc), '[]'::jsonb)
  into v_runs
  from (
    select e.id, e.created_at, pg_catalog.jsonb_build_object(
      'experimentId', e.id,
      'versionId', e.strategy_version_id,
      'parentExperimentId', e.parent_experiment_id,
      'iterationNumber', e.iteration_number,
      'protocol', e.protocol,
      'lineage', e.lineage,
      'status', e.status,
      'manifest', i.manifest,
      'providerMetrics', i.provider_metrics,
      'rawFilesStored', false,
      'tradeCount', (select count(*) from private.strategy_lab_trades as t where t.import_id = i.id),
      'evidenceReportId', r.id,
      'evidenceHash', r.evidence_hash,
      'evidence', r.report,
      'engineVersion', r.engine_version,
      'createdAt', e.created_at
    ) as item
    from private.strategy_lab_experiments as e
    join private.strategy_lab_imports as i
      on i.experiment_id = e.id and i.user_id = e.user_id and i.strategy_id = e.strategy_id
    join private.strategy_lab_evidence_reports as r
      on r.experiment_id = e.id and r.user_id = e.user_id and r.strategy_id = e.strategy_id
    where e.strategy_id = p_strategy_id and e.user_id = v_user
      and (p_runs_before_created_at is null
        or (e.created_at, e.id) < (p_runs_before_created_at, p_runs_before_id))
    order by e.created_at desc, e.id desc
    limit greatest(1, least(coalesce(p_run_limit, 50), 100))
  ) as q;

  select coalesce(pg_catalog.jsonb_agg(q.item order by q.created_at desc, q.id desc), '[]'::jsonb)
  into v_proposals
  from (
    select p.id, p.created_at, pg_catalog.jsonb_build_object(
      'proposalId', p.id,
      'versionId', p.strategy_version_id,
      'experimentId', p.experiment_id,
      'evidenceReportId', p.evidence_report_id,
      'evidenceHash', p.evidence_hash,
      'source', p.source,
      'proposal', p.proposal,
      'audit', p.audit,
      'createdAt', p.created_at
    ) as item
    from private.strategy_lab_proposals as p
    where p.strategy_id = p_strategy_id and p.user_id = v_user
      and (p_proposals_before_created_at is null
        or (p.created_at, p.id) < (p_proposals_before_created_at, p_proposals_before_id))
    order by p.created_at desc, p.id desc
    limit greatest(1, least(coalesce(p_proposal_limit, 50), 100))
  ) as q;

  return pg_catalog.jsonb_build_object(
    'strategy', pg_catalog.jsonb_build_object(
      'strategyId', v_strategy.id,
      'title', v_title,
      'createdAt', v_strategy.created_at,
      'updatedAt', v_updated
    ),
    'versions', v_versions,
    'runs', v_runs,
    'proposals', v_proposals
  );
end;
$$;
revoke all on function public.strategy_lab_get(text, bigint, uuid, integer, integer, integer, timestamp with time zone, uuid, timestamp with time zone, uuid, timestamp with time zone, uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.strategy_lab_get(text, bigint, uuid, integer, integer, integer, timestamp with time zone, uuid, timestamp with time zone, uuid, timestamp with time zone, uuid, uuid) to anon;

drop function if exists public.strategy_lab_append_run(text, bigint, uuid, text, uuid, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, text, text);
create or replace function public.strategy_lab_append_run(
  p_secret text,
  p_telegram_id bigint,
  p_request_uuid uuid,
  p_payload_hash text,
  p_version_id uuid,
  p_protocol jsonb,
  p_lineage jsonb,
  p_manifest jsonb,
  p_provider_metrics jsonb,
  p_trades jsonb,
  p_evidence jsonb,
  p_evidence_hash text,
  p_engine_version text,
  p_account_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_replay jsonb;
  v_strategy uuid;
  v_spec jsonb;
  v_version_parent uuid;
  v_parent uuid;
  v_parent_iteration integer;
  v_parent_spec jsonb;
  v_expected_changed_fields jsonb;
  v_iteration integer;
  v_experiment uuid := gen_random_uuid();
  v_import uuid := gen_random_uuid();
  v_evidence_id uuid := gen_random_uuid();
  v_start_ms bigint;
  v_end_ms bigint;
  v_result jsonb;
begin
  perform private.beta_check_secret(p_secret);
  v_user := private.account_actor(p_telegram_id, p_account_id, 'strategy_lab');
  if v_user is null then
    raise exception 'unknown or unverified user' using errcode = '22023';
  end if;
  v_replay := private.strategy_lab_replay(v_user, 'run', p_request_uuid, p_payload_hash);
  if v_replay is not null then return v_replay; end if;

  select v.strategy_id, v.spec, v.parent_version_id into v_strategy, v_spec, v_version_parent
  from private.strategy_lab_versions as v
  where v.id = p_version_id and v.user_id = v_user;
  if v_strategy is null then
    raise exception 'version not found' using errcode = '22023';
  end if;

  if pg_catalog.jsonb_typeof(p_protocol) is distinct from 'object'
     or pg_catalog.pg_column_size(p_protocol) > 32768
     or pg_catalog.jsonb_typeof(p_lineage) is distinct from 'object'
     or pg_catalog.pg_column_size(p_lineage) > 16384
     or not (p_lineage ?& array['parentRunId','hypothesis','changedFields','userAttestedTestWindowSeenBeforeChange','iterationNumber'])
     or (p_lineage - 'parentRunId' - 'hypothesis' - 'changedFields' - 'userAttestedTestWindowSeenBeforeChange' - 'iterationNumber') <> '{}'::jsonb
     or pg_catalog.jsonb_typeof(p_lineage->'parentRunId') not in ('string','null')
     or pg_catalog.jsonb_typeof(p_lineage->'hypothesis') is distinct from 'string'
     or char_length(btrim(p_lineage->>'hypothesis')) > 500
     or pg_catalog.jsonb_typeof(p_lineage->'changedFields') is distinct from 'array'
     or pg_catalog.jsonb_array_length(p_lineage->'changedFields') > 32
     or exists (
       select 1 from pg_catalog.jsonb_array_elements(p_lineage->'changedFields') as f(value)
       where pg_catalog.jsonb_typeof(f.value) is distinct from 'string'
          or char_length(btrim(f.value #>> '{}')) not between 1 and 120
     )
     or pg_catalog.jsonb_typeof(p_lineage->'userAttestedTestWindowSeenBeforeChange') is distinct from 'boolean'
     or pg_catalog.jsonb_typeof(p_lineage->'iterationNumber') is distinct from 'number'
     or p_lineage->>'iterationNumber' !~ '^[1-9][0-9]*$'
     or (p_lineage->>'iterationNumber')::numeric > 2147483647 then
    raise exception 'invalid lineage' using errcode = '22023';
  end if;
  v_iteration := (p_lineage->>'iterationNumber')::integer;

  if p_lineage->'parentRunId' = 'null'::jsonb then
    if v_version_parent is not null
       or v_iteration <> 1
       or pg_catalog.jsonb_array_length(p_lineage->'changedFields') <> 0
       or (p_lineage->>'userAttestedTestWindowSeenBeforeChange')::boolean
       or btrim(p_lineage->>'hypothesis') <> '' then
      raise exception 'invalid root lineage' using errcode = '22023';
    end if;
    v_parent := null;
  else
    if v_version_parent is null
       or p_lineage->>'parentRunId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or pg_catalog.jsonb_array_length(p_lineage->'changedFields') = 0
       or char_length(btrim(p_lineage->>'hypothesis')) not between 1 and 500 then
      raise exception 'invalid child lineage' using errcode = '22023';
    end if;
    v_parent := (p_lineage->>'parentRunId')::uuid;
    select e.iteration_number, pv.spec into v_parent_iteration, v_parent_spec
    from private.strategy_lab_experiments as e
    join private.strategy_lab_versions as pv
      on pv.id = e.strategy_version_id and pv.strategy_id = e.strategy_id and pv.user_id = e.user_id
    where e.id = v_parent and e.user_id = v_user and e.strategy_id = v_strategy
      and e.strategy_version_id = v_version_parent;
    if v_parent_iteration is null or v_iteration <> v_parent_iteration + 1 then
      raise exception 'invalid child lineage' using errcode = '22023';
    end if;
    select coalesce(pg_catalog.jsonb_agg(k.key order by k.key), '[]'::jsonb)
    into v_expected_changed_fields
    from (
      select pg_catalog.jsonb_object_keys(v_parent_spec) as key
      union
      select pg_catalog.jsonb_object_keys(v_spec) as key
    ) as k
    where v_parent_spec->k.key is distinct from v_spec->k.key;
    if p_lineage->'changedFields' is distinct from v_expected_changed_fields then
      raise exception 'changed fields do not match approved specs' using errcode = '22023';
    end if;
  end if;

  if pg_catalog.jsonb_typeof(p_manifest) is distinct from 'object'
     or pg_catalog.pg_column_size(p_manifest) > 65536
     or not (p_manifest ?& array['schemaVersion','provider','strategyVersionId','compilerVersion','pineHash','symbol','timeframe','timezone','compileWindow','initialCapital','exportedAt','tradesFileHash','metricsFileHash'])
     or (p_manifest - 'schemaVersion' - 'provider' - 'strategyVersionId' - 'compilerVersion' - 'pineHash' - 'symbol' - 'timeframe' - 'timezone' - 'compileWindow' - 'initialCapital' - 'exportedAt' - 'tradesFileHash' - 'metricsFileHash') <> '{}'::jsonb
     or p_manifest->>'schemaVersion' <> '1'
     or p_manifest->>'provider' <> 'tradingview'
     or p_manifest->>'strategyVersionId' is distinct from p_version_id::text
     or p_manifest->>'symbol' is distinct from v_spec#>>'{universe,symbol}'
     or p_manifest->>'timeframe' is distinct from v_spec->>'timeframe'
     or p_manifest->>'timezone' <> 'UTC'
     or char_length(p_manifest->>'compilerVersion') not between 1 and 64
     or p_manifest->>'pineHash' !~ '^[0-9a-f]{64}$'
     or p_manifest->>'tradesFileHash' !~ '^[0-9a-f]{64}$'
     or p_manifest->>'metricsFileHash' !~ '^[0-9a-f]{64}$'
     or pg_catalog.jsonb_typeof(p_manifest->'compileWindow') is distinct from 'object'
     or ((p_manifest->'compileWindow') - 'start'::text - 'end'::text) <> '{}'::jsonb
     or p_manifest#>>'{compileWindow,start}' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     or p_manifest#>>'{compileWindow,end}' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     or pg_catalog.to_char(pg_catalog.to_date(p_manifest#>>'{compileWindow,start}', 'YYYY-MM-DD'), 'YYYY-MM-DD') <> p_manifest#>>'{compileWindow,start}'
     or pg_catalog.to_char(pg_catalog.to_date(p_manifest#>>'{compileWindow,end}', 'YYYY-MM-DD'), 'YYYY-MM-DD') <> p_manifest#>>'{compileWindow,end}'
     or p_manifest#>>'{compileWindow,start}' >= p_manifest#>>'{compileWindow,end}'
     or pg_catalog.jsonb_typeof(p_manifest->'initialCapital') is distinct from 'number'
     or (p_manifest->>'initialCapital')::numeric <= 0
     or (p_manifest->>'initialCapital')::numeric > 1000000000000
     or pg_catalog.jsonb_typeof(p_manifest->'exportedAt') is distinct from 'string' then
    raise exception 'manifest does not match immutable strategy version' using errcode = '22023';
  end if;

  if pg_catalog.jsonb_typeof(p_provider_metrics) is distinct from 'object'
     or pg_catalog.pg_column_size(p_provider_metrics) > 65536
     or pg_catalog.jsonb_typeof(p_trades) is distinct from 'array'
     or pg_catalog.jsonb_array_length(p_trades) > 20000
     or pg_catalog.pg_column_size(p_trades) > 16777216
     or pg_catalog.jsonb_typeof(p_evidence) is distinct from 'object'
     or pg_catalog.pg_column_size(p_evidence) > 65536
     or p_evidence_hash !~ '^[0-9a-f]{64}$'
     or char_length(p_engine_version) not between 1 and 64 then
    raise exception 'invalid run payload' using errcode = '22023';
  end if;

  v_start_ms := (
    extract(epoch from ((p_manifest#>>'{compileWindow,start}')::date::timestamp without time zone at time zone 'UTC')) * 1000
  )::bigint;
  v_end_ms := (
    extract(epoch from ((p_manifest#>>'{compileWindow,end}')::date::timestamp without time zone at time zone 'UTC')) * 1000
  )::bigint;
  if exists (
    select 1 from pg_catalog.jsonb_array_elements(p_trades) as x(t)
    where pg_catalog.jsonb_typeof(x.t) is distinct from 'object'
       or not (x.t ?& array['id','side','entryAt','exitAt','entryPrice','exitPrice','quantity','grossPnl','fees','netPnl'])
       or (x.t - 'id' - 'side' - 'entryAt' - 'exitAt' - 'entryPrice' - 'exitPrice' - 'quantity' - 'grossPnl' - 'fees' - 'netPnl') <> '{}'::jsonb
       or pg_catalog.jsonb_typeof(x.t->'id') is distinct from 'string'
       or char_length(x.t->>'id') not between 1 and 64
       or x.t->>'side' <> 'long'
       or pg_catalog.jsonb_typeof(x.t->'entryAt') is distinct from 'number'
       or pg_catalog.jsonb_typeof(x.t->'exitAt') is distinct from 'number'
       or x.t->>'entryAt' !~ '^[0-9]+$'
       or x.t->>'exitAt' !~ '^[0-9]+$'
       or (x.t->>'entryAt')::numeric > 9223372036854775807
       or (x.t->>'exitAt')::numeric > 9223372036854775807
       or (x.t->>'entryAt')::bigint < v_start_ms
       or (x.t->>'entryAt')::bigint >= v_end_ms
       or (x.t->>'exitAt')::bigint < (x.t->>'entryAt')::bigint
       or pg_catalog.jsonb_typeof(x.t->'entryPrice') is distinct from 'number'
       or pg_catalog.jsonb_typeof(x.t->'exitPrice') is distinct from 'number'
       or pg_catalog.jsonb_typeof(x.t->'quantity') is distinct from 'number'
       or pg_catalog.jsonb_typeof(x.t->'grossPnl') is distinct from 'number'
       or pg_catalog.jsonb_typeof(x.t->'fees') is distinct from 'number'
       or pg_catalog.jsonb_typeof(x.t->'netPnl') is distinct from 'number'
       or (x.t->>'entryPrice')::numeric <= 0
       or (x.t->>'entryPrice')::numeric > 1000000000000000000
       or (x.t->>'exitPrice')::numeric <= 0
       or (x.t->>'exitPrice')::numeric > 1000000000000000000
       or (x.t->>'quantity')::numeric <= 0
       or (x.t->>'quantity')::numeric > 1000000000000000000
       or (x.t->>'fees')::numeric < 0
       or (x.t->>'fees')::numeric > 1000000000000000000
       or abs((x.t->>'grossPnl')::numeric) > 1000000000000000000
       or abs((x.t->>'netPnl')::numeric) > 1000000000000000000
  ) then
    raise exception 'invalid trade data' using errcode = '22023';
  end if;

  insert into private.strategy_lab_experiments
    (id, user_id, strategy_id, strategy_version_id, parent_experiment_id, iteration_number, protocol, lineage, status)
  values (v_experiment, v_user, v_strategy, p_version_id, v_parent, v_iteration, p_protocol, p_lineage, 'evidence-ready');

  insert into private.strategy_lab_imports
    (id, user_id, strategy_id, experiment_id, provider, manifest, provider_metrics, trades_file_hash, metrics_file_hash)
  values (
    v_import, v_user, v_strategy, v_experiment, 'tradingview', p_manifest, p_provider_metrics,
    p_manifest->>'tradesFileHash', p_manifest->>'metricsFileHash'
  );

  insert into private.strategy_lab_trades
    (user_id, strategy_id, import_id, trade_id, side, entry_at_ms, exit_at_ms, entry_price, exit_price, quantity, gross_pnl, fees, net_pnl)
  select
    v_user, v_strategy, v_import, t->>'id', t->>'side',
    (t->>'entryAt')::bigint, (t->>'exitAt')::bigint,
    (t->>'entryPrice')::numeric, (t->>'exitPrice')::numeric,
    (t->>'quantity')::numeric, (t->>'grossPnl')::numeric,
    (t->>'fees')::numeric, (t->>'netPnl')::numeric
  from pg_catalog.jsonb_array_elements(p_trades) as x(t);

  insert into private.strategy_lab_evidence_reports
    (id, user_id, strategy_id, experiment_id, evidence_hash, report, engine_version)
  values (v_evidence_id, v_user, v_strategy, v_experiment, p_evidence_hash, p_evidence, p_engine_version);

  v_result := pg_catalog.jsonb_build_object(
    'experimentId', v_experiment,
    'importId', v_import,
    'evidenceReportId', v_evidence_id,
    'evidenceHash', p_evidence_hash,
    'iterationNumber', v_iteration
  );
  return private.strategy_lab_store_delivery(v_user, 'run', p_request_uuid, p_payload_hash, v_result);
end;
$$;
revoke all on function public.strategy_lab_append_run(text, bigint, uuid, text, uuid, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, text, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.strategy_lab_append_run(text, bigint, uuid, text, uuid, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, text, text, uuid) to anon;

drop function if exists public.paper_open(text, bigint, text, text, numeric, numeric, numeric, numeric, numeric, jsonb, text);
create or replace function public.paper_open(
  p_secret text, p_telegram_id bigint, p_market text, p_side text,
  p_entry numeric, p_size numeric, p_sl numeric, p_tp numeric,
  p_entry_fee numeric, p_checklist jsonb, p_reason text,
  p_account_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare v_uid uuid; v_open int; v_row paper_trades; v_notional numeric;
begin
  perform private.beta_check_secret(p_secret);
  v_uid := private.account_actor_required(p_telegram_id, p_account_id, 'paper');

  select count(*) into v_open from paper_trades where user_id = v_uid and status = 'open';
  if v_open >= 10 then raise exception 'max 10 open paper trades'; end if;

  v_notional := p_entry * p_size;
  if v_notional < 5 then raise exception 'min notional $5'; end if;
  if v_notional > 250000 then raise exception 'max notional $250k'; end if;

  -- discipline gate: SL is mandatory in paper, on the correct side; TP on the correct side if set
  if p_sl is null then raise exception 'stop-loss required'; end if;
  if p_side = 'long' and p_sl >= p_entry then raise exception 'sl must be below entry for long'; end if;
  if p_side = 'short' and p_sl <= p_entry then raise exception 'sl must be above entry for short'; end if;
  if p_tp is not null then
    if p_side = 'long' and p_tp <= p_entry then raise exception 'tp must be above entry for long'; end if;
    if p_side = 'short' and p_tp >= p_entry then raise exception 'tp must be below entry for short'; end if;
  end if;
  if p_reason is null or length(trim(p_reason)) < 10 then raise exception 'pre-trade reason required (min 10 chars)'; end if;
  if p_entry_fee is null or p_entry_fee < 0 or p_entry_fee > v_notional * 0.01 then raise exception 'bad fee'; end if;

  insert into paper_trades (user_id, market, side, entry_price, size, sl, tp, fees, checklist, reason)
  values (v_uid, p_market, p_side, p_entry, p_size, p_sl, p_tp, p_entry_fee, p_checklist, trim(p_reason))
  returning * into v_row;
  return private.paper_trade_json(v_row);
end $$;
revoke all on function public.paper_open(text, bigint, text, text, numeric, numeric, numeric, numeric, numeric, jsonb, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.paper_open(text, bigint, text, text, numeric, numeric, numeric, numeric, numeric, jsonb, text, uuid) to anon;

drop function if exists public.paper_close(text, bigint, uuid, numeric, numeric, text);
create or replace function public.paper_close(
  p_secret text, p_telegram_id bigint, p_trade_id uuid, p_exit numeric, p_exit_fee numeric, p_reason text,
  p_account_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare v_uid uuid; v_row paper_trades; v_dir numeric; v_pnl numeric;
begin
  perform private.beta_check_secret(p_secret);
  v_uid := private.account_actor_required(p_telegram_id, p_account_id, 'paper');

  select * into v_row from paper_trades where id = p_trade_id and user_id = v_uid for update;
  if v_row.id is null then raise exception 'trade not found'; end if;
  if v_row.status = 'closed' then raise exception 'already closed'; end if;
  if p_exit is null or p_exit <= 0 then raise exception 'bad exit price'; end if;
  if p_reason not in ('manual','sl','tp') then raise exception 'bad exit reason'; end if;
  if p_exit_fee is null or p_exit_fee < 0 or p_exit_fee > p_exit * v_row.size * 0.01 then raise exception 'bad fee'; end if;

  v_dir := case when v_row.side = 'long' then 1 else -1 end;
  v_pnl := (p_exit - v_row.entry_price) * v_row.size * v_dir - v_row.fees - p_exit_fee;

  update paper_trades set
    status = 'closed', exit_price = p_exit, exit_reason = p_reason,
    fees = fees + p_exit_fee, pnl = v_pnl, closed_at = now()
  where id = v_row.id
  returning * into v_row;
  return private.paper_trade_json(v_row);
end $$;
revoke all on function public.paper_close(text, bigint, uuid, numeric, numeric, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.paper_close(text, bigint, uuid, numeric, numeric, text, uuid) to anon;

drop function if exists public.paper_journal(text, bigint, uuid, boolean, text, text);
create or replace function public.paper_journal(
  p_secret text, p_telegram_id bigint, p_trade_id uuid,
  p_followed boolean, p_mistake text, p_lesson text,
  p_account_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare v_uid uuid; v_row paper_trades;
begin
  perform private.beta_check_secret(p_secret);
  v_uid := private.account_actor_required(p_telegram_id, p_account_id, 'paper');
  update paper_trades set
    followed_plan = coalesce(p_followed, followed_plan),
    mistake_tag = coalesce(nullif(trim(p_mistake), ''), mistake_tag),
    lesson = coalesce(nullif(trim(p_lesson), ''), lesson)
  where id = p_trade_id and user_id = v_uid and status = 'closed'
  returning * into v_row;
  if v_row.id is null then raise exception 'closed trade not found'; end if;
  return private.paper_trade_json(v_row);
end $$;
revoke all on function public.paper_journal(text, bigint, uuid, boolean, text, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.paper_journal(text, bigint, uuid, boolean, text, text, uuid) to anon;

drop function if exists public.paper_list(text, bigint);
create or replace function public.paper_list(p_secret text, p_telegram_id bigint, p_account_id uuid default null) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare v_uid uuid;
begin
  perform private.beta_check_secret(p_secret);
  v_uid := private.account_actor_required(p_telegram_id, p_account_id, 'paper');
  return jsonb_build_object(
    'open', (select coalesce(jsonb_agg(private.paper_trade_json(t) order by t.opened_at desc), '[]'::jsonb)
             from paper_trades t where t.user_id = v_uid and t.status = 'open'),
    'closed', (select coalesce(jsonb_agg(x.j), '[]'::jsonb) from (
                 select private.paper_trade_json(t) j from paper_trades t
                 where t.user_id = v_uid and t.status = 'closed'
                 order by t.closed_at desc limit 50) x),
    'stats', (select jsonb_build_object(
        'balance', 10000 + coalesce(sum(t.pnl), 0),
        'trades', count(*),
        'wins', count(*) filter (where t.pnl > 0),
        'win_rate', case when count(*) > 0 then round(100.0 * count(*) filter (where t.pnl > 0) / count(*), 1) else null end,
        'avg_r', round(avg(case when t.sl is not null and abs(t.entry_price - t.sl) * t.size > 0
                     then t.pnl / (abs(t.entry_price - t.sl) * t.size) end)::numeric, 2),
        'journaled', count(*) filter (where t.followed_plan is not null),
        'adherence_pct', case when count(*) filter (where t.followed_plan is not null) > 0
                     then round(100.0 * count(*) filter (where t.followed_plan = true) / count(*) filter (where t.followed_plan is not null), 0) end)
      from paper_trades t where t.user_id = v_uid and t.status = 'closed')
  );
end $$;
revoke all on function public.paper_list(text, bigint, uuid) from public, anon, authenticated, service_role;
grant execute on function public.paper_list(text, bigint, uuid) to anon;

drop function if exists public.live_note_upsert(text, bigint, text, text, text, numeric, boolean, text, text);
create or replace function public.live_note_upsert(
  p_secret text, p_telegram_id bigint, p_trade_id text, p_market text, p_side text, p_pnl numeric,
  p_followed boolean, p_mistake text, p_lesson text,
  p_account_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare v_uid uuid; v_row live_notes;
begin
  perform private.beta_check_secret(p_secret);
  v_uid := private.account_actor_required(p_telegram_id, p_account_id, 'paper');
  if p_trade_id is null or length(p_trade_id) > 64 then raise exception 'bad trade id'; end if;
  insert into live_notes (user_id, trade_id, market, side, pnl, followed_plan, mistake_tag, lesson)
  values (v_uid, p_trade_id, p_market, p_side, p_pnl, p_followed, nullif(trim(p_mistake), ''), nullif(trim(p_lesson), ''))
  on conflict (user_id, trade_id) do update set
    followed_plan = coalesce(excluded.followed_plan, live_notes.followed_plan),
    mistake_tag = coalesce(excluded.mistake_tag, live_notes.mistake_tag),
    lesson = coalesce(excluded.lesson, live_notes.lesson),
    pnl = coalesce(excluded.pnl, live_notes.pnl),
    updated_at = now()
  returning * into v_row;
  return jsonb_build_object('trade_id', v_row.trade_id, 'followed_plan', v_row.followed_plan,
    'mistake_tag', v_row.mistake_tag, 'lesson', v_row.lesson);
end $$;
revoke all on function public.live_note_upsert(text, bigint, text, text, text, numeric, boolean, text, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.live_note_upsert(text, bigint, text, text, text, numeric, boolean, text, text, uuid) to anon;

drop function if exists public.live_notes_list(text, bigint);
create or replace function public.live_notes_list(p_secret text, p_telegram_id bigint, p_account_id uuid default null) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare v_uid uuid;
begin
  perform private.beta_check_secret(p_secret);
  v_uid := private.account_actor_required(p_telegram_id, p_account_id, 'paper');
  return coalesce((select jsonb_object_agg(n.trade_id, jsonb_build_object(
      'followed_plan', n.followed_plan, 'mistake_tag', n.mistake_tag, 'lesson', n.lesson))
    from live_notes n where n.user_id = v_uid), '{}'::jsonb);
end $$;
revoke all on function public.live_notes_list(text, bigint, uuid) from public, anon, authenticated, service_role;
grant execute on function public.live_notes_list(text, bigint, uuid) to anon;

drop function if exists public.beta_set_language(text, bigint, text);
create or replace function public.beta_set_language(p_secret text, p_telegram_id bigint, p_language text, p_account_id uuid default null) returns boolean
language plpgsql security definer set search_path = public, private as $$
begin
  perform private.beta_check_secret(p_secret);
  if p_language not in ('en','uk','ru') then raise exception 'bad language'; end if;
  update beta_users set language = p_language, updated_at = now() where id = private.account_actor(p_telegram_id, p_account_id, 'settings');
  return found;
end $$;
revoke all on function public.beta_set_language(text, bigint, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.beta_set_language(text, bigint, text, uuid) to anon;

drop function if exists public.account_login_record(text, bigint, text, text, boolean, text, text);
create or replace function public.account_login_record(
  p_secret text,
  p_telegram_id bigint,
  p_wallet text,
  p_kind text,
  p_admin boolean,
  p_target text,
  p_nonce text,
  p_account_id uuid default null
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
  if p_kind not in ('telegram_link', 'wallet_siwe', 'email_password', 'email_recovery', 'google_oidc', 'telegram_oidc', 'solana_siws') then
    return jsonb_build_object('ok', false, 'error', 'bad_kind');
  end if;
  if p_target is not null and p_target not in ('admin', 'app', 'beta', 'demo') then
    return jsonb_build_object('ok', false, 'error', 'bad_target');
  end if;
  if p_nonce is not null and char_length(p_nonce) not between 8 and 128 then
    return jsonb_build_object('ok', false, 'error', 'bad_nonce');
  end if;
  v_user := coalesce((select u.id from public.beta_users u where u.id = p_account_id), private.activity_resolve_user(p_telegram_id, p_wallet));
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
revoke all on function public.account_login_record(text, bigint, text, text, boolean, text, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.account_login_record(text, bigint, text, text, boolean, text, text, uuid) to anon;

drop function if exists public.product_event_append(text, bigint, text, text, text, text, text, text, text, jsonb);
create or replace function public.product_event_append(
  p_secret text,
  p_telegram_id bigint,
  p_wallet text,
  p_actor_kind text,
  p_actor_key text,
  p_name text,
  p_outcome text,
  p_error_class text,
  p_surface text,
  p_props jsonb,
  p_account_id uuid default null
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
    v_user := coalesce((select u.id from public.beta_users u where u.id = p_account_id), private.activity_resolve_user(p_telegram_id, p_wallet));
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
revoke all on function public.product_event_append(text, bigint, text, text, text, text, text, text, text, jsonb, uuid) from public, anon, authenticated, service_role;
grant execute on function public.product_event_append(text, bigint, text, text, text, text, text, text, text, jsonb, uuid) to anon;

drop function if exists public.admin_user_activity(text, bigint);
create or replace function public.admin_user_activity(p_secret text, p_telegram_id bigint, p_account_id uuid default null)
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
  select u.id into v_user from public.beta_users u where (p_account_id is not null and u.id = p_account_id) or (p_account_id is null and u.telegram_id = p_telegram_id);
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  v_operator := exists (select 1 from private.admin_operators o where o.account_id = v_user or (p_telegram_id is not null and o.telegram_id = p_telegram_id));
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
revoke all on function public.admin_user_activity(text, bigint, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_user_activity(text, bigint, uuid) to anon;

create or replace function public.admin_users_page(
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
      u.id as account_id,
      (u.auth_user_id is not null) as auth_linked,
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
      exists (select 1 from private.admin_operators o where o.telegram_id = u.telegram_id or o.account_id = u.id) as is_operator,
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
      lower(coalesce(nullif(u.telegram_username, ''), nullif(u.first_name, ''), u.telegram_id::text, left(u.id::text, 8))) as display
      from public.beta_users u
      left join public.beta_access a on a.user_id = u.id
      left join private.access_controls c on c.user_id = u.id
     where (u.telegram_id is not null or u.auth_user_id is not null)
       and (
         v_query is null
         or lower(coalesce(u.telegram_username, '')) like '%' || lower(v_query) || '%'
         or lower(coalesce(u.first_name, '')) like '%' || lower(v_query) || '%'
         or u.telegram_id::text = v_query
         or u.id::text = v_query
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
revoke all on function public.admin_users_page(text, text, text, text, text, integer, integer) from public, anon, authenticated, service_role;
grant execute on function public.admin_users_page(text, text, text, text, text, integer, integer) to anon;

create or replace function public.admin_activity_summary(p_secret text, p_now timestamptz default null)
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
      join private.admin_operators o on o.telegram_id = u.telegram_id or o.account_id = u.id
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
revoke all on function public.admin_activity_summary(text, timestamp with time zone) from public, anon, authenticated, service_role;
grant execute on function public.admin_activity_summary(text, timestamp with time zone) to anon;

commit;
