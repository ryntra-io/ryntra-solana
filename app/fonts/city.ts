import localFont from "next/font/local";

import "./fallbacks.css";

/**
 * The city's two faces, which the terminal wears too (brand book: Hubot Sans for the big words and the numbers, Mona Sans
 * for the sentences), from the repository's own files (`./README.md`). Both are variable in weight and width and have no
 * Cyrillic: `city/styles/fonts.ts` puts Geist's Cyrillic (`./root.ts`) right after each in its stack. The Latin face is
 * preloaded where a page carries the city's faces, as Google's was; the fallbacks keep Google's metrics.
 */
export const hubotSans = localFont({
  src: "./files/hubot-sans-latin-standard-normal.woff2",
  weight: "200 900",
  style: "normal",
  display: "swap",
  variable: "--font-display",
  adjustFontFallback: false,
  fallback: ["'Hubot Sans Fallback'"],
  declarations: [
    { prop: "font-family", value: "Hubot Sans" },
    { prop: "font-stretch", value: "75% 125%" },
    { prop: "unicode-range", value: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD" },
  ],
});

export const monaSans = localFont({
  src: "./files/mona-sans-latin-standard-normal.woff2",
  weight: "200 900",
  style: "normal",
  display: "swap",
  variable: "--font-ui",
  adjustFontFallback: false,
  fallback: ["'Mona Sans Fallback'"],
  declarations: [
    { prop: "font-family", value: "Mona Sans" },
    { prop: "font-stretch", value: "75% 125%" },
    { prop: "unicode-range", value: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD" },
  ],
});
