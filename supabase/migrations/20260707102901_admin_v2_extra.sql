-- Admin panel v2: activity metrics, CTA breakdown, top inviters, broadcast recipient list.

create or replace function public.admin_extra(p_secret text) returns jsonb
language plpgsql security definer set search_path = public, private as $$
begin
  perform private.beta_check_secret(p_secret);
  return jsonb_build_object(
    'paper', jsonb_build_object(
      'trades_total', (select count(*) from paper_trades),
      'trades_24h', (select count(*) from paper_trades where opened_at > now() - interval '24 hours'),
      'traders', (select count(distinct user_id) from paper_trades),
      'open_now', (select count(*) from paper_trades where status = 'open')),
    'live', jsonb_build_object(
      'watched_addresses', (select count(*) from account_watch),
      'journal_notes', (select count(*) from live_notes),
      'wallets_submitted', (select count(*) from beta_users where wallet_address is not null)),
    'cta_by_placement_14d', (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) from (
      select coalesce(placement, 'unknown') k, count(*) n from events
      where created_at > now() - interval '14 days' and name = 'telegram_cta_click' group by 1) t),
    'cta_by_locale_14d', (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) from (
      select coalesce(locale, '?') k, count(*) n from events
      where created_at > now() - interval '14 days' group by 1 order by n desc limit 12) t),
    'top_inviters', (select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) from (
      select coalesce(u.telegram_username, u.first_name, u.telegram_id::text) as who,
             count(*) as invites,
             count(*) filter (where exists (select 1 from beta_tasks t
               where t.user_id = r.invited_user_id and t.task_type = 'telegram_join' and t.status = 'verified')) as verified
        from beta_referrals r join beta_users u on u.id = r.inviter_user_id
       group by u.id, u.telegram_username, u.first_name, u.telegram_id
       order by 3 desc, 2 desc limit 10) x)
  );
end $$;

-- Broadcast recipients: telegram ids + language, optionally filtered by beta status.
create or replace function public.admin_broadcast_targets(p_secret text, p_status text default null) returns jsonb
language plpgsql security definer set search_path = public, private as $$
begin
  perform private.beta_check_secret(p_secret);
  return coalesce((select jsonb_agg(jsonb_build_object('telegram_id', u.telegram_id, 'language', u.language))
    from beta_users u
    left join beta_access a on a.user_id = u.id
    where p_status is null or p_status = '' or a.status = p_status
       or (p_status = 'verified_any' and exists (select 1 from beta_tasks t
             where t.user_id = u.id and t.task_type = 'telegram_join' and t.status = 'verified'))),
    '[]'::jsonb);
end $$;

grant execute on function public.admin_extra(text) to anon;
grant execute on function public.admin_broadcast_targets(text, text) to anon;
