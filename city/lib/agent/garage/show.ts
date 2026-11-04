import { useAssistant } from '../../assistant/store.ts';
import { useCity } from '../../city/store.ts';
import type { Tower } from '../../market/types.ts';
import { quarterStore } from '../../quarter/store.ts';
import { useWindows } from '../../window/store.ts';
import { useGarage } from './store.ts';

/**
 * How the garage agent shows a tower: through the city's own seam for towers an answer is about (CITY-10) — the
 * camera flies to each in turn, then frames them together (`CameraRig`), and a column of light rises from each roof
 * (`Beacons`). The agent sets which towers; the city does the flying and the light, the same as for Ryntra's answers.
 * A tower card picked, the logo's way home or Ryntra's own panel takes the towers back.
 */

/** The garage agent's window in the city's frame (CITY-65): one id for the frame, its layouts and the tray (CITY-84). */
export const GARAGE_WINDOW = 'garage';

/** Fly to these towers and light them; out of the quarter first, the city's view is where towers stand. */
export function showTowers(towers: readonly Tower[]): void {
  if (!towers.length) return;
  const assistant = useAssistant.getState();
  if (assistant.open) assistant.hide();
  if (quarterStore.getState().mode !== 'city') quarterStore.getState().leave();
  const city = useCity.getState();
  if (city.selectedId) city.select(null);
  const at = Date.now();
  useAssistant.setState({ shown: [...towers], focusAt: at });
  useGarage.getState().setShowing({ towers, at });
}

/**
 * Whether the agent's window covers the city: a phone's bottom sheet, or the window on the whole screen. In a bay on a
 * computer (CITY-84) at least 40 % of the city stays in view beside it, so the window stays where it stands.
 */
export function windowCoversCity(st: Readonly<{ desk: boolean; layout: Readonly<{ full: string | null }> }> = useWindows.getState()): boolean {
  return !st.desk || st.layout.full === GARAGE_WINDOW;
}

/** The agent shows towers: where its window covers the city it steps aside first, and a chip brings it back. */
export function flyTo(towers: readonly Tower[]): void {
  if (!towers.length) return;
  if (windowCoversCity()) useGarage.getState().stepAside();
  showTowers(towers);
}

/**
 * The agent's towers go dark — only the agent's: an answer Ryntra lit since then stays. A window that stepped aside for
 * the show is done with too: the next tap on the garage is a new opening.
 */
export function darkTowers(): void {
  const garage = useGarage.getState();
  const showing = garage.showing;
  if (!showing) return;
  garage.setShowing(null);
  if (garage.away) garage.close();
  const assistant = useAssistant.getState();
  if (!assistant.open && assistant.focusAt === showing.at) useAssistant.setState({ shown: [], focusAt: Date.now() });
}

/** The agent's window opens — or comes back from aside as it was. The Deck's «Garage» door and a tap on the garage. */
export function openGarage(): void {
  useGarage.getState().show();
}

/** The agent's window closes as its own «Close» does: the opening ends and its towers go dark. */
export function closeGarage(): void {
  useGarage.getState().close();
  darkTowers();
}

/** The Deck's door: opens the window, or closes it when it is open; one stepped aside comes back. */
export function toggleGarage(): void {
  if (useGarage.getState().open) closeGarage();
  else openGarage();
}
