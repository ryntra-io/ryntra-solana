// Run from repo root: node --test lib/agent-control/a2a/outbound.test.mjs
//
// Ordering work from somebody else's agent: where the order may go, that it
// goes nowhere today, that the same order is one order, and that the other
// party's «completed» is a claim.
import { test } from "node:test";
import assert from "node:assert/strict";

import { createMemoryGuardStore } from "../../guard/store.ts";
import {
  PEER_ORIGIN,
  UNREGISTERED_PEER_ORIGIN,
  peerCard,
  peerTask,
} from "../external/fixtures.ts";
import {
  OutboundError,
  PEER_BINDINGS_NOT_USED,
  applyPeerAnswer,
  outboundTaskId,
  placeOutboundOrder,
  readPeerTask,
  resolveOutboundTarget,
} from "./outbound.ts";
import { createA2aTaskLedger } from "./task-ledger.ts";

const NOW = Date.parse("2026-10-26T12:00:00.000Z");
const HOUR = 60 * 60 * 1_000;
const REGISTERED = [PEER_ORIGIN];
const ASK = Object.freeze({ ask: "counterparty-research", subject: "a fixture mint" });

function order(overrides = {}) {
  return {
    idempotencyKey: "order-key-00000001",
    ask: ASK,
    deadlineMs: NOW + HOUR,
    ...overrides,
  };
}

function place({ ledger, card = peerCard(), registeredOrigins = REGISTERED, ...rest } = {}) {
  return placeOutboundOrder({
    rawCard: card,
    registeredOrigins,
    order: order(rest),
    ledger: ledger ?? createA2aTaskLedger(createMemoryGuardStore()),
    nowMs: NOW,
  });
}

test("a peer is resolved from its own card, and the send address is the protocol's", () => {
  const target = resolveOutboundTarget(peerCard(), REGISTERED);
  assert.equal(target.origin, PEER_ORIGIN);
  assert.equal(target.sendUrl, `${PEER_ORIGIN}/a2a/v1/message:send`);
  assert.match(target.cardDigest, /^0x[0-9a-f]{64}$/);
  assert.equal(target.peerName, "Research agent (fixture)");
});

test("the card's own defects are refused before its address is judged", () => {
  assert.throws(
    () => resolveOutboundTarget({ name: "x" }, REGISTERED),
    (error) => error instanceof OutboundError && error.reasonCode === "PEER_CARD_MALFORMED",
  );
  assert.throws(
    () =>
      resolveOutboundTarget(
        peerCard({ supportedInterfaces: [{ url: `${PEER_ORIGIN}/a2a`, protocolBinding: "GRPC", protocolVersion: "1.0" }] }),
        REGISTERED,
      ),
    (error) => error.reasonCode === "PEER_CARD_SERVES_NO_HTTP_JSON_INTERFACE",
  );
  assert.ok(PEER_BINDINGS_NOT_USED.includes("GRPC"));
  assert.throws(
    () =>
      resolveOutboundTarget(
        peerCard({ supportedInterfaces: [{ url: "http://peer.example.test/a2a", protocolBinding: "HTTP+JSON", protocolVersion: "1.0" }] }),
        REGISTERED,
      ),
    (error) => error.reasonCode === "PEER_INTERFACE_NOT_ABSOLUTE_HTTPS",
  );
  assert.throws(
    () =>
      resolveOutboundTarget(
        peerCard({ supportedInterfaces: [{ url: `${PEER_ORIGIN}/a2a`, protocolBinding: "HTTP+JSON", protocolVersion: "0.3" }] }),
        REGISTERED,
      ),
    (error) => error.reasonCode === "PEER_PROTOCOL_VERSION_UNSUPPORTED",
  );
});

test("a host that merely contains a registered name is a different host", () => {
  /* The lookalike the procurement registry already learned about, one protocol
     over: the comparison is of parsed origins, never of strings containing
     each other. */
  for (const url of [
    `https://peer.example.test.evil.test/a2a`,
    `https://evil.test/peer.example.test/a2a`,
    `https://peer.example.test:8443/a2a`,
    `${UNREGISTERED_PEER_ORIGIN}/a2a`,
  ]) {
    assert.throws(
      () =>
        resolveOutboundTarget(
          peerCard({ supportedInterfaces: [{ url, protocolBinding: "HTTP+JSON", protocolVersion: "1.0" }] }),
          REGISTERED,
        ),
      (error) => error.reasonCode === "PEER_ORIGIN_NOT_REGISTERED",
      url,
    );
  }
});

test("with no registered peer, every order refuses — which is the state today", async () => {
  await assert.rejects(
    () => place({ registeredOrigins: [] }),
    (error) => error.reasonCode === "PEER_ORIGIN_NOT_REGISTERED",
  );
});

test("an order is built and not sent: there is no transport to send it with", async () => {
  const placed = await place();
  assert.equal(placed.taskId, outboundTaskId("order-key-00000001"));
  assert.equal(placed.request.url, `${PEER_ORIGIN}/a2a/v1/message:send`);
  assert.equal(placed.request.headers["A2A-Version"], "1.0");
  assert.deepEqual(placed.request.body.message.parts, [{ data: ASK }]);
  assert.equal(placed.record.state, "TASK_STATE_SUBMITTED");
  assert.equal(placed.record.serviceDeliveryStatus, "REQUESTED");
  assert.equal(placed.record.serviceDeliverySource, null);
  assert.ok(placed.limitations.some((line) => /not sent/i.test(line)));
});

test("an order with no future deadline, or a key too short to be one, refuses", async () => {
  await assert.rejects(
    () => place({ deadlineMs: NOW }),
    (error) => error.reasonCode === "ORDER_DEADLINE_NOT_IN_FUTURE",
  );
  await assert.rejects(
    () => place({ idempotencyKey: "short" }),
    (error) => error.reasonCode === "ORDER_MALFORMED",
  );
});

test("the same order placed twice is one order", async () => {
  /* The case the task names. Two identical orders would each be individually
     correct and the work would be commissioned twice. */
  const ledger = createA2aTaskLedger(createMemoryGuardStore());
  const first = await place({ ledger });
  const second = await place({ ledger });

  assert.equal(second.taskId, first.taskId);
  assert.equal(first.replay, false);
  assert.equal(second.replay, true);
  assert.equal(second.record.version, first.record.version);
  assert.equal(second.record.claimedAtMs, first.record.claimedAtMs);
});

test("two orders arriving together leave one winner and one replay", async () => {
  const ledger = createA2aTaskLedger(createMemoryGuardStore());
  const [a, b] = await Promise.all([place({ ledger }), place({ ledger })]);
  assert.equal(a.taskId, b.taskId);
  assert.equal([a.replay, b.replay].filter((value) => value === false).length, 1);
});

test("a peer's «completed» moves a claim and never the delivery axis", async () => {
  const ledger = createA2aTaskLedger(createMemoryGuardStore());
  const placed = await place({ ledger });

  const reading = readPeerTask(peerTask(placed.taskId, "TASK_STATE_COMPLETED", 1), placed.taskId);
  assert.equal(reading.claims, "COMPLETED");
  assert.equal(reading.artifactCount, 1);
  assert.match(reading.because, /party with the interest/i);

  const applied = await applyPeerAnswer({ ledger, reading, nowMs: NOW + 1_000 });
  assert.equal(applied.ok, true);
  assert.equal(applied.record.deliveryClaim, "COUNTERPARTY_CLAIMED_COMPLETED");
  assert.equal(applied.record.serviceDeliveryStatus, "REQUESTED");
  assert.equal(applied.record.serviceDeliverySource, null);
  assert.equal(applied.record.reconciliation, "PENDING");
});

test("a counterparty's claim is inadmissible to the delivery axis, and says so first", async () => {
  const ledger = createA2aTaskLedger(createMemoryGuardStore());
  const placed = await place({ ledger });
  const refused = await ledger.recordDelivery({
    side: "PLACED",
    taskId: placed.taskId,
    delivered: true,
    source: "COUNTERPARTY_CLAIM",
    nowMs: NOW + 1_000,
  });
  assert.equal(refused.ok, false);
  assert.equal(refused.reasonCode, "DELIVERY_SOURCE_INADMISSIBLE");

  const observed = await ledger.recordDelivery({
    side: "PLACED",
    taskId: placed.taskId,
    delivered: true,
    source: "RESOURCE_RESPONSE",
    nowMs: NOW + 2_000,
  });
  assert.equal(observed.ok, true);
  assert.equal(observed.record.serviceDeliveryStatus, "DELIVERED");
  assert.equal(observed.record.reconciliation, "MATCHED");

  const again = await ledger.recordDelivery({
    side: "PLACED",
    taskId: placed.taskId,
    delivered: true,
    source: "RESOURCE_RESPONSE",
    nowMs: NOW + 3_000,
  });
  assert.equal(again.reasonCode, "DELIVERY_ALREADY_RECORDED");
});

test("a peer saying it will not finish is taken, because believing it only withholds credit", async () => {
  const ledger = createA2aTaskLedger(createMemoryGuardStore());
  const placed = await place({ ledger });
  const reading = readPeerTask(peerTask(placed.taskId, "TASK_STATE_FAILED"), placed.taskId);
  assert.equal(reading.claims, "WILL_NOT_DELIVER");
  const applied = await applyPeerAnswer({ ledger, reading, nowMs: NOW + 1_000 });
  assert.equal(applied.record.serviceDeliveryStatus, "NOT_DELIVERED");
  assert.equal(applied.record.reconciliation, "FAILED");
  assert.equal(applied.record.deliveryClaim, "NONE");
});

test("an answer about another task, or about no state at all, is refused", async () => {
  const ledger = createA2aTaskLedger(createMemoryGuardStore());
  const placed = await place({ ledger });
  assert.throws(
    () => readPeerTask(peerTask("order-somebody-else", "TASK_STATE_COMPLETED"), placed.taskId),
    (error) => error.reasonCode === "PEER_TASK_NOT_THE_ONE_ORDERED",
  );
  assert.throws(
    () => readPeerTask(peerTask(placed.taskId, "TASK_STATE_UNSPECIFIED"), placed.taskId),
    (error) => error.reasonCode === "PEER_TASK_STATE_INDETERMINATE",
  );
  assert.throws(
    () => readPeerTask({ id: placed.taskId }, placed.taskId),
    (error) => error.reasonCode === "PEER_TASK_MALFORMED",
  );
  assert.throws(
    () => readPeerTask(peerTask(placed.taskId, "TASK_STATE_WHATEVER"), placed.taskId),
    (error) => error.reasonCode === "PEER_TASK_MALFORMED",
  );
});

test("a deadline that passes makes the order unknown, and nothing is re-ordered", async () => {
  /* The timeout the task names. An unknown is a state, not a signal to order
     again: re-placing an order whose fate nobody knows is how one piece of work
     gets commissioned twice. */
  const ledger = createA2aTaskLedger(createMemoryGuardStore());
  const placed = await place({ ledger });

  const expired = await ledger.expire({ side: "PLACED", taskId: placed.taskId, nowMs: NOW + 2 * HOUR });
  assert.equal(expired.ok, true);
  assert.equal(expired.record.timedOut, true);
  assert.equal(expired.record.state, "TASK_STATE_UNSPECIFIED");
  assert.equal(expired.record.serviceDeliveryStatus, "UNKNOWN");
  assert.equal(expired.record.reconciliation, "UNKNOWN");

  const twice = await ledger.expire({ side: "PLACED", taskId: placed.taskId, nowMs: NOW + 3 * HOUR });
  assert.equal(twice.reasonCode, "TASK_ALREADY_EXPIRED");

  /* Re-placing under the same key is the same order, still unknown. */
  const again = await place({ ledger });
  assert.equal(again.replay, true);
  assert.equal(again.record.timedOut, true);
});

test("a claim arriving after the deadline does not make an unknown pending again", async () => {
  const ledger = createA2aTaskLedger(createMemoryGuardStore());
  const placed = await place({ ledger });
  await ledger.expire({ side: "PLACED", taskId: placed.taskId, nowMs: NOW + 2 * HOUR });

  const late = readPeerTask(peerTask(placed.taskId, "TASK_STATE_COMPLETED", 1), placed.taskId);
  const applied = await applyPeerAnswer({ ledger, reading: late, nowMs: NOW + 3 * HOUR });
  assert.equal(applied.ok, true);
  assert.equal(applied.record.deliveryClaim, "COUNTERPARTY_CLAIMED_COMPLETED");
  assert.equal(applied.record.reconciliation, "UNKNOWN");
  assert.equal(applied.record.serviceDeliveryStatus, "UNKNOWN");
});

test("a terminal task takes no further state from the peer", async () => {
  const ledger = createA2aTaskLedger(createMemoryGuardStore());
  const placed = await place({ ledger });
  await applyPeerAnswer({
    ledger,
    reading: readPeerTask(peerTask(placed.taskId, "TASK_STATE_COMPLETED"), placed.taskId),
    nowMs: NOW + 1_000,
  });
  const second = await ledger.recordTaskState({
    side: "PLACED",
    taskId: placed.taskId,
    state: "TASK_STATE_FAILED",
    nowMs: NOW + 2_000,
  });
  assert.equal(second.reasonCode, "TASK_ALREADY_TERMINAL");
});

test("the two sides of the ledger do not see each other's tasks", async () => {
  const ledger = createA2aTaskLedger(createMemoryGuardStore());
  const placed = await place({ ledger });
  assert.equal(await ledger.read("SERVED", placed.taskId), null);
  assert.ok(await ledger.read("PLACED", placed.taskId));
});
