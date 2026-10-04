"use client";

import { useEffect, useRef, useState } from "react";

import type { WorkspaceLocale } from "@/app/shell/locale";
import { chartOptions } from "@/lib/chart/theme";
import type { PredictionBar, PredictionChart as ChartData } from "@/lib/predictions/model";

import { pct, pctPoints } from "../format";
import styles from "../predictions.module.css";
import { wordsFor } from "../words";

/**
 * The price history of one outcome, in Ryntra's chart: the provider's bars
 * drawn as an area of probability on a 0–100% scale under the same tokens
 * Spot's candles use, the resolution the person picks, the staleness the
 * provider reports said in the frame. The summary line — *what changed* — is
 * computed here from the bars: the last close against the close a day and a
 * week earlier.
 */

export type Resolution = "1m" | "5m" | "1h" | "1d";
const RESOLUTIONS: readonly { id: Resolution; label: string; countBack: number }[] = [
  { id: "5m", label: "1D", countBack: 288 },
  { id: "1h", label: "1W", countBack: 168 },
  { id: "1h", label: "1M", countBack: 720 },
  { id: "1d", label: "ALL", countBack: 365 },
];

export type ChartState = Readonly<{ status: "loading" | "ready" | "failed" | "empty"; chart: ChartData | null }>;

export function useOutcomeChart(outcomeId: string | null, choice: number): ChartState {
  const [state, setState] = useState<ChartState>({ status: "loading", chart: null });
  useEffect(() => {
    if (!outcomeId) return undefined;
    let live = true;
    setState((prev) => ({ status: "loading", chart: prev.chart }));
    const { id, countBack } = RESOLUTIONS[choice] ?? RESOLUTIONS[1];
    void fetch(`/api/predictions/outcomes/${encodeURIComponent(outcomeId)}/chart?resolution=${id}&countBack=${countBack}`, { headers: { accept: "application/json" }, cache: "no-store" })
      .then(async (r) => (r.ok ? ((await r.json()) as { chart: ChartData }).chart : null))
      .then((chart) => {
        if (!live) return;
        if (!chart) setState({ status: "failed", chart: null });
        else setState({ status: chart.bars.length === 0 ? "empty" : "ready", chart });
      })
      .catch(() => {
        if (live) setState({ status: "failed", chart: null });
      });
    return () => {
      live = false;
    };
  }, [outcomeId, choice]);
  return state;
}

/** The change of the close over the last `hours`, from the bars; null when the history does not reach back that far. */
export function changeOver(bars: readonly PredictionBar[], hours: number, nowMs: number = Date.now()): number | null {
  if (bars.length < 2) return null;
  const last = bars[bars.length - 1];
  const target = nowMs - hours * 3_600_000;
  let earlier: PredictionBar | null = null;
  for (const bar of bars) {
    if (bar.t <= target) earlier = bar;
    else break;
  }
  if (!earlier) return null;
  return last.c - earlier.c;
}

export function PredictionChartCard({ outcomeId, outcomeLabel, locale, theme, compact = false }: { outcomeId: string | null; outcomeLabel: string; locale: WorkspaceLocale; theme: "dark" | "light"; compact?: boolean }) {
  const word = wordsFor(locale);
  const [choice, setChoice] = useState(1);
  const state = useOutcomeChart(outcomeId, choice);
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current;
    const chart = state.chart;
    if (!el || !chart || chart.bars.length === 0) return undefined;
    let disposed = false;
    let dispose: (() => void) | null = null;
    void import("lightweight-charts").then(({ createChart, AreaSeries }) => {
      if (disposed || !host.current) return;
      const accent = getComputedStyle(document.documentElement).getPropertyValue("--ry-accent-fg").trim() || "#FF681C";
      const instance = createChart(host.current, {
        ...chartOptions(theme, host.current),
        rightPriceScale: { borderColor: getComputedStyle(document.documentElement).getPropertyValue("--ry-border").trim() || undefined, scaleMargins: { top: 0.1, bottom: 0.1 } },
        handleScroll: !compact,
        handleScale: !compact,
      });
      const series = instance.addSeries(AreaSeries, {
        lineColor: accent,
        topColor: `${accent}55`,
        bottomColor: `${accent}05`,
        lineWidth: 2,
        priceFormat: { type: "custom", formatter: (v: number) => `${(v * 100).toFixed(1)}%`, minMove: 0.001 },
        priceLineVisible: true,
        lastValueVisible: true,
      });
      const seen = new Set<number>();
      const data = chart.bars
        .filter((b) => {
          const t = Math.floor(b.t / 1000);
          if (seen.has(t)) return false;
          seen.add(t);
          return true;
        })
        .map((b) => ({ time: Math.floor(b.t / 1000) as never, value: b.c }));
      series.setData(data);
      instance.timeScale().fitContent();
      dispose = () => instance.remove();
    });
    return () => {
      disposed = true;
      dispose?.();
    };
  }, [state.chart, theme, compact]);

  const bars = state.chart?.bars ?? [];
  const last = bars.length ? bars[bars.length - 1].c : null;
  const d1 = changeOver(bars, 24);
  const d7 = changeOver(bars, 24 * 7);
  return (
    <section className={styles.card} aria-label={word("chart")}>
      <div className={styles.chartTools}>
        <span className={styles.eventMeta}>
          <span>
            {outcomeLabel} <b>{pct(last)}</b>
          </span>
          {d1 != null ? (
            <span>
              {word("change24h")}{" "}
              <b className={styles.delta} data-tone={d1 > 0 ? "pos" : d1 < 0 ? "neg" : undefined}>
                {pctPoints(d1)}
              </b>
            </span>
          ) : null}
          {d7 != null ? (
            <span>
              7{word("days")}{" "}
              <b className={styles.delta} data-tone={d7 > 0 ? "pos" : d7 < 0 ? "neg" : undefined}>
                {pctPoints(d7)}
              </b>
            </span>
          ) : null}
          {state.chart?.staleSeconds != null && state.chart.staleSeconds > 900 ? <span>· {word("stale")} {Math.round(state.chart.staleSeconds / 60)}{word("minutes")}</span> : null}
        </span>
        <div className={styles.tabs} role="group" aria-label={word("chart")}>
          {RESOLUTIONS.map((r, index) => (
            <button key={r.label} type="button" className={styles.tab} aria-pressed={choice === index} onClick={() => setChoice(index)}>
              {r.label}
            </button>
          ))}
        </div>
      </div>
      {state.status === "failed" ? (
        <p className={styles.muted} style={{ padding: "var(--ry-s4)" }}>
          {word("unavailable")}
        </p>
      ) : state.status === "empty" ? (
        <p className={styles.muted} style={{ padding: "var(--ry-s4)" }}>
          {word("chartEmpty")}
        </p>
      ) : (
        <div ref={host} className={styles.chartHost} style={compact ? { height: 200 } : undefined} aria-busy={state.status === "loading"} />
      )}
    </section>
  );
}
