// Run from repo root: node --test city/lib/arena/hack/runner/tools.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { f, session, inProc, EXPLOIT, HONEST, FINDING_META } from "./fixtures.mjs";

test("read: an account of the copy comes back bounded, with the full data's hash", () => {
  const s = session(inProc());
  const r = s.read(f.VAULT);
  assert.equal(r.ok, true);
  assert.equal(r.account.owner, f.PROGRAM);
  assert.equal(r.account.lamports, "1000000000");
  assert.equal(r.account.executable, false);
  assert.match(r.account.dataSha256, /^[0-9a-f]{64}$/);
  assert.equal(r.account.truncated, false);
});

test("read: an address not in the copy is `null`, and a malformed address is refused", () => {
  const s = session(inProc());
  assert.deepEqual(s.read(f.addr(999)), { ok: true, account: null });
  assert.equal(s.read("").ok, false);
  assert.equal(s.read(42).ok, false);
});

test("assemble: a transaction's bytes and a warp pass; junk is refused without a run", () => {
  const s = session(inProc());
  const txInput = EXPLOIT[EXPLOIT.length - 1];
  const tx = s.assemble(txInput);
  assert.equal(tx.ok, true);
  assert.equal(tx.kind, "tx");
  assert.ok(tx.bytes > 0 && tx.bytes <= 1_232);
  const warp = s.assemble({ warp: 10 });
  assert.equal(warp.ok, true);
  assert.equal(warp.kind, "warp");
  assert.equal(s.assemble({ tx: "not base64!!" }).ok, false);
  assert.equal(s.assemble({ nope: 1 }).ok, false);
});

test("tryRun: `run` without `prove` plays the exploit open and reports it reproduced, step by step", async () => {
  const s = session(inProc());
  const run = await s.tryRun(EXPLOIT);
  assert.equal(run.ok, true);
  assert.equal(run.reproduced, true);
  assert.equal(run.stopped, null);
  assert.equal(run.steps.length, EXPLOIT.length);
  assert.match(run.logHash, /^[0-9a-f]{64}$/);
  assert.match(run.steps.at(-1).state, /^[0-9a-f]{64}$/);
});

test("tryRun: an honest run does not reproduce; a run has no proof of its own", async () => {
  const s = session(inProc());
  const run = await s.tryRun(HONEST);
  assert.equal(run.ok, true);
  assert.equal(run.reproduced, false);
});

test("submit: `run` + `prove` builds a CITY-223 finding with the judge's logHash and a PASS", async () => {
  const s = session(inProc());
  const out = await s.submit(EXPLOIT, { ...FINDING_META, costMicroUsd: 1_500 });
  assert.equal(out.ok, true);
  assert.equal(out.judgement.verdict, "PASS");
  assert.equal(out.reproduced, true);
  assert.equal(out.finding.logHash, out.logHash);
  assert.equal(out.finding.order, "order-1");
  assert.equal(out.finding.hunter, "agent-7");
  assert.equal(out.finding.target.instruction, "split");
  // The finding is well-formed for the rules over the judge (CITY-223).
  assert.equal(f.hack.checkFinding(out.finding).length, 0);
});

test("submit: the honest run proves a FAIL — no fault — and still carries the same logHash on both sides", async () => {
  const s = session(inProc());
  const out = await s.submit(HONEST, { ...FINDING_META, costMicroUsd: 0 });
  assert.equal(out.ok, true);
  assert.equal(out.judgement.verdict, "FAIL");
  assert.equal(out.finding.logHash, out.judgement.logHash);
});

test("submit: the model spend is carried into the proof — over the class ceiling the judge blocks it", async () => {
  const s = session(inProc(), { limits: { ...f.sb.DEFAULT_LIMITS, costMicroUsd: 1_000 } });
  const under = await session(inProc(), { limits: { ...f.sb.DEFAULT_LIMITS, costMicroUsd: 1_000 } }).submit(EXPLOIT, { ...FINDING_META, costMicroUsd: 500 });
  assert.equal(under.judgement.verdict, "PASS");
  const over = await s.submit(EXPLOIT, { ...FINDING_META, costMicroUsd: 2_000 });
  assert.notEqual(over.judgement.verdict, "PASS");
});

test("submit: a refused run comes back as a refusal, not a finding", async () => {
  // A pin the backend's recorded store does not hold: the run never starts.
  const s = session(inProc(), { pin: f.pinFor(f.makeSnapshot({ unixTimestamp: f.UNIX + 1 })) });
  const out = await s.submit(EXPLOIT, { ...FINDING_META, costMicroUsd: 0 });
  assert.equal(out.ok, false);
  assert.equal(out.refusal, "NO_SNAPSHOT");
});
