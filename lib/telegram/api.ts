// Minimal, safe Telegram Bot API client. Every call is caught and logged —
// a Telegram hiccup must never fail the webhook (Telegram would retry-storm us).

import { classifyTelegramSend, type PlainDelivery } from "./delivery.ts";

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
/* AI-07: a stand points the bot at a fake Telegram (`scripts/assistant/telegram-stand-ai07.mjs`) — no message reaches anyone; unset, Telegram itself. */
const API = (process.env.VERCEL_ENV !== "production" && process.env.TELEGRAM_API_BASE?.trim() ? process.env.TELEGRAM_API_BASE.trim() : "https://api.telegram.org").replace(/\/$/, "");

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
    const res = await fetch(`${API}/bot${TOKEN}/${method}`, {
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
    const res = await fetch(`${API}/bot${TOKEN}/sendMessage`, {
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

/** «Ryntra друкує…» while an answer is composed (AI-07). */
export function sendTyping(chatId: number) {
  return tg("sendChatAction", { chat_id: chatId, action: "typing" });
}

/**
 * A file the person sent, by its id (AI-07: a voice message) — refused past
 * `maxBytes` before and after the download. The token rides only in the
 * request to Telegram, never in a log.
 */
export async function downloadFile(fileId: string, maxBytes: number): Promise<{ ok: true; bytes: Uint8Array; mime: string } | { ok: false; reason: string }> {
  if (!TOKEN) return { ok: false, reason: "TELEGRAM_BOT_TOKEN not set" };
  const file = await tg<{ file_path?: string; file_size?: number }>("getFile", { file_id: fileId });
  if (!file?.file_path) return { ok: false, reason: "the file is not available" };
  if (typeof file.file_size === "number" && file.file_size > maxBytes) return { ok: false, reason: "the file is too big" };
  try {
    const res = await fetch(`${API}/file/bot${TOKEN}/${file.file_path}`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return { ok: false, reason: `the file answered ${res.status}` };
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength > maxBytes) return { ok: false, reason: "the file is too big" };
    /* Telegram serves a voice message (`.oga`, Opus in Ogg) as octet-stream: it is audio/ogg unless the server named an audio type. */
    const type = res.headers.get("content-type") ?? "";
    const mime = type.startsWith("audio/") ? type : "audio/ogg";
    return { ok: true, bytes, mime };
  } catch {
    return { ok: false, reason: "the file did not come" };
  }
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

/** Is the user an admin/creator of the channel? Used to gate founder commands. */
export async function isChannelAdmin(channel: string, userId: number): Promise<boolean> {
  const r = await tg<{ status: string }>("getChatMember", { chat_id: channel, user_id: userId });
  return r ? ["creator", "administrator"].includes(r.status) : false;
}
