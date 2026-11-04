/**
 * The intent routes' shared steps (CITY-161, contract 1.90.0): whether intents are served here, the windows that bound
 * them, the same-site rule for the steps a person takes, and a refusal said in the contract's own codes.
 *
 * Making an intent needs no wallet and no key — anyone may prepare a request, and only the person's own wallet can act
 * on it — so it has its own small window per address. Claim, the mark (`signed`), release and receipt are the city's
 * steps on Ryntra's own origin: a request from another site is refused, so no page elsewhere can take or end someone's
 * intent. The wallet itself is proven by its signed bytes at the mark, not by these headers.
 *
 * Server only.
 */

import type { NextResponse } from "next/server";

import type { IntentCreateRequestSchema } from "../api/v1/contract.ts";
import { apiFailure } from "../api/v1/http.ts";
import { FixedWindowLimiter, clientIp, rateLimitHeaders } from "../http-control.ts";
import { mutationOriginAllowed } from "../security.ts";
import type { IntentSpec } from "./model.ts";
import { intentsServed } from "./runtime.server.ts";
import type { CreateInput, IntentDeps, IntentRefusal } from "./service.ts";
import type { z } from "zod";

/** The header the creator's key travels in: on the read (for the receipt) and on the withdrawal. */
export const INTENT_KEY_HEADER = "x-ryntra-intent-key";

/** Thirty a minute from one address: an agent's burst, not a flood. */
const CREATE_LIMITER = new FixedWindowLimiter({ limit: 30, windowMs: 60_000, maxKeys: 10_000 });
/** A person presses a few times; sixty is room for retries of a receipt. */
const STEP_LIMITER = new FixedWindowLimiter({ limit: 60, windowMs: 60_000, maxKeys: 10_000 });

type Window = Readonly<{ ok: true; headers: Record<string, string> }> | Readonly<{ ok: false; response: NextResponse }>;

function windowOf(limiter: FixedWindowLimiter, key: string, headers: Headers): Window {
  const decision = limiter.consume(`${key}:${clientIp(headers)}`);
  if (!decision.allowed) return { ok: false, response: apiFailure("RATE_LIMITED", "Too many requests.", { headers: rateLimitHeaders(decision) }) };
  return { ok: true, headers: rateLimitHeaders(decision) };
}

export const consumeIntentCreate = (headers: Headers): Window => windowOf(CREATE_LIMITER, "intent-create", headers);
export const consumeIntentStep = (headers: Headers): Window => windowOf(STEP_LIMITER, "intent-step", headers);

/** The deps, or the refusal that says intents are not served on this deployment. */
export function intentsOrRefusal(): Readonly<{ ok: true; deps: IntentDeps }> | Readonly<{ ok: false; response: NextResponse }> {
  const served = intentsServed();
  if (served.served) return { ok: true, deps: served.deps };
  return { ok: false, response: apiFailure("CAPABILITY_UNAVAILABLE", "Intents are not served on this deployment.") };
}

/** A step a person takes is the city's own, on Ryntra's origin; anything else is refused before the body is read. */
export function sameSiteOrRefusal(request: Request): NextResponse | null {
  if (mutationOriginAllowed(request.url, request.headers.get("origin"), request.headers.get("sec-fetch-site"))) return null;
  return apiFailure("FORBIDDEN", "This step is taken on Ryntra itself.");
}

export function intentFailure(refusal: IntentRefusal, headers: Record<string, string> = {}): NextResponse {
  return apiFailure(refusal.code, refusal.message, { headers });
}

/** The create request as the service takes it: the frozen spec, who prepared it and its deadline. */
export function createInputOf(body: z.output<typeof IntentCreateRequestSchema>): CreateInput {
  const spec: IntentSpec =
    body.action === "swap"
      ? { action: "swap", coin: body.coin, side: body.side, pay: body.pay, amountRaw: body.amountRaw }
      : { action: "transfer", coin: body.coin, amountRaw: body.amountRaw, to: body.to };
  return { spec, origin: { kind: body.origin.kind, name: body.origin.name }, for: body.for ?? null, expiresIn: body.expiresIn ?? null };
}
