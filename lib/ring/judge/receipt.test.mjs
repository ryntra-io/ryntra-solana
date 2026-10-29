// Run from repo root: node --test lib/ring/judge/receipt.test.mjs
import "../../world/testing/hooks.mjs";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";

const { judge, JUDGE_VERSION } = await import("./judge.ts");
const { createStamper, signerOf, stampVerifier, stampText } = await import("./stamp.ts");
const { checkReceipt, makeReceipt, receiptMemo } = await import("./receipt.ts");
const { parseMemo } = await import("./memo.ts");
const { checkRules, classOf, rulesHash, RING_FORMATS, SHOW_MONEY } = await import("./rules.ts");
const { asSeat, demoKit, demoLog, raceLog, DEMO_REPLAY_RULES, DEMO_TESTS_RULES } = await import("./bad-agent.ts");
const { canonicalJson, hashOf, sha256Hex } = await import("./hash.ts");
const { race } = await import("./race.ts");

/** The receipt: rules' hash, judge's version, log's hash, verdict with reason and result, time — checkable by anyone. */

const harness = generateKeyPairSync("ed25519").privateKey;
const stamp = createStamper(harness);
const kit = demoKit(stamp, createStamper(generateKeyPairSync("ed25519").privateKey));
const context = { verifyStamp: stampVerifier([signerOf(harness)]), games: [race] };
const AT = Date.parse("2026-10-28T13:00:00Z");

const won = { ...asSeat(kit, kit.replay, 1), claim: { outcome: "win" } };
const receiptOf = (input) => makeReceipt({ matchId: input.matchId, seat: input.seat, rules: input.rules, judgement: judge(input, context), at: AT });

test("a receipt carries the rules' hash, the judge's version, the log's hash, the verdict with its reason and the time", () => {
  const receipt = receiptOf(won);
  assert.equal(receipt.format, "ryntra-ring-receipt/1");
  assert.equal(receipt.matchId, "demo-race-1");
  assert.equal(receipt.seat, 1);
  assert.equal(receipt.contest, "race-demo");
  assert.equal(receipt.class, "verified");
  assert.equal(receipt.money, "stakes");
  assert.equal(receipt.rulesHash, rulesHash(DEMO_REPLAY_RULES));
  assert.equal(receipt.judge, JUDGE_VERSION);
  assert.equal(receipt.logHash, sha256Hex(won.submission.content));
  assert.equal(receipt.verdict, "PASS");
  assert.equal(receipt.reason, "WON");
  assert.equal(receipt.level, "L2");
  assert.deepEqual(receipt.result, { winner: 1, total: 10 });
  assert.equal(receipt.seal, "verified");
  assert.equal(receipt.at, "2026-10-28T13:00:00.000Z");
  assert.match(receipt.hash, /^[0-9a-f]{64}$/);
});

test("anyone checks a receipt against the rules and the log", () => {
  const receipt = receiptOf(won);
  assert.deepEqual(checkReceipt(receipt, { rules: DEMO_REPLAY_RULES, log: won.submission.content }), []);
  assert.deepEqual(checkReceipt({ ...receipt, detail: "edited" }), ["HASH"]);
  assert.deepEqual(checkReceipt({ ...receipt, verdict: "FAIL" }), ["HASH", "VERDICT"]);
  assert.deepEqual(checkReceipt(receipt, { rules: DEMO_TESTS_RULES }), ["RULES"]);
  assert.deepEqual(checkReceipt(receipt, { log: `${won.submission.content} ` }), ["LOG"]);
  assert.deepEqual(checkReceipt({ ...receipt, format: "other" }), ["FORMAT"]);
});

/** A receipt rewritten by someone who knows how to hash it: every field consistent, the hash recomputed. */
const rewrite = (receipt, changes) => {
  const { hash: _drop, ...body } = { ...receipt, ...changes };
  return { ...body, hash: hashOf(body) };
};

test("a receipt's verdict is played again: a forged PASS with the right hashes does not check out", () => {
  const lost = receiptOf(kit.replay); // seat 0, FAIL, NOT_WON
  const against = { rules: DEMO_REPLAY_RULES, log: kit.replay.submission.content, game: race };
  assert.deepEqual(checkReceipt(lost, against), []);
  assert.deepEqual(checkReceipt(receiptOf(won), { ...against, log: won.submission.content }), []);

  // The loser's receipt turned into a win, result and all: whole, hashed, and false.
  const forged = rewrite(lost, { verdict: "PASS", reason: "WON", result: { winner: 0, total: 10 } });
  assert.deepEqual(checkReceipt(forged, { rules: DEMO_REPLAY_RULES, log: kit.replay.submission.content }), [], "hashes alone cannot tell");
  assert.deepEqual(checkReceipt(forged, against), ["VERDICT"]);
  // A WON that names another winner gives itself away even with nothing to check against.
  assert.deepEqual(checkReceipt(rewrite(lost, { verdict: "PASS", reason: "WON" })), ["VERDICT"]);
  // A cut-off log decides nothing: a PASS on it is false.
  const cut = canonicalJson(raceLog([3, 3, 1]));
  assert.ok(checkReceipt(rewrite(lost, { logHash: sha256Hex(cut), verdict: "FAIL", result: null }), { ...against, log: cut }).includes("VERDICT"));
});

test("a receipt names its match: a log of another match does not check out", () => {
  const receipt = receiptOf(won);
  const other = canonicalJson(demoLog("demo-race-2"));
  assert.deepEqual(checkReceipt(rewrite(receipt, { logHash: sha256Hex(other) }), { log: other }), ["MATCH"]);
  assert.deepEqual(checkReceipt(receipt, { log: "\uD800" }), ["LOG"], "text that is not well-formed has no hash");
});

test("the same match judged again gives the same receipt, byte for byte", () => {
  assert.deepEqual(receiptOf(structuredClone(won)), receiptOf(won));
});

test("the seal «verified» is for code verdicts only", () => {
  assert.equal(receiptOf(kit.replay).seal, "verified"); // FAIL, decided by code
  assert.equal(receiptOf(kit.tests).seal, "verified");
  assert.equal(receiptOf({ ...won, claim: { outcome: "loss" } }).seal, null); // BLOCKED
  const forged = receiptOf(kit.replay);
  const { hash: _drop, ...body } = { ...forged, verdict: "BLOCKED", reason: "FALSE_CLAIM" };
  assert.ok(checkReceipt({ ...body, hash: forged.hash }).includes("SEAL"));
});

test("a receipt's memo names the log and the receipt", () => {
  const receipt = receiptOf(won);
  assert.deepEqual(parseMemo(receiptMemo(receipt)), { matchId: receipt.matchId, logHash: receipt.logHash, receiptHash: receipt.hash });
  assert.throws(() => receiptMemo({ ...receipt, logHash: null }), TypeError);
});

test("classes: money from entries only with a verified class; a show plays for little or a sponsor", () => {
  assert.equal(classOf("replay"), "verified");
  assert.equal(classOf("tests"), "verified");
  assert.equal(classOf("model"), "show");
  assert.deepEqual(SHOW_MONEY, ["none", "sponsored", "small"]);
  assert.deepEqual(checkRules(DEMO_REPLAY_RULES), []);
  assert.deepEqual(checkRules(DEMO_TESTS_RULES), []);
  const show = {
    format: "debate",
    class: "show",
    decider: "model",
    money: "small",
    submission: { media: ["text/plain"], maxBytes: 100 },
    opensAt: 0,
    closesAt: 1,
    limits: {},
    model: { id: "m", passAt: 0.6, failAt: 0.4 },
  };
  assert.deepEqual(checkRules(show), []);
  assert.deepEqual(checkRules({ ...show, money: "stakes" }).map((i) => i.code), ["MONEY_NEEDS_VERIFIED"]);
  assert.deepEqual(checkRules({ ...show, model: { id: "m", passAt: 0.4, failAt: 0.6 } }).map((i) => i.code), ["BAD_RULES"]);
  assert.deepEqual(checkRules({ ...DEMO_TESTS_RULES, tests: { ...DEMO_TESTS_RULES.tests, minPassed: 4 } }).map((i) => i.code), ["BAD_RULES"]);
  assert.deepEqual(checkRules({ ...DEMO_REPLAY_RULES, game: undefined }).map((i) => i.code), ["BAD_RULES"]);
  assert.equal(RING_FORMATS["duo-crack"], "replay", "Duo Crack is decided by the phrase's hash, not a model");
  assert.equal(RING_FORMATS.code, "tests");
  assert.equal(RING_FORMATS["market-replay"], "replay");
});

test("a stamp binds a match, a seat and a hash to a time under a trusted key", () => {
  const hash = sha256Hex("work");
  const what = { matchId: "m-1", seat: 0, hash };
  const signed = stamp(what, AT);
  const verify = stampVerifier([signerOf(harness)]);
  assert.equal(verify(what, signed), true);
  assert.equal(verify({ ...what, hash: sha256Hex("other") }, signed), false);
  assert.equal(verify({ ...what, matchId: "m-2" }, signed), false, "another match");
  assert.equal(verify({ ...what, seat: 1 }, signed), false, "another seat");
  assert.equal(verify(what, { ...signed, at: AT - 1 }), false);
  assert.equal(verify(what, { ...signed, signature: "!!" }), false);
  assert.equal(verify(what, { ...signed, signer: "unknown" }), false);
  assert.equal(verify({ ...what, matchId: "m|1" }, signed), false);
  assert.equal(stampVerifier([])(what, signed), false);
  assert.equal(stampText(what, AT), `ryntra-ring-stamp/1|m-1|0|${hash}|${AT}`);
  assert.throws(() => stamp({ ...what, hash: "nothex" }, AT), TypeError);
  assert.throws(() => stamp({ ...what, matchId: "a|b" }, AT), TypeError);
});
