import localFont from "next/font/local";

import "./fallbacks.css";

/**
 * The brand faces, loaded once at the root for every page — the brand book v1.0 (2026-09-11): Geist for the interface,
 * Geist Mono for every figure, hash and address, Unbounded as the landing's display accent.
 *
 * The files live in the repository (`./files/`, sources and licences in `./README.md`), so the build asks nobody for a
 * font: a face fetched from Google Fonts at build time made every build depend on Google's answer. Each
 * family is one face per script under one family name, Latin and Cyrillic, each with Google's own `unicode-range`, so
 * the browser composes them as it composed Google's stylesheet. The variables carry what they carried — `--font-geist`
 * is `'Geist', 'Geist Fallback'` — and the fallbacks keep Google's metrics (`./fallbacks.css`). What Google preloaded
 * is preloaded: both scripts of the interface faces, the Latin of the display accent.
 *
 * The variable names are historical: `--font-geist` / `--font-geist-mono` feed `--ry-font-sans` / `--ry-font-mono` in
 * the token projection, `--font-sora` is the display accent.
 */
export const geist = localFont({
  src: "./files/geist-latin-wght-normal.woff2",
  weight: "100 900",
  style: "normal",
  display: "swap",
  variable: "--font-geist",
  adjustFontFallback: false,
  fallback: ["'Geist Fallback'"],
  declarations: [
    { prop: "font-family", value: "Geist" },
    { prop: "unicode-range", value: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD" },
  ],
});

/** Geist's Cyrillic: the same family, its own range. The city's faces borrow it for their Ukrainian letters (`city/styles/fonts.ts`). */
export const geistCyrillic = localFont({
  src: "./files/geist-cyrillic-wght-normal.woff2",
  weight: "100 900",
  style: "normal",
  display: "swap",
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "Geist" },
    { prop: "unicode-range", value: "U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116" },
  ],
});

/* Three weights, as Google declared them: three faces over one variable file, so a weight between them takes the nearest
   face, exactly as before. */
export const geistMono = localFont({
  src: [
    { path: "./files/geist-mono-latin-wght-normal.woff2", weight: "400", style: "normal" },
    { path: "./files/geist-mono-latin-wght-normal.woff2", weight: "500", style: "normal" },
    { path: "./files/geist-mono-latin-wght-normal.woff2", weight: "600", style: "normal" },
  ],
  display: "swap",
  variable: "--font-geist-mono",
  adjustFontFallback: false,
  fallback: ["'Geist Mono Fallback'"],
  declarations: [
    { prop: "font-family", value: "Geist Mono" },
    { prop: "unicode-range", value: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD" },
  ],
});

export const geistMonoCyrillic = localFont({
  src: [
    { path: "./files/geist-mono-cyrillic-wght-normal.woff2", weight: "400", style: "normal" },
    { path: "./files/geist-mono-cyrillic-wght-normal.woff2", weight: "500", style: "normal" },
    { path: "./files/geist-mono-cyrillic-wght-normal.woff2", weight: "600", style: "normal" },
  ],
  display: "swap",
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "Geist Mono" },
    { prop: "unicode-range", value: "U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116" },
  ],
});

export const unbounded = localFont({
  src: [
    { path: "./files/unbounded-latin-wght-normal.woff2", weight: "400", style: "normal" },
    { path: "./files/unbounded-latin-wght-normal.woff2", weight: "600", style: "normal" },
    { path: "./files/unbounded-latin-wght-normal.woff2", weight: "700", style: "normal" },
  ],
  display: "swap",
  variable: "--font-sora",
  adjustFontFallback: false,
  fallback: ["'Unbounded Fallback'"],
  declarations: [
    { prop: "font-family", value: "Unbounded" },
    { prop: "unicode-range", value: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD" },
  ],
});

/** Unbounded's Cyrillic: there when a Ukrainian word asks for it, not preloaded — as Google served it. */
export const unboundedCyrillic = localFont({
  src: [
    { path: "./files/unbounded-cyrillic-wght-normal.woff2", weight: "400", style: "normal" },
    { path: "./files/unbounded-cyrillic-wght-normal.woff2", weight: "600", style: "normal" },
    { path: "./files/unbounded-cyrillic-wght-normal.woff2", weight: "700", style: "normal" },
  ],
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "Unbounded" },
    { prop: "unicode-range", value: "U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116" },
  ],
});

/** For `<html>`: the classes that carry the three variables. The Cyrillic faces come with the module's stylesheet. */
export const ROOT_FONTS: Readonly<{ className: string }> = {
  className: `${geist.variable} ${geistMono.variable} ${unbounded.variable}`,
};
