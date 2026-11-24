import { NextResponse } from "next/server";

import { isCardId, postUrl, readCard } from "@/lib/agent-drive/card";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { privateNoStoreHeaders } from "@/lib/http-control";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * «Share on X» from a note: X's composer opens with the closed trade's own words and its card's page — one tap from
 * Telegram or the phone, and the person posts it herself. The words come from the kept card, never from the address.
 * A card that is not there sends her to Ryntra. Reads only.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const lang = new URL(request.url).searchParams.get("l") === "uk" ? "uk" : "en";
  const card = isCardId(id) ? await readCard(getGuardRuntime().store, id).catch(() => null) : null;
  const target = card ? postUrl(card, lang) : new URL("/", request.url).toString();
  return NextResponse.redirect(target, { status: 302, headers: privateNoStoreHeaders() });
}
