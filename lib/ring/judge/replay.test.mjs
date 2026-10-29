// Run from repo root: node --test lib/ring/judge/replay.test.mjs
import "../../world/testing/hooks.mjs";
import assert from "node:assert/strict";
import test from "node:test";

const { recordLog, verifyLog, logHash, LOG_FORMAT } = await import("./replay.ts");
const { canonicalJson, firstDifference, hashOf, sha256Hex } = await import("./hash.ts");
const { memoOf, parseMemo, MEMO_MAX_BYTES } = await import("./memo.ts");
const { race } = await import("./race.ts");
const { demoLog } = await import("./bad-agent.ts");

/** The match log replays on anyone's machine; the replay finds the first divergence; its hash fits a Solana memo. */

const clone = (value) => structuredClone(value);

test("an honest log replays clean", () => {
  const verification = verifyLog(race, demoLog());
  assert.deepEqual(verification, { ok: true, result: { winner: 1, total: 10 }, steps: 4 });
});

test("a replay of the same inputs writes the same log", () => {
  const log = demoLog();
  const inputs = log.entries.map(({ at, input }) => ({ at, input }));
  assert.deepEqual(recordLog(race, log.matchId, log.config, inputs), log);
  assert.equal(logHash(recordLog(race, log.matchId, log.config, inputs)), logHash(log));
});

test("the first divergence: index, path, what the engine derives and what the log says", () => {
  const log = clone(demoLog());
  log.entries[2].derived.total = 8;
  log.entries[3].derived.total = 99;
  const { ok, divergence } = verifyLog(race, log);
  assert.equal(ok, false);
  assert.deepEqual({ ...divergence, message: undefined }, { index: 2, path: "derived.total", expected: 7, found: 8, message: undefined });
});

test("an input the rules refuse is the divergence", () => {
  const log = clone(demoLog());
  log.entries[0].input.add = 4;
  const { divergence } = verifyLog(race, log);
  assert.equal(divergence.index, 0);
  assert.equal(divergence.path, "input");
  assert.match(divergence.message, /input rejected/);
});

test("a missing or an extra entry shows up in the result", () => {
  const short = clone(demoLog());
  short.entries.pop();
  assert.equal(verifyLog(race, short).divergence.index, "result");

  const long = clone(demoLog());
  long.entries.push({ seq: 4, at: long.entries[3].at, input: { seat: 0, add: 1 }, derived: { total: 11, turn: 1 } });
  assert.equal(verifyLog(race, long).divergence.index, 4);
});

test("an undecided log verifies as undecided — never a win", () => {
  const log = recordLog(race, "m1", { target: 10, maxAdd: 3 }, [{ at: 1, input: { seat: 0, add: 3 } }]);
  assert.deepEqual(verifyLog(race, log), { ok: true, result: null, steps: 1 });
});

test("order and time: entries in sequence, never back in time", () => {
  const swapped = clone(demoLog());
  swapped.entries[1].seq = 5;
  assert.equal(verifyLog(race, swapped).divergence.path, "seq");
  const back = clone(demoLog());
  back.entries[2].at = 0;
  assert.equal(verifyLog(race, back).divergence.path, "at");
});

test("a claimed result is checked against the replay", () => {
  assert.equal(verifyLog(race, demoLog(), { winner: 1, total: 10 }).ok, true);
  const { divergence } = verifyLog(race, demoLog(), { winner: 0, total: 10 });
  assert.deepEqual([divergence.index, divergence.path, divergence.expected, divergence.found], ["result", "winner", 1, 0]);
});

test("a malformed log, the wrong game or a refused config is a divergence of the log", () => {
  assert.equal(verifyLog(race, null).divergence.index, "log");
  assert.equal(verifyLog(race, { ...demoLog(), extra: 1 }).divergence.index, "log");
  assert.equal(verifyLog(race, { ...demoLog(), format: "rxn-duel-log/1" }).divergence.path, "format");
  assert.equal(verifyLog(race, { ...demoLog(), game: { id: "race", version: "2" } }).divergence.path, "game");
  assert.equal(verifyLog(race, { ...demoLog(), config: { target: 1, maxAdd: 3 } }).divergence.path, "config");
  assert.equal(verifyLog(race, { ...demoLog(), matchId: "has|pipe" }).divergence.path, "matchId");
});

test("a bug in a game is not swallowed by the replay", () => {
  const buggy = { ...race, derive() { throw new Error("bug"); } };
  assert.throws(() => verifyLog(buggy, demoLog()), /bug/);
});

test("canonical JSON: sorted keys, one form, and nothing JSON cannot carry", () => {
  assert.equal(canonicalJson({ b: 1, a: [true, null, { d: "x", c: 2 }] }), '{"a":[true,null,{"c":2,"d":"x"}],"b":1}');
  assert.equal(hashOf({ a: 1, b: 2 }), hashOf({ b: 2, a: 1 }));
  assert.equal(canonicalJson({ a: undefined, b: 1 }), '{"b":1}');
  for (const bad of [NaN, Infinity, 1n, () => 1, new Date(0), new Map(), [undefined], undefined]) assert.throws(() => canonicalJson(bad), TypeError);
  assert.equal(canonicalJson(JSON.parse('{"b":2,"__proto__":1}')), '{"__proto__":1,"b":2}');
  // A lone surrogate has no UTF-8 form: "\uD800" and "\uDFFF" would both hash as U+FFFD.
  for (const bad of ["\uD800", { "\uDFFF": 1 }, ["a\uDC00b"]]) assert.throws(() => canonicalJson(bad), TypeError);
  assert.throws(() => sha256Hex("\uD800"), TypeError);
  assert.equal(canonicalJson("😀"), '"😀"');
  assert.equal(sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("firstDifference walks keys in order", () => {
  assert.equal(firstDifference({ a: 1, b: [1, 2] }, { a: 1, b: [1, 2] }), null);
  assert.deepEqual(firstDifference({ a: 1, b: [1, 2] }, { a: 1, b: [1, 3] }), { path: "b[1]", expected: 2, found: 3 });
  assert.deepEqual(firstDifference({ a: 1 }, { a: 1, z: 0 }), { path: "z", expected: undefined, found: 0 });
});

test("the log's hash is ready for a Solana memo — the memo is built, nothing is sent", () => {
  const log = demoLog();
  const hash = logHash(log);
  assert.equal(hash, sha256Hex(canonicalJson(log)));
  const memo = memoOf({ matchId: log.matchId, logHash: hash, receiptHash: sha256Hex("receipt") });
  assert.equal(memo, `ryntra-ring/1|demo-race-1|${hash}|${sha256Hex("receipt")}`);
  assert.ok(Buffer.byteLength(memo) <= MEMO_MAX_BYTES);
  assert.ok(/^[\x20-\x7e]+$/.test(memo), "ASCII only");
  assert.deepEqual(parseMemo(memo), { matchId: "demo-race-1", logHash: hash, receiptHash: sha256Hex("receipt") });
  assert.equal(parseMemo("ryntra-ring/1|x|nothex|nothex"), null);
  assert.equal(parseMemo(`other/1|x|${hash}|${hash}`), null);
  assert.throws(() => memoOf({ matchId: "a|b", logHash: hash, receiptHash: hash }), TypeError);
  assert.throws(() => memoOf({ matchId: "m", logHash: "ABC", receiptHash: hash }), TypeError);
  assert.equal(LOG_FORMAT, "ryntra-ring-log/1");
});
