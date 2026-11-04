import { NextRequest, NextResponse } from "next/server";

import { reportError } from "@/lib/monitor";
import { decideBearerAuth, decideWebhookSecret, LEGACY_KEY_ERROR } from "@/lib/security";
import { handleWardUpdate, type TgWardUpdate } from "@/lib/ward-bot/bot";
import { WARD_BOT_WORDS } from "@/lib/ward-bot/words";
import { wardBotConfigured, wardBotDeps, wardBotSecret, wardBotTelegram } from "@/lib/ward-bot/runtime.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/* One check reads the chain and the engine's sources; the bot gives up on it after 20 s. */
export const maxDuration = 30;

/** What the bot asks Telegram to deliver: messages, and being added to a group (for its one-line introduction). */
const UPDATES = ["message", "my_chat_member"] as const;

/**
 * The pre-sign check's Telegram bot — webhook (CITY-166; `lib/ward-bot/**`). A bot of its own, beside the assistant's
 * (`/api/telegram`): someone pastes an address, a CA, a link or a transaction, the bot answers with the engine's verdict
 * in one line. It reads only.
 *
 * Ops (the owner's — the token, @BotFather and adding the bot to groups are theirs):
 *   - env: TELEGRAM_WARD_BOT_TOKEN, TELEGRAM_WARD_WEBHOOK_SECRET;
 *   - register the webhook, commands and description:
 *       curl -H "Authorization: Bearer $TELEGRAM_WARD_WEBHOOK_SECRET" "https://ryntra.io/api/ward-bot?action=setup"
 *   - diagnostics: the same with ?action=info. Secrets never ride in URLs.
 *   - in @BotFather, /setprivacy → Disable lets the bot see pasted addresses in a group; with privacy on it answers
 *     /check and replies to itself only.
 */
export async function POST(req: NextRequest) {
  /* Fail closed: without a secret no update is accepted; auth runs before anything else. */
  const decision = decideWebhookSecret(req.headers.get("x-telegram-bot-api-secret-token"), wardBotSecret());
  if (decision === "unconfigured") return NextResponse.json({ ok: false, error: "webhook not configured" }, { status: 503 });
  if (decision !== "authorized") return NextResponse.json({ ok: false }, { status: 401 });

  let update: TgWardUpdate;
  try {
    update = (await req.json()) as TgWardUpdate;
  } catch {
    return NextResponse.json({ ok: true });
  }
  try {
    await handleWardUpdate(update, wardBotDeps());
  } catch (failure) {
    void reportError("ward-bot:handler", failure, { update_id: typeof update?.update_id === "number" ? update.update_id : null });
  }
  /* Always 200: Telegram redelivers anything else. */
  return NextResponse.json({ ok: true });
}

/**
 * Operator setup and diagnostics, with `Authorization: Bearer <TELEGRAM_WARD_WEBHOOK_SECRET>` and a non-secret
 * `?action=info|setup`. An unauthenticated GET has no effect outside this server.
 */
export async function GET(req: NextRequest) {
  const params = new URL(req.url).searchParams;
  const decision = decideBearerAuth({ authorization: req.headers.get("authorization"), legacyKeyPresent: params.has("setup") || params.has("info") }, wardBotSecret());
  if (decision === "legacy-rejected") return NextResponse.json({ ok: false, error: LEGACY_KEY_ERROR }, { status: 401 });
  if (decision !== "authorized") return NextResponse.json({ ok: false }, { status: 401 });

  const telegram = wardBotTelegram();
  const action = params.get("action");
  if (action === "info") {
    const [webhookInfo, me] = await Promise.all([telegram.call("getWebhookInfo", {}), telegram.call<{ username?: string }>("getMe", {})]);
    return NextResponse.json({ ok: true, configured: wardBotConfigured(), bot: me?.username ?? null, webhookInfo });
  }
  if (action === "setup") {
    const webhookUrl = new URL("/api/ward-bot", req.url).toString();
    /* The backlog is dropped: a group is never flooded with verdicts on yesterday's messages. */
    const webhook = await telegram.call("setWebhook", { url: webhookUrl, secret_token: wardBotSecret(), allowed_updates: UPDATES, drop_pending_updates: true });
    const profile = await Promise.all(
      (["en", "uk"] as const).map(async (lang) => {
        const words = WARD_BOT_WORDS[lang];
        const scope = lang === "en" ? {} : { language_code: lang };
        const commands = [
          { command: "check", description: words.commands.check },
          { command: "help", description: words.commands.help },
        ];
        const [setCommands, setShort, setLong] = await Promise.all([
          telegram.call("setMyCommands", { commands, ...scope }),
          telegram.call("setMyShortDescription", { short_description: words.shortDescription, ...scope }),
          telegram.call("setMyDescription", { description: words.intro, ...scope }),
        ]);
        return { lang, commands: setCommands !== null, shortDescription: setShort !== null, description: setLong !== null };
      }),
    );
    return NextResponse.json({ ok: true, webhookUrl, setWebhook: webhook !== null, profile });
  }
  return NextResponse.json({ ok: true, configured: wardBotConfigured() });
}
