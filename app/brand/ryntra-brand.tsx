import { WORDMARK_BOX } from "./generated/wordmark-box";
import { R_MARK_MATERIAL, R_MARK_MATERIAL_AXIS, R_MARK_PATHS, R_MARK_VIEWBOX } from "./mark";

import "./brand.css";

/**
 * The canonical Ryntra brand components — Brand Canon v1.0 (Owner, 2026-09-11):
 *
 *   - the mark is the orange R measured in `app/brand/mark.ts` — traced from
 *     the Owner's flat master, never redrawn; only its material changes
 *     (the master's ramp, flat, monochrome);
 *   - the primary logo everywhere a header or footer exists is the wordmark
 *     `[R]YNTRA` — the mark is the R, never followed by a second one;
 *   - the wordmark shows where there is horizontal room, the standalone mark
 *     on compact and mobile surfaces;
 *   - the Owner's disc (`ryntra-avatar-1024.png`) is the avatar; the favicon
 *     is the same R on the dark tile, simplified.
 *
 * No other component may draw an R, a wordmark or a logo of its own —
 * `app/brand/brand.test.mjs` enforces it.
 */

/**
 * The wordmark as the Owner's flat lockup of 2026-09-13, traced from the
 * masters by scripts/render-brand-assets.mjs into one vector geometry: the R
 * with the master's own ramp, YNTRA in the ground's ink. One geometry serves
 * both grounds, so both carry the same ratio (the SVG's viewBox); the `-ui`
 * rasters of the same drawing remain for the share card and print.
 */
const WORDMARK_RATIO = WORDMARK_BOX.width / WORDMARK_BOX.height;
export const WORDMARK = {
  dark: { src: "/brand/ryntra-wordmark-dark.svg", ratio: WORDMARK_RATIO },
  light: { src: "/brand/ryntra-wordmark-light.svg", ratio: WORDMARK_RATIO },
} as const;

/** The geometric R. `title` names it for standalone use; omit inside a lockup. */
export function RyntraMark({ size = 26, title }: { size?: number; title?: string }) {
  return (
    <svg
      className="ryntra-brand-mark"
      width={size}
      height={size}
      viewBox={R_MARK_VIEWBOX}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <defs>
        {/* Static id: the gradient is identical in every instance, so the
            first definition in the document serves them all. The stops and
            the axis are the master's own, the same ones the icon set and the
            share card draw. */}
        <linearGradient id="ryntra-mark-g" x1={R_MARK_MATERIAL_AXIS.x1} y1={R_MARK_MATERIAL_AXIS.y1} x2={R_MARK_MATERIAL_AXIS.x2} y2={R_MARK_MATERIAL_AXIS.y2}>
          {R_MARK_MATERIAL.map(([color, offset]) => <stop key={offset} offset={offset} stopColor={color} />)}
        </linearGradient>
      </defs>
      <path d={R_MARK_PATHS} fill="url(#ryntra-mark-g)" />
    </svg>
  );
}

/**
 * The primary lockup.
 *
 * The YNTRA letterforms are drawn, not set: no installed family reproduces
 * them, and setting them in a UI face renders a different logo. So the
 * lockup ships as the Owner's artwork — the traced SVG, one ink per ground —
 * and the standalone mark stays its own vector. The mark IS the R, so the
 * artwork reads YNTRA after it; the accessible name stays the complete word.
 */
export function RyntraBrand({ size = 26 }: { size?: number }) {
  return (
    <span className="ryntra-brand" role="img" aria-label="Ryntra">
      {/* next/image cannot merge the mutually exclusive theme variants. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className="ryntra-brand-lockup ryntra-brand-lockup-dark"
        src={WORDMARK.dark.src}
        alt=""
        width={Math.round(size * WORDMARK.dark.ratio)}
        height={size}
        decoding="async"
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className="ryntra-brand-lockup ryntra-brand-lockup-light"
        src={WORDMARK.light.src}
        alt=""
        width={Math.round(size * WORDMARK.light.ratio)}
        height={size}
        decoding="async"
      />
    </span>
  );
}
