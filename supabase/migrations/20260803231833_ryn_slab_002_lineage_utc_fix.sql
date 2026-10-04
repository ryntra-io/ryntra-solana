-- PREPARED Strategy Lab forward correction.
-- Replaces only the append-run function: child versions cannot mint root runs,
-- and UTC compile-window bounds no longer depend on the database/session TimeZone.

begin;

create or replace function public.strategy_lab_append_run(
  p_secret text,
  p_telegram_id bigint,
  p_request_uuid uuid,
  p_payload_hash text,
  p_version_id uuid,
  p_protocol jsonb,
  p_lineage jsonb,
  p_manifest jsonb,
  p_provider_metrics jsonb,
  p_trades jsonb,
  p_evidence jsonb,
  p_evidence_hash text,
  p_engine_version text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_replay jsonb;
  v_strategy uuid;
  v_spec jsonb;
  v_version_parent uuid;
  v_parent uuid;
  v_parent_iteration integer;
  v_parent_spec jsonb;
  v_expected_changed_fields jsonb;
  v_iteration integer;
  v_experiment uuid := gen_random_uuid();
  v_import uuid := gen_random_uuid();
  v_evidence_id uuid := gen_random_uuid();
  v_start_ms bigint;
  v_end_ms bigint;
  v_result jsonb;
begin
  perform private.beta_check_secret(p_secret);
  v_user := private.strategy_lab_verified_user(p_telegram_id);
  if v_user is null then
    raise exception 'unknown or unverified user' using errcode = '22023';
  end if;
  v_replay := private.strategy_lab_replay(v_user, 'run', p_request_uuid, p_payload_hash);
  if v_replay is not null then return v_replay; end if;

  select v.strategy_id, v.spec, v.parent_version_id into v_strategy, v_spec, v_version_parent
  from private.strategy_lab_versions as v
  where v.id = p_version_id and v.user_id = v_user;
  if v_strategy is null then
    raise exception 'version not found' using errcode = '22023';
  end if;

  if pg_catalog.jsonb_typeof(p_protocol) is distinct from 'object'
     or pg_catalog.pg_column_size(p_protocol) > 32768
     or pg_catalog.jsonb_typeof(p_lineage) is distinct from 'object'
     or pg_catalog.pg_column_size(p_lineage) > 16384
     or not (p_lineage ?& array['parentRunId','hypothesis','changedFields','userAttestedTestWindowSeenBeforeChange','iterationNumber'])
     or (p_lineage - 'parentRunId' - 'hypothesis' - 'changedFields' - 'userAttestedTestWindowSeenBeforeChange' - 'iterationNumber') <> '{}'::jsonb
     or pg_catalog.jsonb_typeof(p_lineage->'parentRunId') not in ('string','null')
     or pg_catalog.jsonb_typeof(p_lineage->'hypothesis') is distinct from 'string'
     or char_length(btrim(p_lineage->>'hypothesis')) > 500
     or pg_catalog.jsonb_typeof(p_lineage->'changedFields') is distinct from 'array'
     or pg_catalog.jsonb_array_length(p_lineage->'changedFields') > 32
     or exists (
       select 1 from pg_catalog.jsonb_array_elements(p_lineage->'changedFields') as f(value)
       where pg_catalog.jsonb_typeof(f.value) is distinct from 'string'
          or char_length(btrim(f.value #>> '{}')) not between 1 and 120
     )
     or pg_catalog.jsonb_typeof(p_lineage->'userAttestedTestWindowSeenBeforeChange') is distinct from 'boolean'
     or pg_catalog.jsonb_typeof(p_lineage->'iterationNumber') is distinct from 'number'
     or p_lineage->>'iterationNumber' !~ '^[1-9][0-9]*$'
     or (p_lineage->>'iterationNumber')::numeric > 2147483647 then
    raise exception 'invalid lineage' using errcode = '22023';
  end if;
  v_iteration := (p_lineage->>'iterationNumber')::integer;

  if p_lineage->'parentRunId' = 'null'::jsonb then
    if v_version_parent is not null
       or v_iteration <> 1
       or pg_catalog.jsonb_array_length(p_lineage->'changedFields') <> 0
       or (p_lineage->>'userAttestedTestWindowSeenBeforeChange')::boolean
       or btrim(p_lineage->>'hypothesis') <> '' then
      raise exception 'invalid root lineage' using errcode = '22023';
    end if;
    v_parent := null;
  else
    if v_version_parent is null
       or p_lineage->>'parentRunId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or pg_catalog.jsonb_array_length(p_lineage->'changedFields') = 0
       or char_length(btrim(p_lineage->>'hypothesis')) not between 1 and 500 then
      raise exception 'invalid child lineage' using errcode = '22023';
    end if;
    v_parent := (p_lineage->>'parentRunId')::uuid;
    select e.iteration_number, pv.spec into v_parent_iteration, v_parent_spec
    from private.strategy_lab_experiments as e
    join private.strategy_lab_versions as pv
      on pv.id = e.strategy_version_id and pv.strategy_id = e.strategy_id and pv.user_id = e.user_id
    where e.id = v_parent and e.user_id = v_user and e.strategy_id = v_strategy
      and e.strategy_version_id = v_version_parent;
    if v_parent_iteration is null or v_iteration <> v_parent_iteration + 1 then
      raise exception 'invalid child lineage' using errcode = '22023';
    end if;
    select coalesce(pg_catalog.jsonb_agg(k.key order by k.key), '[]'::jsonb)
    into v_expected_changed_fields
    from (
      select pg_catalog.jsonb_object_keys(v_parent_spec) as key
      union
      select pg_catalog.jsonb_object_keys(v_spec) as key
    ) as k
    where v_parent_spec->k.key is distinct from v_spec->k.key;
    if p_lineage->'changedFields' is distinct from v_expected_changed_fields then
      raise exception 'changed fields do not match approved specs' using errcode = '22023';
    end if;
  end if;

  if pg_catalog.jsonb_typeof(p_manifest) is distinct from 'object'
     or pg_catalog.pg_column_size(p_manifest) > 65536
     or not (p_manifest ?& array['schemaVersion','provider','strategyVersionId','compilerVersion','pineHash','symbol','timeframe','timezone','compileWindow','initialCapital','exportedAt','tradesFileHash','metricsFileHash'])
     or (p_manifest - 'schemaVersion' - 'provider' - 'strategyVersionId' - 'compilerVersion' - 'pineHash' - 'symbol' - 'timeframe' - 'timezone' - 'compileWindow' - 'initialCapital' - 'exportedAt' - 'tradesFileHash' - 'metricsFileHash') <> '{}'::jsonb
     or p_manifest->>'schemaVersion' <> '1'
     or p_manifest->>'provider' <> 'tradingview'
     or p_manifest->>'strategyVersionId' is distinct from p_version_id::text
     or p_manifest->>'symbol' is distinct from v_spec#>>'{universe,symbol}'
     or p_manifest->>'timeframe' is distinct from v_spec->>'timeframe'
     or p_manifest->>'timezone' <> 'UTC'
     or char_length(p_manifest->>'compilerVersion') not between 1 and 64
     or p_manifest->>'pineHash' !~ '^[0-9a-f]{64}$'
     or p_manifest->>'tradesFileHash' !~ '^[0-9a-f]{64}$'
     or p_manifest->>'metricsFileHash' !~ '^[0-9a-f]{64}$'
     or pg_catalog.jsonb_typeof(p_manifest->'compileWindow') is distinct from 'object'
     or ((p_manifest->'compileWindow') - 'start'::text - 'end'::text) <> '{}'::jsonb
     or p_manifest#>>'{compileWindow,start}' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     or p_manifest#>>'{compileWindow,end}' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     or pg_catalog.to_char(pg_catalog.to_date(p_manifest#>>'{compileWindow,start}', 'YYYY-MM-DD'), 'YYYY-MM-DD') <> p_manifest#>>'{compileWindow,start}'
     or pg_catalog.to_char(pg_catalog.to_date(p_manifest#>>'{compileWindow,end}', 'YYYY-MM-DD'), 'YYYY-MM-DD') <> p_manifest#>>'{compileWindow,end}'
     or p_manifest#>>'{compileWindow,start}' >= p_manifest#>>'{compileWindow,end}'
     or pg_catalog.jsonb_typeof(p_manifest->'initialCapital') is distinct from 'number'
     or (p_manifest->>'initialCapital')::numeric <= 0
     or (p_manifest->>'initialCapital')::numeric > 1000000000000
     or pg_catalog.jsonb_typeof(p_manifest->'exportedAt') is distinct from 'string' then
    raise exception 'manifest does not match immutable strategy version' using errcode = '22023';
  end if;

  if pg_catalog.jsonb_typeof(p_provider_metrics) is distinct from 'object'
     or pg_catalog.pg_column_size(p_provider_metrics) > 65536
     or pg_catalog.jsonb_typeof(p_trades) is distinct from 'array'
     or pg_catalog.jsonb_array_length(p_trades) > 20000
     or pg_catalog.pg_column_size(p_trades) > 16777216
     or pg_catalog.jsonb_typeof(p_evidence) is distinct from 'object'
     or pg_catalog.pg_column_size(p_evidence) > 65536
     or p_evidence_hash !~ '^[0-9a-f]{64}$'
     or char_length(p_engine_version) not between 1 and 64 then
    raise exception 'invalid run payload' using errcode = '22023';
  end if;

  v_start_ms := (
    extract(epoch from ((p_manifest#>>'{compileWindow,start}')::date::timestamp without time zone at time zone 'UTC')) * 1000
  )::bigint;
  v_end_ms := (
    extract(epoch from ((p_manifest#>>'{compileWindow,end}')::date::timestamp without time zone at time zone 'UTC')) * 1000
  )::bigint;
  if exists (
    select 1 from pg_catalog.jsonb_array_elements(p_trades) as x(t)
    where pg_catalog.jsonb_typeof(x.t) is distinct from 'object'
       or not (x.t ?& array['id','side','entryAt','exitAt','entryPrice','exitPrice','quantity','grossPnl','fees','netPnl'])
       or (x.t - 'id' - 'side' - 'entryAt' - 'exitAt' - 'entryPrice' - 'exitPrice' - 'quantity' - 'grossPnl' - 'fees' - 'netPnl') <> '{}'::jsonb
       or pg_catalog.jsonb_typeof(x.t->'id') is distinct from 'string'
       or char_length(x.t->>'id') not between 1 and 64
       or x.t->>'side' <> 'long'
       or pg_catalog.jsonb_typeof(x.t->'entryAt') is distinct from 'number'
       or pg_catalog.jsonb_typeof(x.t->'exitAt') is distinct from 'number'
       or x.t->>'entryAt' !~ '^[0-9]+$'
       or x.t->>'exitAt' !~ '^[0-9]+$'
       or (x.t->>'entryAt')::numeric > 9223372036854775807
       or (x.t->>'exitAt')::numeric > 9223372036854775807
       or (x.t->>'entryAt')::bigint < v_start_ms
       or (x.t->>'entryAt')::bigint >= v_end_ms
       or (x.t->>'exitAt')::bigint < (x.t->>'entryAt')::bigint
       or pg_catalog.jsonb_typeof(x.t->'entryPrice') is distinct from 'number'
       or pg_catalog.jsonb_typeof(x.t->'exitPrice') is distinct from 'number'
       or pg_catalog.jsonb_typeof(x.t->'quantity') is distinct from 'number'
       or pg_catalog.jsonb_typeof(x.t->'grossPnl') is distinct from 'number'
       or pg_catalog.jsonb_typeof(x.t->'fees') is distinct from 'number'
       or pg_catalog.jsonb_typeof(x.t->'netPnl') is distinct from 'number'
       or (x.t->>'entryPrice')::numeric <= 0
       or (x.t->>'entryPrice')::numeric > 1000000000000000000
       or (x.t->>'exitPrice')::numeric <= 0
       or (x.t->>'exitPrice')::numeric > 1000000000000000000
       or (x.t->>'quantity')::numeric <= 0
       or (x.t->>'quantity')::numeric > 1000000000000000000
       or (x.t->>'fees')::numeric < 0
       or (x.t->>'fees')::numeric > 1000000000000000000
       or abs((x.t->>'grossPnl')::numeric) > 1000000000000000000
       or abs((x.t->>'netPnl')::numeric) > 1000000000000000000
  ) then
    raise exception 'invalid trade data' using errcode = '22023';
  end if;

  insert into private.strategy_lab_experiments
    (id, user_id, strategy_id, strategy_version_id, parent_experiment_id, iteration_number, protocol, lineage, status)
  values (v_experiment, v_user, v_strategy, p_version_id, v_parent, v_iteration, p_protocol, p_lineage, 'evidence-ready');

  insert into private.strategy_lab_imports
    (id, user_id, strategy_id, experiment_id, provider, manifest, provider_metrics, trades_file_hash, metrics_file_hash)
  values (
    v_import, v_user, v_strategy, v_experiment, 'tradingview', p_manifest, p_provider_metrics,
    p_manifest->>'tradesFileHash', p_manifest->>'metricsFileHash'
  );

  insert into private.strategy_lab_trades
    (user_id, strategy_id, import_id, trade_id, side, entry_at_ms, exit_at_ms, entry_price, exit_price, quantity, gross_pnl, fees, net_pnl)
  select
    v_user, v_strategy, v_import, t->>'id', t->>'side',
    (t->>'entryAt')::bigint, (t->>'exitAt')::bigint,
    (t->>'entryPrice')::numeric, (t->>'exitPrice')::numeric,
    (t->>'quantity')::numeric, (t->>'grossPnl')::numeric,
    (t->>'fees')::numeric, (t->>'netPnl')::numeric
  from pg_catalog.jsonb_array_elements(p_trades) as x(t);

  insert into private.strategy_lab_evidence_reports
    (id, user_id, strategy_id, experiment_id, evidence_hash, report, engine_version)
  values (v_evidence_id, v_user, v_strategy, v_experiment, p_evidence_hash, p_evidence, p_engine_version);

  v_result := pg_catalog.jsonb_build_object(
    'experimentId', v_experiment,
    'importId', v_import,
    'evidenceReportId', v_evidence_id,
    'evidenceHash', p_evidence_hash,
    'iterationNumber', v_iteration
  );
  return private.strategy_lab_store_delivery(v_user, 'run', p_request_uuid, p_payload_hash, v_result);
end;
$$;

revoke all on function public.strategy_lab_append_run(
  text,bigint,uuid,text,uuid,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,text,text
) from public, anon, authenticated, service_role;
grant execute on function public.strategy_lab_append_run(
  text,bigint,uuid,text,uuid,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,text,text
) to anon;

notify pgrst, 'reload schema';

commit;
