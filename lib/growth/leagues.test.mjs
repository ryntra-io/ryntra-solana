import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryGuardStore } from "../guard/store.ts";
import { addInternalWallet } from "../admin/internal-wallets.ts";
import { serviceFeeQuoted, settleServiceFee } from "../swap/service-fee.ts";
import { accrueRewards } from "../rewards/accrue.ts";
import { recordRewards } from "../rewards/ledger.ts";
import { recordLaunchGraduation } from "../rewards/rank-store.ts";
import { REWARD_RULES_V2 } from "../rewards/rules.ts";
import { readAvatarFrames } from "./avatar-frames.ts";
import { faceAvatarSvg, walletAvatarSvg, walletFace } from "./badges.ts";
import { BOARD_IDS, bestPlace, boardRows, entriesByRecipient, TRADERS_MIN_CLOSED_USD, uniqueRankEvents, weekMetrics } from "./leaderboard.ts";
import { beginSeasons, boardExclusions, forgetLeagueInputs, readWeek, seasonsBegan, setBoardVisibility, readSeasonCounts, LIVE_REFRESH_MS } from "./league-store.ts";
import { LeaderboardsResponseSchema, leaderboardsView, podiumsOf, seasonHead } from "./league-view.ts";
import { peopleArrivedAt, seasonProgress, seasonTheme, SEASON_START_WALLETS, SEASON_TASK_IDS, tasksDone } from "./seasons.ts";
import { swapValueMicros, traderWeek } from "./trader-pnl.ts";
import { currentWeek, isWeekStart, previousWeek, SEASON_WEEKS, seasonAt, seasonRange, weekOfSeason, weekRange, weekStartOf, WEEK_MS } from "./weeks.ts";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
const SOL = "So11111111111111111111111111111111111111112";
const TOKEN = "TokAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const BONK = "BnkAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
/** A valid base58 address per tag (no 0, O, I or l in a tag). */
const addr = (tag) => `${tag}${"x".repeat(44)}`.slice(0, 44);
const ME = addr("Me");
const DAY = 86_400_000;
/* Monday 2026-10-05 00:00 UTC begins the week the tests read. */
const MONDAY = Date.parse("2026-10-05T00:00:00.000Z");
const at = (days, hours = 12) => new Date(MONDAY + days * DAY + hours * 3_600_000).toISOString();
const WEEK = weekRange(new Date(MONDAY).toISOString());

let serial = 0;
/** A settled swap: `out` left the wallet, `arrived` came in. Amounts in whole units of 6 decimals. */
function swap({ wallet = ME, out, outAmount, arrived, inAmount, days, statedUsd = null, outcome = "DONE", network = "mainnet", lane = "SWAP" }) {
  serial += 1;
  const leg = (mint, amount) => ({ mint, amountRaw: String(Math.round(amount * 1_000_000)), decimals: 6, symbol: null });
  return {
    schema: "ryntra.solana.wallet-action",
    schemaVersion: "1.0.0",
    version: 0,
    network,
    wallet,
    actionId: `action-${String(serial).padStart(6, "x")}`,
    lane,
    outcome,
    out: leg(out, outAmount),
    in: leg(arrived, inAmount),
    destination: null,
    signature: null,
    receiptHash: null,
    sourceTx: null,
    destinationTx: null,
    fee: null,
    origin: null,
    providerRef: null,
    statedUsd,
    startedAt: at(days),
    updatedAt: at(days),
  };
}
const buy = (mint, usd, amount, days, wallet = ME) => swap({ wallet, out: USDC, outAmount: usd, arrived: mint, inAmount: amount, days });
const sell = (mint, amount, usd, days, wallet = ME) => swap({ wallet, out: mint, outAmount: amount, arrived: USDC, inAmount: usd, days });

/** Reward rows of one settled trade by `trader`, invited by `inviter`; `received` dollars reached Ryntra. */
function trade({ trader, inviter = null, received = 1, when }) {
  serial += 1;
  const raw = String(Math.round(received * 1_000_000));
  const fee = settleServiceFee(
    serviceFeeQuoted("JUPITER_REFERRAL", { basisPoints: 50, asset: USDC, symbol: "USDC", decimals: 6, amountRaw: raw, providerRetainedPercent: 20 }),
    { collected: true, amountRaw: raw, settlement: { operationRef: `league-${serial}`, userPaidRaw: raw, providerRaw: "0", ryntraRaw: raw, asset: USDC, symbol: "USDC", decimals: 6, basis: "RYNTRA_OBSERVED_SPLIT_DOCUMENTED" } },
  );
  const result = accrueRewards({ fee, trader, referrerL1: inviter, referrerL2: null, settledAt: when, now: when, price: null, rules: REWARD_RULES_V2, referrerL1Rank: "BRONZE" });
  assert.equal(result.ok, true);
  return result.entries;
}

/* ------------------------------------------------------------------ weeks */

test("a week is Monday 00:00 UTC to the next Monday, whatever the day", () => {
  assert.equal(weekStartOf("2026-10-05T00:00:00.000Z"), "2026-10-05T00:00:00.000Z");
  assert.equal(weekStartOf("2026-10-11T23:59:59.999Z"), "2026-10-05T00:00:00.000Z", "Sunday night is still the same week");
  assert.equal(weekStartOf("2026-10-12T00:00:00.000Z"), "2026-10-12T00:00:00.000Z");
  assert.equal(weekStartOf("2026-10-07T03:00:00+05:00"), "2026-10-05T00:00:00.000Z", "a local clock does not move the week");
  assert.deepEqual(currentWeek(at(3)), WEEK);
  assert.deepEqual(previousWeek(at(3)), weekRange("2026-09-28T00:00:00.000Z"));
  assert.equal(Date.parse(WEEK.end) - Date.parse(WEEK.start), WEEK_MS);
  assert.ok(isWeekStart(WEEK.start));
  assert.ok(!isWeekStart(at(1)));
});

test("seasons follow one another, eight weeks each, from the first one's Monday", () => {
  const first = at(2); // a Wednesday: the first season begins that week's Monday
  const one = seasonRange(first, 1);
  assert.equal(one.start, WEEK.start);
  assert.equal(one.weeks.length, SEASON_WEEKS);
  const two = seasonRange(first, 2);
  assert.equal(two.start, one.end, "no gap, no overlap");
  assert.equal(seasonAt(first, at(-1)), null, "nothing before the first season");
  assert.equal(seasonAt(first, at(0, 0)).number, 1);
  assert.equal(seasonAt(first, one.end).number, 2);
  assert.equal(weekOfSeason(one, one.weeks[3]), 4);
  assert.equal(weekOfSeason(one, two.weeks[0]), null);
  assert.equal(seasonTheme(1), "FIRST_STEPS");
  assert.equal(seasonTheme(4), "FIRST_STEPS", "themes come round in turn");
});

/* ------------------------------------------------------------- trader PnL */

test("a trader's week: the closed part at average cost, in basis points", () => {
  const actions = [
    buy(TOKEN, 100, 10, -20), // $10 each, bought weeks earlier
    buy(TOKEN, 300, 10, -10), // $30 each → average $20
    sell(TOKEN, 10, 260, 2), // sold half for $260: cost $200, +30 %
  ];
  const week = traderWeek(actions, ME, WEEK);
  assert.equal(week.closedCostMicros, 200_000_000n);
  assert.equal(week.closedProceedsMicros, 260_000_000n);
  assert.equal(week.resultBps, 3000);
  assert.equal(week.closedTrades, 1);
  assert.equal(week.lastClosedAt, at(2));
});

test("tokens with no known cost are left out, never counted at zero cost", () => {
  /* Sold 10 having bought only 4 through Ryntra: 6 came from elsewhere. */
  const partly = traderWeek([buy(TOKEN, 40, 4, -3), sell(TOKEN, 10, 150, 1)], ME, WEEK);
  assert.equal(partly.closedCostMicros, 40_000_000n, "only the four bought here");
  assert.equal(partly.closedProceedsMicros, 60_000_000n, "and only their share of what the sale brought");
  assert.equal(partly.resultBps, 5000);
  /* A buy whose value was not measured gives no cost either. */
  const unmeasured = swap({ out: SOL, outAmount: 1, arrived: TOKEN, inAmount: 10, days: -2 });
  const none = traderWeek([unmeasured, sell(TOKEN, 10, 500, 1)], ME, WEEK);
  assert.equal(none.resultBps, null);
  assert.equal(none.closedCostMicros, 0n);
  /* Never bought here at all. */
  assert.equal(traderWeek([sell(TOKEN, 5, 50, 1)], ME, WEEK).resultBps, null);
});

test("the provider's own figure values a swap between two tokens; cash for cash closes nothing", () => {
  const solBuy = buy(SOL, 150, 1, -5);
  const rotate = swap({ out: SOL, outAmount: 1, arrived: BONK, inAmount: 1000, days: 1, statedUsd: 180 }); // SOL closed at +20 %
  const week = traderWeek([solBuy, rotate], ME, WEEK);
  assert.equal(week.resultBps, 2000);
  assert.equal(swapValueMicros(rotate), 180_000_000n);
  const stable = swap({ out: USDC, outAmount: 100, arrived: USDT, inAmount: 100, days: 1 });
  assert.equal(traderWeek([stable], ME, WEEK).resultBps, null);
});

test("only settled mainnet swaps of this wallet count, and a sale outside the week only moves the position", () => {
  const actions = [
    buy(TOKEN, 100, 10, -9),
    sell(TOKEN, 5, 100, -2), // last week: +100 %, not this week's
    sell(TOKEN, 5, 40, 1), // this week: −20 %
    swap({ out: TOKEN, outAmount: 1, arrived: USDC, inAmount: 999, days: 1, outcome: "FAILED" }),
    swap({ out: TOKEN, outAmount: 1, arrived: USDC, inAmount: 999, days: 1, network: "devnet" }),
    { ...sell(TOKEN, 1, 999, 1), wallet: addr("Other") },
  ];
  const week = traderWeek(actions, ME, WEEK);
  assert.equal(week.resultBps, -2000);
  assert.equal(week.closedTrades, 1);
});

/* ----------------------------------------------------------------- boards */

function boardFixture() {
  const traders = new Map([
    [addr("Ann"), [buy(TOKEN, 200, 10, -3, addr("Ann")), sell(TOKEN, 10, 240, 1, addr("Ann"))]], // +20 % on $200
    [addr("Bob"), [buy(TOKEN, 50, 10, -3, addr("Bob")), sell(TOKEN, 10, 100, 1, addr("Bob"))]], // +100 % but only $50 closed
    [addr("Cat"), [buy(TOKEN, 400, 10, -3, addr("Cat")), sell(TOKEN, 10, 480, 2, addr("Cat"))]], // +20 % on $400
    [addr("Dan"), [buy(TOKEN, 100, 10, -3, addr("Dan")), sell(TOKEN, 10, 150, 3, addr("Dan"))]], // +50 %
  ]);
  const rows = [
    ...trade({ trader: addr("Fa"), inviter: ME, when: at(1) }),
    ...trade({ trader: addr("Fa"), inviter: ME, when: at(2) }),
    ...trade({ trader: addr("Fb"), inviter: ME, when: at(4) }),
    ...trade({ trader: addr("Fc"), inviter: addr("Ann"), when: at(0, 3) }),
    ...trade({ trader: addr("Fd"), inviter: addr("Ann"), when: at(1, 3) }),
    ...trade({ trader: addr("Fe"), inviter: ME, when: at(-3) }), // last week: not this week's friend
  ];
  const events = [
    { wallet: addr("Kit"), kind: "LAUNCH_GRADUATED", ref: "MintOne", points: "250", rulesVersion: "2.0.0", at: at(2), createdAt: at(2) },
    { wallet: addr("Kit"), kind: "LAUNCH_GRADUATED", ref: "MintOne", points: "250", rulesVersion: "2.0.0", at: at(2), createdAt: at(2) },
    { wallet: addr("Lou"), kind: "LAUNCH_GRADUATED", ref: "MintTwo", points: "250", rulesVersion: "2.0.0", at: at(-4), createdAt: at(-4) },
  ];
  return weekMetrics({ week: WEEK, entries: entriesByRecipient(rows), actions: traders, events: uniqueRankEvents(events) });
}

test("traders: from the minimum closed, best result first, ties to whoever closed more", () => {
  const rows = boardRows(boardFixture(), "TRADERS", new Set());
  assert.deepEqual(rows.map((row) => [row.place, row.wallet, row.value]), [
    [1, addr("Dan"), 5000],
    [2, addr("Cat"), 2000],
    [3, addr("Ann"), 2000],
  ]);
  assert.ok(!rows.some((row) => row.wallet === addr("Bob")), `under $${TRADERS_MIN_CLOSED_USD} closed is not on the board`);
});

test("friends: people invited who traded this week, each once; creators: launches that reached a DEX this week", () => {
  const metrics = boardFixture();
  const friends = boardRows(metrics, "FRIENDS", new Set());
  /* Both have two; Ann reached two first (Monday and Tuesday morning) — ME's second came Friday. */
  assert.deepEqual(friends.map((row) => [row.wallet, row.value]), [[addr("Ann"), 2], [ME, 2]]);
  const creators = boardRows(metrics, "CREATORS", new Set());
  assert.deepEqual(creators.map((row) => [row.wallet, row.value]), [[addr("Kit"), 1]], "one mint counted once; last week's not at all");
});

test("the owner's, test and hidden wallets are never on a board, and places close up", () => {
  const metrics = boardFixture();
  const rows = boardRows(metrics, "TRADERS", new Set([addr("Dan")]));
  assert.deepEqual(rows.map((row) => [row.place, row.wallet]), [[1, addr("Cat")], [2, addr("Ann")]]);
  assert.deepEqual(bestPlace(metrics, addr("Ann"), new Set()), { board: "FRIENDS", place: 1 });
  assert.equal(bestPlace(metrics, addr("Bob"), new Set()), null);
});

/* ---------------------------------------------------------------- seasons */

test("season tasks: a first trade, three different weeks, a friend trading — counted only inside the season and up to the moment asked", () => {
  const season = seasonRange(WEEK.start, 1);
  const rows = [
    ...trade({ trader: ME, when: at(-2) }), // before the season: nothing
    ...trade({ trader: ME, when: at(1) }),
    ...trade({ trader: ME, when: at(2) }), // the same week: still one week
    ...trade({ trader: ME, when: at(9) }),
    ...trade({ trader: addr("Fa"), inviter: ME, when: at(10) }),
    ...trade({ trader: ME, when: at(16) }), // the third week
  ];
  const mine = rows.filter((entry) => entry.recipient === ME);
  const midway = seasonProgress({ wallet: ME, entries: mine, season, at: at(12) });
  assert.deepEqual(midway.tasks.map((task) => [task.id, task.done, task.have]), [["FIRST_TRADE", true, 1], ["THREE_WEEKS", false, 2], ["FRIEND_TRADES", true, 1]]);
  assert.equal(midway.tasks[0].at, at(1));
  assert.equal(midway.complete, false);
  assert.equal(tasksDone(midway), 2);
  const later = seasonProgress({ wallet: ME, entries: mine, season, at: at(20) });
  assert.equal(later.complete, true);
  assert.equal(later.completedAt, at(16), "complete when the last task was done");
  assert.deepEqual(later.tasks.map((task) => task.id), [...SEASON_TASK_IDS]);
  /* The next season starts again from nothing. */
  const next = seasonProgress({ wallet: ME, entries: mine, season: seasonRange(WEEK.start, 2), at: at(70) });
  assert.equal(tasksDone(next), 0);
});

/* ------------------------------------------------------------------ store */

/** `count` outside wallets, the n-th first trading at day `firstDay + n` (and again a day later). */
function crowd(count, firstDay, tag = "P") {
  const rows = [];
  for (let n = 0; n < count; n += 1) {
    const wallet = addr(`${tag}${"abcdefghjkmnpqrstuvwxyz"[n]}`);
    rows.push(...trade({ trader: wallet, when: at(firstDay + n) }), ...trade({ trader: wallet, when: at(firstDay + n + 1) }));
  }
  return rows;
}

test("people arrive when the tenth outside wallet first trades; the owner's and test wallets never count", () => {
  const OWNER = addr("Qwn");
  const rows = [
    ...trade({ trader: OWNER, when: at(-30) }),
    ...trade({ trader: addr("Fa"), inviter: ME, when: at(-20) }), // a friend's first trade: counted for the friend, not for the one who invited
    ...crowd(9, -8),
  ];
  const entries = entriesByRecipient(rows);
  const internal = new Set([OWNER]);
  /* Fa and nine more: the tenth outside wallet is the last of the crowd, first trading on day 0. */
  assert.equal(peopleArrivedAt({ entries, internal, at: at(5) }), at(0));
  assert.equal(SEASON_START_WALLETS, 10);
  assert.equal(peopleArrivedAt({ entries, internal, at: at(-1) }), null, "nine by then: not yet");
  assert.equal(peopleArrivedAt({ entries, internal: new Set([OWNER, addr("Fa")]), at: at(5) }), null, "an internal wallet is not a person who came");
  assert.equal(peopleArrivedAt({ entries, internal: new Set(), at: at(5) }), at(-1), "counting the owner would open it a day earlier");
  assert.equal(peopleArrivedAt({ entries: entriesByRecipient(trade({ trader: addr("Fb"), inviter: ME, when: at(1) })), internal, at: at(5), need: 2 }), null, "the inviter's level-1 row is not its own trade");
});

const PROD = { VERCEL_ENV: "production" };

/** A store whose internal list holds the owner's wallet, with `rows` recorded. */
async function peopleStore(rows) {
  const store = createMemoryGuardStore();
  await addInternalWallet(store, { wallet: addr("Qwn"), label: "owner", now: at(-40) });
  await recordRewards(store, rows);
  forgetLeagueInputs(store);
  return store;
}

test("the first season begins on the Monday of the week people came, once; a preview only reads; nothing before", async () => {
  const store = await peopleStore([...trade({ trader: addr("Qwn"), when: at(-30) }), ...crowd(9, -8)]);
  /* A start written before anyone came, under the old key, is not read. */
  await store.collection("growthSeasons").set("first", { firstStart: weekRange("2026-09-28T00:00:00.000Z").start, setAt: at(-6), setBy: "old" });
  assert.equal(await seasonsBegan(store, at(3), PROD), null, "nine outside wallets and the owner: no season yet");
  assert.equal(await store.collection("growthSeasons").get("firstWithPeople"), undefined, "and nothing written");

  await recordRewards(store, trade({ trader: addr("Late"), when: at(2) }));
  forgetLeagueInputs(store);
  assert.equal(await seasonsBegan(store, at(3), { VERCEL_ENV: "preview" }), null, "a preview never starts seasons");
  /* Two instances asking at once agree. */
  const both = await Promise.all([seasonsBegan(store, at(3), PROD), seasonsBegan(store, at(3), PROD)]);
  assert.deepEqual(both, [WEEK.start, WEEK.start], "the tenth came on Wednesday: from that week's Monday");
  const written = await store.collection("growthSeasons").get("firstWithPeople");
  assert.deepEqual(Object.keys(written).sort(), ["firstStart", "need", "peopleAt", "setAt", "setBy"], "the moment, never the wallets");
  assert.deepEqual([written.peopleAt, written.need, written.setAt], [at(2), 10, at(3)]);

  /* A wallet put on the internal list afterwards does not move a season that began. */
  await addInternalWallet(store, { wallet: addr("Late"), label: "test", now: at(4) });
  forgetLeagueInputs(store);
  assert.equal(await seasonsBegan(store, at(30), PROD), WEEK.start, "written once");
  assert.equal(await seasonsBegan(store, at(30), { VERCEL_ENV: "preview" }), WEEK.start, "and read by everyone after");
});

test("no season opens in the past: people who came long before the first ask start it that week", async () => {
  const store = await peopleStore(crowd(10, -40));
  assert.equal(await seasonsBegan(store, at(3), PROD), WEEK.start);
  assert.equal((await store.collection("growthSeasons").get("firstWithPeople")).peopleAt, at(-31));
});

test("a hidden wallet is a person; the deployment's internal wallets are not", async () => {
  const rows = crowd(10, -8);
  const hiddenStore = await peopleStore(rows);
  await setBoardVisibility(hiddenStore, { wallet: addr("Pa"), hidden: true, now: at(0) });
  assert.equal(await seasonsBegan(hiddenStore, at(3), PROD), WEEK.start, "hidden from the boards, counted all the same");

  const listedStore = await peopleStore(rows);
  assert.equal(await seasonsBegan(listedStore, at(3), { ...PROD, RYNTRA_INTERNAL_WALLETS: addr("Pa") }), null, "nine people once the deployment's own wallet is left out");
});

test("without the internal list — unreadable or empty — no season begins", async () => {
  const empty = createMemoryGuardStore();
  await recordRewards(empty, crowd(10, -8));
  assert.equal(await seasonsBegan(empty, at(3), PROD), null, "an empty list cannot tell the owner from people");

  const inner = await peopleStore(crowd(10, -8));
  const readable = new Set(["rewardEntries", "solanaWalletActions", "rankEvents", "growthSeasons"]);
  const store = {
    ...inner,
    collection(name) {
      const collection = inner.collection(name);
      if (readable.has(name)) return collection;
      return { ...collection, valuesWithPrefix: async () => { throw new Error("down"); } };
    },
  };
  assert.equal(await seasonsBegan(store, at(3), PROD), null, "an unreadable list neither");
  assert.equal(await inner.collection("growthSeasons").get("firstWithPeople"), undefined);
  assert.equal(await seasonsBegan(inner, at(3), PROD), WEEK.start, "the same store with its list readable begins");
});

test("a stand sets its own season start once", async () => {
  const store = createMemoryGuardStore();
  assert.equal(await beginSeasons(store, { firstStart: at(-12), now: at(0), setBy: "stand" }), weekRange("2026-09-21T00:00:00.000Z").start);
  assert.equal(await beginSeasons(store, { firstStart: at(3), now: at(3), setBy: "stand" }), weekRange("2026-09-21T00:00:00.000Z").start, "the first write holds");
  assert.equal(await seasonsBegan(store, at(3), { VERCEL_ENV: "preview" }), "2026-09-21T00:00:00.000Z");
});

async function seededStore() {
  const store = createMemoryGuardStore();
  const actions = store.collection("solanaWalletActions");
  for (const row of [buy(TOKEN, 200, 10, -3, addr("Ann")), sell(TOKEN, 10, 240, 1, addr("Ann")), buy(TOKEN, 100, 10, -3, ME), sell(TOKEN, 10, 130, 2, ME)]) {
    await actions.set(`solana:${row.network}:${row.wallet}:${row.actionId}`, row);
  }
  await recordRewards(store, [...trade({ trader: addr("Fa"), inviter: ME, when: at(1) }), ...trade({ trader: ME, when: at(2) })]);
  await recordLaunchGraduation(store, { creator: addr("Kit"), mint: "MintOne", graduatedAt: at(2), now: at(2) });
  return store;
}

test("a week's figures are kept: recomputed only when stale, never once final", async () => {
  const store = await seededStore();
  const now = at(3);
  const first = await readWeek(store, WEEK, now);
  assert.equal(first.final, false);
  assert.deepEqual(first.metrics.traders.map((row) => row.wallet).sort(), [addr("Ann"), ME].sort());
  assert.equal(first.metrics.creators[0].wallet, addr("Kit"));
  /* A new sale lands; within the refresh window the kept figures answer. */
  const late = sell(TOKEN, 1, 1, 3, addr("Bob"));
  await store.collection("solanaWalletActions").set(`solana:mainnet:${late.wallet}:${late.actionId}`, late);
  forgetLeagueInputs(store);
  const kept = await readWeek(store, WEEK, new Date(Date.parse(now) + 60_000).toISOString());
  assert.equal(kept.computedAt, first.computedAt);
  const fresh = await readWeek(store, WEEK, new Date(Date.parse(now) + LIVE_REFRESH_MS + 1).toISOString());
  assert.notEqual(fresh.computedAt, first.computedAt);
  const ended = await readWeek(store, WEEK, at(9));
  assert.equal(ended.final, true);
  const again = await readWeek(store, WEEK, at(30));
  assert.equal(again.computedAt, ended.computedAt, "a final week is never computed again");
  await assert.rejects(() => readWeek(store, weekRange("2026-12-07T00:00:00.000Z"), now), /not begun/);
});

test("hiding is the wallet's own: off every board on the next read, and no frame anywhere", async () => {
  const store = await seededStore();
  await addInternalWallet(store, { wallet: addr("Ann"), label: "founder", now: at(0) });
  await setBoardVisibility(store, { wallet: ME, hidden: true, now: at(3) });
  const exclusions = await boardExclusions(store, {});
  assert.ok(exclusions.wallets.has(addr("Ann")) && exclusions.wallets.has(ME));
  assert.ok(exclusions.internal.has(addr("Ann")) && !exclusions.internal.has(ME));
  const snapshot = await readWeek(store, WEEK, at(3));
  assert.deepEqual(boardRows(snapshot.metrics, "TRADERS", exclusions.wallets), []);
  const frames = await readAvatarFrames(store, [ME], at(3));
  assert.equal(frames.get(ME), null);
  await setBoardVisibility(store, { wallet: ME, hidden: false, now: at(3) });
  assert.ok(!(await boardExclusions(store, {})).wallets.has(ME));
});

test("season counts leave the owner's wallets out", async () => {
  const store = await seededStore();
  const season = seasonRange(WEEK.start, 1);
  const all = await readSeasonCounts(store, season, at(3), new Set());
  assert.equal(all.participants, 2, "ME (its own trade, a friend's) and the friend (its own trade)");
  assert.equal(all.complete, 0);
  const owner = await readSeasonCounts(await seededStore(), season, at(3), new Set([ME]));
  assert.equal(owner.participants, 1, "the owner's wallet is not a participant");
});

/* ------------------------------------------------------------------- view */

test("the page learns names, faces, ranks and one figure — never anyone's dollars", () => {
  const metrics = boardFixture();
  const view = leaderboardsView({
    kind: "current",
    week: WEEK,
    metrics,
    ranks: { [addr("Dan")]: "GOLD" },
    computedAt: at(3),
    final: false,
    exclude: new Set(),
    season: seasonHead(seasonRange(WEEK.start, 1), WEEK.start, "FIRST_STEPS"),
    creators: true,
    viewer: null,
  });
  assert.ok(LeaderboardsResponseSchema.safeParse(view).success);
  const top = view.boards.TRADERS.rows[0];
  assert.deepEqual(top, { place: 1, name: "Danx…xxxx", face: walletFace(addr("Dan")), rank: "GOLD", value: 5000, you: false });
  const text = JSON.stringify(view);
  assert.doesNotMatch(text, new RegExp(addr("Dan")), "no full address");
  assert.doesNotMatch(text, /closedCost|Proceeds|closedUsd|"usd"|\$/i, "no one's dollars");
  assert.equal(view.you, null);
  assert.equal(view.season.week, 1);
  assert.equal(faceAvatarSvg(top.face, "GOLD", { id: "a" }), walletAvatarSvg(addr("Dan"), "GOLD", { id: "a" }), "the same face from its number");
});

test("the proven viewer sees their own place and how far they are from the traders' minimum — even hidden", () => {
  const metrics = boardFixture();
  const base = { kind: "current", week: WEEK, metrics, ranks: {}, computedAt: at(3), final: false, season: null, creators: false };
  const shown = leaderboardsView({ ...base, exclude: new Set(), viewer: { wallet: addr("Bob"), rank: "BRONZE", hidden: false, internal: false } });
  assert.deepEqual(shown.you.boards.TRADERS, { place: null, value: 10000, closedUsd: "50.00" });
  const hidden = leaderboardsView({ ...base, exclude: new Set([addr("Dan")]), viewer: { wallet: addr("Dan"), rank: "GOLD", hidden: true, internal: false } });
  assert.equal(hidden.you.boards.TRADERS.place, 1, "where they would stand");
  assert.ok(!hidden.boards.TRADERS.rows.some((row) => row.you), "but not on the board");
  const owner = leaderboardsView({ ...base, exclude: new Set([addr("Dan")]), viewer: { wallet: addr("Dan"), rank: null, hidden: false, internal: true } });
  assert.equal(owner.you.boards.TRADERS.place, null);
  assert.equal(owner.you.excluded, true);
  const podiums = podiumsOf(metrics, {}, new Set(), addr("Cat"));
  assert.deepEqual(BOARD_IDS.map((board) => podiums[board].length), [3, 2, 1]);
  assert.equal(podiums.TRADERS[1].you, true);
});
