-- RYN-BETA-001 · prepared, NOT APPLIED to production.
--
-- Retires the reward ladder at its source.
--
-- Removing the ladder from every screen was not enough: the mechanism kept running
-- underneath. `private.beta_recompute` still paid two points for an Arcus task, one for an X
-- follow and two per verified invite; `public.beta_set_wallet` still marked the Arcus task
-- submitted as a side effect of saving an address; and `public.beta_set_task` still
-- recomputed a legacy inviter's reward whenever someone confirmed access. A user could not
-- see any of it, which makes it worse rather than better — the numbers were real and the
-- product denied they existed.
--
-- After this, access is the only thing computed: confirmed, or not. `priority_score` is
-- pinned to zero rather than dropped, so existing readers keep working and no column
-- disappears from under the admin panel.
--
-- Applied migrations are not modified. These are `create or replace` definitions that
-- supersede the ones in 20260707074854_beta_gate_v1.sql and 20260707081249_beta_gate_v3.
--
-- ROLLBACK / RECOVERY
--   Run supabase/prepared/20260806_ryn_beta_001_retire_reward_ladder_rollback.sql.
--
--   Do NOT re-apply the original migrations to roll back. 20260707074854_beta_gate_v1.sql
--   seeds `private.app_config` with `on conflict (key) do update`, so re-running it would
--   overwrite the live `beta_secret` with the repository's redacted placeholder and fail
--   every beta_* RPC closed — login, access, paper and the bot alike. The rollback file
--   therefore carries only the previous function definitions and touches no configuration
--   row, no table and no data.
--
--   Nothing here deletes a row, so no user loses access in either direction. Historical
--   beta_tasks rows for arcus_referral and x_follow are left untouched as a record of what
--   happened; they simply stop meaning anything.

begin;

/**
 * Access is binary. `telegram_join` remains the storage identifier for the confirmed-access
 * flag — a column name, not a channel requirement — so every already-verified row keeps its
 * meaning without a data migration.
 */
create or replace function private.beta_recompute(p_user_id uuid) returns void
language plpgsql security definer set search_path = public, private as $$
declare
  v_confirmed bool;
  v_status text;
begin
  select exists(
    select 1 from beta_tasks
     where user_id = p_user_id and task_type = 'telegram_join' and status = 'verified'
  ) into v_confirmed;

  v_status := case when v_confirmed then 'telegram_verified' else 'pending' end;

  insert into beta_access (user_id, status, priority_score, approved_at, updated_at)
  values (p_user_id, v_status, 0, case when v_confirmed then now() end, now())
  on conflict (user_id) do update
    set status = excluded.status,
        priority_score = 0,
        approved_at = coalesce(beta_access.approved_at, excluded.approved_at),
        updated_at = now();
end $$;

/**
 * Saving a wallet address is a product setting, not a rung. It no longer touches the Arcus
 * task, so an address cannot advance anything.
 */
create or replace function public.beta_set_wallet(p_secret text, p_telegram_id bigint, p_wallet text) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare v_id uuid;
begin
  perform private.beta_check_secret(p_secret);
  select id into v_id from beta_users where telegram_id = p_telegram_id;
  if v_id is null then raise exception 'user not found'; end if;
  if p_wallet !~ '^0x[a-fA-F0-9]{40}$' then raise exception 'bad wallet'; end if;
  update beta_users set wallet_address = p_wallet, updated_at = now() where id = v_id;
  perform private.beta_recompute(v_id);
  return private.beta_state_json(v_id);
end $$;

/**
 * Confirming access no longer pays anybody. The inviter recompute is gone, and the returned
 * inviter fields are kept as nulls so existing callers keep their shape.
 */
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
  return private.beta_state_json(v_id)
      || jsonb_build_object('inviter_telegram_id', null, 'inviter_language', null);
end $$;

/* The manual X-follow verification path is retired with its callers. */
drop function if exists public.beta_admin_verify(text, text);

commit;
