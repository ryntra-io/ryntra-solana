/**
 * What Ryntra knows about a person (AI-18) — the view, the changes, and the few
 * lines the model reads about its reader.
 *
 * The view is three things the person can see and erase: «Про мене» in their
 * own words, the notes Ryntra kept from what they said about themselves, and
 * the answers of «Знайомство». Beside them, what the wallet shows right now —
 * read, never kept.
 *
 * The model reads the person only as words about how to talk to them: the
 * notes and «Про мене» travel as untrusted text the instruction says never to
 * follow, never to quote a figure from and never to turn into a trade.
 */

import type { AssistantMemoryResponse, AssistantMemoryUpdate, AssistantWalletPicture } from "../../api/v1/contract.ts";
import type { GuardStore } from "../../guard/store.ts";
import { profileOf, readProfileRecord } from "../profile/store.ts";
import { noticeInMessage, type Noticed } from "./notice.ts";
import { MEMORY_ABOUT_MAX_CHARS, MEMORY_NOTE_MAX_CHARS, changeMemory, cleanText, deleteMemoryRecord, looksSecret, readMemoryRecord, withNote, type MemoryNote, type MemoryRecord } from "./store.ts";

/** A row of the wallet as the holdings read gives it — only what the picture needs. */
export type WalletRow = Readonly<{ mint: string; symbol: string | null; amountRaw: string; decimals: number | null; catalog: Readonly<{ symbol?: string | null; usdPrice?: string | number | null }> | null }>;
export type WalletRead = Readonly<{ ok: true; holdings: readonly WalletRow[] }> | Readonly<{ ok: false }>;

/** How many tokens the wallet holds and the largest five by value — from the read, never from the model. */
export function walletPicture(read: WalletRead | null): AssistantWalletPicture {
  if (read === null || !read.ok) return { state: "unavailable", tokens: null, largest: [] };
  const valued = read.holdings
    .map((row) => {
      let amount = 0;
      try {
        amount = Number(BigInt(row.amountRaw)) / 10 ** (row.decimals ?? 0);
      } catch {
        amount = 0;
      }
      const symbol = (row.symbol ?? row.catalog?.symbol ?? "").trim();
      const price = Number(row.catalog?.usdPrice ?? 0);
      return { mint: row.mint, symbol, value: amount * (Number.isFinite(price) ? price : 0), amount };
    })
    .filter((row) => row.amount > 0);
  const largest = valued
    .filter((row) => row.symbol.length > 0 && row.symbol.length <= 16 && row.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 5)
    .map((row) => ({ symbol: row.symbol, mint: row.mint }));
  return { state: "current", tokens: valued.length, largest };
}

export async function readMemoryView(store: GuardStore, owner: string, wallet: WalletRead | null): Promise<AssistantMemoryResponse> {
  /* One read at a time: a store with one connection (the stand's) refuses two at once. */
  const memory = await readMemoryRecord(store, owner);
  const profile = await readProfileRecord(store, owner);
  return {
    about: memory?.about ?? null,
    noticing: memory?.noticing ?? true,
    notes: (memory?.notes ?? []).map((note) => ({ ...note })),
    profile: profileOf(profile),
    wallet: walletPicture(wallet),
    updatedAt: memory?.updatedAt ?? null,
  };
}

export type MemoryChange = Readonly<{ ok: true } | { ok: false; code: "VALIDATION_ERROR" | "MEMORY_SECRET_REFUSED"; reason: string }>;

export async function updateMemory(store: GuardStore, owner: string, body: AssistantMemoryUpdate, nowMs: number): Promise<MemoryChange> {
  if (typeof body.note === "string" && cleanText(body.note, MEMORY_NOTE_MAX_CHARS).length < 2) return { ok: false, code: "VALIDATION_ERROR", reason: "The note is empty." };
  /* A key, a password, a recovery phrase is never kept — not in a note, not in «Про мене»: it would travel with every question. */
  if ((typeof body.note === "string" && looksSecret(body.note)) || (typeof body.about === "string" && looksSecret(body.about))) return { ok: false, code: "MEMORY_SECRET_REFUSED", reason: "That looks like a key, a password or a recovery phrase; Ryntra never keeps one." };
  await changeMemory(store, owner, nowMs, (current) => {
    let next: MemoryRecord = current;
    if (body.about !== undefined) {
      const about = body.about === null ? null : cleanText(body.about, MEMORY_ABOUT_MAX_CHARS);
      next = { ...next, about: about && about.length > 0 ? about : null };
    }
    if (body.noticing !== undefined) next = { ...next, noticing: body.noticing };
    if (body.note !== undefined) next = withNote(next, body.note, "typed", nowMs) ?? next;
    return next === current ? null : next;
  });
  return { ok: true };
}

export async function forgetNote(store: GuardStore, owner: string, noteId: string, nowMs: number): Promise<boolean> {
  let found = false;
  await changeMemory(store, owner, nowMs, (current) => {
    const notes = current.notes.filter((note) => note.id !== noteId);
    found = notes.length !== current.notes.length;
    return found ? { ...current, notes } : null;
  });
  return found;
}

/** «Забути все»: the record is gone — «Про мене» and every note; «Знайомство» stays, it has its own «Змінити». */
export async function forgetEverything(store: GuardStore, owner: string): Promise<void> {
  await deleteMemoryRecord(store, owner);
}

/**
 * After a person's message: what of it to keep. «Запам'ятай…» is kept always; a sentence about oneself only while
 * noticing is on. Returns the notes written now, for the turn to say «Запам'ятала» under the message.
 */
export async function rememberFromMessage(store: GuardStore, owner: string, text: string, nowMs: number): Promise<readonly MemoryNote[]> {
  const noticed: readonly Noticed[] = noticeInMessage(text);
  if (noticed.length === 0) return [];
  const before = await readMemoryRecord(store, owner);
  const keep = noticed.filter((item) => item.source === "asked" || (before?.noticing ?? true));
  if (keep.length === 0) return [];
  const written = await changeMemory(store, owner, nowMs, (current) => {
    let next: MemoryRecord | null = null;
    for (const item of keep) next = withNote(next ?? current, item.text, item.source, nowMs) ?? next;
    return next;
  });
  const known = new Set((before?.notes ?? []).map((note) => note.id));
  return written.notes.filter((note) => !known.has(note.id));
}

/** The reader as the model reads it: «Про мене» and the latest notes, cut to a small budget — words only. */
export const READER_MEMORY_MAX_CHARS = 1_200;

export type ReaderMemory = Readonly<{ about: string | null; notes: readonly string[] }>;

export function readerMemory(record: MemoryRecord | null): ReaderMemory | null {
  if (record === null || (record.about === null && record.notes.length === 0)) return null;
  const notes: string[] = [];
  let used = record.about?.length ?? 0;
  for (const note of [...record.notes].reverse()) {
    if (used + note.text.length > READER_MEMORY_MAX_CHARS) break;
    notes.push(note.text);
    used += note.text.length;
  }
  return { about: record.about, notes: notes.reverse() };
}
