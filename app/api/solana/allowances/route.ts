import { NOT_SERVED, allowanceFailure, allowanceJson, allowanceRateRefusal } from "@/lib/solana/allowances/http.server";
import { allowanceDeps, allowanceInfo } from "@/lib/solana/allowances/service.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** `GET /api/solana/allowances` (SOL-7) — the network the limits run on, the Subscriptions program and its USDC. */
export async function GET(request: Request) {
  const deps = allowanceDeps();
  if (!deps) return allowanceFailure("ALLOWANCES_UNAVAILABLE", NOT_SERVED);
  const limited = allowanceRateRefusal("read", request.headers);
  if (limited) return limited;
  return allowanceJson(allowanceInfo(deps));
}
