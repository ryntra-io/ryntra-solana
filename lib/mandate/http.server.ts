/**
 * CITY-174 — what the mandate's routes share: the devnet switch (closed answers 404 — the routes do not exist for the
 * deployment), a rate limit, a bounded JSON body and one shape of failure. Private, never cached.
 */

import type { z } from "zod";

import { clientIp, FixedWindowLimiter, privateNoStoreHeaders, rateLimitHeaders, type RateLimitDecision } from "../http-control.ts";
import { mandateGate, type MandateGate } from "./service.server.ts";

const LIMITER = new FixedWindowLimiter({ limit: 30, windowMs: 60_000, maxKeys: 5_000 });
const MAX_BODY = 16_000;

export type OpenMandate = Extract<MandateGate, { open: true }> & Readonly<{ rate: RateLimitDecision }>;

export const mandateHeaders = (rate: RateLimitDecision): Record<string, string> => ({ ...privateNoStoreHeaders(), ...rateLimitHeaders(rate) });

export const mandateFailure = (status: number, code: string, message: string, rate: RateLimitDecision): Response =>
  Response.json({ error: { code, message } }, { status, headers: mandateHeaders(rate) });

/** The switch and the rate limit; closed or limited answers here and the route stops. */
export function openMandate(request: Request, route: string, env: Readonly<Record<string, string | undefined>> = process.env): OpenMandate | Response {
  const rate = LIMITER.consume(`bots-mandate:${route}:${clientIp(request.headers)}`);
  const gate = mandateGate(env);
  if (!gate.open) return mandateFailure(404, "MANDATE_CLOSED", "Not found.", rate);
  if (!rate.allowed) return mandateFailure(429, "RATE_LIMITED", "Too many requests.", rate);
  return { ...gate, rate };
}

/** A JSON body within its bound, parsed by the route's schema. */
export async function readMandateBody<S extends z.ZodType>(request: Request, schema: S, rate: RateLimitDecision): Promise<z.output<S> | Response> {
  const text = await request.text().catch(() => "");
  if (text.length > MAX_BODY) return mandateFailure(413, "TOO_LARGE", "The request is too large.", rate);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return mandateFailure(400, "VALIDATION_ERROR", "The body is not JSON.", rate);
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return mandateFailure(400, "VALIDATION_ERROR", "The body does not match the request.", rate);
  return parsed.data;
}
