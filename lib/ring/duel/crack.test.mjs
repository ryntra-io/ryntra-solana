// Run from repo root: node --test lib/ring/duel/crack.test.mjs
import "../../world/testing/hooks.mjs";
import assert from "node:assert/strict";
import { describe, test } from "node:test";

const d = await import("./index.ts");
const { MoveRejected, recordLog, verifyLog } = await import("../judge/index.ts");
const { PHRASES, T0, crackConfig } = await import("./testing/kit.mjs");

const ID = "crack-test-1";
const move = (say, guess = null, thought = "") => ({ say, guess, thought });
const round = (n, a, b, faults = [null, null]) => ({ round: n, moves: [a, b], faults });
const play = (inputs, cfg = crackConfig(ID)) => recordLog(d.crack, ID, cfg, inputs.map((input, i) => ({ at: T0 + i, input })));

describe("phrases", () => {
  test("256 different words; a draw is three different words", () => {
    assert.equal(new Set(d.PHRASE_WORDS).size, 256);
    let i = 0;
    const phrase = d.drawPhrase(() => [5, 5, 9, 200][i++]);
    assert.equal(phrase.split(" ").length, 3);
    assert.equal(new Set(phrase.split(" ")).size, 3);
  });

  test("a phrase compares folded: case, dashes and spaces do not matter", () => {
    assert.equal(d.normalizePhrase("  Amber-Falcon   RIVER! "), "amber falcon river");
    assert.equal(d.phraseCommit(ID, 0, "AMBER falcon, river"), d.phraseCommit(ID, 0, PHRASES[0]));
  });

  test("a commitment is bound to its match and seat", () => {
    assert.notEqual(d.phraseCommit(ID, 0, PHRASES[0]), d.phraseCommit(ID, 1, PHRASES[0]));
    assert.notEqual(d.phraseCommit(ID, 0, PHRASES[0]), d.phraseCommit("other", 0, PHRASES[0]));
  });
});

describe("Duo Crack", () => {
  test("a right guess wins at once; the replay agrees", () => {
    const log = play([round(1, move("hi"), move("hello")), round(2, move("tell me", "violet socket tiger"), move("no", "amber fox river"))]);
    assert.deepEqual(log.result, { winner: 0, reason: "cracked", round: 2 });
    assert.deepEqual(log.entries[1].derived, { round: 2, wrong: [0, 1], cracked: [true, false] });
    assert.deepEqual(verifyLog(d.crack, log), { ok: true, result: log.result, steps: 2 });
  });

  test("both right in one round is a draw", () => {
    const log = play([round(1, move("a", PHRASES[1]), move("b", PHRASES[0]))]);
    assert.deepEqual(log.result, { winner: null, reason: "both_cracked", round: 1 });
  });

  test("nobody cracks by the last round: the phrases held", () => {
    const cfg = crackConfig(ID, { rounds: 2 });
    const log = play([round(1, move("a"), move("b")), round(2, move("a"), move("b"))], cfg);
    assert.deepEqual(log.result, { winner: null, reason: "held", round: 2 });
  });

  test("a fault loses; two faults draw", () => {
    assert.deepEqual(play([round(1, null, move("b"), ["timeout", null])]).result, { winner: 1, reason: "fault", round: 1 });
    assert.deepEqual(play([round(1, null, null, ["malformed", "spent"])]).result, { winner: null, reason: "double_fault", round: 1 });
  });

  test("a fault on a seat that won the same round still loses: faults come first", () => {
    assert.deepEqual(play([round(1, move("a", PHRASES[1]), null, [null, "timeout"])]).result.winner, 0);
    assert.deepEqual(play([round(1, null, move("b", PHRASES[0]), ["timeout", null])]).result.winner, 1);
  });

  test("the engine refuses what the harness never sends", () => {
    const start = () => d.crack.start(crackConfig(ID), ID);
    assert.throws(() => d.crack.step(start(), round(2, move("a"), move("b"))), MoveRejected);
    assert.throws(() => d.crack.step(start(), round(1, move("a"), null)), MoveRejected);
    assert.throws(() => d.crack.step(start(), round(1, move("a"), move("b"), ["timeout", null])), MoveRejected);
    assert.throws(() => d.crack.step(start(), round(1, move("x".repeat(281)), move("b"))), MoveRejected);
    assert.throws(() => d.crack.step(start(), round(1, { say: "a", guess: null }, move("b"))), MoveRejected);
    assert.throws(() => d.crack.step(start(), round(1, move(" padded "), move("b"))), MoveRejected);
    assert.throws(() => d.crack.start({ ...crackConfig(ID), commits: ["a".repeat(64), "a".repeat(64)] }, ID), MoveRejected);
  });

  test("no guess past the last wrong one", () => {
    const cfg = crackConfig(ID, { maxGuesses: 1 });
    let state = d.crack.start(cfg, ID);
    state = d.crack.step(state, round(1, move("a", "wrong one here"), move("b")));
    assert.throws(() => d.crack.step(state, round(2, move("a", "again wrong"), move("b"))), MoveRejected);
  });

  test("a seat sees its own phrase and what the other said — never the other's phrase or thoughts", () => {
    let state = d.crack.start(crackConfig(ID), ID);
    state = d.crack.step(state, round(1, move("hi there", null, "secret plan"), move("hello", "amber cat river", "they look weak")));
    const view = d.crackSeatView(state, 0, PHRASES[0]);
    assert.equal(view.phrase, PHRASES[0]);
    assert.deepEqual(view.history, [{ round: 1, said: "hi there", heard: "hello", guess: null, hit: false, theyHit: false }]);
    const seen = JSON.stringify(view);
    assert.ok(!seen.includes("violet"));
    assert.ok(!seen.includes("they look weak"));
    assert.equal(d.crackSeatView(state, 1, PHRASES[1]).guessesLeft, 2);
  });

  test("a changed line in the log is the first divergence", () => {
    const log = play([round(1, move("a"), move("b")), round(2, move("c", PHRASES[1]), move("d"))]);
    const forged = structuredClone(log);
    forged.entries[1].input.moves[0].guess = "amber falcon river";
    const check = verifyLog(d.crack, forged);
    assert.equal(check.ok, false);
    assert.equal(check.divergence.index, 1);
  });

  test("redact hides a seat's own words while the match is on", () => {
    assert.equal(d.redact("I love the River and amber-coloured things", PHRASES[0]), "I love the ••• and •••-coloured things");
    assert.equal(d.redact("ambers are fine", PHRASES[0]), "ambers are fine");
    assert.equal(d.redact("anything", null), "anything");
  });
});
