/**
 * A payout list checked before anything is signed: who each line pays, how much in the coin's smallest units, and what
 * stands in the way. Pure: what the person's own record knows (contacts from earlier payouts) and which recipients have
 * a private balance are handed in — the screen reads them; nothing here asks the network.
 *
 * What a line can say:
 * - stops the payout until mended or removed: no such person (`who`), a broken address (`address`), no amount or one
 *   finer than the coin has (`amount`), a coin the private balance does not pay in (`coin`), the person's own wallet
 *   (`self`), too little for a link or an open payment to land (`small`);
 * - asks to look again, pays as it is: the same recipient twice (`duplicate`);
 * - only says: an address never paid before, once the person has paid anyone (`new`); no private balance — the
 *   payment goes by a link or in the open (`noPrivate`).
 */

import { LINK_MIN_LAMPORTS } from '../network.ts';
import { PAY_COINS, type PayCoin, type PayRow } from './list.ts';

export type Issue = 'who' | 'address' | 'amount' | 'coin' | 'self' | 'small' | 'duplicate' | 'new' | 'noPrivate';

const STOPS: ReadonlySet<Issue> = new Set(['who', 'address', 'amount', 'coin', 'self', 'small']);
const ASKS: ReadonlySet<Issue> = new Set(['duplicate']);

export type Weight = 'stop' | 'ask' | 'note';

export function weightOf(issue: Issue): Weight {
  return STOPS.has(issue) ? 'stop' : ASKS.has(issue) ? 'ask' : 'note';
}

/** How a payment reaches its person: privately; a link they open; or to their wallet in the open, amount seen. */
export type Route = 'private' | 'link' | 'open';

/** For people without a private balance, the person chooses once for all of them. */
export type NoPrivateWay = 'link' | 'open';

export type CheckedRow = PayRow &
  Readonly<{
    /** Stable while the list stands: the line and what it says. */
    id: string;
    /** The address the payment goes to — written, or found by name in the person's own record. */
    address: string | null;
    /** The amount in the coin's smallest units. */
    units: bigint | null;
    issues: readonly Issue[];
    /** Null until it is known whether the recipient has a private balance. */
    route: Route | null;
  }>;

/* ---------------- addresses ---------------- */

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** Base58 to bytes; null when a character is not base58. */
function fromBase58(text: string): Uint8Array | null {
  let value = 0n;
  for (const c of text) {
    const digit = B58.indexOf(c);
    if (digit < 0) return null;
    value = value * 58n + BigInt(digit);
  }
  const bytes: number[] = [];
  while (value > 0n) {
    bytes.unshift(Number(value & 0xffn));
    value >>= 8n;
  }
  for (const c of text) {
    if (c !== '1') break;
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}

/** A Solana address: base58 of exactly 32 bytes. */
export function isAddress(text: string | null | undefined): text is string {
  if (!text || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(text)) return false;
  return fromBase58(text)?.length === 32;
}

/* ---------------- amounts ---------------- */

export function coinOf(symbol: string): PayCoin | null {
  return PAY_COINS.find((c) => c.symbol === symbol.toUpperCase()) ?? null;
}

/** «1200.5» in a coin of `decimals` places as its smallest units; null when it is not a positive amount the coin can hold. */
export function unitsOf(text: string | null, decimals: number): bigint | null {
  if (!text) return null;
  const plain = text.trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(plain)) return null;
  const [whole, frac = ''] = plain.split('.');
  if (frac.replace(/0+$/, '').length > decimals) return null;
  const units = BigInt(whole) * 10n ** BigInt(decimals) + BigInt((frac.slice(0, decimals) || '0').padEnd(decimals, '0'));
  return units > 0n ? units : null;
}

/** Smallest units as the coin's text, nothing rounded away: 0.05, 1200.5. */
export function unitsText(units: bigint, decimals: number): string {
  const sign = units < 0n ? '-' : '';
  const abs = units < 0n ? -units : units;
  const base = 10n ** BigInt(decimals);
  const frac = (abs % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${sign}${abs / base}${frac ? `.${frac}` : ''}`;
}

/* ---------------- the check ---------------- */

/** Names and addresses the person paid before, from their own record: «Oleh» → the address Oleh was paid at last. */
export type Contacts = ReadonlyMap<string, string>;

export const nameKey = (name: string) => name.trim().toLowerCase().replace(/^@/, '');

export type CheckInput = Readonly<{
  rows: readonly PayRow[];
  /** The paying wallet: a line paying it is refused. */
  owner: string | null;
  contacts: Contacts;
  /** Addresses the person paid before (a contact's address, or any earlier payout's). */
  paid: ReadonlySet<string>;
  /** Has the address a private balance? Missing — not read yet. */
  registered: ReadonlyMap<string, boolean>;
  /** How people without a private balance are paid. */
  way: NoPrivateWay;
}>;

export function checkList(input: CheckInput): CheckedRow[] {
  const read = input.rows.map((row) => {
    const named = row.name ? input.contacts.get(nameKey(row.name)) ?? null : null;
    const address = row.to ?? named;
    const coin = coinOf(row.coin);
    const units = coin ? unitsOf(row.amount, coin.decimals) : null;
    return { row, address, coin, units, valid: address !== null && isAddress(address) };
  });
  // Only lines that would pay count as the same recipient twice.
  const counted = new Map<string, number>();
  for (const r of read) if (r.valid && r.units !== null) counted.set(r.address as string, (counted.get(r.address as string) ?? 0) + 1);
  return read.map(({ row, address, coin, units, valid }, i) => {
    const issues: Issue[] = [];
    if (!row.to && !address) issues.push('who');
    else if (row.to && !isAddress(row.to)) issues.push('address');
    if (!coin) issues.push('coin');
    if (units === null) issues.push('amount');
    if (valid && input.owner && address === input.owner) issues.push('self');
    if (valid && units !== null && (counted.get(address as string) ?? 0) > 1) issues.push('duplicate');
    // «New» means something only once the person has paid anyone: on a first payout every address is new.
    if (valid && input.paid.size > 0 && !input.paid.has(address as string)) issues.push('new');
    const has = valid ? input.registered.get(address as string) : undefined;
    let route: Route | null = null;
    if (has === true) route = 'private';
    if (has === false) {
      route = input.way;
      issues.push('noPrivate');
      // A link or an open payment lands in a wallet of its own: it must at least cover that wallet's rent.
      if (units !== null && units < LINK_MIN_LAMPORTS) issues.push('small');
    }
    return { ...row, id: `${i}:${row.line}:${address ?? row.name ?? ''}:${row.amount ?? ''}`, address: valid ? address : null, units, issues, route };
  });
}

/** Lines that stop the payout. */
export function stopping(rows: readonly CheckedRow[]): CheckedRow[] {
  return rows.filter((row) => row.issues.some((issue) => weightOf(issue) === 'stop'));
}

/** Addresses the list pays whose private balance is not known yet — the screen reads these. */
export function toRead(rows: readonly CheckedRow[], registered: ReadonlyMap<string, boolean>): string[] {
  return [...new Set(rows.flatMap((row) => (row.address && !registered.has(row.address) ? [row.address] : [])))];
}

/** The total of the list, per coin, of the lines that pay. */
export function totals(rows: readonly CheckedRow[]): ReadonlyMap<string, bigint> {
  const out = new Map<string, bigint>();
  for (const row of rows) if (row.units !== null && !row.issues.some((i) => weightOf(i) === 'stop')) out.set(row.coin, (out.get(row.coin) ?? 0n) + row.units);
  return out;
}
