import { EarnProReviewRequestSchema, type EarnProReviewResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson } from "@/lib/api/v1/http";
import { parseEarnProReview, reviewEarnPro } from "@/lib/earn-pro/actions.server";
import { earnProFailure, openEarnProDoor } from "@/lib/earn-pro/http.server";
import { readStockSeats } from "@/lib/earn-pro/stocks.server";
import { rateLimitHeaders } from "@/lib/http-control";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * `POST /api/v1/earn/pro/review` — one action of a wallet's on a DLMM Pro pier, built and
 * sealed: a position from a goal and a width paid in SOL alone, «take and put back», the fees and the reward, leaving,
 * closing, an agent's care given or taken back. The answer is the unsigned transactions in the order they are signed,
 * what they do in numbers, and a ticket; the bytes carry no signature — the wallet signs first, and a new position's
 * fresh key stays on the server, sealed, until `submit` brings the same messages back signed.
 */
export async function POST(request: Request) {
  const door = await openEarnProDoor(request);
  if (!door.ok) return door.response;
  const headers = rateLimitHeaders(door.rate);
  const parsed = EarnProReviewRequestSchema.safeParse(door.body);
  const input = parsed.success ? parseEarnProReview(parsed.data) : null;
  if (!input) return apiFailure("VALIDATION_ERROR", "The body is not a Review's request.", { headers });
  if (door.mismatch(input.owner)) return apiFailure("WALLET_MISMATCH", "The session's wallet is not this action's wallet.", { headers });
  const reviewed = await reviewEarnPro(input, { stocks: readStockSeats });
  if (!reviewed.ok) return earnProFailure(reviewed, door.rate);
  const { expiresAt, ...rest } = reviewed.value;
  /* The engine's summary is the contract's own shape, read-only there. */
  const summary = rest.summary as EarnProReviewResponse["summary"];
  return apiJson({ ...rest, summary, transactions: [...rest.transactions], expiresAt: new Date(expiresAt).toISOString() } satisfies EarnProReviewResponse, 200, headers);
}
