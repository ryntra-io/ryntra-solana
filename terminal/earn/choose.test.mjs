import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { mapCatalogPage } from "../../lib/liquidity/catalog/model.ts";
import { earnPoolOf, earnPools, lendRates } from "../../lib/earn-pools/model.ts";
import { SOL_USDC } from "../../city/lib/earn/pier-fixtures.mjs";
import {
  START_FILTERS,
  START_SORT,
  ageText,
  chooseRows,
  coinMatch,
  dayPctText,
  filterRows,
  floorText,
  sortRows,
  strategyFilters,
  strategyPick,
} from "./choose.ts";
import { sameTicket, ticketKey, ticketStands } from "./ticket.ts";

const page = (name) => JSON.parse(readFileSync(new URL(`../../lib/liquidity/catalog/fixtures/${name}`, import.meta.url), "utf8"));
const dlmm = mapCatalogPage(page("dlmm-catalog-2026-10-16.json"), "dlmm").pools;
const damm = mapCatalogPage(page("damm-v2-catalog-2026-10-16.json"), "damm-v2").pools;
const catalog = earnPools([...dlmm, ...damm]);

const SOL = "So11111111111111111111111111111111111111112";

function pool(over = {}) {
  return {
    kind: "dlmm",
    address: "Pool1111111111111111111111111111111111111111",
    x: { mint: SOL, symbol: "SOL", verified: true },
    y: { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", symbol: "USDC", verified: true },
    tvlUsd: 3_000_000,
    volume24hUsd: 23_800_000,
    fees24hUsd: 9_600,
    feeTvl24hPct: 0.32,
    baseFeePct: 0.04,
    feePct: 0.041,
    binStepBps: 4,
    createdAt: "2023-11-01T00:00:00.000Z",
    page: "https://www.meteora.ag/dlmm/Pool1111111111111111111111111111111111111111",
    ...over,
  };
}

test("the catalogue as the chooser's rows — both venues, no blacklisted or shallow pool, the most paid first", () => {
  assert.ok(catalog.length > 0);
  assert.ok(catalog.some((row) => row.kind === "dlmm"));
  assert.ok(catalog.some((row) => row.kind === "damm-v2"));
  for (const row of catalog) {
    assert.ok(row.tvlUsd >= 10_000);
    if (row.kind === "damm-v2") assert.equal(row.binStepBps, null);
    else assert.ok(row.binStepBps > 0);
    if (row.fees24hUsd !== null) assert.ok(Math.abs(row.feeTvl24hPct - (row.fees24hUsd / row.tvlUsd) * 100) < 1e-9);
  }
  for (let at = 1; at < catalog.length; at++) assert.ok((catalog[at - 1].fees24hUsd ?? -1) >= (catalog[at].fees24hUsd ?? -1));
  assert.equal(new Set(catalog.map((row) => row.address)).size, catalog.length, "each pool once");
  const blacklisted = dlmm.find((entry) => entry.blacklisted);
  if (blacklisted) assert.equal(earnPoolOf(blacklisted), null);
});

test("lending rates — a market without a rate is left out; supplied in dollars at the market's price", () => {
  const rates = lendRates([
    { asset: { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", symbol: "USDC", decimals: 6 }, rateAnnualPercent: 4.63, suppliedRaw: "2000000000000", priceUsd: 1 },
    { asset: { mint: "JuprjznTrTSp2UFa3ZBUFgwdAmtZCq4MQCwysN55USD", symbol: "JupUSD", decimals: 6 }, rateAnnualPercent: 6.94, suppliedRaw: null, priceUsd: 1 },
    { asset: { mint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", symbol: "USDT", decimals: 6 }, rateAnnualPercent: null, suppliedRaw: "1", priceUsd: 1 },
  ]);
  assert.deepEqual(
    rates.map((rate) => rate.symbol),
    ["JupUSD", "USDC"],
  );
  assert.equal(rates[1].suppliedUsd, 2_000_000);
  assert.equal(rates[0].suppliedUsd, null);
});

test("a pool the city adds to says the figures of the city's own read — the same the ticket stands on", () => {
  const listed = pool({ address: SOL_USDC.address, tvlUsd: 1, volume24hUsd: 2, fees24hUsd: 8_700, feeTvl24hPct: 3, feePct: 0.09 });
  const stranger = pool({ address: "Pool2222222222222222222222222222222222222222", fees24hUsd: 8_700 });
  const [row, other] = chooseRows({ catalog: [listed, stranger], harbor: [SOL_USDC], addOpen: true, proPiers: [], rows: [] });
  assert.deepEqual([row.tvlUsd, row.volume24hUsd, row.fees24hUsd, row.feePct], [SOL_USDC.tvlUsd, SOL_USDC.volume24hUsd, SOL_USDC.fees24hUsd, SOL_USDC.feePct]);
  assert.ok(Math.abs(row.feeTvlPct - (SOL_USDC.fees24hUsd / SOL_USDC.tvlUsd) * 100) < 1e-12);
  assert.equal(row.act, "add");
  /* What the catalogue alone knows stays the catalogue's: the base fee, the age, the page. */
  assert.deepEqual([row.baseFeePct, row.page, row.step], [listed.baseFeePct, listed.page, listed.binStepBps]);
  /* A pool shown to compare keeps the catalogue's figures. */
  assert.deepEqual([other.fees24hUsd, other.tvlUsd, other.act], [8_700, stranger.tvlUsd, "view"]);
  /* With the city's add closed the figures are still the city's read: the row never says two things by the switch. */
  assert.equal(chooseRows({ catalog: [listed], harbor: [SOL_USDC], addOpen: false, proPiers: [], rows: [] })[0].fees24hUsd, SOL_USDC.fees24hUsd);
});

test("rows — the city's pools add, DLMM Pro adds where it takes deposits, every other pool is shown to compare", () => {
  const harbor = [SOL_USDC];
  const fromCatalog = pool({ address: SOL_USDC.address });
  const other = pool({ address: "Other111111111111111111111111111111111111111", y: { mint: "TTwo1111111111111111111111111111111111111111", symbol: "TTWO", verified: true } });
  const rows = chooseRows({ catalog: [fromCatalog, other], harbor, addOpen: true, proPiers: [], rows: [] });
  assert.equal(rows.find((row) => row.address === SOL_USDC.address).act, "add");
  assert.equal(rows.find((row) => row.address === other.address).act, "view");
  assert.equal(rows.length, 2, "a city pool the catalogue carried is listed once");

  const closed = chooseRows({ catalog: [fromCatalog], harbor, addOpen: false, proPiers: [], rows: [] });
  assert.equal(closed[0].act, "view", "a wallet the add is closed to only compares");

  const onlyCity = chooseRows({ catalog: [], harbor, addOpen: true, proPiers: [], rows: [] });
  assert.equal(onlyCity.length, 1, "the city's own pools stand even when the catalogue did not answer");
  assert.equal(onlyCity[0].act, "add");
});

test("filters — floors, type, coin, verified, step and base bands; a missing figure never passes a floor", () => {
  const rows = chooseRows({
    catalog: [
      pool(),
      pool({ address: "B111111111111111111111111111111111111111111", kind: "damm-v2", binStepBps: null, tvlUsd: 40_000, volume24hUsd: 900_000, baseFeePct: 1 }),
      pool({ address: "C111111111111111111111111111111111111111111", x: { mint: "Junk111111111111111111111111111111111111111", symbol: "JUNK", verified: false }, binStepBps: 80, baseFeePct: 0.2 }),
      pool({ address: "D111111111111111111111111111111111111111111", volume24hUsd: null }),
    ],
    harbor: [],
    addOpen: true,
    proPiers: [],
    rows: [],
  });
  const start = filterRows(rows, START_FILTERS);
  assert.deepEqual(
    start.map((row) => row.address[0]),
    ["P"],
    "the start: deep, traded, verified",
  );
  assert.equal(filterRows(rows, { ...START_FILTERS, minTvl: 0, minVolume: 0, verified: false }).length, 4);
  assert.deepEqual(
    filterRows(rows, { ...START_FILTERS, minTvl: 0, minVolume: 0, verified: false, type: "damm-v2" }).map((row) => row.address[0]),
    ["B"],
  );
  assert.deepEqual(
    filterRows(rows, { ...START_FILTERS, minTvl: 0, minVolume: 0, verified: false, step: "wide" }).map((row) => row.address[0]),
    ["C"],
  );
  assert.deepEqual(
    filterRows(rows, { ...START_FILTERS, minTvl: 0, minVolume: 0, verified: false, base: "high" }).map((row) => row.address[0]),
    ["B"],
  );
  assert.ok(coinMatch(rows[0], "usd"));
  assert.ok(coinMatch(rows[0], SOL));
  assert.ok(!coinMatch(rows[0], "jup"));
  const city = chooseRows({ catalog: [], harbor: [], addOpen: true, proPiers: [{ address: "Pro1111111111111111111111111111111111111111", x: { mint: SOL, symbol: "SOL", decimals: 9 }, y: { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", symbol: "USDC", decimals: 6 }, solIsX: true, price: 140, feeBps: 25, tickSpacing: 10, tickId: 0, depthLamports: null, rewards: [], takesDeposits: true }], rows: [] });
  assert.equal(filterRows(city, START_FILTERS).length, 1, "a Pro pool with no day's volume is not hidden by the floors");
  assert.equal(city[0].act, "pro");
});

test("orders — a figure nobody stated goes last either way; strategies pick a pool that adds first", () => {
  const rows = chooseRows({
    catalog: [
      pool({ address: "A111111111111111111111111111111111111111111", fees24hUsd: 100, feeTvl24hPct: 2, tvlUsd: 200_000 }),
      pool({ address: "B111111111111111111111111111111111111111111", fees24hUsd: null, feeTvl24hPct: null }),
      pool({ address: "C111111111111111111111111111111111111111111", fees24hUsd: 500, feeTvl24hPct: 0.1 }),
    ],
    harbor: [],
    addOpen: true,
    proPiers: [],
    rows: [],
  });
  assert.deepEqual(
    sortRows(rows, START_SORT).map((row) => row.address[0]),
    ["C", "A", "B"],
  );
  assert.deepEqual(
    sortRows(rows, { key: "fees", dir: "asc" }).map((row) => row.address[0]),
    ["A", "C", "B"],
  );
  assert.equal(strategyPick(rows, "high").address[0], "A", "high income: fees to TVL, from a deep pool");
  const shown = chooseRows({ catalog: [pool({ address: "V111111111111111111111111111111111111111111", feeTvl24hPct: 5, tvlUsd: 300_000 }), pool({ address: "W111111111111111111111111111111111111111111", feeTvl24hPct: 1, tvlUsd: 300_000 })], harbor: [{ ...SOL_USDC, address: "W111111111111111111111111111111111111111111" }], addOpen: true, proPiers: [], rows: [] });
  assert.equal(strategyPick(shown, "high").address[0], "V", "high income names its top pool even if it is only compared");
  assert.equal(strategyPick(shown, "stable").address[0], "W", "stable pairs prefer the pool that adds from here");
  assert.equal(strategyFilters("high").minTvl, 100_000);
});

test("words of figures — a day's per cent, age, floors, in the language's own digits", () => {
  assert.equal(dayPctText(0.3214, "en"), "0.32%");
  assert.equal(dayPctText(0.0412, "uk"), "0,041%");
  assert.equal(dayPctText(null, "en"), "—");
  const now = Date.parse("2026-11-16T00:00:00Z");
  assert.equal(ageText("2026-10-15T00:00:00Z", "en", now), "32 d");
  assert.equal(ageText("2025-10-01T00:00:00Z", "uk", now), "13 міс");
  assert.equal(ageText("2023-10-01T00:00:00Z", "uk", now), "3 р");
  assert.equal(ageText(null, "en", now), "—");
  assert.equal(floorText(50_000, "usd", "en"), "> $50K");
  assert.equal(floorText(0.1, "pct", "uk"), "> 0,1%");
});

test("a pool shown to compare is a ticket of its own, standing while the chooser lists it", () => {
  const view = { kind: "view", address: "Other111111111111111111111111111111111111111" };
  assert.equal(ticketKey(view), "view:Other111111111111111111111111111111111111111");
  assert.ok(sameTicket(view, { ...view }));
  assert.ok(!sameTicket(view, { kind: "pool", address: view.address }));
  const figures = { pools: [], lendRate: null, lent: [], views: [], proBoats: [] };
  const kept = { boat: null, proBoat: null };
  assert.ok(ticketStands(view, figures, kept, (address) => address === view.address));
  assert.ok(!ticketStands(view, figures, kept, () => false));
});
