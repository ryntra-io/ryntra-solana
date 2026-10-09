import { NextResponse } from "next/server";

import { readTradeCard } from "@/lib/growth/card-store";
import { tradeCardImagePath, tradeCardVersion } from "@/lib/growth/trade-cards";
import { getGuardRuntime } from "@/lib/guard/runtime";

import { drawTradeCard } from "./card-art";
import { cardOrigin } from "../../origin";

/**
 * A trade card's picture, wherever it is asked for.
 *
 * Public: the card exists because the person it belongs to made it to be
 * posted. The address carries the card's version — its drawing and every
 * figure on it — so the right picture under the right version is cached for
 * good (when it was drawn whole), and any other version, or the old address
 * under `/api`, is sent to the current one rather than drawn.
 *
 * The current address lives beside the card's page, `/r/<code>/c/<card>/image`:
 * X reads `robots.txt`, which closes `/api/` to every robot, and a picture it
 * may not fetch becomes a small grey card with no picture at all.
 */
/** A path segment decoded, or as it came when it is not valid percent-encoding. */
function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export async function serveTradeCardImage(req: Request, id: string, at: Readonly<{ code: string }> | null): Promise<NextResponse | Response> {
  const card = await readTradeCard(getGuardRuntime().store, id).catch(() => null);
  if (!card) {
    return new NextResponse("Not found", { status: 404, headers: { "cache-control": "public, max-age=300" } });
  }
  const version = tradeCardVersion(card);
  /* Drawn only at its one address: its own code, its version, nothing else in the query — any other spelling is sent there, so nobody can make the server draw on every request. */
  const query = new URL(req.url).searchParams;
  const exact = at !== null && (at.code === card.code || safeDecode(at.code) === card.code) && [...query].length === 1 && query.get("v") === version;
  if (!exact) {
    return NextResponse.redirect(new URL(tradeCardImagePath(card), req.url), { status: 308, headers: { "cache-control": "public, max-age=300" } });
  }
  const { image, whole } = await drawTradeCard(card, cardOrigin(req.headers));
  image.headers.set("cache-control", whole ? "public, max-age=31536000, immutable" : "public, max-age=300");
  return image;
}
