/* Pointer + keyboard interaction layer for the drawing system.
   Listens in the CAPTURE phase on the chart container so it can claim events
   before lightweight-charts sees them — but only claims what belongs to
   drawings (tool placement, drags on hits, anchor drags). Idle + "select" +
   nothing hit → events pass through and the chart pans natively.
   SSR-safe: no browser globals at module top level. */

import type { IChartApi } from "lightweight-charts";
import { TOOL_IMPLS } from "./tools";
import type {
  ActiveTool,
  DrawingLayerCallbacks,
  DrawingPoint,
  DrawingRenderState,
  EphemeralDrawing,
  ICoordinateMapper,
  IDrawingStore,
  StoredDrawing,
  ToolImpl,
  ToolType,
} from "./types";

/* ------------------------------------------------------------------ deps ---- */

export type InteractionDeps = {
  chart: IChartApi;
  container: HTMLElement;
  store: IDrawingStore;
  mapper: ICoordinateMapper;
  primitive: { updateView(): void };
  getMagnet(): boolean;
  getActiveTool(): ActiveTool;
  setActiveToolInternal(t: ActiveTool): void;
  callbacks?: DrawingLayerCallbacks;
  setEphemeral(d: EphemeralDrawing | null): void;
  getEphemeral(): EphemeralDrawing | null;
  /** Side used when the "position" tool is armed. Defaults to "long". */
  getPositionSide?(): "long" | "short";
};

/* -------------------------------------------------------------- constants ---- */

const CLICK_SLOP_PX = 4;
const CLICK_DRAG_MIN_MS = 150;
const HIT_TOL_MOUSE = 6;
const HIT_TOL_TOUCH = 12;
const ANCHOR_R_MOUSE = 8;
const ANCHOR_R_TOUCH = 12;
const SNAP_TOL_PX = 8;
const EPHEMERAL_ID = "__ephemeral__";

/* ------------------------------------------------------------ state machine ---- */

type Mode =
  | { kind: "idle" }
  | {
      kind: "placing";
      tool: ToolType;
      committed: DrawingPoint[];
      /** media-space coords + timestamp of the pointerdown that started placement (click-drag detection) */
      downX: number;
      downY: number;
      downAt: number;
    }
  | { kind: "pressedOnBody"; id: string; startX: number; startY: number; original: StoredDrawing; pointerId: number }
  | { kind: "draggingBody"; id: string; last: DrawingPoint; original: StoredDrawing; pointerId: number }
  | { kind: "draggingAnchor"; id: string; anchorIndex: number; original: StoredDrawing; pointerId: number }
  | { kind: "rulerHold" };

/* -------------------------------------------------------------- controller ---- */

export class InteractionController {
  private readonly deps: InteractionDeps;
  private mode: Mode = { kind: "idle" };
  private chartLocked = false;

  constructor(deps: InteractionDeps) {
    this.deps = deps;
    const c = deps.container;
    c.addEventListener("pointerdown", this.onPointerDown, true);
    c.addEventListener("pointermove", this.onPointerMove, true);
    c.addEventListener("pointerup", this.onPointerUp, true);
    c.addEventListener("pointercancel", this.onPointerCancel, true);
    window.addEventListener("keydown", this.onKeyDown);
    this.syncCursor();
  }

  destroy(): void {
    const c = this.deps.container;
    c.removeEventListener("pointerdown", this.onPointerDown, true);
    c.removeEventListener("pointermove", this.onPointerMove, true);
    c.removeEventListener("pointerup", this.onPointerUp, true);
    c.removeEventListener("pointercancel", this.onPointerCancel, true);
    window.removeEventListener("keydown", this.onKeyDown);
    const m = this.mode;
    if (m.kind === "pressedOnBody" || m.kind === "draggingBody" || m.kind === "draggingAnchor") {
      this.releasePointer(m.pointerId);
    }
    this.mode = { kind: "idle" };
    this.unlockChart();
    this.setCursor("");
  }

  /** Re-apply the tool-derived cursor (crosshair when armed, "" on select, grabbing mid-drag). */
  syncCursor(): void {
    if (this.mode.kind === "draggingBody") {
      this.setCursor("grabbing");
      return;
    }
    this.setCursor(this.deps.getActiveTool() !== "select" ? "crosshair" : "");
  }

  /** Called by the facade after an EXTERNAL setActiveTool: cancel any in-flight
      placement silently (no onToolChange — the external owner set the tool) and
      re-sync the cursor. */
  handleExternalToolChange(): void {
    if (this.mode.kind === "placing") {
      this.deps.setEphemeral(null);
      this.unlockChart();
      this.mode = { kind: "idle" };
      this.deps.primitive.updateView();
    }
    this.syncCursor();
  }

  /* ------------------------------------------------------------ pointerdown ---- */

  private onPointerDown = (e: PointerEvent): void => {
    const pt = this.eventXY(e);
    if (!pt) return; // beyond the pane (price/time axes) — never claim

    // rulerHold: clear the measurement, then fall through to idle handling.
    if (this.mode.kind === "rulerHold") {
      this.deps.setEphemeral(null);
      this.mode = { kind: "idle" };
      this.deps.primitive.updateView();
    }

    if (this.mode.kind === "placing") {
      const p = this.resolvePoint(pt.x, pt.y, e);
      if (!p) return; // scale not ready — ignore
      this.claim(e);
      this.commitPoint(p, pt.x, pt.y);
      return;
    }

    if (this.mode.kind !== "idle") return; // stray extra pointer mid-drag

    const tool = this.deps.getActiveTool();
    if (tool !== "select") {
      this.beginPlacement(tool, pt.x, pt.y, e);
      return;
    }
    this.idleSelectPointerDown(pt.x, pt.y, e);
  };

  private beginPlacement(tool: ToolType, x: number, y: number, e: PointerEvent): void {
    const p = this.resolvePoint(x, y, e);
    if (!p) return; // toTimePrice null — ignore the event entirely
    this.claim(e);
    this.lockChart();
    this.capturePointer(e.pointerId);
    this.mode = { kind: "placing", tool, committed: [], downX: x, downY: y, downAt: Date.now() };
    this.commitPoint(p, x, y);
  }

  private idleSelectPointerDown(x: number, y: number, e: PointerEvent): void {
    if (!this.deps.store.isVisible()) {
      this.deselectIfAny();
      return; // layer hidden — nothing hittable; chart pans
    }
    const touch = e.pointerType === "touch";
    const anchorR = touch ? ANCHOR_R_TOUCH : ANCHOR_R_MOUSE;
    const tol = touch ? HIT_TOL_TOUCH : HIT_TOL_MOUSE;

    // 1) selected drawing's anchors first
    const selId = this.deps.store.getSelected();
    if (selId) {
      const sel = this.deps.store.get(selId);
      if (sel && !sel.hidden && !sel.locked) {
        const idx = this.hitAnchor(sel, x, y, anchorR);
        if (idx !== null) {
          this.claim(e);
          this.lockChart();
          this.capturePointer(e.pointerId);
          this.mode = { kind: "draggingAnchor", id: sel.id, anchorIndex: idx, original: sel, pointerId: e.pointerId };
          return;
        }
      }
    }

    // 2) topmost body hit (last-to-first). Locked drawings: selectable, not draggable.
    const hit = this.hitBody(x, y, tol);
    if (hit) {
      this.claim(e);
      if (hit.locked) {
        this.deps.store.setSelected(hit.id);
        this.deps.primitive.updateView();
        return;
      }
      this.lockChart();
      this.capturePointer(e.pointerId);
      this.mode = { kind: "pressedOnBody", id: hit.id, startX: x, startY: y, original: hit, pointerId: e.pointerId };
      return;
    }

    // 3) empty space: deselect if needed, but do NOT claim — the chart pans natively.
    this.deselectIfAny();
  }

  /* ------------------------------------------------------------ pointermove ---- */

  private onPointerMove = (e: PointerEvent): void => {
    const mode = this.mode;
    if (mode.kind === "idle" || mode.kind === "rulerHold") return;
    const pt = this.eventXY(e);
    if (!pt) return; // over the axes — skip this sample
    const { x, y } = pt;

    switch (mode.kind) {
      case "placing": {
        // not claimed: scroll/scale are locked; letting the move through keeps LWC's crosshair tracking
        if (mode.committed.length === 0) return;
        const p = this.resolvePoint(x, y, e);
        if (!p) return;
        this.deps.setEphemeral(this.makeEphemeral(mode.tool, [...mode.committed, p]));
        this.deps.primitive.updateView();
        return;
      }
      case "pressedOnBody": {
        this.claim(e);
        if (Math.hypot(x - mode.startX, y - mode.startY) <= CLICK_SLOP_PX) return;
        const start = this.deps.mapper.toTimePrice(mode.startX, mode.startY);
        if (!start) return;
        this.deps.store.setSelected(mode.id);
        this.mode = {
          kind: "draggingBody",
          id: mode.id,
          last: start,
          original: mode.original,
          pointerId: mode.pointerId,
        };
        this.setCursor("grabbing");
        this.dragBodyTo(x, y);
        return;
      }
      case "draggingBody": {
        this.claim(e);
        this.dragBodyTo(x, y);
        return;
      }
      case "draggingAnchor": {
        this.claim(e);
        const p = this.resolvePoint(x, y, e);
        if (!p) return;
        const cur = this.deps.store.get(mode.id);
        if (!cur) return;
        this.deps.store.update(TOOL_IMPLS[cur.type].applyAnchorDrag(cur, mode.anchorIndex, p));
        this.deps.primitive.updateView();
        return;
      }
    }
  };

  private dragBodyTo(x: number, y: number): void {
    if (this.mode.kind !== "draggingBody") return;
    const m = this.mode;
    const cur = this.deps.mapper.toTimePrice(x, y);
    if (!cur) return;
    const d = this.deps.store.get(m.id);
    if (!d) return;
    const dTime = cur.time - m.last.time;
    const dPrice = cur.price - m.last.price;
    if (dTime === 0 && dPrice === 0) return;
    this.deps.store.update(TOOL_IMPLS[d.type].applyBodyDrag(d, dTime, dPrice));
    m.last = cur;
    this.deps.primitive.updateView();
  }

  /* -------------------------------------------------------------- pointerup ---- */

  private onPointerUp = (e: PointerEvent): void => {
    const mode = this.mode;
    switch (mode.kind) {
      case "placing": {
        const pt = this.eventXY(e);
        if (!pt) return; // released over an axis — never claim, stay placing
        this.claim(e);
        const moved = Math.hypot(pt.x - mode.downX, pt.y - mode.downY) > CLICK_SLOP_PX;
        const longEnough = Date.now() - mode.downAt > CLICK_DRAG_MIN_MS;
        if (!moved || !longEnough) return; // plain click — wait for the next pointerdown
        const p = this.resolvePoint(pt.x, pt.y, e);
        if (!p) return;
        // click-drag placement: commit as the FINAL point and finalize
        if (mode.tool === "position") {
          this.finalizePosition(p);
          return;
        }
        this.finalize(mode.tool, [...mode.committed, p], pt.x, pt.y);
        return;
      }
      case "pressedOnBody": {
        // moved <= slop: a click — select
        this.claim(e);
        this.releasePointer(mode.pointerId);
        this.unlockChart();
        this.mode = { kind: "idle" };
        this.deps.store.setSelected(mode.id);
        this.deps.primitive.updateView();
        return;
      }
      case "draggingBody":
      case "draggingAnchor": {
        // store.update already applied every step; the store's debounced save persists it
        this.claim(e);
        this.releasePointer(mode.pointerId);
        this.unlockChart();
        this.mode = { kind: "idle" };
        this.syncCursor();
        this.deps.primitive.updateView();
        return;
      }
      default:
        return;
    }
  };

  /* ----------------------------------------------------------- pointercancel ---- */

  private onPointerCancel = (_e: PointerEvent): void => {
    const mode = this.mode;
    switch (mode.kind) {
      case "placing":
        this.cancelPlacement();
        return;
      case "pressedOnBody":
        this.releasePointer(mode.pointerId);
        this.unlockChart();
        this.mode = { kind: "idle" };
        return;
      case "draggingBody":
      case "draggingAnchor":
        this.deps.store.update(mode.original);
        this.releasePointer(mode.pointerId);
        this.unlockChart();
        this.mode = { kind: "idle" };
        this.syncCursor();
        this.deps.primitive.updateView();
        return;
      default:
        return;
    }
  };

  /* --------------------------------------------------------------- keyboard ---- */

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.defaultPrevented) return; // another handler (e.g. fullscreen) already consumed it
    if (this.isEditableTarget(e.target)) return; // ticket inputs keep working

    if (e.key === "Escape") {
      this.handleEscape(e);
      return;
    }

    if (e.key === "Delete" || e.key === "Backspace") {
      if (this.mode.kind !== "idle") return;
      const id = this.deps.store.getSelected();
      if (!id) return;
      e.preventDefault();
      this.deps.store.remove(id);
      this.deps.store.setSelected(null); // facade's subscribe-bridge fires onSelectionChange(null)
      this.deps.primitive.updateView();
    }
  };

  private handleEscape(e: KeyboardEvent): void {
    const mode = this.mode;
    switch (mode.kind) {
      case "placing":
        e.preventDefault();
        this.cancelPlacement();
        return;
      case "pressedOnBody":
        e.preventDefault(); // consumed: abort the press
        this.releasePointer(mode.pointerId);
        this.unlockChart();
        this.mode = { kind: "idle" };
        return;
      case "draggingBody":
      case "draggingAnchor":
        e.preventDefault();
        this.deps.store.update(mode.original); // restore pre-drag drawing
        this.releasePointer(mode.pointerId);
        this.unlockChart();
        this.mode = { kind: "idle" };
        this.syncCursor();
        this.deps.primitive.updateView();
        return;
      case "rulerHold":
        e.preventDefault();
        this.deps.setEphemeral(null);
        this.mode = { kind: "idle" };
        this.deps.primitive.updateView();
        return;
      case "idle": {
        if (this.deps.getActiveTool() !== "select") {
          // armed but not placing yet — disarm (auto-reset, keeps toolbar truthful)
          e.preventDefault(); // consumed: disarm the tool
          this.resetToolToSelect();
          return;
        }
        if (this.deps.store.getSelected() !== null) {
          e.preventDefault(); // consumed: clear selection
          this.deps.store.setSelected(null);
          this.deps.primitive.updateView();
        }
        // nothing to do — let Escape through (fullscreen exit etc.)
        return;
      }
    }
  }

  private isEditableTarget(t: EventTarget | null): boolean {
    if (!(t instanceof HTMLElement)) return false;
    if (t.isContentEditable) return true;
    return t.closest("input, textarea, select, [contenteditable='true'], [contenteditable='']") !== null;
  }

  /* -------------------------------------------------------------- placement ---- */

  /** Commit one placement point. Handles per-tool finalize rules. */
  private commitPoint(p: DrawingPoint, x: number, y: number): void {
    if (this.mode.kind !== "placing") return;
    const m = this.mode;

    if (m.tool === "position") {
      // contract says pointCount 2, but UX = single click; points are synthesized
      this.finalizePosition(p);
      return;
    }

    m.committed.push(p);
    const needed: number = TOOL_IMPLS[m.tool].pointCount;
    if (m.committed.length >= needed) {
      this.finalize(m.tool, m.committed.slice(), x, y);
      return;
    }
    // first of two points: preview degenerate segment until the pointer moves
    this.deps.setEphemeral(this.makeEphemeral(m.tool, [...m.committed, { ...p }]));
    this.deps.primitive.updateView();
  }

  private finalize(tool: ToolType, points: DrawingPoint[], x: number, y: number): void {
    const d: StoredDrawing = {
      id: crypto.randomUUID(),
      type: tool,
      points,
      style: {}, // themed accent default
      createdAt: Date.now(),
    };
    if (tool === "text") d.props = { text: "" };

    this.unlockChart();
    this.resetToolToSelect();

    if (tool === "ruler") {
      // never persisted — keep as ephemeral until next pointerdown / Escape
      this.deps.setEphemeral(d);
      this.mode = { kind: "rulerHold" };
      this.deps.primitive.updateView();
      return;
    }

    this.mode = { kind: "idle" };
    this.deps.setEphemeral(null);
    this.deps.store.add(d);
    this.deps.store.setSelected(d.id);
    if (tool === "text") {
      const anchor = points[0];
      const at = (anchor ? this.deps.mapper.toXY(anchor) : null) ?? { x, y };
      this.deps.callbacks?.onRequestTextEdit?.(d.id, at);
    }
    this.deps.primitive.updateView();
  }

  private finalizePosition(p: DrawingPoint): void {
    const side: "long" | "short" = this.deps.getPositionSide ? this.deps.getPositionSide() : "long";
    const entry = p.price;
    const stop = side === "long" ? entry * 0.98 : entry * 1.02;
    const target = side === "long" ? entry * 1.04 : entry * 0.96;
    const t2 = p.time + 20 * this.deps.mapper.getTfSeconds();
    const d: StoredDrawing = {
      id: crypto.randomUUID(),
      type: "position",
      points: [
        { time: p.time, price: entry },
        { time: t2, price: entry },
      ],
      style: {},
      props: { side, stop, target },
      createdAt: Date.now(),
    };
    this.unlockChart();
    this.resetToolToSelect();
    this.mode = { kind: "idle" };
    this.deps.setEphemeral(null);
    this.deps.store.add(d);
    this.deps.store.setSelected(d.id);
    this.deps.primitive.updateView();
  }

  private cancelPlacement(): void {
    this.deps.setEphemeral(null);
    this.unlockChart();
    this.mode = { kind: "idle" };
    this.resetToolToSelect();
    this.deps.primitive.updateView();
  }

  private makeEphemeral(tool: ToolType, points: DrawingPoint[]): EphemeralDrawing {
    const d: EphemeralDrawing = {
      id: EPHEMERAL_ID,
      type: tool,
      points,
      style: {},
      createdAt: Date.now(),
    };
    if (tool === "text") d.props = { text: "" };
    return d;
  }

  private resetToolToSelect(): void {
    if (this.deps.getActiveTool() !== "select") {
      this.deps.setActiveToolInternal("select");
      this.deps.callbacks?.onToolChange?.("select");
    }
    this.syncCursor();
  }

  /* ------------------------------------------------------------- hit testing ---- */

  private renderStateFor(d: StoredDrawing, impl: ToolImpl): DrawingRenderState {
    return { visible: true, pts: impl.project(d, this.deps.mapper) ?? [], labels: [] };
  }

  private hitAnchor(d: StoredDrawing, x: number, y: number, r: number): number | null {
    const impl = TOOL_IMPLS[d.type];
    if (!impl) return null;
    const state = this.renderStateFor(d, impl);
    if (state.pts.length === 0) return null;
    const anchors = impl.anchors(d, state);
    for (let i = 0; i < anchors.length; i++) {
      const a = anchors[i];
      if (a && Math.hypot(a.x - x, a.y - y) <= r) return i;
    }
    return null;
  }

  private hitBody(x: number, y: number, tol: number): StoredDrawing | null {
    const list = this.deps.store.list();
    for (let i = list.length - 1; i >= 0; i--) {
      const d = list[i];
      if (!d || d.hidden) continue;
      const impl = TOOL_IMPLS[d.type];
      if (!impl) continue;
      const state = this.renderStateFor(d, impl);
      if (state.pts.length === 0) continue;
      if (impl.hitTestBody(d, state, x, y, tol)) return d;
    }
    return null;
  }

  private deselectIfAny(): void {
    if (this.deps.store.getSelected() !== null) {
      this.deps.store.setSelected(null); // facade bridge fires onSelectionChange(null)
      this.deps.primitive.updateView();
    }
  }

  /* ---------------------------------------------------------------- helpers ---- */

  /** Container-relative coords; null when beyond the pane (over price/time axes). */
  private eventXY(e: PointerEvent): { x: number; y: number } | null {
    const rect = this.deps.container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const pane = this.deps.mapper.paneSize();
    if (x > pane.width || y > pane.height) return null;
    return { x, y };
  }

  /** magnet XOR shift → OHLC snap (fallback to plain), else plain toTimePrice. */
  private resolvePoint(x: number, y: number, e: { shiftKey: boolean }): DrawingPoint | null {
    const useSnap = this.deps.getMagnet() !== e.shiftKey;
    if (useSnap) {
      return this.deps.mapper.snap(x, y, SNAP_TOL_PX) ?? this.deps.mapper.toTimePrice(x, y);
    }
    return this.deps.mapper.toTimePrice(x, y);
  }

  private claim(e: Event): void {
    e.preventDefault();
    e.stopPropagation();
  }

  private lockChart(): void {
    if (this.chartLocked) return;
    this.chartLocked = true;
    this.deps.chart.applyOptions({ handleScroll: false, handleScale: false });
  }

  private unlockChart(): void {
    if (!this.chartLocked) return;
    this.chartLocked = false;
    this.deps.chart.applyOptions({ handleScroll: true, handleScale: true });
  }

  private capturePointer(pointerId: number): void {
    try {
      this.deps.container.setPointerCapture(pointerId);
    } catch {
      /* capture unsupported / pointer gone — non-fatal */
    }
  }

  private releasePointer(pointerId: number): void {
    try {
      this.deps.container.releasePointerCapture(pointerId);
    } catch {
      /* already released — non-fatal */
    }
  }

  private setCursor(v: string): void {
    this.deps.container.style.cursor = v;
  }
}
