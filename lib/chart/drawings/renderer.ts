/* Pane views + renderers for DrawingsPrimitive. Renderers and their bound draw
   closures are constructed once; the per-frame draw path allocates nothing. */

import type { BitmapCoordinatesRenderingScope, CanvasRenderingTarget2D } from "fancy-canvas";
import type {
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  PrimitivePaneViewZOrder,
} from "lightweight-charts";
import type { DrawingsPrimitive } from "./primitive";
import { TOOL_IMPLS } from "./tools";

const ANCHOR_RADIUS = 4.5;
const ANCHOR_RING_WIDTH = 2;
const TWO_PI = Math.PI * 2;

/** Committed shapes, under the crosshair (zOrder "normal"). */
class ShapesRenderer implements IPrimitivePaneRenderer {
  private readonly drawInScope: (scope: BitmapCoordinatesRenderingScope) => void;

  constructor(p: DrawingsPrimitive) {
    this.drawInScope = (scope: BitmapCoordinatesRenderingScope): void => {
      const entries = p.getRenderEntries();
      if (entries.length === 0) return;
      const palette = p.getPalette();
      const selectedId = p.getSelectedId();
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        if (!e.state.visible || e.state.pts.length === 0) continue;
        TOOL_IMPLS[e.d.type].draw(scope, e.d, e.state, palette, e.d.id === selectedId);
      }
    };
  }

  draw(target: CanvasRenderingTarget2D): void {
    target.useBitmapCoordinateSpace(this.drawInScope);
  }
}

/** Ephemeral preview + anchor handles of the selected drawing (zOrder "top"). */
class OverlayRenderer implements IPrimitivePaneRenderer {
  private readonly drawInScope: (scope: BitmapCoordinatesRenderingScope) => void;

  constructor(p: DrawingsPrimitive) {
    this.drawInScope = (scope: BitmapCoordinatesRenderingScope): void => {
      const palette = p.getPalette();
      const eph = p.getEphemeralEntry();
      if (eph !== null && eph.state.visible && eph.state.pts.length > 0) {
        TOOL_IMPLS[eph.d.type].draw(scope, eph.d, eph.state, palette, false);
      }

      const selectedId = p.getSelectedId();
      if (selectedId === null) return;
      const entries = p.getRenderEntries();
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        if (e.d.id !== selectedId) continue;
        if (!e.state.visible || e.state.pts.length === 0) return;
        const anchors = TOOL_IMPLS[e.d.type].anchors(e.d, e.state);
        const ctx = scope.context;
        const hr = scope.horizontalPixelRatio;
        const vr = scope.verticalPixelRatio;
        const radius = ANCHOR_RADIUS * hr;
        ctx.fillStyle = palette.accent;
        ctx.strokeStyle = palette.panel;
        ctx.lineWidth = ANCHOR_RING_WIDTH * hr;
        for (let a = 0; a < anchors.length; a++) {
          ctx.beginPath();
          ctx.arc(anchors[a].x * hr, anchors[a].y * vr, radius, 0, TWO_PI);
          ctx.fill();
          ctx.stroke();
        }
        return;
      }
    };
  }

  draw(target: CanvasRenderingTarget2D): void {
    target.useBitmapCoordinateSpace(this.drawInScope);
  }
}

class DrawingsPaneView implements IPrimitivePaneView {
  private readonly viewRenderer: IPrimitivePaneRenderer;
  private readonly viewZOrder: PrimitivePaneViewZOrder;

  constructor(renderer: IPrimitivePaneRenderer, zOrder: PrimitivePaneViewZOrder) {
    this.viewRenderer = renderer;
    this.viewZOrder = zOrder;
  }

  zOrder(): PrimitivePaneViewZOrder {
    return this.viewZOrder;
  }

  renderer(): IPrimitivePaneRenderer {
    return this.viewRenderer;
  }
}

export function createDrawingViews(
  p: DrawingsPrimitive,
): [IPrimitivePaneView, IPrimitivePaneView] {
  return [
    new DrawingsPaneView(new ShapesRenderer(p), "normal"),
    new DrawingsPaneView(new OverlayRenderer(p), "top"),
  ];
}
