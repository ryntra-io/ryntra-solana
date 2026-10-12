// Minimal, safe Telegram Bot API client. Every call is caught and logged —
// a Telegram hiccup must never fail the webhook (Telegram would retry-storm us).

import { classifyTelegramSend, type PlainDelivery } from "./delivery.ts";

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;

export type InlineButton = { text: string; url?: string; callback_data?: string };
export type InlineKeyboard = InlineButton[][];

/** Escape user/DB-sourced strings before interpolating into parse_mode=HTML messages. */
export function escapeHtml(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export async function tg<T = unknown>(method: string, body: Record<string, unknown>): Promise<T | null> {
  if (!TOKEN) {
    console.error(`tg ${method}: TELEGRAM_BOT_TOKEN not set`);
    return null;
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    const json = (await res.json()) as { ok: boolean; result?: T; description?: string };
    if (!json.ok) {
      console.error(`tg ${method}: ${json.description}`);
      return null;
    }
    return json.result ?? null;
  } catch (e) {
    console.error(`tg ${method} failed:`, e);
    return null;
  }
}

export function sendMessage(chatId: number, text: string, keyboard?: InlineKeyboard) {
  return tg("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
  });
}

/** Plain-text message (no HTML parsing) — for admin-authored broadcasts and DMs. */
export function sendPlainMessage(chatId: number, text: string, keyboard?: InlineKeyboard) {
  return tg("sendMessage", {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
    ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
  });
}

/** Same send as sendPlainMessage, but returns a delivery class for the queue. */
export async function sendPlainDelivery(chatId: number, text: string): Promise<PlainDelivery> {
  if (!TOKEN) {
    console.error("tg sendMessage: TELEGRAM_BOT_TOKEN not set");
    return { kind: "failed" };
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(8000),
    });
    const json = (await res.json()) as {
      ok: boolean;
      error_code?: number;
      description?: string;
      parameters?: { retry_after?: number };
    };
    if (!json.ok) console.error(`tg sendMessage: ${json.description}`);
    return classifyTelegramSend(json);
  } catch (e) {
    console.error("tg sendMessage failed:", e);
    return { kind: "failed" };
  }
}

/** Message with a reply prompt (client shows an input focused on replying). */
export function sendForceReply(chatId: number, text: string, placeholder?: string) {
  return tg("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: { force_reply: true, ...(placeholder ? { input_field_placeholder: placeholder } : {}) },
  });
}

export function editReplyMarkup(chatId: number, messageId: number, keyboard: InlineKeyboard) {
  return tg("editMessageReplyMarkup", {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: { inline_keyboard: keyboard },
  });
}

export function editMessage(chatId: number, messageId: number, text: string, keyboard?: InlineKeyboard) {
  return tg("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
  });
}

export function answerCallback(callbackQueryId: string, text?: string) {
  return tg("answerCallbackQuery", { callback_query_id: callbackQueryId, ...(text ? { text } : {}) });
}

/** Is the user a member (or admin) of the channel? null = could not check. */
export async function isChannelMember(channel: string, userId: number): Promise<boolean | null> {
  const r = await tg<{ status: string }>("getChatMember", { chat_id: channel, user_id: userId });
  if (!r) return null;
  return ["creator", "administrator", "member"].includes(r.status);
}

/** Is the user an admin/creator of the channel? Used to gate operator commands. */
export async function isChannelAdmin(channel: string, userId: number): Promise<boolean> {
  const r = await tg<{ status: string }>("getChatMember", { chat_id: channel, user_id: userId });
  return r ? ["creator", "administrator"].includes(r.status) : false;
}
