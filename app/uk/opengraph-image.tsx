import { CITY_CARD_SIZE } from "@/city/lib/share/card";
import { cityCard } from "@/city/lib/share/card.server";
import { CARD_WORDS } from "@/city/lib/share/words";

/* The share card of the Ukrainian addresses: the city's card (CITY-158) with its line in Ukrainian. It lives outside
   the landing's route group on purpose: Next gives a metadata image inside a group (`app/(home)/uk/…`) a hashed
   address, and the pages name their card at the plain `/uk/opengraph-image` (`landingOgImage` in `app/seo.ts`). */
export const runtime = "nodejs";
export const revalidate = 86400;
export const alt = CARD_WORDS.uk.alt;
export const size = CITY_CARD_SIZE;
export const contentType = "image/png";
export default function Image() {
  return cityCard({ lang: "uk" });
}
