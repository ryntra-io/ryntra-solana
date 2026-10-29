// SOL-R1 «Market Radar — мем-режим»: the six feeds over Pulse's rows, cut to the tokens born on Meteora DBC, pump.fun
// and Raydium LaunchLab; the creator's history and the holders' growth on a row; the filters of the creator's history;
// and the total fees of a buy before its Review.
import assert from "node:assert/strict";
import test from "node:test";

import {
  feedRows,
  GROWING_MIN_VOLUME_USD,
  isPulseFeed,
  isRadarRow,
  launchVenueOf,
  passesFilter,
  PULSE_DEFAULT_WINDOW,
  PULSE_FEEDS,
  PULSE_FILTER_NONE,
  PULSE_WINDOWS,
  pulseModeOf,
  pulseRowOf,
  RADAR_FEEDS,
  readPulseFilter,
  SOON_MIN_PCT,
  WATCHLIST_MAX,
  watchlistMintsOf,
} from "./pulse.ts";
import { PRIORITY_FEE_CEILING_LAMPORTS } from "../solana/jupiter-build.ts";
import { buyCostOf, costSumOf, PRIORITY_CEILING_LAMPORTS, TOKEN_ACCOUNT_RENT_LAMPORTS, usdcRawOf } from "./radar-cost.ts";

const NOW = Date.parse("2026-10-20T12:00:00Z");
const HOUR = 3_600_000;
const MINT = "4CJfADKLXAKzv8meQ3rywzQULGN535WAMJJUGWZnpump";

function raw(overrides = {}) {
  return {
    id: MINT,
    name: "Three Fen",
    symbol: "3FEN",
    decimals: 6,
    dev: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
    launchpad: "pump.fun",
    mcap: 36_945,
    usdPrice: 0.000036945,
    liquidity: 12_280.1,
    holderCount: 412,
    stats5m: { priceChange: 1.2, buyVolume: 700, sellVolume: 300, holderChange: 0.5 },
    stats1h: { priceChange: 17.9, buyVolume: 4_000, sellVolume: 1_300, holderChange: 12.5 },
    stats6h: { priceChange: 40, buyVolume: 9_000, sellVolume: 4_000, holderChange: 30 },
    stats24h: { priceChange: 40, buyVolume: 9_000, sellVolume: 4_000, holderChange: 30 },
    firstPool: { id: MINT, createdAt: new Date(NOW - 3 * HOUR).toISOString() },
    audit: { mintAuthorityDisabled: true, freezeAuthorityDisabled: true, devBalancePercentage: 2.1, topHoldersPercentage: 31.5, devMints: 7, devMigrations: 2 },
    organicScoreLabel: "low",
    tags: ["unknown"],
    ...overrides,
  };
}

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
/** A distinct base58 address for the n-th test row. */
const mintOf = (n) => `${B58[Math.floor(n / 58) % 58]}${B58[n % 58]}${MINT.slice(2)}`;
let serial = 0;
function row(overrides = {}, rawOverrides = {}) {
  serial += 1;
  const base = pulseRowOf(raw({ id: mintOf(serial), ...rawOverrides }), NOW);
  assert.ok(base);
  return { ...base, ...overrides };
}

test("Market Radar has six feeds — New · Growing · Near Graduation · Graduated · Trending · Watchlist — and Home keeps its five", () => {
  assert.deepEqual([...RADAR_FEEDS], ["new", "growing", "soon", "dex", "trending", "watchlist"]);
  assert.deepEqual([...PULSE_FEEDS], ["new", "soon", "dex", "trending", "movers"]);
  for (const feed of [...RADAR_FEEDS, ...PULSE_FEEDS]) {
    assert.ok(isPulseFeed(feed), feed);
    assert.ok(PULSE_WINDOWS[feed].includes(PULSE_DEFAULT_WINDOW[feed]), `${feed}: its window is one it has`);
  }
  assert.equal(isPulseFeed("radar"), false);
  assert.equal(pulseModeOf("meme"), "meme");
  assert.equal(pulseModeOf("anything"), "all");
  assert.equal(pulseModeOf(null), "all");
});

test("a row names the launch program it was born on — the three the Radar watches, and none else", () => {
  assert.equal(launchVenueOf("pump.fun"), "pump");
  assert.equal(launchVenueOf("met-dbc"), "meteora-dbc");
  assert.equal(launchVenueOf("jup-studio"), "meteora-dbc");
  assert.equal(launchVenueOf("letsbonk.fun"), "launchlab");
  assert.equal(launchVenueOf("raydium-launchlab"), "launchlab");
  assert.equal(launchVenueOf("moonshot"), null, "a launchpad not known to run on the three is not counted as one");
  assert.equal(launchVenueOf(null), null);
  const pump = pulseRowOf(raw(), NOW);
  assert.equal(pump.venue, "pump");
  assert.equal(pump.graduated, false);
  assert.equal(pump.creatorLaunches, 7);
  assert.equal(pump.creatorGraduated, 2);
  assert.equal(pump.windows.h1.holdersChangePct, 12.5);
  const crypto = pulseRowOf(raw({ launchpad: undefined, tags: ["verified"] }), NOW);
  assert.equal(crypto.venue, null);
  assert.equal(isRadarRow(crypto), false, "a token born on no launchpad is not a meme of the Radar");
  assert.equal(pulseRowOf(raw({ graduatedPool: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU" }), NOW).graduated, true);
  assert.equal(pulseRowOf(raw({ audit: { mintAuthorityDisabled: true, freezeAuthorityDisabled: true } }), NOW).creatorLaunches, null, "not stated is null, never zero");
});

test("meme mode keeps only the Radar's tokens in every feed but the person's own watchlist", () => {
  const meme = row();
  const crypto = row({ venue: null, launchpad: null });
  const onCurve = row({ venue: null, curve: { venue: "launchlab", progressPct: 40, complete: false } });
  assert.deepEqual(feedRows("trending", [crypto, meme], "h1", NOW, false, "meme").map((r) => r.mint), [meme.mint]);
  assert.deepEqual(feedRows("trending", [crypto, meme], "h1", NOW).map((r) => r.mint), [crypto.mint, meme.mint], "Home is not cut");
  assert.deepEqual(feedRows("soon", [crypto, onCurve], "h1", NOW, false, "meme").map((r) => r.mint), [onCurve.mint], "a curve read from one of the three counts");
  assert.deepEqual(feedRows("watchlist", [crypto, meme], "h24", NOW, false, "meme").map((r) => r.mint), [crypto.mint, meme.mint], "the person's list, in their order");
});

test("«Ростуть»: on a curve, an hour to a day old, short of «Майже на DEX», holders up and the hour traded — the hour's most traded first", () => {
  const ok = row({}, { stats1h: { priceChange: 5, buyVolume: 900, sellVolume: 300, holderChange: 3 } });
  const bigger = row({}, { stats1h: { priceChange: 5, buyVolume: 9_000, sellVolume: 3_000, holderChange: 3 } });
  const young = row({ firstPoolAt: new Date(NOW - 20 * 60_000).toISOString() });
  const old = row({ firstPoolAt: new Date(NOW - 30 * HOUR).toISOString() });
  const shrinking = row({}, { stats1h: { priceChange: 5, buyVolume: 9_000, sellVolume: 3_000, holderChange: -1 } });
  const unread = row({}, { stats1h: { priceChange: 5, buyVolume: 9_000, sellVolume: 3_000 } });
  const quiet = row({}, { stats1h: { priceChange: 5, buyVolume: 500, sellVolume: 100, holderChange: 9 } });
  const near = row({ curve: { venue: "pump", progressPct: SOON_MIN_PCT, complete: false } });
  const out = row({ graduated: true });
  const graduatedAt = row({ graduatedAt: new Date(NOW - HOUR).toISOString() });
  const crypto = row({ venue: null, launchpad: null });
  const picked = feedRows("growing", [ok, quiet, young, old, shrinking, unread, near, out, graduatedAt, crypto, bigger], "h1", NOW);
  assert.deepEqual(picked.map((r) => r.mint), [bigger.mint, ok.mint]);
  assert.ok(ok.windows.h1.volumeUsd >= GROWING_MIN_VOLUME_USD);
});

test("«Обране»: at most a hundred, as given; the mints asked for are addresses, each once", () => {
  const rows = Array.from({ length: WATCHLIST_MAX + 5 }, () => row());
  assert.equal(feedRows("watchlist", rows, "h24", NOW).length, WATCHLIST_MAX);
  assert.deepEqual(watchlistMintsOf(`${MINT}, ${MINT},not-a-mint,,So11111111111111111111111111111111111111112`), [MINT, "So11111111111111111111111111111111111111112"]);
  assert.deepEqual(watchlistMintsOf(null), []);
  const many = Array.from({ length: 150 }, (_, index) => mintOf(index + 1000)).join(",");
  assert.equal(watchlistMintsOf(many).length, WATCHLIST_MAX);
});

test("the creator's history filters: at most N tokens made, at least M of them on a DEX; a history nobody stated never passes a bound", () => {
  const seven = row();
  const unstated = row({ creatorLaunches: null, creatorGraduated: null });
  const filter = { ...PULSE_FILTER_NONE, creatorLaunchesMax: 10 };
  assert.equal(passesFilter(seven, filter, "h1", NOW), true);
  assert.equal(passesFilter(seven, { ...PULSE_FILTER_NONE, creatorLaunchesMax: 5 }, "h1", NOW), false);
  assert.equal(passesFilter(seven, { ...PULSE_FILTER_NONE, creatorGraduatedMin: 2 }, "h1", NOW), true);
  assert.equal(passesFilter(seven, { ...PULSE_FILTER_NONE, creatorGraduatedMin: 3 }, "h1", NOW), false);
  assert.equal(passesFilter(unstated, filter, "h1", NOW), false);
  assert.equal(passesFilter(unstated, PULSE_FILTER_NONE, "h1", NOW), true);
  assert.deepEqual(readPulseFilter({ creatorLaunchesMax: 3, creatorGraduatedMin: 1 }), { ...PULSE_FILTER_NONE, creatorLaunchesMax: 3, creatorGraduatedMin: 1 });
  assert.deepEqual(readPulseFilter({ creatorLaunchesMax: -1 }), PULSE_FILTER_NONE, "a stored bound that is no bound is none");
});

/* ------------------------------------------------------------ the total fees before buying */

function order(overrides = {}) {
  return {
    inAmountRaw: "100000000",
    outAmountRaw: "2689000000000",
    minReceivedRaw: "2662110000000",
    priceImpactPct: "0.42",
    inUsdValue: "100",
    outUsdValue: "98.61",
    totalFeeBasisPoints: 100,
    ryntraFee: { mechanism: "JUPITER_PLATFORM_FEE", basisPoints: 100, state: "QUOTED" },
    signatureFeeLamports: "5000",
    priorityFeeLamports: "95000",
    rentFeeLamports: "2039280",
    gasless: false,
    router: "metis",
    reviewExpiresAt: "2026-10-20T12:00:55Z",
    ...overrides,
  };
}

test("the fees of a $100 buy quoted on /order: Ryntra's rate, the network's signature and priority as the quote sized them", () => {
  const cost = buyCostOf({ usd: 100, order: order(), lane: "ORDER", solUsd: 200, quotedAt: "2026-10-20T12:00:00Z" });
  assert.deepEqual(cost.ryntra, { bps: 100, usd: 1 });
  assert.deepEqual(cost.jupiter, { bps: 0, usd: 0 });
  assert.equal(cost.network.lamports, 100_000);
  assert.ok(Math.abs(cost.network.usd - 0.02) < 1e-12);
  assert.ok(Math.abs(cost.total.usd - 1.02) < 1e-12);
  assert.ok(Math.abs(cost.total.pct - 1.02) < 1e-12);
  assert.equal(cost.total.maxUsd, cost.total.usd, "a sized priority is no range");
  assert.equal(cost.network.priorityKnown, true);
  assert.equal(cost.deposit.known, true);
  assert.equal(cost.impactPct, 0.42, "the price impact stands beside the fees, not in them");
  assert.equal(cost.deposit.lamports, 2_039_280, "a new token account's deposit is not a fee: it comes back");
  assert.ok(Math.abs(cost.deposit.usd - 0.407856) < 1e-9);
  assert.equal(cost.receiveUsd, 98.61);
  assert.equal(cost.solUsd, 200);
  assert.equal(cost.expiresAt, "2026-10-20T12:00:55Z");
});

test("Jupiter's own share on /order is what its total holds beyond Ryntra's; a gasless order costs no network fee", () => {
  const referral = buyCostOf({ usd: 50, order: order({ totalFeeBasisPoints: 110, ryntraFee: { mechanism: "JUPITER_REFERRAL", basisPoints: 100, state: "QUOTED" } }), lane: "ORDER", solUsd: 200, quotedAt: "x" });
  assert.deepEqual(referral.jupiter, { bps: 10, usd: 0.05 });
  const gasless = buyCostOf({ usd: 50, order: order({ gasless: true }), lane: "ORDER", solUsd: 200, quotedAt: "x" });
  assert.equal(gasless.network.lamports, 0);
  assert.equal(gasless.deposit.lamports, 0);
  assert.equal(gasless.total.usd, 0.5);
  const notApplied = buyCostOf({ usd: 50, order: order({ totalFeeBasisPoints: 0, ryntraFee: { mechanism: "JUPITER_REFERRAL", basisPoints: 0, state: "NOT_APPLIED" } }), lane: "ORDER", solUsd: 200, quotedAt: "x" });
  assert.equal(notApplied.ryntra.usd, 0, "a fee not applied is not shown as charged");
});

test("without SOL's price the network is said in SOL and the total is not a guess; a favourable impact is no cost", () => {
  const cost = buyCostOf({ usd: 100, order: order({ priceImpactPct: "-0.3" }), lane: "ORDER", solUsd: null, quotedAt: "x" });
  assert.equal(cost.network.usd, null);
  assert.equal(cost.total.usd, null);
  assert.equal(cost.total.pct, null);
  assert.equal(cost.total.feesUsd, 1);
  assert.equal(cost.impactPct, 0);
  assert.equal(buyCostOf({ usd: 100, order: order({ priceImpactPct: "n/a" }), lane: "ORDER", solUsd: 200, quotedAt: "x" }).impactPct, null);
});

test("a sum the card may quote is one of the quick sums' bounds, in whole cents; USDC has six decimals", () => {
  assert.equal(costSumOf("100"), 100);
  assert.equal(costSumOf("12.345"), 12.35);
  assert.equal(costSumOf("0.5"), null);
  assert.equal(costSumOf("1000001"), null);
  assert.equal(costSumOf("abc"), null);
  assert.equal(costSumOf(null), null);
  assert.equal(usdcRawOf(100), "100000000");
  assert.equal(usdcRawOf(12.35), "12350000");
});

test("a meme quoted on /build with no wallet: the priority is a range up to its ceiling and the deposit an «if new», never a zero", () => {
  const build = order({ priorityFeeLamports: "0", rentFeeLamports: "0", outUsdValue: null, inUsdValue: null });
  const cost = buyCostOf({ usd: 100, order: build, lane: "BUILD", solUsd: 200, quotedAt: "x" });
  assert.equal(cost.network.priorityKnown, false);
  assert.equal(cost.network.lamports, 5_000, "the signature alone is what is known");
  assert.equal(cost.network.maxLamports, 5_000 + PRIORITY_CEILING_LAMPORTS);
  assert.ok(Math.abs(cost.total.usd - 1.001) < 1e-12);
  assert.ok(Math.abs(cost.total.maxUsd - (1 + (305_000 / 1e9) * 200)) < 1e-12);
  assert.deepEqual(cost.deposit, { lamports: TOKEN_ACCOUNT_RENT_LAMPORTS, usd: (TOKEN_ACCOUNT_RENT_LAMPORTS / 1e9) * 200, known: false });
  assert.equal(cost.receiveUsd, null, "/build states no dollar figure; none is invented");
  assert.equal(BigInt(PRIORITY_CEILING_LAMPORTS), PRIORITY_FEE_CEILING_LAMPORTS, "the ceiling is the assembler's own");
  assert.equal(buyCostOf({ usd: 100, order: order({ signatureFeeLamports: "0" }), lane: "BUILD", solUsd: 200, quotedAt: "x" }).network.lamports, 5_000, "a signature always costs its base fee");
});

test("a quote on /order with no wallet that states a zero priority or deposit has not sized them: a range and an «if new», as on /build", () => {
  const cost = buyCostOf({ usd: 100, order: order({ priorityFeeLamports: "0", rentFeeLamports: "0" }), lane: "ORDER", solUsd: 200, quotedAt: "x" });
  assert.equal(cost.network.priorityKnown, false);
  assert.equal(cost.network.maxLamports, null, "Jupiter's /order bytes carry no ceiling Ryntra can promise");
  assert.equal(cost.total.maxUsd, null);
  assert.deepEqual(cost.deposit, { lamports: TOKEN_ACCOUNT_RENT_LAMPORTS, usd: (TOKEN_ACCOUNT_RENT_LAMPORTS / 1e9) * 200, known: false });
  const gasless = buyCostOf({ usd: 100, order: order({ gasless: true, priorityFeeLamports: "0", rentFeeLamports: "0" }), lane: "ORDER", solUsd: 200, quotedAt: "x" });
  assert.equal(gasless.network.priorityKnown, true, "a gasless order costs the buyer no network fee at all");
  assert.equal(gasless.deposit.lamports, 0);
});

