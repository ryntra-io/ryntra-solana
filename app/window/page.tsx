import type { Metadata, Viewport } from "next";
import { Hubot_Sans, Mona_Sans } from "next/font/google";

import { OutPage } from "@/city/components/window/OutPage";
import { BUNDLED_CITY } from "@/city/lib/market/bundled";
import { PALETTE } from "@/city/lib/palette";
import s from "@/city/styles/city.module.css";

import { buildCityMetadata } from "../seo";

/* `/window?id=chart&tower=<mint>` — one window of the city on a page of its own (CITY-75: a
   chart onto the second monitor). Where the browser has no Document Picture-in-Picture, the city opens its window
   here: the window alone, no 3D city, the same wallet and reads. Never offered to the index. */
const display = Hubot_Sans({ subsets: ["latin"], axes: ["wdth"], variable: "--font-display", display: "swap" });
const ui = Mona_Sans({ subsets: ["latin"], axes: ["wdth"], variable: "--font-ui", display: "swap" });

export const metadata: Metadata = { ...buildCityMetadata(), robots: { index: false, follow: false } };

export const viewport: Viewport = { themeColor: PALETTE.inkDeep, colorScheme: "dark" };

export default function Page() {
  return (
    <div className={`${s.root} ${display.variable} ${ui.variable}`}>
      <script dangerouslySetInnerHTML={{ __html: `document.documentElement.lang="en";document.documentElement.dir="ltr";` }} />
      <OutPage initial={BUNDLED_CITY} />
    </div>
  );
}
