import type { Metadata } from "next";
import { cookies } from "next/headers";

import { FrozenFooter } from "@/app/site/frozen/chrome";
import { MarkDefs } from "@/app/site/frozen/mark";
import { PublicHeader } from "@/app/site/frozen/public-header";
import "@/app/site/frozen/primitives.css";
import "@/app/site/frozen/module.css";
import "./stats.css";
import { pageCard } from "@/app/brand/page-card";
import { pageCardImage } from "@/app/seo";
import { SitePageGraph } from "@/app/site/page-graph";
import { sitePageMetadata } from "@/app/site/seo";
import { readPublicStats } from "@/lib/attribution/stats.server";
import { normalizePublicLocale, PUBLIC_LOCALE_COOKIE } from "@/lib/site/locale";

import { STATS_COPY } from "./copy";
import { StatsContent } from "./stats-content";

/* The chain read behind the page is shared and ten minutes old at most; the
   page itself is rendered per request so the reader's language and the
   freshest shared copy are what they get. */
export const dynamic = "force-dynamic";
/* A cold instance reads a dozen transactions from public endpoints at a polite pace; that takes seconds, not the default ten. */
export const maxDuration = 60;

async function pageLocale() {
  return normalizePublicLocale((await cookies()).get(PUBLIC_LOCALE_COOKIE)?.value);
}

/* The search words: the page's own line in the title, within 60
   characters; the description within 160 — the Ukrainian lead is longer, so
   the search result carries its short form. */
const STATS_META = {
  en: { title: "Stats — every operation through Ryntra, as it confirmed", description: STATS_COPY.en.lead },
  uk: {
    title: "Статистика — кожна операція через Ryntra",
    description: "Наживо з реєстру операцій Ryntra, звірено з публічними транзакціями Solana: рядок з'являється, щойно операція підтверджена; нічого не оцінено.",
  },
} as const;

export async function generateMetadata(): Promise<Metadata> {
  const locale = await pageLocale();
  return sitePageMetadata({
    path: "/stats",
    ...STATS_META[locale],
    keywords: ["ryntra stats", "ryntra volume", "solana trading volume", "jupiter referral", "onchain attribution"],
    locale,
    image: pageCardImage(locale, ["page", "stats"], pageCard("stats", locale)),
  });
}

export default async function StatsPage() {
  const [locale, model] = await Promise.all([pageLocale(), readPublicStats()]);
  return (
    <div className="rx" data-ry-ground="midnight">
      <SitePageGraph path="/stats" locale={locale} name={STATS_META[locale].title} description={STATS_META[locale].description} />
      <MarkDefs />
      <PublicHeader locale={locale} mainId="main" />
      <StatsContent model={model} initialLocale={locale} />
      <FrozenFooter locale={locale} />
    </div>
  );
}
