/* Position (long/short): entry band between t1..t2 with target/stop zones.
   points = [{time: t1, price: entry}, {time: t2, price: entry}] — entry price
   is duplicated and kept in sync; props = {side, stop, target}. */

import type { DrawingPoint, PositionProps, StoredDrawing, ToolImpl } from "../types";
import { drawLabelBitmap, fmtPrice, strokeLineBitmap, withAlpha } from "./shared";

/** Minimum entry↔stop/target gap as a fraction of entry price. */
const MIN_GAP_FRACTION = 0.0001;

function propsOf(d: StoredDrawing): PositionProps {
  const raw = d.props as Partial<PositionProps> | undefined;
  const entry = d.points[0]?.price ?? 0;
  const side = raw && raw.side === "short" ? "short" : "long";
  const stop = raw && typeof raw.stop === "number" ? raw.stop : entry;
  const target = raw && typeof raw.target === "number" ? raw.target : entry;
  return { side, stop, target };
}

/** Rebuild the drawing enforcing target > entry > stop (long) / mirrored (short). */
function rebuild(
  d: StoredDrawing,
  t1: number,
  t2: number,
  entry: number,
  stop: number,
  target: number,
  side: PositionProps["side"],
): StoredDrawing {
  const eps = Math.max(Math.abs(entry) * MIN_GAP_FRACTION, 1e-9);
  let clampedStop = stop;
  let clampedTarget = target;
  if (side === "long") {
    if (clampedTarget < entry + eps) clampedTarget = entry + eps;
    if (clampedStop > entry - eps) clampedStop = entry - eps;
  } else {
    if (clampedTarget > entry - eps) clampedTarget = entry - eps;
    if (clampedStop < entry + eps) clampedStop = entry + eps;
  }
  return {
    ...d,
    points: [
      { time: t1, price: entry },
      { time: t2, price: entry },
    ],
    props: { side, stop: clampedStop, target: clampedTarget },
  };
}

export const positionTool: ToolImpl = {
  pointCount: 2,

  project(d, mapper) {
    const p1 = d.points[0];
    const p2 = d.points[1];
    if (!p1 || !p2) return null;
    const a = mapper.toXY(p1);
    if (!a) return null;
    const b = mapper.toXY(p2);
    if (!b) return null;
    const { stop, target } = propsOf(d);
    // derived: only the y's matter; x reuses the entry-left x
    const stopPt = mapper.toXY({ time: p1.time, price: stop });
    const targetPt = mapper.toXY({ time: p1.time, price: target });
    return [
      a,
      b,
      { x: a.x, y: stopPt ? stopPt.y : a.y },
      { x: a.x, y: targetPt ? targetPt.y : a.y },
    ];
  },

  anchors(_d, state) {
    const a = state.pts[0];
    const b = state.pts[1];
    const stopPt = state.pts[2];
    const targetPt = state.pts[3];
    if (!a || !b || !stopPt || !targetPt) return [];
    const midX = (a.x + b.x) / 2;
    // 0 entry-left · 1 entry-right · 2 target-mid · 3 stop-mid · 4 target-right · 5 stop-right
    return [
      a,
      b,
      { x: midX, y: targetPt.y },
      { x: midX, y: stopPt.y },
      { x: b.x, y: targetPt.y },
      { x: b.x, y: stopPt.y },
    ];
  },

  hitTestBody(_d, state, x, y, tol) {
    const a = state.pts[0];
    const b = state.pts[1];
    const stopPt = state.pts[2];
    const targetPt = state.pts[3];
    if (!a || !b || !stopPt || !targetPt) return false;
    const x1 = Math.min(a.x, b.x);
    const x2 = Math.max(a.x, b.x);
    const yTop = Math.min(stopPt.y, targetPt.y, a.y);
    const yBot = Math.max(stopPt.y, targetPt.y, a.y);
    return x >= x1 - tol && x <= x2 + tol && y >= yTop - tol && y <= yBot + tol;
  },

  applyAnchorDrag(d, index, p: DrawingPoint) {
    const p1 = d.points[0];
    const p2 = d.points[1];
    if (!p1 || !p2) return d;
    const { side, stop, target } = propsOf(d);
    let t1 = p1.time;
    let t2 = p2.time;
    let entry = p1.price;
    let newStop = stop;
    let newTarget = target;
    switch (index) {
      case 0: // entry-left: move t1 + entry price
        t1 = p.time;
        entry = p.price;
        break;
      case 1: // entry-right: move t2 + entry price
        t2 = p.time;
        entry = p.price;
        break;
      case 2: // target-mid: price → target
        newTarget = p.price;
        break;
      case 3: // stop-mid: price → stop
        newStop = p.price;
        break;
      case 4: // target-right: price → target, time → t2
        newTarget = p.price;
        t2 = p.time;
        break;
      case 5: // stop-right: price → stop, time → t2
        newStop = p.price;
        t2 = p.time;
        break;
      default:
        return d;
    }
    return rebuild(d, t1, t2, entry, newStop, newTarget, side);
  },

  applyBodyDrag(d, dTime, dPrice) {
    const p1 = d.points[0];
    const p2 = d.points[1];
    if (!p1 || !p2) return d;
    const { side, stop, target } = propsOf(d);
    return rebuild(
      d,
      p1.time + dTime,
      p2.time + dTime,
      p1.price + dPrice,
      stop + dPrice,
      target + dPrice,
      side,
    );
  },

  draw(scope, d, state, palette) {
    const a = state.pts[0];
    const b = state.pts[1];
    const stopPt = state.pts[2];
    const targetPt = state.pts[3];
    if (!a || !b || !stopPt || !targetPt) return;
    const { side } = propsOf(d);
    const ctx = scope.context;
    const hpr = scope.horizontalPixelRatio;
    const vpr = scope.verticalPixelRatio;
    const x1 = Math.min(a.x, b.x);
    const x2 = Math.max(a.x, b.x);
    const bx = Math.round(x1 * hpr);
    const bw = Math.round((x2 - x1) * hpr);
    const entryY = a.y;

    // target zone (entry ↔ target)
    ctx.save();
    const tTop = Math.round(Math.min(entryY, targetPt.y) * vpr);
    const tBot = Math.round(Math.max(entryY, targetPt.y) * vpr);
    ctx.fillStyle = withAlpha(palette.success, 0.1);
    ctx.fillRect(bx, tTop, bw, tBot - tTop);
    ctx.strokeStyle = withAlpha(palette.success, 0.5);
    ctx.lineWidth = 1;
    ctx.strokeRect(bx + 0.5, tTop + 0.5, bw, tBot - tTop);
    // stop zone (entry ↔ stop)
    const sTop = Math.round(Math.min(entryY, stopPt.y) * vpr);
    const sBot = Math.round(Math.max(entryY, stopPt.y) * vpr);
    ctx.fillStyle = withAlpha(palette.danger, 0.1);
    ctx.fillRect(bx, sTop, bw, sBot - sTop);
    ctx.strokeStyle = withAlpha(palette.danger, 0.5);
    ctx.strokeRect(bx + 0.5, sTop + 0.5, bw, sBot - sTop);
    ctx.restore();

    // entry line
    strokeLineBitmap(scope, x1, entryY, x2, entryY, palette.text, 1);

    // labels: R:R chip above (long) / below (short) the band; entry/tp/sl inline
    const midX = (x1 + x2) / 2;
    const bandTop = Math.min(targetPt.y, stopPt.y, entryY);
    const bandBot = Math.max(targetPt.y, stopPt.y, entryY);
    const rrLabel = state.labels[0];
    if (rrLabel) {
      const rrY = side === "long" ? bandTop - 12 : bandBot + 12;
      drawLabelBitmap(scope, rrLabel, midX, rrY, palette, { align: "center", bg: true });
    }
    const entryLabel = state.labels[1];
    const tpLabel = state.labels[2];
    const slLabel = state.labels[3];
    if (entryLabel) {
      drawLabelBitmap(scope, entryLabel, x1 + 4, entryY, palette, { align: "left", bg: false });
    }
    if (tpLabel) {
      drawLabelBitmap(scope, tpLabel, x1 + 4, targetPt.y, palette, {
        align: "left",
        bg: false,
        color: palette.success,
      });
    }
    if (slLabel) {
      drawLabelBitmap(scope, slLabel, x1 + 4, stopPt.y, palette, {
        align: "left",
        bg: false,
        color: palette.danger,
      });
    }
  },

  computeLabels(d) {
    const p1 = d.points[0];
    if (!p1) return [];
    const { side, stop, target } = propsOf(d);
    const entry = p1.price;
    const rr = Math.abs(target - entry) / Math.max(Math.abs(entry - stop), 1e-9);
    return [
      side.toUpperCase() + " · R:R " + rr.toFixed(2),
      "Entry " + fmtPrice(entry),
      "TP " + fmtPrice(target),
      "SL " + fmtPrice(stop),
    ];
  },
};
