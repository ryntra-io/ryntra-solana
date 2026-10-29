import { readApiBody } from "@/lib/api/v1/http";
import { TreasuryBuildRequestSchema } from "@/lib/solana/treasury/contract";
import { NOT_SERVED, treasuryFailure, treasuryJson, treasuryRateRefusal } from "@/lib/solana/treasury/http.server";
import { buildTreasury, treasuryDeps } from "@/lib/solana/treasury/service.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `POST /api/solana/treasury/build` (SOL-4) — the transactions for one treasury action, for the person's wallet to
 * sign as the fee payer and the acting member, with the Review that says what they do. The server keeps the unsigned
 * bytes to compare the signed ones with and signs nothing but a new multisig's throwaway `createKey`.
 */
export async function POST(request: Request) {
  const deps = treasuryDeps();
  if (!deps) return treasuryFailure("TREASURY_UNAVAILABLE", NOT_SERVED);
  const limited = treasuryRateRefusal("write", request.headers);
  if (limited) return limited;
  const read = await readApiBody(request, TreasuryBuildRequestSchema, 32_000);
  if (!read.ok) return read.response;
  const built = await buildTreasury(deps, read.body);
  if (!built.ok) return treasuryFailure(built.code, built.message, { issues: built.issues });
  return treasuryJson(built.build);
}
