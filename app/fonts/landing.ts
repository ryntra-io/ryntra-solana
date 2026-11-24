import localFont from "next/font/local";

import { unbounded } from "./root";
import "./fallbacks.css";

/**
 * The landing's faces, for the public pages that keep its look (`/product`, `/product-map`, `/agent-control`, a coin's
 * `/assets/<mint>`): Unbounded for display, Onest for the sentences and IBM Plex Mono for figures. Onest and Plex Mono
 * take the interface faces' variables inside these pages (`--font-geist`, `--font-geist-mono`), so the landing's sheet
 * reads them under the names it always did. They load in these segments only — the rest of the site does not carry them;
 * Unbounded is the root's own (`./root.ts`). Latin is preloaded, Cyrillic is there when a word asks for it, as Google
 * served them.
 */
export const onest = localFont({
  src: "./files/onest-latin-wght-normal.woff2",
  weight: "100 900",
  style: "normal",
  display: "swap",
  variable: "--font-geist",
  adjustFontFallback: false,
  fallback: ["'Onest Fallback'"],
  declarations: [
    { prop: "font-family", value: "Onest" },
    { prop: "unicode-range", value: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD" },
  ],
});

export const onestCyrillic = localFont({
  src: "./files/onest-cyrillic-wght-normal.woff2",
  weight: "100 900",
  style: "normal",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "Onest" },
    { prop: "unicode-range", value: "U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116" },
  ],
});

export const plexMono = localFont({
  src: [
    { path: "./files/ibm-plex-mono-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./files/ibm-plex-mono-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./files/ibm-plex-mono-latin-600-normal.woff2", weight: "600", style: "normal" },
  ],
  display: "swap",
  variable: "--font-geist-mono",
  adjustFontFallback: false,
  fallback: ["'IBM Plex Mono Fallback'"],
  declarations: [
    { prop: "font-family", value: "IBM Plex Mono" },
    { prop: "unicode-range", value: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD" },
  ],
});

export const plexMonoCyrillic = localFont({
  src: [
    { path: "./files/ibm-plex-mono-cyrillic-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./files/ibm-plex-mono-cyrillic-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./files/ibm-plex-mono-cyrillic-600-normal.woff2", weight: "600", style: "normal" },
  ],
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "IBM Plex Mono" },
    { prop: "unicode-range", value: "U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116" },
  ],
});

/** For a landing segment's root: the display accent, the sentences and the figures. */
export const LANDING_FONTS: Readonly<{ className: string }> = {
  className: `${unbounded.variable} ${onest.variable} ${plexMono.variable}`,
};
