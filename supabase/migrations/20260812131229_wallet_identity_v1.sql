-- APPLIED to production project lbphobwqzwdkbmyedlwb as migration 20260812131229,
-- under explicit authorization on 2026-08-12.
--
-- Wallet sign-in, step 2: give an account an identity that is not a Telegram id.
--
-- VERIFIED IMMEDIATELY AFTER APPLYING, against the live database:
--   4 users before and after; all 4 still carry their telegram_id; 0 verified
--   wallets written; the 2 legacy watch addresses untouched; 1 paper trade
--   untouched. Purely additive — no UPDATE ran against an existing row.
--   A rolled-back probe confirmed every constraint actually bites:
--     shape_uppercase=refused  shape_garbage=refused  no_identity=refused
--     wallet_only=allowed      duplicate_wallet=refused  duplicate_telegram=refused
--   The probe raised deliberately so nothing it inserted survived; a follow-up
--   count confirmed zero probe rows remained.
--   Supabase security advisors report NO finding against either new function:
--   the `revoke` lines below keep them off anon and authenticated, unlike the
--   27 pre-existing security-definer RPCs the same report flags.
--
-- WHY THIS FILE EXISTS AND THE APP CODE COULD NOT SHIP WITHOUT IT
--   `public.beta_users.telegram_id` was `bigint unique not null`, so **no
--   account could exist without Telegram**. Every downstream table keys on
--   `beta_users.id` and every RPC takes `p_telegram_id bigint` and resolves it.
--   Proving control of a wallet — which `lib/auth/siwe.ts` does, verified — has
--   nowhere to land until this ran. That was the whole blocker, and it is a
--   schema change on the production database holding every user's account,
--   paper trades and journal, so it needed an explicit owner decision rather
--   than an automated one. That authorization was given.
--
-- THE SECURITY DECISION THIS FILE IS BUILT AROUND
--   `beta_users.wallet_address` **must never become the login identity.** It is
--   an unverified *watch* address: the terminal invites anyone to "paste any
--   address above to view it", so live rows contain addresses their owners have
--   never controlled and, in some cases, addresses belonging to other people.
--   Promoting that column to an authentication key would let anyone who signs
--   with an address take over every account that had ever watched it. This is
--   not hypothetical: at the time of applying, production held 4 users, 2 with
--   a watch address, and only **1 distinct address between them** — one
--   signature would have resolved to two accounts. The
--   verified address therefore gets its own column, written only by the
--   signature path, and the two are never conflated.
--
-- DESIGN BOUNDARIES THIS FILE MUST KEEP
--   * an account needs at least one identity. `beta_identity_present` refuses a
--     row with neither, so relaxing `telegram_id` cannot silently create
--     unreachable accounts.
--   * `verified_wallet` is unique and stored lower-case. Postgres allows many
--     NULLs under a unique index, which is exactly what lets most accounts
--     carry no wallet while no two accounts share one.
--   * an address is claimed once. Linking refuses an address already bound to a
--     different account rather than moving it, because moving it is account
--     takeover with extra steps.
--   * no dynamic SQL; `search_path` is empty and every name is fully qualified.
--   * nothing here grants access, status or priority. It records identity only.
--
-- ROLLOUT ORDER WAS MANDATORY AND WAS FOLLOWED
--   1. apply this migration            <- done, 20260812131229
--   2. deploy the app that calls `beta_link_verified_wallet` / `beta_user_by_wallet`
--   Deploying the app first would have failed closed: the RPCs absent, PostgREST
--   erroring, wallet sign-in reporting unavailable. Applying this first changed
--   no behaviour on its own — the column is null everywhere and nothing reads
--   it yet, which is exactly why step 2 can be taken calmly.
--
-- ROLLBACK / RECOVERY
--   Revert the contract, keep any links already recorded:
--     drop function if exists public.beta_user_by_wallet(text, text);
--     drop function if exists public.beta_link_verified_wallet(text, bigint, text);
--   Full revert. Note the NOT NULL restore fails if any wallet-only account
--   exists by then; those must be resolved by the owner first, deliberately:
--     drop index if exists public.beta_users_verified_wallet_idx;
--     alter table public.beta_users drop constraint if exists beta_identity_present;
--     alter table public.beta_users drop column if exists verified_wallet;
--     alter table public.beta_users drop column if exists verified_wallet_at;
--     alter table public.beta_users alter column telegram_id set not null;

begin;

-- ---------------------------------------------------------------- identity --

alter table public.beta_users
  add column if not exists verified_wallet text,
  add column if not exists verified_wallet_at timestamptz;

-- Lower-case and shape are enforced at write time by the linking function; the
-- check makes a hand-written UPDATE unable to bypass it.
alter table public.beta_users
  drop constraint if exists beta_users_verified_wallet_shape;
alter table public.beta_users
  add constraint beta_users_verified_wallet_shape
  check (verified_wallet is null or verified_wallet ~ '^0x[0-9a-f]{40}$');

-- One account per address. Many NULLs are permitted, which is the point.
create unique index if not exists beta_users_verified_wallet_idx
  on public.beta_users (verified_wallet)
  where verified_wallet is not null;

-- A Telegram id is no longer required, but *some* identity is.
alter table public.beta_users alter column telegram_id drop not null;

alter table public.beta_users
  drop constraint if exists beta_identity_present;
alter table public.beta_users
  add constraint beta_identity_present
  check (telegram_id is not null or verified_wallet is not null);

-- --------------------------------------------------------------- functions --

-- Bind a proven address to an account.
--
-- The caller has already verified an EIP-4361 signature over a server-issued,
-- single-use nonce (`lib/auth/siwe.ts`). This function's job is the part that
-- must be atomic: claim the address, or refuse because someone else holds it.
create or replace function public.beta_link_verified_wallet(
  p_secret text,
  p_telegram_id bigint,
  p_wallet text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_wallet text := lower(nullif(trim(p_wallet), ''));
  v_holder uuid;
begin
  perform private.beta_check_secret(p_secret);

  if v_wallet is null or v_wallet !~ '^0x[0-9a-f]{40}$' then
    return jsonb_build_object('ok', false, 'error', 'bad_wallet');
  end if;

  select id into v_id from public.beta_users where telegram_id = p_telegram_id;
  if v_id is null then
    return jsonb_build_object('ok', false, 'error', 'no_user');
  end if;

  -- An address already claimed by another account is not moved. Moving it on a
  -- fresh signature would let anyone who controls an address evict whoever
  -- linked it first, which is takeover dressed as a re-link.
  select id into v_holder from public.beta_users where verified_wallet = v_wallet;
  if v_holder is not null and v_holder <> v_id then
    return jsonb_build_object('ok', false, 'error', 'wallet_taken');
  end if;

  update public.beta_users
     set verified_wallet = v_wallet,
         verified_wallet_at = now(),
         updated_at = now()
   where id = v_id;

  return jsonb_build_object('ok', true, 'user_id', v_id, 'wallet', v_wallet);
end $$;

revoke all on function public.beta_link_verified_wallet(text, bigint, text) from public, anon, authenticated;

-- Resolve an account from a proven address.
--
-- Returns identity only — never access, status or state. The caller reads state
-- through the existing `beta_get_state` path once it knows who this is, so this
-- function cannot become a second, divergent view of an account.
create or replace function public.beta_user_by_wallet(
  p_secret text,
  p_wallet text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_wallet text := lower(nullif(trim(p_wallet), ''));
  v_row public.beta_users%rowtype;
begin
  perform private.beta_check_secret(p_secret);

  if v_wallet is null or v_wallet !~ '^0x[0-9a-f]{40}$' then
    return jsonb_build_object('ok', false, 'error', 'bad_wallet');
  end if;

  select * into v_row from public.beta_users where verified_wallet = v_wallet;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  return jsonb_build_object(
    'ok', true,
    'user_id', v_row.id,
    'telegram_id', v_row.telegram_id,
    'verified_wallet', v_row.verified_wallet,
    'verified_wallet_at', v_row.verified_wallet_at
  );
end $$;

revoke all on function public.beta_user_by_wallet(text, text) from public, anon, authenticated;

commit;

-- WHAT IS DELIBERATELY NOT IN THIS FILE
--   Creating a wallet-only account. The column and the constraint make one
--   representable, and that is as far as a schema change should go on its own:
--   a new account also needs a referral code, a proof code, an access row and a
--   decision about what `verified` means for someone who never used the bot —
--   product questions, not storage ones. They land with the app packet that
--   asks them, against a schema that can already hold the answer.
