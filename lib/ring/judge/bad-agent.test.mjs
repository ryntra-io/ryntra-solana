// Run from repo root: node --test lib/ring/judge/bad-agent.test.mjs
import "../../world/testing/hooks.mjs";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";

const { judge } = await import("./judge.ts");
const { createStamper, signerOf, stampVerifier } = await import("./stamp.ts");
const { BAD_AGENTS, demoKit } = await import("./bad-agent.ts");
const { race } = await import("./race.ts");
const { makeReceipt } = await import("./receipt.ts");

/**
 * «Поганий агент»: every cheat of the public set is BLOCKED with its exact reason, is never payable, never carries the
 * «verified» seal — and the honest matches the cheats start from are judged as they should be.
 */

const harness = generateKeyPairSync("ed25519").privateKey;
const stranger = generateKeyPairSync("ed25519").privateKey;
const kit = demoKit(createStamper(harness), createStamper(stranger));
const context = { verifyStamp: stampVerifier([signerOf(harness)]), games: [race] };

test("the honest matches the cheats start from", () => {
  assert.equal(judge(kit.replay, context).verdict, "FAIL");
  assert.equal(judge(kit.tests, context).verdict, "PASS");
});

test("the set covers the cheats of the task — a false win, a swapped hash, a skipped test, a limit — and a made-up log", () => {
  const codes = new Set(BAD_AGENTS.map((agent) => agent.expect));
  for (const code of ["FALSE_CLAIM", "HASH_MISMATCH", "TEST_SKIPPED", "LIMIT_EXCEEDED", "LOG_NOT_HARNESS", "BAD_STAMP"]) assert.ok(codes.has(code), code);
  assert.equal(new Set(BAD_AGENTS.map((agent) => agent.id)).size, BAD_AGENTS.length, "ids are unique");
});

for (const agent of BAD_AGENTS) {
  test(`bad agent «${agent.id}» (${agent.does}) → BLOCKED ${agent.expect}`, () => {
    const input = agent.tamper(kit);
    const verdict = judge(input, context);
    assert.equal(verdict.verdict, "BLOCKED", verdict.detail);
    assert.equal(verdict.reason, agent.expect, verdict.detail);
    assert.equal(verdict.payable, false);
    assert.equal(verdict.rerun, false);
    const receipt = makeReceipt({ matchId: input.matchId, seat: input.seat, rules: input.rules, judgement: verdict, at: Date.parse("2026-10-28T13:00:00Z") });
    assert.equal(receipt.verdict, "BLOCKED");
    assert.equal(receipt.reason, agent.expect);
    assert.equal(receipt.seal, null);
  });
}

test("a cheat stays blocked whatever came before it", () => {
  const prior = [{ verdict: "NEEDS_REVIEW", reason: "UNDECIDED" }];
  for (const agent of BAD_AGENTS) assert.equal(judge({ ...agent.tamper(kit), prior }, context).verdict, "BLOCKED", agent.id);
});

test("a rewritten log names its first divergence", () => {
  const verdict = judge(BAD_AGENTS.find((a) => a.id === "rewrites-move").tamper(kit), context);
  assert.equal(verdict.divergence.index, 1);
  assert.equal(verdict.divergence.path, "derived.total");
  assert.equal(verdict.divergence.expected, 6);
  assert.equal(verdict.divergence.found, 7);
});
