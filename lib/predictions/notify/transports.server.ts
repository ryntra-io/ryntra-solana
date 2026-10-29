/**
 * The channel's two transports on a real deployment.
 *
 * Both are Ryntra's, not the line's own: a person has one Telegram chat and
 * one browser subscription for the whole product, and a prediction note goes
 * out the same way an assistant note does. Neither is required — a
 * deployment without the push key or without the bot token answers `none`,
 * which is not a failure: the note is in the app's list either way.
 *
 * - **A browser** is woken with an empty Web Push under the deployment's
 *   VAPID key (`RYNTRA_WEBPUSH_JWK`): no words travel through the push
 *   service, and the page's own service worker reads the note from Ryntra.
 *   The subscriptions are the ones the browser already made for Ryntra.
 * - **Telegram** goes to the chat the person bound to their account in
 *   Settings, through the one bot. Nothing here creates that binding, and a
 *   wallet with no account, or an account with no chat, is `none`.
 *
 * Neither carries an action: a note is never permission to trade, and
 * nothing here signs, spends or reads a key.
 *
 * Server only.
 */

import { deliverToTelegramChannel } from "../../account/notifications.ts";
import { accountByWallet } from "../../account/rpc.ts";
import { wakeBrowsers } from "../../assistant/push/webpush.ts";
import { getGuardRuntime } from "../../guard/runtime.ts";
import type { GuardStore } from "../../guard/store.ts";
import { escapeHtml, sendMessage } from "../../telegram/api.ts";

import type { NotifyTransports, NoteWords } from "./channel.ts";

export const APP_ORIGIN = process.env.RYNTRA_PUBLIC_ORIGIN?.replace(/\/$/, "") || "https://ryntra.io";

/** The note as a chat carries it: the product's name, the note's own two lines, and the link under them. */
export function telegramNoteText(words: NoteWords, href: string): string {
  return `<b>Ryntra · ${escapeHtml(words.title)}</b>\n\n${escapeHtml(words.body)}\n\n${escapeHtml(href)}`;
}

/** The transports of this deployment, with the wallet → account lookup and the bot send injected for the tests. */
export function predictionTransports(
  store: GuardStore = getGuardRuntime().store,
  deps: Readonly<{
    accountOf?: (wallet: string) => Promise<string | null | undefined>;
    send?: (chatId: number, text: string, keyboard: readonly (readonly Readonly<{ text: string; url: string }>[])[]) => Promise<unknown>;
    wake?: typeof wakeBrowsers;
  }> = {},
): NotifyTransports {
  const accountOf = deps.accountOf ?? ((wallet: string) => accountByWallet("solana", wallet));
  const send = deps.send ?? ((chatId: number, text: string, keyboard: readonly (readonly Readonly<{ text: string; url: string }>[])[]) => sendMessage(chatId, text, keyboard.map((row) => [...row])));
  const wake = deps.wake ?? wakeBrowsers;
  return {
    webpush: async (wallet, nowMs) => {
      const woken = await wake(store, wallet, nowMs).catch(() => ({ sent: 0, subscriptions: 0 }));
      return woken.sent > 0 ? "sent" : "none";
    },
    telegram: async (wallet, words, href) => {
      const accountId = await accountOf(wallet).catch(() => undefined);
      /* `undefined` — the lookup did not answer, which is a failure; `null` — the wallet has no account, which is simply no channel. */
      if (accountId === undefined) return "failed";
      if (!accountId) return "none";
      const url = href.startsWith("http") ? href : `${APP_ORIGIN}${href}`;
      const outcome = await deliverToTelegramChannel(store, accountId, "", async (chatId) => {
        const sent = await send(chatId, telegramNoteText(words, url), [[{ text: words.cta, url }]]);
        if (!sent) throw new Error("not delivered");
        return sent;
      }).catch(() => "failed" as const);
      return outcome === "sent" ? "sent" : outcome === "no_channel" ? "none" : "failed";
    },
  };
}
