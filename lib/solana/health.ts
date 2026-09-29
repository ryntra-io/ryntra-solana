/**
 * Provider health for the Solana RPC pair (canon §23).
 *
 * Four states and no fifth: `HEALTHY · DEGRADED · UNAVAILABLE · UNKNOWN`. The
 * one that carries the weight is `UNKNOWN` — it is what a pair is before
 * anything has been asked of it, and it is not a synonym for healthy. A tile
 * that renders "no problems reported" over an empty attempt log is reporting
 * its own silence.
 *
 * ## Why a pair has health at all
 *
 * Because failover is allowed and silence about it is not. Canon §23.3 forbids
 * *silent* provider substitution, and §3.5 requires a secondary read path — the
 * two are only compatible if the substitution is stated. `DEGRADED` is that
 * statement: the answer on screen is real, and it did not come from the
 * endpoint this workspace is configured to trust first.
 *
 * The derivation is a pure function over the attempt log a handle already
 * keeps, so nothing has to be probed to know it and no extra request is spent
 * proving liveness the real reads have already proven.
 */

import type { SolanaEndpoint, SolanaRpcAttempt, SolanaRpcHandle } from "./rpc.ts";

export const PROVIDER_HEALTH_STATES = ["HEALTHY", "DEGRADED", "UNAVAILABLE", "UNKNOWN"] as const;
export type ProviderHealthState = (typeof PROVIDER_HEALTH_STATES)[number];

export type EndpointHealth = Readonly<{
  role: SolanaEndpoint["role"];
  host: string;
  fromEnv: boolean;
  answered: number;
  failed: number;
  /** The most recent failure, host-only. `null` when it has never failed. */
  lastReason: string | null;
}>;

export type RpcPairHealth = Readonly<{
  state: ProviderHealthState;
  /** One sentence a surface can print without composing its own. */
  detail: string;
  endpoints: readonly EndpointHealth[];
  /** Which endpoint served the reads on screen, when one did. */
  servedBy: SolanaEndpoint["role"] | null;
  /** Reads where no endpoint in the pair answered at all. */
  unanswered: number;
}>;

function summarize(endpoint: SolanaEndpoint, attempts: readonly SolanaRpcAttempt[]): EndpointHealth {
  const mine = attempts.filter((attempt) => attempt.role === endpoint.role);
  const failures = mine.filter((attempt) => !attempt.ok);
  return {
    role: endpoint.role,
    host: endpoint.host,
    fromEnv: endpoint.fromEnv,
    answered: mine.length - failures.length,
    failed: failures.length,
    lastReason: failures.length === 0 ? null : (failures[failures.length - 1].reason ?? "no reason given"),
  };
}

/**
 * Count the reads where the whole pair failed.
 *
 * A read is one walk of the pair, and every walk begins at the primary — the
 * transport asks the endpoints in order and never starts anywhere else. So the
 * boundary is the next `primary` attempt, not the last endpoint's: a walk the
 * primary answered never reaches the fallback at all, and closing walks on the
 * fallback made a successful read leak its verdict into the next one.
 *
 * Counting walks rather than raw failures is what keeps a single
 * fallback-served read from reading as an outage.
 */
function countUnanswered(attempts: readonly SolanaRpcAttempt[]): number {
  let unanswered = 0;
  let inWalk = false;
  let walkAnswered = false;
  for (const attempt of attempts) {
    if (attempt.role === "primary") {
      if (inWalk && !walkAnswered) unanswered += 1;
      inWalk = true;
      walkAnswered = false;
    }
    if (attempt.ok) walkAnswered = true;
  }
  if (inWalk && !walkAnswered) unanswered += 1;
  return unanswered;
}

export function rpcPairHealth(handle: SolanaRpcHandle): RpcPairHealth {
  const attempts = handle.attempts();
  const endpoints = handle.endpoints.map((endpoint) => summarize(endpoint, attempts));
  const primary = endpoints[0];
  const fallback = endpoints[1] ?? null;
  const unanswered = countUnanswered(attempts);
  const answered = handle.answered();

  if (attempts.length === 0) {
    return {
      state: "UNKNOWN",
      detail: "Nothing has been asked of this endpoint pair yet.",
      endpoints,
      servedBy: null,
      unanswered: 0,
    };
  }

  if (unanswered > 0 && primary.answered === 0 && (fallback === null || fallback.answered === 0)) {
    return {
      state: "UNAVAILABLE",
      detail:
        fallback === null
          ? `${primary.host} did not answer. There is no second endpoint configured for this network.`
          : `Neither ${primary.host} nor ${fallback.host} answered.`,
      endpoints,
      servedBy: null,
      unanswered,
    };
  }

  if (primary.failed > 0 || unanswered > 0) {
    return {
      state: "DEGRADED",
      detail:
        primary.answered === 0 && fallback?.answered
          ? `${primary.host} did not answer; these reads came from ${fallback.host}.`
          : `${primary.host} failed ${primary.failed} of ${primary.failed + primary.answered} calls; the pair still answered.`,
      endpoints,
      servedBy: answered?.role ?? null,
      unanswered,
    };
  }

  return {
    state: "HEALTHY",
    detail: `${primary.host} answered every call.`,
    endpoints,
    servedBy: answered?.role ?? "primary",
    unanswered: 0,
  };
}

/**
 * What a degraded pair means for the facts it produced (canon §23.3).
 *
 * Not decoration: a read served by the fallback is still a real read, and a
 * read nobody served is not stale — it is absent. Surfaces ask this instead of
 * inventing their own wording, so "stale" and "unknown" keep meaning one thing
 * across the workspace.
 */
export function freshnessOf(state: ProviderHealthState): "CURRENT" | "STALE" | "UNKNOWN" {
  if (state === "HEALTHY") return "CURRENT";
  if (state === "DEGRADED") return "STALE";
  return "UNKNOWN";
}
