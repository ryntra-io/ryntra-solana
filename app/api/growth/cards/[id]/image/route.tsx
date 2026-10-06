import { NextRequest, NextResponse } from "next/server";

import { readTradeCard } from "@/lib/growth/card-store";
import { tradeCardImagePath, tradeCardVersion } from "@/lib/growth/trade-cards";
import { getGuardRuntime } from "@/lib/guard/runtime";

import { drawTradeCard } from "./card-art";
import { cardOrigin } from "../../origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * `GET /api/growth/cards/<id>/image?v=<version>` — a trade card's picture.
 *
 * Public: the card exists because the person it belongs to made it to be posted. The
 * address carries the card's version — its drawing and every figure on it —
 * so the right picture under the right version is cached for good — when
 * it was drawn whole — and any other version is sent to the current one
 * rather than drawn.
 */
export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const card = await readTradeCard(getGuardRuntime().store, id).catch(() => null);
  if (!card) {
    return new NextResponse("Not found", { status: 404, headers: { "cache-control": "public, max-age=300" } });
  }
  /* Another version is not drawn: it is sent to the current one, so nobody can make the server draw on every request. */
  const version = tradeCardVersion(card);
  if (new URL(req.url).searchParams.get("v") !== version) {
    return NextResponse.redirect(new URL(`${tradeCardImagePath(card)}`, req.url), { status: 308, headers: { "cache-control": "public, max-age=300" } });
  }
  const { image, whole } = await drawTradeCard(card, cardOrigin(req.headers));
  image.headers.set("cache-control", whole ? "public, max-age=31536000, immutable" : "public, max-age=300");
  return image;
}
