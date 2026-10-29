/**
 * The four limits routes share one gate, the swap routes' own: the site's
 * origin for a browser or the bearer for the phone, a rate limit, a bounded
 * JSON body, and the Swap lane's operator stop — a limit is a swap that waits.
 * A bearer acts only for its own wallet.
 */

import type { z } from "zod";

import { consumeAgentControlRequest, readAgentControlJson } from "../../agent-control/http.ts";
import { privateNoStoreHeaders, rateLimitHeaders, type RateLimitDecision } from "../../http-control.ts";
import { resolveSolanaLaneState } from "../lane-state.ts";
import { readSwapCarrier, walletMismatch } from "../swap-carrier.server.ts";

export const BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

export type LimitGate<T> =
  | Readonly<{ ok: true; body: T; rate: RateLimitDecision }>
  | Readonly<{ ok: false; response: Response }>;

export function limitHeaders(rate: RateLimitDecision): Record<string, string> {
  return { ...privateNoStoreHeaders(), ...rateLimitHeaders(rate) };
}

export function limitFailure(status: number, code: string, message: string, rate: RateLimitDecision, extra: object = {}): Response {
  return Response.json({ error: { code, message, ...extra } }, { status, headers: limitHeaders(rate) });
}

export async function openLimitGate<S extends z.ZodType>(
  request: Request,
  schema: S,
  options: Readonly<{ acts: boolean; owner: (body: z.output<S>) => string }>,
): Promise<LimitGate<z.output<S>>> {
  const rate = consumeAgentControlRequest(request.headers);
  if (!rate.allowed) return { ok: false, response: limitFailure(429, "RATE_LIMITED", "Too many requests.", rate) };
  const carrier = await readSwapCarrier(request, "Limit orders must be asked for from this site.");
  if (!carrier.ok) return { ok: false, response: limitFailure(carrier.status, carrier.code, carrier.message, rate) };
  /* Reading and cancelling stay open when the lane is stopped: a person must always be able to see and take back what is theirs. */
  if (options.acts && resolveSolanaLaneState("SWAP") !== "OPEN") {
    return { ok: false, response: limitFailure(409, "SWAP_PAUSED", "Trading is turned off right now.", rate) };
  }
  const body = await readAgentControlJson(request);
  if (!body.ok) return { ok: false, response: limitFailure(body.status, body.code, "The request body was not accepted.", rate) };
  const parsed = schema.safeParse(body.value);
  if (!parsed.success) return { ok: false, response: limitFailure(400, "VALIDATION_ERROR", "The request did not match its schema.", rate) };
  if (walletMismatch(carrier, options.owner(parsed.data))) {
    return { ok: false, response: limitFailure(403, "WALLET_MISMATCH", "The session's wallet is not this order's wallet.", rate) };
  }
  return { ok: true, body: parsed.data, rate };
}
