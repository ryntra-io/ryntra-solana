import { BASE58 } from "@/lib/api/v1/contract";
import { coinOpenGraph } from "@/city/lib/coin/og.server";
import { readCoinCard } from "@/city/lib/coin/read.server";
import { cityCard } from "@/city/lib/share/card.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * `/api/launch/mission-card?mint=…` — the card older posts of a mission name (MC-0). Mission Control is retired: since
 * CITY-158 a mint gets its tower's card in the city (`city/lib/coin/og.server.tsx`, the same as `/c/<mint>`), and the
 * address without one the city's card. `moment` is read no more; an address that is not a mint is not found.
 */
export async function GET(request: Request) {
  const mint = new URL(request.url).searchParams.get("mint");
  if (!mint) return cityCard();
  if (!BASE58.test(mint)) return new Response("Not a mission card.", { status: 404 });
  return coinOpenGraph(await readCoinCard(mint));
}
