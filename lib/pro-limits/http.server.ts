/**
 * The ladder routes' shared door: the contract's major, the lane's gate, a rate limit — in that order, so
 * a closed deployment answers the same thing to everything and reads nothing of the request.
 */

import "server-only";

import type { NextResponse } from "next/server";

import { consumeAgentControlRequest, consumeSolanaReadRequest } from "../agent-control/http.ts";
import type { ApiErrorCode } from "../api/v1/contract.ts";
import { apiFailure, apiJson, apiMajorRefusal } from "../api/v1/http.ts";
import { rateLimitHeaders } from "../http-control.ts";

import { proLimitsOpen } from "./service.server.ts";
import type { ProResult } from "./service.ts";

/** Null — the request may go on; otherwise the answer to give. `kind` picks the limit: a read's, or a build's. */
export function ladderRefusal(request: Request, kind: "read" | "write"): NextResponse | null {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  if (!proLimitsOpen()) return apiFailure("CAPABILITY_UNAVAILABLE", "Ladders are not served here.");
  const rate = kind === "read" ? consumeSolanaReadRequest(request.headers) : consumeAgentControlRequest(request.headers);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many requests.", { headers: rateLimitHeaders(rate) });
  return null;
}

/** The lane's answer as the contract's: the value shaped by `body`, or the failure with its own code. */
export function ladderAnswer<T, B>(result: ProResult<T>, body: (value: T) => B): NextResponse {
  if (!result.ok) return apiFailure(result.code as ApiErrorCode, result.message);
  return apiJson(body(result.value));
}
