-- APPLIED to production project lbphobwqzwdkbmyedlwb as migration 20260712224258.
-- Rollout order is mandatory: apply this migration first, then deploy the JTI-aware app.
-- New login links fail closed if this RPC is unavailable. Existing no-JTI links remain compatible
-- until their signed expiry, then the compatibility branch can be removed after one full 7-day TTL.

begin;

create table if not exists private.login_nonce_consumption (
  jti text primary key check (jti ~ '^[A-Za-z0-9_-]{24}$'),
  expires_at timestamptz not null,
  used_at timestamptz not null default clock_timestamp()
);

alter table private.login_nonce_consumption enable row level security;

create index if not exists login_nonce_expiry_idx
  on private.login_nonce_consumption (expires_at);

create or replace function public.beta_consume_login_nonce(
  p_secret text,
  p_jti text,
  p_expires_at timestamptz
)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamptz := clock_timestamp();
  v_inserted integer := 0;
begin
  perform private.beta_check_secret(p_secret);

  if p_jti is null or p_jti !~ '^[A-Za-z0-9_-]{24}$' then
    return false;
  end if;

  if p_expires_at is null
     or p_expires_at <= v_now
     or p_expires_at > v_now + interval '8 days' then
    return false;
  end if;

  delete from private.login_nonce_consumption
  where expires_at <= v_now;

  insert into private.login_nonce_consumption (jti, expires_at, used_at)
  values (p_jti, p_expires_at, v_now)
  on conflict (jti) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted = 1;
end;
$$;

revoke all on table private.login_nonce_consumption from public, anon, authenticated;
revoke all on function public.beta_consume_login_nonce(text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.beta_consume_login_nonce(text, text, timestamptz) to anon;

commit;
