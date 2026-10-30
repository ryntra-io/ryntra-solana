import type { Metadata, Viewport } from "next";

import { OutPage } from "@/city/components/window/OutPage";
import { LANG_BOOT_SCRIPT } from "@/city/lib/i18n/langs";
import { BUNDLED_CITY } from "@/city/lib/market/bundled";
import { PALETTE } from "@/city/lib/palette";
import { CITY_FONTS } from "@/city/styles/fonts";
import s from "@/city/styles/city.module.css";

import { buildCityMetadata } from "../seo";

/* `/window?id=chart&tower=<mint>` — one window of the city on a page of its own (CITY-75: a
   chart onto the second monitor). Where the browser has no Document Picture-in-Picture, the city opens its window
   here: the window alone, no 3D city, the same wallet and reads. Never offered to the index. */

export const metadata: Metadata = { ...buildCityMetadata(), robots: { index: false, follow: false } };

export const viewport: Viewport = { themeColor: PALETTE.inkDeep, colorScheme: "dark" };

export default function Page() {
  return (
    <div className={`${s.root} ${CITY_FONTS.className}`} style={CITY_FONTS.style}>
      <script dangerouslySetInnerHTML={{ __html: LANG_BOOT_SCRIPT }} />
      <OutPage initial={BUNDLED_CITY} />
    </div>
  );
}
