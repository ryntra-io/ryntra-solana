/**
 * The door of `/api/v1/wallet/clean/**`: the contract's one error shape, a rate limit, and for a route that builds or
 * relays — the site's own origin for a browser, or the phone's bearer, which acts only for its own wallet. Reads are
 * public: a wallet's accounts are public on chain.
 */

import "server-only";

import type { NextResponse } from "next/server";

import { consumeAgentControlRequest, consumeSolanaReadRequest, readAgentControlJson } from "../agent-control/http.ts";
import type { ApiErrorCode } from "../api/v1/contract.ts";
import { apiFailure, apiMajorRefusal } from "../api/v1/http.ts";
import { rateLimitHeaders, type RateLimitDecision } from "../http-control.ts";
import { readSwapCarrier, walletMismatch } from "../solana/swap-carrier.server.ts";
import type { CleanFailure, CleanFailureCode } from "./service.server.ts";

const CONTRACT_CODE: Readonly<Record<CleanFailureCode, ApiErrorCode>> = {
  CLOSED: "CAPABILITY_UNAVAILABLE",
  BAD_REQUEST: "VALIDATION_ERROR",
  NOTHING_TO_DO: "WALLET_CLEAN_NOTHING_TO_DO",
  UNAVAILABLE: "UNAVAILABLE",
  TICKET_INVALID: "WALLET_CLEAN_TICKET_INVALID",
  TICKET_EXPIRED: "WALLET_CLEAN_TICKET_EXPIRED",
  SIGNED_MISMATCH: "WALLET_CLEAN_SIGNED_MISMATCH",
  NOT_SIGNED: "WALLET_CLEAN_NOT_SIGNED",
  SIMULATION_FAILED: "WALLET_CLEAN_SIMULATION_FAILED",
};

export function cleanFailure(failure: CleanFailure, rate?: RateLimitDecision): NextResponse {
  return apiFailure(CONTRACT_CODE[failure.code], failure.reason, rate ? { headers: rateLimitHeaders(rate) } : {});
}

const OWNER = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export type CleanRead = Readonly<{ ok: true; rate: RateLimitDecision; owner: string }> | Readonly<{ ok: false; response: NextResponse }>;

/** A public read of one wallet: the contract's major, the read budget, an owner that is an address. */
export function openCleanRead(request: Request): CleanRead {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return { ok: false, response: refused };
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) return { ok: false, response: apiFailure("RATE_LIMITED", "Too many requests.", { headers: rateLimitHeaders(rate) }) };
  const owner = new URL(request.url).searchParams.get("owner") ?? "";
  if (!OWNER.test(owner)) return { ok: false, response: apiFailure("VALIDATION_ERROR", "owner must be a Solana address.", { headers: rateLimitHeaders(rate) }) };
  return { ok: true, rate, owner };
}

export type CleanDoor = Readonly<{ ok: true; body: unknown; rate: RateLimitDecision; mismatch: (owner: string) => boolean }> | Readonly<{ ok: false; response: NextResponse }>;

/** A build or a relay: the major, the acting budget, who carries the request, a bounded JSON body. */
export async function openCleanDoor(request: Request): Promise<CleanDoor> {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return { ok: false, response: refused };
  const rate = consumeAgentControlRequest(request.headers);
  const headers = rateLimitHeaders(rate);
  if (!rate.allowed) return { ok: false, response: apiFailure("RATE_LIMITED", "Too many requests.", { headers }) };
  const carrier = await readSwapCarrier(request, "A clean must be asked for from this site.");
  if (!carrier.ok) return { ok: false, response: apiFailure(carrier.status === 401 ? "UNAUTHORIZED" : "FORBIDDEN", carrier.message, { headers }) };
  const body = await readAgentControlJson(request);
  if (!body.ok) return { ok: false, response: apiFailure("VALIDATION_ERROR", "The request body was not accepted.", { headers }) };
  return { ok: true, body: body.value, rate, mismatch: (owner) => walletMismatch(carrier, owner) };
}
