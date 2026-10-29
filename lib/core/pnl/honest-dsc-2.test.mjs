// DSC-2 «Чесний PnL — один стандарт»: one standard for a wallet's and a book's result — fees counted, realized and
// unrealized apart, what is held at the price it would leave at (the pool's depth against it), the completeness of the
// data in percent, the drawdown, 7 · 30 · 90 days; an unknown result never 0 and never a plus. Wallet watch (SOL-R4)
// and the Journal take it; the platform's share of wallets in the plus after fees is in the admin, not published.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import {
  DAY_S,
  ESTIMATED_NETWORK_FEE_SOL,
  exitValue,
  HONEST_PNL_METHOD,
  HONEST_PNL_STANDARD,
  honestPnl,
  honestPnlWindow,
  PNL_PERIOD_DAYS,
  VERDICT_MIN_COMPLETENESS_PCT,
} from "./honest.ts";
import { lastMonths, monthRange, platformMonths } from "./platform.ts";
import { walletHonest } from "../../wallet-watch/honest.ts";
import { tradesOfTransaction } from "../../wallet-watch/trades.ts";
import { fillsHonest, paperHonest } from "../../journal/honest.ts";
import { platformHonestMetric, ryntraWalletInputs } from "../../admin/honest-pnl.ts";

const root = new URL("../../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

const NOW = Date.parse("2026-10-25T12:00:00Z") / 1000;
const DEEP = { price: 0, depth: "DEEP", feeShare: 0, feeFixed: 0 };
const close = (a, b) => Math.abs(a - b) < 1e-9;
let n = 0;
const leg = (side, asset, amount, value, fee, daysAgo) => ({ id: `l${(n += 1)}`, asset, at: NOW - daysAgo * DAY_S, side, amount, value, fee });

test("with fees: a buy's fee joins its cost, a sale's comes off what it brought — the result is after both", () => {
  const pnl = honestPnl({
    unit: "SOL",
    nowS: NOW,
    legs: [leg("buy", "MEME", 1_000, 1, 0.01, 3), leg("sell", "MEME", 1_000, 1.5, 0.01, 1)],
  });
  assert.equal(pnl.standard, HONEST_PNL_STANDARD);
  assert.ok(close(pnl.whole.realized, 0.48), `realized ${pnl.whole.realized}`);
  assert.equal(pnl.whole.unrealized, 0, "nothing held: a known zero, not an unknown");
  assert.ok(close(pnl.whole.result, 0.48));
  assert.ok(close(pnl.whole.fees, 0.02), "the fees are said — already inside the result");
  assert.ok(close(pnl.whole.capital, 1.01));
  assert.equal(pnl.whole.completenessPct, 100);
  assert.equal(pnl.whole.verdict, "PLUS");

  /* The market's bare «PnL» would say +0.5; fees turn a thin trade into a loss. */
  const thin = honestPnl({ unit: "SOL", nowS: NOW, legs: [leg("buy", "MEME", 100, 0.1, 0.0006, 2), leg("sell", "MEME", 100, 0.1009, 0.0006, 1)] });
  assert.ok(thin.whole.result < 0, "a gross plus of 0.0009 is a minus after 0.0012 of fees");
  assert.equal(thin.whole.verdict, "MINUS");
});

test("incomplete data: a sale of what was bought before the read is a part not known — the result is null, never 0 or a plus", () => {
  const pnl = honestPnl({
    unit: "SOL",
    nowS: NOW,
    legs: [
      leg("buy", "A", 100, 1, 0, 5),
      leg("sell", "A", 100, 2, 0, 4),
      /* Sold without a buy in the read: its cost is not known. */
      leg("sell", "B", 50, 3, 0, 2),
    ],
  });
  assert.ok(pnl.whole.completenessPct < VERDICT_MIN_COMPLETENESS_PCT, `completeness ${pnl.whole.completenessPct}`);
  assert.equal(pnl.whole.result, null);
  assert.equal(pnl.whole.verdict, "UNKNOWN");
  assert.equal(pnl.whole.pct, null);
  assert.ok(close(pnl.whole.known, 1), "the known part is said beside the completeness");
  assert.notEqual(pnl.whole.verdict, "PLUS");

  /* Every way a leg can be unknown: no price, no fee read, tokens another wallet paid for. */
  const unpriced = honestPnl({ unit: "SOL", nowS: NOW, legs: [leg("buy", "C", 10, null, 0, 3), leg("sell", "C", 10, 5, 0, 1)] });
  assert.equal(unpriced.whole.result, null);
  assert.equal(unpriced.whole.realized, null, "a sale of units of unknown cost has no realized figure");
  const unread = honestPnl({ unit: "SOL", nowS: NOW, legs: [leg("buy", "D", 10, 1, null, 3), leg("sell", "D", 10, 2, 0.01, 1)] });
  assert.equal(unread.whole.verdict, "UNKNOWN", "a fee not read is not a fee of zero");

  /* A sliver unknown leaves the verdict: weighed by value, a dust leg does not hide a known result. */
  const mostly = honestPnl({ unit: "SOL", nowS: NOW, legs: [leg("buy", "E", 100, 10, 0, 3), leg("sell", "E", 100, 9, 0, 2), leg("sell", "F", 1, 0.05, 0, 1)] });
  assert.ok(mostly.whole.completenessPct >= VERDICT_MIN_COMPLETENESS_PCT);
  assert.ok(close(mostly.whole.result, -1));
  assert.equal(mostly.whole.verdict, "MINUS");
});

test("an illiquid position: what is held is valued at the exit price — the pool's depth against the sale, the exit's fees off", () => {
  const legs = [leg("buy", "THIN", 1_000, 2, 0, 2)];
  const mark = { price: 0.01, depth: 5, feeShare: 0.01, feeFixed: 0.0001 };
  const thin = honestPnl({ unit: "SOL", nowS: NOW, legs, marks: new Map([["THIN", mark]]) });
  /* 1 000 × 0.01 = 10 SOL on the screen; a pool 5 SOL deep pays 10 / (1 + 10 / 5) = 3.33, less 1 % and the network. */
  const expected = (10 / 3) * 0.99 - 0.0001;
  assert.ok(close(exitValue(1_000, mark), expected));
  assert.ok(close(thin.whole.unrealized, expected - 2), `unrealized ${thin.whole.unrealized}`);
  assert.equal(thin.whole.verdict, "PLUS");
  const deep = honestPnl({ unit: "SOL", nowS: NOW, legs, marks: new Map([["THIN", { ...DEEP, price: 0.01 }]]) });
  assert.ok(deep.whole.unrealized > thin.whole.unrealized + 4, "the screen's price would claim 10 SOL; the pool pays a third");
  assert.ok(close(thin.assets[0].exitValue, expected));

  /* No depth, no price: the holding's value is not known — never the last trade's price, never zero. */
  for (const marks of [new Map(), new Map([["THIN", { ...mark, depth: null }]]), new Map([["THIN", { ...mark, price: null }]])]) {
    const unknown = honestPnl({ unit: "SOL", nowS: NOW, legs, marks });
    assert.equal(unknown.whole.unrealized, null);
    assert.equal(unknown.whole.result, null);
    assert.equal(unknown.whole.verdict, "UNKNOWN");
    assert.equal(unknown.assets[0].exitValue, null);
    assert.equal(unknown.whole.known, null, "a buy alone is no known part — never «known part 0»");
  }
  /* A pool drained to nothing: a price of zero is a known zero — the loss is the whole cost. */
  const dead = honestPnl({ unit: "SOL", nowS: NOW, legs, marks: new Map([["THIN", { ...DEEP, price: 0 }]]) });
  assert.ok(close(dead.whole.result, -2));
  assert.equal(dead.whole.verdict, "MINUS");
});

test("what was sent away without a sale leaves the holding; what is still held is at its share of the cost", () => {
  const pnl = honestPnl({
    unit: "SOL",
    nowS: NOW,
    legs: [leg("buy", "G", 100, 1, 0, 3)],
    held: new Map([["G", 40]]),
    marks: new Map([["G", { ...DEEP, price: 0.02 }]]),
  });
  assert.ok(close(pnl.whole.unrealized, 40 * 0.02 - 0.4));
  assert.equal(pnl.assets[0].held, 40);
});

test("drawdown: the deepest fall of the running result from its peak, at the trades and the holdings now", () => {
  const pnl = honestPnl({
    unit: "SOL",
    nowS: NOW,
    legs: [
      leg("buy", "H", 10, 1, 0, 10),
      leg("sell", "H", 10, 3, 0, 9), // +2
      leg("buy", "I", 10, 4, 0, 8),
      leg("sell", "I", 10, 1, 0, 7), // −3
      leg("buy", "J", 10, 1, 0, 6),
      leg("sell", "J", 10, 2, 0, 5), // +1
    ],
  });
  assert.ok(close(pnl.whole.result, 0));
  assert.equal(pnl.whole.verdict, "FLAT");
  assert.ok(close(pnl.whole.drawdown.value, 3));
  assert.ok(close(pnl.whole.drawdown.pct, (3 / 6) * 100), "a share of the capital at work");
  assert.equal(honestPnl({ unit: "SOL", nowS: NOW }).whole.drawdown, null);
  assert.equal(honestPnl({ unit: "SOL", nowS: NOW }).whole.verdict, "EMPTY");
});

test("periods 7 · 30 · 90 days: a period's own sales, and what was bought in it and is still held", () => {
  const pnl = honestPnl({
    unit: "SOL",
    nowS: NOW,
    legs: [
      leg("buy", "K", 10, 1, 0, 60),
      leg("sell", "K", 10, 2, 0, 20), // +1, 20 days ago
      leg("buy", "L", 10, 1, 0, 80),
      leg("sell", "L", 10, 0.5, 0, 3), // −0.5, 3 days ago
      leg("buy", "M", 10, 1, 0, 2), // held: worth 1.5 now
    ],
    marks: new Map([["M", { ...DEEP, price: 0.15 }]]),
  });
  assert.deepEqual(PNL_PERIOD_DAYS, [7, 30, 90]);
  assert.ok(close(pnl.periods[7].result, -0.5 + 0.5));
  assert.equal(pnl.periods[7].trades, 2);
  assert.ok(close(pnl.periods[30].result, 1 - 0.5 + 0.5));
  assert.ok(close(pnl.periods[90].result, pnl.whole.result));
  /* A holding bought before the period is the whole read's, not the period's. */
  const old = honestPnl({ unit: "SOL", nowS: NOW, legs: [leg("buy", "N", 10, 1, 0, 40)], marks: new Map([["N", { ...DEEP, price: 0.3 }]]) });
  assert.equal(old.periods[7].verdict, "EMPTY");
  assert.ok(close(old.periods[90].result, 2));
});

test("the method is said in both languages, the same everywhere, and says an unknown is never 0 or a plus", () => {
  assert.ok(HONEST_PNL_METHOD.length >= 6);
  for (const line of HONEST_PNL_METHOD) assert.ok(line.en.length > 20 && line.uk.length > 20);
  const uk = HONEST_PNL_METHOD.map((line) => line.uk).join(" ");
  for (const word of ["Комісії", "Реалізоване", "Нереалізоване", "глибина пулу", "Повнота", "Просадка", "Період", "ніколи не показуємо як 0 чи плюс"]) assert.ok(uk.includes(word), word);
  for (const line of HONEST_PNL_METHOD) assert.doesNotMatch(line.uk, /сигнал|прибут/i);
});

/* ------------------------------------------------------------ the platform */

test("the platform's metric: a wallet not known is among the month's wallets and never among those in the plus", () => {
  const { from } = monthRange("2026-10");
  const at = from + 5 * DAY_S;
  const wallets = new Map([
    ["plus", { unit: "USD", nowS: NOW, legs: [{ id: "1", asset: "X", at, side: "buy", amount: 1, value: 10, fee: 0.1 }, { id: "2", asset: "X", at: at + 60, side: "sell", amount: 1, value: 12, fee: 0.1 }] }],
    ["minus", { unit: "USD", nowS: NOW, legs: [{ id: "3", asset: "Y", at, side: "buy", amount: 1, value: 10, fee: 0.1 }, { id: "4", asset: "Y", at: at + 60, side: "sell", amount: 1, value: 10.1, fee: 0.1 }] }],
    /* Sold what it never bought through Ryntra: not known. */
    ["unknown", { unit: "USD", nowS: NOW, legs: [{ id: "5", asset: "Z", at, side: "sell", amount: 1, value: 50, fee: 0.1 }] }],
    ["quiet", { unit: "USD", nowS: NOW, legs: [{ id: "6", asset: "X", at: from - 40 * DAY_S, side: "buy", amount: 1, value: 10, fee: 0.1 }] }],
  ]);
  const [september, october] = platformMonths(wallets, ["2026-09", "2026-10"]);
  assert.equal(october.wallets, 3, "a wallet with no trade in the month is not in it");
  assert.equal(october.plus, 1);
  assert.equal(october.minus, 1, "a gross plus eaten by fees is a minus");
  assert.equal(october.unknown, 1);
  assert.equal(october.sharePlusPct, 33.3, "the unknown wallet is in the base");
  assert.equal(october.sharePlusOfKnownPct, 50);
  assert.equal(september.wallets, 0);
  assert.equal(september.sharePlusPct, null, "no wallet: no share, not 0 %");
  assert.deepEqual(lastMonths(NOW, 3), ["2026-08", "2026-09", "2026-10"]);
  assert.equal(honestPnlWindow(wallets.get("plus"), from, monthRange("2026-10").to).verdict, "PLUS");
});

const WALLET = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const MEME = "4CJfADKLXAKzv8meQ3rywzQULGN535WAMJJUGWZnpump";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOL = "So11111111111111111111111111111111111111112";

const action = (id, startedAt, out, arrived, extra = {}) => ({
  schema: "ryntra.solana.wallet-action",
  schemaVersion: "1.0.0",
  version: 1,
  network: "mainnet",
  wallet: WALLET,
  actionId: id.padEnd(16, "x"),
  lane: "SWAP",
  outcome: "DONE",
  out,
  in: arrived,
  destination: null,
  signature: null,
  receiptHash: null,
  sourceTx: null,
  destinationTx: null,
  fee: null,
  origin: null,
  providerRef: null,
  statedUsd: null,
  startedAt,
  updatedAt: startedAt,
  ...extra,
});
const side = (mint, amountRaw, decimals) => ({ mint, amountRaw, decimals, symbol: null, chain: "solana" });

test("Ryntra's own swaps: a dollar and SOL are money, a token for a token is a sale and a buy; the network's fee is estimated and the owner's wallets left out", () => {
  const actions = [
    action("buy-usdc", "2026-10-10T00:00:00.000Z", side(USDC, "100000000", 6), side(MEME, "1000000000", 6)),
    action("sell-sol", "2026-10-12T00:00:00.000Z", side(MEME, "1000000000", 6), side(SOL, "1000000000", 9), { statedUsd: 150 }),
    action("sol-usdc", "2026-10-13T00:00:00.000Z", side(SOL, "1000000000", 9), side(USDC, "200000000", 6)),
  ];
  const inputs = ryntraWalletInputs(actions, { nowS: NOW, solUsd: 200, market: new Map() });
  const legs = inputs.get(WALLET).legs;
  assert.equal(legs.length, 2, "SOL for a dollar is no position");
  assert.deepEqual(legs.map((row) => [row.side, row.asset, row.value]), [["buy", MEME, 100], ["sell", MEME, 150]]);
  assert.ok(close(legs[0].fee, ESTIMATED_NETWORK_FEE_SOL * 200));
  const metric = platformHonestMetric(actions, { nowS: NOW, solUsd: 200, market: new Map(), exclude: new Set() });
  const october = metric.months.at(-1);
  assert.equal(october.month, "2026-10");
  assert.equal(october.plus, 1);
  const without = platformHonestMetric(actions, { nowS: NOW, solUsd: 200, market: new Map(), exclude: new Set([WALLET]) });
  assert.equal(without.wallets, 0);
  assert.equal(without.excluded, 1);
  /* SOL's price not read: the fees are not known — the month is not known, never a plus. */
  const blind = platformHonestMetric(actions, { nowS: NOW, solUsd: null, market: new Map(), exclude: new Set() });
  assert.equal(blind.months.at(-1).unknown, 1);
  assert.equal(blind.months.at(-1).plus, 0);
});

/* ------------------------------------------------------------ the surfaces */

test("wallet watch: the transaction's fee is kept on each trade; a trade read before it is estimated and said", () => {
  const tx = {
    slot: 10,
    blockTime: NOW - 3_600,
    meta: {
      err: null,
      fee: 105_000,
      preBalances: [2_000_000_000, 0],
      postBalances: [1_000_000_000 - 105_000, 0],
      preTokenBalances: [],
      postTokenBalances: [{ accountIndex: 1, mint: MEME, owner: WALLET, uiTokenAmount: { amount: "1000000000", decimals: 6 } }],
    },
    transaction: { signatures: ["sig".padEnd(88, "1")], message: { accountKeys: [{ pubkey: WALLET, signer: true }, { pubkey: "acct", signer: false }] } },
  };
  const [buy] = tradesOfTransaction(tx, WALLET);
  assert.equal(buy.side, "buy");
  assert.ok(close(buy.quoteAmount, 1), "the price leg is without the fee");
  assert.ok(close(buy.feeSol, 0.000105), "the fee is kept apart");

  const sell = { ...buy, signature: "s2".padEnd(88, "2"), slot: 20, at: NOW - 60, side: "sell", quoteAmount: 1.2 };
  delete sell.feeSol;
  const honest = walletHonest({ trades: [buy, sell], solUsd: 200, market: new Map(), nowS: NOW });
  assert.equal(honest.feesEstimated, true);
  assert.ok(close(honest.pnl.whole.result, 1.2 - 1 - 0.000105 - ESTIMATED_NETWORK_FEE_SOL));
  /* Held and not priced: not known. With Jupiter's price and liquidity: at the exit price. */
  const held = walletHonest({ trades: [buy], solUsd: 200, market: new Map(), nowS: NOW });
  assert.equal(held.pnl.whole.verdict, "UNKNOWN");
  const priced = walletHonest({ trades: [buy], solUsd: 200, market: new Map([[MEME, { priceUsd: 0.4, liquidityUsd: 2_000 }]]), nowS: NOW });
  /* 1 000 tokens × $0.40 = 2 SOL on the screen; depth 5 SOL: 2 / 1.4, less 1 % and the network. */
  assert.ok(close(priced.pnl.whole.unrealized, (2 / 1.4) * 0.99 - ESTIMATED_NETWORK_FEE_SOL - 1.000105));
});

test("the Journal: paper and real are two results; paper's fees are said, real fills' opening fees come off", () => {
  const paper = paperHonest(
    {
      closed: [
        { id: "p1", market: "SOL-PERP", entry_price: 100, size: 1, fees: 0.2, pnl: 4.8, opened_at: "2026-10-20T00:00:00Z", closed_at: "2026-10-21T00:00:00Z" },
        { id: "p2", market: "SOL-PERP", entry_price: 100, size: 1, fees: 0.2, pnl: -2.2, opened_at: "2026-10-22T00:00:00Z", closed_at: "2026-10-23T00:00:00Z" },
      ],
      open: [],
    },
    NOW,
  );
  assert.ok(close(paper.whole.result, 2.6), "the book's own after-fee figure, not a second one");
  assert.ok(close(paper.whole.fees, 0.4));
  assert.ok(close(paper.whole.drawdown.value, 2.2));
  const withOpen = paperHonest({ closed: [], open: [{ id: "p3", market: "BTC-PERP", entry_price: 60_000, size: 0.1, fees: 3, pnl: null, opened_at: "2026-10-24T00:00:00Z", closed_at: null }] }, NOW);
  assert.equal(withOpen.whole.verdict, "UNKNOWN", "an open paper trade is not marked here: not known, never 0");

  const fills = fillsHonest(
    [
      { tradeId: "f1", marketDisplayName: "SOL-PERP", size: "1", price: "100", fee: "0.05", closedPnl: "0", positionEffect: "OPEN", createdAt: (NOW - 7_200) * 1000 },
      { tradeId: "f2", marketDisplayName: "SOL-PERP", size: "1", price: "101", fee: "0.05", closedPnl: "1", positionEffect: "CLOSE", createdAt: (NOW - 3_600) * 1000 },
    ],
    NOW,
  );
  assert.ok(close(fills.whole.result, 0.9), "the venue's 1 before fees, less both fills' fees");
  assert.equal(fills.periods[7].trades, 2);
});

test("the surfaces take the standard: the wallet page, the Journal, the admin; nothing is published", () => {
  const page = read("app/app/markets/wallets/wallet-watch.tsx");
  assert.match(page, /HonestPnlPanel/);
  assert.match(page, /view\.honest\.pnl/);
  assert.doesNotMatch(page, /realizedSol \?\? 0\) \+ \(view\.pnl\.unrealizedSol \?\? 0/, "the old sum that read an unknown as 0 is gone");
  assert.doesNotMatch(page, /honest\.realized \?\? 0|honest\.unrealized \?\? 0/, "a token's half not known is never summed as 0");
  assert.match(read("lib/wallet-watch/read.ts"), /walletHonest\(/);
  /* The follower's reality stays beside the result. */
  assert.ok(page.indexOf("HonestPnlPanel") < page.indexOf("<FollowerReality"));
  assert.match(read("app/app/journal/page.tsx"), /HonestPnlPanel/);
  assert.match(read("app/app/journal/read.ts"), /paperHonest\(/);
  const admin = read("app/admin/pnl/page.tsx");
  assert.match(admin, /readPlatformHonestMetric/);
  assert.match(admin, /публікація назовні — словом власника/);
  assert.match(read("app/admin/shell/nav.ts"), /href: "\/admin\/pnl"/);
  /* No public route serves the platform's metric. */
  assert.equal(existsSync(new URL("app/api/v1/pnl", root)), false);
  assert.equal(existsSync(new URL("app/api/v1/metrics", root)), false);
  /* The words: an event, a result — never a «signal» or «profit» promised. */
  for (const file of ["app/shell/honest-pnl.tsx", "app/app/markets/wallets/wallet-words.ts"]) assert.doesNotMatch(read(file), /сигнал|signal/i, file);
});
