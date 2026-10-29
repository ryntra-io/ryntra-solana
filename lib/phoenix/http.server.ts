/**
 * The collateral routes' shared door (B6), the pools' own (`lib/liquidity/studio/http.server.ts`): the site's origin
 * for a browser or the bearer for the phone (a bearer acts only for its own wallet), a rate limit and a bounded JSON
 * body. Whether the wallet may act at all is the gate's, asked by the action itself; the routes' own decisions are
 * `collateral-routes.ts`.
 */

import "server-only";

import { consumeAgentControlRequest, readAgentControlJson } from "../agent-control/http.ts";
import { readSwapCarrier, walletMismatch } from "../solana/swap-carrier.server.ts";

import { collateralFailure, type CollateralDoor } from "./collateral-routes.ts";

export async function openCollateralDoor(request: Request): Promise<CollateralDoor> {
  const rate = consumeAgentControlRequest(request.headers);
  if (!rate.allowed) return { ok: false, response: collateralFailure(429, "RATE_LIMITED", "Too many requests.", rate) };
  const carrier = await readSwapCarrier(request, "Collateral actions must be asked for from this site.");
  if (!carrier.ok) return { ok: false, response: collateralFailure(carrier.status, carrier.code, carrier.message, rate) };
  const body = await readAgentControlJson(request);
  if (!body.ok) return { ok: false, response: collateralFailure(body.status, body.code, "The request body was not accepted.", rate) };
  return { ok: true, body: body.value, rate, mismatch: (owner) => walletMismatch(carrier, owner) };
}
