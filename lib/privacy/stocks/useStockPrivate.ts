/**
 * A stock bought from the private balance, and a stock pool's income put back into it — as a screen holds them: the
 * stage while it runs (the proof may take up to 20 seconds), the way it went, and where the coins are, read from the
 * chain. The only thing the browser keeps is the flow's record, sealed like the private balance's own
 * (`../vault.client.ts`: signatures and coins, nothing the answer trusts), so a page opened again finds its way back.
 *
 * The keys are the private balance's own (`usePrivate` opened them; held in this tab or sealed), never asked here.
 */

import { create } from 'zustand';

import { PrivateError, openBook, ownKeys, sdkCodes, type Book, type Ctx, type WalletKeys } from '../flows.ts';
import { PRIVATE_CHAIN, PRIVATE_NET, privateNetwork } from '../network.ts';
import { loadPrivate } from '../sdk.client.ts';
import { returnToPrivate, type OpenOrder, type Stage } from '../swap/run.ts';
import { swapSigner } from '../swap/signer.client.ts';
import type { CardOrder } from '../swap/useSwap.ts';
import { forget, heldKeys, keysId, seal, unseal, type StoredKeys } from '../vault.client.ts';
import { walletSigner } from '../wallet.client.ts';
import type { BuyPath, IncomePath } from './plan.ts';
import { nextAfter, readStockRecord, type BuyWhere, type IncomeWhere, type StockRecord } from './recover.ts';
import { buyStockPrivately, incomeToPrivate, readStockWhere, type IncomeClaim } from './run.ts';

const NETWORK = PRIVATE_NET;
/** Where the vault keeps the last stock flow's record, per wallet. */
export const stockRecordId = (owner: string) => `stock:${NETWORK}:${owner}`;

export function openOrderOf(order: CardOrder, chain: string): OpenOrder {
  return { wireBase64: order.transactionBase64, lastValidBlockHeight: order.lastValidBlockHeight, inputMint: order.inputMint, outputMint: order.outputMint, inAmountRaw: order.inAmountRaw, minReceivedRaw: order.minReceivedRaw, chain };
}

export type StockFailure = Readonly<{ code: string; detail: string }>;
export type StockFlowName = 'buy' | 'income';

type State = Readonly<{
  flow: StockFlowName | null;
  stage: Stage | 'returning' | null;
  since: number | null;
  path: BuyPath | IncomePath | null;
  where: BuyWhere | IncomeWhere | null;
  failure: StockFailure | null;
  returned: boolean;
}>;

type Actions = Readonly<{
  /** Buys the stock of the ticket's exact order from the private balance. `chain` — the network the order was built for. */
  buy: (order: CardOrder, chain: string, wallet: string, owner: string, fresh?: () => CardOrder | null) => Promise<void>;
  /** Takes the position's income (the engine's claim Review) and puts its SOL or USDC side into the private balance. */
  income: (claim: IncomeClaim, wallet: string, owner: string) => Promise<void>;
  reread: (owner: string) => Promise<void>;
  /** «Return to private balance»: the coin a break left on the person's own wallet. */
  giveBack: (wallet: string, owner: string) => Promise<void>;
  clear: () => void;
}>;

let ctx: Ctx | null = null;
let book: Book | null = null;
let held: StockRecord | null = null;

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

async function keep(record: StockRecord | null, owner: string): Promise<void> {
  try {
    if (record) await seal(stockRecordId(owner), record);
    else await forget(stockRecordId(owner));
  } catch {
    // The vault would not open: the record holds for this page only.
  }
}

async function kept(owner: string): Promise<StockRecord | null> {
  try {
    const record = readStockRecord(JSON.stringify(await unseal<unknown>(stockRecordId(owner))));
    if (record) return record;
  } catch {
    // The vault would not open: this page's own record, if any.
  }
  return held && held.owner === owner ? held : null;
}

function failureOf(error: unknown): StockFailure {
  if (error instanceof PrivateError) return { code: error.code, detail: error.message };
  const codes = sdkCodes(error);
  return { code: codes.at(-1) ?? 'UNKNOWN', detail: error instanceof Error ? error.message : String(error) };
}

export const useStockPrivate = create<State & Actions>((set, get) => {
  const stage = (next: State['stage']) => set({ stage: next, since: next ? Date.now() : null });
  const settle = (where: BuyWhere | IncomeWhere, owner: string) => {
    if (nextAfter(where).does === 'none') {
      held = null;
      void keep(null, owner);
    }
    set({ where });
  };
  const remember = (owner: string) => async (record: StockRecord) => {
    held = record;
    await keep(record, owner);
  };
  /** Runs one flow: the bundle, the keys, the run; a failure after signing reads the chain for where the coins are. */
  const run = async (flow: StockFlowName, owner: string, go: (c: Ctx, b: Book) => Promise<{ path: BuyPath | IncomePath; where: BuyWhere | IncomeWhere }>) => {
    set({ flow, failure: null, path: null, where: null, returned: false });
    try {
      ctx ??= await loadPrivate();
      const end = await go(ctx, await bookFor(ctx, owner));
      set({ path: end.path });
      settle(end.where, owner);
    } catch (error) {
      set({ failure: failureOf(error) });
      if (ctx && (await kept(owner))) await get().reread(owner);
    } finally {
      stage(null);
    }
  };
  return {
    flow: null,
    stage: null,
    since: null,
    path: null,
    where: null,
    failure: null,
    returned: false,

    buy: async (order, chain, wallet, owner, fresh) => {
      if (!privateNetwork() || get().stage) return;
      const open = openOrderOf(order, chain);
      // Another network than the private balance's is said at once: no bundle, no keys, no proof.
      if (open.chain !== PRIVATE_CHAIN) return set({ flow: 'buy', failure: null, where: null, path: { kind: 'refuse', code: 'ELSEWHERE' } });
      await run('buy', owner, (c, b) =>
        buyStockPrivately({
          ctx: c,
          book: b,
          wallet: swapSigner(wallet, owner),
          order: open,
          fresh: () => {
            const now = fresh?.();
            return now ? openOrderOf(now, chain) : null;
          },
          on: stage,
          remember: remember(owner),
        }),
      );
    },

    income: async (claim, wallet, owner) => {
      if (!privateNetwork() || get().stage) return;
      if (claim.chain !== PRIVATE_CHAIN) return set({ flow: 'income', failure: null, where: null, path: { kind: 'refuse', code: 'ELSEWHERE' } });
      await run('income', owner, (c, b) => incomeToPrivate({ ctx: c, book: b, wallet: swapSigner(wallet, owner), claim, on: stage, remember: remember(owner) }));
    },

    reread: async (owner) => {
      const record = await kept(owner);
      if (!record) return;
      try {
        ctx ??= await loadPrivate();
        set({ flow: record.flow });
        settle(await readStockWhere(ctx, record), owner);
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

    clear: () => set({ flow: null, path: null, where: null, failure: null, returned: false }),
  };
});
