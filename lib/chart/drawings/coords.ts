/* Data <-> pixel mapping for drawings. Extrapolates logically beyond loaded bars
   (timeToIndex(findNearest) + tfSeconds) so anchors stay valid off-data. */

import { MismatchDirection } from "lightweight-charts";
import type {
  IChartApi,
  ISeriesApi,
  Logical,
  SeriesType,
  UTCTimestamp,
} from "lightweight-charts";
import type { DrawingPoint, ICoordinateMapper, RenderPt } from "./types";

const OHLC_KEYS = ["open", "high", "low", "close"] as const;

function numTime(bar: { time: unknown } | null | undefined): number | null {
  if (bar === null || bar === undefined) return null;
  const t = bar.time;
  return typeof t === "number" ? t : null;
}

export class CoordinateMapper implements ICoordinateMapper {
  private readonly chart: IChartApi;
  private readonly series: ISeriesApi<SeriesType>;
  private tfSeconds: number;

  constructor(
    chart: IChartApi,
    series: ISeriesApi<"Candlestick"> | ISeriesApi<SeriesType>,
    tfSeconds: number,
  ) {
    this.chart = chart;
    this.series = series as ISeriesApi<SeriesType>;
    this.tfSeconds = tfSeconds > 0 ? tfSeconds : 60;
  }

  toXY(p: DrawingPoint): RenderPt | null {
    const data = this.series.data();
    const len = data.length;
    if (len === 0) return null;
    const y = this.series.priceToCoordinate(p.price);
    if (y === null) return null;
    const firstTime = numTime(data[0]);
    const lastTime = numTime(data[len - 1]);
    if (firstTime === null || lastTime === null) return null;
    const logical = this.timeToLogical(p.time, firstTime, lastTime, len);
    if (logical === null) return null;
    const x = this.chart.timeScale().logicalToCoordinate(logical as Logical);
    if (x === null) return null;
    return { x, y };
  }

  toTimePrice(x: number, y: number): DrawingPoint | null {
    const price = this.series.coordinateToPrice(y);
    if (price === null) return null;
    const ts = this.chart.timeScale();
    const logical = ts.coordinateToLogical(x);
    if (logical === null) return null;
    const data = this.series.data();
    const len = data.length;
    if (len === 0) return null;
    const firstTime = numTime(data[0]);
    const lastTime = numTime(data[len - 1]);
    if (firstTime === null || lastTime === null) return null;
    const firstIdx = ts.timeToIndex(firstTime as UTCTimestamp, true) ?? 0;
    const lastIdx = ts.timeToIndex(lastTime as UTCTimestamp, true) ?? len - 1;

    let time: number;
    if (logical > lastIdx) {
      time = lastTime + (logical - lastIdx) * this.tfSeconds;
    } else if (logical < firstIdx) {
      time = firstTime - (firstIdx - logical) * this.tfSeconds;
    } else {
      const rounded = Math.round(logical);
      const t = numTime(this.series.dataByIndex(rounded, MismatchDirection.NearestLeft));
      time =
        t !== null
          ? t + (logical - rounded) * this.tfSeconds
          : firstTime + (logical - firstIdx) * this.tfSeconds;
    }
    return { time: Math.round(time), price };
  }

  snap(x: number, y: number, tolPx: number): DrawingPoint | null {
    const logical = this.chart.timeScale().coordinateToLogical(x);
    if (logical === null) return null;
    const bar = this.series.dataByIndex(Math.round(logical), MismatchDirection.NearestLeft);
    const t = numTime(bar);
    if (t === null) return null;
    const rec = bar as unknown as Record<string, unknown>;
    let bestPrice = 0;
    let bestDy = Number.POSITIVE_INFINITY;
    let found = false;
    for (let i = 0; i < OHLC_KEYS.length; i++) {
      const v = rec[OHLC_KEYS[i]];
      if (typeof v !== "number") continue;
      const yc = this.series.priceToCoordinate(v);
      if (yc === null) continue;
      const dy = Math.abs(yc - y);
      if (dy < bestDy) {
        bestDy = dy;
        bestPrice = v;
        found = true;
      }
    }
    if (!found || bestDy > tolPx) return null;
    return { time: t, price: bestPrice };
  }

  setTfSeconds(s: number): void {
    if (s > 0) this.tfSeconds = s;
  }

  getTfSeconds(): number {
    return this.tfSeconds;
  }

  barsBetween(t1: number, t2: number): number {
    return Math.round(Math.abs(t2 - t1) / this.tfSeconds);
  }

  paneSize(): { width: number; height: number } {
    return this.chart.paneSize();
  }

  /** Fractional logical index for an epoch time; null when the scale isn't ready. */
  private timeToLogical(
    time: number,
    firstTime: number,
    lastTime: number,
    len: number,
  ): number | null {
    const ts = this.chart.timeScale();
    if (time > lastTime) {
      const lastIdx = ts.timeToIndex(lastTime as UTCTimestamp, true);
      return (lastIdx ?? len - 1) + (time - lastTime) / this.tfSeconds;
    }
    if (time < firstTime) {
      const firstIdx = ts.timeToIndex(firstTime as UTCTimestamp, true);
      return (firstIdx ?? 0) - (firstTime - time) / this.tfSeconds;
    }
    const idx = ts.timeToIndex(time as UTCTimestamp, true);
    if (idx === null) return null;
    const t0 = numTime(this.series.dataByIndex(idx, MismatchDirection.NearestLeft));
    if (t0 === null || t0 === time) return idx;
    if (time > t0) {
      const t1 = numTime(this.series.dataByIndex(idx + 1, MismatchDirection.NearestLeft));
      if (t1 !== null && t1 > t0) return idx + (time - t0) / (t1 - t0);
      return idx + (time - t0) / this.tfSeconds;
    }
    const tm = numTime(this.series.dataByIndex(idx - 1, MismatchDirection.NearestLeft));
    if (tm !== null && tm < t0) return idx - (t0 - time) / (t0 - tm);
    return idx - (t0 - time) / this.tfSeconds;
  }
}
