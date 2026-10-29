/**
 * The developer console routes' shared steps (DEV-2): whether the console is served here, the write window, and a
 * refusal said in the contract's own codes. Server only.
 */

import type { NextResponse } from "next/server";

import type { ApiErrorCode } from "../api/v1/contract.ts";
import { apiFailure } from "../api/v1/http.ts";
import { FixedWindowLimiter, clientIp, rateLimitHeaders } from "../http-control.ts";
import { devConsoleServed } from "./runtime.server.ts";
import type { DevDeps, DevFailure, DevFailureCode } from "./service.server.ts";

export const DEV_FAILURE_API: Readonly<Record<DevFailureCode, ApiErrorCode>> = Object.freeze({
  INVALID: "VALIDATION_ERROR",
  NOT_FOUND: "DEV_NOT_FOUND",
  FORBIDDEN: "DEV_FORBIDDEN",
  LIMIT: "DEV_LIMIT",
  CHANGED: "DEV_CHANGED",
  KEY_INVALID: "DEV_KEY_INVALID",
  ORIGIN_REFUSED: "DEV_ORIGIN_REFUSED",
  SCOPE_REFUSED: "DEV_SCOPE_REFUSED",
  QUOTA_EXCEEDED: "DEV_QUOTA_EXCEEDED",
  UNAVAILABLE: "UNAVAILABLE",
});

export function devFailure(failure: DevFailure, headers: Record<string, string> = {}): NextResponse {
  /* A store not yet provisioned is a capability this deployment does not have, not a passing fault. */
  if (failure.code === "UNAVAILABLE" && /not provisioned/i.test(failure.message)) return apiFailure("CAPABILITY_UNAVAILABLE", failure.message, { headers });
  return apiFailure(DEV_FAILURE_API[failure.code], failure.message, { headers });
}

/** The deps, or the refusal that says why the console is not served on this deployment. */
export function devDepsOrRefusal(): Readonly<{ ok: true; deps: DevDeps }> | Readonly<{ ok: false; response: NextResponse }> {
  const served = devConsoleServed();
  if (served.served) return { ok: true, deps: served.deps };
  const message =
    served.reason === "NO_TEAMS"
      ? "The developer console is served where teams are: a project belongs to a team."
      : served.reason === "CLOSED"
        ? "The developer console is not open on this deployment yet."
        : "The console needs a store every instance shares.";
  return { ok: false, response: apiFailure("CAPABILITY_UNAVAILABLE", message) };
}

/* Twenty console changes a minute from one address: more than a person clicking, less than a loop. */
const DEV_WRITE_LIMITER = new FixedWindowLimiter({ limit: 20, windowMs: 60_000, maxKeys: 5_000 });
/* A keyed read is bounded per address as well as per project: the quota is the project's, this is the network's. */
const DEV_KEY_LIMITER = new FixedWindowLimiter({ limit: 120, windowMs: 60_000, maxKeys: 20_000 });

export function consumeDevWrite(headers: Headers): Readonly<{ ok: true; headers: Record<string, string> }> | Readonly<{ ok: false; response: NextResponse }> {
  const decision = DEV_WRITE_LIMITER.consume(`dev-write:${clientIp(headers)}`);
  if (!decision.allowed) return { ok: false, response: apiFailure("RATE_LIMITED", "Too many changes; try again in a minute.", { headers: rateLimitHeaders(decision) }) };
  return { ok: true, headers: rateLimitHeaders(decision) };
}

export function consumeDevKeyRead(headers: Headers): Readonly<{ ok: true; headers: Record<string, string> }> | Readonly<{ ok: false; response: NextResponse }> {
  const decision = DEV_KEY_LIMITER.consume(`dev-key:${clientIp(headers)}`);
  if (!decision.allowed) return { ok: false, response: apiFailure("RATE_LIMITED", "Too many requests.", { headers: rateLimitHeaders(decision) }) };
  return { ok: true, headers: rateLimitHeaders(decision) };
}

export const DEV_KEY_HEADER = "X-Ryntra-Key";

/** What the quota says, as headers, so a client need not parse a body to know where it stands. */
export function quotaHeaders(rows: readonly Readonly<{ window: string; used: number; limit: number | null; left: number | null; resetsAt: string }>[]): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const row of rows) {
    headers[`X-Ryntra-Quota-${row.window}-Used`] = String(row.used);
    if (row.limit !== null) headers[`X-Ryntra-Quota-${row.window}-Limit`] = String(row.limit);
    if (row.left !== null) headers[`X-Ryntra-Quota-${row.window}-Left`] = String(row.left);
    headers[`X-Ryntra-Quota-${row.window}-Resets`] = row.resetsAt;
  }
  return headers;
}
