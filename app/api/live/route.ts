import { after, NextRequest, NextResponse } from "next/server";
import { canKeepPersonalData, getSession, subjectOf } from "@/lib/session";
import { classifyRpcFailure, recordProductEvent } from "@/lib/admin/activity";
import { liveNoteUpsert, liveNotesList } from "@/lib/live/rpc";
import { mutationOriginAllowed } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Journal notes on real fills. Auth stays in the HttpOnly session cookie. */

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!canKeepPersonalData(session)) return NextResponse.json({ error: "not verified" }, { status: 403 });
  const r = await liveNotesList(subjectOf(session));
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.error === "not verified" ? 403 : 500 });
  return NextResponse.json(r.data);
}

export async function POST(req: NextRequest) {
  if (!mutationOriginAllowed(req.url, req.headers.get("origin"), req.headers.get("sec-fetch-site"))) {
    return NextResponse.json({ error: "cross-site request blocked" }, { status: 403 });
  }
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!canKeepPersonalData(session)) return NextResponse.json({ error: "not verified" }, { status: 403 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const subject = subjectOf(session);

  const tradeId = typeof body.tradeId === "string" && /^[\w-]{1,64}$/.test(body.tradeId) ? body.tradeId : null;
  if (!tradeId) return NextResponse.json({ error: "bad params" }, { status: 400 });

  const r = await liveNoteUpsert({
    subject,
    tradeId,
    market: typeof body.market === "string" ? body.market.slice(0, 20) : null,
    side: typeof body.side === "string" ? body.side.slice(0, 10) : null,
    pnl: typeof body.pnl === "number" && Number.isFinite(body.pnl) ? body.pnl : null,
    followed: typeof body.followed === "boolean" ? body.followed : null,
    mistake: typeof body.mistake === "string" ? body.mistake.slice(0, 80) : null,
    lesson: typeof body.lesson === "string" ? body.lesson.slice(0, 300) : null,
  });
  if (!r.ok) {
    const failure = classifyRpcFailure(r.error);
    after(() => recordProductEvent({ actor: { kind: "account", ...subject }, name: "journal_note_saved", outcome: failure.outcome, errorClass: failure.errorClass, surface: "app" }));
    return NextResponse.json({ error: r.error }, { status: 422 });
  }
  /* The note's P&L, market and text stay in the journal; the activity row is the fact alone. */
  after(() => recordProductEvent({ actor: { kind: "account", ...subject }, name: "journal_note_saved", outcome: "ok", surface: "app" }));
  return NextResponse.json(r.data);
}
