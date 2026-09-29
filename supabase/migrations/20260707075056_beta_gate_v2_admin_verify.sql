-- Repo mirror of the migration applied to Supabase project `ryntra` (lbphobwqzwdkbmyedlwb).
-- Admin verification of the X-follow task by proof code / @username / telegram id.

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

-- beta_set_task returns the inviter's telegram id when an invitee's telegram_join verifies,
-- so the bot can send the inviter a delight notification.
create or replace function public.beta_set_task(
  p_secret text, p_telegram_id bigint, p_task text, p_status text, p_metadata jsonb default null
) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare v_id uuid; v_inviter_tg bigint;
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
    select u.telegram_id into v_inviter_tg
      from beta_referrals r join beta_users u on u.id = r.inviter_user_id
     where r.invited_user_id = v_id;
    perform private.beta_recompute(r.inviter_user_id) from beta_referrals r where r.invited_user_id = v_id;
  end if;
  return private.beta_state_json(v_id) || jsonb_build_object('inviter_telegram_id', v_inviter_tg);
end $$;
