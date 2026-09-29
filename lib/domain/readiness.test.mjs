// Run from repo root: node --test lib/domain/readiness.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateReadiness,
  MIN_THESIS_LENGTH,
  DEFAULT_READINESS_POLICY,
  PLANNED_TRADE_POLICY,
  SPOT_SWAP_POLICY,
} from "./readiness.ts";
import { claimFor } from "./registry.ts";

const state = (over = {}) => ({
  protocol: "live",
  ryntra: "live",
  user: "available",
  verifiedAt: "2026-07-12",
  source: "live-probe",
  ...over,
});

/** Structurally bound claim (the sanctioned shape); tests override state to model registries. */
const claim = (route = "arcus-spot-rfq", over = {}) => ({ route, state: state(over) });

const plan = (over = {}) => ({
  thesis: "breakout retest with tight invalidation",
  entry: "100",
  stop: "97",
  invalidation: "close below 97 on 1h",
  targets: ["106"],
  riskPct: 1,
  ...over,
});

const signal = (over = {}) => ({
  id: "oracle-freshness",
  label: "Oracle freshness",
  state: "fresh",
  value: 12,
  severity: "info",
  source: "chainlink:0xfeed",
  observedAt: 1_000_000,
  ...over,
});

const compliance = (over = {}) => ({
  status: "allowed",
  source: "arcus-compliance-api",
  checkedAt: 1_000_000,
  ...over,
});

const intent = (over = {}) => ({
  kind: "spot-swap",
  route: "arcus-spot-rfq",
  instrument: { chain: "robinhood-chain", kind: "spot-tokenized-equity", base: "NVDA", quote: "USDG" },
  side: "buy",
  size: "1",
  limitPrice: null,
  executionMode: "wallet-signed",
  idempotencyKey: "k-1",
  createdAt: 1_000_000,
  ...over,
});

const base = (over = {}) => ({
  capability: claim(),
  signals: [signal()],
  plan: plan(),
  compliance: compliance(),
  intent: intent(),
  ...over,
});

test("happy path: valid Arcus route, fresh signals, allowed compliance, full plan → ready", () => {
  assert.deepEqual(evaluateReadiness(base()), { level: "ready", reasons: [] });
});

test("determinism: same input object → identical verdict every time", () => {
  const input = base();
  assert.deepEqual(evaluateReadiness(input), evaluateReadiness(input));
});

/* ---------- BINDING: unbypassable route/capability pairing ---------- */

test("BINDING: Uniswap intent + Arcus live capability → not-ready (mismatch)", () => {
  const v = evaluateReadiness(base({ intent: intent({ route: "uniswap-rhchain-amm" }) }));
  assert.equal(v.level, "not-ready");
  assert.ok(v.reasons.includes("route-capability-mismatch"));
});

test("BINDING: route omitted via runtime cast → not-ready (unknown-route), never ready", () => {
  const v = evaluateReadiness(base({ capability: { state: state() } })); // no route field, cast-style
  assert.equal(v.level, "not-ready");
  assert.ok(v.reasons.includes("unknown-route"));
});

test("BINDING: route unknown to the registry → not-ready", () => {
  const v = evaluateReadiness(base({ capability: { route: "definitely-not-a-route", state: state() }, intent: intent({ route: "definitely-not-a-route" }) }));
  assert.equal(v.level, "not-ready");
  assert.ok(v.reasons.includes("unknown-route"));
});

test("BINDING: instrument chain must match the route's chain", () => {
  const foreign = intent({ instrument: { chain: "hypercore", kind: "crypto-perp", base: "BTC", quote: "USDC" } });
  const v = evaluateReadiness(base({ intent: foreign }));
  assert.equal(v.level, "not-ready");
  assert.ok(v.reasons.includes("instrument-chain-mismatch"));
});

test("BINDING: null/undefined capability state on a LIVE intent blocks — never skips the checks", () => {
  for (const stateVal of [null, undefined]) {
    const v = evaluateReadiness(base({ capability: { route: "arcus-spot-rfq", state: stateVal } }));
    assert.equal(v.level, "not-ready", `state=${stateVal} must block a live intent`);
    assert.ok(v.reasons.includes("missing-capability-state"));
  }
  // paper practice is not authorized-execution — a missing state doesn't block it
  const paper = evaluateReadiness(
    base({ capability: { route: "arcus-spot-rfq", state: state() }, intent: intent({ kind: "paper-order" }) })
  );
  assert.equal(paper.level, "ready");
});

test("BINDING: prototype-name routes (toString/constructor/hasOwnProperty) are unknown, not known", () => {
  for (const proto of ["toString", "constructor", "hasOwnProperty", "valueOf"]) {
    const v = evaluateReadiness(
      base({
        capability: { route: proto, state: state() },
        intent: intent({ route: proto, instrument: { chain: undefined, kind: "spot-crypto", base: "X", quote: "Y" } }),
      })
    );
    assert.equal(v.level, "not-ready", `route="${proto}" must be unknown`);
    assert.ok(v.reasons.includes("unknown-route"), `route="${proto}" missing unknown-route`);
  }
});

test("BINDING: a fabricated live state for a route the registry holds read-only/planned blocks", () => {
  // registry truth: arcus-perps-clob is read-only — a hand-built live claim must not authorize
  const fabricated = {
    route: "arcus-perps-clob",
    state: state(), // protocol live / ryntra live / source live-probe — NOT what the registry says
  };
  const liveIntent = intent({ kind: "perp-order", route: "arcus-perps-clob" });
  const v = evaluateReadiness(base({ capability: fabricated, intent: liveIntent }));
  assert.equal(v.level, "not-ready");
  assert.ok(v.reasons.includes("capability-state-mismatch"));
  // and the honest registry claim for the same route still blocks live execution (read-only)
  const honest = evaluateReadiness(base({ capability: claimFor("arcus-perps-clob"), intent: liveIntent }));
  assert.equal(honest.level, "not-ready");
  assert.ok(honest.reasons.includes("route-not-live-on-ryntra"));
  // per-user refinement of `user` on an otherwise registry-true claim is allowed (not a mismatch)
  const refined = evaluateReadiness(base({ capability: claim("arcus-spot-rfq", { user: "available" }) }));
  assert.ok(!refined.reasons.includes("capability-state-mismatch"));
});

test("BINDING: claimFor(route) from the registry is the sanctioned pairing and passes binding", () => {
  const c = claimFor("arcus-spot-rfq");
  assert.equal(c.route, "arcus-spot-rfq");
  const v = evaluateReadiness(base({ capability: c }));
  // registry truth says user is unknown per-user → caution, но binding itself passes
  assert.notEqual(v.level, "not-ready");
  assert.ok(!v.reasons.includes("route-capability-mismatch"));
  assert.ok(!v.reasons.includes("unknown-route"));
});

test("BINDING: paper intent on a planned venue route is fine when claim matches", () => {
  const paper = intent({
    kind: "paper-order",
    route: "hyperliquid-perps-clob",
    instrument: { chain: "hypercore", kind: "crypto-perp", base: "BTC", quote: "USDC" },
  });
  const v = evaluateReadiness(base({ capability: claim("hyperliquid-perps-clob", { ryntra: "planned" }), intent: paper }));
  assert.equal(v.level, "ready"); // paper never touches the venue; binding + discipline satisfied
});

/* ---------- capability truth for live intents ---------- */

test("INVARIANT: blocked compliance → not-ready; unknown compliance can never be ready", () => {
  const blocked = evaluateReadiness(base({ compliance: compliance({ status: "blocked" }) }));
  assert.equal(blocked.level, "not-ready");
  assert.ok(blocked.reasons.includes("compliance-blocked"));

  const unknown = evaluateReadiness(base({ compliance: compliance({ status: "unknown", source: "unverified" }) }));
  assert.equal(unknown.level, "caution");
  assert.ok(unknown.reasons.includes("compliance-unknown"));
});

test("INVARIANT: live intent on read-only / paper / planned / blocked route → not-ready", () => {
  for (const ryntra of ["read-only", "paper", "planned", "blocked"]) {
    const v = evaluateReadiness(base({ capability: claim("arcus-spot-rfq", { ryntra }) }));
    assert.equal(v.level, "not-ready", `ryntra=${ryntra} must not allow a live intent`);
    assert.ok(v.reasons.includes("route-not-live-on-ryntra"));
  }
});

test("INVARIANT: unverified capability source can never authorize a live intent; paper unaffected", () => {
  const v = evaluateReadiness(base({ capability: claim("arcus-spot-rfq", { source: "unverified" }) }));
  assert.equal(v.level, "not-ready");
  assert.ok(v.reasons.includes("capability-unverified"));
  const paper = evaluateReadiness(
    base({ capability: claim("arcus-spot-rfq", { source: "unverified" }), intent: intent({ kind: "paper-order" }) })
  );
  assert.equal(paper.level, "ready");
});

test("user restricted → not-ready; user unknown → at most caution", () => {
  const restricted = evaluateReadiness(base({ capability: claim("arcus-spot-rfq", { user: "restricted" }) }));
  assert.equal(restricted.level, "not-ready");
  assert.ok(restricted.reasons.includes("user-restricted"));

  const unknownUser = evaluateReadiness(base({ capability: claim("arcus-spot-rfq", { user: "unknown" }) }));
  assert.equal(unknownUser.level, "caution");
  assert.ok(unknownUser.reasons.includes("user-access-unknown"));
});

/* ---------- signals ---------- */

test("INVARIANT: any stale/unknown/conflicting signal caps the verdict below ready", () => {
  for (const st of ["stale", "unknown", "conflicting"]) {
    const v = evaluateReadiness(base({ signals: [signal({ state: st })] }));
    assert.notEqual(v.level, "ready", `signal state ${st} must not be ready`);
    assert.ok(v.reasons.includes(`signal-${st}:oracle-freshness`));
  }
});

test("blocker signal → not-ready regardless of everything else", () => {
  const v = evaluateReadiness(base({ signals: [signal({ severity: "blocker", id: "oracle-paused" })] }));
  assert.equal(v.level, "not-ready");
  assert.ok(v.reasons.includes("signal-blocker:oracle-paused"));
});

/* ---------- discipline policies ---------- */

test("PLANNED_TRADE_POLICY: missing stop or thin thesis → not-ready", () => {
  const noStop = evaluateReadiness(base({ plan: plan({ stop: null }) }), PLANNED_TRADE_POLICY);
  assert.equal(noStop.level, "not-ready");
  assert.ok(noStop.reasons.includes("missing-stop"));

  const thin = evaluateReadiness(base({ plan: plan({ thesis: "up only" }) }), PLANNED_TRADE_POLICY);
  assert.equal(thin.level, "not-ready");
  assert.ok(thin.reasons.includes("missing-thesis"));
  assert.ok("up only".length < MIN_THESIS_LENGTH);
  assert.equal(DEFAULT_READINESS_POLICY, PLANNED_TRADE_POLICY); // full discipline is the default
});

test("SPOT_SWAP_POLICY: a plain conversion needs no thesis/stop, but capability/compliance still gate", () => {
  const swap = evaluateReadiness(
    base({ plan: plan({ thesis: "", stop: null, riskPct: null }) }),
    SPOT_SWAP_POLICY
  );
  assert.equal(swap.level, "ready");
  // compliance still kills a swap
  const blocked = evaluateReadiness(
    base({ plan: plan({ thesis: "", stop: null, riskPct: null }), compliance: compliance({ status: "blocked" }) }),
    SPOT_SWAP_POLICY
  );
  assert.equal(blocked.level, "not-ready");
});

/* ---------- risk & policy validation ---------- */

test("INVARIANT: NaN / Infinity / negative / zero risk can never be ready", () => {
  for (const bad of [NaN, Infinity, -Infinity, -1, 0]) {
    const v = evaluateReadiness(base({ plan: plan({ riskPct: bad }) }));
    assert.equal(v.level, "not-ready", `riskPct=${bad} must block`);
    assert.ok(v.reasons.includes("invalid-risk"));
  }
});

test("INVARIANT: an invalid max policy (NaN/negative/zero) can never yield ready", () => {
  for (const bad of [NaN, -1, 0, Infinity]) {
    const v = evaluateReadiness(base(), { maxRiskPct: bad, requiresThesis: true, requiresStop: true });
    if (bad === Infinity) {
      // Infinity is non-finite → invalid-policy too (a cap that never caps is not a cap)
      assert.equal(v.level, "not-ready", "Infinity cap must be rejected");
    } else {
      assert.equal(v.level, "not-ready", `maxRiskPct=${bad} must block`);
    }
    assert.ok(v.reasons.includes("invalid-policy"));
  }
});

test("risk above policy cap → not-ready; a custom valid policy is respected", () => {
  const over = evaluateReadiness(base({ plan: plan({ riskPct: DEFAULT_READINESS_POLICY.maxRiskPct + 0.5 }) }));
  assert.equal(over.level, "not-ready");
  assert.ok(over.reasons.includes("risk-above-policy"));
  const custom = evaluateReadiness(base({ plan: plan({ riskPct: 4 }) }), { maxRiskPct: 5, requiresThesis: true, requiresStop: true });
  assert.equal(custom.level, "ready");
});

test("planning-only record (no intent yet) still evaluates the plan and signals", () => {
  const v = evaluateReadiness(base({ intent: null }));
  assert.equal(v.level, "ready");
  const noStop = evaluateReadiness(base({ intent: null, plan: plan({ stop: null }) }));
  assert.equal(noStop.level, "not-ready");
});
