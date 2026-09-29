import { NextRequest, NextResponse } from "next/server";
import { getSession, hasTelegramId, subjectOf } from "@/lib/session";
import { subjectArgs, type AccountSubject } from "@/lib/account/subject";
import { setWallet } from "@/lib/beta/rpc";
import { rpcResult } from "@/lib/supabase-rpc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function setLanguage(subject: AccountSubject, language: string): Promise<boolean> {
  const r = await rpcResult<unknown>("settings", "beta_set_language", { ...subjectArgs(subject), p_language: language });
  return r.ok;
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  /* Every write in this route resolves through a Telegram id, so a wallet-only
     account is refused once here rather than at each branch. It is a 409 and
     not a 401 or 403 on purpose: the caller is authenticated and permitted —
     the account simply has no id for these two RPCs to key on, and inventing a
     synthetic one is the thing `RYN-ACCESS-001` refused to do. The refusal
     names what is unavailable so the surface can say it in place instead of
     showing a failed save. */
  if (!hasTelegramId(session)) {
    return NextResponse.json(
      {
        error: "unavailable for a wallet account",
        detail:
          "Language and linked-wallet settings still resolve through a Telegram id. You are signed in; these two writes are not available for this account yet.",
      },
      { status: 409 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  if (body.language) {
    const lang = body.language;
    if (lang !== "en" && lang !== "uk" && lang !== "ru") return NextResponse.json({ error: "bad language" }, { status: 400 });
    const ok = await setLanguage(subjectOf(session), lang);
    if (!ok) return NextResponse.json({ error: "failed" }, { status: 500 });
  }

  if (body.wallet) {
    const wallet = typeof body.wallet === "string" ? body.wallet.trim() : "";
    if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) return NextResponse.json({ error: "bad wallet" }, { status: 400 });
    const r = await setWallet(session.telegramId, wallet);
    if (!r) return NextResponse.json({ error: "failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
