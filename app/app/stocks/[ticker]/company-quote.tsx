"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";

import { AreaChart, type ScrubPoint } from "@ryntra/core/chart/compact";

import { moneyChange } from "@/app/app/invest/company-facts-model";
import { useFitHeight } from "@/app/components/chart/use-fit-height";
import { anchorPoints, changePct, CHART_RANGES, dayAgoPrice, despike, historyStartsLate, RANGE_SOURCE, rangePoints, type ChartRange } from "@/app/app/invest/company-model";
import { investWords, numberLocale, type InvestWord } from "@/app/app/invest/invest-words";
import { LocalClock } from "@/app/app/invest/local-clock";
import type { WorkspaceLocale } from "@/app/shell/locale";
import { formatPercent, formatUsdPrice, toneOf } from "@/app/solana/workspace/spot/spot-format";
import { candlesStatus, onTick, tickFor } from "@/app/solana/workspace/spot/core-chart-source";
import { useSpotCandles } from "@/app/solana/workspace/spot/use-spot-data";

import company from "./company.module.css";

/**
 * The company's price and its line.
 *
 * One price on the surface — the venue's, the one the cards on Home and
 * Markets show — and its change over the range the person picked: the day's
 * change is the same figure the cards carry, read against a dotted line at
 * the price a day ago it implies; a week, a month and a year are measured on
 * the line itself, from its first close to its last. The line is the pool's
 * candles (the chart source Spot draws from) as the core's compact area chart
 * (`@ryntra/core/chart/compact`, CH-17) — candles and drawings are Spot's —
 * anchored so it ends at the price above it
 * (`anchorPoints`) and coloured by the direction of the change it
 * illustrates. A finger or a pointer on the line reads the price at that
 * moment and the change since the range began, in local time; lifting it
 * returns the live price. A history younger than the range says since when,
 * rather than calling four months a year; a market with no chart says so in
 * one line and the purchase still works from the live quote.
 */

const RANGE_WORD: Readonly<Record<ChartRange, InvestWord>> = { "1d": "range1d", "1w": "range1w", "1m": "range1m", "1y": "range1y" };
const OVER_WORD: Readonly<Record<ChartRange, InvestWord>> = { "1d": "dayChange", "1w": "overWeek", "1m": "overMonth", "1y": "overYear" };

/** When a point on the line was, in the reader's own clock and words. */
function momentOf(at: number, range: ChartRange, numbers: string): string {
  const options: Intl.DateTimeFormatOptions =
    range === "1d" ? { hour: "2-digit", minute: "2-digit" } : range === "1w" ? { weekday: "short", hour: "2-digit", minute: "2-digit" } : range === "1m" ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" };
  return new Intl.DateTimeFormat(numbers, options).format(new Date(at));
}

/**
 * A private company's one number under its price: the token against the
 * issuer's own valuation — «на 30% дорожче за оцінку PreStocks» — with the
 * time that valuation was read, on the reader's clock. No tone.
 */
export type QuotePremium = Readonly<{ line: string; at: string | null }>;

export function CompanyQuote({ mint, name, price, dayChangePct, locale, premium = null, defaultRange = "1d", status = null, aside = null }: { mint: string; name: string; price: number | null; dayChangePct: number | null; locale: WorkspaceLocale; premium?: QuotePremium | null; /** The range the chart opens on — a month for a PreStocks company, whose thin market saws a day's line; the switches stay. */ defaultRange?: ChartRange; /** The exchange's state, said under the price it qualifies. */ status?: ReactNode; /** What stands at the end of the ranges' row — the way to the candles. */ aside?: ReactNode }) {
  const word = investWords(locale);
  const numbers = numberLocale(locale);
  const [range, setRange] = useState<ChartRange>(defaultRange);
  const [pointer, setPointer] = useState<ScrubPoint | null>(null);
  /* On a desk the line takes what the first screen leaves under the price, its ranges still in view. */
  const quoteRef = useRef<HTMLDivElement>(null);
  useFitHeight(quoteRef, { target: "[data-terminal-chart]", tail: "[data-chart-foot]", variable: "--company-fit", min: 280, max: 560 });
  const candles = useSpotCandles(mint, RANGE_SOURCE[range].timeframe);

  /* A day is read against the price a day ago as the day's change states it — the figure the cards carry; a longer range against its own first close. */
  const dayAgo = range === "1d" ? dayAgoPrice(price, dayChangePct) : null;
  const view = useMemo(() => {
    /* The range ends at the moment the candles are drawn; they arrive after the page, so the clock is the browser's. */
    const now = Date.now();
    const raw = candles.value ? rangePoints(candles.value.candles, range, now) : [];
    /* A day and a week are drawn without the pool's one-trade needles; a month and a year are already calm. */
    const points = anchorPoints(range === "1d" || range === "1w" ? despike(raw) : raw, price);
    return { points, line: points.map((point) => ({ t: point.at, v: onTick(point.price, tickFor(point.price)) })), late: historyStartsLate(points, range, now) };
  }, [candles.value, range, price]);
  /* The time of the last good read of this market and range: a read that failed is aged from it, not from the failure. */
  const lastGood = useRef<Readonly<{ key: string; at: number }> | null>(null);
  const lineStatus = useMemo(() => {
    if (!candles.value) return null;
    const key = `${mint}:${RANGE_SOURCE[range].timeframe}`;
    const observed = candles.status === "ready" ? Date.parse(candles.observedAt) : NaN;
    if (Number.isFinite(observed)) lastGood.current = { key, at: observed };
    const stale = candles.status === "unavailable" || (candles.status === "ready" && candles.stale);
    const at = lastGood.current?.key === key ? lastGood.current.at : null;
    const live = price !== null && !stale;
    /* The sources by name, not the pool's pair: a caption under a beginner's line is no place for «NVDAx/USDC». */
    return candlesStatus({ observedAt: at, stale, pool: null, live, derived: live }, RANGE_SOURCE[range].timeframe);
  }, [candles, range, mint, price]);

  const { points, line, late } = view;
  const from = dayAgo ?? points[0]?.price ?? null;
  const last = points[points.length - 1]?.price ?? null;
  const rangeChange = range === "1d" && dayChangePct !== null ? dayChangePct : changePct(from, last);
  const hoveredPrice = pointer?.v != null ? Number(pointer.v) : null;
  const hovered = pointer && hoveredPrice !== null && Number.isFinite(hoveredPrice) ? { at: pointer.t, price: hoveredPrice } : null;
  const shownPrice = hovered ? hovered.price : price;
  const shownChange = hovered ? changePct(from, hovered.price) : rangeChange;
  /* The same move in dollars: from the range's start (a day: the price a day ago the day's change implies) to the price shown. */
  const shownDelta = from !== null && shownPrice !== null ? moneyChange(shownPrice - from, locale === "uk" ? "uk" : "en") : null;
  const lineTone = toneOf(rangeChange);
  const over = late && points.length > 0 ? `${word("since")} ${momentOf(points[0].at, "1y", numbers)}` : word(OVER_WORD[range]);

  const empty = candles.status === "none" || (candles.status === "unavailable" && points.length === 0) || (candles.status === "ready" && points.length < 2);
  const loading = candles.status === "loading" && points.length < 2;
  /* No pool prices the company at all: no range would draw, so none is offered. A range whose own bars are refused keeps the others. */
  const noPool = candles.status === "none" && candles.code !== "STALE" && candles.code !== "PRICE_MISMATCH";

  return (
    <div ref={quoteRef} className={company.quote}>
      <p className={company.price} translate="no" aria-live={hovered ? "off" : "polite"}>
        {formatUsdPrice(shownPrice, numbers)}
      </p>
      {/* A range whose line has not arrived yet holds its place; one that cannot be drawn says so under the chart, not as a dash here. */}
      {shownChange !== null && Number.isFinite(shownChange) ? (
        <p className={company.change} data-tone={toneOf(shownChange)}>
          <span translate="no">{shownDelta ? `${shownDelta} (${formatPercent(shownChange, numbers)})` : formatPercent(shownChange, numbers)}</span> <span className={company.changeWord}>{hovered ? momentOf(hovered.at, range, numbers) : over}</span>
        </p>
      ) : candles.status === "loading" ? (
        <p className={company.change} aria-hidden="true">
          <span className={company.lineBone} style={{ width: 160 }} />
        </p>
      ) : null}
      {status}
      {premium ? (
        <p className={company.premium} data-premium>
          <span translate="no">{premium.line}</span>
          {premium.at ? (
            <span className={company.premiumAt}>
              <LocalClock iso={premium.at} locale={numbers} prefix={` · ${word("valuationAtShort")} `} />
            </span>
          ) : null}
        </p>
      ) : null}

      <div className={company.chart} data-terminal-chart data-tone={lineTone} data-state={loading ? "loading" : empty ? "empty" : "ready"}>
        {!empty ? (
          <AreaChart
            points={loading ? null : line}
            status={lineStatus}
            label={`${name}: ${formatPercent(rangeChange, numbers)} ${over}`}
            lang={locale === "uk" ? "uk" : "en"}
            unit="USD"
            baseline={dayAgo === null ? null : onTick(dayAgo, tickFor(dayAgo))}
            tone={lineTone === "up" ? "up" : lineTone === "down" ? "down" : "neutral"}
            head={false}
            onScrub={setPointer}
            caption="short"
            className={company.coreLine}
          />
        ) : (
          <p className={company.chartNote}>{noPool ? word("noChart") : word("chartDown")}</p>
        )}
      </div>

      <div className={company.chartFoot} data-chart-foot data-dense>
        {noPool ? null : (
          <div className={company.ranges} data-ranges role="group" aria-label={word("chartRange")}>
            {CHART_RANGES.map((entry) => (
              <button
                key={entry}
                type="button"
                className={company.range}
                aria-pressed={range === entry}
                onClick={() => {
                  setPointer(null);
                  setRange(entry);
                }}
              >
                {word(RANGE_WORD[entry])}
              </button>
            ))}
          </div>
        )}
        {/* The candles in Spot only where a pool prices the company — no way into an empty chart. */}
        {noPool ? null : aside}
      </div>
    </div>
  );
}
