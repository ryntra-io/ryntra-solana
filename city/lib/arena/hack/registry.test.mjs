// Run from repo root: node --test city/lib/arena/hack/registry.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { hack, makeOrder, makeGrant, makeFinding, makeProof, verify, OWNER_B, PROGRAM2 } from "./fixtures.mjs";

const { createHackRegistry, createMemoryHackStore } = hack;

const reg = () => createHackRegistry({ verify });

async function opened(registry = reg(), over = {}) {
  const order = makeOrder(over.order);
  const result = await registry.openOrder(order, makeGrant(order, over.grant));
  return { registry, order, result };
}

test("openOrder: a draft with a valid grant opens", async () => {
  const { result, registry, order } = await opened();
  assert.equal(result.ok, true);
  assert.equal(result.order.status, "open");
  const stored = await registry.order(order.id);
  assert.equal(stored.order.status, "open");
});

test("openOrder: a bad order is refused with where=order", async () => {
  const registry = reg();
  const order = makeOrder({ title: "" });
  const result = await registry.openOrder(order, makeGrant(order));
  assert.equal(result.ok, false);
  assert.equal(result.where, "order");
});

test("openOrder: a forged grant is refused with where=permission", async () => {
  const registry = reg();
  const order = makeOrder();
  const result = await registry.openOrder(order, makeGrant(order, { signature: { signature: "forged" } }));
  assert.equal(result.ok, false);
  assert.equal(result.where, "permission");
});

test("openOrder: an order already closed cannot be opened", async () => {
  const registry = reg();
  const order = makeOrder({ status: "closed" });
  const result = await registry.openOrder(order, makeGrant(order));
  assert.equal(result.ok, false);
  assert.equal(result.where, "order");
});

test("submitFinding: a reproduced finding is recorded confirmed", async () => {
  const { registry, order } = await opened();
  const result = await registry.submitFinding(makeFinding(order), makeProof());
  assert.equal(result.ok, true);
  assert.equal(result.assessment.outcome, "counts");
  assert.equal(result.finding.status, "confirmed");
  const stored = await registry.findings(order.id);
  assert.equal(stored.length, 1);
  assert.equal(stored[0].status, "confirmed");
});

test("submitFinding: the second finding of one vulnerability is a duplicate", async () => {
  const { registry, order } = await opened();
  await registry.submitFinding(makeFinding(order, { id: "f1", hunter: "a" }), makeProof());
  const second = await registry.submitFinding(makeFinding(order, { id: "f2", hunter: "b" }), makeProof());
  assert.equal(second.assessment.outcome, "duplicate");
  assert.equal(second.finding.status, "duplicate");
});

test("submitFinding: an out-of-scope target is blocked", async () => {
  const { registry, order } = await opened();
  const result = await registry.submitFinding(makeFinding(order, { target: { program: PROGRAM2 } }), makeProof());
  assert.equal(result.assessment.outcome, "blocked");
  assert.equal(result.assessment.reason, "OUT_OF_SCOPE");
});

test("submitFinding: no such order", async () => {
  const registry = reg();
  const result = await registry.submitFinding(makeFinding(makeOrder({ id: "ghost" })), makeProof());
  assert.equal(result.ok, false);
});

test("submitFinding: a malformed finding is refused before any store write", async () => {
  const { registry } = await opened();
  const result = await registry.submitFinding({ not: "a finding" }, makeProof());
  assert.equal(result.ok, false);
});

test("applyMove: the owner may pause and resume; a stranger may not", async () => {
  const { registry, order } = await opened();
  const stranger = await registry.applyMove(order.id, "pause", OWNER_B);
  assert.equal(stranger.ok, false);
  const paused = await registry.applyMove(order.id, "pause", order.protocol);
  assert.equal(paused.ok, true);
  assert.equal(paused.order.status, "paused");
  const resumed = await registry.applyMove(order.id, "resume", order.protocol);
  assert.equal(resumed.ok, true);
  assert.equal(resumed.order.status, "open");
});

test("applyMove: a move not allowed from the current status is refused", async () => {
  const { registry, order } = await opened();
  const settle = await registry.applyMove(order.id, "settle", order.protocol);
  assert.equal(settle.ok, false);
});

test("applyMove: the deadline is the system's move — no owner needed", async () => {
  const { registry, order } = await opened();
  const closed = await registry.applyMove(order.id, "deadline");
  assert.equal(closed.ok, true);
  assert.equal(closed.order.status, "closed");
  // A paused order's findings are refused after the deadline closes it.
  const late = await registry.submitFinding(makeFinding(order), makeProof());
  assert.equal(late.assessment.reason, "ORDER_CLOSED");
});

test("orders filter by status and protocol", async () => {
  const registry = reg();
  await opened(registry, { order: { id: "o1" } });
  await opened(registry, { order: { id: "o2" } });
  const open = await registry.orders({ status: "open" });
  assert.equal(open.length, 2);
  const mine = await registry.orders({ protocol: makeOrder().protocol });
  assert.equal(mine.length, 2);
});

test("the in-memory store stands alone", async () => {
  const store = createMemoryHackStore();
  const order = makeOrder({ status: "open" });
  await store.putOrder({ order, grant: makeGrant(order) });
  assert.equal((await store.getOrder(order.id)).order.id, order.id);
  assert.equal(await store.getOrder("nope"), null);
  await store.putFinding(makeFinding(order));
  assert.equal((await store.findingsForOrder(order.id)).length, 1);
  await store.setOrderStatus(order.id, "paused");
  assert.equal((await store.getOrder(order.id)).order.status, "paused");
});

test("review 8.11: a finding is filed once, and an owner's move must name the owner", async () => {
  const { registry, order } = await opened();
  const finding = makeFinding(order);
  const proof = makeProof();
  const first = await registry.submitFinding(finding, proof);
  assert.equal(first.ok, true);
  const again = await registry.submitFinding({ ...finding, summary: "another story" }, proof);
  assert.deepEqual(again, { ok: false, detail: "this finding was already filed" });
  assert.equal((await registry.finding(finding.id)).status, first.finding.status, "the first filing stands");
  const nobody = await registry.applyMove(order.id, "pause");
  assert.equal(nobody.ok, false, "a pause that names nobody is refused");
});
