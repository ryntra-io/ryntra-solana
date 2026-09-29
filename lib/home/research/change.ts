import { createHash } from "node:crypto";

import { canonicalJson, compareCanonicalStrings } from "../../guard/canonical-json.ts";
import { ATTENTION_SEVERITIES, type AttentionSeverity } from "../portfolio/attention.ts";
import {
  absoluteDecimal,
  compareDecimal,
  parseDecimalText,
  rescale,
  subtractDecimal,
  type DecimalValue,
} from "../portfolio/decimal.ts";
import { formatDecimal } from "../portfolio/format.ts";
import { parseExplicitInstant } from "../portfolio/freshness.ts";
import type { Entitlement, MaterialityThreshold } from "./mandate.ts";
import type { MonitorRule } from "./monitor-rule.ts";

/**
 * The material-change engine.
 *
 * **A change is the object.** Not a ranked asset, not a score, not a feed of
 * things that moved. Every row this produces is one answer to *what changed,
 * measured against which threshold, on whose evidence* — and the two answers
 * that are not a change at all get first-class states rather than being dropped:
 *
 *   `CONFLICT` — two sources disagree about one fact. Both values are carried,
 *   there is no `measured`, and there is deliberately no reconciliation. The
 *   defect this prevents is the obvious one: averaging 106 and 112 into 109
 *   produces a number no source reported, that no evidence supports, and that
 *   looks exactly like a fact.
 *
 *   `UNKNOWN` — a required fact nobody supplied, a baseline that does not exist,
 *   a denominator of zero, a value that is not an exact decimal. Each names what
 *   is missing. None becomes a zero and none becomes a calm surface.
 *
 * **There is no clock inside this function and no model call anywhere near it.**
 * `asOf` is an argument; detection is arithmetic and comparison. An LLM may
 * later explain one of these rows to a reader — it may never produce one, which
 * is what "no LLM per tick" means in code rather than in prose.
 *
 * **Rounding goes toward reporting.** A relative move is rounded away from zero,
 * so a 500.1 bps move against a 500 bps threshold is reported rather than
 * silently swallowed. Under-reporting on a monitoring surface is the expensive
 * direction of the same error.
 */

export const CHANGE_KINDS = [
  "EVIDENCE_CONFLICT",
  "VALUE_MOVE",
  "STATE_CHANGE",
  "SOURCE_DEGRADED",
  "EVIDENCE_MISSING",
  "NEW_OBSERVATION",
] as const;

export type ChangeKind = (typeof CHANGE_KINDS)[number];

/** Ordered by how loudly each one should be read, and used for sorting. */
export const CHANGE_STATES = ["CONFLICT", "MATERIAL", "UNKNOWN", "IMMATERIAL"] as const;

export type ChangeState = (typeof CHANGE_STATES)[number];

export type FactObservation = Readonly<{
  factKey: string;
  subjectRef: string;
  subjectLabel: string;
  sourceId: string;
  observedAt: string;
  effectiveAt: string | null;
  /** `null` means the source was asked and did not supply it. */
  value: string | null;
  unit: string | null;
  evidenceRefs: readonly string[];
  entitlement: Entitlement;
}>;

export type FactBaseline = Readonly<{
  subjectRef: string;
  factKey: string;
  value: string | null;
  observedAt: string | null;
  /** The real record the baseline came from. */
  source: string;
}>;

export type SourceDegradation = Readonly<{ sourceId: string; reason: string }>;

export type ChangeReading = Readonly<{
  value: string;
  observedAt: string | null;
  source: string;
}>;

export type ConflictEntry = Readonly<{
  sourceId: string;
  value: string;
  observedAt: string;
}>;

export type MaterialChange = Readonly<{
  id: string;
  ruleId: string;
  ruleVersion: string;
  scopeKind: string;
  subjectRef: string;
  subjectLabel: string;
  factKey: string;
  kind: ChangeKind;
  state: ChangeState;
  severity: AttentionSeverity;
  observedAt: string | null;
  effectiveAt: string | null;
  previous: ChangeReading | null;
  current: ChangeReading | null;
  threshold: Readonly<{ comparison: string; value: number | null; unit: string | null }> | null;
  measured: Readonly<{ value: string; unit: string | null }> | null;
  conflict: readonly ConflictEntry[];
  unknown: readonly string[];
  sources: readonly string[];
  evidenceRefs: readonly string[];
  dedupeKey: string;
}>;

const BPS = 10_000n;

function decimalOf(value: string): DecimalValue | null {
  try {
    return parseDecimalText(value);
  } catch {
    return null;
  }
}

function unitsAt(value: DecimalValue, scale: number): bigint {
  return BigInt(rescale(value, scale, "TOWARD_ZERO").units);
}

/** Magnitude rounded away from zero, so a borderline move reports rather than hides. */
function relativeBps(previous: DecimalValue, current: DecimalValue): bigint | null {
  const scale = Math.max(previous.scale, current.scale);
  const denominator = unitsAt(absoluteDecimal(previous), scale);
  if (denominator === 0n) return null;
  const delta = unitsAt(absoluteDecimal(subtractDecimal(current, previous, scale, "TOWARD_ZERO")), scale);
  const numerator = delta * BPS;
  const quotient = numerator / denominator;
  return numerator % denominator === 0n ? quotient : quotient + 1n;
}

function changeId(material: unknown): string {
  const digest = createHash("sha256")
    .update(`ryntra.home.research.change.v1\n${canonicalJson(material)}`, "utf8")
    .digest("hex");
  return `chg-${digest.slice(0, 12)}`;
}

type Draft = Omit<MaterialChange, "id">;

function withId(draft: Draft): MaterialChange {
  /* The reading clock is deliberately absent from the preimage: two reads of an
     unchanged world must produce the same id, or the detail route cannot resolve
     a change a reader followed a link to. */
  return {
    id: changeId({
      ruleId: draft.ruleId,
      ruleVersion: draft.ruleVersion,
      factKey: draft.factKey,
      subjectRef: draft.subjectRef,
      kind: draft.kind,
      state: draft.state,
      previous: draft.previous?.value ?? null,
      current: draft.current?.value ?? null,
      conflict: draft.conflict.map((entry) => [entry.sourceId, entry.value]),
      unknown: draft.unknown,
    }),
    ...draft,
  };
}

function sortedUnique(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort(compareCanonicalStrings);
}

function evaluate(input: Readonly<{
  rule: MonitorRule;
  trigger: MaterialityThreshold;
  observations: readonly FactObservation[];
  baseline: FactBaseline | null;
}>): Draft {
  const { rule, trigger } = input;
  const skeleton = {
    ruleId: rule.ruleId,
    ruleVersion: rule.version,
    scopeKind: rule.scope.kind,
    subjectRef: rule.scope.ref,
    subjectLabel: rule.scope.label,
    factKey: trigger.factKey,
    severity: trigger.severity,
    dedupeKey: `${rule.dedupeKey}:${trigger.factKey}`,
  };

  const relevant = input.observations.filter(
    (observation) => observation.subjectRef === rule.scope.ref && observation.factKey === trigger.factKey,
  );
  const supplied = relevant.filter((observation) => observation.value !== null);
  const sources = sortedUnique(relevant.map((observation) => observation.sourceId));
  const evidenceRefs = sortedUnique(relevant.flatMap((observation) => observation.evidenceRefs));
  const observedAt = supplied.length === 0
    ? null
    : supplied.map((observation) => observation.observedAt).sort(compareCanonicalStrings).at(-1) ?? null;
  const effectiveAt = supplied.find((observation) => observation.effectiveAt !== null)?.effectiveAt ?? null;
  const unit = supplied.find((observation) => observation.unit !== null)?.unit ?? null;

  const missing = (reason: string, kind: ChangeKind = "EVIDENCE_MISSING", current: ChangeReading | null = null): Draft => ({
    ...skeleton,
    kind,
    state: "UNKNOWN",
    observedAt,
    effectiveAt,
    previous: null,
    current,
    threshold: null,
    measured: null,
    conflict: [],
    unknown: [reason],
    sources,
    evidenceRefs,
  });

  if (supplied.length === 0) {
    const asked = sources.length === 0
      ? `No source in this mandate supplied ${trigger.factKey} for ${rule.scope.label}.`
      : `${sources.join(", ")} returned no ${trigger.factKey} for ${rule.scope.label}.`;
    return missing(asked);
  }

  const distinct = sortedUnique(supplied.map((observation) => observation.value as string));
  if (distinct.length > 1) {
    return {
      ...skeleton,
      kind: "EVIDENCE_CONFLICT",
      state: "CONFLICT",
      observedAt,
      effectiveAt,
      previous: null,
      current: null,
      threshold: null,
      measured: null,
      conflict: supplied
        .map((observation) => ({
          sourceId: observation.sourceId,
          value: observation.value as string,
          observedAt: observation.observedAt,
        }))
        .sort((left, right) => compareCanonicalStrings(left.sourceId, right.sourceId)),
      unknown: [`${sources.join(" and ")} report different values for ${trigger.factKey}; neither is chosen and no average is computed.`],
      sources,
      evidenceRefs,
    };
  }

  const currentValue = distinct[0];
  const current: ChangeReading = {
    value: currentValue,
    observedAt,
    source: sources.join(", "),
  };

  const baseline = input.baseline;
  if (baseline === null || baseline.value === null) {
    return missing(
      `No recorded baseline for ${trigger.factKey}, so this reading is not measured against anything.`,
      "NEW_OBSERVATION",
      current,
    );
  }
  const previous: ChangeReading = {
    value: baseline.value,
    observedAt: baseline.observedAt,
    source: baseline.source,
  };

  if (trigger.comparison === "STATE_CHANGE") {
    const moved = baseline.value !== currentValue;
    return {
      ...skeleton,
      kind: "STATE_CHANGE",
      state: moved ? "MATERIAL" : "IMMATERIAL",
      observedAt,
      effectiveAt,
      previous,
      current,
      threshold: { comparison: "STATE_CHANGE", value: null, unit: null },
      measured: null,
      conflict: [],
      unknown: [],
      sources,
      evidenceRefs,
    };
  }

  const currentDecimal = decimalOf(currentValue);
  const previousDecimal = decimalOf(baseline.value);
  if (currentDecimal === null || previousDecimal === null) {
    return missing(
      `${trigger.factKey} is not an exact decimal in this evidence, so no move is computed from it.`,
      "EVIDENCE_MISSING",
      current,
    );
  }

  const thresholdValue = trigger.value;
  if (thresholdValue === null || !Number.isFinite(thresholdValue)) {
    return missing(`The ${trigger.factKey} threshold is not a number this engine can measure against.`, "EVIDENCE_MISSING", current);
  }

  if (trigger.comparison === "RELATIVE_BPS") {
    const bps = relativeBps(previousDecimal, currentDecimal);
    if (bps === null) {
      return {
        ...missing(
          `The recorded ${trigger.factKey} baseline is zero, so a relative move has no denominator.`,
          "EVIDENCE_MISSING",
          current,
        ),
        previous,
      };
    }
    return {
      ...skeleton,
      kind: "VALUE_MOVE",
      state: bps >= BigInt(Math.trunc(thresholdValue)) ? "MATERIAL" : "IMMATERIAL",
      observedAt,
      effectiveAt,
      previous,
      current,
      threshold: { comparison: "RELATIVE_BPS", value: thresholdValue, unit: "bps" },
      measured: { value: bps.toString(), unit: "bps" },
      conflict: [],
      unknown: [],
      sources,
      evidenceRefs,
    };
  }

  const scale = Math.max(previousDecimal.scale, currentDecimal.scale);
  const delta = absoluteDecimal(subtractDecimal(currentDecimal, previousDecimal, scale, "TOWARD_ZERO"));
  const thresholdDecimal = decimalOf(thresholdValue.toString());
  if (thresholdDecimal === null) {
    return missing(`The ${trigger.factKey} threshold is not an exact decimal.`, "EVIDENCE_MISSING", current);
  }
  return {
    ...skeleton,
    kind: "VALUE_MOVE",
    state: compareDecimal(delta, thresholdDecimal) >= 0 ? "MATERIAL" : "IMMATERIAL",
    observedAt,
    effectiveAt,
    previous,
    current,
    threshold: { comparison: "ABSOLUTE", value: thresholdValue, unit },
    measured: { value: formatDecimal(delta), unit },
    conflict: [],
    unknown: [],
    sources,
    evidenceRefs,
  };
}

function degradation(input: Readonly<{ rules: readonly MonitorRule[]; degraded: SourceDegradation }>): Draft | null {
  /* Attributed to the lowest-id rule that required the source, so the link a
     reader follows is stable rather than dependent on collection order. */
  const owner = input.rules.find((rule) => rule.requiredSources.includes(input.degraded.sourceId));
  if (owner === undefined) return null;
  return {
    ruleId: owner.ruleId,
    ruleVersion: owner.version,
    scopeKind: owner.scope.kind,
    subjectRef: input.degraded.sourceId,
    subjectLabel: input.degraded.sourceId,
    factKey: "sourceState",
    kind: "SOURCE_DEGRADED",
    state: "UNKNOWN",
    severity: owner.severity,
    observedAt: null,
    effectiveAt: null,
    previous: null,
    current: null,
    threshold: null,
    measured: null,
    conflict: [],
    unknown: [input.degraded.reason],
    sources: [input.degraded.sourceId],
    evidenceRefs: [],
    dedupeKey: `${owner.dedupeKey}:sourceState:${input.degraded.sourceId}`,
  };
}

export function detectMaterialChanges(input: Readonly<{
  rules: readonly MonitorRule[];
  observations: readonly FactObservation[];
  baselines: readonly FactBaseline[];
  degradedSources: readonly SourceDegradation[];
  asOf: string;
}>): readonly MaterialChange[] {
  const baselines = new Map(input.baselines.map((entry) => [`${entry.subjectRef}::${entry.factKey}`, entry]));
  const drafts: Draft[] = [];

  for (const rule of input.rules) {
    for (const trigger of rule.triggers) {
      drafts.push(evaluate({
        rule,
        trigger,
        observations: input.observations,
        baseline: baselines.get(`${rule.scope.ref}::${trigger.factKey}`) ?? null,
      }));
    }
  }
  for (const degraded of input.degradedSources) {
    const draft = degradation({ rules: input.rules, degraded });
    if (draft !== null) drafts.push(draft);
  }

  const seen = new Set<string>();
  return drafts
    .map(withId)
    .sort((left, right) => {
      const byState = CHANGE_STATES.indexOf(left.state) - CHANGE_STATES.indexOf(right.state);
      if (byState !== 0) return byState;
      const bySeverity = ATTENTION_SEVERITIES.indexOf(left.severity) - ATTENTION_SEVERITIES.indexOf(right.severity);
      if (bySeverity !== 0) return bySeverity;
      const byTime = compareCanonicalStrings(right.observedAt ?? "", left.observedAt ?? "");
      if (byTime !== 0) return byTime;
      return compareCanonicalStrings(left.id, right.id);
    })
    .filter((change) => {
      const key = `${change.dedupeKey}::${change.state}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/** Whether a reading clock is usable at all — the surface states this rather than guessing. */
export function readingClockIsExplicit(asOf: string): boolean {
  return parseExplicitInstant(asOf) !== null;
}
