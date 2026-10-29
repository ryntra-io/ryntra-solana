import { NextRequest, NextResponse } from "next/server";

import { getGuardRuntime } from "@/lib/guard/runtime";
import { keepTouch } from "@/lib/growth/touch-http";
import { normalizePostCode } from "@/lib/growth/touch-param";
import { readPostCode } from "@/lib/growth/touch-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `/r/p/<code>` — the link of one post or contest the growth panel issued (Ріст 7).
 *
 * It remembers in this browser that the person came from that post, counts the visit, and sends them to the page
 * the post points at. Nothing about the person is written: the visit is a number per post per day, and the source
 * meets a wallet only when one appears in this browser (`/api/growth/touch`). A code nobody issued — mistyped,
 * random — lands on the site with nothing remembered and nothing counted, the same answer as a real one, so the
 * route is no oracle for which codes exist.
 */
export async function GET(req: NextRequest, context: { params: Promise<{ code: string }> }) {
  const { code } = await context.params;
  const normalized = normalizePostCode(code);
  const post = normalized ? await readPostCode(getGuardRuntime().store, normalized).catch(() => null) : null;
  const response = NextResponse.redirect(new URL(post?.landing ?? "/", req.url), 302);
  if (post) keepTouch(req, response, { channel: post.kind === "contest" ? "contest" : "post", source: post.code });
  /* Never cached: the answer carries a `Set-Cookie` that belongs to one browser. */
  response.headers.set("cache-control", "no-store, no-cache, must-revalidate, private");
  return response;
}
