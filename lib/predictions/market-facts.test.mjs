// Run from repo root: node --test lib/predictions/market-facts.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import { ACCOUNT_VENUES, GUEST_ACCESS, marketAccess, openVenueCount, venueAccess } from "./access.ts";
import { RYNTRA_BUY_FEE_BIPS, leastCostOf, payoutEstimate, reviewCosts, ryntraFeeUsd } from "./costs.ts";
import { mapCosts, mapEventSummary, mapRoute } from "./model.ts";
import { settlementKind, settlementPoints } from "./settlement.ts";

/* A route as the provider answered on the stand: two venues, a fee breakdown, each venue's own quote. */
function rawRoute(overrides = {}) {
  return {
    quoteId: "q1",
    venueMarketOutcomeId: "o-yes",
    venueMarketId: "m1",
    estimatedCostRaw: "10000000",
    expiresAt: "2026-10-14T12:01:00.000Z",
    refreshAt: "2026-10-14T12:00:30.000Z",
    status: "ok",
    fills: [
      { venue: "polymarket", chain: "polygon", avgPrice: 0.5, venueQty: 12, venueFee: 0.06, builderFee: 0.01, settlementFee: 0 },
      { venue: "limitless", chain: "base", avgPrice: 0.52, venueQty: 7, venueFee: 0.04, builderFee: 0, settlementFee: 0 },
    ],
    totalFilled: 19,
    rawExecCost: 9.64,
    solveTimeMs: 5,
    verifyTimeMs: 1,
    matchedMarkets: [],
    totalCostIncFees: 9.85,
    estimatedPayout: 19,
    estimatedProfit: 9.15,
    returnPct: 92.9,
    feeBreakdown: { rawExecCost: 9.64, venueFees: 0.1, builderFee: 0.01, bridgeFees: 0.06, executionGas: 0.04, totalCost: 9.85 },
    venueSoloQuotes: [
      { quoteId: "s1", venue: "polymarket", avgPrice: 0.53, filledQty: 19.5, rawExecCost: 10.35, estimatedPayout: 19.5, estimatedProfit: 9.15, returnPct: 88, status: "ok", fills: [{ venue: "polymarket", avgPrice: 0.53, venueQty: 19.5, fills: [{ price: 0.52, size: 10, fill: 10 }, { price: 0.54, size: 40, fill: 9.5 }] }], feeBreakdown: { rawExecCost: 10.35, venueFees: 0.12, bridgeFees: 0, executionGas: 0.03, totalCost: 10.5 } },
      { quoteId: null, venue: "kalshi", avgPrice: null, filledQty: 0, rawExecCost: 0, estimatedPayout: 0, estimatedProfit: 0, returnPct: 0, status: "venue_unavailable", fills: [], unavailableReason: "Venue key required" },
    ],
    warnings: [{ venue: "kalshi", venueMarketOutcomeId: "o-k", reason: "Venue key required" }],
    ...overrides,
  };
}

test("the route keeps the provider's cost breakdown and each venue's own quote", () => {
  const route = mapRoute(rawRoute(), "buy", 10, "2026-10-14T12:00:00.000Z");
  assert.deepEqual(route.costs, { contractsUsd: 9.64, venueFeesUsd: 0.1, builderFeeUsd: 0.01, bridgeUsd: 0.06, gasUsd: 0.04, appFeeUsd: null, appFeeBips: null, referralUsd: null, setupUsd: null, totalUsd: 9.85 });
  assert.equal(route.solos.length, 2);
  assert.deepEqual(route.solos[0], { venue: "polymarket", status: "ok", shares: 19.5, avgPrice: 0.53, directCostUsd: 10.5, unavailableReason: null, levels: [{ price: 0.52, qty: 10 }, { price: 0.54, qty: 9.5 }] });
  assert.equal(route.solos[1].unavailableReason, "Venue key required");
  assert.equal(mapCosts(undefined), null);
  assert.equal(mapRoute(rawRoute({ feeBreakdown: undefined }), "buy", 10, "2026-10-14T12:00:00.000Z").costs, null);
});

test("the Review states every cost line, Ryntra's 0.3% at its own rate when the provider charged none", () => {
  const route = mapRoute(rawRoute(), "buy", 10, "2026-10-14T12:00:00.000Z");
  const costs = reviewCosts(route);
  assert.deepEqual(costs.lines.map((l) => l.id), ["contracts", "venue", "ryntra", "gas", "bridge"]);
  assert.equal(costs.lines.find((l) => l.id === "venue").usd, 0.11);
  assert.equal(costs.ryntra.bips, RYNTRA_BUY_FEE_BIPS);
  assert.equal(costs.ryntra.usd, 0.02892);
  assert.equal(costs.ryntra.charged, false);
  /* The total is what the order takes: the provider's own total; the uncharged fee is stated, not added. */
  assert.equal(costs.totalUsd, 9.85);
  assert.equal(reviewCosts({ ...route, side: "sell" }), null);
});

test("when the provider charges the partner fee, its figure is Ryntra's line and the total already holds it", () => {
  const raw = rawRoute({ totalCostIncFees: 9.879, feeBreakdown: { ...rawRoute().feeBreakdown, appFee: 0.029, appFeeBips: 30 }, appFee: { bips: 30, categoryKey: "all", quotedAppFeeRaw: "29000" } });
  const costs = reviewCosts(mapRoute(raw, "buy", 10, "2026-10-14T12:00:00.000Z"));
  assert.deepEqual(costs.ryntra, { bips: 30, usd: 0.029, charged: true });
  assert.equal(costs.totalUsd, 9.879);
});

test("a line the route does not state is null, never zero", () => {
  const costs = reviewCosts(mapRoute(rawRoute({ feeBreakdown: undefined }), "buy", 10, "2026-10-14T12:00:00.000Z"));
  assert.equal(costs.lines.find((l) => l.id === "gas").usd, null);
  assert.equal(costs.lines.find((l) => l.id === "bridge").usd, null);
  assert.equal(costs.lines.find((l) => l.id === "venue").usd, 0.11);
});

test("the saving line is drawn only when the route beats the least the same contracts cost on one venue alone", () => {
  /* Route: 19 contracts for 9.85 + 0.0289 uncharged fee = 9.8789. Polymarket alone, its own levels cheapest first: 10 × 0.52 + 9 × 0.54 = 10.06. */
  const route = mapRoute(rawRoute(), "buy", 10, "2026-10-14T12:00:00.000Z");
  const saving = reviewCosts(route).saving;
  assert.equal(saving.venue, "polymarket");
  assert.equal(saving.venueCostUsd, 10.06);
  assert.equal(saving.usd, 0.18);
  const solo = rawRoute().venueSoloQuotes[0];
  /* A venue that cannot fill the route's size alone is not compared — however cheap its few contracts, and whatever its fixed costs. */
  const partial = { ...solo, venue: "limitless", filledQty: 4, fills: [{ venue: "limitless", avgPrice: 0.5, venueQty: 4, fills: [{ price: 0.5, size: 4, fill: 4 }] }], feeBreakdown: { rawExecCost: 2, venueFees: 0.02, bridgeFees: 0.3, executionGas: 0.04, totalCost: 2.36 } };
  assert.equal(reviewCosts(mapRoute(rawRoute({ venueSoloQuotes: [partial] }), "buy", 10, "2026-10-14T12:00:00.000Z")).saving, null);
  /* A dearer venue that spent the whole budget stops short; the contracts it did not reach cost at least its last price. 18 × 0.55 + 1 × 0.55 = 10.45. */
  const dearer = { ...solo, filledQty: 18, fills: [{ venue: "polymarket", avgPrice: 0.55, venueQty: 18, fills: [{ price: 0.55, size: 40, fill: 18 }] }], feeBreakdown: { ...solo.feeBreakdown, totalCost: 9.98 } };
  assert.deepEqual(reviewCosts(mapRoute(rawRoute({ venueSoloQuotes: [dearer] }), "buy", 10, "2026-10-14T12:00:00.000Z")).saving, { usd: 0.57, venue: "polymarket", venueCostUsd: 10.45 });
  /* A venue that fills more than the route: only its cheapest levels count, so its cost is not overstated. */
  const deeper = { ...solo, filledQty: 30, fills: [{ venue: "polymarket", avgPrice: 0.6, venueQty: 30, fills: [{ price: 0.5, size: 19, fill: 19 }, { price: 0.75, size: 11, fill: 11 }] }] };
  assert.equal(reviewCosts(mapRoute(rawRoute({ venueSoloQuotes: [deeper] }), "buy", 10, "2026-10-14T12:00:00.000Z")).saving, null);
  /* As cheap as the route before fees: Ryntra's fee makes the route dearer — no line. Under a cent is not a saving either. */
  const even = { ...solo, filledQty: 19, fills: [{ venue: "polymarket", avgPrice: 0.5184, venueQty: 19, fills: [{ price: 0.5184, size: 19, fill: 19 }] }] };
  assert.equal(reviewCosts(mapRoute(rawRoute({ venueSoloQuotes: [even] }), "buy", 10, "2026-10-14T12:00:00.000Z")).saving, null);
  const close = { ...solo, filledQty: 19, fills: [{ venue: "polymarket", avgPrice: 0.5203, venueQty: 19, fills: [{ price: 0.5203, size: 19, fill: 19 }] }] };
  assert.equal(reviewCosts(mapRoute(rawRoute({ venueSoloQuotes: [close] }), "buy", 10, "2026-10-14T12:00:00.000Z")).saving, null);
  assert.equal(reviewCosts(mapRoute(rawRoute({ venueSoloQuotes: [] }), "buy", 10, "2026-10-14T12:00:00.000Z")).saving, null);
  /* A Review stored before the quotes and their levels were kept still reads, and claims nothing. */
  const old = { ...route, solos: route.solos.map(({ levels: _levels, ...rest }) => rest) };
  assert.equal(reviewCosts(old).saving, null);
  delete old.solos;
  delete old.costs;
  assert.equal(reviewCosts(old).saving, null);
  assert.equal(leastCostOf([{ price: 0.6, qty: 5 }, { price: 0.5, qty: 5 }], 7), 3.7);
  assert.equal(leastCostOf([{ price: 0.5, qty: 5 }], 7), null);
  assert.equal(leastCostOf([{ price: 0.5, qty: 5 }], 7, true), 3.5);
});

test("a total the route leaves out is the breakdown's own, with the fees it does not hold", () => {
  const raw = rawRoute({ totalCostIncFees: undefined, feeBreakdown: { ...rawRoute().feeBreakdown, appFee: 0.029, appFeeBips: 30, referralFee: 0.006 } });
  const costs = reviewCosts(mapRoute(raw, "buy", 10, "2026-10-14T12:00:00.000Z"));
  assert.equal(costs.totalUsd, 9.885);
  assert.equal(costs.lines.find((l) => l.id === "referral").usd, 0.006);
});

test("the ticket's promise: what the amount buys if right, after Ryntra's fee", () => {
  assert.equal(ryntraFeeUsd(10), 0.03);
  assert.equal(payoutEstimate(10, 0.46), 21.67);
  assert.equal(payoutEstimate(10, null), null);
  assert.equal(payoutEstimate(0, 0.5), null);
  assert.equal(payoutEstimate(10, 1), null);
});

test("access comes only from the provider's own answers", () => {
  const facts = { locationBlocked: false, venueAccounts: [], disabledVenues: ["novig", "prophetx", "pred"] };
  assert.equal(venueAccess("polymarket", facts), "open");
  assert.equal(venueAccess("novig", facts), "off");
  assert.equal(venueAccess("kalshi", facts), "account");
  assert.equal(venueAccess("kalshi", { ...facts, venueAccounts: [{ venue: "kalshi", status: "active", kycStatus: "verified" }] }), "open");
  assert.equal(venueAccess("polymarket", { ...facts, locationBlocked: true }), "view");
  assert.equal(venueAccess("polymarket", facts, [{ venue: "polymarket", reason: "Geo-restricted for this user's country" }]), "view");
  assert.equal(venueAccess("limitless", facts, [{ venue: "limitless", reason: "Venue temporarily disabled" }]), "off");
  assert.equal(venueAccess("limitless", facts, [{ venue: "polymarket", reason: "Venue temporarily disabled" }]), "open");
  /* Until the provider has answered, nothing is claimed: a guest, an unread profile, an unread configuration. */
  assert.equal(venueAccess("polymarket", GUEST_ACCESS), "unknown");
  assert.equal(venueAccess("prophetx", GUEST_ACCESS), "unknown");
  assert.equal(venueAccess("polymarket", { ...facts, disabledVenues: null }), "unknown");
  assert.equal(venueAccess("polymarket", { ...facts, locationBlocked: null }), "unknown");
  assert.equal(venueAccess("novig", { ...GUEST_ACCESS, disabledVenues: ["novig"] }), "off");
  assert.equal(marketAccess(["polymarket", "kalshi"], GUEST_ACCESS), "unknown");
  assert.ok(ACCOUNT_VENUES.has("kalshi"));
});

test("a market's state is the best any of its venues offers; it is never hidden", () => {
  const facts = { locationBlocked: false, venueAccounts: null, disabledVenues: ["novig"] };
  assert.equal(marketAccess(["kalshi", "polymarket"], facts), "open");
  assert.equal(marketAccess(["kalshi"], facts), "account");
  assert.equal(marketAccess(["novig"], facts), "off");
  assert.equal(marketAccess(["polymarket", "kalshi"], { ...facts, locationBlocked: true }), "view");
  assert.equal(marketAccess([], facts), "off");
  assert.equal(openVenueCount(["kalshi", "polymarket", "limitless", "novig"], facts), 2);
});

const SETTLEMENT = {
  sharedSummary: "This market tracks the change of the upper bound of the target rate after the October meeting.",
  differences: [
    { type: "threshold", title: "Rounding for unlisted rate changes", summary: "Hyperliquid does not specify rounding.", perVenue: { myriad: "Rounded up to nearest 25 bps", polymarket: "Rounded up to nearest 25 bps", limitless: "Rounded up to nearest 25 bps" } },
    { type: "resolution_source", title: "Primary Resolution Source", summary: null, perVenue: { polymarket: "FOMC statement, with URLs", limitless: "FOMC statement, with URLs", hyperliquid: "Parent question", myriad: "Official FOMC statement" } },
    { type: "novel_kind", title: "Something new", summary: null, perVenue: { polymarket: "A", limitless: "A", myriad: "A", hyperliquid: "A" } },
  ],
};

test("«Where's the catch» groups the venues by what they say and names the silent ones", () => {
  const points = settlementPoints(SETTLEMENT, ["polymarket", "limitless", "myriad", "hyperliquid", "kalshi"]);
  assert.ok(points.every((p) => p.groups.every((g) => !g.venues.includes("kalshi"))), "a venue the provider compared nowhere is not called silent");
  assert.equal(points.length, 3);
  assert.equal(points[0].kind, "threshold");
  assert.deepEqual(points[0].groups, [
    { venues: ["myriad", "polymarket", "limitless"], text: "Rounded up to nearest 25 bps" },
    { venues: ["hyperliquid"], text: null },
  ]);
  assert.deepEqual(points[0].differs, ["hyperliquid"]);
  assert.equal(points[1].kind, "source");
  assert.equal(points[1].groups[0].venues.length, 2);
  assert.deepEqual(points[1].differs.sort(), ["hyperliquid", "myriad"]);
  /* Every venue agrees: one group, nobody differs; an unknown kind keeps the provider's title. */
  assert.equal(points[2].kind, "other");
  assert.equal(points[2].groups.length, 1);
  assert.deepEqual(points[2].differs, []);
  assert.deepEqual(settlementPoints(null, ["polymarket"]), []);
  assert.equal(settlementKind("deadline"), "timing");
  assert.equal(settlementKind("cancellation_rules"), "edge");
});

test("a card of several markets names the market its figure belongs to", () => {
  const event = {
    id: "e1",
    title: "Fed Decision in October?",
    venue: "polymarket",
    venues: ["polymarket", "kalshi"],
    status: "open",
    venueMarkets: [
      { id: "m1", question: "No change", venue: "polymarket", venueMarketOutcomes: [{ id: "y", label: "Yes", price: 0.8 }, { id: "n", label: "No", price: 0.2 }] },
      { id: "m2", question: "25 bps cut", venue: "polymarket", venueMarketOutcomes: [{ id: "y2", label: "Yes", price: 0.2 }, { id: "n2", label: "No", price: 0.8 }] },
    ],
  };
  assert.equal(mapEventSummary(event).leadingQuestion, "No change");
  assert.equal(mapEventSummary({ ...event, venueMarkets: [event.venueMarkets[0]] }).leadingQuestion, null);
});
