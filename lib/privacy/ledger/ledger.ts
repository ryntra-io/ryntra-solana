/**
 * The person's own record of private payouts: who was paid, how much, in what, what for, how it went and in which
 * transaction. It lives only in their browser, sealed like the private balance's keys (`store.client.ts`), and in their
 * key copy (`copy.ts`) — never on a server and never on chain: a memo on chain lies there in plain text,
 * and a private transfer shows no amount, so this record is the only place the amounts are written down.
 *
 * Pure: plain JSON in and out (amounts as decimal text), no clock it is not given.
 */

import { lineOf } from '../payouts/list.ts';
import type { Route } from '../payouts/check.ts';

export type LineState = 'paid' | 'failed' | 'waiting';

export type LedgerLine = Readonly<{
  name: string | null;
  to: string;
  /** Decimal text in the coin, as paid. */
  amount: string;
  coin: string;
  /** What it was for — the person's own words. */
  note: string | null;
  how: Route;
  state: LineState;
  /** The transaction it went in; null until it lands. */
  signature: string | null;
  /** A link's own address (never its secret — that lives with the private balance's links). */
  link: string | null;
}>;

export type PayoutRecord = Readonly<{
  v: 1;
  id: string;
  /** When it was paid, ms. */
  at: number;
  network: string;
  coin: string;
  /** Ryntra's fee on the whole payout, decimal text. */
  fee: string;
  lines: readonly LedgerLine[];
}>;

/** How many payouts the record keeps; older ones leave the browser (the person's report files keep them). */
export const LEDGER_KEEP = 200;

/** An id that sorts by time and does not repeat within one browser. */
export function recordId(at: number, salt: number): string {
  return `${at.toString(36).padStart(9, '0')}-${(salt >>> 0).toString(36)}`;
}

/** Is this a record this code wrote? Anything else from storage or a copy is left out. */
export function isRecord(value: unknown): value is PayoutRecord {
  const r = value as PayoutRecord | null;
  return (
    !!r &&
    r.v === 1 &&
    typeof r.id === 'string' &&
    typeof r.at === 'number' &&
    typeof r.coin === 'string' &&
    Array.isArray(r.lines) &&
    r.lines.every((l) => l && typeof l.to === 'string' && typeof l.amount === 'string' && ['paid', 'failed', 'waiting'].includes(l.state))
  );
}

/** Newest first. */
export function newestFirst(records: readonly PayoutRecord[]): PayoutRecord[] {
  return [...records].sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : -1));
}

/** One line's state after a step: the signature it landed in, or that it did not go. */
export function settle(record: PayoutRecord, ids: ReadonlySet<number>, state: LineState, signature: string | null, link: string | null = null): PayoutRecord {
  return { ...record, lines: record.lines.map((line, i) => (ids.has(i) ? { ...line, state, signature: signature ?? line.signature, link: link ?? line.link } : line)) };
}

export function paidCount(record: PayoutRecord): number {
  return record.lines.filter((l) => l.state === 'paid').length;
}

/** Names the person paid, each to the address they were paid at last. */
export function contactsOf(records: readonly PayoutRecord[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const record of newestFirst(records).reverse()) {
    for (const line of record.lines) if (line.name && line.state === 'paid') out.set(line.name.trim().toLowerCase().replace(/^@/, ''), line.to);
  }
  return out;
}

/** Every address the person has paid. */
export function paidTo(records: readonly PayoutRecord[]): Set<string> {
  return new Set(records.flatMap((r) => r.lines.filter((l) => l.state === 'paid').map((l) => l.to)));
}

/** «As last time»: the newest payout's list as text — names, addresses, amounts, coins and what for, ready to change. */
export function templateOf(records: readonly PayoutRecord[]): string | null {
  const last = newestFirst(records)[0];
  if (!last) return null;
  return last.lines.map((l) => lineOf({ name: l.name, to: l.to, amount: l.amount, coin: l.coin, note: l.note })).join('\n');
}

/** The lines of a payout that did not go, as text to pay again. */
export function unpaidOf(record: PayoutRecord): string {
  return record.lines
    .filter((l) => l.state !== 'paid')
    .map((l) => lineOf({ name: l.name, to: l.to, amount: l.amount, coin: l.coin, note: l.note }))
    .join('\n');
}

/* ---------------- the report ---------------- */

export type ReportWords = Readonly<{
  head: readonly [date: string, name: string, address: string, amount: string, coin: string, note: string, how: string, state: string, tx: string];
  how: Readonly<Record<Route, string>>;
  state: Readonly<Record<LineState, string>>;
}>;

/** A cell as a sheet reads it: quoted when it must be, and never a formula («=…», «+…», «-…», «@…» start as text). */
function cell(value: string | null): string {
  let text = value ?? '';
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** The payout as a CSV file for an accountant: one line per payment, the date in ISO form, the transaction's signature. */
export function reportCsv(records: readonly PayoutRecord[], words: ReportWords): string {
  const rows = [words.head.map(cell).join(',')];
  for (const record of newestFirst(records).reverse()) {
    const date = new Date(record.at).toISOString();
    for (const l of record.lines) {
      rows.push([date, l.name, l.to, l.amount, l.coin, l.note, words.how[l.how], words.state[l.state], l.signature].map(cell).join(','));
    }
  }
  return `${rows.join('\r\n')}\r\n`;
}
