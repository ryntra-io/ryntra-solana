import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  StrategyApprovalArtifactSchema,
  canonicalJson,
  issueStrategyApproval,
  verifyStrategyApproval,
  parseStrategyApprovalArtifact,
} from "./approval.ts";

const secret = "strategy-lab-approval-test-secret-32-bytes-minimum";

const validSpec = (overrides = {}) => ({
  schemaVersion: 1,
  name: "BTC RSI mean reversion",
  universe: { provider: "tradingview", symbol: "BYBIT:BTCUSDT", assetClass: "crypto" },
  timeframe: "4h",
  thesis: "Buy oversold reversals only when the broader trend remains constructive.",
  indicators: [
    { id: "rsi-main", kind: "rsi", source: "close", length: 14 },
    { id: "ema-filter", kind: "ema", source: "close", length: 200 },
  ],
  entry: {
    kind: "all",
    rules: [
      { kind: "compare", left: { kind: "indicator", id: "rsi-main" }, operator: "crosses_above", right: { kind: "number", value: 30 } },
      { kind: "compare", left: { kind: "price", source: "close" }, operator: "above", right: { kind: "indicator", id: "ema-filter" } },
    ],
  },
  exit: {
    kind: "any",
    rules: [
      { kind: "compare", left: { kind: "indicator", id: "rsi-main" }, operator: "above", right: { kind: "number", value: 55 } },
    ],
  },
  stop: { kind: "percent", value: 2.5 },
  sizing: { kind: "risk_percent", value: 1 },
  filters: [],
  riskPolicy: { maxDrawdownPercent: 12, maxOpenPositions: 1, allowShort: false },
  costModel: { commissionBps: 10, spreadBps: 5, slippageBps: 8, fundingBpsPerDay: 0 },
  assumptions: ["Signals execute on confirmed bar close."],
  ...overrides,
});

function mustIssue(spec = validSpec(), parentVersionId = null, signingSecret = secret) {
  const result = issueStrategyApproval({ telegramId: 123456, spec, parentVersionId }, signingSecret);
  assert.equal(result.ok, true);
  return result.approval;
}

function changedProof(proof) {
  const last = proof.at(-1);
  return proof.slice(0, -1) + (last === "0" ? "1" : "0");
}

test("issue creates a strict server-generated immutable approval artifact", () => {
  const approval = mustIssue();
  const second = mustIssue();

  assert.equal(StrategyApprovalArtifactSchema.safeParse(approval).success, true);
  assert.match(approval.versionId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(second.versionId, approval.versionId);
  assert.equal(new Date(approval.approvedAt).toISOString(), approval.approvedAt);
  assert.equal(approval.parentVersionId, null);
  assert.equal(
    approval.specHash,
    createHash("sha256").update(canonicalJson(approval.spec)).digest("hex"),
  );
  assert.match(approval.proof, /^v1\.[a-f0-9]{64}$/);
  assert.equal(verifyStrategyApproval({ telegramId: 123456, spec: validSpec(), approval }, secret), "valid");
  assert.equal(StrategyApprovalArtifactSchema.safeParse({ ...approval, extra: true }).success, false);
  assert.equal(StrategyApprovalArtifactSchema.safeParse({
    ...approval,
    spec: { ...approval.spec, extra: true },
  }).success, false);
});

test("canonical JSON and spec hashes are stable across object key order", () => {
  const original = validSpec();
  const reordered = {
    assumptions: original.assumptions,
    costModel: { fundingBpsPerDay: 0, slippageBps: 8, spreadBps: 5, commissionBps: 10 },
    riskPolicy: { allowShort: false, maxOpenPositions: 1, maxDrawdownPercent: 12 },
    filters: original.filters,
    sizing: original.sizing,
    stop: original.stop,
    exit: original.exit,
    entry: original.entry,
    indicators: original.indicators.map((indicator) => ({
      length: indicator.length,
      source: indicator.source,
      kind: indicator.kind,
      id: indicator.id,
    })),
    thesis: original.thesis,
    timeframe: original.timeframe,
    universe: { assetClass: "crypto", symbol: "BYBIT:BTCUSDT", provider: "tradingview" },
    name: original.name,
    schemaVersion: 1,
  };

  assert.equal(canonicalJson(original), canonicalJson(reordered));
  const approval = mustIssue(original);
  const reorderedApproval = {
    proof: approval.proof,
    parentVersionId: approval.parentVersionId,
    approvedAt: approval.approvedAt,
    specHash: approval.specHash,
    spec: reordered,
    versionId: approval.versionId,
    schemaVersion: approval.schemaVersion,
  };
  assert.equal(
    verifyStrategyApproval({ telegramId: 123456, spec: reordered, approval: reorderedApproval }, secret),
    "valid",
  );
});

test("proof binds the user and every artifact-defining field", () => {
  const parentVersionId = "11111111-1111-4111-8111-111111111111";
  const approval = mustIssue(validSpec(), parentVersionId);
  const changedSpec = validSpec({ thesis: "A different, still valid hypothesis must require a new immutable version." });

  assert.equal(approval.parentVersionId, parentVersionId);
  assert.equal(verifyStrategyApproval({ telegramId: 999999, spec: approval.spec, approval }, secret), "invalid");
  assert.equal(verifyStrategyApproval({ telegramId: 123456, spec: changedSpec, approval }, secret), "invalid");
  assert.equal(verifyStrategyApproval({
    telegramId: 123456,
    spec: approval.spec,
    approval: { ...approval, versionId: "22222222-2222-4222-8222-222222222222" },
  }, secret), "invalid");
  assert.equal(verifyStrategyApproval({
    telegramId: 123456,
    spec: approval.spec,
    approval: { ...approval, specHash: "0".repeat(64) },
  }, secret), "invalid");
  assert.equal(verifyStrategyApproval({
    telegramId: 123456,
    spec: approval.spec,
    approval: { ...approval, approvedAt: "2026-07-15T12:00:00.000Z" },
  }, secret), "invalid");
  assert.equal(verifyStrategyApproval({
    telegramId: 123456,
    spec: approval.spec,
    approval: { ...approval, parentVersionId: "33333333-3333-4333-8333-333333333333" },
  }, secret), "invalid");
  assert.equal(verifyStrategyApproval({
    telegramId: 123456,
    spec: approval.spec,
    approval: { ...approval, proof: changedProof(approval.proof) },
  }, secret), "invalid");
});

test("altered or transplanted specs cannot reuse a version, hash, or proof", () => {
  const approval = mustIssue();
  const changedSpec = validSpec({
    riskPolicy: { maxDrawdownPercent: 13, maxOpenPositions: 1, allowShort: false },
  });
  const changed = mustIssue(changedSpec);

  assert.equal(verifyStrategyApproval({
    telegramId: 123456,
    spec: changedSpec,
    approval: { ...approval, spec: changedSpec },
  }, secret), "invalid");
  assert.equal(verifyStrategyApproval({
    telegramId: 123456,
    spec: changedSpec,
    approval: { ...approval, spec: changed.spec, specHash: changed.specHash },
  }, secret), "invalid");
  assert.equal(verifyStrategyApproval({
    telegramId: 123456,
    spec: approval.spec,
    approval: { ...approval, proof: changed.proof },
  }, secret), "invalid");
});

test("semantic validation and malformed inputs fail closed", () => {
  const unknownIndicator = validSpec();
  unknownIndicator.entry.rules[0].left.id = "missing";
  assert.deepEqual(
    issueStrategyApproval({ telegramId: 123456, spec: unknownIndicator }, secret),
    { ok: false, error: "invalid-input" },
  );
  assert.deepEqual(
    issueStrategyApproval({ telegramId: 0, spec: validSpec() }, secret),
    { ok: false, error: "invalid-input" },
  );
  assert.deepEqual(
    issueStrategyApproval({ telegramId: 123456, spec: validSpec(), parentVersionId: "not-a-uuid" }, secret),
    { ok: false, error: "invalid-input" },
  );

  const approval = mustIssue();
  assert.equal(verifyStrategyApproval({ telegramId: 123456, spec: unknownIndicator, approval }, secret), "invalid");
  assert.equal(verifyStrategyApproval({ telegramId: 123456, spec: validSpec(), approval: "malformed" }, secret), "invalid");
  assert.equal(verifyStrategyApproval({
    telegramId: 123456,
    spec: validSpec(),
    approval: { ...approval, proof: "malformed" },
  }, secret), "invalid");
});

test("missing or short secrets are unconfigured and fallback precedence is explicit", () => {
  assert.deepEqual(
    issueStrategyApproval({ telegramId: 123456, spec: validSpec() }, "short"),
    { ok: false, error: "unconfigured" },
  );
  assert.equal(
    verifyStrategyApproval({ telegramId: 123456, spec: validSpec(), approval: {} }, "short"),
    "unconfigured",
  );

  const names = ["STRATEGY_LAB_APPROVAL_SECRET", "STRATEGY_LAB_EVIDENCE_SECRET", "BETA_APP_SECRET"];
  const before = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  const approvalSecret = "dedicated-approval-secret-value-32-bytes";
  const evidenceSecret = "fallback-evidence-secret-value-32-bytes";
  const betaSecret = "fallback-beta-app-secret-value-32-bytes";
  try {
    process.env.STRATEGY_LAB_APPROVAL_SECRET = approvalSecret;
    process.env.STRATEGY_LAB_EVIDENCE_SECRET = evidenceSecret;
    process.env.BETA_APP_SECRET = betaSecret;
    const dedicated = issueStrategyApproval({ telegramId: 123456, spec: validSpec() });
    assert.equal(dedicated.ok, true);
    assert.equal(verifyStrategyApproval({ telegramId: 123456, spec: validSpec(), approval: dedicated.approval }, approvalSecret), "valid");
    assert.equal(verifyStrategyApproval({ telegramId: 123456, spec: validSpec(), approval: dedicated.approval }, evidenceSecret), "invalid");

    delete process.env.STRATEGY_LAB_APPROVAL_SECRET;
    const evidenceFallback = issueStrategyApproval({ telegramId: 123456, spec: validSpec() });
    assert.equal(evidenceFallback.ok, true);
    assert.equal(verifyStrategyApproval({ telegramId: 123456, spec: validSpec(), approval: evidenceFallback.approval }, evidenceSecret), "valid");

    delete process.env.STRATEGY_LAB_EVIDENCE_SECRET;
    const betaFallback = issueStrategyApproval({ telegramId: 123456, spec: validSpec() });
    assert.equal(betaFallback.ok, true);
    assert.equal(verifyStrategyApproval({ telegramId: 123456, spec: validSpec(), approval: betaFallback.approval }, betaSecret), "valid");

    process.env.STRATEGY_LAB_APPROVAL_SECRET = "short";
    assert.deepEqual(
      issueStrategyApproval({ telegramId: 123456, spec: validSpec() }),
      { ok: false, error: "unconfigured" },
    );
  } finally {
    for (const name of names) {
      if (before[name] === undefined) delete process.env[name];
      else process.env[name] = before[name];
    }
  }
});

test("deep or hostile rule ASTs fail closed without escaping as server errors", () => {
  const deepSpec = validSpec();
  let node = deepSpec.entry.rules[0];
  for (let depth = 0; depth < 1_800; depth += 1) {
    node = { kind: "all", rules: [node] };
  }
  deepSpec.entry = node;

  assert.doesNotThrow(() => issueStrategyApproval({ telegramId: 123456, spec: deepSpec }, secret));
  assert.deepEqual(
    issueStrategyApproval({ telegramId: 123456, spec: deepSpec }, secret),
    { ok: false, error: "invalid-input" },
  );

  const approval = mustIssue();
  const hostileEnvelope = { ...approval, spec: deepSpec };
  assert.deepEqual(parseStrategyApprovalArtifact(hostileEnvelope), { success: false });
  assert.equal(
    verifyStrategyApproval({ telegramId: 123456, spec: deepSpec, approval: hostileEnvelope }, secret),
    "invalid",
  );
});
