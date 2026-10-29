/**
 * The pool action routes' shared door, the swap routes' own: the site's origin
 * for a browser or the bearer for the phone (a bearer acts only for its own
 * wallet), a rate limit and a bounded JSON body. Whether the wallet may act at
 * all is the gate's (`gate.ts`), asked by the action itself.
 */

import "server-only";

import { consumeAgentControlRequest, readAgentControlJson } from "../../agent-control/http.ts";
import { privateNoStoreHeaders, rateLimitHeaders, type RateLimitDecision } from "../../http-control.ts";
import { readSwapCarrier, walletMismatch } from "../../solana/swap-carrier.server.ts";

export type LiquidityDoor = Readonly<{ ok: true; body: unknown; rate: RateLimitDecision; mismatch: (owner: string) => boolean }> | Readonly<{ ok: false; response: Response }>;

export function liquidityHeaders(rate: RateLimitDecision): Record<string, string> {
  return { ...privateNoStoreHeaders(), ...rateLimitHeaders(rate) };
}

export function liquidityFailure(status: number, code: string, message: string, rate: RateLimitDecision): Response {
  return Response.json({ error: { code, message } }, { status, headers: liquidityHeaders(rate) });
}

export async function openLiquidityDoor(request: Request): Promise<LiquidityDoor> {
  const rate = consumeAgentControlRequest(request.headers);
  if (!rate.allowed) return { ok: false, response: liquidityFailure(429, "RATE_LIMITED", "Too many requests.", rate) };
  const carrier = await readSwapCarrier(request, "Pool actions must be asked for from this site.");
  if (!carrier.ok) return { ok: false, response: liquidityFailure(carrier.status, carrier.code, carrier.message, rate) };
  const body = await readAgentControlJson(request);
  if (!body.ok) return { ok: false, response: liquidityFailure(body.status, body.code, "The request body was not accepted.", rate) };
  return { ok: true, body: body.value, rate, mismatch: (owner) => walletMismatch(carrier, owner) };
}
