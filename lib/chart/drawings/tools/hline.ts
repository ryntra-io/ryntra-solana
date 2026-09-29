/* Horizontal line: single anchor, spans the full pane width at its price.
   points = [{time: refTime, price}] — the stored time is only a reference so
   the anchor survives TF/scope changes; drags never move it. */

import type { ToolImpl } from "../types";
import { drawLabelBitmap, fmtPrice, lineWidthOf, resolveColor, strokeLineBitmap } from "./shared";

export const hlineTool: ToolImpl = {
  pointCount: 1,

  project(d, mapper) {
    const p = d.points[0];
    if (!p) return null;
    const pt = mapper.toXY(p);
    if (!pt) return null;
    return [{ x: 0, y: pt.y }];
  },

  anchors(_d, state) {
    const p = state.pts[0];
    if (!p) return [];
    return [{ x: 60, y: p.y }];
  },

  hitTestBody(_d, state, _x, y, tol) {
    const p = state.pts[0];
    if (!p) return false;
    return Math.abs(y - p.y) <= tol;
  },

  applyAnchorDrag(d, _index, p) {
    const p0 = d.points[0];
    if (!p0) return d;
    // price only — keep the stored reference time
    return { ...d, points: [{ time: p0.time, price: p.price }] };
  },

  applyBodyDrag(d, _dTime, dPrice) {
    return { ...d, points: d.points.map((p) => ({ time: p.time, price: p.price + dPrice })) };
  },

  draw(scope, d, state, palette) {
    const p = state.pts[0];
    const p0 = d.points[0];
    if (!p || !p0) return;
    const w = scope.bitmapSize.width / scope.horizontalPixelRatio;
    strokeLineBitmap(scope, 0, p.y, w, p.y, resolveColor(d, palette), lineWidthOf(d), d);
    const label = state.labels[0] ?? fmtPrice(p0.price);
    drawLabelBitmap(scope, label, w - 6, p.y, palette, { align: "right", bg: true });
  },

  computeLabels(d) {
    const p0 = d.points[0];
    return p0 ? [fmtPrice(p0.price)] : [];
  },
};
