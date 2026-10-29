/**
 * Contest classes and the rules a match is played under (CITY-68, decision 74; RXN `docs/BLUEPRINT.md` §4.1).
 *
 *   verified — the winner is decided by code: a deterministic replay of the match log or hidden tests in a sandbox.
 *              Anyone can check it again. Only this class may play for real SOL from entries (`money: "stakes"`).
 *   show     — a judge model decides. Models of OpenRouter do not promise the same answer twice, so a show plays for
 *              nothing, for a sponsor's prize or for a small prize only — never for a pool of entries.
 *
 * The rules are hashed into every receipt (`rulesHash`): a match played under other rules is another match.
 *
 * Pure: no store, no clock, no network.
 */

import { canonicalJson, hashOf, isHex32, isRecord } from "./hash.ts";

/** The most bytes any submission may have, whatever its rules say: 1 MiB. */
export const MAX_SUBMISSION_BYTES = 1_048_576;

export const CONTEST_CLASSES = ["verified", "show"] as const;
export type ContestClass = (typeof CONTEST_CLASSES)[number];

/** Who decides: `replay` and `tests` are code; `model` is a judge model. */
export const DECIDERS = ["replay", "tests", "model"] as const;
export type Decider = (typeof DECIDERS)[number];

/**
 * What a match plays for. `stakes` — real SOL from entries into a pool (the pools program, CITY-46 and CITY-52);
 * `small` — a small prize of Ryntra's (its ceiling is money and is set with the pools, not here); `sponsored` — a
 * sponsor's prize; `none` — nothing.
 */
export const MONEY = ["none", "sponsored", "small", "stakes"] as const;
export type Money = (typeof MONEY)[number];

/** The money a show may play for. */
export const SHOW_MONEY: readonly Money[] = ["none", "sponsored", "small"];

export const classOf = (decider: Decider): ContestClass => (decider === "model" ? "show" : "verified");

/** The Ring's formats as the judge sees them: who decides each. Duo Crack is decided by the phrase's hash, not a model. */
export const RING_FORMATS: Readonly<Record<string, Decider>> = {
  "duo-crack": "replay",
  code: "tests",
  "market-replay": "replay",
  dice: "replay",
  debate: "model",
  "character-show": "model",
};

export type Limits = {
  /** Most entries in the match log. */
  steps?: number;
  /** Most the agent may spend on its model in the match, micro-dollars. */
  costMicroUsd?: number;
  /** Most wall time of the agent's turns in the match, ms. */
  ms?: number;
};

export type Rules = {
  /** The Ring format, e.g. `market-replay`. */
  format: string;
  class: ContestClass;
  decider: Decider;
  money: Money;
  /**
   * The engine that replays the log and the config it starts from: required when `decider` is `replay`. The config is
   * part of the rules — a log started from another config is another game, whatever the engine accepts.
   */
  game?: { id: string; version: string; config: unknown };
  /** What an agent may hand in: media types and the most bytes (UTF-8), at most `MAX_SUBMISSION_BYTES`. */
  submission: { media: string[]; maxBytes: number };
  /** Unix ms; a submission stamped earlier is early. */
  opensAt: number;
  /** Unix ms; a submission stamped later is late. */
  closesAt: number;
  limits: Limits;
  /** Hidden tests: required when `decider` is `tests`. `ids` is the whole suite; PASS needs at least `minPassed`. */
  tests?: { suiteHash: string; ids: string[]; minPassed: number };
  /** The judge model of a show: a score at or above `passAt` passes, at or below `failAt` fails, between is unclear. */
  model?: { id: string; passAt: number; failAt: number };
};

export type RuleIssueCode = "BAD_RULES" | "CLASS_DECIDER" | "MONEY_NEEDS_VERIFIED";
export type RuleIssue = { code: RuleIssueCode; detail: string };

const isIn = <T extends string>(list: readonly T[], value: unknown): value is T =>
  typeof value === "string" && (list as readonly string[]).includes(value);
const isCount = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const isId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9._:/-]{1,128}$/.test(value);

/** Everything wrong with a set of rules; empty when they may be played. The money check is the one that matters most. */
export function checkRules(rules: unknown): RuleIssue[] {
  if (!isRecord(rules)) return [bad("rules are not an object")];
  const issues: RuleIssue[] = [];
  if (!isId(rules.format)) issues.push(bad("format"));
  if (!isIn(CONTEST_CLASSES, rules.class)) issues.push(bad("class"));
  if (!isIn(DECIDERS, rules.decider)) issues.push(bad("decider"));
  if (!isIn(MONEY, rules.money)) issues.push(bad("money"));
  if (!isCount(rules.opensAt) || !isCount(rules.closesAt) || rules.opensAt > rules.closesAt) issues.push(bad("opensAt ≤ closesAt"));

  const submission = rules.submission;
  if (
    !isRecord(submission) ||
    !Array.isArray(submission.media) ||
    submission.media.length === 0 ||
    !submission.media.every(isId) ||
    !isCount(submission.maxBytes) ||
    submission.maxBytes === 0 ||
    submission.maxBytes > MAX_SUBMISSION_BYTES
  ) {
    issues.push(bad("submission"));
  }

  const limits = rules.limits;
  if (!isRecord(limits) || !["steps", "costMicroUsd", "ms"].every((key) => limits[key] === undefined || isCount(limits[key]))) {
    issues.push(bad("limits"));
  }

  if (rules.decider === "replay") {
    const game = rules.game;
    if (!isRecord(game) || !isId(game.id) || !isId(game.version) || !isJson(game.config)) {
      issues.push(bad("a replay needs game { id, version, config } with config in JSON"));
    }
  }
  if (rules.decider === "tests") {
    const tests = rules.tests;
    if (
      !isRecord(tests) ||
      !isHex32(tests.suiteHash) ||
      !Array.isArray(tests.ids) ||
      tests.ids.length === 0 ||
      !tests.ids.every(isId) ||
      new Set(tests.ids).size !== tests.ids.length ||
      !isCount(tests.minPassed) ||
      tests.minPassed === 0 ||
      tests.minPassed > tests.ids.length
    ) {
      issues.push(bad("tests need { suiteHash, ids, minPassed } with 1 ≤ minPassed ≤ ids"));
    }
  }
  if (rules.decider === "model") {
    const model = rules.model;
    if (
      !isRecord(model) ||
      !isId(model.id) ||
      !isScore(model.passAt) ||
      !isScore(model.failAt) ||
      (model.failAt as number) >= (model.passAt as number)
    ) {
      issues.push(bad("a show needs model { id, passAt, failAt } with 0 ≤ failAt < passAt ≤ 1"));
    }
  }

  if (isIn(DECIDERS, rules.decider) && isIn(CONTEST_CLASSES, rules.class) && classOf(rules.decider) !== rules.class) {
    issues.push({ code: "CLASS_DECIDER", detail: `decider ${rules.decider} belongs to class ${classOf(rules.decider)}, not ${rules.class}` });
  }
  if (rules.money === "stakes" && (rules.class !== "verified" || rules.decider === "model")) {
    issues.push({ code: "MONEY_NEEDS_VERIFIED", detail: "real SOL from entries needs class verified: the winner decided by code" });
  }
  return issues;
}

export const isScore = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;

/** The hash every receipt carries: the rules as canonical JSON. */
export const rulesHash = (rules: Rules): string => hashOf(rules);

const bad = (detail: string): RuleIssue => ({ code: "BAD_RULES", detail });

/** A value canonical JSON can write down; `undefined` is not one. */
function isJson(value: unknown): boolean {
  if (value === undefined) return false;
  try {
    canonicalJson(value);
    return true;
  } catch {
    return false;
  }
}
