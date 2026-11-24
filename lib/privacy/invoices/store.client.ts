/**
 * Where private invoices live: in the browser that made or paid them, sealed in the private balance's own vault
 * (`../vault.client.ts` — AES-GCM under a key the browser keeps to itself). Nothing here goes to a server.
 *
 * - The recipient keeps each invoice they made: the invoice itself with «what it is for», the slot it was made at (a
 *   payment before it pays nothing), its link, and — once their private history shows it — the payment that settled it.
 * - The payer keeps a mark of each invoice paid from this browser, so the page says «Paid» instead of asking again.
 *
 * Clearing the site's data clears them; the invoice itself still stands whole in the link the recipient sent.
 */

import { forget, ids, seal, unseal } from '../vault.client.ts';
import type { PrivateInvoice } from './model.ts';
import type { Kept, Paid } from './status.ts';
import { PRIVATE_NET } from '../network.ts';

const NETWORK = PRIVATE_NET;

const keptPrefix = (owner: string) => `invoice:${NETWORK}:${owner}:`;
const keptId = (owner: string, id: string) => `${keptPrefix(owner)}${id}`;
const paidHereId = (id: string) => `invoice-paid:${NETWORK}:${id}`;

type StoredInvoice = Readonly<{
  invoice: Readonly<{ id: string; to: string; mint: string; amount: string; forWhat: string | null; createdAt: number; expiresAt: number }>;
  sinceSlot: string;
  fragment: string;
  paid: Readonly<{ signature: string; slot: string; key: string }> | null;
}>;

/** A kept invoice and the part of its link after `#`. */
export type KeptInvoice = Kept & Readonly<{ fragment: string }>;

function fromStored(stored: StoredInvoice): KeptInvoice | null {
  try {
    const { invoice } = stored;
    return {
      invoice: Object.freeze({ ...invoice, amount: BigInt(invoice.amount) }),
      sinceSlot: BigInt(stored.sinceSlot),
      fragment: stored.fragment,
      paid: stored.paid ? { signature: stored.paid.signature, slot: BigInt(stored.paid.slot), key: stored.paid.key } : null,
    };
  } catch {
    return null;
  }
}

function toStored(kept: KeptInvoice): StoredInvoice {
  const { invoice } = kept;
  return {
    invoice: { id: invoice.id, to: invoice.to, mint: invoice.mint, amount: invoice.amount.toString(), forWhat: invoice.forWhat, createdAt: invoice.createdAt, expiresAt: invoice.expiresAt },
    sinceSlot: kept.sinceSlot.toString(),
    fragment: kept.fragment,
    paid: kept.paid ? { signature: kept.paid.signature, slot: kept.paid.slot.toString(), key: kept.paid.key } : null,
  };
}

/** Every invoice this wallet made in this browser. */
export async function keptInvoices(owner: string): Promise<readonly KeptInvoice[]> {
  const out: KeptInvoice[] = [];
  for (const id of await ids(keptPrefix(owner))) {
    const stored = await unseal<StoredInvoice>(id);
    const kept = stored ? fromStored(stored) : null;
    if (kept) out.push(kept);
  }
  return out;
}

export async function keepInvoice(owner: string, invoice: PrivateInvoice, sinceSlot: bigint, fragment: string): Promise<KeptInvoice> {
  const kept: KeptInvoice = { invoice, sinceSlot, fragment, paid: null };
  await seal(keptId(owner, invoice.id), toStored(kept));
  return kept;
}

/** Seals a payment found for an invoice; one already sealed is never replaced. */
export async function markPaid(owner: string, id: string, paid: Paid): Promise<void> {
  const stored = await unseal<StoredInvoice>(keptId(owner, id));
  const kept = stored ? fromStored(stored) : null;
  if (!kept || kept.paid) return;
  await seal(keptId(owner, id), toStored({ ...kept, paid }));
}

export async function forgetInvoice(owner: string, id: string): Promise<void> {
  await forget(keptId(owner, id));
}

export type PaidHere = Readonly<{ signature: string; payer: string; at: number }>;

/** The payer's mark: this browser paid this invoice, with this transaction. */
export async function rememberPayment(id: string, mark: PaidHere): Promise<void> {
  await seal(paidHereId(id), mark);
}

export async function paymentHere(id: string): Promise<PaidHere | null> {
  try {
    return await unseal<PaidHere>(paidHereId(id));
  } catch {
    return null;
  }
}
