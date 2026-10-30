import type { Metadata, Viewport } from "next";

import { CityApp } from "@/city/components/CityApp";
import { LANG_BOOT_SCRIPT } from "@/city/lib/i18n/langs";
import { CITY_FONTS } from "@/city/styles/fonts";
import { BUNDLED_CITY } from "@/city/lib/market/bundled";
import { PALETTE } from "@/city/lib/palette";
import s from "@/city/styles/city.module.css";

import { buildCityMetadata, CITY_WORDS } from "../seo";

/* The route entry for `/` — Ryntra City (decision 70, 2026-10-26): the Solana market as a living 3D night city,
   every coin a tower, and Ryntra's engine (swaps, launches, agents) behind the city as its districts open. The
   bundled city paints the skyline in the first frame and the live read replaces it (`/api/city`). The city speaks
   English and Ukrainian (CITY-79, docs/city/LANGUAGES.md); the boot script picks the language before the first paint.
   The old home (Mission Control, decision 68) and the landing stay in the code until the city replaces their last
   pages. Fonts and colours are the city's own (`city/styles/fonts.ts`, `city/styles/city.module.css`). */

export const metadata: Metadata = buildCityMetadata();

export const viewport: Viewport = { themeColor: PALETTE.inkDeep, viewportFit: "cover", maximumScale: 1 };

export default function Page() {
  return (
    <main className={`${s.root} ${CITY_FONTS.className}`} style={CITY_FONTS.style}>
      <script dangerouslySetInnerHTML={{ __html: LANG_BOOT_SCRIPT }} />
      <h1 className={s.hidden}>{CITY_WORDS.title}</h1>
      <CityApp initial={BUNDLED_CITY} />
    </main>
  );
}
