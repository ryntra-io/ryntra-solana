/**
 * The evidence envelope, enforced by the type system rather than by discipline.
 *
 * The product's whole claim is that a number arrives with its provenance. A
 * convention cannot carry that: `sources?: Source[]` compiles perfectly with
 * nobody having filled it in, and the value renders anyway. So the envelope is
 * a discriminated union whose **resolved branch cannot be constructed without
 * at least one source** — the tuple type `readonly [Source, ...Source[]]` makes
 * an empty array a compile error — and whose unresolved branch **cannot be
 * constructed without a reason**.
 *
 * The consequence is deliberate and slightly inconvenient: reading `.data`
 * requires narrowing first. That inconvenience is the feature. A caller cannot
 * accidentally render an unavailable value as a blank, because there is no
 * `.data` to render until they have acknowledged the state.
 */

/**
 * The five states, as a value.
 *
 * The type alone cannot be rendered, so every surface that wanted to show the
 * vocabulary retyped it — and a retyped vocabulary is how a document ends up
 * naming states the code stopped using — the exact drift this repository had
 * to repair once. The type is derived from this array rather than the other way
 * round, so adding a state to one and forgetting the other is a compile error.
 */
export const EVIDENCE_STATES = ["FRESH", "STALE", "CONFLICTING", "UNKNOWN", "UNAVAILABLE"] as const;

export type EvidenceState = (typeof EVIDENCE_STATES)[number];

export type EvidenceSource = Readonly<{
  /** Machine reference, e.g. `solana:mainnet:getAccountInfo:<mint>`. */
  ref: string;
  /** What answered, in words a person reads on a receipt. */
  label: string;
}>;

/** At least one source. The tuple shape is the enforcement. */
export type EvidenceSources = readonly [EvidenceSource, ...EvidenceSource[]];

export type ResolvedEvidence<T> = Readonly<{
  state: "FRESH" | "STALE";
  data: T;
  sources: EvidenceSources;
  /** ISO-8601, the moment the source observed the value — not when we asked. */
  observedAt: string;
  ageSeconds: number;
  maxAgeSeconds: number;
}>;

export type UnresolvedEvidence = Readonly<{
  state: "CONFLICTING" | "UNKNOWN" | "UNAVAILABLE";
  data: null;
  /** May be empty: a read that never reached a source has none to name. */
  sources: readonly EvidenceSource[];
  observedAt: string;
  /** Never optional. A failure that does not say why is a failure twice. */
  reason: string;
}>;

export type Evidence<T> = ResolvedEvidence<T> | UnresolvedEvidence;

export function isResolved<T>(evidence: Evidence<T>): evidence is ResolvedEvidence<T> {
  return evidence.state === "FRESH" || evidence.state === "STALE";
}

/**
 * Build a resolved value.
 *
 * `FRESH` versus `STALE` is **computed** from the observation time and the
 * caller's freshness budget. It is never a parameter, because a hand-written
 * `state: "FRESH"` is exactly the claim this module exists to prevent someone
 * from making by accident.
 */
export function resolved<T>(input: {
  data: T;
  sources: EvidenceSources;
  observedAt: string | Date;
  maxAgeSeconds: number;
  now?: Date;
}): ResolvedEvidence<T> {
  const observed = input.observedAt instanceof Date ? input.observedAt : new Date(input.observedAt);
  const now = input.now ?? new Date();
  /* Clamped at zero on purpose. A source clock slightly ahead of ours produces
     a negative age, and a negative age is not "extra fresh" — it is an unknown
     skew, and reporting it as a negative number invites arithmetic on it. */
  const ageSeconds = Math.max(0, Math.round((now.getTime() - observed.getTime()) / 1000));
  return {
    state: ageSeconds <= input.maxAgeSeconds ? "FRESH" : "STALE",
    data: input.data,
    sources: input.sources,
    observedAt: observed.toISOString(),
    ageSeconds,
    maxAgeSeconds: input.maxAgeSeconds,
  };
}

/** The source was reached and could not answer, or answered unusably. */
export function unavailable(reason: string, sources: readonly EvidenceSource[] = [], now?: Date): UnresolvedEvidence {
  return { state: "UNAVAILABLE", data: null, sources, observedAt: (now ?? new Date()).toISOString(), reason };
}

/** No source exists for this fact yet. Different from one that failed. */
export function unknown(reason: string, sources: readonly EvidenceSource[] = [], now?: Date): UnresolvedEvidence {
  return { state: "UNKNOWN", data: null, sources, observedAt: (now ?? new Date()).toISOString(), reason };
}

/** Two sources answered and disagreed. Never silently pick one. */
export function conflicting(reason: string, sources: readonly EvidenceSource[], now?: Date): UnresolvedEvidence {
  return { state: "CONFLICTING", data: null, sources, observedAt: (now ?? new Date()).toISOString(), reason };
}

/**
 * Transform a resolved value, carrying provenance through unchanged.
 *
 * Provenance survives derivation. A number computed from sourced inputs is
 * still sourced, and losing that on the way through a mapper is how a derived
 * figure ends up looking like an assertion.
 */
export function mapEvidence<T, U>(evidence: Evidence<T>, transform: (value: T) => U): Evidence<U> {
  if (!isResolved(evidence)) return evidence;
  return { ...evidence, data: transform(evidence.data) };
}

/** The wire shape. `data` is `null` unless the value resolved. */
export function toEnvelope<T>(evidence: Evidence<T>): {
  data: T | null;
  sources: readonly EvidenceSource[];
  as_of: string;
  state: EvidenceState;
  reason?: string;
} {
  return isResolved(evidence)
    ? { data: evidence.data, sources: evidence.sources, as_of: evidence.observedAt, state: evidence.state }
    : { data: null, sources: evidence.sources, as_of: evidence.observedAt, state: evidence.state, reason: evidence.reason };
}
