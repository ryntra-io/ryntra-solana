/* Text note: single anchor + props.text, rendered as a background chip. */

import type { StoredDrawing, TextProps, ToolImpl } from "../types";
import { drawLabelBitmap, shiftPoints } from "./shared";

const FONT_SIZE = 11;
/** Approximate glyph advance in media px for hit-testing (no ctx available there). */
const APPROX_CHAR_W = 7;
const BOX_HALF_H = 8;

function textOf(d: StoredDrawing): string {
  const props = d.props as TextProps | undefined;
  return props && typeof props.text === "string" ? props.text : "";
}

export const textTool: ToolImpl = {
  pointCount: 1,

  project(d, mapper) {
    const p = d.points[0];
    if (!p) return null;
    const pt = mapper.toXY(p);
    if (!pt) return null;
    return [pt];
  },

  anchors(_d, state) {
    return state.pts;
  },

  hitTestBody(d, state, x, y, tol) {
    const p = state.pts[0];
    if (!p) return false;
    const w = APPROX_CHAR_W * textOf(d).length;
    return (
      x >= p.x - tol && x <= p.x + w + tol && y >= p.y - BOX_HALF_H - tol && y <= p.y + BOX_HALF_H + tol
    );
  },

  applyAnchorDrag(d, _index, p) {
    return { ...d, points: [p] };
  },

  applyBodyDrag: shiftPoints,

  draw(scope, d, state, palette, selected) {
    const p = state.pts[0];
    if (!p) return;
    const text = state.labels[0] ?? textOf(d);
    if (!text) return;
    drawLabelBitmap(scope, text, p.x, p.y, palette, {
      align: "left",
      bg: true,
      fontSize: FONT_SIZE,
    });
    if (selected) {
      const ctx = scope.context;
      const hpr = scope.horizontalPixelRatio;
      const vpr = scope.verticalPixelRatio;
      const w = APPROX_CHAR_W * text.length;
      ctx.save();
      ctx.strokeStyle = palette.accent;
      ctx.lineWidth = 1;
      ctx.setLineDash([3 * hpr, 3 * hpr]);
      ctx.strokeRect(
        Math.round((p.x - 5) * hpr) + 0.5,
        Math.round((p.y - BOX_HALF_H - 3) * vpr) + 0.5,
        Math.round((w + 10) * hpr),
        Math.round((BOX_HALF_H * 2 + 6) * vpr),
      );
      ctx.restore();
    }
  },

  computeLabels(d) {
    return [textOf(d)];
  },
};
