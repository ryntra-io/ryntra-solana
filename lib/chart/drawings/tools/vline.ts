/* Vertical line: single anchor, spans the full pane height at its time.
   points = [{time, price: 0}] — price is a placeholder; drags never move it. */

import type { ToolImpl } from "../types";
import { drawLabelBitmap, lineWidthOf, resolveColor, strokeLineBitmap } from "./shared";

/** UTC "MM-DD HH:mm" from epoch seconds. */
function fmtTimeUTC(epochSec: number): string {
  const dt = new Date(epochSec * 1000);
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  const hh = String(dt.getUTCHours()).padStart(2, "0");
  const mi = String(dt.getUTCMinutes()).padStart(2, "0");
  return mm + "-" + dd + " " + hh + ":" + mi;
}

export const vlineTool: ToolImpl = {
  pointCount: 1,

  project(d, mapper) {
    const p = d.points[0];
    if (!p) return null;
    const pt = mapper.toXY(p);
    if (!pt) return null;
    return [{ x: pt.x, y: 0 }];
  },

  anchors(_d, state) {
    const p = state.pts[0];
    if (!p) return [];
    return [{ x: p.x, y: 60 }];
  },

  hitTestBody(_d, state, x, _y, tol) {
    const p = state.pts[0];
    if (!p) return false;
    return Math.abs(x - p.x) <= tol;
  },

  applyAnchorDrag(d, _index, p) {
    const p0 = d.points[0];
    if (!p0) return d;
    // time only — keep the stored placeholder price
    return { ...d, points: [{ time: p.time, price: p0.price }] };
  },

  applyBodyDrag(d, dTime, _dPrice) {
    return { ...d, points: d.points.map((p) => ({ time: p.time + dTime, price: p.price })) };
  },

  draw(scope, d, state, palette) {
    const p = state.pts[0];
    const p0 = d.points[0];
    if (!p || !p0) return;
    const h = scope.bitmapSize.height / scope.verticalPixelRatio;
    strokeLineBitmap(scope, p.x, 0, p.x, h, resolveColor(d, palette), lineWidthOf(d), d);
    const label = state.labels[0] ?? fmtTimeUTC(p0.time);
    drawLabelBitmap(scope, label, p.x, h - 12, palette, { align: "center", bg: true });
  },

  computeLabels(d) {
    const p0 = d.points[0];
    return p0 ? [fmtTimeUTC(p0.time)] : [];
  },
};
