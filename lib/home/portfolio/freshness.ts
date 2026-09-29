export type FreshnessPolicy = Readonly<{
  maxAgeSeconds: number | null;
}>;

export type FreshnessResult =
  | Readonly<{ state: "CURRENT"; effectiveValidUntil: string }>
  | Readonly<{
      state: "STALE";
      effectiveValidUntil: string | null;
      reason: "EXPIRED" | "FRESHNESS_BOUNDARY_UNKNOWN";
    }>
  | Readonly<{
      state: "INVALID";
      code: "INVALID_TIME" | "FUTURE_OBSERVATION" | "INVALID_VALIDITY_WINDOW" | "INVALID_MAX_AGE";
    }>;

type FreshnessErrorCode = Extract<FreshnessResult, { state: "INVALID" }>["code"];

const EXPLICIT_OFFSET_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export function parseExplicitInstant(value: string): number | null {
  if (typeof value !== "string" || value.length > 40 || !EXPLICIT_OFFSET_INSTANT.test(value)) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function maxAgeMilliseconds(policy: FreshnessPolicy): number | null | "INVALID" {
  if (policy.maxAgeSeconds === null) return null;
  if (!Number.isInteger(policy.maxAgeSeconds) || policy.maxAgeSeconds < 0) return "INVALID";
  const value = policy.maxAgeSeconds * 1000;
  return Number.isSafeInteger(value) ? value : "INVALID";
}

function boundary(input: {
  observedAt: string;
  validUntil: string | null;
  policy: FreshnessPolicy;
}): { ok: true; observed: number; boundary: number | null } | { ok: false; code: FreshnessErrorCode } {
  const observed = parseExplicitInstant(input.observedAt);
  const explicit = input.validUntil === null ? null : parseExplicitInstant(input.validUntil);
  if (observed === null || (input.validUntil !== null && explicit === null)) {
    return { ok: false, code: "INVALID_TIME" };
  }
  if (explicit !== null && explicit < observed) {
    return { ok: false, code: "INVALID_VALIDITY_WINDOW" };
  }
  const age = maxAgeMilliseconds(input.policy);
  if (age === "INVALID") return { ok: false, code: "INVALID_MAX_AGE" };
  const policyBoundary = age === null ? null : observed + age;
  if (policyBoundary !== null && !Number.isSafeInteger(policyBoundary)) {
    return { ok: false, code: "INVALID_MAX_AGE" };
  }
  const candidates = [explicit, policyBoundary].filter((value): value is number => value !== null);
  return { ok: true, observed, boundary: candidates.length ? Math.min(...candidates) : null };
}

export function effectiveValidUntil(input: {
  observedAt: string;
  validUntil: string | null;
  policy: FreshnessPolicy;
}): string | null {
  const result = boundary(input);
  if (!result.ok) throw new TypeError(result.code);
  return result.boundary === null ? null : new Date(result.boundary).toISOString();
}

export function evaluateFreshness(input: {
  observedAt: string;
  validUntil: string | null;
  policy: FreshnessPolicy;
  asOf: string;
}): FreshnessResult {
  const result = boundary(input);
  const asOf = parseExplicitInstant(input.asOf);
  if (asOf === null) return { state: "INVALID", code: "INVALID_TIME" };
  if (!result.ok) return { state: "INVALID", code: result.code };
  if (result.observed > asOf) return { state: "INVALID", code: "FUTURE_OBSERVATION" };
  if (result.boundary === null) {
    return { state: "STALE", effectiveValidUntil: null, reason: "FRESHNESS_BOUNDARY_UNKNOWN" };
  }
  const effectiveValidUntil = new Date(result.boundary).toISOString();
  return asOf <= result.boundary
    ? { state: "CURRENT", effectiveValidUntil }
    : { state: "STALE", effectiveValidUntil, reason: "EXPIRED" };
}
