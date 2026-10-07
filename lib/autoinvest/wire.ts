/**
 * A rule on the wire for the reader asking (1.31.0).
 *
 * `enabled` — a token's price condition standing against its price when the
 * rule was turned on — is a value a reader built before 1.31.0 does not know:
 * the phone of 1.30.0 looks the reference up in a table that has no row for
 * it and throws. So a native reader receives `enabled` only once it says it
 * reads it, with `X-Ryntra-Reads: rule-reference-enabled`; until then the
 * judgement's reference reads `market` — a market figure, which the old
 * reader words as «біржовий орієнтир» and never crashes on. The web's own
 * pages (the proof cookie) are built with this server and always read it.
 *
 * Pure: the rule, the carrier and the header are arguments.
 */

import type { AutoinvestRule } from "../api/v1/contract.ts";

export const READS_HEADER = "X-Ryntra-Reads";
export const READS_ENABLED_REFERENCE = "rule-reference-enabled";

/** Whether the reader asking knows the `enabled` reference: the web always; a native client once it says so. */
export function readsEnabledReference(carrier: "bearer" | "cookie", headers: Readonly<{ get(name: string): string | null }>): boolean {
  if (carrier === "cookie") return true;
  const said = headers.get(READS_HEADER) ?? "";
  return said.split(",").map((part) => part.trim().toLowerCase()).includes(READS_ENABLED_REFERENCE);
}

/** The rule as this reader can read it: `enabled` said as `market` to a reader that does not know it; nothing else changes. */
export function ruleForReader(rule: AutoinvestRule, readsEnabled: boolean): AutoinvestRule {
  if (readsEnabled || !rule.occurrences.some((occurrence) => occurrence.condition?.reference === "enabled")) return rule;
  return {
    ...rule,
    occurrences: rule.occurrences.map((occurrence) => (occurrence.condition?.reference === "enabled" ? { ...occurrence, condition: { ...occurrence.condition, reference: "market" } } : occurrence)),
  };
}
