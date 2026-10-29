/*
 * «While you were away», folded: what each line is about, how events fold,
 * how many lines twenty seconds hold, and the notice a channel would get only
 * with the person's consent. Nothing here sends anything.
 */
import "./testing/hooks.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";

const { awayReport, awayNotices, mineOf, linkSubject, AWAY_BEATS, AWAY_PER_ABOUT, NO_CONSENT } = await import("./away.ts");

const Q = "7d3f8a52-0c8e-4f43-9f5e-6a1b2c3d4e5f";
const MINT = "9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump";
const T0 = Date.parse("2026-10-27T10:00:00.000Z");
const t = (minutes) => new Date(T0 + minutes * 60_000).toISOString();

let n = 0;
const ev = (kind, source, subject, minutes, payload = {}) => ({ id: `e${String(++n).padStart(3, "0")}`, at: t(minutes), source, kind, subject, sourceAt: t(minutes), payload });

const mine = mineOf([{
  quarter: { id: Q },
  buildings: [
    { slot: 2, kind: "coin_tower", link: { kind: "mint", mint: MINT } },
    { slot: 3, kind: "oracle", link: { kind: "prediction_book" } },
    { slot: 4, kind: "home", link: null },
  ],
}]);

test("what is mine: my quarters and the objects my buildings show, never the prediction book's account", () => {
  assert.deepEqual([...mine.quarterIds], [Q]);
  assert.deepEqual([...mine.objects.entries()], [[MINT, { quarterId: Q, slot: 2, kind: "coin_tower", linkKind: "mint" }]]);
  assert.equal(linkSubject({ kind: "lp_position", position: "pos" }), "pos");
  assert.equal(linkSubject({ kind: "team", teamId: "6719f2c4a1b2c3d4e5f60718" }), "6719f2c4a1b2c3d4e5f60718");
  assert.equal(linkSubject({ kind: "prediction_book" }), null);
  assert.equal(linkSubject(null), null);
});

test("lines go mine first — quarter, object, district, city — and the newest of each kind leads", () => {
  const report = awayReport([
    ev("pump", "market", "CityCoin", 50, { change: 0.3 }),
    ev("claim", "world", "q-new", 40, { street: "arrivals-1" }),
    ev("visit", "world", Q, 30, { street: "arrivals-1", verifiedHuman: true }),
    ev("pump", "market", MINT, 20, { change: 0.12 }),
    ev("visit", "world", Q, 10, { street: "arrivals-1", verifiedHuman: false }),
  ], mine);
  assert.deepEqual(report.beats.map((b) => [b.about, b.kind, b.count]), [["quarter", "visit", 2], ["object", "pump", 1], ["district", "claim", 1], ["city", "pump", 1]]);
  assert.deepEqual(report.beats[0].detail, { street: "arrivals-1", verified: 1 });
  assert.equal(report.beats[0].at, t(30));
  assert.equal(report.beats[0].from, t(10));
  assert.equal(report.beats[1].source, "market", "my coin's move keeps the market as its source");
  assert.deepEqual(report.counts, { quarter: 2, object: 1, district: 1, city: 1 });
});

test("my district folds by kind and street; the city by kind and coin", () => {
  const report = awayReport([
    ev("build", "world", "q-a", 9, { street: "arrivals-1", slot: 0, kind: "home", level: 1 }),
    ev("build", "world", "q-b", 8, { street: "arrivals-1", slot: 1, kind: "workshop", level: 2 }),
    ev("build", "world", "q-c", 7, { street: "arrivals-2", slot: 0, kind: "home", level: 1 }),
    ev("pump", "market", "CoinA", 6, { change: 0.2 }),
    ev("pump", "market", "CoinA", 5, { change: 0.1 }),
  ], mine);
  assert.deepEqual(report.beats.map((b) => [b.about, b.subject, b.count]), [["district", "arrivals-1", 2], ["district", "arrivals-2", 1], ["city", "CoinA", 2]]);
  assert.deepEqual(report.beats[0].detail, { kind: "home", level: 1, slot: 0, street: "arrivals-1" }, "the newest event's figures");
});

test("twenty seconds hold a few lines: each kind is capped, and so is the whole", () => {
  const many = [];
  for (let i = 0; i < 6; i += 1) many.push(ev("pump", "market", `Coin${i}`, 100 - i));
  for (let i = 0; i < 6; i += 1) many.push(ev("build", "world", `q${i}`, 90 - i, { street: `arrivals-${i + 1}` }));
  for (let i = 0; i < 6; i += 1) many.push(ev(["launch", "graduate", "survival", "pump", "flare", "war"][i], "engine", MINT, 80 - i));
  const report = awayReport(many, mine);
  assert.ok(report.beats.length <= AWAY_BEATS);
  for (const [about, cap] of Object.entries(AWAY_PER_ABOUT)) assert.ok(report.beats.filter((b) => b.about === about).length <= cap, about);
  assert.deepEqual(report.counts, { quarter: 0, object: 6, district: 6, city: 6 });
});

test("an event without a source time is never shown; nested payloads and long strings stay out of a line", () => {
  const report = awayReport([
    { ...ev("launch", "engine", "NoTime", 5), sourceAt: null },
    ev("flare", "market", "CoinB", 4, { change: -0.18, deep: { a: 1 }, list: [1], note: "x".repeat(80), ok: true, nan: Number.NaN }),
  ], mine);
  assert.equal(report.beats.length, 1);
  assert.deepEqual(report.beats[0].detail, { change: -0.18, ok: true });
});

test("a line never names anyone else: a person's key or an address in the payload stays out", () => {
  const report = awayReport([
    ev("launch", "engine", "CoinC", 6, {
      creator: "4EeXQa4MKrBSwDj9pHEoZXjiiUaZmWzveGq5X9dUKPGW",
      walletAddress: "x",
      displayName: "Ann",
      pool: "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R",
      days: 7,
      stage: "damm_v2",
    }),
  ], mine);
  assert.deepEqual(report.beats[0].detail, { days: 7, stage: "damm_v2" });
});

test("a notice is made only for a channel the person turned on, and only when there is something to say", () => {
  const report = awayReport([ev("visit", "world", Q, 3, { verifiedHuman: true }), ev("pump", "market", MINT, 2), ev("pump", "market", "C1", 1), ev("pump", "market", "C2", 0.5)], mine);
  const base = { residentId: "r1", since: t(0), until: t(60), report };
  assert.deepEqual(awayNotices({ ...base, consent: null }), []);
  assert.deepEqual(awayNotices({ ...base, consent: NO_CONSENT }), []);
  assert.deepEqual(awayNotices({ ...base, consent: { telegram: true, push: false, updatedAt: t(0) }, report: { beats: [], counts: report.counts } }), []);
  const notices = awayNotices({ ...base, consent: { telegram: true, push: true, updatedAt: t(0) } });
  assert.deepEqual(notices.map((x) => [x.channel, x.key]), [["telegram", `away:r1:telegram:${t(60)}`], ["push", `away:r1:push:${t(60)}`]]);
  assert.equal(notices[0].beats.length, 3, "a message says less than the screen");
  assert.equal(notices[0].beats[0].kind, "visit");
  assert.ok(Object.isFrozen(NO_CONSENT));
});
