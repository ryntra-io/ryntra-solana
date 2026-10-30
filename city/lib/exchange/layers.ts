import { symbolKey } from '../../../lib/phoenix/market-data.ts';
import { wordsNow } from '../i18n/dict.ts';
import type { OrderRow, PositionRow } from './account.ts';
import { EX_LAYERS } from './words.ts';

/**
 * The perpetual's layers for a price chart (CITY-5d → CITY-5a): where a position was entered, where Phoenix would
 * liquidate it, its take profit and its stop loss, and the orders resting in the book — every price the engine's.
 *
 * The chart of a tower is CITY-5a's (`city/components/chart/**`, the core chart). Until its layer API is merged the
 * Exchange keeps its layers here, in the chart's neutral shape — a price, a kind, a label, a tone of the brandbook —
 * and draws them itself on the window's own level strip. Once CITY-5a exports its layer type, the one adapter is
 * `perpLayers(...)` mapped to it; nothing else of the Exchange changes.
 */

export type LayerKind = 'entry' | 'liquidation' | 'tp' | 'sl' | 'order';

/**
 * The brandbook's light for each (BRANDBOOK §2): the entry in ice, the liquidation in flare — the one danger that is
 * true — the take profit in mint, the stop in warm amber, a resting order in violet.
 */
export type LayerTone = 'ice' | 'flare' | 'mint' | 'warm' | 'violet';

export type PerpLayer = Readonly<{
  id: string;
  kind: LayerKind;
  /** USD per one unit of the asset. */
  price: number;
  label: string;
  tone: LayerTone;
  /** A line the chart draws dashed: a level that has not happened — a trigger, an order, a liquidation. */
  dashed: boolean;
}>;

const TONE: Readonly<Record<LayerKind, LayerTone>> = { entry: 'ice', liquidation: 'flare', tp: 'mint', sl: 'warm', order: 'violet' };

const finite = (value: number | null | undefined): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;

/** The layers of one market: its positions' entry, liquidation, TP and SL, and its resting orders that are not a TP/SL leg. */
export function perpLayers(symbol: string, positions: readonly PositionRow[], orders: readonly OrderRow[]): PerpLayer[] {
  const key = symbolKey(symbol);
  const w = wordsNow(EX_LAYERS);
  const layers: PerpLayer[] = [];
  for (const row of positions) {
    if (symbolKey(row.symbol) !== key) continue;
    const add = (kind: LayerKind, price: number | null, label: string) => {
      if (finite(price)) layers.push({ id: `${row.key}:${kind}`, kind, price, label, tone: TONE[kind], dashed: kind !== 'entry' });
    };
    add('entry', row.entry, row.side === 'long' ? w.longEntry : w.shortEntry);
    add('liquidation', row.liquidationUsd, w.liquidation);
    add('tp', row.tp, w.takeProfit);
    add('sl', row.sl, w.stopLoss);
  }
  for (const order of orders) {
    if (symbolKey(order.symbol) !== key || order.leg !== null || !finite(order.price)) continue;
    layers.push({ id: `order:${order.key}`, kind: 'order', price: order.price, label: order.side === 'buy' ? w.buyOrder : w.sellOrder, tone: TONE.order, dashed: true });
  }
  return layers.sort((a, b) => b.price - a.price);
}

/**
 * The window's own level strip until the chart takes the layers: each level and the mark placed on one line from the
 * lowest to the highest, 0 … 1. Placement only — no level is moved or rounded. Empty with fewer than one level.
 */
export function levelStrip(layers: readonly PerpLayer[], mark: number | null): Readonly<{ marks: readonly (PerpLayer & { at: number })[]; markAt: number | null }> {
  if (layers.length === 0) return { marks: [], markAt: null };
  const prices = [...layers.map((layer) => layer.price), ...(finite(mark) ? [mark] : [])];
  const low = Math.min(...prices);
  const high = Math.max(...prices);
  const span = high - low;
  const at = (price: number) => (span > 0 ? (price - low) / span : 0.5);
  return { marks: layers.map((layer) => ({ ...layer, at: at(layer.price) })), markAt: finite(mark) ? at(mark) : null };
}
