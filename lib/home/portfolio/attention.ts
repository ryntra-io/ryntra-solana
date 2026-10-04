import { compareCanonicalStrings } from "../../guard/canonical-json.ts";
import { parseExplicitInstant } from "./freshness.ts";

/**
 * Needs Attention — the canonical order, and nothing else.
 *
 * Home fixes eleven kinds in one sequence, and the sequence is the product: a
 * surface that sorts by recency puts a strategy trigger above a signature
 * request the moment the trigger is newer, and the reader learns to distrust
 * the top of the list. So priority is this array's index, severity breaks a
 * priority tie, age breaks a severity tie, and the stable id breaks the rest.
 * Every comparison is total, which is what makes the output independent of
 * the order the callers happened to collect facts in.
 *
 * What may not enter: news, promotion, education, engagement filler. An item
 * exists because a typed fact about this reader's own money changed.
 */
export const ATTENTION_KINDS = [
  "EXACT_REVIEW_REQUEST",
  "DETERMINISTIC_REVIEW",
  "INCOMPLETE_RECONCILIATION",
  "LIQUIDATION_OR_HEALTH_RISK",
  "DELAYED_FUNDS",
  "DEGRADED_PROVIDER",
  "ISSUER_OR_PERMISSION_CHANGE",
  "STRATEGY_TRIGGER",
  "AGENT_BUDGET_THRESHOLD",
  "STALE_OR_CONFLICTING_EVIDENCE",
  "UNREVIEWED_OUTCOME",
] as const;

export type AttentionKind = (typeof ATTENTION_KINDS)[number];

/** Severity is an ordered vocabulary, never a score and never a colour total. */
export const ATTENTION_SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;

export type AttentionSeverity = (typeof ATTENTION_SEVERITIES)[number];

export const ATTENTION_FRESHNESS = ["CURRENT", "STALE", "UNKNOWN", "INVALID"] as const;

export type AttentionFreshness = (typeof ATTENTION_FRESHNESS)[number];

/**
 * One item, carrying everything a reader must be told.
 *
 * `detailHref` is nullable on purpose. A missing destination is a real state —
 * the fact is true and the route for it does not exist yet — and the honest
 * rendering is the item without an action, not a link to a page that 404s. The
 * `actionLabel` is normalized to `null` with it so no caller can compose a
 * button that goes nowhere.
 */
export type AttentionItem = Readonly<{
  id: string;
  kind: AttentionKind;
  severity: AttentionSeverity;
  observedAt: string;
  title: string;
  reason: string;
  sourceRef: string;
  freshness: AttentionFreshness;
  detailHref: string | null;
  actionLabel: string | null;
  /** Why there is no destination, when there is none. Never a dead link. */
  limitation: string | null;
}>;

const PRIORITY = new Map<AttentionKind, number>(ATTENTION_KINDS.map((kind, index) => [kind, index]));
const SEVERITY = new Map<AttentionSeverity, number>(
  ATTENTION_SEVERITIES.map((severity, index) => [severity, index]),
);

function normalize(item: AttentionItem): AttentionItem {
  if (!PRIORITY.has(item.kind)) throw new TypeError("attention item carries an unregistered kind");
  if (!SEVERITY.has(item.severity)) throw new TypeError("attention item carries an unregistered severity");
  if (!ATTENTION_FRESHNESS.includes(item.freshness)) {
    throw new TypeError("attention item carries an unregistered freshness state");
  }
  if (typeof item.id !== "string" || item.id.length === 0) {
    throw new TypeError("attention item requires a stable id");
  }
  /* The same rule the RiskCalculation and freshness layers enforce: an instant
     without an explicit offset means something different on every host, and an
     age tie-breaker computed from it is a different order per machine. */
  if (parseExplicitInstant(item.observedAt) === null) {
    throw new TypeError("attention item requires an explicit-offset observation instant");
  }
  const hasRoute = typeof item.detailHref === "string" && item.detailHref.length > 0;
  return Object.freeze({
    ...item,
    detailHref: hasRoute ? item.detailHref : null,
    actionLabel: hasRoute ? item.actionLabel : null,
    limitation: item.limitation ?? null,
  });
}

/**
 * Canonical order: kind priority → severity → age (oldest first) → stable id.
 *
 * Sorting a copy rather than the argument, and comparing on four total orders
 * rather than three, is what makes two callers with the same facts in different
 * collection order produce byte-identical lists.
 */
export function rankAttention(items: readonly AttentionItem[]): readonly AttentionItem[] {
  const normalized = items.map(normalize);
  const ids = new Set(normalized.map((item) => item.id));
  if (ids.size !== normalized.length) throw new TypeError("attention ids must be unique");
  return Object.freeze(
    normalized.sort((left, right) => {
      const priority = (PRIORITY.get(left.kind) ?? 0) - (PRIORITY.get(right.kind) ?? 0);
      if (priority !== 0) return priority;
      const severity = (SEVERITY.get(left.severity) ?? 0) - (SEVERITY.get(right.severity) ?? 0);
      if (severity !== 0) return severity;
      const age = (parseExplicitInstant(left.observedAt) ?? 0) - (parseExplicitInstant(right.observedAt) ?? 0);
      if (age !== 0) return age;
      return compareCanonicalStrings(left.id, right.id);
    }),
  );
}

/**
 * The dominant item, for a surface that has room for one line.
 *
 * `null` for an empty list rather than a placeholder row: calm is a state Today
 * has to be able to say, and a filler item is exactly what it must never show.
 */
export function dominantAttention(items: readonly AttentionItem[]): AttentionItem | null {
  const ranked = rankAttention(items);
  return ranked.length === 0 ? null : ranked[0];
}
