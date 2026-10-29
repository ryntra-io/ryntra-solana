// Run from repo root: node --test lib/ring/judge/judge.test.mjs
import "../../world/testing/hooks.mjs";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";

const { judge, JUDGE_VERSION, DETAIL_MAX } = await import("./judge.ts");
const { createStamper, signerOf, stampVerifier } = await import("./stamp.ts");
const { checkRules, rulesHash, MAX_SUBMISSION_BYTES } = await import("./rules.ts");
const { asSeat, demoKit, submit, raceLog, DEMO_REPLAY_RULES, DEMO_TESTS_RULES, demoLog } = await import("./bad-agent.ts");
const { canonicalJson, sha256Hex } = await import("./hash.ts");
const { race } = await import("./race.ts");
const { LOG_FORMAT, MoveRejected, recordLog } = await import("./replay.ts");

/**
 * The judge on honest and unclear matches: PASS / FAIL / NEEDS_REVIEW by fixed rules, fail-closed, and neither
 * «unclear» nor a final verdict turning into a win by trying again. The cheats are in `bad-agent.test.mjs`.
 */

const harness = generateKeyPairSync("ed25519").privateKey;
const stranger = generateKeyPairSync("ed25519").privateKey;
const stamp = createStamper(harness);
const forge = createStamper(stranger);
const context = { verifyStamp: stampVerifier([signerOf(harness)]), games: [race] };
const kit = () => demoKit(stamp, forge);
const won = () => ({ ...asSeat(kit(), kit().replay, 1), claim: { outcome: "win" } });

const OPENS = Date.parse("2026-10-28T12:00:00Z");
const HANDED_IN = OPENS + 60_000;
const RACE = { matchId: "demo-race-1", seat: 0 };

/** A replay input where the harness recorded — and the seat hands in — a log that ends with `adds` played. */
function replayOf(adds, seat = 0, claim = undefined) {
  const log = canonicalJson(raceLog(adds));
  return { ...kit().replay, seat, claim, submission: submit(LOG_FORMAT, log, stamp, HANDED_IN, { ...RACE, seat }), harness: { logHash: sha256Hex(log) } };
}

/** A replay input where the harness recorded `log` itself and seat 0 hands it in. */
function recorded(log, rules = DEMO_REPLAY_RULES) {
  const content = canonicalJson(log);
  return { ...kit().replay, rules, rulesHash: rulesHash(rules), submission: submit(LOG_FORMAT, content, stamp, HANDED_IN, RACE), harness: { logHash: sha256Hex(content) } };
}

const SHOW_RULES = {
  format: "debate",
  class: "show",
  decider: "model",
  money: "sponsored",
  submission: { media: ["text/plain"], maxBytes: 4_000 },
  opensAt: OPENS,
  closesAt: OPENS + 3_600_000,
  limits: { costMicroUsd: 50_000 },
  model: { id: "anthropic/claude-haiku-5.5", passAt: 0.7, failAt: 0.3 },
};

function showOf(score, model = SHOW_RULES.model.id) {
  const submission = submit("text/plain", "Solana settles in one slot.", stamp, HANDED_IN, { matchId: "show-1", seat: 0 });
  return {
    matchId: "show-1",
    seat: 0,
    rules: SHOW_RULES,
    rulesHash: rulesHash(SHOW_RULES),
    submission,
    usage: { costMicroUsd: 1_000, ms: 2_000 },
    model: { model, subject: submission.hash, score },
  };
}

test("the judge has a version", () => {
  assert.match(JUDGE_VERSION, /^ryntra-ring-judge\/\d+\.\d+\.\d+$/);
});

test("replay: the winner passes, the loser fails, both by code", () => {
  const lost = judge(kit().replay, context);
  assert.equal(lost.verdict, "FAIL");
  assert.equal(lost.reason, "NOT_WON");
  assert.equal(lost.level, "L2");
  assert.equal(lost.payable, false);
  assert.deepEqual(lost.result, { winner: 1, total: 10 });
  assert.equal(lost.logHash, sha256Hex(canonicalJson(demoLog())));

  const pass = judge(won(), context);
  assert.equal(pass.verdict, "PASS");
  assert.equal(pass.reason, "WON");
  assert.equal(pass.payable, true);
  assert.equal(pass.rerun, false);
});

test("replay: a claim is optional, and an honest one is welcome", () => {
  assert.equal(judge({ ...won(), claim: undefined }, context).verdict, "PASS");
  assert.equal(judge({ ...won(), claim: { result: { winner: 1, total: 10 } } }, context).verdict, "PASS");
});

test("replay: a log that stops before the end is unclear, never a win", () => {
  const verdict = judge(replayOf([3, 3, 1], 0, { outcome: "win" }), context);
  assert.equal(verdict.verdict, "NEEDS_REVIEW");
  assert.equal(verdict.reason, "UNDECIDED");
  assert.equal(verdict.payable, false);
  assert.equal(verdict.rerun, true);
});

test("replay: the harness's own log decides — a legal log the agent made up never wins, and only one seat passes", () => {
  // Seat 0 lost; it makes up a legal race it wins and has it stamped.
  const madeUp = canonicalJson(raceLog([3, 3, 1, 1, 2]));
  const cheat = judge({ ...kit().replay, claim: { outcome: "win" }, submission: submit(LOG_FORMAT, madeUp, stamp, HANDED_IN, RACE) }, context);
  assert.equal(cheat.verdict, "BLOCKED");
  assert.equal(cheat.reason, "LOG_NOT_HARNESS");
  assert.equal(cheat.payable, false);
  // The same log, had the harness recorded it, would be a clean win: the block is about whose log it is.
  assert.equal(judge({ ...kit().replay, claim: { outcome: "win" }, submission: submit(LOG_FORMAT, madeUp, stamp, HANDED_IN, RACE), harness: { logHash: sha256Hex(madeUp) } }, context).verdict, "PASS");
  // The real winner still passes on the harness's log.
  assert.equal(judge(won(), context).verdict, "PASS");
});

test("replay: without the harness's own log hash there is no verdict, only review", () => {
  for (const harnessOf of [undefined, {}, { logHash: "nothex" }]) {
    const verdict = judge({ ...won(), harness: harnessOf }, context);
    assert.equal(verdict.verdict, "NEEDS_REVIEW");
    assert.equal(verdict.reason, "NO_EVIDENCE");
    assert.equal(verdict.payable, false);
  }
});

test("replay: the game config is part of the rules — a log from another config is blocked", () => {
  // A config where one move wins: even recorded by the harness, it is not the game the rules name.
  const quick = recordLog(race, "demo-race-1", { target: 2, maxAdd: 3 }, [{ at: OPENS + 1_000, input: { seat: 0, add: 2 } }]);
  const verdict = judge({ ...recorded(quick), claim: { outcome: "win" } }, context);
  assert.equal(verdict.verdict, "BLOCKED");
  assert.equal(verdict.reason, "RULES_MISMATCH");
  assert.equal(verdict.payable, false);

  assert.notEqual(rulesHash(DEMO_REPLAY_RULES), rulesHash({ ...DEMO_REPLAY_RULES, game: { ...DEMO_REPLAY_RULES.game, config: { target: 2, maxAdd: 3 } } }));
  assert.deepEqual(checkRules({ ...DEMO_REPLAY_RULES, game: { id: race.id, version: race.version } }).map((i) => i.code), ["BAD_RULES"]);
});

test("a stamp is for one match and one seat: another seat's stamp is not this seat's", () => {
  const theirs = { ...kit().replay, seat: 1, claim: { outcome: "win" } }; // seat 0's stamp
  assert.equal(judge(theirs, context).reason, "BAD_STAMP");
});

test("tests: all hidden tests pass → PASS; fewer than needed → FAIL", () => {
  const pass = judge(kit().tests, context);
  assert.equal(pass.verdict, "PASS");
  assert.equal(pass.reason, "TESTS_PASSED");
  assert.equal(pass.passed, 3);

  const input = kit().tests;
  const failing = { ...input, claim: { outcome: "loss", passed: 2 }, tests: { ...input.tests, results: input.tests.results.map((r, i) => (i === 1 ? { ...r, status: "fail" } : r)) } };
  const fail = judge(failing, context);
  assert.equal(fail.verdict, "FAIL");
  assert.equal(fail.reason, "TESTS_FAILED");
  assert.equal(fail.passed, 2);
});

test("tests: a broken runner is unclear", () => {
  const input = kit().tests;
  const verdict = judge({ ...input, tests: { ...input.tests, results: input.tests.results.map((r, i) => (i === 0 ? { ...r, status: "infra" } : r)) } }, context);
  assert.equal(verdict.verdict, "NEEDS_REVIEW");
  assert.equal(verdict.reason, "INFRA");
  assert.equal(verdict.rerun, true);
});

test("L3 in a verified contest is support only: it never moves the verdict", () => {
  const input = kit().tests;
  const doubted = judge({ ...input, model: { model: "any/model", subject: input.submission.hash, score: 0 } }, context);
  assert.equal(doubted.verdict, "PASS");
  assert.deepEqual(doubted.support, { model: "any/model", subject: input.submission.hash, score: 0 });

  const lost = judge({ ...kit().replay, model: { model: "any/model", subject: kit().replay.submission.hash, score: 1 } }, context);
  assert.equal(lost.verdict, "FAIL");
  assert.equal(lost.support.score, 1);

  const elsewhere = judge({ ...input, model: { model: "any/model", subject: sha256Hex("x"), score: 1 } }, context);
  assert.equal(elsewhere.support, undefined);
});

test("show: the judge model decides within its thresholds; between is unclear", () => {
  assert.equal(judge(showOf(0.9), context).reason, "MODEL_PASS");
  assert.equal(judge(showOf(0.7), context).verdict, "PASS");
  assert.equal(judge(showOf(0.3), context).reason, "MODEL_FAIL");
  const unclear = judge(showOf(0.5), context);
  assert.equal(unclear.verdict, "NEEDS_REVIEW");
  assert.equal(unclear.reason, "UNCLEAR");
  assert.equal(unclear.level, "L3");
});

test("show: another judge model than the rules name is blocked; no score is no verdict", () => {
  assert.equal(judge(showOf(0.9, "other/model"), context).reason, "RULES_MISMATCH");
  const { model: _drop, ...noScore } = showOf(0.9);
  const verdict = judge(noScore, context);
  assert.equal(verdict.verdict, "NEEDS_REVIEW");
  assert.equal(verdict.reason, "NO_EVIDENCE");
});

test("unclear twice goes to a person; a retry never turns unclear into a win", () => {
  const first = judge(replayOf([3, 3, 1]), context);
  assert.equal(first.reason, "UNDECIDED");
  assert.equal(first.rerun, true);

  const second = judge({ ...replayOf([3, 3, 1]), prior: [first] }, context);
  assert.equal(second.verdict, "NEEDS_REVIEW");
  assert.equal(second.reason, "AMBIGUOUS_TWICE");
  assert.equal(second.rerun, false);
  assert.equal(second.payable, false);

  // The retry comes back a win: it still waits for a person.
  const lucky = judge({ ...won(), prior: [first] }, context);
  assert.equal(lucky.verdict, "NEEDS_REVIEW");
  assert.equal(lucky.reason, "PASS_AFTER_UNCLEAR");
  assert.equal(lucky.payable, false);

  // Once with a person, every later run stays there.
  const later = judge({ ...won(), claim: undefined, prior: [first, second] }, context);
  assert.equal(later.reason, "IN_REVIEW");
  const show = judge({ ...showOf(0.5), prior: [judge(showOf(0.5), context)] }, context);
  assert.equal(show.reason, "AMBIGUOUS_TWICE");
});

test("a final verdict is not retried into a win: a PASS after a FAIL, BLOCKED or PASS waits for a person", () => {
  const input = kit().tests;
  const failing = { ...input, claim: undefined, tests: { ...input.tests, results: input.tests.results.map((r, i) => (i === 0 ? { ...r, status: "fail" } : r)) } };
  const failed = judge(failing, context);
  assert.equal(failed.verdict, "FAIL");
  const blocked = judge({ ...input, tests: { ...input.tests, subject: sha256Hex("other code") } }, context);
  assert.equal(blocked.verdict, "BLOCKED");
  const passed = judge(input, context);
  assert.equal(passed.verdict, "PASS");

  for (const prior of [[failed], [blocked], [passed]]) {
    const again = judge({ ...input, prior }, context);
    assert.equal(again.verdict, "NEEDS_REVIEW", prior[0].verdict);
    assert.equal(again.reason, "PASS_AFTER_VERDICT");
    assert.equal(again.level, "history");
    assert.equal(again.payable, false);
  }
  const review = judge({ ...input, prior: [failed] }, context);
  assert.equal(judge({ ...input, prior: [failed, review] }, context).reason, "IN_REVIEW");
  // A FAIL after a FAIL stays a FAIL; a prior that is not a verdict counts for nothing.
  assert.equal(judge({ ...failing, prior: [failed] }, context).verdict, "FAIL");
  assert.equal(judge({ ...input, prior: [{ verdict: "MAYBE", reason: "WON" }] }, context).verdict, "PASS");
});

test("a retry that settles as a loss stays a loss", () => {
  const first = judge(replayOf([3, 3, 1]), context);
  const settled = judge({ ...kit().replay, prior: [first] }, context);
  assert.equal(settled.verdict, "FAIL");
  assert.equal(settled.reason, "NOT_WON");
});

test("fail-closed: broken rules, missing evidence, an unknown game or a throwing game are never a verdict on the agent", () => {
  const badRules = { ...DEMO_REPLAY_RULES, submission: { media: [], maxBytes: 0 } };
  const rulesBroken = judge({ ...kit().replay, rules: badRules, rulesHash: rulesHash(badRules) }, context);
  assert.equal(rulesBroken.verdict, "NEEDS_REVIEW");
  assert.equal(rulesBroken.reason, "BAD_RULES");

  assert.equal(judge(kit().replay, { ...context, games: [] }).reason, "NO_GAME");
  const { tests: _drop, ...noTests } = kit().tests;
  assert.equal(judge(noTests, context).reason, "NO_EVIDENCE");
  assert.equal(judge({ ...kit().replay, usage: undefined }, context).reason, "NO_EVIDENCE");

  const throwing = { ...race, step() { throw new Error("engine bug"); } };
  const crashed = judge(kit().replay, { ...context, games: [throwing] });
  assert.equal(crashed.verdict, "NEEDS_REVIEW");
  assert.equal(crashed.reason, "JUDGE_ERROR");
  assert.equal(crashed.payable, false);

  const stampThrows = judge(kit().replay, { ...context, verifyStamp: () => { throw new Error("no keys"); } });
  assert.equal(stampThrows.reason, "JUDGE_ERROR");

  assert.equal(judge(null, context).reason, "BAD_INPUT");
  assert.equal(judge({}, context).reason, "BAD_INPUT");
  assert.equal(judge({ ...kit().replay, matchId: "has|pipe" }, context).reason, "BAD_INPUT");
});

test("a format on money must be verified: a show for stakes is blocked before anything else", () => {
  const stakesShow = { ...SHOW_RULES, money: "stakes" };
  assert.deepEqual(checkRules(stakesShow).map((i) => i.code), ["MONEY_NEEDS_VERIFIED"]);
  const verdict = judge({ ...showOf(0.99), rules: stakesShow, rulesHash: rulesHash(stakesShow) }, context);
  assert.equal(verdict.verdict, "BLOCKED");
  assert.equal(verdict.reason, "MONEY_NEEDS_VERIFIED");
  assert.equal(verdict.level, "rules");

  const mislabelled = { ...SHOW_RULES, class: "verified" };
  assert.equal(judge({ ...showOf(0.99), rules: mislabelled, rulesHash: rulesHash(mislabelled) }, context).reason, "CLASS_DECIDER");
});

test("rules: a submission has a ceiling whatever the rules say, and a contest opens before it closes", () => {
  const huge = { ...DEMO_REPLAY_RULES, submission: { media: [LOG_FORMAT], maxBytes: MAX_SUBMISSION_BYTES + 1 } };
  assert.deepEqual(checkRules(huge).map((i) => i.code), ["BAD_RULES"]);
  assert.deepEqual(checkRules({ ...huge, submission: { media: [LOG_FORMAT], maxBytes: MAX_SUBMISSION_BYTES } }), []);
  assert.deepEqual(checkRules({ ...DEMO_REPLAY_RULES, opensAt: DEMO_REPLAY_RULES.closesAt + 1 }).map((i) => i.code), ["BAD_RULES"]);
  assert.deepEqual(checkRules({ ...DEMO_REPLAY_RULES, opensAt: undefined }).map((i) => i.code), ["BAD_RULES"]);
});

test("the judge is deterministic: the same input gives the same judgement", () => {
  const a = judge(kit().replay, context);
  const b = judge(structuredClone(kit().replay), context);
  assert.deepEqual(a, b);
  assert.deepEqual(judge(kit().tests, context), judge(kit().tests, context));
});

test("a log in non-canonical JSON is not accepted: one log, one hash", () => {
  const pretty = JSON.stringify(demoLog(), null, 2);
  const verdict = judge({ ...kit().replay, submission: submit(LOG_FORMAT, pretty, stamp, HANDED_IN, RACE) }, context);
  assert.equal(verdict.reason, "BAD_FORMAT");
});

test("text that is not well-formed is refused before it is hashed", () => {
  const input = kit().tests;
  const content = `${input.submission.content}\uD800`;
  const submission = { ...input.submission, content, size: Buffer.byteLength(content, "utf8") };
  const verdict = judge({ ...input, submission }, context);
  assert.equal(verdict.verdict, "BLOCKED");
  assert.equal(verdict.reason, "BAD_FORMAT");
  assert.equal(verdict.logHash, null);
  // A lone surrogate written as an escape inside a log has no canonical form either.
  const escaped = canonicalJson(demoLog()).replace('"demo-race-1"', '"demo-race-1","x":"\\ud800"');
  assert.equal(judge({ ...kit().replay, submission: submit(LOG_FORMAT, escaped, stamp, HANDED_IN, RACE) }, context).reason, "BAD_FORMAT");
});

test("a log of another match is blocked", () => {
  const other = canonicalJson(demoLog("demo-race-2"));
  const verdict = judge({ ...kit().replay, submission: submit(LOG_FORMAT, other, stamp, HANDED_IN, RACE) }, context);
  assert.equal(verdict.reason, "WRONG_MATCH");
});

test("a replay demands the log's media type", () => {
  const rules = { ...DEMO_REPLAY_RULES, submission: { media: [LOG_FORMAT, "text/plain"], maxBytes: 16_384 } };
  const input = kit().replay;
  const verdict = judge({ ...input, rules, rulesHash: rulesHash(rules), submission: submit("text/plain", input.submission.content, stamp, HANDED_IN, RACE) }, context);
  assert.equal(verdict.reason, "BAD_FORMAT");
  assert.equal(DEMO_TESTS_RULES.decider, "tests");
});

test("the step limit is checked before the replay: a long log is not played through", () => {
  let steps = 0;
  const counting = { ...race, step(state, input, at) { steps += 1; return race.step(state, input, at); } };
  const log = demoLog();
  log.entries = Array.from({ length: DEMO_REPLAY_RULES.limits.steps + 1 }, (_, seq) => ({ ...log.entries[0], seq }));
  const verdict = judge(recorded(log), { ...context, games: [counting] });
  assert.equal(verdict.verdict, "BLOCKED");
  assert.equal(verdict.reason, "LIMIT_EXCEEDED");
  assert.equal(steps, 0);
});

test("what the agent wrote reaches a receipt's detail at most 64 characters long", () => {
  const input = kit().replay;
  const verdict = judge({ ...input, claim: { outcome: "x".repeat(10_000) } }, context);
  assert.equal(verdict.reason, "FALSE_CLAIM");
  assert.ok(verdict.detail.length < 120, verdict.detail);
});

test("every detail is capped: a divergence path, a game's message or an error the agent provoked", () => {
  const key = "k".repeat(10_000);
  const longPath = demoLog();
  longPath.entries[0].derived = { ...longPath.entries[0].derived, [key]: 1 };
  const diverges = judge({ ...kit().replay, submission: submit(LOG_FORMAT, canonicalJson(longPath), stamp, HANDED_IN, RACE) }, context);
  assert.equal(diverges.reason, "REPLAY_DIVERGES");
  assert.ok(diverges.detail.length <= DETAIL_MAX, `${diverges.detail.length}`);

  const chatty = { ...race, step(state, input) { throw new MoveRejected(`refused ${JSON.stringify(input)}${"!".repeat(10_000)}`); } };
  const refused = judge(kit().replay, { ...context, games: [chatty] });
  assert.equal(refused.reason, "REPLAY_DIVERGES");
  assert.ok(refused.detail.length <= DETAIL_MAX, `${refused.detail.length}`);

  const loud = { ...race, step() { throw new Error(`😀${"?".repeat(10_000)}`); } };
  const crashed = judge(kit().replay, { ...context, games: [loud] });
  assert.equal(crashed.reason, "JUDGE_ERROR");
  assert.ok(crashed.detail.length <= DETAIL_MAX, `${crashed.detail.length}`);
  const cut = judge(kit().replay, { ...context, games: [{ ...race, step() { throw new Error(`${"?".repeat(DETAIL_MAX - 1)}😀`); } }] });
  assert.doesNotThrow(() => canonicalJson(cut.detail), "never half a surrogate pair");
});
