import { NextRequest, NextResponse } from "next/server";

import { requireFreshMfa } from "@/lib/admin/auth";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { privateNoStoreHeaders } from "@/lib/http-control";
import { launchNetwork } from "@/lib/launch/config.server";
import { switchAdmitted } from "@/lib/launch/executor-admin.server";
import { listTakedowns, restoreLaunch, takeDownLaunch } from "@/lib/launch/takedown.server";
import { mutationOriginAllowed } from "@/lib/security";
import { getAdminSession, getAdminSessionDetail } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * MC-1 — a launched token's picture, description and links taken down by the operator, or put back (`takedown.server.ts`).
 * GET lists what is down. POST `{ action: "take-down", token, reason }` hides; `{ action: "restore", token }` puts back.
 * Taking down protects people, so the operator's own door (the bot's Telegram link) is enough, as for the executor's
 * stop; putting back needs a fresh second factor. The rows themselves are the record: who took down and who put back,
 * when and why.
 */
export async function GET() {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: privateNoStoreHeaders() });
  try {
    return NextResponse.json({ takedowns: await listTakedowns(getGuardRuntime().store) }, { headers: privateNoStoreHeaders() });
  } catch {
    return NextResponse.json({ error: "unavailable" }, { status: 503, headers: privateNoStoreHeaders() });
  }
}

export async function POST(req: NextRequest) {
  if (!mutationOriginAllowed(req.url, req.headers.get("origin"), req.headers.get("sec-fetch-site"))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403, headers: privateNoStoreHeaders() });
  }
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400, headers: privateNoStoreHeaders() });
  }
  const action = body.action === "take-down" || body.action === "restore" ? body.action : null;
  const token = typeof body.token === "string" && MINT.test(body.token) ? body.token : null;
  const reason = typeof body.reason === "string" ? body.reason.replace(/\s+/g, " ").trim().slice(0, 300) : "";
  if (!action || !token || (action === "take-down" && reason.length < 3)) return NextResponse.json({ error: "bad params" }, { status: 400, headers: privateNoStoreHeaders() });
  const gate = await requireFreshMfa();
  const admitted = action === "restore" ? (gate.ok && !gate.transitional ? { telegramId: gate.admin.telegramId } : null) : switchAdmitted(gate, gate.ok ? null : await getAdminSessionDetail());
  if (!admitted) return NextResponse.json({ error: gate.ok ? "unauthorized" : gate.reason }, { status: !gate.ok && gate.reason === "reverify" ? 403 : 401, headers: privateNoStoreHeaders() });
  const network = launchNetwork();
  if (!network) return NextResponse.json({ error: "launch_unavailable" }, { status: 503, headers: privateNoStoreHeaders() });
  const deps = { store: getGuardRuntime().store, cluster: network.cluster, origin: network.origin };
  try {
    const result =
      action === "take-down"
        ? await takeDownLaunch(deps, { token, reason, by: `telegram:${admitted.telegramId}`, at: new Date().toISOString() })
        : await restoreLaunch(deps, token, { by: `telegram:${admitted.telegramId}`, at: new Date().toISOString() });
    if (!result.ok) return NextResponse.json({ error: result.code === "NOT_FOUND" ? "not_found" : "not_ours" }, { status: 404, headers: privateNoStoreHeaders() });
    return NextResponse.json(result, { headers: privateNoStoreHeaders() });
  } catch {
    return NextResponse.json({ error: "unavailable" }, { status: 503, headers: privateNoStoreHeaders() });
  }
}
