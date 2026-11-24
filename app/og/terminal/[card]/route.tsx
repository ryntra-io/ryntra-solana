import { SHARE_CARDS, isShareCard } from "@/terminal/share/cards";
import { sectionCard } from "@/terminal/share/card.server";

export const runtime = "nodejs";
export const revalidate = 86400;
export const dynamicParams = false;

/**
 * `/og/terminal/<card>` — a section's share card (decision 105): a real frame of that section of the terminal, the mark,
 * its name and its line (`terminal/share/card.server.tsx`). The pages name it with the card's fingerprint (`?v=`,
 * `shareCardPath`), so the picture behind one address never changes and the edge keeps it for a week. Drawn at the
 * build, where the frames are files; a card the list does not name is not found.
 */
export function generateStaticParams() {
  return SHARE_CARDS.filter((card) => card !== "home").map((card) => ({ card }));
}

export async function GET(_request: Request, { params }: { params: Promise<{ card: string }> }) {
  const { card } = await params;
  if (!isShareCard(card)) return new Response("Not found", { status: 404, headers: { "cache-control": "public, max-age=300" } });
  return sectionCard({ id: card });
}
