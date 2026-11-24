import { SHARE_CARD_SIZE, shareCardAlt } from "@/terminal/share/cards";
import { sectionCard } from "@/terminal/share/card.server";

/* The card older posts of «Launched on Ryntra» name: Launch's card of the terminal (`/launches` leads to `/launch`). */
export const runtime = "nodejs";
export const revalidate = 86400;
export const alt = shareCardAlt("launch", "en");
export const size = SHARE_CARD_SIZE;
export const contentType = "image/png";
export default function Image() {
  return sectionCard({ id: "launch", lang: "en" });
}
