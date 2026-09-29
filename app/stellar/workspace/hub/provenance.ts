import { type Evidence, isResolved } from "@/lib/stellar/evidence";

/**
 * Where a panel's figures came from, and how long ago.
 *
 * Every panel on this workspace puts this in its footer. It is a function rather
 * than a convention because the unresolved case is the one that gets forgotten:
 * a read that failed still has to say which source it tried, otherwise a reader
 * cannot tell a broken endpoint from a fact that does not exist.
 */
export function provenanceLine(evidence: Evidence<unknown>): string {
  if (isResolved(evidence)) {
    return `${evidence.sources.map((source) => source.label).join(" · ")} — observed ${evidence.ageSeconds}s ago`;
  }
  return evidence.sources.length
    ? `Attempted: ${evidence.sources.map((source) => source.label).join(" · ")}`
    : "No source was reached.";
}
