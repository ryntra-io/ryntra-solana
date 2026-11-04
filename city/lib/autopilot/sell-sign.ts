import { citySigner } from '../app-bridge/route.ts';
import { post, signAndRelay, type Fetcher, type SignMany, type Who } from '../bots/mandate-sign.ts';
import type { MandateRecord } from '../bots/mandate.ts';
import { readAgentView, useAutopilot } from './store.ts';
import { QUOTE_FRESH_MS, isSaleReceipt, readSaleQuote, useSell, type SaleReceipt, type SellNote } from './sell.ts';

/**
 * The press of «Sell» in the tower's window (CITY-187) — loaded on the press. A fresh review when the one on screen is
 * old, the check of her transaction and the wallet's one prompt (the mandate's own, `../bots/mandate-sign.ts`), the relay;
 * then the agent sells and the window keeps its receipt. «Take it back» is one more signature of hers, the same way.
 */

type Deps = Readonly<{ fetch?: Fetcher; sign?: SignMany; now?: () => number; wait?: (ms: number) => Promise<void> }>;

const noteOf = (kind: 'walletNo' | 'refused' | 'unreachable'): SellNote => kind;
const pause = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

/** What the agent holds is read again once a sale moved it. */
async function refreshAgent(buy: MandateRecord, fetcher: Fetcher): Promise<void> {
  const view = await readAgentView(buy, fetcher);
  if (view) useAutopilot.getState().setView(buy.policy, view);
}

/** «Sell»: the share on screen, one signature, the agent's sale and its receipt. */
export async function tapSell(who: Who, buy: MandateRecord, deps: Deps = {}): Promise<SaleReceipt | null> {
  const fetcher = deps.fetch ?? ((url: string, init?: RequestInit) => fetch(url, init));
  const sign = deps.sign ?? citySigner.signTransactions;
  const now = deps.now ?? Date.now;
  const st = useSell.getState();
  if (st.phase !== 'idle') return null;
  let quote = st.quote;
  if (!quote || quote.share !== st.share || now() - quote.at > QUOTE_FRESH_MS) {
    st.set({ phase: 'pricing', note: null });
    const fresh = await readSaleQuote({ owner: who.owner, policy: buy.policy }, st.share, fetcher, now);
    if (!fresh || 'refused' in fresh) {
      useSell.getState().set({ phase: 'idle', quote: null, note: fresh ? (fresh.code === 'NOTHING' || fresh.code === 'TOO_SMALL' ? 'nothing' : 'refused') : 'unreachable' });
      return null;
    }
    quote = fresh;
  }
  useSell.getState().set({ phase: 'signing', quote, note: null });
  const failed = await signAndRelay(who, quote.transactions, { fetch: fetcher, sign });
  if (failed) {
    useSell.getState().set({ phase: 'idle', quote: null, note: noteOf(failed.kind === 'walletNo' || failed.kind === 'refused' ? failed.kind : 'unreachable') });
    return null;
  }
  useSell.getState().set({ phase: 'selling' });
  let receipt: SaleReceipt = { policy: quote.record.policy, status: 'signed', signature: null, soldRaw: quote.figures.amountRaw, receivedRaw: null, reason: null };
  /* The relay waited for the chain; one more read covers a node a block behind. */
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const gone = await post<unknown>(fetcher, '/api/bots/mandate/sell/go', { owner: who.owner, policy: quote.record.policy });
    if (gone.ok && isSaleReceipt(gone.value)) {
      receipt = gone.value;
      break;
    }
    if (gone.ok || gone.status !== 409) break;
    await (deps.wait ?? pause)(2_000);
  }
  useSell.getState().set({ phase: 'done', quote: null, receipt });
  await refreshAgent(buy, fetcher);
  return receipt;
}

/** «Take it back»: a sale that did not go — the mandate removed and the coin home, one signature. */
export async function tapBack(who: Who, buy: MandateRecord, deps: Deps = {}): Promise<boolean> {
  const fetcher = deps.fetch ?? ((url: string, init?: RequestInit) => fetch(url, init));
  const sign = deps.sign ?? citySigner.signTransactions;
  const st = useSell.getState();
  const receipt = st.receipt;
  if (!receipt || st.phase !== 'done') return false;
  st.set({ phase: 'backing', note: null });
  const built = await post<{ transactions: string[] }>(fetcher, '/api/bots/mandate/sell/back', { owner: who.owner, policy: receipt.policy });
  const failed = built.ok ? await signAndRelay(who, built.value.transactions, { fetch: fetcher, sign }) : { kind: built.status === 0 || built.status >= 500 ? ('unreachable' as const) : ('refused' as const) };
  if (failed) {
    useSell.getState().set({ phase: 'done', note: noteOf(failed.kind === 'walletNo' || failed.kind === 'refused' ? failed.kind : 'unreachable') });
    return false;
  }
  useSell.getState().set({ phase: 'idle', receipt: null, note: 'returned' });
  await refreshAgent(buy, fetcher);
  return true;
}
