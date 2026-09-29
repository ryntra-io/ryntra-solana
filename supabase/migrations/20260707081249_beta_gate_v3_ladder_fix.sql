-- Repo mirror of the migration applied to Supabase project `ryntra` (lbphobwqzwdkbmyedlwb).
-- FIX (review C4, critical): status ladder must be strictly contiguous —
-- X verification without an Arcus wallet must NOT advance the headline status
-- past telegram_verified. 'x_verified' remains a display-only transitional rung.
-- FIX (review C6): beta_set_task also returns inviter_language for localized notifications.

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
