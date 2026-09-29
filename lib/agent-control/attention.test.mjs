// Run from repo root:
// node --test lib/agent-control/attention.test.mjs
//
// Attention and recovery. Two rules carry most of the weight here and both were
// learned the expensive way elsewhere in this repository: **a queue may not
// invent an importance number to sort itself by**, and **a calm queue has to say
// it is calm** — an empty list and a failed load look identical, and the one
// that reads as "nothing needs you" is the dangerous one to get wrong.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  AGENT_CONTROL_OWNER_ACTIONS,
  ATTENTION_CATEGORIES,
  RECOVERY_ACTORS,
  attentionQueue,
} from "./attention.ts";
import { mainnetPerimeter } from "./mainnet-promotion.ts";

const source = readFileSync(new URL("./attention.ts", import.meta.url), "utf8");

const NOW = "2026-08-24T12:00:00.000Z";

/** The quietest possible world: nothing pending, nothing degraded, nothing open. */
const CALM = Object.freeze({
  asOf: NOW,
  proposals: [],
  unreconciledActions: [],
  quota: { durable: true },
  perimeter: null,
  ownerActions: [],
});

/* ═══════════════════════════════════════════════════ the priority is a table */

test("priority is the index of a frozen category table, and no score exists", () => {
  assert.equal(Object.isFrozen(ATTENTION_CATEGORIES), true);
  assert.ok(ATTENTION_CATEGORIES.length >= 4);
  assert.equal(ATTENTION_CATEGORIES[0], "OWNER_DECISION", "a person waiting outranks everything");

  const queue = attentionQueue({
    ...CALM,
    proposals: [{ id: "p-1", ref: "action:base-evm/erc20-transfer@1", phase: "PROPOSE" }],
    quota: { durable: false, reason: "no configured store" },
    ownerActions: AGENT_CONTROL_OWNER_ACTIONS,
  });

  for (const item of queue.items) {
    assert.equal(
      item.priority,
      ATTENTION_CATEGORIES.indexOf(item.category),
      item.id + " must take its rank from the table",
    );
    /* Home's finish battery bans a verdict word; this bans a magnitude. A
       number that is not an index is a score under another name. */
    for (const [key, value] of Object.entries(item)) {
      if (key === "priority") continue;
      assert.notEqual(typeof value, "number", item.id + " carries a numeric field: " + key);
    }
  }
});

test("the queue is ordered by category, and ties keep a stable order", () => {
  const queue = attentionQueue({
    ...CALM,
    quota: { durable: false, reason: "no configured store" },
    proposals: [
      { id: "p-2", ref: "action:base-evm/erc20-transfer@1", phase: "PROPOSE" },
      { id: "p-1", ref: "action:base-evm/erc20-transfer@1", phase: "PROPOSE" },
    ],
    ownerActions: AGENT_CONTROL_OWNER_ACTIONS,
  });
  const ranks = queue.items.map((item) => item.priority);
  assert.deepEqual([...ranks].sort((a, b) => a - b), ranks, "the queue must already be in order");

  const decisions = queue.items.filter((item) => item.category === "OWNER_DECISION").map((item) => item.id);
  assert.deepEqual(
    [...decisions].sort(),
    decisions,
    "items of equal rank keep a stable order rather than an arbitrary one",
  );
});

test("the module names no importance score anywhere in its own source", () => {
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  for (const word of ["score", "severity", "weight", "urgencyValue"]) {
    assert.equal(
      new RegExp("\\b" + word + "\\b", "i").test(stripped),
      false,
      "the attention module must not carry the word " + word,
    );
  }
});

/* ═════════════════════════════════════════════════ every item has a recovery */

test("every item states a recovery, an actor from the vocabulary, and a step", () => {
  assert.equal(Object.isFrozen(RECOVERY_ACTORS), true);
  const queue = attentionQueue({
    ...CALM,
    proposals: [{ id: "p-1", ref: "action:base-evm/erc20-transfer@1", phase: "PROPOSE" }],
    unreconciledActions: [{ id: "a-1", what: "the Golden RWA sample transfer" }],
    quota: { durable: false, reason: "no configured store" },
    perimeter: mainnetPerimeter({ canaries: [], asOf: NOW }),
    ownerActions: AGENT_CONTROL_OWNER_ACTIONS,
  });
  assert.ok(queue.items.length >= 4);
  for (const item of queue.items) {
    assert.ok(RECOVERY_ACTORS.includes(item.recovery.actor), item.id + " has actor " + item.recovery.actor);
    assert.ok(item.recovery.step.length > 20, item.id + " must state a real step");
  }
});

test("an item nobody can fix must name the record that would change that", () => {
  /* `NOBODY` is an honest answer and the most dangerous one to leave bare: a
     row that says nothing can be done and does not say why reads as a bug. */
  const queue = attentionQueue({
    ...CALM,
    unreconciledActions: [{ id: "a-1", what: "the Golden RWA sample transfer" }],
    ownerActions: AGENT_CONTROL_OWNER_ACTIONS,
  });
  const orphans = queue.items.filter((item) => item.recovery.actor === "NOBODY");
  assert.ok(orphans.length >= 1, "the unreconciled sample is exactly this case");
  for (const item of orphans) {
    assert.ok(item.recovery.opensWith.length > 40, item.id + " must name the record that would open it");
  }
});

/* ═════════════════════════════════════════════════════════ the calm state */

test("an empty queue is calm and says so, rather than being an ambiguous blank", () => {
  const queue = attentionQueue(CALM);
  assert.deepEqual(queue.items, []);
  assert.equal(queue.calm, true);
  assert.ok(queue.calmReason.length > 30, "a calm queue must explain what it checked");
  assert.match(queue.calmReason, /checked/i);
});

test("a queue with anything in it is not calm and carries no calm reason", () => {
  const queue = attentionQueue({ ...CALM, ownerActions: AGENT_CONTROL_OWNER_ACTIONS });
  assert.equal(queue.calm, false);
  assert.equal(queue.calmReason, null);
});

/* ══════════════════════════════════════ what it actually reads, and reports */

test("the two open founder actions are real, named, and owner-recoverable", () => {
  /* `RYN-AGENT-CONTROL-007` needs the BNB job funded; `RYN-AGENT-CONTROL-008`
     needs an npm credential. Both are the founder's, neither is Ryntra's, and
     an attention surface that did not show them would be hiding the only two
     things actually waiting on a person. */
  assert.equal(AGENT_CONTROL_OWNER_ACTIONS.length, 2);
  assert.equal(Object.isFrozen(AGENT_CONTROL_OWNER_ACTIONS), true);
  const ids = AGENT_CONTROL_OWNER_ACTIONS.map((action) => action.task);
  assert.deepEqual([...ids].sort(), ["RYN-AGENT-CONTROL-007", "RYN-AGENT-CONTROL-008"]);

  const queue = attentionQueue({ ...CALM, ownerActions: AGENT_CONTROL_OWNER_ACTIONS });
  const rows = queue.items.filter((item) => item.category === "OWNER_DECISION");
  assert.equal(rows.length, 2);
  for (const row of rows) assert.equal(row.recovery.actor, "OWNER");
});

test("a degraded quota store is Ryntra's to fix and is reported as such", () => {
  const queue = attentionQueue({ ...CALM, quota: { durable: false, reason: "no configured store" } });
  const degraded = queue.items.filter((item) => item.category === "DEGRADED_DEPENDENCY");
  assert.equal(degraded.length, 1);
  assert.equal(degraded[0].recovery.actor, "RYNTRA");
  assert.match(degraded[0].detail, /no configured store/);
});

test("a durable quota store produces no row at all", () => {
  const queue = attentionQueue({ ...CALM, quota: { durable: true } });
  assert.deepEqual(queue.items.filter((item) => item.category === "DEGRADED_DEPENDENCY"), []);
});

test("a blocked mainnet perimeter is a note, not an alarm, and names the decision", () => {
  /* Nothing is broken: FD-02 chose testnet for this phase. Reporting a chosen
     boundary at the top of an attention queue would train the reader to ignore
     the queue, which is the failure mode a priority table exists to avoid. */
  const queue = attentionQueue({
    ...CALM,
    perimeter: mainnetPerimeter({ canaries: [], asOf: NOW }),
  });
  const notes = queue.items.filter((item) => item.category === "OPERATIONAL_NOTE");
  assert.equal(notes.length, 1);
  assert.match(notes[0].detail, /FD-02/);
  assert.equal(notes[0].priority, ATTENTION_CATEGORIES.indexOf("OPERATIONAL_NOTE"));
  assert.equal(notes[0].priority, ATTENTION_CATEGORIES.length - 1, "a chosen boundary sorts last");
});

test("a fully promoted perimeter produces no note", () => {
  const perimeter = { state: "PROMOTABLE", promotable: 8, blocked: 0, capabilities: [], asOf: NOW };
  const queue = attentionQueue({ ...CALM, perimeter });
  assert.deepEqual(queue.items.filter((item) => item.category === "OPERATIONAL_NOTE"), []);
});

test("garbage input produces a calm queue rather than a thrown surface", () => {
  /* This queue renders. A malformed record must not be able to take a page
     down, and it must not be able to invent a row either. */
  const queue = attentionQueue({
    asOf: NOW,
    proposals: [null, 7, "p", {}],
    unreconciledActions: [null, {}],
    quota: null,
    perimeter: undefined,
    ownerActions: [null, {}],
  });
  assert.deepEqual(queue.items, []);
  assert.equal(queue.calm, true);
});
