/**
 * The payout record inside the key copy: one line `rpl1.<network>.<owner>.<sealed>` beside the keys in the file the
 * person saves, so a new browser opened with the copy gets its payouts back too.
 *
 * Sealed with AES-GCM under a key drawn (HKDF-SHA-256) from the private balance's viewing key — the same secret that
 * already shows this wallet's private amounts — so the file holds no name, address or amount in the clear, and nothing
 * new to keep: whoever can open the copy's keys can open its record, nobody else. The network and the wallet are bound
 * into the seal, so a record cannot be carried to another wallet's copy.
 *
 * Pure: Web Crypto only (browsers and Node alike).
 */

import { LEDGER_KEEP, isRecord, newestFirst, type PayoutRecord } from './ledger.ts';

const PREFIX = 'rpl1';

const text = (value: string) => new TextEncoder().encode(value);

function toB64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) return null;
  try {
    return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4)), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

async function sealKey(viewing: Uint8Array, network: string, owner: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new Uint8Array(viewing), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: text('ryntra/payout-ledger/v1'), info: text(`${network}.${owner}`) },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** The record as the copy's line; null when there is nothing to keep. */
export async function encodeLedgerCopy(records: readonly PayoutRecord[], network: string, owner: string, viewing: Uint8Array): Promise<string | null> {
  const kept = newestFirst(records).slice(0, LEDGER_KEEP);
  if (!kept.length) return null;
  const head = `${PREFIX}.${network}.${owner}`;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = text(JSON.stringify(kept));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: text(head) }, await sealKey(viewing, network, owner), plain));
  plain.fill(0);
  return `${head}.${toB64url(new Uint8Array([...iv, ...sealed]))}`;
}

/**
 * The records a copy carries for this wallet on this network; null when the text has no such line, or it was cut,
 * changed or sealed for other keys. Only records this code wrote come back.
 */
export async function decodeLedgerCopy(textIn: string, network: string, owner: string, viewing: Uint8Array): Promise<PayoutRecord[] | null> {
  const match = new RegExp(`${PREFIX}\\.([a-z]+)\\.([1-9A-HJ-NP-Za-km-z]{32,44})\\.([A-Za-z0-9_-]+)`).exec(textIn);
  if (!match || match[1] !== network || match[2] !== owner) return null;
  const bytes = fromB64url(match[3]);
  if (!bytes || bytes.length < 13) return null;
  try {
    const head = `${PREFIX}.${network}.${owner}`;
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12), additionalData: text(head) }, await sealKey(viewing, network, owner), bytes.slice(12));
    const parsed: unknown = JSON.parse(new TextDecoder().decode(plain));
    return Array.isArray(parsed) ? parsed.filter(isRecord) : null;
  } catch {
    return null;
  }
}
