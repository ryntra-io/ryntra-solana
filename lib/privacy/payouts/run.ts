/**
 * The payout's steps on the ring, one at a time — each built with the Privacy Rings SDK, signed by the person's wallet
 * and sent through `flows.ts`'s `submit` (the wallet's answer must carry the same bytes; Ryntra's relay; the chain and
 * the ring's indexer waited for). Nothing here keeps a key or decides what to pay: the plan is `plan.ts`'s, the keys are
 * handed in.
 *
 * What the SDK bundle in this build can do decides two things, read once (`abilities`): a transfer to up to 15 people
 * needs `buildMultiTransferTransaction`, a merge needs `buildMergeTransaction` (and, the first time, turning merging on
 * with `buildSetMergeEncryptionTransaction`). The bundle of 18.11 exports neither — then each person is a transfer of
 * their own and a balance in too many parts cannot be merged here; the plan says so before anything is signed.
 */

import { passGate, submit, sync, type Book, type Ctx, type Landed, type PrivateSigner } from '../flows.ts';
import type { Batch, Payment } from './plan.ts';

/** The ring's code for «merges are sealed this way» (`MergeEncryptionScheme.PoseidonCtrV1`). */
const MERGE_SCHEME = 1;

/** Recipients asked about at once when reading who has a private balance. */
const READ_AT_ONCE = 20;

export type Abilities = Readonly<{ perTransfer: number; canMerge: boolean; canTurnMergeOn: boolean }>;

export function abilities(ctx: Ctx): Abilities {
  const { sdk } = ctx;
  return {
    perTransfer: typeof sdk.buildMultiTransferTransaction === 'function' ? 15 : 1,
    canMerge: typeof sdk.buildMergeTransaction === 'function',
    canTurnMergeOn: typeof sdk.buildSetMergeEncryptionTransaction === 'function',
  };
}

/** Which of these addresses have a private balance. */
export async function readRegistered(ctx: Ctx, addresses: readonly string[]): Promise<Map<string, boolean>> {
  const out = new Map<string, boolean>();
  for (let i = 0; i < addresses.length; i += READ_AT_ONCE) {
    const chunk = addresses.slice(i, i + READ_AT_ONCE);
    const { records } = (await ctx.client.getUserRecords(chunk)) as { records: readonly unknown[] };
    chunk.forEach((address, j) => out.set(address, Boolean(records[j])));
  }
  return out;
}

/** Whether the ring's record lets this wallet merge (a merge is refused while it is off). */
export async function mergeIsOn(ctx: Ctx, owner: string): Promise<boolean> {
  const { records } = (await ctx.client.getUserRecords([owner])) as { records: readonly ({ mergeEncryption?: number } | null | undefined)[] };
  return records[0]?.mergeEncryption === MERGE_SCHEME;
}

type Entry = Readonly<{ spent: boolean; utxo: { asset: unknown; amount: bigint; ringProgramId?: unknown; data?: { isEmpty?: () => boolean } }; dataHash?: unknown; ringDataHash?: unknown }>;

/** The parts of the private balance a spend may take: unspent, in this coin, plain (a part with a memo is never taken). */
export function partsOf(book: Book, mint: string): bigint[] {
  const wallet = book.wallet as { utxos(): readonly Entry[] };
  return wallet
    .utxos()
    .filter((e) => !e.spent && String(e.utxo.asset) === mint && BigInt(e.utxo.amount) > 0n && e.utxo.ringProgramId === undefined && e.dataHash === undefined && e.ringDataHash === undefined && (e.utxo.data?.isEmpty?.() ?? true))
    .map((e) => BigInt(e.utxo.amount));
}

/** Where a step stands, for the screen: the proof is being made, the wallet is open, the chain is being waited for. */
export type Stage = 'proving' | 'signing' | 'landing';

/** The person's wallet, telling the screen when it opens and when it has signed. */
export function watched(wallet: PrivateSigner, on: (stage: Stage) => void): PrivateSigner {
  return {
    address: wallet.address,
    async signWire(wire) {
      on('signing');
      const signed = await wallet.signWire(wire);
      on('landing');
      return signed;
    },
  };
}

export type StepCtx = Readonly<{ ctx: Ctx; book: Book; wallet: PrivateSigner; mint: string; on: (stage: Stage) => void }>;

async function landed(step: StepCtx, build: () => Promise<unknown>): Promise<Landed> {
  step.on('proving');
  const tx = await build();
  const done = await submit(step.ctx, tx, { wallet: watched(step.wallet, step.on) });
  // The next spend is built only once the wallet has read this one (the SDK's rule for spends in a row).
  await sync(step.ctx, step.book, done.slot).catch(() => undefined);
  return done;
}

export function turnMergeOn(step: StepCtx): Promise<Landed> {
  return landed(step, () => step.ctx.sdk.buildSetMergeEncryptionTransaction({ client: step.ctx.client, owner: step.wallet.address, scheme: MERGE_SCHEME }));
}

export function merge(step: StepCtx): Promise<Landed> {
  return landed(step, () => step.ctx.sdk.buildMergeTransaction({ client: step.ctx.client, wallet: step.book.wallet, keys: step.book.keys, feePayer: step.wallet.address, asset: step.mint }));
}

/** One private transfer: its payments, then Ryntra's fee as the same transfer's extra output. Every recipient passes the rules before money first. */
export async function transfer(step: StepCtx, batch: Batch, feeTo: string | null): Promise<Landed> {
  for (const p of batch.payments) await passGate(step.ctx, { kind: 'send', owner: step.wallet.address, to: p.to });
  const { sdk, client } = step.ctx;
  const base = { client, wallet: step.book.wallet, keys: step.book.keys, feePayer: step.wallet.address, asset: step.mint };
  const payments = batch.payments.map((p) => ({ recipient: p.to, amount: p.units }));
  if (batch.fee > 0n && feeTo) payments.push({ recipient: feeTo, amount: batch.fee });
  if (payments.length === 1) return landed(step, () => sdk.buildTransferTransaction({ ...base, recipient: payments[0].recipient, amount: payments[0].amount }));
  return landed(step, () => sdk.buildMultiTransferTransaction({ ...base, payments }));
}

/** An open payment: straight from the private balance to the person's wallet — who gets it and how much are seen. */
export async function payOpen(step: StepCtx, payment: Payment): Promise<Landed> {
  // Out of the private balance to someone else's wallet: the rules before money are asked first, as for «Return».
  const gate = await passGate(step.ctx, { kind: 'return', owner: step.wallet.address, to: payment.to });
  const done = await landed(step, () =>
    step.ctx.sdk.buildWithdrawalTransaction({ client: step.ctx.client, wallet: step.book.wallet, keys: step.book.keys, feePayer: step.wallet.address, recipient: payment.to, amount: payment.units, asset: step.mint }),
  );
  if (step.mint === String(step.ctx.sdk.SOL_MINT)) gate.landed('out', payment.units);
  return done;
}
