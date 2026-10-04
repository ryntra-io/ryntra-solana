import { NextRequest, NextResponse } from "next/server";
import { watchList, watchRecapUpdate } from "@/lib/live/rpc";
import { paperList } from "@/lib/paper/rpc";
import { buildRecap } from "@/lib/journal/recap";
import { sendMessage } from "@/lib/telegram/api";
import { BETA_COPY } from "@/lib/beta/texts";
import { pickBetaLang } from "@/lib/beta/types";
import { decideBearerAuth, LEGACY_KEY_ERROR } from "@/lib/security";
import { reportError } from "@/lib/monitor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Daily discipline recap DM. One calm digest per active paper-trader: adherence % leads, one
 * constructive next-step, discipline register — never profit.
 * Trigger: Vercel cron / manual — via `Authorization: Bearer CRON_SECRET` only (Vercel cron
 * sends that header natively). Legacy `?key=` → 401 migration error, never accepted.
 * Scope note: iterates account_watch (verified users who submitted a wallet) — the engaged cohort;
 * a broader "all verified users" list needs its own RPC (follow-up).
 *
 * Anti-spam: paper_list stats are LIFETIME-cumulative, so we send ONLY when the user has closed a
 * new trade since their last recap (`trades > last_recap_trades`), then advance the watermark. That
 * also makes a same-evening re-fire (at-least-once cron delivery / manual retest) a no-op, so a user
 * never gets two recaps for the same activity.
 */
const fmtPct = (n: number | null) => (n == null ? "—" : `${Math.round(n)}%`);

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

  let sent = 0;
  const results: Record<string, string> = {};
  for (const w of list.data) {
    try {
      const paper = await paperList({ accountId: null, telegramId: w.telegram_id });
      if (!paper.ok) { results[String(w.telegram_id)] = "no paper"; continue; }
      const s = paper.data.stats;
      const recap = buildRecap({
        adherencePct: s.adherence_pct,
        winRatePct: s.win_rate,
        trades: s.trades,
        journaled: s.journaled,
      });
      // Send only on genuinely new activity since the last recap; skip otherwise (no daily spam).
      if (!recap || s.trades <= w.last_recap_trades) {
        // keep the watermark in sync (e.g. a paper reset dropped the count) without pinging.
        if (s.trades !== w.last_recap_trades) await watchRecapUpdate(w.telegram_id, s.trades);
        results[String(w.telegram_id)] = recap ? "no new activity" : "nothing to recap";
        continue;
      }
      const lang = pickBetaLang(w.language);
      await sendMessage(
        w.telegram_id,
        BETA_COPY[lang].dailyRecap({
          adherence: fmtPct(recap.adherencePct),
          winRate: fmtPct(recap.winRatePct),
          trades: recap.trades,
          unreviewed: recap.unreviewed,
          advice: recap.advice,
        })
      );
      // Advance the watermark BEFORE counting success so a re-fire this evening finds nothing new.
      await watchRecapUpdate(w.telegram_id, s.trades);
      sent++;
      results[String(w.telegram_id)] = `sent (${recap.advice})`;
    } catch (e) {
      void reportError("cron:recap", e, { telegram_id: w.telegram_id });
      results[String(w.telegram_id)] = "error";
    }
  }
  return NextResponse.json({ ok: true, watched: list.data.length, sent, results });
}
