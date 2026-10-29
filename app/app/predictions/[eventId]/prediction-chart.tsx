"use client";

import { ProbabilityLine } from "@ryntra/core/chart/compact";
import { useEffect, useState } from "react";

import type { WorkspaceLocale } from "@/app/shell/locale";
import { aggStatus, barsFromAgg } from "@/lib/predictions/chart-feed";
import type { PredictionBar, PredictionChart as ChartData } from "@/lib/predictions/model";

import { pctPoints } from "../format";
import styles from "../predictions.module.css";
import { wordsFor } from "../words";

/**
 * An outcome's price history as the page reads it from the provider, the summary line — *what changed* — computed
 * from its bars (the last close against the close a day and a week earlier), and the compact chart of the week from
 * the core: the outcome's probability on a fixed 0–100 % axis, its «no» beside it, its source and age under it. The
 * big chart of the market is the core's `RyntraChart` (`core-chart.tsx`).
 */

export type Resolution = "1m" | "5m" | "1h" | "1d";
const RESOLUTIONS: readonly { id: Resolution; countBack: number }[] = [
  { id: "5m", countBack: 288 },
  { id: "1h", countBack: 168 },
  { id: "1h", countBack: 720 },
  { id: "1d", countBack: 365 },
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

/** *What changed*: the week of an outcome in the core's compact chart, with the day's and the week's move over it. */
export function OutcomeWeekCard({ outcomeId, outcomeLabel, noLabel, locale }: { outcomeId: string; outcomeLabel: string; noLabel: string | null; locale: WorkspaceLocale }) {
  const word = wordsFor(locale);
  const state = useOutcomeChart(outcomeId, 1);
  const bars = state.chart?.bars ?? [];
  const d1 = changeOver(bars, 24);
  const d7 = changeOver(bars, 24 * 7);
  const points = state.status === "loading" ? null : barsFromAgg(bars).map((b) => ({ t: b.t, v: b.c }));
  const status = state.chart ? aggStatus(state.chart, bars.at(-1)?.t ?? null, Date.now()) : null;
  return (
    <section className={styles.card} aria-label={word("chart")}>
      <div className={styles.cardHead}>
        <h2 className={styles.cardTitle}>{word("chart")}</h2>
        <span className={styles.eventMeta}>
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
        </span>
      </div>
      <div className={styles.weekLine}>
        <ProbabilityLine
          points={state.status === "failed" ? [] : points}
          status={status}
          label={`${outcomeLabel} · ${word("week")}`}
          lang={locale === "uk" ? "uk" : "en"}
          showNo={noLabel != null}
          outcomes={noLabel != null ? { yes: outcomeLabel, no: noLabel } : undefined}
        />
      </div>
    </section>
  );
}
