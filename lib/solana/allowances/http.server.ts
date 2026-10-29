/**
 * The spending limits' routes' answers (SOL-7): JSON, never cached, a failure as `{ error: { code, message, issues? } }`
 * — the shape every Ryntra route answers with, so the page reads one.
 */

import { NextResponse } from "next/server";

import { FixedWindowLimiter, clientIp, privateNoStoreHeaders, rateLimitHeaders } from "../../http-control.ts";
import type { AllowanceIssue } from "./model.ts";

const STATUS: Readonly<Record<string, number>> = {
  VALIDATION_ERROR: 400,
  WALLET_MISMATCH: 403,
  ALLOWANCE_NOT_YOURS: 403,
  ALLOWANCE_NOT_DELEGATEE: 403,
  ALLOWANCE_NOT_FOUND: 404,
  ALLOWANCE_PLAN_NOT_FOUND: 404,
  ALLOWANCE_BUILD_NOT_FOUND: 404,
  ALLOWANCES_UNAVAILABLE: 404,
  RATE_LIMITED: 429,
  UNAVAILABLE: 503,
  ALLOWANCE_SEND_UNKNOWN: 503,
};

export function allowanceJson<T>(body: T): NextResponse {
  return NextResponse.json(body, { status: 200, headers: privateNoStoreHeaders() });
}

export function allowanceFailure(code: string, message: string, extra: Readonly<{ issues?: readonly AllowanceIssue[]; headers?: Record<string, string> }> = {}): NextResponse {
  return NextResponse.json(
    { error: { code, message, ...(extra.issues?.length ? { issues: extra.issues.slice(0, 32) } : {}) } },
    { status: STATUS[code] ?? 409, headers: { ...privateNoStoreHeaders(), ...(extra.headers ?? {}) } },
  );
}

/** Reads and writes apart: a page reads often, a person signs rarely. Per instance — a bound, not an accounting. */
const LIMITERS = {
  read: new FixedWindowLimiter({ limit: 30, windowMs: 60_000, maxKeys: 5_000 }),
  write: new FixedWindowLimiter({ limit: 20, windowMs: 60_000, maxKeys: 5_000 }),
};

export function allowanceRateRefusal(kind: keyof typeof LIMITERS, headers: Headers): NextResponse | null {
  const decision = LIMITERS[kind].consume(clientIp(headers));
  return decision.allowed ? null : allowanceFailure("RATE_LIMITED", "Too many requests.", { headers: rateLimitHeaders(decision) });
}

export const NOT_SERVED = "Spending limits are not served on this deployment.";
