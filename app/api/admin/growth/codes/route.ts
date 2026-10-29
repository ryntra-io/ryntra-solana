import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getGuardRuntime } from "@/lib/guard/runtime";
import { issuePostCode, POST_KINDS, POST_NETWORKS } from "@/lib/growth/touch-store";
import { privateNoStoreHeaders } from "@/lib/http-control";
import { mutationOriginAllowed } from "@/lib/security";
import { getAdminSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST /api/admin/growth/codes` — `{ kind, network, title, landing }`: a new post or contest code for the media
 * session (Ріст 7). The link `/r/p/<code>` remembers the post in a visitor's browser until a wallet appears there.
 * A code moves no money and grants nothing, so an operator's session from this site is enough — no second factor.
 */
const json = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status, headers: privateNoStoreHeaders() });

const BodySchema = z
  .object({
    kind: z.enum(POST_KINDS),
    network: z.enum(POST_NETWORKS),
    title: z.string().min(1).max(200),
    landing: z.string().min(1).max(300),
  })
  .strict();

export async function POST(req: NextRequest) {
  if (!mutationOriginAllowed(req.url, req.headers.get("origin"), req.headers.get("sec-fetch-site"))) return json({ error: "forbidden" }, 403);
  const admin = await getAdminSession();
  if (!admin) return json({ error: "unauthorized" }, 401);
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad_json" }, 400);
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return json({ error: "bad_request" }, 400);
  try {
    const outcome = await issuePostCode(getGuardRuntime().store, { ...parsed.data, createdBy: `admin:${admin}`, now: new Date().toISOString() });
    if (!outcome.ok) return json({ error: outcome.reason }, outcome.reason === "busy" ? 503 : 400);
    return json({ ok: true, post: outcome.post });
  } catch {
    return json({ error: "unavailable" }, 503);
  }
}
