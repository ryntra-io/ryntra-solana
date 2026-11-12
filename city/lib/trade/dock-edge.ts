/**
 * The ticket's pinned dock — the order's terms and its one action — stands over the bottom of a card that is taller
 * than its room; the rows scroll under it. Switching the ticket to Stop makes the dock a line taller (its terms take two
 * lines), and its top edge then cut a row in half: on a phone, «You pay SOL USDC · You have 0 SOL» (CITY-242, Д3).
 *
 * How far the card moves so that no row is cut by the dock's edge: the row the edge crosses comes up whole above the
 * dock, as long as the tabs the person just pressed stay in sight; otherwise it goes whole under the dock. Positive
 * scrolls the card on (the rows move up), negative back; zero when no row is cut. Pure: rectangles in, pixels out.
 */
export type Span = Readonly<{ top: number; bottom: number }>;

/** A row the edge only grazes — a pixel or two — is not cut. */
const GRAZE = 2;

export function dockNudge(rows: readonly Span[], dockTop: number, view: Span, tabs: Span | null): number {
  const cut = rows.find((row) => row.top < dockTop - GRAZE && row.bottom > dockTop + GRAZE && row.top >= view.top - GRAZE);
  if (!cut) return 0;
  const up = Math.ceil(cut.bottom - dockTop + GRAZE);
  // The tabs stay whole in the card's room after it moves on.
  if (!tabs || tabs.top - up >= view.top) return up;
  return -Math.ceil(dockTop - cut.top);
}
