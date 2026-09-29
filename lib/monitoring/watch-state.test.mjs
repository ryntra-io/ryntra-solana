import assert from "node:assert/strict";
import test from "node:test";

import { freshPrice, judgeWatch, NEAR_LIMIT_PCT, WATCH_PRICE_MAX_AGE_MS } from "./watch-state.ts";

/*
 * RYN-PROTECT-SIGNAL-001, subtask 1 — the states of Нагляд (canon v5 §11):
 * every held company position is in one state with one action, decided by
 * rules and prices; a position with no exit says so always.
 */

const NOW = Date.parse("2026-09-28T12:00:00.000Z");
const FRESH = "2026-09-28T11:58:00.000Z";
const EXIT = { source: "plan", limit: 164.2, target: 218.9 };
const base = (over = {}) => ({
  price: 182.4,
  observedAt: FRESH,
  nowMs: NOW,
  exit: EXIT,
  issuerPaused: false,
  issuerEvent: false,
  deviationPct: 0.1,
  exchangeClosed: false,
  channel: true,
  ...over,
});

test("between the loss limit and the target: «Все за планом», nothing to do", () => {
  const judged = judgeWatch(base());
  assert.equal(judged.state, "on-plan");
  assert.equal(judged.reason, "between");
  assert.equal(judged.action, null);
  assert.equal(judged.price, 182.4);
  assert.ok(Math.abs(judged.toLimitPct - ((182.4 - 164.2) / 182.4) * 100) < 1e-9);
});

test("at or under the loss limit, or at or over the target: «Дія», the sale opens", () => {
  assert.deepEqual(pick(judgeWatch(base({ price: 164.2 }))), ["action", "limit", "open-sale"]);
  assert.deepEqual(pick(judgeWatch(base({ price: 150 }))), ["action", "limit", "open-sale"]);
  assert.deepEqual(pick(judgeWatch(base({ price: 218.9 }))), ["action", "target", "open-sale"]);
  assert.deepEqual(pick(judgeWatch(base({ price: 240 }))), ["action", "target", "open-sale"]);
  /* A position under «Ryntra попередить» acts the same as one under its plan. */
  assert.deepEqual(pick(judgeWatch(base({ price: 150, exit: { ...EXIT, source: "watch" } }))), ["action", "limit", "open-sale"]);
});

test("no exit at all: one amber line, and its one action depends on the channel", () => {
  assert.deepEqual(pick(judgeWatch(base({ exit: null }))), ["exit-not-set", "no-exit", "warn"]);
  assert.deepEqual(pick(judgeWatch(base({ exit: null, channel: false }))), ["exit-not-set", "no-exit", "connect-telegram"]);
  /* Said whatever else is true of the token — no price, the exchange closed, an event — except a pause, where nothing can be sold. */
  assert.equal(judgeWatch(base({ exit: null, price: null })).state, "exit-not-set");
  assert.equal(judgeWatch(base({ exit: null, exchangeClosed: true, issuerEvent: true, deviationPct: 4 })).state, "exit-not-set");
});

test("the issuer's pause outranks everything: selling is impossible, «Деталі» says why", () => {
  assert.deepEqual(pick(judgeWatch(base({ issuerPaused: true }))), ["issuer-paused", "issuer-paused", "details"]);
  assert.deepEqual(pick(judgeWatch(base({ issuerPaused: true, price: 150 }))), ["issuer-paused", "issuer-paused", "details"]);
  assert.deepEqual(pick(judgeWatch(base({ issuerPaused: true, exit: null }))), ["issuer-paused", "issuer-paused", "details"]);
});

test("«Увага» — near the limit, an issuer's event, above the exchange, the exchange closed — each «Подивитись», in that order", () => {
  const near = 164.2 / (1 - NEAR_LIMIT_PCT / 100);
  assert.deepEqual(pick(judgeWatch(base({ price: near }))), ["attention", "near-limit", "look"]);
  assert.deepEqual(pick(judgeWatch(base({ price: near + 1 }))), ["on-plan", "between", null]);
  assert.deepEqual(pick(judgeWatch(base({ issuerEvent: true }))), ["attention", "issuer-event", "look"]);
  assert.deepEqual(pick(judgeWatch(base({ deviationPct: 2.8 }))), ["attention", "above-exchange", "look"]);
  assert.deepEqual(pick(judgeWatch(base({ deviationPct: 1 }))), ["on-plan", "between", null], "exactly 1 % is not «Дорого»");
  assert.deepEqual(pick(judgeWatch(base({ deviationPct: -3 }))), ["on-plan", "between", null], "below the exchange is not a warning to a holder");
  assert.deepEqual(pick(judgeWatch(base({ exchangeClosed: true }))), ["attention", "exchange-closed", "look"]);
  /* The nearer danger speaks first. */
  assert.equal(judgeWatch(base({ price: near, issuerEvent: true, deviationPct: 3, exchangeClosed: true })).reason, "near-limit");
  assert.equal(judgeWatch(base({ issuerEvent: true, deviationPct: 3, exchangeClosed: true })).reason, "issuer-event");
  assert.equal(judgeWatch(base({ deviationPct: 3, exchangeClosed: true })).reason, "above-exchange");
});

test("an exit with no fresh price is never «Все за планом»: «Не вдалося перевірити», no action", () => {
  assert.deepEqual(pick(judgeWatch(base({ price: null }))), ["unknown", "no-price", null]);
  const old = new Date(NOW - WATCH_PRICE_MAX_AGE_MS - 1).toISOString();
  assert.deepEqual(pick(judgeWatch(base({ observedAt: old }))), ["unknown", "no-price", null]);
  assert.deepEqual(pick(judgeWatch(base({ observedAt: null }))), ["unknown", "no-price", null]);
  /* A stale price never reaches «Дія» either: a warning stands on a price someone saw. */
  assert.deepEqual(pick(judgeWatch(base({ price: 100, observedAt: old }))), ["unknown", "no-price", null]);
  assert.equal(judgeWatch(base({ observedAt: old })).toLimitPct, null);
});

test("an exit is judged only when it can be: a target at or under the limit is no target", () => {
  assert.deepEqual(pick(judgeWatch(base({ price: 300, exit: { source: "watch", limit: 164.2, target: 150 } }))), ["on-plan", "between", null]);
  assert.deepEqual(pick(judgeWatch(base({ price: 300, exit: { source: "watch", limit: 164.2, target: null } }))), ["on-plan", "between", null]);
  assert.deepEqual(pick(judgeWatch(base({ exit: { source: "plan", limit: 0, target: 10 } }))), ["exit-not-set", "no-exit", "warn"]);
});

test("a fresh price is positive, finite and observed within the half hour", () => {
  assert.equal(freshPrice(10, FRESH, NOW), 10);
  assert.equal(freshPrice(0, FRESH, NOW), null);
  assert.equal(freshPrice(Number.NaN, FRESH, NOW), null);
  assert.equal(freshPrice(10, "not a time", NOW), null);
  assert.equal(freshPrice(10, new Date(NOW - WATCH_PRICE_MAX_AGE_MS).toISOString(), NOW), 10);
});

function pick(judged) {
  return [judged.state, judged.reason, judged.action];
}
