import { SHARE_CARD_SIZE, shareCardAlt } from "@/terminal/share/cards";
import { sectionCard } from "@/terminal/share/card.server";

/* The share card of the Ukrainian addresses: home's card with its line in Ukrainian. It lives outside the landing's
   route group on purpose: Next gives a metadata image inside a group (`app/(home)/uk/…`) a hashed address, and the pages
   name their card at the plain `/uk/opengraph-image` (`landingOgImage` in `app/seo.ts`). */
export const runtime = "nodejs";
export const revalidate = 86400;
export const alt = shareCardAlt("home", "uk");
export const size = SHARE_CARD_SIZE;
export const contentType = "image/png";
export default function Image() {
  return sectionCard({ id: "home", lang: "uk" });
}
