import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import { withBoundedCasRetry, type GuardStore } from "../guard/store.ts";
import { sendMessage } from "../telegram/api.ts";

/**
 * Telegram as a notification channel — connected from Settings, never a
 * way in.
 *
 * An account is the wallet that signed; what Telegram adds is a place to be
 * told something. The person presses one button in Settings, lands in the
 * bot with a signed code, presses Start, and the bot writes the binding here
 * — the account id and the Telegram id that just pressed it. Nothing about it
 * signs anybody in, and removing it removes only the channel.
 *
 * The code travels in the bot's `start` payload, which Telegram caps at 64
 * characters of `[A-Za-z0-9_-]`: the account id as 22 base64url characters,
 * the expiry in base-36, and a 16-hex-character HMAC under
 * `BETA_TOKEN_SECRET` — the secret that already signs every session token.
 * Fifteen minutes is long enough to open Telegram and short enough that a
 * code pasted somewhere else is worthless by the time anyone reads it.
 */

const COLLECTION = "notificationChannels" as const;
const PREFIX = "ntf";
/** How long a connect code lives: long enough to open Telegram, short enough to be worthless once pasted elsewhere. */
export const TELEGRAM_CONNECT_TTL_MS = 15 * 60_000;
const TTL_MS = TELEGRAM_CONNECT_TTL_MS;
const BOT = "RyntraBeta_bot";

export const TelegramChannelSchema = z
  .object({
    schema: z.literal("ryntra.notification-channel"),
    schemaVersion: z.literal("1.0.0"),
    version: z.number().int().min(0),
    accountId: z.string().uuid(),
    telegramId: z.number().int().positive(),
    username: z.string().min(1).max(64).nullable(),
    connectedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type TelegramChannel = z.output<typeof TelegramChannelSchema>;

function secret(): string | null {
  const value = (process.env.BETA_TOKEN_SECRET ?? "").trim();
  return value.length >= 16 ? value : null;
}

function sign(body: string, key: string): string {
  return createHmac("sha256", key).update(body).digest("hex").slice(0, 16);
}

function uuidToBase64url(id: string): string | null {
  const hex = id.replace(/-/g, "");
  if (!/^[0-9a-f]{32}$/i.test(hex)) return null;
  return Buffer.from(hex, "hex").toString("base64url");
}

function base64urlToUuid(text: string): string | null {
  if (!/^[A-Za-z0-9_-]{22}$/.test(text)) return null;
  const hex = Buffer.from(text, "base64url").toString("hex");
  if (hex.length !== 32) return null;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** A signed, short-lived code naming the account, for the bot's `start` payload. Null without a secret. */
export function issueTelegramConnectCode(accountId: string, now = Date.now()): string | null {
  const key = secret();
  const id = uuidToBase64url(accountId);
  if (!key || !id) return null;
  const expires = Math.floor((now + TTL_MS) / 1000).toString(36);
  const body = `${PREFIX}_${id}_${expires}`;
  return `${body}_${sign(body, key)}`;
}

/** The account a code names, or null when it is malformed, forged or expired. */
export function verifyTelegramConnectCode(code: string, now = Date.now()): Readonly<{ accountId: string }> | null {
  const key = secret();
  if (!key) return null;
  const match = /^ntf_([A-Za-z0-9_-]{22})_([0-9a-z]{1,10})_([0-9a-f]{16})$/.exec(code);
  if (!match) return null;
  const [, id, expires, signature] = match;
  const expected = sign(`${PREFIX}_${id}_${expires}`, key);
  const left = Buffer.from(signature!, "utf8");
  const right = Buffer.from(expected, "utf8");
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
  if (parseInt(expires!, 36) * 1000 < now) return null;
  const accountId = base64urlToUuid(id!);
  return accountId ? { accountId } : null;
}

export function isTelegramConnectCode(payload: string | null | undefined): payload is string {
  return typeof payload === "string" && payload.startsWith(`${PREFIX}_`);
}

export function telegramConnectLink(code: string): string {
  return `https://t.me/${BOT}?start=${code}`;
}

/** Bind, or re-bind, the account's Telegram channel. Later wins; one account, one chat. */
export async function connectTelegramChannel(
  store: GuardStore,
  args: Readonly<{ accountId: string; telegramId: number; username: string | null; now: string }>,
): Promise<TelegramChannel | null> {
  const channels = store.versioned<TelegramChannel>(COLLECTION);
  try {
    return await withBoundedCasRetry(async () => {
      const found = await channels.get(args.accountId);
      const current = found ? TelegramChannelSchema.safeParse(found) : null;
      const version = current?.success ? current.data.version : null;
      const next = TelegramChannelSchema.parse({
        schema: "ryntra.notification-channel",
        schemaVersion: "1.0.0",
        version: (version ?? -1) + 1,
        accountId: args.accountId,
        telegramId: args.telegramId,
        username: args.username,
        connectedAt: args.now,
      });
      const written = await channels.compareAndSet(args.accountId, version, next);
      return written ? next : false;
    });
  } catch {
    return null;
  }
}

export async function readTelegramChannel(store: GuardStore, accountId: string): Promise<TelegramChannel | null> {
  try {
    const found = await store.collection<unknown>(COLLECTION).get(accountId);
    const parsed = TelegramChannelSchema.safeParse(found);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function disconnectTelegramChannel(store: GuardStore, accountId: string): Promise<boolean> {
  try {
    await store.collection<TelegramChannel>(COLLECTION).delete(accountId);
    return true;
  } catch {
    return false;
  }
}

/**
 * Deliver one message to the account's channel, if it has one. The single
 * path every future sender takes; nothing in the product writes here yet,
 * which is why the channel is described in Settings as a place, not a feed.
 */
export async function deliverToTelegramChannel(
  store: GuardStore,
  accountId: string,
  text: string,
  send: (chatId: number, text: string) => Promise<unknown> = sendMessage,
): Promise<"sent" | "no_channel" | "failed"> {
  const channel = await readTelegramChannel(store, accountId);
  if (!channel) return "no_channel";
  try {
    await send(channel.telegramId, text);
    return "sent";
  } catch {
    return "failed";
  }
}

/** What Settings shows: the handle and the moment, never the Telegram id. */
export function telegramChannelView(channel: TelegramChannel | null): Readonly<{ connected: boolean; username: string | null; connectedAt: string | null }> {
  return channel
    ? { connected: true, username: channel.username, connectedAt: channel.connectedAt }
    : { connected: false, username: null, connectedAt: null };
}
