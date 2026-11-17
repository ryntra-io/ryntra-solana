import { LadderQuoteRequestSchema, type LadderQuoteResponse } from "@/lib/api/v1/contract";
import { readApiBody } from "@/lib/api/v1/http";
import { ladderAnswer, ladderRefusal } from "@/lib/pro-limits/http.server";
import { readProQuote } from "@/lib/pro-limits/service.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * `POST /api/v1/ladders/quote` — a ladder told before anything is built: its prices, what
 * rests on each and what it pays once filled at that price exactly, and the maker's bonus with Ryntra's part of it.
 */
export async function POST(request: Request) {
  const refused = ladderRefusal(request, "read");
  if (refused) return refused;
  const read = await readApiBody(request, LadderQuoteRequestSchema, 2_048);
  if (!read.ok) return read.response;
  return ladderAnswer(await readProQuote(read.body), (quote) => ({ ...quote, rungs: [...quote.rungs] }) satisfies LadderQuoteResponse);
}
