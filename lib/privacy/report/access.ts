/**
 * «Access for an accountant» — what the protocol allows today, by probe 2:
 * - the wallet's viewing key opens the whole history, in and out, for ever, with no end date — never given;
 * - changing the viewing key cuts it off from new transactions only, and breaks what other wallets see — not done;
 * - scope and end date come only from a per-period bundle; a bundle of per-transaction keys needs the viewing key's
 *   bytes, which keys from the wallet do not give.
 *
 * So access is the period's report file, given to a named person, and a journal on the person's side of whom it was
 * given and when. «Take back» means no new files for that grant; a file already given stays with whoever has it — the
 * screen says so before the person agrees.
 *
 * Pure: the journal is plain JSON, the clock and ids are handed in.
 */

import { cleanForWhat } from '../invoices/model.ts';
import { isPeriod, type Period } from './report.ts';

export type Grant = Readonly<{
  v: 1;
  id: string;
  /** Whom it is for — the person's own words. */
  who: string;
  period: Period;
  /** When each file of this grant was given, ms, oldest first. */
  given: readonly number[];
  /** When it was taken back; null while it stands. */
  taken: number | null;
}>;

export const WHO_MAX = 60;
/** How many grants the journal keeps; the oldest taken-back ones leave first. */
export const JOURNAL_KEEP = 100;

/** «Whom» as the journal keeps it: no control characters, spaces folded, at most `WHO_MAX` characters; null when empty. */
export function cleanWho(text: string | null | undefined): string | null {
  const clean = cleanForWhat(text);
  const cut = clean === null ? '' : [...clean].slice(0, WHO_MAX).join('').trim();
  return cut === '' ? null : cut;
}

export function isGrant(value: unknown): value is Grant {
  const g = value as Grant | null;
  return (
    !!g &&
    g.v === 1 &&
    typeof g.id === 'string' &&
    typeof g.who === 'string' &&
    isPeriod(g.period) &&
    Array.isArray(g.given) &&
    g.given.length > 0 &&
    g.given.every((t) => Number.isSafeInteger(t)) &&
    (g.taken === null || Number.isSafeInteger(g.taken))
  );
}

/** Newest given first. */
export function journalOrder(list: readonly Grant[]): Grant[] {
  return [...list].sort((a, b) => (b.given[b.given.length - 1] ?? 0) - (a.given[a.given.length - 1] ?? 0) || (a.id < b.id ? 1 : -1));
}

function kept(list: Grant[]): Grant[] {
  if (list.length <= JOURNAL_KEEP) return list;
  const standing = list.filter((g) => g.taken === null);
  const taken = journalOrder(list.filter((g) => g.taken !== null)).slice(0, Math.max(0, JOURNAL_KEEP - standing.length));
  return journalOrder([...standing, ...taken]);
}

/** A new grant, its first file given at `at`; null when «whom» is empty or the period is not one. */
export function giveAccess(list: readonly Grant[], input: Readonly<{ id: string; who: string; period: Period; at: number }>): Grant[] | null {
  const who = cleanWho(input.who);
  if (!who || !isPeriod(input.period) || list.some((g) => g.id === input.id)) return null;
  return kept([{ v: 1, id: input.id, who, period: { from: input.period.from, to: input.period.to }, given: [input.at], taken: null }, ...list]);
}

/** One more file under a grant that stands; a grant taken back gives nothing more. */
export function giveAgain(list: readonly Grant[], id: string, at: number): Grant[] | null {
  const grant = list.find((g) => g.id === id);
  if (!grant || grant.taken !== null) return null;
  return list.map((g) => (g.id === id ? { ...g, given: [...g.given, at] } : g));
}

export function takeAccess(list: readonly Grant[], id: string, at: number): Grant[] {
  return list.map((g) => (g.id === id && g.taken === null ? { ...g, taken: at } : g));
}

/** Two journals as one — a restored copy and this browser's: by id, a grant taken back in either stays taken. */
export function mergeJournals(here: readonly Grant[], there: readonly Grant[]): Grant[] {
  const byId = new Map(here.map((g) => [g.id, g]));
  for (const g of there) {
    const mine = byId.get(g.id);
    if (!mine) byId.set(g.id, g);
    else {
      const given = [...new Set([...mine.given, ...g.given])].sort((a, b) => a - b);
      const taken = mine.taken ?? g.taken;
      byId.set(g.id, { ...mine, given, taken });
    }
  }
  return kept(journalOrder([...byId.values()]));
}

/** A grant's id: time-sorted and not repeated within one browser. */
export function grantId(at: number, salt: number): string {
  return `${at.toString(36).padStart(9, '0')}-${(salt >>> 0).toString(36)}`;
}
