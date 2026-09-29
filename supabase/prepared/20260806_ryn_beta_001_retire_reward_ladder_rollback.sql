-- RYN-BETA-001 · rollback for 20260806_ryn_beta_001_retire_reward_ladder_v1.sql.
-- Prepared, NOT APPLIED. Run only under explicit owner approval.
--
-- WHY THIS FILE EXISTS RATHER THAN "re-apply the original migrations"
--
-- Re-running supabase/migrations/20260707074854_beta_gate_v1.sql would be destructive. It
-- seeds `private.app_config` with
--     insert into private.app_config (key, value)
--     values ('beta_secret', '<BETA_APP_SECRET — redacted in repo>')
--     on conflict (key) do update set value = excluded.value;
-- so re-applying it overwrites the live application secret with the repository's redacted
-- placeholder. Every `beta_*` RPC is gated on that secret, so the whole product — login,
-- access, paper, the bot — would fail closed until the real value was restored by hand.
--
-- This file therefore contains only the function definitions being restored. It touches no
-- table, no configuration row and no data.
--
-- Restores: private.beta_recompute and public.beta_set_task from
--   20260707081249_beta_gate_v3_ladder_fix.sql, public.beta_set_wallet from
--   20260707074854_beta_gate_v1.sql, and public.beta_admin_verify from
--   20260707075056_beta_gate_v2_admin_verify.sql.
--
-- Note that restoring these re-enables the reward ladder: score for an Arcus task, an X
-- follow and invites, the wallet side effect, the inviter recompute, and manual X
-- verification. Only roll back if that is genuinely what is wanted.

begin;

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

create or replace function public.beta_set_task(
  p_secret text, p_telegram_id bigint, p_task text, p_status text, p_metadata jsonb default null
) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare v_id uuid; v_inviter_tg bigint; v_inviter_lang text;
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
  if p_task = 'telegram_join' and p_status = 'verified' then
    select u.telegram_id, u.language into v_inviter_tg, v_inviter_lang
      from beta_referrals r join beta_users u on u.id = r.inviter_user_id
     where r.invited_user_id = v_id;
    perform private.beta_recompute(r.inviter_user_id) from beta_referrals r where r.invited_user_id = v_id;
  end if;
  return private.beta_state_json(v_id)
      || jsonb_build_object('inviter_telegram_id', v_inviter_tg, 'inviter_language', v_inviter_lang);
end $$;

create or replace function public.beta_admin_verify(p_secret text, p_query text) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare v_id uuid; v_tg bigint;
begin
  perform private.beta_check_secret(p_secret);
  select id, telegram_id into v_id, v_tg from beta_users
   where proof_code = upper(trim(p_query))
      or lower(telegram_username) = lower(ltrim(trim(p_query), '@'))
      or (trim(p_query) ~ '^[0-9]+$' and telegram_id = trim(p_query)::bigint)
   limit 1;
  if v_id is null then return null; end if;
  update beta_tasks set status = 'verified', verified_at = now()
    where user_id = v_id and task_type = 'x_follow';
  perform private.beta_recompute(v_id);
  return private.beta_state_json(v_id) || jsonb_build_object('telegram_id', v_tg);
end $$;
grant execute on function public.beta_admin_verify(text, text) to anon;

commit;
