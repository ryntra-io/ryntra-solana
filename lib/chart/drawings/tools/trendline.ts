/* Trend line: segment between two data-space anchors. */

import type { ToolImpl } from "../types";
import {
  distToSegmentSq,
  lineWidthOf,
  projectTwoPoints,
  replacePointAt,
  resolveColor,
  shiftPoints,
  strokeLineBitmap,
} from "./shared";

export const trendlineTool: ToolImpl = {
  pointCount: 2,

  project: projectTwoPoints,

  anchors(_d, state) {
    return state.pts;
  },

  hitTestBody(_d, state, x, y, tol) {
    const a = state.pts[0];
    const b = state.pts[1];
    if (!a || !b) return false;
    return distToSegmentSq(x, y, a.x, a.y, b.x, b.y) <= tol * tol;
  },

  applyAnchorDrag: replacePointAt,

  applyBodyDrag: shiftPoints,

  draw(scope, d, state, palette) {
    const a = state.pts[0];
    const b = state.pts[1];
    if (!a || !b) return;
    strokeLineBitmap(scope, a.x, a.y, b.x, b.y, resolveColor(d, palette), lineWidthOf(d), d);
  },
};
