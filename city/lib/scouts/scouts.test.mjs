import { test } from "node:test";
import assert from "node:assert/strict";

import { addUsd, ago, figure, flaggedMints, linkText, MAX_FLAGS, scoutsOf, screenOf, solPrice, xIntent } from "./view.ts";
import { openScouts, setScoutsEnv, useScouts } from "./store.ts";

// «Scouts» (CITY-8): the Growth engine's link, friends and shares, shown «$ ≈ SOL» (decision 73), and a flag on the
// towers the people you brought trade. No network: `/api/rewards` is a stub with the engine's own shape.

const OWNER = "4EeXQa4MKrBSwDj9pHEoZXjiiUaZmWzveGq5X9dUKPGW";
const SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const JUP = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const WIF = "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm";

const tower = (id, symbol, price = 1, verified = true) => ({ id, symbol, verified, price });
const TOWERS = [tower(SOL, "SOL", 180), tower(USDC, "USDC", 1), tower(BONK, "BONK"), tower(JUP, "JUP"), tower(WIF, "WIF"), tower("Twin1111111111111111111111111111111111111111", "TWIN"), tower("Twin2222222222222222222222222222222222222222", "TWIN"), tower("Anon111111111111111111111111111111111111111", "ANON", 1, false)];

/** What `/api/rewards` answers for a proven wallet (`app/api/rewards/route.ts`), trimmed to what the city reads. */
const ANSWER = {
  ok: true,
  address: OWNER,
  available: "0.00",
  pending: "1.10",
  lifetime: "12.40",
  cashback: "4.05",
  referralL1: "7.80",
  referralL2: "0.55",
  claimable: false,
  referrals: { level1: 6, level2: 2 },
  referral: { code: "K7Q2M9XW4HPT", link: "https://ryntra.io/r/K7Q2M9XW4HPT" },
  rows: [
    { kind: "REFERRAL_L1", display: "+$0.42", amount: "0.42", valued: true, detail: "BONK", at: "2026-10-29T10:00:00.000Z" },
    { kind: "REFERRAL_L1", display: "+$0.30", amount: "0.30", valued: true, detail: "SOL", at: "2026-10-29T09:00:00.000Z" },
    { kind: "REFERRAL_L2", display: "+$0.05", amount: "0.05", valued: true, detail: "$JUP", at: "2026-10-28T09:00:00.000Z" },
    { kind: "CASHBACK", display: "+$1.00", amount: "1.00", valued: true, detail: "WIF", at: "2026-10-29T11:00:00.000Z" },
    { kind: "REFERRAL_L1", display: "—", amount: "—", valued: false, detail: "TWIN", at: "2026-10-27T09:00:00.000Z" },
    { kind: "CLAIM", display: "−$2.00", amount: "2.00", valued: true, detail: null, at: "2026-10-20T09:00:00.000Z" },
    { kind: "ADJUSTMENT", display: "+$9.00", amount: "9.00", valued: true, detail: null, at: "2026-10-20T09:00:00.000Z" },
  ],
  rank: { rank: "SILVER", friendShare: 15, secondLevelShare: 5 },
  programme: { inviterWindow: { share: 30, days: 90 } },
};

test("every figure reads «$ ≈ SOL» at the city's SOL price, and never guesses a SOL it cannot say", () => {
  assert.deepEqual(figure("12.40", 180), { usd: "$12.40", sol: "≈ 0.0689 SOL" });
  assert.deepEqual(figure("1800.00", 180), { usd: "$1,800.00", sol: "≈ 10 SOL" });
  assert.deepEqual(figure("0.00", 180), { usd: "$0.00", sol: null }, "a zero is one figure, no «0 SOL» under it");
  assert.deepEqual(figure("<0.01", 180), { usd: "<$0.01", sol: null }, "a sub-cent share keeps its bound and no SOL");
  assert.deepEqual(figure("—", 180), { usd: "—", sol: null }, "a share with no value yet is a dash, not a zero");
  assert.deepEqual(figure("12.40", null), { usd: "$12.40", sol: null }, "without a SOL price only the dollars");
  assert.deepEqual(figure("12.40", 0), { usd: "$12.40", sol: null });
  assert.deepEqual(figure("NaN", 180), { usd: "—", sol: null });
  assert.equal(solPrice(TOWERS), 180, "the SOL tower's price");
  assert.equal(solPrice([tower(BONK, "BONK")]), null, "no SOL tower, no SOL price");
  assert.equal(solPrice([tower(SOL, "SOL", 0)]), null);
});

test("two engine figures add up in cents, and a sub-cent part is not lost as a zero", () => {
  assert.equal(addUsd("7.80", "0.55"), "8.35");
  assert.equal(addUsd("0.00", "0.00"), "0.00");
  assert.equal(addUsd("<0.01", "0.00"), "<0.01");
  assert.equal(addUsd("0.05", "0.05"), "0.10");
  assert.equal(addUsd("1999.99", "0.01"), "2000.00");
});

test("the engine's answer becomes the window's view: link, friends, shares, history", () => {
  const view = scoutsOf(ANSWER);
  assert.equal(view.link, "https://ryntra.io/r/K7Q2M9XW4HPT");
  assert.equal(view.friends, 6);
  assert.equal(view.friendsOfFriends, 2);
  assert.equal(view.earned, "12.40");
  assert.equal(view.fromFriends, "8.35", "a friend's and a friend's friend's share together");
  assert.equal(view.cashback, "4.05");
  assert.equal(view.pending, "1.10");
  assert.equal(view.friendShare, 15, "the share at this wallet's rank, from the engine");
  assert.equal(view.secondShare, 5);
  assert.equal(view.cashbackShare, 50, "the Growth line's cashback rate");
  assert.deepEqual(view.firstDays, { share: 30, days: 90 });
  assert.equal(view.rank, "SILVER");
  assert.equal(view.rows.length, 6, "an adjustment is no row of the history");
  assert.equal(view.rows.find((row) => row.kind === "CLAIM").out, true);
  assert.equal(view.rows[2].coin, "$JUP");
});

test("an answer that is not a proven wallet's is no view, and a broken field is a zero, never a made-up figure", () => {
  assert.equal(scoutsOf({ error: "proof required", proof: false }), null);
  assert.equal(scoutsOf({ ok: false, error: "REWARDS_UNAVAILABLE" }), null);
  assert.equal(scoutsOf(null), null);
  const view = scoutsOf({ ok: true, lifetime: "lots", referrals: { level1: -3 }, referral: { link: "javascript:alert(1)" }, rank: null, rows: "x" });
  assert.equal(view.earned, "0.00");
  assert.equal(view.friends, 0);
  assert.equal(view.link, null, "only a web link is shared");
  assert.equal(view.friendShare, null, "no rank, no share at it");
  assert.equal(view.firstDays, null);
  assert.deepEqual(view.rows, []);
});

test("flags stand on the towers the people you brought trade — never on SOL, a stablecoin, a twin ticker or a nameless tower", () => {
  const view = scoutsOf(ANSWER);
  assert.deepEqual(flaggedMints(view.rows, TOWERS), [BONK, JUP], "a friend's BONK, a friend's friend's JUP, newest first");
  assert.ok(!flaggedMints(view.rows, TOWERS).includes(WIF), "your own cashback flags nothing: a scout's flag is for the people you brought");
  assert.deepEqual(flaggedMints([{ kind: "REFERRAL_L1", amount: "0.10", out: false, coin: "TWIN", at: "2026-10-29T00:00:00Z" }], TOWERS), [], "two towers share the ticker: not guessed");
  assert.deepEqual(flaggedMints([{ kind: "REFERRAL_L1", amount: "0.10", out: false, coin: "ANON", at: "2026-10-29T00:00:00Z" }], TOWERS), [], "an unnamed tower gets no flag");
  assert.deepEqual(flaggedMints([{ kind: "REFERRAL_L1", amount: "0.10", out: false, coin: "USDC", at: "2026-10-29T00:00:00Z" }], TOWERS), []);
  assert.deepEqual(flaggedMints([], TOWERS), [], "nobody brought, no flags");
  const many = Array.from({ length: 40 }, (_, i) => tower(`Mint${String(i).padStart(40, "x")}`, `C${i}`));
  const rows = many.map((t, i) => ({ kind: "REFERRAL_L1", amount: "0.01", out: false, coin: t.symbol, at: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString() }));
  const flags = flaggedMints([...rows, ...rows], many);
  assert.equal(flags.length, MAX_FLAGS, "a quiet city: at most a handful of flags");
  assert.equal(new Set(flags).size, flags.length, "one flag a tower");
  assert.equal(flags[0], many[39].id, "the newest first");
});

test("without a wallet the window is the empty state and asks the engine nothing", async () => {
  const asked = [];
  setScoutsEnv({ fetch: async (url) => (asked.push(url), { ok: true, status: 200, json: async () => ANSWER }) });
  useScouts.getState().reset();
  openScouts();
  assert.equal(useScouts.getState().open, true);
  const { owner, status, view } = useScouts.getState();
  assert.equal(screenOf(null, status, view), "connect");
  assert.equal(owner, null);
  assert.deepEqual(asked, [], "no wallet, no read");
  useScouts.getState().close();
});

test("a wallet without its proof is asked once to sign in, then the engine answers", async () => {
  const asked = [];
  let proven = false;
  setScoutsEnv({
    fetch: async (url) => (asked.push(url), proven ? { ok: true, status: 200, json: async () => ANSWER } : { ok: false, status: 401, json: async () => ({ error: "proof required" }) }),
    prove: async () => ((proven = true), { ok: true }),
    now: () => 1_000,
  });
  useScouts.getState().reset();
  await useScouts.getState().read(OWNER);
  assert.equal(useScouts.getState().status, "proof");
  assert.equal(screenOf(OWNER, useScouts.getState().status, useScouts.getState().view), "prove");
  assert.equal(asked[0], `/api/rewards?address=${OWNER}&locale=en`, "the Growth engine's own read, unchanged");
  await useScouts.getState().prove({ wallet: "Phantom", address: OWNER });
  const state = useScouts.getState();
  assert.equal(state.status, "ready");
  assert.equal(screenOf(OWNER, state.status, state.view), "ready");
  assert.equal(state.view.friends, 6);
  await useScouts.getState().read(OWNER);
  assert.equal(asked.length, 2, "a fresh answer is not asked again");
});

test("a declined signature is an answer, not an error; another wallet takes the last one's figures with it", async () => {
  setScoutsEnv({
    fetch: async () => ({ ok: false, status: 401, json: async () => ({}) }),
    prove: async () => ({ ok: false, state: "declined", message: "Nothing was signed." }),
  });
  useScouts.getState().reset();
  await useScouts.getState().prove({ wallet: "Phantom", address: OWNER });
  assert.equal(useScouts.getState().status, "proof");
  assert.equal(useScouts.getState().message, null);

  setScoutsEnv({ fetch: async () => ({ ok: true, status: 200, json: async () => ANSWER }), now: () => 5_000 });
  await useScouts.getState().read(OWNER, true);
  assert.equal(useScouts.getState().view.friends, 6);
  useScouts.getState().reset();
  assert.equal(useScouts.getState().view, null, "no figures of the last wallet");
});

test("a wallet switched while the last one was signing keeps the new wallet's state: the old proof writes nothing", async () => {
  const OTHER = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
  let release;
  const asked = [];
  setScoutsEnv({
    fetch: async (url) => (asked.push(url), { ok: false, status: 401, json: async () => ({}) }),
    prove: () => new Promise((resolve) => (release = resolve)),
  });
  useScouts.getState().reset();
  const proving = useScouts.getState().prove({ wallet: "Phantom", address: OWNER });
  assert.equal(useScouts.getState().status, "proving");
  // The person switches to another wallet before the first one answers.
  useScouts.getState().reset();
  await useScouts.getState().read(OTHER);
  assert.equal(useScouts.getState().owner, OTHER);
  release({ ok: true });
  await proving;
  assert.equal(useScouts.getState().owner, OTHER, "the old wallet's proof does not take the window back");
  assert.equal(useScouts.getState().status, "proof");
  assert.ok(!asked.some((url) => url.includes(OWNER)), "nothing is read for the wallet that left");
  useScouts.getState().reset();
});

test("an engine that does not answer keeps what was shown and says the read failed", async () => {
  setScoutsEnv({ fetch: async () => ({ ok: true, status: 200, json: async () => ANSWER }), now: () => 0 });
  useScouts.getState().reset();
  await useScouts.getState().read(OWNER);
  setScoutsEnv({ fetch: async () => ({ ok: false, status: 503, json: async () => ({ ok: false }) }), now: () => 120_000 });
  await useScouts.getState().read(OWNER);
  assert.equal(useScouts.getState().status, "failed");
  assert.equal(useScouts.getState().view.friends, 6, "the figures stay on screen");
  useScouts.getState().reset();
  setScoutsEnv({ fetch: async () => { throw new Error("offline"); } });
  await useScouts.getState().read(OWNER);
  assert.equal(screenOf(OWNER, useScouts.getState().status, useScouts.getState().view), "failed");
});

test("the link reads short, the whole of it is shared, and X gets the link as its own field", () => {
  assert.equal(linkText("https://ryntra.io/r/K7Q2M9XW4HPT"), "ryntra.io/r/K7Q2M9XW4HPT");
  const intent = new URL(xIntent("https://ryntra.io/r/K7Q2M9XW4HPT"));
  assert.equal(intent.origin + intent.pathname, "https://x.com/intent/post");
  assert.equal(intent.searchParams.get("url"), "https://ryntra.io/r/K7Q2M9XW4HPT");
  assert.ok(!/app\/rewards/.test(intent.href), "no old address anywhere");
});

test("ages are short", () => {
  const now = Date.parse("2026-10-29T12:00:00Z");
  assert.equal(ago("2026-10-29T11:59:30Z", now), "now");
  assert.equal(ago("2026-10-29T11:15:00Z", now), "45m");
  assert.equal(ago("2026-10-29T09:00:00Z", now), "3h");
  assert.equal(ago("2026-10-27T12:00:00Z", now), "2d");
  assert.equal(ago("2026-10-01T12:00:00Z", now), "1 Oct");
});
