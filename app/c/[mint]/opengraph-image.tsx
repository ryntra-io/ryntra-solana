import { coinOpenGraph, COIN_OG_SIZE } from "@/city/lib/coin/og.server";
import { readCoinCard } from "@/city/lib/coin/read.server";

/* `/c/<mint>`'s preview on X, Telegram and the rest: that coin's own card (`city/lib/coin/og.server.tsx`). */
export const runtime = "nodejs";
export const revalidate = 300;
export const alt = "A Solana coin in Ryntra City";
export const size = COIN_OG_SIZE;
export const contentType = "image/png";

type Params = { mint: string };

export default async function Image({ params }: { params: Promise<Params> | Params }) {
  const { mint } = await params;
  return coinOpenGraph(await readCoinCard(mint));
}
