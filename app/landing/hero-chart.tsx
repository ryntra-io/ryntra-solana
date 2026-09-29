"use client";

import { useEffect, useRef } from "react";
import type { IChartApi, ISeriesApi, UTCTimestamp } from "lightweight-charts";
import type { HeroPoint } from "./live-market";

type Mounted = { chart: IChartApi; series: ISeriesApi<"Area"> };

function applyPoints(mounted: Mounted, points: readonly HeroPoint[]) {
  mounted.series.setData(points.map((point) => ({ time: point.time as UTCTimestamp, value: point.value })));
  mounted.chart.timeScale().fitContent();
}

/**
 * The hero's base plane: the real Arcus spot market for the token you can swap
 * today, drawn with the terminal's own engine (lightweight-charts) so the
 * landing shows the product rather than a picture of it.
 *
 * The library is imported lazily — a marketing page must not pay for the chart
 * bundle before hydration — and every interaction handler is off: this is a
 * display surface, so page scrolling over it must never be captured.
 */
export function HeroChart({ points, accent = "#ff5a1f" }: { points: readonly HeroPoint[]; accent?: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef<Mounted | null>(null);
  const pendingRef = useRef<readonly HeroPoint[]>(points);

  pendingRef.current = points;

  useEffect(() => {
    let disposed = false;
    let dispose = () => {};

    void (async () => {
      const host = hostRef.current;
      if (!host) return;
      try {
        const { AreaSeries, createChart } = await import("lightweight-charts");
        if (disposed || !hostRef.current) return;

        const chart = createChart(hostRef.current, {
          autoSize: true,
          // Lightweight Charts requires visible TradingView attribution on every public surface.
          layout: { background: { color: "transparent" }, textColor: "#64748b", fontSize: 10, attributionLogo: true },
          grid: { vertLines: { visible: false }, horzLines: { color: "rgba(148,163,184,0.06)" } },
          // No axes: the header already carries the price, and a hero must not
          // clip axis labels against its own rounded frame.
          timeScale: { visible: false },
          rightPriceScale: { visible: false, scaleMargins: { top: 0.14, bottom: 0.06 } },
          crosshair: { mode: 0, vertLine: { visible: false }, horzLine: { visible: false } },
          handleScroll: false,
          handleScale: false,
        });

        const series = chart.addSeries(AreaSeries, {
          lineColor: accent,
          lineWidth: 2,
          topColor: "rgba(255, 90, 31, 0.26)",
          bottomColor: "rgba(255, 90, 31, 0)",
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });

        const mounted: Mounted = { chart, series };
        mountedRef.current = mounted;
        applyPoints(mounted, pendingRef.current);

        dispose = () => {
          mountedRef.current = null;
          chart.remove();
        };
      } catch {
        // A missing chart never breaks the page: the card keeps its framing and copy.
      }
    })();

    return () => {
      disposed = true;
      dispose();
    };
  }, [accent]);

  useEffect(() => {
    const mounted = mountedRef.current;
    if (mounted) applyPoints(mounted, points);
  }, [points]);

  return <div className="lp3-chart-canvas" ref={hostRef} aria-hidden />;
}
