// Shared by the dice tests; load after `lib/world/testing/hooks.mjs`.
import assert from "node:assert/strict";

const dice = await import("../index.ts");
const { DiceMatch, commitmentFor, createMockBeacon, defineMatch, mockBeaconRound, nextBid, other, roundTime, sha256Hex, HashRng } = dice;

export { dice };
export const T0 = 1_000_000;
export const beacon = createMockBeacon();

export function config(overrides = {}) {
  return defineMatch({ matchId: "duel-1", players: ["alpha", "beta"], startedAt: T0, beacon: beacon.info, ...overrides });
}

export const seedOf = (label) => sha256Hex(`test seed|${label}`);
export const SEEDS = [seedOf("alpha"), seedOf("beta")];

export const commitCall = (cfg, seat, seed) => ({ name: "commit", arguments: { commitment: commitmentFor(cfg.matchId, seat, seed) } });
export const revealCall = (seed) => ({ name: "reveal", arguments: { seed } });
export const bidCall = (count, face) => ({ name: "bid", arguments: { count, face } });
export const challengeCall = { name: "challenge", arguments: {} };

/** Both commit and reveal; the match then waits for the beacon. */
export function revealedMatch(cfg = config(), seeds = SEEDS) {
  const m = new DiceMatch(cfg);
  m.apply({ type: "move", seat: 0, at: T0 + 10, call: commitCall(cfg, 0, seeds[0]) });
  m.apply({ type: "move", seat: 1, at: T0 + 20, call: commitCall(cfg, 1, seeds[1]) });
  m.apply({ type: "move", seat: 0, at: T0 + 30, call: revealCall(seeds[0]) });
  m.apply({ type: "move", seat: 1, at: T0 + 40, call: revealCall(seeds[1]) });
  return m;
}

/** A match in round 1 of play. */
export function playingMatch(cfg = config(), seeds = SEEDS, salt = "mock") {
  const m = revealedMatch(cfg, seeds);
  const round = m.beaconRound;
  m.apply({ type: "beacon", at: roundTime(cfg.beacon, round), beacon: mockBeaconRound(round, salt, cfg.beacon) });
  return m;
}

/** Plays until the end, each move `step` ms after the previous one. */
export function playOut(m, strategies, step = 100) {
  for (let guard = 0; !m.result && guard < 10_000; guard++) {
    const seat = m.pending()[0];
    if (seat === undefined) throw new Error(`nobody to move in phase ${m.phase}`);
    m.apply({ type: "move", seat, at: m.now + step, call: strategies[seat](m.view(seat)) });
  }
}

/** Bids its most common face; challenges when the bid looks unlikely given its own dice. */
export const cautious = (view) => {
  const total = view.dice[0] + view.dice[1];
  const opponentDice = view.dice[other(view.you)];
  const expected = (face) => view.yourDice.filter((d) => d === face).length + opponentDice / 6;
  const last = view.bids.at(-1);
  if (last && last.count > expected(last.face) + 1) return challengeCall;
  // Raise on the face it holds most of, at the lowest count that beats the last bid.
  const face = [1, 2, 3, 4, 5, 6].reduce((a, b) => (expected(b) > expected(a) ? b : a));
  const count = !last ? 1 : face > last.face ? last.count : last.count + 1;
  if (count <= total && (!last || count <= expected(face) + 1)) return bidCall(count, face);
  return last ? challengeCall : bidCall(1, face);
};

/** Picks moves from a tape of numbers: a small raise or a challenge. Always legal. */
export function tapeStrategy(tape) {
  let i = 0;
  return (view) => {
    const options = [];
    if (view.tools.includes("challenge")) options.push(challengeCall);
    let bid = view.minBid;
    for (let k = 0; bid && k < 8; k++) {
      options.push(bidCall(bid.count, bid.face));
      bid = nextBid(bid, view.dice[0] + view.dice[1]);
    }
    const pick = tape.length > 0 ? (tape[i++ % tape.length] ?? 0) : 0;
    return options[pick % options.length];
  };
}

/** An agent for the driver: commits and reveals `seed`, then plays `strategy`. */
export function agent(seed, strategy) {
  return {
    act(view) {
      if (view.phase === "commit") return { name: "commit", arguments: { commitment: commitmentFor(view.matchId, view.you, seed) } };
      if (view.phase === "reveal") return revealCall(seed);
      return strategy(view);
    },
  };
}

/**
 * Asserts that `actual` holds everything `expected` names: objects by their listed keys, arrays element by element and
 * of the same length, a RegExp against a string, anything else by strict equality.
 */
export function assertMatch(actual, expected, path = "") {
  if (expected instanceof RegExp) {
    assert.equal(typeof actual, "string", `${path || "value"} should be a string`);
    assert.match(actual, expected, path);
    return;
  }
  if (Array.isArray(expected)) {
    assert.ok(Array.isArray(actual), `${path || "value"} should be an array`);
    assert.equal(actual.length, expected.length, `${path || "value"} length`);
    expected.forEach((e, i) => assertMatch(actual[i], e, `${path}[${i}]`));
    return;
  }
  if (expected !== null && typeof expected === "object") {
    assert.ok(actual !== null && typeof actual === "object", `${path || "value"} should be an object`);
    for (const key of Object.keys(expected)) assertMatch(actual[key], expected[key], path ? `${path}.${key}` : key);
    return;
  }
  assert.equal(actual, expected, path || undefined);
}

/**
 * A seeded source of test cases in place of a property-testing library: the same seed gives the same cases, so a
 * failure names its run and replays.
 */
export function cases(seed) {
  const rng = new HashRng(sha256Hex(`dice cases|${seed}`));
  const int = (min, max) => min + rng.int(max - min + 1);
  const pick = (list) => list[rng.int(list.length)];
  const hex32 = () => Array.from({ length: 32 }, () => rng.int(256).toString(16).padStart(2, "0")).join("");
  const text = (max) => Array.from({ length: int(0, max) }, () => String.fromCharCode(int(0x20, 0x7e))).join("");
  const tape = () => Array.from({ length: int(1, 40) }, () => int(0, 1_000));
  const game = () => ({ seeds: [hex32(), hex32()], salt: text(8), tapes: [tape(), tape()] });
  /** Any value an agent might send: JSON or not, nested, odd numbers, odd keys. */
  const anything = (depth = 0) => {
    const kind = int(0, depth > 2 ? 6 : 9);
    switch (kind) {
      case 0: return undefined;
      case 1: return null;
      case 2: return pick([true, false]);
      case 3: return pick([0, -0, 1, -1, 1.5, 2 ** 53, Number.NaN, Number.POSITIVE_INFINITY, int(-100, 100)]);
      case 4: return text(12);
      case 5: return pick([10n, Symbol("s"), () => 1]);
      case 6: return pick(["bid", "challenge", "commit", "reveal", "__proto__", "constructor"]);
      case 7: return Array.from({ length: int(0, 4) }, () => anything(depth + 1));
      default: {
        const value = {};
        for (let i = int(0, 4); i > 0; i--) value[pick(["name", "arguments", "count", "face", "id", text(4)])] = anything(depth + 1);
        return value;
      }
    }
  };
  return { int, pick, hex32, text, tape, game, anything };
}
