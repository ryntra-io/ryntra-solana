-- ============================================================================
-- APPLIED 2026-07-21 as Supabase migration 20260721174101 after explicit founder approval.
-- RYN-SLAB-002 append-only Strategy Lab persistence candidate.
--
-- This is a fresh, exact transaction: object collisions and reapplication fail
-- atomically. It intentionally contains no IF NOT EXISTS or destructive repair.
-- The reviewed containment rollback only removes access; it never deletes data.
--
-- Invariants:
--   * private UUID-only tables; no sequence privileges are created;
--   * verified beta-user ownership is resolved inside secret-gated RPCs;
--   * exact retries return immutable original IDs; changed hashes fail closed;
--   * approval.versionId is the persisted version primary key;
--   * runs and proposals bind to owned immutable version/evidence lineage;
--   * normalized trades are stored atomically; source CSV is never stored/read;
--   * every table has ENABLE + FORCE RLS, no policies, explicit ACL revocation;
--   * UPDATE, DELETE and TRUNCATE are rejected on every Strategy Lab table;
--   * SECURITY DEFINER routines have an empty search_path; only anon executes RPCs.
--
-- ============================================================================

begin;

create table private.strategy_lab_strategies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.beta_users(id) on delete restrict,
  title text not null check (char_length(btrim(title)) between 3 and 80),
  created_at timestamptz not null default clock_timestamp(),
  unique (id, user_id)
);

create table private.strategy_lab_versions (
  id uuid primary key,
  strategy_id uuid not null,
  user_id uuid not null,
  version_number integer not null check (version_number > 0),
  parent_version_id uuid,
  spec jsonb not null check (jsonb_typeof(spec) = 'object' and pg_column_size(spec) <= 65536),
  spec_hash text not null check (spec_hash ~ '^[0-9a-f]{64}$'),
  approved_at timestamptz not null,
  proof text not null check (proof ~ '^v1\.[0-9a-f]{64}$'),
  approval jsonb not null check (jsonb_typeof(approval) = 'object' and pg_column_size(approval) <= 131072),
  check (
    approval ?& array['schemaVersion','versionId','spec','specHash','approvedAt','parentVersionId','proof']
    and (approval - 'schemaVersion' - 'versionId' - 'spec' - 'specHash' - 'approvedAt' - 'parentVersionId' - 'proof') = '{}'::jsonb
    and jsonb_typeof(approval->'schemaVersion') = 'number'
    and jsonb_typeof(approval->'versionId') = 'string'
    and jsonb_typeof(approval->'spec') = 'object'
    and jsonb_typeof(approval->'specHash') = 'string'
    and jsonb_typeof(approval->'approvedAt') = 'string'
    and jsonb_typeof(approval->'parentVersionId') in ('string','null')
    and jsonb_typeof(approval->'proof') = 'string'
  ),
  recorded_at timestamptz not null default clock_timestamp(),
  unique (strategy_id, version_number),
  unique (id, strategy_id, user_id),
  foreign key (strategy_id, user_id)
    references private.strategy_lab_strategies(id, user_id) on delete restrict,
  foreign key (parent_version_id, strategy_id, user_id)
    references private.strategy_lab_versions(id, strategy_id, user_id) on delete restrict,
  check ((approval->>'versionId')::uuid = id),
  check ((approval->>'specHash') = spec_hash),
  check ((approval->'spec') = spec),
  check ((approval->>'approvedAt')::timestamptz = approved_at),
  check ((approval->>'proof') = proof),
  check (
    (parent_version_id is null and approval->'parentVersionId' = 'null'::jsonb)
    or (approval->>'parentVersionId')::uuid = parent_version_id
  )
);

create table private.strategy_lab_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.beta_users(id) on delete restrict,
  operation text not null check (operation in ('version', 'run', 'proposal')),
  request_uuid uuid not null,
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  result jsonb not null check (jsonb_typeof(result) = 'object' and pg_column_size(result) <= 262144),
  created_at timestamptz not null default clock_timestamp(),
  unique (user_id, operation, request_uuid)
);

create table private.strategy_lab_experiments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  strategy_id uuid not null,
  strategy_version_id uuid not null,
  parent_experiment_id uuid,
  iteration_number integer not null check (iteration_number > 0),
  protocol jsonb not null check (jsonb_typeof(protocol) = 'object' and pg_column_size(protocol) <= 32768),
  lineage jsonb not null check (jsonb_typeof(lineage) = 'object' and pg_column_size(lineage) <= 16384),
  status text not null check (status in ('evidence-ready', 'reviewed')),
  created_at timestamptz not null default clock_timestamp(),
  unique (id, strategy_id, user_id),
  foreign key (strategy_version_id, strategy_id, user_id)
    references private.strategy_lab_versions(id, strategy_id, user_id) on delete restrict,
  foreign key (parent_experiment_id, strategy_id, user_id)
    references private.strategy_lab_experiments(id, strategy_id, user_id) on delete restrict
);

create table private.strategy_lab_imports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  strategy_id uuid not null,
  experiment_id uuid not null,
  provider text not null check (provider = 'tradingview'),
  manifest jsonb not null check (jsonb_typeof(manifest) = 'object' and pg_column_size(manifest) <= 65536),
  provider_metrics jsonb not null check (jsonb_typeof(provider_metrics) = 'object' and pg_column_size(provider_metrics) <= 65536),
  trades_file_hash text not null check (trades_file_hash ~ '^[0-9a-f]{64}$'),
  metrics_file_hash text not null check (metrics_file_hash ~ '^[0-9a-f]{64}$'),
  raw_files_stored boolean not null default false check (raw_files_stored = false),
  created_at timestamptz not null default clock_timestamp(),
  unique (experiment_id),
  unique (id, strategy_id, user_id),
  foreign key (experiment_id, strategy_id, user_id)
    references private.strategy_lab_experiments(id, strategy_id, user_id) on delete restrict
);

create table private.strategy_lab_trades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  strategy_id uuid not null,
  import_id uuid not null,
  trade_id text not null check (char_length(trade_id) between 1 and 64),
  side text not null check (side = 'long'),
  entry_at_ms bigint not null,
  exit_at_ms bigint not null check (exit_at_ms >= entry_at_ms),
  entry_price numeric not null check (entry_price > 0 and entry_price <= 1000000000000000000),
  exit_price numeric not null check (exit_price > 0 and exit_price <= 1000000000000000000),
  quantity numeric not null check (quantity > 0 and quantity <= 1000000000000000000),
  gross_pnl numeric not null check (abs(gross_pnl) <= 1000000000000000000),
  fees numeric not null check (fees >= 0 and fees <= 1000000000000000000),
  net_pnl numeric not null check (abs(net_pnl) <= 1000000000000000000),
  unique (import_id, trade_id),
  foreign key (import_id, strategy_id, user_id)
    references private.strategy_lab_imports(id, strategy_id, user_id) on delete restrict
);

create table private.strategy_lab_evidence_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  strategy_id uuid not null,
  experiment_id uuid not null,
  evidence_hash text not null check (evidence_hash ~ '^[0-9a-f]{64}$'),
  report jsonb not null check (jsonb_typeof(report) = 'object' and pg_column_size(report) <= 65536),
  engine_version text not null check (char_length(engine_version) between 1 and 64),
  created_at timestamptz not null default clock_timestamp(),
  unique (experiment_id),
  unique (id, experiment_id, strategy_id, user_id),
  foreign key (experiment_id, strategy_id, user_id)
    references private.strategy_lab_experiments(id, strategy_id, user_id) on delete restrict
);

create table private.strategy_lab_proposals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  strategy_id uuid not null,
  strategy_version_id uuid not null,
  experiment_id uuid not null,
  evidence_report_id uuid not null,
  evidence_hash text not null check (evidence_hash ~ '^[0-9a-f]{64}$'),
  source text not null check (source in ('manual', 'ai')),
  proposal jsonb not null check (jsonb_typeof(proposal) = 'object' and pg_column_size(proposal) <= 65536),
  audit jsonb,
  check (
    (source = 'manual' and audit is null)
    or (source = 'ai' and jsonb_typeof(audit) = 'object' and pg_column_size(audit) <= 65536)
  ),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (strategy_version_id, strategy_id, user_id)
    references private.strategy_lab_versions(id, strategy_id, user_id) on delete restrict,
  foreign key (experiment_id, strategy_id, user_id)
    references private.strategy_lab_experiments(id, strategy_id, user_id) on delete restrict,
  foreign key (evidence_report_id, experiment_id, strategy_id, user_id)
    references private.strategy_lab_evidence_reports(id, experiment_id, strategy_id, user_id) on delete restrict
);

create index strategy_lab_strategies_user_created_idx
  on private.strategy_lab_strategies (user_id, created_at desc, id desc);
create index strategy_lab_versions_strategy_recorded_idx
  on private.strategy_lab_versions (strategy_id, recorded_at desc, id desc);
create index strategy_lab_versions_parent_idx
  on private.strategy_lab_versions (parent_version_id, strategy_id, user_id);
create index strategy_lab_deliveries_user_created_idx
  on private.strategy_lab_deliveries (user_id, created_at desc, id desc);
create index strategy_lab_experiments_version_idx
  on private.strategy_lab_experiments (strategy_version_id, strategy_id, user_id);
create unique index strategy_lab_experiments_one_root_per_version_idx
  on private.strategy_lab_experiments (strategy_version_id) where parent_experiment_id is null;
create index strategy_lab_experiments_parent_idx
  on private.strategy_lab_experiments (parent_experiment_id, strategy_id, user_id);
create index strategy_lab_experiments_strategy_created_idx
  on private.strategy_lab_experiments (strategy_id, created_at desc, id desc);
create index strategy_lab_imports_owner_idx
  on private.strategy_lab_imports (strategy_id, user_id);
create index strategy_lab_trades_import_idx
  on private.strategy_lab_trades (import_id, strategy_id, user_id);
create index strategy_lab_evidence_owner_idx
  on private.strategy_lab_evidence_reports (strategy_id, user_id);
create index strategy_lab_proposals_version_idx
  on private.strategy_lab_proposals (strategy_version_id, strategy_id, user_id);
create index strategy_lab_proposals_experiment_idx
  on private.strategy_lab_proposals (experiment_id, strategy_id, user_id);
create index strategy_lab_proposals_evidence_idx
  on private.strategy_lab_proposals (evidence_report_id, experiment_id, strategy_id, user_id);
create index strategy_lab_proposals_strategy_created_idx
  on private.strategy_lab_proposals (strategy_id, created_at desc, id desc);

alter table private.strategy_lab_strategies enable row level security;
alter table private.strategy_lab_strategies force row level security;
alter table private.strategy_lab_versions enable row level security;
alter table private.strategy_lab_versions force row level security;
alter table private.strategy_lab_deliveries enable row level security;
alter table private.strategy_lab_deliveries force row level security;
alter table private.strategy_lab_experiments enable row level security;
alter table private.strategy_lab_experiments force row level security;
alter table private.strategy_lab_imports enable row level security;
alter table private.strategy_lab_imports force row level security;
alter table private.strategy_lab_trades enable row level security;
alter table private.strategy_lab_trades force row level security;
alter table private.strategy_lab_evidence_reports enable row level security;
alter table private.strategy_lab_evidence_reports force row level security;
alter table private.strategy_lab_proposals enable row level security;
alter table private.strategy_lab_proposals force row level security;

revoke all privileges on table
  private.strategy_lab_strategies,
  private.strategy_lab_versions,
  private.strategy_lab_deliveries,
  private.strategy_lab_experiments,
  private.strategy_lab_imports,
  private.strategy_lab_trades,
  private.strategy_lab_evidence_reports,
  private.strategy_lab_proposals
from public, anon, authenticated, service_role;

-- Every identifier is UUID-backed, so this schema creates no Strategy Lab sequence.

create function private.strategy_lab_reject_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'strategy lab records are append-only' using errcode = '55000';
  return null;
end;
$$;

revoke all on function private.strategy_lab_reject_mutation()
  from public, anon, authenticated, service_role;

create trigger strategy_lab_strategies_immutable
before update or delete on private.strategy_lab_strategies
for each row execute function private.strategy_lab_reject_mutation();
create trigger strategy_lab_strategies_no_truncate
before truncate on private.strategy_lab_strategies
for each statement execute function private.strategy_lab_reject_mutation();
create trigger strategy_lab_versions_immutable
before update or delete on private.strategy_lab_versions
for each row execute function private.strategy_lab_reject_mutation();
create trigger strategy_lab_versions_no_truncate
before truncate on private.strategy_lab_versions
for each statement execute function private.strategy_lab_reject_mutation();
create trigger strategy_lab_deliveries_immutable
before update or delete on private.strategy_lab_deliveries
for each row execute function private.strategy_lab_reject_mutation();
create trigger strategy_lab_deliveries_no_truncate
before truncate on private.strategy_lab_deliveries
for each statement execute function private.strategy_lab_reject_mutation();
create trigger strategy_lab_experiments_immutable
before update or delete on private.strategy_lab_experiments
for each row execute function private.strategy_lab_reject_mutation();
create trigger strategy_lab_experiments_no_truncate
before truncate on private.strategy_lab_experiments
for each statement execute function private.strategy_lab_reject_mutation();
create trigger strategy_lab_imports_immutable
before update or delete on private.strategy_lab_imports
for each row execute function private.strategy_lab_reject_mutation();
create trigger strategy_lab_imports_no_truncate
before truncate on private.strategy_lab_imports
for each statement execute function private.strategy_lab_reject_mutation();
create trigger strategy_lab_trades_immutable
before update or delete on private.strategy_lab_trades
for each row execute function private.strategy_lab_reject_mutation();
create trigger strategy_lab_trades_no_truncate
before truncate on private.strategy_lab_trades
for each statement execute function private.strategy_lab_reject_mutation();
create trigger strategy_lab_evidence_immutable
before update or delete on private.strategy_lab_evidence_reports
for each row execute function private.strategy_lab_reject_mutation();
create trigger strategy_lab_evidence_no_truncate
before truncate on private.strategy_lab_evidence_reports
for each statement execute function private.strategy_lab_reject_mutation();
create trigger strategy_lab_proposals_immutable
before update or delete on private.strategy_lab_proposals
for each row execute function private.strategy_lab_reject_mutation();
create trigger strategy_lab_proposals_no_truncate
before truncate on private.strategy_lab_proposals
for each statement execute function private.strategy_lab_reject_mutation();

create function private.strategy_lab_verified_user(p_telegram_id bigint)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select u.id
  from public.beta_users as u
  where u.telegram_id = p_telegram_id
    and exists (
      select 1 from public.beta_tasks as t
      where t.user_id = u.id
        and t.task_type = 'telegram_join'
        and t.status = 'verified'
    )
  limit 1
$$;

revoke all on function private.strategy_lab_verified_user(bigint)
  from public, anon, authenticated, service_role;

create function private.strategy_lab_replay(
  p_user_id uuid,
  p_operation text,
  p_request_uuid uuid,
  p_payload_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_delivery private.strategy_lab_deliveries%rowtype;
begin
  if p_request_uuid is null or p_payload_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid idempotency metadata' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'ryntra:strategy-lab:v1:' || p_user_id::text || ':' || p_operation || ':' || p_request_uuid::text,
    0
  ));
  select d.* into v_delivery
  from private.strategy_lab_deliveries as d
  where d.user_id = p_user_id
    and d.operation = p_operation
    and d.request_uuid = p_request_uuid;
  if found then
    if v_delivery.payload_hash is distinct from p_payload_hash then
      raise exception 'idempotency conflict' using errcode = '23505';
    end if;
    return v_delivery.result || '{"replay":true}'::jsonb;
  end if;
  return null;
end;
$$;

revoke all on function private.strategy_lab_replay(uuid,text,uuid,text)
  from public, anon, authenticated, service_role;

create function private.strategy_lab_store_delivery(
  p_user_id uuid,
  p_operation text,
  p_request_uuid uuid,
  p_payload_hash text,
  p_result jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.strategy_lab_deliveries
    (user_id, operation, request_uuid, payload_hash, result)
  values (p_user_id, p_operation, p_request_uuid, p_payload_hash, p_result - 'replay');
  return (p_result - 'replay') || '{"replay":false}'::jsonb;
end;
$$;

revoke all on function private.strategy_lab_store_delivery(uuid,text,uuid,text,jsonb)
  from public, anon, authenticated, service_role;

create function public.strategy_lab_append_version(
  p_secret text,
  p_telegram_id bigint,
  p_request_uuid uuid,
  p_payload_hash text,
  p_approval jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_replay jsonb;
  v_version_id uuid;
  v_parent_id uuid;
  v_strategy_id uuid;
  v_latest_id uuid;
  v_number integer;
  v_title text;
  v_approved_at timestamptz;
  v_result jsonb;
begin
  perform private.beta_check_secret(p_secret);
  v_user := private.strategy_lab_verified_user(p_telegram_id);
  if v_user is null then
    raise exception 'unknown or unverified user' using errcode = '22023';
  end if;
  v_replay := private.strategy_lab_replay(v_user, 'version', p_request_uuid, p_payload_hash);
  if v_replay is not null then return v_replay; end if;

  if pg_catalog.jsonb_typeof(p_approval) is distinct from 'object'
     or pg_catalog.pg_column_size(p_approval) > 131072
     or not (p_approval ?& array['schemaVersion','versionId','spec','specHash','approvedAt','parentVersionId','proof'])
     or (p_approval - 'schemaVersion' - 'versionId' - 'spec' - 'specHash' - 'approvedAt' - 'parentVersionId' - 'proof') <> '{}'::jsonb
     or p_approval->>'schemaVersion' <> '1'
     or p_approval->>'versionId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or pg_catalog.jsonb_typeof(p_approval->'spec') is distinct from 'object'
     or pg_catalog.pg_column_size(p_approval->'spec') > 65536
     or p_approval->>'specHash' !~ '^[0-9a-f]{64}$'
     or p_approval->>'approvedAt' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?Z$'
     or pg_catalog.jsonb_typeof(p_approval->'parentVersionId') not in ('string','null')
     or p_approval->>'proof' !~ '^v1\.[0-9a-f]{64}$' then
    raise exception 'invalid approval' using errcode = '22023';
  end if;

  v_version_id := (p_approval->>'versionId')::uuid;
  v_approved_at := (p_approval->>'approvedAt')::timestamptz;
  v_title := btrim(p_approval#>>'{spec,name}');
  if char_length(v_title) not between 3 and 80 then
    raise exception 'invalid approval' using errcode = '22023';
  end if;

  if p_approval->'parentVersionId' = 'null'::jsonb then
    v_parent_id := null;
    v_strategy_id := gen_random_uuid();
    v_number := 1;
    insert into private.strategy_lab_strategies (id, user_id, title)
    values (v_strategy_id, v_user, v_title);
  else
    if p_approval->>'parentVersionId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception 'invalid approval' using errcode = '22023';
    end if;
    v_parent_id := (p_approval->>'parentVersionId')::uuid;
    select v.strategy_id into v_strategy_id
    from private.strategy_lab_versions as v
    where v.id = v_parent_id and v.user_id = v_user;
    if v_strategy_id is null then
      raise exception 'parent version not found' using errcode = '22023';
    end if;
    perform 1 from private.strategy_lab_strategies as s
    where s.id = v_strategy_id and s.user_id = v_user for update;
    select v.id into v_latest_id
    from private.strategy_lab_versions as v
    where v.strategy_id = v_strategy_id and v.user_id = v_user
    order by v.version_number desc
    limit 1;
    if v_latest_id is distinct from v_parent_id then
      raise exception 'stale parent version' using errcode = '22023';
    end if;
    select coalesce(max(v.version_number), 0) + 1 into v_number
    from private.strategy_lab_versions as v
    where v.strategy_id = v_strategy_id and v.user_id = v_user;
  end if;

  insert into private.strategy_lab_versions
    (id, strategy_id, user_id, version_number, parent_version_id, spec, spec_hash, approved_at, proof, approval)
  values (
    v_version_id, v_strategy_id, v_user, v_number, v_parent_id,
    p_approval->'spec', p_approval->>'specHash', v_approved_at,
    p_approval->>'proof', p_approval
  );

  v_result := pg_catalog.jsonb_build_object(
    'strategyId', v_strategy_id,
    'versionId', v_version_id,
    'versionNumber', v_number,
    'approval', p_approval
  );
  return private.strategy_lab_store_delivery(v_user, 'version', p_request_uuid, p_payload_hash, v_result);
end;
$$;

create function public.strategy_lab_append_run(
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
    if v_iteration <> 1
       or pg_catalog.jsonb_array_length(p_lineage->'changedFields') <> 0
       or (p_lineage->>'userAttestedTestWindowSeenBeforeChange')::boolean
       or btrim(p_lineage->>'hypothesis') <> '' then
      raise exception 'invalid root lineage' using errcode = '22023';
    end if;
    v_parent := null;
  else
    if p_lineage->>'parentRunId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
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

  v_start_ms := (extract(epoch from (p_manifest#>>'{compileWindow,start}')::date::timestamptz) * 1000)::bigint;
  v_end_ms := (extract(epoch from (p_manifest#>>'{compileWindow,end}')::date::timestamptz) * 1000)::bigint;
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

create function public.strategy_lab_append_proposal(
  p_secret text,
  p_telegram_id bigint,
  p_request_uuid uuid,
  p_payload_hash text,
  p_version_id uuid,
  p_experiment_id uuid,
  p_evidence_report_id uuid,
  p_evidence_hash text,
  p_source text,
  p_proposal jsonb,
  p_audit jsonb
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
  v_stored_hash text;
  v_proposal_id uuid := gen_random_uuid();
  v_result jsonb;
begin
  perform private.beta_check_secret(p_secret);
  v_user := private.strategy_lab_verified_user(p_telegram_id);
  if v_user is null then
    raise exception 'unknown or unverified user' using errcode = '22023';
  end if;
  v_replay := private.strategy_lab_replay(v_user, 'proposal', p_request_uuid, p_payload_hash);
  if v_replay is not null then return v_replay; end if;

  select e.strategy_id, r.evidence_hash into v_strategy, v_stored_hash
  from private.strategy_lab_experiments as e
  join private.strategy_lab_evidence_reports as r
    on r.experiment_id = e.id and r.strategy_id = e.strategy_id and r.user_id = e.user_id
  where e.id = p_experiment_id
    and e.strategy_version_id = p_version_id
    and e.user_id = v_user
    and r.id = p_evidence_report_id;
  if v_strategy is null
     or v_stored_hash is distinct from p_evidence_hash
     or p_evidence_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'evidence binding mismatch' using errcode = '22023';
  end if;
  if p_source not in ('manual', 'ai')
     or pg_catalog.jsonb_typeof(p_proposal) is distinct from 'object'
     or pg_catalog.pg_column_size(p_proposal) > 65536
     or (p_source = 'manual' and p_audit is not null)
     or (p_source = 'ai' and pg_catalog.jsonb_typeof(p_audit) is distinct from 'object')
     or (p_audit is not null and pg_catalog.pg_column_size(p_audit) > 65536) then
    raise exception 'invalid proposal' using errcode = '22023';
  end if;

  insert into private.strategy_lab_proposals
    (id, user_id, strategy_id, strategy_version_id, experiment_id, evidence_report_id, evidence_hash, source, proposal, audit)
  values (
    v_proposal_id, v_user, v_strategy, p_version_id, p_experiment_id,
    p_evidence_report_id, p_evidence_hash, p_source, p_proposal, p_audit
  );
  v_result := pg_catalog.jsonb_build_object('proposalId', v_proposal_id);
  return private.strategy_lab_store_delivery(v_user, 'proposal', p_request_uuid, p_payload_hash, v_result);
end;
$$;

create function public.strategy_lab_list(
  p_secret text,
  p_telegram_id bigint,
  p_limit integer default 50,
  p_before_updated_at timestamptz default null,
  p_before_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_limit integer;
begin
  perform private.beta_check_secret(p_secret);
  v_user := private.strategy_lab_verified_user(p_telegram_id);
  if v_user is null then return '[]'::jsonb; end if;
  if (p_before_updated_at is null) <> (p_before_id is null) then
    raise exception 'invalid cursor' using errcode = '22023';
  end if;
  v_limit := greatest(1, least(coalesce(p_limit, 50), 100));
  return coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'strategyId', q.strategy_id,
      'title', q.title,
      'createdAt', q.created_at,
      'updatedAt', q.updated_at,
      'latestVersionId', q.version_id,
      'versionNumber', q.version_number,
      'specHash', q.spec_hash
    ) order by q.updated_at desc, q.strategy_id desc)
    from (
      select s.id as strategy_id,
             coalesce(v.spec->>'name', s.title) as title,
             s.created_at,
             v.recorded_at as updated_at,
             v.id as version_id,
             v.version_number,
             v.spec_hash
      from private.strategy_lab_strategies as s
      join lateral (
        select lv.id, lv.version_number, lv.spec, lv.spec_hash, lv.recorded_at
        from private.strategy_lab_versions as lv
        where lv.strategy_id = s.id and lv.user_id = s.user_id
        order by lv.version_number desc
        limit 1
      ) as v on true
      where s.user_id = v_user
        and (p_before_updated_at is null or (v.recorded_at, s.id) < (p_before_updated_at, p_before_id))
      order by v.recorded_at desc, s.id desc
      limit v_limit
    ) as q
  ), '[]'::jsonb);
end;
$$;

create function public.strategy_lab_get(
  p_secret text,
  p_telegram_id bigint,
  p_strategy_id uuid,
  p_version_limit integer default 50,
  p_run_limit integer default 50,
  p_proposal_limit integer default 50,
  p_versions_before_recorded_at timestamptz default null,
  p_versions_before_id uuid default null,
  p_runs_before_created_at timestamptz default null,
  p_runs_before_id uuid default null,
  p_proposals_before_created_at timestamptz default null,
  p_proposals_before_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_strategy private.strategy_lab_strategies%rowtype;
  v_updated timestamptz;
  v_title text;
  v_versions jsonb;
  v_runs jsonb;
  v_proposals jsonb;
begin
  perform private.beta_check_secret(p_secret);
  v_user := private.strategy_lab_verified_user(p_telegram_id);
  if v_user is null then return null; end if;
  if (p_versions_before_recorded_at is null) <> (p_versions_before_id is null)
     or (p_runs_before_created_at is null) <> (p_runs_before_id is null)
     or (p_proposals_before_created_at is null) <> (p_proposals_before_id is null) then
    raise exception 'invalid cursor' using errcode = '22023';
  end if;
  select s.* into v_strategy from private.strategy_lab_strategies as s
  where s.id = p_strategy_id and s.user_id = v_user;
  if not found then return null; end if;

  select v.recorded_at, coalesce(v.spec->>'name', v_strategy.title)
  into v_updated, v_title
  from private.strategy_lab_versions as v
  where v.strategy_id = p_strategy_id and v.user_id = v_user
  order by v.version_number desc limit 1;

  select coalesce(pg_catalog.jsonb_agg(q.item order by q.recorded_at desc, q.id desc), '[]'::jsonb)
  into v_versions
  from (
    select v.id, v.recorded_at, pg_catalog.jsonb_build_object(
      'versionId', v.id,
      'versionNumber', v.version_number,
      'parentVersionId', v.parent_version_id,
      'spec', v.spec,
      'specHash', v.spec_hash,
      'approvedAt', v.approved_at,
      'approval', v.approval,
      'recordedAt', v.recorded_at
    ) as item
    from private.strategy_lab_versions as v
    where v.strategy_id = p_strategy_id and v.user_id = v_user
      and (p_versions_before_recorded_at is null
        or (v.recorded_at, v.id) < (p_versions_before_recorded_at, p_versions_before_id))
    order by v.recorded_at desc, v.id desc
    limit greatest(1, least(coalesce(p_version_limit, 50), 100))
  ) as q;

  select coalesce(pg_catalog.jsonb_agg(q.item order by q.created_at desc, q.id desc), '[]'::jsonb)
  into v_runs
  from (
    select e.id, e.created_at, pg_catalog.jsonb_build_object(
      'experimentId', e.id,
      'versionId', e.strategy_version_id,
      'parentExperimentId', e.parent_experiment_id,
      'iterationNumber', e.iteration_number,
      'protocol', e.protocol,
      'lineage', e.lineage,
      'status', e.status,
      'manifest', i.manifest,
      'providerMetrics', i.provider_metrics,
      'rawFilesStored', false,
      'tradeCount', (select count(*) from private.strategy_lab_trades as t where t.import_id = i.id),
      'evidenceReportId', r.id,
      'evidenceHash', r.evidence_hash,
      'evidence', r.report,
      'engineVersion', r.engine_version,
      'createdAt', e.created_at
    ) as item
    from private.strategy_lab_experiments as e
    join private.strategy_lab_imports as i
      on i.experiment_id = e.id and i.user_id = e.user_id and i.strategy_id = e.strategy_id
    join private.strategy_lab_evidence_reports as r
      on r.experiment_id = e.id and r.user_id = e.user_id and r.strategy_id = e.strategy_id
    where e.strategy_id = p_strategy_id and e.user_id = v_user
      and (p_runs_before_created_at is null
        or (e.created_at, e.id) < (p_runs_before_created_at, p_runs_before_id))
    order by e.created_at desc, e.id desc
    limit greatest(1, least(coalesce(p_run_limit, 50), 100))
  ) as q;

  select coalesce(pg_catalog.jsonb_agg(q.item order by q.created_at desc, q.id desc), '[]'::jsonb)
  into v_proposals
  from (
    select p.id, p.created_at, pg_catalog.jsonb_build_object(
      'proposalId', p.id,
      'versionId', p.strategy_version_id,
      'experimentId', p.experiment_id,
      'evidenceReportId', p.evidence_report_id,
      'evidenceHash', p.evidence_hash,
      'source', p.source,
      'proposal', p.proposal,
      'audit', p.audit,
      'createdAt', p.created_at
    ) as item
    from private.strategy_lab_proposals as p
    where p.strategy_id = p_strategy_id and p.user_id = v_user
      and (p_proposals_before_created_at is null
        or (p.created_at, p.id) < (p_proposals_before_created_at, p_proposals_before_id))
    order by p.created_at desc, p.id desc
    limit greatest(1, least(coalesce(p_proposal_limit, 50), 100))
  ) as q;

  return pg_catalog.jsonb_build_object(
    'strategy', pg_catalog.jsonb_build_object(
      'strategyId', v_strategy.id,
      'title', v_title,
      'createdAt', v_strategy.created_at,
      'updatedAt', v_updated
    ),
    'versions', v_versions,
    'runs', v_runs,
    'proposals', v_proposals
  );
end;
$$;

revoke all on function public.strategy_lab_append_version(text,bigint,uuid,text,jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.strategy_lab_append_run(text,bigint,uuid,text,uuid,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,text,text)
  from public, anon, authenticated, service_role;
revoke all on function public.strategy_lab_append_proposal(text,bigint,uuid,text,uuid,uuid,uuid,text,text,jsonb,jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.strategy_lab_list(text,bigint,integer,timestamptz,uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.strategy_lab_get(text,bigint,uuid,integer,integer,integer,timestamptz,uuid,timestamptz,uuid,timestamptz,uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.strategy_lab_append_version(text,bigint,uuid,text,jsonb) to anon;
grant execute on function public.strategy_lab_append_run(text,bigint,uuid,text,uuid,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,text,text) to anon;
grant execute on function public.strategy_lab_append_proposal(text,bigint,uuid,text,uuid,uuid,uuid,text,text,jsonb,jsonb) to anon;
grant execute on function public.strategy_lab_list(text,bigint,integer,timestamptz,uuid) to anon;
grant execute on function public.strategy_lab_get(text,bigint,uuid,integer,integer,integer,timestamptz,uuid,timestamptz,uuid,timestamptz,uuid) to anon;

commit;
