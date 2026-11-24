import { createHash } from "node:crypto";

import type { InboxRecord } from "../monitoring/store.ts";
import { DRIVE_TRIGGER, EXIT_FAILED, xText, type DriveEvent } from "./events.ts";
import { coinName, heldText, solPlain, solSigned, type Lang } from "./figures.ts";
import { DRIVE_WORDS } from "./words.ts";

/**
 * A drive event as the engine's inbox keeps it — both languages, said in hers — and as Telegram and the phone carry it:
 * one line, one line under it, and the buttons. Every note of a mandate opens the agent's own page (`/agent/pulse`),
 * where «Stop» is the one action; in Telegram «Stop» stands under the message itself, and a closed trade that came back
 * with more carries «Share on X». The week opens the person's bots. Pure.
 */

/** The agent's own page: what it just did, and «Stop». */
export const PULSE_PATH = "/agent/pulse";
/** Where the week opens: the bots at work, the week under them. */
export const DRIVE_HOME = "/bots/recurring";

export const pulseHref = (policy: string, card: string | null = null) => `${PULSE_PATH}?p=${policy}${card ? `&x=${card}` : ""}`;
/** «Stop» from a message: the agent's page, its one action ready. */
export const stopHref = (href: string) => `${href}${href.includes("?") ? "&" : "?"}do=stop`;
/** «Share on X» from a message: the card's own way to X's composer (`/api/v1/agent-drive/card/<id>/post`). */
export const shareHref = (card: string, lang: Lang) => `/api/v1/agent-drive/card/${card}/post?l=${lang}`;

export function isDriveNote(note: Readonly<{ triggerId: string }>): boolean {
  return typeof note.triggerId === "string" && note.triggerId.startsWith(DRIVE_TRIGGER);
}

/** The kind a drive note tells, read from its identity; null — not a drive note. */
export function driveKindOf(note: Readonly<{ triggerId: string }>): DriveEvent["kind"] | "week" | null {
  if (!isDriveNote(note)) return null;
  const kind = note.triggerId.slice(DRIVE_TRIGGER.length).split(":")[0];
  return kind === "bought" || kind === "sold" || kind === "paused" || kind === "stopped" || kind === EXIT_FAILED || kind === "week" ? kind : null;
}

const hash = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 24);

/** An event's two lines in one language. */
export function driveWords(event: DriveEvent, lang: Lang): Readonly<{ title: string; reason: string }> {
  const w = DRIVE_WORDS[lang];
  const coin = coinName(event.coin, lang);
  switch (event.kind) {
    case "bought":
      return { title: w.bought(coin), reason: w.boughtLine(solPlain(event.spentRaw, lang)) };
    case "sold": {
      const entry = BigInt(event.entryRaw);
      const x = entry > 0n ? xText(Number((BigInt(event.exitRaw) * 1000n) / entry) / 1000, lang) : solSigned((BigInt(event.exitRaw) - entry).toString(), lang);
      const held = event.openedAt === null ? null : heldText(event.at - event.openedAt, lang);
      const line = w.soldLine(solPlain(event.entryRaw, lang), solPlain(event.exitRaw, lang), held);
      return { title: w.sold(coin, x), reason: event.why ? `${line} · ${w[`sale_${event.why}`]}` : line };
    }
    case "paused":
      return { title: w.paused, reason: `${coin} · ${w[`pause_${event.why}`]}` };
    case "stopped":
      return { title: w.stopped, reason: `${coin} · ${w[`stop_${event.why}`]}` };
    case EXIT_FAILED:
      return { title: w.exitFailed(coin), reason: w.exitFailedLine(w[`sale_${event.why}`]) };
  }
}

/** The note of one event: it opens the agent's page — with the closed trade's card when it is worth sharing. */
export function driveNote(event: DriveEvent, identity: string, locale: Lang, nowMs: number, card: string | null = null): InboxRecord {
  const en = driveWords(event, "en");
  const uk = driveWords(event, "uk");
  const own = locale === "uk" ? uk : en;
  return {
    id: `inb_${hash(identity)}`,
    owner: event.owner,
    monitorId: `mon_${hash(`${DRIVE_TRIGGER}${event.owner}`)}`,
    triggerId: identity,
    title: own.title,
    reason: own.reason,
    context: own.title,
    href: pulseHref(event.policy, event.kind === "sold" ? card : null),
    cta: DRIVE_WORDS[locale].open,
    paper: false,
    unread: true,
    createdAt: new Date(nowMs).toISOString(),
    locale,
    text: { en, uk },
  };
}

/** The week as one note: its two lines in both languages, opening the person's bots. */
export function weekNote(owner: string, identity: string, text: Readonly<Record<Lang, Readonly<{ title: string; reason: string }>>>, locale: Lang, nowMs: number): InboxRecord {
  const own = text[locale];
  return {
    id: `inb_${hash(identity)}`,
    owner,
    monitorId: `mon_${hash(`${DRIVE_TRIGGER}${owner}`)}`,
    triggerId: identity,
    title: own.title,
    reason: own.reason,
    context: own.title,
    href: DRIVE_HOME,
    cta: DRIVE_WORDS[locale].open,
    paper: false,
    unread: true,
    createdAt: new Date(nowMs).toISOString(),
    locale,
    text: { en: text.en, uk: text.uk },
  };
}

type Button = Readonly<{ text: string; url?: string; callback_data?: string }>;
export type DriveKeyboard = readonly (readonly Button[])[];

/** The card a note links to, from its address; null — none. */
export function cardOfHref(href: string): string | null {
  const match = /[?&]x=([a-f0-9]{20})(?:&|$)/u.exec(href);
  return match ? match[1]! : null;
}

/**
 * The note's buttons in Telegram: «Stop agent» under every move of an agent still at work, «Share on X» under a closed
 * trade whose note carries its card (only one that came back with more does), and the link to the agent.
 */
export function driveKeyboard(note: Readonly<{ triggerId: string; href: string; locale: Lang }>, link: Readonly<{ text: string; url: string }>, origin: string): DriveKeyboard {
  const w = DRIVE_WORDS[note.locale === "uk" ? "uk" : "en"];
  const kind = driveKindOf(note);
  const card = kind === "sold" ? cardOfHref(note.href) : null;
  const share: readonly Button[] = card ? [{ text: w.share, url: `${origin}${shareHref(card, note.locale)}` }] : [];
  if (kind === "bought" || kind === "paused" || kind === "sold" || kind === EXIT_FAILED) {
    return [...(share.length ? [share] : []), [{ text: w.stop, url: `${origin}${stopHref(note.href)}` }, link]];
  }
  return [[link]];
}
