/**
 * What the mandate's routes share: the devnet switch (closed answers 404 — the routes do not exist for the
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

/** A wallet's proof as `requireWalletProof` answers it (`../api/v1/proof.ts`). */
export type ProvenOwner = Readonly<{ ok: true; address: string }> | Readonly<{ ok: false; response: Response }>;
export type ProveOwner = (request: Request) => Promise<ProvenOwner>;

/** The real proof for a change, read from the session store — loaded only on a request, never by a test that hands its own. */
const proveForChange: ProveOwner = async (request) => (await import("../api/v1/proof.ts")).requireWalletProof(request, "mutation");

/**
 * The agent's book takes a budget only from the wallet it is hers (the review of #1965: «the budget's entry
 * in the book — only with the owner's proof»): the same proof as the doors of her agents and her care
 * (`requireWalletProof(…, "mutation")` — the phone's bearer, or the browser's proof the wallet itself signed, from this
 * site). Without it, anyone holding her public addresses could join her signed budget first, with rules she never saw.
 * Null — proven for `owner`; otherwise the refusal to answer with: 401 (or the proof's own status) without one, 403 for
 * another wallet.
 */
export async function ownerProof(request: Request, owner: string, rate: RateLimitDecision, prove: ProveOwner = proveForChange): Promise<Response | null> {
  const proof = await prove(request).catch(() => null);
  if (!proof) return mandateFailure(503, "UNAVAILABLE", "The wallet's proof is not readable.", rate);
  if (!proof.ok) {
    const said = (await proof.response
      .clone()
      .json()
      .catch(() => null)) as { error?: { code?: unknown; message?: unknown } } | null;
    const code = typeof said?.error?.code === "string" ? said.error.code : "UNAUTHORIZED";
    const message = typeof said?.error?.message === "string" ? said.error.message : "No proven wallet: sign in with the wallet first.";
    return mandateFailure(proof.response.status || 401, code, message, rate);
  }
  if (proof.address !== owner) return mandateFailure(403, "WALLET_MISMATCH", "The session's wallet is not this wallet.", rate);
  return null;
}
