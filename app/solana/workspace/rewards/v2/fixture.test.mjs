import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { RANK_THRESHOLDS, REWARD_RANKS, REWARD_RULES_CURRENT, REWARD_RULES_V2_1_NOT_BEFORE, rankForPoints } from "../../../../../lib/rewards/rules.ts";
import { v2Copy } from "./copy.ts";
import { claimFloor, firstTenView, inviterWindow, ladder, moneyTotals, nextTask, rankView, sample, TASK_POINTS, TASKS_WITHOUT_A_TRADE } from "./fixture.ts";

/* The prototype of Rewards v2 (Ріст 9) draws a sample, and the sample may not say what the product does not do. */

for (const persona of ["active", "new"]) {
  const data = sample(persona);

  test(`${persona}: the money card is the sum of its rows, and a claim never takes more than was earned`, () => {
    const totals = moneyTotals(data.money);
    const earned = data.money.filter((row) => row.kind !== "claim").reduce((sum, row) => sum + row.usdMicros, 0n);
    const paid = data.money.filter((row) => row.kind === "claim").reduce((sum, row) => sum - row.usdMicros, 0n);
    assert.equal(totals.earned, earned);
    assert.equal(totals.paid, paid);
    assert.equal(totals.available + totals.pending + totals.paid, totals.earned);
    assert.ok(totals.available >= 0n);
    for (const row of data.money) assert.equal(row.rules, REWARD_RULES_CURRENT.version, "every row carries the rules it was computed by");
  });

  test(`${persona}: every row is dated after the rules it carries came into force`, () => {
    for (const row of [...data.money, ...data.points]) assert.ok(Date.parse(row.at) >= Date.parse(REWARD_RULES_V2_1_NOT_BEFORE), `${row.id} predates rules 2.1.0`);
  });

  test(`${persona}: walked by date, no claim ever takes more than was available then`, () => {
    let balance = 0n;
    for (const row of [...data.money].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))) {
      balance += row.usdMicros;
      assert.ok(balance >= 0n, `${row.id} claims more than was earned by ${row.at}`);
    }
  });

  test(`${persona}: each row's state adds up to the overview's figures`, () => {
    const totals = moneyTotals(data.money);
    const sum = (state) => data.money.filter((row) => row.kind !== "claim" && row.state === state).reduce((total, row) => total + row.usdMicros, 0n);
    assert.equal(sum("available"), totals.available);
    assert.equal(sum("pending"), totals.pending);
    assert.equal(sum("paid"), totals.paid);
  });

  test(`${persona}: a row's share is the rules' share — cashback, the inviter's window, the second level, all of the fee in First $10 back`, () => {
    const allowed = { cashback: [REWARD_RULES_CURRENT.cashbackBps], friend: [REWARD_RULES_CURRENT.inviterWindow.bps, ...Object.values(REWARD_RULES_CURRENT.referralL1BpsByRank)], friend2: [REWARD_RULES_CURRENT.referralL2Bps], firstTen: [10_000] };
    for (const row of data.money) if (row.kind !== "claim") assert.ok(allowed[row.kind].includes(row.shareBps), `${row.id} share`);
  });

  test(`${persona}: the rank is the rules' rank for the points of the last 30 days`, () => {
    const rank = rankView(data.points);
    assert.equal(rank.rank, rankForPoints(BigInt(rank.points)));
    assert.equal(rank.share, REWARD_RULES_CURRENT.referralL1BpsByRank[rank.rank] / 100);
    if (rank.next) assert.equal(rank.next.toGo, Number(RANK_THRESHOLDS[rank.next.rank]) - rank.points);
  });

  test(`${persona}: «First $10 back» never shows more than its cap, and its trades earn no rank points`, () => {
    const view = firstTenView(data);
    assert.ok(view.returned <= view.cap);
    if (view.state === "active") assert.equal(rankView(data.points).bySource.trades, 0);
  });

  test(`${persona}: the next step is a task a person can act on`, () => {
    assert.equal(nextTask(data.tasks)?.state, "available");
  });
}

/*
 * The points of a task are money, because a rank is a share of a friend's fee: nothing a person can do without
 * trading may add up to a rank, and the sample shows the rank its own numbers really give.
 */

test("tasks alone never buy a rank: what needs no trade stays under the first threshold", () => {
  const free = TASKS_WITHOUT_A_TRADE.reduce((sum, id) => sum + TASK_POINTS[id], 0);
  const silver = Number(RANK_THRESHOLDS[REWARD_RANKS[1]]);
  assert.ok(free < silver, `${free} points without a trade reach ${REWARD_RANKS[1]} at ${silver}`);
  assert.equal(rankForPoints(BigInt(free)), REWARD_RANKS[0]);
});

test("the active sample is Bronze on its own fees, not on its tasks", () => {
  const rank = rankView(sample("active").points);
  assert.equal(rank.rank, REWARD_RANKS[0]);
  assert.equal(rank.share, REWARD_RULES_CURRENT.referralL1BpsByRank[REWARD_RANKS[0]] / 100);
  assert.ok(rank.bySource.task < Number(RANK_THRESHOLDS[REWARD_RANKS[1]]), "the sample's tasks alone would be a rank");
});

test("the friends' money is what their rows paid, and nobody in First $10 back has paid their inviter", () => {
  const data = sample("active");
  for (const friend of data.friends) {
    const rows = data.money.filter((row) => row.kind === "friend" && row.source === friend.wallet);
    assert.equal(rows.reduce((sum, row) => sum + row.usdMicros, 0n), friend.earnedUsdMicros);
    if (friend.inFirstTen) assert.equal(friend.earnedUsdMicros, 0n);
  }
});

test("the claim button shows only above the floor of the rules in force", () => {
  assert.equal(claimFloor(true), REWARD_RULES_CURRENT.claimFloor.withAccountUsdMicros);
  assert.equal(claimFloor(false), REWARD_RULES_CURRENT.claimFloor.withoutAccountUsdMicros);
  assert.equal(inviterWindow().share, REWARD_RULES_CURRENT.inviterWindow.bps / 100);
});

test("the ladder promises as live only what lives: early access, perps and presales are «later»", () => {
  const live = Object.fromEntries(ladder().map((step) => [step.opens, step.live]));
  assert.deepEqual(live, { cashback: true, frame: true, launches: false, perps: false, presales: false });
});

const flat = (value) => (typeof value === "function" ? "" : typeof value === "string" ? value : Object.values(value).map(flat).join(" "));

for (const locale of ["en", "uk"]) {
  test(`${locale}: no word the programme forbids, and both languages say the same things`, () => {
    const words = v2Copy(locale);
    const text = flat(words) + [words.youGet(30, 90), words.theyGet("$10", 100), words.claim("$1"), words.celebrateRankLine(10, 15)].join(" ");
    assert.doesNotMatch(text, /заробляй|заробіт|пасивн|passive|\bearn\b|guarantee|гарантов|risk-free|без ризику|\bsafe\b|безпечн|airdrop|аірдроп|token soon|токен скоро|convert|конверт|free stocks|безкоштовні акції|real shares|справжні акції|\bRyn\b|jackpot|джекпот|spin|крутн/i);
    assert.match(words.pointsNote, locale === "uk" ? /не мають грошової вартості/ : /no cash value/);
  });
}

test("the two languages have the same keys", () => {
  const keys = (value, prefix = "") => (typeof value === "object" && value !== null && !Array.isArray(value) ? Object.entries(value).flatMap(([key, inner]) => keys(inner, `${prefix}${key}.`)) : [prefix]);
  assert.deepEqual(keys(v2Copy("en")).sort(), keys(v2Copy("uk")).sort());
});

test("the prototype stays behind noindex and leaves the live Rewards page alone", () => {
  const page = readFileSync(new URL("../../../../app/rewards/preview/page.tsx", import.meta.url), "utf8");
  assert.match(page, /robots: \{ index: false, follow: false/);
  const live = readFileSync(new URL("../page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(live, /v2\//, "the live page does not import the prototype");
});
