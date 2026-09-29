/* Rectangle: two opposite corners in data space; corner order is normalized
   at draw/hit time so either drag direction works. */

import type { ToolImpl } from "../types";
import {
  fillRectBitmap,
  lineWidthOf,
  projectTwoPoints,
  resolveColor,
  setDash,
  shiftPoints,
  withAlpha,
} from "./shared";

export const rectTool: ToolImpl = {
  pointCount: 2,

  project: projectTwoPoints,

  anchors(_d, state) {
    const a = state.pts[0];
    const b = state.pts[1];
    if (!a || !b) return [];
    // 0: points[0] · 1: points[1] · 2: (x1, y2) · 3: (x2, y1)
    return [a, b, { x: a.x, y: b.y }, { x: b.x, y: a.y }];
  },

  hitTestBody(_d, state, x, y, tol) {
    const a = state.pts[0];
    const b = state.pts[1];
    if (!a || !b) return false;
    const x1 = Math.min(a.x, b.x);
    const x2 = Math.max(a.x, b.x);
    const y1 = Math.min(a.y, b.y);
    const y2 = Math.max(a.y, b.y);
    // inside or near the border — the tol-expanded rect covers both
    return x >= x1 - tol && x <= x2 + tol && y >= y1 - tol && y <= y2 + tol;
  },

  applyAnchorDrag(d, index, p) {
    const p1 = d.points[0];
    const p2 = d.points[1];
    if (!p1 || !p2) return d;
    switch (index) {
      case 0:
        return { ...d, points: [p, p2] };
      case 1:
        return { ...d, points: [p1, p] };
      case 2:
        // corner (x1, y2) = {time: points[0].time, price: points[1].price}
        return {
          ...d,
          points: [
            { time: p.time, price: p1.price },
            { time: p2.time, price: p.price },
          ],
        };
      case 3:
        // corner (x2, y1) = {time: points[1].time, price: points[0].price}
        return {
          ...d,
          points: [
            { time: p1.time, price: p.price },
            { time: p.time, price: p2.price },
          ],
        };
      default:
        return d;
    }
  },

  applyBodyDrag: shiftPoints,

  draw(scope, d, state, palette) {
    const a = state.pts[0];
    const b = state.pts[1];
    if (!a || !b) return;
    const color = resolveColor(d, palette);
    fillRectBitmap(scope, a.x, a.y, b.x, b.y, withAlpha(color, d.style.opacity ?? 0.12));
    // crisp border
    const ctx = scope.context;
    const hpr = scope.horizontalPixelRatio;
    const vpr = scope.verticalPixelRatio;
    const bw = Math.max(1, Math.round(lineWidthOf(d) * hpr));
    const half = bw % 2 ? 0.5 : 0;
    const bx1 = Math.round(Math.min(a.x, b.x) * hpr) + half;
    const by1 = Math.round(Math.min(a.y, b.y) * vpr) + half;
    const bx2 = Math.round(Math.max(a.x, b.x) * hpr) + half;
    const by2 = Math.round(Math.max(a.y, b.y) * vpr) + half;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = bw;
    setDash(ctx, d, hpr);
    ctx.strokeRect(bx1, by1, bx2 - bx1, by2 - by1);
    ctx.restore();
  },
};
