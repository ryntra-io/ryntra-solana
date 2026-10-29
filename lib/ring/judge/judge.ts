/**
 * The Ring's judge (CITY-68, decision 74): one verdict on one agent's submission and claim, by fixed rules, in a fixed
 * order, the same on every machine. Three levels of evidence:
 *
 *   L1 — the submission itself: its media type, its size, its hash, the harness's signed time stamp; the rules' hash;
 *        the limits the harness measured (steps, model cost, time).
 *   L2 — deterministic: a replay of the match log (`replay.ts`) or hidden tests run in a sandbox.
 *   L3 — a judge model's score. In a verified contest it is only recorded beside the verdict and never moves it; in a
 *        show it decides, and a show never plays for entries (`rules.ts`).
 *
 * Verdicts:
 *
 *   BLOCKED      — the agent or the format broke a rule: a false claim, a swapped hash, a skipped test, a limit gone
 *                  over, rules a show may not have. Exact reason code; never paid.
 *   FAIL         — clean evidence, and it does not win.
 *   NEEDS_REVIEW — the judge cannot tell: evidence missing or unclear, the judge's own input broken. Never paid.
 *   PASS         — clean evidence, and it wins. The only payable verdict.
 *
 * Unclear never turns into a win by trying again: the first unclear result may be run again (`rerun`); a second one
 * goes to a person (`AMBIGUOUS_TWICE`), and a PASS that comes after an unclear one waits for a person too
 * (`PASS_AFTER_UNCLEAR`). Nor does a final verdict: a PASS after a PASS, FAIL or BLOCKED of the same match and seat
 * waits for a person (`PASS_AFTER_VERDICT`). Anything unexpected — a throw anywhere, a bug in a game — is
 * NEEDS_REVIEW: fail-closed.
 *
 * A replay judges the harness's log, not the agent's: the agent hands the log in, and it must be byte for byte the log
 * the harness recorded itself (`harness.logHash`) — a legal log the agent made up is `LOG_NOT_HARNESS`.
 *
 * Pure: no store, no clock, no network; the stamp check and the games come in through `JudgeContext`.
 */

import { canonicalJson, isHex32, isRecord, isWellFormed, sha256Hex, toWellFormed } from "./hash.ts";
import { MATCH_ID } from "./memo.ts";
import { verifyLog, LOG_FORMAT, type Divergence, type GameResult, type ReplayGame } from "./replay.ts";
import { checkRules, isScore, rulesHash, type Rules } from "./rules.ts";
import type { Stamp, StampVerifier } from "./stamp.ts";

/** The judge's own version; every receipt carries it. A change to any rule below is a new version. */
export const JUDGE_VERSION = "ryntra-ring-judge/1.0.0";

export const VERDICTS = ["PASS", "FAIL", "NEEDS_REVIEW", "BLOCKED"] as const;
export type Verdict = (typeof VERDICTS)[number];

export type ReasonCode =
  // PASS
  | "WON"
  | "TESTS_PASSED"
  | "MODEL_PASS"
  // FAIL
  | "NOT_WON"
  | "TESTS_FAILED"
  | "MODEL_FAIL"
  // BLOCKED
  | "CLASS_DECIDER"
  | "MONEY_NEEDS_VERIFIED"
  | "RULES_MISMATCH"
  | "WRONG_MATCH"
  | "BAD_FORMAT"
  | "TOO_LARGE"
  | "HASH_MISMATCH"
  | "BAD_STAMP"
  | "EARLY"
  | "LATE"
  | "LIMIT_EXCEEDED"
  | "REPLAY_DIVERGES"
  | "LOG_NOT_HARNESS"
  | "TEST_SKIPPED"
  | "TESTS_TAMPERED"
  | "FALSE_CLAIM"
  // NEEDS_REVIEW
  | "UNDECIDED"
  | "INFRA"
  | "UNCLEAR"
  | "AMBIGUOUS_TWICE"
  | "PASS_AFTER_UNCLEAR"
  | "PASS_AFTER_VERDICT"
  | "IN_REVIEW"
  | "NO_EVIDENCE"
  | "NO_GAME"
  | "BAD_RULES"
  | "BAD_INPUT"
  | "JUDGE_ERROR";

/** Where the verdict was decided. */
export type Level = "rules" | "L1" | "L2" | "L3" | "history" | "judge";

/** The unclear reasons: a first one may be run again, a second goes to a person. */
export const UNCLEAR_REASONS: readonly ReasonCode[] = ["UNDECIDED", "INFRA", "UNCLEAR"];

/** The reasons that put a match with a person: every later run stays there. */
const WITH_A_PERSON: readonly ReasonCode[] = ["AMBIGUOUS_TWICE", "PASS_AFTER_UNCLEAR", "PASS_AFTER_VERDICT", "IN_REVIEW"];

/** The longest `detail` a judgement carries — whatever the agent, a game or an error wrote into it. */
export const DETAIL_MAX = 120;

/** What the agent hands in. For a replay it is the match log as canonical JSON, media type `ryntra-ring-log/1`. */
export type Submission = { media: string; content: string; hash: string; size: number; stamp: Stamp };

/** What the harness measured — never what the agent says about itself. */
export type Usage = { costMicroUsd: number; ms: number; steps?: number };

export type TestStatus = "pass" | "fail" | "skip" | "infra";

/** The sandbox's report: which suite ran, on which submission, and each test's status. `infra` — the runner broke. */
export type TestRun = { suiteHash: string; subject: string; results: { id: string; status: TestStatus }[] };

/** A judge model's score of a submission, 0 … 1. */
export type ModelScore = { model: string; subject: string; score: number };

/** What the agent says. Untrusted: every field present is checked against what the judge derives. */
export type Claim = {
  outcome?: "win" | "loss" | "draw";
  result?: unknown;
  passed?: number;
  logHash?: string;
  rulesHash?: string;
};

/** An earlier verdict on the same match and seat. */
export type PriorVerdict = { verdict: Verdict; reason: ReasonCode };

export type JudgeInput = {
  matchId: string;
  /** Whose submission and claim. */
  seat: number;
  rules: Rules;
  /** The hash the match was opened under. */
  rulesHash: string;
  submission: Submission;
  usage: Usage;
  tests?: TestRun;
  model?: ModelScore;
  claim?: Claim;
  prior?: readonly PriorVerdict[];
  /**
   * What the harness recorded itself — never what the agent hands in. A replay needs `logHash`: SHA-256 of the log the
   * harness wrote as the match was played, the same for every seat.
   */
  harness?: { logHash?: string };
};

export type JudgeContext = {
  verifyStamp: StampVerifier;
  /** The games a replay may use, matched by `rules.game` id and version. */
  games?: readonly ReplayGame<unknown>[];
};

export type Judgement = {
  verdict: Verdict;
  reason: ReasonCode;
  level: Level;
  detail: string;
  /** PASS only. */
  payable: boolean;
  /** A first unclear result: running the same match again may still settle it. */
  rerun: boolean;
  /** SHA-256 of the submission's bytes — for a replay, the log's hash; `null` when it could not be read. */
  logHash: string | null;
  /** The first divergence of a replay that failed. */
  divergence?: Divergence;
  /** The derived result of a replay. */
  result?: GameResult | null;
  /** Hidden tests passed. */
  passed?: number;
  /** A model's score recorded beside a verdict decided by code. */
  support?: ModelScore;
};

type Draft = Omit<Judgement, "payable" | "rerun" | "logHash">;

/** The verdict on one submission. Never throws. */
export function judge(input: JudgeInput, context: JudgeContext): Judgement {
  let logHash: string | null = null;
  try {
    const draft = decide(input, context, (hash) => (logHash = hash));
    return finish(withHistory(draft, isRecord(input) ? input.prior : undefined), logHash);
  } catch (error) {
    return finish({ verdict: "NEEDS_REVIEW", reason: "JUDGE_ERROR", level: "judge", detail: error instanceof Error ? error.message : "unknown" }, logHash);
  }
}

function decide(input: JudgeInput, context: JudgeContext, setHash: (hash: string) => void): Draft {
  if (!isRecord(input) || typeof input.matchId !== "string" || !MATCH_ID.test(input.matchId) || !Number.isSafeInteger(input.seat) || input.seat < 0) {
    return review("BAD_INPUT", "judge", "input needs matchId, seat, rules, submission and usage");
  }

  // Rules: a format on money must be verified.
  const issues = checkRules(input.rules);
  const shape = issues.find((issue) => issue.code === "BAD_RULES");
  if (shape) return review("BAD_RULES", "rules", shape.detail);
  const rule = issues[0];
  if (rule) return blocked(rule.code === "CLASS_DECIDER" ? "CLASS_DECIDER" : "MONEY_NEEDS_VERIFIED", "rules", rule.detail);
  const rules = input.rules;
  const expectedRules = rulesHash(rules);
  if (input.rulesHash !== expectedRules) return blocked("RULES_MISMATCH", "rules", "the match was opened under other rules");
  const claim = isRecord(input.claim) ? input.claim : {};
  if (claim.rulesHash !== undefined && claim.rulesHash !== expectedRules) return blocked("RULES_MISMATCH", "rules", "the claim names other rules");

  // L1: the submission's media, size, hash and time stamp.
  const submission = input.submission;
  if (
    !isRecord(submission) ||
    typeof submission.media !== "string" ||
    typeof submission.content !== "string" ||
    typeof submission.hash !== "string" ||
    !Number.isSafeInteger(submission.size) ||
    !isRecord(submission.stamp)
  ) {
    return blocked("BAD_FORMAT", "L1", "submission needs { media, content, hash, size, stamp }");
  }
  if (!rules.submission.media.includes(submission.media)) return blocked("BAD_FORMAT", "L1", `media ${short(submission.media)} is not allowed`);
  if (rules.decider === "replay" && submission.media !== LOG_FORMAT) return blocked("BAD_FORMAT", "L1", `a replay takes ${LOG_FORMAT}`);
  const bytes = Buffer.byteLength(submission.content, "utf8");
  if (bytes > rules.submission.maxBytes) return blocked("TOO_LARGE", "L1", `${bytes} bytes, at most ${rules.submission.maxBytes}`);
  if (submission.size !== bytes) return blocked("BAD_FORMAT", "L1", `declared ${submission.size} bytes, has ${bytes}`);
  if (!isWellFormed(submission.content)) return blocked("BAD_FORMAT", "L1", "the submission is not well-formed text: a lone surrogate");
  const hash = sha256Hex(submission.content);
  setHash(hash);
  if (submission.hash !== hash) return blocked("HASH_MISMATCH", "L1", "the submission's hash is not its bytes' hash");
  if (claim.logHash !== undefined && claim.logHash !== hash) return blocked("HASH_MISMATCH", "L1", "the claim names another log");
  if (!context.verifyStamp({ matchId: input.matchId, seat: input.seat, hash }, submission.stamp)) {
    return blocked("BAD_STAMP", "L1", "the time stamp is not signed by a trusted harness for this match, seat and hash");
  }
  if (submission.stamp.at < rules.opensAt) return blocked("EARLY", "L1", `stamped ${submission.stamp.at}, opened ${rules.opensAt}`);
  if (submission.stamp.at > rules.closesAt) return blocked("LATE", "L1", `stamped ${submission.stamp.at}, closed ${rules.closesAt}`);

  // L1: the limits, as the harness measured them.
  const usage = input.usage;
  if (!isRecord(usage) || !isCount(usage.costMicroUsd) || !isCount(usage.ms) || (usage.steps !== undefined && !isCount(usage.steps))) {
    return review("NO_EVIDENCE", "L1", "the harness's usage is missing");
  }
  const over = overLimit(rules, usage.costMicroUsd, usage.ms, usage.steps);
  if (over) return blocked("LIMIT_EXCEEDED", "L1", over);

  // L2 or L3, by who decides.
  const support = rules.decider === "model" ? undefined : supportOf(input.model, hash);
  const draft =
    rules.decider === "replay"
      ? byReplay(input, rules, submission.content, hash, claim, context)
      : rules.decider === "tests"
        ? byTests(input.tests, rules, hash, claim)
        : byModel(input.model, rules, hash);
  return support ? { ...draft, support } : draft;
}

function byReplay(input: JudgeInput, rules: Rules, content: string, hash: string, claim: Claim, context: JudgeContext): Draft {
  const spec = rules.game!;
  const game = context.games?.find((g) => g.id === spec.id && g.version === spec.version);
  if (!game) return review("NO_GAME", "L2", `no engine for ${spec.id}@${spec.version}`);
  const recorded = isRecord(input.harness) ? input.harness.logHash : undefined;
  if (!isHex32(recorded)) return review("NO_EVIDENCE", "L2", "the harness's own log hash is missing");
  let log: unknown;
  let canonical: string;
  try {
    log = JSON.parse(content);
    canonical = canonicalJson(log);
  } catch {
    return blocked("BAD_FORMAT", "L1", "the log is not JSON that has one canonical form");
  }
  if (canonical !== content) return blocked("BAD_FORMAT", "L1", "the log is not in canonical JSON");
  if (isRecord(log) && log.matchId !== input.matchId) return blocked("WRONG_MATCH", "L1", "the log belongs to another match");
  if (isRecord(log) && canonicalJson(log.config ?? null) !== canonicalJson(spec.config)) {
    return blocked("RULES_MISMATCH", "L1", "the log starts from another game config than the rules");
  }
  // The step limit before the replay: a long log is not played through first.
  if (isRecord(log) && Array.isArray(log.entries)) {
    const over = overLimit(rules, 0, 0, log.entries.length);
    if (over) return blocked("LIMIT_EXCEEDED", "L1", over);
  }

  const verification = verifyLog(game, log);
  if (!verification.ok) {
    const { divergence } = verification;
    return { ...blocked("REPLAY_DIVERGES", "L2", divergence.message), divergence };
  }
  // A legal log is not enough: it must be the one the harness recorded. A made-up win or a cut-off log stops here.
  if (hash !== recorded) return blocked("LOG_NOT_HARNESS", "L2", "the log is not the one the harness recorded");

  const { result } = verification;
  if (!result) return { ...review("UNDECIDED", "L2", "the log stops before the match is decided"), result };
  if (claim.result !== undefined && canonicalJson(claim.result) !== canonicalJson(result)) {
    return { ...blocked("FALSE_CLAIM", "L2", "the claimed result is not the replayed one"), result };
  }
  const outcome = result.winner === input.seat ? "win" : result.winner === null ? "draw" : "loss";
  if (claim.outcome !== undefined && claim.outcome !== outcome) {
    return { ...blocked("FALSE_CLAIM", "L2", `claims ${short(claim.outcome)}, the replay says ${outcome}`), result };
  }
  return outcome === "win"
    ? { verdict: "PASS", reason: "WON", level: "L2", detail: `seat ${input.seat} wins on replay`, result }
    : { verdict: "FAIL", reason: "NOT_WON", level: "L2", detail: `the replay says ${outcome}`, result };
}

/**
 * Hidden tests decide whether a submission qualifies, not who wins: PASS means «passed at least `minPassed`», and
 * several seats may PASS. How a prize is split among them belongs to the pools module, not the judge.
 */
function byTests(run: TestRun | undefined, rules: Rules, hash: string, claim: Claim): Draft {
  const suite = rules.tests!;
  if (run === undefined) return review("NO_EVIDENCE", "L2", "no test run");
  if (!isRecord(run) || !isHex32(run.suiteHash) || !isHex32(run.subject) || !Array.isArray(run.results)) {
    return review("NO_EVIDENCE", "L2", "the test run is malformed");
  }
  if (run.suiteHash !== suite.suiteHash) return blocked("RULES_MISMATCH", "L2", "another test suite ran");
  if (run.subject !== hash) return blocked("HASH_MISMATCH", "L2", "the tests ran on other bytes");

  const status = new Map<string, TestStatus>();
  for (const result of run.results) {
    if (!isRecord(result) || typeof result.id !== "string" || !["pass", "fail", "skip", "infra"].includes(result.status as string)) {
      return blocked("TESTS_TAMPERED", "L2", "a test result is malformed");
    }
    if (!suite.ids.includes(result.id)) return blocked("TESTS_TAMPERED", "L2", `test ${short(result.id)} is not in the suite`);
    if (status.has(result.id)) return blocked("TESTS_TAMPERED", "L2", `test ${result.id} is reported twice`);
    status.set(result.id, result.status);
  }
  const skipped = suite.ids.find((id) => status.get(id) === undefined || status.get(id) === "skip");
  if (skipped) return blocked("TEST_SKIPPED", "L2", `test ${skipped} did not run`);
  const broken = suite.ids.find((id) => status.get(id) === "infra");
  if (broken) return review("INFRA", "L2", `the runner broke on test ${broken}`);

  const passed = suite.ids.filter((id) => status.get(id) === "pass").length;
  if (claim.passed !== undefined && claim.passed !== passed) return { ...blocked("FALSE_CLAIM", "L2", `claims ${short(claim.passed)} passed, ran ${passed}`), passed };
  if (passed >= suite.minPassed) return { verdict: "PASS", reason: "TESTS_PASSED", level: "L2", detail: `${passed} of ${suite.ids.length} passed`, passed };
  if (claim.outcome === "win") return { ...blocked("FALSE_CLAIM", "L2", `claims a win with ${passed} of ${suite.minPassed} needed`), passed };
  return { verdict: "FAIL", reason: "TESTS_FAILED", level: "L2", detail: `${passed} of ${suite.minPassed} needed`, passed };
}

function byModel(score: ModelScore | undefined, rules: Rules, hash: string): Draft {
  const model = rules.model!;
  if (score === undefined) return review("NO_EVIDENCE", "L3", "no judge model's score");
  if (!isRecord(score) || typeof score.model !== "string" || !isScore(score.score)) return review("NO_EVIDENCE", "L3", "the score is malformed");
  if (score.model !== model.id) return blocked("RULES_MISMATCH", "L3", `scored by ${short(score.model)}, the rules name ${model.id}`);
  if (score.subject !== hash) return blocked("HASH_MISMATCH", "L3", "the model scored other bytes");
  if (score.score >= model.passAt) return { verdict: "PASS", reason: "MODEL_PASS", level: "L3", detail: `score ${score.score} ≥ ${model.passAt}` };
  if (score.score <= model.failAt) return { verdict: "FAIL", reason: "MODEL_FAIL", level: "L3", detail: `score ${score.score} ≤ ${model.failAt}` };
  return review("UNCLEAR", "L3", `score ${score.score} between ${model.failAt} and ${model.passAt}`);
}

/** A model's score beside a code verdict: kept only if it is well formed and about these bytes. */
function supportOf(score: ModelScore | undefined, hash: string): ModelScore | undefined {
  if (!isRecord(score) || typeof score.model !== "string" || score.subject !== hash || !isScore(score.score)) return undefined;
  return { model: score.model, subject: score.subject, score: score.score };
}

/** Neither an unclear result nor a final verdict becomes a win by trying again. */
function withHistory(draft: Draft, prior: readonly PriorVerdict[] | undefined): Draft {
  const history = Array.isArray(prior) ? prior.filter((p): p is PriorVerdict => isRecord(p) && (VERDICTS as readonly unknown[]).includes(p.verdict)) : [];
  if (draft.verdict === "BLOCKED" || draft.verdict === "FAIL") return draft;
  if (history.some((p) => WITH_A_PERSON.includes(p.reason))) {
    return { ...draft, verdict: "NEEDS_REVIEW", reason: "IN_REVIEW", level: "history", detail: `with a person already; this run: ${draft.reason}` };
  }
  const final = history.find((p) => p.verdict !== "NEEDS_REVIEW");
  if (final && draft.verdict === "PASS") {
    return { ...draft, verdict: "NEEDS_REVIEW", reason: "PASS_AFTER_VERDICT", level: "history", detail: `${draft.reason} after ${final.verdict}: a person confirms` };
  }
  const unclearBefore = history.filter((p) => p.verdict === "NEEDS_REVIEW" && UNCLEAR_REASONS.includes(p.reason)).length;
  if (unclearBefore === 0) return draft;
  if (UNCLEAR_REASONS.includes(draft.reason)) {
    return { ...draft, verdict: "NEEDS_REVIEW", reason: "AMBIGUOUS_TWICE", level: "history", detail: `unclear again (${draft.reason}): a person decides` };
  }
  if (draft.verdict === "PASS") {
    return { ...draft, verdict: "NEEDS_REVIEW", reason: "PASS_AFTER_UNCLEAR", level: "history", detail: `${draft.reason} after an unclear run: a person confirms` };
  }
  return draft;
}

function finish(draft: Draft, logHash: string | null): Judgement {
  return {
    ...draft,
    detail: clip(draft.detail, DETAIL_MAX),
    payable: draft.verdict === "PASS",
    rerun: draft.verdict === "NEEDS_REVIEW" && UNCLEAR_REASONS.includes(draft.reason),
    logHash,
  };
}

function overLimit(rules: Rules, costMicroUsd: number, ms: number, steps: number | undefined): string | null {
  const { limits } = rules;
  if (limits.costMicroUsd !== undefined && costMicroUsd > limits.costMicroUsd) return `cost ${costMicroUsd} µ$ over ${limits.costMicroUsd}`;
  if (limits.ms !== undefined && ms > limits.ms) return `time ${ms} ms over ${limits.ms}`;
  if (limits.steps !== undefined && steps !== undefined && steps > limits.steps) return `steps ${steps} over ${limits.steps}`;
  return null;
}

/** At most `max` UTF-16 units, never ending on half a surrogate pair. */
function clip(text: unknown, max: number): string {
  const value = typeof text === "string" ? text : String(text);
  return toWellFormed(value.slice(0, max));
}

/** An untrusted value as it may appear in a receipt's detail: at most 64 characters. */
const short = (value: unknown): string => clip(value, 64);
const isCount = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const blocked = (reason: ReasonCode, level: Level, detail: string): Draft => ({ verdict: "BLOCKED", reason, level, detail });
const review = (reason: ReasonCode, level: Level, detail: string): Draft => ({ verdict: "NEEDS_REVIEW", reason, level, detail });
