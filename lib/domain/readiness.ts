/* Trade Readiness Record + the deterministic readiness policy engine (STEP 3/5).
   The workflow is: instrument → route → risk snapshot → plan → size → stop/invalidation →
   compliance → execution intent. `evaluateReadiness` is a PURE function — same inputs, same
   verdict, no LLM in the decision path. An AI layer may EXPLAIN a verdict later; it may never
   produce one. INVARIANTS (tested):
     - blocked compliance or any blocker signal → not-ready
     - unknown/stale/conflicting anywhere → verdict can never be "ready"
     - no stop / no thesis → not-ready (discipline gate, same bar as the paper terminal)
     - a live intent on a route Ryntra hasn't shipped live → not-ready */

import type { CapabilityState, DataState, ExecutionMode } from "./capability.ts";
import { neverSafe } from "./capability.ts";
import type { RouteId } from "./ids.ts";
import { ROUTES } from "./ids.ts";
import type { InstrumentKey } from "./instrument.ts";
// Runtime import is one-directional (registry's import of RouteCapabilityClaim is type-only,
// erased at runtime) — no cycle. The registry is the truth the engine cross-checks against.
import { ROUTE_CAPABILITIES } from "./registry.ts";

export type RiskSignalSeverity = "info" | "caution" | "blocker";

/** One named risk observation with explicit provenance and freshness. */
export type RiskSignal = {
  /** Stable id, e.g. "oracle-freshness", "market-hours", "spread", "concentration". */
  id: string;
  label: string;
  state: DataState;
  /** Raw observed value; null when unmeasured (never fake a value). */
  value: string | number | boolean | null;
  severity: RiskSignalSeverity;
  /** Provenance, e.g. "arcus:/v1/markets", "chainlink:feed 0x…", "derived:portfolio". */
  source: string;
  /** Unix ms when observed; null when unmeasured. */
  observedAt: number | null;
};

/** What the user intends to execute. Idempotency key is minted ONCE per intent and reused on retries. */
export type ExecutionIntent = {
  kind: "spot-swap" | "perp-order" | "paper-order";
  route: RouteId;
  instrument: InstrumentKey;
  side: "buy" | "sell";
  /** Decimal string in venue units — never floats for sizes. */
  size: string;
  limitPrice: string | null;
  executionMode: ExecutionMode;
  idempotencyKey: string;
  createdAt: number;
};

export type ComplianceDecision = {
  status: "allowed" | "blocked" | "unknown";
  source: "arcus-compliance-api" | "geo-static" | "unverified";
  checkedAt: number | null;
  reason?: string;
};

export type TradePlan = {
  /** Why enter — the discipline gate requires a real thesis (min 10 chars, terminal parity). */
  thesis: string;
  entry: string | null;
  /** Hard stop is REQUIRED for readiness; invalidation is the structural reason behind it. */
  stop: string | null;
  invalidation: string | null;
  targets: string[];
  /** Planned risk as % of account/bankroll, when sized. */
  riskPct: number | null;
};

export type ReadinessLevel = "ready" | "caution" | "not-ready";

export type ReadinessVerdict = {
  level: ReadinessLevel;
  /** Machine-stable reason codes, most severe first. UI localizes; the codes are the audit log. */
  reasons: string[];
};

/**
 * A capability claim STRUCTURALLY BOUND to the route it describes. Callers obtain it via
 * `claimFor(route)` (lib/domain/registry.ts) so a generic "live" capability can never be
 * hand-attached to a different route. The evaluator re-checks the binding at runtime — a
 * cast-in claim with a missing/foreign/unknown route blocks, it never slips through.
 */
export type RouteCapabilityClaim = {
  route: RouteId;
  state: CapabilityState;
};

/** The single record the workflow produces; journal + execution both reference it. */
export type TradeReadinessRecord = {
  id: string;
  instrument: InstrumentKey;
  capability: RouteCapabilityClaim;
  signals: RiskSignal[];
  plan: TradePlan;
  compliance: ComplianceDecision;
  intent: ExecutionIntent | null;
  verdict: ReadinessVerdict;
  createdAt: number;
  updatedAt: number;
};

export const MIN_THESIS_LENGTH = 10;

/**
 * Which discipline fields the workflow REQUIRES depends on what the user is doing:
 * a planned trade demands a thesis + stop; a plain spot conversion does not. The policy type
 * spells that out — no implicit "everything is a trade" assumption.
 */
export type ReadinessPolicy = {
  /** Hard cap on planned risk % of account; above it → not-ready. Must be finite and > 0. */
  maxRiskPct: number;
  requiresThesis: boolean;
  requiresStop: boolean;
};

/** Planned trade (SmartTrade/paper): full discipline gate. */
export const PLANNED_TRADE_POLICY: ReadinessPolicy = { maxRiskPct: 2, requiresThesis: true, requiresStop: true };

/** Spot swap (asset conversion): capability/compliance/signals still gate; thesis+stop do not. */
export const SPOT_SWAP_POLICY: ReadinessPolicy = { maxRiskPct: 100, requiresThesis: false, requiresStop: false };

export const DEFAULT_READINESS_POLICY: ReadinessPolicy = PLANNED_TRADE_POLICY;

type ReadinessInput = {
  capability: RouteCapabilityClaim;
  signals: readonly RiskSignal[];
  plan: TradePlan;
  compliance: ComplianceDecision;
  intent: ExecutionIntent | null;
};

const validPositive = (n: number): boolean => Number.isFinite(n) && n > 0;

/** Own-property route lookup — `in` would accept prototype names ("toString", "constructor"). */
const knownRoute = (route: unknown): route is RouteId =>
  typeof route === "string" && Object.hasOwn(ROUTES, route);

/**
 * VENUE-LEVEL capability facts (protocol/ryntra/source) must MATCH the registry — a caller can
 * never fabricate a more permissive claim for a real route. `user` is deliberately excluded:
 * it is a PER-USER refinement (the registry says "unknown" until compliance resolves it).
 */
const matchesRegistry = (cap: CapabilityState, reg: CapabilityState): boolean =>
  cap.protocol === reg.protocol && cap.ryntra === reg.ryntra && cap.source === reg.source;

/**
 * Deterministic policy engine. Returns the verdict AND the ordered reason codes so the UI and
 * the journal can show exactly why. Never consults anything but its arguments.
 * BINDING IS UNBYPASSABLE: the capability claim carries its route; a claim whose route is
 * missing (runtime cast), unknown to the registry, or different from the intent's route blocks.
 */
export function evaluateReadiness(
  input: ReadinessInput,
  policy: ReadinessPolicy = DEFAULT_READINESS_POLICY
): ReadinessVerdict {
  const blockers: string[] = [];
  const cautions: string[] = [];

  // A malformed policy can never yield ready — validate it before it validates anything else.
  if (!validPositive(policy.maxRiskPct)) blockers.push("invalid-policy");

  // Route/capability binding — checked for EVERY intent (a mismatch is a caller bug, not a
  // live-only concern) and against the runtime route registry via OWN-property lookup
  // (prototype names like "toString" must not pass; runtime casts don't slip by).
  const claimRoute = input.capability?.route;
  const claimKnown = knownRoute(claimRoute);
  if (!claimKnown) blockers.push("unknown-route");
  if (input.intent != null) {
    if (!knownRoute(input.intent.route)) blockers.push("unknown-route:intent");
    if (input.intent.route !== claimRoute) blockers.push("route-capability-mismatch");
    // The instrument must live on the chain the route executes on — structural, not advisory.
    if (claimKnown && input.intent.instrument.chain !== ROUTES[claimRoute].chain)
      blockers.push("instrument-chain-mismatch");
  }

  // Compliance is a gate, not a signal: blocked kills, unknown can never be green.
  if (input.compliance.status === "blocked") blockers.push("compliance-blocked");
  else if (input.compliance.status === "unknown") cautions.push("compliance-unknown");

  // Capability truth: a LIVE intent needs a route Ryntra actually shipped live for this user,
  // and the claim itself must be verifiable — an unverified source can never authorize execution.
  // A MISSING state is the least verifiable claim of all: it blocks, it never skips the checks.
  const live = input.intent != null && input.intent.kind !== "paper-order";
  const cap = input.capability?.state;
  if (live) {
    if (cap == null) blockers.push("missing-capability-state");
    else {
      // Venue-level facts must match the registry — a fabricated "live" claim for a route the
      // registry holds as read-only/planned can never authorize execution.
      if (claimKnown && !matchesRegistry(cap, ROUTE_CAPABILITIES[claimRoute]))
        blockers.push("capability-state-mismatch");
      if (cap.ryntra !== "live") blockers.push("route-not-live-on-ryntra");
      if (cap.protocol !== "live") blockers.push("protocol-not-live");
      if (cap.source === "unverified") blockers.push("capability-unverified");
      if (cap.user === "restricted") blockers.push("user-restricted");
      else if (cap.user === "unknown") cautions.push("user-access-unknown");
    }
  }

  // Discipline gate — what is REQUIRED comes from the policy (planned trade vs spot swap).
  if (policy.requiresStop && !input.plan.stop) blockers.push("missing-stop");
  if (policy.requiresThesis && input.plan.thesis.trim().length < MIN_THESIS_LENGTH) blockers.push("missing-thesis");
  // Risk, when stated, must be a real number: NaN/Infinity/zero/negative can never be ready.
  if (input.plan.riskPct != null) {
    if (!validPositive(input.plan.riskPct)) blockers.push("invalid-risk");
    else if (input.plan.riskPct > policy.maxRiskPct) blockers.push("risk-above-policy");
  }

  // Signals: blockers kill; any non-fresh state caps the verdict at caution.
  for (const s of input.signals) {
    if (s.severity === "blocker") blockers.push(`signal-blocker:${s.id}`);
    else if (s.severity === "caution") cautions.push(`signal-caution:${s.id}`);
    if (neverSafe(s.state)) cautions.push(`signal-${s.state}:${s.id}`);
  }

  if (blockers.length > 0) return { level: "not-ready", reasons: [...blockers, ...cautions] };
  if (cautions.length > 0) return { level: "caution", reasons: cautions };
  return { level: "ready", reasons: [] };
}
