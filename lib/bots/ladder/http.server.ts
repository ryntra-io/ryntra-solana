/**
 * What every ladder route shares: the switch (closed answers 404 — the routes
 * do not exist for the deployment), a rate limit, a bounded JSON body and one
 * shape of failure. Private, never cached.
 */

import type { z } from "zod";

import { clientIp, FixedWindowLimiter, privateNoStoreHeaders, rateLimitHeaders, type RateLimitDecision } from "../../http-control.ts";
import { ladderGate } from "./network.ts";

const LIMITER = new FixedWindowLimiter({ limit: 30, windowMs: 60_000, maxKeys: 5_000 });
const MAX_BODY = 64_000;

export type OpenGate = Readonly<{ network: "devnet"; pools: readonly string[]; quotes: readonly string[]; rate: RateLimitDecision }>;

export function ladderHeaders(rate: RateLimitDecision): Record<string, string> {
  return { ...privateNoStoreHeaders(), ...rateLimitHeaders(rate) };
}

export function ladderFailure(status: number, code: string, message: string, rate: RateLimitDecision): Response {
  return Response.json({ error: { code, message } }, { status, headers: ladderHeaders(rate) });
}

/** The switch and the rate limit; closed or limited answers here and the route stops. */
export function openLadder(request: Request, route: string, env: Readonly<Record<string, string | undefined>> = process.env): OpenGate | Response {
  const rate = LIMITER.consume(`bots-ladder:${route}:${clientIp(request.headers)}`);
  const gate = ladderGate(env);
  if (!gate.open) return ladderFailure(404, "LADDER_CLOSED", "Not found.", rate);
  if (!rate.allowed) return ladderFailure(429, "RATE_LIMITED", "Too many requests.", rate);
  return { network: gate.network, pools: gate.pools, quotes: gate.quotes, rate };
}

/** A JSON body within its bound, parsed by the route's schema. */
export async function readLadderBody<S extends z.ZodType>(request: Request, schema: S, rate: RateLimitDecision): Promise<z.output<S> | Response> {
  const text = await request.text().catch(() => "");
  if (text.length > MAX_BODY) return ladderFailure(413, "TOO_LARGE", "The request is too large.", rate);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return ladderFailure(400, "VALIDATION_ERROR", "The body is not JSON.", rate);
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return ladderFailure(400, "VALIDATION_ERROR", "The body does not match the request.", rate);
  return parsed.data;
}
