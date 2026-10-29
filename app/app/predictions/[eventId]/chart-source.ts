/**
 * The market page's chart source in the core's contract (`ryntra.chart`): one outcome — the market's «yes» — on the
 * probability scale, and its «no» as 100 − «yes». Its pages come from Ryntra's route
 * (`/api/predictions/outcomes/<id>/feed`): from the market-data gateway where it records the market, from the
 * aggregator's bars otherwise — one source per view, never the two spliced, each page naming its source and age.
 *
 * Live: the gateway has no address a browser on https may call yet, so the newest bars are read again every
 * `POLL_MS` and the numbers are said as delayed by that much — never as live. Bars shorter than a minute are not
 * offered: a poll would miss most of them. A read that fails leaves the bars on screen, aged; when reads come back
 * after a break longer than a bar, the chart is told the bars since its newest one changed, and reads them again —
 * never a line drawn across the break. A market that no longer trades, and a tab out of sight, are not polled.
 */
import { CHART_CONTRACT, type Bar, type ChartSource, type DataStatus, type HistoryPage, type Instrument, type LiveEvent, type MarketState, type TimeResolution } from "@ryntra/core/adapters";

import { complementBar, complementPage, keyOfResolution, NO_BASIS, PROBABILITY_STEP, resolutionOfKey, YES_BASIS } from "../../../../lib/predictions/chart-feed.ts";

/** How often the newest bars are read again; the server keeps the aggregator's read 20 s too. */
export const POLL_MS = 20_000;
/** The shortest bar a poll keeps whole. */
const SHORTEST_MS = 60_000;

const SPAN_MS: Readonly<Record<string, number>> = { second: 1000, minute: 60_000, hour: 3_600_000, day: 86_400_000, week: 7 * 86_400_000, month: 30 * 86_400_000 };
const barMs = (r: TimeResolution) => (SPAN_MS[r.unit] ?? 60_000) * r.span;

export type OutcomeChartFacts = Readonly<{
  /** The «yes» outcome's id: the instrument. */
  yesId: string;
  /** As the person reads it: the market's question, short. */
  symbol: string;
  venue: string;
  /** Whether the market has a «no» to chart (a market of two outcomes). */
  withNo: boolean;
  /** Whether the market still trades: a settled one is `resolved`, one past its close `closed`. */
  market: MarketState;
}>;

type Via = "gateway" | "aggregator";
type Answer = Readonly<{ via: Via; page: HistoryPage }>;
type InstrumentAnswer = Readonly<{ via: Via; resolutions: readonly string[]; opening: string }>;

/** The source of one chart, and the interval it opens on (the gateway's minute, or the aggregator's hour). */
export type PredictionChartFeed = Readonly<{ source: ChartSource; opening: () => Promise<TimeResolution | null> }>;

async function read<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { headers: { accept: "application/json" }, cache: "no-store", signal });
  if (!response.ok) throw new Error(`the chart's read answered ${response.status}`);
  return (await response.json()) as T;
}

/** The status as the screen should read it: the market's own state, and a poll's delay on top of the source's. */
function shown(status: DataStatus, market: MarketState, now: number): DataStatus {
  const polled = status.state === "live" ? { state: "delayed" as const, delay_ms: POLL_MS } : status.state === "delayed" ? { delay_ms: (status.delay_ms ?? 0) + POLL_MS } : {};
  return { ...status, ...polled, market, age_ms: Math.max(status.age_ms, now - status.at) };
}

const hidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";

export function predictionChartFeed(facts: OutcomeChartFacts, now: () => number = Date.now): PredictionChartFeed {
  const base = `/api/predictions/outcomes/${encodeURIComponent(facts.yesId)}/feed`;
  let answer: Promise<InstrumentAnswer> | null = null;
  const instrumentAnswer = () => {
    answer ??= read<InstrumentAnswer>(`${base}?part=instrument`).catch((error) => {
      answer = null;
      throw error;
    });
    return answer;
  };

  const page = async (request: Readonly<{ resolution: string; load: string; timestamp: number | null; limit: number }>, signal?: AbortSignal): Promise<HistoryPage> => {
    const { via } = await instrumentAnswer();
    const q = new URLSearchParams({ part: "history", via, resolution: request.resolution, load: request.load, limit: String(request.limit) });
    if (request.timestamp != null) q.set("timestamp", String(request.timestamp));
    return (await read<Answer>(`${base}?${q}`, signal)).page;
  };

  /* The newest bar each view opened on, by interval and side: where its poll starts. */
  const opened = new Map<string, Bar>();
  const viewKey = (key: string, no: boolean) => `${key}|${no ? "no" : "yes"}`;

  const resolutionsOf = (a: InstrumentAnswer) => a.resolutions.map(resolutionOfKey).filter((r): r is TimeResolution => r !== null && barMs(r) >= SHORTEST_MS);

  const source: ChartSource = {
    contract: CHART_CONTRACT,
    instrument: async (id) => {
      if (id !== facts.yesId) throw new Error(`unknown instrument ${id}`);
      const resolutions = resolutionsOf(await instrumentAnswer());
      const value: Instrument = {
        id: facts.yesId,
        symbol: facts.symbol,
        // Polymarket settles on Polygon; another venue is named by itself.
        network: facts.venue === "polymarket" ? "polygon" : facts.venue,
        venue: facts.venue,
        kind: "prediction",
        base: facts.yesId,
        quote: "USDC",
        tick: PROBABILITY_STEP,
        price_rule: null,
        lot: "1",
        min_notional: null,
        price_band: null,
        multiplier: "1",
        multiplier_version: null,
        session: { timezone: "UTC", windows: [], holidays: [] },
        reference_session: null,
        scale: "probability",
        outcomes: facts.withNo ? ["yes", "no"] : ["yes"],
        min_resolution: resolutions[0] ?? { kind: "time", unit: "minute", span: 1 },
        resolutions,
        bases: facts.withNo ? [YES_BASIS, NO_BASIS] : [YES_BASIS],
        trading_basis: YES_BASIS,
      };
      return value;
    },
    history: async (request, options) => {
      const key = keyOfResolution(request.resolution);
      if (!key) throw new Error("this source draws bars by time");
      if (request.load === "backward") {
        // The newest page is the first one: newer bars come as live updates.
        const newest = await page({ resolution: key, load: "init", timestamp: null, limit: 1 }, options?.signal);
        return { ...newest, bars: [], more: { forward: false, backward: false }, gaps: [], status: shown(newest.status, facts.market, now()) };
      }
      const yes = await page({ resolution: key, load: request.load, timestamp: request.timestamp, limit: request.limit }, options?.signal);
      const result = request.basis.outcome === "no" ? complementPage(yes) : yes;
      const last = result.bars.at(-1);
      if (request.load === "init" && last) opened.set(viewKey(key, request.basis.outcome === "no"), last);
      return { ...result, status: shown(result.status, facts.market, now()) };
    },
    subscribe: (request, listener: (event: LiveEvent) => void) => {
      const key = keyOfResolution(request.resolution);
      if (!key || request.resolution.kind !== "time" || facts.market !== "open") return () => {};
      const span = barMs(request.resolution);
      const no = request.basis.outcome === "no";
      let newest: Bar | null = opened.get(viewKey(key, no)) ?? null;
      /* After a correction the chart reads its view again: the poll goes on from that page's newest bar. */
      let reseed = false;
      let stopped = false;
      const poll = async () => {
        if (hidden()) return;
        if (reseed) {
          reseed = false;
          newest = opened.get(viewKey(key, no)) ?? newest;
        }
        try {
          const yes = await page({ resolution: key, load: "init", timestamp: null, limit: 3 });
          if (stopped) return;
          const status = shown(yes.status, facts.market, now());
          const first = yes.bars[0];
          // Reads came back after a break longer than the bars they hold: the source has the bars between, so the chart
          // reads them again — the engine reloads its view on a correction — rather than drawing a line across.
          if (newest && first && first.t > newest.t + span) {
            listener({ type: "corrected", correction: { instrument: facts.yesId, from: newest.t, to: first.t, reason: "backfill", at: now() } });
            reseed = true;
            return;
          }
          for (const bar of yes.bars) {
            if (newest && bar.t < newest.t) continue;
            const value = no ? complementBar(bar) : bar;
            if (newest && value.t === newest.t && value.o === newest.o && value.h === newest.h && value.l === newest.l && value.c === newest.c && value.v === newest.v) continue;
            newest = value;
            listener({ type: "bar", bar: value, status });
          }
          if (yes.bars.length === 0) listener({ type: "status", status });
        } catch {
          /* The bars on screen stay, aged by the chart; the next read may answer. */
        }
      };
      const timer = setInterval(() => void poll(), POLL_MS);
      const onVisible = () => {
        if (!hidden()) void poll();
      };
      if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisible);
      return () => {
        stopped = true;
        clearInterval(timer);
        if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisible);
      };
    },
    series: async () => [],
    seriesHistory: async (request) => {
      throw new Error(`no series here (${request.series})`);
    },
    marks: async () => ({
      marks: [],
      status: { state: "delayed", market: facts.market, source: { id: "agg", label: "AGG", rights: "display", attribution: null }, at: now(), gateway_at: now(), age_ms: 0, delay_ms: POLL_MS, derived: false },
    }),
    book: async () => null,
  };

  return {
    source,
    opening: async () => {
      try {
        const a = await instrumentAnswer();
        const opening = resolutionOfKey(a.opening);
        return opening && resolutionsOf(a).some((r) => keyOfResolution(r) === a.opening) ? opening : (resolutionsOf(a)[0] ?? null);
      } catch {
        return null;
      }
    },
  };
}
