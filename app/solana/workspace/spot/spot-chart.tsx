"use client";

import { useEffect, useMemo, useState } from "react";

import { ProChart } from "@/app/components/chart/ProChart";
import { readResolvedTheme, watchResolvedTheme } from "@/app/app/theme";
import type { ChartMarkerSpec } from "@/lib/chart/types";
import { SPOT_TIMEFRAMES, TIMEFRAME_SOURCE, type SpotTimeframe, isSpotTimeframe } from "@/lib/spot/candles";
import type { TokenMark } from "@/lib/spot/token-page";

import { useSolanaI18n } from "../i18n/provider.tsx";
import { formatPercent, formatUsdAxis } from "./spot-format.ts";
import type { CandlesState, NoChartCode } from "./use-spot-data.ts";

import styles from "./spot.module.css";

const TF_KEY = "ryntra.spot.timeframe.v1";
const SERIES_KEY = "ryntra.spot.series.v1";

/** What the chart draws: the price, or the market's capitalisation over the same candles. */
export type SpotSeries = "price" | "cap";

/**
 * The capitalisation over a market's candles: each candle times the supply
 * the catalogue counts today (its market cap over its price), so the line is
 * the price's own line on a capitalisation's scale. A supply that changed over
 * the window is not redrawn — the chart says the scale is today's supply. Null
 * without both figures, or for a tokenized stock, whose token supply is no
 * company's value.
 */
export function capFactorOf(market: Readonly<{ price: number | null; marketCapUsd: number | null; category: string | null }> | null): number | null {
  if (!market || market.category === "stock") return null;
  const { price, marketCapUsd } = market;
  if (price === null || marketCapUsd === null || !Number.isFinite(price) || !Number.isFinite(marketCapUsd) || price <= 0 || marketCapUsd <= 0) return null;
  const factor = marketCapUsd / price;
  return Number.isFinite(factor) && factor > 0 ? factor : null;
}

function useSpotSeries(): [SpotSeries, (next: SpotSeries) => void] {
  const [series, setSeries] = useState<SpotSeries>("price");
  useEffect(() => {
    try {
      if (window.localStorage.getItem(SERIES_KEY) === "cap") setSeries("cap");
    } catch {
      /* A denied store keeps the price. */
    }
  }, []);
  const set = (next: SpotSeries) => {
    setSeries(next);
    try {
      window.localStorage.setItem(SERIES_KEY, next);
    } catch {
      /* Nothing to keep. */
    }
  };
  return [series, set];
}

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
 *
 * «Ціна · Капіталізація» beside the timeframes switches the same candles to
 * the market's capitalisation (`capFactorOf`) — the axis in compact dollars,
 * a line under the switch that the scale is today's supply, and drawings kept
 * apart from the price's. A market without a capitalisation, or a tokenized
 * stock, has no switch.
 */
export function SpotChart({
  symbol,
  candles,
  timeframe,
  onTimeframe,
  pro,
  capFactor = null,
  marks = [],
  ownTrades = [],
}: {
  symbol: string;
  candles: CandlesState;
  timeframe: SpotTimeframe;
  onTimeframe: (next: SpotTimeframe) => void;
  pro: boolean;
  /** The supply the market cap is counted on (`capFactorOf`); null: no capitalisation to switch to. */
  capFactor?: number | null;
  /** The market's own marks (`marksOf`): the largest trades, the creator's, the curve's exit, a fall in liquidity. */
  marks?: readonly TokenMark[];
  /** The person's own filled trades of this market, from the wallet's history. */
  ownTrades?: readonly Readonly<{ t: number; side: "buy" | "sell" }>[];
}) {
  const { text, locale } = useSolanaI18n();
  const [chosen, setSeries] = useSpotSeries();
  const series: SpotSeries = capFactor === null ? "price" : chosen;
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  useEffect(() => {
    setTheme(readResolvedTheme());
    return watchResolvedTheme(setTheme);
  }, []);

  const rows = useMemo(() => {
    const source = candles.value ? candles.value.candles : [];
    if (series !== "cap" || capFactor === null) return [...source];
    return source.map((candle) => ({ ...candle, open: candle.open * capFactor, high: candle.high * capFactor, low: candle.low * capFactor, close: candle.close * capFactor }));
  }, [candles.value, series, capFactor]);
  /* Four significant figures in the header's own «$…B» shape: the axis steps read apart («$1.234B», «$1.241B»), narrow in both languages. */
  const capFormatter = useMemo(() => (value: number) => formatUsdAxis(value, locale), [locale]);
  const tfSeconds = TIMEFRAME_SOURCE[timeframe].seconds;
  const markers = useMemo<ChartMarkerSpec[]>(() => {
    const out: ChartMarkerSpec[] = [];
    for (const mark of marks) {
      if (mark.kind === "big-buy") out.push({ time: mark.t, position: "belowBar", shape: "arrowUp", color: "up", text: "" });
      else if (mark.kind === "big-sell") out.push({ time: mark.t, position: "aboveBar", shape: "arrowDown", color: "down", text: "" });
      else if (mark.kind === "creator-buy") out.push({ time: mark.t, position: "belowBar", shape: "arrowUp", color: "up", text: text("Creator") });
      else if (mark.kind === "creator-sell") out.push({ time: mark.t, position: "aboveBar", shape: "arrowDown", color: "down", text: mark.pct === null ? text("Creator sold") : `${text("Creator sold")} ${mark.pct < 0.01 ? "<0.01" : mark.pct.toFixed(mark.pct < 1 ? 2 : 1)}%` });
      else if (mark.kind === "dex") out.push({ time: mark.t, position: "aboveBar", shape: "circle", color: "ink", text: text("On DEX") });
      else if (mark.kind === "liquidity-drop") out.push({ time: mark.t, position: "aboveBar", shape: "square", color: "down", text: `${text("Liquidity")} ${formatPercent(mark.pct, locale)}` });
    }
    for (const own of ownTrades) out.push({ time: own.t, position: own.side === "buy" ? "belowBar" : "aboveBar", shape: "circle", color: "ink", text: text("You") });
    return out.sort((a, b) => a.time - b.time);
  }, [marks, ownTrades, locale, text]);
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
      <section className={`${styles.panel} ${styles.chart}`} aria-label={text("Chart")} data-terminal-chart data-dense>
        <div className={styles.chartState} data-chart-state>
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

  const switcher =
    capFactor === null ? null : (
      <span className={styles.seriesSwitch} role="group" aria-label={text("The chart shows")} data-chart-series={series}>
        {(["price", "cap"] as const).map((entry) => (
          <button key={entry} type="button" className={series === entry ? "on" : ""} aria-pressed={series === entry} onClick={() => setSeries(entry)} title={entry === "cap" ? text("Market cap at today's circulating supply") : undefined}>
            {entry === "price" ? text("Price") : text("Market cap")}
          </button>
        ))}
      </span>
    );
  const head = switcher || note ? (
    <>
      {switcher}
      {note ? <span className={styles.chartNote}>{note}</span> : null}
    </>
  ) : undefined;

  return (
    <section className={`${styles.panel} ${styles.chart}`} aria-label={text("Chart")} data-terminal-chart data-dense>
      <ProChart
        key={series}
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
        drawingScope={series === "cap" ? `spot:${symbol}:cap` : `spot:${symbol}`}
        note={head}
        priceFormatter={series === "cap" ? capFormatter : undefined}
        markers={markers}
        chartClassName={styles.chartCanvas}
        features={pro ? { indicators: true, settings: true, drawings: true, fullscreen: true } : { indicators: false, settings: false, drawings: false, fullscreen: false }}
      />
      {/* What the capitalisation is counted on, on the chart itself at every width: the past at today's supply. */}
      {series === "cap" ? (
        <p className={styles.capNote} data-cap-note>
          {text("Market cap at today's circulating supply")}
        </p>
      ) : null}
    </section>
  );
}
