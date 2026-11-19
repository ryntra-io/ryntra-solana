import { useEffect, useRef, useState, type RefObject } from 'react';
import { decimalOf, type LayerLine } from './chart-layer.ts';

/**
 * The screen's lines past the prices on screen. The core chart draws a level only inside the prices it shows
 * and fits its scale to the candles alone, so a ladder five per cent under the price would simply not be there. As a
 * trading screen does with its orders, the lines past the edge are counted and said at that edge — «↓ 6» — and the
 * ones inside stand where they are. Nothing of the core chart is changed: its own rows say which are off.
 *
 * Which edge: a line above the price now waits at the top, one under it at the bottom. A chart scrolled far into its
 * history may show prices that the price now is outside of; the count is still right, its edge is the price now's.
 */

/** How many lines wait above and below the prices on screen, and where the plot's edges stand in the pane, px. */
export type OffEdge = Readonly<{ above: number; below: number; top: number; bottom: number; right: number }>;

export const NO_EDGE: OffEdge = { above: 0, below: 0, top: 0, bottom: 0, right: 0 };

/** The lines a person reads as prices across the chart — not the pool's strips by the scale. */
export const acrossLines = (lines: readonly LayerLine[]): readonly LayerLine[] => lines.filter((line) => line.weight === undefined);

/**
 * Off lines on each side, from what the core's rows say (`data-off`) and where each price stands against the price now.
 * Pure: the rows' prices and states are an argument.
 */
export function countOff(rows: readonly Readonly<{ price: number; off: boolean }>[], now: number | null): Readonly<{ above: number; below: number }> {
  let above = 0;
  let below = 0;
  for (const row of rows) {
    if (!row.off || now === null || !(now > 0)) continue;
    if (row.price > now) above += 1;
    else below += 1;
  }
  return { above, below };
}

/** The keys the core's rows are found by: each price once, as the chart was handed it (`decimalOf`, as `CoinChart` writes the levels). */
export function rowKeys(lines: readonly LayerLine[]): readonly string[] {
  return [...new Set(acrossLines(lines).flatMap((line) => decimalOf(line.price) ?? []))];
}

const READ_MS = 400;
const px = (style: CSSStyleDeclaration, name: string): number => {
  const value = Number.parseFloat(style.getPropertyValue(name));
  return Number.isFinite(value) ? value : 0;
};

/** Reads the core's rows of `lines` in the pane a few times a second while there are any and the page is seen: the scale moves with the person. */
export function useOffEdge(pane: RefObject<HTMLElement | null>, lines: readonly LayerLine[], now: number | null): OffEdge {
  const [edge, setEdge] = useState<OffEdge>(NO_EDGE);
  const price = useRef(now);
  price.current = now;
  const key = rowKeys(lines).join(',');
  useEffect(() => {
    if (!key) {
      setEdge(NO_EDGE);
      return;
    }
    const prices = key.split(',');
    // The same count twice in a row before it is said: a chart still drawing its first bars has every line off for a moment.
    let last = '';
    const read = () => {
      if (document.hidden) return;
      const root = pane.current;
      const box = root?.querySelector<HTMLElement>('.ryntra-trade');
      if (!root || !box) {
        last = '';
        setEdge(NO_EDGE);
        return;
      }
      const rows = prices.map((at) => {
        const row = root.querySelector<HTMLElement>(`.ryntra-trade__row--level[data-price="${CSS.escape(at)}"]`);
        return { price: Number(at), off: row !== null && row.dataset.off !== undefined };
      });
      const { above, below } = countOff(rows, price.current);
      const style = getComputedStyle(box);
      const outer = root.getBoundingClientRect();
      const inner = box.getBoundingClientRect();
      // The plot's own edges — not the time axis under it, not the price scale beside it.
      const top = Math.round(inner.top - outer.top + px(style, '--plot-top'));
      const height = px(style, '--plot-height') || inner.height;
      const right = Math.round(outer.right - (inner.left + px(style, '--plot-left') + (px(style, '--plot-width') || inner.width)));
      const next: OffEdge = { above, below, top, bottom: Math.round(top + height), right };
      const seen = `${above}:${below}`;
      const steady = seen === last;
      last = seen;
      if (!steady) return;
      setEdge((was) => (was.above === next.above && was.below === next.below && was.top === next.top && was.bottom === next.bottom && was.right === next.right ? was : next));
    };
    read();
    const timer = window.setInterval(read, READ_MS);
    return () => window.clearInterval(timer);
  }, [pane, key]);
  return edge;
}
