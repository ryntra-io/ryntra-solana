/**
 * The assistant in Telegram (AI-07) — whose chat this is, in the Guard store.
 *
 * A chat is bound to an account only by the bot's own binding: the person
 * pressed «Підключити Telegram» in Settings on ryntra.io, the signed code
 * reached the bot, and `notificationChannels` holds the account with the
 * Telegram id that pressed Start (lib/account/notifications.ts). Nothing here
 * creates that binding or trusts anything the chat says about itself.
 *
 * - `chat:<telegramId>` — the chat's row: the account it was bound to, the
 *   wallet the assistant reads for (one of the account's proven Solana
 *   wallets), the conversation, what waits for a button (a question at a
 *   price, a voice message, the words heard), the suggestions under the last
 *   answer and the chat's minute and day. Every read checks the binding
 *   again: a chat the account disconnected, or that another chat replaced,
 *   reads nothing — the row is a memory of the chat, never a key.
 * - `voice:day:<YYYY-MM-DD>` — the deployment's day of voice heard on the
 *   server: seconds and micro-dollars, the ceiling a day of voice cannot pass.
 */

import { z } from "zod";

import { TelegramChannelSchema } from "../../account/notifications.ts";
import { withBoundedCasRetry, type GuardStore } from "../../guard/store.ts";

export const TELEGRAM_COLLECTION = "assistantTelegram" as const;

const Wallet = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
const Iso = z.string().datetime({ offset: true });

/** How long the account's wallets are trusted without asking the accounts store again. */
export const WALLETS_FRESH_MS = 10 * 60_000;
/** When the accounts store does not answer, the wallet last read keeps answering this long — never a wallet nobody read. */
export const WALLETS_STALE_MS = 24 * 60 * 60_000;
/** A button's offer lives this long; a press after it asks again at the price of the moment. */
export const PENDING_MS = 15 * 60_000;

export const PendingSchema = z.discriminatedUnion("kind", [
  /** A question the free credits do not cover, waiting for «Спитати · N кредитів». */
  /* `wallet` — when the question is about another wallet of the account than the chat reads for (a note's «Чому?»). */
  z.object({ kind: z.literal("question"), text: z.string().min(1).max(2_000), credits: z.number().int().min(0), at: Iso, wallet: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/).optional() }).strict(),
  /** A voice message, its length and price shown, waiting for «Розпізнати». */
  z
    .object({
      kind: z.literal("voice"),
      fileId: z.string().min(1).max(256),
      fileUniqueId: z.string().min(1).max(128),
      seconds: z.number().int().min(1).max(120),
      credits: z.number().int().min(1),
      at: Iso,
    })
    .strict(),
  /** The words heard, waiting for «Так» or «Виправити». */
  z.object({ kind: z.literal("heard"), text: z.string().min(1).max(2_000), at: Iso }).strict(),
]);
export type Pending = z.infer<typeof PendingSchema>;

export const ChatRecordSchema = z
  .object({
    schema: z.literal("ryntra.assistant.telegram-chat"),
    version: z.number().int().min(1),
    telegramId: z.number().int().positive(),
    accountId: z.string().uuid(),
    wallet: Wallet.nullable(),
    walletsReadAt: Iso.nullable(),
    locale: z.enum(["uk", "en"]),
    sessionId: z.string().min(8).max(64).nullable(),
    pending: PendingSchema.nullable(),
    /** The questions under the last answer, pressed by their place. */
    suggestions: z.array(z.string().min(1).max(400)).max(3),
    /** The chat's minute: how many updates it sent in it. */
    minute: z.object({ at: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/), count: z.number().int().min(0) }).strict(),
    /** The chat's day of voice: how many messages were heard. */
    voiceDay: z.object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), count: z.number().int().min(0) }).strict(),
    createdAt: Iso,
    updatedAt: Iso,
  })
  .strict();
export type ChatRecord = z.infer<typeof ChatRecordSchema>;

export const chatKey = (telegramId: number) => `chat:${telegramId}`;
export const voiceDayKey = (day: string) => `voice:day:${day}`;
export const minuteOf = (nowMs: number) => new Date(nowMs).toISOString().slice(0, 16);
export const dayOf = (nowMs: number) => new Date(nowMs).toISOString().slice(0, 10);

type Versioned = { version: number };
const rows = (store: GuardStore) => store.versioned<Versioned & Record<string, unknown>>(TELEGRAM_COLLECTION);

export async function readChat(store: GuardStore, telegramId: number): Promise<ChatRecord | null> {
  const parsed = ChatRecordSchema.safeParse(await rows(store).get(chatKey(telegramId)));
  return parsed.success && parsed.data.telegramId === telegramId ? parsed.data : null;
}

/**
 * Change the chat's row by a function of what is stored now, under
 * compare-and-set; `null` from the change writes nothing. Resolves the row
 * written (or the row as it stands when nothing changed), `null` when the
 * store did not answer.
 */
export async function updateChat(store: GuardStore, telegramId: number, change: (current: ChatRecord) => ChatRecord | null): Promise<ChatRecord | null> {
  try {
    return await withBoundedCasRetry(async () => {
      const current = await readChat(store, telegramId);
      if (!current) return null as ChatRecord | null;
      const next = change(current);
      if (next === null) return current;
      const written = ChatRecordSchema.parse({ ...next, version: current.version + 1 });
      return (await rows(store).compareAndSet(chatKey(telegramId), current.version, written)) ? written : false;
    });
  } catch {
    return null;
  }
}

/** Remember the account a chat was just bound to (the bot calls it right after the binding is written). */
export async function rememberChat(store: GuardStore, input: Readonly<{ telegramId: number; accountId: string; locale: "uk" | "en"; nowMs: number }>): Promise<ChatRecord | null> {
  forgetUnbound(input.telegramId);
  const at = new Date(input.nowMs).toISOString();
  try {
    return await withBoundedCasRetry(async () => {
      const current = await readChat(store, input.telegramId);
      const same = current?.accountId === input.accountId;
      const next = ChatRecordSchema.parse({
        schema: "ryntra.assistant.telegram-chat",
        version: (current?.version ?? 0) + 1,
        telegramId: input.telegramId,
        accountId: input.accountId,
        /* Another account bound to this chat starts from nothing of the one before. */
        wallet: same ? current!.wallet : null,
        walletsReadAt: same ? current!.walletsReadAt : null,
        locale: same ? current!.locale : input.locale,
        sessionId: same ? current!.sessionId : null,
        pending: null,
        suggestions: [],
        minute: current?.minute ?? { at: minuteOf(input.nowMs), count: 0 },
        voiceDay: current?.voiceDay ?? { day: dayOf(input.nowMs), count: 0 },
        createdAt: same ? current!.createdAt : at,
        updatedAt: at,
      });
      return (await rows(store).compareAndSet(chatKey(input.telegramId), current?.version ?? null, next)) ? next : false;
    });
  } catch {
    return null;
  }
}

/** The account's proven Solana wallets, oldest first; `undefined` when the accounts store did not answer. */
export type WalletsOf = (accountId: string) => Promise<readonly string[] | undefined>;

export type ChatLink =
  | Readonly<{ state: "linked"; accountId: string; wallet: string; chat: ChatRecord }>
  /** No binding of this chat to any account — the person gets the way to connect, nothing else. */
  | Readonly<{ state: "unlinked" }>
  /** Bound, but the account proves no Solana wallet — nothing of anyone's own can be read. */
  | Readonly<{ state: "no-wallet"; accountId: string; chat: ChatRecord }>
  /** The store or the accounts store did not answer, and no wallet read recently stands in. */
  | Readonly<{ state: "unavailable" }>;

/**
 * The account a chat was bound to in `notificationChannels` when the chat has
 * no row yet — a binding made before AI-07. One scan of the channels; the
 * row written after it spares every later message the scan.
 */
async function findBinding(store: GuardStore, telegramId: number): Promise<string | null> {
  const all = await store.collection<unknown>("notificationChannels").valuesWithPrefix("");
  let found: { accountId: string; at: string } | null = null;
  for (const raw of all) {
    const parsed = TelegramChannelSchema.safeParse(raw);
    if (!parsed.success || parsed.data.telegramId !== telegramId) continue;
    if (!found || parsed.data.connectedAt > found.at) found = { accountId: parsed.data.accountId, at: parsed.data.connectedAt };
  }
  return found?.accountId ?? null;
}

const UNBOUND_MEMORY_MS = 60_000;
const unboundSeen = new Map<number, number>();

/** Forget that a chat had no binding — the bot calls it right after it writes one. */
export function forgetUnbound(telegramId: number): void {
  unboundSeen.delete(telegramId);
}

/** Whose chat this is now: the binding read again on every message, the wallet from the accounts store at most every ten minutes. */
export async function resolveChat(store: GuardStore, telegramId: number, input: Readonly<{ walletsOf: WalletsOf; locale: "uk" | "en"; nowMs: number }>): Promise<ChatLink> {
  let chat: ChatRecord | null;
  try {
    chat = await readChat(store, telegramId);
    if (!chat) {
      /* A chat with no binding is not scanned for again within the minute — a stream of messages is one scan. */
      const missed = unboundSeen.get(telegramId);
      if (missed !== undefined && input.nowMs - missed < UNBOUND_MEMORY_MS) return { state: "unlinked" };
      const accountId = await findBinding(store, telegramId);
      if (!accountId) {
        if (unboundSeen.size > 10_000) unboundSeen.clear();
        unboundSeen.set(telegramId, input.nowMs);
        return { state: "unlinked" };
      }
      unboundSeen.delete(telegramId);
      chat = await rememberChat(store, { telegramId, accountId, locale: input.locale, nowMs: input.nowMs });
      if (!chat) return { state: "unavailable" };
    }
    /* Read directly: a store that did not answer is «unavailable», never an unbinding that would forget the chat. */
    const raw = await store.collection<unknown>("notificationChannels").get(chat.accountId);
    const parsed = raw === undefined || raw === null ? null : TelegramChannelSchema.safeParse(raw);
    const channel = parsed?.success ? parsed.data : null;
    if (!channel || channel.telegramId !== telegramId) {
      /* The account disconnected this chat, or bound another one: the chat's memory goes, and it reads nothing. */
      await rows(store).delete(chatKey(telegramId)).catch(() => undefined);
      return { state: "unlinked" };
    }
  } catch {
    return { state: "unavailable" };
  }
  const readAt = chat.walletsReadAt ? Date.parse(chat.walletsReadAt) : Number.NEGATIVE_INFINITY;
  if (chat.wallet && input.nowMs - readAt < WALLETS_FRESH_MS) return { state: "linked", accountId: chat.accountId, wallet: chat.wallet, chat };
  const wallets = await input.walletsOf(chat.accountId).catch(() => undefined);
  if (wallets === undefined) {
    if (chat.wallet && input.nowMs - readAt < WALLETS_STALE_MS) return { state: "linked", accountId: chat.accountId, wallet: chat.wallet, chat };
    return { state: "unavailable" };
  }
  const proven = wallets.filter((wallet) => Wallet.safeParse(wallet).success);
  /* The wallet chosen before stays while the account still proves it; otherwise the one proven last. */
  const wallet = chat.wallet && proven.includes(chat.wallet) ? chat.wallet : (proven.at(-1) ?? null);
  const at = new Date(input.nowMs).toISOString();
  const written = await updateChat(store, telegramId, (current) => ({ ...current, wallet, walletsReadAt: at, ...(wallet !== current.wallet ? { sessionId: null, pending: null, suggestions: [] } : {}), updatedAt: at }));
  const next = written ?? chat;
  if (!wallet) return { state: "no-wallet", accountId: chat.accountId, chat: next };
  return { state: "linked", accountId: chat.accountId, wallet, chat: next };
}

/** The account's wallets for the settings: the one read for, and the others it proves (a choice the person makes, never the bot). */
export async function chooseWallet(store: GuardStore, telegramId: number, wallet: string, input: Readonly<{ walletsOf: WalletsOf; nowMs: number }>): Promise<"chosen" | "not-proven" | "unavailable"> {
  const chat = await readChat(store, telegramId).catch(() => null);
  if (!chat) return "unavailable";
  const wallets = await input.walletsOf(chat.accountId).catch(() => undefined);
  if (wallets === undefined) return "unavailable";
  if (!wallets.includes(wallet)) return "not-proven";
  const at = new Date(input.nowMs).toISOString();
  const written = await updateChat(store, telegramId, (current) => (current.wallet === wallet ? null : { ...current, wallet, walletsReadAt: at, sessionId: null, pending: null, suggestions: [], updatedAt: at }));
  return written ? "chosen" : "unavailable";
}

/* ------------------------------------------------------------ the limits */

/** Updates one chat may send in a minute; past it the chat is answered once that it is too fast, then not at all until the minute ends. */
export const CHAT_UPDATES_PER_MINUTE = 12;
/** Voice messages one chat may have heard on the server in a UTC day. */
export const CHAT_VOICE_PER_DAY = 30;

export type MinuteDecision = "ok" | "slow-down" | "silent";

/** Count one update of the chat's minute; the first one past the limit says so, the rest are dropped without a word. */
export async function takeMinute(store: GuardStore, telegramId: number, nowMs: number): Promise<MinuteDecision> {
  const minute = minuteOf(nowMs);
  let decision: MinuteDecision = "ok";
  const at = new Date(nowMs).toISOString();
  const written = await updateChat(store, telegramId, (current) => {
    const count = current.minute.at === minute ? current.minute.count + 1 : 1;
    decision = count <= CHAT_UPDATES_PER_MINUTE ? "ok" : count === CHAT_UPDATES_PER_MINUTE + 1 ? "slow-down" : "silent";
    return { ...current, minute: { at: minute, count }, updatedAt: at };
  });
  /* A store that did not answer is not a reason to stop a person: the credits still meter every paid call. */
  return written ? decision : "ok";
}

const VoiceDaySchema = z.object({ version: z.number().int().min(1), seconds: z.number().int().min(0), microUsd: z.number().int().min(0) }).strict();

/** The deployment's day of voice: claim `seconds` under the ceiling, or refuse. */
export async function claimVoiceSeconds(store: GuardStore, seconds: number, ceiling: number, nowMs: number): Promise<boolean> {
  const key = voiceDayKey(dayOf(nowMs));
  try {
    return await withBoundedCasRetry(async () => {
      const parsed = VoiceDaySchema.safeParse(await rows(store).get(key));
      const current = parsed.success ? parsed.data : null;
      if ((current?.seconds ?? 0) + seconds > ceiling) return "refused" as const;
      const next = { version: (current?.version ?? 0) + 1, seconds: (current?.seconds ?? 0) + seconds, microUsd: current?.microUsd ?? 0 };
      return (await rows(store).compareAndSet(key, current?.version ?? null, next)) ? ("taken" as const) : false;
    }).then((outcome) => outcome === "taken");
  } catch {
    return false;
  }
}

/** Give back seconds claimed for a voice that was never heard, and add what one that was heard cost. */
export async function settleVoiceSeconds(store: GuardStore, input: Readonly<{ claimed: number; heard: number; microUsd: number; claimedAtMs: number }>): Promise<void> {
  /* Settled on the day the seconds were claimed — a hearing across midnight never takes from the next day. */
  const key = voiceDayKey(dayOf(input.claimedAtMs));
  try {
    await withBoundedCasRetry(async () => {
      const parsed = VoiceDaySchema.safeParse(await rows(store).get(key));
      if (!parsed.success) return true;
      const current = parsed.data;
      const next = { version: current.version + 1, seconds: Math.max(0, current.seconds - input.claimed + input.heard), microUsd: current.microUsd + input.microUsd };
      return (await rows(store).compareAndSet(key, current.version, next)) ? true : false;
    });
  } catch {
    /* A count that could not be settled keeps the claim: conservative, never generous. */
  }
}

export async function readVoiceDay(store: GuardStore, nowMs: number): Promise<Readonly<{ seconds: number; microUsd: number }>> {
  const parsed = VoiceDaySchema.safeParse(await rows(store).get(voiceDayKey(dayOf(nowMs))).catch(() => null));
  return parsed.success ? { seconds: parsed.data.seconds, microUsd: parsed.data.microUsd } : { seconds: 0, microUsd: 0 };
}

/**
 * The account's Solana wallets from the accounts store's projection
 * (`beta_state_by_account` → `account.wallets`), oldest proof first; `[]` for
 * an account that proves none or is gone. Only `chain = solana` and an
 * address of the right shape are taken.
 */
export function solanaWalletsOf(raw: unknown): string[] {
  const account = raw && typeof raw === "object" ? (raw as { account?: { wallets?: unknown } }).account : undefined;
  const wallets = Array.isArray(account?.wallets) ? account.wallets : [];
  return wallets
    .map((entry) => (entry && typeof entry === "object" ? (entry as { chain?: unknown; address?: unknown; verified_at?: unknown }) : null))
    .filter((entry): entry is { chain: string; address: string; verified_at?: unknown } => entry !== null && entry.chain === "solana" && typeof entry.address === "string" && Wallet.safeParse(entry.address).success)
    .sort((a, b) => String(a.verified_at ?? "").localeCompare(String(b.verified_at ?? "")))
    .map((entry) => entry.address);
}
