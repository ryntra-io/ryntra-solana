/* Ruler: ephemeral measurement between two points — translucent range box,
   diagonal arrow, and a Δprice/%/bars/duration readout. Never persisted, but
   still a full ToolImpl so the overlay renders it like any drawing. */

import type { ToolImpl } from "../types";
import {
  drawLabelBitmap,
  fmtPrice,
  projectTwoPoints,
  replacePointAt,
  shiftPoints,
  strokeLineBitmap,
  withAlpha,
} from "./shared";

/** Human duration from seconds: "3h 20m", "2d 4h", "45m", "30s". */
function fmtDuration(totalSec: number): string {
  const s = Math.round(Math.abs(totalSec));
  if (s >= 86400) {
    const days = Math.floor(s / 86400);
    const hours = Math.floor((s % 86400) / 3600);
    return days + "d " + hours + "h";
  }
  if (s >= 3600) {
    const hours = Math.floor(s / 3600);
    const mins = Math.floor((s % 3600) / 60);
    return hours + "h " + mins + "m";
  }
  if (s >= 60) return Math.floor(s / 60) + "m";
  return s + "s";
}

export const rulerTool: ToolImpl = {
  pointCount: 2,

  project: projectTwoPoints,

  anchors(_d, state) {
    return state.pts;
  },

  hitTestBody(_d, state, x, y, tol) {
    const a = state.pts[0];
    const b = state.pts[1];
    if (!a || !b) return false;
    return (
      x >= Math.min(a.x, b.x) - tol &&
      x <= Math.max(a.x, b.x) + tol &&
      y >= Math.min(a.y, b.y) - tol &&
      y <= Math.max(a.y, b.y) + tol
    );
  },

  applyAnchorDrag: replacePointAt,

  applyBodyDrag: shiftPoints,

  draw(scope, d, state, palette) {
    const a = state.pts[0];
    const b = state.pts[1];
    const p1 = d.points[0];
    const p2 = d.points[1];
    if (!a || !b || !p1 || !p2) return;
    const ctx = scope.context;
    const hpr = scope.horizontalPixelRatio;
    const vpr = scope.verticalPixelRatio;
    const x1 = Math.min(a.x, b.x);
    const x2 = Math.max(a.x, b.x);
    const y1 = Math.min(a.y, b.y);
    const y2 = Math.max(a.y, b.y);

    // translucent range box + border
    ctx.save();
    ctx.fillStyle = withAlpha(palette.accent, 0.08);
    ctx.fillRect(
      Math.round(x1 * hpr),
      Math.round(y1 * vpr),
      Math.round((x2 - x1) * hpr),
      Math.round((y2 - y1) * vpr),
    );
    ctx.strokeStyle = withAlpha(palette.accent, 0.5);
    ctx.lineWidth = 1;
    ctx.strokeRect(
      Math.round(x1 * hpr) + 0.5,
      Math.round(y1 * vpr) + 0.5,
      Math.round((x2 - x1) * hpr),
      Math.round((y2 - y1) * vpr),
    );
    ctx.restore();

    // diagonal arrow p1 → p2
    strokeLineBitmap(scope, a.x, a.y, b.x, b.y, palette.accent, 1);
    const ddx = b.x - a.x;
    const ddy = b.y - a.y;
    const len = Math.sqrt(ddx * ddx + ddy * ddy);
    if (len > 8) {
      const ux = ddx / len;
      const uy = ddy / len;
      const headLen = 7;
      const spread = 0.45;
      ctx.save();
      ctx.strokeStyle = palette.accent;
      ctx.lineWidth = Math.max(1, Math.round(hpr));
      ctx.beginPath();
      ctx.moveTo(b.x * hpr, b.y * vpr);
      ctx.lineTo(
        (b.x - headLen * (ux * Math.cos(spread) - uy * Math.sin(spread))) * hpr,
        (b.y - headLen * (uy * Math.cos(spread) + ux * Math.sin(spread))) * vpr,
      );
      ctx.moveTo(b.x * hpr, b.y * vpr);
      ctx.lineTo(
        (b.x - headLen * (ux * Math.cos(spread) + uy * Math.sin(spread))) * hpr,
        (b.y - headLen * (uy * Math.cos(spread) - ux * Math.sin(spread))) * vpr,
      );
      ctx.stroke();
      ctx.restore();
    }

    // centered readout — line 0 colored by Δprice sign
    const cx = (x1 + x2) / 2;
    const cy = (y1 + y2) / 2;
    const valueColor = p2.price - p1.price >= 0 ? palette.success : palette.danger;
    const line0 = state.labels[0];
    const line1 = state.labels[1];
    if (line0) {
      drawLabelBitmap(scope, line0, cx, cy - 9, palette, {
        align: "center",
        bg: true,
        color: valueColor,
      });
    }
    if (line1) {
      drawLabelBitmap(scope, line1, cx, cy + 9, palette, { align: "center", bg: true });
    }
  },

  computeLabels(d, ctx) {
    const p1 = d.points[0];
    const p2 = d.points[1];
    if (!p1 || !p2) return [];
    const dPrice = p2.price - p1.price;
    const pct = p1.price !== 0 ? (dPrice / p1.price) * 100 : 0;
    const bars = ctx.barsBetween(p1.time, p2.time);
    const duration = fmtDuration(p2.time - p1.time);
    return [
      (dPrice >= 0 ? "+" : "") + fmtPrice(dPrice) + " (" + pct.toFixed(2) + "%)",
      bars + " bars · " + duration,
    ];
  },
};
