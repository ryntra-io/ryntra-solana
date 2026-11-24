/**
 * The record's own copy — a file the person saves, so their payouts, invoices and access journal outlive a cleared
 * browser.
 *
 * Why a file of its own: the record is sealed in the browser under a key the browser keeps to itself, and the key copy
 * carries it only when this browser holds the private balance's viewing key (`../ledger/store.client.ts`). With keys
 * that come from the wallet it holds none, so the key copy says «no record» and clearing the site's data would lose it.
 * This file is that record as plain text: names, addresses and amounts are readable in it — the screen says so — and it
 * is kept like any document. It holds no key of any kind.
 *
 * It is bound to one wallet on one network: a copy opens only where it was made for. Pure.
 */

import { ADDRESS, INVOICE_ID } from '../invoices/model.ts';
import { isRecord, LEDGER_KEEP, newestFirst, type PayoutRecord } from '../ledger/ledger.ts';
import { isGrant, type Grant } from './access.ts';

export const BACKUP_KIND = 'ryntra-private-record';

/** A kept private invoice as plain JSON: every big number as decimal text. */
export type InvoiceJson = Readonly<{
  invoice: Readonly<{ id: string; to: string; mint: string; amount: string; forWhat: string | null; createdAt: number; expiresAt: number }>;
  sinceSlot: string;
  fragment: string;
  paid: Readonly<{ signature: string; slot: string; key: string }> | null;
}>;

export type Backup = Readonly<{
  kind: typeof BACKUP_KIND;
  v: 1;
  network: string;
  owner: string;
  at: number;
  payouts: readonly PayoutRecord[];
  invoices: readonly InvoiceJson[];
  access: readonly Grant[];
}>;

const DIGITS = /^\d+$/;

export function isInvoiceJson(value: unknown): value is InvoiceJson {
  const v = value as InvoiceJson | null;
  const i = v?.invoice;
  return (
    !!v &&
    !!i &&
    typeof i.id === 'string' &&
    INVOICE_ID.test(i.id) &&
    typeof i.to === 'string' &&
    ADDRESS.test(i.to) &&
    typeof i.mint === 'string' &&
    typeof i.amount === 'string' &&
    DIGITS.test(i.amount) &&
    (i.forWhat === null || typeof i.forWhat === 'string') &&
    Number.isSafeInteger(i.createdAt) &&
    Number.isSafeInteger(i.expiresAt) &&
    typeof v.sinceSlot === 'string' &&
    DIGITS.test(v.sinceSlot) &&
    typeof v.fragment === 'string' &&
    (v.paid === null || (!!v.paid && typeof v.paid.signature === 'string' && typeof v.paid.slot === 'string' && DIGITS.test(v.paid.slot) && typeof v.paid.key === 'string'))
  );
}

/** The copy's text: one JSON document, readable by eye. Null when there is nothing to keep. */
export function encodeBackup(input: Readonly<{ network: string; owner: string; at: number; payouts: readonly PayoutRecord[]; invoices: readonly InvoiceJson[]; access: readonly Grant[] }>): string | null {
  if (!input.payouts.length && !input.invoices.length && !input.access.length) return null;
  const backup: Backup = {
    kind: BACKUP_KIND,
    v: 1,
    network: input.network,
    owner: input.owner,
    at: input.at,
    payouts: newestFirst(input.payouts).slice(0, LEDGER_KEEP),
    invoices: [...input.invoices],
    access: [...input.access],
  };
  return `${JSON.stringify(backup, null, 1)}\n`;
}

export type Restored = Readonly<{ payouts: PayoutRecord[]; invoices: InvoiceJson[]; access: Grant[] }>;

/**
 * What a copy carries for this wallet on this network; null when the text is not such a copy, or it was made for
 * another wallet or network. Only entries this code wrote come back; anything else in it is left out.
 */
export function decodeBackup(text: string, network: string, owner: string): Restored | null {
  let parsed: Partial<Backup> | null;
  try {
    parsed = JSON.parse(text.replace(/^﻿/, '')) as Partial<Backup> | null;
  } catch {
    return null;
  }
  if (!parsed || parsed.kind !== BACKUP_KIND || parsed.v !== 1 || parsed.network !== network || parsed.owner !== owner) return null;
  const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
  return {
    payouts: list(parsed.payouts).filter(isRecord).filter((r) => r.network === network),
    invoices: list(parsed.invoices).filter(isInvoiceJson).filter((i) => i.invoice.to === owner),
    access: list(parsed.access).filter(isGrant),
  };
}

/** The copy's file name: the wallet's first characters and the day. */
export function backupFileName(owner: string, day: string): string {
  return `ryntra-record-${owner.slice(0, 6)}-${day}.json`;
}
