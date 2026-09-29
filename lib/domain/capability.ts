/* Capability & data-state vocabulary — the truth spine of the multi-venue core (STEP 3).
   Three ORTHOGONAL axes replace the single "status" word that conflated them:
     protocol — what the venue/protocol itself offers (live | beta | unavailable)
     ryntra   — what Ryntra has actually shipped against it (live | read-only | paper | planned | blocked)
     user     — whether THIS user may act on it (available | restricted | unknown)
   A capability is only "green" when all three are positive AND the claim is verifiably sourced.
   Pure types + pure policy functions; no I/O. UI layers consume the tones, never re-derive them. */

/** What the venue / on-chain protocol itself offers. */
export type ProtocolMaturity = "live" | "beta" | "unavailable";

/** What Ryntra has actually shipped against it. */
export type RyntraMaturity = "live" | "read-only" | "paper" | "planned" | "blocked";

/** Whether the current user may act (geo / compliance / cohort gates). */
export type UserAccess = "available" | "restricted" | "unknown";

/** How the claim was established. `unverified` exists so a claim can be honest about itself. */
export type CapabilitySource = "live-probe" | "official-docs" | "derived" | "unverified";

export type CapabilityState = {
  protocol: ProtocolMaturity;
  ryntra: RyntraMaturity;
  user: UserAccess;
  /** YYYY-MM-DD of the last verification of this claim. */
  verifiedAt: string;
  source: CapabilitySource;
  /** Human note: WHY it is gated/planned/blocked (e.g. "perps cohort-gated by Arcus"). */
  reason?: string;
};

/** Freshness/consistency of a piece of market or account data. */
export type DataState = "fresh" | "stale" | "unknown" | "conflicting";

/** How price discovery works on a route. Determines which visualizations are honest. */
export type MarketStructure = "rfq" | "clob" | "amm" | "oracle-execution";

/** How an order is authorized. Ryntra never holds withdrawal-capable credentials. */
export type ExecutionMode = "wallet-signed" | "client-api-key" | "server-agent-key" | "oauth-broker";

/** UI tone vocabulary. "ok" is the ONLY green; policy below guards who may claim it. */
export type UiTone = "ok" | "caution" | "danger" | "neutral";

/**
 * Tone for a data state. INVARIANT (tested): stale / unknown / conflicting are NEVER "ok" —
 * a gap in knowledge must never render as safety.
 */
export function dataTone(state: DataState): UiTone {
  switch (state) {
    case "fresh":
      return "ok";
    case "stale":
      return "caution";
    case "unknown":
      return "caution";
    case "conflicting":
      return "danger";
  }
}

/** True when the state may not be presented as safe/green under any styling. */
export function neverSafe(state: DataState): boolean {
  return state !== "fresh";
}

/**
 * Tone for a capability. INVARIANT (tested): "ok" requires protocol=live AND ryntra=live AND
 * user=available AND a verifiable source. Anything unknown or unverified caps at "caution";
 * blocked/unavailable/restricted read as "danger".
 */
export function capabilityTone(c: CapabilityState): UiTone {
  if (c.protocol === "unavailable" || c.ryntra === "blocked" || c.user === "restricted") return "danger";
  if (c.ryntra === "planned") return "neutral"; // roadmap, not a warning
  if (c.source === "unverified" || c.user === "unknown") return "caution";
  if (c.protocol === "live" && c.ryntra === "live") return "ok"; // user=available guaranteed above
  if (c.ryntra === "read-only" || c.ryntra === "paper") return "neutral"; // shipped, just not execution
  return "caution"; // e.g. protocol beta under a live surface
}

/**
 * Order-book style visualizations (DOM, tape, footprint, heatmap, volume profile) are honest
 * ONLY for CLOB structures. RFQ/AMM/oracle execution have no resting book — rendering one
 * would be fabricated market structure.
 */
export function orderbookAllowed(structure: MarketStructure): boolean {
  return structure === "clob";
}

/** Threshold-based freshness: observedAt (unix ms) vs now, else unknown when unmeasured. */
export function freshnessOf(observedAt: number | null | undefined, nowMs: number, staleAfterMs: number): DataState {
  if (observedAt == null || !Number.isFinite(observedAt) || observedAt <= 0) return "unknown";
  if (nowMs - observedAt <= staleAfterMs) return "fresh";
  return "stale";
}

/** Merge freshness across sources: any conflict dominates, then unknown, then stale. */
export function combineDataStates(states: readonly DataState[]): DataState {
  if (states.length === 0) return "unknown";
  if (states.includes("conflicting")) return "conflicting";
  if (states.includes("unknown")) return "unknown";
  if (states.includes("stale")) return "stale";
  return "fresh";
}
