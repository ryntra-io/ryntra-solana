import { PortfolioExitReviewRequestSchema, type PortfolioExitReviewResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson } from "@/lib/api/v1/http";
import { rateLimitHeaders } from "@/lib/http-control";
import { exitFailure, openExitDoor } from "@/lib/portfolio/exit/http.server";
import { exitReviewAnswer } from "@/lib/portfolio/exit/service.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `POST /api/v1/portfolio/exit/review` — one approval, built and sealed: the positions
 * left (or their fees collected) by the engine's own builders, the swaps into the target on the swap's own fee, as
 * unsigned transactions in the order the wallet signs them at once; what comes, the rent back and the fee in one
 * summary; what is not in it, named with why; a ticket. Closed unless the deployment opens it.
 */
export async function POST(request: Request) {
  const door = await openExitDoor(request);
  if (!door.ok) return door.response;
  const headers = rateLimitHeaders(door.rate);
  const parsed = PortfolioExitReviewRequestSchema.safeParse(door.body);
  if (!parsed.success) return apiFailure("VALIDATION_ERROR", "The body is not an exit's request.", { headers });
  if (door.mismatch(parsed.data.owner)) return apiFailure("WALLET_MISMATCH", "The session's wallet is not this exit's wallet.", { headers });
  const { owner, mode, target, positions } = parsed.data;
  const reviewed = await exitReviewAnswer({ owner, mode, target: target ?? "SOL", positions });
  if (!reviewed.ok) return exitFailure(reviewed, door.rate);
  return apiJson(reviewed.value satisfies PortfolioExitReviewResponse, 200, headers);
}
