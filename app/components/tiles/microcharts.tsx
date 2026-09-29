/**
 * Ryntra Micro Charts — the dashboard-tile layer of the chart stack.
 *
 * Six shapes, plain SVG, no dependency and no client JavaScript. They render on
 * the server with the rest of the page, which is why they can sit inside a
 * server component beside the number they explain.
 *
 * **Why SVG and not a library.** The founder's condition was explicit: build on
 * Recharts if the project already has it. It does not — `recharts` is in
 * neither `dependencies` nor `devDependencies`. Six shapes in SVG add nothing
 * to install, survive the Content Security Policy, theme with the shell because
 * they take `--rt-chart-*` like everything else, and are visible to
 * `design:check` and to the rendered-surface probe. A library would be invisible
 * to both.
 *
 * **Why they are small.** A microchart is not a chart with the axes removed. It
 * answers one question at a glance and hands the detail to the page. If a shape
 * here needs a legend, a tooltip or an axis label to be read, it is the wrong
 * shape for a tile.
 *
 * Every one of them refuses to draw rather than draw a lie: an empty series
 * renders the empty state, never a flat line at zero.
 */

import type { ReactNode } from "react";

/* ------------------------------------------------------------------ shared */

const EMPTY = (
  <span className="mc-empty" role="img" aria-label="no data">
    —
  </span>
);

function path(points: readonly (readonly [number, number])[]): string {
  return points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`).join(" ");
}

/* --------------------------------------------------------------- sparkline */

export type SparklineProps = Readonly<{
  values: readonly number[];
  /** Height in px; the width is fluid and the viewBox scales. */
  height?: number;
  label: string;
  /** Fill the area under the line. Off for a pure trend, on for a volume shape. */
  area?: boolean;
}>;

/**
 * A trend, and nothing else.
 *
 * No axes, no grid, no labels — the number above the chart is the value and
 * this says which way it got there. The last point is marked because "where it
 * ends" is the one position a reader looks for.
 */
export function Sparkline({ values, height = 40, label, area = true }: SparklineProps) {
  if (values.length < 2) return EMPTY;
  const W = 200;
  const H = height;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = W / (values.length - 1);
  const points = values.map((v, i) => [i * step, H - 2 - ((v - min) / span) * (H - 4)] as const);
  const last = points[points.length - 1];

  return (
    <svg className="mc" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label}>
      {area ? (
        <path className="mc-area" d={`${path(points)} L${W} ${H} L0 ${H} Z`} vectorEffect="non-scaling-stroke" />
      ) : null}
      <path className="mc-line" d={path(points)} vectorEffect="non-scaling-stroke" />
      <circle className="mc-dot" cx={last[0]} cy={last[1]} r={2.5} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/* -------------------------------------------------------------------- bars */

export type BarsProps = Readonly<{
  values: readonly number[];
  height?: number;
  label: string;
  /** Index to mark as the one that matters. */
  accent?: number;
}>;

/** A distribution. Rounded caps, one accent, nothing else. */
export function Bars({ values, height = 40, label, accent }: BarsProps) {
  if (values.length === 0) return EMPTY;
  const W = 200;
  const H = height;
  const max = Math.max(...values, 1);
  const gap = 2;
  const w = (W - gap * (values.length - 1)) / values.length;

  return (
    <svg className="mc" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label}>
      {values.map((v, i) => {
        const h = Math.max(1.5, (v / max) * (H - 2));
        return (
          <rect
            key={i}
            className={i === accent ? "mc-bar mc-bar-accent" : "mc-bar"}
            x={i * (w + gap)}
            y={H - h}
            width={w}
            height={h}
            rx={Math.min(1.5, w / 2)}
          />
        );
      })}
    </svg>
  );
}

/* -------------------------------------------------------------------- ring */

export type RingProps = Readonly<{
  part: number;
  whole: number;
  label: string;
  size?: number;
  /** Printed in the middle. A 1.3% arc is honest and unreadable on its own. */
  caption?: string;
}>;

/**
 * One ratio, drawn.
 *
 * Built for the number this product exists to state — three executable out of
 * two hundred and thirty-one listed. A bar would make three look like nothing;
 * a ring makes the *proportion* the subject, which is the honest reading.
 */
export function Ring({ part, whole, label, size = 52, caption }: RingProps) {
  if (whole <= 0) return EMPTY;
  const r = size / 2 - 5;
  const c = 2 * Math.PI * r;
  const fraction = Math.max(0, Math.min(1, part / whole));

  /* The arc is the true fraction and nothing rounds it up. Three of two
     hundred and thirty-one *is* a sliver, and inflating it to a readable
     minimum would be the surface telling a more comfortable story than the
     number. What is added instead is the figure in the middle, so the shape
     has a subject rather than reading as a circle that failed to draw. */
  return (
    <svg className="mc-fixed" width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label}>
      <circle className="mc-track" cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={5} />
      <circle
        className="mc-value"
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        strokeWidth={5}
        strokeLinecap="butt"
        strokeDasharray={`${(c * fraction).toFixed(2)} ${c.toFixed(2)}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      {caption ? (
        <text className="mc-caption" x={size / 2} y={size / 2} textAnchor="middle" dominantBaseline="central">
          {caption}
        </text>
      ) : null}
    </svg>
  );
}

/* ------------------------------------------------------------------- gauge */

export type GaugeProps = Readonly<{ fraction: number; label: string; width?: number }>;

/** A semi-circle share. Used where a ratio is a coverage rather than a count. */
export function Gauge({ fraction, label, width = 84 }: GaugeProps) {
  const f = Math.max(0, Math.min(1, fraction));
  const W = width;
  const H = width / 2 + 6;
  const r = W / 2 - 5;
  const cx = W / 2;
  const cy = H - 4;
  const end = Math.PI * (1 - f);
  const x = cx + r * Math.cos(end);
  const y = cy - r * Math.sin(end);
  /* Always the short way. The sweep here can never exceed 180 degrees, so a
     large-arc flag of 1 sends the pen the long way round the circle — which is
     what drew a backwards "C" instead of a gauge for every fraction above a
     half, and looked like a broken component rather than a wrong number. */
  const large = 0;

  return (
    <svg className="mc-fixed" width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      <path className="mc-track" d={`M${cx - r} ${cy} A${r} ${r} 0 0 1 ${cx + r} ${cy}`} fill="none" strokeWidth={5} />
      {f > 0 ? (
        <path
          className="mc-value"
          d={`M${cx - r} ${cy} A${r} ${r} 0 ${large} 1 ${x.toFixed(2)} ${y.toFixed(2)}`}
          fill="none"
          strokeWidth={5}
          strokeLinecap="round"
        />
      ) : null}
    </svg>
  );
}

/* -------------------------------------------------------------- dot matrix */

export type DotMatrixProps = Readonly<{
  /** 0…1 per cell. */
  cells: readonly number[];
  columns?: number;
  label: string;
}>;

/** Density across a set. Each cell is one member, its opacity its magnitude. */
export function DotMatrix({ cells, columns = 24, label }: DotMatrixProps) {
  if (cells.length === 0) return EMPTY;
  const size = 6;
  const gap = 2;
  const rows = Math.ceil(cells.length / columns);
  const W = columns * (size + gap) - gap;
  const H = rows * (size + gap) - gap;

  return (
    <svg className="mc" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      {cells.map((v, i) => (
        <rect
          key={i}
          className="mc-cell"
          x={(i % columns) * (size + gap)}
          y={Math.floor(i / columns) * (size + gap)}
          width={size}
          height={size}
          rx={1.5}
          opacity={0.18 + Math.max(0, Math.min(1, v)) * 0.82}
        />
      ))}
    </svg>
  );
}

/* ------------------------------------------------------------- split meter */

export type SplitMeterProps = Readonly<{
  /**
   * `step` is a position in a monochrome ramp, not a meaning.
   *
   * The first version painted the three instrument classes series-cyan, grey
   * and **red** — and red in this design system is `blocked`. A community token
   * is not blocked; nothing about its class is a fault. Colour is only allowed
   * to carry meaning here, so a composition of named categories gets tints of
   * one hue and the legend names them.
   */
  parts: readonly Readonly<{ value: number; step: 1 | 2 | 3; name: string }>[];
  label: string;
}>;

/**
 * A composition as one bar.
 *
 * The only shape here that carries more than one colour, and it carries them
 * because the parts are named categories rather than a magnitude. A zero-width
 * part is dropped rather than drawn as a sliver nobody can hit.
 */
export function SplitMeter({ parts, label }: SplitMeterProps) {
  const total = parts.reduce((sum, p) => sum + p.value, 0);
  if (total <= 0) return EMPTY;
  let x = 0;
  const W = 200;

  return (
    <svg className="mc" viewBox={`0 0 ${W} 10`} preserveAspectRatio="none" role="img" aria-label={label}>
      {parts.map((p) => {
        const w = (p.value / total) * W;
        const rect =
          w > 0.5 ? (
            <rect key={p.name} className={`mc-split mc-step-${p.step}`} x={x} y={0} width={Math.max(3, w - 1)} height={10} rx={2} />
          ) : null;
        x += w;
        return rect;
      })}
    </svg>
  );
}

/* -------------------------------------------------------------- the legend */

export function ChartLegend({ children }: { children: ReactNode }) {
  return <p className="mc-legend">{children}</p>;
}
