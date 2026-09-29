-- RYN-ACCESS-002 — a per-account cutoff for legacy stateless sessions.
--
-- PREPARED 2026-09-06 and verified locally in PGlite against the
-- production-equivalent set. **NOT applied to production**: applying it is a
-- separately authorized owner action, like every production migration.
--
-- WHY IT EXISTS
--   Sessions minted before `20260906120000` are stateless HMAC cookies. They
--   carry no session id, so `session_revoke` has nothing to revoke: «вийти
--   всюди» and a password reset deleted the browser's own copy and left every
--   other copy of that cookie working until it expired on its own. The only
--   other lever was rotating `BETA_TOKEN_SECRET`, which signs out every user
--   of the product at once — a global answer to a single account's problem.
--
--   This is the account-scoped lever: one timestamp on the account row, read
--   by the session resolver. A stateless cookie for a closed account stops
--   working; a recorded session is untouched (it has its own row and its own
--   revocation); nobody else is affected; no secret is rotated. The next bot
--   link mints a recorded session, so the person is one tap from being back.
--
-- WHAT IT DOES NOT DO
--   It does not delete anything, does not touch financial rows, and does not
--   change who owns what. `legacy_closed_at` is only ever set forward by the
--   two actions that mean «end my other sessions», and clearing it is not
--   exposed: an account that closed its legacy access does not silently
--   re-open it.

begin;

alter table public.beta_users
  add column if not exists legacy_closed_at timestamptz;

-- The state projection gains the cutoff. Signature unchanged, so this replaces
-- the function in place and leaves no second candidate behind.
create or replace function private.beta_state_json(p_user_id uuid) returns jsonb
language sql security definer set search_path = public, private as $$
  select jsonb_build_object(
    'user', (select jsonb_build_object(
        'id', u.id, 'telegram_id', u.telegram_id, 'username', u.telegram_username, 'first_name', u.first_name,
        'language', u.language, 'wallet_address', u.wallet_address, 'proof_code', u.proof_code,
        'referral_code', u.referral_code, 'created_at', u.created_at,
        'legacy_closed_at', u.legacy_closed_at)
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

-- Close legacy access for one account. Idempotent: a second call moves the
-- cutoff forward, which is still true, and never reports a close it did not do.
create function public.account_legacy_close(p_secret text, p_account_id uuid, p_reason text default 'logout_all')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated integer := 0;
begin
  perform private.beta_check_secret(p_secret);
  if p_reason not in ('logout_all', 'password_reset', 'role_revoked') then
    return jsonb_build_object('ok', false, 'error', 'bad_reason');
  end if;
  update public.beta_users
     set legacy_closed_at = clock_timestamp(), updated_at = now()
   where id = p_account_id;
  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  return jsonb_build_object('ok', true, 'closed', true);
end;
$$;

revoke all on function public.account_legacy_close(text, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.account_legacy_close(text, uuid, text) to anon;

commit;
