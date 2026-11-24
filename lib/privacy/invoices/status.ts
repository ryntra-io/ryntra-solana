/**
 * How the recipient learns an invoice is paid: by reading their own private balance, never the public chain. A private transfer shows only the payer on chain — not the recipient, not the sum — so nothing public
 * could say which invoice it paid. The recipient's own private history (the SDK's `getPrivateTransactions` after a
 * sync) lists every payment that came in, with its coin, its exact sum, its slot and its signature.
 *
 * An invoice is paid by the first incoming payment, after the invoice was made, of exactly its coin and exactly its sum
 * that no other invoice took; invoices are matched oldest first, and a payment pays one invoice only. Once matched, the
 * recipient's browser keeps the match (`store.client.ts`), so a later read never moves it.
 *
 * The edge it cannot see: the recipient's own «Hide» of exactly a waiting invoice's sum also comes in as a payment —
 * the private history does not say who deposited. «Paid» leads to the transaction, where the payer stands.
 *
 * Pure: the private history and the clock are handed in.
 */

import type { PrivateInvoice } from './model.ts';

/** One payment that came into the private balance, as the SDK's history records it. */
export type Inbound = Readonly<{ key: string; signature: string; slot: bigint; mint: string; amount: bigint }>;

/** The settling payment of an invoice: which transaction, at what slot. */
export type Paid = Readonly<{ signature: string; slot: bigint; key: string }>;

/** An invoice as its recipient keeps it: the invoice, the slot it was made at, and its payment once matched. */
export type Kept = Readonly<{ invoice: PrivateInvoice; sinceSlot: bigint; paid: Paid | null }>;

export type InvoiceState = 'waiting' | 'paid' | 'expired';

export type Settled = Readonly<{ state: InvoiceState; paid: Paid | null }>;

const KINDS = new Set(['deposit', 'privateTransfer']);

function big(value: unknown): bigint | null {
  try {
    if (typeof value === 'bigint') return value;
    if (typeof value === 'number' && Number.isSafeInteger(value)) return BigInt(value);
    if (typeof value === 'string' && /^\d+$/.test(value)) return BigInt(value);
  } catch {
    /* not a number */
  }
  return null;
}

/**
 * The payments that came in, from the SDK's private history: inbound, confirmed, a deposit or a private transfer,
 * with a signature, a slot and a positive sum. Anything else — what the person sent, split or merged — is not a payment
 * to them.
 */
export function inboundOf(records: readonly unknown[]): readonly Inbound[] {
  const out: Inbound[] = [];
  for (const raw of records) {
    if (!raw || typeof raw !== 'object') continue;
    const record = raw as { id?: { signature?: unknown; slot?: unknown; index?: unknown }; kind?: unknown; direction?: unknown; status?: unknown; asset?: unknown; amount?: unknown };
    if (record.direction !== 'inbound' || record.status !== 'confirmed' || !KINDS.has(String(record.kind))) continue;
    const signature = typeof record.id?.signature === 'string' ? record.id.signature : null;
    const slot = big(record.id?.slot);
    const index = big(record.id?.index) ?? 0n;
    const amount = big(record.amount);
    if (!signature || slot === null || amount === null || amount <= 0n || record.asset === undefined || record.asset === null) continue;
    out.push(Object.freeze({ key: `${signature}#${index}`, signature, slot, mint: String(record.asset), amount }));
  }
  return out;
}

/** Every kept invoice's state now: paid, waiting, or expired with nothing come. */
export function settle(kept: readonly Kept[], inbound: readonly Inbound[], now: number): ReadonlyMap<string, Settled> {
  const out = new Map<string, Settled>();
  const used = new Set<string>();
  for (const one of kept) if (one.paid) used.add(one.paid.key);
  const payments = [...inbound].sort((a, b) => (a.slot < b.slot ? -1 : a.slot > b.slot ? 1 : a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const oldestFirst = [...kept].sort((a, b) => a.invoice.createdAt - b.invoice.createdAt || (a.invoice.id < b.invoice.id ? -1 : 1));
  for (const one of oldestFirst) {
    const { invoice } = one;
    if (one.paid) {
      out.set(invoice.id, { state: 'paid', paid: one.paid });
      continue;
    }
    const match = payments.find((p) => !used.has(p.key) && p.mint === invoice.mint && p.amount === invoice.amount && p.slot >= one.sinceSlot);
    if (match) {
      used.add(match.key);
      out.set(invoice.id, { state: 'paid', paid: { signature: match.signature, slot: match.slot, key: match.key } });
      continue;
    }
    out.set(invoice.id, { state: now >= invoice.expiresAt ? 'expired' : 'waiting', paid: null });
  }
  return out;
}

/** The kept invoices whose payment this read found for the first time — the ones the store seals as paid. */
export function newlyPaid(kept: readonly Kept[], settled: ReadonlyMap<string, Settled>): readonly (Readonly<{ id: string; paid: Paid }>)[] {
  return kept.flatMap((one) => {
    const now = settled.get(one.invoice.id);
    return !one.paid && now?.paid ? [{ id: one.invoice.id, paid: now.paid }] : [];
  });
}

/** «Waiting for …»: the sums still to come, by coin, in the order the coins first appear. */
export function waitingTotals(kept: readonly Kept[], settled: ReadonlyMap<string, Settled>): readonly (Readonly<{ mint: string; amount: bigint }>)[] {
  const totals = new Map<string, bigint>();
  for (const { invoice } of kept) {
    if (settled.get(invoice.id)?.state !== 'waiting') continue;
    totals.set(invoice.mint, (totals.get(invoice.mint) ?? 0n) + invoice.amount);
  }
  return [...totals].map(([mint, amount]) => ({ mint, amount }));
}

/** The list as the screen shows it: waiting first (soonest to expire on top), then paid and expired, newest first. */
export function listOrder<T extends Kept>(kept: readonly T[], settled: ReadonlyMap<string, Settled>): readonly T[] {
  const rank = (one: T) => (settled.get(one.invoice.id)?.state === 'waiting' ? 0 : 1);
  return [...kept].sort((a, b) => rank(a) - rank(b) || (rank(a) === 0 ? a.invoice.expiresAt - b.invoice.expiresAt : b.invoice.createdAt - a.invoice.createdAt));
}
