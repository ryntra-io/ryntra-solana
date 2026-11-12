// Run from repo root: node --test city/lib/arena/hack/permission.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { hack, makeOrder, makeGrant, verify, PROGRAM2, OWNER_B } from "./fixtures.mjs";

const { checkGrant, isGrantBody, grantText, scopeHash } = hack;

const expectOf = (order) => ({ order: order.id, protocol: order.protocol, scopeHash: scopeHash(order.scope), opensAt: order.opensAt, closesAt: order.closesAt });

test("a valid, signed grant for the order has no issues", () => {
  const order = makeOrder({ status: "open" });
  assert.deepEqual(checkGrant(makeGrant(order), expectOf(order), verify), []);
});

test("a forged signature is refused: NO_PERMISSION", () => {
  const order = makeOrder({ status: "open" });
  const forged = makeGrant(order, { signature: { signature: "forged" } });
  const issues = checkGrant(forged, expectOf(order), verify);
  assert.equal(issues[0].code, "NO_PERMISSION");
});

test("a grant for another order, owner, scope or window is refused", () => {
  const order = makeOrder({ status: "open" });
  assert.equal(checkGrant(makeGrant(order, { body: { order: "other" } }), expectOf(order), verify)[0].code, "WRONG_ORDER");
  assert.equal(checkGrant(makeGrant(order, { body: { protocol: OWNER_B }, signature: { signer: OWNER_B } }), expectOf(order), verify)[0].code, "WRONG_PROTOCOL");
  // A signer who is not the protocol owner, even with the order's own protocol in the body.
  assert.equal(checkGrant(makeGrant(order, { signature: { signer: OWNER_B } }), expectOf(order), verify)[0].code, "WRONG_PROTOCOL");
  // A different scope than the order's — still a valid body (it names the target), but a wider instruction set.
  const otherScope = makeGrant(order, { body: { scope: { programs: order.scope.programs, instructions: ["swap", "withdraw", "mint"] } } });
  assert.equal(checkGrant(otherScope, expectOf(order), verify)[0].code, "SCOPE_MISMATCH");
  // A grant whose window does not cover the order's.
  const narrow = makeGrant(order, { body: { opensAt: order.opensAt + 1 } });
  assert.equal(checkGrant(narrow, expectOf(order), verify)[0].code, "WINDOW");
});

test("a grant body on a non-copy target is malformed", () => {
  const order = makeOrder({ status: "open" });
  const bad = makeGrant(order, { body: { target: { kind: "mainnet", program: PROGRAM2 } } });
  assert.equal(checkGrant(bad, expectOf(order), verify)[0].code, "BAD_GRANT");
  assert.equal(isGrantBody({ ...bad, signature: undefined }), false);
});

test("a grant without a signature is malformed", () => {
  const order = makeOrder({ status: "open" });
  const { signature: _omit, ...body } = makeGrant(order);
  assert.equal(checkGrant(body, expectOf(order), verify)[0].code, "BAD_GRANT");
});

test("a verifier that throws does not crash the check — it is simply not permitted", () => {
  const order = makeOrder({ status: "open" });
  const throwing = () => {
    throw new Error("boom");
  };
  assert.equal(checkGrant(makeGrant(order), expectOf(order), throwing)[0].code, "NO_PERMISSION");
});

test("grantText and scopeHash are stable regardless of key order", () => {
  const order = makeOrder({ status: "open" });
  const a = makeGrant(order);
  const b = makeGrant(order);
  const { signature: _sa, ...bodyA } = a;
  const { signature: _sb, ...bodyB } = b;
  assert.equal(grantText(bodyA), grantText(bodyB));
  assert.equal(scopeHash(order.scope), scopeHash({ instructions: [...order.scope.instructions].reverse(), programs: order.scope.programs }));
});
