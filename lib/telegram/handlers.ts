import { randomUUID } from "node:crypto";

import { BETA_COPY } from "@/lib/beta/texts";
import { pickBetaLang, type BetaLang, type BetaState } from "@/lib/beta/types";
import { getState, metrics, setTask, setWallet, upsertUser } from "@/lib/beta/rpc";
import { adminSessionUrl, demoUrl, statusPageUrl } from "@/lib/beta/token";
import { recordAccessConfirmed, recordBotStart } from "@/lib/growth/attribution";
import { isAdminOperator, getFeedbackDraft, getNotificationPrefs, openFeedbackThread, setFeedbackDraft, setNotificationPrefs } from "@/lib/admin/store";
import { isFeedbackCategory, publicFeedbackRef, sanitizeFeedbackBody } from "@/lib/admin/feedback";
import {
  isNotificationKey,
  NOTIFICATION_COPY,
  settingsBody,
  settingsButtons,
  togglePref,
} from "@/lib/admin/notifications";
import { connectTelegramChannel, isTelegramConnectCode, verifyTelegramConnectCode } from "@/lib/account/notifications";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { answerCallback, editMessage, editReplyMarkup, sendForceReply, sendMessage, tg, type InlineKeyboard } from "./api";

/**
 * Ryntra beta bot.
 *
 * Access is one action: start the bot, read what confirmation means, press confirm.
 * Nothing else opens the product. Channel membership, an X follow, an Arcus account and
 * a wallet address are optional and change neither access nor standing.
 *
 * `telegram_join` survives as the storage identifier for the verified-access flag because
 * `lib/session.ts` and every already-verified row depend on it. It is a column name, not a
 * promise: no surface may show join-the-channel semantics.
 */

const WALLET_RE = /^0x[a-fA-F0-9]{40}$/;
const BOT_USERNAME = "RyntraBeta_bot";

/** The storage identifier for "this user confirmed beta access". See the note above. */
const ACCESS_TASK = "telegram_join" as const;

type TgUser = { id: number; username?: string; first_name?: string; language_code?: string };
type TgMessage = { message_id: number; chat: { id: number; type: string }; from?: TgUser; text?: string };
type TgCallback = { id: string; from: TgUser; data?: string; message?: TgMessage };
export type TgUpdate = { update_id: number; message?: TgMessage; callback_query?: TgCallback };

function langOf(state: BetaState | null, tgLangCode?: string): BetaLang {
  return pickBetaLang(state?.user?.language ?? tgLangCode);
}

/* ---------- rendering ---------- */

function hasAccess(state: BetaState): boolean {
  return state.tasks?.[ACCESS_TASK]?.status === "verified";
}

/**
 * One keyboard, two shapes. Before confirmation the only primary action is to confirm;
 * after it the product link leads. The wallet button is present in both, visibly optional.
 */
function accessKeyboard(state: BetaState, lang: BetaLang): InlineKeyboard {
  const c = BETA_COPY[lang];
  const rows: InlineKeyboard = [];
  /* The bot only ever renders for a Telegram chat, so this id is present in
     practice. It is read into a local rather than asserted because the column
     is genuinely nullable now, and a wallet-only row reaching here should fall
     back to the confirm button instead of building a deep link around `null`. */
  const telegramId = state.user.telegram_id;
  if (hasAccess(state) && telegramId !== null) {
    rows.push([{ text: c.btnDemo, url: demoUrl(telegramId, lang) }]);
  } else {
    rows.push([{ text: c.btnConfirm, callback_data: "confirm" }]);
  }
  rows.push([
    { text: c.btnStatus, callback_data: "status" },
    { text: state.user.wallet_address ? c.btnWalletDone : c.btnWallet, callback_data: "wallet" },
  ]);
  return rows;
}

function welcomeText(lang: BetaLang): string {
  const c = BETA_COPY[lang];
  return `${c.welcomeTitle}\n\n${c.welcomeBody}\n\n${c.welcomeFooter}`;
}

function statusText(state: BetaState, lang: BetaLang): string {
  const c = BETA_COPY[lang];
  const access = c.status[state.access.status];
  return [
    c.statusTitle,
    "",
    `${hasAccess(state) ? "✅" : "▫️"} ${access.name}`,
    "",
    access.hint,
    "",
    c.optionalNote,
  ].join("\n");
}

/* ---------- flows ---------- */

/**
 * Creates or refreshes the user row.
 *
 * No inviter is passed. `ref_*` payloads remain a recognised legacy namespace so they can
 * never be mistaken for campaign attribution, but they grant no access, priority, status,
 * credit or reward, so they no longer create a referral edge.
 */
async function ensureState(user: TgUser): Promise<BetaState | null> {
  return upsertUser({
    telegramId: user.id,
    username: user.username,
    firstName: user.first_name,
    language: pickBetaLang(user.language_code),
    inviterRef: null,
  });
}

/**
 * `fromStartCommand` distinguishes a real `/start` from the fallback that shows the welcome
 * to an unknown user who sent arbitrary text. Only the former is a bot start; counting the
 * latter would inflate the top of the funnel with people who never opened a link.
 */
const NOTIFY_CONNECT_COPY: Record<BetaLang, { connected: string; stale: string; failed: string }> = {
  en: {
    connected: "Ryntra notifications are connected to this chat. You can disconnect them any time in Settings → Wallets & notifications.",
    stale: "This connection link has expired. Open Ryntra → Settings and press «Connect Telegram» again.",
    failed: "The connection could not be saved right now. Try again from Settings in a moment.",
  },
  uk: {
    connected: "Сповіщення Ryntra підключено до цього чату. Відключити можна будь-коли в Налаштуваннях → Гаманці й сповіщення.",
    stale: "Це посилання для підключення вже не діє. Відкрийте Ryntra → Налаштування і натисніть «Підключити Telegram» ще раз.",
    failed: "Зараз не вдалося зберегти підключення. Спробуйте ще раз із Налаштувань за хвилину.",
  },
  ru: {
    connected: "Уведомления Ryntra подключены к этому чату. Отключить можно в любой момент в Настройках → Кошельки и уведомления.",
    stale: "Эта ссылка для подключения уже не действует. Откройте Ryntra → Настройки и нажмите «Подключить Telegram» ещё раз.",
    failed: "Сейчас не удалось сохранить подключение. Попробуйте ещё раз из Настроек через минуту.",
  },
};

async function handleStart(
  msg: TgMessage,
  payload: string | undefined,
  updateId: number | undefined,
  fromStartCommand: boolean,
) {
  const user = msg.from;
  if (!user) return;
  /* A notification-channel code from Settings: the person came to be
     reachable, not to join the beta. The code is verified, the chat is bound
     to the account it names, and the answer is one sentence — no welcome, no
     checklist. A stale or forged code says so and falls through to nothing
     else. */
  if (isTelegramConnectCode(payload)) {
    const named = verifyTelegramConnectCode(payload);
    const lang = pickBetaLang(user.language_code);
    if (!named) {
      await sendMessage(msg.chat.id, NOTIFY_CONNECT_COPY[lang].stale);
      return;
    }
    const bound = await connectTelegramChannel(getGuardRuntime().store, {
      accountId: named.accountId,
      telegramId: user.id,
      username: user.username ?? null,
      now: new Date().toISOString(),
    });
    await sendMessage(msg.chat.id, bound ? NOTIFY_CONNECT_COPY[lang].connected : NOTIFY_CONNECT_COPY[lang].failed);
    return;
  }
  const state = await ensureState(user);
  const lang = langOf(state, user.language_code);
  if (!state) {
    await sendMessage(msg.chat.id, BETA_COPY[lang].stateError);
    return;
  }
  /* Attribution runs after the user exists and never gates what follows: a malformed or
     absent payload leaves the user with ordinary direct access. */
  if (fromStartCommand) void recordBotStart(user.id, payload ?? null, updateId ?? null);
  await sendMessage(msg.chat.id, welcomeText(lang), accessKeyboard(state, lang));
}

async function handleStatus(chatId: number, user: TgUser) {
  const state = (await getState(user.id)) ?? (await ensureState(user));
  const lang = langOf(state, user.language_code);
  if (!state) {
    await sendMessage(chatId, BETA_COPY[lang].stateError);
    return;
  }
  const rows: InlineKeyboard = [[{ text: BETA_COPY[lang].btnStatusPage, url: statusPageUrl(user.id, lang) }]];
  if (hasAccess(state)) {
    rows.unshift([{ text: BETA_COPY[lang].btnDemo, url: demoUrl(user.id, lang) }]);
  }
  await sendMessage(chatId, statusText(state, lang), rows);
}

async function handleWalletInput(msg: TgMessage) {
  const user = msg.from;
  if (!user) return;
  const wallet = (msg.text ?? "").trim();
  let state = await getState(user.id);
  if (!state) state = await ensureState(user);
  const lang = langOf(state, user.language_code);
  if (!WALLET_RE.test(wallet)) {
    await sendMessage(msg.chat.id, BETA_COPY[lang].walletBad);
    return;
  }
  const next = await setWallet(user.id, wallet);
  if (!next) {
    await sendMessage(msg.chat.id, BETA_COPY[lang].stateError);
    return;
  }
  await sendMessage(msg.chat.id, BETA_COPY[lang].walletSaved, accessKeyboard(next, lang));
}

/* ---------- callbacks ---------- */

async function handleCallback(cb: TgCallback) {
  const user = cb.from;
  const chatId = cb.message?.chat.id ?? user.id;
  const messageId = cb.message?.message_id;
  const state = (await getState(user.id)) ?? (await ensureState(user));
  const lang = langOf(state, user.language_code);
  const c = BETA_COPY[lang];

  if (!state) {
    await answerCallback(cb.id, c.stateError);
    return;
  }

  switch (cb.data) {
    case "confirm": {
      /* Idempotent by construction: a second press reports the same success and writes
         nothing new. Nothing external is consulted — no channel, no follow, no venue. */
      if (hasAccess(state)) {
        await answerCallback(cb.id, c.confirmAlready);
        return;
      }
      const next = await setTask(user.id, ACCESS_TASK, "verified");
      if (!next) {
        await answerCallback(cb.id, c.stateError);
        return;
      }
      void recordAccessConfirmed(user.id);
      await answerCallback(cb.id, c.confirmDone);
      if (messageId) await editReplyMarkup(chatId, messageId, accessKeyboard(next, lang));
      await sendMessage(chatId, statusText(next, lang), accessKeyboard(next, lang));
      return;
    }
    case "wallet": {
      await answerCallback(cb.id);
      await sendForceReply(chatId, c.askWallet, "0x…");
      return;
    }
    case "status": {
      await answerCallback(cb.id);
      await handleStatus(chatId, user);
      return;
    }
    default: {
      if (cb.data?.startsWith("np:")) {
        const key = cb.data.slice(3);
        if (!isNotificationKey(key)) {
          await answerCallback(cb.id);
          return;
        }
        if (key === "service_security") {
          await answerCallback(cb.id, NOTIFICATION_COPY[lang].locked);
          return;
        }
        const current = await getNotificationPrefs(user.id);
        const next = togglePref(current, key);
        const saved = await setNotificationPrefs(user.id, next);
        if (!saved?.ok) {
          await answerCallback(cb.id, c.stateError);
          return;
        }
        await answerCallback(cb.id);
        await renderSettings(chatId, user.id, lang, messageId);
        return;
      }
      const category = cb.data?.startsWith("fb:") ? cb.data.slice(3) : "";
      if (isFeedbackCategory(category)) {
        await answerCallback(cb.id);
        await setFeedbackDraft(user.id, category);
        await sendForceReply(chatId, "Напиши відгук одним повідомленням (мінімум 10 символів).", "Відгук");
        return;
      }
      await answerCallback(cb.id);
    }
  }
}

/* ---------- admin (operators, not user access) ---------- */

/**
 * Admin authentication is deliberately separate from user access. Long-term
 * authority is `admin_operators`. Channel membership is only a one-time
 * bootstrap while that table is empty, or a fail-closed fallback before the
 * migration is applied.
 */
async function handleAdmin(msg: TgMessage, cmd: string): Promise<boolean> {
  const user = msg.from;
  if (!user) return false;
  if (!(await isAdminOperator(user.id))) return false;

  if (cmd === "/stats") {
    const m = await metrics();
    await sendMessage(msg.chat.id, `<b>Beta funnel</b>\n<pre>${escapeHtml(JSON.stringify(m, null, 2)).slice(0, 3500)}</pre>`);
    return true;
  }

  if (cmd === "/admin") {
    const link = adminSessionUrl(user.id);
    if (!link) {
      await sendMessage(msg.chat.id, "Admin link unavailable (BETA_TOKEN_SECRET not set).");
      return true;
    }
    await sendMessage(msg.chat.id, "Admin panel access (24 hours, this account only):", [
      [{ text: "🛠 Open admin panel", url: link }],
    ]);
    return true;
  }

  if (cmd === "/setup") {
    const base = process.env.PUBLIC_BASE_URL ?? "https://ryntra.io";
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
    const wh = await tg("setWebhook", {
      url: `${base}/api/telegram`,
      secret_token: secret,
      allowed_updates: ["message", "callback_query"],
    });
    await tg("setMyCommands", {
      commands: [
        { command: "start", description: "Open the beta and confirm access" },
        { command: "status", description: "Your access state" },
        { command: "feedback", description: "Send product feedback" },
        { command: "settings", description: "Notification settings" },
        { command: "help", description: "Commands" },
      ],
    });
    await tg("setMyCommands", {
      commands: [
        { command: "start", description: "Відкрити бету й підтвердити доступ" },
        { command: "status", description: "Стан твого доступу" },
        { command: "feedback", description: "Надіслати відгук" },
        { command: "settings", description: "Сповіщення" },
        { command: "help", description: "Команди" },
      ],
      language_code: "uk",
    });
    await tg("setMyCommands", {
      commands: [
        { command: "start", description: "Открыть бету и подтвердить доступ" },
        { command: "status", description: "Состояние твоего доступа" },
        { command: "feedback", description: "Отправить отзыв" },
        { command: "settings", description: "Уведомления" },
        { command: "help", description: "Команды" },
      ],
      language_code: "ru",
    });
    const self = await tg<{ id: number; username: string }>("getMe", {});
    await sendMessage(
      msg.chat.id,
      `Setup: webhook ${wh ? "✅" : "❌"} (message + callback_query)\nBot: @${self?.username ?? BOT_USERNAME}`
    );
    return true;
  }

  return false;
}

function escapeHtml(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/* ---------- entry ---------- */

export async function handleUpdate(update: TgUpdate): Promise<void> {
  if (update.callback_query) {
    await handleCallback(update.callback_query);
    return;
  }

  const msg = update.message;
  if (!msg?.from || msg.chat.type !== "private") return;

  const text = (msg.text ?? "").trim();
  const [cmdRaw, ...rest] = text.split(/\s+/);
  const cmd = cmdRaw?.toLowerCase().replace(`@${BOT_USERNAME.toLowerCase()}`, "");
  const arg = rest.join(" ").trim();

  if (cmd === "/start") return handleStart(msg, arg || undefined, update.update_id, true);
  if (cmd === "/status") return handleStatus(msg.chat.id, msg.from);
  if (cmd === "/whoami") {
    await sendMessage(msg.chat.id, `Your Telegram ID: <code>${msg.from.id}</code>`);
    return;
  }
  if (cmd === "/help") {
    const state = await getState(msg.from.id);
    await sendMessage(msg.chat.id, BETA_COPY[langOf(state, msg.from.language_code)].help);
    return;
  }
  if (cmd === "/settings") {
    await renderSettings(msg.chat.id, msg.from.id, langOf(await getState(msg.from.id), msg.from.language_code));
    return;
  }
  if (cmd === "/feedback") {
    await sendMessage(msg.chat.id, "Обери категорію відгуку.", [
      [
        { text: "Помилка", callback_data: "fb:bug" },
        { text: "Ідея", callback_data: "fb:idea" },
      ],
      [
        { text: "Безпека", callback_data: "fb:security" },
        { text: "Інше", callback_data: "fb:other" },
      ],
    ]);
    return;
  }
  if (cmd === "/stats" || cmd === "/setup" || cmd === "/admin") {
    const handled = await handleAdmin(msg, cmd);
    if (handled) return;
    // non-admins fall through to the generic hint
  }

  if (WALLET_RE.test(text)) return handleWalletInput(msg);

  const draft = await getFeedbackDraft(msg.from.id);
  if (draft && isFeedbackCategory(draft) && !cmd?.startsWith("/")) {
    const body = sanitizeFeedbackBody(text);
    if (!body) {
      await sendMessage(msg.chat.id, "Напиши відгук одним повідомленням, щонайменше 10 символів.");
      return;
    }
    const opened = await openFeedbackThread({
      source: "bot",
      category: draft,
      body,
      telegramId: msg.from.id,
      locale: msg.from.language_code ?? null,
      publicRef: publicFeedbackRef(randomUUID()),
    });
    if (!opened.ok) {
      await sendMessage(msg.chat.id, "Інбокс ще не підключений. Спробуй пізніше.");
      return;
    }
    await sendMessage(msg.chat.id, `Прийнято. Референс <code>${opened.public_ref}</code>.`);
    return;
  }

  const state = await getState(msg.from.id);
  if (!state) return handleStart(msg, undefined, update.update_id, false);
  await sendMessage(msg.chat.id, BETA_COPY[langOf(state, msg.from.language_code)].unknown);
}

async function renderSettings(chatId: number, userId: number, lang: BetaLang, messageId?: number) {
  const prefs = await getNotificationPrefs(userId);
  const text = settingsBody(lang, prefs);
  const keyboard = settingsButtons(lang, prefs);
  if (messageId) {
    const edited = await editMessage(chatId, messageId, text, keyboard);
    if (edited) return;
  }
  await sendMessage(chatId, text, keyboard);
}
