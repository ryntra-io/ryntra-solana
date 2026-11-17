import { WalletCleanSubmitRequestSchema, type WalletCleanSubmitResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson } from "@/lib/api/v1/http";
import { rateLimitHeaders } from "@/lib/http-control";
import { cleanFailure, openCleanDoor } from "@/lib/wallet-clean/http.server";
import { submitClean } from "@/lib/wallet-clean/service.server";
import { readCleanTicket } from "@/lib/wallet-clean/ticket";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `POST /api/v1/wallet/clean/submit` (contract 1.94.0) — the wallet's signed transactions of a clean, held to its
 * ticket, then sent once each: the closes, the swaps, and the close after the swaps once they landed. Where one does
 * not land, the answer says which did.
 */
export async function POST(request: Request) {
  const door = await openCleanDoor(request);
  if (!door.ok) return door.response;
  const headers = rateLimitHeaders(door.rate);
  const parsed = WalletCleanSubmitRequestSchema.safeParse(door.body);
  if (!parsed.success) return apiFailure("VALIDATION_ERROR", "A relay takes a ticket and the signed transactions.", { headers });
  const read = readCleanTicket(parsed.data.ticket, process.env);
  if (read.ok && door.mismatch(read.ticket.owner)) return apiFailure("WALLET_MISMATCH", "The session's wallet is not this clean's wallet.", { headers });
  const relayed = await submitClean(parsed.data);
  if (!relayed.ok) return cleanFailure(relayed, door.rate);
  return apiJson(relayed.value satisfies WalletCleanSubmitResponse, 200, headers);
}
