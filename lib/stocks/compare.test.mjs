// Run from repo root: node --test lib/stocks/compare.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import { compareRepresentations, COMPARE_LIMIT } from "./compare.server.ts";
import { REFERENCE_UNAVAILABLE, UNKNOWN_SESSION } from "./session.ts";
import { STOCK_ISSUERS } from "./representations.ts";
import { groupUnderlying, sameUnderlying, underlyingConfidence } from "./underlying-group.ts";

/**
 * One underlying, several tokens (canon §7.7): the grouping rule and the
 * comparison it feeds. The quotes are injected, so nothing here asks the
 * venue anything; what is tested is the rule — who is grouped with whom,
 * what is ranked, what is named as the lowest quoted cost and what is not.
 */

const NVDAX = "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh";
const NVDAON = "Nvd1onPmi7cw1QbE3kt1aQ5cQZ9TQ4n2M3y3aVJq7bE";
const NVDABP = "Nvd2bpkDQwFhuf6NgoxTbYzFUTNqA7rYqMTXjm1t6Yh";
const GOOGX = "Xsg1oWKzFPvWQz7NFCC7bBmcqzgV5CqXTPdgV3o9pxk";
const GOOGLX = "Xsg2oWKzFPvWQz7NFCC7bBmcqzgV5CqXTPdgV3o9pxk";
const TSLAX = "Xst3oWKzFPvWQz7NFCC7bBmcqzgV5CqXTPdgV3o9pxk";

function representation({ mint, symbol, issuer, underlying, isin = null, name = null, catalogue = false, decimals = 8 }) {
  return {
    mint,
    symbol,
    name: name ?? `${underlying} token`,
    issuer: STOCK_ISSUERS[issuer],
    issuerConfirmation: catalogue ? "issuer-catalogue" : "tag-only",
    underlying: { symbol: underlying, isin, listingCountry: catalogue ? "US" : null, name: name ?? null },
    exchange: null,
    tokenProgram: null,
    decimals,
    tradingHalted: null,
    sources: catalogue ? ["jupiter-verified", "xstocks-public-api"] : ["jupiter-verified"],
  };
}

function row(rep, { liquidityUsd = 100_000, multiplier = 1 } = {}) {
  return {
    representation: rep,
    market: { priceUsd: 180, change24hPct: 0, volume24hUsd: 1_000_000, liquidityUsd, verified: true, observedAt: "2026-09-15T12:00:00.000Z", icon: null },
    tokenPerShareUsd: 180,
    multiplier: multiplier === null ? null : { current: multiplier, pending: null, effectiveAt: null },
    multiplierState: multiplier === null ? null : "active",
    reference: { ...REFERENCE_UNAVAILABLE },
    session: UNKNOWN_SESSION,
    deviationPct: null,
  };
}

const nvdax = row(representation({ mint: NVDAX, symbol: "NVDAx", issuer: "xstocks", underlying: "NVDA", isin: "US67066G1040", name: "NVIDIA", catalogue: true }), { multiplier: 1.001701 });
const nvdaon = row(representation({ mint: NVDAON, symbol: "NVDAon", issuer: "ondo", underlying: "NVDA" }), { liquidityUsd: 50_000, multiplier: 1.003376 });
const nvdabp = row(representation({ mint: NVDABP, symbol: "NVDA", issuer: "backpack", underlying: "NVDA" }), { liquidityUsd: 20_000, multiplier: null });
const googx = row(representation({ mint: GOOGX, symbol: "GOOGx", issuer: "xstocks", underlying: "GOOG", isin: "US02079K1079", catalogue: true }));
const googlx = row(representation({ mint: GOOGLX, symbol: "GOOGLx", issuer: "xstocks", underlying: "GOOGL", isin: "US02079K3059", catalogue: true }));
const tslax = row(representation({ mint: TSLAX, symbol: "TSLAx", issuer: "xstocks", underlying: "TSLA", isin: "US88160R1014", catalogue: true }));
const universe = { rows: [nvdax, nvdaon, nvdabp, googx, googlx, tslax], marketsObservedAt: "", issuerCatalogue: { ok: true, reason: null }, fetchedAt: "" };

test("the same underlying is the same symbol and, where both state one, the same ISIN — a share class stays its own group", () => {
  assert.equal(sameUnderlying(nvdax.representation, nvdaon.representation), true, "a catalogue-confirmed NVDA and an implied NVDA are one underlying");
  assert.equal(sameUnderlying(googx.representation, googlx.representation), false, "GOOG and GOOGL are two share classes");
  const otherListing = representation({ mint: GOOGLX, symbol: "NVDAz", issuer: "xstocks", underlying: "NVDA", isin: "DE000A0000001", catalogue: true });
  assert.equal(sameUnderlying(nvdax.representation, otherListing), false, "two ISINs under one ticker are two listings, not one");
  assert.equal(underlyingConfidence(nvdax.representation), "confirmed");
  assert.equal(underlyingConfidence(nvdaon.representation), "implied");
});

test("the group is the anchor and every other representation of its underlying, confirmed first then by liquidity, never the anchor itself", () => {
  const group = groupUnderlying(universe.rows, nvdax);
  assert.deepEqual({ symbol: group.symbol, isin: group.isin }, { symbol: "NVDA", isin: "US67066G1040" });
  assert.deepEqual(group.others.map((member) => member.representation.symbol), ["NVDAon", "NVDA"]);
  const fromImplied = groupUnderlying(universe.rows, nvdaon);
  assert.deepEqual(fromImplied.others.map((member) => member.representation.symbol), ["NVDAx", "NVDA"], "the confirmed member leads whichever token the page is open on");
  assert.equal(fromImplied.isin, "US67066G1040", "the group carries the ISIN its confirmed member states");
  assert.deepEqual(groupUnderlying(universe.rows, tslax).others, [], "a lone representation has an empty group");
});

const findRow = (anchor) => async () => ({ ok: true, row: anchor, universe });

function quoteOf(perShare, { multiplier = 1, ok = true, code = "NO_ROUTE", reason = "no route" } = {}) {
  return async ({ ticker, side, usd }) => {
    if (!ok) return { ok: false, code, reason };
    const units = (usd / perShare).toFixed(6);
    return {
      ok: true,
      quote: {
        mint: ticker,
        symbol: "x",
        side,
        usd,
        tokenRaw: "1",
        tokenScaled: units,
        minReceivedRaw: "1",
        minReceivedScaled: units,
        multiplier,
        executablePerShare: multiplier === null ? null : perShare,
        reference: { ...REFERENCE_UNAVAILABLE },
        deviationPct: null,
        priceImpactPct: "0.01",
        feeBasisPoints: 50,
        slippageBps: 50,
        router: "metis",
        observedAt: "2026-09-15T12:00:00.000Z",
        reviewExpiresAt: "2026-09-15T12:01:00.000Z",
        source: { label: "Jupiter" },
      },
    };
  };
}

test("a Buy quotes the whole group for the same amount and names the lowest per-share price as the lowest quoted cost — never a row without units", async () => {
  const perShareByMint = { [NVDAX]: 181.4, [NVDAON]: 180.9, [NVDABP]: 170 };
  const quote = async (input) => quoteOf(perShareByMint[input.ticker], { multiplier: input.ticker === NVDABP ? null : 1 })(input);
  const read = await compareRepresentations({ ticker: "NVDAx", side: "BUY", usd: 1000 }, { findRow: findRow(nvdax), quote, now: () => new Date("2026-09-15T12:00:05.000Z") });
  assert.ok(read.ok);
  const { comparison } = read;
  assert.equal(comparison.compared, true);
  assert.deepEqual(comparison.rows.map((r) => r.representation.symbol), ["NVDAx", "NVDAon", "NVDA"]);
  assert.equal(comparison.rows[0].anchor, true);
  assert.deepEqual(comparison.rows.map((r) => r.ranked), [true, true, false], "a mint without a known multiplier is shown, not ranked");
  assert.deepEqual(comparison.rows.map((r) => r.lowestCost), [false, true, false], "NVDAon at $180.90 is the lowest quoted cost; NVDA at a token price of $170 has no per-share basis");
  assert.equal(comparison.rows.every((r) => r.quote === null || r.quote.usd === 1000), true, "every row quoted for the same amount");
  assert.equal(comparison.underlying.isin, "US67066G1040");
});

test("a mint the venue has no route for at this size is named with the venue's reason, and one ranked row is no comparison", async () => {
  const quote = async (input) => (input.ticker === NVDAX ? quoteOf(181.4)(input) : quoteOf(0, { ok: false, code: "NO_ROUTE", reason: "COULD_NOT_FIND_ANY_ROUTE" })(input));
  const read = await compareRepresentations({ ticker: "NVDAx", side: "BUY", usd: 250_000 }, { findRow: findRow(nvdax), quote });
  assert.ok(read.ok);
  assert.equal(read.comparison.compared, false, "with one ranked row there is nothing to call lowest");
  assert.deepEqual(read.comparison.rows.map((r) => r.lowestCost), [false, false, false]);
  assert.deepEqual(read.comparison.rows[1].failure, { code: "NO_ROUTE", reason: "COULD_NOT_FIND_ANY_ROUTE" });
});

test("a Sell compares nothing: the open token alone is quoted, because a person sells what they hold", async () => {
  const calls = [];
  const quote = async (input) => { calls.push(input.ticker); return quoteOf(181.4)(input); };
  const read = await compareRepresentations({ ticker: "NVDAx", side: "SELL", usd: 500 }, { findRow: findRow(nvdax), quote });
  assert.ok(read.ok);
  assert.deepEqual(calls, [NVDAX]);
  assert.equal(read.comparison.rows.length, 1);
  assert.equal(read.comparison.compared, false);
});

test("the budget holds: past the limit a representation is named and not quoted; an amount the quote refuses refuses the comparison", async () => {
  const many = Array.from({ length: COMPARE_LIMIT + 2 }, (_, i) => row(representation({ mint: `M${i}`.padEnd(32, "1"), symbol: `NVDA${i}`, issuer: "ondo", underlying: "NVDA" })));
  const wide = { rows: [nvdax, ...many], marketsObservedAt: "", issuerCatalogue: { ok: true, reason: null }, fetchedAt: "" };
  const calls = [];
  const quote = async (input) => { calls.push(input.ticker); return quoteOf(181)(input); };
  const read = await compareRepresentations({ ticker: "NVDAx", side: "BUY", usd: 100 }, { findRow: async () => ({ ok: true, row: nvdax, universe: wide }), quote });
  assert.ok(read.ok);
  assert.equal(calls.length, COMPARE_LIMIT);
  assert.equal(read.comparison.rows.length, COMPARE_LIMIT + 3, "the anchor and seven others: five quoted, three named");
  assert.equal(read.comparison.rows.at(-1).failure.code, "NOT_QUOTED");
  const refused = await compareRepresentations({ ticker: "NVDAx", side: "BUY", usd: 0.5 }, { findRow: findRow(nvdax), quote: async () => ({ ok: false, code: "AMOUNT", reason: "too small" }) });
  assert.deepEqual(refused, { ok: false, code: "AMOUNT", reason: "too small" });
});

test("an unknown ticker and a catalogue that did not answer are refused as themselves", async () => {
  const unknown = await compareRepresentations({ ticker: "NOPE", side: "BUY", usd: 100 }, { findRow: async () => ({ ok: true, row: null, universe }), quote: quoteOf(1) });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.code, "UNKNOWN_ASSET");
  const down = await compareRepresentations({ ticker: "NVDAx", side: "BUY", usd: 100 }, { findRow: async () => ({ ok: false, code: "ISSUER_CATALOGUE_UNAVAILABLE", reason: "down" }), quote: quoteOf(1) });
  assert.deepEqual(down, { ok: false, code: "PROVIDER", reason: "down" });
});
