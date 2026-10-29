import { NextRequest, NextResponse } from "next/server";

import { requireFreshMfa } from "@/lib/admin/auth";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { readReviewQueue } from "@/lib/growth/review-queue";
import { protectDeps } from "@/lib/growth/protect-deps.server";
import { revealSource } from "@/lib/growth/protect-store";
import { actOnCase, markHub, type ReviewAction } from "@/lib/growth/review-store";
import { REVIEW_DECISIONS, type ReviewDecision } from "@/lib/growth/review";
import { SIGNAL_HASH } from "@/lib/growth/protect";
import { privateNoStoreHeaders } from "@/lib/http-control";
import { mutationOriginAllowed } from "@/lib/security";
import { getAdminSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/* A look at a shared source reads the chain again: give it time. */
export const maxDuration = 300;

/**
 * The review queue of the Growth line's protection (S10): the cases and the
 * partners' pools (GET), and the reviewer's steps (POST) — decide a case
 * (clear, adjust to an amount, cancel), freeze or lift a freeze, look at the
 * address behind a shared source, and mark it an exchange or a bridge (or lift
 * the mark). Every step needs a fresh second
 * factor and a reason, and stands in the case's own log for good.
 */
const json = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status, headers: privateNoStoreHeaders() });

export async function GET() {
  const admin = await getAdminSession();
  if (!admin) return json({ error: "unauthorized" }, 401);
  try {
    return json({ ...(await readReviewQueue(getGuardRuntime().store, { now: new Date().toISOString() })) });
  } catch {
    return json({ error: "unavailable" }, 503);
  }
}

/** Dollars as the reviewer types them ("12.5") to micro-units; null when not an amount. */
function usdToMicros(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).trim().replace(",", ".");
  const match = /^(\d{1,9})(?:\.(\d{1,6}))?$/.exec(text);
  if (!match) return null;
  return (BigInt(match[1]!) * 1_000_000n + BigInt((match[2] ?? "").padEnd(6, "0"))).toString();
}

export async function POST(req: NextRequest) {
  if (!mutationOriginAllowed(req.url, req.headers.get("origin"), req.headers.get("sec-fetch-site"))) return json({ error: "forbidden" }, 403);
  const gate = await requireFreshMfa();
  if (!gate.ok) return json({ error: gate.reason }, gate.reason === "reverify" ? 403 : 401);
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await req.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return json({ error: "bad json" }, 400);
    body = parsed as Record<string, unknown>;
  } catch {
    return json({ error: "bad json" }, 400);
  }
  const by = `admin:${gate.admin.telegramId}`;
  const store = getGuardRuntime().store;
  const now = new Date().toISOString();
  /* A look before a mark: the address behind a shared source's hash, read again from the chain, shown once, kept nowhere. */
  if (body.action === "reveal") {
    if (typeof body.hash !== "string" || !SIGNAL_HASH.test(body.hash) || typeof body.pool !== "string" || (body.network !== "solana" && body.network !== "arc")) return json({ error: "bad_request" }, 400);
    const deps = protectDeps(store);
    if (!deps) return json({ error: "no_key" }, 503);
    try {
      return json({ ok: true, address: await revealSource(store, deps, { network: body.network, pool: body.pool, hash: body.hash, by }) });
    } catch {
      return json({ error: "unavailable" }, 503);
    }
  }
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (!note) return json({ error: "reason_required" }, 400);
  try {
    if (body.action === "hub" || body.action === "unhub") {
      if (typeof body.hash !== "string" || !SIGNAL_HASH.test(body.hash)) return json({ error: "bad_hash" }, 400);
      const marked = await markHub(store, { hash: body.hash, note, by, now, marked: body.action === "hub" });
      return marked.ok ? json({ ok: true, created: marked.created }) : json({ error: "bad_request" }, 400);
    }
    if (typeof body.subject !== "string") return json({ error: "bad_subject" }, 400);
    let action: ReviewAction;
    if (body.action === "freeze") action = { kind: "FREEZE", note };
    else if (body.action === "unfreeze") action = { kind: "UNFREEZE", note };
    else if (body.action === "decide" && (REVIEW_DECISIONS as readonly string[]).includes(String(body.decision))) {
      const decision = body.decision as ReviewDecision;
      const ceiling = decision === "ADJUST" ? usdToMicros(body.ceilingUsd) : null;
      if (decision === "ADJUST" && ceiling === null) return json({ error: "bad_amount" }, 400);
      /* The last event the reviewer saw: a case that moved on since is refused, never decided blind. */
      if (typeof body.seen !== "number" || !Number.isInteger(body.seen) || body.seen < 0) return json({ error: "bad_seen" }, 400);
      action = { kind: "DECIDE", decision, note, seen: body.seen, ...(ceiling !== null ? { ceilingUsdMicros: ceiling } : {}) };
    } else return json({ error: "bad_action" }, 400);
    const outcome = await actOnCase(store, { subject: body.subject, action, by, now });
    if (!outcome.ok) return json({ error: outcome.code }, outcome.code === "UNAVAILABLE" ? 503 : 409);
    return json({ ok: true, event: outcome.event, state: outcome.view.state });
  } catch {
    return json({ error: "unavailable" }, 503);
  }
}
