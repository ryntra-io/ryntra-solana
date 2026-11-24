import { isCardId, readCard } from "@/lib/agent-drive/card";
import { driveCardImage } from "@/lib/agent-drive/card-art.server";
import { getGuardRuntime } from "@/lib/guard/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The «×» card of a closed trade, drawn by the server (1200×675, `next/og`): the picture X shows under a post that links
 * the card's page (`/x/<id>`). Its figures are the kept card's alone; the address only names it, in the person's
 * language or the one asked (`?l=uk`). A card that is not there answers 404. Reads only.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const card = isCardId(id) ? await readCard(getGuardRuntime().store, id).catch(() => null) : null;
  if (!card) return new Response("Not found", { status: 404, headers: { "cache-control": "public, max-age=60" } });
  const asked = new URL(request.url).searchParams.get("l");
  return driveCardImage(card, asked === "uk" || asked === "en" ? asked : card.locale);
}
