/**
 * The bot's own Telegram client (CITY-166). A bot of its own, with its own token: the assistant's client
 * (`lib/telegram/api.ts`) reads the assistant bot's token at load, so this one takes its token as an argument and shares
 * nothing with it. Plain text only — no `parse_mode`, so nothing foreign can become markup.
 *
 * Every call is caught: a Telegram hiccup never fails the webhook (Telegram would redeliver into a storm). The token
 * rides only in the request to Telegram, never in a log or an answer.
 */

import type { WardBotReply } from "./bot.ts";

export type WardTelegram = Readonly<{
  call: <T = unknown>(method: string, body: Record<string, unknown>) => Promise<T | null>;
  send: (reply: WardBotReply) => Promise<unknown>;
}>;

export function wardTelegram(args: Readonly<{ token: string | null; base?: string; fetch?: typeof fetch }>): WardTelegram {
  const base = (args.base ?? "https://api.telegram.org").replace(/\/$/, "");
  const send = args.fetch ?? fetch;
  const call = async <T = unknown>(method: string, body: Record<string, unknown>): Promise<T | null> => {
    if (!args.token) {
      console.error(`ward-bot ${method}: the bot's token is not set`);
      return null;
    }
    try {
      const res = await send(`${base}/bot${args.token}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8_000),
      });
      const json = (await res.json()) as { ok: boolean; result?: T; description?: string };
      if (!json.ok) {
        console.error(`ward-bot ${method}: ${String(json.description ?? "refused").slice(0, 200)}`);
        return null;
      }
      return json.result ?? null;
    } catch (failure) {
      console.error(`ward-bot ${method} failed: ${failure instanceof Error ? failure.name : "error"}`);
      return null;
    }
  };
  return {
    call,
    send: (reply) =>
      call("sendMessage", {
        chat_id: reply.chatId,
        text: reply.text,
        link_preview_options: { is_disabled: true },
        disable_notification: reply.quiet,
        ...(reply.replyTo !== null ? { reply_parameters: { message_id: reply.replyTo, allow_sending_without_reply: true } } : {}),
      }),
  };
}
