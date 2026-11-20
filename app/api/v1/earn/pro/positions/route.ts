import { BASE58, type EarnProPositionsResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson } from "@/lib/api/v1/http";
import { openEarnProRead, earnProClosed } from "@/lib/earn-pro/http.server";
import { earnProPositionsAnswer } from "@/lib/earn-pro/service.server";
import { readStockSeats } from "@/lib/earn-pro/stocks.server";
import { rateLimitHeaders } from "@/lib/http-control";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * `GET /api/v1/earn/pro/positions?owner=` — a wallet's positions at the DLMM Pro piers,
 * read from the chain: what each is worth, the fees to take, the pool's reward, whether it earns now, and — where an
 * agent looks after it — what that care was told and did. Public data of a public address.
 */
export async function GET(request: Request) {
  const door = openEarnProRead(request);
  if (!door.ok) return door.response;
  const headers = rateLimitHeaders(door.rate);
  const owner = new URL(request.url).searchParams.get("owner") ?? "";
  if (!BASE58.test(owner)) return apiFailure("VALIDATION_ERROR", "owner: a wallet's address.", { headers });
  const answer = await earnProPositionsAnswer(owner, process.env, { stocks: readStockSeats }).catch(() => undefined);
  if (answer === undefined) return apiFailure("UNAVAILABLE", "The chain did not answer for the positions. Try again.", { headers });
  if (answer === null) return earnProClosed(door.rate);
  return apiJson(answer satisfies EarnProPositionsResponse, 200, headers);
}
