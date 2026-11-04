import type { Metadata } from "next";

import { CityApp } from "@/city/components/CityApp";
import { LaunchedOpener } from "@/city/components/launch/LaunchedOpener";
import { LANG_BOOT_SCRIPT, LANG_KEY, type Lang } from "@/city/lib/i18n/langs";
import { BUNDLED_CITY } from "@/city/lib/market/bundled";
import { CITY_CARD_SIZE } from "@/city/lib/share/card";
import { LAUNCHES_CARD_WORDS } from "@/city/lib/share/words";
import { CITY_FONTS } from "@/city/styles/fonts";
import s from "@/city/styles/city.module.css";

import { SITE, SITE_NAME, TWITTER } from "../seo";

/* `/launches` and `/uk/launches` — every coin launched on Ryntra's launchpad (CITY-185): the city, opened on its window
   «Launched on Ryntra» (`city/components/launch/LaunchedLayer.tsx`). One address to hand anyone who asks where the
   launches are. Its card is the city's own frame of the live city with the page's line (`opengraph-image.tsx`). */

export const LAUNCHES_PATH = { en: "/launches", uk: "/uk/launches" } as const;
const OG_LOCALES = { en: "en_US", uk: "uk_UA" } as const;

const WORDS: Readonly<Record<Lang, Readonly<{ title: string; description: string; h1: string }>>> = {
  en: {
    title: "Launched on Ryntra — every coin from the launchpad",
    description: "Every coin launched on Ryntra on Solana, each a tower of the live city: its market cap, the way to its pool, its holders. Trade it, or launch yours.",
    h1: "Launched on Ryntra",
  },
  uk: {
    title: "Запущено на Ryntra — усі монети з лаунчпаду",
    description: "Усі монети, запущені на Ryntra на Solana, кожна — вежа живого міста: капіталізація, шлях до пулу, тримачі. Торгуй або запусти свою.",
    h1: "Запущено на Ryntra",
  },
};

export function launchesMetadata(lang: Lang): Metadata {
  const words = WORDS[lang];
  const url = `${SITE}${LAUNCHES_PATH[lang]}`;
  const image = { url: `${url}/opengraph-image`, ...CITY_CARD_SIZE, alt: LAUNCHES_CARD_WORDS[lang].alt };
  return {
    title: { absolute: words.title },
    description: words.description,
    alternates: { canonical: url, languages: { en: `${SITE}${LAUNCHES_PATH.en}`, uk: `${SITE}${LAUNCHES_PATH.uk}`, "x-default": `${SITE}${LAUNCHES_PATH.en}` } },
    openGraph: { type: "website", url, siteName: SITE_NAME, title: words.title, description: words.description, images: [image], locale: OG_LOCALES[lang], alternateLocale: [OG_LOCALES[lang === "en" ? "uk" : "en"]] },
    twitter: { card: "summary_large_image", site: TWITTER, title: words.title, description: words.description, images: [image.url] },
  };
}

/* The Ukrainian address names its language as a `?lang=` link does: the choice is kept, then the city's one rule runs. */
const UK_FIRST = `try{localStorage.setItem(${JSON.stringify(LANG_KEY)},"uk")}catch(e){}`;

export function LaunchesPage({ lang }: { lang: Lang }) {
  return (
    <main className={`${s.root} ${CITY_FONTS.className}`} style={CITY_FONTS.style}>
      <script dangerouslySetInnerHTML={{ __html: lang === "uk" ? `${UK_FIRST}${LANG_BOOT_SCRIPT}` : LANG_BOOT_SCRIPT }} />
      <h1 className={s.hidden}>{WORDS[lang].h1}</h1>
      <CityApp initial={BUNDLED_CITY} />
      <LaunchedOpener />
    </main>
  );
}
