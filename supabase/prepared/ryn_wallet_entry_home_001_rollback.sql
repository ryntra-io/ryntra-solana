-- PREPARED rollback for wallet-entry schema; never deletes or rebinds users.
-- Allowed only before any wallet-native account has been created.
begin;
do $$ begin
  if exists(select 1 from public.beta_users where wallet_native) then
    raise exception 'wallet-native accounts exist; retain schema and repair forward';
  end if;
end $$;
drop trigger wallet_account_has_identity on public.beta_users;
drop trigger wallet_link_keeps_identity on private.account_wallets;
drop function private.check_wallet_account_identity();
drop function private.require_wallet_account_identity(uuid);
drop function public.account_resolve_solana(text,text,text);
alter table public.beta_users drop constraint beta_identity_present;
alter table public.beta_users add constraint beta_identity_present check
  (telegram_id is not null or verified_wallet is not null or auth_user_id is not null);
alter table public.beta_users drop column wallet_native;

create or replace function public.account_wallet_link(
  p_secret text,
  p_account_id uuid,
  p_chain text,
  p_address text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
begin
  perform private.beta_check_secret(p_secret);
  if p_chain not in ('solana', 'evm') then
    return jsonb_build_object('ok', false, 'error', 'bad_chain');
  end if;
  if (p_chain = 'evm' and p_address !~ '^0x[0-9a-f]{40}$')
     or (p_chain = 'solana' and p_address !~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$') then
    return jsonb_build_object('ok', false, 'error', 'bad_address');
  end if;
  if not exists (select 1 from public.beta_users u where u.id = p_account_id) then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  select w.account_id into v_owner from private.account_wallets w where w.chain = p_chain and w.address = p_address;
  if v_owner is not null and v_owner <> p_account_id then
    return jsonb_build_object('ok', false, 'error', 'wallet_taken');
  end if;
  if v_owner is null then
    insert into private.account_wallets (account_id, chain, address) values (p_account_id, p_chain, p_address);
    if p_chain = 'evm' then
      update public.beta_users
         set verified_wallet = p_address, verified_wallet_at = clock_timestamp(), updated_at = now()
       where id = p_account_id and verified_wallet is null;
    end if;
  else
    update private.account_wallets set last_used_at = clock_timestamp() where chain = p_chain and address = p_address;
  end if;
  return jsonb_build_object('ok', true, 'already', v_owner is not null);
end;
$$;

create or replace function public.account_wallet_unlink(
  p_secret text,
  p_account_id uuid,
  p_chain text,
  p_address text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer := 0;
begin
  perform private.beta_check_secret(p_secret);
  delete from private.account_wallets w
   where w.account_id = p_account_id and w.chain = p_chain and w.address = p_address;
  get diagnostics v_deleted = row_count;
  if v_deleted = 0 then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;
commit;
