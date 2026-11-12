// Run from repo root: node --test city/lib/arena/hack/runner/limits.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { f, runner, session, inProc, view, stubPlan, EXPLOIT } from "./fixtures.mjs";

const { runAgent, stubBrain } = runner;

test("the class ceiling stops the agent before a move could push its spend past it", async () => {
  // Each move costs 100; the ceiling is 150. After one move (spent 100), a second would reach 200 > 150.
  const brain = stubBrain({ plan: stubPlan(), moveMicroUsd: 100, loopForever: true });
  const outcome = await runAgent(session(inProc()), brain, { view: view(), maxTurns: 100, classCeilingMicroUsd: 150, moveMicroUsd: 100 });
  assert.equal(outcome.result, "out_of_budget");
  assert.equal(outcome.turns, 1);
  assert.equal(outcome.spentMicroUsd, 100);
});

test("a timeout is charged the full move price, so a stalling agent still spends toward the ceiling", async () => {
  let turns = 0;
  const timeoutBrain = {
    async next() {
      turns += 1;
      return { kind: "fault", fault: "timeout", costMicroUsd: 100 };
    },
  };
  const outcome = await runAgent(session(inProc()), timeoutBrain, { view: view(), maxTurns: 10, classCeilingMicroUsd: 1_000, moveMicroUsd: 100 });
  assert.equal(outcome.result, "fault");
  assert.equal(outcome.spentMicroUsd, 100);
  assert.equal(turns, 1);
});

test("a brain that never submits ends at the turn cap, it does not run forever", async () => {
  const brain = stubBrain({ plan: stubPlan(), moveMicroUsd: 1, loopForever: true });
  const outcome = await runAgent(session(inProc()), brain, { view: view(), maxTurns: 4, classCeilingMicroUsd: 1_000_000, moveMicroUsd: 1 });
  assert.equal(outcome.result, "over_turns");
  assert.equal(outcome.turns, 4);
});

test("the caller's signal stops the run", async () => {
  const controller = new AbortController();
  controller.abort();
  const brain = stubBrain({ plan: stubPlan(), moveMicroUsd: 1 });
  const outcome = await runAgent(session(inProc()), brain, { view: view(), maxTurns: 10, classCeilingMicroUsd: 1_000_000, moveMicroUsd: 1, signal: controller.signal });
  assert.equal(outcome.result, "aborted");
});

test("the sandbox's own limits still bite through the tools: past the step limit a run stops, it does not crash", async () => {
  const many = [...EXPLOIT, ...Array.from({ length: 30 }, () => ({ warp: 1 }))];
  const run = await session(inProc(), { limits: { ...f.sb.DEFAULT_LIMITS, steps: 5 } }).tryRun(many);
  assert.equal(run.ok, true);
  assert.equal(run.stopped, "steps");
  assert.equal(run.steps.length, 5);
});

test("a per-transaction compute budget bites through the tool: the step fails, the exploit cannot set up, nothing reproduces", async () => {
  // The first transaction (open + open) needs more than this budget, so it fails in the copy and the exploit never arms.
  const run = await session(inProc(), { limits: { ...f.sb.DEFAULT_LIMITS, cuPerStep: 1_500 } }).tryRun(EXPLOIT);
  assert.equal(run.ok, true);
  assert.equal(run.reproduced, false);
  assert.equal(run.steps[0].last.ok, false);
});

test("bad limits are refused before any run", async () => {
  const run = await session(inProc(), { limits: { ...f.sb.DEFAULT_LIMITS, steps: 21 } }).tryRun(EXPLOIT);
  assert.equal(run.ok, false);
  assert.equal(run.refusal, "BAD_LIMITS");
});
