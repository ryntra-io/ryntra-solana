import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { REWARD_RULES_CURRENT } from "../../lib/rewards/rules.ts";
import { POINTS_POLICY_V1 } from "../../lib/points/policy.ts";
import { PARTNERS_OFFER, PARTNERS_OPEN } from "./partners.ts";
import { setRewardsEnv, useRewardsRead } from "./store.ts";
import {
  along,
  countShown,
  dollarsOf,
  earning,
  groupedOf,
  latest,
  linkShown,
  pointsOf,
  rankOf,
  rewardsOf,
  rulesLadder,
  rulesShares,
  screenOf,
  shareShown,
  sharesOf,
  solShown,
  tabsShown,
  usdShown,
} from "./view.ts";
import { REWARDS } from "./words.ts";

/* «Rewards» in the terminal: the Growth line's one answer read as the screen shows it — points, level, place, rank,
   cashback, the link and what friends brought in SOL — and the rules beside it before a wallet. Nothing counted here. */

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const read = (path) => readFileSync(join(REPO, path), "utf8");
const ANSWER = JSON.parse(read("terminal/rewards/fixtures/answer.json"));
const OWNER = ANSWER.address;

test("the points of a proven wallet: the total, the level's span, the place among wallets, the volume", () => {
  const points = pointsOf(ANSWER);
  assert.deepEqual(points, { total: 12480, level: 3, levelFrom: 5000, nextAt: 25000, place: 37, ranked: 1240, volume: 48210.55, trades: 186, activeDays: 23 });
  assert.equal(pointsOf({ ...ANSWER, points: null }), null, "a ledger that was not read is unavailable, never zero");
  assert.equal(pointsOf({ ...ANSWER, points: { ...ANSWER.points, rank: null } }).place, null, "no place is a dash, not the first");
  assert.equal(pointsOf({ ...ANSWER, points: { ...ANSWER.points, nextLevelAt: null } }).nextAt, null, "the top level has no next");
  assert.equal(groupedOf("12 480"), 12480);
  assert.equal(groupedOf("12 480"), 12480);
  assert.equal(groupedOf("12.5"), null);
  assert.equal(dollarsOf("$48 210.55"), 48210.55);
  assert.equal(dollarsOf("—"), null);
});

test("the rank over 30 days: which, its next, what it pays on a friend's trade, and its ladder", () => {
  const rank = rankOf(ANSWER);
  assert.equal(rank.id, "GOLD");
  assert.equal(rank.share, 20);
  assert.deepEqual(rank.next, { id: "SAPPHIRE", at: 1000 });
  assert.equal(rank.ladder.length, 5);
  assert.deepEqual(rank.ladder[2], { id: "GOLD", from: 100, share: 20 });
  assert.equal(rankOf({ ...ANSWER, rank: null }), null, "unavailable, not Bronze");
  assert.equal(rankOf({ ...ANSWER, rank: { ...ANSWER.rank, rank: "PLATINUM" } }), null, "a rank the screen does not know is not guessed");
  // Before a wallet: the ladder by the rules in force, the same numbers the engine prints.
  const rules = rulesLadder();
  assert.deepEqual(rules.map((rung) => rung.id), ["BRONZE", "SILVER", "GOLD", "SAPPHIRE", "DIAMOND"]);
  assert.deepEqual(rules.map((rung) => rung.share), Object.values(REWARD_RULES_CURRENT.referralL1BpsByRank).map((bps) => bps / 100));
  assert.deepEqual(rules.map((rung) => rung.from), rank.ladder.map((rung) => rung.from), "the recorded answer's ladder is the rules' own");
});

test("the whole answer: the friends' part is the city's own projection; not a proven answer is nothing", () => {
  const view = rewardsOf(ANSWER);
  assert.equal(view.friends.link, "https://ryntra.io/r/K7Q2M8XPLW4Z");
  assert.equal(view.friends.friends, 14);
  assert.equal(view.friends.friendsOfFriends, 3);
  assert.equal(view.friends.fromFriends, "64.50", "level one and level two, in cents");
  assert.equal(view.friends.cashback, "21.85");
  assert.equal(rewardsOf({ ok: false }), null);
  assert.equal(rewardsOf(null), null);
});

test("figures as the eye reads them: dollars, SOL at the market's price, counts and shares in each language", () => {
  assert.equal(usdShown("21.85", "en"), "$21.85");
  assert.equal(usdShown("1234.50", "en"), "$1,234.50");
  assert.equal(usdShown("1234.50", "uk"), "$1 234,50");
  assert.equal(usdShown("<0.01", "en"), "<$0.01");
  assert.equal(usdShown("—", "en"), "—");
  assert.equal(solShown("64.50", 150, "en"), "0.43");
  assert.equal(solShown("64.50", 150, "uk"), "0,43");
  assert.equal(solShown("0.00", 150, "en"), "0");
  assert.equal(solShown("64.50", null, "en"), null, "without a price, never a guessed SOL");
  assert.equal(solShown("<0.01", 150, "en"), null);
  assert.equal(solShown("300000.00", 150, "en"), "2,000");
  assert.equal(countShown(12480, "en"), "12,480");
  assert.equal(countShown(12480, "uk"), "12 480");
  assert.equal(shareShown(20, "en"), "20%");
  assert.equal(shareShown(0.5, "uk"), "0,5 %");
  assert.equal(linkShown("https://ryntra.io/r/K7Q2M8XPLW4Z/"), "ryntra.io/r/K7Q2M8XPLW4Z");
});

test("a span: the level's bar from where it began to the next, full at the top, never outside 0 … 1", () => {
  assert.equal(along(12480, 5000, 25000), 0.374);
  assert.equal(along(5000, 5000, 25000), 0);
  assert.equal(along(30000, 5000, 25000), 1);
  assert.equal(along(120000, 100000, null), 1);
  assert.equal(along(10, 10, 10), 0);
});

test("what earns and what a friend's trade pays, from the rules in force — never typed by hand", () => {
  const e = earning();
  assert.equal(e.perDollar, Number(POINTS_POLICY_V1.volumeTiers[0].pointsPerThousandUsd) / 1000);
  assert.equal(e.activeDay, Number(POINTS_POLICY_V1.activeDay.points));
  assert.equal(e.friend, Number(POINTS_POLICY_V1.qualifiedReferral.points));
  assert.equal(e.dayCap, Number(POINTS_POLICY_V1.dailyVolumePointsCap));
  const rules = rulesShares();
  assert.equal(rules.friend, REWARD_RULES_CURRENT.referralL1BpsByRank.BRONZE / 100);
  assert.deepEqual(rules.firstDays, { share: REWARD_RULES_CURRENT.inviterWindow.bps / 100, days: REWARD_RULES_CURRENT.inviterWindow.days });
  assert.equal(rules.second, REWARD_RULES_CURRENT.referralL2Bps / 100);
  const mine = sharesOf(rewardsOf(ANSWER).friends);
  assert.equal(mine.friend, 20, "the wallet's own rank pays its own share");
  assert.deepEqual(mine.firstDays, { share: 30, days: 90 });
});

test("the latest rows: the kinds a tab asks for, newest first, a few", () => {
  const rows = rewardsOf(ANSWER).friends.rows;
  const friends = latest(rows, ["REFERRAL_L1", "REFERRAL_L2", "CLAIM"], 4);
  assert.deepEqual(friends.map((row) => row.kind), ["REFERRAL_L1", "REFERRAL_L1", "REFERRAL_L2", "CLAIM"]);
  assert.equal(friends[0].coin, "JUP");
  assert.equal(friends[3].out, true, "a payout is money out");
  assert.equal(latest(rows, ["CASHBACK"]).length, 1);
});

test("what a tab shows: a wallet to connect, its one signature, the read, the figures, or a read that failed", () => {
  const view = rewardsOf(ANSWER);
  assert.equal(screenOf(null, "ready", view), "connect");
  assert.equal(screenOf(OWNER, "proof", null), "prove");
  assert.equal(screenOf(OWNER, "proving", null), "prove");
  assert.equal(screenOf(OWNER, "reading", null), "reading");
  assert.equal(screenOf(OWNER, "reading", view), "ready", "a read again keeps the figures on screen");
  assert.equal(screenOf(OWNER, "failed", view), "ready", "a hiccup keeps the figures");
  assert.equal(screenOf(OWNER, "failed", null), "failed");
});

test("«For partners» stands only while the programme is open: its terms set and its payouts running", () => {
  assert.deepEqual(tabsShown(false), ["points", "invite"]);
  assert.deepEqual(tabsShown(true), ["points", "invite", "partners"]);
  assert.equal(PARTNERS_OPEN, PARTNERS_OFFER !== null && read("city/lib/partners/facts.ts").includes("export const PAYOUTS: 'counting' | 'open' = 'open';"));
});

test("the read: a proven wallet's figures; the one signature asked for only by a tap; another wallet's answer dropped", async () => {
  const asked = [];
  let proven = false;
  let signatures = 0;
  setRewardsEnv({
    now: () => 1_000,
    fetch: async (url) => {
      asked.push(url);
      if (!proven) return { ok: false, status: 401, json: async () => ({ error: "proof required" }) };
      return { ok: true, status: 200, json: async () => ANSWER };
    },
    prove: async () => {
      signatures += 1;
      proven = true;
      return { ok: true };
    },
  });
  const store = useRewardsRead.getState();
  store.reset();
  await store.read(OWNER, "uk");
  assert.equal(useRewardsRead.getState().status, "proof", "no proof here: the screen asks, it never opens the wallet itself");
  assert.equal(signatures, 0);
  assert.match(asked[0], /^\/api\/rewards\?address=4EeX.*&locale=uk$/);
  await useRewardsRead.getState().prove({ wallet: "Phantom", address: OWNER }, "uk");
  assert.equal(signatures, 1);
  assert.equal(useRewardsRead.getState().status, "ready");
  assert.equal(useRewardsRead.getState().view.points.total, 12480);
  // Within a minute the same wallet is not read again.
  await useRewardsRead.getState().read(OWNER, "uk");
  assert.equal(asked.length, 2);

  // A declined signature is a person's own «no»: no line in flare.
  setRewardsEnv({ prove: async () => ({ ok: false, state: "declined", message: "Nothing was signed." }), fetch: async () => ({ ok: false, status: 401, json: async () => ({}) }) });
  useRewardsRead.getState().reset();
  await useRewardsRead.getState().prove({ wallet: "Phantom", address: OWNER }, "en");
  assert.equal(useRewardsRead.getState().status, "proof");
  assert.equal(useRewardsRead.getState().message, null);

  // Another wallet came while the first was read: the first one's answer is not this screen's.
  let release;
  setRewardsEnv({ fetch: () => new Promise((done) => (release = () => done({ ok: true, status: 200, json: async () => ANSWER }))) });
  useRewardsRead.getState().reset();
  const first = useRewardsRead.getState().read(OWNER, "en");
  useRewardsRead.getState().reset();
  release();
  await first;
  assert.equal(useRewardsRead.getState().view, null);
  assert.equal(useRewardsRead.getState().status, "none");

  // A read that fails keeps nothing it did not have, and says so.
  setRewardsEnv({ fetch: async () => ({ ok: false, status: 503, json: async () => ({ ok: false }) }) });
  await useRewardsRead.getState().read(OWNER, "en", true);
  assert.equal(useRewardsRead.getState().status, "failed");
});

test("the screen: one page of its kind, one amber action a tab, every word from its dictionary, no rule written here", () => {
  const screen = read("terminal/rewards/RewardsScreen.tsx");
  const parts = read("terminal/rewards/parts.tsx");
  assert.match(screen, /<Page data-rewards-screen=""/);
  assert.match(screen, /<PageHead title=\{menu\.rewards\}/);
  // Each tab's main column is one function, and each draws its one Action (or hands it to `Ask`).
  for (const name of ["PointsMain", "InviteMain", "PartnersMain"]) {
    const body = screen.slice(screen.indexOf(`function ${name}(`), screen.indexOf("\n}\n", screen.indexOf(`function ${name}(`)));
    assert.equal((body.match(/<Action[\s>]/g) ?? []).length, 1, `${name}: one amber action`);
  }
  assert.equal((parts.match(/<Action[\s>]/g) ?? []).length, 1, "the ask's one action");
  assert.equal((parts.match(/tone="hi"/g) ?? []).length, 3, "the ask, the read and the failure are the one action panel");
  // Nothing here pays, binds or writes: one read, one proof.
  const store = read("terminal/rewards/store.ts");
  assert.doesNotMatch(store, /method:\s*['"](POST|PUT|PATCH|DELETE)/);
  assert.doesNotMatch(`${screen}${parts}${store}`, /\/api\/rewards\/(claim|referral)/, "no payout, no binding from the terminal");
  // The words of both halves.
  assert.deepEqual(Object.keys(REWARDS.uk).sort(), Object.keys(REWARDS.en).sort());
});
