/**
 * Foreign text, cleaned before anything reads it (CITY-166).
 *
 * In a group everything but the bot's own words is someone else's: the message, a token's self-chosen name and
 * description, a payment request's label. None of it is trusted. Two passes:
 *
 * - `cleanIncoming` — the message as it arrives, before the bot looks for an address in it: invisible characters,
 *   direction overrides and control characters are dropped, so an address cannot be split, reversed or hidden, and the
 *   length is bounded.
 * - `cleanForeign` — any foreign string before it reaches a reply, a log or a model: everything above, plus markup,
 *   links, @handles and the marks the bot's own verdict uses, so a token named «⚪ No known blockers» cannot pass for
 *   a verdict; one line, clipped.
 *
 * The bot calls no model and puts no foreign text in its replies today; this is the one gate any such text passes.
 * Pure: no clock, no network.
 */

/** The longest message read; Telegram's own limit is 4 096. */
export const INCOMING_MAX = 4_096;

/* Zero-width and joiner characters, the word joiner and invisible operators, the byte-order mark, the soft hyphen. */
const INVISIBLE = /[­᠎​-‏⁠-⁤﻿]/g;
/* Embeddings, overrides and isolates: they reorder what is shown without changing what is there. */
const BIDI = /[‪-‮⁦-⁩]/g;
/* C0 and C1 controls, but not the tab and newline a person types. */
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
/* Variation selectors and tags: invisible modifiers that ride on visible characters. */
const MODIFIERS = /[︀-️]|\uDB40[\uDC00-\uDC7F]/g;
/* The marks the bot's verdict line starts with, and the ticks and crosses a fake verdict would borrow. */
const VERDICT_MARKS = /[⚪⚫\u{1F7E0}-\u{1F7EB}\u{1F534}-\u{1F535}✅☑✔❌❎✖⚠\u{1F6D1}\u{1F6AB}⭕]/gu;
const LINKS = /\b(?:https?:\/\/|www\.|t\.me\/|telegram\.me\/)\S*/gi;
const HANDLES = /(^|[^\w])@[A-Za-z0-9_]{3,}/g;
const TAGS = /<[^>]{0,200}>/g;

/** The message as it arrives, made safe to search for an address in. */
export function cleanIncoming(text: unknown): string {
  if (typeof text !== "string") return "";
  return text
    .slice(0, INCOMING_MAX)
    .normalize("NFC")
    .replace(INVISIBLE, "")
    .replace(BIDI, "")
    .replace(MODIFIERS, "")
    .replace(CONTROL, " ");
}

/** A foreign string, made safe to show or to hand on: one line, no markup, no links, no verdict marks, at most `max` characters. */
export function cleanForeign(text: unknown, max = 32): string {
  const once = cleanIncoming(text)
    .replace(TAGS, " ")
    .replace(LINKS, " ")
    .replace(HANDLES, "$1")
    .replace(VERDICT_MARKS, "")
    .replace(/[<>&"`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const chars = Array.from(once);
  if (max < 1 || chars.length <= max) return max < 1 ? "" : once;
  return `${chars.slice(0, max - 1).join("").trimEnd()}…`;
}
