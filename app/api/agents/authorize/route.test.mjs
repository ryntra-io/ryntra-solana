import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { privateKeyToAccount } from "viem/accounts";

import {
  buildAgentAuthorizationChallenge,
} from "../../../../lib/agent-control/authorization.ts";
import {
  createAgentControlRuntime,
} from "../../../../lib/agent-control/runtime.ts";
import { createFileGuardStore } from "../../../../lib/guard/store.ts";
import {
  authorizationNonceStorageId,
  createAgentAuthorizePostHandler,
} from "./handler.ts";

const CHAIN_ID = 97;
const NOW = new Date("2026-08-21T12:00:00.000Z");
const EXPIRES_AT = "2026-08-21T13:00:00.000Z";
const CONTENT_HASH = `0x${"a".repeat(64)}`;
const NONCE = "cold-start-nonce-0001";
const account = privateKeyToAccount(`0x${"33".repeat(32)}`);
const ROUTE = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
const INSTRUMENTATION = readFileSync(
  new URL("../../../../instrumentation.ts", import.meta.url),
  "utf8",
);
const ALLOWED_RATE = {
  allowed: true,
  limit: 12,
  remaining: 11,
  resetAfterSeconds: 60,
  retryAfterSeconds: 60,
};

async function signedBody(nonce = NONCE) {
  const challenge = buildAgentAuthorizationChallenge({
    contentHash: CONTENT_HASH,
    subject: account.address,
    nonce,
    expiresAt: new Date(EXPIRES_AT),
    chainId: CHAIN_ID,
  });
  const signature = await account.signTypedData({
    domain: { ...challenge.domain },
    types: challenge.types,
    primaryType: challenge.primaryType,
    message: { ...challenge.message },
  });
  return {
    contentHash: CONTENT_HASH,
    proof: {
      subjectRef: account.address,
      contentHash: CONTENT_HASH,
      nonce,
      expiresAt: EXPIRES_AT,
      signature,
    },
  };
}

function request(body) {
  return new Request("https://ryntra.test/api/agents/authorize", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function runtime(directory) {
  return createAgentControlRuntime({
    store: createFileGuardStore({ directory }),
    deployment: "SINGLE_INSTANCE",
    nodeEnv: "production",
  });
}

function handler(agentRuntime) {
  return createAgentAuthorizePostHandler({
    getRuntime: () => agentRuntime,
    consumeRequest: () => ALLOWED_RATE,
    now: () => NOW,
  });
}

test("the production route uses the shared Agent Control runtime, never a private memory store", () => {
  assert.match(ROUTE, /getAgentControlRuntime/);
  assert.match(ROUTE, /createAgentAuthorizePostHandler/);
  assert.match(ROUTE, /getRuntime:\s*getAgentControlRuntime/);
  assert.doesNotMatch(ROUTE, /createMemoryGuardStore|createAgentControlStore|PROCESS_LOCAL/);
  assert.match(INSTRUMENTATION, /assertAgentControlStartupEnvironment/);
  assert.match(INSTRUMENTATION, /NEXT_RUNTIME !== "nodejs"/);
  assert.doesNotMatch(INSTRUMENTATION, /agent-control\/runtime|instrumentation-node/);
});

test("one authorization remains consumed after a cold start and reports the real durability", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "ryntra-agent-authorize-route-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const body = await signedBody();

  const firstRuntime = runtime(directory);
  const first = await handler(firstRuntime)(request(body));
  const firstBody = await first.json();
  assert.equal(first.status, 200);
  assert.equal(firstBody.data.authorized, true);
  assert.equal(firstBody.data.nonceDurability, "DURABLE_SINGLE_WRITER");
  assert.deepEqual(firstBody.data.limitations, [
    "Ryntra verified a signature. It did not create, fund, submit or execute anything.",
    "DURABLE_SINGLE_WRITER_STORE",
  ]);

  const lifecycleId = `authorization_${authorizationNonceStorageId(NONCE)}`;
  const lifecycle = await firstRuntime.lifecycles.readLifecycle(lifecycleId);
  assert.equal(lifecycle?.state, "AUTHORIZED");
  assert.equal(lifecycle?.contentHash, CONTENT_HASH);
  assert.deepEqual(
    (await firstRuntime.lifecycles.readAudit(lifecycleId)).map((entry) => entry.event),
    ["AUTHORIZATION_ACCEPTED"],
  );

  /* A new adapter and a new Agent Control runtime model a cold server start.
     No module cache or in-process Map survives this boundary. */
  const restartedRuntime = runtime(directory);
  const replay = await handler(restartedRuntime)(request(body));
  const replayBody = await replay.json();
  assert.equal(replay.status, 200);
  assert.equal(replayBody.data.authorized, false);
  assert.equal(replayBody.data.reasonCode, "AUTHORIZATION_NONCE_REPLAYED");
  assert.equal(replayBody.data.nonceDurability, "DURABLE_SINGLE_WRITER");
  assert.equal(
    (await restartedRuntime.lifecycles.readLifecycle(lifecycleId))?.version,
    lifecycle?.version,
    "the replay must observe the original lifecycle rather than create another",
  );
});

test("the maximum bounded nonce maps to a bounded opaque lifecycle identity", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "ryntra-agent-authorize-max-nonce-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const nonce = "n".repeat(128);
  const nonceId = authorizationNonceStorageId(nonce);
  assert.match(nonceId, /^[0-9a-f]{64}$/);

  const agentRuntime = runtime(directory);
  const response = await handler(agentRuntime)(request(await signedBody(nonce)));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).data.authorized, true);
  assert.equal(
    (await agentRuntime.lifecycles.readLifecycle(`authorization_${nonceId}`))?.state,
    "AUTHORIZED",
  );

  const persisted = readFileSync(join(directory, "agentIntents.json"), "utf8");
  assert.doesNotMatch(persisted, new RegExp(nonce));
});
