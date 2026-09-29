/* Shared drawing-tool helpers. All coordinates are media-space (CSS px) unless
   a function name says Bitmap — those convert via scope pixel ratios internally.
   Pure TS + canvas; no React, no imports outside ../types and ../../format. */

import { withAlpha } from "../../format";
import type {
  BitmapScope,
  DrawingPoint,
  ICoordinateMapper,
  RenderPt,
  StoredDrawing,
  ThemePalette,
} from "../types";

/* Formatting/color helpers live in lib/chart/format.ts (shared with indicators);
   re-exported here so tool imports stay unchanged. */
export { fmtPrice, withAlpha } from "../../format";

/** Squared distance from (x, y) to segment (x1, y1)-(x2, y2). Media space. */
export function distToSegmentSq(
  x: number,
  y: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  let t = 0;
  if (lenSq > 0) {
    t = ((x - x1) * dx + (y - y1) * dy) / lenSq;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
  }
  const ex = x - (x1 + t * dx);
  const ey = y - (y1 + t * dy);
  return ex * ex + ey * ey;
}

/** Drawing color: explicit user color, else themed accent. */
export function resolveColor(d: StoredDrawing, palette: ThemePalette): string {
  return d.style.color ?? palette.accent;
}

/** Drawing stroke width in media px. */
export function lineWidthOf(d: StoredDrawing): number {
  return d.style.width ?? 1;
}

/** Apply the drawing's dash pattern to ctx (bitmap-space, hence hpr scaling). */
export function setDash(ctx: CanvasRenderingContext2D, d: StoredDrawing, hpr: number): void {
  const dash = d.style.dash;
  if (dash === "dashed") ctx.setLineDash([6 * hpr, 4 * hpr]);
  else if (dash === "dotted") ctx.setLineDash([2 * hpr, 3 * hpr]);
  else ctx.setLineDash([]);
}

/** Stroke a media-space line onto the bitmap-space canvas. Crisp rounding for
    axis-aligned lines. Applies d's dash pattern when d is given. Save/restore
    always — dash state leaks otherwise. */
export function strokeLineBitmap(
  scope: BitmapScope,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string,
  width: number,
  d?: StoredDrawing,
): void {
  const ctx = scope.context;
  const hpr = scope.horizontalPixelRatio;
  const vpr = scope.verticalPixelRatio;
  const bitmapWidth = Math.max(1, Math.round(width * hpr));
  const half = bitmapWidth % 2 ? 0.5 : 0;
  let bx1 = x1 * hpr;
  let by1 = y1 * vpr;
  let bx2 = x2 * hpr;
  let by2 = y2 * vpr;
  if (x1 === x2) {
    const bx = Math.round(bx1) + half;
    bx1 = bx;
    bx2 = bx;
  }
  if (y1 === y2) {
    const by = Math.round(by1) + half;
    by1 = by;
    by2 = by;
  }
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = bitmapWidth;
  if (d) setDash(ctx, d, hpr);
  ctx.beginPath();
  ctx.moveTo(bx1, by1);
  ctx.lineTo(bx2, by2);
  ctx.stroke();
  ctx.restore();
}

/** Fill a media-space rect (any corner order) onto the bitmap-space canvas. */
export function fillRectBitmap(
  scope: BitmapScope,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  fillStyle: string,
): void {
  const ctx = scope.context;
  const hpr = scope.horizontalPixelRatio;
  const vpr = scope.verticalPixelRatio;
  const bx1 = Math.round(Math.min(x1, x2) * hpr);
  const by1 = Math.round(Math.min(y1, y2) * vpr);
  const bx2 = Math.round(Math.max(x1, x2) * hpr);
  const by2 = Math.round(Math.max(y1, y2) * vpr);
  ctx.save();
  ctx.fillStyle = fillStyle;
  ctx.fillRect(bx1, by1, bx2 - bx1, by2 - by1);
  ctx.restore();
}

/** Rounded-rect path in bitmap coords (manual arcTo — no reliance on ctx.roundRect). */
function roundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Draw a small text label at a media-space point (vertically centered on yMedia).
    Optional rounded background chip (panel @ 0.85, 1px border, 3px radius, 4px x-pad). */
export function drawLabelBitmap(
  scope: BitmapScope,
  text: string,
  xMedia: number,
  yMedia: number,
  palette: ThemePalette,
  opts?: {
    align?: "left" | "center" | "right";
    bg?: boolean;
    /** override text fill (default palette.text) */
    color?: string;
    /** media px; default 10 */
    fontSize?: number;
  },
): void {
  if (!text) return;
  const ctx = scope.context;
  const hpr = scope.horizontalPixelRatio;
  const vpr = scope.verticalPixelRatio;
  const fontSize = opts?.fontSize ?? 10;
  ctx.save();
  ctx.font = fontSize * vpr + "px -apple-system, ui-sans-serif, sans-serif";
  ctx.textBaseline = "middle";
  const textW = ctx.measureText(text).width;
  const bx = xMedia * hpr;
  const by = yMedia * vpr;
  const align = opts?.align ?? "left";
  const left = align === "left" ? bx : align === "center" ? bx - textW / 2 : bx - textW;
  if (opts?.bg) {
    const padX = 4 * hpr;
    const boxH = (fontSize + 6) * vpr;
    roundedRectPath(ctx, left - padX, by - boxH / 2, textW + padX * 2, boxH, 3 * hpr);
    ctx.fillStyle = withAlpha(palette.panel, 0.85);
    ctx.fill();
    ctx.strokeStyle = palette.border;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.fillStyle = opts?.color ?? palette.text;
  ctx.fillText(text, left, by);
  ctx.restore();
}

/** Default applyBodyDrag: shift every point by the data-space delta. */
export function shiftPoints(d: StoredDrawing, dTime: number, dPrice: number): StoredDrawing {
  return {
    ...d,
    points: d.points.map((p) => ({ time: p.time + dTime, price: p.price + dPrice })),
  };
}

/** Default project() for two-anchor tools: map points[0]/points[1] to media
    space; null when either anchor is missing or the scale isn't ready. */
export function projectTwoPoints(d: StoredDrawing, mapper: ICoordinateMapper): RenderPt[] | null {
  const p1 = d.points[0];
  const p2 = d.points[1];
  if (!p1 || !p2) return null;
  const a = mapper.toXY(p1);
  if (!a) return null;
  const b = mapper.toXY(p2);
  if (!b) return null;
  return [a, b];
}

/** Default applyAnchorDrag: replace points[index] immutably (out-of-range index
    leaves the points untouched). */
export function replacePointAt(d: StoredDrawing, index: number, p: DrawingPoint): StoredDrawing {
  const points = d.points.slice();
  if (index >= 0 && index < points.length) points[index] = p;
  return { ...d, points };
}
