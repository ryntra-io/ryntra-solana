// Run from repo root: node --test app/api/agents/a2a/a2a-route.test.mjs
//
// The A2A interface over HTTP: the card, the one served method, and the five
// the protocol defines that this product answers by name rather than with a
// bare not-found.
//
// The test lives one folder above the route because the route's own folder is a
// catch-all segment, and a path with brackets in it is a path every tool reads
// differently.
import { test } from "node:test";
import assert from "node:assert/strict";

import { createA2aInterfaceHandler } from "./v1/[...method]/handler.ts";
import { createMemoryGuardStore } from "../../../../lib/guard/store.ts";
import { createA2aTaskLedger } from "../../../../lib/agent-control/a2a/task-ledger.ts";
import {
  FIXTURE_MINTS,
  memeFacts,
  sendMessage,
  sendText,
} from "../../../../lib/agent-control/external/fixtures.ts";

/** The interface base the card declares, and the versioned paths under it. */
const INTERFACE = "https://ryntra.io/api/agents/a2a";
const BASE = `${INTERFACE}/v1`;
const NOW = new Date("2026-10-26T12:00:00.000Z");

function handlerWith(ledger = createA2aTaskLedger(createMemoryGuardStore())) {
  return createA2aInterfaceHandler({
    ledger: () => ledger,
    readSide: async (mint) => (mint === FIXTURE_MINTS.freshToken ? memeFacts() : null),
    now: () => NOW,
  });
}

function call(handler, segments, { method = "GET", body, headers = {} } = {}) {
  const request = new Request(`${BASE}/${segments.join("/")}`, {
    method,
    headers: body ? { "content-type": "application/json", ...headers } : headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  return handler(request, { params: Promise.resolve({ method: segments }) });
}

test("the card is served at the protocol's own method path", async () => {
  const response = await call(handlerWith(), ["card"]);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/a2a+json");
  assert.equal(response.headers.get("A2A-Version"), "1.0");
  const card = await response.json();
  /* The base, not the versioned path: a client appends the protocol's own
     `/v1/<method>` to whatever the card declares. */
  assert.equal(card.supportedInterfaces[0].url, INTERFACE);
  assert.equal(card.supportedInterfaces[0].protocolVersion, "1.0");
});

test("the five methods the protocol defines and this product does not serve answer by name", async () => {
  const handler = handlerWith();
  for (const segments of [["message:stream"], ["tasks", "abc"], ["tasks", "abc:cancel"]]) {
    const response = await call(handler, segments, { method: "POST", body: {} });
    assert.equal(response.status, 501, segments.join("/"));
    const body = await response.json();
    assert.equal(body.error.code, "A2A_METHOD_NOT_SERVED", segments.join("/"));
    assert.ok(body.error.message.length > 30, segments.join("/"));
  }

  const unknown = await call(handler, ["nonsense"], { method: "POST", body: {} });
  assert.equal(unknown.status, 404);
  assert.equal((await unknown.json()).error.code, "A2A_METHOD_UNKNOWN");
});

test("another generation's version header is refused rather than read with these semantics", async () => {
  const response = await call(handlerWith(), ["card"], { headers: { "A2A-Version": "0.3" } });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "A2A_VERSION_UNSUPPORTED");
});

test("a quote completes as a task with one artifact", async () => {
  const response = await call(handlerWith(), ["message:send"], {
    method: "POST",
    body: sendMessage({
      intent: "QUOTE_TRADE",
      inputMint: FIXTURE_MINTS.usdc,
      outputMint: FIXTURE_MINTS.freshToken,
      amountRaw: "1000000",
    }),
  });
  assert.equal(response.status, 200);
  const { task } = await response.json();
  assert.equal(task.status.state, "TASK_STATE_COMPLETED");
  assert.equal(task.artifacts.length, 1);
  assert.equal(task.artifacts[0].parts[0].data.flow, "MEME");
});

test("a request to act is a rejected task, and the answer is still a task", async () => {
  const response = await call(handlerWith(), ["message:send"], {
    method: "POST",
    body: sendMessage({ intent: "EXECUTE_TRADE" }),
  });
  assert.equal(response.status, 200);
  const { task } = await response.json();
  assert.equal(task.status.state, "TASK_STATE_REJECTED");
  assert.notEqual(task.status.state, "TASK_STATE_AUTH_REQUIRED");
  assert.equal(task.metadata.execution.open, false);
});

test("prose and a body that is not a message are both answered in the protocol's terms", async () => {
  const handler = handlerWith();
  const prose = await call(handler, ["message:send"], { method: "POST", body: sendText("buy me some") });
  assert.equal((await prose.json()).task.status.state, "TASK_STATE_REJECTED");

  const nonsense = await call(handler, ["message:send"], { method: "POST", body: { nope: 1 } });
  assert.equal((await nonsense.json()).task.status.state, "TASK_STATE_REJECTED");
});

test("the same message twice is the same task", async () => {
  const ledger = createA2aTaskLedger(createMemoryGuardStore());
  const handler = handlerWith(ledger);
  const body = sendMessage({ intent: "READ_TARIFF" }, "msg-route-0001");
  const first = await (await call(handler, ["message:send"], { method: "POST", body })).json();
  const second = await (await call(handler, ["message:send"], { method: "POST", body })).json();
  assert.equal(second.task.id, first.task.id);
  const held = await ledger.readByRequest("SERVED", "msg-route-0001");
  assert.equal(held.taskId, first.task.id);
});

test("the wrong verb on a served method is refused as the wrong verb", async () => {
  const handler = handlerWith();
  const get = await call(handler, ["message:send"], { method: "GET" });
  assert.equal(get.status, 405);
  assert.equal((await get.json()).error.code, "A2A_HTTP_METHOD_NOT_ALLOWED");
});
