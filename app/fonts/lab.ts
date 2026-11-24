import localFont from "next/font/local";

import "./fallbacks.css";

/**
 * Inter, the face of the AGG product lab only (`app/preview/agg-lab/`, admin, never indexed): the aggregator's own UI is
 * drawn in it, mapped onto its font token in `agg-lab.css`. Latin preloaded, Cyrillic — the lab's own words are
 * Ukrainian — there when asked, as Google served them.
 */
export const inter = localFont({
  src: [
    { path: "./files/inter-latin-wght-normal.woff2", weight: "400", style: "normal" },
    { path: "./files/inter-latin-wght-normal.woff2", weight: "500", style: "normal" },
    { path: "./files/inter-latin-wght-normal.woff2", weight: "600", style: "normal" },
    { path: "./files/inter-latin-wght-normal.woff2", weight: "700", style: "normal" },
  ],
  display: "swap",
  variable: "--font-agg-inter",
  adjustFontFallback: false,
  fallback: ["'Inter Fallback'"],
  declarations: [
    { prop: "font-family", value: "Inter" },
    { prop: "unicode-range", value: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD" },
  ],
});

export const interCyrillic = localFont({
  src: [
    { path: "./files/inter-cyrillic-wght-normal.woff2", weight: "400", style: "normal" },
    { path: "./files/inter-cyrillic-wght-normal.woff2", weight: "500", style: "normal" },
    { path: "./files/inter-cyrillic-wght-normal.woff2", weight: "600", style: "normal" },
    { path: "./files/inter-cyrillic-wght-normal.woff2", weight: "700", style: "normal" },
  ],
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  declarations: [
    { prop: "font-family", value: "Inter" },
    { prop: "unicode-range", value: "U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116" },
  ],
});
