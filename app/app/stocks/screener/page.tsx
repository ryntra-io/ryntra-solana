import { redirect } from "next/navigation";

/**
 * The stock screener is «Ринки → Акції» since the menu v6.2 (2026-10-06,
 *): one table for every asset, with the same columns for a
 * stock — the issuer, the exchange's session, the deviation. `?kind=preipo`
 * opens «Приватні» there. `next.config.ts` sends this address first.
 */
export default async function ScreenerMovedToMarkets({ searchParams }: { searchParams: Promise<{ kind?: string | string[]; q?: string | string[] }> }): Promise<never> {
  const params = await searchParams;
  const kind = Array.isArray(params.kind) ? params.kind[0] : params.kind;
  redirect(kind === "preipo" ? "/app/markets?tab=private" : "/app/markets?tab=stocks");
}
