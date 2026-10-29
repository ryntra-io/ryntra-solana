// Run from repo root: node --test lib/ring/dice/receipt.test.mjs
import "../../world/testing/hooks.mjs";
import assert from "node:assert/strict";
import { describe, test } from "node:test";

const { DRAND_QUICKNET, DiceMatch, MOCK_BEACON_INFO, RECEIPT_FORMAT, configDigest, diceReceipt, logDigest } = await import("./index.ts");
const { T0, assertMatch, cautious, config, playOut, playingMatch, revealedMatch, tapeStrategy } = await import("./testing/helpers.mjs");

const NONE = { agreedConfig: null };

/**
 * The dice receipt: a finished log proves its result by replay alone. A claim the log does not back is blocked with
 * its reason, and a log that stops early is «unclear» — never a win.
 */

function finished(cfg = config()) {
  const m = playingMatch(cfg);
  playOut(m, [cautious, tapeStrategy([3, 1, 4, 1, 5, 9, 2, 6])]);
  return { log: JSON.parse(JSON.stringify(m.log())), result: m.result };
}

describe("dice receipt", () => {
  test("proves an honest win of an agreed config on drand quicknet by format and replay", () => {
    const cfg = config({ beacon: DRAND_QUICKNET });
    const { log, result } = finished(cfg);
    const receipt = diceReceipt(log, result, { agreedConfig: configDigest(cfg) });
    assertMatch(receipt, {
      format: RECEIPT_FORMAT,
      game: "dice",
      class: "verified",
      ruleset: "liars-dice/1",
      matchId: "duel-1",
      players: ["alpha", "beta"],
      configDigest: configDigest(log.config),
      logDigest: logDigest(log),
      // The limits stay on the receipt: the BLS signature is not checked here, and the moves are as the host wrote them.
      proof: { format: true, replay: true, agreedConfig: true, beacon: "unchecked", moves: "host_recorded" },
      verdict: { kind: "win", winner: result.winner, winnerId: result.winnerId, reason: "eliminated" },
    });
    assert.match(receipt.logDigest, /^[0-9a-f]{64}$/);
  });

  test("records a double timeout as no winner", () => {
    const m = new DiceMatch(config());
    m.apply({ type: "tick", at: T0 + 60_000 });
    assertMatch(diceReceipt(m.log(), m.result, NONE), { proof: { format: true, replay: true }, verdict: { kind: "no_winner", reason: "timeout" } });
  });

  test("blocks a bad agent that claims a win it did not have", () => {
    const { log, result } = finished();
    const loser = 1 - result.winner;
    const claim = { ...result, winner: loser, winnerId: result.players[loser] };
    const receipt = diceReceipt(log, claim, NONE);
    assertMatch(receipt, { class: "unverified", proof: { format: true, replay: false }, verdict: { kind: "blocked", why: "claim_differs", divergence: { index: "result", path: "winner" } } });
  });

  test("blocks a log whose dice were changed after the match", () => {
    const { log, result } = finished();
    const i = log.entries.findIndex((e) => e.type === "round");
    log.entries[i].hands[0][0] = (log.entries[i].hands[0][0] % 6) + 1;
    assertMatch(diceReceipt(log, result, NONE), { verdict: { kind: "blocked", why: "log_does_not_replay", divergence: { index: i, path: "hands[0][0]" } } });
  });

  test("keeps a log that stops early unclear, whatever the claim", () => {
    const { log, result } = finished();
    // Cut before the first challenge: every entry left is honest, the match is simply not over.
    log.entries = log.entries.slice(0, log.entries.findIndex((e) => e.type === "showdown") - 1);
    const receipt = diceReceipt(log, result, NONE);
    assertMatch(receipt, { class: "unverified", proof: { format: true, replay: true }, verdict: { kind: "unclear", why: "log_stops_early" } });
    assert.notEqual(receipt.verdict.kind, "win");
  });

  test("blocks a log played under another config than the one agreed", () => {
    const { log, result } = finished();
    const agreed = configDigest(config({ limits: { moveMs: 5_000 } }));
    assertMatch(diceReceipt(log, result, { agreedConfig: agreed }), { proof: { format: true, replay: false }, verdict: { kind: "blocked", why: "config_not_agreed" } });
  });

  test("never throws on what it is handed", () => {
    for (const log of [null, 7, "log", [], { format: "ryntra-dice-log/1" }, { config: config(), entries: "x" }]) {
      const receipt = diceReceipt(log, null, NONE);
      assertMatch(receipt, { class: "unverified", logDigest: null, proof: { format: false, replay: false }, verdict: { kind: "blocked", why: "malformed_log" } });
    }
    assertMatch(diceReceipt({ config: config(), entries: "x" }, null, NONE), { matchId: "duel-1" });
  });

  test("never calls a fully forged log on the mock beacon verified", () => {
    // Anyone can write this: seeds of their own, the mock beacon, a one-millisecond move limit. It replays.
    const forged = config({ matchId: "forged-1", limits: { moveMs: 1 } });
    const { log, result } = finished(forged);
    assert.equal(log.config.beacon.chainHash, MOCK_BEACON_INFO.chainHash);
    for (const agreedConfig of [null, configDigest(forged)]) {
      const receipt = diceReceipt(log, result, { agreedConfig });
      assertMatch(receipt, { class: "unverified", proof: { replay: true, beacon: "unknown_chain", moves: "host_recorded" }, verdict: { kind: "win" } });
    }
    // Against the config the judge agreed, it does not even replay.
    assertMatch(diceReceipt(log, result, { agreedConfig: configDigest(config({ beacon: DRAND_QUICKNET })) }), { class: "unverified", verdict: { kind: "blocked", why: "config_not_agreed" } });
  });

  test("is not verified without an agreed config, or on a chain that only borrows the quicknet hash", () => {
    const cfg = config({ beacon: DRAND_QUICKNET });
    const { log, result } = finished(cfg);
    assertMatch(diceReceipt(log, result, NONE), { class: "unverified", proof: { agreedConfig: false, beacon: "unchecked" }, verdict: { kind: "win" } });

    const borrowed = config({ beacon: { ...DRAND_QUICKNET, period: 1_000 } });
    const other = finished(borrowed);
    assertMatch(diceReceipt(other.log, other.result, { agreedConfig: configDigest(borrowed) }), { class: "unverified", proof: { agreedConfig: true, beacon: "unknown_chain" } });
  });

  test("records a void match as no winner", () => {
    const cfg = config({ beacon: DRAND_QUICKNET });
    const m = revealedMatch(cfg);
    m.apply({ type: "tick", at: m.deadline + 1 });
    assertMatch(diceReceipt(m.log(), m.result, { agreedConfig: configDigest(cfg) }), {
      class: "verified",
      verdict: { kind: "no_winner", reason: "beacon_timeout" },
    });
  });

  test("digests the config, not its key order", () => {
    const cfg = config();
    const reordered = Object.fromEntries(Object.entries(cfg).reverse());
    assert.equal(configDigest(reordered), configDigest(cfg));
    assert.notEqual(configDigest(config({ matchId: "duel-2" })), configDigest(cfg));
  });
});
