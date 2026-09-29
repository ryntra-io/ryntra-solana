import type { LandingLocale } from "./landing-copy.ts";

/**
 * The landing's screens of the product: `ryntra.io` as a guest sees it — no
 * wallet, so no one's balance, address or rule — taken by
 * `scripts/site/capture-landing-shots.mjs` in both languages and both themes
 * at the phone width every screen is drawn for first (390 × 844, twice over).
 * The page shows the screen in the reader's theme; the other file is never
 * fetched. The test reads every file and refuses a size that does not match
 * or a name with no file behind it.
 */

export type ShotName = "company" | "buy" | "autoinvest" | "dip" | "payments";
export type ShotTheme = "dark" | "light";

export const SHOT_SIZE = { width: 780, height: 1688 } as const;
export const SHOT_NAMES: readonly ShotName[] = ["company", "buy", "autoinvest", "dip", "payments"];
export const SHOT_THEMES: readonly ShotTheme[] = ["dark", "light"];

export function shotSrc(name: ShotName, locale: LandingLocale, theme: ShotTheme): string {
  return `/site/landing/${name}-${locale}-${theme}.webp`;
}
