import { create } from 'zustand';

/**
 * What stands over a coin's chart beside the candles: lines at prices, each written by the part of the screen that
 * owns it. The ticket's ladder writes its own slot; a slot of the pool's liquidity or of the person's positions is
 * another part's, so two writers never overwrite each other and the chart draws them all together.
 *
 * Prices are the chart's own — US dollars of the coin, the basis its candles are drawn in. A part whose prices are in
 * another coin turns them with `inChart` against the price both sides agree on now.
 *
 * Pure but for the small store: the chart reads it, the parts write it.
 */

/** Who writes a slot over the chart. */
export type LayerSlot = 'ladder' | 'orders' | 'positions' | 'liquidity';

/**
 * A line's colour: the ticket's draft is amber, what already rests is lilac, what the person holds is mint; `depth` is
 * the pool's own liquidity — not a line across the chart but a strip by the price scale.
 */
export type LineTone = 'draft' | 'resting' | 'held' | 'depth';

/**
 * A line across the chart at a price in US dollars; `tag` is the price as the axis' tag says it, null — the line alone.
 * `weight` (0…1) makes it a strip by the price scale instead, as long as its weight (liquidity by price).
 */
export type LayerLine = Readonly<{
  id: string;
  price: number;
  tone: LineTone;
  tag: string | null;
  weight?: number;
  /** A line's own name, said at its left in its colour (the person's average entry): the price's tag stays at the right. */
  name?: string;
}>;

/** What one slot draws: its lines, and a short badge for the chart's head (the ticket's «Ladder · 8 prices»). */
export type Layer = Readonly<{ lines: readonly LayerLine[]; badge: string | null }>;

type State = Readonly<{ mint: string | null; slots: Readonly<Partial<Record<LayerSlot, Layer>>> }>;

export const useChartLayer = create<State>(() => ({ mint: null, slots: {} }));

/** Writes a slot over the chart of `mint`; null clears it. Another coin's slots go when a coin writes first. */
export function setLayer(mint: string, slot: LayerSlot, layer: Layer | null): void {
  const state = useChartLayer.getState();
  // Clearing what another coin drew is nothing to do: the chart in front keeps its lines.
  if (!layer && state.mint !== mint) return;
  const slots = state.mint === mint ? { ...state.slots } : {};
  if (layer && (layer.lines.length || layer.badge)) slots[slot] = layer;
  else delete slots[slot];
  useChartLayer.setState({ mint, slots });
}

/** Every line over the chart of `mint`, in the slots' order. */
export function linesOf(state: State, mint: string): readonly LayerLine[] {
  if (state.mint !== mint) return [];
  return ORDER.flatMap((slot) => state.slots[slot]?.lines ?? []);
}

/** The first badge over the chart of `mint`, or null. */
export function badgeOf(state: State, mint: string): string | null {
  if (state.mint !== mint) return null;
  for (const slot of ORDER) {
    const badge = state.slots[slot]?.badge;
    if (badge) return badge;
  }
  return null;
}

const ORDER: readonly LayerSlot[] = ['ladder', 'orders', 'positions', 'liquidity'];

/**
 * A price in another coin as the chart's US dollars: scaled by where the coin stands now on both sides — what it is
 * worth in that coin (`coinIn`) and in dollars (`coinUsd`). Null where either is not known.
 */
export function inChart(price: number, coinIn: number, coinUsd: number | null): number | null {
  if (!(price > 0) || !(coinIn > 0) || coinUsd === null || !(coinUsd > 0)) return null;
  const usd = (price / coinIn) * coinUsd;
  return Number.isFinite(usd) ? usd : null;
}

/** A price as the chart's level takes it: a plain decimal, six significant digits, no exponent. */
export function decimalOf(price: number): string | null {
  if (!(price > 0) || !Number.isFinite(price)) return null;
  return price.toLocaleString('en-US', { useGrouping: false, maximumSignificantDigits: 6 });
}
