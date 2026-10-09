import type { NextRequest } from "next/server";

import { serveTradeCardImage } from "./serve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * `GET /api/growth/cards/<id>/image` — the first address of a card's picture,
 * kept for links already shared: it sends to the current one beside the
 * card's page (`serve.ts` says why).
 */
export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return serveTradeCardImage(req, id, null);
}
