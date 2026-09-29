import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { inDevelopmentRepository, needsDevelopmentRepository } from "../development-repository.mjs";

const sql = readFileSync(
  new URL("../../supabase/migrations/20260721174101_ryn_slab_002_strategy_lab_append_only_v1.sql", import.meta.url),
  "utf8",
);
const rollback = readFileSync(
  new URL("../../supabase/prepared/20260719_strategy_lab_v1_containment_rollback.sql", import.meta.url),
  "utf8",
);
const recovery = readFileSync(
  new URL("../../supabase/prepared/20260721_strategy_lab_v1_access_recovery.sql", import.meta.url),
  "utf8",
);
const fkIndexes = readFileSync(
  new URL("../../supabase/migrations/20260721181158_ryn_slab_002_covering_fk_indexes.sql", import.meta.url),
  "utf8",
);
const correction = readFileSync(
  new URL("../../supabase/migrations/20260803231833_ryn_slab_002_lineage_utc_fix.sql", import.meta.url),
  "utf8",
);
const correctionAssertions = inDevelopmentRepository
  ? readFileSync(new URL("../../scripts/db/ryn-slab-002-correction-assertions.sql", import.meta.url), "utf8")
  : "";
const productionSmoke = inDevelopmentRepository
  ? readFileSync(new URL("../../scripts/strategy-lab-supabase-smoke.mjs", import.meta.url), "utf8")
  : "";

const tables = [
  "strategy_lab_strategies",
  "strategy_lab_versions",
  "strategy_lab_deliveries",
  "strategy_lab_experiments",
  "strategy_lab_imports",
  "strategy_lab_trades",
  "strategy_lab_evidence_reports",
  "strategy_lab_proposals",
];

const functions = [
  "strategy_lab_append_version",
  "strategy_lab_append_run",
  "strategy_lab_append_proposal",
  "strategy_lab_list",
  "strategy_lab_get",
];

test("Strategy Lab migration mirror is a fresh exact applied transaction", () => {
  assert.match(sql, /APPLIED 2026-07-21 as Supabase migration 20260721174101/);
  assert.match(sql, /^begin;$/m);
  assert.match(sql, /^commit;$/m);
  const executable = sql.replace(/^\s*--.*$/gm, "");
  assert.doesNotMatch(executable, /if\s+not\s+exists|create\s+or\s+replace/i);
  assert.doesNotMatch(sql, /^\s*(drop|delete|truncate)\s/im);
  for (const table of tables) {
    assert.match(sql, new RegExp(`create table private\\.${table} \\(`, "i"));
    assert.doesNotMatch(sql, new RegExp(`create table public\\.${table}`, "i"));
  }
});

test("all private tables are policy-free, force-RLS closed, ACL-revoked, and append-only", () => {
  assert.doesNotMatch(sql, /create policy/i);
  assert.match(sql, /from public, anon, authenticated, service_role;/i);
  assert.doesNotMatch(sql, /grant (select|insert|update|delete|truncate|references|trigger)[^;]+strategy_lab/i);
  for (const table of tables) {
    assert.match(sql, new RegExp(`alter table private\\.${table} enable row level security`, "i"));
    assert.match(sql, new RegExp(`alter table private\\.${table} force row level security`, "i"));
  }
  assert.equal((sql.match(/before update or delete on private\.strategy_lab_/gi) ?? []).length, tables.length);
  assert.equal((sql.match(/before truncate on private\.strategy_lab_/gi) ?? []).length, tables.length);
  assert.doesNotMatch(sql, /on delete cascade/i);
  assert.ok((sql.match(/on delete restrict/gi) ?? []).length >= 9);
});

test("public RPC surface is exact, secret-gated, empty-path, and anon-only", () => {
  assert.equal((sql.match(/language plpgsql\s+security definer\s+set search_path = ''/gi) ?? []).length, functions.length + 2);
  assert.doesNotMatch(sql, /search_path\s*=\s*public/i);
  for (const fn of functions) {
    assert.match(sql, new RegExp(`create function public\\.${fn}\\(`, "i"));
    assert.match(sql, new RegExp(`revoke all on function public\\.${fn}\\([^;]+from public, anon, authenticated, service_role`, "is"));
    assert.match(sql, new RegExp(`grant execute on function public\\.${fn}\\([^;]+to anon`, "is"));
  }
  assert.equal((sql.match(/perform private\.beta_check_secret\(p_secret\)/gi) ?? []).length, functions.length);
  assert.equal((sql.match(/private\.strategy_lab_verified_user\(p_telegram_id\)/gi) ?? []).length, functions.length);
  assert.doesNotMatch(sql, /grant execute[^;]+to (authenticated|service_role)/i);
});

test("delivery idempotency serializes exact requests and rejects changed hashes", () => {
  assert.match(sql, /pg_advisory_xact_lock\(pg_catalog\.hashtextextended/i);
  assert.match(sql, /unique \(user_id, operation, request_uuid\)/i);
  assert.match(sql, /raise exception 'idempotency conflict' using errcode = '23505'/i);
  assert.match(sql, /v_delivery\.result \|\| '\{"replay":true\}'::jsonb/i);
  assert.match(sql, /return \(p_result - 'replay'\) \|\| '\{"replay":false\}'::jsonb/i);
  for (const operation of ["version", "run", "proposal"]) {
    assert.ok(sql.includes(`private.strategy_lab_replay(v_user, '${operation}'`));
    assert.ok(sql.includes(`private.strategy_lab_store_delivery(v_user, '${operation}'`));
  }
});

test("versions persist the exact signed approval identity and reject stale forks", () => {
  assert.match(sql, /id uuid primary key,/i);
  assert.match(sql, /check \(\(approval->>'versionId'\)::uuid = id\)/i);
  assert.match(sql, /v_version_id := \(p_approval->>'versionId'\)::uuid/i);
  assert.match(sql, /p_approval->'spec', p_approval->>'specHash', v_approved_at/i);
  assert.match(sql, /'approval', p_approval/i);
  assert.match(sql, /v_latest_id is distinct from v_parent_id/i);
  assert.match(sql, /raise exception 'stale parent version'/i);
  assert.match(sql, /foreign key \(parent_version_id, strategy_id, user_id\)[\s\S]+on delete restrict/i);
});

test("runs enforce owned version/manifest binding, exact lineage, atomic normalized trades, and supplied evidence hash", () => {
  for (const field of ["parentRunId", "hypothesis", "changedFields", "userAttestedTestWindowSeenBeforeChange", "iterationNumber"]) {
    assert.ok(sql.includes(`'${field}'`), `missing lineage field ${field}`);
  }
  assert.match(sql, /invalid root lineage/i);
  assert.match(sql, /invalid child lineage/i);
  assert.match(sql, /v_iteration <> v_parent_iteration \+ 1/i);
  assert.match(sql, /e\.strategy_version_id = v_version_parent/i);
  assert.match(sql, /v_parent_spec->k\.key is distinct from v_spec->k\.key/i);
  assert.match(sql, /changed fields do not match approved specs/i);
  assert.match(sql, /p_manifest->>'strategyVersionId' is distinct from p_version_id::text/i);
  assert.match(sql, /p_manifest->>'symbol' is distinct from v_spec#>>'\{universe,symbol\}'/i);
  assert.match(sql, /p_manifest->>'timeframe' is distinct from v_spec->>'timeframe'/i);
  assert.match(sql, /jsonb_array_length\(p_trades\) > 20000/i);
  assert.match(sql, /pg_column_size\(p_trades\) > 16777216/i);
  assert.match(sql, /insert into private\.strategy_lab_trades/i);
  assert.match(sql, /p_evidence_hash !~ '\^\[0-9a-f\]\{64\}\$'/i);
  assert.match(sql, /'evidenceHash', p_evidence_hash/i);
  assert.match(sql, /'iterationNumber', v_iteration/i);
  assert.doesNotMatch(sql, /\b(raw_csv|trades_csv|performance_csv)\b/i);
});
test("forward correction binds root/child versions and uses UTC boundaries in every session timezone", { skip: needsDevelopmentRepository("the correction assertions under scripts/db/") }, () => {
  assert.match(correction, /PREPARED RYN-SLAB-002 forward correction/i);
  assert.match(correction, /^begin;$/m);
  assert.match(correction, /^commit;$/m);
  assert.match(correction, /create or replace function public\.strategy_lab_append_run/i);
  assert.match(correction, /v_version_parent is not null[\s\S]+invalid root lineage/i);
  assert.match(correction, /v_version_parent is null[\s\S]+invalid child lineage/i);
  assert.equal((correction.match(/at time zone 'UTC'/gi) ?? []).length, 2);
  assert.doesNotMatch(correction, /::date::timestamptz/i);
  assert.match(correction, /revoke all on function public\.strategy_lab_append_run[\s\S]+from public, anon, authenticated, service_role/i);
  assert.match(correction, /grant execute on function public\.strategy_lab_append_run[\s\S]+to anon/i);
  const correctionEnvelope = correction.replace(/as \$\$[\s\S]*?\$\$;/i, "");
  assert.doesNotMatch(correctionEnvelope, /^\s*(drop|delete|update|truncate|insert)\b/im);
  assert.match(correctionAssertions, /child StrategySpec accepted a root experiment lineage/i);
  assert.match(correctionAssertions, /root StrategySpec accepted a child experiment lineage/i);
  assert.match(correctionAssertions, /America\/New_York/);
  assert.match(correctionAssertions, /Asia\/Beirut/);
});

test("production smoke validates the same strict restore schemas before claiming recoverability", { skip: needsDevelopmentRepository("the production smoke script under scripts/") }, () => {
  assert.match(productionSmoke, /StrategyLabDetailResultSchema\.safeParse\(detail\)/);
  assert.match(productionSmoke, /StrategyLabProtocolSchema\.parse\(/);
  assert.match(productionSmoke, /StrategyChangeProposalSchema\.parse\(/);
  assert.match(productionSmoke, /evaluateEvidence\(/);
  assert.match(productionSmoke, /LEGACY_TELEGRAM_ID/);
  assert.match(productionSmoke, /quarantineLegacySyntheticUser/);
  assert.match(productionSmoke, /legacy\.response\.ok && Array\.isArray\(legacy\.body\)/);
  assert.match(productionSmoke, /legacy\.body\.length === 0/);
  assert.doesNotMatch(productionSmoke, /protocol:\s*\{\s*mode:\s*"paper"/);
  assert.doesNotMatch(productionSmoke, /score:\s*49/);
  assert.doesNotMatch(productionSmoke, /disposition:\s*"no_trade"/);
});


test("proposals bind exact owned evidence while manual audit remains nullable", () => {
  assert.match(sql, /source text not null check \(source in \('manual', 'ai'\)\)/i);
  assert.match(sql, /source = 'manual' and audit is null/i);
  assert.match(sql, /source = 'ai' and jsonb_typeof\(audit\) = 'object'/i);
  assert.match(sql, /e\.strategy_version_id = p_version_id/i);
  assert.match(sql, /r\.id = p_evidence_report_id/i);
  assert.match(sql, /v_stored_hash is distinct from p_evidence_hash/i);
  assert.match(sql, /raise exception 'evidence binding mismatch'/i);
});

test("reads are bounded, stable, user-scoped, and never restore trade rows", () => {
  assert.match(sql, /\(v\.recorded_at, s\.id\) < \(p_before_updated_at, p_before_id\)/i);
  assert.match(sql, /order by q\.updated_at desc, q\.strategy_id desc/i);
  assert.match(sql, /least\(coalesce\(p_version_limit, 50\), 100\)/i);
  assert.match(sql, /least\(coalesce\(p_run_limit, 50\), 100\)/i);
  assert.match(sql, /least\(coalesce\(p_proposal_limit, 50\), 100\)/i);
  assert.match(sql, /\(v\.recorded_at, v\.id\) < \(p_versions_before_recorded_at, p_versions_before_id\)/i);
  assert.match(sql, /\(e\.created_at, e\.id\) < \(p_runs_before_created_at, p_runs_before_id\)/i);
  assert.match(sql, /\(p\.created_at, p\.id\) < \(p_proposals_before_created_at, p_proposals_before_id\)/i);
  assert.match(sql, /where s\.id = p_strategy_id and s\.user_id = v_user/i);
  assert.match(sql, /'tradeCount', \(select count\(\*\)/i);
  assert.doesNotMatch(sql, /'trades'\s*,/i);
});

test("containment rollback revokes access without destructive data changes", () => {
  assert.match(rollback, /REVIEWED RYN-SLAB-002 non-destructive containment rollback/);
  assert.match(rollback, /^begin;$/m);
  assert.match(rollback, /^commit;$/m);
  for (const fn of functions) {
    assert.match(rollback, new RegExp(`revoke all on function public\\.${fn}\\(`, "i"));
  }
  assert.match(rollback, /from public, anon, authenticated, service_role;/i);
  const executable = rollback.replace(/^\s*--.*$/gm, "");
  assert.doesNotMatch(executable, /\b(drop|delete|update|truncate)\b/i);
  assert.doesNotMatch(executable, /disable row level security|create policy/i);
});

test("forward recovery restores only the reviewed anon RPC surface", () => {
  assert.match(recovery, /reviewed forward recovery/i);
  assert.match(recovery, /^begin;$/m);
  assert.match(recovery, /^commit;$/m);
  assert.match(recovery, /notify pgrst, 'reload schema'/i);
  assert.match(recovery, /v_table_count <> 8/i);
  assert.match(recovery, /v_function_count <> 5/i);
  assert.match(recovery, /relrowsecurity/i);
  assert.match(recovery, /relforcerowsecurity/i);
  assert.match(recovery, /search_path=""/i);
  for (const fn of functions) {
    assert.match(recovery, new RegExp(`revoke all on function public\\.${fn}\\(`, "i"));
    assert.match(recovery, new RegExp(`grant execute on function public\\.${fn}\\([^;]+to anon`, "is"));
  }
  const executable = recovery.replace(/^\s*--.*$/gm, "");
  assert.doesNotMatch(executable, /^\s*(drop|delete|update|truncate|insert)\b/im);
  assert.doesNotMatch(executable, /grant (select|insert|update|delete|truncate)[^;]+strategy_lab/i);
  assert.doesNotMatch(recovery, /grant execute[^;]+to (authenticated|service_role)/i);
});

test("applied advisor follow-up adds only the three reviewed composite FK indexes", () => {
  assert.match(fkIndexes, /APPLIED 2026-07-21 as Supabase migration 20260721181158/i);
  assert.match(fkIndexes, /^begin;$/m);
  assert.match(fkIndexes, /^commit;$/m);
  assert.equal((fkIndexes.match(/^create index /gim) ?? []).length, 3);
  assert.match(
    fkIndexes,
    /strategy_lab_versions_strategy_user_idx\s+on private\.strategy_lab_versions \(strategy_id, user_id\)/i,
  );
  assert.match(
    fkIndexes,
    /strategy_lab_imports_experiment_strategy_user_idx\s+on private\.strategy_lab_imports \(experiment_id, strategy_id, user_id\)/i,
  );
  assert.match(
    fkIndexes,
    /strategy_lab_evidence_experiment_strategy_user_idx\s+on private\.strategy_lab_evidence_reports \(experiment_id, strategy_id, user_id\)/i,
  );
  const executable = fkIndexes.replace(/^\s*--.*$/gm, "");
  assert.doesNotMatch(executable, /^\s*(drop|delete|update|truncate|insert|alter|grant|revoke)\b/im);
});
