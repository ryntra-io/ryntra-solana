/**
 * What every `/api/v1/autopay` route does first: the contract's major, the rate, the wallet's proof (a read
 * takes it, a change takes the wallet's own signature behind it — `requireWalletProof`), and the switch. Closed — the
 * route answers `CAPABILITY_UNAVAILABLE`, and the screen shows no autopay at all.
 */

import { z } from "zod";
import type { NextResponse } from "next/server";

import { consumeSolanaReadRequest } from "../agent-control/http.ts";
import { apiFailure } from "../api/v1/http.ts";
import { apiMajorRefusal } from "../api/v1/http.ts";
import { requireWalletProof } from "../api/v1/proof.ts";
import { rateLimitHeaders } from "../http-control.ts";
import type { Failure } from "./service.server.ts";
import { autopayGate, type OpenAutopay } from "./service.server.ts";
import { AUTOPAY_COINS, AUTOPAY_EVERY, COUNT_MAX } from "./schedule.ts";

export type OpenRequest = Readonly<{ gate: OpenAutopay; owner: string }>;

export async function openAutopayRequest(request: Request, intent: "read" | "mutation"): Promise<OpenRequest | NextResponse> {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many requests.", { headers: rateLimitHeaders(rate) });
  const gate = autopayGate();
  if (!gate.open) return apiFailure("CAPABILITY_UNAVAILABLE", "Autopay is not open here.");
  const proof = await requireWalletProof(request, intent);
  if (!proof.ok) return proof.response;
  return { gate, owner: proof.address };
}

/** A failure of the service as the contract answers it: its own refusals travel as a validation error naming the reason. */
export function autopayFailure(failure: Failure): NextResponse {
  if (failure.code === "UNAVAILABLE") return apiFailure("UNAVAILABLE", failure.reason);
  if (failure.code === "WRONG_NETWORK") return apiFailure("UNAVAILABLE", "The network did not answer. Try again.");
  return apiFailure("VALIDATION_ERROR", failure.reason, { issues: [{ path: failure.code.toLowerCase(), message: failure.reason }] });
}

const Base64Tx = z.string().min(64).max(4_096).regex(/^[A-Za-z0-9+/]+={0,2}$/);

export const ReviewSchema = z.object({
  to: z.string().min(1).max(80),
  label: z.string().max(64).nullable().optional(),
  coin: z.enum(AUTOPAY_COINS),
  amount: z.string().min(1).max(32),
  every: z.enum(AUTOPAY_EVERY),
  count: z.number().int().min(1).max(COUNT_MAX),
  startAt: z.number().int().positive().nullable().optional(),
  smartAccount: z.string().max(64).nullable().optional(),
});

export const SubmitSchema = z.object({
  draft: z.record(z.string(), z.unknown()),
  transactions: z.array(Base64Tx).min(1).max(2),
});

export const StopSchema = z.object({
  id: z.string().uuid(),
  transaction: Base64Tx.optional(),
});
