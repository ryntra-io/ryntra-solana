/**
 * A swap at the private desk as the Swap screen holds it: the stage while it runs, what it bought, why it
 * stopped. Started only where `way.ts` chose the desk — a desk at `DESK_URL` that quotes the pair, and a build that can
 * check the desk's leg before the wallet signs; today neither stands, so the Swap's «Private» goes the route's way.
 *
 * The keys are the private balance's own (`usePrivate` opened them; held in this tab or sealed), never asked here.
 * Nothing is kept: a desk swap is one transaction — it lands whole or not at all, so there is no half way to find again.
 */

import { create } from 'zustand';

import { PrivateError, openBook, ownKeys, sdkCodes, type Book, type Ctx, type WalletKeys } from '../flows.ts';
import { PRIVATE_NET, privateNetwork } from '../network.ts';
import { loadPrivate } from '../sdk.client.ts';
import { heldKeys, keysId, unseal, type StoredKeys } from '../vault.client.ts';
import { walletSigner } from '../wallet.client.ts';
import { DESK } from './config.ts';
import { DeskRefused, httpDesk, refusalCode } from './link.ts';
import type { Ask } from './quote.ts';
import { DeskError, PAID_READER, deskAbilities, swapAtDesk, type DeskStage } from './run.ts';

const NETWORK = PRIVATE_NET;

/** For the Swap's choice at render: a build with no reader of the desk's leg never offers the desk. */
export const deskCanCheck = (): boolean => PAID_READER !== null;

/**
 * How the last desk swap stopped. The desk's own refusals are folded into three codes, each said before the wallet was
 * asked — `DESK_EXPIRED` (the price ran out), `DESK_NOT_NOW` (no stock, too small, no fresh price), `DESK_REFUSED`
 * (anything else the desk said); `DeskError`'s codes stand as they are; the private balance's (`PrivateError`, the
 * SDK's) too — those may come after sending, and say «read the network».
 */
export type DeskFailure = Readonly<{ code: string; detail: string }>;

type State = Readonly<{
  stage: DeskStage | null;
  /** When the stage began (ms), for the seconds on the waiting line. */
  since: number | null;
  failure: DeskFailure | null;
  /** What the last swap bought, once it landed. */
  done: Readonly<{ outMint: string; outRaw: bigint }> | null;
}>;

type Actions = Readonly<{
  start: (ask: Ask, wallet: string) => Promise<void>;
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

export function failureOf(error: unknown): DeskFailure {
  if (error instanceof DeskRefused) return { code: refusalCode(error.code), detail: error.code };
  if (error instanceof DeskError || error instanceof PrivateError) return { code: error.code, detail: error.message };
  const codes = sdkCodes(error);
  return { code: codes.at(-1) ?? 'UNKNOWN', detail: error instanceof Error ? error.message : String(error) };
}

export const useDeskSwap = create<State & Actions>((set, get) => {
  const stage = (next: DeskStage | null) => set({ stage: next, since: next ? Date.now() : null });
  return {
    stage: null,
    since: null,
    failure: null,
    done: null,

    start: async (ask, wallet) => {
      const url = DESK.url;
      if (!privateNetwork() || !url || get().stage) return;
      set({ failure: null, done: null });
      try {
        ctx ??= await loadPrivate();
        if (!deskAbilities(ctx.sdk).canCheck) throw new DeskError('DESK_UNCHECKED');
        const end = await swapAtDesk({ ctx, book: await bookFor(ctx, ask.owner), wallet: walletSigner(wallet, ask.owner), link: httpDesk(url), ask, on: stage });
        set({ done: { outMint: end.quote.outMint, outRaw: end.quote.outRaw } });
      } catch (error) {
        set({ failure: failureOf(error) });
      } finally {
        stage(null);
      }
    },

    clear: () => set({ failure: null, done: null }),
  };
});
