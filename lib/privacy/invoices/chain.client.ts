/**
 * The private invoice's steps that reach the ring, through the same SDK client and relay as the private
 * balance (`../sdk.client.ts`, `/api/v1/privacy/<network>/**`):
 *
 * - `invoiceSlot` — the slot an invoice is made at, so a payment from before it never pays it;
 * - `readInbound` — the recipient's own private history: the payments that came in, read with their own keys;
 * - `buildWalletPayment` — the payer's one approval, built: the sum straight into the recipient's private balance.
 *
 * Nothing here keeps a key or a signature. Mainnet is not reachable from here: the client is the test network's.
 */

import { canReceive, openBook, ownKeys, passGate, PrivateError, sync, type Book, type Ctx, type WalletKeys } from '../flows.ts';
import { defaultGate } from '../gate/client.ts';
import { PRIVATE_NET, RING_SOL } from '../network.ts';
import { heldKeys, keysId, unseal, type StoredKeys } from '../vault.client.ts';
import type { PrivateInvoice } from './model.ts';
import { inboundOf, type Inbound } from './status.ts';

const NETWORK = PRIVATE_NET;

/** The confirmed slot now. */
export async function invoiceSlot(ctx: Ctx): Promise<bigint> {
  return BigInt(await ctx.client.solanaRpc.getSlot({ commitment: 'confirmed' }).send());
}

let book: Readonly<{ owner: string; book: Book }> | null = null;

/**
 * The payments that came into this wallet's private balance, from its own private history after a sync; null when
 * this browser holds no keys for it. The keys the wallet gave in this tab come first (`heldKeys`, checked by the private
 * balance against the ring's record); older keys sealed in this browser only when there are none. The book is kept
 * between reads, so each sync takes only what is new.
 */
export async function readInbound(ctx: Ctx, owner: string): Promise<readonly Inbound[] | null> {
  const fromWallet = heldKeys<WalletKeys>(NETWORK, owner);
  if (fromWallet) {
    if (book?.owner !== owner || book.book.keys !== fromWallet) book = { owner, book: openBook(ctx, owner, fromWallet) };
  } else if (book?.owner !== owner) {
    const stored = await unseal<StoredKeys>(keysId(NETWORK, owner));
    if (!stored) return null;
    const keys = ownKeys(ctx, owner, { viewing: Uint8Array.from(stored.viewing), nullifier: Uint8Array.from(stored.nullifier) });
    book = { owner, book: openBook(ctx, owner, keys) };
  }
  await sync(ctx, book.book);
  return inboundOf(ctx.sdk.getPrivateTransactions(book.book.wallet) as readonly unknown[]);
}

/** Forgets the kept book (another wallet came, or the keys changed). */
export function dropBook(): void {
  book = null;
}

/** Can this wallet take a private payment — is its private balance turned on? */
export function takesPrivate(ctx: Ctx, owner: string): Promise<boolean> {
  return canReceive(ctx, owner);
}

/**
 * «Pay» from the wallet, built: the ring's deposit of the invoice's exact sum from the payer's wallet straight into the
 * recipient's private balance (the SDK resolves their private address from the ring's registry). The payer and the
 * sum are seen; «what it is for» is never written: no memo. Nothing is signed here — the page has the wallet sign it
 * with `submit` (`../flows.ts`), so a failure before the wallet is asked moved nothing.
 *
 * The rules ahead of a deposit — the address check and the pause of new deposits — stand in front of this call as in
 * front of «Hide»; a move they do not pass throws before anything is built.
 */
export async function buildWalletPayment(ctx: Ctx, payer: string, invoice: PrivateInvoice): Promise<unknown> {
  if (!(await canReceive(ctx, invoice.to))) throw new PrivateError('NOT_REGISTERED');
  // The rules before money: the payer's address and the pause of new deposits, as for «Hide» (a cap that needs the
  // recipient's balance cannot be read from here, so with a cap set the gate waits), then the recipient's address.
  await passGate(ctx, { kind: 'hide', owner: payer, amount: invoice.mint === RING_SOL ? invoice.amount : 0n });
  await passGate(ctx, { kind: 'send', owner: payer, to: invoice.to });
  return ctx.sdk.buildDepositTransaction({
    client: ctx.client,
    feePayer: payer,
    recipient: invoice.to,
    amount: invoice.amount,
    ...(invoice.mint === RING_SOL ? {} : { asset: invoice.mint }),
  });
}

/** A wallet payment landed: SOL into the ring is counted in «in — out», as «Hide» counts it. Never fails the payment. */
export function paidIn(ctx: Ctx, invoice: PrivateInvoice): void {
  if (invoice.mint === RING_SOL) (ctx.gate ?? defaultGate()).landed('in', invoice.amount);
}

/** The wallet's SOL now, in lamports. */
export async function walletLamports(ctx: Ctx, address: string): Promise<bigint> {
  return BigInt(await ctx.client.getBalance(address));
}
