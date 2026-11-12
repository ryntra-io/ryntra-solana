// Run from repo root: node --test city/lib/arena/hack/finding.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { hack, makeOrder, makeFinding, ACCOUNT, addr } from "./fixtures.mjs";

const { checkFinding, severityRank, isSeverity, dedupeKey, withStatus, SEVERITIES } = hack;
const order = makeOrder();

test("a well-formed finding has no issues", () => {
  assert.deepEqual(checkFinding(makeFinding(order)), []);
  assert.deepEqual(checkFinding(makeFinding(order, { logHash: null })), []); // no run attached yet
});

test("a malformed finding is caught, field by field", () => {
  assert.equal(checkFinding(null)[0].code, "BAD_FINDING");
  assert.ok(checkFinding(makeFinding(order, { id: "a bad id" })).some((i) => i.detail.includes("id")));
  assert.ok(checkFinding(makeFinding(order, { hunterOwner: "nope" })).some((i) => i.detail.includes("hunterOwner")));
  assert.ok(checkFinding(makeFinding(order, { severity: "catastrophic" })).some((i) => i.detail.includes("severity")));
  assert.ok(checkFinding(makeFinding(order, { logHash: "not-hex" })).some((i) => i.detail.includes("logHash")));
  assert.ok(checkFinding(makeFinding(order, { target: { program: "nope" } })).some((i) => i.detail.includes("target")));
  assert.ok(checkFinding(makeFinding(order, { title: "" })).some((i) => i.detail.includes("title")));
});

test("severity ranks strongest first; info is the weakest", () => {
  assert.deepEqual([...SEVERITIES], ["critical", "high", "medium", "low", "info"]);
  assert.ok(severityRank("critical") > severityRank("high"));
  assert.ok(severityRank("high") > severityRank("low"));
  assert.ok(severityRank("low") > severityRank("info"));
  assert.equal(isSeverity("medium"), true);
  assert.equal(isSeverity("huge"), false);
});

test("the dedupe key is the same vulnerability: order, program, instruction and class — the account does not change it", () => {
  const a = makeFinding(order, { id: "a", hunter: "x" });
  const b = makeFinding(order, { id: "b", hunter: "y", target: { program: a.target.program, instruction: "withdraw", account: ACCOUNT } });
  assert.equal(dedupeKey(a), dedupeKey(b)); // same program + instruction + class, different account and hunter

  const other = makeFinding(order, { vulnClass: "overflow" });
  assert.notEqual(dedupeKey(a), dedupeKey(other)); // another class is another vulnerability

  const elsewhere = makeFinding(order, { target: { program: addr(77), instruction: "withdraw" } });
  assert.notEqual(dedupeKey(a), dedupeKey(elsewhere)); // another program

  const otherOrder = makeFinding(makeOrder({ id: "order-2" }));
  assert.notEqual(dedupeKey(a), dedupeKey(otherOrder)); // another order
});

test("withStatus moves a finding without touching the rest", () => {
  const f = makeFinding(order);
  const moved = withStatus(f, "confirmed");
  assert.equal(moved.status, "confirmed");
  assert.equal(moved.id, f.id);
  assert.equal(f.status, "submitted"); // the original is untouched
});
