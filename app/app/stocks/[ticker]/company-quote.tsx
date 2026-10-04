"use client";

import { useId, useMemo, useState, type PointerEvent, type ReactNode } from "react";

import { moneyChange } from "@/app/app/invest/company-facts-model";
import { anchorPoints, changePct, CHART_RANGES, dayAgoPrice, despike, historyStartsLate, lineGeometry, MIN_SPAN_RATIO, nearestIndex, RANGE_SOURCE, rangePoints, type ChartRange } from "@/app/app/invest/company-model";
import { investWords, numberLocale, type InvestWord } from "@/app/app/invest/invest-words";
import { LocalClock } from "@/app/app/invest/local-clock";
import type { WorkspaceLocale } from "@/app/shell/locale";
import { formatPercent, formatUsdPrice, toneOf } from "@/app/solana/workspace/spot/spot-format";
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
 * candles (the chart source Spot draws from) as a plain line — candles and
 * drawings are «Профі»'s — anchored so it ends at the price above it
 * (`anchorPoints`) and coloured by the direction of the change it
 * illustrates. A finger or a pointer on the line reads the price at that
 * moment and the change since the range began, in local time; lifting it
 * returns the live price. A history younger than the range says since when,
 * rather than calling four months a year; a market with no chart says so in
 * one line and the purchase still works from the live quote.
 */

const WIDTH = 1000;
const HEIGHT = 240;

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
  const [pointer, setPointer] = useState<number | null>(null);
  const candles = useSpotCandles(mint, RANGE_SOURCE[range].timeframe);
  const gradient = `cq${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;

  /* A day is read against the price a day ago as the day's change states it — the figure the cards carry; a longer range against its own first close. */
  const dayAgo = range === "1d" ? dayAgoPrice(price, dayChangePct) : null;
  const view = useMemo(() => {
    /* The range ends at the moment the candles are drawn; they arrive after the page, so the clock is the browser's. */
    const now = Date.now();
    const raw = candles.value ? rangePoints(candles.value.candles, range, now) : [];
    /* A day and a week are drawn without the pool's one-trade needles; a month and a year are already calm. */
    const points = anchorPoints(range === "1d" || range === "1w" ? despike(raw) : raw, price);
    return { points, geometry: lineGeometry(points, WIDTH, HEIGHT, 8, dayAgo, MIN_SPAN_RATIO[range]), late: historyStartsLate(points, range, now) };
  }, [candles.value, range, dayAgo, price]);

  const { points, geometry, late } = view;
  const from = dayAgo ?? points[0]?.price ?? null;
  const last = points[points.length - 1]?.price ?? null;
  const rangeChange = range === "1d" && dayChangePct !== null ? dayChangePct : changePct(from, last);
  const hovered = pointer !== null && geometry ? points[pointer] ?? null : null;
  const shownPrice = hovered ? hovered.price : price;
  const shownChange = hovered ? changePct(from, hovered.price) : rangeChange;
  /* The same move in dollars: from the range's start (a day: the price a day ago the day's change implies) to the price shown. */
  const shownDelta = from !== null && shownPrice !== null ? moneyChange(shownPrice - from, locale === "uk" ? "uk" : "en") : null;
  const lineTone = toneOf(rangeChange);
  const over = late && points.length > 0 ? `${word("since")} ${momentOf(points[0].at, "1y", numbers)}` : word(OVER_WORD[range]);

  const read = (event: PointerEvent<HTMLDivElement>) => {
    if (!geometry) return;
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width <= 0) return;
    setPointer(nearestIndex(geometry.xs, WIDTH, (event.clientX - box.left) / box.width));
  };

  const empty = candles.status === "none" || (candles.status === "unavailable" && points.length === 0) || (candles.status === "ready" && points.length < 2);
  const loading = candles.status === "loading" && points.length < 2;
  /* No pool prices the company at all: no range would draw, so none is offered. A range whose own bars are refused keeps the others. */
  const noPool = candles.status === "none" && candles.code !== "STALE" && candles.code !== "PRICE_MISMATCH";

  return (
    <div className={company.quote}>
      <p className={company.price} translate="no" aria-live={hovered ? "off" : "polite"}>
        {formatUsdPrice(shownPrice, numbers)}
      </p>
      <p className={company.change} data-tone={toneOf(shownChange)}>
        <span translate="no">{shownDelta ? `${shownDelta} (${formatPercent(shownChange, numbers)})` : formatPercent(shownChange, numbers)}</span> <span className={company.changeWord}>{hovered ? momentOf(hovered.at, range, numbers) : over}</span>
      </p>
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

      <div
        className={company.chart}
        data-tone={lineTone}
        data-state={loading ? "loading" : empty ? "empty" : "ready"}
        onPointerMove={read}
        onPointerDown={read}
        onPointerLeave={() => setPointer(null)}
        onPointerCancel={() => setPointer(null)}
        onPointerUp={(event) => {
          if (event.pointerType !== "mouse") setPointer(null);
        }}
      >
        {geometry && !empty ? (
          <>
            <svg className={company.chartSvg} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" role="img" aria-label={`${name}: ${formatPercent(rangeChange, numbers)} ${over}`}>
              <defs>
                <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="currentColor" stopOpacity="0.16" />
                  <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d={geometry.area} fill={`url(#${gradient})`} stroke="none" />
              <line className={company.baseline} x1="0" x2={WIDTH} y1={geometry.baselineY} y2={geometry.baselineY} vectorEffect="non-scaling-stroke" />
              <path className={company.line} d={geometry.line} fill="none" vectorEffect="non-scaling-stroke" />
            </svg>
            {hovered && pointer !== null ? (
              <>
                <span className={company.hair} style={{ left: `${(geometry.xs[pointer] / WIDTH) * 100}%` }} aria-hidden="true" />
                <span className={company.pin} style={{ left: `${(geometry.xs[pointer] / WIDTH) * 100}%`, top: `${(geometry.ys[pointer] / HEIGHT) * 100}%` }} aria-hidden="true" />
              </>
            ) : null}
          </>
        ) : loading ? (
          <span className={company.chartBone} aria-hidden="true" />
        ) : (
          <p className={company.chartNote}>{noPool ? word("noChart") : word("chartDown")}</p>
        )}
      </div>

      <div className={company.chartFoot}>
        {noPool ? null : (
          <div className={company.ranges} role="group" aria-label={word("chartRange")}>
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
        {aside}
      </div>
    </div>
  );
}
