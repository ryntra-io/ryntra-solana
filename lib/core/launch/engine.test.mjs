import assert from "node:assert/strict";
import test from "node:test";

import {
  ENGINE_RULE,
  CLEAR_AFTER_SECONDS,
  NO_ALERTS,
  engineAlerts,
  engineAlertsSent,
  engineMayTell,
  engineMessage,
  engineOrder,
  failedSendsInRow,
  nextSlot,
  plural,
  queueLagSeconds,
  retryAfterSeconds,
  visitOutcome,
} from "./engine.ts";

const T = (n) => ({ token: `T${n}` });

test("the queue: never visited first, then the longest due; a market resting or waiting out a failure is skipped", () => {
  const slots = new Map([
    ["T1", { dueAt: 900, visitedAt: 900, errors: 0, lastError: null }],
    ["T2", { dueAt: 500, visitedAt: 500, errors: 0, lastError: null }],
    ["T3", { dueAt: 2_000, visitedAt: 1_000, errors: 0, lastError: null }],
    ["T5", { dueAt: 1_500, visitedAt: 1_000, errors: 2, lastError: "x" }],
  ]);
  const order = engineOrder([T(1), T(2), T(3), T(4), T(5)], slots, 1_000).map((item) => item.token);
  assert.deepEqual(order, ["T4", "T2", "T1"]);
});

test("the queue keeps the launches' own order among markets alike — the oldest launch first", () => {
  assert.deepEqual(engineOrder([T(3), T(1), T(2)], new Map(), 10).map((item) => item.token), ["T3", "T1", "T2"]);
});

test("a pass that reaches only part of the markets: the rest come first in the next one, and every market is visited in turn", () => {
  const items = Array.from({ length: 10 }, (_, index) => T(index));
  const slots = new Map();
  const visits = new Map();
  for (let pass = 0; pass < 5; pass += 1) {
    const now = 1_000 + pass * 60;
    for (const item of engineOrder(items, slots, now).slice(0, 4)) {
      slots.set(item.token, nextSlot(slots.get(item.token) ?? null, { outcome: "IDLE", now, restSeconds: ENGINE_RULE.floorRestSeconds }));
      visits.set(item.token, (visits.get(item.token) ?? 0) + 1);
    }
  }
  assert.equal(visits.size, 10, "all ten reached within three passes of four");
  assert.ok([...visits.values()].every((count) => count >= 1 && count <= 3), "and then in turn: none far ahead of another");
});

test("a visit's outcome from its steps: a failure first, then an act, then a wait; else nothing to do", () => {
  assert.equal(visitOutcome([{ step: "BUDGET_CLAIMED" }, { step: "ERROR: boom" }]), "FAILED");
  assert.equal(visitOutcome([{ step: "GRADUATION_REJECTED" }]), "FAILED");
  assert.equal(visitOutcome([{ step: "FLOOR_PLACED" }]), "ACTED");
  assert.equal(visitOutcome([{ step: "BUDGET_CLAIM_PENDING" }]), "WAITING");
  assert.equal(visitOutcome([{ step: "LEASED" }]), "WAITING");
  assert.equal(visitOutcome([{ step: "NO_PRICE" }]), "WAITING");
  assert.equal(visitOutcome([{ step: "BUDGET_DATA_UNCHECKED" }]), "WAITING");
  assert.equal(visitOutcome([{ step: "BUDGET_NOTHING" }]), "IDLE");
  assert.equal(visitOutcome([{ step: "FLOOR_HOLDS" }]), "IDLE");
  assert.equal(visitOutcome([]), "IDLE");
});

test("retries: the wait grows with each failure in a row and stops growing; a visit that did not fail ends the run", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 9].map(retryAfterSeconds), [60, 120, 300, 900, 1_800, 1_800]);
  let slot = null;
  slot = nextSlot(slot, { outcome: "FAILED", now: 100, restSeconds: 300, error: "node" });
  assert.deepEqual(slot, { dueAt: 160, visitedAt: 100, errors: 1, lastError: "node" });
  slot = nextSlot(slot, { outcome: "FAILED", now: 160, restSeconds: 300 });
  assert.deepEqual([slot.dueAt, slot.errors, slot.lastError], [280, 2, "node"]);
  slot = nextSlot(slot, { outcome: "IDLE", now: 280, restSeconds: 300 });
  assert.deepEqual(slot, { dueAt: 580, visitedAt: 280, errors: 0, lastError: null });
  assert.equal(nextSlot(slot, { outcome: "ACTED", now: 600, restSeconds: 300 }).dueAt, 600, "an act: due again in the next pass");
});

test("the queue's lag: the longest a due market has waited", () => {
  const slots = [
    { dueAt: 100, visitedAt: 40, errors: 0, lastError: null },
    { dueAt: 300, visitedAt: 0, errors: 0, lastError: null },
    { dueAt: null, visitedAt: null, errors: 0, lastError: null },
  ];
  assert.equal(queueLagSeconds(slots, 250), 150);
  assert.equal(queueLagSeconds(slots, 50), 0);
});

test("failed transactions in a row: a landed one ends the run", () => {
  assert.equal(failedSendsInRow(1, [{ step: "BUDGET_CLAIM_FAILED" }, { step: "GRADUATION_REJECTED" }]), 3);
  assert.equal(failedSendsInRow(2, [{ step: "BUDGET_CLAIM_FAILED" }, { step: "BUDGET_CLAIMED" }, { step: "HOLDER_CLAIM_LAPSED" }]), 1);
  assert.equal(failedSendsInRow(4, [{ step: "ON_CURVE" }]), 4, "a pass that sent nothing leaves the run as it was");
});

const quiet = { at: 10_000, silentSeconds: 60, nodes: { reads: 40, mainDown: 0, bothFailed: 0 }, failedSendsInRow: 0, lamports: 400_000_000n, paused: [], lagSeconds: 0, stopsUnread: false, failing: 0 };

/** Passes a minute apart from `state`, each told and kept as delivered; the words of each pass. */
function run(signalsOf, minutes, from = NO_ALERTS) {
  let state = from;
  const said = [];
  for (let minute = 0; minute < minutes; minute += 1) {
    const signals = { ...quiet, ...signalsOf(minute), at: 10_000 + minute * 60 };
    const { words, holding } = engineAlerts(state, signals);
    state = engineAlertsSent(state, { holding, words, delivered: true, at: signals.at });
    said.push(words.map((word) => `${word.kind}:${word.key}`));
  }
  return { said, state };
}

test("the operator's words: a condition said once it has lasted, not again each minute, again after six hours, and once when it has been gone ten minutes", () => {
  /* The main node down for most reads: said after two minutes of it. */
  const down = { nodes: { reads: 40, mainDown: 30, bothFailed: 0 } };
  const node = run(() => down, 4);
  assert.deepEqual(node.said, [[], [], ["RAISED:NODE"], []]);
  const { words: still } = engineAlerts(node.state, { ...quiet, ...down, at: 10_120 + ENGINE_RULE.repeatSeconds });
  assert.deepEqual(still.map((word) => `${word.kind}:${word.key}`), ["STILL:NODE"]);
  /* Gone: said cleared only after ten quiet minutes. */
  let state = node.state;
  const cleared = [];
  for (let minute = 4; minute <= 4 + CLEAR_AFTER_SECONDS / 60; minute += 1) {
    const signals = { ...quiet, at: 10_000 + minute * 60 };
    const { words, holding } = engineAlerts(state, signals);
    state = engineAlertsSent(state, { holding, words, delivered: true, at: signals.at });
    cleared.push(...words.map((word) => `${word.kind}:${word.key}`));
  }
  assert.deepEqual(cleared, ["CLEARED:NODE"]);
  assert.equal(state.active.NODE, undefined);
});

test("markets failing pass after pass, then not, then again (a public node's rate limit): no word rises and falls each minute", () => {
  const flapping = run((minute) => ({ failing: minute % 2 === 0 ? 3 : 0 }), 30);
  const words = flapping.said.flat();
  assert.deepEqual(words, ["RAISED:FAILING"], "said once, after five minutes of it, and not cleared while it keeps coming back");
  const brief = run((minute) => ({ failing: minute < 3 ? 1 : 0 }), 20);
  assert.deepEqual(brief.said.flat(), [], "three minutes of one failing market are not worth a word");
});

test("the operator's words: the alerts of the plan — failed sends in a row, SOL low, a pause, a silence, the queue lagging — at once", () => {
  const { words } = engineAlerts(NO_ALERTS, {
    ...quiet,
    silentSeconds: 900,
    failedSendsInRow: 3,
    lamports: 50_000_000n,
    paused: ["4JVX000000000000QRLa"],
    lagSeconds: 600,
    stopsUnread: true,
    failing: 2,
  });
  assert.deepEqual(words.map((word) => word.key).sort(), ["LAG", "LOW_SOL", "PAUSED", "SENDS", "SILENT", "STOPS"]);
  const text = engineMessage(words);
  assert.equal(
    text,
    [
      "Ryntra · виконавець",
      "Минуло: 15 хв без проходів",
      "Увага: 1 ринок на паузі за ризик-лімітами — 4JVX…QRLa",
      "Увага: 3 транзакції поспіль не пройшли",
      "Увага: SOL у виконавця 0,050 — менше 0,100, поповніть",
      "Увага: черга відстає на 10 хв",
      "Увага: вимикач не прочитано — прохід нічого не підписує",
    ].join("\n"),
  );
  assert.equal(engineAlerts(NO_ALERTS, { ...quiet, failedSendsInRow: 2 }).words.length, 0, "two failures in a row are not yet a series");
});

test("a word that did not reach the operator is said again later, not every minute; its condition is not marked said", () => {
  let state = NO_ALERTS;
  const signals = { ...quiet, lamports: 1n };
  const first = engineAlerts(state, signals);
  state = engineAlertsSent(state, { holding: first.holding, words: first.words, delivered: false, at: signals.at });
  assert.equal(state.active.LOW_SOL.sentAt, null);
  assert.equal(engineMayTell(state, signals.at + 60), false);
  assert.equal(engineMayTell(state, signals.at + ENGINE_RULE.retryWordSeconds), true);
  const again = engineAlerts(state, { ...signals, at: signals.at + ENGINE_RULE.retryWordSeconds });
  assert.deepEqual(again.words.map((word) => `${word.kind}:${word.key}`), ["RAISED:LOW_SOL"]);
});

test("a clearing that did not reach the operator is said again", () => {
  let state = engineAlertsSent(NO_ALERTS, { holding: { LAG: "x" }, words: [{ key: "LAG", kind: "RAISED", text: "x" }], delivered: true, at: 100 });
  const at = 100 + CLEAR_AFTER_SECONDS;
  const cleared = engineAlerts(state, { ...quiet, at });
  assert.deepEqual(cleared.words.map((word) => word.kind), ["CLEARED"]);
  state = engineAlertsSent(state, { holding: cleared.holding, words: cleared.words, delivered: false, at });
  assert.deepEqual(engineAlerts(state, { ...quiet, at: at + 1_000 }).words.map((word) => word.kind), ["CLEARED"]);
});

test("both nodes failing a read is said: the second did not answer either", () => {
  const both = run(() => ({ nodes: { reads: 40, mainDown: 1, bothFailed: 4 } }), 4);
  assert.deepEqual(both.said, [[], [], ["RAISED:NODE"], []]);
  assert.equal(engineMessage([{ key: "NODE", kind: "RAISED", text: both.state.active.NODE.detail }]), "Ryntra · виконавець\nУвага: обидва вузли не відповіли на 4 читання");
});

test("the main node's standing refusal of an indexed read, answered by the second every pass, raises no word (SOL-C9)", () => {
  /* Measured 21.10: publicnode answers the creator's wallet (`heldBy`) with 403 «Indexed requests require a personal token». */
  const refused = run(() => ({ nodes: { reads: 120, mainDown: 0, bothFailed: 0 } }), 6 * 60 + 30);
  assert.deepEqual(refused.said.flat(), []);
  assert.equal(refused.state.active.NODE, undefined);
  const minority = run(() => ({ nodes: { reads: 120, mainDown: 60, bothFailed: 0 } }), 10);
  assert.deepEqual(minority.said.flat(), [], "the main node down for half the reads, not most, the second answering: no word");
  const most = run(() => ({ nodes: { reads: 120, mainDown: 61, bothFailed: 0 } }), 3);
  assert.deepEqual(most.said.flat(), ["RAISED:NODE"]);
  assert.equal(most.state.active.NODE.detail, "основний вузол не відповів на 61 з 120 читань");
  assert.deepEqual(run(() => ({ nodes: null }), 5).said.flat(), [], "nodes not counted: nothing said of them");
});

test("said again after six hours only what needs the operator's hand; markets the queue retries are said once", () => {
  const holding = { failing: 2, lamports: 1_000_000n };
  const first = run(() => holding, 6);
  assert.deepEqual(first.said.flat().sort(), ["RAISED:FAILING", "RAISED:LOW_SOL"]);
  const later = engineAlerts(first.state, { ...quiet, ...holding, at: 10_000 + 6 * 60 + ENGINE_RULE.repeatSeconds });
  assert.deepEqual(later.words.map((word) => `${word.kind}:${word.key}`), ["STILL:LOW_SOL"]);
  assert.equal(engineMessage(later.words), "Ryntra · виконавець\nДосі: SOL у виконавця 0,001 — менше 0,100, поповніть");
  const { words } = engineAlerts(first.state, { ...quiet, at: 10_000 + 6 * 60 + CLEAR_AFTER_SECONDS });
  assert.equal(engineMessage(words), "Ryntra · виконавець\nМинуло: брак SOL у виконавця\nМинуло: помилки на ринках");
});

test("the words count right: 1 транзакція, 3 транзакції, 5 транзакцій; 1 ринок, 2 ринки; on 1 ринку, on 2 ринках", () => {
  assert.deepEqual([1, 2, 4, 5, 11, 12, 14, 21, 22, 25, 111, 101].map((n) => plural(n, "one", "few", "many")), ["one", "few", "few", "many", "many", "many", "many", "one", "few", "many", "many", "one"]);
  const say = (signals) => engineAlerts(NO_ALERTS, { ...quiet, ...signals }).words.map((word) => word.text);
  assert.deepEqual(say({ failedSendsInRow: 3 }), ["3 транзакції поспіль не пройшли"]);
  assert.deepEqual(say({ failedSendsInRow: 5 }), ["5 транзакцій поспіль не пройшли"]);
  assert.deepEqual(say({ failedSendsInRow: 21 }), ["21 транзакція поспіль не пройшла"]);
  assert.deepEqual(say({ paused: ["A".repeat(32), "B".repeat(32)] }), ["2 ринки на паузі за ризик-лімітами — AAAA…AAAA, BBBB…BBBB"]);
  assert.deepEqual(say({ paused: Array.from({ length: 5 }, (_, i) => `${i}`.repeat(32)) })[0].slice(0, 9), "5 ринків ");
  const failing = (n) => {
    const { state } = run(() => ({ failing: n }), 6);
    return state.active.FAILING.detail;
  };
  assert.equal(failing(1), "помилка на 1 ринку — черга повторить");
  assert.equal(failing(3), "помилки на 3 ринках — черга повторить");
  const nodes = (bothFailed) => engineAlerts(NO_ALERTS, { ...quiet, nodes: { reads: 40, mainDown: 0, bothFailed } }).holding.NODE;
  assert.deepEqual([1, 3, 5].map(nodes), ["обидва вузли не відповіли на 1 читання", "обидва вузли не відповіли на 3 читання", "обидва вузли не відповіли на 5 читань"]);
});

test("each line opens with its mark — «Увага:», «Досі:», «Минуло:» — never «!», «…», «✓»", () => {
  const text = engineMessage([
    { key: "LAG", kind: "RAISED", text: "a" },
    { key: "LOW_SOL", kind: "STILL", text: "b" },
    { key: "NODE", kind: "CLEARED", text: "c" },
    { key: "PAUSED", kind: "EVENT", text: "d" },
    { key: "SILENT", kind: "EVENT", text: "e" },
  ]);
  assert.equal(text, "Ryntra · виконавець\nУвага: a\nДосі: b\nМинуло: c\nУвага: d\nМинуло: e");
  assert.doesNotMatch(text, /^[!…✓]/m);
});
