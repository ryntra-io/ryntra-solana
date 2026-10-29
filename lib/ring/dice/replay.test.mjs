// Run from repo root: node --test lib/ring/dice/replay.test.mjs
import "../../world/testing/hooks.mjs";
import assert from "node:assert/strict";
import { describe, test } from "node:test";

const { logDigest, replay, verify } = await import("./index.ts");
const { SEEDS, assertMatch, cautious, config, playOut, playingMatch, seedOf, tapeStrategy } = await import("./testing/helpers.mjs");

function finishedLog(seeds = SEEDS, salt = "mock") {
  const m = playingMatch(config(), seeds, salt);
  playOut(m, [cautious, tapeStrategy([3, 1, 4, 1, 5, 9, 2, 6])]);
  return { log: m.log(), m };
}

const indexOf = (log, type, nth = 0) => log.entries.flatMap((e, i) => (e.type === type ? [i] : []))[nth];

describe("determinism", () => {
  test("produces the same match for the same seeds and beacon", () => {
    const a = finishedLog();
    const b = finishedLog();
    assert.deepEqual(b.log, a.log);
    assert.equal(logDigest(b.log), logDigest(a.log));
  });

  test("rolls different dice when a seed or the beacon changes", () => {
    const base = finishedLog().log;
    const firstRoll = (log) => log.entries.find((e) => e.type === "round");
    assert.notDeepEqual(firstRoll(finishedLog([seedOf("other"), SEEDS[1]]).log), firstRoll(base));
    assert.notDeepEqual(firstRoll(finishedLog(SEEDS, "other beacon").log), firstRoll(base));
  });

  test("digests a log independently of key order", () => {
    const { log } = finishedLog();
    const reordered = { entries: log.entries, config: log.config, format: log.format };
    assert.equal(logDigest(reordered), logDigest(log));
  });
});

describe("replay", () => {
  test("re-derives every roll and the live result", () => {
    const { log, m } = finishedLog();
    const r = replay(log);
    assert.deepEqual(r.result, m.result);
    assert.deepEqual(r.log, log);
    const rounds = log.entries.filter((e) => e.type === "round");
    assert.equal(r.rolls.length, rounds.length);
    assert.deepEqual(r.rolls.map((x) => x.hands), rounds.map((x) => x.hands));
  });

  test("survives a JSON round trip", () => {
    const { log, m } = finishedLog();
    const wire = JSON.parse(JSON.stringify(log));
    assert.deepEqual(replay(wire).result, m.result);
  });
});

describe("verify", () => {
  test("accepts an honest log and result", () => {
    const { log, m } = finishedLog();
    assert.deepEqual(verify(log, m.result), { ok: true, result: m.result });
  });

  test("finds a tampered roll", () => {
    const { log, m } = finishedLog();
    const i = indexOf(log, "round", 1);
    const entry = log.entries[i];
    const original = entry.hands[1][2];
    entry.hands[1][2] = (original % 6) + 1;
    const v = verify(log, m.result);
    assert.equal(v.ok, false);
    assertMatch(v.divergence, { index: i, path: "hands[1][2]", expected: original, found: (original % 6) + 1 });
  });

  test("finds a tampered showdown", () => {
    const { log, m } = finishedLog();
    const i = indexOf(log, "showdown");
    const entry = log.entries[i];
    entry.loser = entry.loser === 0 ? 1 : 0;
    assertMatch(verify(log, m.result), { ok: false, divergence: { index: i, path: "loser" } });
  });

  test("finds a wrong claimed winner", () => {
    const { log, m } = finishedLog();
    const claimed = { ...m.result, winner: 1 - m.result.winner, winnerId: "mallory" };
    assertMatch(verify(log, claimed), { ok: false, divergence: { index: "result", path: "winner" } });
  });

  test("finds a changed move: everything after it is derived again", () => {
    const { log, m } = finishedLog();
    const i = log.entries.findIndex((e) => e.type === "move" && e.call?.name === "bid");
    log.entries[i].call = { name: "challenge", arguments: {} };
    const v = verify(log, m.result);
    assert.equal(v.ok, false);
    assert.ok(v.divergence.index > i);
  });

  test("finds a swapped beacon round", () => {
    const { log, m } = finishedLog();
    const i = indexOf(log, "beacon");
    const entry = log.entries[i];
    entry.beacon = { ...entry.beacon, round: entry.beacon.round + 1 };
    assertMatch(verify(log, m.result), { ok: false, divergence: { index: i, message: /input rejected/ } });
  });

  test("finds missing, extra and truncated entries", () => {
    const { log, m } = finishedLog();
    const i = indexOf(log, "round", 1);

    const missing = structuredClone(log);
    missing.entries.splice(i, 1);
    assertMatch(verify(missing, m.result), { ok: false, divergence: { index: i } });

    const extra = structuredClone(log);
    extra.entries.push({ type: "tick", at: 0 });
    assertMatch(verify(extra, m.result), { ok: false, divergence: { index: log.entries.length } });

    const truncated = structuredClone(log);
    truncated.entries = truncated.entries.slice(0, i);
    assertMatch(verify(truncated, m.result), { ok: false, divergence: { index: i, message: /missing/ } });
  });

  test("reports a log that stops before the end", () => {
    const { log, m } = finishedLog();
    const cut = structuredClone(log);
    cut.entries = cut.entries.slice(0, indexOf(log, "round", 1) + 1);
    assertMatch(verify(cut, m.result), { ok: false, divergence: { index: "result" } });
  });

  test("reports a malformed log", () => {
    assertMatch(verify({ format: "something else" }, null), { ok: false, divergence: { index: "log" } });
    assertMatch(verify(null, null), { ok: false, divergence: { index: "log" } });
  });
});
