/**
 * The launch dock's draft: what a creator typed on the home page — name, ticker, picture — carried to the launch form in
 * this tab only (sessionStorage), so the form opens with the token filled in and its first step passed. It stays while
 * the creator goes back and forth (the dock and the form both read it) and is removed once the launch is sent or started
 * over; a forgotten one expires. Nothing leaves the browser here: the form checks the fields with its own rules and the
 * review shows them again before anything is uploaded or signed.
 */

import { imageTypeOf, IMAGE_MAX_BYTES } from "./form.ts";
import type { Picture } from "./picture.client.ts";

export const HOME_DRAFT_KEY = "ryntra:launch-draft";
/** The form's address when it opens on a draft from the home page. */
export const HOME_DRAFT_PATH = "/app/launch/new?from=home";
/** A draft older than this is a forgotten tab, not a launch in progress: the form ignores it. */
export const HOME_DRAFT_TTL_MS = 30 * 60 * 1000;

export type HomeDraft = Readonly<{ name: string; symbol: string; picture: Picture | null }>;

/** The draft as stored, with the moment it was written. */
export function encodeHomeDraft(draft: HomeDraft, now: number): string {
  return JSON.stringify({ v: 1, at: now, name: draft.name, symbol: draft.symbol, picture: draft.picture });
}

/** The draft from what is stored; null for anything else, for an old draft, and for one with nothing in it. */
export function decodeHomeDraft(raw: string | null, now: number): HomeDraft | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const entry = value as Record<string, unknown>;
  if (entry.v !== 1 || typeof entry.at !== "number" || now - entry.at > HOME_DRAFT_TTL_MS || entry.at - now > 60_000) return null;
  const name = typeof entry.name === "string" ? entry.name.slice(0, 64) : "";
  const symbol = typeof entry.symbol === "string" ? entry.symbol.slice(0, 20) : "";
  const picture = pictureOf(entry.picture);
  if (!name.trim() && !symbol.trim() && !picture) return null;
  return { name, symbol, picture };
}

/* Only a data: picture the form itself would have made: within the size the server takes, its base64 the address's own,
   and its first bytes the image type the address names. */
function pictureOf(value: unknown): Picture | null {
  if (!value || typeof value !== "object") return null;
  const entry = value as Record<string, unknown>;
  if (typeof entry.url !== "string" || typeof entry.base64 !== "string" || typeof entry.bytes !== "number") return null;
  const match = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(entry.url);
  if (!match || match[2] !== entry.base64 || entry.bytes <= 0 || entry.bytes > IMAGE_MAX_BYTES) return null;
  let head: Uint8Array;
  try {
    head = Uint8Array.from(atob(entry.base64.slice(0, 24)), (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
  if (imageTypeOf(head) !== match[1]) return null;
  return { url: entry.url, base64: entry.base64, bytes: entry.bytes };
}

/** Writes the draft for the form; false when this browser keeps nothing (a private window, blocked storage). */
export function writeHomeDraft(draft: HomeDraft): boolean {
  try {
    window.sessionStorage.setItem(HOME_DRAFT_KEY, encodeHomeDraft(draft, Date.now()));
    return true;
  } catch {
    return false;
  }
}

/** The draft, if this tab holds one still fresh; it stays for Back and Forward. */
export function readHomeDraft(): HomeDraft | null {
  try {
    return decodeHomeDraft(window.sessionStorage.getItem(HOME_DRAFT_KEY), Date.now());
  } catch {
    return null;
  }
}

/** Removes the draft: the launch is sent, or the creator started over. */
export function clearHomeDraft(): void {
  try {
    window.sessionStorage.removeItem(HOME_DRAFT_KEY);
  } catch {
    /* Nothing kept, nothing to remove. */
  }
}
