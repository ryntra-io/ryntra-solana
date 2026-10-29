// Run from repo root: node --test app/app/portfolio-value.test.mjs
//
// «Вартість портфеля» (B2b, огляд B13 п. 3): one rule for Home and Portfolio — the wallet, plus its Meteora pools,
// plus what waits in its open limit orders. Adding liquidity moves money, it does not lose it.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { orderHeld, portfolioValue, priceBook } from "./portfolio-value.ts";

const SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const sol = (amount, price = "200") => ({ kind: "NATIVE_SOL", mint: null, amountRaw: String(Math.round(amount * 1e9)), decimals: 9, symbol: "SOL", catalog: { symbol: "SOL", name: "Solana", usdPrice: price } });
const usdc = (amount) => ({ kind: "TOKEN", mint: USDC, amountRaw: String(Math.round(amount * 1e6)), decimals: 6, symbol: "USDC", catalog: { symbol: "USDC", name: "USD Coin", usdPrice: "1" } });
const unpriced = { kind: "TOKEN", mint: "Odd1111111111111111111111111111111111111111", amountRaw: "5", decimals: 0, symbol: null, catalog: null };
const order = (over) => ({ inputMint: USDC, makingRaw: "100000000", filledInputRaw: "0", state: "OPEN", ...over });
const ready = (holdings, pools = [], orders = [], over = {}) =>
  portfolioValue({
    wallet: { status: "ready", complete: true, holdings },
    pools: { status: "ready", values: pools, complete: true },
    orders: { status: "ready", complete: true, orders, tokens: {} },
    collateral: { status: "ready", state: "none", usd: null, sol: null },
    ...over,
  });
const usd = (micro) => Number(micro) / 1e6;

test("the value is the wallet, plus the pools, plus what waits in open orders", () => {
  const value = ready([sol(1), usdc(50)], [1000, 25.5], [order({}), order({ state: "FILLED" })]);
  assert.equal(value.phase, "ready");
  assert.equal(usd(value.parts.wallet), 250);
  assert.equal(usd(value.parts.pools), 1025.5);
  assert.equal(usd(value.parts.orders), 100, "a filled order holds nothing");
  assert.equal(usd(value.total), 1375.5);
});

test("adding $1000 of liquidity leaves the value where it was — the money moved from the wallet to a pool", () => {
  const before = ready([usdc(1500)]);
  const after = ready([usdc(500)], [1000]);
  assert.equal(after.total, before.total);
});

test("an order holds the part of its input not yet filled, at the input's price; an unknown price is not a zero", () => {
  const prices = priceBook([sol(1, "150")]);
  assert.equal(prices.get(USDC), 1);
  assert.equal(prices.get(SOL), 150);
  assert.equal(usd(orderHeld(order({ inputMint: SOL, makingRaw: "2000000000", filledInputRaw: "500000000" }), {}, prices)), 225);
  assert.equal(orderHeld(order({ inputMint: "Unknown11111111111111111111111111111111111" }), { Unknown11111111111111111111111111111111111: { symbol: "X", decimals: 6 } }, prices), null);
  const value = ready([usdc(10)], [], [order({ inputMint: "Unknown11111111111111111111111111111111111" })]);
  assert.equal(value.unpriced, 1, "said beside the number");
  assert.equal(usd(value.total), 10);
});

test("only the wallet decides whether there is a number: loading, failed, read in part, or every asset unpriced", () => {
  const base = { pools: { status: "ready", values: [5], complete: true }, orders: { status: "ready", complete: true, orders: [], tokens: {} }, collateral: { status: "ready", state: "active", usd: 7, sol: null } };
  assert.equal(portfolioValue({ ...base, wallet: { status: "loading", complete: false, holdings: [] } }).phase, "loading");
  assert.equal(portfolioValue({ ...base, wallet: { status: "error", complete: false, holdings: [] } }).reason, "unread");
  assert.equal(portfolioValue({ ...base, wallet: { status: "ready", complete: false, holdings: [usdc(1)] } }).reason, "partial");
  const allOdd = portfolioValue({ ...base, wallet: { status: "ready", complete: true, holdings: [unpriced] } });
  assert.equal(allOdd.reason, "unpriced", "never $0 for a wallet whose every asset is unpriced");
  assert.equal(allOdd.total, null);
  assert.equal(usd(ready([]).total), 0, "an empty wallet is worth $0");
});

test("a part not read is named and left out — never counted as zero; a part read in part makes the number a floor", () => {
  const value = portfolioValue({
    wallet: { status: "ready", complete: true, holdings: [usdc(10)] },
    pools: { status: "failed", values: [], complete: true },
    orders: { status: "loading", complete: true, orders: [], tokens: {} },
    collateral: { status: "loading", state: null, usd: null, sol: null },
  });
  assert.equal(value.phase, "ready");
  assert.deepEqual(value.reads, { wallet: "ready", pools: "failed", orders: "loading", collateral: "loading" });
  assert.equal(value.parts.pools, null);
  assert.equal(value.parts.orders, null);
  assert.equal(usd(value.total), 10);
  assert.equal(value.partial, true, "a failed part makes the number a floor, said under it");
  assert.equal(ready([usdc(1)], [1], [], { pools: { status: "ready", values: [1], complete: false } }).partial, true);
  assert.equal(ready([usdc(1)], [1]).partial, false);
});

test("Home and Portfolio draw the same number", () => {
  const home = readFileSync(new URL("./home/home-surface.tsx", import.meta.url), "utf8");
  const portfolio = readFileSync(new URL("../solana/workspace/holdings/holdings-card.tsx", import.meta.url), "utf8");
  assert.match(home, /usePortfolioValue\(owner\)/);
  assert.match(portfolio, /usePortfolioValue\(connection\?\.address \?\? null\)/);
  assert.match(portfolio, /portfolio\.phase === "ready" && portfolio\.total !== null \? \(portfolio\.total < 0n \? `−\$\{usdValueIn\(-portfolio\.total, locale\)\}` : usdValueIn\(portfolio\.total, locale\)\)/);
});

// SOL-C6 (UX-600): collateral on Phoenix is the person's money — read as «Your Phoenix account» reads it, a part of its own.
const collateral = (usd, sol = null, status = "ready", state = usd === null && sol === null ? "none" : "active") => ({ collateral: { status, state, usd, sol } });

test("the value includes Phoenix collateral as a part of its own: wallet + pools + orders + collateral", () => {
  const value = ready([sol(1), usdc(50)], [1000], [order({})], collateral(500));
  assert.equal(usd(value.parts.collateral), 500);
  assert.equal(usd(value.total), 250 + 1000 + 100 + 500);
  assert.equal(value.partial, false);
});

test("an account that is there but did not state its dollars is not read — never $0 — and the number is a floor", () => {
  const value = ready([usdc(20)], [], [], collateral(null, null, "ready", "active"));
  assert.equal(value.reads.collateral, "failed");
  assert.equal(value.parts.collateral, null);
  assert.equal(usd(value.total), 20);
  assert.equal(value.partial, true);
});

test("an account never opened (uninitialized) holds nothing, as a wallet Phoenix has never seen", () => {
  const value = ready([usdc(20)], [], [], collateral(null, null, "ready", "uninitialized"));
  assert.equal(value.reads.collateral, "ready");
  assert.equal(value.parts.collateral, 0n);
  assert.equal(value.partial, false);
});

test("a balance owed on Phoenix is counted as Phoenix states it, below zero too", () => {
  const value = ready([usdc(100)], [], [], collateral(-20));
  assert.equal(usd(value.parts.collateral), -20);
  assert.equal(usd(value.total), 80);
});

test("depositing $500 of collateral leaves the value where it was — the money moved from the wallet to Phoenix", () => {
  const before = ready([usdc(800)], [], [], collateral(null));
  const after = ready([usdc(300)], [], [], collateral(500));
  assert.equal(after.total, before.total);
  assert.equal(usd(after.parts.wallet), 300);
  assert.equal(usd(after.parts.collateral), 500);
});

test("SOL posted on Phoenix counts at the wallet's own SOL price; without that price it is unpriced, never $0", () => {
  const priced = ready([sol(1, "150")], [], [], collateral(10, 2));
  assert.equal(usd(priced.parts.collateral), 10 + 300);
  const noSol = ready([usdc(5)], [], [], collateral(10, 2));
  assert.equal(usd(noSol.parts.collateral), 10);
  assert.equal(noSol.unpriced, 1);
});

test("a wallet with no Phoenix account adds nothing; a Phoenix read that failed is left out and makes the number a floor", () => {
  const none = ready([usdc(20)], [], [], collateral(null));
  assert.equal(none.parts.collateral, 0n);
  assert.equal(usd(none.total), 20);
  assert.equal(none.partial, false);
  const failed = ready([usdc(20)], [], [], collateral(null, null, "failed"));
  assert.equal(failed.reads.collateral, "failed");
  assert.equal(failed.parts.collateral, null);
  assert.equal(usd(failed.total), 20);
  assert.equal(failed.partial, true, "«not everything answered: the value is at least this»");
  const loading = ready([usdc(20)], [], [], collateral(null, null, "loading"));
  assert.equal(loading.parts.collateral, null);
  assert.equal(loading.partial, false);
});

test("the unrealised result of positions is margin, not a balance: only the collateral is in the sum", () => {
  /* The rule takes the collateral alone; Phoenix's account value (collateral + result) never reaches it. */
  const source = readFileSync(new URL("./use-portfolio-value.ts", import.meta.url), "utf8");
  assert.match(source, /usd: phoenix\.value\.collateralUsd, sol: phoenix\.value\.collateralSol/);
  assert.doesNotMatch(source, /portfolioUsd/);
});

test("Home and Portfolio name the collateral «Застава Phoenix» and open «Perps» from it", () => {
  const words = readFileSync(new URL("./home/home-words.ts", import.meta.url), "utf8");
  assert.match(words, /collateral: "Phoenix collateral"/);
  assert.match(words, /collateral: "Застава Phoenix"/);
  const home = readFileSync(new URL("./home/home-surface.tsx", import.meta.url), "utf8");
  assert.match(home, /const PARTS: readonly ValuePart\[\] = \["wallet", "pools", "orders", "collateral"\]/);
  assert.match(home, /href="\/app\/perps"/);
  const portfolio = readFileSync(new URL("../solana/workspace/holdings/holdings-card.tsx", import.meta.url), "utf8");
  assert.match(portfolio, /\["pools", "orders", "collateral"\] as const/);
  assert.match(portfolio, /"Phoenix collateral"/);
  assert.match(portfolio, /"\/app\/perps"/);
  const catalog = readFileSync(new URL("../solana/workspace/i18n/catalog.ts", import.meta.url), "utf8");
  assert.match(catalog, /"Phoenix collateral": "Застава Phoenix"/);
});

test("Home names a failed collateral read without a link, and the risk tier beside the collateral when it is not «safe»", () => {
  const home = readFileSync(new URL("./home/home-surface.tsx", import.meta.url), "utf8");
  assert.match(home, /part === "collateral" && value\.reads\.collateral === "ready" \? \(/);
  assert.match(home, /value\.reads\.collateral !== "ready" \|\| \(value\.parts\.collateral \?\? 0n\) !== 0n/, "a first read on its way is named, not left out");
  assert.match(home, /tier && tier !== "safe" \? futuresWord\(/);
  assert.match(home, /data-home="collateral-risk"/);
  assert.match(home, /\(value\.parts\.collateral \?\? 0n\) !== 0n/, "a balance owed is a row too");
});


test("Portfolio names collateral still being read, never leaves it out unsaid", () => {
  const portfolio = readFileSync(new URL("../solana/workspace/holdings/holdings-card.tsx", import.meta.url), "utf8");
  assert.match(portfolio, /portfolio\.reads\.collateral === "loading" \|\| \(portfolio\.parts\[part\] \?\? 0n\) !== 0n/);
  assert.match(portfolio, /portfolio\.reads\[part\] === "loading" \? text\("Reading"\)/);
  const catalog = readFileSync(new URL("../solana/workspace/i18n/catalog.ts", import.meta.url), "utf8");
  assert.match(catalog, /"Reading": "Читаємо"/);
});
