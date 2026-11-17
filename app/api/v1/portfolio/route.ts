import { BASE58, type PortfolioResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal } from "@/lib/api/v1/http";
import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import { rateLimitHeaders } from "@/lib/http-control";
import { portfolioAnswer } from "@/lib/portfolio/service.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * `GET /api/v1/portfolio?owner=` — everything a wallet holds across Solana, outside Ryntra
 * too: coins and liquid staking, native stake, Meteora pools, lending deposits and borrows, and apart a projection of
 * the platforms the engine does not read itself. Every position says whether one step takes it out and, if not, why.
 * Public data of a public address; a source that falls is in the answer, never its error. `refresh=1` reads again.
 */
export async function GET(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const rate = consumeSolanaReadRequest(request.headers);
  const headers = rateLimitHeaders(rate);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many requests.", { headers });
  const params = new URL(request.url).searchParams;
  const owner = params.get("owner") ?? "";
  if (!BASE58.test(owner)) return apiFailure("VALIDATION_ERROR", "owner: a wallet's address.", { headers });
  const answer = await portfolioAnswer(owner, params.get("refresh") === "1").catch(() => null);
  if (!answer) return apiFailure("UNAVAILABLE", "The portfolio could not be read. Try again.", { headers });
  return apiJson(answer satisfies PortfolioResponse, 200, headers);
}
