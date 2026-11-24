import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { mapCatalogPage } from "../../../lib/liquidity/catalog/model.ts";
import { proDaysOf, shelfOf, noShelf } from "../../../lib/stocks/pools-shelf.ts";
import { lookalikeOf } from "../../../lib/world/text-safety/lookalike.ts";
import { poolHref, TICKET_TABS } from "../../pool/desk-pool.ts";
import { actionOf, dayText, depthText, hrefOf, logoOf, logosAfter, pctText, SHELF_SHOWN, shelfShown, shownPools } from "./shelf-view.ts";
import { STOCK_POOLS } from "./words.ts";

/* A stock's pools on its page: which rows stand, each row's one action and where it leads, the figures as
   text, the words, and how the coin's page mounts the shelf. On the answers recorded beside the shelf's read. */

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const code = (path) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const fixture = JSON.parse(read("../../../lib/stocks/pools-shelf.fixture.json"));
const NOW = Date.parse("2026-11-20T15:00:00.000Z");
const statesOf = (raw) => (raw ? { step: raw.step, pools: new Map(raw.pools.map((state) => [state.pool, state])) } : null);
const shelf = (stock, over = {}) =>
  shelfOf({
    mint: stock.mint,
    symbol: stock.symbol,
    nowMs: NOW,
    dlmm: mapCatalogPage(stock.dlmmPage, "dlmm").pools,
    pro: stock.pro,
    proDays: proDaysOf(statesOf(stock.states), stock.pro.map((row) => row.address)),
    ladder: stock.ladder,
    deposits: { dlmm: true, pro: true },
    passesFor: (symbol, mint) => lookalikeOf(symbol, mint) !== null,
    ...over,
  });
const OPEN = { dlmm: true, pro: true };
const OFF = { dlmm: false, pro: false };

test("the shelf shows only for a stock with a pool: a coin that is no stock, no pools, or nothing read shows nothing", () => {
  assert.equal(shelfShown(shelf(fixture.ant)), true);
  assert.equal(shelfShown(noShelf(fixture.ant.mint, NOW)), false);
  assert.equal(shelfShown({ ...shelf(fixture.ant), pools: [] }), false);
  assert.equal(shelfShown(null), false);
});

test("one action a row: the limit where the stock's limits rest, else the deposit this build offers, else none", () => {
  const ant = shelf(fixture.ant);
  const pro = ant.pools.find((pool) => pool.venue === "dlmm-pro");
  const usdc = ant.pools[0];
  assert.equal(actionOf(pro, OPEN), "limit", "the limit leads even where a deposit is open too");
  assert.equal(actionOf(pro, OFF), "limit", "the ladder is the engine's own, whatever the deposit's switches");
  assert.equal(actionOf(usdc, OPEN), "deposit");
  assert.equal(actionOf(usdc, OFF), null, "a build that does not offer the deposit draws no button");
  assert.equal(actionOf(usdc, { dlmm: false, pro: true }), null);
  const closed = shelf(fixture.ant, { deposits: { dlmm: false, pro: false } });
  assert.ok(closed.pools.every((pool) => actionOf(pool, OPEN) !== "deposit"), "the engine takes no new money: no deposit");
});

test("each action opens the pool's own page on the ticket's tab of that flow; the pair opens the pool", () => {
  const pool = { address: "Cuwq452DQpCoti14YML8f8WMCeahTDt1T5hnC75Vcu8N" };
  assert.equal(hrefOf(pool, "limit"), poolHref(pool.address, "limit"));
  assert.equal(hrefOf(pool, "deposit"), poolHref(pool.address, "position"));
  assert.equal(hrefOf(pool, null), poolHref(pool.address));
  assert.ok(TICKET_TABS.includes("limit") && TICKET_TABS.includes("position"), "the pool page knows both tabs");
});

test("four rows stand open, the pool of the limits among them; «All pools» opens the rest", () => {
  const pools = shelf(fixture.ant).pools;
  assert.equal(pools.length, 6);
  const shown = shownPools(pools, false);
  assert.equal(shown.length, SHELF_SHOWN);
  assert.ok(shown.some((pool) => pool.limit), "the thin DLMM Pro pool of the limits is not hidden behind «All pools»");
  assert.deepEqual(shown.slice(0, 3), pools.slice(0, 3), "the deepest stay first");
  assert.equal(shownPools(pools, true).length, 6);
  assert.equal(shownPools(shelf(fixture.tsla).pools, false).length, 2);
});

test("the figures as a person reads them, in both languages", () => {
  const [first] = shelf(fixture.ant).pools;
  const pro = shelf(fixture.ant).pools.find((pool) => pool.venue === "dlmm-pro");
  assert.equal(pctText(0.8, "en"), "0.8%");
  assert.equal(pctText(0.8, "uk"), "0,8%");
  assert.equal(pctText(0.32, "en"), "0.32%");
  assert.equal(pctText(Number.NaN, "en"), "—");
  assert.match(depthText(first, "en"), /^\$799/);
  assert.deepEqual(dayText(pro, "en"), { text: dayText(pro, "en").text, floor: true }, "a day counted in part is a floor");
  assert.equal(dayText(first, "en").floor, false);
  assert.equal(dayText({ volume24hUsd: null, volumeWhole: null }, "en"), null, "no figure is «—», never 0");
  assert.equal(depthText(pro, "en"), "$1.6K", "a thin pool keeps a tenth, never rounds up to $2K");
  assert.equal(depthText(pro, "uk"), "$1,6K");
  assert.equal(depthText({ tvlUsd: 640 }, "en"), "$640");
  assert.equal(STOCK_POOLS.uk.dayFloor("$186"), "≥$186 за добу");
  assert.equal(STOCK_POOLS.en.bonus("0.32%"), "Bonus +0.32%");
});

test("the actions say what the task names: «Deposit» and «Limit with bonus»", () => {
  assert.equal(STOCK_POOLS.uk.deposit, "Вкласти");
  assert.equal(STOCK_POOLS.uk.limit, "Лімітка з бонусом");
  assert.equal(STOCK_POOLS.en.deposit, "Deposit");
  assert.equal(STOCK_POOLS.en.limit, "Limit with bonus");
  for (const lang of ["en", "uk"]) {
    const said = Object.values(STOCK_POOLS[lang]).map((value) => (typeof value === "string" ? value : value("ANT", "SOL"))).join(" ");
    assert.doesNotMatch(said, /bin step|program|tick|\bAPI\b|x1000|guarant|гарант|без ризику/i, `${lang}: nothing technical, no promise`);
  }
});

test("logos: the engine's own address, USDC from the site, the catalogue's next", () => {
  assert.equal(logoOf(fixture.ant.mint), `/api/icon/${fixture.ant.mint}`);
  assert.equal(logoOf("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"), "/site/universe/USDC.png");
  assert.deepEqual(logosAfter("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"), []);
  assert.deepEqual(logosAfter(fixture.ant.mint), [`/api/spot/icon?mint=${fixture.ant.mint}`]);
});

test("the coin's page mounts the shelf in one line under the stock's facts, never in the phone's sheet", () => {
  const screen = code("../../coin/CoinScreen.tsx");
  const mounts = screen.match(/<StockPoolsShelf\b[^>]*\/>/g) ?? [];
  assert.equal(mounts.length, 1);
  assert.match(screen, /\{stock && flow \? <StockPoolsShelf mint=\{mint\} facts=\{false\} \/> : null\}/);
  assert.ok(screen.indexOf("<StockCoinFacts") < screen.indexOf("<StockPoolsShelf"), "under the stock's facts, which say the hours and the rights");
});

test("the shelf reads only: its one door, its links and its kit — no wallet, no signature, no ticket of its own", () => {
  const shelfCode = code("./StockPoolsShelf.tsx");
  const hook = code("./useStockPools.ts");
  assert.match(hook, /\/api\/v1\/stocks\/pools\?mint=/);
  for (const source of [shelfCode, hook]) assert.doesNotMatch(source, /useWallet|signTransaction|sendTransaction|\/review|\/submit|<Action\b/);
  assert.match(shelfCode, /useStockPoolFacts\(mint, stockFacts\)/, "the stock's facts are the coin's own read, shared");
  assert.match(shelfCode, /<QuietLink href=\{hrefOf\(pool, action\)\}/, "each action is a quiet link: the page's one amber action stays the ticket's");
});
