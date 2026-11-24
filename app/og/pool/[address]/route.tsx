import { isPoolAddress } from "@/lib/earn-pools/bins";
import { poolOpenGraph, readPoolFacts } from "@/terminal/share/pool.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

/**
 * `/og/pool/<address>` — a Meteora pool's share card (`terminal/share/pool.server.tsx`): its pair, its venue and what
 * the engine reads of it now, kept five minutes. A pool the engine does not know draws the pool section's card; an
 * address that is not a pool's is not found.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  if (!isPoolAddress(address)) return new Response("Not found", { status: 404, headers: { "cache-control": "public, max-age=300" } });
  return poolOpenGraph(await readPoolFacts(address).catch(() => null));
}
