import assert from "node:assert/strict";
import test from "node:test";

import {
  CITY_USES,
  fundingVerdict,
  honestCountMark,
  judgeCityTrade,
  judgeTrade,
  MIN_TRADE_USD_MICROS,
  NO_CLUSTER_CHECK,
  weeklyClusterShare,
} from "./honest-count.ts";
import { PROTECT_RULES } from "../growth/protect.ts";
import { POINTS_REASONS } from "../world/contract.ts";

/*
 * The city's honest count: a trade inside one wallet cluster counts for nothing — no points, no billboard, no war
 * score, no prestige, no host's part — and a trade nobody has checked yet counts for nothing either.
 */

const BUYER = "6dNVSFwbC6RGDCyEXBuMBpBHVpPTGqJnGG8kk9EMXbLp";
const CREATOR = "3EjkPWNaQmDLNKYAP6sHKZgLMxYPjQnfPdBbEjNzXZQL";
const HOST = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const FRIEND = "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T";
const RELAYER = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const AT = "2026-10-21T12:00:00.000Z";
const tx = (n) => `${"5".repeat(86)}${"ABCDEFGHJK"[n % 10]}${"abcdefghij"[Math.floor(n / 10) % 10]}`;

const trade = (over = {}) => ({
  tx: tx(0),
  at: AT,
  mint: MINT,
  buyer: BUYER,
  signers: [BUYER],
  creator: CREATOR,
  host: HOST,
  friend: null,
  usdMicros: 25_000_000n,
  ...over,
});

/** A Growth check that knows the given pairs, in either order, and sees everyone else as separate people. */
const clusters = (same = {}) => ({
  asked: [],
  async check(a, b, at) {
    this.asked.push([a, b, at]);
    const reason = same[`${a}|${b}`] ?? same[`${b}|${a}`];
    return reason ? { verdict: "same", reason, rules: "test" } : { verdict: "separate", rules: "test" };
  },
});

const reasons = (judgement) => Object.fromEntries(CITY_USES.map((use) => [use, judgement.counts[use].counted ? "counted" : judgement.counts[use].reason]));
const all = (value) => Object.fromEntries(CITY_USES.map((use) => [use, value]));

test("self-trade: the buyer is the creator or the host — counted nowhere, the Growth line not even asked", async () => {
  for (const over of [{ buyer: CREATOR, signers: [CREATOR] }, { buyer: HOST, signers: [HOST] }]) {
    const check = clusters();
    const judgement = await judgeCityTrade(trade(over), check);
    assert.equal(judgement.cluster, "inside");
    assert.equal(judgement.inside.why, "same_wallet");
    assert.deepEqual(reasons(judgement), all("self_trade"));
    assert.deepEqual(check.asked, []);
  }
});

test("a second own wallet as the friend: one cluster with the buyer — counted nowhere", async () => {
  const judgement = await judgeCityTrade(trade({ friend: FRIEND }), clusters({ [`${BUYER}|${FRIEND}`]: "shared_funder" }));
  assert.equal(judgement.cluster, "inside");
  assert.deepEqual(judgement.inside, { party: "friend", why: "shared_funder" });
  assert.deepEqual(reasons(judgement), all("cluster"));
});

test("a second own wallet as the creator's buyer: funded by the creator — counted nowhere", async () => {
  const judgement = await judgeCityTrade(trade(), clusters({ [`${BUYER}|${CREATOR}`]: "direct_funds" }));
  assert.deepEqual(judgement.inside, { party: "creator", why: "direct_funds" });
  assert.deepEqual(reasons(judgement), all("cluster"));
});

test("the same signer: the creator signed the buyer's trade — counted nowhere", async () => {
  for (const signers of [[CREATOR], [BUYER, CREATOR]]) {
    const judgement = await judgeCityTrade(trade({ signers }), clusters());
    assert.equal(judgement.cluster, "inside");
    assert.deepEqual(judgement.inside, { party: "creator", why: "same_signer" });
    assert.deepEqual(reasons(judgement), all("same_signer"));
  }
});

test("a signer that is neither buyer nor party is checked too: a relayer in the host's cluster", async () => {
  const check = clusters({ [`${RELAYER}|${HOST}`]: "shared_device" });
  const judgement = await judgeCityTrade(trade({ signers: [RELAYER, BUYER] }), check);
  assert.deepEqual(judgement.inside, { party: "host", why: "shared_device" });
  assert.ok(check.asked.some(([a, b]) => a === RELAYER && b === HOST));
  assert.ok(check.asked.every(([, , at]) => at === AT), "clusters are asked as they were at the trade");
});

test("the plainest reason is named when there are several", async () => {
  const judgement = await judgeCityTrade(trade({ friend: CREATOR, buyer: HOST, signers: [HOST] }), clusters());
  assert.equal(judgement.inside.why, "same_wallet");
  assert.equal(judgement.inside.party, "host");
});

test("an ordinary trade between people: counted everywhere, the host's part too", async () => {
  const check = clusters();
  const judgement = await judgeCityTrade(trade({ friend: FRIEND }), check);
  assert.equal(judgement.cluster, "outside");
  assert.equal(judgement.inside, null);
  assert.deepEqual(reasons(judgement), all("counted"));
  assert.deepEqual(check.asked.map(([a, b]) => `${a}|${b}`).sort(), [`${BUYER}|${CREATOR}`, `${BUYER}|${FRIEND}`, `${BUYER}|${HOST}`].sort());
});

test("an ordinary trade outside any quarter: everything but the host's part", async () => {
  const judgement = await judgeCityTrade(trade({ host: null }), clusters());
  assert.deepEqual(reasons(judgement), { ...all("counted"), host_share: "no_host" });
});

test("not known means not counted: today's stub, a pair the Growth line cannot read, a check that fails", async () => {
  const today = await judgeCityTrade(trade());
  assert.equal(today.cluster, "unknown");
  assert.deepEqual(reasons(today), all("unverified"));
  assert.deepEqual(await NO_CLUSTER_CHECK.check(BUYER, CREATOR, AT), { verdict: "unknown", why: "no_check" });

  const half = {
    async check(a, b) {
      return b === HOST ? { verdict: "unknown", why: "deep" } : { verdict: "separate", rules: "test" };
    },
  };
  assert.deepEqual(reasons(await judgeCityTrade(trade(), half)), all("unverified"));

  const broken = { check: async () => Promise.reject(new Error("rpc down")) };
  assert.deepEqual(reasons(await judgeCityTrade(trade(), broken)), all("unverified"));
});

test("a known cluster wins over a pair that is not known", async () => {
  const mixed = {
    async check(a, b) {
      return b === HOST ? { verdict: "same", reason: "linked_wallet", rules: "test" } : { verdict: "unknown", why: "deep" };
    },
  };
  const judgement = await judgeCityTrade(trade(), mixed);
  assert.equal(judgement.cluster, "inside");
  assert.deepEqual(reasons(judgement), all("cluster"));
});

test("an answer of «same» without a reason the city knows is not taken as «separate»", () => {
  const judgement = judgeTrade(trade(), () => ({ verdict: "same", reason: "gut_feeling", rules: "test" }));
  assert.equal(judgement.cluster, "unknown");
  assert.deepEqual(reasons(judgement), all("unverified"));
});

test("nothing is counted from volume: a dollar and a million weigh the same, and the answer carries no amount", async () => {
  const small = await judgeCityTrade(trade({ usdMicros: MIN_TRADE_USD_MICROS }), clusters());
  const huge = await judgeCityTrade(trade({ usdMicros: 1_000_000_000_000n }), clusters());
  assert.deepEqual(small, huge);
  const keys = JSON.stringify(huge, (_key, value) => (typeof value === "bigint" ? String(value) : value));
  assert.doesNotMatch(keys, /usd|amount|volume|launches/i);
  assert.equal(MIN_TRADE_USD_MICROS, PROTECT_RULES.activation.minTradeUsdMicros);
});

test("a trade under a dollar or without a dollar figure is no activity", async () => {
  assert.deepEqual(reasons(await judgeCityTrade(trade({ usdMicros: MIN_TRADE_USD_MICROS - 1n }), clusters())), all("dust"));
  assert.deepEqual(reasons(await judgeCityTrade(trade({ usdMicros: null }), clusters())), all("no_amount"));
  /* Still a trade between people: it counts towards the public number as outside. */
  assert.equal((await judgeCityTrade(trade({ usdMicros: 1n }), clusters())).cluster, "outside");
});

test("an unreadable trade counts for nothing", async () => {
  for (const over of [{ tx: "x" }, { at: "yesterday" }, { signers: [] }, { signers: BUYER }, { buyer: null }, { buyer: "0xabc" }, { creator: "creator" }, { usdMicros: -1n }, { usdMicros: 5 }]) {
    assert.deepEqual(reasons(await judgeCityTrade(trade(over), clusters())), all("malformed"));
  }
});

test("a trade that names nobody besides the buyer is not known: a $1 round trip of one wallet counts for nothing", async () => {
  const alone = trade({ creator: null, host: null, friend: null, usdMicros: MIN_TRADE_USD_MICROS });
  for (const check of [NO_CLUSTER_CHECK, clusters()]) {
    const judgement = await judgeCityTrade(alone, check);
    assert.equal(judgement.cluster, "unknown");
    assert.equal(judgement.inside, null);
    assert.deepEqual(reasons(judgement), all("no_party"));
  }
  assert.deepEqual(reasons(judgeTrade(alone, () => ({ verdict: "separate", rules: "test" }))), all("no_party"));
  /* One party named is enough to ask about. */
  assert.equal((await judgeCityTrade(trade({ creator: null, host: null, friend: FRIEND }), clusters())).cluster, "outside");
});

test("the city points list has no reason for volume, trades or launches", () => {
  assert.ok(POINTS_REASONS.every((reason) => !/volume|trade|swap|launch/.test(reason)));
});

test("the funding trail of the Growth line can say «same», never «separate»", () => {
  const party = (hashes, chain = [], ancestors = chain) => ({ hashes, chain, ancestors, complete: true, deep: false });
  assert.deepEqual(fundingVerdict(party(["h:a"], ["h:b"]), party(["h:b"])), { verdict: "same", reason: "direct_funds", rules: PROTECT_RULES.version });
  assert.deepEqual(fundingVerdict(party(["h:a"], ["h:x"]), party(["h:b"], ["h:x"])), { verdict: "same", reason: "shared_funder", rules: PROTECT_RULES.version });
  assert.deepEqual(fundingVerdict(party(["h:a"], ["h:x"]), party(["h:b"], ["h:y"])), { verdict: "unknown", why: "funding_only" });
});

/* ---------------------------------------------------------------------------------------------- */

/* `at` is when the event was emitted, `sourceAt` its chain time as the feed shows it, `tradeAt` the trade's own time. */
const event = (n, cluster, over = {}) => ({
  id: `e${n}`,
  at: over.at ?? AT,
  source: over.source ?? "engine",
  kind: "launch",
  subject: MINT,
  sourceAt: over.sourceAt === undefined ? AT : over.sourceAt,
  payload: { ...honestCountMark({ tx: tx(over.tx ?? n), at: over.tradeAt ?? AT, cluster }), other: 1 },
});

test("the week's share of trades inside one cluster, counted from the city's events", () => {
  const events = [
    event(1, "inside"),
    event(2, "outside"),
    event(3, "outside"),
    event(4, "outside"),
    event(5, "unknown"),
    /* The same trade re-checked later: its latest report counts, once. */
    event(6, "unknown", { tx: 2, at: "2026-10-20T00:00:00.000Z" }),
    event(7, "inside", { tx: 3, at: "2026-10-22T00:00:00.000Z" }),
    /* Not this week, the world's own routes, no chain time, no mark: not counted. */
    event(8, "inside", { tradeAt: "2026-10-27T00:00:00.000Z" }),
    event(9, "inside", { source: "world" }),
    event(10, "inside", { sourceAt: null }),
    { ...event(11, "inside"), payload: { honestCount: { v: 2, tx: tx(11), at: AT, cluster: "inside" } } },
    { ...event(12, "inside"), payload: { honestCount: { v: 1, tx: tx(12), cluster: "inside" } } },
  ];
  const share = weeklyClusterShare(events, "2026-10-25T23:59:59.000Z");
  assert.deepEqual(share.week, { start: "2026-10-19T00:00:00.000Z", end: "2026-10-26T00:00:00.000Z" });
  assert.equal(share.trades, 5);
  assert.deepEqual([share.inside, share.outside, share.unknown], [2, 2, 1]);
  assert.equal(share.insideBps, 5_000);
  assert.equal(share.uncheckedBps, 2_000);
});

test("a trade counts in its own week, even when its re-check is emitted the week after", () => {
  const NEXT = "2026-10-28T09:00:00.000Z";
  const events = [
    event(1, "unknown"),
    /* Re-checked next week: emitted then, shown then, still the trade of the 21st. */
    event(2, "inside", { tx: 1, at: NEXT, sourceAt: NEXT }),
  ];
  const week = weeklyClusterShare(events, AT);
  assert.deepEqual([week.trades, week.inside, week.unknown], [1, 1, 0]);
  const next = weeklyClusterShare(events, NEXT);
  assert.equal(next.trades, 0, "nothing moves into the week of the report");
  const judged = honestCountMark(judgeTrade(trade(), () => ({ verdict: "separate", rules: "test" })));
  assert.equal(judged.honestCount.at, AT, "the mark carries the trade's own time");
});

test("a week with nothing checked has no share yet, and a week with no trades has none at all", () => {
  const unchecked = weeklyClusterShare([event(1, "unknown")], AT);
  assert.equal(unchecked.insideBps, null);
  assert.equal(unchecked.uncheckedBps, 10_000);
  const empty = weeklyClusterShare([], AT);
  assert.deepEqual([empty.trades, empty.insideBps, empty.uncheckedBps], [0, null, null]);
});
