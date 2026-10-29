import type { ChartLevel, ChartMark, MarkKind } from '@ryntra/core/adapters';
import { create } from 'zustand';
import { PRICE_BASIS, onTick } from '../../../app/solana/workspace/spot/core-chart-source.ts';

/**
 * Layers over a tower's chart (CITY-5a): marks at moments and levels across the chart, each layer a chip the person
 * turns on and off. The chart has two of its own — the coin's market marks and «Your entry» — and any district adds
 * its own with one call, without touching the chart's files:
 *
 *   setChartLayer({ id: 'perps', label: 'Perps', mint, levels: [{ id: 'entry', price: 187.4, label: 'Long entry' }] });
 *   clearChartLayer('perps');
 *
 * Prices are plain dollar numbers: the chart puts each level on its own price step. Times are ms of the epoch. A
 * layer is drawn on its own tower's chart only; a new call with the same id replaces it. Nothing here sends anything:
 * a level never becomes an order. How to use it — `city/lib/chart/README.md`.
 */

export type LayerMark = Readonly<{
  id: string;
  /** ms of the epoch. */
  t: number;
  side: 'buy' | 'sell' | null;
  label: string;
  /** A dollar price to pin the mark to; none — the mark stands on its candle. */
  price?: number | null;
  /** The person's own trade or alert (drawn as theirs); the market's otherwise. */
  own?: boolean;
  kind?: MarkKind;
}>;

export type LayerLevel = Readonly<{
  id: string;
  /** Dollars. */
  price: number;
  label: string;
  /** `alert` — a price the person waits for; `level` — a line they keep. Neither ever drafts an order. */
  kind?: 'level' | 'alert';
}>;

export type ChartLayer = Readonly<{
  /** Unique among layers: `perps`, `vault`. `market` and `entry` are the chart's own. */
  id: string;
  /** The chip's word. */
  label: string;
  /** The tower (mint) it is drawn on. */
  mint: string;
  marks?: readonly LayerMark[];
  levels?: readonly LayerLevel[];
}>;

type LayersState = {
  layers: ReadonlyMap<string, ChartLayer>;
  /** Layers the person turned off; kept across towers, so «off» stays off. */
  hidden: ReadonlySet<string>;
};

export const useChartLayers = create<LayersState>(() => ({ layers: new Map(), hidden: new Set() }));

/** Adds or replaces a layer. */
export function setChartLayer(layer: ChartLayer): void {
  useChartLayers.setState((state) => ({ layers: new Map(state.layers).set(layer.id, layer) }));
}

/** Takes a layer off every chart. */
export function clearChartLayer(id: string): void {
  if (!useChartLayers.getState().layers.has(id)) return;
  useChartLayers.setState((state) => {
    const layers = new Map(state.layers);
    layers.delete(id);
    return { layers };
  });
}

/** The person's chip: a layer on or off. */
export function toggleChartLayer(id: string): void {
  useChartLayers.setState((state) => {
    const hidden = new Set(state.hidden);
    if (!hidden.delete(id)) hidden.add(id);
    return { hidden };
  });
}

/** The added layers of one tower, in the order they came, the ones with nothing to draw left out. */
export function layersOf(layers: ReadonlyMap<string, ChartLayer>, mint: string): ChartLayer[] {
  return [...layers.values()].filter((layer) => layer.mint === mint && ((layer.marks?.length ?? 0) > 0 || (layer.levels?.length ?? 0) > 0));
}

const usable = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;

/**
 * Every shown layer as the core chart takes it: marks oldest first, levels on the chart's price step, each id prefixed
 * by its layer so two layers never collide. A mark or level without a usable time or price is left out.
 */
export function mergeLayers(layers: readonly ChartLayer[], hidden: ReadonlySet<string>, tick: string): { marks: ChartMark[]; levels: ChartLevel[] } {
  const marks: ChartMark[] = [];
  const levels: ChartLevel[] = [];
  for (const layer of layers) {
    if (hidden.has(layer.id)) continue;
    for (const mark of layer.marks ?? []) {
      if (!usable(mark.t)) continue;
      marks.push({
        id: `${layer.id}:${mark.id}`,
        kind: mark.kind ?? 'trade',
        t: mark.t,
        price: usable(mark.price) ? onTick(mark.price, tick) : null,
        side: mark.side,
        label: mark.label,
        own: mark.own ?? false,
      });
    }
    for (const level of layer.levels ?? []) {
      if (!usable(level.price)) continue;
      levels.push({ id: `${layer.id}:${level.id}`, kind: level.kind ?? 'level', price: onTick(level.price, tick), basis: PRICE_BASIS, label: level.label });
    }
  }
  return { marks: marks.sort((a, b) => a.t - b.t), levels };
}
