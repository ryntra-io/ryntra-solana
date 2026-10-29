/**
 * What a note is, and every decision about it that needs no store: the
 * channels, the person's settings and what becomes of one note's delivery.
 *
 * It lives apart from `channel.ts` so a page can read a note and the
 * settings without pulling the server's store and crypto into the browser.
 * Pure: the pages, the routes and the channel read it the same way.
 */

import { inQuietHours, nextQuietEndMs, isValidQuietHours, type QuietHours } from "../../monitoring/quiet-hours.ts";

/** The channels a note can leave by. Both are shared with the rest of Ryntra: one browser subscription, one Telegram chat. */
export const NOTE_CHANNELS = Object.freeze(["webpush", "telegram"] as const);
export type NoteChannel = (typeof NOTE_CHANNELS)[number];

/** How many notes of one wallet reach the channels in one clock hour unless the person says otherwise. */
export const NOTES_PER_HOUR_DEFAULT = 12;
export const NOTES_PER_HOUR_MIN = 1;
export const NOTES_PER_HOUR_MAX = 60;
/** Inside this window the same thing happening again raises one note's count instead of writing a second. */
export const NOTE_GROUP_MS = 6 * 3_600_000;
/** How many notes of a wallet are kept; older ones go. */
export const NOTES_KEPT = 60;

export type NotifyPrefs = Readonly<{
  version: number;
  wallet: string;
  /** The one touch: off, and no note leaves by any channel. */
  on: boolean;
  channels: readonly NoteChannel[];
  quietHours: QuietHours | null;
  perHour: number;
  updatedAt: string;
}>;

/** Where a note's delivery got to, decided once and kept on the note. */
export type NoteDelivery = "sent" | "quiet" | "capped" | "off" | "no_channel" | "failed";

export type Note = Readonly<{
  version: number;
  wallet: string;
  /** The grouping identity: the same thing happening again finds this note. */
  id: string;
  kind: string;
  /** What the words are made of. Figures and ids only — no text of the provider's, nothing of a person. */
  facts: Readonly<Record<string, string | number | null>>;
  /** Where in the app the note points. */
  href: string;
  /** True for a note about the simulated account, so a page never prints it as real money. */
  paper: boolean;
  /** How many times this thing has happened inside the grouping window. */
  count: number;
  delivery: NoteDelivery | null;
  /** When the channels may be used, for a note the quiet hour held back. */
  deliverAfter: string | null;
  readAt: string | null;
  createdAt: string;
  updatedAt: string;
}>;

/** What a caller asks to be told, before the channel decides anything about it. */
export type NoteDraft = Readonly<{
  kind: string;
  /** What makes this the same thing happening again; the wallet is added here. */
  identity: string;
  facts?: Readonly<Record<string, string | number | null>>;
  href: string;
  paper?: boolean;
  /**
   * A standing fact rather than something that happens again: said once and
   * never raised or renewed. A market stays decided, so a pass that runs
   * every ten minutes must not count it ten times an hour.
   */
  once?: boolean;
}>;

/** The words of one note, in the language the reader asked for; the caller owns them. */
export type NoteWords = Readonly<{ title: string; body: string; cta: string }>;

/**
 * The transports. Each answers what became of one wallet's one note; a
 * transport the deployment has no key for answers `none`, which is not a
 * failure — the list in the app still carries the note.
 */
export type NotifyTransports = Readonly<{
  webpush?: (wallet: string, nowMs: number) => Promise<"sent" | "none" | "failed">;
  telegram?: (wallet: string, words: NoteWords, href: string) => Promise<"sent" | "none" | "failed">;
}>;

/* ------------------------------------------------------------------ the person's settings */

export function defaultPrefs(wallet: string, nowMs: number = Date.now()): NotifyPrefs {
  return { version: 0, wallet, on: true, channels: [...NOTE_CHANNELS], quietHours: null, perHour: NOTES_PER_HOUR_DEFAULT, updatedAt: new Date(nowMs).toISOString() };
}

export type PrefsChange = Readonly<{ on?: boolean; channels?: readonly string[]; quietHours?: unknown; perHour?: number }>;

/** The person's own change, clamped to what the channel can honour. Anything unreadable leaves that choice as it was. */
export function mergePrefs(current: NotifyPrefs, change: PrefsChange, nowMs: number): NotifyPrefs {
  const channels = change.channels === undefined ? current.channels : NOTE_CHANNELS.filter((c) => change.channels!.includes(c));
  const asked = change.quietHours;
  const quietHours =
    asked === undefined ? current.quietHours
    : asked === null ? null
    : isValidQuietHours(asked as QuietHours) ? { start: (asked as QuietHours).start, end: (asked as QuietHours).end, timezone: (asked as QuietHours).timezone }
    : current.quietHours;
  const perHour = change.perHour === undefined || !Number.isFinite(change.perHour) ? current.perHour : Math.min(NOTES_PER_HOUR_MAX, Math.max(NOTES_PER_HOUR_MIN, Math.round(change.perHour)));
  return { ...current, on: change.on ?? current.on, channels, quietHours, perHour, updatedAt: new Date(nowMs).toISOString() };
}

/** What becomes of a note's channels, before any transport is called. */
export function deliveryDecision(prefs: NotifyPrefs, nowMs: number): Readonly<{ decision: Exclude<NoteDelivery, "sent" | "failed"> | "send"; until: number | null }> {
  if (!prefs.on) return { decision: "off", until: null };
  if (prefs.channels.length === 0) return { decision: "no_channel", until: null };
  if (inQuietHours(nowMs, prefs.quietHours)) return { decision: "quiet", until: nextQuietEndMs(nowMs, prefs.quietHours) };
  return { decision: "send", until: null };
}
