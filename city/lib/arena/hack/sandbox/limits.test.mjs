// Run from repo root: node --test city/lib/arena/hack/sandbox/limits.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { sb, toy, recorded, makeSnapshot, attempt, makeSandbox, proveContext, orderFor, findingFor, verify, hack, tx, CHECK, REPRODUCES, SETUP, BAL_A, BAL_B, PROGRAM } from "./fixtures.mjs";

const honestMove = tx({ program: PROGRAM, op: "move", args: { from: BAL_A, to: BAL_B, amount: 1 } });

test("the limits are checked against their caps: 20 steps, 1.4M CU per step, a total that holds a step", () => {
  assert.equal(sb.checkLimits(sb.DEFAULT_LIMITS), null);
  assert.equal(sb.DEFAULT_LIMITS.steps, 20);
  assert.match(sb.checkLimits(sb.limitsOf({ steps: 21 })).detail, /steps/);
  assert.match(sb.checkLimits(sb.limitsOf({ cuPerStep: 1_400_001 })).detail, /cuPerStep/);
  assert.match(sb.checkLimits(sb.limitsOf({ cuPerStep: 5_000, cuTotal: 4_999 })).detail, /at least one step/);
  assert.match(sb.checkLimits(sb.limitsOf({ ms: 0 })).detail, /ms/);
  assert.match(sb.checkLimits(sb.limitsOf({ costMicroUsd: -1 })).detail, /costMicroUsd/);
  const run = makeSandbox().run(attempt({ limits: { steps: 21 } }));
  assert.equal(run.ok, false);
  assert.equal(run.refusal, "BAD_LIMITS");
});

test("past the step limit the harness stops feeding inputs; the run ends, it does not crash", () => {
  const inputs = [...SETUP, ...Array.from({ length: 30 }, () => honestMove)];
  const sandbox = makeSandbox();
  const run = sandbox.run(attempt({ inputs, limits: { steps: 5 } }));
  assert.equal(run.ok, true);
  assert.equal(run.stopped, "steps");
  assert.equal(run.log.entries.length, 5);
  assert.equal(run.usage.steps, 5);
  assert.equal(run.reproduced, false);
  // The judge holds the log to the same step limit, and the honest run is clean evidence of no fault.
  const { judgement } = sandbox.prove(run, proveContext());
  assert.equal(judgement.verdict, "FAIL");
  assert.equal(sandbox.rules(run, { opensAt: 0, closesAt: 1 }).limits.steps, 5);
});

test("past the time ceiling the harness stops between steps; the log stays replayable", () => {
  const clock = { t: 0 };
  // Every look at the wall clock finds it 12 s later.
  const sandbox = sb.createHackSandbox({ engine: toy.createToyEngine, snapshot: recorded(makeSnapshot()), invariants: [CHECK], now: () => (clock.t += 12_000) });
  const run = sandbox.run(attempt({ inputs: [...SETUP, honestMove, honestMove, honestMove], limits: { ms: 30_000 } }));
  assert.equal(run.ok, true);
  assert.equal(run.stopped, "time");
  assert.ok(run.log.entries.length < 5);
  assert.match(run.stopDetail, /30000 at most/);
  assert.equal(makeSandbox().replay(run.log).logHash, run.logHash);
});

test("going over the run's compute is the seat's loss, even when the copy is broken", () => {
  const sandbox = makeSandbox();
  // The split that breaks the check is the step that goes over: 2000 + 1500 + 2100 > 5000.
  const run = sandbox.run(attempt({ inputs: REPRODUCES, limits: { cuPerStep: 5_000, cuTotal: 5_000 } }));
  assert.equal(run.ok, true);
  assert.equal(run.stopped, "cu");
  assert.deepEqual(run.result, { winner: null, reproduced: false, stop: "cu" });
  assert.equal(run.log.entries.at(-1).derived.over, "cu");
  const { judgement, proof } = sandbox.prove(run, proveContext());
  assert.equal(judgement.verdict, "FAIL");
  const { order, grant } = orderFor();
  const a = hack.assessFinding({ order, grant, finding: findingFor(order, run.logHash), proof, prior: [] }, verify);
  assert.equal(a.reason, "NOT_REPRODUCED");
});

test("after the compute is spent no further input runs", () => {
  const run = makeSandbox().run(attempt({ inputs: [...REPRODUCES, honestMove], limits: { cuPerStep: 5_000, cuTotal: 5_000 } }));
  assert.equal(run.stopped, "cu");
  assert.equal(run.log.entries.length, 3);
});

test("a step over its own budget fails in the copy and the run goes on", () => {
  const run = makeSandbox().run(attempt({ inputs: SETUP, limits: { cuPerStep: 1_600, cuTotal: 10_000 } }));
  assert.equal(run.ok, true);
  const first = run.log.entries[0].derived.last;
  assert.equal(first.ok, false);
  assert.match(first.err, /compute budget/);
  assert.equal(first.units, 1_600);
  assert.equal(run.log.entries.length, 2);
  assert.equal(run.stopped, null);
});

test("an input the copy cannot take stops the run where it stands; nothing it hung on an input reaches the log", () => {
  const run = makeSandbox().run(attempt({ inputs: [...SETUP, { tx: "not base64!" }, honestMove] }));
  assert.equal(run.ok, true);
  assert.equal(run.stopped, "rejected");
  assert.equal(run.log.entries.length, 2);
  const extra = makeSandbox().run(attempt({ inputs: [{ ...SETUP[0], note: "x" }] }));
  assert.equal(extra.stopped, "rejected");
  const warp = makeSandbox().run(attempt({ inputs: [{ warp: 432_001 }] }));
  assert.equal(warp.stopped, "rejected");
});
