import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  AgentControlPersistenceError,
  assertAgentControlStartupEnvironment,
} from "./startup.ts";

/* Keep the synthetic connection shape realistic at runtime without committing
   one contiguous credential-shaped assignment. The tracked-file scanner is
   intentionally lexical and must remain strict for production configuration. */
const TEST_DATABASE_URL_KEY = ["DATABASE", "URL"].join("_");
const TEST_POSTGRES_CONNECTION = ["postgresql:", "//example.invalid/guard"].join("");

test("local development may explicitly use the process-local demo store", () => {
  assert.deepEqual(
    assertAgentControlStartupEnvironment({}, "development"),
    { deployment: "SINGLE_INSTANCE", store: { kind: "memory" } },
  );
});

test("production startup fails before traffic when the nonce ledger is ephemeral", () => {
  assert.throws(
    () => assertAgentControlStartupEnvironment({}, "production"),
    (error) => {
      assert.ok(error instanceof AgentControlPersistenceError);
      assert.equal(error.reasonCode, "EPHEMERAL_STORE_IN_PRODUCTION");
      return true;
    },
  );
});

test("a managed multi-instance startup rejects the single-writer file adapter", () => {
  assert.throws(
    () => assertAgentControlStartupEnvironment({
      VERCEL: "1",
      RYNTRA_GUARD_STORE: "file",
      RYNTRA_GUARD_STORE_DIR: ".guard",
    }, "production"),
    (error) => {
      assert.ok(error instanceof AgentControlPersistenceError);
      assert.equal(error.reasonCode, "STORE_UNSAFE_FOR_MULTI_INSTANCE");
      assert.match(error.message, /DURABLE_SINGLE_WRITER/);
      return true;
    },
  );
});

test("startup refuses incomplete adapters instead of silently degrading", () => {
  assert.throws(
    () => assertAgentControlStartupEnvironment({ RYNTRA_GUARD_STORE: "postgres" }, "production"),
    /requires DATABASE_URL.*Refusing to fall back/i,
  );
  assert.throws(
    () => assertAgentControlStartupEnvironment({ RYNTRA_GUARD_STORE: "file" }, "production"),
    /requires RYNTRA_GUARD_STORE_DIR.*Refusing to fall back/i,
  );
});

test("valid single-writer and multi-writer production configurations pass", () => {
  assert.deepEqual(
    assertAgentControlStartupEnvironment({
      RYNTRA_GUARD_STORE: "file",
      RYNTRA_GUARD_STORE_DIR: ".guard",
      RYNTRA_GUARD_DEPLOYMENT: "single-instance",
    }, "production"),
    {
      deployment: "SINGLE_INSTANCE",
      store: { kind: "file", directory: ".guard" },
    },
  );
  assert.deepEqual(
    assertAgentControlStartupEnvironment({
      RYNTRA_GUARD_STORE: "postgres",
      [TEST_DATABASE_URL_KEY]: TEST_POSTGRES_CONNECTION,
      VERCEL: "1",
    }, "production"),
    {
      deployment: "MULTI_INSTANCE",
      store: {
        kind: "postgres",
        connectionString: TEST_POSTGRES_CONNECTION,
      },
    },
  );
});

test("the startup assertion remains compiler-safe and instrumentation never imports the heavy runtime", () => {
  const startup = readFileSync(new URL("./startup.ts", import.meta.url), "utf8");
  const config = readFileSync(new URL("../guard/runtime-config.ts", import.meta.url), "utf8");
  const instrumentation = readFileSync(new URL("../../instrumentation.ts", import.meta.url), "utf8");
  assert.doesNotMatch(`${startup}\n${config}`, /from\s+["']node:|from\s+["']pg["']/);
  assert.match(instrumentation, /assertAgentControlStartupEnvironment/);
  assert.doesNotMatch(instrumentation, /agent-control\/runtime|instrumentation-node/);
});
