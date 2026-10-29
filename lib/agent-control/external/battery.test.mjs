// Run from repo root: node --test lib/agent-control/external/battery.test.mjs
//
// The six cases this work is required to prove, each through the surface that
// would actually face an agent from outside rather than through the function
// that happens to refuse it:
//
//   1. a key that is not ours
//   2. a mandate with nothing left in it
//   3. an action attempted over MCP
//   4. «completed» with nothing delivered
//   5. the same order placed twice
//   6. a deadline that passes
//
// They are variations on two objects — one quote and one order — because a
// battery that re-declares its subject six times proves six different things by
// accident.
import { test } from "node:test";
import assert from "node:assert/strict";

import { createMemoryGuardStore } from "../../guard/store.ts";
import { applyPeerAnswer, placeOutboundOrder, readPeerTask } from "../a2a/outbound.ts";
import { createA2aTaskLedger } from "../a2a/task-ledger.ts";
import { answerSendMessage } from "../a2a/interface.ts";
import { admitHostedToolCall, hostedMcpTool } from "../mcp/hosted.ts";
import { MCP_WRITE_EFFECTS } from "../mcp/write-tools.ts";
import { admitMcpWrite, mcpWriteRefusal } from "../mcp/write-gate.ts";
import { authenticateAgentKey, createAgentTenancy } from "../tenancy.ts";
import { FIXTURE, MAINNET, USDC_MAINNET, smartAccountLimit } from "../procurement/fixtures.ts";
import { decideExternalExecution, quoteTradeFee } from "./router.ts";
import {
  FIXTURE_MINTS,
  PEER_ORIGIN,
  memeFacts,
  peerCard,
  peerTask,
  sendMessage,
} from "./fixtures.ts";

const NOW = Date.parse("2026-10-26T12:00:00.000Z");
const HOUR = 60 * 60 * 1_000;

/* ── 1. a key that is not ours ──────────────────────────────────────────── */

test("a key that is not ours is refused, and never quietly becomes anonymous", async () => {
  /*
   * The distinction is the whole case. Presenting nothing is anonymous and is
   * served at the anonymous rate; presenting something wrong is a refusal. A
   * downgrade would make a revoked key look like it still worked, because the
   * caller would keep reading.
   */
  const tenancy = createAgentTenancy(createMemoryGuardStore());
  const tenant = await tenancy.createTenant({ displayName: "A tenant (fixture)", createdAtMs: NOW });
  const issued = await tenancy.issueKey({
    tenantId: tenant.tenantId,
    label: "fixture",
    scopes: ["evidence:read"],
    createdAtMs: NOW,
  });

  const accepted = await authenticateAgentKey(tenancy, issued.key, { nowMs: NOW });
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.principal.tenantId, tenant.tenantId);

  /* Built from the real credential so each case differs in exactly one way:
     a key of the right shape and the wrong identifier is a different refusal
     from a key of the wrong shape, and both are refusals. */
  const unissuedId = "0".repeat(issued.keyId.length);
  const wrongSecret = `${issued.secret[0] === "a" ? "b" : "a"}${issued.secret.slice(1)}`;
  const cases = [
    ["nothing presented", null, "MALFORMED_KEY"],
    ["not a key at all", "hello", "MALFORMED_KEY"],
    ["an identifier nobody issued", issued.key.replace(issued.keyId, unissuedId), "UNKNOWN_KEY"],
    ["the right identifier and the wrong secret", issued.key.replace(issued.secret, wrongSecret), "SECRET_MISMATCH"],
  ];
  for (const [label, presented, reasonCode] of cases) {
    const decision = await authenticateAgentKey(tenancy, presented, { nowMs: NOW });
    assert.equal(decision.accepted, false, label);
    assert.equal(decision.reasonCode, reasonCode, label);
    assert.ok(!("principal" in decision), `${label} produced a principal`);
  }

  await tenancy.revokeKey(issued.keyId, { revokedAtMs: NOW + 1_000 });
  const revoked = await authenticateAgentKey(tenancy, issued.key, { nowMs: NOW + 2_000 });
  assert.equal(revoked.reasonCode, "KEY_REVOKED");
});

test("a key of ours that does not carry the scope is refused for that scope alone", async () => {
  const tenancy = createAgentTenancy(createMemoryGuardStore());
  const tenant = await tenancy.createTenant({ displayName: "A tenant (fixture)", createdAtMs: NOW });
  const issued = await tenancy.issueKey({
    tenantId: tenant.tenantId,
    label: "reads only",
    scopes: ["evidence:read"],
    createdAtMs: NOW,
  });
  const refused = await authenticateAgentKey(tenancy, issued.key, {
    nowMs: NOW,
    requiredScopes: ["proposal:write"],
  });
  assert.equal(refused.reasonCode, "SCOPE_NOT_GRANTED");

  const allowed = await authenticateAgentKey(tenancy, issued.key, {
    nowMs: NOW,
    requiredScopes: ["evidence:read"],
  });
  assert.equal(allowed.accepted, true);
});

/* ── 2. a mandate with nothing left in it ───────────────────────────────── */

const mandateRequest = Object.freeze({
  network: MAINNET,
  mint: USDC_MAINNET,
  payTo: FIXTURE.payTo,
  amountBaseUnits: "100000",
  spender: FIXTURE.agent,
  agentBoundBaseUnits: "500000",
});

test("quoting works, acting does not, and an exhausted mandate is its own second reason", () => {
  /*
   * One path, two answers. The quote is served because a price is a read; the
   * action is not, and the reason it is not does not depend on the mandate
   * being sound — which is exactly why the mandate's own verdict is carried
   * beside it rather than instead of it.
   */
  const quotation = quoteTradeFee({
    inputMint: FIXTURE_MINTS.usdc,
    outputMint: FIXTURE_MINTS.freshToken,
    amountRaw: "1000000",
    input: null,
    output: memeFacts(),
    nowMs: NOW,
  });
  assert.equal(quotation.capability, "QUOTE");
  assert.equal(quotation.execution.open, false);

  const exhausted = decideExternalExecution({
    read: smartAccountLimit({ availableBaseUnits: "1" }, NOW),
    request: mandateRequest,
    nowMs: NOW,
  });
  assert.equal(exhausted.state, "OWNER_SIGNATURE_REQUIRED");
  assert.equal(exhausted.mandateSound, false);
  assert.equal(exhausted.programVerdict.reasonCode, "MANDATE_AMOUNT_ABOVE_AVAILABLE");
  assert.deepEqual(
    [...exhausted.reasons],
    ["EXTERNAL_REQUEST_CARRIES_NO_OWNER_SIGNATURE", "MANDATE_NOT_SOUND"],
  );
});

/* ── 3. an action attempted over MCP ────────────────────────────────────── */

test("an action attempted over MCP is refused at the gate, in four different shapes", () => {
  /*
   * Four shapes because a caller trying to act does not announce it. A tool
   * named for executing, an argument shaped to grant authority, an endpoint
   * the caller chose, and the indirection a published meta-tool would give —
   * each is refused, and each by its own name.
   */
  const named = [
    ["execute_trade", "WRITE_TOOL_NOT_REGISTERED"],
    ["sign_transaction", "WRITE_TOOL_NOT_REGISTERED"],
    ["tool_execute", "WRITE_TOOL_NOT_REGISTERED"],
  ];
  for (const [tool, reasonCode] of named) {
    let code = "ADMITTED";
    try {
      admitMcpWrite({ tool, input: {} });
    } catch (error) {
      code = mcpWriteRefusal(error);
    }
    assert.equal(code, reasonCode, tool);
    assert.equal(hostedMcpTool(tool), null, `${tool} is hosted`);
  }

  /* Authority in an argument is refused first, before the tool is looked up:
     refused later it would come back as an unrecognized field, and somebody
     would drop the field, resend and read the success as permission. */
  let authority = "ADMITTED";
  try {
    admitMcpWrite({ tool: "propose_action", input: { ownerAuthorization: "GRANTED" } });
  } catch (error) {
    authority = mcpWriteRefusal(error);
  }
  assert.equal(authority, "OWNER_AUTHORITY_NOT_ACCEPTED_FROM_CALLER");

  let endpoint = "ADMITTED";
  try {
    admitMcpWrite({ tool: "propose_action", input: { baseUrl: "https://evil.test" } });
  } catch (error) {
    endpoint = mcpWriteRefusal(error);
  }
  assert.equal(endpoint, "CALLER_SUPPLIED_ENDPOINT");

  /* A name this endpoint does not host is refused even for a token holding
     every scope — the inventory filter is an ergonomic, not the control. */
  const guessed = admitHostedToolCall("execute_trade", ["evidence:read", "proposal:write", "metrics:read"]);
  assert.equal(guessed.admitted, false);
  assert.equal(guessed.reasonCode, "TOOL_NOT_HOSTED");
});

test("a proposal that names a value-moving action is admitted and still authorizes nothing", () => {
  /* Proposing a value-committing action is what this product is for. The
     refusal that matters is not «you may not ask» — it is that asking never
     becomes permission, which is a property of the one effect value. */
  const admitted = admitMcpWrite({
    tool: "propose_action",
    input: { actionRef: "action:bnb-apex/fund-job@1", budget: { amount: "1", assetRef: "x" } },
  });
  assert.equal(admitted.effect, "PROPOSAL_ONLY");
  assert.equal(admitted.phase, "PROPOSE");
  assert.equal(admitted.ownerAuthorization, "NOT_REQUESTED");
  assert.deepEqual([...MCP_WRITE_EFFECTS], ["PROPOSAL_ONLY"]);
});

test("the A2A door gives the same answer as the MCP door", async () => {
  const answer = await answerSendMessage(sendMessage({ intent: "EXECUTE_TRADE" }), {
    ledger: createA2aTaskLedger(createMemoryGuardStore()),
    readSide: async () => null,
    now: new Date(NOW),
  });
  assert.equal(answer.task.status.state, "TASK_STATE_REJECTED");
  assert.equal(answer.task.metadata.execution.open, false);
});

/* ── 4, 5, 6: one order, three ways it ends ─────────────────────────────── */

function ledger() {
  return createA2aTaskLedger(createMemoryGuardStore());
}

function order(store, overrides = {}) {
  return placeOutboundOrder({
    rawCard: peerCard(),
    registeredOrigins: [PEER_ORIGIN],
    order: {
      idempotencyKey: "battery-order-0001",
      ask: { ask: "counterparty-research" },
      deadlineMs: NOW + HOUR,
      ...overrides,
    },
    ledger: store,
    nowMs: NOW,
  });
}

test("«completed» with nothing delivered does not close the order", async () => {
  const store = ledger();
  const placed = await order(store);

  const reading = readPeerTask(peerTask(placed.taskId, "TASK_STATE_COMPLETED", 2), placed.taskId);
  const applied = await applyPeerAnswer({ ledger: store, reading, nowMs: NOW + 60_000 });

  assert.equal(applied.record.state, "TASK_STATE_COMPLETED");
  assert.equal(applied.record.deliveryClaim, "COUNTERPARTY_CLAIMED_COMPLETED");
  /* Still exactly where it was. Two artifacts listed by the peer and none read
     here is not delivery, it is a claim with a number attached. */
  assert.equal(applied.record.serviceDeliveryStatus, "REQUESTED");
  assert.equal(applied.record.serviceDeliverySource, null);
  assert.equal(applied.record.reconciliation, "PENDING");

  const byClaim = await store.recordDelivery({
    side: "PLACED",
    taskId: placed.taskId,
    delivered: true,
    source: "COUNTERPARTY_CLAIM",
    nowMs: NOW + 70_000,
  });
  assert.equal(byClaim.reasonCode, "DELIVERY_SOURCE_INADMISSIBLE");

  const observed = await store.recordDelivery({
    side: "PLACED",
    taskId: placed.taskId,
    delivered: true,
    source: "RESOURCE_RESPONSE",
    nowMs: NOW + 80_000,
  });
  assert.equal(observed.record.serviceDeliveryStatus, "DELIVERED");
  assert.equal(observed.record.reconciliation, "MATCHED");
});

test("the same order placed twice is one order, and one row", async () => {
  const store = ledger();
  const first = await order(store);
  const second = await order(store);
  const third = await order(store, { ask: { ask: "something else entirely" } });

  assert.equal(second.taskId, first.taskId);
  assert.equal(second.replay, true);
  /* Even a different ask under the same key is the order that key already
     bought: the key is the identity, and honouring the new ask would be
     rewriting an order the peer may already be working on. */
  assert.equal(third.taskId, first.taskId);
  assert.equal(third.replay, true);
  assert.equal(third.record.requestDigest, first.record.requestDigest);
});

test("a deadline that passes makes the order unknown, and nothing is ordered again", async () => {
  const store = ledger();
  const placed = await order(store);

  const expired = await store.expire({ side: "PLACED", taskId: placed.taskId, nowMs: NOW + 2 * HOUR });
  assert.equal(expired.record.timedOut, true);
  assert.equal(expired.record.reconciliation, "UNKNOWN");
  assert.equal(expired.record.serviceDeliveryStatus, "UNKNOWN");

  const again = await order(store);
  assert.equal(again.replay, true);
  assert.equal(again.record.timedOut, true);

  const late = readPeerTask(peerTask(placed.taskId, "TASK_STATE_COMPLETED", 1), placed.taskId);
  const applied = await applyPeerAnswer({ ledger: store, reading: late, nowMs: NOW + 3 * HOUR });
  assert.equal(applied.record.deliveryClaim, "COUNTERPARTY_CLAIMED_COMPLETED");
  assert.equal(applied.record.reconciliation, "UNKNOWN");
});
