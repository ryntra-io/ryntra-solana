import { after, NextRequest, NextResponse } from "next/server";
import { canKeepPersonalData, getSession, subjectOf } from "@/lib/session";
import { subjectKey, type AccountSubject } from "@/lib/account/subject";
import { classifyRpcFailure, recordProductEvent } from "@/lib/admin/activity";
import { getMarkets, getTakerFeeFraction } from "@/lib/arcus/public";
import { paperClose, paperJournal, paperList, paperOpen } from "@/lib/paper/rpc";
import { assessRisk, clampRiskRules } from "@/lib/risk";
import { escapeHtml, sendMessage } from "@/lib/telegram/api";
import { BETA_COPY } from "@/lib/beta/texts";
import { pickBetaLang } from "@/lib/beta/types";
import { evaluateReadiness, PLANNED_TRADE_POLICY } from "@/lib/domain/readiness";
import { claimFor } from "@/lib/domain/registry";
import { newIdempotencyKey } from "@/lib/domain/execution-safety";
import { recordFirstValueCompleted, recordFirstValueStarted } from "@/lib/growth/attribution";
import { mutationOriginAllowed } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Paper trading API for the authenticated terminal. Auth stays in the HttpOnly session cookie;
 * state-changing requests additionally require an exact same-origin browser request.
 */

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);

/* A refused rule is not an activity and a failing store is an error the
   operator sees; neither row carries the plan's numbers. */
function recordPaperFailure(subject: AccountSubject, name: "paper_plan_opened" | "paper_plan_closed" | "paper_journal_saved", error: string) {
  const failure = classifyRpcFailure(error);
  after(() => recordProductEvent({ actor: { kind: "account", ...subject }, name, outcome: failure.outcome, errorClass: failure.errorClass, surface: "app" }));
}

// Best-effort per-instance rate limit (serverless: per-warm-instance). The DB additionally
// caps open trades at 10; this throttles notification spam and rapid open/close loops.
const rateBuckets = new Map<string, number[]>();
function rateLimited(key: string, maxPerMinute = 20): boolean {
  const now = Date.now();
  const arr = (rateBuckets.get(key) ?? []).filter((t) => now - t < 60_000);
  if (arr.length >= maxPerMinute) {
    rateBuckets.set(key, arr);
    return true;
  }
  arr.push(now);
  rateBuckets.set(key, arr);
  return false;
}

/* The bot speaks to Telegram accounts only; an account without a Telegram id
   keeps its plans and gets no message. */
function notifyTelegram(telegramId: number | null, language: string | null | undefined, text: (lang: "en" | "uk" | "ru") => string): void {
  if (telegramId === null) return;
  void sendMessage(telegramId, text(pickBetaLang(language)));
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!canKeepPersonalData(session)) return NextResponse.json({ error: "not verified" }, { status: 403 });
  const r = await paperList(subjectOf(session));
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.error === "not verified" ? 403 : 500 });
  return NextResponse.json(r.data);
}

export async function POST(req: NextRequest) {
  if (!mutationOriginAllowed(req.url, req.headers.get("origin"), req.headers.get("sec-fetch-site"))) {
    return NextResponse.json({ error: "cross-site request blocked" }, { status: 403 });
  }
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!session.verified) return NextResponse.json({ error: "not verified" }, { status: 403 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const telegramId = session.telegramId;
  const subject = subjectOf(session);
  if (rateLimited(subjectKey(subject))) return NextResponse.json({ error: "slow down" }, { status: 429 });

  const action = body.action;

  if (action === "open") {
    const market = typeof body.market === "string" ? body.market : "";
    const side = body.side === "long" || body.side === "short" ? body.side : null;
    const entry = num(body.entry);
    const size = num(body.size);
    const sl = num(body.sl);
    const tp = body.tp == null ? null : num(body.tp);
    const reason = typeof body.reason === "string" ? body.reason.slice(0, 500) : "";
    const checklistRaw = Array.isArray(body.checklist) ? (body.checklist as unknown[]).slice(0, 8) : [];
    const checklist = checklistRaw
      .map((c) => c as { item?: unknown; checked?: unknown })
      .filter((c) => typeof c.item === "string")
      .map((c) => ({ item: (c.item as string).slice(0, 60), checked: c.checked === true }));

    if (!side || !entry || !size || !sl || (body.tp != null && tp === null)) {
      return NextResponse.json({ error: "bad params" }, { status: 400 });
    }
    const markets = await getMarkets().catch(() => []);
    const marketMeta = markets.find((m) => m.marketDisplayName === market);
    if (!marketMeta) {
      return NextResponse.json({ error: "unknown market" }, { status: 400 });
    }

    /* Deterministic readiness gate (lib/domain/readiness) — the SAME policy engine the domain
       tests pin, with the full planned-trade discipline: mandatory stop, real thesis, bound
       route claim from the registry (paper SmartTrade runs the arcus-perps-clob route, paper
       intent — capability gates for live execution don't apply, discipline does). */
    const crypto = (marketMeta.category ?? "").toUpperCase() === "CRYPTO";
    const readiness = evaluateReadiness(
      {
        capability: claimFor("arcus-perps-clob"),
        signals: [],
        plan: {
          thesis: reason,
          entry: String(entry),
          stop: String(sl),
          invalidation: null,
          targets: tp != null ? [String(tp)] : [],
          riskPct: null, // sized in USD, not % of account — the Risk Guard below covers loss caps
        },
        compliance: { status: "unknown", source: "unverified", checkedAt: null }, // paper never trades the venue
        intent: {
          kind: "paper-order",
          route: "arcus-perps-clob",
          instrument: { chain: "robinhood-chain", kind: crypto ? "crypto-perp" : "rwa-perp", base: market, quote: "USDG" },
          side: side === "long" ? "buy" : "sell",
          size: String(size),
          limitPrice: String(entry),
          executionMode: "wallet-signed",
          idempotencyKey: newIdempotencyKey(),
          createdAt: Date.now(),
        },
      },
      PLANNED_TRADE_POLICY
    );
    if (readiness.level === "not-ready") {
      return NextResponse.json(
        { error: `not ready: ${readiness.reasons.join(", ")}`, readiness: readiness.reasons },
        { status: 422 }
      );
    }

    // Risk Guard (server side): daily loss limit + loss-streak cooldown are soft blocks —
    // a triggered rule requires the client to send riskAck:true (explicit user acknowledgement).
    const current = await paperList(subject);
    /* First value means the user's FIRST paper plan, so a long-standing user's next trade
       must not be relabelled as newly reaching it. When the history read fails we decline to
       claim firstness rather than guess: under-counting is honest, mislabelling is not. */
    const isFirstPlan = current.ok && current.data.open.length === 0 && current.data.closed.length === 0;
    if (current.ok) {
      const maxLoss = Math.abs(entry - sl) * size;
      const rules = clampRiskRules(body.rules);
      const risk = assessRisk({ maxLoss, balance: current.data.stats.balance, closed: current.data.closed, offHours: false }, rules);
      if ((risk.dailyLossHit || risk.streakHit) && body.riskAck !== true) {
        return NextResponse.json(
          { error: "risk guard: acknowledge the risk warnings to proceed", guard: { dailyLossHit: risk.dailyLossHit, streakHit: risk.streakHit } },
          { status: 422 }
        );
      }
    }

    /* Named first value: `paper_plan`. The start is emitted here — authenticated,
       access-verified and structurally valid — and never earlier, so opening the bot or
       loading a page can never be counted as value. Both calls are fire-and-forget and
       additionally deduplicated per user in the database, so analytics can neither slow this
       path down, change what it returns, nor double-count a concurrent retry. */
    if (isFirstPlan && telegramId !== null) void recordFirstValueStarted(telegramId);

    const fee = (await getTakerFeeFraction()) * entry * size;
    const r = await paperOpen({ subject, market, side, entry, size, sl, tp, entryFee: fee, checklist, reason });
    if (!r.ok) recordPaperFailure(subject, "paper_plan_opened", r.error);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 422 });

    /* Only a persisted plan completes. A failed mutation returned above. The
       activity row carries the fact and no size, price or market. */
    if (isFirstPlan && telegramId !== null) void recordFirstValueCompleted(telegramId);
    after(() => recordProductEvent({ actor: { kind: "account", ...subject }, name: "paper_plan_opened", outcome: "ok", surface: "app", props: { first: isFirstPlan } }));

    notifyTelegram(telegramId, session.state.user.language, (lang) => BETA_COPY[lang].paperOpened(escapeHtml(market), side, entry.toLocaleString("en-US")));
    return NextResponse.json(r.data);
  }

  if (action === "close") {
    const tradeId = typeof body.tradeId === "string" && /^[0-9a-f-]{36}$/.test(body.tradeId) ? body.tradeId : null;
    const exit = num(body.exit);
    const reason = body.reason === "manual" || body.reason === "sl" || body.reason === "tp" ? body.reason : null;
    if (!tradeId || !exit || !reason) return NextResponse.json({ error: "bad params" }, { status: 400 });

    // exit fee uses the trade size — fetch it from the user's open list to compute honestly
    const list = await paperList(subject);
    if (!list.ok) return NextResponse.json({ error: list.error }, { status: 500 });
    const trade = list.data.open.find((x) => x.id === tradeId);
    if (!trade) return NextResponse.json({ error: "trade not found" }, { status: 404 });

    const fee = (await getTakerFeeFraction()) * exit * Number(trade.size);
    const r = await paperClose({ subject, tradeId, exit, exitFee: fee, reason });
    if (!r.ok) recordPaperFailure(subject, "paper_plan_closed", r.error);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 422 });
    after(() => recordProductEvent({ actor: { kind: "account", ...subject }, name: "paper_plan_closed", outcome: "ok", surface: "app", props: { reason } }));

    const pnl = Number(r.data.pnl ?? 0);
    notifyTelegram(telegramId, session.state.user.language, (lang) => BETA_COPY[lang].paperClosed(escapeHtml(r.data.market), (pnl >= 0 ? "+" : "") + pnl.toFixed(2), reason));
    return NextResponse.json(r.data);
  }

  if (action === "journal") {
    const tradeId = typeof body.tradeId === "string" && /^[0-9a-f-]{36}$/.test(body.tradeId) ? body.tradeId : null;
    if (!tradeId) return NextResponse.json({ error: "bad params" }, { status: 400 });
    const r = await paperJournal({
      subject,
      tradeId,
      followed: typeof body.followed === "boolean" ? body.followed : null,
      mistake: typeof body.mistake === "string" ? body.mistake.slice(0, 80) : null,
      lesson: typeof body.lesson === "string" ? body.lesson.slice(0, 300) : null,
    });
    if (!r.ok) recordPaperFailure(subject, "paper_journal_saved", r.error);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 422 });
    after(() => recordProductEvent({ actor: { kind: "account", ...subject }, name: "paper_journal_saved", outcome: "ok", surface: "app" }));
    return NextResponse.json(r.data);
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
