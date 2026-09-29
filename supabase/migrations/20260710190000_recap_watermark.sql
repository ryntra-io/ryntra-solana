-- Daily-recap anti-spam watermark. The recap DM must fire only when a user has closed NEW paper
-- trades since their last recap — otherwise the cron re-sends an identical lifetime-stats digest
-- every night (paper_list stats are cumulative). `last_recap_trades` = the closed-trade count at
-- the last recap; the cron sends only when current trades > this, then advances it (which also
-- makes a same-evening re-fire a no-op). Default 0 → the first recap fires on first real activity.

alter table public.account_watch add column if not exists last_recap_trades int not null default 0;

-- watch_list now also returns the recap watermark (fill-alert list unchanged otherwise).
create or replace function public.watch_list(p_secret text) returns jsonb
language plpgsql security definer set search_path = public, private as $$
begin
  perform private.beta_check_secret(p_secret);
  return coalesce((select jsonb_agg(jsonb_build_object(
      'telegram_id', u.telegram_id, 'language', u.language, 'address', u.wallet_address,
      'last_sequence', coalesce(w.last_sequence, 0),
      'last_recap_trades', coalesce(w.last_recap_trades, 0)))
    from beta_users u
    join beta_tasks t on t.user_id = u.id and t.task_type = 'telegram_join' and t.status = 'verified'
    left join account_watch w on w.user_id = u.id
    where u.wallet_address is not null), '[]'::jsonb);
end $$;

-- Set the recap watermark to the current closed-trade count. Plain assignment (not greatest) so a
-- paper reset (trade count drops) re-arms future recaps rather than silencing them forever.
create or replace function public.watch_recap_update(p_secret text, p_telegram_id bigint, p_trades int) returns boolean
language plpgsql security definer set search_path = public, private as $$
declare v_uid uuid;
begin
  perform private.beta_check_secret(p_secret);
  select id into v_uid from beta_users where telegram_id = p_telegram_id;
  if v_uid is null then return false; end if;
  insert into account_watch (user_id, address, last_recap_trades)
  select v_uid, u.wallet_address, p_trades from beta_users u where u.id = v_uid and u.wallet_address is not null
  on conflict (user_id) do update set last_recap_trades = excluded.last_recap_trades, updated_at = now();
  return true;
end $$;

grant execute on function public.watch_recap_update(text, bigint, int) to anon;
