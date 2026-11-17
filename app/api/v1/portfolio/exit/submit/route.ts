import { PortfolioExitSubmitRequestSchema, type PortfolioExitSubmitResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson } from "@/lib/api/v1/http";
import { rateLimitHeaders } from "@/lib/http-control";
import { exitFailure, openExitDoor } from "@/lib/portfolio/exit/http.server";
import { exitSubmitAnswer } from "@/lib/portfolio/exit/service.server";
import { readExitTicket } from "@/lib/portfolio/exit/ticket";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `POST /api/v1/portfolio/exit/submit` — the wallet's signed transactions of an exit, held
 * to its ticket, then sent once each: first what stands alone, then the swaps of what arrived once their positions have
 * landed. Where one does not land, the answer says which did.
 */
export async function POST(request: Request) {
  const door = await openExitDoor(request);
  if (!door.ok) return door.response;
  const headers = rateLimitHeaders(door.rate);
  const parsed = PortfolioExitSubmitRequestSchema.safeParse(door.body);
  if (!parsed.success) return apiFailure("VALIDATION_ERROR", "A relay takes a ticket and the signed transactions.", { headers });
  const read = readExitTicket(parsed.data.ticket, process.env);
  if (read.ok && door.mismatch(read.ticket.owner)) return apiFailure("WALLET_MISMATCH", "The session's wallet is not this exit's wallet.", { headers });
  const relayed = await exitSubmitAnswer(parsed.data);
  if (!relayed.ok) return exitFailure(relayed, door.rate);
  return apiJson(relayed.value satisfies PortfolioExitSubmitResponse, 200, headers);
}
