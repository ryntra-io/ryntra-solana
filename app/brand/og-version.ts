import { HOMEPAGE_COPY } from "../../lib/site/homepage-copy.ts";
import { WORDMARK_BOX, WORDMARK_STAMP } from "./generated/wordmark-box.ts";
import { R_MARK_MATERIAL, R_MARK_PATHS, RYNTRA_COLORS } from "./mark.ts";

/**
 * The share card's version, as the fingerprint of everything drawn on it.
 *
 * X, Telegram, LinkedIn and Slack cache a link preview by the image's URL,
 * for days. The card was redrawn for the new brand on 2026-09-13 and every
 * post on X kept showing the old one — blue ground, the retired letter, the
 * positioning of a month ago — because `/opengraph-image` had been the same
 * address the whole time and nothing told a cache to look again. So the
 * address carries this fingerprint (`/opengraph-image?v=…`): it changes
 * exactly when the picture does, and a stale cache miss is then a fresh
 * fetch rather than a stale hit.
 *
 * Not a cryptographic hash and not a secret — a 32-bit FNV-1a over the
 * card's inputs, which is short enough for a query string and needs no
 * import that a browser bundle could not carry.
 */

/** Bump when the card's layout code (`homepage-og.tsx`) changes without its inputs changing. */
const LAYOUT_REVISION = "2026-09-14";

export function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

const inputs = [
  LAYOUT_REVISION,
  ...HOMEPAGE_COPY.en.ogLines,
  HOMEPAGE_COPY.en.ogContext,
  HOMEPAGE_COPY.en.availability,
  ...HOMEPAGE_COPY.uk.ogLines,
  HOMEPAGE_COPY.uk.ogContext,
  HOMEPAGE_COPY.uk.availability,
  R_MARK_PATHS,
  R_MARK_MATERIAL.map(([color, offset]) => `${color}@${offset}`).join(","),
  `${WORDMARK_BOX.width}x${WORDMARK_BOX.height}`,
  WORDMARK_STAMP,
  RYNTRA_COLORS.graphite,
  RYNTRA_COLORS.surface,
  RYNTRA_COLORS.text,
  RYNTRA_COLORS.muted,
];

export const HOMEPAGE_OG_VERSION = fnv1a(inputs.join("|"));
