import { missionCard } from "@/app/brand/mission-card";
import { BASE58 } from "@/lib/api/v1/contract";
import { isCardMoment, reachedMoments } from "@/lib/mission-control/scene";
import { readSceneMission } from "@/lib/mission-control/scene.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const CARD_READ_MS = 20_000;

/**
 * `/api/launch/mission-card?mint=…&moment=orbit` — a mission's moment as a card for X, 1200 × 675 (MC-0). The figures
 * are read here from the chain through the Launch API's server functions, never from the address; a moment the mission
 * has not reached is no card (404). Without `mint` it is Mission Control's own card.
 */
export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const mint = query.get("mint");
  const moment = query.get("moment") ?? "launch";
  if (!mint) return withCache(missionCard(null, null));
  if (!BASE58.test(mint) || !isCardMoment(moment)) return new Response("Not a mission card.", { status: 404 });
  /* An image waits longer than a page: a cold read of the markets may take its time, and the card is cached after. */
  const mission = await readSceneMission(mint, CARD_READ_MS);
  if (!mission || !reachedMoments(mission).includes(moment)) return new Response("This mission has not reached that moment.", { status: 404 });
  return withCache(missionCard(mission, moment));
}

function withCache(response: Response): Response {
  response.headers.set("cache-control", "public, max-age=60, s-maxage=300, stale-while-revalidate=600");
  return response;
}
