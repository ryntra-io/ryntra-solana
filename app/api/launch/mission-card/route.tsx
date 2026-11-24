import { BASE58 } from "@/lib/api/v1/contract";
import { readCoinCard } from "@/city/lib/coin/read.server";
import { sectionCard } from "@/terminal/share/card.server";
import { coinOpenGraph } from "@/terminal/share/coin.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * `/api/launch/mission-card?mint=…` — the card older posts of a mission name (MC-0). Mission Control is
 * retired: a mint gets its coin's card (`terminal/share/coin.server.tsx`, the same as `/c/<mint>`), and the address
 * without one home's card. `moment` is read no more; an address that is not a mint is not found.
 */
export async function GET(request: Request) {
  const mint = new URL(request.url).searchParams.get("mint");
  if (!mint) return sectionCard({ id: "home" });
  if (!BASE58.test(mint)) return new Response("Not a mission card.", { status: 404 });
  return coinOpenGraph(await readCoinCard(mint));
}
