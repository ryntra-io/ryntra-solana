import { LadderSubmitRequestSchema, type LadderSubmitResponse } from "@/lib/api/v1/contract";
import { readApiBody } from "@/lib/api/v1/http";
import { ladderAnswer, ladderRefusal } from "@/lib/pro-limits/http.server";
import { submitProLimit } from "@/lib/pro-limits/service.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `POST /api/v1/ladders/submit` — the relay: the Review's ticket and its transactions,
 * signed by the wallet, in order. Only the bytes the Review showed are sent; anything else is refused and nothing
 * moves.
 */
export async function POST(request: Request) {
  const refused = ladderRefusal(request, "write");
  if (refused) return refused;
  const read = await readApiBody(request, LadderSubmitRequestSchema, 24_576);
  if (!read.ok) return read.response;
  return ladderAnswer(await submitProLimit(read.body), (relay) => ({ action: relay.action, nftMint: relay.nftMint, results: [...relay.results], settled: relay.settled }) satisfies LadderSubmitResponse);
}
