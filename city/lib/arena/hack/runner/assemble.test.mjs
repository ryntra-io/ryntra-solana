// Run from repo root: node --test city/lib/arena/hack/runner/assemble.test.mjs
/*
 * CITY-238: the harness puts a transaction together for an agent that cannot sign — with the agent's own payers of the
 * copy and nothing else. The payers' keys sign only what names them; no other signature is ever made; the bounds hold.
 * And the session takes `{ instructions }` wherever it takes an input, and the brain without a model files a run the
 * judge cannot decide when its plan says so.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { f, runner, inProc, capturing, session, stubPlan, view, FINDING_META } from "./fixtures.mjs";

const { createCopyActors, ASSEMBLE_MAX } = await import("./assemble.ts");
const { HACK_TOOLS, readAction, runnerMessages } = await import("./prompt.ts");

const PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const OTHER = Keypair.fromSeed(new Uint8Array(32).fill(9)).publicKey.toBase58();
const seeds = [new Uint8Array(32).fill(1), new Uint8Array(32).fill(2)];
const ix = (over = {}) => ({ program: PROGRAM, accounts: [{ address: OTHER, writable: true }], data: Buffer.from([8, 1, 0, 0, 0, 0, 0, 0, 0]).toString("base64"), ...over });

test("a transaction out of instructions: the first payer pays, the payers named as signers sign, the bytes are the same every time", () => {
  const actors = createCopyActors(2, seeds);
  assert.equal(actors.addresses.length, 2);
  const built = actors.assemble([ix(), ix({ accounts: [{ address: actors.addresses[1], signer: true }, { address: OTHER }] })]);
  assert.equal(built.ok, true);
  assert.equal(built.kind, "tx");
  const tx = Transaction.from(Buffer.from(built.input.tx, "base64"));
  assert.equal(tx.feePayer.toBase58(), actors.addresses[0]);
  assert.deepEqual(tx.signatures.map((s) => s.publicKey.toBase58()), [...actors.addresses]);
  assert.equal(tx.verifySignatures(), true);
  assert.equal(built.bytes, Buffer.from(built.input.tx, "base64").length);
  assert.deepEqual(createCopyActors(2, seeds).assemble([ix(), ix({ accounts: [{ address: actors.addresses[1], signer: true }, { address: OTHER }] })]), built);
  // A run's payers are its own: two runs never share a key.
  assert.notEqual(createCopyActors().addresses[0], createCopyActors().addresses[0]);
  assert.equal(createCopyActors(9).addresses.length, 4, "four payers at most, as the sandbox funds");
});

test("no signature the agent does not have is ever made; what does not read is refused before a run is spent on it", () => {
  const actors = createCopyActors(1, seeds);
  const refused = (instructions, what) => {
    const built = actors.assemble(instructions);
    assert.equal(built.ok, false);
    assert.match(built.detail, what);
  };
  refused([ix({ accounts: [{ address: OTHER, signer: true }] })], /only your own payer can sign/);
  refused([], /instructions/);
  refused("not a list", /instructions/);
  refused(Array.from({ length: ASSEMBLE_MAX.instructions + 1 }, () => ix()), /instructions/);
  refused([ix({ program: "not a program" })], /program/);
  refused([ix({ accounts: "none" })], /accounts/);
  refused([ix({ accounts: [{ address: "x" }] })], /address/);
  refused([ix({ data: "not base64!" })], /data/);
  refused([ix({ data: Buffer.alloc(ASSEMBLE_MAX.dataBytes + 1).toString("base64") })], /data/);
  refused([null], /instruction/);
  // More accounts than a packet holds: refused by size, never cut.
  const many = Array.from({ length: 6 }, (_x, i) => ix({ accounts: Array.from({ length: 8 }, (_y, j) => ({ address: Keypair.fromSeed(new Uint8Array(32).fill(20 + i * 8 + j)).publicKey.toBase58() })) }));
  refused(many, /too large|bytes/i);
  assert.ok(new PublicKey(actors.addresses[0]));
});

test("the session takes { instructions } as a tool input and inside a run's inputs; without an assembler it says so", async () => {
  const actors = createCopyActors(1, seeds);
  const backend = capturing(inProc());
  const withAssembler = runner.createHackSession(
    { order: f.orderFor().order, pin: f.pinFor(), claim: f.CLAIM, actors: actors.addresses, limits: f.sb.DEFAULT_LIMITS, snapshot: f.makeSnapshot(), hunter: "agent-7", hunterOwner: f.OWNER_A, seat: "attacker", runPrefix: "order-1" },
    { backend, now: () => f.AT, assembler: actors.assemble },
  );
  const built = withAssembler.assemble({ instructions: [ix()] });
  assert.equal(built.ok, true);
  // A run's inputs: the asks are assembled first; what reaches the sandbox is a signed transaction, never the ask.
  await withAssembler.tryRun([{ instructions: [ix()] }, { warp: 5 }]);
  assert.deepEqual(backend.calls[0].attempt.inputs, [built.input, { warp: 5 }]);
  assert.deepEqual(backend.calls[0].attempt.actors, actors.addresses);
  // An ask the harness cannot make spends no run and names the input.
  const bad = await withAssembler.tryRun([{ warp: 5 }, { instructions: [ix({ accounts: [{ address: OTHER, signer: true }] })] }]);
  assert.deepEqual([bad.ok, bad.refusal], [false, "BAD_ATTEMPT"]);
  assert.match(bad.detail, /input 1: only your own payer can sign/);
  const filed = await withAssembler.submit([{ instructions: [ix({ program: "x" })] }], { ...FINDING_META, costMicroUsd: 0 });
  assert.deepEqual([filed.ok, filed.refusal], [false, "BAD_ATTEMPT"]);
  assert.equal(backend.calls.length, 1, "no run was spent on what could not be assembled");

  const plain = session(inProc());
  assert.deepEqual(plain.assemble({ instructions: [ix()] }), { ok: false, detail: "this session only takes a signed { tx } or a { warp }" });
  assert.equal(plain.assemble({ warp: 3 }).ok, true, "a signed transaction and a warp are checked as before");
});

test("the prompt names the agent's payer and the tool takes instructions; the model's call reads back as the ask", () => {
  const actors = createCopyActors(1, seeds);
  const [system] = runnerMessages({ ...view(), actors: actors.addresses });
  assert.match(system.content, new RegExp(`Your payer in the copy is ${actors.addresses[0]}`));
  assert.match(system.content, /the only key you have/);
  assert.doesNotMatch(runnerMessages(view())[0].content, /Your payer/, "a session that brings signed transactions is told nothing of a payer");
  const tool = HACK_TOOLS.find((t) => t.name === "assemble_tx");
  assert.deepEqual(Object.keys(tool.parameters.properties), ["instructions", "tx", "warp"]);
  assert.equal(HACK_TOOLS.length, 4, "four tools, no more");
  const call = (name, args) => readAction({ id: "c", name, arguments: JSON.stringify(args) });
  assert.deepEqual(call("assemble_tx", { instructions: [ix()] }), { kind: "assemble", input: { instructions: [ix()] } });
  assert.deepEqual(call("run", { inputs: [{ instructions: [ix()] }] }).inputs, [{ instructions: [ix()] }]);
});

test("the brain without a model files a run the judge cannot decide only when its plan says so", async () => {
  const stub = (plan) => runner.stubBrain({ plan, moveMicroUsd: 1 });
  const after = (result) => [{ tool: "read_account", result: {} }, { tool: "assemble_tx", result: {} }, { tool: "run", result }];
  const undecided = { ok: true, reproduced: null };
  const next = async (plan, result) => (await stub(plan).next({ ...view(), history: after(result) })).action;
  assert.equal((await next(stubPlan(), undecided)).kind, "stop");
  const filed = await next(stubPlan({ undecided: true }), undecided);
  assert.equal(filed.kind, "submit");
  assert.match(filed.why, /owner decides/);
  assert.equal((await next(stubPlan({ undecided: true }), { ok: false, refusal: "ENGINE", detail: "x" })).kind, "stop", "a run that was never played is nothing to file");
  assert.equal((await next(stubPlan({ undecided: true }), { ok: true, reproduced: false })).kind, "stop");
  assert.equal((await next(stubPlan(), { ok: true, reproduced: true })).kind, "submit");
});
