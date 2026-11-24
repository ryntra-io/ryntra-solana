/**
 * A coin's logo drawn in dark ink, which vanishes on the terminal's dark glass (Anthropic's black mark on
 * ANT, seen on 19.11): such a logo stands on a light disc. The rule is the picture's own pixels, never a list of coins:
 * among the pixels a person sees (alpha at least half), nearly all are dark and almost none are light. A light logo, a
 * colourful one, or a dark disc with a light mark on it reads as it is.
 *
 * Pure: the pixels in, one answer out. The browser's part — drawing the loaded picture small and reading it back — is
 * `CoinLogo`'s.
 */

/** The side, px, a logo is read at: enough to tell ink from ground, cheap on a long list. */
export const LOGO_SAMPLE = 24;
/** A pixel is seen at this alpha (0–255) or more. */
export const SEEN_ALPHA = 128;
/** Below this luminance (0–255) a pixel is dark ink on the glass; above `LIGHT_LUMA`, light enough to read on it. */
export const DARK_LUMA = 56;
export const LIGHT_LUMA = 140;
/** A logo is dark when at least this share of what is seen is dark… */
export const DARK_SHARE = 0.85;
/** …and at most this share is light. */
export const LIGHT_SHARE = 0.04;
/** Fewer seen pixels than this share of the picture: nothing to judge. */
const SEEN_MIN_SHARE = 0.02;

/** Relative luminance of an sRGB pixel, 0–255 (Rec. 709 weights). */
export function luma(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Whether a logo's pixels (RGBA, row by row) are dark ink that would vanish on the terminal's dark glass. */
export function darkLogo(rgba: ArrayLike<number>): boolean {
  const pixels = Math.floor(rgba.length / 4);
  if (pixels === 0) return false;
  let seen = 0;
  let dark = 0;
  let light = 0;
  for (let at = 0; at < pixels * 4; at += 4) {
    if ((rgba[at + 3] ?? 0) < SEEN_ALPHA) continue;
    seen += 1;
    const y = luma(rgba[at] ?? 0, rgba[at + 1] ?? 0, rgba[at + 2] ?? 0);
    if (y < DARK_LUMA) dark += 1;
    else if (y > LIGHT_LUMA) light += 1;
  }
  if (seen < pixels * SEEN_MIN_SHARE) return false;
  return dark / seen >= DARK_SHARE && light / seen <= LIGHT_SHARE;
}
