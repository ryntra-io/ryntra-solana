-- A wallet becomes an account.
--
-- AUTHORIZED 2026-08-19.
-- Every production migration needs an explicit approval, and this one has it.
--
-- WHY THIS FILE EXISTS
--   `20260812131229_wallet_identity_v1` made a wallet-only row *representable*:
--   `beta_users.telegram_id` became nullable under
--   `check (telegram_id is not null or verified_wallet is not null)`. Its own
--   closing note said creating one was deliberately left out, because a new
--   account "also needs a referral code, a proof code, an access row and a
--   decision about what `verified` means for someone who never used the bot —
--   product questions, not storage ones." Those questions have answers now, and
--   this is the file that carries them.
--
-- THE ANSWERS
--   referral_code / proof_code — generated exactly as `beta_upsert_user`
--     generates them, seeded from the wallet instead of the Telegram id. Same
--     shape, same uniqueness, no second scheme.
--   tasks — the same three rows, all pending. A wallet account has not joined
--     the channel, followed on X or used the referral, and pretending otherwise
--     would be inventing a fact about a person.
--   `verified` — **stays exactly what it was: the Telegram channel join.** This
--     is the load-bearing answer. A wallet account signs in, reads everything
--     and keeps its own journal and plans, and it is *not verified*. The one
--     surface that checks `verified` is `/app/connect`, which provisions a
--     trading credential — so the credential stays behind the stronger identity
--     without a single new gate being written. Opening access and keeping that
--     door shut turned out to be the same flag, already there.
--
-- WHAT THIS FILE DOES NOT DO
--   It does not touch `beta_upsert_user`, `beta_set_task` or any existing
--   function. A Telegram account created before this migration behaves
--   identically after it. There is no data migration because there is no data
--   to move: no wallet-only row exists yet, by construction.

begin;

-- ---------------------------------------------------------------- creation --
--
-- Create an account from a proven wallet, or return the one that already holds
-- it. The proof happened in `app/api/auth/wallet` against a server-issued,
-- single-use SIWE nonce; this function records the result and never verifies a
-- signature itself — the same division `beta_link_verified_wallet` uses.
--
-- Returning the existing account rather than raising on conflict is deliberate.
-- Sign-in is idempotent by nature: a person clicking twice is not an error, and
-- a unique-violation surfaced to the caller would have to be translated back
-- into "you are already signed in" by every caller that ever exists.
create or replace function public.beta_create_wallet_user(
  p_secret text,
  p_wallet text
) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare
  v_wallet text := lower(nullif(trim(p_wallet), ''));
  v_id uuid;
  v_new bool := false;
begin
  perform private.beta_check_secret(p_secret);

  -- The same shape the read path enforces. An address that is not 20 bytes of
  -- hex is not a wallet, and this is the last place that can still say so.
  if v_wallet is null or v_wallet !~ '^0x[0-9a-f]{40}$' then
    return jsonb_build_object('ok', false, 'error', 'bad_wallet');
  end if;

  select id into v_id from beta_users where verified_wallet = v_wallet;

  if v_id is null then
    insert into beta_users (
      telegram_id, verified_wallet, verified_wallet_at, language, referral_code, proof_code
    ) values (
      null,
      v_wallet,
      now(),
      'en',
      upper(substr(md5(v_wallet || gen_random_uuid()::text), 1, 8)),
      'RYNTRA-' || upper(substr(md5(gen_random_uuid()::text), 1, 4))
    ) returning id into v_id;
    v_new := true;

    -- The same three tasks, all pending. A wallet account has done none of
    -- them, and `telegram_join` staying pending is what keeps `verified` false.
    insert into beta_tasks (user_id, task_type) values
      (v_id, 'telegram_join'), (v_id, 'arcus_referral'), (v_id, 'x_follow')
    on conflict do nothing;
  end if;

  perform private.beta_recompute(v_id);
  return private.beta_state_json(v_id) || jsonb_build_object('ok', true, 'is_new', v_new);
end $$;

revoke all on function public.beta_create_wallet_user(text, text) from public, anon, authenticated;

-- -------------------------------------------------------------------- read --
--
-- State for an account identified by its wallet.
--
-- `beta_get_state` takes a Telegram id and resolves it to `beta_users.id`,
-- which cannot serve an account whose Telegram id is null. This is the same
-- read through the same `private.beta_state_json`, entered by the other key —
-- not a second view of an account, which is the mistake `beta_user_by_wallet`
-- was written to avoid.
create or replace function public.beta_state_by_wallet(
  p_secret text,
  p_wallet text
) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare
  v_wallet text := lower(nullif(trim(p_wallet), ''));
  v_id uuid;
begin
  perform private.beta_check_secret(p_secret);

  if v_wallet is null or v_wallet !~ '^0x[0-9a-f]{40}$' then
    return null;
  end if;

  select id into v_id from beta_users where verified_wallet = v_wallet;
  if v_id is null then
    return null;
  end if;

  return private.beta_state_json(v_id);
end $$;

revoke all on function public.beta_state_by_wallet(text, text) from public, anon, authenticated;

commit;

-- WHAT IS DELIBERATELY NOT IN THIS FILE
--   Any change to what `verified` means. A wallet account is signed in and not
--   verified, and every surface that already reads that flag keeps its current
--   behaviour without being touched.
--   Any paid or tiered access. It is separate work and it stays separate;
--   nothing here stores a plan, a tier or an entitlement.
--   Any mutation keyed on a wallet. Task writes still go through
--   `beta_set_task(p_telegram_id)`, so a wallet-only account cannot yet
--   complete a task — which is correct, because every one of those three tasks
--   is a Telegram or X action it has not performed.
