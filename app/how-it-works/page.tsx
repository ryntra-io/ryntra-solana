import type { Metadata, Viewport } from "next";
import { redirect } from "next/navigation";

import { GuidesPage } from "@/city/components/how/GuidesPage";
import { CITY_GUIDE_FLAGS, HOW_PATH, lessons } from "@/city/lib/how/guides";
import { LANG_BOOT_SCRIPT } from "@/city/lib/i18n/langs";
import { PALETTE } from "@/city/lib/palette";
import { CITY_CARD_SIZE, cityCardVersion } from "@/city/lib/share/card";
import { CITY_FONTS } from "@/city/styles/fonts";
import city from "@/city/styles/city.module.css";

import { buildMissionControlMetadata } from "../seo";

/* `/how-it-works` — «How it works» of Ryntra City as a page of its own (CITY-43): a lesson film, one line and «Try»
   for every function live on this deployment whose lesson is here, the same lessons the city's menu (☰) opens as a
   window. «Try» leads into the city, which opens that function's window. No lesson yet — no page: the address leads
   into the city, never to an empty page. The lessons are files of this build (`city/lib/how/films.json`), so the page
   is built once with it. */

export const dynamic = "force-static";

const WORDS = {
  title: "How it works — Ryntra",
  description: "Short films for what you can do on Ryntra: watch one, then try it yourself in the living Solana city.",
} as const;

const ITEMS = lessons(CITY_GUIDE_FLAGS);

export const metadata: Metadata = {
  ...buildMissionControlMetadata(WORDS, HOW_PATH, `/opengraph-image?v=${cityCardVersion()}`, CITY_CARD_SIZE),
  robots: { index: ITEMS.length > 0, follow: true },
};

export const viewport: Viewport = { themeColor: PALETTE.inkDeep, colorScheme: "dark" };

export default function Page() {
  if (!ITEMS.length) redirect("/");
  return (
    <div className={`${city.root} ${CITY_FONTS.className}`} style={CITY_FONTS.style}>
      <script dangerouslySetInnerHTML={{ __html: LANG_BOOT_SCRIPT }} />
      <GuidesPage items={ITEMS} />
    </div>
  );
}
