/**
 * The door of `/api/v1/earn/pro/**`: the contract's one error shape, a rate limit, and for a route that
 * builds or relays — the site's own origin for a browser, or the phone's bearer, which acts only for its own wallet.
 *
 * Reads are public like every pier read of Earn. Whether a wallet may act at all is the gate's (`./gate.ts`), asked by
 * the action itself.
 */

import "server-only";

import type { NextResponse } from "next/server";

import { consumeAgentControlRequest, consumeSolanaReadRequest, readAgentControlJson } from "../agent-control/http.ts";
import type { ApiErrorCode } from "../api/v1/contract.ts";
import { apiFailure, apiMajorRefusal } from "../api/v1/http.ts";
import { rateLimitHeaders, type RateLimitDecision } from "../http-control.ts";
import { readSwapCarrier, walletMismatch } from "../solana/swap-carrier.server.ts";
import type { EarnProFailure, EarnProFailureCode } from "./actions.server.ts";
import { earnProGate } from "./gate.ts";

/** The surface's own refusals as the contract names them (1.92.0). */
const CONTRACT_CODE: Readonly<Record<EarnProFailureCode, ApiErrorCode>> = {
  EARN_PRO_CLOSED: "CAPABILITY_UNAVAILABLE",
  EARN_PRO_STOPPED: "EARN_PRO_STOPPED",
  BAD_REQUEST: "VALIDATION_ERROR",
  NOT_A_PIER: "EARN_PRO_NOT_A_PIER",
  PIER_NOT_OPEN: "EARN_PRO_PIER_NOT_OPEN",
  AMOUNT_LOW: "EARN_PRO_AMOUNT_LOW",
  AMOUNT_HIGH: "EARN_PRO_AMOUNT_HIGH",
  CARE_CLOSED: "EARN_PRO_CARE_CLOSED",
  BALANCE_LOW: "EARN_PRO_BALANCE_LOW",
  NOTHING_TO_DO: "EARN_PRO_NOTHING_TO_DO",
  REFUSED: "EARN_PRO_REFUSED",
  UNAVAILABLE: "UNAVAILABLE",
  TICKET_INVALID: "EARN_PRO_TICKET_INVALID",
  TICKET_EXPIRED: "EARN_PRO_TICKET_EXPIRED",
  SIGNED_MISMATCH: "EARN_PRO_SIGNED_MISMATCH",
  NOT_SIGNED: "EARN_PRO_NOT_SIGNED",
  SIMULATION_FAILED: "EARN_PRO_SIMULATION_FAILED",
};

export function earnProFailure(failure: EarnProFailure, rate?: RateLimitDecision): NextResponse {
  return apiFailure(CONTRACT_CODE[failure.code], failure.reason, rate ? { headers: rateLimitHeaders(rate) } : {});
}

/** Closed here: the contract's answer for a capability a deployment does not serve. */
export const earnProClosed = (rate?: RateLimitDecision): NextResponse => apiFailure("CAPABILITY_UNAVAILABLE", "Earning on DLMM Pro is not served here.", rate ? { headers: rateLimitHeaders(rate) } : {});

export type EarnProRead = Readonly<{ ok: true; rate: RateLimitDecision }> | Readonly<{ ok: false; response: NextResponse }>;

/** A public read: the contract's major, the read budget, the gate. */
export function openEarnProRead(request: Request): EarnProRead {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return { ok: false, response: refused };
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) return { ok: false, response: apiFailure("RATE_LIMITED", "Too many requests.", { headers: rateLimitHeaders(rate) }) };
  if (!earnProGate(process.env).open) return { ok: false, response: earnProClosed(rate) };
  return { ok: true, rate };
}

export type EarnProDoor = Readonly<{ ok: true; body: unknown; rate: RateLimitDecision; mismatch: (owner: string) => boolean }> | Readonly<{ ok: false; response: NextResponse }>;

/** A build or a relay: the major, the acting budget, the gate, who carries the request, a bounded JSON body. */
export async function openEarnProDoor(request: Request): Promise<EarnProDoor> {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return { ok: false, response: refused };
  const rate = consumeAgentControlRequest(request.headers);
  const headers = rateLimitHeaders(rate);
  if (!rate.allowed) return { ok: false, response: apiFailure("RATE_LIMITED", "Too many requests.", { headers }) };
  if (!earnProGate(process.env).open) return { ok: false, response: earnProClosed(rate) };
  const carrier = await readSwapCarrier(request, "Earn's actions must be asked for from this site.");
  if (!carrier.ok) return { ok: false, response: apiFailure(carrier.status === 401 ? "UNAUTHORIZED" : "FORBIDDEN", carrier.message, { headers }) };
  const body = await readAgentControlJson(request);
  if (!body.ok) return { ok: false, response: apiFailure("VALIDATION_ERROR", "The request body was not accepted.", { headers }) };
  return { ok: true, body: body.value, rate, mismatch: (owner) => walletMismatch(carrier, owner) };
}
