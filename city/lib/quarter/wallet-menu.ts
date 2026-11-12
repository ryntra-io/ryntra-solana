/**
 * Where the wallet's panel stands (CITY-239). The panel answers a tap inside a window — «Connect wallet» in the Ring,
 * «Sign in» in the Vault — so it must stand over that window (CITY-236). It used to do so by lifting the whole layer of
 * the top bar over the windows, and the city's event slab and the home's cards came up with it and lay on the window.
 * Now the panel alone stands in a layer of its own, over the windows, and is placed under its chip by the chip's own
 * place on the screen; the top bar's layer stays where it was, under every window.
 *
 * Pure: the chip's box and the screen come in, the panel's corner goes out (`wallet-menu.test.mjs`).
 */

/** The gap between the chip and its panel, px. */
export const MENU_GAP = 8;
/** The panel never stands closer to the screen's top than the top bar does, px. */
export const MENU_TOP_MIN = 12;

export type MenuPlace = Readonly<{ top: number; right: number }>;

/**
 * The panel's top right corner: under the chip, its right edge on the chip's. A chip that is out of sight — the top
 * bar folded away while a window asks for the wallet — still gets its panel on the screen, at the top bar's own line.
 */
export function menuPlace(chip: Readonly<{ bottom: number; right: number }>, screenWidth: number): MenuPlace {
  const top = Math.max(MENU_TOP_MIN, Math.round(chip.bottom + MENU_GAP));
  const right = Math.max(0, Math.round(screenWidth - chip.right));
  return { top, right };
}

/**
 * The keyboard's way through the open panel (CITY-240). The panel is drawn at the end of the page, in a layer of its
 * own, so the page's own order no longer leads from the chip into it: Tab from the chip went on along the top bar and
 * reached the panel last, and Shift+Tab from the panel's first button went to whatever stands before the page's end.
 * The order a person expects is the one the panel had while it hung under its chip: the chip, the panel's controls,
 * then what follows the chip in the top bar — and the same way back. Nothing is trapped: past the panel's two ends the
 * page's own order goes on.
 *
 * `at` — where the keyboard is: on the chip, on a control of the panel (its place among the panel's `count`), on the
 * control that follows the chip in the page, or elsewhere (null). The answer is where this Tab goes, or null to leave
 * it to the page.
 */
export type TabStop = 'chip' | 'first' | 'last' | 'after';

export function tabTo(at: 'chip' | 'after' | number | null, count: number, shift: boolean): TabStop | null {
  if (at === null || count < 1) return null;
  if (at === 'chip') return shift ? null : 'first';
  if (at === 'after') return shift ? 'last' : null;
  if (shift) return at === 0 ? 'chip' : null;
  return at === count - 1 ? 'after' : null;
}

/** What Tab can stop on. */
export const TABBABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
