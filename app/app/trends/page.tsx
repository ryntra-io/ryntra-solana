import { redirect } from "next/navigation";

/**
 * Trends is a sort of «Ринки» since the menu v6.2 (2026-10-06) — «У тренді», the day's volume — not a page of its own; `?mode=meme`
 * opens «Меми» there. `next.config.ts` sends this address first.
 */
export default async function TrendsMovedToMarkets({ searchParams }: { searchParams: Promise<{ mode?: string | string[] }> }): Promise<never> {
  const params = await searchParams;
  const mode = Array.isArray(params.mode) ? params.mode[0] : params.mode;
  redirect(mode === "meme" ? "/app/markets?tab=memes" : "/app/markets");
}
