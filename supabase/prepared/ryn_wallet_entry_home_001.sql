-- RYN-WALLET-ENTRY-HOME-001 part A. PREPARED ONLY; not applied to production.
-- Existing account IDs, auth identities, wallets and private plans stay intact.
-- Server-verified SIWS is a prerequisite at the application boundary. These
-- RPCs retain the existing app-secret authorization, empty search_path and
-- explicit grants. An anonymous caller without that secret gains nothing.
begin;

alter table public.beta_users add column wallet_native boolean not null default false;
alter table public.beta_users drop constraint beta_identity_present;
alter table public.beta_users add constraint beta_identity_present check (
  telegram_id is not null or verified_wallet is not null or auth_user_id is not null or wallet_native
);

-- The flag is not an identity by itself. A wallet-native account must have a
-- real link by COMMIT. Deferred validation allows account + link to be one
-- atomic operation without inventing an email, Telegram id or EVM address.
create function private.require_wallet_account_identity(p_account_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare u public.beta_users%rowtype;
begin
  select * into u from public.beta_users where id = p_account_id for update;
  if found and u.wallet_native and u.telegram_id is null and u.auth_user_id is null
     and u.verified_wallet is null and not exists (
       select 1 from private.account_wallets w where w.account_id = p_account_id
     ) then
    raise exception 'wallet account needs a verified identity' using errcode = '23514';
  end if;
end;
$$;

create function private.check_wallet_account_identity()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'beta_users' then
    if tg_op <> 'DELETE' then perform private.require_wallet_account_identity(new.id); end if;
  else
    if tg_op <> 'DELETE' then perform private.require_wallet_account_identity(new.account_id); end if;
    if tg_op <> 'INSERT' then perform private.require_wallet_account_identity(old.account_id); end if;
  end if;
  return null;
end;
$$;
create constraint trigger wallet_account_has_identity
after insert or update on public.beta_users deferrable initially deferred
for each row execute function private.check_wallet_account_identity();
create constraint trigger wallet_link_keeps_identity
after insert or update or delete on private.account_wallets deferrable initially deferred
for each row execute function private.check_wallet_account_identity();

create function public.account_resolve_solana(p_secret text, p_address text, p_language text default 'en')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_new boolean := false;
begin
  perform private.beta_check_secret(p_secret);
  if p_address is null or p_address !~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' then
    return jsonb_build_object('ok', false, 'error', 'bad_address');
  end if;
  -- Link, unlink and first login share this lock, including when no row exists.
  perform pg_advisory_xact_lock(hashtextextended('ryntra-wallet:solana:' || p_address, 0));
  select account_id into v_id from private.account_wallets where chain = 'solana' and address = p_address;
  if v_id is null then
    insert into public.beta_users (wallet_native, language, referral_code, proof_code)
    values (true, case when p_language = 'uk' then 'uk' else 'en' end,
      upper(substr(md5(gen_random_uuid()::text), 1, 8)),
      'RYNTRA-' || upper(substr(md5(gen_random_uuid()::text), 1, 4))) returning id into v_id;
    insert into private.account_wallets (account_id, chain, address, last_used_at)
    values (v_id, 'solana', p_address, clock_timestamp());
    insert into public.beta_tasks(user_id, task_type) values
      (v_id, 'telegram_join'), (v_id, 'arcus_referral'), (v_id, 'x_follow');
    insert into public.beta_access(user_id) values (v_id);
    v_new := true;
  else
    update private.account_wallets set last_used_at = clock_timestamp()
      where chain = 'solana' and address = p_address;
  end if;
  return jsonb_build_object('ok', true, 'account_id', v_id, 'is_new', v_new);
end;
$$;

create or replace function public.account_wallet_link(p_secret text, p_account_id uuid, p_chain text, p_address text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_owner uuid;
begin
  perform private.beta_check_secret(p_secret);
  if p_chain is null or p_chain not in ('solana', 'evm') then
    return jsonb_build_object('ok', false, 'error', 'bad_chain');
  end if;
  if p_address is null or (p_chain = 'evm' and p_address !~ '^0x[0-9a-f]{40}$')
    or (p_chain = 'solana' and p_address !~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$') then
    return jsonb_build_object('ok', false, 'error', 'bad_address');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('ryntra-wallet:' || p_chain || ':' || p_address, 0));
  perform 1 from public.beta_users where id = p_account_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  select account_id into v_owner from private.account_wallets where chain = p_chain and address = p_address;
  if v_owner is not null and v_owner <> p_account_id then
    return jsonb_build_object('ok', false, 'error', 'wallet_taken');
  end if;
  if v_owner is null then
    insert into private.account_wallets(account_id, chain, address) values(p_account_id, p_chain, p_address);
    if p_chain = 'evm' then
      update public.beta_users set verified_wallet = p_address, verified_wallet_at = clock_timestamp(), updated_at = now()
        where id = p_account_id and verified_wallet is null;
    end if;
  else
    update private.account_wallets set last_used_at = clock_timestamp() where chain = p_chain and address = p_address;
  end if;
  return jsonb_build_object('ok', true, 'already', v_owner is not null);
end;
$$;

create or replace function public.account_wallet_unlink(p_secret text, p_account_id uuid, p_chain text, p_address text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare u public.beta_users%rowtype; v_other boolean;
begin
  perform private.beta_check_secret(p_secret);
  if p_chain is null or p_address is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  perform pg_advisory_xact_lock(hashtextextended('ryntra-wallet:' || p_chain || ':' || p_address, 0));
  select * into u from public.beta_users where id = p_account_id for update;
  if not found or not exists (select 1 from private.account_wallets where account_id = p_account_id and chain = p_chain and address = p_address) then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  select exists(select 1 from private.account_wallets where account_id = p_account_id and (chain, address) <> (p_chain, p_address)) into v_other;
  if u.telegram_id is null and u.auth_user_id is null and not v_other then
    return jsonb_build_object('ok', false, 'error', 'last_method');
  end if;
  -- Never change the legacy EVM identity as a side effect of this Solana task.
  if p_chain = 'evm' and u.verified_wallet = p_address then
    return jsonb_build_object('ok', false, 'error', 'legacy_wallet');
  end if;
  delete from private.account_wallets where account_id = p_account_id and chain = p_chain and address = p_address;
  update private.sessions set revoked_at = clock_timestamp(), revoked_reason = 'replaced'
    where account_id = p_account_id and kind = 'customer' and wallet_chain = p_chain
      and wallet_address = p_address and revoked_at is null;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function private.require_wallet_account_identity(uuid) from public, anon, authenticated, service_role;
revoke all on function private.check_wallet_account_identity() from public, anon, authenticated, service_role;
revoke all on function public.account_resolve_solana(text,text,text) from public, anon, authenticated, service_role;
grant execute on function public.account_resolve_solana(text,text,text) to anon;
-- Replacements keep the existing app-secret gate and role scope explicitly.
revoke all on function public.account_wallet_link(text,uuid,text,text) from public, anon, authenticated, service_role;
revoke all on function public.account_wallet_unlink(text,uuid,text,text) from public, anon, authenticated, service_role;
grant execute on function public.account_wallet_link(text,uuid,text,text) to anon;
grant execute on function public.account_wallet_unlink(text,uuid,text,text) to anon;
commit;
