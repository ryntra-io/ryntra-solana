"use client";

import { useMemo } from "react";

import type { DataStatus } from "@ryntra/core/adapters";
import { AreaChart, type LineMark } from "@ryntra/core/chart/compact";

import type { LaunchMarketResponse } from "@/lib/api/v1/contract";

import styles from "../launch.module.css";
import { useHydrated } from "../use-hydrated";

type Chart = LaunchMarketResponse["chart"];
export type OwnTrade = Readonly<{ t: number; side: "buy" | "sell" }>;

/** How long the page keeps a read of the market before it reads again (`token-market.tsx`). */
export const LAUNCH_READ_MS = 20_000;

/** A market cap as the chart's decimal string: whole cents of the pair, or the pair's own small steps under one. */
export function capText(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "0";
  return value >= 1 ? value.toFixed(2) : value.toFixed(6);
}

/**
 * The numbers' status under the chart: Ryntra's own read of the market from the Solana chain — every trade from the
 * curve's opening — re-read every `LAUNCH_READ_MS`, so the line is up to that much behind the chain.
 */
export function launchStatus(observedAt: string, stale = false, now: number = Date.now()): DataStatus {
  const read = Date.parse(observedAt);
  const at = Math.min(now, Number.isFinite(read) ? read : now);
  return {
    state: stale ? "stale" : "delayed",
    market: "open",
    source: { id: "solana-chain", label: "Solana", attribution: null, rights: "display" },
    at,
    gateway_at: now,
    age_ms: Math.max(0, now - at),
    delay_ms: stale ? null : LAUNCH_READ_MS,
    derived: true,
  };
}

/**
 * The market cap of a launch over time — one point a trade, from the curve's opening price to the price now — held
 * between trades (a step: the price moves only with a trade), on a log scale (a launch's cap spans orders of magnitude),
 * with the creator's own trades marked, the connected wallet's, and the moment it graduated to the DEX. The core's
 * compact area chart (`@ryntra/core/chart/compact`, CH-17): its readout, its high and low, its source and age.
 */
export function LaunchChart({
  chart,
  own,
  unit,
  observedAt,
  stale = false,
  lang,
  creatorWord,
  ownWord,
  dexWord,
  label,
}: {
  chart: Chart;
  own: readonly OwnTrade[];
  /** The pair's unit after a figure: «USD» for a dollar pair, else the pair's symbol. */
  unit: string;
  /** When the page read the market. */
  observedAt: string;
  /** The last refresh failed: the last read is shown, stale. */
  stale?: boolean;
  lang: "uk" | "en";
  /** What a creator's buy and sale are called on a mark. */
  creatorWord: Readonly<{ buy: string; sell: string }>;
  ownWord: string;
  dexWord: string;
  /** What the chart is, for a reader that cannot see it. */
  label: string;
}) {
  const points = useMemo(() => chart.points.map((point) => ({ t: point.t * 1000, v: capText(point.marketCapPair) })), [chart.points]);
  const marks = useMemo<LineMark[]>(
    () =>
      [
        ...chart.markers.map((marker): LineMark =>
          marker.kind === "graduated"
            ? { t: marker.t * 1000, kind: "event", label: dexWord }
            : marker.kind === "creator-buy"
              ? { t: marker.t * 1000, kind: "buy", label: creatorWord.buy }
              : { t: marker.t * 1000, kind: "sell", label: creatorWord.sell },
        ),
        ...own.map((trade): LineMark => ({ t: trade.t * 1000, kind: trade.side, label: ownWord })),
      ].sort((a, b) => a.t - b.t),
    [chart.markers, own, creatorWord, ownWord, dexWord],
  );
  const status = useMemo(() => launchStatus(observedAt, stale), [observedAt, stale]);
  /* The chart's age to a tenth of a second and its axis in the reader's time zone are the browser's: the server holds its box (SOL-P1). */
  const hydrated = useHydrated();
  if (!hydrated) {
    return (
      <div className={styles.chartCanvas} data-launch-chart>
        <span className={styles.chartPlaceholder} aria-hidden />
      </div>
    );
  }
  return (
    <div className={styles.chartCanvas} data-launch-chart>
      <AreaChart points={points} status={status} label={label} lang={lang} unit={unit} tone="neutral" curve="step" scale="log" marks={marks} caption="full" />
    </div>
  );
}
