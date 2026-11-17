/**
 * The door of `/api/v1/portfolio/exit/**`: the contract's one error shape, a rate limit, and for a route that builds or
 * relays — the site's own origin for a browser, or the phone's bearer, which acts only for its own wallet. The overview
 * is public: a wallet's positions are public on chain.
 */

import "server-only";

import type { NextResponse } from "next/server";

import { consumeAgentControlRequest, consumeSolanaReadRequest, readAgentControlJson } from "../../agent-control/http.ts";
import type { ApiErrorCode } from "../../api/v1/contract.ts";
import { apiFailure, apiMajorRefusal } from "../../api/v1/http.ts";
import { rateLimitHeaders, type RateLimitDecision } from "../../http-control.ts";
import { readSwapCarrier, walletMismatch } from "../../solana/swap-carrier.server.ts";
import { EXIT_MODES, EXIT_TARGETS, type ExitMode, type ExitTarget } from "./model.ts";
import type { ExitFailure, ExitFailureCode } from "./service.ts";

const CONTRACT_CODE: Readonly<Record<ExitFailureCode, ApiErrorCode>> = {
  CLOSED: "CAPABILITY_UNAVAILABLE",
  BAD_REQUEST: "VALIDATION_ERROR",
  NOTHING_TO_DO: "PORTFOLIO_EXIT_NOTHING_TO_DO",
  UNAVAILABLE: "UNAVAILABLE",
  TICKET_INVALID: "PORTFOLIO_EXIT_TICKET_INVALID",
  TICKET_EXPIRED: "PORTFOLIO_EXIT_TICKET_EXPIRED",
  SIGNED_MISMATCH: "PORTFOLIO_EXIT_SIGNED_MISMATCH",
  NOT_SIGNED: "PORTFOLIO_EXIT_NOT_SIGNED",
};

export function exitFailure(failure: ExitFailure, rate?: RateLimitDecision): NextResponse {
  return apiFailure(CONTRACT_CODE[failure.code], failure.reason, rate ? { headers: rateLimitHeaders(rate) } : {});
}

const OWNER = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export type ExitRead = Readonly<{ ok: true; rate: RateLimitDecision; owner: string; mode: ExitMode; target: ExitTarget }> | Readonly<{ ok: false; response: NextResponse }>;

/** The public overview of one wallet: the contract's major, the read budget, an owner that is an address, a mode and a target. */
export function openExitRead(request: Request): ExitRead {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return { ok: false, response: refused };
  const rate = consumeSolanaReadRequest(request.headers);
  const headers = rateLimitHeaders(rate);
  if (!rate.allowed) return { ok: false, response: apiFailure("RATE_LIMITED", "Too many requests.", { headers }) };
  const params = new URL(request.url).searchParams;
  const owner = params.get("owner") ?? "";
  if (!OWNER.test(owner)) return { ok: false, response: apiFailure("VALIDATION_ERROR", "owner must be a Solana address.", { headers }) };
  const mode = params.get("mode") ?? "exit";
  const target = params.get("target") ?? "SOL";
  if (!(EXIT_MODES as readonly string[]).includes(mode)) return { ok: false, response: apiFailure("VALIDATION_ERROR", "mode: exit or collect.", { headers }) };
  if (!(EXIT_TARGETS as readonly string[]).includes(target)) return { ok: false, response: apiFailure("VALIDATION_ERROR", "target: SOL, USDC or SPLIT.", { headers }) };
  return { ok: true, rate, owner, mode: mode as ExitMode, target: target as ExitTarget };
}

export type ExitDoor = Readonly<{ ok: true; body: unknown; rate: RateLimitDecision; mismatch: (owner: string) => boolean }> | Readonly<{ ok: false; response: NextResponse }>;

/** A build or a relay: the major, the acting budget, who carries the request, a bounded JSON body. */
export async function openExitDoor(request: Request): Promise<ExitDoor> {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return { ok: false, response: refused };
  const rate = consumeAgentControlRequest(request.headers);
  const headers = rateLimitHeaders(rate);
  if (!rate.allowed) return { ok: false, response: apiFailure("RATE_LIMITED", "Too many requests.", { headers }) };
  const carrier = await readSwapCarrier(request, "An exit must be asked for from this site.");
  if (!carrier.ok) return { ok: false, response: apiFailure(carrier.status === 401 ? "UNAUTHORIZED" : "FORBIDDEN", carrier.message, { headers }) };
  const body = await readAgentControlJson(request);
  if (!body.ok) return { ok: false, response: apiFailure("VALIDATION_ERROR", "The request body was not accepted.", { headers }) };
  return { ok: true, body: body.value, rate, mismatch: (owner) => walletMismatch(carrier, owner) };
}
