import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { mapCatalogPage, mapCatalogPool } from "../liquidity/catalog/model.ts";
import { lookalikeOf } from "../world/text-safety/lookalike.ts";
import {
  dlmmShelfPool,
  isPoolsShelf,
  noShelf,
  proDaysOf,
  proShelfPool,
  SHELF_MAX,
  SHELF_MIN_TVL_USD,
  shelfDeposits,
  shelfOf,
} from "./pools-shelf.ts";

/* A stock's pools on Meteora DLMM and DLMM Pro, on the answers recorded beside this test
   (`pools-shelf.fixture.json`: the live read of 19.11 for ANT, stand values where it says so). */

const fixture = JSON.parse(readFileSync(new URL("./pools-shelf.fixture.json", import.meta.url), "utf8"));
const NOW = Date.parse("2026-11-20T15:00:00.000Z");
const passesFor = (symbol, mint) => lookalikeOf(symbol, mint) !== null;
const statesOf = (raw) => (raw ? { step: raw.step, pools: new Map(raw.pools.map((state) => [state.pool, state])) } : null);

function inputOf(stock, over = {}) {
  const pro = stock.pro;
  return {
    mint: stock.mint,
    symbol: stock.symbol,
    nowMs: NOW,
    dlmm: mapCatalogPage(stock.dlmmPage, "dlmm").pools,
    pro,
    proDays: proDaysOf(statesOf(stock.states), pro.map((row) => row.address)),
    ladder: stock.ladder,
    deposits: { dlmm: true, pro: true },
    passesFor,
    ...over,
  };
}

const PRO_ANT = "Cuwq452DQpCoti14YML8f8WMCeahTDt1T5hnC75Vcu8N";
const ANT_USDC = "8GTCUyGQsVNq7cdWEszyNb6w9uiUo727BdGu6v7UmpdX";

test("ANT: every pool on DLMM and DLMM Pro, the deepest first, each with its figures", () => {
  const shelf = shelfOf(inputOf(fixture.ant));
  assert.equal(shelf.isStock, true);
  assert.equal(shelf.symbol, "ANT");
  assert.deepEqual(shelf.read, { dlmm: true, pro: true });
  assert.deepEqual(
    shelf.pools.map((pool) => [pool.venue, pool.other.symbol, pool.tvlUsd]),
    [
      ["dlmm", "USDC", 799000],
      ["dlmm", "USDC", 547000],
      ["dlmm", "USDC", 493000],
      ["dlmm", "SOL", 452000],
      ["dlmm", "SOL", 56000],
      ["dlmm-pro", "SOL", 1554],
    ],
  );
  const first = shelf.pools[0];
  assert.equal(first.address, ANT_USDC);
  assert.deepEqual(first.stock, { mint: fixture.ant.mint, symbol: "ANT" });
  assert.equal(first.feePct, 0.8);
  assert.equal(first.volume24hUsd, 2400000);
  assert.equal(first.volumeWhole, true);
  assert.equal(first.bonusPct, null, "a DLMM pool has no limit bonus");
  assert.equal(first.limit, false);
  assert.equal(first.deposit, true, "a stock against USDC takes the engine's deposit");
});

test("DLMM Pro: the pool of the stock's limits carries the bonus and the limit; its day is a floor until counted whole", () => {
  const pro = shelfOf(inputOf(fixture.ant)).pools.find((pool) => pool.venue === "dlmm-pro");
  assert.equal(pro.address, PRO_ANT);
  assert.equal(pro.feePct, 0.8);
  assert.equal(pro.bonusPct, 0.32);
  assert.equal(pro.limit, true);
  assert.equal(pro.volume24hUsd, 186.4);
  assert.equal(pro.volumeWhole, false);
  assert.equal(pro.deposit, true, "a pool of SOL against the stock, open to liquidity");
});

test("no empty pool and no fake: another mint's USDC, a blacklisted pool, dust, a test coin, an empty pool, another mint's pool", () => {
  const shelf = shelfOf(inputOf(fixture.ant));
  const shown = new Set(shelf.pools.map((pool) => pool.address));
  for (const raw of fixture.ant.dlmmPage.data) {
    const keep = raw.tvl >= SHELF_MIN_TVL_USD && !raw.is_blacklisted && raw.token_y.is_verified;
    assert.equal(shown.has(raw.address), keep, raw.address);
  }
  for (const row of fixture.ant.pro) assert.equal(shown.has(row.address), row.address === PRO_ANT, row.address);
  for (const pool of shelf.pools) assert.ok(pool.tvlUsd >= SHELF_MIN_TVL_USD);
});

test("a ticker that passes for another coin's stays off the shelf", () => {
  const raw = structuredClone(fixture.ant.dlmmPage.data[0]);
  raw.address = "AntLookStand22222222222222222222222222222222";
  raw.token_y = { ...raw.token_y, address: "LookUsdcStand2222222222222222222222222222222", symbol: "USDС", is_verified: true };
  assert.equal(dlmmShelfPool(mapCatalogPool(raw, "dlmm"), { mint: fixture.ant.mint, symbol: "ANT", passesFor }), null);
});

test("DAMM v2, a pool of two other coins and a DLMM Pro pool with its swaps shut are not the shelf's", () => {
  const raw = fixture.ant.dlmmPage.data[0];
  assert.equal(dlmmShelfPool(mapCatalogPool(raw, "damm-v2"), { mint: fixture.ant.mint, symbol: "ANT" }), null);
  assert.equal(dlmmShelfPool(mapCatalogPool(raw, "dlmm"), { mint: fixture.tsla.mint, symbol: "TSLAx" }), null);
  const shut = { ...fixture.ant.pro[0], open: { swap: false, deposits: true } };
  assert.equal(proShelfPool(shut, { mint: fixture.ant.mint, symbol: "ANT" }), null);
});

test("deposits: only where the engine takes new money for everyone and the pair is the deposit's own", () => {
  const closed = shelfOf(inputOf(fixture.ant, { deposits: { dlmm: false, pro: false } }));
  assert.ok(closed.pools.every((pool) => pool.deposit === false));
  const pro = shelfOf(inputOf(fixture.ant)).pools.find((pool) => pool.venue === "dlmm-pro");
  const noLiquidity = proShelfPool({ ...fixture.ant.pro[0], open: { swap: true, deposits: false } }, { mint: fixture.ant.mint, symbol: "ANT", deposits: { dlmm: true, pro: true } });
  assert.equal(pro.deposit, true);
  assert.equal(noLiquidity.deposit, false, "a pool shut to new liquidity");
  const switches = { seat: true, paused: false, dlmm: "open", dlmmStopped: false, pro: true, proStocks: true, proStopped: false };
  assert.deepEqual(shelfDeposits(switches), { dlmm: true, pro: true });
  assert.deepEqual(shelfDeposits({ ...switches, dlmm: "canary" }), { dlmm: false, pro: true }, "a canary serves one wallet, not the shelf");
  assert.deepEqual(shelfDeposits({ ...switches, paused: true }), { dlmm: false, pro: false }, "the issuer paused the token");
  assert.deepEqual(shelfDeposits({ ...switches, paused: null }), { dlmm: false, pro: false }, "the mint was not read: never on a guess");
  assert.deepEqual(shelfDeposits({ ...switches, seat: false }), { dlmm: false, pro: false }, "a pre-IPO token, or one its issuer stopped selling");
  assert.deepEqual(shelfDeposits({ ...switches, dlmmStopped: true, proStopped: true }), { dlmm: false, pro: false });
  assert.deepEqual(shelfDeposits({ ...switches, proStocks: false }), { dlmm: true, pro: false });
});

test("the limit: only on the ladder's own pool and while it takes orders", () => {
  const away = shelfOf(inputOf(fixture.ant, { ladder: { ...fixture.ant.ladder, pool: ANT_USDC } }));
  assert.ok(away.pools.every((pool) => pool.limit === false && pool.bonusPct === null), "a ladder in another pool lends its bonus to none of these");
  const shut = shelfOf(inputOf(fixture.ant, { ladder: { ...fixture.ant.ladder, placing: false } }));
  assert.ok(shut.pools.every((pool) => pool.limit === false && pool.bonusPct === null));
  const none = shelfOf(inputOf(fixture.ant, { ladder: null }));
  assert.ok(none.pools.every((pool) => pool.limit === false));
});

test("a venue that did not answer leaves its pools out and says so; a coin that is no stock has no shelf", () => {
  const noDlmm = shelfOf(inputOf(fixture.ant, { dlmm: null }));
  assert.deepEqual(noDlmm.read, { dlmm: false, pro: true });
  assert.deepEqual(noDlmm.pools.map((pool) => pool.venue), ["dlmm-pro"]);
  const noPro = shelfOf(inputOf(fixture.ant, { pro: null }));
  assert.deepEqual(noPro.read, { dlmm: true, pro: false });
  assert.equal(noPro.pools.length, 5);
  const none = shelfOf(inputOf(fixture.ant, { symbol: null }));
  assert.equal(none.isStock, false);
  assert.deepEqual(none.pools, []);
  assert.deepEqual(noShelf("x", NOW).pools, []);
});

test("TSLAx: two DLMM pools, no DLMM Pro, no bonus anywhere", () => {
  const shelf = shelfOf(inputOf(fixture.tsla));
  assert.deepEqual(shelf.pools.map((pool) => `${pool.stock.symbol}/${pool.other.symbol}`), ["TSLAx/USDC", "TSLAx/SOL"]);
  assert.ok(shelf.pools.every((pool) => pool.bonusPct === null && !pool.limit));
  assert.equal(Number(shelf.pools[0].feePct.toFixed(3)), 0.254, "the fee now: the base and the part that grows with volatility");
});

test("at most SHELF_MAX rows, the deepest, and the limit's pool kept however thin", () => {
  const many = Array.from({ length: 12 }, (_, i) => {
    const raw = structuredClone(fixture.ant.dlmmPage.data[0]);
    raw.address = `AntManyStand${"ABCDEFGHJKLMN"[i]}`.padEnd(44, "2");
    raw.tvl = 100000 + i * 1000;
    return mapCatalogPool(raw, "dlmm");
  });
  const shelf = shelfOf(inputOf(fixture.ant, { dlmm: many }));
  assert.equal(shelf.pools.length, SHELF_MAX);
  assert.ok(shelf.pools.some((pool) => pool.address === PRO_ANT), "the thin pool of the limits stays");
  assert.equal(shelf.pools[0].tvlUsd, 111000);
});

test("the day of a DLMM Pro pool: counted, written lately, after a step that ended — else none", () => {
  const states = statesOf(fixture.ant.states);
  assert.deepEqual([...proDaysOf(states, [PRO_ANT]).entries()], [[PRO_ANT, { usd: 186.4, whole: false }]]);
  assert.equal(proDaysOf({ ...states, step: { ...states.step, endedAgo: null } }, [PRO_ANT]).size, 0, "no step ended yet");
  const stale = { ...states, pools: new Map([[PRO_ANT, { ...states.pools.get(PRO_ANT), writtenAgo: 3_600_000 }]]) };
  assert.equal(proDaysOf(stale, [PRO_ANT]).size, 0, "a row the indexer no longer writes");
  assert.equal(proDaysOf(null, [PRO_ANT]).size, 0);
});

test("the screen's guard reads the answer and only it", () => {
  const shelf = JSON.parse(JSON.stringify(shelfOf(inputOf(fixture.ant))));
  assert.equal(isPoolsShelf(shelf), true);
  assert.equal(isPoolsShelf(shelf, fixture.ant.mint), true);
  assert.equal(isPoolsShelf(shelf, fixture.tsla.mint), false, "another mint's answer");
  assert.equal(isPoolsShelf({ ...shelf, pools: [{ ...shelf.pools[0], tvlUsd: "799000" }] }), false);
  assert.equal(isPoolsShelf(null), false);
});

test("the shelf is read only: the server's reader builds, signs and sends nothing", () => {
  const server = readFileSync(new URL("./pools-shelf.server.ts", import.meta.url), "utf8");
  const route = readFileSync(new URL("../../app/api/v1/stocks/pools/route.ts", import.meta.url), "utf8");
  for (const code of [server, route]) {
    assert.doesNotMatch(code, /sign|sendTransaction|Keypair|review\(|submit/i);
  }
  assert.match(route, /export async function GET/);
  assert.doesNotMatch(route, /export async function (POST|PUT|DELETE|PATCH)/);
  assert.match(route, /publicCacheHeaders\(60, 120\)/);
});
