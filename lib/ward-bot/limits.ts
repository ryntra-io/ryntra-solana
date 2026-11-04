/**
 * The bot's brakes (CITY-166): how often it may answer one person, one group and everyone, what it does not answer
 * twice, and what it remembers of a chat to catch a look-alike address. The bot must never become the spam it warns
 * about: one message in, at most one line out, and past a limit it says so once and then keeps quiet.
 *
 * Per warm instance, in memory, with a bounded number of keys (`FixedWindowLimiter`): the same best-effort layer the
 * public API has. Nothing is written anywhere; a cold instance starts with clean counters, which can only make the bot
 * quieter in total, never louder in one window of one instance.
 */

import { FixedWindowLimiter } from "../http-control.ts";

export const WARD_BOT_LIMITS = {
  /** Checks one group gets per window. */
  chat: { limit: 20, windowMs: 10 * 60_000 },
  /** Checks one person gets per minute in a group. */
  member: { limit: 4, windowMs: 60_000 },
  /** Checks one person gets per minute in a private chat. */
  direct: { limit: 12, windowMs: 60_000 },
  /** Checks the whole bot runs per minute on one instance: the chain's read budget. */
  global: { limit: 120, windowMs: 60_000 },
  /** The same thing pasted in the same chat is not answered again within this. */
  repeatMs: 15 * 60_000,
  /** A message older than this (an outage's backlog) is not answered: a stale verdict is noise. */
  staleMs: 10 * 60_000,
  /** Addresses remembered per chat, for the look-alike comparison. */
  knownPerChat: 24,
  /** Chats remembered at once. */
  maxChats: 2_048,
  /** Updates remembered, to answer a redelivered one once. */
  maxUpdates: 4_096,
} as const;

export type WardBotAdmission =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; why: "repeat" | "member" | "chat" | "global"; notice: boolean; retryAfterSeconds: number }>;

type Clock = () => number;

/** A bounded map that forgets the oldest first. */
class Recent<K, V> {
  private readonly map = new Map<K, V>();
  private readonly max: number;
  constructor(max: number) {
    this.max = max;
  }
  get(key: K): V | undefined {
    return this.map.get(key);
  }
  set(key: K, value: V): void {
    this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value as K | undefined;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }
  delete(key: K): void {
    this.map.delete(key);
  }
}

export class WardBotGate {
  private readonly now: Clock;
  private readonly chat: FixedWindowLimiter;
  private readonly member: FixedWindowLimiter;
  private readonly direct: FixedWindowLimiter;
  private readonly global: FixedWindowLimiter;
  /** One notice per key and window: «too many checks» is said once, then the bot is quiet. */
  private readonly notices: FixedWindowLimiter;
  private readonly updates: Recent<number, true>;
  private readonly repeats: Recent<string, number>;
  private readonly known: Recent<number, string[]>;

  constructor(options: Readonly<{ now?: Clock }> = {}) {
    this.now = options.now ?? Date.now;
    const L = WARD_BOT_LIMITS;
    const make = (spec: Readonly<{ limit: number; windowMs: number }>, maxKeys: number) => new FixedWindowLimiter({ ...spec, maxKeys, now: this.now });
    this.chat = make(L.chat, L.maxChats);
    this.member = make(L.member, L.maxChats * 4);
    this.direct = make(L.direct, L.maxChats * 4);
    this.global = make(L.global, 1);
    this.notices = make({ limit: 1, windowMs: L.chat.windowMs }, L.maxChats * 2);
    this.updates = new Recent(L.maxUpdates);
    this.repeats = new Recent(L.maxChats * 8);
    this.known = new Recent(L.maxChats);
  }

  /** True when this update was already taken — Telegram redelivers what it thinks was missed. */
  seen(updateId: number): boolean {
    if (this.updates.get(updateId)) return true;
    this.updates.set(updateId, true);
    return false;
  }

  /** May this message be checked? Consumes the person's, the group's and the bot's budget, in that order. */
  admit(args: Readonly<{ chatId: number; userId: number; direct: boolean; key: string }>): WardBotAdmission {
    const now = this.now();
    const repeatKey = `${args.chatId}|${args.key}`;
    const last = this.repeats.get(repeatKey);
    if (last !== undefined && now - last < WARD_BOT_LIMITS.repeatMs) return { ok: false, why: "repeat", notice: false, retryAfterSeconds: Math.ceil((last + WARD_BOT_LIMITS.repeatMs - now) / 1_000) };

    const person = (args.direct ? this.direct : this.member).consume(`${args.chatId}|${args.userId}`);
    /* In a group the person who floods is not answered at all; in a private chat they are told once. */
    if (!person.allowed) return { ok: false, why: "member", notice: args.direct && this.notice(`member|${args.chatId}|${args.userId}`), retryAfterSeconds: person.retryAfterSeconds };
    if (!args.direct) {
      const group = this.chat.consume(String(args.chatId));
      if (!group.allowed) return { ok: false, why: "chat", notice: this.notice(`chat|${args.chatId}`), retryAfterSeconds: group.retryAfterSeconds };
    }
    const all = this.global.consume("all");
    if (!all.allowed) return { ok: false, why: "global", notice: this.notice(`global|${args.chatId}`), retryAfterSeconds: all.retryAfterSeconds };

    this.repeats.set(repeatKey, now);
    return { ok: true };
  }

  /** May the bot say something other than a verdict to this person (what to paste, what it does)? Out of the person's own budget, never the chain's. */
  mayHint(chatId: number, userId: number, direct: boolean): boolean {
    return (direct ? this.direct : this.member).consume(`${chatId}|${userId}`).allowed;
  }

  /** A check that did not happen does not count as answered: the same paste may be tried again. */
  forget(chatId: number, key: string): void {
    this.repeats.delete(`${chatId}|${key}`);
  }

  /** May the bot say something unasked here (its introduction)? Once per chat and window. */
  introduce(chatId: number): boolean {
    return this.notice(`intro|${chatId}`);
  }

  /** Addresses recently checked in this chat, newest first. */
  knownIn(chatId: number): readonly string[] {
    return this.known.get(chatId) ?? [];
  }

  remember(chatId: number, address: string): void {
    const list = (this.known.get(chatId) ?? []).filter((entry) => entry !== address);
    list.unshift(address);
    this.known.set(chatId, list.slice(0, WARD_BOT_LIMITS.knownPerChat));
  }

  private notice(key: string): boolean {
    return this.notices.consume(key).allowed;
  }
}
