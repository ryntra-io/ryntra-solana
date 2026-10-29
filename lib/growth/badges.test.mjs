import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryGuardStore } from "../guard/store.ts";
import { formatPoints } from "../points/model.ts";
import { serviceFeeQuoted, settleServiceFee } from "../swap/service-fee.ts";
import { accrueRewards } from "../rewards/accrue.ts";
import { recordRewards } from "../rewards/ledger.ts";
import { rankStanding } from "../rewards/rank.ts";
import { RANK_THRESHOLDS } from "../rewards/rules.ts";
import { recordLaunchGraduation } from "../rewards/rank-store.ts";
import { REWARD_RANKS, REWARD_RULES_V2 } from "../rewards/rules.ts";
import { achievementsOf, FIVE_FRIENDS, highestRank, ranksReached } from "./achievements.ts";
import { AVATAR_FRAMES_MAX, readAvatarFrames } from "./avatar-frames.ts";
import {
  ACHIEVEMENT_IDS,
  ACHIEVEMENT_METAL,
  achievementBadgeSvg,
  hasAvatarFrame,
  LOCKED_METAL,
  RANK_METALS,
  rankBadgeSvg,
  rankTier,
  walletAvatarSvg,
} from "./badges.ts";

const ME = "6dNVSFwbC6RGDCyEXBuMBpBHVpPTGqJnGG8kk9EMXbLp";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const ORANGE = "#FF681C";
const DAY = 86_400_000;
const T0 = Date.parse("2026-08-01T00:00:00.000Z");
const iso = (days) => new Date(T0 + days * DAY).toISOString();
/** A distinct, valid-looking address per friend. */
const friend = (n) => `Fr${String(n).padStart(3, "0")}${"x".repeat(38)}`;

let serial = 0;
/** One settled trade by `trader`, invited by `inviter`; `received` dollars reached Ryntra. */
function trade({ trader, inviter = null, received, days, at = iso(days) }) {
  serial += 1;
  const raw = String(Math.round(received * 1_000_000));
  const fee = settleServiceFee(
    serviceFeeQuoted("JUPITER_REFERRAL", { basisPoints: 50, asset: USDC, symbol: "USDC", decimals: 6, amountRaw: raw, providerRetainedPercent: 20 }),
    {
      collected: true,
      amountRaw: raw,
      settlement: { operationRef: `badge-${serial}`, userPaidRaw: raw, providerRaw: "0", ryntraRaw: raw, asset: USDC, symbol: "USDC", decimals: 6, basis: "RYNTRA_OBSERVED_SPLIT_DOCUMENTED" },
    },
  );
  const result = accrueRewards({
    fee, trader, referrerL1: inviter, referrerL2: null, settledAt: at, now: at, price: null, rules: REWARD_RULES_V2, referrerL1Rank: "BRONZE",
  });
  assert.equal(result.ok, true);
  return result.entries;
}

const launch = (wallet, mint, days) => ({ wallet, kind: "LAUNCH_GRADUATED", ref: mint, points: "250", rulesVersion: "2.0.0", at: iso(days), createdAt: iso(days) });

/* ------------------------------------------------------------- drawings */

test("five rank badges in one language: same medallion, own metal, one to five orange marks", () => {
  const drawn = REWARD_RANKS.map((rank) => rankBadgeSvg(rank, { id: `t-${rank}` }));
  for (const [index, rank] of REWARD_RANKS.entries()) {
    const svg = drawn[index];
    assert.match(svg, /^<svg [^>]*viewBox="0 0 64 64"/);
    assert.ok(svg.includes(RANK_METALS[rank].mid), `${rank} wears its own metal`);
    assert.equal((svg.match(new RegExp(`<path data-mark="" d="[^"]+" fill="${ORANGE}"/>`, "g")) ?? []).length, rankTier(rank), `${rank} has ${rankTier(rank)} orange marks`);
    assert.equal((svg.match(new RegExp(`fill="${ORANGE}"`, "g")) ?? []).length, rankTier(rank), "the orange is the marks and nothing else");
    assert.doesNotMatch(svg, /<text|<image|href=/, "drawn, never lettered or fetched");
    assert.equal(svg.match(/<path/g).length, drawn[0].match(/<path/g).length + (rank === "DIAMOND" ? 1 : 0) + (rankTier(rank) - 1), "the same shapes on every rank");
    assert.doesNotMatch(svg, /opacity="0\.5"/);
  }
  assert.equal(new Set(REWARD_RANKS.map((rank) => RANK_METALS[rank].mid)).size, 5);
});

test("a badge not reached keeps its marks, loses its metal and the orange, and its gem is empty", () => {
  const locked = rankBadgeSvg("GOLD", { id: "l", locked: true });
  assert.ok(!locked.includes(ORANGE));
  assert.ok(!locked.includes(RANK_METALS.GOLD.mid));
  assert.equal(locked.match(/<path data-mark=""/g).length, 3);
  assert.match(locked, /<g fill="none" stroke="#7C8899"/, "the gem's place, outlined");
  assert.doesNotMatch(locked, /\sopacity=/, "slate, not a faded metal");
  assert.doesNotMatch(locked, /#1B2735|#0A1118/, "no dark enamel: never heavier than a badge held on a light card");
  assert.match(locked, /fill-rule="evenodd"/, "the rim alone");
});

test("the slate of a badge not reached keeps 3:1 against the card in both themes", () => {
  const luminance = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a, b) => {
    const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
    return (x + 0.05) / (y + 0.05);
  };
  for (const ground of ["#0E1620", "#FFFFFF"]) {
    assert.ok(contrast(LOCKED_METAL.mid, ground) >= 3, `slate on ${ground}: ${contrast(LOCKED_METAL.mid, ground).toFixed(2)}`);
  }
});

test("ids carry the caller's prefix, cleaned, so two badges on a page never share a gradient", () => {
  const svg = rankBadgeSvg("SILVER", { id: ":r1:" });
  assert.match(svg, /id="r1-m"/);
  assert.match(svg, /url\(#r1-m\)/);
  assert.match(rankBadgeSvg("SILVER", { id: "9" }), /id="rb9-m"/, "an id never starts with a digit");
  const titled = rankBadgeSvg("SILVER", { title: 'Silver "rank" <b>' });
  assert.match(titled, /role="img" aria-label="Silver &quot;rank&quot; &lt;b>"/);
  assert.match(rankBadgeSvg("SILVER"), /aria-hidden="true"/);
});

test("achievements are the same medallion, round, in their own teal — never the brand orange of an action", () => {
  for (const id of ACHIEVEMENT_IDS) {
    const earned = achievementBadgeSvg(id, { id: "a", earned: true });
    const locked = achievementBadgeSvg(id, { id: "b", earned: false });
    assert.ok(earned.includes(ACHIEVEMENT_METAL.mid));
    assert.ok(!earned.includes(ORANGE));
    assert.ok(!locked.includes(ORANGE) && !locked.includes(ACHIEVEMENT_METAL.mid));
    assert.doesNotMatch(earned, /<text|<image/);
  }
  for (const rank of REWARD_RANKS) assert.notEqual(ACHIEVEMENT_METAL.mid, RANK_METALS[rank].mid);
});

test("a wallet always draws the same face; the frame is Silver and above, with the rank's gem", () => {
  assert.equal(walletAvatarSvg(ME, null, { id: "x" }), walletAvatarSvg(ME, null, { id: "x" }));
  assert.notEqual(walletAvatarSvg(ME, null, { id: "x" }), walletAvatarSvg(friend(1), null, { id: "x" }));
  assert.equal(hasAvatarFrame(null), false);
  assert.equal(hasAvatarFrame("BRONZE"), false);
  for (const rank of REWARD_RANKS) {
    const svg = walletAvatarSvg(ME, rank, { id: "f" });
    assert.equal(svg.includes(RANK_METALS[rank].mid), rank !== "BRONZE", `${rank}: frame ${rank !== "BRONZE"}`);
    assert.equal(hasAvatarFrame(rank), rank !== "BRONZE");
  }
  assert.equal(walletAvatarSvg(ME, "BRONZE", { id: "f" }), walletAvatarSvg(ME, null, { id: "f" }), "Bronze is drawn as no frame at all");
  for (let n = 0; n < 40; n += 1) {
    const face = walletAvatarSvg(friend(n), null);
    assert.ok(!face.includes(ORANGE), "the orange belongs to actions, not to faces");
    for (const rank of REWARD_RANKS) assert.ok(!face.includes(RANK_METALS[rank].mid), "a face never wears a rank's metal");
    for (const teal of ["#14B8A6", "#06B6D4", ACHIEVEMENT_METAL.mid]) assert.ok(!face.includes(teal), "a face never wears the achievements' teal");
    assert.doesNotMatch(face, /rotate\(45/, "never a rotated square, which reads as a gem");
  }
});

/* --------------------------------------------------------- achievements */

const SINCE = iso(-60);

/* The stories below are told in thresholds, not in dollars: a ladder that moves must not rewrite what they mean.
   One dollar of received fee is one point, so a threshold is also the dollars it takes to reach it. */
const SILVER = Number(RANK_THRESHOLDS.SILVER);
const GOLD = Number(RANK_THRESHOLDS.GOLD);

test("a rank's badge stays after the rank falls: Gold 40 days ago, Bronze today", () => {
  const entries = [...trade({ trader: ME, received: SILVER, days: 0 }), ...trade({ trader: ME, received: GOLD - SILVER, days: 3 })];
  const today = iso(43);
  assert.equal(rankStanding({ wallet: ME, entries, events: [], at: today }).rank, "BRONZE");
  const ranks = ranksReached({ wallet: ME, entries, events: [], at: today, since: SINCE });
  assert.deepEqual(ranks.map((step) => [step.rank, step.reached, step.at, step.from]), [
    ["BRONZE", true, null, "0"],
    ["SILVER", true, iso(0), formatPoints(RANK_THRESHOLDS.SILVER)],
    ["GOLD", true, iso(3), formatPoints(RANK_THRESHOLDS.GOLD)],
    ["SAPPHIRE", false, null, formatPoints(RANK_THRESHOLDS.SAPPHIRE)],
    ["DIAMOND", false, null, formatPoints(RANK_THRESHOLDS.DIAMOND)],
  ]);
  assert.equal(highestRank(ranks), "GOLD");
});

test("no badge is dated before ranks began: what the window already held is read at that moment", () => {
  /* Gold's worth of fee received on days 0 and 3 (before ranks); ranks begin on day 10. */
  const entries = [...trade({ trader: ME, received: SILVER, days: 0 }), ...trade({ trader: ME, received: GOLD - SILVER, days: 3 })];
  const ranks = ranksReached({ wallet: ME, entries, events: [], at: iso(20), since: iso(10) });
  assert.deepEqual(ranks.filter((step) => step.reached).map((step) => [step.rank, step.at]), [["BRONZE", null], ["SILVER", iso(10)], ["GOLD", iso(10)]]);
  /* Begun on day 40, the old trades have left the window: no badge from them. */
  assert.equal(highestRank(ranksReached({ wallet: ME, entries, events: [], at: iso(45), since: iso(40) })), "BRONZE");
  /* A trade after the start dates its own badge. */
  const later = [...entries, ...trade({ trader: ME, received: SILVER, days: 41 })];
  assert.deepEqual(ranksReached({ wallet: ME, entries: later, events: [], at: iso(45), since: iso(40) }).find((step) => step.rank === "SILVER"), { rank: "SILVER", reached: true, at: iso(41), from: formatPoints(RANK_THRESHOLDS.SILVER) });
});

test("where ranks have not begun, only the rank held now is reached, and undated", () => {
  const entries = [...trade({ trader: ME, received: SILVER, days: 0 }), ...trade({ trader: ME, received: GOLD - SILVER, days: 3 })];
  assert.deepEqual(ranksReached({ wallet: ME, entries, events: [], at: iso(5), since: null }).map((step) => [step.rank, step.reached, step.at]), [
    ["BRONZE", true, null],
    ["SILVER", true, null],
    ["GOLD", true, null],
    ["SAPPHIRE", false, null],
    ["DIAMOND", false, null],
  ]);
  assert.equal(highestRank(ranksReached({ wallet: ME, entries, events: [], at: iso(45), since: null })), "BRONZE");
});

test("the window is the rank card's own: a trade exactly 30 days earlier has left it", () => {
  /* Each trade alone is under Silver; together they reach it — so the window decides. */
  const half = Math.ceil(SILVER * 0.6);
  const out = [...trade({ trader: ME, received: half, days: 0 }), ...trade({ trader: ME, received: half, days: 30 })];
  assert.equal(highestRank(ranksReached({ wallet: ME, entries: out, events: [], at: iso(31), since: SINCE })), "BRONZE");
  const inside = [...trade({ trader: ME, received: half, days: 0 }), ...trade({ trader: ME, received: half, days: 29.99 })];
  assert.equal(highestRank(ranksReached({ wallet: ME, entries: inside, events: [], at: iso(31), since: SINCE })), "SILVER");
});

test("the highest rank reached is never above what the rank card showed at some moment", () => {
  const entries = [];
  for (let i = 0; i < 40; i += 1) entries.push(...trade({ trader: i % 3 ? ME : friend(i), inviter: i % 3 ? null : ME, received: 37 + ((i * 53) % 410), days: i * 2.3 }));
  const events = [launch(ME, "MintOne", 17), launch(ME, "MintTwo", 61)];
  const moments = [...entries.map((entry) => entry.source?.settledAt).filter(Boolean), ...events.map((event) => event.at)];
  const shown = moments.map((at) => rankStanding({ wallet: ME, entries, events, at }).rank);
  const best = shown.reduce((a, b) => (rankTier(b) > rankTier(a) ? b : a), "BRONZE");
  assert.equal(highestRank(ranksReached({ wallet: ME, entries, events, at: iso(120), since: SINCE })), best);
});

test("friends: the first friend's trade, five different friends, never oneself or a repeat", () => {
  const entries = [
    ...trade({ trader: ME, received: 5, days: 1 }),
    ...trade({ trader: friend(1), inviter: ME, received: 3, days: 2 }),
    ...trade({ trader: friend(1), inviter: ME, received: 3, days: 3 }),
    ...trade({ trader: friend(2), inviter: ME, received: 3, days: 4 }),
    ...trade({ trader: friend(3), inviter: ME, received: 3, days: 5 }),
    ...trade({ trader: friend(4), inviter: ME, received: 3, days: 6 }),
  ];
  let badges = Object.fromEntries(achievementsOf({ wallet: ME, entries, events: [], at: iso(10), since: SINCE }).badges.map((badge) => [badge.id, badge]));
  assert.deepEqual(badges.FIRST_FRIEND, { id: "FIRST_FRIEND", earned: true, at: iso(2) });
  assert.deepEqual(badges.FIVE_FRIENDS, { id: "FIVE_FRIENDS", earned: false, at: null });
  assert.equal(FIVE_FRIENDS, 5);
  entries.push(...trade({ trader: friend(5), inviter: ME, received: 3, days: 8 }));
  badges = Object.fromEntries(achievementsOf({ wallet: ME, entries, events: [], at: iso(10), since: SINCE }).badges.map((badge) => [badge.id, badge]));
  assert.deepEqual(badges.FIVE_FRIENDS, { id: "FIVE_FRIENDS", earned: true, at: iso(8) });
  /* Asked about a moment before the fifth friend traded, the badge is not yet there. */
  const earlier = achievementsOf({ wallet: ME, entries, events: [], at: iso(7), since: SINCE }).badges.find((badge) => badge.id === "FIVE_FRIENDS");
  assert.equal(earlier.earned, false);
  /* A wallet's own trade never makes it its own friend. */
  assert.equal(achievementsOf({ wallet: friend(9), entries: trade({ trader: friend(9), inviter: friend(9), received: 9, days: 1 }), events: [], at: iso(5), since: SINCE }).badges[0].earned, false);
});

test("a launch that reached a DEX, once, on the day it graduated — and absent until then", () => {
  const summary = achievementsOf({ wallet: ME, entries: [], events: [launch(ME, "MintA", 12), launch(friend(1), "MintB", 2)], at: iso(20), since: SINCE });
  assert.deepEqual(summary.badges.find((badge) => badge.id === "LAUNCH_ON_DEX"), { id: "LAUNCH_ON_DEX", earned: true, at: iso(12) });
  const none = achievementsOf({ wallet: ME, entries: [], events: [], at: iso(20), since: SINCE });
  assert.equal(none.badges.some((badge) => badge.earned), false);
  assert.deepEqual(none.badges.map((badge) => badge.id), ["FIRST_FRIEND", "FIVE_FRIENDS"], "not offered as a goal before launches are open to everyone");
});

/* --------------------------------------------------------------- frames */

test("the chart reads frames only: a rank from Silver up, or nothing", async () => {
  const store = createMemoryGuardStore();
  const now = new Date().toISOString();
  const recent = (days) => new Date(Date.now() - days * DAY).toISOString();
  const silver = friend(11);
  const gold = friend(12);
  for (const [trader, received] of [[silver, 150], [gold, 1_200], [friend(13), 20]]) {
    await recordRewards(store, trade({ trader, received, at: recent(2) }), `seed-${trader}`);
  }
  await recordLaunchGraduation(store, { creator: friend(14), mint: "MintFrame", graduatedAt: recent(1), now });
  const frames = await readAvatarFrames(store, [silver, gold, friend(13), friend(14), friend(15), silver, "short", 42], now);
  assert.deepEqual([...frames.entries()], [[silver, "SILVER"], [gold, "GOLD"], [friend(13), null], [friend(14), "SILVER"], [friend(15), null]]);
  const many = await readAvatarFrames(store, Array.from({ length: 80 }, (_, i) => friend(100 + i)), now);
  assert.equal(many.size, AVATAR_FRAMES_MAX);
});
