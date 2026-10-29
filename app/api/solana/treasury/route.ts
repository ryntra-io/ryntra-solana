import { NOT_SERVED, treasuryFailure, treasuryJson, treasuryRateRefusal } from "@/lib/solana/treasury/http.server";
import { treasuryDeps, treasuryInfo } from "@/lib/solana/treasury/service.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** `GET /api/solana/treasury` (SOL-4) — the network the treasury runs on and Squads' fee for a new multisig. */
export async function GET(request: Request) {
  const deps = treasuryDeps();
  if (!deps) return treasuryFailure("TREASURY_UNAVAILABLE", NOT_SERVED);
  const limited = treasuryRateRefusal("read", request.headers);
  if (limited) return limited;
  return treasuryJson(await treasuryInfo(deps));
}
