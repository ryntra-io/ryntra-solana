import { test } from "node:test";
import assert from "node:assert/strict";

import { outcomeOf, signAndSend, signatureOfWire } from "./flow.ts";
import { addReview, clock, no, ok, scriptedEngine, wire } from "./test-fixtures.mjs";

const LANDED = (signature) => ({ results: [{ signature, state: "LANDED", reason: null }], settled: true });
const SIG = signatureOfWire(wire(9));

function deps(script, sign = async (unsigned) => ({ ok: true, signed: unsigned.map(() => wire(9)) })) {
  const time = clock();
  const run = scriptedEngine(script);
  return { ...run, time, deps: { engine: run.engine, sign, now: time.now, sleep: time.sleep, followMs: 20_000, followEveryMs: 4_000 } };
}

test("a signature's id is the first signature of the wire, in base58", () => {
  assert.equal(signatureOfWire(wire(0)), "1".repeat(64));
  assert.equal(SIG.length >= 64 && SIG.length <= 90, true);
  assert.match(SIG, /^[1-9A-HJ-NP-Za-km-z]+$/);
});

test("the signed bytes go to the relay once, and a landed relay is done", async () => {
  const { deps: d, routes } = deps({ submit: [ok(LANDED(SIG))] });
  const outcome = await signAndSend(addReview(), d.now(), d);
  assert.deepEqual(outcome, { kind: "done", signatures: [SIG] });
  assert.equal(routes("submit").length, 1);
  assert.deepEqual(routes("submit")[0].args, ["ticket-1", [wire(9)]]);
});

test("a wallet that says no sends nothing", async () => {
  const { deps: d, routes } = deps({ submit: [ok(LANDED(SIG))] }, async () => ({ ok: false }));
  assert.deepEqual(await signAndSend(addReview(), d.now(), d), { kind: "refused", code: "WALLET_REFUSED" });
  assert.equal(routes("submit").length, 0);
});

test("a Review too old to sign never opens the wallet", async () => {
  let asked = 0;
  const { deps: d, time, routes } = deps({ submit: [ok(LANDED(SIG))] }, async () => {
    asked += 1;
    return { ok: false };
  });
  const at = d.now();
  time.advance(15_000);
  assert.deepEqual(await signAndSend(addReview(), at, d), { kind: "aged" });
  assert.equal(asked, 0);
  assert.equal(routes("submit").length, 0);
});

test("bytes that aged while the wallet was open are not sent", async () => {
  const time = clock();
  const run = scriptedEngine({ submit: [ok(LANDED(SIG))] });
  const d = {
    engine: run.engine,
    now: time.now,
    sleep: time.sleep,
    sign: async (unsigned) => {
      time.advance(25_000);
      return { ok: true, signed: unsigned.map(() => wire(9)) };
    },
  };
  assert.deepEqual(await signAndSend(addReview(), time.now(), d), { kind: "aged" });
  assert.equal(run.routes("submit").length, 0);
});

test("a worded refusal from the relay means nothing moved; an expired ticket builds again", async () => {
  const refused = deps({ submit: [no("WALLET_MISMATCH")] });
  assert.deepEqual(await signAndSend(addReview(), refused.deps.now(), refused.deps), { kind: "refused", code: "WALLET_MISMATCH" });
  const expired = deps({ submit: [no("TICKET_EXPIRED")] });
  assert.deepEqual(await signAndSend(addReview(), expired.deps.now(), expired.deps), { kind: "aged" });
  assert.equal(expired.routes("status").length, 0);
});

test("a relay whose answer was lost is asked of the chain, never sent again", async () => {
  const { deps: d, routes } = deps({
    submit: [no("NETWORK")],
    status: [ok({ results: [{ signature: SIG, state: "UNKNOWN", reason: null }] }), ok({ results: [{ signature: SIG, state: "LANDED", reason: null }] })],
  });
  assert.deepEqual(await signAndSend(addReview(), d.now(), d), { kind: "done", signatures: [SIG] });
  assert.equal(routes("submit").length, 1);
  assert.equal(routes("status").length, 2);
  assert.deepEqual(routes("status")[0].args, [[SIG]]);
});

test("a chain that stays silent leaves the outcome unknown after the time is up", async () => {
  const { deps: d, routes } = deps({ submit: [no("HTTP_504")], status: [no("NETWORK")] });
  assert.deepEqual(await signAndSend(addReview(), d.now(), d), { kind: "unknown", signatures: [SIG] });
  assert.equal(routes("status").length, 5);
});

test("the relay's results become one outcome", () => {
  const r = (...states) => ({ results: states.map((state, i) => ({ signature: `s${i}`, state, reason: null })), settled: false });
  assert.equal(outcomeOf(r("LANDED", "LANDED")).kind, "done");
  assert.equal(outcomeOf(r("LANDED", "FAILED", "NOT_SENT")).kind, "partial");
  assert.deepEqual(outcomeOf(r("FAILED", "NOT_SENT")), { kind: "failed", signature: "s0" });
  assert.equal(outcomeOf(r("LANDED", "UNKNOWN")).kind, "unknown");
  assert.deepEqual(outcomeOf(r()), { kind: "failed", signature: null });
});
