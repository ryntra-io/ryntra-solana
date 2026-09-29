import { compareCanonicalStrings } from "../guard/canonical-json.ts";
import { ObservedOutcomeSchema, type ObservedOutcome } from "./artifacts.ts";

/**
 * Expected against actual, movement by movement.
 *
 * The intent said what it expected to happen. The chain was read back
 * independently. This compares the two and refuses to average them.
 *
 * **A deviation is recorded as a deviation.** That is the whole rule, and it is
 * the one every reconciliation gets wrong under pressure: an outcome that
 * mostly matched is not a match, and a receipt that says `MATCHED` over a
 * partial result is worse than no receipt, because somebody will act on it.
 * `DEVIATION_RECORDED` is a first-class outcome here rather than a failure
 * mode — the Stellar lifecycle reached the same conclusion the day it spent two
 * signatures on transactions that could not have succeeded.
 *
 * What this module deliberately does not do is decide *why* something deviated.
 * It reports which expectations were met, which were not, and what was observed
 * that nobody expected. Explaining a deviation is a human reading the receipt;
 * inventing the explanation here would be the product asserting a cause it did
 * not observe.
 */

export type ReconciliationFinding = Readonly<{
  expectation: string;
  status: "MATCHED" | "NOT_OBSERVED";
  matchedBy: string | null;
}>;

export type Reconciliation = Readonly<{
  status: ObservedOutcome["status"];
  findings: readonly ReconciliationFinding[];
  /** Observed effects no expectation accounted for. Never silently dropped. */
  unexpected: readonly string[];
  matched: number;
  expected: number;
}>;

/**
 * An expectation is met when an observed effect carries it.
 *
 * Substring containment rather than equality, because the expectation is
 * written by the intent's author and the observed description comes from a
 * chain read; requiring them to be byte-identical would make every real
 * reconciliation a deviation. Comparison is case-folded and whitespace-
 * collapsed so formatting differences are not findings.
 */
function normalise(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

export function reconcileObservedOutcome({
  expectedEffects,
  observed,
}: {
  expectedEffects: readonly string[];
  observed: ObservedOutcome;
}): Reconciliation {
  const outcome = ObservedOutcomeSchema.parse(observed);

  if (expectedEffects.length === 0) {
    /* An intent that expected nothing cannot be reconciled against anything.
       Returning MATCHED here would mean "we checked and it was fine", which is
       precisely the claim that was not made. */
    throw new Error("An intent with no expected effects cannot be reconciled.");
  }

  const effects = outcome.observedEffects.map((effect) => ({
    normalised: normalise(effect.description),
    sourceRef: effect.sourceRef,
    description: effect.description,
  }));
  const consumed = new Set<number>();

  const findings = [...expectedEffects]
    .sort(compareCanonicalStrings)
    .map((expectation) => {
      const needle = normalise(expectation);
      const index = effects.findIndex(
        (effect, position) => !consumed.has(position) && effect.normalised.includes(needle),
      );
      if (index === -1) {
        return { expectation, status: "NOT_OBSERVED" as const, matchedBy: null };
      }
      /* One observed effect satisfies one expectation. Without this, a single
         effect would silently satisfy every expectation that happens to be a
         substring of it, and a partial result would read as complete. */
      consumed.add(index);
      return { expectation, status: "MATCHED" as const, matchedBy: effects[index].sourceRef };
    });

  const unexpected = effects
    .filter((_, position) => !consumed.has(position))
    .map((effect) => effect.description)
    .sort(compareCanonicalStrings);

  const matched = findings.filter((finding) => finding.status === "MATCHED").length;

  /* The chain's own verdict outranks the comparison. A failed transaction that
     happens to have emitted the expected events is still a failure, and calling
     it MATCHED because the descriptions lined up would be the product deciding
     it knows better than the ledger. */
  const status: ObservedOutcome["status"] =
    outcome.status === "FAILED"
      ? "FAILED"
      : matched === findings.length && unexpected.length === 0
        ? "MATCHED"
        : "DEVIATION_RECORDED";

  return Object.freeze({
    status,
    findings: Object.freeze(findings),
    unexpected: Object.freeze(unexpected),
    matched,
    expected: findings.length,
  });
}
