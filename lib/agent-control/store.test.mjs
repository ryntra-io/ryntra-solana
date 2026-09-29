import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryGuardStore } from "../guard/store.ts";
import { AgentStoreError, createAgentControlStore, isTerminalState } from "./store.ts";

const NOW = new Date("2026-08-17T12:00:00.000Z");

function newStore() {
  return createAgentControlStore(createMemoryGuardStore());
}

async function opened(store, overrides = {}) {
  return store.openLifecycle({
    lifecycleId: "life_1",
    idempotencyKey: "idem-key-00000001",
    intentHash: `0x${"1".repeat(64)}`,
    now: NOW,
    ...overrides,
  });
}

test("a replayed request yields the same record, not a second one", async () => {
  const store = newStore();
  const first = await opened(store);
  assert.equal(first.created, true);
  assert.equal(first.record.state, "DRAFTED");

  /* The same key replayed, and deliberately with a different lifecycle id: a
     retry that generated a fresh id must still land on the original record,
     which is the whole point of keying on the idempotency key rather than on
     whatever the caller happened to mint. */
  const replay = await opened(store, { lifecycleId: "life_2" });
  assert.equal(replay.created, false);
  assert.equal(replay.record.lifecycleId, "life_1");
  assert.equal(replay.record.version, first.record.version);
  assert.equal(await store.readLifecycle("life_2"), undefined, "the retry must not create a second lifecycle");
});

test("concurrent opens on one key produce exactly one lifecycle", async () => {
  const store = newStore();
  const results = await Promise.all(
    Array.from({ length: 8 }, (_, index) =>
      opened(store, { lifecycleId: `life_${index}` }),
    ),
  );
  const created = results.filter((result) => result.created);
  assert.equal(created.length, 1, "more than one writer believed it created the lifecycle");
  const ids = new Set(results.map((result) => result.record.lifecycleId));
  assert.equal(ids.size, 1, "the losers were handed different records");
});

test("opening atomically commits idempotency, lifecycle and the first audit fact", async () => {
  const guard = createMemoryGuardStore();
  const store = createAgentControlStore(guard);
  const first = await store.openLifecycle({
    lifecycleId: "life_authorized",
    idempotencyKey: "authorization-idempotency-0001",
    intentHash: `0x${"3".repeat(64)}`,
    contentHash: `0x${"3".repeat(64)}`,
    initialState: "AUTHORIZED",
    initialEvent: "AUTHORIZATION_ACCEPTED",
    now: NOW,
  });

  assert.equal(first.created, true);
  assert.equal(first.record.state, "AUTHORIZED");
  assert.equal(
    (await guard.collection("agentIdempotency").get("authorization-idempotency-0001")).lifecycleId,
    "life_authorized",
  );
  assert.equal((await guard.collection("agentIntents").get("life_authorized")).state, "AUTHORIZED");
  assert.equal(
    (await guard.collection("agentAudit").get("life_authorized#000000")).event,
    "AUTHORIZATION_ACCEPTED",
  );
});

test("a terminal state is never reopened", async () => {
  const store = newStore();
  await opened(store);
  await store.advance({ lifecycleId: "life_1", to: "PREFLIGHTED", now: NOW });
  await store.advance({ lifecycleId: "life_1", to: "FAILED", now: NOW });

  /* The exact defect the payout kernel wrote this rule for: a slow read
     resolving after the lifecycle already failed. */
  await assert.rejects(
    () => store.advance({ lifecycleId: "life_1", to: "OBSERVED", now: NOW }),
    (error) => {
      assert.ok(error instanceof AgentStoreError);
      assert.equal(error.reasonCode, "TERMINAL_STATE_NOT_REOPENABLE");
      return true;
    },
  );
  assert.equal((await store.readLifecycle("life_1")).state, "FAILED");
});

test("every terminal state is closed, and every non-terminal one is not", async () => {
  for (const state of ["RECONCILED", "BLOCKED", "FAILED"]) {
    assert.equal(isTerminalState(state), true, `${state} must be terminal`);
  }
  for (const state of ["DRAFTED", "PREFLIGHTED", "AUTHORIZED", "OBSERVED"]) {
    assert.equal(isTerminalState(state), false, `${state} must not be terminal`);
  }
});

test("the audit trail records every transition in order and cannot be rewritten", async () => {
  const store = newStore();
  await opened(store);
  await store.advance({ lifecycleId: "life_1", to: "PREFLIGHTED", now: NOW });
  await store.advance({ lifecycleId: "life_1", to: "AUTHORIZED", now: NOW });
  await store.advance({ lifecycleId: "life_1", to: "RECONCILED", now: NOW });

  const trail = await store.readAudit("life_1");
  assert.deepEqual(
    trail.map((entry) => [entry.from, entry.to]),
    [
      [null, "DRAFTED"],
      ["DRAFTED", "PREFLIGHTED"],
      ["PREFLIGHTED", "AUTHORIZED"],
      ["AUTHORIZED", "RECONCILED"],
    ],
  );
  assert.deepEqual(trail.map((entry) => entry.sequence), [0, 1, 2, 3]);

  /* Append-only is a property of the mechanism, not a rule: the store exposes
     no operation that overwrites an entry, so the assertion is over the
     surface rather than over an attempt. */
  assert.equal(typeof store.readAudit, "function");
  assert.ok(!("rewriteAudit" in store) && !("deleteAudit" in store));
});

test("a policy version is immutable; an edit is a new version", async () => {
  const store = newStore();
  const first = await store.publishPolicy({ id: "agent-default", version: 1, definition: { limit: 1 }, now: NOW });
  assert.match(first.digest, /^0x[0-9a-f]{64}$/);

  await assert.rejects(
    () => store.publishPolicy({ id: "agent-default", version: 1, definition: { limit: 2 }, now: NOW }),
    (error) => {
      assert.equal(error.reasonCode, "POLICY_VERSION_IMMUTABLE");
      return true;
    },
  );
  assert.deepEqual((await store.readPolicy("agent-default", 1)).definition, { limit: 1 });

  const second = await store.publishPolicy({ id: "agent-default", version: 2, definition: { limit: 2 }, now: NOW });
  assert.notEqual(second.digest, first.digest, "a different definition must digest differently");
  assert.deepEqual((await store.readPolicy("agent-default", 1)).definition, { limit: 1 }, "v1 must not have moved");
});

test("advancing a lifecycle that does not exist is refused by name", async () => {
  const store = newStore();
  await assert.rejects(
    () => store.advance({ lifecycleId: "missing", to: "PREFLIGHTED", now: NOW }),
    (error) => {
      assert.equal(error.reasonCode, "LIFECYCLE_NOT_FOUND");
      return true;
    },
  );
});

test("this layer adds no adapter of its own", async () => {
  /* Rule five: reuse the surface that was already polished. Three adapters
     already sit behind one contract in lib/guard/store.ts, and a second store
     beside them would be two things that must agree about durability. */
  const { readFileSync } = await import("node:fs");
  const source = readFileSync("lib/agent-control/store.ts", "utf8");
  assert.match(source, /from "\.\.\/guard\/store\.ts"/);
  assert.ok(!/new Map\(|writeFileSync|createPool|node:fs/.test(source), "this layer implements storage of its own");
});
