// Run from repo root: node --test lib/product/capabilities.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { ROUTES } from "../domain/ids.ts";
import { ROUTE_CAPABILITIES } from "../domain/registry.ts";
import {
  readRialtoDirectRoutePin,
  readRialtoExecutionTokenMetadata,
} from "../arcus/spot-exec-policy.ts";
import { USDG_ADDRESS } from "../arcus/spot.ts";
import {
  CAPABILITY_MATURITIES,
  PUBLIC_CAPABILITIES,
  getCapabilityFreshness,
  getCapabilityTruthTone,
  getPublicCapabilitiesForSurface,
  productCapabilityById,
} from "./capabilities.ts";

/* Derived from the registry rather than typed. A fixed clock here means every
   re-verification silently dates the registry into this test's future, and a
   claim verified after "now" reads as conflicting — which is correct behaviour
   and a useless test failure. */
const TASK_NOW = new Date(`${productCapabilityById("arcus-spot-rfq").lastVerifiedAt}T12:00:00.000Z`);
const ARCUS_SPOT_EXECUTION_TOKENS = [
  "0x322F0929c4625eD5bAd873c95208D54E1c003b2d",
  "0xAf3D76f1834a1D425780943c99Ea8a608F8A93f9",
  "0x86923F96303d656e4aa86D9d42d1e57ad2023fdc",
];

test("registry has stable unique IDs and a complete machine-readable contract", () => {
  assert.deepEqual(CAPABILITY_MATURITIES, ["live", "testnet", "paper", "preview", "planned", "after_gate"]);
  assert.ok(PUBLIC_CAPABILITIES.length >= 15);

  const ids = new Set();
  for (const capability of PUBLIC_CAPABILITIES) {
    assert.equal(ids.has(capability.id), false, `duplicate capability id: ${capability.id}`);
    ids.add(capability.id);
    assert.ok(CAPABILITY_MATURITIES.includes(capability.maturity), `${capability.id}: maturity`);
    assert.ok(["none", "read_only", "paper_only", "testnet_execution", "supported_live"].includes(capability.mode), `${capability.id}: mode`);
    /* A chain pack has no venue by nature — a direct-EOA transfer calls the
       token contract with nobody in between — so scope is satisfied by a venue
       OR by a chain provider. Requiring a venue here would have forced a chain
       pack to name one it does not use. */
    assert.ok(
      capability.scope.venues.length > 0 || capability.scope.provider?.kind === "chain",
      `${capability.id}: venue or chain scope`,
    );
    assert.ok(capability.scope.assets.length > 0, `${capability.id}: asset scope`);
    assert.ok(capability.evidence.internal.length > 0, `${capability.id}: internal evidence`);
    assert.match(capability.lastVerifiedAt, /^\d{4}-\d{2}-\d{2}$/, `${capability.id}: verification date`);
    assert.equal(capability.freshness.policy, "rolling_review");
    assert.ok(capability.freshness.maxAgeDays > 0, `${capability.id}: freshness window`);
    assert.ok(["fresh", "stale", "unknown", "conflicting"].includes(capability.freshness.state));
    assert.ok(capability.publicLabel.length >= 3, `${capability.id}: public label`);
    assert.ok(capability.limitation.length >= 50, `${capability.id}: limitation`);
    assert.ok(capability.failClosed.on.length > 0, `${capability.id}: fail-closed triggers`);
    assert.ok(capability.failClosed.behavior.length >= 20, `${capability.id}: fail-closed behavior`);
    assert.ok(capability.failClosed.recovery.length >= 20, `${capability.id}: recovery`);
    assert.equal(capability.authority.withdrawalAuthority, false, `${capability.id}: no withdrawals`);
    assert.ok(capability.publicSurfaces.includes("methodology"), `${capability.id}: methodology disclosure`);
  }
});

test("maturity and operating mode cannot promote non-live work", () => {
  const liveExecution = [];
  for (const capability of PUBLIC_CAPABILITIES) {
    if (capability.maturity !== "live") {
      assert.notEqual(capability.mode, "supported_live", `${capability.id}: non-live execution`);
      assert.doesNotMatch(capability.publicLabel, /\blive\b/i, `${capability.id}: non-live label`);
    }
    if (capability.mode === "supported_live") liveExecution.push(capability.id);
    if (capability.maturity === "paper") assert.equal(capability.mode, "paper_only");
  }
  assert.deepEqual(liveExecution, ["arcus-spot-rfq"]);
});

test("route-bound claims match the domain route registry and exact provider", () => {
  for (const capability of PUBLIC_CAPABILITIES) {
    const routeId = capability.scope.route;
    if (!routeId) continue;
    const route = ROUTES[routeId];
    const claim = ROUTE_CAPABILITIES[routeId];
    assert.ok(route, `${capability.id}: unknown route`);
    assert.ok(claim, `${capability.id}: missing route capability`);
    assert.ok(capability.scope.provider, `${capability.id}: route provider`);
    if (route.executor.kind === "venue") {
      assert.equal(capability.scope.provider.kind, "venue");
      assert.equal(capability.scope.provider.id, route.executor.venue);
    } else {
      assert.equal(capability.scope.provider.kind, "protocol");
      assert.equal(capability.scope.provider.id, route.executor.protocol);
    }
  }

  const spot = productCapabilityById("arcus-spot-rfq");
  assert.equal(spot.scope.route, "arcus-spot-rfq");
  assert.equal(ROUTE_CAPABILITIES[spot.scope.route].ryntra, "live");
  assert.equal(ROUTE_CAPABILITIES[spot.scope.route].protocol, "live");
  const executionSymbols = ARCUS_SPOT_EXECUTION_TOKENS.map((token) => {
    const metadata = readRialtoExecutionTokenMetadata(token);
    assert.ok(metadata, token);
    assert.ok(readRialtoDirectRoutePin(USDG_ADDRESS, token), metadata.symbol + " buy route");
    assert.ok(readRialtoDirectRoutePin(token, USDG_ADDRESS), metadata.symbol + " sell route");
    return `USDG↔${metadata.symbol}`;
  });
  assert.deepEqual(spot.scope.assets, executionSymbols);

  const account = productCapabilityById("arcus-account-read");
  assert.equal(account.scope.route, "arcus-perps-clob");
  assert.equal(ROUTE_CAPABILITIES[account.scope.route].ryntra, "read-only");
});

test("freshness and the sanctioned tone fail closed", () => {
  const spot = productCapabilityById("arcus-spot-rfq");
  assert.equal(getCapabilityFreshness(spot, TASK_NOW), "fresh");
  assert.equal(getCapabilityTruthTone(spot, TASK_NOW), "caution", "unknown user is never green");
  assert.equal(getCapabilityTruthTone(spot, TASK_NOW, "available"), "positive");
  assert.equal(getCapabilityTruthTone(spot, TASK_NOW, "restricted"), "danger");

  const afterWindow = new Date(TASK_NOW.getTime() + 44 * 24 * 60 * 60 * 1000);
  assert.equal(getCapabilityFreshness(spot, afterWindow), "stale");
  assert.equal(getCapabilityTruthTone(spot, afterWindow, "available"), "caution");

  const rwa = productCapabilityById("rwa-risk-pack");
  for (const state of ["stale", "unknown", "conflicting"]) {
    const changed = { ...rwa, freshness: { ...rwa.freshness, state } };
    assert.notEqual(getCapabilityTruthTone(changed, TASK_NOW), "positive", `${state} rendered positive`);
  }

  const wrongProvider = {
    ...spot,
    scope: {
      ...spot.scope,
      provider: { kind: "venue", id: "hyperliquid", label: "Hyperliquid" },
    },
  };
  assert.equal(getCapabilityFreshness(wrongProvider, TASK_NOW), "conflicting");
});

test("full loop and gated capabilities remain explicitly unshipped", () => {
  const loop = productCapabilityById("complete-decision-loop");
  assert.equal(loop.maturity, "planned");
  assert.equal(loop.mode, "none");
  assert.match(loop.publicLabel, /not shipped/i);
  assert.match(loop.limitation, /StrategySpec.*readiness.*DecisionReceipt.*ReviewRecord/i);
  assert.equal(productCapabilityById("strategy-lab-v1").maturity, "preview");
  assert.equal(productCapabilityById("guarded-automation").maturity, "after_gate");
  assert.equal(productCapabilityById("pro-order-flow").maturity, "after_gate");
  assert.equal(productCapabilityById("sequencer-monitoring").maturity, "after_gate");
});

test("authority and custody boundaries are explicit", () => {
  const liveExecution = productCapabilityById("arcus-spot-rfq");
  assert.equal(liveExecution.authority.authorization, "wallet_signature");
  assert.equal(liveExecution.authority.custody, "non_custodial");
  assert.ok(liveExecution.failClosed.on.includes("authorization_missing"));

  const accountRead = productCapabilityById("arcus-account-read");
  assert.equal(accountRead.authority.authorization, "none");
  assert.equal(accountRead.authority.custody, "not_applicable");
  assert.equal(accountRead.failClosed.on.includes("authorization_missing"), false);
  assert.match(accountRead.failClosed.recovery, /public wallet address/i);

  const uniswap = productCapabilityById("uniswap-quote-comparison");
  assert.equal(uniswap.maturity, "live");
  assert.equal(uniswap.mode, "read_only");
  assert.equal(uniswap.scope.route, "uniswap-rhchain-amm");
  assert.equal(uniswap.scope.provider?.id, "uniswap");
  assert.match(uniswap.limitation, /no Uniswap route selection or execution is shipped/i);

  const portfolio = productCapabilityById("portfolio-heat");
  assert.equal(portfolio.maturity, "live");
  assert.equal(portfolio.mode, "read_only");
  assert.match(portfolio.limitation, /supported Stock Token holdings/i);
  assert.equal(productCapabilityById("complete-portfolio-risk").maturity, "planned");

  const automation = productCapabilityById("guarded-automation");
  assert.equal(automation.authority.authorization, "future_scoped_mandate");
  assert.equal(automation.authority.withdrawalAuthority, false);
  assert.match(automation.limitation, /not shipped/i);
});

test("public surfaces are curated from the registry", () => {
  const landing = getPublicCapabilitiesForSurface("landing").map((item) => item.id);
  assert.ok(landing.includes("supported-route-readiness"));
  assert.ok(landing.includes("complete-decision-loop"));
  assert.ok(landing.includes("arcus-spot-rfq"));
  assert.equal(landing.includes("guarded-automation"), false);
  assert.deepEqual(getPublicCapabilitiesForSurface("methodology"), PUBLIC_CAPABILITIES);
});

test("Agent Control registry separates source previews from every external gate", () => {
  const rows = getPublicCapabilitiesForSurface("agent_control");
  assert.deepEqual(
    rows.map((row) => row.id),
    [
      "agent-control-intent",
      "agent-control-preflight",
      "agent-decision-passport-preview",
      "agent-launch-public-read",
      "bnb-apex-read-observer",
      "agentverse-public-passport",
      "agentverse-discovery",
      "bnb-agent-job-lifecycle",
    ],
  );

  for (const id of [
    "agent-control-intent",
    "agent-control-preflight",
    "agent-decision-passport-preview",
    "agent-launch-public-read",
    "bnb-apex-read-observer",
    "agentverse-public-passport",
  ]) {
    const row = productCapabilityById(id);
    assert.equal(row.maturity, "preview", id);
    assert.notEqual(row.mode, "testnet_execution", id);
  }

  for (const id of [
    "agentverse-discovery",
    "bnb-agent-job-lifecycle",
  ]) {
    const row = productCapabilityById(id);
    assert.equal(row.maturity, "planned", id);
    assert.equal(row.mode, "none", id);
  }

  const agentversePassport = productCapabilityById("agentverse-public-passport");
  assert.equal(agentversePassport.scope.provider?.kind, "platform");
  assert.equal(agentversePassport.scope.provider?.id, "agentverse");
  assert.match(agentversePassport.limitation, /does not .*prove liveness/i);
  assert.match(productCapabilityById("bnb-agent-job-lifecycle").limitation, /no Ryntra .*job/i);
  assert.equal(rows.some((row) => ["live", "testnet"].includes(row.maturity)), false);
});

test("public evidence never leaks repository paths or secret material", () => {
  const publicInternalPath = /(?:^|\/)(?:app|lib|docs|scripts|output)\//i;
  const secretMaterial = /BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|\bsk-[A-Za-z0-9_-]{12,}|(?:api[_-]?key|secret|token)\s*[:=]\s*\S+/i;
  for (const capability of PUBLIC_CAPABILITIES) {
    const evidenceIds = new Set();
    for (const evidence of [...capability.evidence.public, ...capability.evidence.internal]) {
      assert.equal(evidenceIds.has(evidence.id), false, `${capability.id}: duplicate evidence id ${evidence.id}`);
      evidenceIds.add(evidence.id);
      assert.doesNotMatch(evidence.reference, secretMaterial, `${capability.id}: secret-like evidence`);
    }
    for (const evidence of capability.evidence.public) {
      assert.match(evidence.reference, /^(?:\/|https:\/\/)/, `${capability.id}: public reference form`);
      assert.doesNotMatch(evidence.reference, publicInternalPath, `${capability.id}: internal public reference`);
    }
    for (const evidence of capability.evidence.internal) {
      assert.doesNotMatch(evidence.reference, /app\/config\/features|lib\/domain\/registry/i,
        `${capability.id}: flags and provider capability state are bindings, not evidence`);
    }
  }
});
