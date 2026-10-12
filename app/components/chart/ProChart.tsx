"use client";

import React, {
  forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState,
} from "react";
import {
  AreaSeries, BarSeries, CandlestickSeries, LineSeries,
  createChart, createSeriesMarkers, createTextWatermark,
  CrosshairMode, LineStyle, PriceScaleMode,
  type IChartApi, type IPriceLine, type ISeriesApi, type ISeriesMarkersPluginApi, type SeriesMarker, type SeriesType,
  type LogicalRange, type MouseEventParams, type Time, type UTCTimestamp,
} from "lightweight-charts";
import type { ChartMarkerSpec, ChartTheme, NormalizedCandle, PriceLineSpec } from "@/lib/chart/types";
import { CANDLE_PALETTES, chartOptions } from "@/lib/chart/theme";
import { loadChartSettings, saveChartSettings, type ChartSettings, type ChartType } from "@/lib/chart/settings";
import { hasVolume as candlesHaveVolume } from "@/lib/chart/indicators/calc";
import { IndicatorEngine } from "@/lib/chart/indicators/engine";
import type { IndicatorInstance } from "@/lib/chart/indicators/defs";
import { loadIndicators, saveIndicators } from "@/lib/chart/indicators/persist";
import { createDrawingLayer, type DrawingLayerEx } from "@/lib/chart/drawings/controller";
import type { ActiveTool, RenderPt } from "@/lib/chart/drawings/types";
import { withAlpha } from "@/lib/chart/format";
import { createRiskLineLayer, type RiskLineLayer, type RiskLineSpec } from "@/lib/chart/risklines/layer";
import type { ThemePalette } from "@/lib/chart/drawings/types";
import { DrawingToolbar } from "./DrawingToolbar";
import { IndicatorsMenu } from "./IndicatorsMenu";
import { IndicatorLegend, type LegendRow } from "./IndicatorLegend";
import { ChartSettingsPopover } from "./ChartSettingsPopover";
import { TextEditOverlay } from "./TextEditOverlay";
import {
  ArrowsIn, ArrowsOut, ChartLine, GearSix,
} from "@phosphor-icons/react";

export type ProChartHandle = {
  /** WS tick hot path — no React re-render. */
  applyTick(c: NormalizedCandle): void;
  /** WS snapshot / full replace outside the `candles` prop. */
  applySnapshot(c: NormalizedCandle[]): void;
  fitContent(): void;
  getChart(): IChartApi | null;
};

export type ProChartFeatures = {
  drawings?: boolean;
  indicators?: boolean;
  settings?: boolean;
  fullscreen?: boolean;
};

export type ProChartProps = {
  /** REST seed / full data — the page owns the feed, the chart owns rendering. */
  candles: NormalizedCandle[];
  symbolLabel: string;
  tfSeconds: number;
  theme: ChartTheme;
  /** accent hex for line/area series + drawings; defaults to the --accent CSS var on the container */
  accent?: string;
  timeframes: readonly string[];
  tf: string;
  onTfChange(tf: string): void;
  /** PriceLineSpec.color also accepts semantic "up"/"down" — resolved via the active candle palette */
  priceLines?: PriceLineSpec[];
  /** Marks on the main series — trades, events — each put on the bar its moment falls in. */
  markers?: ChartMarkerSpec[];
  /** draggable, ticket-synced SL/TP/entry lines (derived state, never persisted) */
  riskLines?: RiskLineSpec[];
  onRiskLineDrag?(id: string, price: number): void;
  onRiskLineCommit?(id: string, price: number): void;
  /** indicator/settings persistence surface */
  storageNamespace: "demo" | "swap" | "spot";
  /** drawings persistence key, e.g. "demo:BTC-USD" / "spot:TSLA" */
  drawingScope: string;
  note?: React.ReactNode;
  /** className of the chart canvas div — keeps existing height CSS ("dm-chart" | "spot-chart") */
  chartClassName?: string;
  features?: ProChartFeatures;
  /** How the price axis and the crosshair print a value — e.g. a market cap as «$4.6M»; read when the chart is built, so a caller that changes it remounts the chart. */
  priceFormatter?: (value: number) => string;
};

/* ---- series construction per chart type ---- */

type AnySeries = ISeriesApi<SeriesType>;

function candleColorOptions(pal: { up: string; down: string }, type: ChartType) {
  if (type === "hollow") {
    return {
      upColor: "rgba(0,0,0,0)", downColor: pal.down, borderVisible: true,
      borderUpColor: pal.up, borderDownColor: pal.down, wickUpColor: pal.up, wickDownColor: pal.down,
    };
  }
  return { upColor: pal.up, downColor: pal.down, borderVisible: false, wickUpColor: pal.up, wickDownColor: pal.down };
}

function addMainSeries(chart: IChartApi, s: ChartSettings, accent: string): AnySeries {
  const pal = CANDLE_PALETTES[s.palette];
  switch (s.chartType) {
    case "bars":
      return chart.addSeries(BarSeries, { upColor: pal.up, downColor: pal.down, thinBars: false }) as AnySeries;
    case "line":
      return chart.addSeries(LineSeries, { color: accent, lineWidth: 2, priceLineVisible: true }) as AnySeries;
    case "area":
      return chart.addSeries(AreaSeries, {
        lineColor: accent, lineWidth: 2,
        topColor: withAlpha(accent, 0.18), bottomColor: withAlpha(accent, 0),
      }) as AnySeries;
    case "hollow":
    case "candles":
    default:
      return chart.addSeries(CandlestickSeries, candleColorOptions(pal, s.chartType)) as AnySeries;
  }
}

function mapBar(c: NormalizedCandle, type: ChartType) {
  if (type === "line" || type === "area") return { time: c.time, value: c.close };
  return { time: c.time, open: c.open, high: c.high, low: c.low, close: c.close };
}

/* ---- time label formatting (labels only; data stays UTC epoch) ---- */

function makeTimeFormatters(tz: "utc" | "local") {
  const zone = tz === "utc" ? "UTC" : undefined;
  const full = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const timeOnly = new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hour12: false });
  const dayOnly = new Intl.DateTimeFormat("en-GB", { timeZone: zone, day: "numeric" });
  const monthOnly = new Intl.DateTimeFormat("en-GB", { timeZone: zone, month: "short" });
  const yearOnly = new Intl.DateTimeFormat("en-GB", { timeZone: zone, year: "numeric" });
  const toDate = (t: Time) => new Date((t as number) * 1000);
  return {
    timeFormatter: (t: Time) => full.format(toDate(t)),
    /* TickMarkType: 0 Year, 1 Month, 2 DayOfMonth, 3 Time, 4 TimeWithSeconds */
    tickMarkFormatter: (t: Time, type: number) => {
      const d = toDate(t);
      if (type === 0) return yearOnly.format(d);
      if (type === 1) return monthOnly.format(d);
      if (type === 2) return dayOnly.format(d);
      return timeOnly.format(d);
    },
  };
}

function buildChartOptions(theme: ChartTheme, s: ChartSettings, priceFormatter?: (value: number) => string) {
  const base = chartOptions(theme);
  const fmt = makeTimeFormatters(s.timezone);
  const gridColors = base.grid as { vertLines?: { color?: string }; horzLines?: { color?: string } };
  return {
    ...base,
    // applyOptions deep-merges — `visible` must be explicit in BOTH branches or re-enabling does nothing
    grid: s.grid
      ? { vertLines: { color: gridColors.vertLines?.color, visible: true }, horzLines: { color: gridColors.horzLines?.color, visible: true } }
      : { vertLines: { visible: false }, horzLines: { visible: false } },
    crosshair: { mode: s.crosshair === "magnet" ? CrosshairMode.Magnet : CrosshairMode.Normal },
    localization: priceFormatter ? { timeFormatter: fmt.timeFormatter, priceFormatter } : { timeFormatter: fmt.timeFormatter },
    timeScale: { ...base.timeScale, tickMarkFormatter: fmt.tickMarkFormatter },
  };
}

/** ThemePalette for the risk-line layer, resolved from the container's CSS vars
    (honors per-page accent overrides + light/dark). */
function readRiskPalette(el: HTMLElement): ThemePalette {
  const s = getComputedStyle(el);
  const g = (n: string, fb: string) => s.getPropertyValue(n).trim() || fb;
  return {
    accent: g("--accent", "#ff5a1f"),
    success: g("--success", "#22c55e"),
    danger: g("--danger", "#ef4444"),
    warning: g("--warning", "#f59e0b"),
    text: g("--text", "#f8fafc"),
    textDim: g("--text-dim", "#cbd5e1"),
    panel: g("--panel", "#111827"),
    border: g("--border", "rgba(148,163,184,0.18)"),
  };
}

/* ============================================================ component ---- */

export const ProChart = forwardRef<ProChartHandle, ProChartProps>(function ProChart(props, ref) {
  const {
    candles, symbolLabel, tfSeconds, theme, accent, timeframes, tf, onTfChange,
    priceLines, markers, riskLines, onRiskLineDrag, onRiskLineCommit,
    storageNamespace, drawingScope, note, chartClassName, features, priceFormatter,
  } = props;
  const priceFormatterRef = useRef(priceFormatter);
  priceFormatterRef.current = priceFormatter;
  const feat = { drawings: true, indicators: true, settings: true, fullscreen: true, ...features };

  const [settings, setSettings] = useState<ChartSettings>(() => loadChartSettings());
  const [instances, setInstances] = useState<IndicatorInstance[]>(() => loadIndicators(storageNamespace));
  const [openMenu, setOpenMenu] = useState<"indicators" | "settings" | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [activeTool, setActiveTool] = useState<ActiveTool>("select");
  const [positionSide, setPositionSide] = useState<"long" | "short">("long");
  const [magnet, setMagnet] = useState(true);
  const [drawVisible, setDrawVisible] = useState(true);
  const [textEdit, setTextEdit] = useState<{ id: string; at: RenderPt } | null>(null);
  const [legendTick, setLegendTick] = useState(0);

  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<AnySeries | null>(null);
  const engineRef = useRef<IndicatorEngine | null>(null);
  const layerRef = useRef<DrawingLayerEx | null>(null);
  const prevCandlesRef = useRef<NormalizedCandle[] | null>(null);
  const watermarkRef = useRef<{ detach(): void; applyOptions(o: unknown): void } | null>(null);
  const priceLineObjsRef = useRef<IPriceLine[]>([]);
  const riskLineLayerRef = useRef<RiskLineLayer | null>(null);
  const candlesRef = useRef<NormalizedCandle[]>(candles);
  const savedRangeRef = useRef<LogicalRange | null>(null);
  const fitKeyRef = useRef<string>("");
  const hoverTimeRef = useRef<UTCTimestamp | null>(null);
  const legendRafRef = useRef(0);
  const chartElRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const instancesRef = useRef(instances);
  instancesRef.current = instances;
  const priceLinesRef = useRef(priceLines);
  priceLinesRef.current = priceLines;
  const markersRef = useRef(markers);
  markersRef.current = markers;
  const markersApiRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const riskLinesRef = useRef(riskLines);
  riskLinesRef.current = riskLines;
  const onRiskLineDragRef = useRef(onRiskLineDrag);
  onRiskLineDragRef.current = onRiskLineDrag;
  const onRiskLineCommitRef = useRef(onRiskLineCommit);
  onRiskLineCommitRef.current = onRiskLineCommit;
  const activeToolRef = useRef(activeTool);
  activeToolRef.current = activeTool;
  const magnetRef = useRef(magnet);
  magnetRef.current = magnet;
  const drawVisibleRef = useRef(drawVisible);
  drawVisibleRef.current = drawVisible;
  const positionSideRef = useRef(positionSide);
  positionSideRef.current = positionSide;

  const cssAccent = useAccentHex(rootRef, theme);
  const accentHex = accent ?? cssAccent;
  /* candlesRef also carries WS-only data, so volume presence must track ticks (legendTick), not just the prop */
  const volumeOk = useMemo(() => {
    void legendTick;
    return candlesHaveVolume(candlesRef.current.length ? candlesRef.current : candles);
  }, [candles, legendTick]);

  const applyPriceLines = useCallback(() => {
    const s = seriesRef.current;
    if (!s) return;
    const pal = CANDLE_PALETTES[settingsRef.current.palette];
    for (const l of priceLineObjsRef.current) { try { s.removePriceLine(l); } catch { /* disposed */ } }
    priceLineObjsRef.current = [];
    for (const spec of priceLinesRef.current ?? []) {
      if (!(spec.price > 0)) continue;
      // semantic colors follow the palette so SL/TP overlays respect the colorblind setting
      const color = spec.color === "up" ? pal.up : spec.color === "down" ? pal.down : spec.color;
      priceLineObjsRef.current.push(s.createPriceLine({
        price: spec.price, color, title: spec.title,
        lineStyle: spec.style === "solid" ? LineStyle.Solid : LineStyle.Dashed,
        lineWidth: spec.width ?? 1,
      }));
    }
  }, []);

  /* The marks on the bars the chart holds now: each moment snapped to the newest bar that opened at or before it,
     a moment before the first bar dropped, and marks on one bar joined into one. */
  const applyMarkers = useCallback(() => {
    const api = markersApiRef.current;
    if (!api) return;
    const pal = CANDLE_PALETTES[settingsRef.current.palette];
    const times = candlesRef.current.map((c) => c.time);
    const ink = rootRef.current ? getComputedStyle(rootRef.current).color || "#94a3b8" : "#94a3b8";
    const byBar = new Map<number, SeriesMarker<Time>>();
    for (const spec of markersRef.current ?? []) {
      let low = 0, high = times.length - 1, bar: number | null = null;
      while (low <= high) {
        const mid = (low + high) >> 1;
        if (times[mid] <= spec.time) { bar = times[mid]; low = mid + 1; } else high = mid - 1;
      }
      if (bar === null) continue;
      const color = spec.color === "up" ? pal.up : spec.color === "down" ? pal.down : spec.color === "ink" ? ink : spec.color;
      const key = bar * 2 + (spec.position === "aboveBar" ? 1 : 0);
      const known = byBar.get(key);
      if (known) {
        const words = (known.text ?? "").split(" · ").filter(Boolean);
        if (spec.text && !words.includes(spec.text)) byBar.set(key, { ...known, text: [...words, spec.text].join(" · ") });
        continue;
      }
      byBar.set(key, { time: bar as UTCTimestamp, position: spec.position, shape: spec.shape, color, text: spec.text });
    }
    try { api.setMarkers([...byBar.values()].sort((a, b) => (a.time as number) - (b.time as number))); } catch { /* series swapped mid-update */ }
  }, []);

  const applyWatermark = useCallback((chart: IChartApi, on: boolean, label: string) => {
    watermarkRef.current?.detach();
    watermarkRef.current = null;
    if (!on) return;
    watermarkRef.current = createTextWatermark(chart.panes()[0], {
      horzAlign: "center", vertAlign: "center",
      lines: [{ text: label, color: "rgba(148,163,184,0.08)", fontSize: 44 }],
    });
  }, []);

  /* ---------- build / rebuild (theme or chart-type change) ---------- */
  useEffect(() => {
    const el = chartElRef.current;
    if (!el) return;
    const s = settingsRef.current;
    const chart = createChart(el, buildChartOptions(theme, s, priceFormatterRef.current));
    const series = addMainSeries(chart, s, accentHex);
    series.setData(candlesRef.current.map((c) => mapBar(c, s.chartType)));
    chart.priceScale("right").applyOptions({
      mode: s.scale.log ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal,
      autoScale: s.scale.autoScale,
    });

    const engine = new IndicatorEngine(chart, { palette: CANDLE_PALETTES[s.palette] });
    engine.sync(instancesRef.current, candlesRef.current);

    applyWatermark(chart, s.watermark, symbolLabel);

    chartRef.current = chart;
    seriesRef.current = series;
    engineRef.current = engine;
    applyPriceLines();
    markersApiRef.current = createSeriesMarkers(series, []);
    applyMarkers();

    // draggable risk-line layer — created BEFORE the drawing layer so its capture-phase
    // pointer handler runs first and can beat the drawing controller on a line hit.
    const riskLayer = createRiskLineLayer(chart, series, chart.chartElement(), readRiskPalette(rootRef.current ?? el), {
      onDrag: (id, price) => onRiskLineDragRef.current?.(id, price),
      onCommit: (id, price) => onRiskLineCommitRef.current?.(id, price),
    });
    riskLayer.setLines(riskLinesRef.current ?? []);
    riskLineLayerRef.current = riskLayer;

    let layer: DrawingLayerEx | null = null;
    if (feat.drawings) {
      layer = createDrawingLayer(chart, series, {
        container: chart.chartElement(),
        scope: drawingScope,
        tfSeconds,
        callbacks: {
          onToolChange: (t) => setActiveTool(t),
          onRequestTextEdit: (id, at) => setTextEdit({ id, at }),
        },
      });
      // a rebuild creates a fresh layer with default internal state — re-sync it to the toolbar's React state
      layer.setMagnet(magnetRef.current);
      layer.setVisible(drawVisibleRef.current);
      layer.setPositionSide(positionSideRef.current);
      layer.setActiveTool(activeToolRef.current);
      layerRef.current = layer;
    }

    const onCrosshair = (p: MouseEventParams) => {
      hoverTimeRef.current = (p.time as UTCTimestamp | undefined) ?? null;
      if (instancesRef.current.length === 0) return; // nothing to update — skip the re-render
      cancelAnimationFrame(legendRafRef.current);
      legendRafRef.current = requestAnimationFrame(() => setLegendTick((t) => t + 1));
    };
    chart.subscribeCrosshairMove(onCrosshair);

    if (savedRangeRef.current) chart.timeScale().setVisibleLogicalRange(savedRangeRef.current);
    else if (candlesRef.current.length) chart.timeScale().fitContent();

    return () => {
      try { savedRangeRef.current = chart.timeScale().getVisibleLogicalRange(); } catch { /* disposed */ }
      cancelAnimationFrame(legendRafRef.current);
      chart.unsubscribeCrosshairMove(onCrosshair);
      riskLineLayerRef.current?.destroy();
      riskLineLayerRef.current = null;
      layer?.destroy();
      layerRef.current = null;
      engine.destroy();
      engineRef.current = null;
      watermarkRef.current?.detach();
      watermarkRef.current = null;
      priceLineObjsRef.current = [];
      try { markersApiRef.current?.detach(); } catch { /* disposed with the chart */ }
      markersApiRef.current = null;
      seriesRef.current = null;
      chartRef.current = null;
      chart.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme, settings.chartType, accentHex]);

  /* ---------- data feed (REST seed / market / TF switch) ---------- */
  useEffect(() => {
    // own copy: applyTick appends to candlesRef and must never mutate the parent's state array
    candlesRef.current = candles.slice();
    const dataChanged = prevCandlesRef.current !== candles;
    prevCandlesRef.current = candles;
    const s = seriesRef.current;
    if (!s) return;
    s.setData(candles.map((c) => mapBar(c, settingsRef.current.chartType)));
    engineRef.current?.setCandles(candles);
    applyMarkers();
    const key = `${symbolLabel}:${tf}`;
    // fit only once the NEW dataset for this key has actually arrived — on a market/TF switch this
    // effect first fires with the stale prop (identity unchanged), and fitting then would consume the key
    if (key !== fitKeyRef.current && candles.length && dataChanged) {
      fitKeyRef.current = key;
      savedRangeRef.current = null;
      chartRef.current?.timeScale().fitContent();
    }
    setLegendTick((t) => t + 1);
  }, [candles, symbolLabel, tf, applyMarkers]);

  /* ---------- drawing layer follows scope / tf / palette ---------- */
  useEffect(() => { layerRef.current?.setScope(drawingScope); }, [drawingScope]);
  useEffect(() => { layerRef.current?.setTfSeconds(tfSeconds); }, [tfSeconds]);
  useEffect(() => { layerRef.current?.refreshPalette(); }, [theme, accentHex]);
  useEffect(() => { layerRef.current?.setActiveTool(activeTool); }, [activeTool]);
  useEffect(() => { layerRef.current?.setMagnet(magnet); }, [magnet]);
  useEffect(() => { layerRef.current?.setVisible(drawVisible); }, [drawVisible]);
  useEffect(() => { layerRef.current?.setPositionSide(positionSide); }, [positionSide]);

  /* ---------- price lines ---------- */
  useEffect(() => { applyPriceLines(); }, [priceLines, applyPriceLines]);
  useEffect(() => { applyMarkers(); }, [markers, applyMarkers, settings.palette]);

  /* ---------- draggable risk lines (ticket-synced) ---------- */
  useEffect(() => { riskLineLayerRef.current?.setLines(riskLines ?? []); }, [riskLines]);
  useEffect(() => {
    const el = rootRef.current ?? chartElRef.current;
    if (el) riskLineLayerRef.current?.setPalette(readRiskPalette(el));
  }, [theme, accentHex]);

  /* ---------- watermark label follows symbol ---------- */
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    applyWatermark(chart, settingsRef.current.watermark, symbolLabel);
  }, [symbolLabel, applyWatermark]);

  /* ---------- settings (live apply; chartType handled by rebuild) ---------- */
  const onSettingsChange = useCallback((next: ChartSettings) => {
    const prev = settingsRef.current;
    setSettings(next);
    saveChartSettings(next);
    const chart = chartRef.current;
    if (!chart) return;
    if (next.chartType !== prev.chartType) return; // rebuild effect takes over
    chart.applyOptions(buildChartOptions(theme, next, priceFormatterRef.current));
    chart.priceScale("right").applyOptions({
      mode: next.scale.log ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal,
      autoScale: next.scale.autoScale,
    });
    if (next.palette !== prev.palette) {
      const pal = CANDLE_PALETTES[next.palette];
      const s = seriesRef.current;
      if (s && (next.chartType === "candles" || next.chartType === "hollow")) {
        s.applyOptions(candleColorOptions(pal, next.chartType) as never);
      } else if (s && next.chartType === "bars") {
        s.applyOptions({ upColor: pal.up, downColor: pal.down } as never);
      }
      engineRef.current?.setPalette(pal);
      applyPriceLines(); // semantic "up"/"down" line colors follow the palette
    }
    if (next.watermark !== prev.watermark) applyWatermark(chart, next.watermark, symbolLabel);
  }, [theme, symbolLabel, applyWatermark, applyPriceLines]);

  /* ---------- indicators ---------- */
  const onInstancesChange = useCallback((next: IndicatorInstance[]) => {
    setInstances(next);
    saveIndicators(storageNamespace, next);
    engineRef.current?.sync(next, candlesRef.current);
    setLegendTick((t) => t + 1);
  }, [storageNamespace]);

  const legendRows: LegendRow[] = useMemo(() => {
    void legendTick;
    const engine = engineRef.current;
    if (!engine || !feat.indicators) return [];
    const byId = new Map(instances.map((i) => [i.id, i] as const));
    return engine.valuesAt(hoverTimeRef.current).map((r) => ({
      ...r, visible: byId.get(r.id)?.visible ?? true,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [legendTick, instances]);

  /* ---------- fullscreen ---------- */
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setFullscreen(false); };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [fullscreen]);

  /* ---------- imperative handle (WS hot path) ---------- */
  useImperativeHandle(ref, (): ProChartHandle => ({
    applyTick(c) {
      const arr = candlesRef.current;
      const last = arr[arr.length - 1];
      if (last && c.time < last.time) return; // LWC update() throws on out-of-order times
      const appended = !last || c.time > last.time;
      if (appended) arr.push(c); else arr[arr.length - 1] = c;
      try { seriesRef.current?.update(mapBar(c, settingsRef.current.chartType) as never); } catch { /* series swapped mid-tick */ }
      engineRef.current?.applyTick(c, appended);
      if (hoverTimeRef.current === null) {
        cancelAnimationFrame(legendRafRef.current);
        legendRafRef.current = requestAnimationFrame(() => setLegendTick((t) => t + 1));
      }
    },
    applySnapshot(cs) {
      const sorted = cs.slice().sort((a, b) => a.time - b.time);
      candlesRef.current = sorted;
      seriesRef.current?.setData(sorted.map((c) => mapBar(c, settingsRef.current.chartType)));
      engineRef.current?.setCandles(sorted);
      applyMarkers();
    },
    fitContent() { chartRef.current?.timeScale().fitContent(); },
    getChart() { return chartRef.current; },
  }), [applyMarkers]);

  /* ---------- render ---------- */
  return (
    <div ref={rootRef} className={`pc-root${fullscreen ? " pc-fullscreen" : ""}`}>
      <div className="dm-tfs pc-head">
        {timeframes.map((x) => (
          <button key={x} className={tf === x ? "on" : ""} onClick={() => onTfChange(x)}>{x}</button>
        ))}
        {note}
        <div className="pc-actions">
          {feat.indicators ? (
            <button
              className={`pc-btn${openMenu === "indicators" ? " on" : ""}${instances.length ? " has" : ""}`}
              title="Indicators"
              data-pc-trigger=""
              onClick={() => setOpenMenu(openMenu === "indicators" ? null : "indicators")}
            >
              <ChartLine size={14} /> Indicators{instances.length ? ` · ${instances.length}` : ""}
            </button>
          ) : null}
          {feat.settings ? (
            <button
              className={`pc-btn${openMenu === "settings" ? " on" : ""}`}
              title="Chart settings"
              data-pc-trigger=""
              onClick={() => setOpenMenu(openMenu === "settings" ? null : "settings")}
            >
              <GearSix size={14} />
            </button>
          ) : null}
          {feat.fullscreen ? (
            <button className="pc-btn" title={fullscreen ? "Exit fullscreen (Esc)" : "Fullscreen"} onClick={() => setFullscreen(!fullscreen)}>
              {fullscreen ? <ArrowsIn size={14} /> : <ArrowsOut size={14} />}
            </button>
          ) : null}
        </div>
      </div>
      <div className="pc-stage">
        {feat.drawings ? (
          <DrawingToolbar
            activeTool={activeTool}
            onTool={setActiveTool}
            positionSide={positionSide}
            onPositionSide={setPositionSide}
            magnet={magnet}
            onMagnet={setMagnet}
            visible={drawVisible}
            onVisible={setDrawVisible}
            onClearAll={() => layerRef.current?.clearAll()}
          />
        ) : null}
        <div ref={chartElRef} className={chartClassName ?? "dm-chart"} />
        {feat.indicators ? (
          <IndicatorLegend
            rows={legendRows}
            onToggle={(id) => onInstancesChange(instances.map((i) => (i.id === id ? { ...i, visible: !i.visible } : i)))}
            onRemove={(id) => onInstancesChange(instances.filter((i) => i.id !== id))}
          />
        ) : null}
        {feat.indicators ? (
          <IndicatorsMenu
            open={openMenu === "indicators"}
            onClose={() => setOpenMenu(null)}
            instances={instances}
            onChange={onInstancesChange}
            hasVolume={volumeOk}
          />
        ) : null}
        {feat.settings ? (
          <ChartSettingsPopover
            open={openMenu === "settings"}
            onClose={() => setOpenMenu(null)}
            settings={settings}
            onChange={onSettingsChange}
          />
        ) : null}
        {textEdit ? (
          <TextEditOverlay
            at={textEdit.at}
            initial=""
            onCommit={(text) => { layerRef.current?.setText(textEdit.id, text); setTextEdit(null); }}
            onCancel={() => { layerRef.current?.setText(textEdit.id, ""); setTextEdit(null); }}
          />
        ) : null}
      </div>
    </div>
  );
});

/** Resolve the effective --accent hex from CSS vars (per-page accent overrides honored). */
function useAccentHex(rootRef: React.RefObject<HTMLDivElement | null>, theme: ChartTheme): string {
  const [hex, setHex] = useState("#ff5a1f");
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const v = getComputedStyle(el).getPropertyValue("--accent").trim();
    if (v) setHex(v);
  }, [rootRef, theme]);
  return hex;
}
