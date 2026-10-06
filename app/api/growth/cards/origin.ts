import type { NextRequest } from "next/server";

import { SITE } from "@/app/seo";

/**
 * The address a card's link and QR carry: always `https://ryntra.io` in
 * production, whatever host the request came through — the picture is
 * cached for a year, so it must carry the one address people share — and
 * the address a preview or the stand was reached at elsewhere, so a card made
 * there opens there.
 */
export function cardOrigin(headers: Headers): string {
  if (process.env.VERCEL_ENV === "production") return SITE;
  const host = headers.get("x-forwarded-host") ?? headers.get("host") ?? new URL(SITE).host;
  const proto = headers.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}

/** The same, from a route's request. */
export function publicOrigin(req: NextRequest): string {
  return cardOrigin(req.headers);
}
