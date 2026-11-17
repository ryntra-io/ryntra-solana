import { BASE58, type LadderOrdersResponse } from "@/lib/api/v1/contract";
import { apiFailure } from "@/lib/api/v1/http";
import { ladderAnswer, ladderRefusal } from "@/lib/pro-limits/http.server";
import { readProOrders } from "@/lib/pro-limits/service.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * `GET /api/v1/ladders/orders?owner=&mint=` — a wallet's ladders with how much of each
 * filled, read from the chain; `mint` narrows them to one coin. Read-only: what a wallet holds on chain is public.
 */
export async function GET(request: Request) {
  const refused = ladderRefusal(request, "read");
  if (refused) return refused;
  const params = new URL(request.url).searchParams;
  const owner = params.get("owner") ?? "";
  const mint = params.get("mint");
  if (!BASE58.test(owner)) return apiFailure("VALIDATION_ERROR", "owner: not an address");
  if (mint !== null && !BASE58.test(mint)) return apiFailure("VALIDATION_ERROR", "mint: not an address");
  return ladderAnswer(await readProOrders({ owner, mint }), (orders) => ({ owner, orders: [...orders] }) satisfies LadderOrdersResponse);
}
