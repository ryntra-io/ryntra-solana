import type { Title, VaultId } from "./levels";

/**
 * What the vault keeps: each person's attempts for the limits, what they cracked, the public feed and the answers to
 * request keys. The interface is the vault's; a deployment keeps it in the database (`supabase-store.ts`,
 * `supabase/migrations/*_vault_v1.sql`), so every server instance counts the same limits and reads the same feed.
 * This file also has the memory store — for tests and a developer's machine only: it lives as long as one warm
 * instance, so the server never opens the vault in production on it (`server.ts`). Nothing here is money: the free
 * vaults' worst case is a model's cost, and that has its own dollar limit on every guard's key (CITY-45).
 */

export type Window = { name: "minute" | "day"; ms: number; limit: number };

export type Take =
  | { ok: true; ticket: string; left: Record<Window["name"], number> }
  | { ok: false; window: Window["name"]; retryAfterS: number };

export type Progress = {
  /** Every vault cracked, with the day it was cracked (the latest one for the daily vault). */
  cracked: Partial<Record<VaultId, string>>;
  /** Days the daily vault was cracked on, newest first, at most a month. */
  dailyDays: string[];
  points: number;
  title: Title | null;
};

export const emptyProgress = (): Progress => ({ cracked: {}, dailyDays: [], points: 0, title: null });

/** A crack to record: what it pays and, for the last practice level, the title it brings. */
export type Crack = {
  vault: VaultId;
  /** The UTC day, `YYYY-MM-DD`. */
  day: string;
  points: number;
  /** The title this vault brings, given only to a person who has none yet. */
  title: Title | null;
  /** How many of the daily vault's days a person's progress keeps. */
  keepDays: number;
};

export type Cracked = {
  /** Whether this call recorded the crack: false when it was cracked before (ever, or today for the daily vault). */
  recorded: boolean;
  /** The title this call gave, if it gave one. */
  title: Title | null;
  /** The person's progress after the call. */
  progress: Progress;
};

/** Whether a person has cracked a vault: a practice level ever, the daily vault on that day. */
export const crackedOn = (progress: Progress, vault: VaultId, day: string) => (vault === "daily" ? progress.cracked.daily === day : !!progress.cracked[vault]);

/**
 * What a crack does to a person's progress: a practice level once ever, the daily vault once a day; the title with the
 * last level. The database does the same in `public.vault_crack`, in one transaction.
 */
export function applyCrack(progress: Progress, crack: Crack): Cracked {
  if (crackedOn(progress, crack.vault, crack.day)) return { recorded: false, title: null, progress };
  const next: Progress = structuredClone(progress);
  next.cracked[crack.vault] = crack.day;
  if (crack.vault === "daily") next.dailyDays = [crack.day, ...next.dailyDays.filter((d) => d !== crack.day)].slice(0, crack.keepDays);
  next.points += crack.points;
  const title = crack.title && next.title === null ? crack.title : null;
  if (title) next.title = title;
  return { recorded: true, title, progress: next };
}

export type FeedOutcome = "held" | "leaked" | "caught" | "cracked" | "screened";

export type FeedEntry = {
  id: string;
  vault: VaultId;
  at: string;
  /** Who tried, as anyone may see it: a short tag, never an address or an id. */
  who: string;
  outcome: FeedOutcome;
  /** The guard's reply with every word of the dictionary masked; null when the guard did not hear the attempt. */
  reply: string | null;
  pressure: number;
  /** The attempt with every word of the dictionary masked; the routes show it only ten minutes after it was made. */
  attempt: string;
};

export interface VaultStore {
  /** True for a store every server instance shares (the database); false for one instance's memory. */
  readonly durable: boolean;
  /** Counts an attempt against every window at once, or says which window is full. Atomic for one key. */
  take(key: string, windows: readonly Window[], now: number): Promise<Take>;
  /** Gives back an attempt that did not happen (the guard never answered). */
  giveBack(key: string, ticket: string): Promise<void>;
  /** What is left in every window, without counting anything. */
  left(key: string, windows: readonly Window[], now: number): Promise<Record<Window["name"], { left: number; resetS: number }>>;
  progress(who: string): Promise<Progress>;
  /** Records a crack on the progress as it is at that moment, atomically: two cracks at once are counted once. */
  crack(who: string, crack: Crack, now: number): Promise<Cracked>;
  push(entry: FeedEntry): Promise<void>;
  /** The newest entries of a vault's feed, before an entry if one is named. */
  feed(vault: VaultId, limit: number, before?: string | null): Promise<FeedEntry[]>;
  /** A stored answer to a request key, so a retried attempt is never counted twice. */
  answer(key: string, now: number): Promise<unknown | null>;
  keepAnswer(key: string, body: unknown, now: number): Promise<void>;
}

/** The store could not be reached or answered in a way the vault does not read: nothing it was asked is known. */
export class VaultStoreUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VaultStoreUnavailable";
  }
}

/** The start of the UTC day a moment falls in. */
export const dayStart = (now: number) => Math.floor(now / 86_400_000) * 86_400_000;

/** How long the answer to a request key is kept: a retry comes within minutes. */
export const ANSWER_MS = 10 * 60_000;

const FEED_KEEP = 200;
const KEYS_KEEP = 20_000;

type Mark = { at: number; ticket: string };

/** One instance's memory: for tests and a developer's machine. Never what a deployment opens on. */
export function createMemoryVaultStore(): VaultStore {
  const attempts = new Map<string, Mark[]>();
  const progress = new Map<string, Progress>();
  const feeds = new Map<VaultId, FeedEntry[]>();
  const answers = new Map<string, { body: unknown; until: number }>();
  let tickets = 0;

  /** Marks older than the longest window are gone; the map never grows past its bound. */
  const marksOf = (key: string, windows: readonly Window[], now: number) => {
    const oldest = Math.min(...windows.map((w) => start(w, now)));
    const marks = (attempts.get(key) ?? []).filter((m) => m.at >= oldest);
    attempts.delete(key);
    while (attempts.size >= KEYS_KEEP) attempts.delete(attempts.keys().next().value as string);
    attempts.set(key, marks);
    return marks;
  };
  // The minute is a sliding minute; the day is the UTC day, so "25 a day" starts again at midnight.
  const start = (w: Window, now: number) => (w.name === "day" ? dayStart(now) : now - w.ms);
  const end = (w: Window, marks: Mark[], now: number) => (w.name === "day" ? dayStart(now) + 86_400_000 : (marks.find((m) => m.at > now - w.ms)?.at ?? now) + w.ms);

  return {
    durable: false,
    async take(key, windows, now) {
      const marks = marksOf(key, windows, now);
      for (const w of windows) {
        const inside = marks.filter((m) => m.at >= start(w, now));
        if (inside.length >= w.limit) return { ok: false, window: w.name, retryAfterS: Math.max(1, Math.ceil((end(w, inside, now) - now) / 1000)) };
      }
      const ticket = `t${++tickets}`;
      marks.push({ at: now, ticket });
      const left = Object.fromEntries(windows.map((w) => [w.name, w.limit - marks.filter((m) => m.at >= start(w, now)).length])) as Record<Window["name"], number>;
      return { ok: true, ticket, left };
    },
    async giveBack(key, ticket) {
      const marks = attempts.get(key);
      if (marks) attempts.set(key, marks.filter((m) => m.ticket !== ticket));
    },
    async left(key, windows, now) {
      const marks = (attempts.get(key) ?? []).filter((m) => m.at >= Math.min(...windows.map((w) => start(w, now))));
      return Object.fromEntries(
        windows.map((w) => {
          const inside = marks.filter((m) => m.at >= start(w, now));
          return [w.name, { left: Math.max(0, w.limit - inside.length), resetS: inside.length ? Math.max(1, Math.ceil((end(w, inside, now) - now) / 1000)) : 0 }];
        }),
      ) as Record<Window["name"], { left: number; resetS: number }>;
    },
    async progress(who) {
      const p = progress.get(who);
      return p ? structuredClone(p) : emptyProgress();
    },
    async crack(who, crack) {
      // Read and write with no await between them: one turn of the event loop, so two cracks at once count once.
      const done = applyCrack(progress.get(who) ?? emptyProgress(), crack);
      if (done.recorded) {
        progress.delete(who);
        while (progress.size >= KEYS_KEEP) progress.delete(progress.keys().next().value as string);
        progress.set(who, structuredClone(done.progress));
      }
      return { ...done, progress: structuredClone(done.progress) };
    },
    async push(entry) {
      const list = feeds.get(entry.vault) ?? [];
      list.unshift(entry);
      list.length = Math.min(list.length, FEED_KEEP);
      feeds.set(entry.vault, list);
    },
    async feed(vault, limit, before) {
      const list = feeds.get(vault) ?? [];
      const from = before ? list.findIndex((e) => e.id === before) + 1 : 0;
      return before && from === 0 ? [] : list.slice(from, from + limit);
    },
    async answer(key, now) {
      const kept = answers.get(key);
      return kept && kept.until > now ? kept.body : null;
    },
    async keepAnswer(key, body, now) {
      for (const [k, v] of answers) if (v.until <= now) answers.delete(k);
      while (answers.size >= KEYS_KEEP) answers.delete(answers.keys().next().value as string);
      answers.set(key, { body, until: now + ANSWER_MS });
    },
  };
}
