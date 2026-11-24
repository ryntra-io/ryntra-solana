/**
 * A private swap as the Swap screen holds it: the stage while it runs (the proof may take up to 20 seconds), the way
 * it went, and where the coins are — read from the chain. The only thing the browser keeps is the swap's record, sealed
 * like the private balance's own (`vault.client.ts`: signatures and coins, nothing the answer trusts), so a page opened
 * again finds its way back and reads the chain once more. A vault that cannot be opened leaves the record for this page
 * only.
 *
 * The keys are the private balance's own (`usePrivate` opened them; held in this tab or sealed), never asked here.
 */

import { create } from 'zustand';

import { PrivateError, openBook, ownKeys, sdkCodes, type Book, type Ctx, type WalletKeys } from '../flows.ts';
import { PRIVATE_CHAIN, PRIVATE_NET, privateNetwork } from '../network.ts';
import { loadPrivate } from '../sdk.client.ts';
import { forget, heldKeys, keysId, seal, unseal, type StoredKeys } from '../vault.client.ts';
import { walletSigner } from '../wallet.client.ts';
import type { Path } from './plan.ts';
import { nextOf, readRecord, type PackRecord, type Where } from './recover.ts';
import { readWhere, returnToPrivate, swapPrivately, type OpenOrder, type Stage } from './run.ts';
import { swapSigner } from './signer.client.ts';

const NETWORK = PRIVATE_NET;
/** Where the vault keeps the last swap's record, per wallet. */
export const swapId = (owner: string) => `swap:${NETWORK}:${owner}`;

/** The swap's card's exact order, as the trade logic holds it. */
export type CardOrder = Readonly<{ transactionBase64: string; lastValidBlockHeight: string; inputMint: string; outputMint: string; inAmountRaw: string; minReceivedRaw: string }>;

/** The card's exact order with the network it was built for (the screen names it). */
export function openOrderOf(order: CardOrder, chain: string): OpenOrder {
  return { wireBase64: order.transactionBase64, lastValidBlockHeight: order.lastValidBlockHeight, inputMint: order.inputMint, outputMint: order.outputMint, inAmountRaw: order.inAmountRaw, minReceivedRaw: order.minReceivedRaw, chain };
}

export type SwapFailure = Readonly<{ code: string; detail: string }>;

type State = Readonly<{
  stage: Stage | 'returning' | null;
  /** When the stage began (ms), for the seconds on the waiting line. */
  since: number | null;
  path: Path | null;
  where: Where | null;
  failure: SwapFailure | null;
  /** The coins a break left on the wallet went back into the private balance. */
  returned: boolean;
  /** The coin the last swap bought. */
  outMint: string | null;
}>;

type Actions = Readonly<{
  /** `chain` — the network the card built the order for. */
  start: (order: CardOrder, chain: string, wallet: string, owner: string, fresh?: () => CardOrder | null) => Promise<void>;
  /** Reads the chain again for the kept record of this wallet. */
  reread: (owner: string) => Promise<void>;
  /** «Return to private balance»: the coin a break left on the person's own wallet. */
  giveBack: (wallet: string, owner: string) => Promise<void>;
  clear: () => void;
}>;

let ctx: Ctx | null = null;
let book: Book | null = null;

async function bookFor(c: Ctx, owner: string): Promise<Book> {
  const fromWallet = heldKeys<WalletKeys>(NETWORK, owner);
  if (fromWallet) {
    if (!book || book.owner !== owner || book.keys !== fromWallet) book = openBook(c, owner, fromWallet);
    return book;
  }
  if (book && book.owner === owner) return book;
  const stored = await unseal<StoredKeys>(keysId(NETWORK, owner));
  if (!stored) throw new PrivateError('NOT_REGISTERED');
  book = openBook(c, owner, ownKeys(c, owner, { viewing: Uint8Array.from(stored.viewing), nullifier: Uint8Array.from(stored.nullifier) }));
  return book;
}

async function keep(record: PackRecord | null, owner: string): Promise<void> {
  try {
    if (record) await seal(swapId(owner), record);
    else await forget(swapId(owner));
  } catch {
    // The vault would not open: the record holds for this page only.
  }
}

let held: PackRecord | null = null;

async function kept(owner: string): Promise<PackRecord | null> {
  try {
    const record = readRecord(JSON.stringify(await unseal<unknown>(swapId(owner))));
    if (record) return record;
  } catch {
    // The vault would not open: this page's own record, if any.
  }
  return held && held.owner === owner ? held : null;
}

function failureOf(error: unknown): SwapFailure {
  if (error instanceof PrivateError) return { code: error.code, detail: error.message };
  const codes = sdkCodes(error);
  return { code: codes.at(-1) ?? 'UNKNOWN', detail: error instanceof Error ? error.message : String(error) };
}

export const usePrivateSwap = create<State & Actions>((set, get) => {
  const stage = (next: State['stage']) => set({ stage: next, since: next ? Date.now() : null });
  /** A finished place forgets the record: nothing is left to find. */
  const settle = (where: Where, owner: string) => {
    if (nextOf(where).does === 'none') {
      held = null;
      void keep(null, owner);
    }
    set({ where });
  };
  return {
    stage: null,
    since: null,
    path: null,
    where: null,
    failure: null,
    returned: false,
    outMint: null,

    start: async (order, chain, wallet, owner, fresh) => {
      if (!privateNetwork() || get().stage) return;
      set({ failure: null, path: null, where: null, returned: false, outMint: order.outputMint });
      const open = openOrderOf(order, chain);
      // A route on another network than the private balance's is said at once: no bundle, no keys, no proof.
      if (open.chain !== PRIVATE_CHAIN) return set({ path: { kind: 'refuse', code: 'ELSEWHERE' } });
      try {
        ctx ??= await loadPrivate();
        const b = await bookFor(ctx, owner);
        const end = await swapPrivately({
          ctx,
          book: b,
          wallet: swapSigner(wallet, owner),
          order: open,
          fresh: () => {
            const now = fresh?.();
            return now ? openOrderOf(now, chain) : null;
          },
          on: stage,
          remember: async (record) => {
            held = record;
            await keep(record, owner);
          },
        });
        set({ path: end.path });
        settle(end.where, owner);
      } catch (error) {
        set({ failure: failureOf(error) });
        // Signed and maybe sent: the chain says where the coins are.
        if (ctx && (await kept(owner))) await get().reread(owner);
      } finally {
        stage(null);
      }
    },

    reread: async (owner) => {
      const record = await kept(owner);
      if (!record) return;
      try {
        ctx ??= await loadPrivate();
        settle(await readWhere(ctx, record), owner);
      } catch (error) {
        set({ failure: failureOf(error) });
      }
    },

    giveBack: async (wallet, owner) => {
      const where = get().where;
      if (!where || where.place !== 'wallet' || get().stage) return;
      stage('returning');
      try {
        ctx ??= await loadPrivate();
        const b = await bookFor(ctx, owner);
        await returnToPrivate(ctx, walletSigner(wallet, owner), b, where.mint, where.amount);
        held = null;
        await keep(null, owner);
        set({ where: null, failure: null, returned: true });
      } catch (error) {
        set({ failure: failureOf(error) });
      } finally {
        stage(null);
      }
    },

    clear: () => set({ path: null, where: null, failure: null, returned: false }),
  };
});
