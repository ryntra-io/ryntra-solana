// Run from repo root: node --test city/lib/arena/hack/sandbox/stand.test.mjs
// The stand of reproduction: the recorded scenario (`fixtures/scenario.json`) played again on this machine — each
// attempt must give the log hash it was recorded with — and carried through the judge (CITY-68) and the rules over
// it (CITY-223) to what the finding becomes.
import assert from "node:assert/strict";
import test from "node:test";
import { sb, toy, judgeLib, hack, readScenario, recorded, proveContext, orderFor, findingFor, verify, OWNER_A, AT } from "./fixtures.mjs";

const scenario = readScenario();
const sandbox = () =>
  sb.createHackSandbox({ engine: toy.createToyEngine, snapshot: recorded(scenario.snapshot), invariants: [toy.conservedCheck(scenario.check.vault)], now: () => 0 });
const play = (name) => {
  const a = scenario.attempts.find((x) => x.name === name);
  const s = sandbox();
  const run = s.run({ runId: a.runId, pin: scenario.pin, target: scenario.target, claim: { invariant: scenario.check.invariant, version: scenario.check.version }, actors: scenario.actors, inputs: a.inputs });
  return { a, s, run };
};

test("the recorded pin is the recorded state's own", () => {
  assert.deepEqual(sb.pinOf(scenario.snapshot, scenario.target, toy.TOY_ENGINE), scenario.pin);
  assert.equal(sb.snapshotMatches(scenario.snapshot, scenario.pin), true);
});

for (const name of ["reproduces", "does-not-reproduce"]) {
  test(`«${name}»: this machine writes the log hash it was recorded with`, () => {
    const { a, run } = play(name);
    assert.equal(run.ok, true);
    assert.equal(run.logHash, a.expect.logHash);
    assert.equal(run.reproduced, a.expect.reproduced);
    assert.equal(run.usage.steps, a.expect.steps);
    assert.equal(run.usage.cu, a.expect.cu);
  });
}

test("the finding reproduces: the judge passes the replay, the rules count it first and reward-eligible", () => {
  const { a, s, run } = play("reproduces");
  const { proof, judgement } = s.prove(run, proveContext());
  assert.equal(judgement.verdict, a.expect.verdict);
  assert.equal(judgement.reason, "WON");
  assert.equal(judgement.logHash, run.logHash);
  assert.equal(proof.deterministic, true);
  const { order, grant } = orderFor();
  const assessed = hack.assessFinding({ order, grant, finding: findingFor(order, run.logHash), proof, prior: [] }, verify);
  assert.equal(assessed.outcome, "counts");
  assert.equal(assessed.reason, "COUNTS");
  assert.equal(assessed.payable, true);
});

test("the finding does not reproduce: clean evidence of no fault, rejected", () => {
  const { a, s, run } = play("does-not-reproduce");
  const { proof, judgement } = s.prove(run, proveContext());
  assert.equal(judgement.verdict, a.expect.verdict);
  assert.equal(judgement.reason, "NOT_WON");
  const { order, grant } = orderFor();
  const assessed = hack.assessFinding({ order, grant, finding: findingFor(order, run.logHash), proof, prior: [] }, verify);
  assert.equal(assessed.outcome, "rejected");
  assert.equal(assessed.reason, "NOT_REPRODUCED");
  assert.equal(assessed.payable, false);
});

test("a finding that names another run's log is not proven by this one", () => {
  const good = play("reproduces");
  const other = play("does-not-reproduce");
  const { proof } = good.s.prove(good.run, proveContext());
  const { order, grant } = orderFor();
  const assessed = hack.assessFinding({ order, grant, finding: findingFor(order, other.run.logHash), proof, prior: [] }, verify);
  assert.equal(assessed.reason, "EVIDENCE_MISMATCH");
});

test("the same fault reproduced again by a second agent is a duplicate, never paid twice", () => {
  const first = play("reproduces");
  const second = play("reproduces");
  const { order, grant } = orderFor();
  const confirmed = { ...findingFor(order, first.run.logHash), status: "confirmed" };
  const { proof } = second.s.prove(second.run, proveContext());
  const later = findingFor(order, second.run.logHash, { id: "finding-2", hunter: "agent-9", submittedAt: AT + 60_000 });
  const assessed = hack.assessFinding({ order, grant, finding: later, proof, prior: [confirmed] }, verify);
  assert.equal(assessed.outcome, "duplicate");
  assert.equal(assessed.payable, false);
  assert.equal(OWNER_A.length, 44);
});

test("a log the agent made up — the honest run with its result turned into a win — is blocked as a cheat", () => {
  const { s, run } = play("does-not-reproduce");
  const forged = JSON.parse(judgeLib.canonicalJson(run.log));
  forged.result = { winner: 0, reproduced: true, stop: null };
  const content = judgeLib.canonicalJson(forged);
  const hash = judgeLib.sha256Hex(content);
  const ctx = proveContext();
  const rules = s.rules(run, ctx.window);
  const judgement = judgeLib.judge(
    {
      matchId: run.runId,
      seat: 0,
      rules,
      rulesHash: judgeLib.rulesHash(rules),
      submission: { media: judgeLib.LOG_FORMAT, content, hash, size: Buffer.byteLength(content), stamp: ctx.stamp({ matchId: run.runId, seat: 0, hash }, ctx.at) },
      usage: { costMicroUsd: 0, ms: 0, steps: run.usage.steps },
      harness: { logHash: run.logHash },
    },
    { verifyStamp: ctx.verifyStamp, games: [s.game] },
  );
  assert.equal(judgement.verdict, "BLOCKED");
  assert.equal(judgement.reason, "REPLAY_DIVERGES");
  const { order, grant } = orderFor();
  const assessed = hack.assessFinding({ order, grant, finding: findingFor(order, hash), proof: { judgement, deterministic: true }, prior: [] }, verify);
  assert.equal(assessed.reason, "CHEAT");
});

test("a log stamped outside the order's window is not a proof", () => {
  const { s, run } = play("reproduces");
  const ctx = proveContext();
  const { judgement } = s.prove(run, { ...ctx, at: ctx.window.closesAt + 1 });
  assert.equal(judgement.verdict, "BLOCKED");
  assert.equal(judgement.reason, "LATE");
});

test("the model's spend is held to the class's ceiling when the order sets one", () => {
  const a = scenario.attempts[0];
  const s = sandbox();
  const run = s.run({ runId: a.runId, pin: scenario.pin, claim: { invariant: "conserved", version: "1" }, actors: scenario.actors, inputs: a.inputs, limits: { costMicroUsd: 1_000 } });
  const { judgement } = s.prove(run, proveContext({ costMicroUsd: 1_001 }));
  assert.equal(judgement.verdict, "BLOCKED");
  assert.equal(judgement.reason, "LIMIT_EXCEEDED");
});
