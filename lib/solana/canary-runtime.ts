import {
  SOLANA_CANARY_FALLBACK_POLICY_ID,
  resolveSolanaCanaryPolicy,
  SolanaCanaryPolicySchema,
  solanaCanaryPolicyDigest,
  type SolanaCanaryPolicy,
} from "./canary-policy.ts";

/**
 * What the owner-canary policy is when it cannot be read, and who that answer
 * is allowed to serve.
 *
 * ## The problem this exists for
 *
 * `resolveSolanaCanaryPolicy` reads the operator's own experiment configuration
 * and fails when any of it is malformed. Five customer-path routes resolved it
 * and refused `503` on failure, so a typo in a variable that describes a
 * twenty-dollar internal experiment refused **every stranger's transfer**. The
 * canary is an internal instrument; it may not decide an ordinary action.
 *
 * ## The answer, and the two halves it must keep apart
 *
 * A deterministic closed policy — decided on 2026-09-03, taking the fallback
 * over a new verdict schema version so no signed artifact is re-versioned for
 * this. But a fallback that quietly stands in for a healthy policy would be
 * worse than the refusal it replaces, so it is a **declared degraded state**
 * with a hard line through the middle:
 *
 * - **CUSTOMER** — proceeds. Admission is decided by the safety, support and
 *   capability contracts, exactly as it already was; the canary verdict is
 *   recorded as a bound artifact and consulted for nothing.
 * - **OWNER_CANARY** — fails closed. No wallet, no reservation, no submit.
 *
 * The flow is **declared by the caller**, never derived from the policy. That is
 * the whole point: with empty allowlists every action reads `OUTSIDE_ENVELOPE`,
 * so an owner canary would otherwise slip through wearing a customer's clothes
 * and spend real money with no accounting behind it.
 *
 * ## Why the closed policy produces an honest verdict on its own
 *
 * Nothing here fakes a verdict. The fallback is a real policy artifact and the
 * existing evaluator reads it the way it reads any other:
 *
 * - `state: "PAUSED"` makes `EMERGENCY_STOP` a `PAUSE`, so the decision is
 *   `PAUSE` and `newRiskAllowed` is false;
 * - empty allowlists fail every membership rule, so the scope is
 *   `OUTSIDE_ENVELOPE`, decided by `TRANSFER_CAPABILITY`;
 * - a `policyId` no budget snapshot can match keeps `CONFIG_VALID` at
 *   `UNKNOWN` — never `PASS`, so the signed bundle cannot claim a healthy
 *   configuration;
 * - `totalLimitUsdMicros: "0"` means there is no ceiling to reserve against.
 *
 * The digest follows from the artifact, so it is deterministic and distinct
 * from any production policy without a second hashing path.
 */

/**
 * Unmistakable, and never a production policy id.
 *
 * Declared in `canary-policy.ts` and re-exported here: the evaluator has to
 * recognise it to keep `CONFIG_VALID` off `PASS`, and it may not import this
 * module. One constant, two readers.
 */
export const CANARY_FALLBACK_POLICY_ID = SOLANA_CANARY_FALLBACK_POLICY_ID;

export const CANARY_FALLBACK_DETAIL =
  "Runtime owner-canary policy could not be read. A deterministic closed fallback was used. Customer execution is unaffected; owner canaries are disabled.";

const CLOSED_FAMILY = {
  minimumUsdMicros: "0",
  maximumUsdMicros: "0",
  allowedDestinations: [],
  allowedMints: [],
  allowedPrograms: [],
  requireHumanApproval: true,
} as const;

export const CANARY_FALLBACK_POLICY: SolanaCanaryPolicy = SolanaCanaryPolicySchema.parse({
  schema: "ryntra.solana.canary-policy",
  schemaVersion: "1.0.0",
  policyId: CANARY_FALLBACK_POLICY_ID,
  state: "PAUSED",
  totalLimitUsdMicros: "0",
  valuationMaxAgeSeconds: 1,
  families: {
    SEND: CLOSED_FAMILY,
    ATA_CREATE: CLOSED_FAMILY,
    SWAP: CLOSED_FAMILY,
    CCTP: CLOSED_FAMILY,
    TOKEN_2022: CLOSED_FAMILY,
  },
  source: {
    ref: "ryntra:canary-policy:fallback-closed",
    label: "Deterministic closed fallback — the runtime owner-canary policy could not be read",
  },
});

/** Which half of the product is asking. Declared, never inferred. */
export const CANARY_FLOWS = ["CUSTOMER", "OWNER_CANARY"] as const;
export type CanaryFlow = (typeof CANARY_FLOWS)[number];

export const CANARY_RUNTIME_MODES = ["STRICT", "FALLBACK_CLOSED"] as const;
export type CanaryRuntimeMode = (typeof CANARY_RUNTIME_MODES)[number];

export type CanaryRuntime = Readonly<{
  mode: CanaryRuntimeMode;
  policy: SolanaCanaryPolicy;
  policyDigest: string;
  /** The exact parse failure, for the operator's own surface and the log. */
  reason: string | null;
  checkedAt: string;
}>;

/**
 * Read the owner-canary policy, and say plainly when the answer is a fallback.
 *
 * Total: this never throws and never refuses. A caller that must refuse asks
 * {@link canaryFlowPermitted} instead, which is where the customer/owner line
 * lives.
 */
export function resolveCanaryRuntime(
  env: Record<string, string | undefined> = process.env,
  now: Date = new Date(),
): CanaryRuntime {
  const resolved = resolveSolanaCanaryPolicy(env);
  if (resolved.ok) {
    return {
      mode: "STRICT",
      policy: resolved.policy,
      policyDigest: solanaCanaryPolicyDigest(resolved.policy),
      reason: null,
      checkedAt: now.toISOString(),
    };
  }
  return {
    mode: "FALLBACK_CLOSED",
    policy: CANARY_FALLBACK_POLICY,
    policyDigest: solanaCanaryPolicyDigest(CANARY_FALLBACK_POLICY),
    reason: resolved.reason,
    checkedAt: now.toISOString(),
  };
}

export type CanaryFlowDecision =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; code: "OWNER_CANARY_UNAVAILABLE"; reason: string }>;

/**
 * The line between the two halves.
 *
 * A customer is never refused for the state of the operator's configuration. An
 * owner canary is never permitted while that configuration is unreadable —
 * because the fallback's empty allowlists would place its own action outside
 * the envelope, which is exactly how a real canary would spend real money with
 * no reservation, no ceiling and no ledger entry behind it.
 */
export function canaryFlowPermitted(runtime: CanaryRuntime, flow: CanaryFlow): CanaryFlowDecision {
  if (flow === "CUSTOMER" || runtime.mode === "STRICT") return { ok: true };
  return {
    ok: false,
    code: "OWNER_CANARY_UNAVAILABLE",
    reason:
      "The owner-canary policy configuration could not be read, so owner canaries are disabled until it parses again. " +
      (runtime.reason ?? ""),
  };
}

/** Whether the canary may touch its ledger at all. Never under a fallback. */
export function canaryLedgerWritable(runtime: CanaryRuntime): boolean {
  return runtime.mode === "STRICT";
}

export type CanaryRuntimeReport = Readonly<{
  state: "HEALTHY" | "DEGRADED";
  label: string;
  customerMoneyFlows: "UNAFFECTED";
  ownerCanaries: "ENABLED" | "DISABLED";
  budgetWrites: "ENABLED" | "DISABLED";
  reason: string | null;
  checkedAt: string;
}>;

/**
 * What the operator's own surface shows, and what the log line carries.
 *
 * `customerMoneyFlows` is a constant rather than a computation, and that is the
 * claim being made: no state of this runtime changes what a customer can do.
 * If that ever becomes conditional, this type stops compiling, which is the
 * point of writing it as a literal.
 */
export function describeCanaryRuntime(runtime: CanaryRuntime): CanaryRuntimeReport {
  const degraded = runtime.mode === "FALLBACK_CLOSED";
  return {
    state: degraded ? "DEGRADED" : "HEALTHY",
    label: degraded ? "DEGRADED · FALLBACK CLOSED" : "HEALTHY",
    customerMoneyFlows: "UNAFFECTED",
    ownerCanaries: degraded ? "DISABLED" : "ENABLED",
    budgetWrites: degraded ? "DISABLED" : "ENABLED",
    reason: runtime.reason,
    checkedAt: runtime.checkedAt,
  };
}

/**
 * Say it once per instance and per transition, not once per request.
 *
 * A degraded policy is read on every plan, and a line per request would bury
 * the transition that matters in a flood of copies of itself. Serverless
 * instances are short-lived, so this repeats across them — which is the right
 * side to be wrong on: an under-reported outage is worse than a duplicated one.
 */
let lastReported: string | null = null;

export function reportCanaryRuntime(
  runtime: CanaryRuntime,
  sink: (line: string) => void = console.error,
): boolean {
  const report = describeCanaryRuntime(runtime);
  const key = `${report.state}:${report.reason ?? ""}`;
  if (key === lastReported) return false;
  lastReported = key;
  sink(
    "[solana-canary] " +
      JSON.stringify({
        event: "owner_canary_policy_state",
        state: report.state,
        ownerCanaries: report.ownerCanaries,
        budgetWrites: report.budgetWrites,
        customerMoneyFlows: report.customerMoneyFlows,
        reason: report.reason,
        checkedAt: report.checkedAt,
      }),
  );
  return true;
}

/** Test-only: forget what was last reported. */
export function resetCanaryRuntimeReporting(): void {
  lastReported = null;
}

/** The header a caller uses to declare it is running an owner canary. */
export const CANARY_FLOW_HEADER = "x-ryntra-canary-flow";

/**
 * Which half of the product is asking, read from the request and from nothing
 * else.
 *
 * Deliberately not derived from the policy, the allowlists or the verdict. Under
 * a closed fallback every action reads `OUTSIDE_ENVELOPE`, so a mode inferred
 * from scope would call an owner canary a customer and let it spend real money
 * with no reservation behind it — the exact substitution the closed policy of
 * 2026-09-03 forbids.
 *
 * Absent or unrecognised means `CUSTOMER`. That is the safe default in this
 * direction: a customer is never refused for the operator's configuration, and a
 * caller that wants owner-canary accounting has to say so, which is the only
 * request this can refuse.
 */
export function readCanaryFlow(headers: Headers): CanaryFlow {
  return headers.get(CANARY_FLOW_HEADER)?.trim().toUpperCase() === "OWNER_CANARY"
    ? "OWNER_CANARY"
    : "CUSTOMER";
}
