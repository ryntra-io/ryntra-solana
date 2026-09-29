/* Ray: starts at p1, passes through p2, extends to the pane edge. */

import type { ToolImpl } from "../types";
import {
  lineWidthOf,
  projectTwoPoints,
  replacePointAt,
  resolveColor,
  shiftPoints,
  strokeLineBitmap,
} from "./shared";

/** Hit-test cap: how far (media px) past p1 the ray is considered to extend. */
const RAY_HIT_CAP_PX = 4000;

export const rayTool: ToolImpl = {
  pointCount: 2,

  project: projectTwoPoints,

  anchors(_d, state) {
    return state.pts;
  },

  hitTestBody(_d, state, x, y, tol) {
    const a = state.pts[0];
    const b = state.pts[1];
    if (!a || !b) return false;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) {
      const ex = x - a.x;
      const ey = y - a.y;
      return ex * ex + ey * ey <= tol * tol;
    }
    // Project onto the ray: clamp t >= 0 (one-directional), cap at a far point.
    const tCap = Math.max(RAY_HIT_CAP_PX / Math.sqrt(lenSq), 1);
    let t = ((x - a.x) * dx + (y - a.y) * dy) / lenSq;
    if (t < 0) t = 0;
    else if (t > tCap) t = tCap;
    const ex = x - (a.x + t * dx);
    const ey = y - (a.y + t * dy);
    return ex * ex + ey * ey <= tol * tol;
  },

  applyAnchorDrag: replacePointAt,

  applyBodyDrag: shiftPoints,

  draw(scope, d, state, palette) {
    const a = state.pts[0];
    const b = state.pts[1];
    if (!a || !b) return;
    const w = scope.bitmapSize.width / scope.horizontalPixelRatio;
    const h = scope.bitmapSize.height / scope.verticalPixelRatio;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    // Analytic exit point against the media-space pane bounds; handles
    // vertical (dx=0) and horizontal (dy=0) since Infinity drops out of min().
    let t = Infinity;
    if (dx > 0) t = Math.min(t, (w - a.x) / dx);
    else if (dx < 0) t = Math.min(t, -a.x / dx);
    if (dy > 0) t = Math.min(t, (h - a.y) / dy);
    else if (dy < 0) t = Math.min(t, -a.y / dy);
    // Degenerate direction, off-pane exit before p2, or NaN → at least reach p2
    // (over-draw is clipped by the canvas).
    if (!Number.isFinite(t) || t < 1) t = 1;
    strokeLineBitmap(
      scope,
      a.x,
      a.y,
      a.x + dx * t,
      a.y + dy * t,
      resolveColor(d, palette),
      lineWidthOf(d),
      d,
    );
  },
};
