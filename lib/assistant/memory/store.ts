/**
 * The assistant's memory of a person (AI-18) — in the Guard collection
 * `assistantProfiles` beside «Знайомство», under its own key, no DDL:
 *
 * - `memory:solana:mainnet:<wallet>` — «Про мене» in the person's own words
 *   and up to `MEMORY_NOTES_MAX` short notes Ryntra kept from what the person
 *   said about themselves («торгую мемкоїнами», «не люблю плече»), each with
 *   where it came from; versioned by compare-and-set, so two tabs never write
 *   over each other.
 *
 * Every word here is the person's own: a note is a sentence they wrote, never
 * a model's paraphrase and never a headline or a token's name read elsewhere.
 * It only shapes how Ryntra words an answer; it never adds a figure and never
 * becomes advice. «Забути» deletes the note, «Забути все» the whole record —
 * there is no copy elsewhere.
 */

import { randomUUID } from "node:crypto";

import { z } from "zod";

import type { GuardStore } from "../../guard/store.ts";
import { BIP39_ENGLISH } from "./bip39-english.ts";

export const MEMORY_COLLECTION = "assistantProfiles" as const;
export const MEMORY_NOTES_MAX = 30;
export const MEMORY_NOTE_MAX_CHARS = 160;
export const MEMORY_ABOUT_MAX_CHARS = 600;

const Wallet = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
const Iso = z.string().datetime({ offset: true });

export const MemoryNoteSchema = z
  .object({
    id: z.string().regex(/^m_[0-9a-f]{12}$/),
    text: z.string().min(2).max(MEMORY_NOTE_MAX_CHARS),
    /** `said` — Ryntra noticed it in the conversation; `asked` — the person said «запам'ятай»; `typed` — added by hand. */
    source: z.enum(["said", "asked", "typed"]),
    at: Iso,
  })
  .strict();
export type MemoryNote = z.infer<typeof MemoryNoteSchema>;

export const MemoryRecordSchema = z
  .object({
    schema: z.literal("ryntra.assistant.memory"),
    version: z.number().int().min(1),
    owner: Wallet,
    about: z.string().max(MEMORY_ABOUT_MAX_CHARS).nullable(),
    /** Whether Ryntra may keep what it notices; «запам'ятай» and typed notes are kept either way. */
    noticing: z.boolean(),
    notes: z.array(MemoryNoteSchema).max(MEMORY_NOTES_MAX),
    createdAt: Iso,
    updatedAt: Iso,
  })
  .strict();
export type MemoryRecord = z.infer<typeof MemoryRecordSchema>;

export const memoryKey = (owner: string) => `memory:solana:mainnet:${owner}`;

type Versioned = { version: number };
const records = (store: GuardStore) => store.versioned<Versioned & Record<string, unknown>>(MEMORY_COLLECTION);

/** A link of any kind — a scheme, `www.`, `t.me/…`, a bare `name.tld/…` — is never kept. */
const LINK = /(?:\b[a-z][a-z0-9+.-]*:\/\/\S+|\bwww\.\S+|(?<![\p{L}\p{N}@])[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,24}\b(?:\/\S*)?)/giu;

/**
 * What must never be kept, whoever asked: a seed phrase, a private key, a password, a code — by its words, or by its
 * shape (a base58 or hex string as long as a key, a recovery phrase by the BIP39 list, a long run of digits).
 */
const SECRET_WORDS = /(?<![\p{L}])(?:seed|сід|мнемон\p{L}*|фраз\p{L}* відновлен\p{L}*|recovery phrase|secret phrase|private key|приватн\p{L}* ключ\p{L}*|секретн\p{L}* ключ\p{L}*|ключ\p{L}* від гаманц\p{L}*|пароль|паролі|password|passphrase|passcode|2fa|otp|pin|пін|cvv|cvc|номер картки|card number|api key|апі ключ)(?![\p{L}])/iu;
const SECRET_SHAPES = /[1-9A-HJ-NP-Za-km-z]{32,}|\b(?:0x)?[0-9a-f]{32,}\b|\d{6,}/u;
/**
 * A recovery phrase: twelve words in a row of which eleven and more are in the BIP39 list — whatever stands between them
 * (quotes, commas, dashes, slashes, «#1», «1-», «1.»): only words count, so a pasted JSON array is caught the same way. One
 * word off the list is allowed for a typo; a sentence made of plain English words never has eleven of twelve in the list.
 */
const PHRASE_WINDOW = 12;
const PHRASE_HITS = 11;
function mnemonic(text: string): boolean {
  const words = text.toLowerCase().match(/\p{L}+/gu) ?? [];
  if (words.length < PHRASE_WINDOW) return false;
  let hits = 0;
  for (let i = 0; i < words.length; i += 1) {
    if (BIP39_ENGLISH.has(words[i]!)) hits += 1;
    if (i >= PHRASE_WINDOW && BIP39_ENGLISH.has(words[i - PHRASE_WINDOW]!)) hits -= 1;
    if (i >= PHRASE_WINDOW - 1 && hits >= PHRASE_HITS) return true;
  }
  return false;
}

export function looksSecret(text: string): boolean {
  return SECRET_WORDS.test(text) || SECRET_SHAPES.test(text) || mnemonic(text);
}

/**
 * A person's text as it may be kept: control characters and links out, spaces collapsed, cut at the limit on a word.
 * A link is never kept — a note is about the person, and a link is the one way text could point the model elsewhere.
 */
export function cleanText(raw: string, max: number): string {
  const flat = raw
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, " ")
    .replace(LINK, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return (space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:—-]+$/u, "") + "…";
}

/** The same thought twice is one note: compared without case, marks and spaces. */
export function sameNote(a: string, b: string): boolean {
  const key = (text: string) => text.toLocaleLowerCase("uk").replace(/[^\p{L}\p{N}]+/gu, "");
  return key(a) === key(b);
}

export function emptyMemory(owner: string, nowMs: number): MemoryRecord {
  const at = new Date(nowMs).toISOString();
  return { schema: "ryntra.assistant.memory", version: 1, owner, about: null, noticing: true, notes: [], createdAt: at, updatedAt: at };
}

export async function readMemoryRecord(store: GuardStore, owner: string): Promise<MemoryRecord | null> {
  const parsed = MemoryRecordSchema.safeParse(await records(store).get(memoryKey(owner)));
  return parsed.success && parsed.data.owner === owner ? parsed.data : null;
}

/** Write over the version read (`null` — none yet); false when someone else wrote first. */
export async function writeMemoryRecord(store: GuardStore, next: MemoryRecord, expected: number | null): Promise<boolean> {
  return records(store).compareAndSet(memoryKey(next.owner), expected, MemoryRecordSchema.parse(next));
}

export async function deleteMemoryRecord(store: GuardStore, owner: string): Promise<void> {
  await records(store).delete(memoryKey(owner));
}

export const newNoteId = () => `m_${randomUUID().replace(/-/g, "").slice(0, 12)}`;

/**
 * A change, applied by compare-and-set and tried again when another tab wrote first. `change` gets the current record
 * (or a fresh one) and returns the next one, or null for «nothing to write».
 */
export async function changeMemory(store: GuardStore, owner: string, nowMs: number, change: (current: MemoryRecord) => MemoryRecord | null): Promise<MemoryRecord> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const read = await readMemoryRecord(store, owner);
    const current = read ?? emptyMemory(owner, nowMs);
    const next = change(current);
    if (next === null) return current;
    const at = new Date(nowMs).toISOString();
    const written = { ...next, version: read ? read.version + 1 : 1, updatedAt: at };
    if (await writeMemoryRecord(store, written, read ? read.version : null)) return written;
  }
  throw new Error("MEMORY_BUSY");
}

/**
 * A note added at the end. When the list is full, a noticed note gives way first (the oldest), then a typed one, and only
 * then the oldest the person asked for. A secret is never kept, whoever asked.
 */
export function withNote(record: MemoryRecord, text: string, source: MemoryNote["source"], nowMs: number): MemoryRecord | null {
  const clean = cleanText(text, MEMORY_NOTE_MAX_CHARS);
  if (clean.length < 2 || looksSecret(text) || looksSecret(clean) || record.notes.some((note) => sameNote(note.text, clean))) return null;
  const notes = [...record.notes, { id: newNoteId(), text: clean, source, at: new Date(nowMs).toISOString() }];
  while (notes.length > MEMORY_NOTES_MAX) {
    const order: readonly MemoryNote["source"][] = ["said", "typed", "asked"];
    const at = order.map((kind) => notes.findIndex((note) => note.source === kind)).find((index) => index >= 0) ?? 0;
    notes.splice(at, 1);
  }
  return { ...record, notes };
}
