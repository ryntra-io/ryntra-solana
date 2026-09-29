-- Live account layer (read-only, zero keys): journal notes on REAL fills + fill-alert watermarks.

create table if not exists public.live_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.beta_users(id) on delete cascade,
  trade_id text not null,
  market text,
  side text,
  pnl numeric,
  followed_plan boolean,
  mistake_tag text,
  lesson text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, trade_id)
);
alter table public.live_notes enable row level security;

create table if not exists public.account_watch (
  user_id uuid primary key references public.beta_users(id) on delete cascade,
  address text not null,
  last_sequence bigint not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.account_watch enable row level security;

create or replace function public.live_note_upsert(
  p_secret text, p_telegram_id bigint, p_trade_id text, p_market text, p_side text, p_pnl numeric,
  p_followed boolean, p_mistake text, p_lesson text
) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare v_uid uuid; v_row live_notes;
begin
  perform private.beta_check_secret(p_secret);
  v_uid := private.paper_user(p_telegram_id);
  if p_trade_id is null or length(p_trade_id) > 64 then raise exception 'bad trade id'; end if;
  insert into live_notes (user_id, trade_id, market, side, pnl, followed_plan, mistake_tag, lesson)
  values (v_uid, p_trade_id, p_market, p_side, p_pnl, p_followed, nullif(trim(p_mistake), ''), nullif(trim(p_lesson), ''))
  on conflict (user_id, trade_id) do update set
    followed_plan = coalesce(excluded.followed_plan, live_notes.followed_plan),
    mistake_tag = coalesce(excluded.mistake_tag, live_notes.mistake_tag),
    lesson = coalesce(excluded.lesson, live_notes.lesson),
    pnl = coalesce(excluded.pnl, live_notes.pnl),
    updated_at = now()
  returning * into v_row;
  return jsonb_build_object('trade_id', v_row.trade_id, 'followed_plan', v_row.followed_plan,
    'mistake_tag', v_row.mistake_tag, 'lesson', v_row.lesson);
end $$;

create or replace function public.live_notes_list(p_secret text, p_telegram_id bigint) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare v_uid uuid;
begin
  perform private.beta_check_secret(p_secret);
  v_uid := private.paper_user(p_telegram_id);
  return coalesce((select jsonb_object_agg(n.trade_id, jsonb_build_object(
      'followed_plan', n.followed_plan, 'mistake_tag', n.mistake_tag, 'lesson', n.lesson))
    from live_notes n where n.user_id = v_uid), '{}'::jsonb);
end $$;

-- watch list for fill alerts: every verified user with a wallet address
create or replace function public.watch_list(p_secret text) returns jsonb
language plpgsql security definer set search_path = public, private as $$
begin
  perform private.beta_check_secret(p_secret);
  return coalesce((select jsonb_agg(jsonb_build_object(
      'telegram_id', u.telegram_id, 'language', u.language, 'address', u.wallet_address,
      'last_sequence', coalesce(w.last_sequence, 0)))
    from beta_users u
    join beta_tasks t on t.user_id = u.id and t.task_type = 'telegram_join' and t.status = 'verified'
    left join account_watch w on w.user_id = u.id
    where u.wallet_address is not null), '[]'::jsonb);
end $$;

create or replace function public.watch_update(p_secret text, p_telegram_id bigint, p_last_sequence bigint) returns boolean
language plpgsql security definer set search_path = public, private as $$
declare v_uid uuid;
begin
  perform private.beta_check_secret(p_secret);
  select id into v_uid from beta_users where telegram_id = p_telegram_id;
  if v_uid is null then return false; end if;
  insert into account_watch (user_id, address, last_sequence)
  select v_uid, u.wallet_address, p_last_sequence from beta_users u where u.id = v_uid and u.wallet_address is not null
  on conflict (user_id) do update set last_sequence = greatest(account_watch.last_sequence, excluded.last_sequence), updated_at = now();
  return true;
end $$;

grant execute on function public.live_note_upsert(text, bigint, text, text, text, numeric, boolean, text, text) to anon;
grant execute on function public.live_notes_list(text, bigint) to anon;
grant execute on function public.watch_list(text) to anon;
grant execute on function public.watch_update(text, bigint, bigint) to anon;
