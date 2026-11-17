import type { Metadata, Viewport } from "next";

import { CityApp } from "@/city/components/CityApp";
import { LANG_BOOT_SCRIPT } from "@/city/lib/i18n/langs";
import { BUNDLED_CITY } from "@/city/lib/market/bundled";
import { PALETTE } from "@/city/lib/palette";
import { CITY_FONTS } from "@/city/styles/fonts";
import s from "@/city/styles/city.module.css";

import { buildCityMetadata, CITY_HOME_WORDS } from "../seo";

/* `/city` — Ryntra City at its own address once the terminal is the home page: the same city
   as it always was, its scene, its Arena and its windows, opened from the terminal's rail («City»). Its windows open
   from this address as they did from `/` (`/city?open=oracle`). With the terminal's switch closed `/city` leads to `/`,
   where the city still is (`city/lib/open/old-addresses.ts`), so this page answers only once the switch is open. */

export const metadata: Metadata = buildCityMetadata("/city");

export const viewport: Viewport = { themeColor: PALETTE.inkDeep, viewportFit: "cover", maximumScale: 1 };

export default function Page() {
  return (
    <main className={`${s.root} ${CITY_FONTS.className}`} style={CITY_FONTS.style}>
      <script dangerouslySetInnerHTML={{ __html: LANG_BOOT_SCRIPT }} />
      <h1 className={s.hidden}>{CITY_HOME_WORDS.title}</h1>
      <CityApp initial={BUNDLED_CITY} />
    </main>
  );
}
