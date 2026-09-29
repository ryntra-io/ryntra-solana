// Run from repo root: node --test lib/domain/routes.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { rankQuotes, comparisonFreshness, hasFeeDisclosure, compareAmounts } from "./routes.ts";
import { ROUTES, routesOnChain } from "./ids.ts";

const q = (over = {}) => ({
  route: "arcus-spot-rfq",
  instrument: { chain: "robinhood-chain", kind: "spot-tokenized-equity", base: "NVDA", quote: "USDG" },
  side: "buy",
  size: "10",
  expectedOut: "1000",
  price: "100",
  feeBps: 11,
  feeNote: "Quote-disclosed provider fee: 11 bps. Ryntra adds no separate fee on this fixture.",
  priceImpactPct: null,
  freshness: "fresh",
  observedAt: 1_000_000,
  warnings: [],
  executionMode: "wallet-signed",
  ...over,
});

test("rankQuotes: more output ranks better; ranking never implies selection", () => {
  const a = q({ route: "arcus-spot-rfq", expectedOut: "1000" });
  const b = q({ route: "uniswap-rhchain-amm", expectedOut: "1005", priceImpactPct: 0.4 });
  const ranked = rankQuotes([a, b]);
  const byRoute = Object.fromEntries(ranked.map((r) => [r.quote.route, r]));
  assert.equal(byRoute["uniswap-rhchain-amm"].rank, 1);
  assert.equal(byRoute["arcus-spot-rfq"].rank, 2);
  // the result carries no "selected" field at all — selection is the user's, by design
  for (const r of ranked) assert.ok(!("selected" in r));
});

test("INVARIANT: a non-fresh quote is excluded from ranking, never silently dropped", () => {
  const fresh = q({ expectedOut: "990" });
  const stale = q({ route: "uniswap-rhchain-amm", expectedOut: "1010", freshness: "stale" });
  const ranked = rankQuotes([fresh, stale]);
  const staleRanked = ranked.find((r) => r.quote.route === "uniswap-rhchain-amm");
  assert.equal(staleRanked.rank, null);
  assert.equal(staleRanked.excluded, "not-fresh");
  const freshRanked = ranked.find((r) => r.quote.route === "arcus-spot-rfq");
  assert.equal(freshRanked.rank, 1); // stale 1010 must NOT beat fresh 990
  assert.equal(ranked.length, 2);
});

test("INVARIANT: 18-decimal base-unit amounts rank without float precision loss", () => {
  // Both values exceed Number.MAX_SAFE_INTEGER and differ only in the last digits —
  // Number() would see them as equal and could mis-rank.
  const small = "1000000000000000000000005"; // 1000.000000000000000000005 × 1e21
  const big = "1000000000000000000000009";
  assert.equal(compareAmounts(big, small), 1);
  assert.equal(compareAmounts(small, big), -1);
  assert.equal(compareAmounts(big, big), 0);
  const ranked = rankQuotes([
    q({ route: "arcus-spot-rfq", expectedOut: small }),
    q({ route: "uniswap-rhchain-amm", expectedOut: big }),
  ]);
  const byRoute = Object.fromEntries(ranked.map((r) => [r.quote.route, r.rank]));
  assert.equal(byRoute["uniswap-rhchain-amm"], 1);
  assert.equal(byRoute["arcus-spot-rfq"], 2);
});

test("INVARIANT: DECIMAL amount strings also compare at full precision (no Number round-trip)", () => {
  // Differ only past the 17th significant digit — Number() would call them equal.
  assert.equal(compareAmounts("1000.000000000000000002", "1000.000000000000000001"), 1);
  assert.equal(compareAmounts("1000.000000000000000001", "1000.000000000000000002"), -1);
  assert.equal(compareAmounts("1000.000000000000000001", "1000.000000000000000001"), 0);
  // mixed integer vs decimal, and unequal fraction lengths, scale correctly
  assert.equal(compareAmounts("1000", "999.999999999999999999"), 1);
  assert.equal(compareAmounts("0.5", "0.50"), 0);
  assert.equal(compareAmounts("-1.5", "-1.4"), -1);
});

test("unquotable route is annotated no-quote", () => {
  const ranked = rankQuotes([q({ expectedOut: null, price: null })]);
  assert.equal(ranked[0].rank, null);
  assert.equal(ranked[0].excluded, "no-quote");
});

test("comparisonFreshness: one stale leg makes the whole view non-fresh", () => {
  assert.equal(comparisonFreshness([q(), q()]), "fresh");
  assert.equal(comparisonFreshness([q(), q({ freshness: "stale" })]), "stale");
  assert.equal(comparisonFreshness([q({ freshness: "unknown" }), q()]), "unknown");
  assert.equal(comparisonFreshness([]), "unknown");
});

test("INVARIANT: fee disclosure is mandatory even at zero fee", () => {
  assert.equal(hasFeeDisclosure(q({ feeBps: 0, feeNote: "Generic zero-fee fixture; no separate fee." })), true);
  assert.equal(hasFeeDisclosure(q({ feeNote: "" })), false);
  assert.equal(hasFeeDisclosure(q({ feeNote: "   " })), false);
});

test("route registry: chain/executor separation is coherent", () => {
  // Robinhood Chain is a CHAIN with two distinct executors on it (venue Arcus + protocol Uniswap)
  const rh = routesOnChain("robinhood-chain").map((r) => r.id).sort();
  assert.deepEqual(rh, ["arcus-perps-clob", "arcus-spot-rfq", "uniswap-rhchain-amm"]);
  assert.equal(ROUTES["arcus-spot-rfq"].executor.kind, "venue");
  assert.equal(ROUTES["uniswap-rhchain-amm"].executor.kind, "onchain-protocol");
  // structure honesty: RFQ route is rfq, AMM route is amm — no CLOB claims on either
  assert.equal(ROUTES["arcus-spot-rfq"].structure, "rfq");
  assert.equal(ROUTES["uniswap-rhchain-amm"].structure, "amm");
  assert.equal(ROUTES["hyperliquid-perps-clob"].structure, "clob");
  // every route is wallet-signed today — no custodial execution mode anywhere
  for (const r of Object.values(ROUTES)) assert.equal(r.executionMode, "wallet-signed");
});
