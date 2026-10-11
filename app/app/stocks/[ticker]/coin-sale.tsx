"use client";

import { useCallback, useMemo } from "react";

import { coinSaleAssetOf, coinSaleLines } from "@/app/app/invest/sale-model";
import type { WorkspaceLocale } from "@/app/shell/locale";
import { openSolanaConnection } from "@/app/solana/workspace/connection-trigger.client";
import { useSpotMarket } from "@/app/solana/workspace/spot/use-spot-data";
import { SOLANA_MAINNET_USDC_MINT, WRAPPED_SOL_MINT } from "@/lib/solana/send-kinds";
import type { CheckBasis, CheckOrderFigures } from "@/lib/stocks/check";

import { SellSheet, type SellSheetProps } from "./sell-sheet";

/**
 * The sale of a coin from its position in Portfolio — the same sheet as a
 * company's (`sell-sheet.tsx`), on the same execution path into USDC, with the
 * coin read as Spot reads it (`/api/spot/market`, `coinSaleAssetOf`): its
 * name, its icon, what it is, its price. Open while `mint` is set; the
 * position's own logo and name stand in the head while it is read.
 *
 * The server counts «Перевірка» for a company only (`check`, contract 1.20.0),
 * so a coin's four lines are counted here, by the same rules, on the order the
 * server answered (`coinSaleLines`) — the network's fee at SOL's price as
 * Spot's header reads it — and handed to the sheet, which draws them.
 */
export function CoinPositionSale({ mint, placeholder, locale, onClose }: Readonly<{ mint: string | null; placeholder: SellSheetProps["placeholder"]; locale: WorkspaceLocale; onClose: () => void }>) {
  const read = useSpotMarket(mint);
  const sol = useSpotMarket(mint === null ? null : WRAPPED_SOL_MINT);
  const lang = locale === "uk" ? "uk" : "en";
  /* A read of the previous coin is never drawn under this one's name. */
  const market = read.value && read.value.mint === mint ? read.value : null;
  const asset = useMemo(() => (market ? coinSaleAssetOf(market, lang, WRAPPED_SOL_MINT) : null), [market, lang]);
  const solUsd = sol.value?.price ?? null;
  const linesOf = useCallback(
    (order: CheckOrderFigures, basis: CheckBasis) => (asset ? coinSaleLines({ order, basis, asset, solUsd, usdcMint: SOLANA_MAINNET_USDC_MINT }) : null),
    [asset, solUsd],
  );
  const connectFirst = useCallback(() => {
    onClose();
    window.requestAnimationFrame(() => openSolanaConnection());
  }, [onClose]);
  const failed = mint !== null && market === null && (read.status === "unknown" || read.status === "unavailable");
  return <SellSheet open={mint !== null} asset={asset} placeholder={placeholder} failed={failed} coin linesOf={linesOf} locale={locale} onClose={onClose} onConnect={connectFirst} />;
}
