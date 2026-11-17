import { create } from 'zustand';

/**
 * The rail names every shelf: an icon without its word is not read, and the names are the shortest
 * account of what Ryntra does. A person may fold it to its icons with the button at its foot; the browser remembers
 * that. A desk narrower than 1360 px folds it by itself (the frame's sheet), whatever is remembered.
 *
 * The sheet reads `data-rail='folded'` (`RAIL_ATTR`) on the page's root element. A small script (`RAIL_BOOT_SCRIPT`)
 * sets it there before the first paint, so a person who keeps the rail folded never sees it jump; the store follows
 * right after hydration.
 */

export const RAIL_KEY = 'ryntra.terminal.rail.v1';
export const RAIL_ATTR = 'data-rail';
const FOLDED = 'folded';

/** Runs as the page is parsed, before the first paint: the browser's memory to the root element. */
export const RAIL_BOOT_SCRIPT = `try{if(localStorage.getItem('${RAIL_KEY}')==='${FOLDED}')document.documentElement.setAttribute('${RAIL_ATTR}','${FOLDED}')}catch(e){}`;

export const railStore = create<{ folded: boolean }>(() => ({ folded: false }));

function mark(folded: boolean): void {
  if (folded) document.documentElement.setAttribute(RAIL_ATTR, FOLDED);
  else document.documentElement.removeAttribute(RAIL_ATTR);
}

/** Whether the person keeps the rail folded to its icons. */
export function useRailFolded(): boolean {
  return railStore((st) => st.folded);
}

/** Reads the browser's memory; a private window or blocked storage leaves the rail with its names. */
export function hydrateRail(): void {
  let folded = false;
  try {
    folded = window.localStorage.getItem(RAIL_KEY) === FOLDED;
  } catch {
    folded = false;
  }
  mark(folded);
  if (folded !== railStore.getState().folded) railStore.setState({ folded });
}

/** The terminal's frame leaves the page (the city is a page of its own): the root forgets the rail. */
export function forgetRail(): void {
  document.documentElement.removeAttribute(RAIL_ATTR);
}

export function setRailFolded(folded: boolean): void {
  mark(folded);
  railStore.setState({ folded });
  try {
    window.localStorage.setItem(RAIL_KEY, folded ? FOLDED : 'open');
  } catch {
    /* Storage blocked: the choice holds for this visit. */
  }
}
