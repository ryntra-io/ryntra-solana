/**
 * The team routes' shared steps (TEAM-1): whether teams are served here, the write window, and a refusal said in the
 * contract's codes. Server only.
 */

import type { NextResponse } from "next/server";

import type { ApiErrorCode } from "../api/v1/contract.ts";
import { apiFailure } from "../api/v1/http.ts";
import { FixedWindowLimiter, clientIp, rateLimitHeaders } from "../http-control.ts";
import { teamsServed } from "./runtime.server.ts";
import type { TeamDeps, TeamFailure, TeamFailureCode } from "./service.server.ts";

export const TEAM_FAILURE_API: Readonly<Record<TeamFailureCode, ApiErrorCode>> = Object.freeze({
  INVALID: "VALIDATION_ERROR",
  NOT_FOUND: "TEAM_NOT_FOUND",
  FORBIDDEN: "TEAM_FORBIDDEN",
  LIMIT: "TEAM_LIMIT",
  MEMBER_EXISTS: "TEAM_MEMBER_EXISTS",
  LAST_OWNER: "TEAM_LAST_OWNER",
  CHANGED: "TEAM_CHANGED",
  TREASURY_REFUSED: "TEAM_TREASURY_REFUSED",
  UNAVAILABLE: "UNAVAILABLE",
});

export function teamFailure(failure: TeamFailure): NextResponse {
  /* A store not yet provisioned is a capability this deployment does not have, not a passing fault. */
  if (failure.code === "UNAVAILABLE" && /not provisioned/i.test(failure.message)) return apiFailure("CAPABILITY_UNAVAILABLE", failure.message);
  return apiFailure(TEAM_FAILURE_API[failure.code], failure.message);
}

/** The deps, or the refusal that says why teams are not served on this deployment. */
export function teamDepsOrRefusal(): Readonly<{ ok: true; deps: TeamDeps }> | Readonly<{ ok: false; response: NextResponse }> {
  const served = teamsServed();
  if (served.served) return { ok: true, deps: served.deps };
  const message =
    served.reason === "NOT_SERVED" ? "Teams are not served here: the treasury's network is not named." : served.reason === "CLOSED" ? "Teams are not open on this deployment yet." : "Teams need a store every instance shares.";
  return { ok: false, response: apiFailure("CAPABILITY_UNAVAILABLE", message) };
}

/* Twenty changes a minute from one address: more than a person keeping a list by hand, less than a loop. */
const TEAM_WRITE_LIMITER = new FixedWindowLimiter({ limit: 20, windowMs: 60_000, maxKeys: 5_000 });

export function consumeTeamWrite(headers: Headers): Readonly<{ ok: true; headers: Record<string, string> }> | Readonly<{ ok: false; response: NextResponse }> {
  const decision = TEAM_WRITE_LIMITER.consume(`team-write:${clientIp(headers)}`);
  if (!decision.allowed) return { ok: false, response: apiFailure("RATE_LIMITED", "Too many changes; try again in a minute.", { headers: rateLimitHeaders(decision) }) };
  return { ok: true, headers: rateLimitHeaders(decision) };
}
