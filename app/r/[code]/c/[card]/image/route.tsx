import type { NextRequest } from "next/server";

import { serveTradeCardImage } from "@/app/api/growth/cards/[id]/image/serve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * `GET /r/<code>/c/<card>/image?v=<version>` — a trade card's picture, beside
 * its page, where X and Telegram may fetch it (`robots.txt` closes `/api/`).
 * The code in the address is the page's; the picture is the card's own.
 */
export async function GET(req: NextRequest, context: { params: Promise<{ code: string; card: string }> }) {
  const { code, card } = await context.params;
  return serveTradeCardImage(req, card, { code });
}
