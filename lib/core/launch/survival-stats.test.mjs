// SOL-L3 (SOL-L0 finding З19): the public survival of Ryntra's markets at 7, 30 and 90 days — one definition, each
// market that lived proven by a trade's transaction, a week not read never counted as quiet.
import assert from "node:assert/strict";
import test from "node:test";

import { marketSurvival, survivalDecided, survivalRateBps, survivalStats, survivalWindow, windowCovered, windowOutcome } from "./survival-stats.ts";

const DAY = 86_400;
const LAUNCH = 1_760_000_000;
const CREATOR = "Creator1111111111111111111111111111111111";
const RYNTRA = "Ryntra11111111111111111111111111111111111";
const BUYER = "Buyer111111111111111111111111111111111111";
const WHOLE = { complete: true, coveredFrom: null, gaps: [] };
const trade = (day, trader = BUYER, payer = trader) => ({ signature: `sig${day}`, at: LAUNCH + day * DAY, trader, payer });
const excluded = new Set([CREATOR, RYNTRA]);
const at = (outcomes, days) => outcomes.find((outcome) => outcome.days === days);

test("the window of day N is the week before it, never before the launch", () => {
  assert.deepEqual(survivalWindow(LAUNCH, 7), { from: LAUNCH, to: LAUNCH + 7 * DAY });
  assert.deepEqual(survivalWindow(LAUNCH, 30), { from: LAUNCH + 23 * DAY, to: LAUNCH + 30 * DAY });
  assert.deepEqual(survivalWindow(LAUNCH, 90), { from: LAUNCH + 83 * DAY, to: LAUNCH + 90 * DAY });
});

test("a trade by someone else in the week proves the market lived; the creator's and Ryntra's prove nothing", () => {
  const outcomes = marketSurvival({ launchedAt: LAUNCH, trades: [trade(1), trade(25, CREATOR), trade(26, BUYER, CREATOR), trade(85, RYNTRA)], cover: WHOLE, excluded, now: LAUNCH + 100 * DAY });
  assert.deepEqual(at(outcomes, 7), { days: 7, state: "alive", proof: { signature: "sig1", at: LAUNCH + DAY } });
  assert.equal(at(outcomes, 30).state, "quiet", "the creator's trade, and a buy the creator paid for, are not demand");
  assert.equal(at(outcomes, 90).state, "quiet", "Ryntra's own trade is not demand");
  assert.ok(outcomes.every(survivalDecided));
});

test("the newest trade of the week is the proof", () => {
  const outcomes = marketSurvival({ launchedAt: LAUNCH, trades: [trade(2), trade(5), trade(3)], cover: WHOLE, excluded, now: LAUNCH + 8 * DAY });
  assert.equal(at(outcomes, 7).proof.signature, "sig5");
});

test("younger than N days: not counted at N", () => {
  const outcomes = marketSurvival({ launchedAt: LAUNCH, trades: [trade(1)], cover: WHOLE, excluded, now: LAUNCH + 10 * DAY });
  assert.deepEqual(outcomes.map((outcome) => outcome.state), ["alive", "young", "young"]);
});

test("a week not read whole is «not read», never «quiet»", () => {
  const cut = { complete: false, coveredFrom: LAUNCH + 50 * DAY, gaps: [] };
  const outcomes = marketSurvival({ launchedAt: LAUNCH, trades: [], cover: cut, excluded, now: LAUNCH + 100 * DAY });
  assert.deepEqual(outcomes.map((outcome) => outcome.state), ["unread", "unread", "quiet"]);
  const gap = { complete: false, coveredFrom: null, gaps: [LAUNCH + 3 * DAY] };
  assert.equal(windowCovered(gap, survivalWindow(LAUNCH, 7)), false);
  assert.equal(windowCovered(gap, survivalWindow(LAUNCH, 30)), true);
});

test("the tallies count people's markets and Ryntra's own apart; the rate is of the markets decided", () => {
  const now = LAUNCH + 40 * DAY;
  const markets = [
    { own: true, outcomes: marketSurvival({ launchedAt: LAUNCH, trades: [trade(1)], cover: WHOLE, excluded, now }) },
    { own: false, outcomes: marketSurvival({ launchedAt: LAUNCH, trades: [trade(2), trade(29)], cover: WHOLE, excluded, now }) },
    { own: false, outcomes: marketSurvival({ launchedAt: LAUNCH, trades: [], cover: WHOLE, excluded, now }) },
    { own: false, outcomes: marketSurvival({ launchedAt: LAUNCH, trades: [], cover: { complete: false, coveredFrom: now, gaps: [] }, excluded, now }) },
    { own: false, outcomes: marketSurvival({ launchedAt: now - DAY, trades: [], cover: WHOLE, excluded, now }) },
  ];
  const [d7, d30, d90] = survivalStats(markets);
  assert.deepEqual(d7.people, { eligible: 3, alive: 1, quiet: 1, unread: 1 });
  assert.deepEqual(d7.ryntra, { eligible: 1, alive: 1, quiet: 0, unread: 0 });
  assert.deepEqual(d30.people, { eligible: 3, alive: 1, quiet: 1, unread: 1 });
  assert.deepEqual(d90.people, { eligible: 0, alive: 0, quiet: 0, unread: 0 });
  assert.equal(survivalRateBps(d7.people), null, "a market not read leaves no rate: it is most often a busy one");
  assert.equal(survivalRateBps({ eligible: 2, alive: 1, quiet: 1, unread: 0 }), 5_000);
  assert.equal(survivalRateBps(d90.people), null, "nothing decided: no rate, never 0 %");
});

test("a window read on its own: alive on a trade that proves demand even from a part; quiet only when read whole", () => {
  const read = (trades, complete) => windowOutcome(30, { trades, complete }, LAUNCH, excluded);
  assert.equal(read([trade(25)], false).state, "alive", "a proof needs no whole read");
  assert.equal(read([trade(25, CREATOR)], true).state, "quiet");
  assert.equal(read([trade(25, CREATOR)], false).state, "unread");
  assert.equal(read([trade(20)], true).state, "quiet", "a trade before the window is not in it");
});

test("a list cut at the window's very start does not cover it", () => {
  assert.equal(windowCovered({ complete: false, coveredFrom: LAUNCH, gaps: [] }, survivalWindow(LAUNCH, 7)), false);
  assert.equal(windowCovered({ complete: false, coveredFrom: LAUNCH - 1, gaps: [] }, survivalWindow(LAUNCH, 7)), true);
});
