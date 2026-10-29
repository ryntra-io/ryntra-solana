import { create } from 'zustand';
import { readSettings, type StorageLike } from './settings.ts';

/**
 * «Flashing effects» for the whole city (CITY-66): the one question the city's banners, white flashes, shockwaves, the
 * eclipse's ring and the camera's shake ask before they move. The feed's store (`./store.ts`) owns the switch and tells
 * this module each change; the city's scene imports only this small module, never the feed. Asked before the feed has
 * read the device, it reads the kept switch itself — and a device asking for reduced motion has the flashing off.
 */

type Motion = Readonly<{ flashing: boolean; known: boolean }>;

const useMotion = create<Motion>(() => ({ flashing: true, known: false }));

/** The switch as the feed's store has it now. */
export function setFlashing(on: boolean): void {
  const st = useMotion.getState();
  if (st.flashing !== on || !st.known) useMotion.setState({ flashing: on, known: true });
}

/** Whether the city may flash now. */
export function flashingOn(): boolean {
  if (!useMotion.getState().known && typeof window !== 'undefined') setFlashing(readSettings(browserStorage(), prefersReducedMotion()).flashing);
  return useMotion.getState().flashing;
}

/** The same, for a component: it renders again when the switch moves. */
export function useFlashing(): boolean {
  return useMotion((st) => st.flashing);
}

/** Back to a fresh page (tests). */
export function resetMotion(): void {
  useMotion.setState({ flashing: true, known: false });
}

export function prefersReducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export function browserStorage(): StorageLike | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

/* The page's own mark of the choice, for styles that stop blinking without a prop: `html[data-city-flash='off']`. */
if (typeof document !== 'undefined') {
  useMotion.subscribe((st, before) => {
    if (st.known && (st.flashing !== before.flashing || !before.known)) document.documentElement.dataset.cityFlash = st.flashing ? 'on' : 'off';
  });
}
