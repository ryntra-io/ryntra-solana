-- ============================================================================
-- PREPARED, NOT APPLIED — do NOT run against production without founder approval.
-- This file stays in supabase/prepared/ so the applied-migrations mirror remains
-- truthful. A future rollout must copy the reviewed content into a fresh timestamped
-- migration and receive separate explicit approval before any remote application.
--
-- DecisionReceipt v1 invariants:
--   * every row is an immutable snapshot of deterministic readiness inputs + output;
--   * receipt_key deduplicates delivery, separately from intent.idempotencyKey;
--   * an exact retry returns the original row; a conflicting replay fails closed;
--   * storage is private, RLS has no policies, and public RPCs are secret-gated;
--   * SECURITY DEFINER functions use an empty search_path and qualified objects;
--   * UPDATE, DELETE and TRUNCATE are rejected in addition to privilege revocation.
-- ============================================================================

begin;

create table private.decision_receipts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.beta_users(id) on delete restrict,
  receipt_key uuid not null,
  receipt_version smallint not null check (receipt_version = 1),
  receipt_kind text not null check (receipt_kind = 'trade-readiness'),
  evaluator_id text not null check (evaluator_id = 'evaluate-readiness'),
  evaluator_version smallint not null check (evaluator_version = 1),
  policy_id text not null check (policy_id in ('planned-trade', 'spot-swap')),
  policy_version smallint not null check (policy_version = 1),
  route text not null check (
    char_length(trim(route)) between 1 and 64
    and route in (
      'arcus-spot-rfq',
      'arcus-perps-clob',
      'uniswap-rhchain-amm',
      'hyperliquid-perps-clob'
    )
  ),
  instrument text not null check (char_length(trim(instrument)) between 1 and 128),
  intent_kind text check (
    intent_kind is null
    or intent_kind in ('spot-swap', 'perp-order', 'paper-order')
  ),
  verdict text not null check (verdict in ('ready', 'caution', 'not-ready')),
  evaluated_at timestamptz not null,
  receipt jsonb not null,
  recorded_at timestamptz not null default clock_timestamp(),
  unique (user_id, receipt_key),
  check (jsonb_typeof(receipt) is not distinct from 'object'),
  check (pg_column_size(receipt) <= 65536),
  check (receipt ?& array[
    'schemaVersion',
    'kind',
    'evaluatedAt',
    'evaluator',
    'policy',
    'instrument',
    'capability',
    'signals',
    'plan',
    'compliance',
    'intent',
    'verdict'
  ]),
  check (
    receipt->'evaluator' ?& array['id', 'version']
    and receipt->'policy' ?& array['id', 'version', 'config']
    and receipt#>'{policy,config}' ?& array[
      'maxRiskPct', 'requiresThesis', 'requiresStop'
    ]
    and receipt->'instrument' ?& array['chain', 'kind', 'base', 'quote']
    and receipt->'capability' ?& array['route', 'state']
    and receipt#>'{capability,state}' ?& array[
      'protocol', 'ryntra', 'user', 'verifiedAt', 'source'
    ]
    and receipt->'plan' ?& array[
      'thesis', 'entry', 'stop', 'invalidation', 'targets', 'riskPct'
    ]
    and receipt->'compliance' ?& array['status', 'source', 'checkedAt']
    and receipt->'verdict' ?& array['level', 'reasons']
    and (
      receipt->'intent' = 'null'::jsonb
      or receipt->'intent' ?& array[
        'kind',
        'route',
        'instrument',
        'side',
        'size',
        'limitPrice',
        'executionMode',
        'idempotencyKey',
        'createdAt'
      ]
    )
  ),
  check (jsonb_typeof(receipt->'evaluator') is not distinct from 'object'),
  check (jsonb_typeof(receipt->'policy') is not distinct from 'object'),
  check (jsonb_typeof(receipt#>'{policy,config}') is not distinct from 'object'),
  check (jsonb_typeof(receipt->'instrument') is not distinct from 'object'),
  check (jsonb_typeof(receipt->'capability') is not distinct from 'object'),
  check (jsonb_typeof(receipt#>'{capability,state}') is not distinct from 'object'),
  check (jsonb_typeof(receipt->'signals') is not distinct from 'array'),
  check (jsonb_typeof(receipt->'plan') is not distinct from 'object'),
  check (jsonb_typeof(receipt->'compliance') is not distinct from 'object'),
  check (jsonb_typeof(receipt->'verdict') is not distinct from 'object'),
  check (jsonb_typeof(receipt#>'{plan,targets}') is not distinct from 'array'),
  check (jsonb_typeof(receipt#>'{verdict,reasons}') is not distinct from 'array'),
  check (jsonb_array_length(receipt->'signals') <= 32),
  check (jsonb_array_length(receipt#>'{plan,targets}') <= 16),
  check (jsonb_array_length(receipt#>'{verdict,reasons}') <= 64),
  check ((receipt->>'schemaVersion')::smallint is not distinct from receipt_version),
  check ((receipt->>'kind') is not distinct from receipt_kind),
  check ((receipt#>>'{evaluator,id}') is not distinct from evaluator_id),
  check ((receipt#>>'{evaluator,version}')::smallint is not distinct from evaluator_version),
  check ((receipt#>>'{policy,id}') is not distinct from policy_id),
  check ((receipt#>>'{policy,version}')::smallint is not distinct from policy_version),
  check ((receipt#>>'{capability,route}') is not distinct from route),
  check ((receipt#>>'{verdict,level}') is not distinct from verdict),
  check (
    instrument is not distinct from (
      (receipt#>>'{instrument,chain}') || ':' ||
      (receipt#>>'{instrument,kind}') || ':' ||
      (receipt#>>'{instrument,base}') || '/' ||
      (receipt#>>'{instrument,quote}')
    )
  ),
  check (
    (receipt->'intent' = 'null'::jsonb and intent_kind is null)
    or (
      jsonb_typeof(receipt->'intent') is not distinct from 'object'
      and receipt->'intent' ?& array[
        'kind',
        'route',
        'instrument',
        'side',
        'size',
        'limitPrice',
        'executionMode',
        'idempotencyKey',
        'createdAt'
      ]
      and (receipt#>>'{intent,kind}') is not distinct from intent_kind
    )
  )
);

create index decision_receipts_user_recorded_idx
  on private.decision_receipts (user_id, recorded_at desc, id desc);

alter table private.decision_receipts enable row level security;
revoke all on table private.decision_receipts
  from public, anon, authenticated, service_role;

create or replace function private.reject_decision_receipt_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'decision receipts are append-only'
    using errcode = '55000';
  return null;
end;
$$;

revoke all on function private.reject_decision_receipt_mutation()
  from public, anon, authenticated, service_role;

create trigger decision_receipts_immutable
before update or delete on private.decision_receipts
for each row execute function private.reject_decision_receipt_mutation();

create trigger decision_receipts_no_truncate
before truncate on private.decision_receipts
for each statement execute function private.reject_decision_receipt_mutation();

create or replace function public.trr_append(
  p_secret text,
  p_telegram_id bigint,
  p_receipt_key uuid,
  p_receipt jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_route text;
  v_chain text;
  v_instrument_kind text;
  v_base text;
  v_quote text;
  v_instrument text;
  v_intent_kind text;
  v_verdict text;
  v_evaluator_id text;
  v_evaluator_version smallint;
  v_policy_id text;
  v_policy_version smallint;
  v_evaluated_ms numeric;
  v_evaluated_at timestamptz;
  v_now_ms numeric;
  v_row private.decision_receipts%rowtype;
begin
  perform private.beta_check_secret(p_secret);

  select u.id into v_user
  from public.beta_users as u
  where u.telegram_id = p_telegram_id
    and exists (
      select 1
      from public.beta_tasks as t
      where t.user_id = u.id
        and t.task_type = 'telegram_join'
        and t.status = 'verified'
    );
  if v_user is null then
    raise exception 'unknown or unverified user'
      using errcode = '22023';
  end if;

  if p_receipt_key is null then
    raise exception 'receipt key required'
      using errcode = '22023';
  end if;
  if p_receipt is null
     or jsonb_typeof(p_receipt) is distinct from 'object'
     or octet_length(p_receipt::text) > 65536 then
    raise exception 'invalid decision receipt'
      using errcode = '22023';
  end if;
  if (p_receipt ?& array[
    'schemaVersion',
    'kind',
    'evaluatedAt',
    'evaluator',
    'policy',
    'instrument',
    'capability',
    'signals',
    'plan',
    'compliance',
    'intent',
    'verdict'
  ]) is not true then
    raise exception 'incomplete decision receipt'
      using errcode = '22023';
  end if;
  if jsonb_typeof(p_receipt->'schemaVersion') is distinct from 'number'
     or p_receipt->>'schemaVersion' is distinct from '1'
     or jsonb_typeof(p_receipt->'kind') is distinct from 'string'
     or p_receipt->>'kind' is distinct from 'trade-readiness' then
    raise exception 'unsupported decision receipt version'
      using errcode = '22023';
  end if;

  if jsonb_typeof(p_receipt->'evaluator') is distinct from 'object'
     or jsonb_typeof(p_receipt->'policy') is distinct from 'object'
     or jsonb_typeof(p_receipt#>'{policy,config}') is distinct from 'object'
     or jsonb_typeof(p_receipt->'instrument') is distinct from 'object'
     or jsonb_typeof(p_receipt->'capability') is distinct from 'object'
     or jsonb_typeof(p_receipt#>'{capability,state}') is distinct from 'object'
     or jsonb_typeof(p_receipt->'signals') is distinct from 'array'
     or jsonb_typeof(p_receipt->'plan') is distinct from 'object'
     or jsonb_typeof(p_receipt#>'{plan,targets}') is distinct from 'array'
     or jsonb_typeof(p_receipt->'compliance') is distinct from 'object'
     or jsonb_typeof(p_receipt->'verdict') is distinct from 'object'
     or jsonb_typeof(p_receipt#>'{verdict,reasons}') is distinct from 'array'
     or jsonb_typeof(p_receipt->'intent') not in ('object', 'null') then
    raise exception 'invalid decision receipt shape'
      using errcode = '22023';
  end if;
  if (
    p_receipt->'evaluator' ?& array['id', 'version']
    and p_receipt->'policy' ?& array['id', 'version', 'config']
    and p_receipt#>'{policy,config}' ?& array[
      'maxRiskPct', 'requiresThesis', 'requiresStop'
    ]
    and p_receipt->'instrument' ?& array['chain', 'kind', 'base', 'quote']
    and p_receipt->'capability' ?& array['route', 'state']
    and p_receipt#>'{capability,state}' ?& array[
      'protocol', 'ryntra', 'user', 'verifiedAt', 'source'
    ]
    and p_receipt->'plan' ?& array[
      'thesis', 'entry', 'stop', 'invalidation', 'targets', 'riskPct'
    ]
    and p_receipt->'compliance' ?& array['status', 'source', 'checkedAt']
    and p_receipt->'verdict' ?& array['level', 'reasons']
    and (
      p_receipt->'intent' = 'null'::jsonb
      or p_receipt->'intent' ?& array[
        'kind',
        'route',
        'instrument',
        'side',
        'size',
        'limitPrice',
        'executionMode',
        'idempotencyKey',
        'createdAt'
      ]
    )
  ) is not true then
    raise exception 'incomplete nested decision receipt'
      using errcode = '22023';
  end if;
  if jsonb_array_length(p_receipt->'signals') > 32
     or jsonb_array_length(p_receipt#>'{plan,targets}') > 16
     or jsonb_array_length(p_receipt#>'{verdict,reasons}') > 64 then
    raise exception 'decision receipt array limit exceeded'
      using errcode = '22023';
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_receipt->'signals') as e(value)
    where pg_catalog.jsonb_typeof(e.value) is distinct from 'object'
  ) or exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_receipt#>'{plan,targets}') as e(value)
    where pg_catalog.jsonb_typeof(e.value) is distinct from 'string'
       or char_length(trim(e.value #>> '{}')) not between 1 and 128
  ) or exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_receipt#>'{verdict,reasons}') as e(value)
    where pg_catalog.jsonb_typeof(e.value) is distinct from 'string'
       or char_length(trim(e.value #>> '{}')) not between 1 and 256
  ) then
    raise exception 'invalid decision receipt array item'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_receipt->'signals') as e(value)
    where not (e.value ?& array[
      'id', 'label', 'state', 'value', 'severity', 'source', 'observedAt'
    ])
       or jsonb_typeof(e.value->'id') is distinct from 'string'
       or char_length(trim(e.value->>'id')) not between 1 and 128
       or jsonb_typeof(e.value->'label') is distinct from 'string'
       or char_length(trim(e.value->>'label')) not between 1 and 256
       or jsonb_typeof(e.value->'state') is distinct from 'string'
       or e.value->>'state' not in ('fresh', 'stale', 'unknown', 'conflicting')
       or jsonb_typeof(e.value->'value') not in (
         'string', 'number', 'boolean', 'null'
       )
       or (
         jsonb_typeof(e.value->'value') = 'string'
         and char_length(e.value->>'value') > 2048
       )
       or jsonb_typeof(e.value->'severity') is distinct from 'string'
       or e.value->>'severity' not in ('info', 'caution', 'blocker')
       or jsonb_typeof(e.value->'source') is distinct from 'string'
       or char_length(trim(e.value->>'source')) not between 1 and 512
       or jsonb_typeof(e.value->'observedAt') not in ('number', 'null')
       or (
         jsonb_typeof(e.value->'observedAt') = 'number'
         and (
           (e.value->>'observedAt')::numeric <= 0
           or (e.value->>'observedAt')::numeric <>
             pg_catalog.trunc((e.value->>'observedAt')::numeric)
         )
       )
  ) then
    raise exception 'invalid decision receipt risk signal'
      using errcode = '22023';
  end if;

  v_evaluator_id := p_receipt#>>'{evaluator,id}';
  if v_evaluator_id is distinct from 'evaluate-readiness'
     or jsonb_typeof(p_receipt#>'{evaluator,version}') is distinct from 'number'
     or p_receipt#>>'{evaluator,version}' is distinct from '1' then
    raise exception 'unsupported evaluator version'
      using errcode = '22023';
  end if;
  v_evaluator_version := 1;

  v_policy_id := p_receipt#>>'{policy,id}';
  if v_policy_id is null
     or v_policy_id not in ('planned-trade', 'spot-swap')
     or jsonb_typeof(p_receipt#>'{policy,version}') is distinct from 'number'
     or p_receipt#>>'{policy,version}' is distinct from '1' then
    raise exception 'unsupported policy version'
      using errcode = '22023';
  end if;
  v_policy_version := 1;
  if (
    v_policy_id = 'planned-trade'
    and p_receipt#>'{policy,config}' is distinct from
      '{"maxRiskPct":2,"requiresThesis":true,"requiresStop":true}'::jsonb
  ) or (
    v_policy_id = 'spot-swap'
    and p_receipt#>'{policy,config}' is distinct from
      '{"maxRiskPct":100,"requiresThesis":false,"requiresStop":false}'::jsonb
  ) then
    raise exception 'policy config does not match version'
      using errcode = '22023';
  end if;

  if jsonb_typeof(p_receipt#>'{capability,state,protocol}') is distinct from 'string'
     or p_receipt#>>'{capability,state,protocol}'
       not in ('live', 'beta', 'unavailable')
     or jsonb_typeof(p_receipt#>'{capability,state,ryntra}') is distinct from 'string'
     or p_receipt#>>'{capability,state,ryntra}'
       not in ('live', 'read-only', 'paper', 'planned', 'blocked')
     or jsonb_typeof(p_receipt#>'{capability,state,user}') is distinct from 'string'
     or p_receipt#>>'{capability,state,user}'
       not in ('available', 'restricted', 'unknown')
     or jsonb_typeof(p_receipt#>'{capability,state,verifiedAt}')
       is distinct from 'string'
     or p_receipt#>>'{capability,state,verifiedAt}'
       !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     or jsonb_typeof(p_receipt#>'{capability,state,source}') is distinct from 'string'
     or p_receipt#>>'{capability,state,source}'
       not in ('live-probe', 'official-docs', 'derived', 'unverified')
     or (
       p_receipt#>'{capability,state}' ? 'reason'
       and (
         jsonb_typeof(p_receipt#>'{capability,state,reason}')
           is distinct from 'string'
         or char_length(p_receipt#>>'{capability,state,reason}') > 512
       )
     ) then
    raise exception 'invalid receipt capability state'
      using errcode = '22023';
  end if;

  v_route := p_receipt#>>'{capability,route}';
  if v_route is null
     or v_route not in (
    'arcus-spot-rfq',
    'arcus-perps-clob',
    'uniswap-rhchain-amm',
    'hyperliquid-perps-clob'
  ) then
    raise exception 'invalid receipt route'
      using errcode = '22023';
  end if;

  if jsonb_typeof(p_receipt#>'{instrument,chain}') is distinct from 'string'
     or jsonb_typeof(p_receipt#>'{instrument,kind}') is distinct from 'string'
     or jsonb_typeof(p_receipt#>'{instrument,base}') is distinct from 'string'
     or jsonb_typeof(p_receipt#>'{instrument,quote}') is distinct from 'string' then
    raise exception 'invalid receipt instrument'
      using errcode = '22023';
  end if;
  v_chain := p_receipt#>>'{instrument,chain}';
  v_instrument_kind := p_receipt#>>'{instrument,kind}';
  v_base := p_receipt#>>'{instrument,base}';
  v_quote := p_receipt#>>'{instrument,quote}';
  if v_chain not in ('robinhood-chain', 'hypercore')
     or v_instrument_kind not in (
       'spot-tokenized-equity',
       'spot-crypto',
       'rwa-perp',
       'crypto-perp'
     )
     or v_base !~ '^[A-Za-z0-9._-]{1,32}$'
     or v_quote !~ '^[A-Za-z0-9._-]{1,32}$' then
    raise exception 'invalid receipt instrument'
      using errcode = '22023';
  end if;
  if (
    v_route = 'hyperliquid-perps-clob'
    and v_chain <> 'hypercore'
  ) or (
    v_route <> 'hyperliquid-perps-clob'
    and v_chain <> 'robinhood-chain'
  ) then
    raise exception 'route and instrument chain mismatch'
      using errcode = '22023';
  end if;
  v_instrument :=
    v_chain || ':' || v_instrument_kind || ':' || v_base || '/' || v_quote;

  if jsonb_typeof(p_receipt#>'{plan,thesis}') is distinct from 'string'
     or char_length(p_receipt#>>'{plan,thesis}') > 4096
     or jsonb_typeof(p_receipt#>'{plan,entry}') not in ('string', 'null')
     or (
       jsonb_typeof(p_receipt#>'{plan,entry}') = 'string'
       and char_length(p_receipt#>>'{plan,entry}') > 128
     )
     or jsonb_typeof(p_receipt#>'{plan,stop}') not in ('string', 'null')
     or (
       jsonb_typeof(p_receipt#>'{plan,stop}') = 'string'
       and char_length(p_receipt#>>'{plan,stop}') > 128
     )
     or jsonb_typeof(p_receipt#>'{plan,invalidation}') not in ('string', 'null')
     or (
       jsonb_typeof(p_receipt#>'{plan,invalidation}') = 'string'
       and char_length(p_receipt#>>'{plan,invalidation}') > 2048
     )
     or jsonb_typeof(p_receipt#>'{plan,riskPct}') not in ('number', 'null') then
    raise exception 'invalid receipt plan'
      using errcode = '22023';
  end if;

  v_verdict := p_receipt#>>'{verdict,level}';
  if v_verdict is null
     or v_verdict not in ('ready', 'caution', 'not-ready') then
    raise exception 'invalid receipt verdict'
      using errcode = '22023';
  end if;
  if jsonb_typeof(p_receipt#>'{compliance,status}') is distinct from 'string'
     or p_receipt#>>'{compliance,status}' not in ('allowed', 'blocked', 'unknown')
     or jsonb_typeof(p_receipt#>'{compliance,source}') is distinct from 'string'
     or p_receipt#>>'{compliance,source}'
       not in ('arcus-compliance-api', 'geo-static', 'unverified')
     or jsonb_typeof(p_receipt#>'{compliance,checkedAt}')
       not in ('number', 'null')
     or (
       jsonb_typeof(p_receipt#>'{compliance,checkedAt}') = 'number'
       and (
         (p_receipt#>>'{compliance,checkedAt}')::numeric <= 0
         or (p_receipt#>>'{compliance,checkedAt}')::numeric <>
           pg_catalog.trunc((p_receipt#>>'{compliance,checkedAt}')::numeric)
       )
     )
     or (
       p_receipt->'compliance' ? 'reason'
       and (
         jsonb_typeof(p_receipt#>'{compliance,reason}') is distinct from 'string'
         or char_length(p_receipt#>>'{compliance,reason}') > 2048
       )
     ) then
    raise exception 'invalid receipt compliance'
      using errcode = '22023';
  end if;

  if p_receipt->'intent' = 'null'::jsonb then
    v_intent_kind := null;
  else
    v_intent_kind := p_receipt#>>'{intent,kind}';
    if v_intent_kind is null
       or v_intent_kind not in ('spot-swap', 'perp-order', 'paper-order')
       or p_receipt#>>'{intent,route}' is distinct from v_route
       or p_receipt#>'{intent,instrument}' is distinct from p_receipt->'instrument'
       or jsonb_typeof(p_receipt#>'{intent,side}') is distinct from 'string'
       or p_receipt#>>'{intent,side}' not in ('buy', 'sell')
       or jsonb_typeof(p_receipt#>'{intent,size}') is distinct from 'string'
       or char_length(trim(p_receipt#>>'{intent,size}')) not between 1 and 128
       or jsonb_typeof(p_receipt#>'{intent,limitPrice}')
         not in ('string', 'null')
       or (
         jsonb_typeof(p_receipt#>'{intent,limitPrice}') = 'string'
         and char_length(trim(p_receipt#>>'{intent,limitPrice}'))
           not between 1 and 128
       )
       or jsonb_typeof(p_receipt#>'{intent,executionMode}')
         is distinct from 'string'
       or p_receipt#>>'{intent,executionMode}'
         not in ('wallet-signed', 'client-api-key', 'server-agent-key', 'oauth-broker')
       or jsonb_typeof(p_receipt#>'{intent,idempotencyKey}')
         is distinct from 'string'
       or p_receipt#>>'{intent,idempotencyKey}'
          !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or jsonb_typeof(p_receipt#>'{intent,createdAt}') is distinct from 'number'
       or (p_receipt#>>'{intent,createdAt}')::numeric <= 0
       or (p_receipt#>>'{intent,createdAt}')::numeric <>
         pg_catalog.trunc((p_receipt#>>'{intent,createdAt}')::numeric) then
      raise exception 'invalid receipt intent binding'
        using errcode = '22023';
    end if;
  end if;

  if jsonb_typeof(p_receipt->'evaluatedAt') is distinct from 'number' then
    raise exception 'invalid evaluatedAt'
      using errcode = '22023';
  end if;
  v_evaluated_ms := (p_receipt->>'evaluatedAt')::numeric;
  v_now_ms := extract(epoch from pg_catalog.clock_timestamp()) * 1000;
  if v_evaluated_ms <> pg_catalog.trunc(v_evaluated_ms)
     or v_evaluated_ms <= 0
     or v_evaluated_ms > v_now_ms + 300000 then
    raise exception 'invalid evaluatedAt'
      using errcode = '22023';
  end if;
  v_evaluated_at :=
    pg_catalog.to_timestamp((v_evaluated_ms / 1000)::double precision);

  insert into private.decision_receipts (
    user_id,
    receipt_key,
    receipt_version,
    receipt_kind,
    evaluator_id,
    evaluator_version,
    policy_id,
    policy_version,
    route,
    instrument,
    intent_kind,
    verdict,
    evaluated_at,
    receipt
  )
  values (
    v_user,
    p_receipt_key,
    1,
    'trade-readiness',
    v_evaluator_id,
    v_evaluator_version,
    v_policy_id,
    v_policy_version,
    v_route,
    v_instrument,
    v_intent_kind,
    v_verdict,
    v_evaluated_at,
    p_receipt
  )
  on conflict (user_id, receipt_key) do nothing
  returning * into v_row;

  if v_row.id is null then
    select r.* into v_row
    from private.decision_receipts as r
    where r.user_id = v_user
      and r.receipt_key = p_receipt_key;

    if v_row.id is null then
      raise exception 'decision receipt retry unavailable'
        using errcode = '40001';
    end if;
    if v_row.receipt is distinct from p_receipt then
      raise exception 'decision receipt idempotency conflict'
        using errcode = '23505';
    end if;
  end if;

  return pg_catalog.jsonb_build_object(
    'id', v_row.id,
    'receiptKey', v_row.receipt_key,
    'recordedAt', v_row.recorded_at,
    'receipt', v_row.receipt
  );
end;
$$;

create or replace function public.trr_list(
  p_secret text,
  p_telegram_id bigint,
  p_limit int default 50
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_limit int := greatest(least(coalesce(p_limit, 50), 200), 1);
begin
  perform private.beta_check_secret(p_secret);

  select u.id into v_user
  from public.beta_users as u
  where u.telegram_id = p_telegram_id
    and exists (
      select 1
      from public.beta_tasks as t
      where t.user_id = u.id
        and t.task_type = 'telegram_join'
        and t.status = 'verified'
    );
  if v_user is null then
    raise exception 'unknown or unverified user'
      using errcode = '22023';
  end if;

  return coalesce((
    select pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'id', r.id,
        'receiptKey', r.receipt_key,
        'recordedAt', r.recorded_at,
        'receipt', r.receipt
      )
      order by r.recorded_at desc, r.id desc
    )
    from (
      select d.id, d.receipt_key, d.recorded_at, d.receipt
      from private.decision_receipts as d
      where d.user_id = v_user
      order by d.recorded_at desc, d.id desc
      limit v_limit
    ) as r
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.trr_append(text, bigint, uuid, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.trr_list(text, bigint, int)
  from public, anon, authenticated, service_role;

grant execute on function public.trr_append(text, bigint, uuid, jsonb) to anon;
grant execute on function public.trr_list(text, bigint, int) to anon;

commit;
