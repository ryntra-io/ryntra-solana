-- Ryntra: ready launch sets — the curve settings creators save and others start from.
--
-- PREPARED 2026-11-20 as a file only. Not applied to any Supabase project.
-- Until it is applied the read answers Ryntra's own sets (one per preset) and
-- a save says sets cannot be kept yet (`lib/launch/presets-market/store.ts`):
-- a function that is not there is a store that did not answer.
--
-- WHAT THIS FILE DOES
--   * Two tables, nothing else of the schema touched:
--     `private.launch_sets` — one creator's set: its name, the author's
--     wallet, its five numbers (`terms`, as the server checked them, and
--     `terms_key`, the same numbers as one line), the text the author's
--     wallet signed and the signature. The server checks the signature
--     before it calls the function; the row keeps both so anyone can check
--     it again. A name is one per network; one wallet keeps a set of the
--     same numbers once and at most twenty sets.
--     `private.launch_set_uses` — one landed launch counted for the set it
--     started from: one coin, one set, once. A Ryntra set's id is
--     `ryntra-<preset>`; a creator's is the row's uuid.
--     Row level security forced on both, no policies, every grant revoked.
--   * The server reads and writes only through the three `public.launch_set*`
--     functions below, each gated by the app secret
--     (`private.beta_check_secret`) and each one transaction, the same way
--     the pools' tape is (`20261120150000_pro_pools_store_v1.sql`). None
--     takes a table's name or a statement.
--
-- WHAT IT DOES NOT DO
--   No money, no key, no transaction: a set is numbers Launch already builds,
--   a public wallet address and a signed message. No existing table,
--   function or row is changed. The price of starting from a set is not
--   here: it is the server's setting, zero by default.

begin;

create table private.launch_sets (
  id uuid primary key default gen_random_uuid(),
  network text not null check (network in ('devnet', 'mainnet')),
  name text not null check (char_length(name) between 3 and 32),
  name_key text not null,
  author text not null check (author ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  terms jsonb not null check (jsonb_typeof(terms) = 'object'),
  terms_key text not null check (char_length(terms_key) between 8 and 120),
  message text not null check (char_length(message) between 40 and 1000),
  signature text not null check (char_length(signature) between 64 and 100),
  hidden boolean not null default false,
  created_at timestamptz not null default clock_timestamp(),
  unique (network, name_key),
  unique (network, author, terms_key)
);

-- A wallet's sets, to count them.
create index launch_sets_author_idx on private.launch_sets (network, author);

create table private.launch_set_uses (
  network text not null check (network in ('devnet', 'mainnet')),
  mint text not null check (mint ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  set_id text not null check (set_id ~ '^(ryntra-[a-z-]{1,24}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$'),
  used_at timestamptz not null default clock_timestamp(),
  primary key (network, mint)
);

-- The launches of each set.
create index launch_set_uses_set_idx on private.launch_set_uses (network, set_id);

alter table private.launch_sets enable row level security;
alter table private.launch_sets force row level security;
revoke all privileges on table private.launch_sets from public, anon, authenticated, service_role;

alter table private.launch_set_uses enable row level security;
alter table private.launch_set_uses force row level security;
revoke all privileges on table private.launch_set_uses from public, anon, authenticated, service_role;

-- ------------------------------------------------------- the server's API --

-- Creators' sets of a network, the most used first (then the newest), and the launches of each of Ryntra's own.
create function public.launch_sets_top(p_secret text, p_network text, p_limit integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 12), 100));
begin
  perform private.beta_check_secret(p_secret);
  if p_network is null or p_network not in ('devnet', 'mainnet') then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;
  return jsonb_build_object(
    'ok', true,
    'sets', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'author', t.author, 'terms', t.terms, 'uses', t.uses, 'created_at', t.created_at) order by t.uses desc, t.created_at desc)
        from (
          select s.id, s.name, s.author, s.terms, s.created_at,
                 (select count(*) from private.launch_set_uses u where u.network = s.network and u.set_id = s.id::text) as uses
            from private.launch_sets s
           where s.network = p_network and not s.hidden
           order by uses desc, s.created_at desc
           limit v_limit
        ) t
    ), '[]'::jsonb),
    'ryntra', coalesce((
      select jsonb_agg(jsonb_build_object('id', u.set_id, 'uses', u.uses))
        from (
          select set_id, count(*) as uses
            from private.launch_set_uses
           where network = p_network and set_id like 'ryntra-%'
           group by set_id
        ) u
    ), '[]'::jsonb)
  );
end;
$$;

-- Keeps a creator's set the server checked and whose signature it verified.
create function public.launch_set_save(p_secret text, p_network text, p_name text, p_author text, p_terms jsonb, p_terms_key text, p_message text, p_signature text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  v_key text := lower(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')));
  v_row private.launch_sets;
begin
  perform private.beta_check_secret(p_secret);
  if p_network is null or p_network not in ('devnet', 'mainnet')
     or char_length(v_name) not between 3 and 32
     or v_key like 'ryntra%'
     or p_author is null or p_author !~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'
     or p_terms is null or jsonb_typeof(p_terms) <> 'object'
     or p_terms_key is null or char_length(p_terms_key) not between 8 and 120
     or p_message is null or char_length(p_message) not between 40 and 1000
     or p_signature is null or char_length(p_signature) not between 64 and 100 then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;
  -- One wallet's sets are counted under its own lock, so two saves at once never pass twenty.
  perform pg_advisory_xact_lock(hashtextextended('launch_sets:' || p_network || ':' || p_author, 0));
  if exists (select 1 from private.launch_sets s where s.network = p_network and s.name_key = v_key) then
    return jsonb_build_object('ok', false, 'error', 'name_taken');
  end if;
  if exists (select 1 from private.launch_sets s where s.network = p_network and s.author = p_author and s.terms_key = p_terms_key) then
    return jsonb_build_object('ok', false, 'error', 'same_terms');
  end if;
  if (select count(*) from private.launch_sets s where s.network = p_network and s.author = p_author) >= 20 then
    return jsonb_build_object('ok', false, 'error', 'author_full');
  end if;
  insert into private.launch_sets (network, name, name_key, author, terms, terms_key, message, signature)
  values (p_network, v_name, v_key, p_author, p_terms, p_terms_key, p_message, p_signature)
  on conflict do nothing
  returning * into v_row;
  if v_row.id is null then
    return jsonb_build_object('ok', false, 'error', 'name_taken');
  end if;
  return jsonb_build_object('ok', true, 'set', jsonb_build_object('id', v_row.id, 'name', v_row.name, 'author', v_row.author, 'terms', v_row.terms, 'uses', 0, 'created_at', v_row.created_at));
end;
$$;

-- Counts one landed launch for one set, once per coin. A creator's set counts only a launch with its own numbers.
create function public.launch_set_use(p_secret text, p_network text, p_set text, p_mint text, p_terms_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.beta_check_secret(p_secret);
  if p_network is null or p_network not in ('devnet', 'mainnet')
     or p_mint is null or p_mint !~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'
     or p_set is null or p_set !~ '^(ryntra-[a-z-]{1,24}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$' then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;
  if p_set not like 'ryntra-%' and not exists (
    select 1 from private.launch_sets s
     where s.network = p_network and s.id = p_set::uuid and not s.hidden and s.terms_key = p_terms_key
  ) then
    return jsonb_build_object('ok', true, 'counted', false);
  end if;
  insert into private.launch_set_uses (network, mint, set_id) values (p_network, p_mint, p_set)
  on conflict (network, mint) do nothing;
  return jsonb_build_object('ok', true, 'counted', found);
end;
$$;

revoke all on function public.launch_sets_top(text, text, integer) from public, anon, authenticated, service_role;
revoke all on function public.launch_set_save(text, text, text, text, jsonb, text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.launch_set_use(text, text, text, text, text) from public, anon, authenticated, service_role;

grant execute on function public.launch_sets_top(text, text, integer) to anon;
grant execute on function public.launch_set_save(text, text, text, text, jsonb, text, text, text) to anon;
grant execute on function public.launch_set_use(text, text, text, text, text) to anon;

commit;
