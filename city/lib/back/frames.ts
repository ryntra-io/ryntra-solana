/**
 * The windows of the one frame «Back» closes by themselves (CITY-213). Android's «Back» left the app from every window
 * no one had added by hand to the list of layers: Earn, Bots, the agent's card, the Autopilot, Guard, Learn. So the rule
 * is now the other way round: a window in the frame stands on «Back» unless a named layer already speaks for it.
 *
 * Pure: the ids come in, the layers go out (`frames.test.mjs`).
 */

/** The mark of a layer that is only a window of the frame. */
export const FRAME = 'frame:';

/** The frame's windows a named layer closes (`useBackLayers.ts`): the frame must not stand on «Back» twice for them. */
const NAMED: ReadonlySet<string> = new Set(['predict', 'money', 'chart', 'exchange', 'swap', 'spot', 'scouts', 'partners', 'partners-landing', 'berth', 'garage', 'guides', 'settings']);

const named = (id: string) => NAMED.has(id) || id.startsWith('page-');

/** The layers of the windows standing in the frame now, in the frame's order: the top window last. */
export function frameLayers(ids: readonly string[]): string[] {
  return ids.filter((id) => !named(id)).map((id) => FRAME + id);
}

/** The window a frame layer stands for; null for any other layer. */
export function frameWindow(layer: string): string | null {
  return layer.startsWith(FRAME) ? layer.slice(FRAME.length) : null;
}
