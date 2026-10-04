import { createHash } from "node:crypto";

import { RISK_CALCULATION_VERSION, RISK_FORMULA_VERSION } from "../portfolio/risk-calculation.ts";
import { RYN_AI_AUTHORITY, RYN_OPERATIONS, rynOperation, type RynOperation } from "./operations.ts";

/**
 * The Ryn workbench's answer, and the structure it cannot escape.
 *
 * Home gives the workbench a fixed output shape: plain answer; attributable
 * facts and times; conflicts and unknowns; scenarios; portfolio and plan
 * relevance; a deterministic result when the data is sufficient; the next
 * permissible step; source, model and policy versions. Eight sections.
 *
 * **Every one of them is always present**, and that is the load-bearing
 * decision in this file. A structure that lets a section vanish when it is
 * empty is a structure that quietly drops the unknowns section on the answer
 * where it matters most — the reader sees seven confident parts and never
 * learns that the eighth was omitted rather than answered. So an empty section
 * renders with its own reason, and `compileRynAnswer` has no path that returns
 * fewer than eight.
 *
 * **Sufficiency is decided before the result, not around it.** The input may
 * carry a perfectly good number and still be refused: a stale fact, a blocking
 * unknown or an unavailable risk reference makes the result `INSUFFICIENT` and
 * the number never reaches the output object at all. That is deliberate — a
 * figure that is present in the data but absent from the answer cannot leak
 * through a display layer that decided to be helpful.
 *
 * **The compiler calls no model.** Not "does not currently"; there is no client
 * here, no fetch, no clock and no randomness. Same question over the same facts
 * produces the same `answerId`, which is what makes an answer something a
 * reader can be shown twice.
 *
 * Two refusals are constructions rather than checks a caller could skip: a
 * plain answer containing a personalized verdict throws, and a next step whose
 * kind is not in the permissible set throws. Neither can be reached through a
 * display layer, because neither object can be built.
 */

export const RYN_ANSWER_SECTIONS = [
  "PLAIN_ANSWER",
  "FACTS",
  "CONFLICTS_AND_UNKNOWNS",
  "SCENARIOS",
  "RELEVANCE",
  "DETERMINISTIC_RESULT",
  "NEXT_STEP",
  "VERSIONS",
] as const;

export type RynAnswerSectionId = (typeof RYN_ANSWER_SECTIONS)[number];

const SECTION_LABEL: Readonly<Record<RynAnswerSectionId, string>> = {
  PLAIN_ANSWER: "Answer",
  FACTS: "Facts and where they came from",
  CONFLICTS_AND_UNKNOWNS: "Disagreements and gaps",
  SCENARIOS: "Scenarios",
  RELEVANCE: "What it touches",
  DETERMINISTIC_RESULT: "Deterministic result",
  NEXT_STEP: "Next step",
  VERSIONS: "Versions",
};

/**
 * The six verdicts Ryntra may not issue, and the shape they are refused in.
 *
 * The first version of this check banned the bare word, and the first fixture
 * written against it failed on *"a corporate action is declared on TSLA-USD and
 * you hold it in one book"* — the most natural true sentence about the reader's
 * own position. A gate that makes the honest sentence unsayable does not get
 * obeyed; it gets worked around, and then it is guarding nothing.
 *
 * So the refusal is on the **directive**, which is what `AFTER_GATE` actually
 * gates: an imperative opening a clause (*Hold this position.*), or a verdict
 * reached through a recommending construction (*you should buy*, *time to
 * reduce*, *consider hedging*). *You hold it* describes a fact about the
 * reader; *hold it* tells them what to do, and only the second one needs a
 * permitted provider of record behind it.
 *
 * `WAIT` is deliberately absent from the list: Home names explicit
 * no-action as a permitted current capability, so refusing the word would ban
 * the one answer this product is allowed to give.
 */
const VERDICT_WORDS = ["BUY", "SELL", "HOLD", "REDUCE", "HEDGE", "REBALANCE"] as const;

/** `should buy`, `time to reduce`, `consider hedging` — a verdict with a recommender in front. */
const RECOMMENDING =
  /\b(?:should|shall|must|need(?:s)?\s+to|ought\s+to|time\s+to|consider|recommend(?:s|ed)?|advise(?:s|d)?|suggest(?:s|ed)?|better\s+to|worth)\b[^.!?]{0,48}?\b(?:buy|sell|hold|reduc|hedg|rebalanc)\w*/i;

/** An imperative opening the sentence or a clause inside it. */
const IMPERATIVE = /(?:^|[.!?;—]\s+)(?:buy|sell|hold|reduce|hedge|rebalance)\b/i;

/** What a next step may be. Nothing here executes, signs or authorizes. */
export const RYN_STEP_KINDS = [
  "REVIEW_EVIDENCE",
  "OPEN_SUBJECT",
  "COMPARE_SOURCES",
  "RECORD_DECISION",
  "ADJUST_MONITORING",
  "OPEN_STRATEGY",
] as const;

export type RynStepKind = (typeof RYN_STEP_KINDS)[number];

export type RynFreshness = "CURRENT" | "STALE" | "UNKNOWN" | "INVALID";

export type RynFact = Readonly<{
  key: string;
  statement: string;
  value: string | null;
  sourceId: string;
  sourceLabel: string;
  observedAt: string;
  freshness: RynFreshness;
  entitlement: string;
}>;

export type RynReading = Readonly<{
  sourceId: string;
  label: string;
  value: string;
  observedAt: string;
}>;

export type RynConflict = Readonly<{
  conflictId: string;
  subject: string;
  readings: readonly RynReading[];
  reason: string;
}>;

export type RynUnknownInput = Readonly<{
  unknownId: string;
  missingKey: string;
  missingFact: string;
  why: string;
  blocking: boolean;
}>;

export type RynUnknown = RynUnknownInput & Readonly<{ blocks: readonly string[] }>;

export type RynScenarioInput = Readonly<{
  scenarioId: string;
  label: string;
  assumption: string;
  effect: string;
  requires: readonly string[];
  basis: string;
}>;

export type RynScenario = RynScenarioInput;

export type RynRelevance = Readonly<{
  state: "RELEVANT" | "NOT_RELEVANT" | "UNKNOWN";
  positions: readonly string[];
  plans: readonly string[];
  reason: string | null;
}>;

export type RynRiskReference = Readonly<{
  state: "AVAILABLE" | "UNAVAILABLE";
  reference: string | null;
  reason: string | null;
}>;

export type RynDeterministicInput = Readonly<{
  statement: string;
  value: string;
  basis: string;
  inputDigest: string;
}>;

export type RynStepInput = Readonly<{
  kind: string;
  label: string;
  href: string;
  reason: string | null;
}>;

export type RynQuestion = Readonly<{
  questionId: string;
  prompt: string;
  operation: string;
  subjectLabel: string;
  subjectHref: string;
}>;

export type RynSourceVersion = Readonly<{ sourceId: string; label: string; version: string }>;

export type RynAnswerInput = Readonly<{
  asOf: string;
  question: RynQuestion;
  plainAnswer: string | null;
  facts: readonly RynFact[];
  conflicts: readonly RynConflict[];
  unknowns: readonly RynUnknownInput[];
  scenarios: readonly RynScenarioInput[];
  relevance: RynRelevance;
  deterministic: RynDeterministicInput | null;
  risk: RynRiskReference;
  nextSteps: readonly RynStepInput[];
  sourceVersions: readonly RynSourceVersion[];
}>;

export type RynSection = Readonly<{
  id: RynAnswerSectionId;
  label: string;
  state: "PRESENT" | "EMPTY";
  count: number;
  reason: string | null;
}>;

export type RynPlainAnswer =
  | Readonly<{ state: "STATED"; statement: string; reason: null }>
  | Readonly<{ state: "WITHHELD"; statement: null; reason: string }>;

export type RynMissingInput = Readonly<{ key: string; label: string }>;

export type RynResult =
  | Readonly<{
      state: "DETERMINISTIC";
      statement: string;
      value: string;
      basis: string;
      schemaVersion: string;
      formulaVersion: string;
      inputDigest: string;
    }>
  | Readonly<{ state: "INSUFFICIENT"; missing: readonly RynMissingInput[]; reason: string }>;

export type RynNextStep =
  | Readonly<{ state: "AVAILABLE"; kind: RynStepKind; label: string; href: string; authority: "USER"; reason: string | null }>
  | Readonly<{ state: "NONE"; kind: null; label: null; href: null; authority: "USER"; reason: string }>;

export type RynVersions = Readonly<{
  sources: readonly RynSourceVersion[];
  model: Readonly<{ state: "NOT_CALLED"; reason: string }>;
  policy: Readonly<{
    adviceAuthority: "NONE";
    aiAuthority: typeof RYN_AI_AUTHORITY;
    operationSet: readonly RynOperation[];
    riskSchemaVersion: string;
    riskFormulaVersion: string;
  }>;
}>;

export type RynAnswer = Readonly<{
  answerId: string;
  asOf: string;
  question: RynQuestion;
  operation: RynOperation;
  aiAuthority: typeof RYN_AI_AUTHORITY;
  recommendation: null;
  sections: readonly RynSection[];
  plainAnswer: RynPlainAnswer;
  facts: readonly RynFact[];
  conflicts: readonly RynConflict[];
  unknowns: readonly RynUnknown[];
  scenarios: readonly RynScenario[];
  relevance: RynRelevance;
  result: RynResult;
  nextStep: RynNextStep;
  versions: RynVersions;
}>;

function refuseVerdict(sentence: string): void {
  if (RECOMMENDING.test(sentence) || IMPERATIVE.test(sentence)) {
    throw new Error(
      "A plain answer may not issue a personalized verdict (" +
        VERDICT_WORDS.join(", ") +
        "); Ryntra issues none: " +
        sentence,
    );
  }
}

function stepKind(value: string): RynStepKind {
  if (!(RYN_STEP_KINDS as readonly string[]).includes(value)) {
    throw new Error("Not a permissible next step kind: " + value);
  }
  return value as RynStepKind;
}

/**
 * Which named inputs this answer does not have.
 *
 * Three separate reasons collapse into one set, and each keeps its own key so
 * the refusal can name it: a fact that is not current, a blocking unknown, and
 * an unavailable deterministic risk reference.
 */
function missingInputs(input: RynAnswerInput): readonly RynMissingInput[] {
  const missing = new Map<string, string>();
  for (const fact of input.facts) {
    if (fact.freshness !== "CURRENT") {
      missing.set(fact.key, "A current reading of " + fact.key + " from " + fact.sourceLabel);
    }
  }
  for (const unknown of input.unknowns) {
    if (unknown.blocking) missing.set(unknown.missingKey, unknown.missingFact);
  }
  if (input.risk.state !== "AVAILABLE") {
    missing.set("risk", "The deterministic risk calculation");
  }
  if (input.facts.length === 0) {
    missing.set("facts", "Any fact from a source about this subject");
  }
  return [...missing.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, label]) => ({ key, label }));
}

function section(
  id: RynAnswerSectionId,
  count: number,
  reason: string,
): RynSection {
  return {
    id,
    label: SECTION_LABEL[id],
    state: count > 0 ? "PRESENT" : "EMPTY",
    count,
    reason: count > 0 ? null : reason,
  };
}

export function compileRynAnswer(input: RynAnswerInput): RynAnswer {
  const operation = rynOperation(input.question.operation);

  for (const conflict of input.conflicts) {
    if (conflict.readings.length < 2) {
      throw new Error(
        "A conflict needs at least two readings; one reading is a fact, not a disagreement: " + conflict.conflictId,
      );
    }
  }

  const missing = missingInputs(input);
  const missingSet = new Set(missing.map((entry) => entry.key));
  const missingLabel = new Map(missing.map((entry) => [entry.key, entry.label]));

  const plainAnswer: RynPlainAnswer =
    input.facts.length === 0 || input.plainAnswer === null
      ? {
          state: "WITHHELD",
          statement: null,
          reason:
            "No fact is established for this question yet, so there is no answer to state. A sentence written over nothing would be the invention this workbench exists to avoid.",
        }
      : (() => {
          refuseVerdict(input.plainAnswer);
          return { state: "STATED" as const, statement: input.plainAnswer, reason: null };
        })();

  const unknowns: readonly RynUnknown[] = input.unknowns.map((unknown) => ({
    ...unknown,
    blocks: unknown.blocking
      ? ["the deterministic result", ...input.scenarios.filter((scenario) => scenario.requires.includes(unknown.missingKey)).map((scenario) => scenario.label)]
      : [],
  }));

  const droppedScenarios = input.scenarios.filter((scenario) =>
    scenario.requires.some((key) => missingSet.has(key)),
  );
  const scenarios = input.scenarios.filter((scenario) => !droppedScenarios.includes(scenario));

  const sufficient = missing.length === 0 && input.deterministic !== null;

  const result: RynResult = sufficient && input.deterministic !== null
    ? {
        state: "DETERMINISTIC",
        statement: input.deterministic.statement,
        value: input.deterministic.value,
        basis: input.deterministic.basis,
        schemaVersion: RISK_CALCULATION_VERSION,
        formulaVersion: RISK_FORMULA_VERSION,
        inputDigest: input.deterministic.inputDigest,
      }
    : {
        state: "INSUFFICIENT",
        missing: input.deterministic === null && missing.length === 0
          ? [{ key: "calculation", label: "A deterministic calculation for this question" }]
          : missing,
        reason:
          "Not every input this calculation needs is present and current, so no number is stated. A figure computed over a stale or missing input is a guess with a decimal point.",
      };

  const permitted = input.nextSteps.map((step) => ({ ...step, kind: stepKind(step.kind) }));
  const nextStep: RynNextStep = permitted.length > 0
    ? {
        state: "AVAILABLE",
        kind: permitted[0].kind,
        label: permitted[0].label,
        href: permitted[0].href,
        authority: "USER",
        reason: permitted[0].reason,
      }
    : {
        state: "NONE",
        kind: null,
        label: null,
        href: null,
        authority: "USER",
        reason:
          "There is no step this answer can offer. Nothing is waiting on you here, and inventing a next action would be the filler this surface refuses.",
      };

  const versions: RynVersions = {
    sources: input.sourceVersions,
    model: {
      state: "NOT_CALLED",
      reason:
        "This answer was compiled from records that already exist. No model was called, so no model version is bound to it.",
    },
    policy: {
      adviceAuthority: "NONE",
      aiAuthority: RYN_AI_AUTHORITY,
      operationSet: RYN_OPERATIONS,
      riskSchemaVersion: RISK_CALCULATION_VERSION,
      riskFormulaVersion: RISK_FORMULA_VERSION,
    },
  };

  const conflictAndUnknownCount = input.conflicts.length + unknowns.length;

  const sections: readonly RynSection[] = [
    section("PLAIN_ANSWER", plainAnswer.state === "STATED" ? 1 : 0, plainAnswer.reason ?? ""),
    section(
      "FACTS",
      input.facts.length,
      "No source reported a fact for this question. That is a gap in coverage, not a quiet all-clear.",
    ),
    section(
      "CONFLICTS_AND_UNKNOWNS",
      conflictAndUnknownCount,
      "No source disagrees with another here and nothing needed is missing.",
    ),
    section(
      "SCENARIOS",
      scenarios.length,
      droppedScenarios.length > 0
        ? "Every scenario for this question needs an input that is missing or stale: " +
          [...new Set(
            droppedScenarios.flatMap((scenario) =>
              scenario.requires.filter((key) => missingSet.has(key)).map((key) => missingLabel.get(key) ?? key),
            ),
          )].sort().join("; ") +
          "."
        : "No scenario applies to this question.",
    ),
    section(
      "RELEVANCE",
      input.relevance.positions.length + input.relevance.plans.length,
      input.relevance.reason ??
        "Nothing you hold and no plan you recorded touches this subject.",
    ),
    section(
      "DETERMINISTIC_RESULT",
      result.state === "DETERMINISTIC" ? 1 : 0,
      result.state === "DETERMINISTIC" ? "" : result.reason,
    ),
    section("NEXT_STEP", nextStep.state === "AVAILABLE" ? 1 : 0, nextStep.state === "AVAILABLE" ? "" : nextStep.reason),
    section(
      "VERSIONS",
      input.sourceVersions.length,
      "No source answered this question, so there is no source version to bind to it.",
    ),
  ];

  const answerId = "ryn_" + createHash("sha256")
    .update(
      JSON.stringify([
        input.question.questionId,
        operation,
        input.facts,
        input.conflicts,
        input.unknowns,
        scenarios,
        input.relevance,
        result,
        nextStep.kind,
        input.sourceVersions,
      ]),
    )
    .digest("hex")
    .slice(0, 12);

  return {
    answerId,
    asOf: input.asOf,
    question: input.question,
    operation,
    aiAuthority: RYN_AI_AUTHORITY,
    recommendation: null,
    sections,
    plainAnswer,
    facts: input.facts,
    conflicts: input.conflicts,
    unknowns,
    scenarios,
    relevance: input.relevance,
    result,
    nextStep,
    versions,
  };
}
