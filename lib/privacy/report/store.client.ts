/**
 * The report's place in the browser: it reads the person's own record (payouts and kept private invoices), keeps the
 * access journal sealed beside them in the private balance's vault (`../vault.client.ts` — the same non-exportable key,
 * the same store), and writes and reads the record's own copy file (`backup.ts`). Nothing here goes to a server and
 * nothing here signs.
 */

import { readLedger, writePayout } from '../ledger/store.client.ts';
import type { PayoutRecord } from '../ledger/ledger.ts';
import { keepInvoice, keptInvoices, markPaid, type KeptInvoice } from '../invoices/store.client.ts';
import { seal, unseal } from '../vault.client.ts';
import { isGrant, mergeJournals, type Grant } from './access.ts';
import { decodeBackup, encodeBackup, type InvoiceJson } from './backup.ts';
import { PRIVATE_NET } from '../network.ts';

/** The network the private balance runs on: the report and its backup are named for it (`../network.ts`). */
export const REPORT_NETWORK = PRIVATE_NET;

const accessId = (owner: string) => `access:${REPORT_NETWORK}:${owner}`;

export type Sources = Readonly<{ payouts: readonly PayoutRecord[]; invoices: readonly KeptInvoice[] }>;

/** The person's record in this browser; what cannot be read is left empty, never guessed. */
export async function readSources(owner: string): Promise<Sources> {
  const [payouts, invoices] = await Promise.all([readLedger(REPORT_NETWORK, owner).catch(() => [] as PayoutRecord[]), keptInvoices(owner).catch(() => [] as readonly KeptInvoice[])]);
  return { payouts, invoices };
}

export async function readJournal(owner: string): Promise<Grant[]> {
  const stored = await unseal<unknown>(accessId(owner)).catch(() => null);
  return Array.isArray(stored) ? stored.filter(isGrant) : [];
}

export async function writeJournal(owner: string, list: readonly Grant[]): Promise<void> {
  await seal(accessId(owner), list);
}

function toJson(kept: KeptInvoice): InvoiceJson {
  const { invoice } = kept;
  return {
    invoice: { id: invoice.id, to: invoice.to, mint: invoice.mint, amount: invoice.amount.toString(), forWhat: invoice.forWhat, createdAt: invoice.createdAt, expiresAt: invoice.expiresAt },
    sinceSlot: kept.sinceSlot.toString(),
    fragment: kept.fragment,
    paid: kept.paid ? { signature: kept.paid.signature, slot: kept.paid.slot.toString(), key: kept.paid.key } : null,
  };
}

/** The record's copy file; null when there is nothing to keep. */
export async function backupText(owner: string, now: number): Promise<string | null> {
  const [sources, access] = await Promise.all([readSources(owner), readJournal(owner)]);
  return encodeBackup({ network: REPORT_NETWORK, owner, at: now, payouts: sources.payouts, invoices: sources.invoices.map(toJson), access });
}

/**
 * Puts back what a copy carries and this browser lacks; how many payouts and invoices came back, or null when the text
 * is no copy of this wallet. What this browser already has is never overwritten; the journals are joined.
 */
export async function restoreBackup(owner: string, text: string): Promise<number | null> {
  const restored = decodeBackup(text, REPORT_NETWORK, owner);
  if (!restored) return null;
  const have = await readSources(owner);
  const payoutIds = new Set(have.payouts.map((r) => r.id));
  const invoiceIds = new Set(have.invoices.map((k) => k.invoice.id));
  let added = 0;
  for (const record of restored.payouts) {
    if (payoutIds.has(record.id)) continue;
    await writePayout(REPORT_NETWORK, owner, record);
    added += 1;
  }
  for (const one of restored.invoices) {
    if (invoiceIds.has(one.invoice.id)) continue;
    const invoice = Object.freeze({ ...one.invoice, amount: BigInt(one.invoice.amount) });
    await keepInvoice(owner, invoice, BigInt(one.sinceSlot), one.fragment);
    if (one.paid) await markPaid(owner, invoice.id, { signature: one.paid.signature, slot: BigInt(one.paid.slot), key: one.paid.key });
    added += 1;
  }
  if (restored.access.length) await writeJournal(owner, mergeJournals(await readJournal(owner), restored.access));
  return added;
}
