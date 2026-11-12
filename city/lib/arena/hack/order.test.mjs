// Run from repo root: node --test city/lib/arena/hack/order.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { hack, makeOrder, PROGRAM2 } from "./fixtures.mjs";

const { checkOrder, nextStatus, canMove, moveOrder, OrderMoveRejected, takesFindingAt, orderHash, ORDER_STATUSES } = hack;

test("a well-formed order has no issues", () => {
  assert.deepEqual(checkOrder(makeOrder({ status: "open" })), []);
});

test("a malformed order is caught, field by field", () => {
  assert.equal(checkOrder(null)[0].code, "BAD_ORDER");
  assert.ok(checkOrder(makeOrder({ id: "a bad id" })).some((i) => i.detail.includes("id")));
  assert.ok(checkOrder(makeOrder({ protocol: "nope" })).some((i) => i.detail.includes("protocol")));
  assert.ok(checkOrder(makeOrder({ title: "" })).some((i) => i.detail.includes("title")));
  assert.ok(checkOrder(makeOrder({ opensAt: 100, closesAt: 50 })).some((i) => i.detail.includes("opensAt")));
  assert.ok(checkOrder(makeOrder({ reward: {} })).some((i) => i.detail.includes("pool")));
});

test("an order on a non-copy target is refused", () => {
  const issues = checkOrder(makeOrder({ target: { kind: "mainnet", program: PROGRAM2 } }));
  assert.ok(issues.some((i) => i.code === "BAD_TARGET"));
});

test("a scope that does not name the target's program is refused", () => {
  const issues = checkOrder(makeOrder({ scope: { programs: [PROGRAM2] } }));
  assert.ok(issues.some((i) => i.code === "BAD_SCOPE"));
});

test("the state machine: the only moves allowed from each status", () => {
  assert.equal(nextStatus("draft", "open"), "open");
  assert.equal(nextStatus("open", "pause"), "paused");
  assert.equal(nextStatus("paused", "resume"), "open");
  assert.equal(nextStatus("open", "close"), "closed");
  assert.equal(nextStatus("open", "deadline"), "closed");
  assert.equal(nextStatus("paused", "deadline"), "closed");
  assert.equal(nextStatus("closed", "settle"), "settled");
  // Refusals.
  assert.equal(nextStatus("draft", "pause"), null);
  assert.equal(nextStatus("settled", "open"), null);
  assert.equal(nextStatus("closed", "open"), null);
  assert.equal(nextStatus("open", "open"), null);
});

test("moveOrder returns the next status, or throws when the move is not allowed", () => {
  const open = moveOrder(makeOrder(), "open");
  assert.equal(open.status, "open");
  assert.equal(canMove(open, "pause"), true);
  assert.equal(canMove(open, "settle"), false);
  assert.throws(() => moveOrder(open, "settle"), OrderMoveRejected);
});

test("only an open order inside its window takes a finding", () => {
  const order = makeOrder({ status: "open" });
  assert.equal(takesFindingAt(order, order.opensAt), true);
  assert.equal(takesFindingAt(order, order.opensAt - 1), false); // early
  assert.equal(takesFindingAt(order, order.closesAt + 1), false); // late
  assert.equal(takesFindingAt({ ...order, status: "paused" }, order.opensAt), false); // not open
  assert.equal(takesFindingAt({ ...order, status: "closed" }, order.opensAt), false);
});

test("an order keeps one hash across its status moves", () => {
  const draft = makeOrder();
  const open = moveOrder(draft, "open");
  assert.equal(orderHash(draft), orderHash(open)); // status is not part of the hash
  assert.notEqual(orderHash(draft), orderHash(makeOrder({ title: "another" })));
});

test("every status is a known one", () => {
  assert.deepEqual([...ORDER_STATUSES], ["draft", "open", "paused", "closed", "settled"]);
});
