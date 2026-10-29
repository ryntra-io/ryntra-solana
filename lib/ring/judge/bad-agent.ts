/**
 * «Поганий агент» (CITY-68): a public set of cheats the judge must catch. Each takes an honest match and does one bad
 * thing — claims a win it did not get, swaps a hash, rewrites or makes up the log, skips a test, goes over a limit — and
 * names the exact reason the judge blocks it with. The tests run every one; Fight Night (CITY-60) can show them live.
 *
 * The honest matches (`demoKit`) are played on the demo game `race.ts`: a replay contest where seat 0 honestly lost,
 * and a code contest where the submission honestly passes all three hidden tests. Both play for stakes, so both are
 * verified.
 */

import { canonicalJson, hashOf, sha256Hex } from "./hash.ts";
import type { JudgeInput, ReasonCode, Submission } from "./judge.ts";
import { race } from "./race.ts";
import { LOG_FORMAT, recordLog, type MatchLog } from "./replay.ts";
import { rulesHash, type Rules } from "./rules.ts";
import type { Stamper } from "./stamp.ts";

export type Kit = {
  /** Replay contest, seat 0 lost the race and says so. */
  replay: JudgeInput;
  /** Code contest, the submission passes 3 of 3 hidden tests. */
  tests: JudgeInput;
  /** The trusted harness. */
  stamp: Stamper;
  /** A key nobody trusts. */
  forge: Stamper;
};

export type BadAgent = {
  id: string;
  /** What the agent does, in one line. */
  does: string;
  expect: ReasonCode;
  tamper(kit: Kit): JudgeInput;
};

const OPENS = Date.parse("2026-10-28T12:00:00Z");
const CLOSES = OPENS + 3_600_000;
const HANDED_IN = OPENS + 60_000;

export const DEMO_REPLAY_RULES: Rules = {
  format: "race-demo",
  class: "verified",
  decider: "replay",
  money: "stakes",
  game: { id: race.id, version: race.version, config: { target: 10, maxAdd: 3 } },
  submission: { media: [LOG_FORMAT], maxBytes: 16_384 },
  opensAt: OPENS,
  closesAt: CLOSES,
  limits: { steps: 40, costMicroUsd: 100_000, ms: 600_000 },
};

const SUITE = ["adds", "carries", "rounds"];

export const DEMO_TESTS_RULES: Rules = {
  format: "code",
  class: "verified",
  decider: "tests",
  money: "stakes",
  submission: { media: ["text/typescript"], maxBytes: 16_384 },
  opensAt: OPENS,
  closesAt: CLOSES,
  limits: { costMicroUsd: 100_000, ms: 600_000 },
  tests: { suiteHash: hashOf({ suite: "sum", ids: SUITE }), ids: SUITE, minPassed: 3 },
};

/** A race of these adds, seats taking turns from seat 0, under the demo rules' config. */
export function raceLog(adds: readonly number[], matchId = "demo-race-1"): MatchLog {
  return recordLog(race, matchId, DEMO_REPLAY_RULES.game!.config, adds.map((add, i) => ({ at: OPENS + 1_000 * (i + 1), input: { seat: i % 2, add } })));
}

/** The race both seats played: seat 1 brings the total to 10. */
export const demoLog = (matchId = "demo-race-1"): MatchLog => raceLog([3, 3, 1, 3], matchId);

/** A submission of these bytes by this match's seat, stamped by `stamp` at `at`. */
export function submit(media: string, content: string, stamp: Stamper, at: number, by: { matchId: string; seat: number }): Submission {
  const hash = sha256Hex(content);
  return { media, content, hash, size: Buffer.byteLength(content, "utf8"), stamp: stamp({ ...by, hash }, at) };
}

/** The same input for another seat: the harness stamps each seat's submission for that seat. */
export const asSeat = (kit: Kit, input: JudgeInput, seat: number): JudgeInput => ({
  ...input,
  seat,
  submission: submit(input.submission.media, input.submission.content, kit.stamp, input.submission.stamp.at, { matchId: input.matchId, seat }),
});

export function demoKit(stamp: Stamper, forge: Stamper): Kit {
  const log = canonicalJson(demoLog());
  const code = "export const sum = (a: number, b: number): number => a + b;\n";
  const codeSubmission = submit("text/typescript", code, stamp, HANDED_IN, { matchId: "demo-code-1", seat: 0 });
  return {
    stamp,
    forge,
    replay: {
      matchId: "demo-race-1",
      seat: 0,
      rules: DEMO_REPLAY_RULES,
      rulesHash: rulesHash(DEMO_REPLAY_RULES),
      submission: submit(LOG_FORMAT, log, stamp, HANDED_IN, { matchId: "demo-race-1", seat: 0 }),
      usage: { costMicroUsd: 20_000, ms: 30_000 },
      claim: { outcome: "loss" },
      harness: { logHash: sha256Hex(log) },
    },
    tests: {
      matchId: "demo-code-1",
      seat: 0,
      rules: DEMO_TESTS_RULES,
      rulesHash: rulesHash(DEMO_TESTS_RULES),
      submission: codeSubmission,
      usage: { costMicroUsd: 20_000, ms: 30_000 },
      tests: {
        suiteHash: DEMO_TESTS_RULES.tests!.suiteHash,
        subject: codeSubmission.hash,
        results: SUITE.map((id) => ({ id, status: "pass" as const })),
      },
      claim: { outcome: "win", passed: 3 },
    },
  };
}

/** The replay input with this log handed in by seat 0 and stamped by the harness; the harness's own log is unchanged. */
const handIn = (kit: Kit, log: MatchLog, claim: JudgeInput["claim"] = kit.replay.claim): JudgeInput => ({
  ...kit.replay,
  claim,
  submission: submit(LOG_FORMAT, canonicalJson(log), kit.stamp, HANDED_IN, { matchId: kit.replay.matchId, seat: 0 }),
});

const withLog = (kit: Kit, edit: (log: MatchLog) => void): JudgeInput => {
  const log = demoLog();
  edit(log);
  return handIn(kit, log);
};

export const BAD_AGENTS: readonly BadAgent[] = [
  {
    id: "claims-win",
    does: "lost the race and claims a win",
    expect: "FALSE_CLAIM",
    tamper: (kit) => ({ ...kit.replay, claim: { outcome: "win" } }),
  },
  {
    id: "claims-result",
    does: "claims a result with itself as the winner",
    expect: "FALSE_CLAIM",
    tamper: (kit) => ({ ...kit.replay, claim: { result: { winner: 0, total: 10 } } }),
  },
  {
    id: "rewrites-result",
    does: "rewrites the log's result to its own win and has it stamped",
    expect: "REPLAY_DIVERGES",
    tamper: (kit) => withLog(kit, (log) => void (log.result = { winner: 0, total: 10 })),
  },
  {
    id: "rewrites-move",
    does: "changes a past move in the log and has it stamped",
    expect: "REPLAY_DIVERGES",
    tamper: (kit) => withLog(kit, (log) => void ((log.entries[1]!.derived as { total: number }).total = 7)),
  },
  {
    id: "illegal-move",
    does: "plays twice in a row",
    expect: "REPLAY_DIVERGES",
    tamper: (kit) => withLog(kit, (log) => void ((log.entries[1]!.input as { seat: number }).seat = 0)),
  },
  {
    id: "names-other-log",
    does: "names another log's hash in its claim",
    expect: "HASH_MISMATCH",
    tamper: (kit) => ({ ...kit.replay, claim: { outcome: "loss", logHash: sha256Hex("another log") } }),
  },
  {
    id: "swaps-bytes",
    does: "swaps the log's bytes after the stamp, keeping the old hash",
    expect: "HASH_MISMATCH",
    tamper: (kit) => {
      const log = demoLog();
      log.result = { winner: 0, total: 10 };
      const content = canonicalJson(log);
      return { ...kit.replay, submission: { ...kit.replay.submission, content, size: Buffer.byteLength(content, "utf8") } };
    },
  },
  {
    id: "fabricated-log",
    does: "lost, then hands in a legal log it made up where it wins, and has it stamped",
    expect: "LOG_NOT_HARNESS",
    tamper: (kit) => handIn(kit, raceLog([3, 3, 1, 1, 2]), { outcome: "win" }),
  },
  {
    id: "truncated-log",
    does: "cuts the log off before the move that lost it, to stall the payout",
    expect: "LOG_NOT_HARNESS",
    tamper: (kit) => handIn(kit, raceLog([3, 3, 1])),
  },
  {
    id: "forged-stamp",
    does: "stamps its own submission with its own key",
    expect: "BAD_STAMP",
    tamper: (kit) => ({ ...kit.replay, submission: submit(LOG_FORMAT, kit.replay.submission.content, kit.forge, HANDED_IN, { matchId: kit.replay.matchId, seat: 0 }) }),
  },
  {
    id: "borrows-stamp",
    does: "hands in the same work with a stamp the harness gave it in another match",
    expect: "BAD_STAMP",
    tamper: (kit) => ({ ...kit.tests, submission: submit("text/typescript", kit.tests.submission.content, kit.stamp, HANDED_IN, { matchId: "demo-code-0", seat: 0 }) }),
  },
  {
    id: "late",
    does: "hands in after the contest closed",
    expect: "LATE",
    tamper: (kit) => ({ ...kit.replay, submission: submit(LOG_FORMAT, kit.replay.submission.content, kit.stamp, CLOSES + 1, { matchId: kit.replay.matchId, seat: 0 }) }),
  },
  {
    id: "early",
    does: "has its work stamped before the contest opened",
    expect: "EARLY",
    tamper: (kit) => ({ ...kit.replay, submission: submit(LOG_FORMAT, kit.replay.submission.content, kit.stamp, OPENS - 1, { matchId: kit.replay.matchId, seat: 0 }) }),
  },
  {
    id: "too-large",
    does: "hands in more bytes than the rules allow",
    expect: "TOO_LARGE",
    tamper: (kit) => ({ ...kit.replay, submission: submit(LOG_FORMAT, `${kit.replay.submission.content}${" ".repeat(16_384)}`, kit.stamp, HANDED_IN, { matchId: kit.replay.matchId, seat: 0 }) }),
  },
  {
    id: "over-budget",
    does: "spends more on its model than the limit",
    expect: "LIMIT_EXCEEDED",
    tamper: (kit) => ({ ...kit.replay, usage: { costMicroUsd: 100_001, ms: 30_000 } }),
  },
  {
    id: "over-time",
    does: "thinks longer than the limit",
    expect: "LIMIT_EXCEEDED",
    tamper: (kit) => ({ ...kit.replay, usage: { costMicroUsd: 20_000, ms: 600_001 } }),
  },
  {
    id: "too-many-steps",
    does: "plays more steps than the limit",
    expect: "LIMIT_EXCEEDED",
    tamper: (kit) => ({ ...kit.replay, usage: { costMicroUsd: 20_000, ms: 30_000, steps: 41 } }),
  },
  {
    id: "other-rules",
    does: "plays under rules with a looser limit",
    expect: "RULES_MISMATCH",
    tamper: (kit) => ({ ...kit.replay, rulesHash: rulesHash({ ...DEMO_REPLAY_RULES, limits: { ...DEMO_REPLAY_RULES.limits, costMicroUsd: 10_000_000 } }) }),
  },
  {
    id: "skips-test",
    does: "makes a hidden test vanish from the run",
    expect: "TEST_SKIPPED",
    tamper: (kit) => ({ ...kit.tests, tests: { ...kit.tests.tests!, results: kit.tests.tests!.results.slice(1) } }),
  },
  {
    id: "marks-skip",
    does: "marks a hidden test as skipped",
    expect: "TEST_SKIPPED",
    tamper: (kit) => ({
      ...kit.tests,
      tests: { ...kit.tests.tests!, results: kit.tests.tests!.results.map((r, i) => (i === 2 ? { ...r, status: "skip" as const } : r)) },
    }),
  },
  {
    id: "fake-test",
    does: "reports a passing test that is not in the suite",
    expect: "TESTS_TAMPERED",
    tamper: (kit) => ({ ...kit.tests, tests: { ...kit.tests.tests!, results: [...kit.tests.tests!.results, { id: "free-win", status: "pass" as const }] } }),
  },
  {
    id: "claims-passed",
    does: "fails a test and claims all three passed",
    expect: "FALSE_CLAIM",
    tamper: (kit) => ({
      ...kit.tests,
      tests: { ...kit.tests.tests!, results: kit.tests.tests!.results.map((r, i) => (i === 0 ? { ...r, status: "fail" as const } : r)) },
    }),
  },
  {
    id: "tests-other-code",
    does: "has the tests run on other code than it hands in",
    expect: "HASH_MISMATCH",
    tamper: (kit) => ({ ...kit.tests, tests: { ...kit.tests.tests!, subject: sha256Hex("other code") } }),
  },
];
