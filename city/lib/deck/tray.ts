/**
 * Where a tray of the Deck stands (CITY-242): over the place that was pressed — Spot's doors over Spot, the Arena's over
 * the Arena — not in the Deck's middle whatever was pressed. Its middle stands over the place's middle, moved in only as
 * far as it takes to keep the whole tray on the screen with the city's edge around it (a phone's Spot is near the edge).
 *
 * Everything in the screen's pixels: the Deck's left edge, the place's middle, the tray's width, the screen's width and
 * the edge to keep. The answer is the tray's middle measured from the Deck's left edge — what its `left` is set to.
 */
export function trayCentre(deckLeft: number, placeCentre: number, trayWidth: number, screenWidth: number, edge: number): number {
  const half = trayWidth / 2;
  const low = edge + half;
  const high = screenWidth - edge - half;
  // A tray wider than the screen keeps the screen's middle: nothing better to do with it.
  const centre = low > high ? screenWidth / 2 : Math.min(Math.max(placeCentre, low), high);
  return Math.round(centre - deckLeft);
}
