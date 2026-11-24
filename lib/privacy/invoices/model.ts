/**
 * Ryntra Private — an invoice paid into the private balance.
 *
 * A private invoice asks for an exact sum of one coin, paid into the recipient's private balance on Helius Privacy
 * Rings: the payer pays from their own private balance (a private transfer — only the payer is seen) or, without one,
 * straight from their wallet into the recipient's private balance in one approval (the payer and the sum are seen).
 *
 * «What it is for» never goes on chain: a deposit's memo lies there in plain text, and a note with a memo cannot be
 * spent by the SDK's high level (`docs/research/ryntra-private-2026-11-18/PROBE.md`, point 4). The invoice — sum, coin,
 * what for, until when, to whom — rides whole in the link's `#fragment` (`code.ts`), which the browser never sends to a
 * server, and lives sealed in the recipient's own browser (`store.client.ts`). Ryntra's server never holds it.
 *
 * Pure: no clock, no random source and no network it is not handed; the tests read it as it is.
 */

import { RING_SOL } from '../network.ts';

/** A coin a private invoice asks for: its symbol, the ring's name for it (`RING_SOL` for SOL) and its decimals. */
export type PrivateCoin = Readonly<{ symbol: string; mint: string; decimals: number }>;

/**
 * The coins a private invoice asks for on the test network. SOL alone today: the private balance's own steps move SOL
 * (`flows.ts`), and the ring holds no devnet USDC of ours yet (the first step). A coin joins this list once
 * the private balance can hold and send it.
 */
export const PRIVATE_INVOICE_COINS: readonly PrivateCoin[] = Object.freeze([Object.freeze({ symbol: 'SOL', mint: RING_SOL, decimals: 9 })]);

export function coinOf(mint: string): PrivateCoin | null {
  return PRIVATE_INVOICE_COINS.find((coin) => coin.mint === mint) ?? null;
}

/** How long an invoice is valid — the open links' own presets (`terminal/money/money-view.ts`), 7 days unless picked. */
export const EXPIRIES = ['1h', '24h', '7d', '30d'] as const;
export type Expiry = (typeof EXPIRIES)[number];
export const DEFAULT_EXPIRY: Expiry = '7d';
const HOUR = 3_600_000;
export const EXPIRY_MS: Readonly<Record<Expiry, number>> = Object.freeze({ '1h': HOUR, '24h': 24 * HOUR, '7d': 7 * 24 * HOUR, '30d': 30 * 24 * HOUR });
/** The longest an invoice may live, read back from a link: the longest preset and a day of slack for clocks. */
export const LONGEST_MS = EXPIRY_MS['30d'] + 24 * HOUR;

/** The bound on «what it is for» — the open links' own (120 characters). */
export const FOR_WHAT_MAX = 120;

/** The largest amount the ring takes: an unsigned 64-bit number of the coin's smallest units. */
export const MAX_UNITS = 0xffff_ffff_ffff_ffffn;

export type PrivateInvoice = Readonly<{
  /** 16 hex characters: 8 random bytes, made in the recipient's browser. */
  id: string;
  /** The recipient's wallet address: the payment lands in its private balance. */
  to: string;
  /** The coin, by the ring's name for it. */
  mint: string;
  /** The exact sum asked, in the coin's smallest units. */
  amount: bigint;
  /** What it is for — seen by whoever holds the link: the payer and the recipient. */
  forWhat: string | null;
  /** When it was made and until when it is paid, in milliseconds. */
  createdAt: number;
  expiresAt: number;
}>;

export const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export const INVOICE_ID = /^[0-9a-f]{16}$/;

/**
 * The amount a person typed as the coin's smallest units, or null while it is not one: a positive decimal with no more
 * places than the coin has — more is refused, never rounded. Accepts a comma for the point («0,5»).
 */
export function amountUnits(typed: string, decimals: number): bigint | null {
  const plain = typed.trim().replace(',', '.');
  if (!/^\d*\.?\d*$/.test(plain) || plain === '' || plain === '.') return null;
  const [whole = '', part = ''] = plain.split('.');
  if (part.length > decimals) return null;
  const units = BigInt(whole || '0') * 10n ** BigInt(decimals) + BigInt(part.padEnd(decimals, '0') || '0');
  return units > 0n && units <= MAX_UNITS ? units : null;
}

/** Smallest units as the coin's text, without rounding away what is there: 0.05, 1.234567891. */
export function unitsText(units: bigint, decimals: number): string {
  const sign = units < 0n ? '-' : '';
  const abs = units < 0n ? -units : units;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = decimals > 0 ? (abs % base).toString().padStart(decimals, '0').replace(/0+$/, '') : '';
  return `${sign}${whole}${frac ? `.${frac}` : ''}`;
}

/**
 * «What it is for» as the invoice keeps it: no control characters, spaces folded, trimmed, at most `FOR_WHAT_MAX`
 * characters (whole code points); null when nothing is left.
 */
export function cleanForWhat(text: string | null | undefined): string | null {
  if (typeof text !== 'string') return null;
  const folded = text.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g, ' ').replace(/\s+/g, ' ').trim();
  const cut = [...folded].slice(0, FOR_WHAT_MAX).join('').trim();
  return cut === '' ? null : cut;
}

/** 8 random bytes as the invoice's id. */
export function invoiceId(bytes: Uint8Array): string {
  if (bytes.length !== 8) throw new Error('invoice id: 8 bytes');
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export type NewInvoice = Readonly<{ to: string; mint: string; typed: string; forWhat: string; expiry: Expiry }>;

/** A new invoice from the form, or null when the form does not hold one. `now` and `random` are the caller's. */
export function makeInvoice(input: NewInvoice, now: number, random: Uint8Array): PrivateInvoice | null {
  const coin = coinOf(input.mint);
  if (!coin || !ADDRESS.test(input.to) || !EXPIRIES.includes(input.expiry)) return null;
  const amount = amountUnits(input.typed, coin.decimals);
  if (amount === null) return null;
  return Object.freeze({
    id: invoiceId(random),
    to: input.to,
    mint: coin.mint,
    amount,
    forWhat: cleanForWhat(input.forWhat),
    createdAt: now,
    expiresAt: now + EXPIRY_MS[input.expiry],
  });
}

export function isExpired(invoice: Pick<PrivateInvoice, 'expiresAt'>, now: number): boolean {
  return now >= invoice.expiresAt;
}

/** What is left of an invoice's time, in the largest whole unit: «5 days», «3 h», «12 min»; null once it is over. */
export type Left = Readonly<{ unit: 'days' | 'hours' | 'minutes'; count: number }>;

export function timeLeft(invoice: Pick<PrivateInvoice, 'expiresAt'>, now: number): Left | null {
  const ms = invoice.expiresAt - now;
  if (ms <= 0) return null;
  if (ms >= 24 * HOUR) return { unit: 'days', count: Math.floor(ms / (24 * HOUR)) };
  if (ms >= HOUR) return { unit: 'hours', count: Math.floor(ms / HOUR) };
  return { unit: 'minutes', count: Math.max(1, Math.floor(ms / 60_000)) };
}

/** A wallet address as people read it at a glance: the first four and the last four. */
export function shortAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 4)}…${address.slice(-4)}` : address;
}
