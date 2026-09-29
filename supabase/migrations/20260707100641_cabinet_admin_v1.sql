-- Repo mirror of the migration applied to Supabase project `ryntra` (lbphobwqzwdkbmyedlwb).
-- Cabinet settings + admin panel RPCs (same secret-gated SECURITY DEFINER model).
-- NOTE: repo filename timestamp is approximate; applied version is listed by list_migrations.

create or replace function public.beta_set_language(p_secret text, p_telegram_id bigint, p_language text) returns boolean
language plpgsql security definer set search_path = public, private as $$
begin
  perform private.beta_check_secret(p_secret);
  if p_language not in ('en','uk','ru') then raise exception 'bad language'; end if;
  update beta_users set language = p_language, updated_at = now() where telegram_id = p_telegram_id;
  return found;
end $$;

create or replace function public.admin_users_list(p_secret text, p_query text default null, p_limit int default 100) returns jsonb
language plpgsql security definer set search_path = public, private as $$
begin
  perform private.beta_check_secret(p_secret);
  return coalesce((select jsonb_agg(row_to_json(x)) from (
    select u.telegram_id, u.telegram_username, u.first_name, u.language, u.wallet_address,
           u.proof_code, u.referral_code, u.created_at,
           a.status, a.priority_score,
           (select jsonb_object_agg(t.task_type, t.status) from beta_tasks t where t.user_id = u.id) as tasks,
           (select count(*) from beta_referrals r where r.inviter_user_id = u.id) as invites,
           (select count(*) from paper_trades p where p.user_id = u.id) as paper_trades
      from beta_users u
      left join beta_access a on a.user_id = u.id
     where p_query is null or p_query = ''
        or lower(coalesce(u.telegram_username,'')) like '%' || lower(p_query) || '%'
        or u.telegram_id::text = p_query
        or u.proof_code = upper(p_query)
        or lower(coalesce(u.wallet_address,'')) = lower(p_query)
     order by u.created_at desc
     limit least(greatest(p_limit, 1), 500)
  ) x), '[]'::jsonb);
end $$;

grant execute on function public.beta_set_language(text, bigint, text) to anon;
grant execute on function public.admin_users_list(text, text, int) to anon;
