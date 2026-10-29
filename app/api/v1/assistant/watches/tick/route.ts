import { NextRequest, NextResponse } from "next/server";

import { ensureBotProfileOnce } from "@/lib/assistant/telegram/profile";
import { runWatches } from "@/lib/assistant/watch/runtime.server";
import { tg } from "@/lib/telegram/api";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { reportError } from "@/lib/monitor";
import { decideBearerAuth, LEGACY_KEY_ERROR } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * «Стежити за токеном»'s cron (AI-05), every minute: every token watched is
 * read once for everyone, every watch judged without a model, a note written
 * for each that rang and its deliveries queued for the monitoring cron to
 * send. Internal — the cron's bearer only, not part of the public contract.
 * Signs, sends money and trades nothing.
 */
export async function GET(req: NextRequest) {
  const decision = decideBearerAuth(
    { authorization: req.headers.get("authorization"), legacyKeyPresent: new URL(req.url).searchParams.has("key") },
    process.env.CRON_SECRET,
  );
  if (decision === "legacy-rejected") return NextResponse.json({ ok: false, error: LEGACY_KEY_ERROR }, { status: 401 });
  if (decision !== "authorized") return NextResponse.json({ ok: false }, { status: 401 });
  const guard = getGuardRuntime();
  if (!guard.writes.allowed) return NextResponse.json({ ok: true, skipped: "read-only" });
  /* AI-07: once per instance, the bot's profile and commands made right by the bot itself — bounded, never the pass's failure. */
  if (process.env.TELEGRAM_BOT_TOKEN && (process.env.VERCEL_ENV === "production" || !process.env.VERCEL)) await Promise.race([ensureBotProfileOnce(tg), new Promise((settle) => setTimeout(settle, 12_000))]).catch(() => undefined);
  try {
    const run = await runWatches(guard.store);
    return NextResponse.json({ ok: true, ...run });
  } catch (error) {
    /* A pass that failed whole is taken again a minute on; nothing it wrote is written twice. */
    void reportError("cron:assistant-watches", error, {});
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
