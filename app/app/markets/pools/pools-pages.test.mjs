// «Ринки → Пули»: the catalogue and a pool's page stand on the core's overview page and read only — no route here
// builds a transaction, no Ryntra fee is drawn, no projected yield is shown, and every figure carries its source.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../../../../${path}`, import.meta.url), "utf8");

const CATALOG_PAGE = read("app/app/markets/pools/page.tsx");
const POOL_PAGE = read("app/app/markets/pools/[address]/page.tsx");
const CATALOG = read("app/app/markets/pools/pools-catalog.tsx");
const POSITIONS = read("app/app/markets/pools/my-positions.tsx");
const SIMULATOR = read("app/app/markets/pools/pool-simulator.tsx");
const DISTRIBUTION = read("app/app/markets/pools/pool-distribution.tsx");
const ROUTE = read("app/api/liquidity/positions/route.ts");
const CHAIN = read("lib/liquidity/catalog/chain.server.ts");
const WORDS = read("app/app/markets/pools/pools-words.ts");
const DOMAINS = read("app/shell/domains.ts");
const CONFIG = read("next.config.ts");

const NET = read("app/app/markets/pools/lp-net.tsx");
const WATCH = read("app/app/markets/pools/position-watch.tsx");
const ENTRIES = read("app/app/markets/pools/position-entries.ts");

const ALL = { CATALOG_PAGE, POOL_PAGE, CATALOG, POSITIONS, SIMULATOR, DISTRIBUTION, ROUTE, CHAIN, NET, WATCH, ENTRIES };

test("both pages are the core's overview page; the positions stand in its side column", () => {
  assert.match(CATALOG_PAGE, /<Page kind="overview"[^>]*aside=\{<MyPositions/);
  assert.match(POOL_PAGE, /<Page\s[\s\S]*kind="overview"[\s\S]*aside=\{<MyPositions locale=\{locale\} pool=\{address\} \/>\}/);
  assert.match(CATALOG, /<Table\s/, "the catalogue is the core's table");
  assert.match(POSITIONS, /<Block\s/, "the positions are the core's block");
});

const POOL_ACTION = read("app/app/markets/pools/pool-actions.tsx");
const ADD = read("app/app/markets/pools/add-liquidity.tsx");
const MANAGE = read("app/app/markets/pools/manage-position.tsx");
const API = read("app/app/markets/pools/liquidity-api.ts");
const ADD_PAGE = read("app/app/markets/pools/[address]/add/page.tsx");
const POSITION_PAGE = read("app/app/markets/pools/[address]/position/[position]/page.tsx");

test("the reading pages build, sign and send nothing; the pool page's one orange action is «Add liquidity»", () => {
  for (const [name, source] of Object.entries(ALL)) {
    assert.doesNotMatch(source, /\bbuild(Add|Remove|Claim)\b|previewAdd|previewRemove|previewClaim|signTransaction|sendTransaction/, `${name} builds nothing`);
    assert.doesNotMatch(source, /variant="primary"/, `${name} draws no orange action of its own`);
  }
  assert.match(POOL_PAGE, /action=\{chain\.ok \? <AddLiquidityAction /, "the pool page's action is the core page's action slot");
  assert.equal(POOL_ACTION.match(/variant="primary"/g)?.length, 1, "one orange action on the pool page");
  assert.match(WORDS, /after a live check with the smallest amount/, "the page says when actions come");
});

test("the action pages: the core's action page, one orange action, the wallet signs and the relay holds the bytes to the Review", () => {
  assert.match(ADD_PAGE, /<Page kind="action"/);
  assert.match(POSITION_PAGE, /<Page kind="action"/);
  for (const [name, source] of Object.entries({ ADD, MANAGE })) {
    assert.equal(source.match(/variant="primary"/g)?.length, 1, `${name}: one orange action`);
    assert.match(source, /<Review\b/, `${name}: the core's Review`);
    assert.match(source, /<RelayReceipt\b/, `${name}: a receipt`);
    assert.doesNotMatch(source, /useId\(/, `${name}: fixed ids, no drift under the page frame`);
  }
  assert.match(API, /signTransactions\(/, "the wallet signs");
  assert.match(API, /\/api\/liquidity\/submit/);
  assert.doesNotMatch(API, /sendTransaction|signAndSendTransaction/, "the browser never sends: the relay holds the bytes to the Review");
});

test("no projected yield and no Ryntra fee on a pool", () => {
  for (const [name, source] of Object.entries({ ...ALL, WORDS })) {
    assert.doesNotMatch(source, /\bapr\b|\bapy\b|fee_tvl_ratio/i, `${name}: no APR, APY or fee-to-TVL ratio`);
    assert.doesNotMatch(source, /ryntraFee|RYNTRA_FEE|feeBps:\s*\d/, `${name}: no fee of Ryntra's own`);
  }
  assert.match(WORDS, /No projected yield/);
});

test("every figure names where it came from and when", () => {
  assert.match(POOL_PAGE, /pool\.source\.slot[\s\S]*word\("sourceChain"\)[\s\S]*<ReadTime[\s\S]*word\("sourceData"\)[\s\S]*<ReadTime/, "a pool's facts: the chain's time with its slot on hover, the venue's read time");
  assert.match(CATALOG, /word\("sourceData"\)[\s\S]*<ReadTime/);
  assert.match(POSITIONS, /word\("sourceChain"\)[\s\S]*<ReadTime[\s\S]*word\("pricesFrom"\)[\s\S]*<ReadTime/);
  /* A read's time is worded in the reader's zone, after the page arrives — never by the server's clock. */
  for (const [name, source] of Object.entries({ POOL_PAGE, CATALOG, POSITIONS })) assert.doesNotMatch(source, /formatTime\(/, `${name} words no time on the server`);
});

test("Pools is a row of Заробіток at its address under Markets, and the old Robinhood redirect leaves its path alone", () => {
  /* Menu 3 (NAV-1): Пули is a row of its own; its page keeps the address it had as a tab of Ринки. */
  assert.match(DOMAINS, /pools: row\("pools", "\/app\/markets\/pools", \["\/app\/markets\/pools"\]\)/);
  assert.match(CONFIG, /source: "\/app\/markets\/:path\(\(\?!pools\(\?:\/\|\$\)\)\.\+\)"/);
  assert.doesNotMatch(CONFIG, /source: "\/app\/markets\/:path\+"/);
});

test("a wallet's positions are read from endpoints that answer owner-indexed reads", () => {
  assert.match(CHAIN, /REFUSES_INDEXED = new Set\(\["solana-rpc\.publicnode\.com"\]\)/);
  assert.match(ROUTE, /new FixedWindowLimiter\(\{ limit: 20, windowMs: 60_000/, "the route has its own tight window");
  assert.match(ROUTE, /isWalletKey\(owner\)/, "and takes a real key only");
  assert.match(CHAIN, /POSITIONS_DEADLINE_MS = 20_000/, "and answers before the function's limit");
});

test("the narrowed redirect, run through Next's own matcher: Pools stays, every other old path still goes", async () => {
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  const { pathToRegexp } = require("next/dist/compiled/path-to-regexp");
  const source = CONFIG.match(/source: "(\/app\/markets\/:path\(\(\?!pools[^"]+)"/)[1];
  const re = pathToRegexp(source, [], { strict: true, sensitive: false, delimiter: "/" });
  for (const path of ["/app/markets/pools", "/app/markets/pools/", "/app/markets/pools/5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6"]) assert.equal(re.test(path), false, path);
  for (const path of ["/app/markets/AAPL", "/app/markets/poolsx", "/app/markets/screener/add"]) assert.equal(re.test(path), true, path);
});

test("a busy search still filters: the top pools matched against the words asked, never the whole list under «Results for»", () => {
  const SERVICE = read("lib/liquidity/catalog/service.server.ts");
  assert.match(SERVICE, /searchAllowed\(nowMs\)\) return readPoolCatalog\(null, deps\)\.then\(\(top\) => \(\{ \.\.\.top, pools: matchCatalog\(top\.pools, search\), search, searchLimited: true \}\)\)/);
  assert.match(ROUTE, /hasFreshPositions\(owner\) \? FREE : POSITIONS_LIMITER\.consume/, "a cached wallet costs no token");
  assert.match(POSITIONS, /response\.status === 429/, "and a 429 is worded as too many reads, not as Solana's silence");
});

test("SOL-2b: a position's IL and net result stand under it; a rebalance is the person's own two signed steps; the net of a position is no promise", () => {
  assert.match(POSITIONS, /<WatchLines position=\{position\} entry=\{entry\}/, "every listed position carries its result or the line that the entry is missing");
  assert.match(MANAGE, /<PositionWatch\b/, "a position's page carries its result, its entry and the rebalance");
  /* A rebalance acts only through the page's own withdraw form (its Review, the wallet's signature) and the add page. */
  assert.match(WATCH, /onWithdrawAll/);
  assert.match(WATCH, /\/add\?rebalance=/);
  assert.doesNotMatch(WATCH, /reviewAction|signAndRelay|signTransactions|setInterval|setTimeout/, "nothing in the watch acts or runs by itself");
  assert.match(WORDS, /nothing runs by itself/);
  assert.match(MANAGE, /if \(relayed\.value\.settled\) \{[\s\S]*recordRemove[\s\S]*recordClaim/, "the entry follows only what landed");
  assert.match(ADD, /if \(relayed\.value\.settled\) \{[\s\S]*recordAdd\(/);
  /* The net: three outcomes under the person's assumptions, Ryntra's entry share 0 for a deposit without automation. */
  assert.match(NET, /RYNTRA_ENTRY_PCT = 0;/);
  assert.match(NET, /word\("netNotPromise"\)/);
  assert.match(WORDS, /not a forecast and not a promise of income/);
  assert.match(WORDS, /не прогноз і не обіцянка доходу/);
  assert.match(SIMULATOR, /<NetSimulator\b/);
});
