import type { Metadata, Viewport } from "next";
import { Hubot_Sans, Mona_Sans } from "next/font/google";

import { CityApp } from "@/city/components/CityApp";
import { BUNDLED_CITY } from "@/city/lib/market/bundled";
import { PALETTE } from "@/city/lib/palette";
import s from "@/city/styles/city.module.css";

import { buildCityMetadata, CITY_WORDS } from "../seo";

/* The route entry for `/` — Ryntra City (decision 70, 2026-10-26): the Solana market as a living 3D night city,
   every coin a tower, and Ryntra's engine (swaps, launches, agents) behind the city as its districts open. The
   bundled city paints the skyline in the first frame and the live read replaces it (`/api/city`). The city
   speaks English only; the old home (Mission Control, decision 68) and the landing stay in the code until the
   city replaces their last pages. Fonts and colours are the city's own (`city/styles/city.module.css`). */
const display = Hubot_Sans({ subsets: ["latin"], axes: ["wdth"], variable: "--font-display", display: "swap" });
const ui = Mona_Sans({ subsets: ["latin"], axes: ["wdth"], variable: "--font-ui", display: "swap" });

export const metadata: Metadata = buildCityMetadata();

export const viewport: Viewport = { themeColor: PALETTE.inkDeep, viewportFit: "cover", maximumScale: 1 };

export default function Page() {
  return (
    <main className={`${s.root} ${display.variable} ${ui.variable}`}>
      <script dangerouslySetInnerHTML={{ __html: `document.documentElement.lang="en";document.documentElement.dir="ltr";` }} />
      <h1 className={s.hidden}>{CITY_WORDS.title}</h1>
      <CityApp initial={BUNDLED_CITY} />
    </main>
  );
}
