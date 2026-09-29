import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryGuardStore } from "../guard/store.ts";
import { setPositionWatch } from "./position-watch.ts";
import { readPortfolioRisk, RISK_PRICED_TOKENS_MAX, WRAPPED_SOL_MINT } from "./portfolio-risk.server.ts";
import { USDC_MINT } from "./portfolio-risk.ts";

/*
 * RYN-PROTECT-SIGNAL-001, subtask 2 — «Ризик портфеля» read on the server: the
 * positions as Нагляд judged them, every other token priced, the SOL balance,
 * and every read that failed named as a gap — never guessed.
 */

const OWNER = "F9pV233uBksW4U1BKiK7u9qShgXkwoR6F8MzU4FZYPUv";
const AAPLX = "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp";
const NVDAX = "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh";
const NVDAON = "gEGtLTPNQ7jcg25zTetkbmF7teoDLcrfTnQfmn2ondo";
const SPACEX = "PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh";
const JUP = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const SPAM = "SpamB2kzK2UbYbWWgDD8KZAKVCSrcWe6QaLmKnXJ8ptq";
/* Monday 2026-09-28, noon in Kyiv — a weekday in New York. */
const MONDAY = Date.parse("2026-09-28T09:00:00.000Z");
/* Friday 2026-10-02, 10:00 in New York. */
const FRIDAY = Date.parse("2026-10-02T14:00:00.000Z");
const seen = (nowMs) => new Date(nowMs - 60_000).toISOString();

const stockRow = (mint, symbol, company, price, nowMs, over = {}) => ({
  representation: { mint, symbol, name: `${symbol} token`, underlying: { symbol: company, name: company === "SPACEX" ? "SpaceX" : company, isin: null, listingCountry: null }, instrument: { class: company === "SPACEX" ? "pre-ipo" : "listed-equity", unitBasis: "share", rights: "economic" }, decimals: 8, tradingHalted: false },
  market: { priceUsd: price, observedAt: seen(nowMs), icon: null },
  multiplier: null,
  reference: { state: "current" },
  deviationPct: 0.1,
  session: { period: "market" },
  lifecycle: { state: "active" },
  ...over,
});

/* $1 per raw 1e8 of a company token priced at $1 000: raw 10_000_000 = 0.1 unit = $100. */
const units = (usd, price) => BigInt(Math.round((usd / price) * 1e8));

function deps({ nowMs = MONDAY, held, complete = true, lamports = 1_000_000_000n, prices, rows, readPrices, verified = new Set(), suspicious = new Set() } = {}) {
  const universeRows = rows ?? [stockRow(AAPLX, "AAPLx", "AAPL", 1000, nowMs), stockRow(NVDAX, "NVDAx", "NVDA", 1000, nowMs), stockRow(NVDAON, "NVDAon", "NVDA", 1000, nowMs), stockRow(SPACEX, "SPACEX", "SPACEX", 1000, nowMs)];
  const heldMap = held ?? new Map([[AAPLX, units(200, 1000)], [NVDAX, units(200, 1000)], [USDC_MINT, 450_000_000n]]);
  const decimals = new Map([[USDC_MINT, 6], [JUP, 6], [SPAM, 9], [AAPLX, 8], [NVDAX, 8], [NVDAON, 8], [SPACEX, 8]]);
  return {
    readHeld: async () => (held === null ? null : { held: heldMap, frozen: new Set(), complete, decimals }),
    readUniverse: async () => ({ ok: true, universe: { rows: universeRows } }),
    readTelegram: async () => true,
    readRows: async () => [],
    readSolBalance: async () => lamports,
    readPrices: readPrices ?? (async (mints) => new Map(mints.filter((mint) => prices?.[mint] !== undefined || mint === WRAPPED_SOL_MINT).map((mint) => [mint, { usd: mint === WRAPPED_SOL_MINT ? 150 : prices[mint], symbol: mint === JUP ? "JUP" : null, name: mint === JUP ? "Jupiter" : null, verified: verified.has(mint) || mint === WRAPPED_SOL_MINT || mint === JUP, suspicious: suspicious.has(mint) }]))),
  };
}

test("the whole wallet is the total: companies, dollars and SOL; a company with a limit on a weekday reads «Нормальний»", async () => {
  const store = createMemoryGuardStore();
  for (const [mint, symbol] of [[AAPLX, "AAPLx"], [NVDAX, "NVDAx"]]) await setPositionWatch(store, OWNER, { mint, symbol, preset: "careful", basisPerUnit: 1000, basisObservedAt: seen(MONDAY), locale: "uk" }, MONDAY - 60_000);
  const read = await readPortfolioRisk(store, OWNER, MONDAY, deps());
  /* $200 + $200 + $450 of dollars + 1 SOL at $150 = $1 000; each company 20 %, SOL 15 %. */
  assert.equal(read.risk.totalUsd, 1000);
  assert.equal(read.risk.state, "normal");
  assert.equal(read.risk.capsApplied, true);
});

test("one company above 25 % — its two tokens counted as one; a coin above 25 % is named by the catalogue", async () => {
  const store = createMemoryGuardStore();
  const held = new Map([[AAPLX, units(100, 1000)], [NVDAX, units(150, 1000)], [NVDAON, units(150, 1000)], [USDC_MINT, 400_000_000n], [JUP, 200_000_000n]]);
  const read = await readPortfolioRisk(store, OWNER, MONDAY, deps({ held, lamports: 0n, prices: { [JUP]: 1 } }));
  /* $100 + $300 of NVIDIA + $400 + $200 of JUP = $1 000. */
  assert.equal(read.risk.totalUsd, 1000);
  assert.deepEqual(
    read.risk.findings.filter((row) => row.reason === "concentration").map((row) => [row.kind, row.name, row.sharePct]),
    [["company", "NVDA", 30]],
  );
  const coin = await readPortfolioRisk(store, OWNER, MONDAY, deps({ held, lamports: 0n, prices: { [JUP]: 3 } }));
  assert.deepEqual(coin.risk.findings.filter((row) => row.reason === "concentration").map((row) => [row.kind, row.symbol, row.name]), [["crypto", "JUP", "Jupiter"]]);
});

test("dollars are the dollar tokens the product names — USDC, USDT, PYUSD, USDS — in the total and outside every cap", async () => {
  const store = createMemoryGuardStore();
  const PYUSD = "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo";
  const held = new Map([[AAPLX, units(200, 1000)], [NVDAX, units(200, 1000)], [PYUSD, 450_000_000n]]);
  const read = await readPortfolioRisk(store, OWNER, MONDAY, { ...deps({ held }), readHeld: async () => ({ held, frozen: new Set(), complete: true, decimals: new Map([[PYUSD, 6], [AAPLX, 8], [NVDAX, 8]]) }) });
  /* $450 of PYUSD is 45 % of $1 000 — dollars, not a coin above its cap. */
  assert.equal(read.risk.totalUsd, 1000);
  assert.equal(read.risk.state, "normal");
});

test("a private company is its own class: SpaceX above 10 % together is «Увага»", async () => {
  const store = createMemoryGuardStore();
  const held = new Map([[SPACEX, units(150, 1000)], [AAPLX, units(200, 1000)], [USDC_MINT, 650_000_000n]]);
  const read = await readPortfolioRisk(store, OWNER, MONDAY, deps({ held, lamports: 0n }));
  assert.deepEqual(read.risk.findings.filter((row) => row.reason !== "action").map((row) => [row.reason, row.sharePct]), [["private-share", 15]]);
});

test("every read that fails is a gap, and a gap keeps «Нормальний» away", async () => {
  const store = createMemoryGuardStore();
  assert.deepEqual((await readPortfolioRisk(store, OWNER, MONDAY, deps({ lamports: null }))).risk.gaps, ["balance"]);
  const noBalance = await readPortfolioRisk(store, OWNER, MONDAY, { ...deps(), readSolBalance: async () => { throw new Error("rpc down"); } });
  assert.equal(noBalance.risk.state, "unknown");
  assert.deepEqual(noBalance.risk.gaps, ["balance"]);
  assert.deepEqual((await readPortfolioRisk(store, OWNER, MONDAY, deps({ complete: false }))).risk.gaps, ["holdings"]);
  assert.deepEqual((await readPortfolioRisk(store, OWNER, MONDAY, deps({ held: null }))).risk.gaps, ["holdings"]);
  assert.deepEqual((await readPortfolioRisk(store, OWNER, MONDAY, deps({ readPrices: async () => null }))).risk.gaps, ["prices"]);
  const noMarket = await readPortfolioRisk(store, OWNER, MONDAY, { ...deps(), readUniverse: async () => ({ ok: false, code: "UNAVAILABLE", reason: "down" }) });
  assert.deepEqual(noMarket.risk.gaps, ["market"]);
  /* A company's price older than half an hour is not a price the share may stand on. */
  const stale = await readPortfolioRisk(store, OWNER, MONDAY, deps({ rows: [stockRow(AAPLX, "AAPLx", "AAPL", 1000, MONDAY - 3_600_000), stockRow(NVDAX, "NVDAx", "NVDA", 1000, MONDAY)] }));
  assert.equal(stale.risk.state, "unknown");
  assert.deepEqual(stale.risk.gaps, ["prices"]);
  /* SOL held and no price for it. */
  const noSol = await readPortfolioRisk(store, OWNER, MONDAY, deps({ readPrices: async () => new Map() }));
  assert.deepEqual(noSol.risk.gaps, ["prices"]);
});

test("only a token the catalogue verifies counts: no market, unverified or suspicious stays outside the worth and is never named; a verified one without a price is a gap", async () => {
  const store = createMemoryGuardStore();
  const held = new Map([[AAPLX, units(200, 1000)], [NVDAX, units(200, 1000)], [USDC_MINT, 450_000_000n], [SPAM, 10_000_000_000_000n]]);
  const read = await readPortfolioRisk(store, OWNER, MONDAY, deps({ held, prices: {} }));
  assert.equal(read.risk.totalUsd, 1000);
  assert.deepEqual(read.risk.gaps, []);
  /* An airdrop with a pool and a price: unverified or suspicious, it neither dilutes the wallet nor speaks in the warning. */
  const airdrop = await readPortfolioRisk(store, OWNER, MONDAY, deps({ held, prices: { [SPAM]: 1 } }));
  assert.equal(airdrop.risk.totalUsd, 1000);
  assert.equal(airdrop.risk.state, "normal");
  const flagged = await readPortfolioRisk(store, OWNER, MONDAY, deps({ held, prices: { [SPAM]: 1 }, verified: new Set([SPAM]), suspicious: new Set([SPAM]) }));
  assert.equal(flagged.risk.totalUsd, 1000);
  /* Verified, and no price came: a gap, never left out silently. */
  const noPrice = await readPortfolioRisk(store, OWNER, MONDAY, deps({ held, prices: { [SPAM]: null }, verified: new Set([SPAM]) }));
  assert.deepEqual(noPrice.risk.gaps, ["prices"]);
  const unscaled = "Unsc1111111111111111111111111111111111111111";
  const unknownScale = await readPortfolioRisk(store, OWNER, MONDAY, deps({ held: new Map([...held, [unscaled, 5n]]), prices: { [unscaled]: 2 }, verified: new Set([unscaled]) }));
  assert.deepEqual(unknownScale.risk.gaps, ["prices"]);
  /* A wallet with more tokens than are priced is not claimed read. */
  const many = new Map(held);
  for (let index = 0; index <= RISK_PRICED_TOKENS_MAX; index += 1) many.set(`Many${String(index).padStart(40, "x")}`, 1n);
  assert.deepEqual((await readPortfolioRisk(store, OWNER, MONDAY, deps({ held: many, prices: {} }))).risk.gaps, ["prices"]);
});

test("the weekend: a listed company without a loss limit is «Увага» on a Friday in New York, or while its exchange is closed", async () => {
  const store = createMemoryGuardStore();
  /* $20 of NVIDIA and $2 of SpaceX: the private companies under their cap. */
  const held = new Map([[NVDAX, units(20, 1000)], [SPACEX, units(2, 1000)]]);
  const friday = await readPortfolioRisk(store, OWNER, FRIDAY, deps({ nowMs: FRIDAY, held, lamports: 0n }));
  assert.deepEqual(friday.risk.findings.map((row) => [row.reason, row.symbol]), [["weekend-no-limit", "NVDAx"]], "a private company has no exchange and no weekend");
  const monday = await readPortfolioRisk(store, OWNER, MONDAY, deps({ held, lamports: 0n }));
  assert.equal(monday.risk.state, "normal");
  /* A day off: the exchange closed and opening more than a day away. */
  const holiday = await readPortfolioRisk(store, OWNER, MONDAY, deps({ held, lamports: 0n, rows: [stockRow(NVDAX, "NVDAx", "NVDA", 1000, MONDAY, { session: { period: "closed", nextChangeAt: new Date(MONDAY + 3 * 86_400_000).toISOString() } }), stockRow(SPACEX, "SPACEX", "SPACEX", 1000, MONDAY)] }));
  assert.deepEqual(holiday.risk.findings.map((row) => row.reason), ["weekend-no-limit"]);
  /* A weekday night: the regular session closed, opening in hours — not the weekend. */
  const night = await readPortfolioRisk(store, OWNER, MONDAY, deps({ held, lamports: 0n, rows: [stockRow(NVDAX, "NVDAx", "NVDA", 1000, MONDAY, { session: { period: "closed", nextChangeAt: new Date(MONDAY + 10 * 3_600_000).toISOString() } }), stockRow(SPACEX, "SPACEX", "SPACEX", 1000, MONDAY)] }));
  assert.equal(night.risk.state, "normal");
});

test("an exit that could not be read is a gap: no position called without a limit, never «Нормальний» — a plan at its limit may be among the unread", async () => {
  const store = createMemoryGuardStore();
  /* The plans' and the watches' store does not answer. */
  const failing = {
    ...store,
    versioned: (name) => {
      const collection = store.versioned(name);
      return new Proxy(collection, { get: (target, key) => (key === "valuesWithPrefix" ? async () => { throw new Error("store down"); } : Reflect.get(target, key).bind?.(target) ?? Reflect.get(target, key)) });
    },
    collection: (name) => store.collection(name),
  };
  const held = new Map([[NVDAX, units(20, 1000)]]);
  const friday = await readPortfolioRisk(failing, OWNER, FRIDAY, deps({ nowMs: FRIDAY, held, lamports: 0n }));
  assert.equal(friday.risk.state, "unknown");
  assert.deepEqual(friday.risk.gaps, ["exits"]);
  assert.deepEqual(friday.risk.findings, [], "no «без межі збитку» on an exit nobody read");
  const monday = await readPortfolioRisk(failing, OWNER, MONDAY, deps({ held, lamports: 0n }));
  assert.equal(monday.risk.state, "unknown");
});
