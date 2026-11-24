/**
 * The private invoice as the part of its link after `#` — `/private/pay#i=<invoice+checksum>`.
 *
 * Browsers never send a fragment to a server, so the invoice — to whom, the coin, the exact sum, what it is for, until
 * when — reaches only whoever holds the link: the recipient who made it and the payer they gave it to. The payer's page
 * strips the fragment from its analytics before anything is sent (as the claim page does).
 *
 * A 4-byte SHA-256 checksum refuses a cut or changed link before anything is shown or signed. Base64url, no padding.
 * The link carries no secret: it holds nothing but the ask, and paying it still needs the payer's own wallet.
 * Pure: Web Crypto's `subtle.digest` only.
 */

import { ADDRESS, FOR_WHAT_MAX, INVOICE_ID, LONGEST_MS, MAX_UNITS, cleanForWhat, coinOf, type PrivateInvoice } from './model.ts';

const PREFIX = 'i=';
const VERSION = 1;

/** The payer's page. */
export const PAY_PATH = '/private/pay';

function toB64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4);
  try {
    return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

async function check4(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))).slice(0, 4);
}

/** The invoice on the wire: short keys, the sum as a decimal string of units, times in whole seconds. */
type Wire = { v: number; i: string; t: string; m: string; a: string; f?: string; c: number; e: number };

/** `i=<invoice+checksum>` — the part of the link after `#`. */
export async function encodeInvoice(invoice: PrivateInvoice): Promise<string> {
  const wire: Wire = {
    v: VERSION,
    i: invoice.id,
    t: invoice.to,
    m: invoice.mint,
    a: invoice.amount.toString(),
    ...(invoice.forWhat ? { f: invoice.forWhat } : {}),
    c: Math.floor(invoice.createdAt / 1000),
    e: Math.floor(invoice.expiresAt / 1000),
  };
  const body = new TextEncoder().encode(JSON.stringify(wire));
  return `${PREFIX}${toB64url(new Uint8Array([...body, ...(await check4(body))]))}`;
}

/**
 * The invoice from a link's hash (with or without `#`), or null when the link is cut, changed or asks for what no
 * invoice may: an unknown coin, a sum of nothing or past the ring's bound, a time back to front or longer than a month.
 */
export async function decodeInvoice(hash: string): Promise<PrivateInvoice | null> {
  const text = hash.replace(/^#/, '');
  if (!text.startsWith(PREFIX)) return null;
  const bytes = fromB64url(text.slice(PREFIX.length));
  if (!bytes || bytes.length < 5 || bytes.length > 2048) return null;
  const body = bytes.slice(0, -4);
  const sum = bytes.slice(-4);
  const want = await check4(body);
  if (!sum.every((byte, index) => byte === want[index])) return null;
  let wire: Partial<Wire>;
  try {
    wire = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)) as Partial<Wire>;
  } catch {
    return null;
  }
  if (!wire || typeof wire !== 'object' || wire.v !== VERSION) return null;
  const { i, t, m, a, f, c, e } = wire;
  if (typeof i !== 'string' || !INVOICE_ID.test(i)) return null;
  if (typeof t !== 'string' || !ADDRESS.test(t)) return null;
  if (typeof m !== 'string' || !coinOf(m)) return null;
  if (typeof a !== 'string' || !/^[1-9]\d{0,19}$/.test(a) || BigInt(a) > MAX_UNITS) return null;
  if (f !== undefined && (typeof f !== 'string' || cleanForWhat(f) !== f || [...f].length > FOR_WHAT_MAX)) return null;
  if (!Number.isSafeInteger(c) || !Number.isSafeInteger(e) || (c as number) <= 0 || (e as number) <= (c as number)) return null;
  const createdAt = (c as number) * 1000;
  const expiresAt = (e as number) * 1000;
  if (expiresAt - createdAt > LONGEST_MS) return null;
  return Object.freeze({ id: i, to: t, mint: m, amount: BigInt(a), forWhat: f ?? null, createdAt, expiresAt });
}

/** The link a recipient sends: the payer's page on this site, the invoice after `#`. */
export function payUrl(origin: string, fragment: string): string {
  return `${origin}${PAY_PATH}#${fragment}`;
}
