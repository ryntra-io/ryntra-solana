/**
 * The bot on a real chain and a real Telegram (CITY-166). Server only.
 *
 * Environment — values are the owner's and never live in the repository:
 * - `TELEGRAM_WARD_BOT_TOKEN` — the bot's token from @BotFather;
 * - `TELEGRAM_WARD_WEBHOOK_SECRET` — the secret Telegram sends with every update, and the operator's bearer for setup;
 * - `TELEGRAM_API_BASE` — outside production only, a fake Telegram for a stand (as the assistant's bot reads it).
 *
 * The engine's reads are the ones `POST /api/v1/ward/check` uses on mainnet (`lib/ward/reads.server.ts`).
 */

import { getGuardRuntime } from "../guard/runtime.ts";
import { createSolanaRpcHandle } from "../solana/rpc.ts";
import type { WardReads } from "../ward/check.ts";
import { chainReads, recipientRead, securityRead, tokenFactsRead } from "../ward/reads.server.ts";
import { engineCheck, type WardBotDeps } from "./bot.ts";
import { WardBotGate } from "./limits.ts";
import { wardTelegram, type WardTelegram } from "./telegram.ts";

/** Where a Ryntra payment link pasted in a chat is read. */
const ORIGIN = "https://ryntra.io";

export function wardBotSecret(): string | undefined {
  return process.env.TELEGRAM_WARD_WEBHOOK_SECRET;
}

export function wardBotConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_WARD_BOT_TOKEN?.trim());
}

let client: WardTelegram | null = null;
export function wardBotTelegram(): WardTelegram {
  if (!client) {
    const stand = process.env.VERCEL_ENV !== "production" ? process.env.TELEGRAM_API_BASE?.trim() : undefined;
    client = wardTelegram({ token: process.env.TELEGRAM_WARD_BOT_TOKEN?.trim() || null, ...(stand ? { base: stand } : {}) });
  }
  return client;
}

function engineReads(): WardReads {
  const handle = createSolanaRpcHandle({ network: "mainnet", timeoutMs: 6_000, retries: 1 });
  return {
    ...chainReads(handle),
    security: securityRead,
    tokenFacts: tokenFactsRead,
    /* The links' store is opened only when a link or an address is actually read. */
    recipient: (to, mint, from) => recipientRead(handle, { origin: ORIGIN, store: getGuardRuntime().store })(to, mint, from),
  };
}

/* One gate per warm instance: its counters are the bot's brakes. */
const gate = new WardBotGate();
let username: Promise<string | null> | null = null;

function ownUsername(): Promise<string | null> {
  username ??= wardBotTelegram()
    .call<{ username?: string }>("getMe", {})
    .then((me) => me?.username ?? null)
    .then((name) => {
      if (name === null) username = null;
      return name;
    });
  return username;
}

export function wardBotDeps(): WardBotDeps {
  return {
    send: (reply) => wardBotTelegram().send(reply),
    check: engineCheck(engineReads),
    gate,
    username: ownUsername,
    now: Date.now,
  };
}
