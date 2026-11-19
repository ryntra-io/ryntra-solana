// The agent's budget is the person's own: her day, her trade, her term; no ceiling of Ryntra's, only the
// agent's technical bounds. Pure: no network, no wallet.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  AGENT_NETWORK_MIN,
  BUYS_A_DAY_MAX,
  DAYS_DEFAULT,
  DAYS_MAX,
  HANDY_SHARES,
  OPENING_LAMPORTS,
  TRADE_MIN_LAMPORTS,
  agentNetworkOf,
  budgetFrom,
  budgetFund,
  budgetIssue,
  budgetRefusal,
  budgetTotal,
  budgetWithin,
  buysADay,
  daySpend,
  defaultDays,
  defaultTrade,
  handyBudget,
  leastTradeOf,
  roundDay,
  roundUp,
  termOf,
} from "./budget.ts";

const SOL = 1_000_000_000n;
const U64_MAX = 2n ** 64n - 1n;

test("any day, trade and term she writes is a budget — 0.001 SOL or a thousand SOL a day, a day or ten years", () => {
  for (const budget of [
    { perDay: TRADE_MIN_LAMPORTS, perTrade: TRADE_MIN_LAMPORTS, days: 1 },
    { perDay: SOL / 10n, perTrade: SOL / 50n, days: 30 },
    { perDay: 1000n * SOL, perTrade: 100n * SOL, days: 365 },
    { perDay: 24n * SOL, perTrade: SOL, days: DAYS_MAX },
  ]) assert.equal(budgetIssue(budget), null, JSON.stringify(budget, (_, v) => (typeof v === "bigint" ? String(v) : v)));
});

test("only the agent's own bounds refuse: a trade under 0.001 SOL or over the day, more than 24 buys a day, a term past ten years, a u64 that would wrap", () => {
  const ok = { perDay: SOL, perTrade: SOL / 2n, days: 30 };
  assert.equal(budgetIssue({ ...ok, perTrade: 0n }), "zero");
  assert.equal(budgetIssue({ ...ok, perDay: 0n }), "zero");
  assert.equal(budgetIssue({ ...ok, perTrade: TRADE_MIN_LAMPORTS - 1n }), "tradeMin");
  assert.equal(budgetIssue({ ...ok, perTrade: SOL + 1n }), "tradeOverDay");
  assert.equal(budgetIssue({ ...ok, perTrade: SOL / 25n }), "buys");
  assert.equal(budgetIssue({ ...ok, perTrade: leastTradeOf(SOL) }), null, "the least trade a day allows is a trade");
  assert.equal(budgetIssue({ ...ok, perTrade: leastTradeOf(SOL) - 1n }), "buys");
  assert.equal(budgetIssue({ ...ok, days: 0 }), "term");
  assert.equal(budgetIssue({ ...ok, days: DAYS_MAX + 1 }), "term");
  assert.equal(budgetIssue({ ...ok, days: 1.5 }), "term");
  assert.equal(budgetIssue({ perDay: U64_MAX + 1n, perTrade: U64_MAX, days: 1 }), "tooLarge", "a day past u64 never wraps");
  assert.equal(budgetIssue({ perDay: U64_MAX / 10n, perTrade: U64_MAX / 20n, days: 30 }), "tooLarge", "a vault past u64");
  assert.match(budgetRefusal({ ...ok, days: 0 }), /1 to 3650 days/);
  assert.equal(budgetRefusal(ok), null);
});

test("the vault takes what the agent can spend: its buys of the trade a day, for each day — never more than the day she wrote", () => {
  assert.equal(buysADay({ perDay: SOL, perTrade: SOL / 2n }), 2);
  assert.equal(buysADay({ perDay: SOL, perTrade: (SOL * 3n) / 10n }), 3);
  assert.equal(buysADay({ perDay: SOL, perTrade: SOL / 100n }), BUYS_A_DAY_MAX);
  assert.equal(daySpend({ perDay: SOL, perTrade: (SOL * 3n) / 10n }), (SOL * 9n) / 10n, "0.9 of the 1 SOL day: three trades of 0.3");
  assert.equal(budgetFund({ perDay: SOL, perTrade: SOL / 2n, days: 30 }), 30n * SOL);
  assert.equal(budgetFund({ perDay: 1000n * SOL, perTrade: 500n * SOL, days: 365 }), 365_000n * SOL);
});

test("the agent's network fees are one 0.01 SOL for any budget — a long or busy one pays no more up front", () => {
  for (const budget of [{ perDay: TRADE_MIN_LAMPORTS * 24n, perTrade: TRADE_MIN_LAMPORTS, days: DAYS_MAX }, { perDay: SOL, perTrade: SOL, days: 1 }]) {
    assert.equal(agentNetworkOf(budget), AGENT_NETWORK_MIN);
    assert.equal(budgetTotal(budget), budgetFund(budget) + AGENT_NETWORK_MIN);
  }
  assert.equal(AGENT_NETWORK_MIN, 10_000_000n);
});

test("from the day she says: half the day a trade, and a term the wallet holds — 30 days, or fewer, never more than it has", () => {
  assert.equal(defaultTrade(SOL), SOL / 2n);
  assert.equal(defaultTrade(TRADE_MIN_LAMPORTS), TRADE_MIN_LAMPORTS, "under two least trades: the day is one trade");
  assert.deepEqual(budgetFrom(SOL), { perDay: SOL, perTrade: SOL / 2n, days: DAYS_DEFAULT }, "a balance not read: the default");
  assert.equal(budgetFrom(SOL, 5n * SOL).days, 4, "5 SOL: four days of 1 SOL and what the signature opens");
  for (const balance of [2n * SOL, 10n * SOL, 31n * SOL]) {
    const b = budgetFrom(SOL, balance);
    assert.ok(b.days === 1 || budgetTotal(b) + OPENING_LAMPORTS <= balance, String(balance));
  }
  assert.equal(defaultDays({ perDay: SOL, perTrade: SOL / 2n }, SOL / 2n), 1, "short even of a day: one day — the card says what is missing");
});

test("a sum held whole: the largest budget its vault part and the agent's fees fit, a shorter term when the day would be too small", () => {
  for (const total of [SOL / 50n, (SOL * 3n) / 10n, 10n * SOL, 1234n * SOL + 7n]) {
    const b = budgetWithin(total);
    assert.ok(b, String(total));
    assert.equal(budgetIssue(b), null);
    assert.ok(budgetTotal(b) <= total, `${total}: ${budgetTotal(b)}`);
  }
  assert.ok(budgetTotal(budgetWithin(10n * SOL)) > 10n * SOL - 1_000n, "nothing of the sum is left behind but rounding");
  assert.equal(budgetWithin(SOL / 50n).days < DAYS_DEFAULT, true, "0.02 SOL: fewer days, each a trade the agent makes");
  assert.equal(budgetWithin(AGENT_NETWORK_MIN), null);
});

test("the wallet's handy shares: rounded days that fit what the share leaves after the signature's accounts", () => {
  const balance = 2n * SOL;
  const days = HANDY_SHARES.map((share) => handyBudget(balance, share));
  for (const [at, b] of days.entries()) {
    assert.ok(b && budgetIssue(b) === null, String(HANDY_SHARES[at]));
    assert.ok(budgetTotal(b) <= ((balance - OPENING_LAMPORTS) * BigInt(HANDY_SHARES[at])) / 100n);
  }
  assert.ok(days.every((b, at) => at === 0 || b.perDay >= days[at - 1].perDay), "a larger share, a larger day");
  assert.equal(handyBudget(0n, 100), null);
  assert.equal(roundDay(33_166_666n), 33_000_000n);
  assert.equal(roundDay(99n), 99n);
  assert.equal(roundUp(666_666_667n), 670_000_000n, "a least is counted up, never under");
  assert.equal(roundUp(SOL), SOL);
  assert.equal(budgetIssue({ perDay: 16n * SOL, perTrade: roundUp(leastTradeOf(16n * SOL)), days: 30 }), null);
});

test("a term read back from a mandate's end: whole days, rounded — a minute or a clock's drift either way is the same term", () => {
  const now = Date.UTC(2026, 10, 17, 12);
  const end = BigInt(Math.floor(now / 1000) + 30 * 86_400);
  assert.equal(termOf(end, now), 30);
  assert.equal(termOf(end, now + 60_000), 30);
  assert.equal(termOf(end + 30n, now), 30);
  assert.equal(termOf(BigInt(Math.floor(now / 1000) - 3_600), now), 1, "an end passed reads as one day — the book refuses it by its end");
});
