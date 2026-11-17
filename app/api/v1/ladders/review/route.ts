import { LadderReviewRequestSchema, type LadderReviewResponse } from "@/lib/api/v1/contract";
import { readApiBody } from "@/lib/api/v1/http";
import { ladderAnswer, ladderRefusal } from "@/lib/pro-limits/http.server";
import { reviewProLimit } from "@/lib/pro-limits/service.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `POST /api/v1/ladders/review` — one action's unsigned transactions and the ticket the
 * relay holds them to: place a ladder, take what filled, cancel, or let Ryntra's agent collect. The wallet in the
 * body pays and is the only signer a person holds; the server signs nothing here and keeps no key of the person's.
 */
export async function POST(request: Request) {
  const refused = ladderRefusal(request, "write");
  if (refused) return refused;
  const read = await readApiBody(request, LadderReviewRequestSchema, 2_048);
  if (!read.ok) return read.response;
  return ladderAnswer(
    await reviewProLimit(read.body),
    (review) => ({ ...review, transactions: [...review.transactions], quote: review.quote ? { ...review.quote, rungs: [...review.quote.rungs] } : null }) satisfies LadderReviewResponse,
  );
}
