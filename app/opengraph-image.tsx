import { CITY_CARD_SIZE } from "@/city/lib/share/card";
import { cityCard } from "@/city/lib/share/card.server";
import { CARD_WORDS } from "@/city/lib/share/words";

/* The site's share card (CITY-158): the city's own — a frame of the live 3D city, the mark and the line
   (`city/lib/share/card.server.tsx`). Every page without a card of its own shows it, at `/opengraph-image?v=…`. */
export const runtime = "nodejs";
export const revalidate = 86400;
export const alt = CARD_WORDS.en.alt;
export const size = CITY_CARD_SIZE;
export const contentType = "image/png";
export default function OpenGraphImage() {
  return cityCard({ lang: "en" });
}
