/**
 * «Contacts»: a person's own address book, bound to their wallet. One
 * contact is a name, where the money goes — a Solana address or a `.skr` name — and a short note.
 *
 * Every change is the wallet's own word: the client builds the change's text with `changeText` below, the wallet signs
 * that text as a message (never a transaction), and the server builds the very same text again from the fields it was
 * sent and checks the wallet's signature over it (`./service.server.ts`). The text names the wallet, the change, a
 * fresh nonce and when it was signed, so a signature never changes another wallet's book, never does twice, and never
 * outlives a few minutes.
 *
 * Pure: no clock it is not given, no network, no store — the screen, the server and the tests share it.
 */

import { addressProblem } from "../solana/address.ts";
import { lookalikeOf, skrNameOf } from "../solana/skr-name.ts";

/** The most contacts one wallet keeps. */
export const CONTACTS_MAX = 200;
/** A name's length, in characters, after it is tidied. */
export const NAME_MAX = 40;
/** A note's length, in characters, after it is tidied. */
export const NOTE_MAX = 120;
/** How long a signed change stays good: the wallet signed it moments ago, not yesterday. */
export const CHANGE_FRESH_MS = 5 * 60_000;
/** A nonce: 16 to 64 letters and digits the client draws at random. */
export const NONCE = /^[A-Za-z0-9]{16,64}$/;
/** A contact's id: a UUID the client draws when it adds one, so the signed text can name it. */
export const CONTACT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const CHANGE_ACTIONS = ["add", "edit", "remove"] as const;
export type ChangeAction = (typeof CHANGE_ACTIONS)[number];

/** One contact as the book keeps it and the screen shows it. `to` is an address or a `.skr` name, in its one form. */
export type Contact = Readonly<{
  id: string;
  name: string;
  to: string;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}>;

/** Where a contact's money goes: an address as it is, or a `.skr` name the engine resolves at the moment of sending. */
export type ContactTarget = Readonly<{ kind: "address"; value: string }> | Readonly<{ kind: "name"; value: string }>;

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** The bytes a base58 string decodes to; null when a character is not base58. */
function base58Bytes(value: string): Uint8Array | null {
  let number = 0n;
  for (const char of value) {
    const digit = BASE58_ALPHABET.indexOf(char);
    if (digit < 0) return null;
    number = number * 58n + BigInt(digit);
  }
  const bytes: number[] = [];
  while (number > 0n) {
    bytes.unshift(Number(number % 256n));
    number /= 256n;
  }
  for (const char of value) {
    if (char !== "1") break;
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}

/** A Solana address in its one spelling: base58 of exactly 32 bytes. Off-curve addresses (a vault, a program) count too. */
export function isAddress(value: string): boolean {
  if (addressProblem(value) !== null || value !== value.trim()) return false;
  const bytes = base58Bytes(value);
  return bytes !== null && bytes.length === 32;
}

/** Where `typed` sends money, or null when it is neither an address nor a `.skr` name. */
export function targetOf(typed: string): ContactTarget | null {
  const value = typeof typed === "string" ? typed.trim() : "";
  if (value === "") return null;
  if (value.toLowerCase().endsWith(".skr")) {
    const name = skrNameOf(value);
    return name ? { kind: "name", value: name } : null;
  }
  return isAddress(value) ? { kind: "address", value } : null;
}

/** Control characters, zero-width marks and direction overrides: each becomes a plain space before the text is kept. */
const INVISIBLE = (code: number): boolean =>
  code <= 0x1f || code === 0x7f || (code >= 0x200b && code <= 0x200f) || (code >= 0x2028 && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069) || code === 0xfeff;

/** Spaces at the edges dropped, runs of spaces and line breaks made one space, the one Unicode form. */
function tidy(text: string): string {
  let out = "";
  for (const char of text.normalize("NFC")) out += INVISIBLE(char.codePointAt(0) ?? 0) ? " " : char;
  return out.replace(/\s+/g, " ").trim();
}

/** A name as the book keeps it; null when it is empty or longer than `NAME_MAX`. */
export function nameOf(typed: string): string | null {
  if (typeof typed !== "string") return null;
  const name = tidy(typed);
  return name.length >= 1 && [...name].length <= NAME_MAX ? name : null;
}

/** A note as the book keeps it: null for none; undefined when it is longer than `NOTE_MAX`. */
export function noteOf(typed: string | null | undefined): string | null | undefined {
  if (typed === null || typed === undefined) return null;
  if (typeof typed !== "string") return undefined;
  const note = tidy(typed);
  if (note === "") return null;
  return [...note].length <= NOTE_MAX ? note : undefined;
}

/** What a person typed for a contact, before it is tidied. */
export type ContactDraft = Readonly<{ name: string; to: string; note?: string | null }>;

export type DraftIssue = "name" | "to" | "note" | "self";

/** The first thing wrong with a draft, as the form marks its field; null when the book takes it. */
export function draftIssue(draft: ContactDraft, owner: string | null = null): DraftIssue | null {
  if (nameOf(draft.name) === null) return "name";
  const target = targetOf(draft.to);
  if (!target) return "to";
  if (owner && target.kind === "address" && target.value === owner) return "self";
  if (noteOf(draft.note) === undefined) return "note";
  return null;
}

/** A draft as the book keeps it; null when `draftIssue` finds anything. */
export function cleanDraft(draft: ContactDraft, owner: string | null = null): Readonly<{ name: string; to: string; note: string | null }> | null {
  if (draftIssue(draft, owner) !== null) return null;
  return { name: nameOf(draft.name)!, to: targetOf(draft.to)!.value, note: noteOf(draft.note) ?? null };
}

/**
 * Another contact whose address this one imitates — the same first and last four characters, another middle (the
 * address-poisoning trick, `lookalikeOf`). The form says it before the wallet signs; null when it imitates none.
 */
export function lookalikeContact(contacts: readonly Contact[], to: string, except: string | null = null): Contact | null {
  const target = targetOf(to);
  if (!target || target.kind !== "address") return null;
  const others = contacts.filter((contact) => contact.id !== except && targetOf(contact.to)?.kind === "address");
  const match = lookalikeOf(
    others.map((contact) => contact.to),
    target.value,
  );
  return match ? (others.find((contact) => contact.to === match) ?? null) : null;
}

/** The contact already kept for this address or name; null when there is none. */
export function contactFor(contacts: readonly Contact[], to: string): Contact | null {
  const target = targetOf(to);
  if (!target) return null;
  return contacts.find((contact) => contact.to === target.value) ?? null;
}

/**
 * The contacts that answer what was typed in «To»: by name first, then by address or `.skr` name; empty input — the
 * newest few. At most `limit`.
 */
export function suggestions(contacts: readonly Contact[], typed: string, limit = 5): readonly Contact[] {
  const query = tidy(typeof typed === "string" ? typed : "").toLowerCase();
  const newest = contacts.slice().sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
  if (query === "") return newest.slice(0, limit);
  const byName = newest.filter((contact) => contact.name.toLowerCase().includes(query));
  const byTo = newest.filter((contact) => !byName.includes(contact) && contact.to.toLowerCase().startsWith(query));
  return [...byName, ...byTo].slice(0, limit);
}

/* ── the signed change ─────────────────────────────────────────────────────────────────────────────────────────── */

/** One change of the book, as the wallet signs it. `name`, `to` and `note` are tidied already; a removal carries none. */
export type ContactChange = Readonly<{
  action: ChangeAction;
  wallet: string;
  id: string;
  name: string | null;
  to: string | null;
  note: string | null;
  nonce: string;
  /** When the client built it, ISO 8601 in UTC. */
  issuedAt: string;
}>;

/** Why a change is not one the book takes, before any signature is read; null when it is. */
export function changeRefusal(change: ContactChange): string | null {
  if (!(CHANGE_ACTIONS as readonly string[]).includes(change.action)) return "the change is add, edit or remove";
  if (!isAddress(change.wallet)) return "the wallet is a Solana address";
  if (!CONTACT_ID.test(change.id)) return "the contact's id is a UUID";
  if (!NONCE.test(change.nonce)) return "the nonce is 16 to 64 letters and digits";
  if (Number.isNaN(Date.parse(change.issuedAt)) || new Date(change.issuedAt).toISOString() !== change.issuedAt) return "the time is ISO 8601 in UTC";
  if (change.action === "remove") return change.name === null && change.to === null && change.note === null ? null : "a removal carries no fields";
  const clean = cleanDraft({ name: change.name ?? "", to: change.to ?? "", note: change.note }, change.wallet);
  if (!clean) return "the contact's name, address or note is not one the book keeps";
  if (clean.name !== change.name || clean.to !== change.to || clean.note !== change.note) return "the fields are not in their tidy form";
  return null;
}

/** Whether a change was signed close enough to `nowMs`: within `CHANGE_FRESH_MS` either way (clocks differ a little). */
export function changeFresh(change: Pick<ContactChange, "issuedAt">, nowMs: number): boolean {
  const at = Date.parse(change.issuedAt);
  return Number.isFinite(at) && Math.abs(nowMs - at) <= CHANGE_FRESH_MS;
}

/**
 * The text the wallet signs for a change — the same on the client and the server, line for line. It says plainly what
 * the person allows, so the wallet's own window reads as the change itself.
 */
export function changeText(change: ContactChange): string {
  const lines = ["Ryntra — contacts", `Change: ${change.action}`, `Wallet: ${change.wallet}`, `Contact: ${change.id}`];
  if (change.action !== "remove") {
    lines.push(`Name: ${change.name ?? ""}`, `To: ${change.to ?? ""}`, `Note: ${change.note ?? "—"}`);
  }
  lines.push(`Nonce: ${change.nonce}`, `Issued: ${change.issuedAt}`);
  return lines.join("\n");
}

/** A contact of the store's answer, or null when it is not one the screen shows. */
export function contactOf(raw: unknown): Contact | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const id = typeof row.id === "string" && CONTACT_ID.test(row.id) ? row.id : null;
  const name = typeof row.name === "string" ? nameOf(row.name) : null;
  const to = typeof row.to === "string" ? targetOf(row.to)?.value ?? null : null;
  const note = row.note === null || row.note === undefined ? null : typeof row.note === "string" ? noteOf(row.note) ?? null : null;
  const createdAt = typeof row.createdAt === "string" ? row.createdAt : null;
  const updatedAt = typeof row.updatedAt === "string" ? row.updatedAt : createdAt;
  if (!id || !name || !to || !createdAt || !updatedAt) return null;
  return { id, name, to, note, createdAt, updatedAt };
}
