/**
 * The chance of a side over time, from the bars the engine reads (`/api/predictions/outcomes/<id>/chart`): one range
 * per pill — a day, a week, a month, everything — the line itself and the change it shows. Every point is a venue's
 * close; a range the venue has no history for says so instead of drawing a flat line.
 */

export type Range = '1D' | '1W' | '1M' | 'ALL';
export const RANGES: readonly Range[] = ['1D', '1W', '1M', 'ALL'];

export type Ask = Readonly<{ resolution: '5m' | '1h' | '1d'; countBack: number }>;

/**
 * What each pill asks the engine for: a bar size it serves and how many bars back — and, where a venue keeps no bars
 * of that size for the market, the next size that still covers the range (a day of hours, a week of days). Every
 * point drawn is still a close the venue priced.
 */
export const RANGE_ASKS: Readonly<Record<Range, readonly Ask[]>> = {
  '1D': [
    { resolution: '5m', countBack: 288 },
    { resolution: '1h', countBack: 24 },
  ],
  '1W': [
    { resolution: '1h', countBack: 168 },
    { resolution: '1d', countBack: 7 },
  ],
  '1M': [
    { resolution: '1d', countBack: 31 },
    { resolution: '1h', countBack: 500 },
  ],
  ALL: [
    { resolution: '1d', countBack: 365 },
    { resolution: '1h', countBack: 500 },
  ],
};

/** The first ask of each pill. */
export const RANGE_ASK: Readonly<Record<Range, Ask>> = {
  '1D': RANGE_ASKS['1D'][0]!,
  '1W': RANGE_ASKS['1W'][0]!,
  '1M': RANGE_ASKS['1M'][0]!,
  ALL: RANGE_ASKS.ALL[0]!,
};

/** How far back each pill reaches, ms; null for everything. */
export const RANGE_SPAN: Readonly<Record<Range, number | null>> = { '1D': 86_400_000, '1W': 7 * 86_400_000, '1M': 31 * 86_400_000, ALL: null };

/**
 * The places a side's history is asked for, in order: each bar size of the pill on the market's own outcome, then on
 * the same outcome at the other venues the engine matched. The first that answers two points or more is drawn.
 */
export function chartPlan(outcomeId: string, matched: readonly string[], range: Range): readonly Readonly<{ outcomeId: string; ask: Ask }>[] {
  const ids = [outcomeId, ...matched.filter((id) => id !== outcomeId)];
  return ids.flatMap((id) => RANGE_ASKS[range].map((ask) => ({ outcomeId: id, ask })));
}

/** The points of a range only: a coarser size may reach further back than the pill asks. */
export function within(points: readonly Point[], range: Range, nowMs: number = Date.now()): readonly Point[] {
  const span = RANGE_SPAN[range];
  if (span === null) return points;
  return points.filter((p) => p.t >= nowMs - span);
}

/** One point of the line: when (ms) and the side's chance, 0–1. */
export type Point = Readonly<{ t: number; p: number }>;

/** The bars as points: in time order, one per bar, the closes the venue priced. */
export function pointsOf(json: unknown): Point[] | null {
  const chart = (json as { chart?: unknown } | null)?.chart as { bars?: unknown } | undefined;
  if (!chart || !Array.isArray(chart.bars)) return null;
  const byTime = new Map<number, number>();
  for (const b of chart.bars as { t?: unknown; c?: unknown }[]) {
    if (!b || typeof b.t !== 'number' || !Number.isFinite(b.t) || typeof b.c !== 'number' || !Number.isFinite(b.c)) continue;
    // A venue may price in cents or in dollars of a share; both are read as a chance.
    const p = b.c > 1 && b.c <= 100 ? b.c / 100 : b.c;
    if (p < 0 || p > 1) continue;
    byTime.set(b.t, p);
  }
  return [...byTime.entries()].sort((a, b) => a[0] - b[0]).map(([t, p]) => ({ t, p }));
}

/** The change of the chance over the last `hours`, in percentage points; null when the history does not reach back that far. */
export function changeOver(points: readonly Point[], hours: number, nowMs: number = Date.now()): number | null {
  if (points.length < 2) return null;
  const target = nowMs - hours * 3_600_000;
  let earlier: Point | null = null;
  for (const point of points) {
    if (point.t <= target) earlier = point;
    else break;
  }
  if (!earlier) earlier = points[0]!.t <= target + hours * 3_600_000 * 0.1 ? points[0]! : null;
  if (!earlier) return null;
  return Math.round((points[points.length - 1]!.p - earlier.p) * 1000) / 10;
}

/** The change a line shows from its first point to its last, in percentage points. */
export function changeAcross(points: readonly Point[]): number | null {
  if (points.length < 2) return null;
  return Math.round((points[points.length - 1]!.p - points[0]!.p) * 1000) / 10;
}

export type Frame = Readonly<{
  /** The chance at the bottom and the top of the frame, in whole tens of percent. */
  low: number;
  high: number;
  /** The gridlines' chances, low to high. */
  ticks: readonly number[];
}>;

/** The frame a line is drawn in: whole tens of percent around it, a band of at least 20 points. */
export function frameOf(points: readonly Point[]): Frame {
  if (!points.length) return { low: 0, high: 1, ticks: [0, 0.25, 0.5, 0.75, 1] };
  let lo = Math.min(...points.map((p) => p.p));
  let hi = Math.max(...points.map((p) => p.p));
  lo = Math.max(0, Math.floor(lo * 10 - 0.5) / 10);
  hi = Math.min(1, Math.ceil(hi * 10 + 0.5) / 10);
  const narrow = () => hi - lo < 0.2 - 1e-9;
  while (narrow()) {
    if (hi < 1) hi = Math.min(1, hi + 0.1);
    if (narrow() && lo > 0) lo = Math.max(0, lo - 0.1);
  }
  const step = hi - lo > 0.6 ? 0.2 : 0.1;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + 1e-9; v += step) ticks.push(Math.round(v * 100) / 100);
  return { low: Math.round(lo * 100) / 100, high: Math.round(hi * 100) / 100, ticks };
}

/** The line and the area under it as SVG paths in a `width` × `height` box. */
export function pathsOf(points: readonly Point[], frame: Frame, width: number, height: number): Readonly<{ line: string; area: string; end: Readonly<{ x: number; y: number }> | null }> {
  if (points.length < 2) return { line: '', area: '', end: null };
  const t0 = points[0]!.t;
  const t1 = points[points.length - 1]!.t;
  const span = Math.max(1, t1 - t0);
  const band = Math.max(1e-6, frame.high - frame.low);
  const xy = (pt: Point) => [((pt.t - t0) / span) * width, height - ((pt.p - frame.low) / band) * height] as const;
  const coords = points.map(xy);
  const line = coords.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('');
  const area = `${line}L${width.toFixed(1)} ${height}L0 ${height}Z`;
  const [ex, ey] = coords[coords.length - 1]!;
  return { line, area, end: { x: ex, y: ey } };
}

/** The time labels under a range: five, evenly spaced, as a person reads that range. */
export function timeLabels(points: readonly Point[], range: Range, count = 5): readonly string[] {
  if (points.length < 2) return [];
  const t0 = points[0]!.t;
  const t1 = points[points.length - 1]!.t;
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const at = new Date(t0 + ((t1 - t0) * i) / (count - 1));
    out.push(
      range === '1D'
        ? at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
        : range === 'ALL'
          ? at.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
          : at.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    );
  }
  return out;
}

/** The point a finger or a pointer at `k` (0–1 across the plot) stands on: the nearest in time, as the line is drawn. */
export function nearestAt(points: readonly Point[], k: number): number {
  if (points.length < 2) return points.length - 1;
  const t0 = points[0]!.t;
  const t = t0 + Math.min(1, Math.max(0, k)) * (points[points.length - 1]!.t - t0);
  let lo = 0;
  let hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid]!.t <= t) lo = mid;
    else hi = mid;
  }
  return t - points[lo]!.t <= points[hi]!.t - t ? lo : hi;
}

/** Where a point sits across the plot, 0–1, by its time — the same place the line passes. */
export function xAt(points: readonly Point[], i: number): number {
  if (points.length < 2 || i < 0) return 1;
  const t0 = points[0]!.t;
  return (points[i]!.t - t0) / Math.max(1, points[points.length - 1]!.t - t0);
}

/** A point's moment as the tip under a finger says it: the time on a day, the date beyond. */
export function momentOf(t: number, range: Range): string {
  const at = new Date(t);
  return range === '1D' ? at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : at.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(range === 'ALL' ? { year: '2-digit' } : {}) });
}
