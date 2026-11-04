import { CITY_CARD_SIZE } from "@/city/lib/share/card";
import { cityCard } from "@/city/lib/share/card.server";
import { LAUNCHES_CARD_WORDS } from "@/city/lib/share/words";

/* The card of «Launched on Ryntra» (CITY-185): the city's own frame of the live city, the page's line. */
export const runtime = "nodejs";
export const revalidate = 86400;
export const alt = LAUNCHES_CARD_WORDS.uk.alt;
export const size = CITY_CARD_SIZE;
export const contentType = "image/png";
export default function Image() {
  return cityCard({ lang: "uk", line: LAUNCHES_CARD_WORDS });
}
