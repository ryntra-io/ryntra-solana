import { Suspense } from "react";

import { authorityViews } from "@/lib/core/authority-matrix";
import { SYMBOL } from "@/lib/phoenix/market-data";

import { solanaServerLocale } from "../i18n/server.ts";
import { FuturesWorkspace } from "./futures-workspace.tsx";
import { futuresWord } from "./futures-words.ts";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const locale = await solanaServerLocale();
  return { title: futuresWord(locale === "uk" ? "uk" : "en", "title") };
}

/**
 * Perps — Phoenix's perpetuals, a row of Торгівля inside Ryntra on Solana, at `/app/perps`
 * (PERP-1; `/app/futures` leads here for good, `lib/product/customer-routing.ts`). A view
 * first for orders; «Застава» moves USDC between the wallet and Phoenix, each move signed by the wallet (B6). `?market=SOL`
 * opens a market directly; anything else in the address opens SOL. Orders' honest state is read here on the server from
 * the authority matrix (EXE-1) and said as a word in the market's head.
 */
export default async function FuturesPage({ searchParams }: { searchParams: Promise<{ market?: string }> }) {
  const params = await searchParams;
  const symbol = params.market && SYMBOL.test(params.market) ? params.market : null;
  return (
    <Suspense>
      <FuturesWorkspace initialSymbol={symbol} ordersState={authorityViews(["phoenix.orders"])["phoenix.orders"].state} />
    </Suspense>
  );
}
