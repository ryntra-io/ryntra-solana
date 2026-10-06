"use client";

import { AreaSeries, LineType, PriceScaleMode, createChart, createSeriesMarkers, type IChartApi, type SeriesMarker, type Time, type UTCTimestamp } from "lightweight-charts";
import { useEffect, useRef, useState } from "react";

import { readResolvedTheme, watchResolvedTheme } from "@/app/app/theme";
import type { LaunchMarketResponse } from "@/lib/api/v1/contract";
import { candlePalette, chartOptions } from "@/lib/chart/theme";

import styles from "../launch.module.css";

type Chart = LaunchMarketResponse["chart"];
export type OwnTrade = Readonly<{ t: number; side: "buy" | "sell" }>;

/** How many steps the time axis is cut into at most. */
const STEPS = 160;

/**
 * The points laid on an even clock: the chart spaces values by their order,
 * not their time, so a token with three trades over a day would show them side
 * by side. Every step of `size` seconds carries the market cap at its end —
 * the last trade at or before it — and every trade is kept at its own second
 * when the steps are finer than the trades.
 */
export function evenly(points: Chart["points"]): { time: UTCTimestamp; value: number }[] {
  if (points.length === 0) return [];
  const first = points[0]!.t;
  const last = points.at(-1)!.t;
  const span = Math.max(last - first, 60);
  const size = Math.max(1, Math.ceil(span / STEPS));
  const out: { time: UTCTimestamp; value: number }[] = [];
  let index = 0;
  let value = points[0]!.marketCapPair;
  for (let t = first; t <= last + size - 1; t += size) {
    while (index < points.length && points[index]!.t <= t) {
      value = points[index]!.marketCapPair;
      index += 1;
    }
    out.push({ time: t as UTCTimestamp, value });
  }
  return out;
}

/**
 * The market cap of a launch over time — one point a trade, from the curve's
 * opening price to the price now — with the creator's own trades marked (▲ a
 * buy, ▼ a sale), the connected wallet's trades, and the moment it graduated
 * to the DEX. `lightweight-charts` on the design system's chart tokens, drawn
 * again when the theme changes.
 */
export function LaunchChart({
  chart,
  own,
  money,
  creatorLetter,
  ownLetter,
  label,
}: {
  chart: Chart;
  own: readonly OwnTrade[];
  money: (value: number) => string;
  creatorLetter: string;
  ownLetter: string;
  /** What the chart shows, said in words for a reader that cannot see it — from the launch to now, the high and the low. */
  label: (figures: Readonly<{ from: string; to: string; high: string; low: string }>) => string;
}) {
  const host = useRef<HTMLDivElement | null>(null);
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    setTheme(readResolvedTheme());
    return watchResolvedTheme(setTheme);
  }, []);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const palette = candlePalette("default", element);
    const css = getComputedStyle(element);
    /*
     * The design system's second chart colour: its first series colour is the brand orange, and orange on this page is
     * for the one action — the trade.
     */
    const accent = css.getPropertyValue("--ry-c2").trim() || "#8FA6C8";
    const ink = css.getPropertyValue("--ry-text").trim() || "#E8EDF4";
    const base = chartOptions(theme, element);
    const chartApi: IChartApi = createChart(element, {
      ...base,
      handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { mouseWheel: false, pinch: true, axisPressedMouseMove: false },
      /* A market cap moves by multiples: on a log scale  000 →  000 reads as the climb it is, and nothing is drawn below zero. */
      rightPriceScale: { ...base.rightPriceScale, mode: PriceScaleMode.Logarithmic, scaleMargins: { top: 0.08, bottom: 0.08 } },
      /* The first time label sits inside the chart, not half off its left edge. */
      timeScale: { ...base.timeScale, fixLeftEdge: true, fixRightEdge: true, rightOffset: 0 },
      localization: { priceFormatter: money },
    });
    const data = evenly(chart.points);
    const values = data.map((point) => point.value).filter((value) => value > 0);
    const low = values.length ? Math.min(...values) : 0;
    const high = values.length ? Math.max(...values) : 0;
    const series = chartApi.addSeries(AreaSeries, {
      lineColor: accent,
      lineWidth: 2,
      /* The price moves only with a trade: between two trades it stands still. */
      lineType: LineType.WithSteps,
      topColor: `${accent}38`,
      bottomColor: `${accent}00`,
      priceFormat: { type: "custom", formatter: money, minMove: 0.000001 },
      /* The market cap now is the page's headline; no second tag beside the trade's action. */
      lastValueVisible: false,
      priceLineVisible: false,
      /*
       * The scale spans what the market cap did, with room for the marks in pixels — not a multiple of it; below, room
       * enough that the creator's first mark clears the TradingView mark in the corner, which the chart's licence keeps.
       */
      /* A flat line — a launch with no trade yet — gets a sliver of range, not ten labels of one value. */
      autoscaleInfoProvider: () => (values.length ? { priceRange: { minValue: low === high ? low * 0.99 : low, maxValue: low === high ? high * 1.01 : high }, margins: { above: 26, below: 56 } } : null),
    });
    series.setData(data);
    /* A mark sits on the nearest point at or before it: the chart keeps one value a second. */
    const times = data.map((point) => point.time as number);
    const snap = (t: number) => {
      let found = times[0] ?? t;
      for (const time of times) if (time <= t) found = time;
      return found as UTCTimestamp;
    };
    const marks: SeriesMarker<Time>[] = [
      ...chart.markers.map((marker): SeriesMarker<Time> =>
        marker.kind === "graduated"
          ? { time: snap(marker.t), position: "aboveBar", shape: "circle", color: ink, text: "DEX" }
          : marker.kind === "creator-buy"
            ? { time: snap(marker.t), position: "belowBar", shape: "arrowUp", color: palette.up, text: creatorLetter }
            : { time: snap(marker.t), position: "aboveBar", shape: "arrowDown", color: palette.down, text: creatorLetter },
      ),
      ...own.map((trade): SeriesMarker<Time> => ({ time: snap(trade.t), position: trade.side === "buy" ? "belowBar" : "aboveBar", shape: "circle", color: ink, text: ownLetter })),
    ];
    if (data.length) createSeriesMarkers(series, marks.sort((a, b) => (a.time as number) - (b.time as number)));
    chartApi.timeScale().fitContent();
    /* The library lays its canvases out in a table; the chart is one picture with its sentence, not a table to read. */
    element.querySelectorAll("table").forEach((table) => table.setAttribute("aria-hidden", "true"));
    return () => chartApi.remove();
  }, [chart, own, theme, money, creatorLetter, ownLetter]);

  const first = chart.points[0];
  const last = chart.points.at(-1);
  const caps = chart.points.map((point) => point.marketCapPair);
  const summary =
    first && last ? label({ from: money(first.marketCapPair), to: money(last.marketCapPair), high: money(Math.max(...caps)), low: money(Math.min(...caps)) }) : "";
  return <div ref={host} className={styles.chartCanvas} role="img" aria-label={summary || undefined} />;
}
