import { z } from "zod";

import {
  GUARD_CAS_MAX_ATTEMPTS,
  withBoundedCasRetry,
  type GuardStore,
  type GuardVersionedCollection,
} from "../guard/store.ts";
import type { AgentPrincipal } from "./tenancy.ts";

/**
 * Durable quotas — the counter that survives a cold start and is shared between
 * instances.
 *
 * What this replaces is stated exactly, because the difference is the point.
 * `consumeAgentControlRequest` in `./http.ts` is a module-level
 * `FixedWindowLimiter`: correct arithmetic over the wrong scope. Two warm
 * instances each hold their own map, so a caller receives the limit once per
 * instance; a cold start hands the whole window back; and nothing an operator
 * reads afterwards says how much anybody actually used. That is best effort,
 * and best effort is the honest name for it — it is still a useful floor
 * against a single hot loop, and it stays as one.
 *
 * The durable meter is the authority. It keeps one record per
 * (principal, window) in the configured Guard store and advances it through
 * `compareAndSet`, so two instances racing on the same window produce one
 * increment rather than two. `insertIfAbsent` opens the window; the loser of
 * that race re-reads and joins the winner's record instead of starting a second
 * one.
 *
 * **A quota you cannot count is not a quota.** When the store cannot be reached
 * the meter refuses with `QUOTA_UNAVAILABLE` rather than allowing. Degrading to
 * "allow" would remove the control at exactly the moment infrastructure is
 * unhealthy, which is when an unbounded caller does the most damage. Production
 * already refuses to boot Agent Control without a durable store
 * (`assertAgentControlPersistence`), so this adds no failure mode that was not
 * already fatal there — it makes the same requirement visible per request.
 *
 * No migration. `GUARD_COLLECTIONS` gained `agentQuotas`, and the Postgres
 * adapter is one table keyed by `(collection, key)`.
 */

export const AGENT_QUOTA_REFUSALS = ["QUOTA_UNAVAILABLE", "QUOTA_CONTENDED"] as const;

export type AgentQuotaRefusal = (typeof AGENT_QUOTA_REFUSALS)[number];

export class QuotaUnavailableError extends Error {
  readonly reasonCode: AgentQuotaRefusal;

  constructor(reasonCode: AgentQuotaRefusal, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "QuotaUnavailableError";
    this.reasonCode = reasonCode;
  }
}

export type AgentQuotaPolicy = Readonly<{ limit: number; windowSeconds: number }>;

/**
 * The declared policies.
 *
 * An anonymous caller keeps the same 12/60s the edge firewall enforces, so the
 * advertised headers, the durable meter and the two Vercel Firewall rules still
 * tell one story. An identified tenant is worth more because Ryntra knows who
 * to talk to when they are wrong — that is the entire commercial content of
 * "identity before anything hosted", and it is one number rather than a tier
 * table nobody has sold yet.
 */
export const AGENT_QUOTA_POLICIES = {
  ANONYMOUS: { limit: 12, windowSeconds: 60 },
  TENANT: { limit: 120, windowSeconds: 60 },
} as const satisfies Record<string, AgentQuotaPolicy>;

export function quotaPolicyFor(principal: AgentPrincipal | null): AgentQuotaPolicy {
  return principal ? AGENT_QUOTA_POLICIES.TENANT : AGENT_QUOTA_POLICIES.ANONYMOUS;
}

export const AgentQuotaRecordSchema = z
  .object({
    version: z.number().int().nonnegative(),
    principal: z.string().min(1).max(256),
    windowStartMs: z.number().int().nonnegative(),
    windowSeconds: z.number().int().positive(),
    limit: z.number().int().positive(),
    used: z.number().int().nonnegative(),
  })
  .strict();

export type AgentQuotaRecord = z.output<typeof AgentQuotaRecordSchema>;

export type AgentQuotaDecision = Readonly<{
  allowed: boolean;
  principal: string;
  limit: number;
  remaining: number;
  used: number;
  windowSeconds: number;
  resetAtMs: number;
  retryAfterSeconds: number;
}>;

export type AgentQuotaMeter = Readonly<{
  consume(input: {
    principal: string;
    policy: AgentQuotaPolicy;
    nowMs: number;
  }): Promise<AgentQuotaDecision>;
  peek(input: {
    principal: string;
    policy: AgentQuotaPolicy;
    nowMs: number;
  }): Promise<AgentQuotaDecision>;
}>;

function windowStart(nowMs: number, windowSeconds: number): number {
  const windowMs = windowSeconds * 1_000;
  return Math.floor(nowMs / windowMs) * windowMs;
}

function decisionFrom(
  record: AgentQuotaRecord,
  nowMs: number,
  allowed: boolean,
): AgentQuotaDecision {
  const resetAtMs = record.windowStartMs + record.windowSeconds * 1_000;
  return {
    allowed,
    principal: record.principal,
    limit: record.limit,
    used: record.used,
    remaining: Math.max(0, record.limit - record.used),
    windowSeconds: record.windowSeconds,
    resetAtMs,
    retryAfterSeconds: Math.max(1, Math.ceil((resetAtMs - nowMs) / 1_000)),
  };
}

export function createAgentQuotaMeter(store: GuardStore): AgentQuotaMeter {
  function collection(): GuardVersionedCollection<AgentQuotaRecord> {
    return store.versioned<AgentQuotaRecord>("agentQuotas");
  }

  async function run(
    principal: string,
    policy: AgentQuotaPolicy,
    nowMs: number,
    increment: boolean,
  ): Promise<AgentQuotaDecision> {
    const start = windowStart(nowMs, policy.windowSeconds);
    const key = `${principal}:${policy.windowSeconds}:${start}`;
    try {
      const quotas = collection();
      return await withBoundedCasRetry(async () => {
        const current = await quotas.get(key);
        if (!current) {
          const opened = AgentQuotaRecordSchema.parse({
            version: 0,
            principal,
            windowStartMs: start,
            windowSeconds: policy.windowSeconds,
            limit: policy.limit,
            used: increment ? 1 : 0,
          });
          /* Losing this race is not a failure: somebody else opened the same
             window, and the next round reads their record and joins it. */
          if (!(await quotas.insertIfAbsent(key, opened))) return false;
          return decisionFrom(opened, nowMs, true);
        }
        if (current.used >= current.limit) {
          return decisionFrom(current, nowMs, false);
        }
        if (!increment) return decisionFrom(current, nowMs, true);
        const next = AgentQuotaRecordSchema.parse({
          ...current,
          version: current.version + 1,
          /* The stored limit wins for the life of a window. Re-reading the
             policy mid-window would let a deploy that raises the limit hand
             extra capacity to a caller who is already over the old one. */
          used: current.used + 1,
        });
        if (!(await quotas.compareAndSet(key, current.version, next))) return false;
        return decisionFrom(next, nowMs, true);
      }, GUARD_CAS_MAX_ATTEMPTS);
    } catch (error) {
      if (error instanceof Error && error.name === "GuardCasExhaustedError") {
        throw new QuotaUnavailableError(
          "QUOTA_CONTENDED",
          "The quota window did not settle within its attempt budget.",
          { cause: error },
        );
      }
      throw new QuotaUnavailableError(
        "QUOTA_UNAVAILABLE",
        "The durable quota store could not be reached, so no request can be admitted.",
        { cause: error },
      );
    }
  }

  return {
    consume: ({ principal, policy, nowMs }) => run(principal, policy, nowMs, true),
    peek: ({ principal, policy, nowMs }) => run(principal, policy, nowMs, false),
  };
}

/** One-call form for a route that has a store and one decision to make. */
export function consumeAgentQuota(
  store: GuardStore,
  input: { principal: string; policy: AgentQuotaPolicy; nowMs: number },
): Promise<AgentQuotaDecision> {
  return createAgentQuotaMeter(store).consume(input);
}

/** The principal string a decision is keyed by. Never a raw credential. */
export function quotaPrincipal(principal: AgentPrincipal | null, clientIp: string): string {
  return principal ? `tenant:${principal.tenantId}` : `anon:${clientIp}`;
}
