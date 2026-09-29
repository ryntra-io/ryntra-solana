/* Fibonacci retracement: p1→p2 defines the 0→1 direction; horizontal level
   lines at the classic ratios with "level · price" labels. */

import type { ToolImpl } from "../types";
import {
  distToSegmentSq,
  drawLabelBitmap,
  fmtPrice,
  projectTwoPoints,
  resolveColor,
  shiftPoints,
  strokeLineBitmap,
  withAlpha,
} from "./shared";

const LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1] as const;

export const fibTool: ToolImpl = {
  pointCount: 2,

  project(d, mapper) {
    const pts = projectTwoPoints(d, mapper);
    if (pts === null) return null;
    const a = pts[0]!;
    const b = pts[1]!;
    const p1 = d.points[0]!;
    const p2 = d.points[1]!;
    const xmin = Math.min(a.x, b.x);
    const price0 = p1.price;
    const price1 = p2.price;
    for (let i = 0; i < LEVELS.length; i++) {
      const level = LEVELS[i]!;
      const levelPt = mapper.toXY({ time: p1.time, price: price0 + (price1 - price0) * level });
      // toXY should convert any price once the scale is live; if it declines
      // (e.g. far off-scale), fall back to linear interpolation between the anchors.
      const y = levelPt ? levelPt.y : a.y + (b.y - a.y) * level;
      pts.push({ x: xmin, y });
    }
    return pts;
  },

  anchors(_d, state) {
    return state.pts.slice(0, 2);
  },

  hitTestBody(_d, state, x, y, tol) {
    const a = state.pts[0];
    const b = state.pts[1];
    if (!a || !b) return false;
    const xmin = Math.min(a.x, b.x);
    const xmax = Math.max(a.x, b.x);
    if (x >= xmin - tol && x <= xmax + tol) {
      for (let i = 0; i < LEVELS.length; i++) {
        const lp = state.pts[2 + i];
        if (lp && Math.abs(y - lp.y) <= tol) return true;
      }
    }
    // the (faintly drawn) trend segment is also grabbable
    return distToSegmentSq(x, y, a.x, a.y, b.x, b.y) <= tol * tol;
  },

  applyAnchorDrag(d, index, p) {
    if (index !== 0 && index !== 1) return d;
    const points = d.points.slice();
    points[index] = p;
    return { ...d, points };
  },

  applyBodyDrag: shiftPoints,

  draw(scope, d, state, palette) {
    const a = state.pts[0];
    const b = state.pts[1];
    if (!a || !b) return;
    const color = resolveColor(d, palette);
    const lineColor = withAlpha(color, 0.9);
    const fillColor = withAlpha(color, 0.04);
    const labelColor = withAlpha(palette.text, 0.8);
    const xmin = Math.min(a.x, b.x);
    const xmax = Math.max(a.x, b.x);

    // faint fill between adjacent levels
    for (let i = 0; i < LEVELS.length - 1; i++) {
      const lp = state.pts[2 + i];
      const ln = state.pts[3 + i];
      if (!lp || !ln) continue;
      if (lp.y !== ln.y) {
        // media-space rect between the two level lines
        const ctx = scope.context;
        const hpr = scope.horizontalPixelRatio;
        const vpr = scope.verticalPixelRatio;
        ctx.save();
        ctx.fillStyle = fillColor;
        ctx.fillRect(
          Math.round(xmin * hpr),
          Math.round(Math.min(lp.y, ln.y) * vpr),
          Math.round((xmax - xmin) * hpr),
          Math.round(Math.abs(ln.y - lp.y) * vpr),
        );
        ctx.restore();
      }
    }

    // trend segment p1→p2, dashed + faint (always dashed regardless of d.style.dash)
    {
      const ctx = scope.context;
      const hpr = scope.horizontalPixelRatio;
      const vpr = scope.verticalPixelRatio;
      ctx.save();
      ctx.strokeStyle = withAlpha(color, 0.35);
      ctx.lineWidth = Math.max(1, Math.round(hpr));
      ctx.setLineDash([4 * hpr, 4 * hpr]);
      ctx.beginPath();
      ctx.moveTo(a.x * hpr, a.y * vpr);
      ctx.lineTo(b.x * hpr, b.y * vpr);
      ctx.stroke();
      ctx.restore();
    }

    // level lines + labels
    for (let i = 0; i < LEVELS.length; i++) {
      const lp = state.pts[2 + i];
      if (!lp) continue;
      strokeLineBitmap(scope, xmin, lp.y, xmax, lp.y, lineColor, 1);
      const label = state.labels[i];
      if (label) {
        drawLabelBitmap(scope, label, xmin - 6, lp.y, palette, {
          align: "right",
          bg: false,
          color: labelColor,
        });
      }
    }
  },

  computeLabels(d) {
    const p1 = d.points[0];
    const p2 = d.points[1];
    if (!p1 || !p2) return [];
    const labels: string[] = [];
    for (let i = 0; i < LEVELS.length; i++) {
      const level = LEVELS[i]!;
      labels.push(level + " · " + fmtPrice(p1.price + (p2.price - p1.price) * level));
    }
    return labels;
  },
};
