import { EarnProSubmitRequestSchema, type EarnProSubmitResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson } from "@/lib/api/v1/http";
import { submitEarnPro } from "@/lib/earn-pro/actions.server";
import { earnProFailure, openEarnProDoor } from "@/lib/earn-pro/http.server";
import { readEarnProTicket } from "@/lib/earn-pro/ticket";
import { rateLimitHeaders } from "@/lib/http-control";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `POST /api/v1/earn/pro/submit` — the wallet's signed transactions of a Review: held to
 * its ticket — the same messages, the same wallet, every signature real — then sent once each, in order, and settled
 * from the chain's answer. A refusal before the first send means nothing moved; where a later one does not land, the
 * answer says which did.
 */
export async function POST(request: Request) {
  const door = await openEarnProDoor(request);
  if (!door.ok) return door.response;
  const headers = rateLimitHeaders(door.rate);
  const parsed = EarnProSubmitRequestSchema.safeParse(door.body);
  if (!parsed.success) return apiFailure("VALIDATION_ERROR", "A relay takes a ticket and the signed transactions.", { headers });
  const read = readEarnProTicket(parsed.data.ticket, process.env);
  if (read.ok && door.mismatch(read.ticket.owner)) return apiFailure("WALLET_MISMATCH", "The session's wallet is not this action's wallet.", { headers });
  const relayed = await submitEarnPro(parsed.data);
  if (!relayed.ok) return earnProFailure(relayed, door.rate);
  return apiJson({ action: relayed.value.action, nftMint: relayed.value.nftMint, results: relayed.value.results.map((result) => ({ ...result, reason: result.reason?.slice(0, 240) ?? null })), settled: relayed.value.settled } satisfies EarnProSubmitResponse, 200, headers);
}
