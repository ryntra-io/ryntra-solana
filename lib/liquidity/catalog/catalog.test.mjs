import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  CATALOG_MIN_TVL_USD,
  catalogRows,
  catalogUrl,
  cleanSearch,
  isPoolAddress,
  mapCatalogPage,
  mapCatalogPool,
  matchCatalog,
  mergeCatalog,
} from "./model.ts";
import { positionView, rankPositions, unitsOf } from "./positions.ts";
import { binsSpanPct, movedPrice, simulateBins, simulateRange } from "./simulate.ts";

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
const DLMM_PAGE = fixture("dlmm-catalog-2026-10-16.json");
const DAMM_PAGE = fixture("damm-v2-catalog-2026-10-16.json");

const SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const close = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(a), Math.abs(b));

test("a DLMM page maps to catalogue pools with the venue's own figures and no projected yield", () => {
  const page = mapCatalogPage(DLMM_PAGE, "dlmm");
  assert.ok(page);
  assert.equal(page.total, DLMM_PAGE.total);
  assert.equal(page.pools.length, DLMM_PAGE.data.length);
  const first = page.pools[0];
  const raw = DLMM_PAGE.data[0];
  assert.equal(first.kind, "dlmm");
  assert.equal(first.address, raw.address);
  assert.equal(first.x.symbol, raw.token_x.symbol);
  assert.equal(first.tvlUsd, raw.tvl);
  assert.equal(first.volume24hUsd, raw.volume["24h"]);
  assert.equal(first.fees24hUsd, raw.fees["24h"]);
  assert.equal(first.binStepBps, raw.pool_config.bin_step);
  /* The API's `dynamic_fee_pct` is the variable part alone: the fee a trade pays is the base plus it, never below the base. */
  for (const pool of page.pools) {
    const record = DLMM_PAGE.data.find((r) => r.address === pool.address);
    assert.ok(close(pool.dynamicFeePct, record.pool_config.base_fee_pct + record.dynamic_fee_pct));
    assert.ok(pool.dynamicFeePct >= pool.baseFeePct);
  }
  assert.equal(first.range, null);
  assert.equal(first.source.page, `https://app.meteora.ag/dlmm/${raw.address}`);
  /* The venue's APR and fee-to-TVL ratio are a day stretched over a year; the model does not carry them. */
  for (const pool of page.pools) for (const key of Object.keys(pool)) assert.ok(!/apr|apy|ratio/i.test(key), key);
});

test("a DAMM v2 page keeps the pool's range, reads the program's extremes as no bound, and marks compounding", () => {
  const page = mapCatalogPage(DAMM_PAGE, "damm-v2");
  assert.ok(page);
  for (const pool of page.pools) {
    assert.equal(pool.kind, "damm-v2");
    assert.equal(pool.binStepBps, null);
    assert.equal(pool.dynamicFeePct, null);
    assert.ok(pool.range);
    const raw = DAMM_PAGE.data.find((r) => r.address === pool.address);
    if (raw.pool_config.max_price >= 1e15) assert.equal(pool.range.maxPrice, null);
    if (raw.pool_config.min_price < 1e-15) assert.equal(pool.range.minPrice, null);
    assert.equal(pool.compounding, raw.pool_config.collect_fee_mode === 2);
  }
  const bounded = page.pools.find((pool) => pool.range.minPrice !== null && pool.range.maxPrice !== null);
  assert.ok(bounded, "the fixture holds a concentrated pool with both bounds");
  assert.ok(bounded.range.minPrice < bounded.range.maxPrice);
});

test("a blacklisted record is never listed, but its own page reads it with the flag", () => {
  const raw = { ...DLMM_PAGE.data[0], is_blacklisted: true };
  const page = mapCatalogPage({ total: 1, data: [raw, raw] }, "dlmm");
  assert.equal(page.pools.length, 0);
  assert.equal(mapCatalogPool(raw, "dlmm").blacklisted, true);
});

test("records the catalogue cannot stand behind are dropped, not guessed", () => {
  assert.equal(mapCatalogPool({ ...DLMM_PAGE.data[0], address: "not-an-address" }, "dlmm"), null);
  assert.equal(mapCatalogPool({ ...DLMM_PAGE.data[0], token_x: null }, "dlmm"), null);
  assert.equal(mapCatalogPage({ pools: [] }, "dlmm"), null);
  const negative = mapCatalogPool({ ...DLMM_PAGE.data[0], tvl: -5, volume: { "24h": "lots" } }, "dlmm");
  assert.equal(negative.tvlUsd, null);
  assert.equal(negative.volume24hUsd, null);
});

test("the catalogue asks the venue for deep, unflagged pools, the most traded first, and a clean search only", () => {
  const url = new URL(catalogUrl("dlmm", null));
  assert.equal(url.origin, "https://dlmm.datapi.meteora.ag");
  assert.equal(url.searchParams.get("sort_by"), "volume_24h:desc");
  assert.equal(url.searchParams.get("filter_by"), `is_blacklisted=false && tvl>=${CATALOG_MIN_TVL_USD}`);
  assert.equal(url.searchParams.get("query"), null);
  assert.equal(new URL(catalogUrl("damm-v2", "SOL USDC")).searchParams.get("query"), "SOL USDC");
  assert.equal(cleanSearch("  jup "), "jup");
  assert.equal(cleanSearch("a&filter_by=x"), null);
  assert.equal(cleanSearch(""), null);
  assert.equal(cleanSearch(["x"]), null);
  assert.ok(isPoolAddress(SOL));
  assert.ok(!isPoolAddress("0OIl"));
});

test("views, orders and the filter work over both venues; a pool in both pages appears once", () => {
  const dlmm = mapCatalogPage(DLMM_PAGE, "dlmm").pools;
  const damm = mapCatalogPage(DAMM_PAGE, "damm-v2").pools;
  const all = mergeCatalog([dlmm, damm, dlmm]);
  assert.equal(all.length, dlmm.length + damm.length);
  assert.ok(catalogRows(all, "dlmm", "tvl", "desc").every((pool) => pool.kind === "dlmm"));
  const byTvl = catalogRows(all, "all", "tvl", "desc");
  for (let i = 1; i < byTvl.length; i += 1) assert.ok((byTvl[i - 1].tvlUsd ?? -1) >= (byTvl[i].tvlUsd ?? -1));
  const asc = catalogRows(all, "all", "volume24h", "asc");
  for (let i = 1; i < asc.length; i += 1) assert.ok((asc[i - 1].volume24hUsd ?? -1) <= (asc[i].volume24hUsd ?? -1));
  assert.ok(matchCatalog(all, "sol").length > 0);
  const pair = matchCatalog(all, "sol usdc").map((p) => p.address);
  assert.ok(pair.length > 0);
  assert.deepEqual(matchCatalog(all, "SOL/USDC").map((p) => p.address), pair);
  assert.deepEqual(matchCatalog(all, "usdc-sol").map((p) => p.address), pair);
  assert.ok(matchCatalog(all, "usdc").every((pool) => pool.name.toLowerCase().includes("usdc") || pool.x.symbol.toLowerCase().includes("usdc") || pool.y.symbol.toLowerCase().includes("usdc")));
  assert.deepEqual(matchCatalog(all, all[0].address.toLowerCase()).map((p) => p.address), [all[0].address]);
  assert.equal(matchCatalog(all, "").length, all.length);
});

test("holding against a full-range pool: the textbook loss of a constant-product curve", () => {
  /* Price ×4: the pool is worth 2·√4 / (1 + 4) of holding — 20 % less. */
  const four = simulateRange({ min: null, max: null, price: 100, nextPrice: 400, value: 1000 });
  assert.ok(close(four.pool / four.hold, 0.8));
  assert.ok(close(four.differencePct, -20));
  assert.ok(close(four.breakEvenFees, four.hold - four.pool));
  assert.equal(four.inRange, true);
  const still = simulateRange({ min: null, max: null, price: 100, nextPrice: 100, value: 1000 });
  assert.ok(close(still.pool, 1000));
  assert.ok(close(still.hold, 1000));
  assert.equal(still.breakEvenFees, 0);
  /* A narrower range loses more for the same move, and past its top holds only Y. */
  const narrow = simulateRange({ min: 80, max: 125, price: 100, nextPrice: 150, value: 1000 });
  const wide = simulateRange({ min: null, max: null, price: 100, nextPrice: 150, value: 1000 });
  assert.ok(narrow.differencePct < wide.differencePct);
  assert.equal(narrow.inRange, false);
  assert.ok(close(narrow.holds.x, 0));
  assert.equal(simulateRange({ min: 200, max: 100, price: 100, nextPrice: 150, value: 1 }), null);
});

test("DLMM bins: a rise sells X bin by bin, a fall buys it, and leaving the range leaves one token", () => {
  const base = { binStepBps: 25, price: 100, below: 10, above: 10, value: 2100 };
  const still = simulateBins({ ...base, nextPrice: 100 });
  assert.ok(close(still.pool, 2100));
  assert.ok(close(still.hold, 2100));
  const up = simulateBins({ ...base, nextPrice: 120 });
  assert.equal(up.inRange, false);
  assert.ok(close(up.holds.x, 0), "every X bin was crossed and sold");
  assert.ok(up.pool < up.hold, "selling on the way up trails holding");
  const down = simulateBins({ ...base, nextPrice: 80 });
  assert.equal(down.inRange, false);
  assert.ok(close(down.holds.y, 0), "every Y bin was crossed and spent");
  assert.ok(down.pool < down.hold);
  const inside = simulateBins({ ...base, nextPrice: 101 });
  assert.equal(inside.inRange, true);
  assert.ok(inside.holds.x > 0 && inside.holds.y > 0);
  assert.equal(simulateBins({ ...base, nextPrice: 0 }), null);
  assert.equal(simulateBins({ ...base, below: -1, nextPrice: 100 }), null);
  assert.ok(close(binsSpanPct(100, 1).up, 1));
  /* A bin step of 100 over 34 bins: +40.3 % up but −28.7 % down, never "±40 %". */
  assert.ok(close(binsSpanPct(100, 34).up, (1.01 ** 34 - 1) * 100));
  assert.ok(close(binsSpanPct(100, 34).down, (1 - 1.01 ** -34) * 100));
  assert.ok(binsSpanPct(100, 34).down < binsSpanPct(100, 34).up);
  assert.equal(movedPrice(10, -100), null);
  assert.ok(close(movedPrice(10, 50), 15));
});

const position = (overrides = {}) => ({
  venue: "meteora-dlmm",
  network: "solana",
  address: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
  pool: "5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6",
  owner: "J7zLmXcKnqbP6Gk1ecDRdXcPtNiFcwpwVwvmMjqXBnPC",
  feeRecipient: "J7zLmXcKnqbP6Gk1ecDRdXcPtNiFcwpwVwvmMjqXBnPC",
  nftMint: null,
  range: { kind: "bins", lowerBin: -10, upperBin: 10, lowerPrice: "180.5", upperPrice: "220.25" },
  rangeState: "in_range",
  amounts: { x: { units: "1500000000", asset: SOL, decimals: 9 }, y: { units: "250000000", asset: USDC, decimals: 6 } },
  unclaimedFees: { x: { units: "1000000", asset: SOL, decimals: 9 }, y: { units: "500000", asset: USDC, decimals: 6 } },
  unclaimedRewards: [],
  lockedBps: 0,
  source: { kind: "chain", program: "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo", slot: 373_000_000, at: 1_760_620_000_000 },
  ...overrides,
});

test("a position reads in each token's unit and in USD at the venue's prices, with both sources' times", () => {
  const record = mapCatalogPool(DLMM_PAGE.data.find((r) => r.token_x.address === SOL && r.token_y.address === USDC), "dlmm");
  const view = positionView(position(), "dlmm", record, "2026-10-16T18:00:00.000Z");
  assert.equal(view.x.symbol, "SOL");
  assert.equal(view.y.symbol, "USDC");
  assert.ok(close(view.x.amount, 1.5));
  assert.ok(close(view.y.amount, 250));
  assert.ok(close(view.valueUsd, 1.5 * record.x.priceUsd + 250 * record.y.priceUsd));
  assert.ok(close(view.unclaimedUsd, 0.001 * record.x.priceUsd + 0.5 * record.y.priceUsd));
  assert.equal(view.lower, 180.5);
  assert.equal(view.upper, 220.25);
  assert.equal(view.feesElsewhere, false);
  assert.equal(view.slot, 373_000_000);
  assert.equal(view.pricesAt, "2026-10-16T18:00:00.000Z");
  /* Without the venue's record the amounts stand and no USD is invented. */
  const bare = positionView(position(), "dlmm", null, null);
  assert.equal(bare.valueUsd, null);
  assert.equal(bare.pricesAt, null);
  assert.equal(bare.x.symbol, "So11…");
  const elsewhere = positionView(position({ feeRecipient: SOL, rangeState: "above" }), "dlmm", record, null);
  assert.equal(elsewhere.feesElsewhere, true);
  assert.equal(elsewhere.pricesAt, null);
  /* A full-range DAMM v2 position: the chain's extreme prices are no bounds. */
  const full = positionView(position({ venue: "meteora-damm2", range: { kind: "range", minPrice: "5.421214630269582e-23", maxPrice: "18446050713735950" } }), "damm-v2", null, null);
  assert.equal(full.lower, null);
  assert.equal(full.upper, null);
  const ranked = rankPositions([bare, view]);
  assert.equal(ranked[0], view);
});

test("base units read past a float's exact digits keep their size", () => {
  assert.ok(close(unitsOf({ units: "123456789012345678901234", asset: SOL, decimals: 6 }), 1.2345678901234568e17, 1e-12));
  assert.equal(unitsOf({ units: "0", asset: SOL, decimals: 9 }), 0);
  assert.equal(unitsOf({ units: "-1", asset: SOL, decimals: 9 }), 0);
});
