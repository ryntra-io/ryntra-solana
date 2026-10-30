import { create } from 'zustand';

/**
 * CITY-81, the «Play» layer: the city's first screen is money only — Launch,
 * Harbor, Agents, Predict, Exchange. Your quarter, the Ring, the Vault, the Hall, the Run and the Map are one more layer
 * over the same city, opened by the «City / Play» switch beside the brand and never on the way to money. Every visit
 * starts in City. Escape and a phone's Back return from Play to City (city/components/game, city/components/hud/useBackLayers.ts).
 */

export type Layer = 'city' | 'play';

/** The words of the layer's own controls: the city's dictionary (`./words.ts`, CITY-79). */
export { GAME as GAME_WORDS } from './words.ts';

/** The game's dock, in its order. */
export type GameItem = 'quarter' | 'ring' | 'vault' | 'hall' | 'run' | 'map';
/** The money's dock, in its order. */
export type CityItem = 'launch' | 'harbor' | 'agents' | 'predict' | 'exchange';

export const GAME_ITEMS: readonly GameItem[] = ['quarter', 'ring', 'vault', 'hall', 'run', 'map'];
export const CITY_ITEMS: readonly CityItem[] = ['launch', 'harbor', 'agents', 'predict', 'exchange'];

/**
 * What a dock shows: the items whose switch is open, in the dock's order. A closed one is simply not there — no «Soon»,
 * no lock. Your quarter and the Map have no switch: they are always in Play.
 */
export function shownItems<T extends string>(order: readonly T[], open: Readonly<Partial<Record<T, boolean>>>): T[] {
  return order.filter((id) => open[id] === true);
}

type LayerState = {
  layer: Layer;
  /** Into Play or back to City. A phone's Back returns from Play as it closes a window: Play is the bottom layer of the
   * city's «Back» (city/components/hud/useBackLayers.ts), so a window or the Map opened in Play closes first (CITY-150). */
  set: (layer: Layer) => void;
};

export const useLayer = create<LayerState>((set, get) => ({
  layer: 'city',
  set: (layer) => {
    if (get().layer !== layer) set({ layer });
  },
}));

/** The layer now, outside React. */
export const layerNow = (): Layer => useLayer.getState().layer;

/** Back to a fresh page (tests). */
export function resetLayer(): void {
  useLayer.setState({ layer: 'city' });
}
