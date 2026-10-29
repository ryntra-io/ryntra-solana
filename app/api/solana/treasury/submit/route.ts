import { readApiBody } from "@/lib/api/v1/http";
import { TreasurySubmitRequestSchema } from "@/lib/solana/treasury/contract";
import { NOT_SERVED, treasuryFailure, treasuryJson, treasuryRateRefusal } from "@/lib/solana/treasury/http.server";
import { submitTreasury, treasuryDeps } from "@/lib/solana/treasury/service.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `POST /api/solana/treasury/submit` (SOL-4) — what the wallet signed: each transaction the built one, with only the
 * wallet's own fee and guard instructions added; sent once, in order, stopping at the first that does not land.
 * `PENDING` — sent and not confirmed in time: the treasury's page reads the chain again, nothing is sent twice.
 */
export async function POST(request: Request) {
  const deps = treasuryDeps();
  if (!deps) return treasuryFailure("TREASURY_UNAVAILABLE", NOT_SERVED);
  const limited = treasuryRateRefusal("write", request.headers);
  if (limited) return limited;
  const read = await readApiBody(request, TreasurySubmitRequestSchema, 200_000);
  if (!read.ok) return read.response;
  const submitted = await submitTreasury(deps, read.body).catch(() => null);
  if (!submitted) return treasuryFailure("UNAVAILABLE", "No answer could be read from the network now; if it was sent, the treasury's page shows it.");
  if (!submitted.ok) return treasuryFailure(submitted.code, submitted.message);
  return treasuryJson(submitted.submit);
}
