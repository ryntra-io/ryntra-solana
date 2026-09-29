import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  resolveStrategyLabPersistenceState,
  strategyLabPaidAiEnabled,
  strategyLabPersistenceEnabled,
  strategyLabPersistenceState,
  strategyLabPreviewEnabled,
} from "./config.ts";

const route = (name) => readFileSync(new URL(`../../app/api/strategy-lab/${name}/route.ts`, import.meta.url), "utf8");
const persistenceSchemas = () => readFileSync(new URL("./persistence-schemas.ts", import.meta.url), "utf8");

test("Strategy Lab preview kill switch accepts only explicit false values", () => {
  const before = process.env.STRATEGY_LAB_PREVIEW_DISABLED;
  try {
    delete process.env.STRATEGY_LAB_PREVIEW_DISABLED;
    assert.equal(strategyLabPreviewEnabled(), true);
    for (const value of ["false", "0", "no", "off", " FALSE ", " Off "]) {
      process.env.STRATEGY_LAB_PREVIEW_DISABLED = value;
      assert.equal(strategyLabPreviewEnabled(), true);
    }
    for (const value of ["true", "TRUE", "1", "yes", "", "unexpected", " true "]) {
      process.env.STRATEGY_LAB_PREVIEW_DISABLED = value;
      assert.equal(strategyLabPreviewEnabled(), false);
    }
  } finally {
    if (before === undefined) delete process.env.STRATEGY_LAB_PREVIEW_DISABLED;
    else process.env.STRATEGY_LAB_PREVIEW_DISABLED = before;
  }
});

test("persistence distinguishes source-disabled, misconfigured, and enabled states", () => {
  const before = process.env.STRATEGY_LAB_PERSISTENCE_ENABLED;
  const config = readFileSync(new URL("./config.ts", import.meta.url), "utf8");
  try {
    /* The source flag is on since 2026-09-07 (RYN-ACCESS-002: saved plans on a
       real account), so the environment alone decides between «misconfigured»
       and «enabled»; nothing but the exact string "true" opens it. */
    for (const value of [undefined, "false", "TRUE", "1", " true "]) {
      assert.equal(resolveStrategyLabPersistenceState(true, value), "misconfigured");
      if (value === undefined) delete process.env.STRATEGY_LAB_PERSISTENCE_ENABLED;
      else process.env.STRATEGY_LAB_PERSISTENCE_ENABLED = value;
      assert.equal(strategyLabPersistenceEnabled(), false);
      assert.equal(strategyLabPersistenceState(), "misconfigured");
    }
    assert.equal(resolveStrategyLabPersistenceState(false, "true"), "source-disabled");
    assert.equal(resolveStrategyLabPersistenceState(true, "true"), "enabled");
    process.env.STRATEGY_LAB_PERSISTENCE_ENABLED = "true";
    assert.equal(strategyLabPersistenceState(), "enabled");
    assert.equal(strategyLabPersistenceEnabled(), strategyLabPreviewEnabled(), "the environment value opens persistence wherever the preview is on");
  } finally {
    if (before === undefined) delete process.env.STRATEGY_LAB_PERSISTENCE_ENABLED;
    else process.env.STRATEGY_LAB_PERSISTENCE_ENABLED = before;
  }
  assert.ok(config.includes("FLAGS.strategyLab.persistence"));
  assert.ok(config.includes('environmentValue === "true"'));
});

test("paid AI is available only in an explicit local development runtime", () => {
  const beforeRuntime = process.env.NODE_ENV;
  const beforeDisabled = process.env.STRATEGY_LAB_PREVIEW_DISABLED;
  try {
    delete process.env.STRATEGY_LAB_PREVIEW_DISABLED;
    for (const runtime of [undefined, "test", "staging", "production", "", "DEVELOPMENT"]) {
      if (runtime === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = runtime;
      assert.equal(strategyLabPaidAiEnabled(), false);
    }
    process.env.NODE_ENV = "development";
    assert.equal(strategyLabPaidAiEnabled(), true);
  } finally {
    if (beforeRuntime === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = beforeRuntime;
    if (beforeDisabled === undefined) delete process.env.STRATEGY_LAB_PREVIEW_DISABLED;
    else process.env.STRATEGY_LAB_PREVIEW_DISABLED = beforeDisabled;
  }
});

test("all Strategy Lab mutation routes share the fail-closed security envelope", () => {
  for (const name of ["approve", "formalize", "review", "import", "compile", "proposals", "strategies", "versions"]) {
    const source = route(name);
    const handler = name === "strategies" ? source.slice(source.indexOf("export async function POST")) : source;
    for (const control of [
      "strategyLabPreviewEnabled",
      "consumeStrategyLabPreSession",
      "mutationOriginAllowed",
      "getSession",
      /* RYN-ACCESS-002: the gate is the account (recorded session or legacy
         channel join), not the channel join alone. */
      "canKeepPersonalData(session)",
      "FixedWindowLimiter",
      "readBoundedJson",
      "privateNoStoreHeaders",
      "rateLimitHeaders",
    ]) {
      assert.ok(source.includes(control), `${name} must use ${control}`);
    }
    assert.ok(handler.indexOf("mutationOriginAllowed") < handler.indexOf("getSession()"));
    const ingressAt = handler.indexOf("const preSessionDecision = consumeStrategyLabPreSession");
    assert.ok(ingressAt > handler.indexOf("if (!mutationOriginAllowed") && ingressAt < handler.indexOf("getSession()"));
    assert.ok(handler.indexOf("if (!strategyLabPreviewEnabled())") < handler.indexOf("if (!mutationOriginAllowed"));
    assert.ok(handler.includes('return json({ error: "not found" }, 404)'));
  }
});

test("persistence-only routes fail closed before session and RPC work", () => {
  for (const name of ["strategies", "versions", "proposals"]) {
    const source = route(name);
    const handlers = name === "strategies"
      ? [
        source.slice(source.indexOf("export async function GET"), source.indexOf("export async function POST")),
        source.slice(source.indexOf("export async function POST")),
      ]
      : [source.slice(source.indexOf("export async function POST"))];
    for (const handler of handlers) {
      assert.ok(handler.includes("if (!strategyLabPreviewEnabled())"));
      assert.ok(handler.includes('if (persistenceState !== "enabled")'));
      assert.ok(handler.indexOf("strategyLabPersistenceState()") < handler.indexOf("getSession()"));
      assert.ok(handler.includes("persistence disabled"));
      assert.ok(handler.includes("persistence unavailable"));
      assert.ok(handler.includes("503"));
    }
  }
});

test("paid AI routes fail closed before origin, session, or provider work", () => {
  for (const name of ["formalize", "review"]) {
    const source = route(name);
    const gateAt = source.indexOf("if (!strategyLabPaidAiEnabled())");
    assert.ok(gateAt >= 0);
    assert.ok(gateAt < source.indexOf("if (!mutationOriginAllowed"));
    assert.ok(gateAt < source.indexOf("getSession()"));
    assert.ok(gateAt < source.indexOf(name === "formalize" ? "formalizeStrategy({" : "reviewEvidence({"));
  }
});

test("approval persistence stores only a signed exact artifact and returns the verified DB replay", () => {
  const approve = route("approve");
  for (const control of [
    "requestId: CanonicalUuidSchema",
    "AppendVersionResultSchema.safeParse(stored.data)",
    "issueStrategyApproval",
    "strategyLabAppendVersion",
    "parseStrategyApprovalArtifact(checked.data.approval)",
    "verifyStrategyApproval",
    "isStrategyLabIdempotencyConflict",
    "canonicalJson(storedApproval.data) !== canonicalJson(issued.approval)",
  ]) {
    assert.ok(approve.includes(control));
  }
  assert.ok(approve.includes("parentApproval: z.unknown().optional()"));
  assert.ok(approve.includes("parentVersionId = parentApproval.data.versionId"));
  assert.ok(approve.includes('persistenceState === "misconfigured"'));
  assert.ok(approve.indexOf('persistenceState === "misconfigured"') < approve.indexOf("issueStrategyApproval({"));
  assert.ok(approve.indexOf("issueStrategyApproval") < approve.indexOf("strategyLabAppendVersion({"));
  assert.ok(!approve.includes("p_spec:"));
  assert.ok(approve.includes("checked.data.replay ? 200 : 201"));
});

test("append RPCs carry stable request hashes and exact relational identities", () => {
  const rpc = readFileSync(new URL("./rpc.ts", import.meta.url), "utf8");
  for (const name of [
    "strategy_lab_append_version",
    "strategy_lab_append_run",
    "strategy_lab_append_proposal",
  ]) {
    assert.ok(rpc.includes(name));
  }
  assert.equal((rpc.match(/p_request_uuid:/g) ?? []).length, 3);
  assert.equal((rpc.match(/p_payload_hash:/g) ?? []).length, 3);
  assert.ok(!rpc.includes("strategy_lab_record_ai"));
  assert.ok(!rpc.includes("strategyLabRecordAi"));
  for (const field of ["p_evidence_hash", "p_experiment_id", "p_evidence_report_id", "p_source"]) {
    assert.ok(rpc.includes(field));
  }
});

test("import persistence is strict, idempotent, hash-bound, and fails closed", () => {
  const source = route("import");
  const normalizedSource = source.replace(/\r\n/g, "\n");
  for (const control of [
    "requestId: CanonicalUuidSchema",
    "lineage: ExperimentLineageSchema",
    "persistence request required",
    "evidenceProofSigningAvailable",
    "evidenceReportHash",
    "strategyLabAppendRun",
    "isStrategyLabIdempotencyConflict",
    "persistence integrity failure",
    "evidenceIdentity",
  ]) {
    assert.ok(source.includes(control));
  }
  assert.ok(!source.includes('"not-requested"'));
  assert.ok(!source.includes('"unavailable"'));
  assert.ok(!source.includes("versionId: z.string().uuid()"));
  assert.ok(normalizedSource.indexOf("evidenceProofSigningAvailable()") < normalizedSource.indexOf("strategyLabAppendRun({"));
  assert.ok(normalizedSource.indexOf("strategyLabAppendRun({") < normalizedSource.indexOf("issueEvidenceProof({"));
  assert.ok(normalizedSource.indexOf("issueEvidenceProof({") < normalizedSource.indexOf("return json({\n    manifest"));
});

test("manual proposals are provider-neutral, DB-bound, reload-recoverable, and never call OpenAI", () => {
  const source = route("proposals");
  for (const control of [
    "StrategyChangeProposalSchema",
    "applyReviewChanges",
    "createEvidenceProofIdentity",
    "evidenceIdentity.evidenceHash !== parsed.data.evidenceIdentity.evidenceHash",
    'source: "manual"',
    "audit: null",
    "strategyLabAppendProposal",
    "confirmHumanProposal: z.literal(true)",
  ]) {
    assert.ok(source.includes(control));
  }
  assert.ok(source.indexOf("createEvidenceProofIdentity") < source.indexOf("strategyLabAppendProposal({"));
  assert.ok(!source.includes("evidenceProof"));
  assert.ok(!source.includes("verifyEvidenceProof"));
  assert.ok(!source.includes("reviewEvidence"));
  assert.ok(!source.includes("openai"));
  assert.ok(source.includes("checked.data.replay ? 200 : 201"));
});

test("OpenAI routes remain stateless and defer before provider work when persistence is enabled or misconfigured", () => {
  const formalize = route("formalize");
  const review = route("review");
  const openai = readFileSync(new URL("./openai.ts", import.meta.url), "utf8");
  assert.ok(review.indexOf("verifyEvidenceProof") < review.indexOf("reviewEvidence"));
  for (const [name, source, providerCall] of [
    ["formalize", formalize, "formalizeStrategy({"],
    ["review", review, "reviewEvidence({"],
  ]) {
    assert.ok(source.includes("requestId: CanonicalUuidSchema"));
    assert.ok(source.includes("StrategyAiBudgetController"));
    assert.ok(source.includes("completedTtlMs: 60_000"));
    const deferredAt = source.indexOf('if (persistenceState !== "source-disabled"');
    const providerAt = source.indexOf(providerCall);
    assert.ok(deferredAt >= 0 && providerAt > deferredAt, `${name} must defer before provider work`);
    assert.ok(source.includes('"ai persistence deferred"'));
    assert.ok(source.includes('"persistence unavailable"'));
    assert.ok(source.includes('persistenceState === "misconfigured"'));
    assert.ok(source.includes('persistence: "disabled"'));
    assert.ok(!source.includes("strategyLabRecordAi"));
    assert.ok(!source.includes("strategyLabAppendProposal"));
  }
  assert.ok(review.includes("parsed.data.persistence !== undefined"));
  assert.ok(openai.includes("store: false"));
  assert.ok(openai.includes("safety_identifier"));
  for (const forbidden of ["function_call", "web_search", "code_interpreter", "mcp", "wallet_address", "tools:", "background"]) {
    assert.ok(!openai.includes(forbidden));
  }
});

test("import applies deterministic costs before evidence and never stores raw CSV", () => {
  const source = route("import");
  assert.ok(source.indexOf("applyCostModel") < source.indexOf("evaluateEvidence"));
  assert.ok(source.includes("rawFilesStored: false"));
  assert.ok(source.includes("compilePineV6"));
  assert.ok(source.indexOf("const compiled = compilePineV6") < source.indexOf("adjusted = applyCostModel"));
  assert.ok(source.includes("deriveBenchmarkReturnPercent"));
  assert.ok(source.includes("tradesPreview: adjusted.slice(0, 200)"));
  assert.ok(!source.includes("p_trades_csv"));
  assert.ok(!source.includes("p_performance_csv"));
});

test("derived evidence failures map to 422 before persistence or proof issuance", () => {
  const source = route("import");
  const evaluateAt = source.indexOf("evaluateEvidence({");
  const catchAt = source.indexOf("} catch {", evaluateAt);
  const persistAt = source.indexOf("strategyLabAppendRun({");
  const proofAt = source.indexOf("issueEvidenceProof({");
  assert.ok(evaluateAt >= 0 && catchAt > evaluateAt && persistAt > catchAt && proofAt > persistAt);
  assert.match(source.slice(catchAt, persistAt), /invalid trade data[\s\S]*422/);
});

test("legacy raw strategy mutation endpoints are deprecated", () => {
  for (const name of ["strategies", "versions"]) {
    const source = route(name);
    const handler = source.slice(source.indexOf("export async function POST"));
    assert.ok(handler.includes("DeprecatedMutationSchema"));
    assert.ok(handler.includes("use the approval endpoint"));
    assert.ok(!handler.includes("compilePineV6"));
    assert.ok(!handler.includes("strategyLabCreate"));
  }
});

test("strategy reads use paired bounded cursor pagination and bounded detail limits", () => {
  const source = `${route("strategies")}\n${persistenceSchemas()}`;
  for (const control of [
    "beforeUpdatedAt",
    "beforeId",
    ".max(100)",
    "versionLimit",
    "runLimit",
    "proposalLimit",
    "nextCursor",
    "last.updatedAt",
    "last.strategyId",
    "versionsBeforeRecordedAt",
    "versionsBeforeId",
    "runsBeforeCreatedAt",
    "runsBeforeId",
    "proposalsBeforeCreatedAt",
    "proposalsBeforeId",
    "nextCursors",
    "DetailResultSchema",
    "StrategyListResultSchema.safeParse(result.data)",
    "Version restore identity mismatch.",
    "Run restore identity mismatch.",
    "evidenceReportHash(run.evidence) !== run.evidenceHash",
    "Provider metrics exceed restore bounds.",
    "Collection cursors require a strategy id.",
    "Pagination cursor fields must be supplied together.",
  ]) {
    assert.ok(source.includes(control));
  }
  assert.ok(source.includes('datetime({ offset: true })'));
  assert.ok(source.includes("}).strict();"));
  assert.ok(!source.includes(".passthrough()"));
  assert.ok(!source.includes('toISOString() === value'));
});

test("detail restore RPC forwards every deterministic collection cursor pair", () => {
  const rpc = readFileSync(new URL("./rpc.ts", import.meta.url), "utf8");
  for (const control of [
    "versionsBeforeRecordedAt: string | null",
    "versionsBeforeId: string | null",
    "runsBeforeCreatedAt: string | null",
    "runsBeforeId: string | null",
    "proposalsBeforeCreatedAt: string | null",
    "proposalsBeforeId: string | null",
    "p_versions_before_recorded_at: input.versionsBeforeRecordedAt",
    "p_versions_before_id: input.versionsBeforeId",
    "p_runs_before_created_at: input.runsBeforeCreatedAt",
    "p_runs_before_id: input.runsBeforeId",
    "p_proposals_before_created_at: input.proposalsBeforeCreatedAt",
    "p_proposals_before_id: input.proposalsBeforeId",
  ]) {
    assert.ok(rpc.includes(control), `missing detail cursor contract: ${control}`);
  }
  const source = route("strategies");
  const schemas = persistenceSchemas();
  assert.ok(schemas.includes("strategyId: StrategyLabCanonicalUuidSchema"));
  assert.ok(schemas.includes("createdAt: StrategyLabCursorTimestampSchema"));
  assert.ok(schemas.includes("updatedAt: StrategyLabCursorTimestampSchema"));
  assert.ok(source.includes("persistence integrity failure"));
});
