/**
 * The normalized market-evidence snapshot — one shape every provider's
 * adapter maps into and every surface reads from.
 *
 * Time is three fields, never one. `fetchedAt` is when Ryntra asked;
 * `observedAt` is the provider's own statement of when the data stands as of,
 * and is `null` when the provider states none — the HTTP clock is never
 * written into it; `providerLagSeconds` is the provider's documented response
 * cache for the families behind the snapshot, which bounds how old a "fresh"
 * answer may already be. A card that says *updated just now* would be lying
 * twice; this shape makes it say *asked at 12:31, the source may be up to 30
 * minutes behind*.
 *
 * `expiresAt` is Ryntra's own rule: the moment after which the snapshot is
 * not served from the cache and a plan's required condition counts it stale.
 * It never exceeds the retention the rights map allows.
 *
 * Nothing licensed beyond the listed figures is here by construction: the
 * adapter's mapper reads named fields into named metrics and the raw answer
 * is dropped before this object exists. No address, no label, no row.
 *
 * Pure and client-safe; the contract's zod schema mirrors it.
 */

import type { EvidenceMetricId, EvidenceProvider, EvidenceUnit, EvidenceWindow } from "./metrics.ts";

export const EVIDENCE_NETWORK = "solana:mainnet" as const;

export type EvidenceCoverage =
  /** The source answered the figure for the whole window. */
  | "full"
  /** The source answered with a stated limitation (its warning is in `note`). */
  | "partial"
  /** The source answered without this figure. */
  | "absent";

export type EvidenceMetricValue = Readonly<{
  id: EvidenceMetricId;
  /** `null` when the source answered without the figure — never zero in its place. */
  value: number | null;
  unit: EvidenceUnit;
  window: EvidenceWindow;
  coverage: EvidenceCoverage;
  /** The source's own limitation, in words a person reads; null when none. */
  note: string | null;
}>;

export type EvidenceAttribution = Readonly<{
  /** The wording the provider's terms accept, shown beside every figure. */
  text: string;
  href: string;
}>;

export type MarketEvidenceSnapshot = Readonly<{
  provider: EvidenceProvider;
  subject: Readonly<{ network: typeof EVIDENCE_NETWORK; mint: string; symbol: string | null }>;
  window: EvidenceWindow;
  fetchedAt: string;
  observedAt: string | null;
  providerLagSeconds: number;
  expiresAt: string;
  metrics: readonly EvidenceMetricValue[];
  /** Coverage notes about the whole answer (a family that did not answer, a window the source limits). */
  warnings: readonly string[];
  attribution: EvidenceAttribution;
  /** The rights-map entry the snapshot was filtered under; a reader of an old snapshot can tell which rule shaped it. */
  rightsPolicy: string;
  /** The provider families that answered, for the details disclosure. */
  families: readonly string[];
}>;

export const EVIDENCE_READ_STATES = ["FRESH", "STALE", "UNKNOWN", "UNAVAILABLE"] as const;
export type EvidenceReadState = (typeof EVIDENCE_READ_STATES)[number];

export type EvidenceServedFrom = "provider" | "cache" | "stale-cache" | "none";

/**
 * What a read returns. `FRESH` and `STALE` carry a snapshot; `UNKNOWN` means
 * the provider covers no such token (an honest *not enough data*, never a
 * zero with a green state); `UNAVAILABLE` means the provider, the budget or
 * the rights refused the read, with the reason. `served` says where the
 * answer came from, so a cost never hides behind a cache and a cache never
 * pretends to be a fresh call.
 */
export type MarketEvidenceRead = Readonly<{
  state: EvidenceReadState;
  snapshot: MarketEvidenceSnapshot | null;
  reason: string | null;
  served: EvidenceServedFrom;
}>;

export function metricOf(snapshot: MarketEvidenceSnapshot, id: EvidenceMetricId): EvidenceMetricValue | null {
  return snapshot.metrics.find((metric) => metric.id === id) ?? null;
}

/** Fresh or stale by Ryntra's own expiry, judged at `nowMs`. */
export function snapshotStateAt(snapshot: MarketEvidenceSnapshot, nowMs: number): "FRESH" | "STALE" {
  return Date.parse(snapshot.expiresAt) > nowMs ? "FRESH" : "STALE";
}
