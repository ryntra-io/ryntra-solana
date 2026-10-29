/**
 * The production side of the assistant in Telegram (AI-07): the bot's own
 * Telegram client, the accounts store's projection for the account's
 * wallets, the web's agent dependencies for the wallet, the transcriber.
 * Server only.
 *
 * The agent's holdings read is the holdings route called in-process, as on
 * the web. A Telegram update carries no address of the person's, and the bot
 * invents none: the reads from Telegram share the route's anonymous window
 * (120 a minute an instance), while each chat is held to 12 updates a minute
 * (`takeMinute`). On the stand (`RYNTRA_AGENT_FIXTURES=1`) every account
 * proves the fixture wallet, so a chat bound there talks to the fixture world.
 */

import { agentDepsFor, fixturesOn } from "@/app/api/v1/agent/runtime";
import { OWNER as FIXTURE_OWNER } from "@/lib/agent/fixtures";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { rpcResult } from "@/lib/supabase-rpc";
import { answerCallback, downloadFile, editMessage, sendMessage, sendTyping, type InlineKeyboard } from "@/lib/telegram/api";
import { lookupToken } from "../watch/runtime.server.ts";
import type { AssistantBotDeps, TgPort } from "./bot.ts";
import { solanaWalletsOf, type WalletsOf } from "./link.ts";
import { createOpenAiTranscriber, voiceDailySeconds } from "./voice.ts";

const ORIGIN = process.env.RYNTRA_PUBLIC_ORIGIN?.replace(/\/$/, "") || "https://ryntra.io";

const TELEGRAM: TgPort = {
  send: async (chatId, text, keyboard) => sendMessage(chatId, text, keyboard as InlineKeyboard | undefined) as Promise<{ message_id: number } | null>,
  edit: (chatId, messageId, text, keyboard) => editMessage(chatId, messageId, text, keyboard as InlineKeyboard | undefined),
  answer: (callbackId, text) => answerCallback(callbackId, text),
  typing: (chatId) => sendTyping(chatId),
  download: (fileId, maxBytes) => downloadFile(fileId, maxBytes),
};

/** The account's proven Solana wallets — the accounts store's own projection; `undefined` when it did not answer. */
const walletsOf: WalletsOf = async (accountId) => {
  if (fixturesOn()) return [FIXTURE_OWNER];
  const read = await rpcResult<unknown>("account", "beta_state_by_account", { p_account_id: accountId });
  if (!read.ok) return undefined;
  return solanaWalletsOf(read.data);
};

export function assistantBotDeps(): AssistantBotDeps {
  return {
    store: getGuardRuntime().store,
    tg: TELEGRAM,
    walletsOf,
    agentFor: (owner) => agentDepsFor(new Request(`${ORIGIN}/api/telegram`), owner),
    transcriber: createOpenAiTranscriber(process.env),
    lookupToken,
    voiceDailySeconds: voiceDailySeconds(process.env),
    origin: ORIGIN,
    now: Date.now,
  };
}
