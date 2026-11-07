// Run from repo root: node --test lib/ring/duel/pairing.test.mjs
import "../../world/testing/hooks.mjs";
import assert from "node:assert/strict";
import { describe, test } from "node:test";

const d = await import("./index.ts");
const { emptyRating } = await import("../rating.ts");
const { PHRASES, T0, clock, crackConfig, keys } = await import("./testing/kit.mjs");

const agent = (id, extra = {}) => ({ id, owner: `a:${id}`, status: "active", weight: "light", formats: ["duo-crack", "market-replay"], ...extra });

describe("who may meet whom", () => {
  test("one class, two owners, both on, both able to play it", () => {
    assert.equal(d.pairRefusal(agent("x"), agent("y"), "duo-crack"), null);
    assert.equal(d.pairRefusal(agent("x"), agent("x"), "duo-crack"), "SAME_AGENT");
    assert.equal(d.pairRefusal(agent("x"), agent("y", { owner: "a:x" }), "duo-crack"), "SAME_OWNER");
    assert.equal(d.pairRefusal(agent("x"), agent("y", { weight: "heavy" }), "duo-crack"), "WEIGHT");
    assert.equal(d.pairRefusal(agent("x"), agent("y", { formats: ["duo-crack"] }), "market-replay"), "FORMAT");
    assert.equal(d.pairRefusal(agent("x", { status: "off" }), agent("y"), "duo-crack"), "OFF");
  });
});

describe("series", () => {
  test("for nothing one game; Market Replay best of three; Duo Crack one game on each side", () => {
    assert.deepEqual(d.seriesPlan("duo-crack", "none"), { games: 1, needed: 1 });
    assert.deepEqual(d.seriesPlan("market-replay", "stakes"), { games: 3, needed: 2 });
    assert.deepEqual(d.seriesPlan("duo-crack", "stakes"), { games: 2, needed: 2 });
  });

  test("sides swap every game, and a seat's win is read back to its agent", () => {
    assert.deepEqual(d.seatsOf(["A", "B"], 0), ["A", "B"]);
    assert.deepEqual(d.seatsOf(["A", "B"], 1), ["B", "A"]);
    assert.equal(d.sideOf(1, 0), 1);
    assert.equal(d.sideOf(2, 0), 0);
    assert.equal(d.sideOf(1, null), null);
  });

  test("best of three stops at two wins; one each is not over; draws count as played", () => {
    const plan = d.seriesPlan("market-replay", "stakes");
    assert.deepEqual(d.seriesState(plan, [0, 0]), { wins: [2, 0], draws: 0, played: 2, winner: 0, over: true });
    assert.equal(d.seriesState(plan, [0, 1]).over, false);
    assert.deepEqual(d.seriesState(plan, [null, null, 1]), { wins: [0, 1], draws: 2, played: 3, winner: 1, over: true });
    assert.deepEqual(d.seriesState(plan, [1, null, 0]).winner, null);
    const two = d.seriesPlan("duo-crack", "stakes");
    assert.equal(d.seriesState(two, [0]).over, false);
    assert.deepEqual(d.seriesState(two, [0, 1]), { wins: [1, 1], draws: 0, played: 2, winner: null, over: true });
  });

  test("a two-game Duo Crack series with swapped sides: the same agent wins from both seats", async () => {
    const { stamp, verifyStamp } = keys();
    const plan = d.seriesPlan("duo-crack", "stakes");
    const pair = [d.houseAgent("wall"), d.houseAgent("chatty")];
    const sides = [];
    for (let game = 0; game < plan.games; game++) {
      const matchId = `series-1-g${game}`;
      const phrases = d.seatsOf(PHRASES, game);
      const config = { ...crackConfig(matchId), commits: [d.phraseCommit(matchId, 0, phrases[0]), d.phraseCommit(matchId, 1, phrases[1])] };
      const run = await d.runDuel({ format: "duo-crack", matchId, config, secrets: phrases, agents: d.seatsOf(pair, game), now: clock(), moveMs: 200 });
      const rules = d.duelRules({ format: "duo-crack", config, weight: "light", opensAt: T0, closesAt: T0 + 3_600_000 });
      const settled = d.settle({ rules, run, stamp, verifyStamp, at: T0 + 60_000 });
      assert.equal(settled.judgements[run.result.winner].verdict, "PASS");
      sides.push(d.sideOf(game, run.result.winner));
    }
    assert.deepEqual(sides, [0, 0]);
    assert.deepEqual(d.seriesState(plan, sides).winner, 0);
  });
});

describe("ratings", () => {
  test("a win moves both rows; a draw between equals moves neither", () => {
    const rows = [emptyRating("duo-crack"), emptyRating("duo-crack")];
    const [a, b] = d.rateGame(rows, 0);
    assert.deepEqual([a.rating, b.rating, a.wins, b.losses], [1224, 1176, 1, 1]);
    const [c, e] = d.rateGame(rows, null);
    assert.deepEqual([c.rating, e.rating, c.draws], [1200, 1200, 1]);
  });

  test("each row is read against the other's rating before the game", () => {
    const strong = { ...emptyRating("market-replay"), rating: 1600, games: 20 };
    const [a, b] = d.rateGame([strong, emptyRating("market-replay")], 1);
    assert.ok(a.rating < 1600 && b.rating > 1200);
    // An upset moves the newcomer more than an even win would (48 · 0.91 > 24), the veteran less (K 32).
    assert.ok(b.rating - 1200 > 24 && 1600 - a.rating < b.rating - 1200);
  });
});
