-- Repo mirror of the migration applied to Supabase project `ryntra` (lbphobwqzwdkbmyedlwb).
-- M5: paper trading + journal-before-trade. Same security model as beta gate:
-- RLS with no policies; access only via SECURITY DEFINER RPCs gated by the app secret.

create table if not exists public.paper_trades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.beta_users(id) on delete cascade,
  market text not null,
  side text not null check (side in ('long','short')),
  entry_price numeric not null check (entry_price > 0),
  size numeric not null check (size > 0),
  sl numeric check (sl > 0),
  tp numeric check (tp > 0),
  status text not null default 'open' check (status in ('open','closed')),
  exit_price numeric,
  exit_reason text check (exit_reason in ('manual','sl','tp')),
  fees numeric not null default 0,
  pnl numeric,
  checklist jsonb,
  reason text,
  followed_plan boolean,
  mistake_tag text,
  lesson text,
  opened_at timestamptz not null default now(),
  closed_at timestamptz
);

create index if not exists paper_trades_user_idx on public.paper_trades (user_id, status);
alter table public.paper_trades enable row level security;

-- helper: resolve verified user id by telegram id (demo requires Telegram Verified)
create or replace function private.paper_user(p_telegram_id bigint) returns uuid
language plpgsql security definer set search_path = public, private as $$
declare v_id uuid;
begin
  select u.id into v_id
    from beta_users u
    join beta_tasks t on t.user_id = u.id and t.task_type = 'telegram_join' and t.status = 'verified'
   where u.telegram_id = p_telegram_id;
  if v_id is null then raise exception 'not verified'; end if;
  return v_id;
end $$;

create or replace function private.paper_trade_json(p_row public.paper_trades) returns jsonb
language sql security definer set search_path = public, private as $$
  select jsonb_build_object(
    'id', p_row.id, 'market', p_row.market, 'side', p_row.side,
    'entry_price', p_row.entry_price, 'size', p_row.size, 'sl', p_row.sl, 'tp', p_row.tp,
    'status', p_row.status, 'exit_price', p_row.exit_price, 'exit_reason', p_row.exit_reason,
    'fees', p_row.fees, 'pnl', p_row.pnl, 'checklist', p_row.checklist, 'reason', p_row.reason,
    'followed_plan', p_row.followed_plan, 'mistake_tag', p_row.mistake_tag, 'lesson', p_row.lesson,
    'opened_at', p_row.opened_at, 'closed_at', p_row.closed_at);
$$;

create or replace function public.paper_open(
  p_secret text, p_telegram_id bigint, p_market text, p_side text,
  p_entry numeric, p_size numeric, p_sl numeric, p_tp numeric,
  p_entry_fee numeric, p_checklist jsonb, p_reason text
) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare v_uid uuid; v_open int; v_row paper_trades; v_notional numeric;
begin
  perform private.beta_check_secret(p_secret);
  v_uid := private.paper_user(p_telegram_id);

  select count(*) into v_open from paper_trades where user_id = v_uid and status = 'open';
  if v_open >= 10 then raise exception 'max 10 open paper trades'; end if;

  v_notional := p_entry * p_size;
  if v_notional < 5 then raise exception 'min notional $5'; end if;
  if v_notional > 250000 then raise exception 'max notional $250k'; end if;

  -- discipline gate: SL is mandatory in paper, on the correct side; TP on the correct side if set
  if p_sl is null then raise exception 'stop-loss required'; end if;
  if p_side = 'long' and p_sl >= p_entry then raise exception 'sl must be below entry for long'; end if;
  if p_side = 'short' and p_sl <= p_entry then raise exception 'sl must be above entry for short'; end if;
  if p_tp is not null then
    if p_side = 'long' and p_tp <= p_entry then raise exception 'tp must be above entry for long'; end if;
    if p_side = 'short' and p_tp >= p_entry then raise exception 'tp must be below entry for short'; end if;
  end if;
  if p_reason is null or length(trim(p_reason)) < 10 then raise exception 'pre-trade reason required (min 10 chars)'; end if;
  if p_entry_fee is null or p_entry_fee < 0 or p_entry_fee > v_notional * 0.01 then raise exception 'bad fee'; end if;

  insert into paper_trades (user_id, market, side, entry_price, size, sl, tp, fees, checklist, reason)
  values (v_uid, p_market, p_side, p_entry, p_size, p_sl, p_tp, p_entry_fee, p_checklist, trim(p_reason))
  returning * into v_row;
  return private.paper_trade_json(v_row);
end $$;

create or replace function public.paper_close(
  p_secret text, p_telegram_id bigint, p_trade_id uuid, p_exit numeric, p_exit_fee numeric, p_reason text
) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare v_uid uuid; v_row paper_trades; v_dir numeric; v_pnl numeric;
begin
  perform private.beta_check_secret(p_secret);
  v_uid := private.paper_user(p_telegram_id);

  select * into v_row from paper_trades where id = p_trade_id and user_id = v_uid for update;
  if v_row.id is null then raise exception 'trade not found'; end if;
  if v_row.status = 'closed' then raise exception 'already closed'; end if;
  if p_exit is null or p_exit <= 0 then raise exception 'bad exit price'; end if;
  if p_reason not in ('manual','sl','tp') then raise exception 'bad exit reason'; end if;
  if p_exit_fee is null or p_exit_fee < 0 or p_exit_fee > p_exit * v_row.size * 0.01 then raise exception 'bad fee'; end if;

  v_dir := case when v_row.side = 'long' then 1 else -1 end;
  v_pnl := (p_exit - v_row.entry_price) * v_row.size * v_dir - v_row.fees - p_exit_fee;

  update paper_trades set
    status = 'closed', exit_price = p_exit, exit_reason = p_reason,
    fees = fees + p_exit_fee, pnl = v_pnl, closed_at = now()
  where id = v_row.id
  returning * into v_row;
  return private.paper_trade_json(v_row);
end $$;

create or replace function public.paper_journal(
  p_secret text, p_telegram_id bigint, p_trade_id uuid,
  p_followed boolean, p_mistake text, p_lesson text
) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare v_uid uuid; v_row paper_trades;
begin
  perform private.beta_check_secret(p_secret);
  v_uid := private.paper_user(p_telegram_id);
  update paper_trades set
    followed_plan = coalesce(p_followed, followed_plan),
    mistake_tag = coalesce(nullif(trim(p_mistake), ''), mistake_tag),
    lesson = coalesce(nullif(trim(p_lesson), ''), lesson)
  where id = p_trade_id and user_id = v_uid and status = 'closed'
  returning * into v_row;
  if v_row.id is null then raise exception 'closed trade not found'; end if;
  return private.paper_trade_json(v_row);
end $$;

create or replace function public.paper_list(p_secret text, p_telegram_id bigint) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare v_uid uuid;
begin
  perform private.beta_check_secret(p_secret);
  v_uid := private.paper_user(p_telegram_id);
  return jsonb_build_object(
    'open', (select coalesce(jsonb_agg(private.paper_trade_json(t) order by t.opened_at desc), '[]'::jsonb)
             from paper_trades t where t.user_id = v_uid and t.status = 'open'),
    'closed', (select coalesce(jsonb_agg(x.j), '[]'::jsonb) from (
                 select private.paper_trade_json(t) j from paper_trades t
                 where t.user_id = v_uid and t.status = 'closed'
                 order by t.closed_at desc limit 50) x),
    'stats', (select jsonb_build_object(
        'balance', 10000 + coalesce(sum(t.pnl), 0),
        'trades', count(*),
        'wins', count(*) filter (where t.pnl > 0),
        'win_rate', case when count(*) > 0 then round(100.0 * count(*) filter (where t.pnl > 0) / count(*), 1) else null end,
        'avg_r', round(avg(case when t.sl is not null and abs(t.entry_price - t.sl) * t.size > 0
                     then t.pnl / (abs(t.entry_price - t.sl) * t.size) end)::numeric, 2),
        'journaled', count(*) filter (where t.followed_plan is not null),
        'adherence_pct', case when count(*) filter (where t.followed_plan is not null) > 0
                     then round(100.0 * count(*) filter (where t.followed_plan = true) / count(*) filter (where t.followed_plan is not null), 0) end)
      from paper_trades t where t.user_id = v_uid and t.status = 'closed')
  );
end $$;

revoke all on function private.paper_user(bigint) from public, anon, authenticated;
revoke all on function private.paper_trade_json(public.paper_trades) from public, anon, authenticated;
grant execute on function public.paper_open(text, bigint, text, text, numeric, numeric, numeric, numeric, numeric, jsonb, text) to anon;
grant execute on function public.paper_close(text, bigint, uuid, numeric, numeric, text) to anon;
grant execute on function public.paper_journal(text, bigint, uuid, boolean, text, text) to anon;
grant execute on function public.paper_list(text, bigint) to anon;
