import { SHARE_CARD_SIZE, shareCardAlt } from "@/terminal/share/cards";
import { sectionCard } from "@/terminal/share/card.server";

/* The site's share card: home's — a real frame of the terminal's Market, the mark and the first rule's line
   (`terminal/share/card.server.tsx`, decision 105: no card shows the city). Every page without a card of its own shows
   it, at `/opengraph-image?v=…` (`shareCardPath` in `terminal/share/cards.ts`). */
export const runtime = "nodejs";
export const revalidate = 86400;
export const alt = shareCardAlt("home", "en");
export const size = SHARE_CARD_SIZE;
export const contentType = "image/png";
export default function OpenGraphImage() {
  return sectionCard({ id: "home", lang: "en" });
}
