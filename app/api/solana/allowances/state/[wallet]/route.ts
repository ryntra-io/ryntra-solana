import { NOT_SERVED, allowanceFailure, allowanceJson, allowanceRateRefusal } from "@/lib/solana/allowances/http.server";
import { isAddress } from "@/lib/solana/allowances/model";
import { allowanceDeps, allowanceState } from "@/lib/solana/allowances/service.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * `GET /api/solana/allowances/state/{wallet}` (SOL-7) — every spending limit the wallet gave and was given on the
 * Subscriptions program: who may take what now, how much was taken, until when; «unknown» wherever a read failed.
 */
export async function GET(request: Request, context: { params: Promise<{ wallet: string }> }) {
  const deps = allowanceDeps();
  if (!deps) return allowanceFailure("ALLOWANCES_UNAVAILABLE", NOT_SERVED);
  const limited = allowanceRateRefusal("read", request.headers);
  if (limited) return limited;
  const { wallet } = await context.params;
  if (!isAddress(wallet)) return allowanceFailure("VALIDATION_ERROR", "wallet: not an address");
  const read = await allowanceState(deps, wallet).catch(() => null);
  if (!read) return allowanceFailure("UNAVAILABLE", "The network could not be read now.");
  if (!read.ok) return allowanceFailure(read.code, read.message);
  return allowanceJson(read.state);
}
