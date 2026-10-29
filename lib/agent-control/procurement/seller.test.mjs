// Run from repo root: node --test lib/agent-control/procurement/seller.test.mjs
//
// What stays free, what is sold, and everything stopping the sale.
//
// The first test is the one that matters most and it is not about x402 at all:
// the material risk facts must not appear in the paid deliverable. The
// monetisation rules name hiding a critical risk fact behind a price as never
// allowed, and the only way that stays true through later edits is a test that
// reads both lists.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  FREE_RISK_FACTS,
  FREE_RISK_FACT_IDS,
  NEVER_MONETISED,
  SELLABLE_SERVICES,
  SELLER_ENV,
  TOKEN_DEEP_REPORT,
  sellerCatalogue,
  sellerReadiness,
} from "./seller.ts";
import {
  AGENT_PROCUREMENT_CAPS,
  HUB_ENV_NAMES,
  RYNTRA_PROVIDER_ID,
  buildHubPolicy,
  buildHubState,
} from "./hub.ts";
import { FIXTURE, MAINNET, USDC_MAINNET, fixtureSellerEnv } from "./fixtures.ts";
import { splAssetRef } from "./protocol.ts";
import { resolveRegisteredResource } from "./provider-registry.ts";

/* ── Free stays free ─────────────────────────────────────────────────────── */

test("no material risk fact is sold, and each names where it is already read", () => {
  assert.ok(FREE_RISK_FACTS.length >= 7, "the free list shrank");
  for (const fact of FREE_RISK_FACTS) {
    assert.match(fact.id, /^[a-z0-9-]+$/);
    assert.ok(fact.readBy.length > 0, `${fact.id} names nowhere it is read`);
  }
  // GATE-PROVED: if a free fact's id ever appears in what the paid service
  // adds, the paid report is withholding something the free answer gave.
  const sold = `${TOKEN_DEEP_REPORT.adds.join(" ")} ${TOKEN_DEEP_REPORT.label}`.toLowerCase();
  for (const id of FREE_RISK_FACT_IDS) {
    assert.equal(sold.includes(id), false, `${id} appears in the paid deliverable`);
  }
});

test("the paid service sells no verdict and says so", () => {
  const excluded = TOKEN_DEEP_REPORT.excludes.join(" ").toLowerCase();
  assert.match(excluded, /no «safe»/);
  assert.match(excluded, /no single score/);
  assert.ok(
    TOKEN_DEEP_REPORT.excludes.some((line) => /free and stay free/i.test(line)),
    "the exclusions stopped saying the risk facts stay free",
  );
  assert.ok(NEVER_MONETISED.length >= 4);
  assert.ok(NEVER_MONETISED.some((line) => /Hiding a material risk fact/.test(line)));
});

test("there is exactly one sellable service, and it is `exact` only", () => {
  assert.equal(SELLABLE_SERVICES.length, 1);
  assert.equal(TOKEN_DEEP_REPORT.serviceId, "token-deep-report");
  // `upto` is a range, and a seller offering a range asks for an open
  // authorization.
  assert.equal(TOKEN_DEEP_REPORT.scheme, "exact");
  assert.equal(TOKEN_DEEP_REPORT.path, "/api/agents/services/token-report");
});

/* ── Readiness ───────────────────────────────────────────────────────────── */

test("with nothing set, every blocker is named at once", () => {
  const readiness = sellerReadiness(TOKEN_DEEP_REPORT, {});
  assert.equal(readiness.sellable, false);
  assert.equal(readiness.config, null);
  const codes = readiness.blockers.map((blocker) => blocker.code);
  for (const expected of [
    "NETWORK_NOT_SET_BY_OWNER",
    "PAY_TO_NOT_SET_BY_OWNER",
    "PRICE_NOT_SET_BY_OWNER",
    "FACILITATOR_NOT_SET_BY_OWNER",
    "DELIVERABLE_NOT_BUILT",
  ]) {
    assert.ok(codes.includes(expected), `${expected} is not reported`);
  }
});

test("the price is the owner's after a cost measurement, and is never invented here", () => {
  // D22. A price in this repository would be a number the first buyer inherits.
  const readiness = sellerReadiness(TOKEN_DEEP_REPORT, fixtureSellerEnv({ [SELLER_ENV.priceBaseUnits]: "" }));
  const blocker = readiness.blockers.find((entry) => entry.code === "PRICE_NOT_SET_BY_OWNER");
  assert.ok(blocker, "an unset price is not reported");
  assert.match(blocker.detail, /D22/);
});

test("a malformed recipient, price or facilitator is a blocker rather than a guess", () => {
  const cases = [
    ["PAY_TO_MALFORMED", { [SELLER_ENV.payTo]: "ryntra" }],
    ["PRICE_MALFORMED", { [SELLER_ENV.priceBaseUnits]: "0.05" }],
    ["PRICE_MALFORMED", { [SELLER_ENV.priceBaseUnits]: "0" }],
    ["FACILITATOR_UNKNOWN", { [SELLER_ENV.facilitator]: "SELF_HOSTED" }],
  ];
  for (const [code, overrides] of cases) {
    const readiness = sellerReadiness(TOKEN_DEEP_REPORT, fixtureSellerEnv(overrides));
    assert.ok(
      readiness.blockers.some((blocker) => blocker.code === code),
      `${JSON.stringify(overrides)} did not report ${code}`,
    );
  }
});

test("a facilitator that does not publish this chain is a blocker", () => {
  // PayAI publishes no devnet, so a devnet sale through it cannot be quoted.
  const readiness = sellerReadiness(TOKEN_DEEP_REPORT, fixtureSellerEnv({ [SELLER_ENV.facilitator]: "PAYAI" }));
  assert.ok(readiness.blockers.some((blocker) => blocker.code === "FACILITATOR_DOES_NOT_DECLARE_NETWORK"));
});

test("even with all four values set, the deliverable keeps the service unsellable", () => {
  // GATE-PROVED: this is the honest state today. Quoting for an answer that
  // does not exist is the paid-but-unserved case, not an edge case.
  const readiness = sellerReadiness(TOKEN_DEEP_REPORT, fixtureSellerEnv());
  assert.equal(readiness.sellable, false);
  assert.deepEqual(
    readiness.blockers.map((blocker) => blocker.code),
    ["DELIVERABLE_NOT_BUILT"],
  );
  assert.match(readiness.blockers[0].detail, /AGH-1/);
  // The configuration itself is readable, which is what lets the surface show
  // the chain, the recipient and the price the owner set.
  assert.equal(readiness.config.networkName, "devnet");
  assert.equal(readiness.config.payTo, FIXTURE.payTo);
  assert.equal(readiness.config.priceBaseUnits, "50000");
  assert.equal(readiness.config.assetSymbol, "USDC");
  assert.equal(readiness.config.decimals, 6);
});

test("the catalogue is one entry, and the environment names are stated once", () => {
  assert.equal(sellerCatalogue({}).length, 1);
  assert.equal(HUB_ENV_NAMES, SELLER_ENV);
  for (const name of Object.values(SELLER_ENV)) {
    assert.match(name, /^RYNTRA_X402_[A-Z_]+$/);
  }
  // Not one of them is a credential. The facilitator's key belongs to the
  // client this repository does not hold.
  assert.equal(Object.values(SELLER_ENV).some((name) => /KEY|SECRET|TOKEN/.test(name)), false);
});

/* ── The hub ─────────────────────────────────────────────────────────────── */

test("with nothing set the hub's registry is empty and pays nobody", () => {
  const state = buildHubState({ env: {}, origin: "https://ryntra.io" });
  assert.equal(state.registry.providers.length, 0);
  assert.ok(state.blockers.length > 0);
  assert.equal(
    resolveRegisteredResource(state.registry, "https://ryntra.io/api/agents/services/token-report").reasonCode,
    "PROVIDER_NOT_REGISTERED",
  );
});

test("once the owner sets the four values, Ryntra is the hub's first provider", () => {
  const state = buildHubState({ env: fixtureSellerEnv(), origin: "https://ryntra.io" });
  assert.equal(state.registry.providers.length, 1);
  const [provider] = state.registry.providers;
  assert.equal(provider.providerId, RYNTRA_PROVIDER_ID);
  const resolved = resolveRegisteredResource(
    state.registry,
    "https://ryntra.io/api/agents/services/token-report?mint=abc",
  );
  assert.equal(resolved.ok, true);
  assert.equal(resolved.service.priceBaseUnits, "50000");
  // The ceiling is the owner's per-call cap rather than the price.
  assert.equal(resolved.service.priceCeilingBaseUnits, AGENT_PROCUREMENT_CAPS.perCallBaseUnits);
  // And the service is still not sellable: the deliverable is AGH-1.
  assert.equal(state.ownService.sellable, false);
});

test("without a known https origin nothing can be registered", () => {
  for (const origin of [null, "ryntra.io", "http://ryntra.io", "https://ryntra.io/app"]) {
    const state = buildHubState({ env: fixtureSellerEnv(), origin });
    assert.equal(state.registry.providers.length, 0, String(origin));
    assert.ok(state.blockers.some((blocker) => blocker.code === "ORIGIN_UNKNOWN"), String(origin));
  }
});

test("the hub's policy buys only `exact`, only USDC, and each chain on its own list", () => {
  const policy = buildHubPolicy();
  assert.deepEqual([...policy.allowedSchemes], ["exact"]);
  assert.deepEqual([...policy.allowedFacilitators], ["COINBASE_CDP"]);
  assert.equal(policy.allowedAssets.length, 2);
  const mainnet = policy.allowedAssets.find((entry) => entry.network === MAINNET);
  assert.deepEqual([...mainnet.assetRefs], [splAssetRef(MAINNET, USDC_MAINNET)]);
  // A devnet entry never answers for mainnet, so the lists cannot be merged.
  assert.equal(
    policy.allowedAssets.some((entry) => entry.assetRefs.includes(splAssetRef(MAINNET, USDC_MAINNET)) && entry.network !== MAINNET),
    false,
  );
  assert.equal(policy.perCallCeilingBaseUnits, AGENT_PROCUREMENT_CAPS.perCallBaseUnits);
  assert.equal(policy.dailyCeilingBaseUnits, AGENT_PROCUREMENT_CAPS.dailyBaseUnits);
});

test("the caps are Ryntra's own and sit inside the band the review names", () => {
  // 0.01–1 USDC a call, in the owner's review. One dollar a call and ten a day
  // is the largest that band can justify; the agent's own bound is smaller.
  assert.equal(BigInt(AGENT_PROCUREMENT_CAPS.perCallBaseUnits), 1_000_000n);
  assert.equal(BigInt(AGENT_PROCUREMENT_CAPS.dailyBaseUnits), 10_000_000n);
  assert.ok(
    BigInt(AGENT_PROCUREMENT_CAPS.agentBoundBaseUnits) < BigInt(AGENT_PROCUREMENT_CAPS.perCallBaseUnits),
    "the agent's own bound is not below the per-call ceiling",
  );
});
