/**
 * The response discipline every bridge route shares.
 *
 * Six routes with one shape: private, never cached, rate-limit headers always
 * present, and a refusal that names its cause instead of a generic sentence.
 * Written once because six copies of a header helper drift the first time one
 * of them is fixed.
 */

import type { z } from "zod";

import { privateNoStoreHeaders, rateLimitHeaders, type RateLimitDecision } from "../http-control.ts";

export function bridgeHeaders(rate: RateLimitDecision) {
  return { ...privateNoStoreHeaders(), ...rateLimitHeaders(rate) };
}

export function bridgeFailure(
  status: number,
  code: string,
  message: string,
  rate: RateLimitDecision,
  extra: object = {},
) {
  return Response.json({ error: { code, message, ...extra } }, { status, headers: bridgeHeaders(rate) });
}

/**
 * A refusal that states, in the body, that nothing was burned.
 *
 * Used by every path in the burn route that stops before the boundary. A
 * caller reading a 4xx has to be able to tell "your request was rejected" from
 * "your money may already be gone", and inferring it from a status code is not
 * good enough when the difference is a burn.
 */
export function bridgeRefuseBeforeBurn(
  status: number,
  code: string,
  message: string,
  rate: RateLimitDecision,
  extra: object = {},
) {
  return bridgeFailure(status, code, message, rate, { ...extra, burnBoundary: "NOT_CROSSED" });
}

/** The first three schema issues, named. A wall of them tells a reader less. */
export function describeBridgeIssues(error: z.ZodError): string {
  const lines: string[] = [];
  for (const issue of error.issues) {
    const where = issue.path.join(".");
    const line = where ? `${where} — ${issue.message}` : issue.message;
    if (lines.includes(line)) continue;
    lines.push(line);
    if (lines.length === 3) break;
  }
  return lines.length > 0 ? lines.join(" · ") : "The bridge request was not accepted.";
}
