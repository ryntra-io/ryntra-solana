import { NextRequest, NextResponse } from "next/server";

import {
  disconnectTelegramChannel,
  issueTelegramConnectCode,
  readTelegramChannel,
  telegramChannelView,
  telegramConnectLink,
} from "@/lib/account/notifications";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { privateNoStoreHeaders } from "@/lib/http-control";
import { mutationOriginAllowed } from "@/lib/security";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The account's notification channel — Telegram, connected from Settings.
 *
 * `GET` says whether a chat is connected and which handle, never the id.
 * `POST start` mints the signed code the bot will read from its `start`
 * payload and returns the link; `POST disconnect` removes the channel. All
 * three need the account session that the wallet's signature opened.
 */
function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: privateNoStoreHeaders() });
}

export async function GET() {
  const session = await getSession();
  if (!session?.accountId) return json({ error: "unauthorized" }, 401);
  const channel = await readTelegramChannel(getGuardRuntime().store, session.accountId);
  return json({ ok: true, telegram: telegramChannelView(channel) });
}

export async function POST(req: NextRequest) {
  if (!mutationOriginAllowed(req.url, req.headers.get("origin"), req.headers.get("sec-fetch-site"))) {
    return json({ error: "forbidden" }, 403);
  }
  const session = await getSession();
  if (!session?.accountId) return json({ error: "unauthorized" }, 401);
  let body: { action?: unknown };
  try {
    body = (await req.json()) as { action?: unknown };
  } catch {
    return json({ error: "bad json" }, 400);
  }
  const store = getGuardRuntime().store;
  if (body.action === "start") {
    const code = issueTelegramConnectCode(session.accountId);
    if (!code) return json({ error: "unavailable" }, 503);
    return json({ ok: true, link: telegramConnectLink(code) });
  }
  if (body.action === "disconnect") {
    const removed = await disconnectTelegramChannel(store, session.accountId);
    if (!removed) return json({ error: "unavailable" }, 503);
    return json({ ok: true, telegram: telegramChannelView(null) });
  }
  return json({ error: "bad params" }, 400);
}
