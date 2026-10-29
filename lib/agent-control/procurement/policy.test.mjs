// Run from repo root: node --test lib/agent-control/procurement/policy.test.mjs
//
// The order of the five stages, and every refusal each one can give.
//
// The order is the subject rather than a detail. A request can be wrong in six
// ways at once, and which wrongness is reported decides what somebody fixes: a
// URL nobody registered must not come back as «over the ceiling», and a sound
// request with no program-enforced mandate must not come back as a refusal at
// all — it is one a person signs.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  PROCUREMENT_NONCE_AGE_SECONDS,
  PROCUREMENT_REFUSALS,
  ProcurementPolicyError,
  evaluateProcurement,
} from "./policy.ts";
import { splAssetRef } from "./protocol.ts";
import {
  DEVNET,
  FIXTURE,
  FIXTURE_ORIGIN,
  MAINNET,
  USDC_DEVNET,
  USDC_MAINNET,
  fixturePolicy,
  fixtureRegistry,
  merchantPlan,
  smartAccountLimit,
  v4SpendingLimit,
} from "./fixtures.ts";

const NOW_MS = Date.parse("2026-10-26T12:00:00.000Z");

function request(overrides = {}) {
  return {
    resourceUrl: `${FIXTURE_ORIGIN}/v1/token-facts?mint=${USDC_MAINNET}`,
    scheme: "exact",
    facilitator: "COINBASE_CDP",
    network: MAINNET,
    assetRef: splAssetRef(MAINNET, USDC_MAINNET),
    mint: USDC_MAINNET,
    payTo: FIXTURE.payTo,
    quotedBaseUnits: "200000",
    capBaseUnits: null,
    maxTimeoutSeconds: 30,
    nonce: "fixture-nonce-0000000001",
    quoteIssuedAtMs: NOW_MS - 1_000,
    spender: FIXTURE.agent,
    agentBoundBaseUnits: "500000",
    ...overrides,
  };
}

function evaluate(overrides = {}, extra = {}) {
  return evaluateProcurement({
    registry: fixtureRegistry(),
    policy: fixturePolicy(),
    request: request(overrides),
    mandateRead: smartAccountLimit({}, NOW_MS),
    nonceAlreadyUsed: false,
    spentTodayBaseUnits: "0",
    nowMs: NOW_MS,
    ...extra,
  });
}

/* ── Building a policy ────────────────────────────────────────────────────── */

test("a policy states a receipt is required and that paper-only never reaches mainnet", () => {
  const policy = fixturePolicy();
  assert.equal(policy.receipt, "REQUIRED");
  assert.equal(policy.paperOnlyReachesMainnet, false);
});

test("a policy that could not bound anything refuses at build", () => {
  const cases = [
    ["POLICY_ID_MALFORMED", { id: "x" }],
    ["POLICY_SCHEME_UNKNOWN", { allowedSchemes: ["prepaid"] }],
    ["POLICY_FACILITATOR_UNKNOWN", { allowedFacilitators: ["SELF_HOSTED"] }],
    ["POLICY_NETWORK_NOT_SOLANA", { allowedAssets: [{ network: "eip155:8453", assetRefs: [] }] }],
    ["POLICY_CEILING_MALFORMED", { perCallCeilingBaseUnits: "0.5" }],
    ["POLICY_CEILING_MALFORMED", { perCallCeilingBaseUnits: "0" }],
    ["POLICY_DAILY_BELOW_PER_CALL", { dailyCeilingBaseUnits: "1" }],
    ["POLICY_NONCE_AGE_OUT_OF_RANGE", { nonceMaxAgeSeconds: 3_600 }],
    ["POLICY_NONCE_AGE_OUT_OF_RANGE", { nonceMaxAgeSeconds: 1 }],
  ];
  for (const [reasonCode, overrides] of cases) {
    assert.throws(
      () => fixturePolicy(overrides),
      (error) => error instanceof ProcurementPolicyError && error.reasonCode === reasonCode,
      `${JSON.stringify(overrides)} did not refuse with ${reasonCode}`,
    );
  }
  assert.ok(PROCUREMENT_NONCE_AGE_SECONDS.min < PROCUREMENT_NONCE_AGE_SECONDS.max);
});

/* ── Stage one: the provider ──────────────────────────────────────────────── */

test("an unregistered URL refuses at the provider stage, not at a price", () => {
  // GATE-PROVED: this request is otherwise perfect — right chain, right token,
  // under every ceiling. Only the host is somebody else's.
  const decision = evaluate({ resourceUrl: "https://pay-me-now.test/v1/anything" });
  assert.equal(decision.allowed, false);
  assert.equal(decision.stage, "PROVIDER");
  assert.equal(decision.reasonCode, "PROVIDER_NOT_REGISTERED");
});

/* ── Stage two: the route ─────────────────────────────────────────────────── */

test("a scheme, facilitator, chain or asset the owner has not allowed refuses at the route", () => {
  const cases = [
    ["SCHEME_NOT_ALLOWED_BY_POLICY", { scheme: "upto", capBaseUnits: "200000" }],
    ["FACILITATOR_NOT_ALLOWED_BY_POLICY", { facilitator: "PAYAI" }],
    ["NETWORK_NOT_ALLOWED_BY_POLICY", { network: MAINNET }, { policy: fixturePolicy({ allowedAssets: [{ network: DEVNET, assetRefs: [splAssetRef(DEVNET, USDC_DEVNET)] }] }) }],
    ["ASSET_NOT_ALLOWED_ON_NETWORK", { assetRef: splAssetRef(MAINNET, FIXTURE.otherMint) }],
  ];
  for (const [reasonCode, overrides, extra = {}] of cases) {
    const decision = evaluate(overrides, extra);
    assert.equal(decision.allowed, false, reasonCode);
    assert.equal(decision.stage, "ROUTE", reasonCode);
    assert.equal(decision.reasonCode, reasonCode, JSON.stringify(overrides));
  }
});

test("`upto` without a declared cap is refused before the policy is even consulted", () => {
  const decision = evaluate(
    { scheme: "upto", capBaseUnits: null },
    { policy: fixturePolicy({ allowedSchemes: ["exact", "upto"] }) },
  );
  assert.equal(decision.reasonCode, "UPTO_WITHOUT_CAP");
  assert.match(decision.detail, /open authorization/);
});

test("a route that does not match what the provider registered refuses", () => {
  // The chain is allowed and the asset is on its allowlist; the provider simply
  // registered this service on another chain.
  const decision = evaluate({
    network: DEVNET,
    mint: USDC_DEVNET,
    assetRef: splAssetRef(DEVNET, USDC_DEVNET),
  });
  assert.equal(decision.reasonCode, "ROUTE_DOES_NOT_MATCH_REGISTRATION");
  assert.match(decision.detail, /Oracle Labs/);
});

test("a paper-and-devnet service refuses on mainnet, at both layers", () => {
  // The fixture's second service has no audit behind it. Its devnet route is
  // allowed; its mainnet route never is — and it cannot even be registered on
  // mainnet, which is the first of the two layers.
  assert.throws(
    () =>
      fixtureRegistry([
        (() => {
          const base = fixtureRegistry().providers[0];
          const [first, second] = base.services;
          return {
            ...base,
            services: [
              first,
              { ...second, network: MAINNET, mint: USDC_MAINNET, assetRef: splAssetRef(MAINNET, USDC_MAINNET) },
            ],
          };
        })(),
      ]),
    (error) => error.reasonCode === "SERVICE_PAPER_ONLY_ON_MAINNET",
  );

  const onDevnet = evaluate({
    resourceUrl: `${FIXTURE_ORIGIN}/v1/pull-experiment`,
    network: DEVNET,
    mint: USDC_DEVNET,
    assetRef: splAssetRef(DEVNET, USDC_DEVNET),
    quotedBaseUnits: "10000",
    maxTimeoutSeconds: 20,
    payTo: FIXTURE.payTo,
  }, {
    policy: fixturePolicy({ refund: "PATH_OPTIONAL" }),
    mandateRead: smartAccountLimit({ network: DEVNET, mint: USDC_DEVNET }, NOW_MS),
  });
  assert.equal(onDevnet.allowed, true, JSON.stringify(onDevnet));

  const onMainnet = evaluate({
    resourceUrl: `${FIXTURE_ORIGIN}/v1/pull-experiment`,
    quotedBaseUnits: "10000",
    maxTimeoutSeconds: 20,
  });
  assert.equal(onMainnet.reasonCode, "PAPER_ONLY_SERVICE_ON_MAINNET");
  assert.match(onMainnet.detail, /no audit/);
});

/* ── Stage three: the price ───────────────────────────────────────────────── */

test("a quote above the registered price, or above the owner's per-call ceiling, each refuse", () => {
  assert.equal(evaluate({ quotedBaseUnits: "200001" }).reasonCode, "QUOTE_ABOVE_REGISTERED_PRICE");
  // The service's own ceiling binds the registration rather than the request:
  // a provider re-priced above it cannot be admitted at the new number, which
  // is why the quote-time comparison would never fire and is not made.
  assert.throws(
    () =>
      fixtureRegistry([
        (() => {
          const base = fixtureRegistry().providers[0];
          const [first, second] = base.services;
          return { ...base, services: [{ ...first, priceBaseUnits: "900000" }, second] };
        })(),
      ]),
    (error) => error.reasonCode === "SERVICE_CEILING_BELOW_PRICE",
  );
  // The owner's own per-call ceiling is the bound a request meets.
  assert.equal(
    evaluate({ quotedBaseUnits: "200000" }, {
      policy: fixturePolicy({ perCallCeilingBaseUnits: "150000", dailyCeilingBaseUnits: "150000" }),
    }).reasonCode,
    "QUOTE_ABOVE_PER_CALL_CEILING",
  );
});

test("the day's ceiling counts what is already spent", () => {
  const decision = evaluate({}, {
    policy: fixturePolicy({ perCallCeilingBaseUnits: "200000", dailyCeilingBaseUnits: "300000" }),
    spentTodayBaseUnits: "150000",
  });
  assert.equal(decision.reasonCode, "DAY_WOULD_EXCEED_CEILING");
  assert.match(decision.detail, /150000 is already spent today/);
});

test("an amount that is not whole base units is refused as malformed", () => {
  assert.equal(evaluate({ quotedBaseUnits: "0.2" }).reasonCode, "AMOUNT_MALFORMED");
  assert.equal(evaluate({ quotedBaseUnits: "0" }).reasonCode, "AMOUNT_MALFORMED");
  assert.equal(evaluate({}, { spentTodayBaseUnits: "1.5" }).reasonCode, "AMOUNT_MALFORMED");
});

/* ── Stage four: the request ──────────────────────────────────────────────── */

test("a timeout above the provider's own bound, or no refund path where one is required, refuses", () => {
  assert.equal(evaluate({ maxTimeoutSeconds: 31 }).reasonCode, "TIMEOUT_ABOVE_SERVICE_BOUND");
  assert.equal(evaluate({ maxTimeoutSeconds: 0 }).reasonCode, "TIMEOUT_MALFORMED");
  // The fixture's paper-only service declares no refund path, so a policy that
  // requires one cannot buy it even on devnet.
  const decision = evaluate({
    resourceUrl: `${FIXTURE_ORIGIN}/v1/pull-experiment`,
    network: DEVNET,
    mint: USDC_DEVNET,
    assetRef: splAssetRef(DEVNET, USDC_DEVNET),
    quotedBaseUnits: "10000",
    maxTimeoutSeconds: 20,
  });
  assert.equal(decision.reasonCode, "REFUND_PATH_REQUIRED");
});

test("a stale quote, a quote from the future and a spent quote each refuse", () => {
  assert.equal(evaluate({ nonce: "short" }).reasonCode, "NONCE_MALFORMED");
  assert.equal(evaluate({ quoteIssuedAtMs: NOW_MS + 1 }).reasonCode, "NONCE_STALE");
  assert.equal(evaluate({ quoteIssuedAtMs: NOW_MS - 61_000 }).reasonCode, "NONCE_STALE");
  const spent = evaluate({}, { nonceAlreadyUsed: true });
  assert.equal(spent.reasonCode, "NONCE_ALREADY_USED");
  assert.match(spent.detail, /one payment is never two purchases/);
});

/* ── Stage five: who authorizes ───────────────────────────────────────────── */

test("a sound request with a sound mandate is authorized, and says who authorized it", () => {
  const decision = evaluate();
  assert.equal(decision.allowed, true, JSON.stringify(decision));
  assert.equal(decision.stage, "AUTHORIZED");
  assert.equal(decision.authorization, "AGENT_ALONE");
  assert.equal(decision.provider.providerId, "oracle-labs");
  assert.equal(decision.amountBaseUnits, "200000");
  assert.ok(decision.limitations.some((line) => /not a payment/i.test(line)));
});

test("above the agent's bound the decision is allowed and a person confirms", () => {
  // Not a refusal: the mandate is sound and the action is simply larger.
  const decision = evaluate({ quotedBaseUnits: "200000", agentBoundBaseUnits: "100000" });
  assert.equal(decision.allowed, true);
  assert.equal(decision.authorization, "HUMAN_CONFIRMATION");
});

test("a mandate the program cannot bound refuses last, after every other check passed", () => {
  const decision = evaluate({}, { mandateRead: v4SpendingLimit(NOW_MS) });
  assert.equal(decision.allowed, false);
  assert.equal(decision.stage, "MANDATE");
  assert.equal(decision.reasonCode, "PROGRAM_HOLDS_NO_EXPIRY");
});

test("a merchant plan authorizes the same request", () => {
  const decision = evaluate({}, { mandateRead: merchantPlan({}, NOW_MS) });
  assert.equal(decision.allowed, true);
  assert.equal(decision.mandate.kind, "SUBSCRIPTIONS_MERCHANT_PLAN");
});

test("every refusal this module can produce is in its own list", () => {
  const unique = new Set(PROCUREMENT_REFUSALS);
  assert.equal(unique.size, PROCUREMENT_REFUSALS.length);
});
