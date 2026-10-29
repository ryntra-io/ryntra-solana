/**
 * The Earn routes' shared door — the collateral lane's own, for the same three reasons.
 *
 * The site's origin for a browser or the bearer for the phone (and a bearer acts only for its own wallet), a
 * rate limit, and a JSON body with a ceiling on it. Whether the wallet may act at all is the gate's question,
 * asked by the action itself; the routes' own decisions are `routes.ts`.
 */

import "server-only";

import { consumeAgentControlRequest, readAgentControlJson } from "../agent-control/http.ts";
import { readSwapCarrier, walletMismatch } from "../solana/swap-carrier.server.ts";

import { earnFailure, type EarnDoor } from "./routes.ts";

export async function openEarnDoor(request: Request): Promise<EarnDoor> {
  const rate = consumeAgentControlRequest(request.headers);
  if (!rate.allowed) return { ok: false, response: earnFailure(429, "RATE_LIMITED", "Too many requests.", rate) };
  const carrier = await readSwapCarrier(request, "Earn actions must be asked for from this site.");
  if (!carrier.ok) return { ok: false, response: earnFailure(carrier.status, carrier.code, carrier.message, rate) };
  const body = await readAgentControlJson(request);
  if (!body.ok) return { ok: false, response: earnFailure(body.status, body.code, "The request body was not accepted.", rate) };
  return { ok: true, body: body.value, rate, mismatch: (owner) => walletMismatch(carrier, owner) };
}
