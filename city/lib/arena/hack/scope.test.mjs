// Run from repo root: node --test city/lib/arena/hack/scope.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { hack, PROGRAM, PROGRAM2, ACCOUNT, addr } from "./fixtures.mjs";

const { isAddress, isName, checkTarget, checkScope, inScope, isFindingTarget, targetProgram } = hack;

test("an address is base58, 32-44 characters, without 0 O I l", () => {
  assert.equal(isAddress(PROGRAM), true);
  assert.equal(isAddress("11111111111111111111111111111111"), true);
  assert.equal(isAddress("too-short"), false);
  assert.equal(isAddress("0OIl0OIl0OIl0OIl0OIl0OIl0OIl0OIl"), false); // forbidden characters
  assert.equal(isAddress(123), false);
});

test("a name is a short id", () => {
  assert.equal(isName("withdraw"), true);
  assert.equal(isName("a bad name"), false);
  assert.equal(isName(""), false);
});

test("a target is a copy: a fork at a pinned slot, or a devnet deploy — never live mainnet", () => {
  assert.equal(checkTarget({ kind: "fork", program: PROGRAM, slot: 250_000_000 }), null);
  assert.equal(checkTarget({ kind: "devnet", program: PROGRAM }), null);
  assert.equal(checkTarget({ kind: "fork", program: PROGRAM }).code, "BAD_TARGET"); // a fork needs a slot
  assert.equal(checkTarget({ kind: "mainnet", program: PROGRAM }).code, "BAD_TARGET"); // no live target exists
  assert.equal(checkTarget({ kind: "fork", program: "nope", slot: 1 }).code, "BAD_TARGET");
  assert.equal(checkTarget(null).code, "BAD_TARGET");
});

test("a scope names at least one program and is well-formed", () => {
  assert.equal(checkScope({ programs: [PROGRAM] }), null);
  assert.equal(checkScope({ programs: [PROGRAM], instructions: ["swap"], accounts: [ACCOUNT] }), null);
  assert.equal(checkScope({ programs: [] }).code, "BAD_SCOPE");
  assert.equal(checkScope({ programs: [PROGRAM, PROGRAM] }).code, "BAD_SCOPE"); // listed twice
  assert.equal(checkScope({ programs: [PROGRAM], instructions: ["a bad name"] }).code, "BAD_SCOPE");
  assert.equal(checkScope({ programs: [PROGRAM], accounts: ["nope"] }).code, "BAD_SCOPE");
});

test("a scope must name the target's program", () => {
  assert.equal(checkScope({ programs: [PROGRAM] }, { kind: "fork", program: PROGRAM, slot: 1 }), null);
  assert.equal(checkScope({ programs: [PROGRAM] }, { kind: "fork", program: PROGRAM2, slot: 1 }).code, "BAD_SCOPE");
});

test("inScope: the program, and the instruction and account when the scope narrows them", () => {
  const scope = { programs: [PROGRAM], instructions: ["swap", "withdraw"], accounts: [ACCOUNT] };
  assert.equal(inScope(scope, { program: PROGRAM, instruction: "withdraw" }), true);
  assert.equal(inScope(scope, { program: PROGRAM }), true); // no instruction named — still in a named program
  assert.equal(inScope(scope, { program: PROGRAM2 }), false); // another program
  assert.equal(inScope(scope, { program: PROGRAM, instruction: "mint" }), false); // instruction out of scope
  assert.equal(inScope(scope, { program: PROGRAM, account: addr(99) }), false); // account out of scope
  assert.equal(inScope({ programs: [PROGRAM] }, { program: PROGRAM, instruction: "anything" }), true); // no narrowing
});

test("a finding target is well-formed", () => {
  assert.equal(isFindingTarget({ program: PROGRAM }), true);
  assert.equal(isFindingTarget({ program: PROGRAM, instruction: "swap", account: ACCOUNT }), true);
  assert.equal(isFindingTarget({ program: "nope" }), false);
  assert.equal(isFindingTarget({ program: PROGRAM, instruction: "a bad name" }), false);
  assert.equal(targetProgram({ kind: "fork", program: PROGRAM, slot: 1 }), PROGRAM);
});
