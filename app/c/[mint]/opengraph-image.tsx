import { readCoinCard } from "@/city/lib/coin/read.server";
import { coinOpenGraph, COIN_OG_SIZE } from "@/terminal/share/coin.server";

/* A coin's preview on X, Telegram and the rest — `/coin/<mint>` and the older `/c/<mint>` name it: that coin's own card
   (`terminal/share/coin.server.tsx`) — its logo, its figures from the engine, what is true of it. */
export const runtime = "nodejs";
export const revalidate = 300;
export const alt = "A Solana coin on Ryntra — its price, the day's move and its market cap";
export const size = COIN_OG_SIZE;
export const contentType = "image/png";

type Params = { mint: string };

export default async function Image({ params }: { params: Promise<Params> | Params }) {
  const { mint } = await params;
  return coinOpenGraph(await readCoinCard(mint));
}
