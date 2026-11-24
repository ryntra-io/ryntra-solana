/**
 * A checked list as the signatures it takes — counted before the first one. Pure: the parts the private balance lies in
 * and whether the ring may merge them for this wallet are handed in; nothing is built or sent here.
 *
 * The steps, in the order they are signed:
 * 1. turning merging on for this wallet, once, when a merge is needed and the ring's record has it off;
 * 2. merges, where a transfer would need more parts of the balance than its proof takes (`shapes.ts`): each folds up to
 *    24 smallest parts into one;
 * 3. private transfers of up to 15 recipients each (14 when Ryntra's fee is the transfer's own extra output), in list
 *    order;
 * 4. open payments — a withdrawal straight to the person's wallet, amount seen;
 * 5. links — two signatures each (the link's network fees in the open, then the private transfer into it).
 *
 * The balance's parts are followed through every step the way the SDK picks them (largest first, change back as one
 * part), so a merge is counted where it will really be asked for, not where it might be.
 */

import { LINK_FEE_LAMPORTS } from '../network.ts';
import type { CheckedRow } from './check.ts';
import { feeOf, type FeeRule } from './fee.ts';
import { MAX_PAYMENTS, MAX_SPEND_INPUTS, MERGE_INPUT_COUNT, maxSpendInputs } from './shapes.ts';

export type Payment = Readonly<{ id: string; to: string; units: bigint }>;

export type Batch = Readonly<{
  coin: string;
  payments: readonly Payment[];
  /** Ryntra's fee — the same transfer's extra output; 0 adds no output. */
  fee: bigint;
}>;

export type PlanStep =
  | Readonly<{ kind: 'mergeOn' }>
  | Readonly<{ kind: 'merge'; parts: number }>
  | Readonly<{ kind: 'transfer'; batch: number }>
  | Readonly<{ kind: 'open'; payment: Payment }>
  | Readonly<{ kind: 'link'; payment: Payment }>;

/** Wallet signatures each step asks for. */
export const SIGNATURES: Readonly<Record<PlanStep['kind'], number>> = { mergeOn: 1, merge: 1, transfer: 1, open: 1, link: 2 };

export type Plan = Readonly<{
  steps: readonly PlanStep[];
  batches: readonly Batch[];
  /** Wallet signatures, all told. */
  signatures: number;
  people: number;
  /** What the payments carry, fee not counted. */
  total: bigint;
  fee: bigint;
  /** What the private balance gives: payments and fee. */
  spend: bigint;
  /** SOL the wallet itself pays in the open: each link's network fees (network fees of each signature aside). */
  walletSol: bigint;
  /** The private balance falls short by this much; 0 when it holds enough. */
  short: bigint;
  /** A merge is needed but this session cannot merge (the SDK build lacks it). */
  stuck: boolean;
}>;

export type PlanInput = Readonly<{
  /** Lines that pay — nothing in them stops the payout — with their routes known. */
  rows: readonly CheckedRow[];
  coin: string;
  /** Spendable parts of the private balance in this coin. */
  parts: readonly bigint[];
  /** The ring's record lets this wallet merge. */
  mergeOn: boolean;
  /** Recipients one private transfer may carry here: 15 with the SDK's multi-recipient transfer, 1 without. */
  perTransfer: number;
  /** This session can build a merge. */
  canMerge: boolean;
  fee: FeeRule;
}>;

/** Private recipients cut into transfers, in list order. */
export function batchesOf(rows: readonly CheckedRow[], coin: string, perTransfer: number, fee: FeeRule): Batch[] {
  const feeSlot = fee.to && fee.bps > 0 && perTransfer > 1 ? 1 : 0;
  const size = Math.max(1, Math.min(perTransfer, MAX_PAYMENTS) - feeSlot);
  const pay = rows.filter((r) => r.route === 'private' && r.coin === coin && r.address && r.units !== null);
  const out: Batch[] = [];
  for (let i = 0; i < pay.length; i += size) {
    const payments = pay.slice(i, i + size).map((r) => ({ id: r.id, to: r.address as string, units: r.units as bigint }));
    const sum = payments.reduce((a, p) => a + p.units, 0n);
    out.push({ coin, payments, fee: feeSlot ? feeOf(sum, fee) : 0n });
  }
  return out;
}

type Pick = Readonly<{ ok: true; taken: readonly bigint[] }> | Readonly<{ ok: false; why: 'short' | 'tooMany' }>;

/** The SDK's pick (`flows/select.js`): largest parts first, until the amount is covered, at most `maxInputs`. */
function pick(parts: readonly bigint[], amount: bigint, maxInputs: number, maxWithChange: number): Pick {
  const sorted = [...parts].sort((a, b) => (a > b ? -1 : a < b ? 1 : 0));
  const total = sorted.reduce((a, b) => a + b, 0n);
  if (total < amount) return { ok: false, why: 'short' };
  const taken: bigint[] = [];
  let have = 0n;
  for (const part of sorted.slice(0, maxInputs)) {
    taken.push(part);
    have += part;
    if (have >= amount) break;
  }
  if (have < amount) return { ok: false, why: 'tooMany' };
  if (have !== amount && taken.length > maxWithChange) return { ok: false, why: 'tooMany' };
  return { ok: true, taken };
}

function without(parts: readonly bigint[], taken: readonly bigint[]): bigint[] {
  const left = [...parts];
  for (const t of taken) left.splice(left.indexOf(t), 1);
  return left;
}

export function planPayout(input: PlanInput): Plan {
  const batches = batchesOf(input.rows, input.coin, input.perTransfer, input.fee);
  const opens = input.rows.filter((r) => r.route === 'open' && r.coin === input.coin && r.address && r.units !== null);
  const links = input.rows.filter((r) => r.route === 'link' && r.coin === input.coin && r.address && r.units !== null);
  const asPayment = (r: CheckedRow): Payment => ({ id: r.id, to: r.address as string, units: r.units as bigint });

  const steps: PlanStep[] = [];
  let parts = [...input.parts];
  let mergeOn = input.mergeOn;
  let short = 0n;
  let stuck = false;

  /** One spend of `amount`; merges first when it would need more parts than its proof takes. */
  const spend = (amount: bigint, maxInputs: number, maxWithChange: number): boolean => {
    for (;;) {
      const got = pick(parts, amount, maxInputs, maxWithChange);
      if (got.ok) {
        const change = got.taken.reduce((a, b) => a + b, 0n) - amount;
        parts = without(parts, got.taken);
        if (change > 0n) parts.push(change);
        return true;
      }
      if (got.why === 'short') {
        const have = parts.reduce((a, b) => a + b, 0n);
        short += amount - have;
        parts = [];
        return false;
      }
      // Too many parts: fold the smallest together, as the ring's default merge does.
      if (!input.canMerge || parts.length < 2) {
        stuck = true;
        return false;
      }
      if (!mergeOn) {
        steps.push({ kind: 'mergeOn' });
        mergeOn = true;
      }
      const smallest = [...parts].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).slice(0, MERGE_INPUT_COUNT);
      parts = without(parts, smallest);
      parts.push(smallest.reduce((a, b) => a + b, 0n));
      steps.push({ kind: 'merge', parts: smallest.length });
    }
  };

  batches.forEach((batch, i) => {
    const outputs = batch.payments.length + (batch.fee > 0n ? 1 : 0);
    const amount = batch.payments.reduce((a, p) => a + p.units, 0n) + batch.fee;
    if (spend(amount, maxSpendInputs(outputs), maxSpendInputs(outputs + 1))) steps.push({ kind: 'transfer', batch: i });
  });
  // A withdrawal and a one-recipient transfer take the SDK's widest pick.
  for (const row of opens) if (spend(row.units as bigint, MAX_SPEND_INPUTS, MAX_SPEND_INPUTS)) steps.push({ kind: 'open', payment: asPayment(row) });
  for (const row of links) if (spend(row.units as bigint, maxSpendInputs(1), maxSpendInputs(2))) steps.push({ kind: 'link', payment: asPayment(row) });

  const total = [...batches.flatMap((b) => b.payments), ...opens.map(asPayment), ...links.map(asPayment)].reduce((a, p) => a + p.units, 0n);
  const fee = batches.reduce((a, b) => a + b.fee, 0n);
  return {
    steps,
    batches,
    signatures: steps.reduce((a, s) => a + SIGNATURES[s.kind], 0),
    people: batches.reduce((a, b) => a + b.payments.length, 0) + opens.length + links.length,
    total,
    fee,
    spend: total + fee,
    walletSol: BigInt(links.length) * LINK_FEE_LAMPORTS,
    short,
    stuck,
  };
}
