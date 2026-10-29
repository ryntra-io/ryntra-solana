// Run from repo root: node --test lib/agent-control/a2a/interface.test.mjs
//
// The method inventory, and the one answer this surface will not give.
//
// `TASK_STATE_AUTH_REQUIRED` is asserted absent from every path below, not
// because it is ugly but because §7.6.1 lets a task in that state resume on a
// credential arriving out of band. An action resuming on a credential is the
// thing this interface exists not to do.
import { test } from "node:test";
import assert from "node:assert/strict";

import { createMemoryGuardStore } from "../../guard/store.ts";
import { FIXTURE_MINTS, memeFacts, sendMessage, sendText } from "../external/fixtures.ts";
import {
  A2A_REFUSED_METHODS,
  A2A_SERVED_METHODS,
  acceptsWireVersion,
  answerSendMessage,
  resolveA2aMethod,
  servedTaskId,
} from "./interface.ts";
import { createA2aTaskLedger } from "./task-ledger.ts";

const NOW = new Date("2026-10-26T12:00:00.000Z");

function deps({ ledger, reads = [] } = {}) {
  return {
    ledger: ledger ?? createA2aTaskLedger(createMemoryGuardStore()),
    readSide: async (mint) => {
      reads.push(mint);
      return mint === FIXTURE_MINTS.freshToken ? memeFacts() : null;
    },
    now: NOW,
  };
}

test("one method is served and the rest refuse by name, not by a bare not-found", () => {
  assert.deepEqual([...A2A_SERVED_METHODS], ["card", "message:send"]);
  assert.deepEqual(resolveA2aMethod(["card"], "GET"), { served: true, method: "card" });
  assert.deepEqual(resolveA2aMethod(["message:send"], "POST"), { served: true, method: "message:send" });

  const streaming = resolveA2aMethod(["message:stream"], "POST");
  assert.equal(streaming.served, false);
  assert.equal(streaming.reasonCode, "A2A_METHOD_NOT_SERVED");
  assert.equal(streaming.status, 501);

  for (const segments of [["tasks", "abc"], ["tasks", "abc:cancel"], ["tasks", "abc:subscribe"]]) {
    const refused = resolveA2aMethod(segments, "GET");
    assert.equal(refused.reasonCode, "A2A_METHOD_NOT_SERVED", segments.join("/"));
  }

  const unknown = resolveA2aMethod(["whatever"], "POST");
  assert.equal(unknown.reasonCode, "A2A_METHOD_UNKNOWN");
  assert.equal(unknown.status, 404);

  assert.equal(resolveA2aMethod(["card"], "POST").reasonCode, "A2A_HTTP_METHOD_NOT_ALLOWED");
  assert.equal(resolveA2aMethod(["message:send"], "GET").reasonCode, "A2A_HTTP_METHOD_NOT_ALLOWED");
});

test("every refused method carries a reason worth reading", () => {
  for (const entry of A2A_REFUSED_METHODS) {
    assert.ok(entry.because.length > 30, `${entry.method} is refused without a reason`);
    assert.match(entry.path, /^\/v1\//, entry.method);
  }
});

test("an absent version header is accepted and another generation is not", () => {
  assert.equal(acceptsWireVersion(null), true);
  assert.equal(acceptsWireVersion("1.0"), true);
  assert.equal(acceptsWireVersion(" 1.0 "), true);
  assert.equal(acceptsWireVersion("0.3"), false);
  assert.equal(acceptsWireVersion("1.0.0"), false);
});

test("a tariff read completes with an artifact and nothing else", async () => {
  const answer = await answerSendMessage(sendMessage({ intent: "READ_TARIFF" }), deps());
  assert.equal(answer.task.status.state, "TASK_STATE_COMPLETED");
  assert.equal(answer.task.artifacts.length, 1);
  const [part] = answer.task.artifacts[0].parts;
  assert.ok(Array.isArray(part.data.flows), "the artifact carries the table");
  assert.equal(answer.replay, false);
});

test("a trade quote reads both sides of the pair through the port it was given", async () => {
  const reads = [];
  const answer = await answerSendMessage(
    sendMessage({
      intent: "QUOTE_TRADE",
      inputMint: FIXTURE_MINTS.usdc,
      outputMint: FIXTURE_MINTS.freshToken,
      amountRaw: "1000000",
    }),
    deps({ reads }),
  );
  assert.equal(answer.task.status.state, "TASK_STATE_COMPLETED");
  assert.deepEqual(reads.sort(), [FIXTURE_MINTS.freshToken, FIXTURE_MINTS.usdc].sort());
  const [part] = answer.task.artifacts[0].parts;
  assert.equal(part.data.flow, "MEME");
  assert.equal(part.data.transaction, null);
});

test("prose is rejected with the shape it should have sent", async () => {
  const answer = await answerSendMessage(sendText("please buy me some of that token"), deps());
  assert.equal(answer.task.status.state, "TASK_STATE_REJECTED");
  assert.match(answer.task.status.message.parts[0].text, /one data part naming an intent/i);
  assert.equal(answer.task.artifacts.length, 0);
});

test("a request to act is rejected, terminally, and never parked on a credential", async () => {
  for (const intent of ["EXECUTE_SWAP", "SIGN_TRADE", "SUBMIT_ORDER", "QUOTE_TRADE_AND_SEND"]) {
    const answer = await answerSendMessage(
      sendMessage({ intent }, `msg-${intent}`),
      deps(),
    );
    assert.equal(answer.task.status.state, "TASK_STATE_REJECTED", intent);
    assert.notEqual(answer.task.status.state, "TASK_STATE_AUTH_REQUIRED", intent);
    assert.match(answer.task.status.message.parts[0].text, /wallet owner's signature/i, intent);
    assert.equal(answer.task.metadata.execution.open, false, intent);
  }
});

test("a served intent that cannot be answered is rejected with the reason, not with a guess", async () => {
  const answer = await answerSendMessage(
    sendMessage({ intent: "QUOTE_LAUNCH_BUY", presetId: "advanced" }),
    deps(),
  );
  assert.equal(answer.task.status.state, "TASK_STATE_REJECTED");
  assert.equal(answer.task.metadata.reasonCode, "LAUNCH_PRESET_NOT_OPEN_TO_PEOPLE");
});

test("the ledger says what the caller was told, including when the answer is a refusal", async () => {
  /* Two accounts of one event is a defect, and the one nobody reads is the one
     that stays wrong. */
  const ledger = createA2aTaskLedger(createMemoryGuardStore());
  const answer = await answerSendMessage(
    sendMessage({ intent: "QUOTE_LAUNCH_BUY", presetId: "advanced" }, "msg-refused-0001"),
    deps({ ledger }),
  );
  assert.equal(answer.task.status.state, "TASK_STATE_REJECTED");
  const held = await ledger.readByRequest("SERVED", "msg-refused-0001");
  assert.equal(held.state, "TASK_STATE_REJECTED");
  assert.equal(held.stateClass, "TERMINAL");
});

test("a body that is not a message of this protocol is still answered as a task", async () => {
  const answer = await answerSendMessage({ nonsense: true }, deps());
  assert.equal(answer.task.status.state, "TASK_STATE_REJECTED");
  assert.match(answer.task.status.message.parts[0].text, /was not a message of this protocol/i);
});

test("the same message sent twice is the same task, and the ledger holds it once", async () => {
  /*
   * The case the task names, on the served side: a client whose connection
   * dropped resends, and gets what it already had rather than a second record
   * of the same request.
   */
  const ledger = createA2aTaskLedger(createMemoryGuardStore());
  const body = sendMessage({ intent: "READ_TARIFF" }, "msg-repeat-0001");

  const first = await answerSendMessage(body, deps({ ledger }));
  const second = await answerSendMessage(body, deps({ ledger }));

  assert.equal(first.task.id, servedTaskId("msg-repeat-0001"));
  assert.equal(second.task.id, first.task.id);
  assert.equal(first.replay, false);
  assert.equal(second.replay, true);

  const held = await ledger.readByRequest("SERVED", "msg-repeat-0001");
  assert.equal(held.taskId, first.task.id);
  /* One claim, one completion: the second answer recorded no further state. */
  assert.equal(held.state, "TASK_STATE_COMPLETED");
  assert.equal(held.version, 2);
});

test("two different messages asking the same thing are two tasks", async () => {
  const ledger = createA2aTaskLedger(createMemoryGuardStore());
  const one = await answerSendMessage(sendMessage({ intent: "READ_TARIFF" }, "msg-a"), deps({ ledger }));
  const two = await answerSendMessage(sendMessage({ intent: "READ_TARIFF" }, "msg-b"), deps({ ledger }));
  assert.notEqual(one.task.id, two.task.id);
  assert.equal(two.replay, false);
});
