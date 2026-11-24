// «Портфель: прибуток і збиток» — the wallet's result by the honest standard (DSC-2): fees counted, locked in
// apart from still held, 7 · 30 · 90 days, each coin's entry price, the calendar's days; what the read does not know is
// said in `coverage`, never a silent zero; the result is the wallet page's own (`walletHonest`).
import assert from "node:assert/strict";
import test from "node:test";

import { DAY_S, ESTIMATED_NETWORK_FEE_SOL, honestPnl } from "../core/pnl/honest.ts";
import { walletHonest } from "../wallet-watch/honest.ts";
import { USDC_MINT, WRAPPED_SOL } from "../wallet-watch/trades.ts";
import { heldNow, PNL_CALENDAR_DAYS, pnlInput, portfolioPnl, PORTFOLIO_PNL_STANDARD } from "./pnl.ts";

const NOW = Date.parse("2026-11-19T15:00:00Z") / 1000;
const close = (a, b, eps = 1e-9) => a !== null && Math.abs(a - b) < eps;
const KITE = "KiteKiteKiteKiteKiteKiteKiteKiteKiteKite1111";
const MEME = "MemeMemeMemeMemeMemeMemeMemeMemeMemeMeme1111";
const DROP = "DropDropDropDropDropDropDropDropDropDrop1111";

let slot = 1_000;
/** A trade of `amount` whole coins (6 decimals) for `sol`, `daysAgo` before now. */
function trade(side, mint, amount, sol, daysAgo, extra = {}) {
  slot += 1;
  return {
    signature: `sig${slot}`,
    slot,
    at: NOW - Math.round(daysAgo * DAY_S),
    side,
    mint,
    tokensRaw: String(Math.round(amount * 1e6)),
    decimals: 6,
    quote: "SOL",
    quoteAmount: sol,
    paidBy: null,
    feeSol: 0.001,
    ...extra,
  };
}

/* A market the size does not move: a depth so deep the exit is the price, less Ryntra's fee and the network's. */
const SOL_USD = 200;
const market = (entries) => new Map(entries.map(([mint, priceUsd, liquidityUsd = 1e15, symbol = mint.slice(0, 4)]) => [mint, { priceUsd, liquidityUsd, symbol, name: `${symbol} coin`, icon: null }]));
const read = (trades, more = {}) => ({ trades, held: null, oldestAt: NOW - 200 * DAY_S, complete: true, gap: false, skipped: 0, ...more });

test("the result is the wallet page's own: the same legs and marks as walletHonest", () => {
  const trades = [
    trade("buy", KITE, 1_000, 1, 20),
    trade("sell", KITE, 400, 0.8, 5),
    trade("buy", MEME, 50, 0.5, 2, { quote: "USDC", quoteAmount: 100 }),
    trade("buy", DROP, 10, null, 1, { quote: null, quoteAmount: null, paidBy: "Someone1111111111111111111111111111111111", feeSol: 0 }),
    trade("sell", MEME, 10, 0.2, 1, { feeSol: undefined }),
  ];
  const facts = market([[KITE, 0.5], [MEME, 3], [DROP, 1]]);
  const held = new Map([[KITE, 600], [MEME, null]]);
  const ours = pnlInput({ trades, solUsd: SOL_USD, market: facts, held, nowS: NOW });
  const theirs = walletHonest({ trades, solUsd: SOL_USD, market: facts, held, nowS: NOW });
  assert.deepEqual(honestPnl(ours.input), theirs.pnl);
  assert.equal(ours.approx, theirs.approx);
  assert.equal(ours.approx, true, "a dollar leg is in SOL at SOL's price now");
  assert.equal(ours.feesEstimated, true, "a trade without its fee on record is estimated");
  assert.equal(ours.input.legs.find((leg) => leg.asset === MEME && leg.side === "sell").fee, ESTIMATED_NETWORK_FEE_SOL);
});

test("fees counted, locked in apart from still held, and the entry price of what is held — its buy fees inside", () => {
  const pnl = portfolioPnl({
    read: read([trade("buy", KITE, 1_000, 1, 20), trade("sell", KITE, 500, 1, 3)], { held: new Map([[KITE, 500]]) }),
    solUsd: SOL_USD,
    market: market([[KITE, 0.4]]),
    nowS: NOW,
  });
  assert.equal(pnl.standard, PORTFOLIO_PNL_STANDARD);
  assert.equal(pnl.unit, "SOL");
  const kite = pnl.coins.find((coin) => coin.mint === KITE);
  /* Bought 1 000 for 1 SOL + 0.001; sold half for 1 SOL − 0.001 against half the cost (0.5005). */
  assert.ok(close(kite.realized, 0.999 - 0.5005), `locked in ${kite.realized}`);
  assert.ok(close(kite.entry, 1.001 / 1_000), `entry ${kite.entry}`);
  /* The price now: $0.40 = 0.002 SOL a coin; what is held leaves at that, less Ryntra's fee and the network's. */
  assert.ok(close(kite.now, 0.002));
  assert.ok(kite.unrealized !== null && kite.unrealized > 0.4, `open ${kite.unrealized}`);
  assert.ok(close(kite.result, kite.realized + kite.unrealized));
  assert.ok(kite.pct > 0);
  assert.equal(kite.verdict, "PLUS");
  assert.equal(kite.held, 500);
  assert.equal(kite.symbol, "Kite");
  assert.deepEqual(pnl.coverage.gaps, []);
  assert.equal(pnl.coverage.since, null, "the read reached the first transaction");
  /* The 7-day period: the sale within it, and nothing bought within it is held. */
  assert.ok(close(pnl.periods[7].realized, kite.realized));
  assert.equal(pnl.periods[7].unrealized, 0);
  assert.ok(close(pnl.periods[7].fees, 0.001));
  assert.equal(pnl.periods[7].verdict, "PLUS");
  assert.equal(pnl.periods[7].covered, true);
  /* 30 days: the buy too — and what it left held, at the exit price now. */
  assert.ok(close(pnl.periods[30].result, kite.result));
});

test("a coin all sold keeps the price it came in at; a loss after fees is a minus", () => {
  const pnl = portfolioPnl({ read: read([trade("buy", MEME, 100, 0.1, 4), trade("buy", MEME, 100, 0.3, 3), trade("sell", MEME, 200, 0.39, 2)]), solUsd: SOL_USD, market: market([[MEME, 1]]), nowS: NOW });
  const meme = pnl.coins[0];
  assert.equal(meme.held, 0);
  assert.ok(close(meme.entry, 0.402 / 200));
  assert.ok(meme.result < 0);
  assert.equal(meme.verdict, "MINUS");
  assert.equal(meme.value, 0);
  assert.equal(pnl.periods[7].verdict, "MINUS");
});

test("a period the read does not reach is not known: null with the known part beside, never a zero or a plus", () => {
  const trades = [trade("buy", KITE, 1_000, 1, 9), trade("sell", KITE, 1_000, 2, 1)];
  const pnl = portfolioPnl({ read: read(trades, { complete: false, oldestAt: NOW - 10 * DAY_S }), solUsd: SOL_USD, market: market([[KITE, 0.4]]), nowS: NOW });
  assert.equal(pnl.periods[7].covered, true, "the read reaches back ten days");
  assert.ok(pnl.periods[7].result !== null);
  for (const days of [30, 90]) {
    const period = pnl.periods[days];
    assert.equal(period.covered, false, `${days} days start before the read`);
    assert.equal(period.result, null);
    assert.equal(period.pct, null);
    assert.equal(period.verdict, "UNKNOWN");
    assert.ok(close(period.known, 1.999 - 1.001), "the known part is said beside");
  }
  assert.equal(pnl.whole.result, null, "the whole read is not the whole history");
  assert.deepEqual(pnl.coverage.gaps, ["older"]);
  assert.equal(pnl.coverage.since, NOW - 10 * DAY_S);
  /* Even a period with no trade read in it is not known when the read does not reach its start. */
  const quiet = portfolioPnl({ read: read([], { complete: false, oldestAt: NOW - 2 * DAY_S }), solUsd: SOL_USD, market: new Map(), nowS: NOW });
  assert.equal(quiet.periods[7].verdict, "UNKNOWN");
  const empty = portfolioPnl({ read: read([]), solUsd: SOL_USD, market: new Map(), nowS: NOW });
  assert.equal(empty.periods[7].verdict, "EMPTY", "a whole read with no trade: no trades, said as such");
  assert.equal(empty.coins.length, 0);
});

test("transactions never read: no period and no coin's result is known", () => {
  const pnl = portfolioPnl({ read: read([trade("buy", KITE, 1_000, 1, 3), trade("sell", KITE, 1_000, 2, 1)], { skipped: 4 }), solUsd: SOL_USD, market: market([[KITE, 0.4]]), nowS: NOW });
  for (const days of [7, 30, 90]) assert.equal(pnl.periods[days].result, null);
  assert.equal(pnl.coins[0].result, null);
  assert.equal(pnl.coins[0].verdict, "UNKNOWN");
  assert.ok(pnl.coverage.gaps.includes("skipped"));
  assert.ok(pnl.days.every((day) => day.verdict === "UNREAD"));
  const gap = portfolioPnl({ read: read([], { gap: true }), solUsd: SOL_USD, market: new Map(), nowS: NOW });
  assert.ok(gap.coverage.gaps.includes("skipped"));
});

test("transfers: a coin with no trade read, one that came in beside its buys, one sent away — no result made of them", () => {
  const trades = [trade("buy", KITE, 1_000, 1, 5), trade("buy", MEME, 100, 0.5, 4)];
  const held = new Map([
    [KITE, 1_500],
    [MEME, 40],
    [DROP, 7],
    [USDC_MINT, 12],
    [WRAPPED_SOL, 0.3],
  ]);
  const pnl = portfolioPnl({ read: read(trades, { held }), solUsd: SOL_USD, market: market([[KITE, 0.4], [MEME, 1]]), nowS: NOW });
  const kite = pnl.coins.find((coin) => coin.mint === KITE);
  const meme = pnl.coins.find((coin) => coin.mint === MEME);
  assert.equal(kite.arrived, true, "500 came without a buy read");
  assert.equal(kite.entry, null, "the entry of what is held is not known");
  assert.equal(kite.held, 1_500);
  assert.equal(kite.value, null);
  assert.equal(meme.sent, true, "60 left without a sale");
  assert.equal(meme.held, 40);
  assert.ok(close(meme.entry, 0.501 / 100), "what is left still came in at its price");
  assert.equal(pnl.coverage.untraded, 1, "DROP — money (USDC, SOL) is not a coin without a result");
  assert.ok(pnl.coverage.gaps.includes("transfers"));
});

test("unpriced legs and coins nobody quotes are parts not known, said in the gaps", () => {
  const swap = trade("buy", DROP, 10, null, 2, { quote: null, quoteAmount: null });
  const pnl = portfolioPnl({ read: read([swap, trade("buy", MEME, 100, 0.5, 2)], { held: new Map([[MEME, 100], [DROP, 10]]) }), solUsd: SOL_USD, market: market([[MEME, null]]), nowS: NOW });
  assert.ok(pnl.coverage.gaps.includes("unpriced"), "a token-for-token swap has no price");
  assert.ok(pnl.coverage.gaps.includes("unquoted"), "MEME has no price now");
  const meme = pnl.coins.find((coin) => coin.mint === MEME);
  assert.equal(meme.unrealized, null);
  assert.equal(meme.now, null);
  assert.equal(meme.result, null);
  const drop = pnl.coins.find((coin) => coin.mint === DROP);
  assert.equal(drop.entry, null, "bought without a price: no entry");
  /* No SOL price: nothing held can be valued, and no dollar leg turned into SOL. */
  const blind = portfolioPnl({ read: read([trade("buy", KITE, 1_000, 1, 2)], { held: new Map([[KITE, 1_000]]) }), solUsd: null, market: market([[KITE, 0.4]]), nowS: NOW });
  assert.equal(blind.solUsd, null);
  assert.equal(blind.coins[0].now, null);
  assert.ok(blind.coverage.gaps.includes("unquoted"));
});

test("the calendar: ninety UTC days, the last today — a day in the plus, one in the minus, an empty one, and days the read does not reach", () => {
  const trades = [
    trade("buy", KITE, 1_000, 1, 6),
    trade("sell", KITE, 500, 1, 5),
    trade("buy", MEME, 100, 1, 4),
    trade("sell", MEME, 100, 0.5, 3),
  ];
  const pnl = portfolioPnl({ read: read(trades, { complete: false, oldestAt: NOW - 30 * DAY_S, held: new Map([[KITE, 500]]) }), solUsd: SOL_USD, market: market([[KITE, 0.0001], [MEME, 1]]), nowS: NOW });
  assert.equal(pnl.days.length, PNL_CALENDAR_DAYS);
  assert.equal(pnl.days.at(-1).day, "2026-11-19");
  assert.equal(pnl.days.at(-2).day, "2026-11-18");
  const on = (daysAgo) => pnl.days.find((day) => day.day === new Date((NOW - daysAgo * DAY_S) * 1000).toISOString().slice(0, 10));
  assert.equal(on(5).verdict, "PLUS", "half sold for what the whole cost");
  assert.equal(on(3).verdict, "MINUS", "sold for half");
  assert.equal(on(1).verdict, "EMPTY");
  assert.equal(on(1).result, null);
  assert.equal(on(6).verdict, "MINUS", "the day's buy is still held, and the price fell under it");
  assert.equal(on(40).verdict, "UNREAD", "before the read: nothing is said of it");
  assert.equal(on(40).result, null);
  assert.ok(pnl.days.every((day, at) => at === 0 || day.from - pnl.days[at - 1].from === DAY_S), "one day apart, oldest first");
  const short = portfolioPnl({ read: read([]), solUsd: SOL_USD, market: new Map(), nowS: NOW, calendarDays: 7 });
  assert.equal(short.days.length, 7);
});

test("held now: a coin traded after the accounts were read is not known to be held — null, never a cap at 0", () => {
  const trades = [trade("buy", KITE, 10, 0.1, 0.01), trade("buy", MEME, 10, 0.1, 3)];
  const held = heldNow({ [MEME]: 10, [DROP]: 2 }, new Date((NOW - DAY_S) * 1000).toISOString(), trades);
  assert.equal(held.get(KITE), null);
  assert.equal(held.get(MEME), 10);
  assert.equal(held.get(DROP), 2);
  assert.equal(heldNow(null, null, trades), null);
  /* A time not read: every coin traded is not known to be held. */
  assert.equal(heldNow({ [MEME]: 10 }, null, trades).get(MEME), null);
});

test("the coins: held first by what they would bring, then those all sold by their result", () => {
  const trades = [trade("buy", KITE, 1_000, 1, 5), trade("buy", MEME, 100, 0.1, 5), trade("buy", DROP, 10, 1, 5), trade("sell", DROP, 10, 3, 2)];
  const pnl = portfolioPnl({ read: read(trades, { held: new Map([[KITE, 1_000], [MEME, 100]]) }), solUsd: SOL_USD, market: market([[KITE, 0.1], [MEME, 2], [DROP, 1]]), nowS: NOW });
  /* MEME would bring ≈ 1 SOL, KITE ≈ 0.5; DROP is all sold. */
  assert.deepEqual(pnl.coins.map((coin) => coin.mint), [MEME, KITE, DROP]);
  assert.ok(pnl.coins[0].value > pnl.coins[1].value);
});
