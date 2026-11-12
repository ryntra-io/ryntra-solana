// Run from repo root: node --test city/lib/arena/hack/sandbox/determinism.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import {
  sb,
  toy,
  judgeLib,
  attempt,
  makeSandbox,
  makeSnapshot,
  pinFor,
  proveContext,
  orderFor,
  findingFor,
  verify,
  hack,
  tx,
  CLAIM,
  REPRODUCES,
  NOT_REPRODUCED,
  PROGRAM,
  VAULT,
  PROTOCOL_BAL,
  PROTOCOL,
} from "./fixtures.mjs";

const { canonicalJson } = judgeLib;

test("the same pin and the same inputs give the same log, byte for byte, on a fresh sandbox", () => {
  const first = makeSandbox().run(attempt());
  const second = makeSandbox().run(attempt());
  assert.equal(first.ok, true);
  assert.equal(first.logHash, second.logHash);
  assert.equal(canonicalJson(first.log), canonicalJson(second.log));
  assert.equal(first.logHash, judgeLib.sha256Hex(canonicalJson(first.log)));
});

test("wall time never enters the log: a slow machine and a fast one write the same bytes", () => {
  const slow = { t: 0 };
  const fast = { t: 9_999_999 };
  const a = makeSandbox({ clock: slow }).run(attempt());
  slow.t += 25_000;
  const b = makeSandbox({ clock: fast }).run(attempt());
  assert.equal(a.logHash, b.logHash);
  // The entries' time is the copy's own clock.
  for (const entry of a.log.entries) assert.equal(entry.at, makeSnapshot().unixTimestamp * 1_000);
});

test("the copy's clock moves only by the run's own warp, the same on every replay", () => {
  const run = makeSandbox().run(attempt({ inputs: [{ warp: 5 }, ...REPRODUCES] }));
  assert.equal(run.ok, true);
  assert.equal(run.log.entries[0].derived.slot, makeSnapshot().slot + 5);
  assert.equal(run.log.entries[1].at, (makeSnapshot().unixTimestamp + 2) * 1_000);
  assert.equal(makeSandbox().replay(run.log).logHash, run.logHash);
});

test("anyone replays the log on the same pin and gets the same log hash and result", () => {
  const run = makeSandbox().run(attempt());
  const replayed = makeSandbox().replay(JSON.parse(canonicalJson(run.log)));
  assert.equal(replayed.ok, true);
  assert.equal(replayed.logHash, run.logHash);
  assert.deepEqual(replayed.result, { winner: 0, reproduced: true, stop: null });
});

test("a log changed anywhere does not replay: the first divergence is named", () => {
  const run = makeSandbox().run(attempt());
  const log = JSON.parse(canonicalJson(run.log));
  log.entries[1].derived.cuUsed += 1;
  const derived = makeSandbox().replay(log);
  assert.equal(derived.ok, false);
  assert.equal(derived.divergence.index, 1);
  assert.equal(derived.divergence.path, "derived.cuUsed");

  const swapped = JSON.parse(canonicalJson(run.log));
  swapped.entries[2].input = NOT_REPRODUCED[2];
  const input = makeSandbox().replay(swapped);
  assert.equal(input.ok, false);
  assert.equal(input.divergence.index, 2);

  const claimed = JSON.parse(canonicalJson(makeSandbox().run(attempt({ inputs: NOT_REPRODUCED })).log));
  claimed.result = { winner: 0, reproduced: true, stop: null };
  assert.equal(makeSandbox().replay(claimed).divergence.index, "result");
});

test("another pin is another run: a different recorded state gives a different log hash", () => {
  const richer = makeSnapshot();
  richer.accounts[0] = { ...richer.accounts[0], lamports: "2000000000" };
  const a = makeSandbox().run(attempt());
  const b = makeSandbox({ snapshots: [richer] }).run(attempt({ pin: pinFor(richer) }));
  assert.equal(b.ok, true);
  assert.notEqual(a.logHash, b.logHash);
  assert.equal(b.reproduced, true);
});

test("the copy must load to exactly the pinned state: an engine that drifts on load is refused", () => {
  const drifting = () => {
    const engine = toy.createToyEngine();
    return { ...engine, load: (snapshot) => (engine.load(snapshot), engine.fund(VAULT, 1n)) };
  };
  const run = makeSandbox({ engine: drifting }).run(attempt());
  assert.equal(run.ok, false);
  assert.equal(run.refusal, "BAD_ATTEMPT");
  assert.match(run.detail, /does not hash to the pin/);
});

test("the pin names its engine: another engine version is refused, not run", () => {
  const newer = () => ({ ...toy.createToyEngine(), version: "2" });
  const run = makeSandbox({ engine: newer }).run(attempt());
  assert.equal(run.ok, false);
  assert.match(run.detail, /the pin runs on toy@1/);
});

test("a run with no recorded state for its pin does not start", () => {
  const run = makeSandbox({ snapshots: [] }).run(attempt());
  assert.equal(run.ok, false);
  assert.equal(run.refusal, "NO_SNAPSHOT");
});

test("an actor that is an account of the copy is refused: the agent funds only its own payers", () => {
  const run = makeSandbox().run(attempt({ actors: [PROTOCOL_BAL] }));
  assert.equal(run.ok, false);
  assert.match(run.detail, /actor is an account of the copy/);
});

test("signatures are checked: the protocol's key cannot be borrowed by naming it as the payer", () => {
  const forged = { tx: toy.toyTx(PROTOCOL, [{ program: PROGRAM, op: "move", args: { from: PROTOCOL_BAL, to: PROTOCOL_BAL, amount: 1 } }]) };
  const run = makeSandbox().run(attempt({ inputs: [forged] }));
  assert.equal(run.ok, true);
  assert.equal(run.log.entries[0].derived.last.ok, false);
  assert.match(run.log.entries[0].derived.last.err, /signature verification failed/);
  assert.equal(run.reproduced, false);
});

test("a check that already fails at the pin proves nothing: undecided, and a person looks", () => {
  const broken = makeSnapshot();
  broken.accounts[0] = { ...broken.accounts[0], data: toy.toyData({ t: "vault", supply: 999, accounts: [PROTOCOL_BAL] }) };
  const sandbox = makeSandbox({ snapshots: [broken] });
  const run = sandbox.run(attempt({ pin: pinFor(broken) }));
  assert.equal(run.ok, true);
  assert.equal(run.reproduced, null);
  assert.equal(run.result, null);
  const { judgement, proof } = sandbox.prove(run, proveContext());
  assert.equal(judgement.verdict, "NEEDS_REVIEW");
  assert.equal(judgement.reason, "UNDECIDED");
  const { order, grant } = orderFor();
  const a = hack.assessFinding({ order, grant, finding: findingFor(order, run.logHash), proof, prior: [] }, verify);
  assert.equal(a.outcome, "review");
  assert.equal(a.payable, false);
});

test("a claim the order does not carry does not start", () => {
  const run = makeSandbox().run(attempt({ claim: { ...CLAIM, invariant: "solvent" } }));
  assert.equal(run.ok, false);
  assert.match(run.detail, /no check solvent@1/);
});

test("the log carries the pin, the claim and the limits: the rules the judge replays under", () => {
  const sandbox = makeSandbox();
  const run = sandbox.run(attempt());
  assert.deepEqual(run.log.config.pin, pinFor());
  assert.deepEqual(run.log.config.claim, CLAIM);
  const rules = sandbox.rules(run, { opensAt: 0, closesAt: 1 });
  assert.equal(rules.class, "verified");
  assert.equal(rules.decider, "replay");
  assert.equal(rules.money, "none");
  assert.deepEqual(rules.game.config, run.log.config);
  assert.deepEqual(judgeLib.checkRules(rules), []);
  assert.equal(sb.HACK_GAME.id, run.log.game.id);
  assert.equal(typeof tx, "function");
  assert.equal(VAULT.length, 44);
});
