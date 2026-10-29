// Run from repo root: node --test lib/ring/dice/properties.test.mjs
import "../../world/testing/hooks.mjs";
import assert from "node:assert/strict";
import { describe, test } from "node:test";

const { RULES, compareBids, replay, verify } = await import("./index.ts");
const { bidCall, cases, challengeCall, config, playOut, playingMatch, tapeStrategy } = await import("./testing/helpers.mjs");

/**
 * Properties over many seeded games. Each run draws its case from `cases(name, run)`, so a failure names the run that
 * broke and the same run replays it.
 */
function forRuns(name, runs, check) {
  for (let run = 0; run < runs; run++) {
    try {
      check(cases(`${name}|${run}`));
    } catch (error) {
      error.message = `run ${run}: ${error.message}`;
      throw error;
    }
  }
}

function play({ seeds, salt, tapes }) {
  const m = playingMatch(config(), seeds, salt);
  playOut(m, [tapeStrategy(tapes[0]), tapeStrategy(tapes[1])]);
  return m;
}

/** Dice in play at the start and after the showdown of every round, as the log records them. */
function rounds(log) {
  const out = [];
  for (const entry of log.entries) {
    if (entry.type === "round") out.push({ dice: entry.hands[0].length + entry.hands[1].length });
    const current = out.at(-1);
    if (current && entry.type === "showdown") current.after = entry.dice[0] + entry.dice[1];
  }
  return out;
}

describe("properties", () => {
  test("bids always rise within a round and every round costs exactly one die", () => {
    forRuns("rise", 150, (c) => {
      const m = play(c.game());
      const result = m.result;
      assert.equal(result.reason, "eliminated");

      for (const showdown of m.publicView().history) {
        for (let i = 1; i < showdown.bids.length; i++) {
          assert.ok(compareBids(showdown.bids[i], showdown.bids[i - 1]) > 0);
          assert.notEqual(showdown.bids[i].seat, showdown.bids[i - 1].seat);
        }
      }

      const all = rounds(m.log());
      let total = 2 * RULES.dicePerPlayer;
      for (const r of all) {
        assert.equal(r.dice, total);
        assert.equal(r.after, total - 1);
        total -= 1;
      }
      assert.equal(all.length, result.rounds);
      assert.ok(result.rounds <= 2 * RULES.dicePerPlayer - 1);
      assert.ok(result.dice[result.winner] > 0);
      assert.equal(result.dice[1 - result.winner], 0);
    });
  });

  test("rolls only faces 1..6, one die per die in play", () => {
    forRuns("faces", 100, (c) => {
      const m = play(c.game());
      let dice = [RULES.dicePerPlayer, RULES.dicePerPlayer];
      for (const entry of m.log().entries) {
        if (entry.type === "round") {
          assert.deepEqual(entry.hands.map((h) => h.length), dice);
          for (const d of entry.hands.flat()) assert.ok(Number.isInteger(d) && d >= 1 && d <= RULES.faces);
        }
        if (entry.type === "showdown") dice = entry.dice;
      }
    });
  });

  test("replays every game to the live result", () => {
    forRuns("replay", 100, (c) => {
      const m = play(c.game());
      const log = JSON.parse(JSON.stringify(m.log()));
      assert.deepEqual(replay(log).result, m.result);
      assert.deepEqual(verify(log, m.result), { ok: true, result: m.result });
    });
  });

  test("never throws on arbitrary agent input; a rejected move loses for its sender", () => {
    const seen = new Set();
    forRuns("garbage", 100, (c) => {
      const anyCall = () =>
        c.pick([
          () => bidCall(c.int(-2, 14), c.int(-1, 8)),
          () => challengeCall,
          () => c.anything(),
          () => ({ name: c.pick(["bid", "challenge", "commit", "reveal", "pass"]), arguments: c.anything() }),
        ])();
      const { seeds, salt } = c.game();
      const m = playingMatch(config(), seeds, salt);
      let lastSeat = 0;
      for (let n = c.int(0, 60); n > 0 && !m.result; n--) {
        lastSeat = m.pending()[0];
        m.apply({ type: "move", seat: lastSeat, at: m.now + 1, call: anyCall() });
      }
      const result = m.result;
      if (result) seen.add(result.faults[0]?.code ?? result.reason);
      if (result && result.reason === "illegal_move") {
        assert.equal(result.faults.length, 1);
        assert.equal(result.faults[0].seat, lastSeat);
        assert.equal(result.winner, 1 - lastSeat);
      }
      for (const showdown of m.publicView().history) {
        for (let i = 1; i < showdown.bids.length; i++) assert.ok(compareBids(showdown.bids[i], showdown.bids[i - 1]) > 0);
      }
      const log = m.log();
      if (m.result) assert.equal(verify(log, m.result).ok, true);
      else assert.deepEqual(replay(log).log, log);
    });
    // The cases reach the engine's refusals, not only the happy path.
    for (const code of ["malformed", "not_higher", "no_bid"]) assert.ok(seen.has(code), `no run ended on ${code}: ${[...seen]}`);
  });
});
