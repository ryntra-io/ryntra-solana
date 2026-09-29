/* Draggable risk lines — SL / TP / entry (or trigger) levels rendered as draggable
   horizontal lines, two-way synced with a trade ticket. Unlike the drawing layer these
   are DERIVED state (owned by React), never persisted: the price comes in as a prop and a
   drag fires a callback back out. Reuses the LWC v5 primitives API + the drawings' bitmap
   render helpers, but with its own tiny pointer handler (no DrawingStore, no placement FSM).

   Coexistence: the pointer handler registers in the CAPTURE phase and, only on a hit of a
   draggable line, calls stopImmediatePropagation — so the drawings' InteractionController
   (also capture, same element) never also acts. On a miss it never claims (chart pan +
   drawing selection keep working). It must be created BEFORE the drawing layer so its
   capture listener runs first. */

import type {
  IChartApi, IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesApi,
  ISeriesPrimitive, PrimitivePaneViewZOrder, PrimitiveHoveredItem,
  SeriesAttachedParameter, SeriesType, Time,
} from "lightweight-charts";
import type { CanvasRenderingTarget2D, BitmapCoordinatesRenderingScope } from "fancy-canvas";
import { drawLabelBitmap, fmtPrice } from "@/lib/chart/drawings/tools/shared";
import type { ThemePalette } from "@/lib/chart/drawings/types";

/** semantic color keys resolve against the palette; anything else is passed through */
export type RiskLineColor = "entry" | "up" | "down";

export type RiskLineSpec = {
  id: string;
  price: number;
  color: RiskLineColor;
  /** short role label drawn on the line, e.g. "SL" / "TP" / "Entry" */
  label: string;
  draggable?: boolean;
};

export type RiskLineLayer = {
  setLines(specs: RiskLineSpec[]): void;
  setPalette(p: ThemePalette): void;
  destroy(): void;
};

const HIT_TOL_MOUSE = 6;
const HIT_TOL_TOUCH = 12;
const HANDLE_X = 16; // media px from the left where the grab handle sits
const HANDLE_R = 3.5;
const TWO_PI = Math.PI * 2;

type Line = { id: string; y: number; price: number; color: string; label: string; draggable: boolean };

function colorOf(c: RiskLineColor, p: ThemePalette): string {
  return c === "entry" ? p.accent : c === "up" ? p.success : p.danger;
}

class RiskLinePrimitive implements ISeriesPrimitive<Time> {
  private specs: RiskLineSpec[] = [];
  private palette: ThemePalette;
  private lines: Line[] = [];
  /** live override while dragging so the line follows the pointer without a React round-trip */
  dragId: string | null = null;
  dragPrice: number | null = null;

  private chart: IChartApi | null = null;
  private series: ISeriesApi<SeriesType, Time> | null = null;
  private requestUpdate: (() => void) | null = null;
  private readonly views: readonly [IPrimitivePaneView];

  constructor(palette: ThemePalette) {
    this.palette = palette;
    this.views = Object.freeze([new RiskLinePaneView(this)]);
  }

  setSpecs(specs: RiskLineSpec[]): void { this.specs = specs; this.requestUpdate?.(); }
  setPalette(p: ThemePalette): void { this.palette = p; this.requestUpdate?.(); }
  getPalette(): ThemePalette { return this.palette; }
  getLines(): readonly Line[] { return this.lines; }
  repaint(): void { this.requestUpdate?.(); }
  getSeries(): ISeriesApi<SeriesType, Time> | null { return this.series; }

  attached(p: SeriesAttachedParameter<Time, SeriesType>): void {
    this.chart = p.chart as unknown as IChartApi;
    this.series = p.series;
    this.requestUpdate = p.requestUpdate;
  }
  detached(): void { this.chart = null; this.series = null; this.requestUpdate = null; }

  paneViews(): readonly IPrimitivePaneView[] { return this.views; }

  updateAllViews(): void {
    const s = this.series;
    if (!s) { this.lines = []; return; }
    const out: Line[] = [];
    for (const spec of this.specs) {
      const price = this.dragId === spec.id && this.dragPrice != null ? this.dragPrice : spec.price;
      if (!(price > 0)) continue;
      const y = s.priceToCoordinate(price);
      if (y == null) continue;
      out.push({ id: spec.id, y, price, color: colorOf(spec.color, this.palette), label: spec.label, draggable: spec.draggable === true });
    }
    this.lines = out;
  }

  /** cursor hint only; the drag itself is handled by RiskLinePointer */
  hitTest(x: number, y: number): PrimitiveHoveredItem | null {
    void x;
    for (const l of this.lines) {
      if (l.draggable && Math.abs(y - l.y) <= HIT_TOL_MOUSE) {
        return { externalId: `riskline:${l.id}`, zOrder: "top", cursorStyle: "ns-resize" };
      }
    }
    return null;
  }
}

class RiskLinePaneView implements IPrimitivePaneView {
  private readonly _renderer: RiskLineRenderer;
  constructor(p: RiskLinePrimitive) { this._renderer = new RiskLineRenderer(p); }
  zOrder(): PrimitivePaneViewZOrder { return "top"; }
  renderer(): IPrimitivePaneRenderer { return this._renderer; }
}

class RiskLineRenderer implements IPrimitivePaneRenderer {
  private readonly drawInScope: (scope: BitmapCoordinatesRenderingScope) => void;
  constructor(p: RiskLinePrimitive) {
    this.drawInScope = (scope: BitmapCoordinatesRenderingScope): void => {
      const lines = p.getLines();
      if (lines.length === 0) return;
      const palette = p.getPalette();
      const ctx = scope.context;
      const hpr = scope.horizontalPixelRatio;
      const vpr = scope.verticalPixelRatio;
      const wMedia = scope.bitmapSize.width / hpr;
      for (const l of lines) {
        // dashed full-width rule
        const byRaw = l.y * vpr;
        const lw = Math.max(1, Math.round(1.5 * hpr));
        const by = Math.round(byRaw) + (lw % 2 ? 0.5 : 0);
        ctx.save();
        ctx.strokeStyle = l.color;
        ctx.lineWidth = lw;
        ctx.setLineDash([6 * hpr, 4 * hpr]);
        ctx.beginPath();
        ctx.moveTo(HANDLE_X * 2 * hpr, by);
        ctx.lineTo(wMedia * hpr, by);
        ctx.stroke();
        ctx.restore();
        // grab handle for draggable lines
        if (l.draggable) {
          ctx.save();
          ctx.fillStyle = l.color;
          ctx.strokeStyle = palette.panel;
          ctx.lineWidth = 2 * hpr;
          ctx.beginPath();
          ctx.arc(HANDLE_X * hpr, l.y * vpr, HANDLE_R * hpr, 0, TWO_PI);
          ctx.fill();
          ctx.stroke();
          ctx.restore();
        }
        // role + price label chip on the line, left-of-axis
        drawLabelBitmap(scope, `${l.label} ${fmtPrice(l.price)}`, wMedia - 6, l.y, palette, {
          align: "right", bg: true, color: l.color,
        });
      }
    };
  }
  draw(target: CanvasRenderingTarget2D): void { target.useBitmapCoordinateSpace(this.drawInScope); }
}

/* -------------------------------------------------------------- pointer handler ---- */

type RiskLineCallbacks = {
  onDrag?(id: string, price: number): void;
  onCommit?(id: string, price: number): void;
};

class RiskLinePointer {
  private draggingId: string | null = null;
  private pointerId = -1;
  private chartLocked = false;
  private rafId = 0;
  private pendingPrice: number | null = null;

  constructor(
    private readonly chart: IChartApi,
    private readonly container: HTMLElement,
    private readonly primitive: RiskLinePrimitive,
    private readonly cb: RiskLineCallbacks,
  ) {
    container.addEventListener("pointerdown", this.onDown, true);
    container.addEventListener("pointermove", this.onMove, true);
    container.addEventListener("pointerup", this.onUp, true);
    container.addEventListener("pointercancel", this.onUp, true);
  }

  destroy(): void {
    this.container.removeEventListener("pointerdown", this.onDown, true);
    this.container.removeEventListener("pointermove", this.onMove, true);
    this.container.removeEventListener("pointerup", this.onUp, true);
    this.container.removeEventListener("pointercancel", this.onUp, true);
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.unlock();
  }

  /** container-relative y; null when over the price/time axes (outside the pane) */
  private paneY(e: PointerEvent): number | null {
    const rect = this.container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const axisW = this.chart.priceScale("right").width();
    const axisH = this.chart.timeScale().height();
    if (x < 0 || y < 0 || x > rect.width - axisW || y > rect.height - axisH) return null;
    return y;
  }

  private tol(e: PointerEvent): number {
    return e.pointerType === "touch" ? HIT_TOL_TOUCH : HIT_TOL_MOUSE;
  }

  private onDown = (e: PointerEvent): void => {
    if (this.draggingId !== null) return;
    const y = this.paneY(e);
    if (y == null) return;
    const tol = this.tol(e);
    let hit: string | null = null;
    for (const l of this.primitive.getLines()) {
      if (l.draggable && Math.abs(y - l.y) <= tol) { hit = l.id; break; }
    }
    if (hit === null) return; // miss → let the chart / drawing layer handle it
    e.preventDefault();
    e.stopImmediatePropagation(); // beat the drawings' capture-phase controller on the same element
    this.draggingId = hit;
    this.pointerId = e.pointerId;
    this.lock();
    try { this.container.setPointerCapture(e.pointerId); } catch { /* non-fatal */ }
  };

  private onMove = (e: PointerEvent): void => {
    if (this.draggingId === null || e.pointerId !== this.pointerId) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const s = this.primitive.getSeries();
    if (!s) return;
    const rect = this.container.getBoundingClientRect();
    const axisH = this.chart.timeScale().height();
    const yRaw = e.clientY - rect.top;
    const y = Math.max(0, Math.min(rect.height - axisH, yRaw));
    const price = s.coordinateToPrice(y);
    if (price == null || !(Number(price) > 0)) return;
    this.primitive.dragId = this.draggingId;
    this.primitive.dragPrice = Number(price);
    this.primitive.repaint();
    this.pendingPrice = Number(price);
    if (!this.rafId) {
      this.rafId = requestAnimationFrame(() => {
        this.rafId = 0;
        if (this.draggingId !== null && this.pendingPrice != null) this.cb.onDrag?.(this.draggingId, this.pendingPrice);
      });
    }
  };

  private onUp = (e: PointerEvent): void => {
    if (this.draggingId === null || e.pointerId !== this.pointerId) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const id = this.draggingId;
    const price = this.primitive.dragPrice;
    this.draggingId = null;
    this.pointerId = -1;
    this.primitive.dragId = null;
    this.primitive.dragPrice = null;
    this.primitive.repaint();
    this.unlock();
    try { this.container.releasePointerCapture(e.pointerId); } catch { /* non-fatal */ }
    if (this.rafId) { cancelAnimationFrame(this.rafId); this.rafId = 0; }
    if (price != null && price > 0) this.cb.onCommit?.(id, price);
  };

  private lock(): void {
    if (this.chartLocked) return;
    this.chartLocked = true;
    this.chart.applyOptions({ handleScroll: false, handleScale: false });
  }
  private unlock(): void {
    if (!this.chartLocked) return;
    this.chartLocked = false;
    this.chart.applyOptions({ handleScroll: true, handleScale: true });
  }
}

/** Create a draggable risk-line layer on a series. Call BEFORE createDrawingLayer so its
    capture-phase pointer handler runs first. */
export function createRiskLineLayer(
  chart: IChartApi,
  series: ISeriesApi<SeriesType>,
  container: HTMLElement,
  palette: ThemePalette,
  cb: RiskLineCallbacks,
): RiskLineLayer {
  const primitive = new RiskLinePrimitive(palette);
  series.attachPrimitive(primitive);
  const pointer = new RiskLinePointer(chart, container, primitive, cb);
  return {
    setLines: (specs) => primitive.setSpecs(specs),
    setPalette: (p) => primitive.setPalette(p),
    destroy: () => {
      pointer.destroy();
      try { series.detachPrimitive(primitive); } catch { /* series disposed */ }
    },
  };
}
