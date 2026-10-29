// Run from repo root: node --test lib/ring/dice/tournament.test.mjs
import "../../world/testing/hooks.mjs";
import assert from "node:assert/strict";
import { describe, test } from "node:test";

const { DiceError, DiceMatch, champion, createBracket, isFinished, matchConfigFor, pairing, ratingRecord, ratingRecords, readyMatches, recordResult, seedOrder } =
  await import("./index.ts");
const { T0, assertMatch, beacon } = await import("./testing/helpers.mjs");

const entrants = (n) => Array.from({ length: n }, (_, i) => ({ id: `agent-${i + 1}` }));

/** A result as the dice engine reports it; `winner` is a seat, or null for a double forfeit. */
function resultFor(bracket, matchId, winner, endedAt = T0) {
  const match = bracket.matches.find((m) => m.id === matchId);
  const players = pairing(match);
  return {
    matchId,
    ruleset: "liars-dice/1",
    players,
    winner,
    winnerId: winner === null ? null : players[winner],
    reason: winner === null ? "timeout" : "eliminated",
    faults: [],
    rounds: winner === null ? 0 : 7,
    dice: winner === null ? [5, 5] : winner === 0 ? [3, 0] : [0, 3],
    endedAt,
  };
}

/** Plays every ready match, the higher seed (lower number) winning. */
function playAll(bracket) {
  let b = bracket;
  let clock = T0;
  const seedOfId = (id) => Number(id.split("-")[1]);
  for (let ready = readyMatches(b); ready.length > 0; ready = readyMatches(b)) {
    for (const m of ready) {
      const [x, y] = pairing(m);
      b = recordResult(b, resultFor(b, m.id, seedOfId(x) < seedOfId(y) ? 0 : 1, (clock += 1_000)));
    }
  }
  return b;
}

describe("brackets", () => {
  test("seeds the standard way", () => {
    assert.deepEqual(seedOrder(4), [1, 4, 2, 3]);
    assert.deepEqual(seedOrder(8), [1, 8, 4, 5, 2, 7, 3, 6]);
  });

  test("pairs eight entrants 1-8, 4-5, 2-7, 3-6", () => {
    const b = createBracket("cup", entrants(8));
    assert.equal(b.size, 8);
    assert.equal(b.rounds, 3);
    assert.deepEqual(readyMatches(b).map(pairing), [
      ["agent-1", "agent-8"],
      ["agent-4", "agent-5"],
      ["agent-2", "agent-7"],
      ["agent-3", "agent-6"],
    ]);
    assert.ok(b.matches.map((m) => m.id).includes("cup:r3:m0"));
  });

  test("gives byes to the top seeds and moves them on", () => {
    const b = createBracket("cup", entrants(6));
    const firstRound = b.matches.filter((m) => m.round === 1);
    assert.deepEqual(firstRound.filter((m) => m.walkover).map((m) => m.winner), ["agent-1", "agent-2"]);
    assert.deepEqual(readyMatches(b).map(pairing), [
      ["agent-4", "agent-5"],
      ["agent-3", "agent-6"],
    ]);
    const semi = b.matches.find((m) => m.id === "cup:r2:m0");
    assert.deepEqual(semi.slots[0], { kind: "agent", id: "agent-1" });
    assert.equal(semi.status, "waiting");
  });

  test("plays through to a champion", () => {
    const b = playAll(createBracket("cup", entrants(5)));
    assert.equal(isFinished(b), true);
    assert.equal(champion(b), "agent-1");
    assert.equal(b.matches.filter((m) => m.result).length, 4);
  });

  test("turns a double forfeit into a walkover for the next opponent", () => {
    let b = createBracket("cup", entrants(4));
    b = recordResult(b, resultFor(b, "cup:r1:m0", null));
    const final = b.matches.find((m) => m.id === "cup:r2:m0");
    assert.deepEqual(final.slots[0], { kind: "bye" });
    b = recordResult(b, resultFor(b, "cup:r1:m1", 1));
    assert.equal(isFinished(b), true);
    assert.equal(champion(b), "agent-3");
    assert.equal(b.matches.at(-1).walkover, true);
  });

  test("keeps one owner's agents out of the same bracket", () => {
    assert.throws(() => createBracket("cup", [{ id: "a", owner: "o1" }, { id: "b", owner: "o1" }]), /owner o1/);
    assert.throws(() => createBracket("cup", [{ id: "a" }, { id: "a" }]), /twice/);
    assert.throws(() => createBracket("cup", [{ id: "a" }]), DiceError);
    assert.throws(() => createBracket("c|p", entrants(2)), DiceError);
  });

  test("refuses results for the wrong match or players, and replays", () => {
    const b = createBracket("cup", entrants(4));
    const good = resultFor(b, "cup:r1:m0", 0);
    assert.throws(() => recordResult(b, { ...good, players: ["agent-4", "agent-1"] }), /is agent-1 vs agent-4/);
    assert.throws(() => recordResult(b, { ...good, matchId: "cup:r2:m0" }), /not ready/);
    const after = recordResult(b, good);
    assert.throws(() => recordResult(after, good), /done/);
    // The original bracket is untouched.
    assert.equal(b.matches[0].status, "ready");
  });

  test("refuses a winner who is not one of the players at the named seat", () => {
    const b = createBracket("cup", entrants(4));
    const good = resultFor(b, "cup:r1:m0", 0);
    for (const bad of [
      { ...good, winnerId: "agent-2" },
      { ...good, winnerId: "agent-4" },
      { ...good, winner: null },
      { ...good, winner: 2 },
      { ...resultFor(b, "cup:r1:m0", null), winnerId: "agent-1" },
    ]) {
      assert.throws(() => recordResult(b, bad), /winner must be agent-1 at seat 0, agent-4 at seat 1 or nobody/);
    }
  });

  test("refuses a void match, which is played again", () => {
    const b = createBracket("cup", entrants(4));
    const voided = { ...resultFor(b, "cup:r1:m0", null), reason: "beacon_timeout" };
    assert.throws(() => recordResult(b, voided), /void/);
    assert.equal(readyMatches(b).length, 2);
  });

  test("builds the dice config for a ready match", () => {
    const b = createBracket("cup", entrants(2));
    const [final] = readyMatches(b);
    const cfg = matchConfigFor(final, { startedAt: T0, beacon: beacon.info });
    assertMatch(cfg, { matchId: "cup:r1:m0", players: ["agent-1", "agent-2"] });
    assert.doesNotThrow(() => new DiceMatch(cfg));
  });
});

describe("rating records", () => {
  test("scores wins and losses, and leaves double forfeits unrated", () => {
    const b = createBracket("cup", entrants(4));
    assertMatch(ratingRecord(resultFor(b, "cup:r1:m0", 1)), {
      matchId: "cup:r1:m0",
      players: ["agent-1", "agent-4"],
      scores: [0, 1],
      rated: true,
      reason: "eliminated",
    });
    assertMatch(ratingRecord(resultFor(b, "cup:r1:m0", null)), { scores: [0, 0], rated: false });
  });

  test("lists every played match of a bracket in time order, without walkovers", () => {
    const records = ratingRecords(playAll(createBracket("cup", entrants(6))));
    assert.equal(records.length, 5);
    for (let i = 1; i < records.length; i++) assert.ok(records[i].at >= records[i - 1].at);
    assertMatch(records.at(-1), { matchId: "cup:r3:m0", scores: [1, 0] });
  });
});
