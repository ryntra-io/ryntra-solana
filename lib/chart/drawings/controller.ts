/* Facade for the chart drawing system. Wires store + mapper + palette +
   primitive + interactions into the DrawingLayer contract from types.ts.
   SSR-safe: no browser globals at module top level — everything happens
   inside createDrawingLayer, which is only called client-side. */

import type { IChartApi, ISeriesApi, SeriesType } from "lightweight-charts";
import { CoordinateMapper } from "./coords";
import { InteractionController } from "./interactions";
import { readPalette } from "./palette";
import { DrawingsPrimitive } from "./primitive";
import { DrawingStore } from "./store";
import type {
  ActiveTool,
  DrawingLayer,
  DrawingLayerOptions,
  EphemeralDrawing,
  ThemePalette,
} from "./types";

/** DrawingLayer + long/short arming for the position tool (structurally still
    a DrawingLayer, so it satisfies the base contract everywhere). */
export type DrawingLayerEx = DrawingLayer & {
  setPositionSide(side: "long" | "short"): void;
};

export function createDrawingLayer(
  chart: IChartApi,
  series: ISeriesApi<SeriesType>,
  opts: DrawingLayerOptions,
): DrawingLayerEx {
  const callbacks = opts.callbacks;

  /* 1) persistence + coordinates */
  const store = new DrawingStore(opts.scope);
  const mapper = new CoordinateMapper(chart, series, opts.tfSeconds);

  /* 2) theme palette (mutable ref — refreshPalette swaps it) */
  let palette: ThemePalette = readPalette(opts.container);

  /* 3) in-progress placement / ruler preview */
  const ephemeralRef: { current: EphemeralDrawing | null } = { current: null };

  /* 4) renderer primitive */
  const primitive = new DrawingsPrimitive({
    store,
    mapper,
    getPalette: () => palette,
    getEphemeral: () => ephemeralRef.current,
  });
  series.attachPrimitive(primitive);

  /* 5) store subscription: repaint + selection-change bridging (fire only on change) */
  let lastSelected: string | null = store.getSelected();
  const unsub = store.subscribe(() => {
    primitive.updateView();
    const sel = store.getSelected();
    if (sel !== lastSelected) {
      lastSelected = sel;
      callbacks?.onSelectionChange?.(sel);
    }
  });

  /* 6) facade-owned state */
  let activeTool: ActiveTool = "select";
  let magnet = true;
  let positionSide: "long" | "short" = "long";

  /* 7) interactions */
  const interactions = new InteractionController({
    chart,
    container: opts.container,
    store,
    mapper,
    primitive,
    getMagnet: () => magnet,
    getActiveTool: () => activeTool,
    setActiveToolInternal: (t) => {
      activeTool = t;
    },
    getPositionSide: () => positionSide,
    callbacks,
    setEphemeral: (d) => {
      ephemeralRef.current = d;
    },
    getEphemeral: () => ephemeralRef.current,
  });

  /* 8) facade */
  return {
    setActiveTool(t: ActiveTool): void {
      if (t === activeTool) {
        interactions.syncCursor();
        return;
      }
      activeTool = t;
      // external set: cancel in-flight placement + cursor sync; onToolChange is
      // NOT fired here — only internal auto-resets fire it.
      interactions.handleExternalToolChange();
    },
    getActiveTool(): ActiveTool {
      return activeTool;
    },

    setMagnet(on: boolean): void {
      magnet = on;
    },
    getMagnet(): boolean {
      return magnet;
    },

    setVisible(on: boolean): void {
      store.setVisible(on); // primitive skips rendering when false
      primitive.updateView();
    },
    isVisible(): boolean {
      return store.isVisible();
    },

    deleteSelected(): void {
      const id = store.getSelected();
      if (id === null) return;
      store.remove(id);
      store.setSelected(null); // subscribe-bridge fires onSelectionChange(null)
    },

    clearAll(): void {
      store.clearAll();
    },

    setScope(scope: string): void {
      store.setScope(scope); // flushes old scope synchronously, loads new
      ephemeralRef.current = null;
      primitive.updateView();
    },

    setTfSeconds(s: number): void {
      mapper.setTfSeconds(s);
      primitive.updateView();
    },

    refreshPalette(): void {
      palette = readPalette(opts.container);
      primitive.updateView();
      // CSS vars settle after the theme attribute flips — re-read once more next frame
      if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(() => {
          palette = readPalette(opts.container);
          primitive.updateView();
        });
      }
    },

    setText(id: string, text: string): void {
      const d = store.get(id);
      if (!d) return;
      if (text.trim() === "") {
        store.remove(id); // empty text drawing is meaningless — drop it
        if (store.getSelected() === id) store.setSelected(null);
      } else {
        store.update({ ...d, props: { text } });
      }
    },

    setPositionSide(side: "long" | "short"): void {
      positionSide = side;
    },

    destroy(): void {
      interactions.destroy();
      unsub();
      try {
        series.detachPrimitive(primitive);
      } catch {
        /* chart/series may already be disposed */
      }
      store.destroy();
    },
  };
}
