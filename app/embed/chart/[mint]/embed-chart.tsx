"use client";

/* The core's tokens, base and components, then its chart — what the cabinet's frame loads (`app/app/product-shell.tsx`),
   without the frame. */
import "@ryntra/core/tokens.css";
import "@ryntra/core/base.css";
import "@ryntra/core/ui.css";
import "@ryntra/core/chart.css";
import "@/app/design/tokens.css";

import { capFactorOf, SpotChart, useSpotTimeframe } from "@/app/solana/workspace/spot/spot-chart.tsx";
import { useSpotCandles, useSpotMarket, useTokenPart } from "@/app/solana/workspace/spot/use-spot-data.ts";
import type { TokenMark } from "@/lib/spot/token-page";

import styles from "./embed-chart.module.css";

/**
 * The spot page's chart of one market and nothing around it (CH-21): the market's price, its candles at the chosen
 * interval and the market's own marks — the same public reads the spot page makes. No wallet is read here: the
 * person's orders and trades are the app's, on its own screens. The candles take the whole window under the chart's
 * bar, less the line of the sources under them.
 */
export function EmbedChart({ mint }: { mint: string }) {
  const [timeframe, setTimeframe] = useSpotTimeframe();
  const market = useSpotMarket(mint);
  const candles = useSpotCandles(mint, timeframe);
  const overview = useTokenPart<{ marks: readonly TokenMark[] }>(mint, "overview", true);
  const marks = overview.status === "ready" ? overview.value.marks : overview.status === "loading" || overview.status === "unavailable" ? (overview.value?.marks ?? []) : [];
  const value = market.value;
  const livePrice = market.status === "ready" && !market.stale ? (value?.price ?? null) : null;
  return (
    <div className={styles.frame} data-embed-chart>
      <SpotChart
        symbol={value?.symbol ?? ""}
        mint={mint}
        stock={value?.category === "stock"}
        candles={candles}
        timeframe={timeframe}
        onTimeframe={setTimeframe}
        capFactor={capFactorOf(value ?? null)}
        marks={marks}
        livePrice={livePrice}
        fullScreen={false}
      />
    </div>
  );
}
