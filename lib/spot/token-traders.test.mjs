import assert from "node:assert/strict";
import test from "node:test";

import { ESTIMATED_NETWORK_FEE_SOL } from "../core/pnl/honest.ts";
import { holdersReachOf, isProgramHolder, tradersOf, withHolderValues } from "./token-traders.ts";
import { EMPTY_WALLET_BOOK } from "./wallet-labels.ts";

/*
 * «хто заробив» by Ryntra's one standard — realized and unrealized apart, fees counted, a result only when
 * at least 95 % is known — and only as deep as the trades read, which the basis says.
 */

const MINT = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const DEV = "JUPhop9E8ZfdJ5FNHhxQt4uAih822Vs4QpqsWcewFbq";
const EARLY = "MriyaNN8TMp6qRWjfr723PK7xgQK7yCt7Kg2v2PQu7X";
const UNPRICED = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const NOW = Date.parse("2026-11-19T12:00:00Z");
const SOL = 100;
const FEE = ESTIMATED_NETWORK_FEE_SOL * SOL;

let n = 0;
const trade = (wallet, side, tokenAmount, usd, minutesAgo, extra = {}) => ({
  signature: `${"5".repeat(80)}${String(++n).padStart(8, "1")}`,
  at: new Date(NOW - minutesAgo * 60_000).toISOString(),
  side,
  wallet,
  tokenAmount,
  usd,
  priceUsd: usd === null ? null : usd / tokenAmount,
  capUsd: null,
  ...extra,
});

const trades = [
  trade(DEV, "buy", 100, 10, 30),
  trade(DEV, "buy", 100, 30, 20),
  trade(DEV, "sell", 100, 40, 10),
  trade(EARLY, "sell", 50, 25, 5),
  trade(UNPRICED, "buy", 10, null, 1),
];
const close = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

const input = {
  mint: MINT,
  trades,
  source: "geckoterminal",
  whole: false,
  nowMs: NOW,
  priceUsd: 0.5,
  depthUsd: 1e12,
  solPriceUsd: SOL,
  book: { ...EMPTY_WALLET_BOOK, dev: DEV },
};

test("a wallet's row: bought, sold, average prices and the honest result, realized and not", () => {
  const { traders } = tradersOf(input);
  const dev = traders.find((row) => row.wallet === DEV);
  assert.deepEqual(dev.labels, ["creator"]);
  assert.equal(dev.buys, 2);
  assert.equal(dev.sells, 1);
  assert.equal(dev.boughtTokens, 200);
  assert.equal(dev.soldTokens, 100);
  assert.equal(dev.boughtUsd, 40);
  assert.equal(dev.soldUsd, 40);
  assert.equal(dev.avgBuyPriceUsd, 0.2);
  assert.equal(dev.avgSellPriceUsd, 0.4);
  assert.equal(dev.netTokens, 100);
  /* Cost 40 + two fees for 200; a sale of 100 for 40 less its fee; the rest at the exit price now less the exit's fee. */
  const cost = 40 + 2 * FEE;
  assert.ok(close(dev.realizedUsd, 40 - FEE - cost / 2));
  assert.ok(close(dev.unrealizedUsd, 100 * 0.5 - FEE - cost / 2, 1e-4));
  assert.ok(close(dev.resultUsd, dev.realizedUsd + dev.unrealizedUsd));
  assert.equal(dev.completenessPct, 100);
  assert.equal(dev.firstAt, trades[0].at);
  assert.equal(dev.lastAt, trades[2].at);
});

test("a sale of what was bought before the span has no result — never a made-up one", () => {
  const { traders } = tradersOf(input);
  const early = traders.find((row) => row.wallet === EARLY);
  assert.equal(early.resultUsd, null);
  assert.equal(early.realizedUsd, null);
  assert.equal(early.completenessPct, 0);
  assert.equal(early.soldUsd, 25);
  assert.equal(early.avgBuyPriceUsd, null);
  assert.equal("labels" in early, false);
  const unpriced = traders.find((row) => row.wallet === UNPRICED);
  assert.equal(unpriced.unpriced, 1);
  assert.equal(unpriced.boughtUsd, 0);
  assert.equal(unpriced.avgBuyPriceUsd, null);
  assert.equal(unpriced.resultUsd, null);
});

test("known results first, largest first; then the rest by turnover", () => {
  const { traders } = tradersOf(input);
  assert.deepEqual(traders.map((row) => row.wallet), [DEV, EARLY, UNPRICED]);
  assert.deepEqual(tradersOf({ ...input, limit: 1 }).traders.map((row) => row.wallet), [DEV]);
});

test("without a price or a depth the holding's value is not known, and neither is the result", () => {
  const noPrice = tradersOf({ ...input, priceUsd: null }).traders.find((row) => row.wallet === DEV);
  assert.equal(noPrice.unrealizedUsd, null);
  assert.equal(noPrice.resultUsd, null);
  assert.ok(noPrice.realizedUsd !== null, "the sale is still known");
  const noDepth = tradersOf({ ...input, depthUsd: null }).traders.find((row) => row.wallet === DEV);
  assert.equal(noDepth.unrealizedUsd, null);
  const shallow = tradersOf({ ...input, depthUsd: 50 }).traders.find((row) => row.wallet === DEV);
  assert.ok(shallow.unrealizedUsd < tradersOf(input).traders[0].unrealizedUsd, "the depth moves the exit against the sale");
  const noSol = tradersOf({ ...input, solPriceUsd: null }).traders.find((row) => row.wallet === DEV);
  assert.equal(noSol.resultUsd, null, "fees not known: the result is not given");
});

test("a holding read apart caps what the span says is held", () => {
  const sent = tradersOf({ ...input, held: new Map([[DEV, 0]]) }).traders.find((row) => row.wallet === DEV);
  assert.equal(sent.unrealizedUsd, 0, "nothing held now: nothing to value");
});

test("the basis says the source, the span, whether it is whole, and how the fees are known", () => {
  const { basis } = tradersOf(input);
  assert.deepEqual(basis, {
    method: "ryntra.honest-pnl/1",
    source: "geckoterminal",
    trades: 5,
    from: trades[0].at,
    to: trades[4].at,
    whole: false,
    fees: "estimate",
    exit: { priceUsd: 0.5, depthUsd: 1e12, poolFeeCounted: false },
    wallets: 3,
    listed: 3,
  });
  const chain = trades.map((row) => ({ ...row, feeSol: 0.000005 }));
  assert.equal(tradersOf({ ...input, trades: chain, source: "helius", whole: true }).basis.fees, "chain");
  assert.equal(tradersOf({ ...input, trades: [chain[0], ...trades.slice(1)] }).basis.fees, "mixed");
  assert.equal(tradersOf({ ...input, solPriceUsd: null }).basis.fees, "unknown");
  const empty = tradersOf({ ...input, trades: [] });
  assert.deepEqual(empty.traders, []);
  assert.equal(empty.basis.from, null);
});

test("the chain's own fee is used where the trade carries it", () => {
  const chain = [trade(DEV, "buy", 100, 10, 3, { feeSol: 0.001 }), trade(DEV, "sell", 100, 20, 2, { feeSol: 0.001 })];
  const row = tradersOf({ ...input, trades: chain }).traders[0];
  assert.ok(close(row.realizedUsd, 20 - 0.1 - (10 + 0.1)));
});

test("holders: their worth at the price now, and how far the list reaches", () => {
  const rows = withHolderValues([{ amount: 1_000 }, { amount: 0 }], 0.25);
  assert.deepEqual(rows.map((row) => row.valueUsd), [250, 0]);
  assert.deepEqual(withHolderValues([{ amount: 1_000 }], null).map((row) => row.valueUsd), [null]);
  assert.deepEqual(withHolderValues([{ amount: 1_250 }], 2, 1.25).map((row) => row.valueUsd), [2_000], "a stock's shown amount over its multiplier, at the token's price");
  assert.deepEqual(holdersReachOf(20, false, 41_000), { listed: 20, ceiling: 20, source: "largest-accounts", whole: false, holders: 41_000 });
  assert.deepEqual(holdersReachOf(37, true, null), { listed: 37, ceiling: 100, source: "all-accounts", whole: true, holders: null });
  assert.equal(isProgramHolder(["pool"]), true);
  assert.equal(isProgramHolder(["creator"]), false);
});
