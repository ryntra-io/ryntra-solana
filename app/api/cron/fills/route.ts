import { NextRequest, NextResponse } from "next/server";
import { getFills } from "@/lib/arcus/public";
import { watchList, watchUpdate } from "@/lib/live/rpc";
import { escapeHtml, sendMessage } from "@/lib/telegram/api";
import { BETA_COPY } from "@/lib/beta/texts";
import { pickBetaLang } from "@/lib/beta/types";
import { decideBearerAuth, LEGACY_KEY_ERROR } from "@/lib/security";
import { reportError } from "@/lib/monitor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Real-fill Telegram alerts for every verified user who submitted a wallet.
 * Trigger: Vercel cron / external scheduler / admin panel — ALL via `Authorization: Bearer
 * CRON_SECRET` (Vercel cron sends that header natively). Legacy `?key=` → 401 migration error.
 * Watermark = max fill sequenceNumber per user (account_watch.last_sequence).
 * First run per user only sets the watermark (no spam backfill).
 */
export async function GET(req: NextRequest) {
  const decision = decideBearerAuth(
    { authorization: req.headers.get("authorization"), legacyKeyPresent: new URL(req.url).searchParams.has("key") },
    process.env.CRON_SECRET
  );
  if (decision === "legacy-rejected")
    return NextResponse.json({ ok: false, error: LEGACY_KEY_ERROR }, { status: 401 });
  if (decision !== "authorized") return NextResponse.json({ ok: false }, { status: 401 });

  const list = await watchList();
  if (!list.ok) return NextResponse.json({ ok: false, error: list.error }, { status: 500 });

  let notified = 0;
  const results: Record<string, string> = {};
  for (const w of list.data) {
    try {
      const fills = await getFills(w.address, 50);
      if (!fills.length) { results[String(w.telegram_id)] = "no fills"; continue; }
      const maxSeq = Math.max(...fills.map((f) => f.sequenceNumber));
      if (w.last_sequence === 0) {
        // first sighting: set watermark silently
        await watchUpdate(w.telegram_id, maxSeq);
        results[String(w.telegram_id)] = "watermark set";
        continue;
      }
      const CAP = 20;
      const freshAll = fills
        .filter((f) => f.sequenceNumber > w.last_sequence)
        .sort((a, b) => a.sequenceNumber - b.sequenceNumber);
      const fresh = freshAll.slice(0, CAP); // cap per run to avoid Telegram flood
      const capped = freshAll.length > fresh.length;
      const lang = pickBetaLang(w.language);
      for (const f of fresh) {
        const closing = f.positionEffect?.startsWith("CLOSE");
        const pnl = Number(f.closedPnl || 0);
        const text = closing
          ? BETA_COPY[lang].liveFillClosed(escapeHtml(f.marketDisplayName), (pnl >= 0 ? "+" : "") + pnl.toFixed(2), f.side, f.size, f.price)
          : BETA_COPY[lang].liveFillOpened(escapeHtml(f.marketDisplayName), f.side, f.size, f.price);
        await sendMessage(w.telegram_id, text);
        notified++;
      }
      // When capped, advance only to the last NOTIFIED fill — not maxSeq — so the fills we
      // deferred (fresh 21+) are picked up next run instead of being silently skipped.
      const advanceTo = capped ? fresh[fresh.length - 1].sequenceNumber : maxSeq;
      if (fresh.length || maxSeq > w.last_sequence) await watchUpdate(w.telegram_id, advanceTo);
      results[String(w.telegram_id)] = capped ? `${fresh.length} new (capped, ${freshAll.length - fresh.length} deferred)` : `${fresh.length} new`;
    } catch (e) {
      void reportError("cron:fills", e, { telegram_id: w.telegram_id });
      results[String(w.telegram_id)] = "error";
    }
  }
  return NextResponse.json({ ok: true, watched: list.data.length, notified, results });
}
