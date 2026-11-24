import { NextRequest, NextResponse } from "next/server";

import { runAgentDrive } from "@/lib/agent-drive/drive.server";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { privateNoStoreHeaders } from "@/lib/http-control";
import { reportError } from "@/lib/monitor";
import { decideBearerAuth, LEGACY_KEY_ERROR } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The agent's drive, every minute: each new move of the agent — bought, sold, paused, stopped — told once to the person
 * at once, with «Stop agent» under it, and on Monday at her hour her agents' week. Through the engine's inbox and
 * delivery: Telegram, the phone's push, the browser's push. Internal — the cron's bearer only. Shut unless
 * `RYNTRA_AGENT_DRIVE=on`. Signs, sends money and trades nothing.
 */
export async function GET(req: NextRequest) {
  const decision = decideBearerAuth({ authorization: req.headers.get("authorization"), legacyKeyPresent: req.nextUrl.searchParams.has("key") }, process.env.CRON_SECRET);
  if (decision === "legacy-rejected") return NextResponse.json({ ok: false, error: LEGACY_KEY_ERROR }, { status: 401, headers: privateNoStoreHeaders() });
  if (decision !== "authorized") return NextResponse.json({ ok: false }, { status: 401, headers: privateNoStoreHeaders() });
  try {
    const answer = await runAgentDrive(process.env, getGuardRuntime());
    return NextResponse.json({ ok: true, ...answer }, { headers: privateNoStoreHeaders() });
  } catch (error) {
    /* A pass that failed whole is taken again next minute: a move is told by its identity, once, whenever it is seen. */
    void reportError("cron:agent-drive", error, {});
    return NextResponse.json({ ok: false }, { status: 500, headers: privateNoStoreHeaders() });
  }
}
