"use client";

import { useEffect, useMemo, useState } from "react";

import { ProChart } from "@/app/components/chart/ProChart";
import { readResolvedTheme, watchResolvedTheme } from "@/app/app/theme";
import { SPOT_TIMEFRAMES, TIMEFRAME_SOURCE, type SpotTimeframe, isSpotTimeframe } from "@/lib/spot/candles";

import { useSolanaI18n } from "../i18n/provider.tsx";
import type { CandlesState, NoChartCode } from "./use-spot-data.ts";

import styles from "./spot.module.css";

const TF_KEY = "ryntra.spot.timeframe.v1";

export function useSpotTimeframe(): [SpotTimeframe, (next: SpotTimeframe) => void] {
  const [timeframe, setTimeframe] = useState<SpotTimeframe>("1h");
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(TF_KEY);
      if (isSpotTimeframe(stored)) setTimeframe(stored);
    } catch {
      /* A denied store keeps the default. */
    }
  }, []);
  const set = (next: SpotTimeframe) => {
    setTimeframe(next);
    try {
      window.localStorage.setItem(TF_KEY, next);
    } catch {
      /* Nothing to keep. */
    }
  };
  return [timeframe, set];
}

/**
 * The price chart — `lightweight-charts` through the repository's ProChart,
 * fed real candles and nothing else. A market with no pool says so in the
 * frame; a source that stopped answering keeps the last read and says that.
 * Pro turns on indicators and chart settings; Simple is the candles, the
 * timeframes and the price.
 */
export function SpotChart({
  symbol,
  candles,
  timeframe,
  onTimeframe,
  pro,
}: {
  symbol: string;
  candles: CandlesState;
  timeframe: SpotTimeframe;
  onTimeframe: (next: SpotTimeframe) => void;
  pro: boolean;
}) {
  const { text } = useSolanaI18n();
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  useEffect(() => {
    setTheme(readResolvedTheme());
    return watchResolvedTheme(setTheme);
  }, []);

  const rows = useMemo(() => (candles.value ? [...candles.value.candles] : []), [candles.value]);
  const tfSeconds = TIMEFRAME_SOURCE[timeframe].seconds;
  const note =
    candles.status === "unavailable" && rows.length > 0
      ? text("Chart source paused — showing the last read")
      : candles.status === "ready" && candles.stale
        ? text("Chart source paused — showing the last read")
        : candles.status === "loading" && rows.length === 0
          ? text("Loading chart…")
          : candles.status === "ready" && rows.length === 0
            ? text("No candles for this timeframe yet")
            : null;

  if (candles.status === "none" || (candles.status === "unavailable" && rows.length === 0)) {
    /* A market with no chart says why in one sentence — the wrong chart is
       worse than none — and the ticket keeps working from the live quote. */
    const why: Record<NoChartCode, string> = {
      NO_POOL: text("No pool prices this asset on the chart source."),
      NO_MAJOR_QUOTE: text("This asset is only paired against assets whose dollar price cannot be trusted."),
      THIN: text("No pool for this asset holds enough liquidity to be called its market."),
      QUIET: text("No pool for this asset traded in the last day."),
      STALE: text("The newest candle is more than three days old."),
      PRICE_MISMATCH: text("The pool's price does not agree with the market price of this asset."),
    };
    return (
      <section className={`${styles.panel} ${styles.chart}`} aria-label={text("Chart")}>
        <div className={styles.chartState}>
          <div>
            <b>{candles.status === "none" ? text("Chart unavailable") : text("The chart is unavailable right now")}</b>
            {candles.status === "none"
              ? `${candles.code ? why[candles.code] : text("No pool prices this asset on the chart source.")} ${text("Buy and Sell still work from the live quote.")}`
              : text("The price and the order ticket still work; the chart will return on its own.")}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className={`${styles.panel} ${styles.chart}`} aria-label={text("Chart")}>
      <ProChart
        candles={rows}
        symbolLabel={symbol}
        tfSeconds={tfSeconds}
        theme={theme}
        timeframes={SPOT_TIMEFRAMES}
        tf={timeframe}
        onTfChange={(next) => {
          if (isSpotTimeframe(next)) onTimeframe(next);
        }}
        storageNamespace="spot"
        drawingScope={`spot:${symbol}`}
        note={note ? <span className={styles.chartNote}>{note}</span> : undefined}
        chartClassName={styles.chartCanvas}
        features={pro ? { indicators: true, settings: true, drawings: true, fullscreen: true } : { indicators: false, settings: false, drawings: false, fullscreen: false }}
      />
    </section>
  );
}
