/* Series primitive hosting all drawings: pooled render states, two pane views
   (shapes + overlay) and cursor hit-testing. No autoscaleInfo by design —
   drawings must never stretch the price scale. */

import type {
  IChartApiBase,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  PrimitiveHoveredItem,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from "lightweight-charts";
import { createDrawingViews } from "./renderer";
import { TOOL_IMPLS } from "./tools";
import type {
  DrawingRenderState,
  DrawingsPrimitiveDeps,
  LabelContext,
  StoredDrawing,
  ThemePalette,
} from "./types";

const EPHEMERAL_KEY = "__ephemeral__";
const ANCHOR_HIT_RADIUS = 8;
const BODY_HIT_TOL = 6;
const NO_LABELS: string[] = [];

export type RenderEntry = { d: StoredDrawing; state: DrawingRenderState };

function emptyState(): DrawingRenderState {
  return { visible: false, pts: [], labels: [] };
}

export class DrawingsPrimitive implements ISeriesPrimitive<Time> {
  private readonly deps: DrawingsPrimitiveDeps;
  private readonly views: readonly [IPrimitivePaneView, IPrimitivePaneView];
  private readonly states = new Map<string, DrawingRenderState>();
  private readonly entries: RenderEntry[] = [];
  private ephemeral: RenderEntry | null = null;
  private readonly labelCtx: LabelContext;
  /** computeLabels memo. Keyed by object identity — the store replaces drawing
      objects immutably on update, and ephemerals are rebuilt per pointermove,
      so a (drawing, tfSeconds) pair fully determines the label strings. */
  private readonly labelCache = new WeakMap<StoredDrawing, { tfSeconds: number; labels: string[] }>();

  private chart: IChartApiBase<Time> | null = null;
  private series: ISeriesApi<SeriesType, Time> | null = null;
  private requestUpdate: (() => void) | null = null;

  constructor(deps: DrawingsPrimitiveDeps) {
    this.deps = deps;
    this.labelCtx = {
      tfSeconds: deps.mapper.getTfSeconds(),
      barsBetween: deps.mapper.barsBetween.bind(deps.mapper),
    };
    this.views = Object.freeze(createDrawingViews(this));
  }

  /* ---- ISeriesPrimitive ---- */

  attached(param: SeriesAttachedParameter<Time, SeriesType>): void {
    this.chart = param.chart;
    this.series = param.series;
    this.requestUpdate = param.requestUpdate;
  }

  detached(): void {
    this.chart = null;
    this.series = null;
    this.requestUpdate = null;
  }

  /** Repaint request; no-op when not attached. */
  updateView(): void {
    if (this.requestUpdate !== null) this.requestUpdate();
  }

  updateAllViews(): void {
    const store = this.deps.store;
    const mapper = this.deps.mapper;
    this.labelCtx.tfSeconds = mapper.getTfSeconds();

    for (const key of this.states.keys()) {
      if (key !== EPHEMERAL_KEY && store.get(key) === undefined) this.states.delete(key);
    }

    if (!store.isVisible()) {
      this.entries.length = 0;
      this.ephemeral = null;
      return;
    }

    const drawings = store.list();
    let n = 0;
    for (const d of drawings) {
      let state = this.states.get(d.id);
      if (state === undefined) {
        state = emptyState();
        this.states.set(d.id, state);
      }
      this.computeState(d, state);
      const slot = this.entries[n];
      if (slot === undefined) this.entries.push({ d, state });
      else {
        slot.d = d;
        slot.state = state;
      }
      n++;
    }
    this.entries.length = n;

    const eph = this.deps.getEphemeral();
    if (eph === null) {
      this.ephemeral = null;
    } else {
      let state = this.states.get(EPHEMERAL_KEY);
      if (state === undefined) {
        state = emptyState();
        this.states.set(EPHEMERAL_KEY, state);
      }
      this.computeState(eph, state);
      if (this.ephemeral === null) this.ephemeral = { d: eph, state };
      else {
        this.ephemeral.d = eph;
        this.ephemeral.state = state;
      }
    }
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return this.views;
  }

  hitTest(x: number, y: number): PrimitiveHoveredItem | null {
    const store = this.deps.store;
    if (!store.isVisible()) return null;

    // Anchors of the selected drawing take priority over any body.
    const selectedId = store.getSelected();
    if (selectedId !== null) {
      const d = store.get(selectedId);
      const state = this.states.get(selectedId);
      if (d !== undefined && state !== undefined && state.visible && state.pts.length > 0) {
        const anchors = TOOL_IMPLS[d.type].anchors(d, state);
        for (let i = 0; i < anchors.length; i++) {
          const dx = anchors[i].x - x;
          const dy = anchors[i].y - y;
          if (dx * dx + dy * dy <= ANCHOR_HIT_RADIUS * ANCHOR_HIT_RADIUS) {
            return { externalId: d.id, zOrder: "top", cursorStyle: "grab" };
          }
        }
      }
    }

    // Bodies, topmost (last-created) first.
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const e = this.entries[i];
      if (!e.state.visible || e.state.pts.length === 0) continue;
      if (TOOL_IMPLS[e.d.type].hitTestBody(e.d, e.state, x, y, BODY_HIT_TOL)) {
        return { externalId: e.d.id, zOrder: "top", cursorStyle: "pointer" };
      }
    }
    return null;
  }

  /* ---- renderer-facing (same module boundary) ---- */

  getRenderEntries(): readonly RenderEntry[] {
    return this.entries;
  }

  getEphemeralEntry(): RenderEntry | null {
    return this.ephemeral;
  }

  getSelectedId(): string | null {
    return this.deps.store.getSelected();
  }

  getPalette(): ThemePalette {
    return this.deps.getPalette();
  }

  /* ---- internals ---- */

  private computeState(d: StoredDrawing, state: DrawingRenderState): void {
    const impl = TOOL_IMPLS[d.type];
    const pts = impl.project(d, this.deps.mapper);
    if (pts === null || d.hidden === true) {
      state.visible = false;
      return;
    }
    state.visible = true;
    state.pts = pts;
    if (impl.computeLabels === undefined) {
      state.labels = NO_LABELS;
      return;
    }
    const tfSeconds = this.labelCtx.tfSeconds;
    const cached = this.labelCache.get(d);
    if (cached !== undefined && cached.tfSeconds === tfSeconds) {
      state.labels = cached.labels;
      return;
    }
    const labels = impl.computeLabels(d, this.labelCtx);
    this.labelCache.set(d, { tfSeconds, labels });
    state.labels = labels;
  }
}
