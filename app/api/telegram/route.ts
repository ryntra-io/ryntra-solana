import { NextRequest, NextResponse } from "next/server";
import { markUpdate } from "@/lib/beta/rpc";
import { handleUpdate, type TgUpdate } from "@/lib/telegram/handlers";
import { isChannelAdmin, tg } from "@/lib/telegram/api";
import { LINKS } from "@/lib/beta/types";
import { ensureBotProfile, ensureBotProfileOnce } from "@/lib/assistant/telegram/profile";
import { decideBearerAuth, decideWebhookSecret, LEGACY_KEY_ERROR } from "@/lib/security";
import { reportError } from "@/lib/monitor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/* AI-07: an update may be a question to the model or a voice message heard on the server — the agent's own minute. */
export const maxDuration = 60;

/**
 * Ryntra's bot ( @RyntraBeta_bot ) webhook — since AI-07 the assistant «Ryntra»
 * in Telegram (lib/telegram/handlers.ts → lib/assistant/telegram/**): /start,
 * questions and voice for a chat bound to an account in Settings, /watch
 * /plans /brief /credits /settings /help, the notifications' buttons.
 *
 * Ops:
 *   - env: TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, BETA_APP_SECRET, BETA_TOKEN_SECRET
 *   - after every webhook-shape change: admin sends /setup to the bot
 *     (re-registers webhook with message + callback_query and refreshes commands),
 *     or: curl -H "Authorization: Bearer $TELEGRAM_WEBHOOK_SECRET" ".../api/telegram?action=setup"
 *   - diagnostics: same, with ?action=info. Secrets never ride in URLs.
 */

const SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;

// Self-healing webhook config: once per cold start make sure Telegram delivers
// callback_query (inline buttons) too. The very first registration only allowed
// "message", and allowed_updates persists on Telegram's side until changed.
let webhookChecked = false;
async function ensureWebhookConfig(reqUrl: string) {
  if (webhookChecked) return;
  if (!SECRET) return; // never (re-)register a webhook without a secret_token — that would fail-open
  webhookChecked = true;
  const target = new URL("/api/telegram", reqUrl);
  if (target.hostname !== "ryntra.io") return; // never re-point the webhook from preview deployments
  /* AI-07: the bot's profile and commands, set by the bot itself once per instance (no BotFather). */
  await ensureBotProfileOnce(tg);
  const wi = await tg<{ url?: string; allowed_updates?: string[] }>("getWebhookInfo", {});
  if (!wi) return;
  const allowed = wi.allowed_updates ?? [];
  if (wi.url !== target.toString() || !allowed.includes("callback_query") || !allowed.includes("message")) {
    const r = await tg("setWebhook", {
      url: target.toString(),
      secret_token: SECRET,
      allowed_updates: ["message", "callback_query"],
    });
    console.log("telegram webhook re-registered:", r !== null);
  }
}

export async function POST(req: NextRequest) {
  // FAIL-CLOSED: an unset secret means the webhook is misconfigured — refuse (503), never accept
  // an unauthenticated update. Auth runs BEFORE any side effect (ensureWebhookConfig).
  const decision = decideWebhookSecret(req.headers.get("x-telegram-bot-api-secret-token"), SECRET);
  if (decision === "unconfigured")
    return NextResponse.json({ ok: false, error: "webhook not configured" }, { status: 503 });
  if (decision !== "authorized") return NextResponse.json({ ok: false }, { status: 401 });

  await ensureWebhookConfig(req.url);

  let update: TgUpdate;
  try {
    update = (await req.json()) as TgUpdate;
  } catch {
    return NextResponse.json({ ok: true });
  }

  // Idempotency: Telegram retries deliveries; process each update once.
  if (typeof update.update_id === "number") {
    const firstTime = await markUpdate(update.update_id);
    if (!firstTime) return NextResponse.json({ ok: true });
  }

  try {
    await handleUpdate(update);
  } catch (e) {
    void reportError("telegram:handler", e, { update_id: update.update_id });
  }
  // Always 200 fast so Telegram doesn't retry.
  return NextResponse.json({ ok: true });
}

/**
 * Operator diagnostics/setup. Auth via `Authorization: Bearer <TELEGRAM_WEBHOOK_SECRET>`;
 * the action is a NON-secret query flag: `?action=info` or `?action=setup`.
 * Legacy `?info=<secret>` / `?setup=<secret>` → 401 migration error (secrets never ride URLs).
 *   curl -H "Authorization: Bearer $TELEGRAM_WEBHOOK_SECRET" "https://ryntra.io/api/telegram?action=info"
 */
export async function GET(req: NextRequest) {
  // Bearer auth BEFORE any Telegram API call or ensureWebhookConfig — an unauthenticated GET
  // must have zero external side effects.
  const params = new URL(req.url).searchParams;
  const legacyPresent = params.has("setup") || params.has("info");
  const decision = decideBearerAuth(
    { authorization: req.headers.get("authorization"), legacyKeyPresent: legacyPresent },
    SECRET
  );
  if (decision === "legacy-rejected")
    return NextResponse.json({ ok: false, error: LEGACY_KEY_ERROR }, { status: 401 });
  if (decision !== "authorized") return NextResponse.json({ ok: false }, { status: 401 });
  await ensureWebhookConfig(req.url);
  const action = params.get("action");

  if (action === "info") {
    const wi = await tg("getWebhookInfo", {});
    const self = await tg<{ id: number; username: string }>("getMe", {});
    const botIsChannelAdmin = self ? await isChannelAdmin(LINKS.channelHandle, self.id) : null;
    return NextResponse.json({ ok: true, webhookInfo: wi, bot: self?.username, botIsChannelAdmin });
  }

  if (action === "setup") {
    const webhookUrl = new URL("/api/telegram", req.url).toString();
    const wh = await tg("setWebhook", {
      url: webhookUrl,
      secret_token: SECRET,
      allowed_updates: ["message", "callback_query"],
    });
    /* AI-07: the assistant's profile and commands, read and written where they differ (lib/assistant/telegram/profile.ts). */
    const profile = await ensureBotProfile(tg);
    const wi = await tg("getWebhookInfo", {});
    return NextResponse.json({ ok: true, webhookUrl, setWebhook: wh !== null, profile, webhookInfo: wi });
  }

  return NextResponse.json({ ok: true, bot: "@RyntraBeta_bot", configured: Boolean(process.env.TELEGRAM_BOT_TOKEN) });
}
