import { WalletCleanReviewRequestSchema, type WalletCleanReviewResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson } from "@/lib/api/v1/http";
import { rateLimitHeaders } from "@/lib/http-control";
import { cleanFailure, openCleanDoor } from "@/lib/wallet-clean/http.server";
import { reviewClean } from "@/lib/wallet-clean/service.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `POST /api/v1/wallet/clean/review` (contract 1.94.0) — one clean of the wallet, built and sealed: the closes, the
 * swaps of the small coins into SOL on the swap engine's own route and fee, and the close after them, as unsigned
 * transactions in the order the wallet signs them at once; what it gives back in one summary; a ticket.
 */
export async function POST(request: Request) {
  const door = await openCleanDoor(request);
  if (!door.ok) return door.response;
  const headers = rateLimitHeaders(door.rate);
  const parsed = WalletCleanReviewRequestSchema.safeParse(door.body);
  if (!parsed.success) return apiFailure("VALIDATION_ERROR", "The body is not a clean's request.", { headers });
  if (door.mismatch(parsed.data.owner)) return apiFailure("WALLET_MISMATCH", "The session's wallet is not this clean's wallet.", { headers });
  const reviewed = await reviewClean(parsed.data);
  if (!reviewed.ok) return cleanFailure(reviewed, door.rate);
  return apiJson(reviewed.value satisfies WalletCleanReviewResponse, 200, headers);
}
