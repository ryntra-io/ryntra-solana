import { NOT_SERVED, treasuryFailure, treasuryJson, treasuryRateRefusal } from "@/lib/solana/treasury/http.server";
import { isAddress } from "@/lib/solana/treasury/model";
import { treasuryDeps, treasuryState } from "@/lib/solana/treasury/service.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * `GET /api/solana/treasury/state/{multisig}` (SOL-4) — a Squads multisig as the chain holds it: members and roles,
 * threshold and delay, the vault's SOL and USDC, the latest proposals and the spending limits.
 */
export async function GET(request: Request, context: { params: Promise<{ address: string }> }) {
  const deps = treasuryDeps();
  if (!deps) return treasuryFailure("TREASURY_UNAVAILABLE", NOT_SERVED);
  const limited = treasuryRateRefusal("read", request.headers);
  if (limited) return limited;
  const { address } = await context.params;
  if (!isAddress(address)) return treasuryFailure("VALIDATION_ERROR", "address: not an address");
  const read = await treasuryState(deps, address);
  if (!read.ok) return treasuryFailure(read.code, read.message);
  return treasuryJson(read.state);
}
