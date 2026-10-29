"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import { ArrowsIn, ArrowsOut, GearSix } from "@phosphor-icons/react";
import type { ChartLevel, ChartMark } from "@ryntra/core/adapters";
import { CANDLE_TYPES, chartWords, INDICATORS_LOCAL_KEY, RyntraChart, SCALE_MODES } from "@ryntra/core/chart";

import { isSpotTimeframe, type SpotTimeframe } from "@/lib/spot/candles";
import type { TokenMark } from "@/lib/spot/token-page";

import { useSolanaI18n } from "../i18n/provider.tsx";
import { DEFAULT_LOOK, legacyDrawingKeys, legacyIndicators, legacyLook, PALETTE_TOKENS, type CandlePalette, type ChartLook } from "./chart-legacy.ts";
import { CAP_BASIS, PRICE_BASIS, SpotChartFeed, onTick, resolutionOf, timeframeOf } from "./core-chart-source.ts";
import { limitFillMarkers, limitOrderLines } from "./limit-orders-view.ts";
import { formatAmount, formatPercent } from "./spot-format.ts";
import type { LimitOrdersRead } from "./use-limit-orders.ts";
import type { CandlesState, HoldingsState, NoChartCode } from "./use-spot-data.ts";

import { SourcesLine } from "./sources-line.tsx";
import styles from "./spot.module.css";

/* The quotes an order line converts to dollars without a read: the dollars at one, SOL at the wallet's own SOL price. */
const DOLLAR_QUOTES = new Set(["EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"]);
const WRAPPED_SOL = "So11111111111111111111111111111111111111112";
const TF_KEY = "ryntra.spot.timeframe.v1";
const SERIES_KEY = "ryntra.spot.series.v1";
/* What the person keeps on this chart besides what the core keeps itself (indicators, drawings): the palette, the clock,
   the candles' type and the scale — the last two chosen in «Вигляд графіка», so the chart's tools stand in one row. */
const LOOK_KEY = "ryntra.spot.chart-look.v1";
const PALETTES: readonly CandlePalette[] = ["default", "contrast", "colorblind"];

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

function useStored<T extends string>(key: string, initial: T, accept: (value: string | null) => value is T): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(initial);
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(key);
      if (accept(stored)) setValue(stored);
    } catch {
      /* A denied store keeps the default. */
    }
  }, [key, accept]);
  const set = (next: T) => {
    setValue(next);
    try {
      window.localStorage.setItem(key, next);
    } catch {
      /* Nothing to keep. */
    }
  };
  return [value, set];
}

const isSeries = (value: string | null): value is SpotSeries => value === "price" || value === "cap";
const isTimeframe = (value: string | null): value is SpotTimeframe => isSpotTimeframe(value);

export function useSpotTimeframe(): [SpotTimeframe, (next: SpotTimeframe) => void] {
  return useStored<SpotTimeframe>(TF_KEY, "1h", isTimeframe);
}

/** The look: this chart's own key once the person changed it here; the older chart's settings before that (`legacyLook`). */
function useChartLook(): [ChartLook | null, (next: Partial<ChartLook>) => void] {
  const [look, setLook] = useState<ChartLook | null>(null);
  useEffect(() => {
    const older = legacyLook();
    try {
      const raw = window.localStorage.getItem(LOOK_KEY);
      const saved = raw ? (JSON.parse(raw) as Partial<ChartLook>) : null;
      setLook({
        ...older,
        palette: saved && PALETTES.includes(saved.palette as CandlePalette) ? (saved.palette as CandlePalette) : older.palette,
        timezone: saved && "timezone" in saved ? (saved.timezone === "UTC" ? "UTC" : null) : older.timezone,
        candle: saved && (CANDLE_TYPES as readonly string[]).includes(saved.candle as string) ? (saved.candle as ChartLook["candle"]) : older.candle,
        scale: saved && (SCALE_MODES as readonly string[]).includes(saved.scale as string) ? (saved.scale as ChartLook["scale"]) : older.scale,
      });
    } catch {
      setLook(older);
    }
  }, []);
  const set = (next: Partial<ChartLook>) => {
    setLook((current) => {
      const merged = { ...(current ?? DEFAULT_LOOK), ...next };
      try {
        window.localStorage.setItem(LOOK_KEY, JSON.stringify({ palette: merged.palette, timezone: merged.timezone, candle: merged.candle, scale: merged.scale }));
      } catch {
        /* Nothing to keep. */
      }
      return merged;
    });
  };
  return [look, set];
}

/** The core's indicator worker, from this site's own file: the page's policy allows no worker from a blob. */
const indicatorWorker = () => new Worker(new URL("./indicator-worker.ts", import.meta.url), { type: "module" });

/**
 * The price chart — the core's chart (`@ryntra/core/chart`, CH-17) on the candles Solana already reads: GeckoTerminal's
 * pool candles, the last bar closed at the page's one live price (`SpotChartFeed`). A market with no pool says so in
 * the frame; a source that stopped answering keeps the last read, and the chart says it is stale.
 *
 * «Ціна · Капіталізація» beside the symbol switches the same candles to the market's capitalisation (`capFactorOf`) —
 * the core's market-cap basis, a line under the chart that the scale is today's supply, and drawings kept apart from
 * the price's. A market without a capitalisation, or a tokenized stock, has no switch.
 *
 * What the older chart kept comes along once: the drawings (the core's `importLegacy`, by the older keys), the
 * indicators, the candles' type, the scale, the palette and the clock (`chart-legacy.ts`).
 */
export function SpotChart({
  symbol,
  mint,
  stock = false,
  candles,
  timeframe,
  onTimeframe,
  capFactor = null,
  marks = [],
  ownTrades = [],
  limits = null,
  holdings = null,
  livePrice = null,
  fullScreen = true,
}: {
  symbol: string;
  /** The market on the chart: the chart's instrument, and the base of the wallet's limit orders drawn on it. */
  mint: string;
  /** A tokenized stock (`category === "stock"`). */
  stock?: boolean;
  candles: CandlesState;
  timeframe: SpotTimeframe;
  onTimeframe: (next: SpotTimeframe) => void;
  /** The supply the market cap is counted on (`capFactorOf`); null: no capitalisation to switch to. */
  capFactor?: number | null;
  /** The market's own marks (`marksOf`): the largest trades, the creator's, the curve's exit, a fall in liquidity. */
  marks?: readonly TokenMark[];
  /** The person's own filled trades of this market, from the wallet's history. */
  ownTrades?: readonly Readonly<{ t: number; side: "buy" | "sell" }>[];
  /** The wallet's limit orders: open ones are levels at their price, filled ones marks on their candle. */
  limits?: LimitOrdersRead | null;
  /** The wallet's balances, for SOL's dollar price when an order is priced in SOL. */
  holdings?: HoldingsState | null;
  /** The page's one last price — the header's and the ticket's — while it is fresh; the chart's last bar closes at it. */
  livePrice?: number | null;
  /** The full-screen control; off where the chart already is the whole screen (the phone's WebView, CH-21). */
  fullScreen?: boolean;
}) {
  const { text, locale } = useSolanaI18n();
  const lang = locale === "uk" ? "uk" : "en";
  const [chosen, setSeries] = useStored<SpotSeries>(SERIES_KEY, "price", isSeries);
  const series: SpotSeries = capFactor === null ? "price" : chosen;
  const basis = series === "cap" ? CAP_BASIS : PRICE_BASIS;
  const [look, setLook] = useChartLook();
  const section = useRef<HTMLElement | null>(null);
  const [full, setFull] = useState(false);

  /* One feed a market, made with it: its first step from the price the page has, finer as the reads bring smaller
     prices. What the page reads of the market — its symbol, whether it is a stock, the supply its cap is counted on —
     goes in before the chart asks: the chart's own effects run before this component's. */
  const lastClose = candles.value && candles.value.mint === mint ? (candles.value.candles.at(-1)?.close ?? null) : null;
  const reference = livePrice ?? lastClose;
  const [held, setHeld] = useState<Readonly<{ mint: string; feed: SpotChartFeed }> | null>(null);
  useEffect(() => {
    const feed = new SpotChartFeed({ mint, symbol, stock, capFactor, reference });
    setHeld({ mint, feed });
    return () => feed.dispose();
    // A market's feed lives while the market is on the chart; the price seeds its first step only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mint]);
  const feed = held && held.mint === mint ? held.feed : null;
  feed?.describe({ symbol, stock, capFactor });

  /* The page's reads go into the feed as they come, and its live price; the chart listens. A read that failed keeps
     the time of the last good one (`put`), so the age under the chart counts from it. */
  useEffect(() => {
    if (!feed || !candles.value || candles.value.mint !== mint) return;
    const read = candles.value;
    const observed = candles.status === "ready" ? Date.parse(candles.observedAt) : null;
    const stale = candles.status === "unavailable" || (candles.status === "ready" && candles.stale);
    feed.put(read.timeframe, read.candles, observed !== null && Number.isFinite(observed) ? observed : null, stale, read.pool.name);
  }, [feed, candles, mint]);
  useEffect(() => {
    feed?.live(livePrice ?? null);
  }, [feed, livePrice]);

  /* A change of interval made in the chart goes to the page, which reads it; the chart follows the page's `resolution`. */
  /* The older chart's indicators, brought once — only while the core keeps none of its own in this browser — and then
     whatever the person sets, so a chart opened again (the price and the cap) opens with the set they have now. */
  const [indicators, setIndicators] = useState<readonly Readonly<{ name: string; params: readonly number[]; pane: "candles" | "own" }>[] | null>(() => {
    try {
      if (typeof window === "undefined" || window.localStorage.getItem(INDICATORS_LOCAL_KEY) !== null) return null;
    } catch {
      return null;
    }
    return legacyIndicators();
  });

  /* The source and the age in one line (SOL-C12): the sources' attribution stands at the end of the chart's own line of
     its source and age, which gives it that much room. Measured, so it holds in either language. */
  useEffect(() => {
    const root = section.current;
    const line = root?.querySelector<HTMLElement>("[data-chart-sources='chart']");
    if (!root || !line) return;
    const measure = () => root.style.setProperty("--spot-sources-w", `${Math.ceil(line.getBoundingClientRect().width)}px`);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(line);
    return () => observer.disconnect();
  }, [feed, look, candles.status]);

  useEffect(() => {
    const onChange = () => setFull(section.current !== null && document.fullscreenElement === section.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  /* The read's own arrays, not its wrapper: the levels and marks are rebuilt on a new read, not on every render. */
  const limitOrders = limits?.orders ?? null;
  const limitTokens = limits?.tokens ?? null;
  const solUsd = useMemo(() => {
    const native = holdings?.value?.find((row) => row.kind === "NATIVE_SOL");
    const price = native?.catalog?.usdPrice ? Number(native.catalog.usdPrice) : null;
    return price !== null && Number.isFinite(price) && price > 0 ? price : null;
  }, [holdings]);
  const tick = feed ? feed.tick : null;
  const chartMarks = useMemo(() => {
    const view = series === "cap" ? CAP_BASIS : PRICE_BASIS;
    const out: ChartMark[] = [];
    const add = (id: string, seconds: number, side: "buy" | "sell" | null, label: string, own: boolean, kind: ChartMark["kind"] = "trade") =>
      out.push({ id, kind, t: seconds * 1000, price: null, side, label, own });
    marks.forEach((mark, index) => {
      const id = `m${index}:${mark.kind}:${mark.t}`;
      if (mark.kind === "big-buy") add(id, mark.t, "buy", text("Large buy"), false);
      else if (mark.kind === "big-sell") add(id, mark.t, "sell", text("Large sale"), false);
      else if (mark.kind === "creator-buy") add(id, mark.t, "buy", text("Creator"), false);
      else if (mark.kind === "creator-sell")
        add(id, mark.t, "sell", mark.pct === null ? text("Creator sold") : `${text("Creator sold")} ${mark.pct < 0.01 ? "<0.01" : mark.pct.toFixed(mark.pct < 1 ? 2 : 1)}%`, false);
      else if (mark.kind === "dex") add(id, mark.t, null, text("On DEX"), false, "event");
      else if (mark.kind === "liquidity-drop") add(id, mark.t, null, `${text("Liquidity")} ${formatPercent(mark.pct, locale)}`, false, "event");
    });
    ownTrades.forEach((own, index) => add(`own${index}:${own.t}`, own.t, own.side, text("You"), true));
    if (limitOrders) {
      limitFillMarkers(limitOrders, mint, text("Limit")).forEach((fill, index) => add(`limit${index}:${fill.time}`, fill.time, fill.position === "belowBar" ? "buy" : "sell", fill.text, true));
    }
    /* The wallet's open limits on this market, at the price each fills at, in the chart's unit: levels, never a draft. */
    const levels: ChartLevel[] = [];
    if (limitOrders && limitTokens && limitOrders.length > 0 && tick !== null) {
      const lines = limitOrderLines({
        orders: limitOrders,
        tokens: limitTokens,
        baseMint: mint,
        quoteUsd: (quote) => (DOLLAR_QUOTES.has(quote) ? 1 : quote === WRAPPED_SOL ? solUsd : null),
        capFactor: series === "cap" ? capFactor : null,
        label: (order, amount) => `${order.side === "buy" ? text("Buy") : text("Sell")}${amount === null ? "" : ` ${formatAmount(amount, locale)}`}`,
      });
      for (const line of lines) levels.push({ id: line.id, kind: "level", price: onTick(line.price, series === "cap" ? "1" : tick), basis: view, label: line.title });
    }
    return { view, marks: out.sort((a, b) => a.t - b.t), levels };
  }, [marks, ownTrades, mint, limitOrders, limitTokens, solUsd, series, capFactor, text, locale, tick]);

  const sources = <SourcesLine place="chart" />;

  if (candles.status === "none" || (candles.status === "unavailable" && !candles.value)) {
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
      <section ref={section} className={`${styles.panel} ${styles.chart}`} aria-label={text("Chart")} data-terminal-chart data-dense>
        <div className={styles.chartState} data-chart-state>
          <div>
            <b>{candles.status === "none" ? text("Chart unavailable") : text("The chart is unavailable right now")}</b>
            {candles.status === "none"
              ? `${candles.code ? why[candles.code] : text("No pool prices this asset on the chart source.")} ${text("Buy and Sell still work from the live quote.")}`
              : text("The price and the order ticket still work; the chart will return on its own.")}
          </div>
        </div>
        {sources}
      </section>
    );
  }

  /* The chart's tools in one row (SOL-C12): the strip above names the market, so the head carries no symbol of its own;
     the candles' type and the scale stand in «Вигляд графіка» beside the palette and the clock, and the core's own
     controls for them are put away in the stylesheet. The interval is the core's row — the one interval switch. */
  const coreWords = chartWords(lang);
  const head = (
    <span className={styles.chartHead}>
      {/* The chart's name for a screen reader (the core labels the chart by its head). */}
      <span className="sr-only" translate="no">
        {symbol}
      </span>
      {capFactor === null ? null : (
        <span className={styles.seriesSwitch} role="group" aria-label={text("The chart shows")} data-chart-series={series}>
          {(["price", "cap"] as const).map((entry) => (
            <button key={entry} type="button" aria-pressed={series === entry} onClick={() => setSeries(entry)} title={entry === "cap" ? text("Market cap at today's circulating supply") : undefined}>
              {entry === "price" ? text("Price") : text("Market cap")}
            </button>
          ))}
        </span>
      )}
      <details className={styles.chartLook}>
        <summary className={styles.chartIcon} aria-label={text("Chart look")} title={text("Chart look")}>
          <GearSix size={16} aria-hidden="true" />
        </summary>
        <div className={styles.chartLookMenu}>
          {capFactor === null ? null : (
            <>
              <p className={styles.seriesInMenu}>{text("The chart shows")}</p>
              <span className={styles.seriesInMenu} role="group" aria-label={text("The chart shows")}>
                {(["price", "cap"] as const).map((entry) => (
                  <button key={entry} type="button" aria-pressed={series === entry} onClick={() => setSeries(entry)}>
                    {entry === "price" ? text("Price") : text("Market cap")}
                  </button>
                ))}
              </span>
            </>
          )}
          <p>{text("Candle type")}</p>
          <span role="group" aria-label={text("Candle type")}>
            {CANDLE_TYPES.map((entry) => (
              <button key={entry} type="button" aria-pressed={(look ?? DEFAULT_LOOK).candle === entry} onClick={() => setLook({ candle: entry })}>
                {coreWords.candleTypes[entry]}
              </button>
            ))}
          </span>
          <p>{text("Chart scale")}</p>
          <span role="group" aria-label={text("Chart scale")}>
            {SCALE_MODES.map((entry) => (
              <button key={entry} type="button" aria-pressed={(look ?? DEFAULT_LOOK).scale === entry} onClick={() => setLook({ scale: entry })} title={coreWords.scaleNames[entry]}>
                {coreWords.scales[entry]}
              </button>
            ))}
          </span>
          <p>{text("Candle colours")}</p>
          <span role="group" aria-label={text("Candle colours")}>
            {PALETTES.map((entry) => (
              <button key={entry} type="button" aria-pressed={(look ?? DEFAULT_LOOK).palette === entry} onClick={() => setLook({ palette: entry })}>
                {entry === "default" ? text("Standard") : entry === "contrast" ? text("High contrast") : text("Colour-blind")}
              </button>
            ))}
          </span>
          <p>{text("Time labels")}</p>
          <span role="group" aria-label={text("Time labels")}>
            <button type="button" aria-pressed={(look ?? DEFAULT_LOOK).timezone === null} onClick={() => setLook({ timezone: null })}>
              {text("My time")}
            </button>
            <button type="button" aria-pressed={(look ?? DEFAULT_LOOK).timezone === "UTC"} onClick={() => setLook({ timezone: "UTC" })}>
              UTC
            </button>
          </span>
        </div>
      </details>
      {fullScreen ? (
        <button
          type="button"
          className={styles.chartIcon}
          aria-label={full ? text("Exit full screen") : text("Full screen")}
          title={full ? text("Exit full screen") : text("Full screen")}
          aria-pressed={full}
          onClick={() => {
            if (document.fullscreenElement) void document.exitFullscreen?.();
            else void section.current?.requestFullscreen?.();
          }}
        >
          {full ? <ArrowsIn size={16} aria-hidden="true" /> : <ArrowsOut size={16} aria-hidden="true" />}
        </button>
      ) : null}
    </span>
  );

  const palette = look && look.palette !== "default" ? (PALETTE_TOKENS[look.palette] as CSSProperties) : undefined;
  return (
    <section ref={section} className={`${styles.panel} ${styles.chart}`} aria-label={text("Chart")} data-terminal-chart data-dense>
      <div className={styles.chartCanvas} style={palette} data-spot-core-chart>
        {feed && look ? (
          <RyntraChart
            key={`${mint}|${series}|${look.palette}`}
            source={feed.source}
            instrument={mint}
            resolution={resolutionOf(timeframe)}
            onResolutionChange={(next) => {
              const tf = timeframeOf(next);
              if (tf) onTimeframe(tf);
            }}
            basis={basis}
            lang={lang}
            timezone={look.timezone ?? undefined}
            candleType={look.candle}
            scale={look.scale}
            symbol={head}
            label={`${symbol} · ${series === "cap" ? text("Market cap") : text("Price")}`}
            marks={chartMarks}
            drawings={{ profile: null, legacy: (view) => legacyDrawingKeys(symbol, view) }}
            indicators={indicators}
            onIndicatorsChange={setIndicators}
            indicatorWorker={indicatorWorker}
            className={styles.coreChart}
          />
        ) : (
          <div className={styles.chartState} data-chart-state>
            {text("Loading chart…")}
          </div>
        )}
      </div>
      {/* What the capitalisation is counted on, on the chart itself at every width: the past at today's supply. */}
      {series === "cap" ? (
        <p className={styles.capNote} data-cap-note>
          {text("Market cap at today's circulating supply")}
        </p>
      ) : null}
      {sources}
    </section>
  );
}
