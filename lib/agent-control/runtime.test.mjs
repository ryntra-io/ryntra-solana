import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createFileGuardStore,
  createMemoryGuardStore,
} from "../guard/store.ts";
import {
  AgentControlPersistenceError,
  createAgentControlRuntime,
} from "./runtime.ts";

function temporaryStore(t) {
  const directory = mkdtempSync(join(tmpdir(), "ryntra-agent-control-runtime-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return { directory, store: createFileGuardStore({ directory }) };
}

test("memory remains explicit local-development state", () => {
  const store = createMemoryGuardStore();
  const runtime = createAgentControlRuntime({
    store,
    deployment: "SINGLE_INSTANCE",
    nodeEnv: "development",
  });

  assert.equal(runtime.guardStore, store, "Agent Control must reuse the configured Guard adapter");
  assert.equal(runtime.persistence.durability, "EPHEMERAL_SINGLE_INSTANCE");
  assert.deepEqual(runtime.persistence.limitations, ["EPHEMERAL_SINGLE_INSTANCE_STORE"]);
});

test("production initialization fails loudly on an ephemeral nonce ledger", () => {
  assert.throws(
    () => createAgentControlRuntime({
      store: createMemoryGuardStore(),
      deployment: "SINGLE_INSTANCE",
      nodeEnv: "production",
    }),
    (error) => {
      assert.ok(error instanceof AgentControlPersistenceError);
      assert.equal(error.reasonCode, "EPHEMERAL_STORE_IN_PRODUCTION");
      assert.match(error.message, /per-process memory in production/);
      return true;
    },
  );
});

test("multi-instance initialization refuses the durable single-writer adapter", (t) => {
  const { store } = temporaryStore(t);
  assert.throws(
    () => createAgentControlRuntime({
      store,
      deployment: "MULTI_INSTANCE",
      nodeEnv: "production",
    }),
    (error) => {
      assert.ok(error instanceof AgentControlPersistenceError);
      assert.equal(error.reasonCode, "STORE_UNSAFE_FOR_MULTI_INSTANCE");
      assert.match(error.message, /DURABLE_SINGLE_WRITER/);
      return true;
    },
  );
});

test("a production single-instance runtime accepts a cold-start durable store", (t) => {
  const { store } = temporaryStore(t);
  const runtime = createAgentControlRuntime({
    store,
    deployment: "SINGLE_INSTANCE",
    nodeEnv: "production",
  });

  assert.equal(runtime.persistence.durability, "DURABLE_SINGLE_WRITER");
  assert.deepEqual(runtime.persistence.limitations, ["DURABLE_SINGLE_WRITER_STORE"]);
});
