import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { sendMessage } from "@/lib/telegram/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* Session-authed self-notification: the cabinet DMs the OWN user via the bot
   (e.g. a conditional spot order triggered). Never messages anyone else. */

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 5;
const buckets = new Map<number, number[]>();

/** Allowed templates only — the client picks a kind, never free-form bot text. */
function render(kind: string, p: Record<string, string>): string | null {
  const t = (s?: string) => (s ?? "").slice(0, 40).replace(/[^\w .,:$%→\-()/]/g, "");
  if (kind === "spot-order-triggered") {
    return `🔔 ${t(p.label)} ${t(p.ticker)} triggered at $${t(p.price)}.\nOpen Ryntra to sign the prepared swap — nothing executes without your wallet.`;
  }
  return null;
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.verified) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const now = Date.now();
  const hits = (buckets.get(session.telegramId) ?? []).filter((ts) => now - ts < WINDOW_MS);
  if (hits.length >= MAX_PER_WINDOW) return NextResponse.json({ error: "rate limited" }, { status: 429 });
  hits.push(now);
  buckets.set(session.telegramId, hits);

  let body: { kind?: string; params?: Record<string, string> };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const text = render(String(body.kind ?? ""), body.params ?? {});
  if (!text) return NextResponse.json({ error: "unknown kind" }, { status: 400 });

  try {
    await sendMessage(session.telegramId, text);
  } catch { /* bot down — notification is best-effort */ }
  return NextResponse.json({ ok: true });
}
