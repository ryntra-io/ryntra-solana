/**
 * The person's report of private payments: what they paid out and what came in by their
 * private invoices — to whom, how much, in what, what for, when, and the transaction — for a period they pick, as a
 * figure on screen and a file a spreadsheet opens.
 *
 * Everything comes from the person's own record in their browser (`../ledger/**`, `../invoices/store.client.ts`): a
 * private transfer hides its amount on chain, so the chain cannot give these rows. Nothing here goes to a server.
 *
 * Pure: no clock it is not given, no storage, no network. Amounts stay decimal text and are added exactly.
 */

import type { LineState, PayoutRecord } from '../ledger/ledger.ts';
import { coinOf, unitsText } from '../invoices/model.ts';
import type { Route } from '../payouts/check.ts';

/** A payment out (a payout line), Ryntra's fee on a payout, or a payment in (a private invoice paid). */
export type Kind = 'payout' | 'fee' | 'invoice';

export type ReportRow = Readonly<{
  /** When: the payout's time, or the invoice's day it was made (the record keeps no clock time of the payment). */
  at: number;
  kind: Kind;
  name: string | null;
  /** Who received it: the recipient's address; for an invoice, the person's own. Empty for the fee. */
  to: string;
  /** Exact decimal text in the coin. */
  amount: string;
  coin: string;
  note: string | null;
  /** How a payout line went; null for an invoice (the payer chose) and the fee. */
  how: Route | null;
  state: LineState;
  signature: string | null;
  /** The row's own key: the payout's id and line, or the invoice's id. */
  ref: string;
}>;

/** A private invoice as the report reads it — the recipient's kept invoice, amounts in the coin's smallest units. */
export type InvoiceSource = Readonly<{
  invoice: Readonly<{ id: string; to: string; mint: string; amount: bigint; forWhat: string | null; createdAt: number }>;
  paid: Readonly<{ signature: string }> | null;
}>;

/** Every line of every payout, and the fee where there was one, oldest first. */
export function rowsOfPayouts(records: readonly PayoutRecord[]): ReportRow[] {
  const out: ReportRow[] = [];
  for (const record of [...records].sort((a, b) => a.at - b.at)) {
    record.lines.forEach((line, i) => {
      out.push({
        at: record.at,
        kind: 'payout',
        name: line.name,
        to: line.to,
        amount: line.amount,
        coin: line.coin,
        note: line.note,
        how: line.how,
        state: line.state,
        signature: line.signature,
        ref: `${record.id}:${i}`,
      });
    });
    if (isPositive(record.fee) && record.lines.some((l) => l.state === 'paid')) {
      out.push({ at: record.at, kind: 'fee', name: null, to: '', amount: record.fee, coin: record.coin, note: null, how: null, state: 'paid', signature: null, ref: `${record.id}:fee` });
    }
  }
  return out;
}

/** The private invoices that were paid — the ones money came in by; waiting and expired ones moved nothing. */
export function rowsOfInvoices(kept: readonly InvoiceSource[]): ReportRow[] {
  const out: ReportRow[] = [];
  for (const { invoice, paid } of kept) {
    const coin = coinOf(invoice.mint);
    if (!paid || !coin) continue;
    out.push({
      at: invoice.createdAt,
      kind: 'invoice',
      name: null,
      to: invoice.to,
      amount: unitsText(invoice.amount, coin.decimals),
      coin: coin.symbol,
      note: invoice.forWhat,
      how: null,
      state: 'paid',
      signature: paid.signature,
      ref: invoice.id,
    });
  }
  return out;
}

/** Both, oldest first. */
export function reportRows(records: readonly PayoutRecord[], kept: readonly InvoiceSource[]): ReportRow[] {
  return [...rowsOfPayouts(records), ...rowsOfInvoices(kept)].sort((a, b) => a.at - b.at || (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0));
}

/* ---------------- periods ---------------- */

/** How long a period is; «all» is everything the record holds. */
export const UNITS = ['month', 'quarter', 'year', 'all'] as const;
export type Unit = (typeof UNITS)[number];

/** From (inclusive) to (exclusive), ms. */
export type Period = Readonly<{ from: number; to: number }>;

export const ALL_TIME: Period = Object.freeze({ from: 0, to: Number.MAX_SAFE_INTEGER });

/**
 * The period of a unit around `now`, `shift` periods back (0 — this one, -1 — the one before), in the person's own
 * calendar (the browser's local time). A shift forward is never past this period.
 */
export function periodOf(unit: Unit, now: number, shift = 0): Period {
  if (unit === 'all') return ALL_TIME;
  const d = new Date(now);
  const y = d.getFullYear();
  const back = Math.min(0, Math.trunc(shift));
  if (unit === 'year') return { from: new Date(y + back, 0, 1).getTime(), to: new Date(y + back + 1, 0, 1).getTime() };
  const size = unit === 'quarter' ? 3 : 1;
  const first = d.getMonth() - (d.getMonth() % size) + back * size;
  return { from: new Date(y, first, 1).getTime(), to: new Date(y, first + size, 1).getTime() };
}

export function isPeriod(value: unknown): value is Period {
  const p = value as Period | null;
  return !!p && Number.isSafeInteger(p.from) && Number.isSafeInteger(p.to) && p.from >= 0 && p.to > p.from;
}

export function inPeriod(rows: readonly ReportRow[], period: Period): ReportRow[] {
  return rows.filter((row) => row.at >= period.from && row.at < period.to);
}

/* ---------------- exact sums ---------------- */

const DECIMAL = /^\d+(\.\d+)?$/;

function isPositive(text: string): boolean {
  return DECIMAL.test(text) && /[1-9]/.test(text);
}

/** Two non-negative decimals added without rounding: «0.1» + «0.2» = «0.3». Text that is not a decimal adds nothing. */
export function addDecimal(a: string, b: string): string {
  const [x, y] = [DECIMAL.test(a) ? a : '0', DECIMAL.test(b) ? b : '0'];
  const [xw, xf = ''] = x.split('.');
  const [yw, yf = ''] = y.split('.');
  const places = Math.max(xf.length, yf.length);
  const sum = BigInt(xw + xf.padEnd(places, '0')) + BigInt(yw + yf.padEnd(places, '0'));
  if (!places) return sum.toString();
  const text = sum.toString().padStart(places + 1, '0');
  const frac = text.slice(-places).replace(/0+$/, '');
  return `${text.slice(0, -places)}${frac ? `.${frac}` : ''}`;
}

/** One side of the period: how much went, by coin, and in how many payments. Only what surely went is counted. */
export type Side = Readonly<{ count: number; byCoin: ReadonlyMap<string, string> }>;
export type Totals = Readonly<{ out: Side; in: Side; fee: ReadonlyMap<string, string> }>;

export function totalsOf(rows: readonly ReportRow[]): Totals {
  const out = new Map<string, string>();
  const inn = new Map<string, string>();
  const fee = new Map<string, string>();
  let outCount = 0;
  let inCount = 0;
  for (const row of rows) {
    if (row.state !== 'paid') continue;
    if (row.kind === 'payout') {
      out.set(row.coin, addDecimal(out.get(row.coin) ?? '0', row.amount));
      outCount += 1;
    } else if (row.kind === 'invoice') {
      inn.set(row.coin, addDecimal(inn.get(row.coin) ?? '0', row.amount));
      inCount += 1;
    } else fee.set(row.coin, addDecimal(fee.get(row.coin) ?? '0', row.amount));
  }
  return { out: { count: outCount, byCoin: out }, in: { count: inCount, byCoin: inn }, fee };
}

/* ---------------- the file ---------------- */

/**
 * How the file is written for the sheet that opens it. A spreadsheet in English reads «,» between cells and «.» in a
 * number; one in Ukrainian (and most of Europe) reads «;» between cells and «,» in a number — a file written the other
 * way opens as one column, or with «1.5» turned into a date. The file is UTF-8 with its byte-order mark, so a sheet
 * reads Cyrillic names as they are.
 */
export type CsvStyle = Readonly<{ sep: ',' | ';'; point: '.' | ',' }>;
export const CSV_STYLE: Readonly<Record<'en' | 'uk', CsvStyle>> = Object.freeze({ en: { sep: ',', point: '.' }, uk: { sep: ';', point: ',' } });

export type CsvWords = Readonly<{
  head: readonly [date: string, kind: string, name: string, address: string, amount: string, coin: string, note: string, how: string, state: string, tx: string];
  kind: Readonly<Record<Kind, string>>;
  how: Readonly<Record<Route, string>>;
  state: Readonly<Record<LineState, string>>;
}>;

/** A cell as a sheet reads it: quoted when it must be, and never a formula («=…», «+…», «-…», «@…» start as text). */
export function csvCell(value: string | null, sep: string): string {
  let text = value ?? '';
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return text.includes(sep) || /["\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const two = (n: number) => String(n).padStart(2, '0');

/** «2026-11-20 14:05» at an offset from UTC in minutes — the form every spreadsheet reads as a date and time. */
export function stamp(at: number, offsetMinutes: number): string {
  const d = new Date(at + offsetMinutes * 60_000);
  return `${d.getUTCFullYear()}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())} ${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`;
}

/** The browser's own offset at a moment — what `reportCsv` takes to write local times. */
export const localOffset = (at: number): number => -new Date(at).getTimezoneOffset();

/**
 * The rows as a CSV file: one line per payment, oldest first; the amount exactly as recorded, with the sheet's own
 * decimal point; the transaction's signature whole. Starts with the byte-order mark and ends each line with CRLF.
 */
export function reportCsv(rows: readonly ReportRow[], words: CsvWords, style: CsvStyle, offsetOf: (at: number) => number = () => 0): string {
  const line = (cells: readonly (string | null)[]) => cells.map((c) => csvCell(c, style.sep)).join(style.sep);
  const out = [line(words.head)];
  for (const row of rows) {
    out.push(
      line([
        stamp(row.at, offsetOf(row.at)),
        words.kind[row.kind],
        row.name,
        row.to,
        style.point === ',' ? row.amount.replace('.', ',') : row.amount,
        row.coin,
        row.note,
        row.how ? words.how[row.how] : null,
        words.state[row.state],
        row.signature,
      ]),
    );
  }
  return `﻿${out.join('\r\n')}\r\n`;
}

/** The file's name: the period's first and last day, or the day it was made for «all». */
export function reportFileName(period: Period, now: number, offsetOf: (at: number) => number = () => 0): string {
  const day = (at: number) => stamp(at, offsetOf(at)).slice(0, 10);
  if (period.to === ALL_TIME.to) return `ryntra-report-${day(now)}.csv`;
  return `ryntra-report-${day(period.from)}_${day(period.to - 1)}.csv`;
}
