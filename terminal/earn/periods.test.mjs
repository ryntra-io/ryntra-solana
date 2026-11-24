import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { CATALOG_PERIODS, mapCatalogPage } from "../../lib/liquidity/catalog/model.ts";
import { earnPeriods, earnPools } from "../../lib/earn-pools/model.ts";
import { periodsOf } from "./catalog.ts";
import { START_FILTERS, START_PERIOD, START_SORT, chooseRows, coinMatch, figuresOf, filterRows, savedRows, sortRows, withPeriods } from "./choose.ts";
import { SAVED_POOLS_MAX, parseSavedPools, toggledPool } from "./saved-pools.ts";
import { EARN } from "./words.ts";

/* The pools' table: the window it reads, a pool found by its address, the person's own pools, one measure. */

const page = (name) => JSON.parse(readFileSync(new URL(`../../lib/liquidity/catalog/fixtures/${name}`, import.meta.url), "utf8"));
const rawDlmm = page("dlmm-catalog-2026-10-16.json");
const dlmm = mapCatalogPage(rawDlmm, "dlmm").pools;
const damm = mapCatalogPage(page("damm-v2-catalog-2026-10-16.json"), "damm-v2").pools;
const all = [...dlmm, ...damm];
const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

const rowsOf = (periods = new Map()) =>
  withPeriods(chooseRows({ catalog: earnPools(all), harbor: [], addOpen: false, proPiers: [], rows: [] }), periods);

test("the catalogue carries the venue's own windows, each as read — 30 min, 1 h, 2 h, 24 h; none worked out", () => {
  assert.deepEqual([...CATALOG_PERIODS], ["30m", "1h", "2h", "24h"]);
  const first = dlmm[0];
  const raw = rawDlmm.data.find((entry) => entry.address === first.address);
  for (const period of CATALOG_PERIODS) {
    assert.equal(first.periods[period].volumeUsd, raw.volume[period]);
    assert.equal(first.periods[period].feesUsd, raw.fees[period]);
  }
  // The day's window is the figure the table always had.
  assert.equal(first.periods["24h"].feesUsd, first.fees24hUsd);
  // A window the venue did not state is empty, never a zero.
  const blank = mapCatalogPage({ data: [{ ...rawDlmm.data[0], volume: { "24h": 5 }, fees: {} }] }, "dlmm").pools[0];
  assert.equal(blank.periods["1h"].volumeUsd, null);
  assert.equal(blank.periods["24h"].volumeUsd, 5);
  assert.equal(blank.periods["24h"].feesUsd, null);
});

test("the windows' answer: the chooser's pools in its order, read back by pool; a broken body is no answer", () => {
  const periods = earnPeriods(all);
  assert.deepEqual(
    periods.map((entry) => entry.address),
    earnPools(all).map((row) => row.address),
  );
  const back = periodsOf(JSON.parse(JSON.stringify({ pools: periods, at: null })));
  assert.equal(back.size, periods.length);
  assert.equal(periodsOf({ nope: [] }), null);
  assert.equal(periodsOf(null), null);
});

test("a row's figures by window: the day is the row's own; a shorter one the venue's, fees over what the pool holds now", () => {
  const rows = rowsOf(new Map(earnPeriods(all).map((entry) => [entry.address, entry.periods])));
  const row = rows.find((entry) => entry.periods?.["1h"]?.feesUsd > 0);
  assert.ok(row, "a pool with an hour's fees");
  const day = figuresOf(row, "24h");
  assert.equal(day.feesUsd, row.fees24hUsd);
  assert.equal(day.feeTvlPct, row.feeTvlPct);
  const hour = figuresOf(row, "1h");
  assert.equal(hour.feesUsd, row.periods["1h"].feesUsd);
  assert.ok(Math.abs(hour.feeTvlPct - (row.periods["1h"].feesUsd / row.tvlUsd) * 100) < 1e-12);
  // No window read: the place stays empty, never a zero.
  const bare = rowsOf().find((entry) => entry.address === row.address);
  assert.deepEqual(figuresOf(bare, "1h"), { volumeUsd: null, feesUsd: null, feeTvlPct: null, floor: false });
});

test("DLMM Pro's pools are counted by the day alone: a shorter window leaves their places empty", () => {
  const pro = { key: "pro:P", type: "pro", address: "Pro1111111111111111111111111111111111111111", name: "MET · SOL", coins: [{ mint: "a", symbol: "MET" }, { mint: "b", symbol: "SOL" }], verified: true, tvlUsd: 1000, volume24hUsd: 500, fees24hUsd: 5, feeTvlPct: 0.5, baseFeePct: 0.3, feePct: 0.3, step: 30, createdAt: null, page: null, act: "view", dayFloor: true };
  const withWindows = withPeriods([pro], new Map([[pro.address, { "1h": { volumeUsd: 9, feesUsd: 9 } }]]));
  assert.equal(withWindows[0].periods, undefined, "a Pro row takes no window from the catalogue");
  assert.deepEqual(figuresOf(pro, "1h"), { volumeUsd: null, feesUsd: null, feeTvlPct: null, floor: false });
  assert.equal(figuresOf(pro, "24h").floor, true, "a day read in part stays «≥»");
});

test("the order follows the window the table reads; the start is the day", () => {
  assert.equal(START_PERIOD, "24h");
  const rows = rowsOf(new Map(earnPeriods(all).map((entry) => [entry.address, entry.periods])));
  const hour = sortRows(rows, START_SORT, "30m");
  const values = hour.map((row) => figuresOf(row, "30m").feesUsd).filter((value) => value !== null);
  for (let at = 1; at < values.length; at++) assert.ok(values[at - 1] >= values[at]);
  assert.deepEqual(
    sortRows(rows, START_SORT).map((row) => row.address),
    sortRows(rows, START_SORT, "24h").map((row) => row.address),
  );
});

test("a search finds a pool by its own address, as it finds a coin by its address or its symbol", () => {
  const rows = rowsOf();
  const row = rows[0];
  assert.ok(coinMatch(row, row.address));
  assert.ok(coinMatch(row, ` ${row.address} `));
  assert.ok(coinMatch(row, row.coins[0].mint));
  assert.ok(coinMatch(row, row.coins[0].symbol.slice(0, 2)));
  assert.ok(!coinMatch(row, "1111111111111111111111111111111111111111111"));
  assert.deepEqual(
    filterRows(rows, { ...START_FILTERS, coin: row.address, minTvl: 0, minVolume: 0, verified: false }).map((entry) => entry.address),
    [row.address],
  );
});

test("«Saved» keeps the pools a person starred, each once, the newest last; it shows every one, whatever the filters", () => {
  const a = "PoaA1111111111111111111111111111111111111111";
  const b = "PoaB2222222222222222222222222222222222222222";
  assert.deepEqual(toggledPool([], a), [a]);
  assert.deepEqual(toggledPool([a, b], a), [b]);
  assert.deepEqual(toggledPool([a], "not a pool"), [a]);
  assert.deepEqual(parseSavedPools(JSON.stringify([a, a, "x", 3, b])), [a, b]);
  assert.deepEqual(parseSavedPools("{broken"), []);
  assert.deepEqual(parseSavedPools(null), []);
  const ABC = "123456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  const many = Array.from({ length: SAVED_POOLS_MAX + 5 }, (_, at) => `PoaC${"1".repeat(38)}${ABC[Math.floor(at / ABC.length)]}${ABC[at % ABC.length]}`);
  assert.equal(parseSavedPools(JSON.stringify(many)).length, SAVED_POOLS_MAX);
  assert.equal(parseSavedPools(JSON.stringify(many)).at(-1), many.at(-1), "the newest stay");
  const rows = rowsOf();
  const shallow = rows.at(-1);
  const kept = savedRows(rows, [shallow.address]);
  assert.deepEqual(kept.map((row) => row.address), [shallow.address]);
});

test("one measure on the desk and the phone, in the text's own colour; the cards' figure is no green promise", () => {
  for (const lang of ["en", "uk"]) {
    const w = EARN[lang];
    assert.equal(w.phoneFees, w.cFeeTvlDay, `${lang}: the phone's head names the desk's measure`);
    assert.doesNotMatch(w.sStable, /stable|стабільн/i, `${lang}: a set of SOL · USDC is not «stable»`);
    assert.doesNotMatch(w.sHigh, /income|дохід/i, `${lang}: a past day's fees are not an «income»`);
    for (const period of ["30m", "1h", "2h", "24h"]) assert.ok(w.periodName(period).length > 0);
  }
  const chooser = read("./Chooser.tsx");
  assert.doesNotMatch(chooser, /tone=\{row\.feeTvlPct/, "the table's bold figure is not mint");
  assert.doesNotMatch(chooser, /feeTvlPct > 0 && e\.up/, "the phone's figure is not mint");
  const css = read("./earn.module.css");
  const figure = css.slice(css.indexOf(".cardFigure {"), css.indexOf("}", css.indexOf(".cardFigure {")));
  assert.match(figure, /color: var\(--ice\)/);
  assert.doesNotMatch(figure, /--mint/);
});
