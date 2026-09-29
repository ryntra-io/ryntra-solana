/* IndicatorEngine — owns every indicator series/pane on a lightweight-charts
   instance. Plain class, no React: the chart component drives it imperatively.
   Datasets are ≤ ~1500 bars, so ticks do a FULL recompute of the arrays but
   render via series.update(lastPoint) — setData on ticks causes autoscale flicker. */

import { HistogramSeries, LineSeries, LineStyle } from "lightweight-charts";
import type { IChartApi, IPaneApi, ISeriesApi, Time, UTCTimestamp } from "lightweight-charts";
import type { NormalizedCandle, LinePoint, HistogramPoint } from "../types";
import { fmtPrice, withAlpha } from "../format";
import { INDICATOR_DEFS, instanceLabel } from "./defs";
import type { IndicatorInstance } from "./defs";
import {
  atr,
  bollinger,
  ema,
  hasVolume,
  macd,
  rsi,
  sma,
  volumeHistogram,
  vwap,
  wma,
} from "./calc";

type Palette = { up: string; down: string };
type AnySeries = ISeriesApi<"Line"> | ISeriesApi<"Histogram">;
type Points = LinePoint[] | HistogramPoint[];

type SubSeries = {
  kind: "line" | "histogram";
  api: AnySeries;
  /** Cached candle-aligned points — legend lookups binary-search these. */
  data: Points;
};

type Entry = {
  instance: IndicatorInstance;
  pane: IPaneApi<Time> | null;
  /** Empty while requiresVolume && feed has no volume (legend explains). */
  series: SubSeries[];
};

const GREY_LEVEL = "rgba(148,163,184,0.4)";

function fmtVolume(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(2)}K`;
  return v.toFixed(2);
}

/** Largest point with time <= t, or null. */
function floorByTime(data: Points, t: number): LinePoint | HistogramPoint | null {
  let lo = 0;
  let hi = data.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((data[mid].time as number) <= t) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found >= 0 ? data[found] : null;
}

function setSub(sub: SubSeries, data: Points): void {
  sub.data = data;
  if (sub.kind === "line") (sub.api as ISeriesApi<"Line">).setData(data as LinePoint[]);
  else (sub.api as ISeriesApi<"Histogram">).setData(data as HistogramPoint[]);
}

function updateSub(sub: SubSeries, point: LinePoint | HistogramPoint): void {
  if (sub.kind === "line") (sub.api as ISeriesApi<"Line">).update(point as LinePoint);
  else (sub.api as ISeriesApi<"Histogram">).update(point as HistogramPoint);
}

export class IndicatorEngine {
  private chart: IChartApi;
  private palette: Palette;
  private candles: NormalizedCandle[] = [];
  /** Caller's array reference from the last sync/setCandles — change detector only. */
  private sourceRef: NormalizedCandle[] | null = null;
  private entries = new Map<string, Entry>();
  private order: string[] = [];

  constructor(chart: IChartApi, opts: { palette: Palette }) {
    this.chart = chart;
    this.palette = opts.palette;
  }

  sync(instances: IndicatorInstance[], candles: NormalizedCandle[]): void {
    const candlesChanged = candles !== this.sourceRef;
    if (candlesChanged) {
      this.candles = candles.slice();
      this.sourceRef = candles;
    }

    const next = new Map(instances.map((i) => [i.id, i]));
    for (const [id, entry] of this.entries) {
      if (!next.has(id)) {
        this.removeEntry(entry);
        this.entries.delete(id);
      }
    }

    for (const instance of instances) {
      const entry = this.entries.get(instance.id);
      if (!entry || entry.instance.type !== instance.type) {
        if (entry) this.removeEntry(entry);
        const created = this.createEntry(instance);
        this.entries.set(instance.id, created);
        this.recompute(created);
        continue;
      }
      const prev = entry.instance;
      entry.instance = instance;
      const paramsChanged = JSON.stringify(prev.params) !== JSON.stringify(instance.params);
      if (paramsChanged || candlesChanged) {
        this.recompute(entry);
      }
      if (prev.color !== instance.color || prev.lineWidth !== instance.lineWidth) {
        this.restyle(entry);
      }
      if (prev.visible !== instance.visible) {
        for (const sub of entry.series) sub.api.applyOptions({ visible: instance.visible });
      }
    }

    this.order = instances.map((i) => i.id);
  }

  setCandles(candles: NormalizedCandle[]): void {
    this.candles = candles.slice();
    this.sourceRef = candles;
    for (const entry of this.entries.values()) this.recompute(entry);
  }

  applyTick(candle: NormalizedCandle, appended: boolean): void {
    if (appended || this.candles.length === 0) this.candles.push(candle);
    else this.candles[this.candles.length - 1] = candle;
    this.sourceRef = null; // diverged from caller's array

    for (const entry of this.entries.values()) {
      if (entry.series.length === 0) {
        // volume may have appeared mid-session — try to attach now
        this.recompute(entry);
        continue;
      }
      const data = this.computeData(entry.instance);
      for (let i = 0; i < entry.series.length; i++) {
        const sub = entry.series[i];
        const points = data[i];
        const hadData = sub.data.length > 0;
        sub.data = points;
        if (points.length === 0) continue;
        if (!hadData) {
          setSub(sub, points); // first defined value — update() has no anchor yet
        } else {
          updateSub(sub, points[points.length - 1]);
        }
      }
    }
  }

  setPalette(p: Palette): void {
    this.palette = p;
    for (const entry of this.entries.values()) {
      // only these bake palette colors into point data
      if (entry.instance.type === "volume" || entry.instance.type === "macd") {
        this.recompute(entry);
      }
    }
  }

  /** Legend rows for ALL instances; null time → last bar.
      Hidden (visible=false) instances still get a row — with empty values —
      so the legend can render a dimmed chip instead of dropping it. */
  valuesAt(
    time: UTCTimestamp | null,
  ): { id: string; label: string; color: string; values: string[] }[] {
    const rows: { id: string; label: string; color: string; values: string[] }[] = [];
    for (const id of this.order) {
      const entry = this.entries.get(id);
      if (!entry) continue;
      const { instance } = entry;
      if (!instance.visible) {
        rows.push({ id, label: instanceLabel(instance), color: instance.color, values: [] });
        continue;
      }
      const fmt = instance.type === "volume" ? fmtVolume : fmtPrice;
      let values: string[];
      if (entry.series.length === 0 && INDICATOR_DEFS[instance.type].requiresVolume) {
        values = ["no volume data"];
      } else {
        values = entry.series.map((sub) => {
          const point =
            time == null
              ? sub.data.length > 0
                ? sub.data[sub.data.length - 1]
                : null
              : floorByTime(sub.data, time as number);
          return point ? fmt(point.value) : "—";
        });
      }
      rows.push({ id, label: instanceLabel(instance), color: instance.color, values });
    }
    return rows;
  }

  hasVolume(): boolean {
    return hasVolume(this.candles);
  }

  destroy(): void {
    for (const entry of this.entries.values()) this.removeEntry(entry);
    this.entries.clear();
    this.order = [];
  }

  /* ---- internals ---- */

  private createEntry(instance: IndicatorInstance): Entry {
    const def = INDICATOR_DEFS[instance.type];
    const entry: Entry = { instance, pane: null, series: [] };
    if (def.placement === "pane") {
      entry.pane = this.chart.addPane();
      entry.pane.setStretchFactor(1);
      this.chart.panes()[0].setStretchFactor(3);
    }
    this.ensureSeries(entry);
    return entry;
  }

  /** Attach series if missing. False when requiresVolume and the feed has none. */
  private ensureSeries(entry: Entry): boolean {
    if (entry.series.length > 0) return true;
    const { instance } = entry;
    const def = INDICATOR_DEFS[instance.type];
    if (def.requiresVolume && !hasVolume(this.candles)) return false;

    const lineOpts = {
      color: instance.color,
      lineWidth: instance.lineWidth,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
      visible: instance.visible,
    } as const;

    const addLine = (opts: object): SubSeries => {
      const api = entry.pane
        ? entry.pane.addSeries(LineSeries, opts)
        : this.chart.addSeries(LineSeries, opts);
      return { kind: "line", api, data: [] };
    };

    switch (instance.type) {
      case "sma":
      case "ema":
      case "wma":
      case "vwap":
      case "rsi":
      case "atr": {
        const sub = addLine(lineOpts);
        if (instance.type === "rsi") {
          for (const price of [30, 70]) {
            (sub.api as ISeriesApi<"Line">).createPriceLine({
              price,
              color: GREY_LEVEL,
              lineWidth: 1,
              lineStyle: LineStyle.Dashed,
              axisLabelVisible: false,
              title: "",
            });
          }
        }
        entry.series = [sub];
        break;
      }
      case "bb": {
        const band = {
          ...lineOpts,
          color: withAlpha(instance.color, 0.6),
          lineWidth: 1 as const,
          lineStyle: LineStyle.Dashed,
        };
        entry.series = [addLine(lineOpts), addLine(band), addLine(band)];
        break;
      }
      case "macd": {
        const macdLine = addLine(lineOpts);
        const signalLine = addLine({ ...lineOpts, color: withAlpha(instance.color, 0.7) });
        const histApi = entry.pane!.addSeries(HistogramSeries, {
          priceLineVisible: false,
          lastValueVisible: false,
          visible: instance.visible,
        });
        entry.series = [macdLine, signalLine, { kind: "histogram", api: histApi, data: [] }];
        break;
      }
      case "volume": {
        const api = this.chart.addSeries(HistogramSeries, {
          priceScaleId: "vol",
          priceFormat: { type: "volume" },
          priceLineVisible: false,
          lastValueVisible: false,
          visible: instance.visible,
        });
        api.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
        entry.series = [{ kind: "histogram", api, data: [] }];
        break;
      }
    }
    return true;
  }

  /** Candle-aligned point arrays in entry.series order. */
  private computeData(instance: IndicatorInstance): Points[] {
    const c = this.candles;
    const p = instance.params;
    switch (instance.type) {
      case "sma":
        return [sma(c, p.period)];
      case "ema":
        return [ema(c, p.period)];
      case "wma":
        return [wma(c, p.period)];
      case "bb": {
        const b = bollinger(c, p.period, p.mult);
        return [b.basis, b.upper, b.lower];
      }
      case "vwap":
        return [vwap(c)];
      case "rsi":
        return [rsi(c, p.period)];
      case "atr":
        return [atr(c, p.period)];
      case "macd": {
        const m = macd(c, p.fast, p.slow, p.signal);
        const up = withAlpha(this.palette.up, 0.5);
        const down = withAlpha(this.palette.down, 0.5);
        const hist: HistogramPoint[] = m.hist.map((pt) => ({
          time: pt.time,
          value: pt.value,
          color: pt.value >= 0 ? up : down,
        }));
        return [m.macd, m.signal, hist];
      }
      case "volume":
        return [
          volumeHistogram(c, withAlpha(this.palette.up, 0.45), withAlpha(this.palette.down, 0.45)),
        ];
    }
  }

  private recompute(entry: Entry): void {
    if (!this.ensureSeries(entry)) {
      // volume disappeared from the feed (symbol switch) — drop stale series
      if (entry.series.length > 0) this.removeSeriesOnly(entry);
      return;
    }
    const data = this.computeData(entry.instance);
    for (let i = 0; i < entry.series.length; i++) setSub(entry.series[i], data[i]);
  }

  /** Reapply style-only options after a color/lineWidth change. */
  private restyle(entry: Entry): void {
    const { instance, series } = entry;
    if (series.length === 0) return;
    const base = { color: instance.color, lineWidth: instance.lineWidth };
    switch (instance.type) {
      case "bb": {
        series[0].api.applyOptions(base);
        const band = { color: withAlpha(instance.color, 0.6) };
        series[1].api.applyOptions(band);
        series[2].api.applyOptions(band);
        break;
      }
      case "macd":
        series[0].api.applyOptions(base);
        series[1].api.applyOptions({ ...base, color: withAlpha(instance.color, 0.7) });
        break; // hist colors come from the palette, not the instance
      case "volume":
        break;
      default:
        series[0].api.applyOptions(base);
    }
  }

  private removeSeriesOnly(entry: Entry): void {
    for (const sub of entry.series) {
      try {
        this.chart.removeSeries(sub.api);
      } catch {
        // chart may already be disposed
      }
    }
    entry.series = [];
  }

  private removeEntry(entry: Entry): void {
    this.removeSeriesOnly(entry);
    if (!entry.pane) return;
    try {
      // never cache pane indices — LWC reindexes panes on removal; also verify
      // the pane still belongs to the chart (LWC can auto-drop emptied panes)
      const panes = this.chart.panes();
      if (panes.includes(entry.pane) && entry.pane.getSeries().length === 0) {
        this.chart.removePane(entry.pane.paneIndex());
      }
    } catch {
      // chart may already be disposed
    }
    entry.pane = null;
  }
}
