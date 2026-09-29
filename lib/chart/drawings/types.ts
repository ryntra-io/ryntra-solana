/* Contracts for the drawing layer. Every module in lib/chart/drawings/* codes
   against these types so core/tools/interactions can be built independently.
   Pure TS — no React. Browser APIs only inside implementations, never at module top level. */

/* ---------------------------------------------------------------- model ---- */

export type ToolType =
  | "trend"
  | "ray"
  | "hline"
  | "vline"
  | "rect"
  | "fib"
  | "text"
  | "ruler"
  | "position";

/** Anchor in data space. time = UNIX seconds (epoch) — TF-portable by construction. */
export type DrawingPoint = { time: number; price: number };

export type DrawingStyle = {
  /** null/undefined = themed accent (recolors with theme/accent switches). Explicit hex = user choice. */
  color?: string | null;
  width?: 1 | 2 | 3;
  dash?: "solid" | "dashed" | "dotted";
  opacity?: number;
};

export type PositionProps = { side: "long" | "short"; stop: number; target: number };
export type TextProps = { text: string };

export type StoredDrawing = {
  id: string;
  type: ToolType;
  /** Semantics per type:
      trend/ray/rect/fib: [p1, p2] (fib: p1→p2 defines the 0→1 direction)
      hline: [{time: refTime, price}]  ·  vline: [{time, price: 0}]
      text: [anchor] + props.text
      position: [{time: t1, price: entry}, {time: t2, price: entry}] + props {side, stop, target}
      ruler: never persisted (ephemeral only) */
  points: DrawingPoint[];
  style: DrawingStyle;
  props?: PositionProps | TextProps | Record<string, unknown>;
  locked?: boolean;
  hidden?: boolean;
  createdAt: number;
};

/** Versioned localStorage envelope. `foreign` keeps entries from newer schema
    versions/unknown types intact so an old client never destroys them. */
export type DrawingsFile = { v: 1; drawings: StoredDrawing[] };

export const DRAWINGS_STORAGE_PREFIX = "ryntra-drawings:";
export const MAX_DRAWINGS_PER_SCOPE = 200;

/* ------------------------------------------------------------- palette ---- */

/** Resolved from CSS vars via getComputedStyle on the chart container
    (so per-page accent overrides are honored). Cached; refresh on theme/accent change. */
export type ThemePalette = {
  accent: string;
  success: string;
  danger: string;
  warning: string;
  text: string;
  textDim: string;
  panel: string;
  border: string;
};

/* ------------------------------------------------------------ geometry ---- */

export type RenderPt = { x: number; y: number };

/** Media-space (CSS px) render state per drawing, pooled and rebuilt in updateAllViews. */
export type DrawingRenderState = {
  visible: boolean;
  /** media-space points from ToolImpl.project() — d.points projections first, derived points after */
  pts: RenderPt[];
  /** cached label strings (ruler readout, fib levels, position R:R) — rebuilt only in updateAllViews */
  labels: string[];
};

/** Bitmap-space scope passed to tool draw fns (structural subset of fancy-canvas
    BitmapCoordinatesRenderingScope — media coords × pixel ratios). */
export type BitmapScope = {
  context: CanvasRenderingContext2D;
  bitmapSize: { width: number; height: number };
  horizontalPixelRatio: number;
  verticalPixelRatio: number;
};

export type HitPart = { kind: "body" } | { kind: "anchor"; index: number };

/* ---------------------------------------------------------- tool plugin ---- */

/** Every tool implements this. Registered in tools/index.ts as Record<ToolType, ToolImpl>. */
export interface ToolImpl {
  /** anchors the user places to create the drawing (1 or 2). */
  pointCount: 1 | 2;
  /** Project every pixel point the tool needs into media space (d.points projections first,
      then any derived points — e.g. position appends stop/target y's). null → not renderable now.
      Called from updateAllViews (renderer) and on demand for hit-testing (interactions). */
  project(d: StoredDrawing, mapper: ICoordinateMapper): RenderPt[] | null;
  /** Anchor handles shown when selected, derived from state.pts (position derives 6 handles). */
  anchors(d: StoredDrawing, state: DrawingRenderState): RenderPt[];
  /** Hit test in media px. Callers test anchors (via anchors()) first; this tests the body. */
  hitTestBody(d: StoredDrawing, state: DrawingRenderState, x: number, y: number, tol: number): boolean;
  /** Apply dragging anchor `index` (from anchors()) to a new data-space point. Returns updated drawing. */
  applyAnchorDrag(d: StoredDrawing, index: number, p: DrawingPoint): StoredDrawing;
  /** Apply whole-body drag by data-space delta. Default impl (shiftAllPoints) shifts every point;
      hline ignores dTime, vline ignores dPrice. */
  applyBodyDrag(d: StoredDrawing, dTime: number, dPrice: number): StoredDrawing;
  /** Draw the committed shape. Convert media→bitmap with scope ratios inside. Allocation-free. */
  draw(
    scope: BitmapScope,
    d: StoredDrawing,
    state: DrawingRenderState,
    palette: ThemePalette,
    selected: boolean,
  ): void;
  /** Rebuild cached labels (ruler readout, fib prices, position R:R). Called from updateAllViews. */
  computeLabels?(d: StoredDrawing, ctx: LabelContext): string[];
}

export type LabelContext = {
  tfSeconds: number;
  /** bar count between two epoch times on the current TF (rounded) */
  barsBetween(t1: number, t2: number): number;
};

/* --------------------------------------------------------- store facade ---- */

export interface IDrawingStore {
  list(): readonly StoredDrawing[];
  get(id: string): StoredDrawing | undefined;
  add(d: StoredDrawing): void;
  update(d: StoredDrawing): void;
  remove(id: string): void;
  clearAll(): void;
  getSelected(): string | null;
  setSelected(id: string | null): void;
  isVisible(): boolean;
  setVisible(v: boolean): void;
  /** Fires on any mutation (list, selection, visibility). Returns unsubscribe. */
  subscribe(fn: () => void): () => void;
  /** Flush current scope synchronously, then load drawings for the new scope key. */
  setScope(scope: string): void;
  flush(): void;
  destroy(): void;
}

/* -------------------------------------------------------- mapper facade ---- */

/** Wraps {chart, series}: data↔pixel conversion with logical extrapolation
    beyond loaded data (timeToIndex(findNearest) + tfSeconds), OHLC magnet snapping. */
export interface ICoordinateMapper {
  /** null when the scale isn't ready (no data yet) */
  toXY(p: DrawingPoint): RenderPt | null;
  toTimePrice(x: number, y: number): DrawingPoint | null;
  /** OHLC magnet: nearest of O/H/L/C on the bar under x, if within tolPx of y. */
  snap(x: number, y: number, tolPx: number): DrawingPoint | null;
  setTfSeconds(s: number): void;
  getTfSeconds(): number;
  barsBetween(t1: number, t2: number): number;
  paneSize(): { width: number; height: number };
}

/* ------------------------------------------------- cross-module wiring ---- */

/** In-progress placement preview or ruler — rendered by the overlay view, never persisted. */
export type EphemeralDrawing = StoredDrawing;

/** Constructor deps of DrawingsPrimitive (primitive.ts). The primitive must also expose
    `updateView(): void` (proxies the requestUpdate captured in attached()). */
export type DrawingsPrimitiveDeps = {
  store: IDrawingStore;
  mapper: ICoordinateMapper;
  getPalette(): ThemePalette;
  getEphemeral(): EphemeralDrawing | null;
};

/* --------------------------------------------------------- layer facade ---- */

export type ActiveTool = ToolType | "select";

export type DrawingLayerCallbacks = {
  /** fired when the layer auto-resets to "select" after placement (keeps toolbar truthful) */
  onToolChange?(tool: ActiveTool): void;
  onSelectionChange?(id: string | null): void;
  /** text tool wants an inline editor at media-space coords (React renders the overlay input) */
  onRequestTextEdit?(id: string, at: RenderPt): void;
};

export type DrawingLayerOptions = {
  /** chart container element (chart.chartElement()) — palette + pointer listeners hang off it */
  container: HTMLElement;
  scope: string;
  tfSeconds: number;
  callbacks?: DrawingLayerCallbacks;
};

export interface DrawingLayer {
  setActiveTool(t: ActiveTool): void;
  getActiveTool(): ActiveTool;
  setMagnet(on: boolean): void;
  getMagnet(): boolean;
  setVisible(on: boolean): void;
  isVisible(): boolean;
  deleteSelected(): void;
  clearAll(): void;
  /** flush + reload persisted drawings (market switch) */
  setScope(scope: string): void;
  setTfSeconds(s: number): void;
  /** re-read CSS vars after theme/accent change, then repaint */
  refreshPalette(): void;
  /** update text of a text drawing (from the React overlay editor) */
  setText(id: string, text: string): void;
  destroy(): void;
}
