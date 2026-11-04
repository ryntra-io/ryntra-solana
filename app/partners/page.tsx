import type { Metadata, Viewport } from "next";

import { PartnersPage } from "@/city/components/partners/PartnersPage";
import { LANG_BOOT_SCRIPT } from "@/city/lib/i18n/langs";
import { PALETTE } from "@/city/lib/palette";
import { OFFER, percent } from "@/city/lib/partners/facts";
import city from "@/city/styles/city.module.css";
import { CITY_FONTS } from "@/city/styles/fonts";

import { SITE, SITE_NAME, TWITTER } from "../seo";

/* `/partners` — how partners earn, as one short page of the site (CITY-177): the share and the friend's discount on top,
   «Copy my link» at once, three steps, the calculator, the rules behind «Details». Not a deck any more: the numbers are
   decision 93's (`city/lib/partners/terms.ts`), the same the city's «Partners» window prints. The preview card is the
   page's own head, filmed by `scripts/decks/export-live.mjs`. */

export const dynamic = "force-static";

const PAGE_URL = `${SITE}/partners`;

function words() {
  const title = "Ryntra Partners — earn on every trade your friends make";
  const description = OFFER
    ? `${percent(OFFER.firstPercent, "en")} of Ryntra's fee for each person's first ${OFFER.firstDays} days, then ${percent(OFFER.afterPercent, "en")} for good; ${percent(OFFER.discountPercent, "en")} off for your friend. Copy your link in one tap.`
    : "Bring friends to Ryntra and share the fee on every launch and swap they make. Copy your link in one tap.";
  return { title, description };
}

export function generateMetadata(): Metadata {
  const { title, description } = words();
  const image = { url: `${SITE}/decks/og-partners.jpg`, width: 1200, height: 630, alt: title };
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: PAGE_URL },
    openGraph: { type: "website", url: PAGE_URL, siteName: SITE_NAME, title, description, images: [image], locale: "en_US", alternateLocale: ["uk_UA"] },
    twitter: { card: "summary_large_image", site: TWITTER, title, description, images: [image.url] },
  };
}

export const viewport: Viewport = { themeColor: PALETTE.inkDeep, colorScheme: "dark" };

export default function Page() {
  return (
    <div className={`${city.root} ${CITY_FONTS.className}`} style={CITY_FONTS.style}>
      <script dangerouslySetInnerHTML={{ __html: LANG_BOOT_SCRIPT }} />
      <PartnersPage />
    </div>
  );
}
