"use client";

import type { MarketState, TimeResolution } from "@ryntra/core/adapters";
import { RyntraChart } from "@ryntra/core/chart";
import { ChartTelemetry, type ChartTelemetryEvent } from "@ryntra/core/chart/telemetry";
import { useEffect, useMemo, useState } from "react";

import type { WorkspaceLocale } from "@/app/shell/locale";
import { NO_BASIS, outcomePair, YES_BASIS } from "@/lib/predictions/chart-feed";
import type { PredictionMarket, PredictionOutcome } from "@/lib/predictions/model";

import { pct } from "../format";
import styles from "../predictions.module.css";
import { outcomeLabel, wordsFor } from "../words";
import { predictionChartFeed } from "./chart-source";

/**
 * The market's chart: Ryntra's one trading chart from the core, the outcome's price as a percent of its payout over
 * time, its source and age said under it. «Yes» and «no» are one switch over it — the same as the ticket's outcome —
 * and «no» is drawn as 100 − «yes». The chart drafts nothing here: buying is the ticket's, with its Review.
 */

const indicatorWorker = () => new Worker(new URL("./indicator-worker.ts", import.meta.url), { type: "module" });

/** The chart's health goes to Ryntra's monitoring: the market and counts, never a person. */
function sendTelemetry(event: ChartTelemetryEvent): void {
  try {
    const body = JSON.stringify(event);
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function" && navigator.sendBeacon("/api/predictions/chart-telemetry", body)) return;
    void fetch("/api/predictions/chart-telemetry", { method: "POST", body, keepalive: true, headers: { "content-type": "application/json" } }).catch(() => null);
  } catch {
    /* monitoring never breaks the chart */
  }
}

export function PredictionCoreChart({
  market,
  outcome,
  onOutcome,
  marketState,
  locale,
}: {
  market: PredictionMarket;
  outcome: PredictionOutcome;
  onOutcome: (id: string) => void;
  marketState: MarketState;
  locale: WorkspaceLocale;
}) {
  const word = wordsFor(locale);
  const pair = outcomePair(market.outcomes, outcome.id);
  const yes = pair?.yes ?? outcome;
  const no = pair?.no ?? null;
  const withNo = no != null;
  const feed = useMemo(
    () => predictionChartFeed({ yesId: yes.id, symbol: market.question, venue: market.venue, withNo, market: marketState }),
    [yes.id, market.question, market.venue, withNo, marketState],
  );
  /* The interval to open on is the source's: the gateway's minute, or the aggregator's hour (a week on screen). */
  const [opening, setOpening] = useState<Readonly<{ feed: typeof feed; resolution: TimeResolution | null }> | null>(null);
  useEffect(() => {
    let live = true;
    void feed.opening().then((resolution) => {
      if (live) setOpening({ feed, resolution });
    });
    return () => {
      live = false;
    };
  }, [feed]);
  const telemetry = useMemo(() => new ChartTelemetry({ surface: "predictions-market", onEvent: sendTelemetry }), [yes.id]); // eslint-disable-line react-hooks/exhaustive-deps -- one telemetry per charted outcome
  const onNo = no != null && outcome.id === no.id;
  const chosen = [yes, ...(no ? [no] : [])];

  return (
    <div className={styles.coreChart} data-prediction-chart>
      {opening?.feed !== feed ? (
        <div className={styles.coreChartWait} aria-busy="true" />
      ) : (
      <RyntraChart
        key={yes.id}
        source={feed.source}
        instrument={yes.id}
        resolution={opening.resolution ?? undefined}
        basis={onNo ? NO_BASIS : YES_BASIS}
        lang={locale === "uk" ? "uk" : "en"}
        candleType="line"
        label={`${market.question} · ${outcomeLabel(onNo && no ? no.label : yes.label, locale)} · ${word("chart")}`}
        symbol={
          !withNo ? undefined : (
          <span className={styles.chartOutcomes} role="group" aria-label={word("outcomes")}>
            {chosen.map((o) => (
              <button key={o.id} type="button" className={styles.chartOutcome} data-chart-outcome={o.id === yes.id ? "yes" : "no"} aria-pressed={o.id === (onNo ? no?.id : yes.id)} onClick={() => onOutcome(o.id)}>
                <span className={styles.chartOutcomeName}>{outcomeLabel(o.label, locale)}</span>
                <b>{pct(o.probability)}</b>
              </button>
            ))}
          </span>
          )
        }
        indicatorWorker={indicatorWorker}
        telemetry={telemetry}
      />
      )}
    </div>
  );
}
