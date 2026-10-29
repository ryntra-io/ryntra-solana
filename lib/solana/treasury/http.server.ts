/**
 * The treasury routes' answers (SOL-4): JSON, never cached, a failure as `{ error: { code, message, issues? } }` — the
 * shape every Ryntra route answers with, so the page reads one.
 */

import { NextResponse } from "next/server";

import { FixedWindowLimiter, clientIp, privateNoStoreHeaders, rateLimitHeaders } from "../../http-control.ts";
import type { TreasuryIssue } from "./model.ts";

const STATUS: Readonly<Record<string, number>> = {
  VALIDATION_ERROR: 400,
  WALLET_MISMATCH: 403,
  TREASURY_NOT_INITIATOR: 403,
  TREASURY_NOT_VOTER: 403,
  TREASURY_NOT_EXECUTOR: 403,
  TREASURY_NOT_SPENDER: 403,
  TREASURY_NOT_MEMBER: 403,
  TREASURY_NOT_FOUND: 404,
  TREASURY_PROPOSAL_NOT_FOUND: 404,
  TREASURY_LIMIT_NOT_FOUND: 404,
  TREASURY_BUILD_NOT_FOUND: 404,
  TREASURY_UNAVAILABLE: 404,
  RATE_LIMITED: 429,
  UNAVAILABLE: 503,
};

export function treasuryJson<T>(body: T): NextResponse {
  return NextResponse.json(body, { status: 200, headers: privateNoStoreHeaders() });
}

export function treasuryFailure(code: string, message: string, extra: Readonly<{ issues?: readonly TreasuryIssue[]; headers?: Record<string, string> }> = {}): NextResponse {
  return NextResponse.json(
    { error: { code, message, ...(extra.issues?.length ? { issues: extra.issues.slice(0, 32) } : {}) } },
    { status: STATUS[code] ?? 409, headers: { ...privateNoStoreHeaders(), ...(extra.headers ?? {}) } },
  );
}

/** Reads and writes apart: a page reads often, a person signs rarely. Per instance — a bound, not an accounting. */
const LIMITERS = {
  read: new FixedWindowLimiter({ limit: 60, windowMs: 60_000, maxKeys: 5_000 }),
  write: new FixedWindowLimiter({ limit: 20, windowMs: 60_000, maxKeys: 5_000 }),
};

export function treasuryRateRefusal(kind: keyof typeof LIMITERS, headers: Headers): NextResponse | null {
  const decision = LIMITERS[kind].consume(clientIp(headers));
  return decision.allowed ? null : treasuryFailure("RATE_LIMITED", "Too many requests.", { headers: rateLimitHeaders(decision) });
}

export const NOT_SERVED = "The treasury is not served on this deployment.";
