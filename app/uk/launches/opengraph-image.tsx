import { SHARE_CARD_SIZE } from "@/terminal/share/cards";
import { SHARE_WORDS } from "@/terminal/share/words";
import { sectionCard } from "@/terminal/share/card.server";

/* The card older posts of «Запущено на Ryntra» name: Launch's card of the terminal, its line in Ukrainian. */
export const runtime = "nodejs";
export const revalidate = 86400;
export const alt = SHARE_WORDS.launch.uk.alt;
export const size = SHARE_CARD_SIZE;
export const contentType = "image/png";
export default function Image() {
  return sectionCard({ id: "launch", lang: "uk" });
}
