/**
 * The canonical Ryntra mark — the single source of the geometry.
 *
 * The brand palette (2026-09-11, `LOGO/Брендбук2/Палітра.txt`) with the
 * masters of 2026-09-13: the master symbol is the orange R, and its geometry
 * never changes by hand — proportions, the arrow, the inner notch, the top
 * bar, the slant of the leg, the negative space are the master's. Only the
 * material treatment changes with the task: flat for small UI, the master's
 * own ramp for branding, monochrome for print.
 *
 * The geometry is *measured*, not drawn: `scripts/render-brand-assets.mjs`
 * traces the flat standalone master (`Лого.png`, a transparent PNG) on its
 * 50%-alpha line and fits the ramp across the letter's interior, and writes
 * `./generated/mark-geometry.ts`. This module re-exports that measurement
 * and derives the few values consumers need from it. The mark was once
 * measured from a tile master that was later replaced, and the share card,
 * the favicon and the phone bar carried a different letter from the header
 * for two days; re-tracing from the current master on every render is what
 * keeps that from happening again.
 *
 * Every surface that draws the mark — the React mark, `app/icon.svg`, the
 * favicon rasters, the Open Graph card — imports or embeds exactly these
 * strings. `app/brand/brand.test.mjs` fails the build when a surface drifts to
 * a hand-drawn variant, which is how the site once ended up with four logos.
 */
import {
  R_MARK_BOX,
  R_MARK_CANVAS,
  R_MARK_MATERIAL,
  R_MARK_MATERIAL_AXIS,
  R_MARK_PATHS,
  R_MARK_SOURCE,
  R_MARK_TRACE,
} from "./generated/mark-geometry.ts";

export { R_MARK_BOX, R_MARK_CANVAS, R_MARK_MATERIAL, R_MARK_MATERIAL_AXIS, R_MARK_PATHS, R_MARK_SOURCE, R_MARK_TRACE };

/** A square viewBox with the mark centred and ~4% optical padding. */
export const R_MARK_VIEWBOX = (() => {
  const side = Math.round(Math.max(R_MARK_BOX.width, R_MARK_BOX.height) * 1.087);
  const x = Math.round(R_MARK_BOX.x + R_MARK_BOX.width / 2 - side / 2);
  const y = Math.round(R_MARK_BOX.y + R_MARK_BOX.height / 2 - side / 2);
  return `${x} ${y} ${side} ${side}`;
})();

/**
 * The mark's fill as a two-stop ramp for the consumers that keep that shape
 * (a drop shadow's tint, a hover tint): the ends of the master's own ramp.
 */
export const RYNTRA_GRADIENT = {
  from: R_MARK_MATERIAL[0][0],
  to: R_MARK_MATERIAL[R_MARK_MATERIAL.length - 1][0],
} as const;

/**
 * Core brand palette — fixed 2026-09-11 (`LOGO/Брендбук2/Палітра.txt`).
 *
 * Orange is the brand; graphite with a navy undertone is the dark ground;
 * cool neutral white is the light ground. The older names (`navy`, `heat`,
 * `sand`, `ink`, `blue`, `cyan`, `white`, `paper`) stay as call-site aliases
 * so no consumer breaks; every one resolves to a brand value.
 */
export const RYNTRA_COLORS = {
  /** brand — the mark, the primary action, the selected state. */
  orange: "#FF681C",
  orangeHover: "#FF7A2F",
  orangeDeep: "#F24C0C",
  honey: "#F5A524",
  /** dark environment */
  graphite: "#080D13",
  surface: "#0E1620",
  elevated: "#131E2A",
  border: "#22303E",
  text: "#F5F7FA",
  muted: "#91A0B2",
  /** light environment */
  lightBg: "#F5F7FA",
  lightSurface: "#FFFFFF",
  lightBorder: "#DDE3EA",
  lightText: "#111820",
  lightMuted: "#667085",
  /** @deprecated alias of `graphite`; the dark ground. */
  navy: "#080D13",
  /** @deprecated alias of `orange`. */
  heat: "#FF681C",
  /** @deprecated alias of `lightBg`; the light ground. */
  sand: "#F5F7FA",
  /** @deprecated alias of `lightText`. */
  ink: "#111820",
  /** @deprecated alias of `orange`. */
  blue: "#FF681C",
  /** @deprecated alias of `orangeHover`. */
  cyan: "#FF7A2F",
  white: "#F5F7FA",
  paper: "#F5F7FA",
} as const;
