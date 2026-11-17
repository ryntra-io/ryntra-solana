import { create } from 'zustand';
import { citySigner } from '../../city/lib/app-bridge/route.ts';
import { useMoneyStore } from '../../city/lib/money/store.ts';
import { useWallet } from '../../city/lib/trade/wallet.ts';
import type { WalletCleanBackResponse, WalletCleanSubmitResponse } from '../../lib/api/v1/contract.ts';
import { NO_CHOICE, choiceFor, outcomeOf, reviewFresh, toggled, type Choice, type CleanItem, type CleanRead, type CleanReview, type Outcome } from './clean-view.ts';

/**
 * «Clean the wallet»'s state on the Portfolio: the engine's read of the wallet, the person's choice over it, the clean
 * built for that choice, and where its one approval stands. The engine builds and sends (`/api/v1/wallet/clean/**`);
 * the wallet signs the whole package at once; nothing here moves money of its own.
 */

/** A read older than this is asked again as the screen opens. */
const STALE_MS = 60_000;
/** After a clean, the wallet is read again — and once more for a network that lags. */
const AFTER_MS = [1_500, 7_000] as const;

/** `empty` — the engine built nothing for this choice (no route, nothing to close): not asked again until the choice moves. */
export type CleanPhase = 'idle' | 'building' | 'ready' | 'empty' | 'signing' | 'sending' | 'done' | 'declined' | 'failed';

type Store = {
  owner: string | null;
  read: CleanRead | null;
  readAt: number;
  readState: 'none' | 'reading' | 'ready' | 'failed';
  choice: Choice;
  review: CleanReview | null;
  /** When the review arrived, by this browser's own clock. */
  reviewAt: number;
  phase: CleanPhase;
  outcome: Outcome | null;
  /** What the last relay said, kept for the result's figure. */
  sent: Readonly<{ review: CleanReview; answer: WalletCleanSubmitResponse }> | null;
};

const INITIAL = { owner: null, read: null, readAt: 0, readState: 'none', choice: NO_CHOICE, review: null, reviewAt: 0, phase: 'idle', outcome: null, sent: null } as const satisfies Store;

export const useClean = create<Store>(() => ({ ...INITIAL }));

const busy = (phase: CleanPhase) => phase === 'signing' || phase === 'sending';

async function getJson<T>(url: string, init?: RequestInit): Promise<Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; code: string }>> {
  try {
    const answer = await fetch(url, { cache: 'no-store', ...init, headers: { accept: 'application/json', 'X-Ryntra-API': '1', ...(init?.body ? { 'content-type': 'application/json' } : {}) } });
    const body = (await answer.json().catch(() => null)) as unknown;
    if (!answer.ok) return { ok: false, code: (body as { error?: { code?: string } } | null)?.error?.code ?? `HTTP_${answer.status}` };
    return { ok: true, value: body as T };
  } catch {
    return { ok: false, code: 'NETWORK' };
  }
}

/** The wallet the screen shows: a switch drops everything of the last one. */
export function followClean(owner: string | null): void {
  const now = useClean.getState();
  if (now.owner === owner) {
    if (owner && (now.readState === 'none' || (now.readState === 'ready' && Date.now() - now.readAt > STALE_MS))) void readClean();
    return;
  }
  if (busy(now.phase)) return;
  useClean.setState({ ...INITIAL, owner });
  if (owner) void readClean();
}

/** The engine's read of the wallet: what a clean takes, and the marks of every coin held. */
export async function readClean(): Promise<void> {
  const owner = useClean.getState().owner;
  if (!owner) return;
  useClean.setState((st) => ({ readState: st.read ? st.readState : 'reading' }));
  const answer = await getJson<CleanRead>(`/api/v1/wallet/clean?${new URLSearchParams({ owner })}`);
  if (useClean.getState().owner !== owner) return;
  if (!answer.ok) {
    useClean.setState((st) => ({ readState: st.read ? 'ready' : 'failed' }));
    return;
  }
  useClean.setState((st) => {
    const kept = choiceFor(answer.value, st.choice);
    // The same choice stays the same object: a clean built for it is not thrown away by a fresh read.
    const same = kept.add.length === st.choice.add.length && kept.drop.length === st.choice.drop.length;
    return { read: answer.value, readAt: Date.now(), readState: 'ready', choice: same ? st.choice : kept };
  });
}

/** One switch of the panel: the built clean is dropped and built again for the new choice. */
export function setIncluded(item: CleanItem, on: boolean): void {
  const now = useClean.getState();
  if (busy(now.phase)) return;
  useClean.setState({ choice: toggled(now.choice, item, on), review: null, phase: 'idle' });
}

/** The panel opens or the choice moves: the clean is built for it, while the person reads. */
let builds = 0;

export async function buildClean(): Promise<CleanReview | null> {
  const { owner, read, choice, phase } = useClean.getState();
  if (!owner || !read?.canClean || busy(phase)) return null;
  const mine = ++builds;
  useClean.setState({ phase: 'building', review: null });
  const answer = await getJson<CleanReview>('/api/v1/wallet/clean/review', { method: 'POST', body: JSON.stringify({ owner, ...choiceFor(read, choice) }) });
  const after = useClean.getState();
  // Only the latest build speaks: an older one that comes back late changes nothing.
  if (mine !== builds || after.phase !== 'building') return null;
  // Asked for another wallet or another choice: dropped, and built again for what stands now.
  if (after.owner !== owner || after.choice !== choice) {
    useClean.setState({ phase: 'idle' });
    return null;
  }
  if (!answer.ok) {
    useClean.setState({ phase: answer.code === 'WALLET_CLEAN_NOTHING_TO_DO' ? 'empty' : 'failed', review: null });
    return null;
  }
  useClean.setState({ phase: 'ready', review: answer.value, reviewAt: Date.now() });
  return answer.value;
}

/**
 * The one action: the built clean — built again if its bytes are near their end — signed by the wallet at once, then
 * handed to the engine, which sends each transaction once. A wallet that declines leaves everything as it was.
 */
export async function runClean(): Promise<void> {
  const connection = useWallet.getState().connection;
  const state = useClean.getState();
  if (!connection || connection.address !== state.owner || busy(state.phase)) return;
  const review = state.review && reviewFresh(state.reviewAt, Date.now()) ? state.review : await buildClean();
  if (!review) return;
  useClean.setState({ phase: 'signing' });
  const signed = await citySigner.signTransactions({ wallet: connection.wallet, address: connection.address, unsignedWireBase64: [...review.transactions], chain: 'solana:mainnet' });
  if (!signed.ok) {
    useClean.setState({ phase: 'declined', review: null });
    refollow();
    return;
  }
  useClean.setState({ phase: 'sending' });
  const answer = await getJson<WalletCleanSubmitResponse>('/api/v1/wallet/clean/submit', { method: 'POST', body: JSON.stringify({ ticket: review.ticket, signed: signed.signedWireBase64 }) });
  if (!answer.ok) {
    useClean.setState({ phase: 'failed', review: null });
    refollow();
    return;
  }
  refollow();
  useClean.setState({ phase: 'done', outcome: outcomeOf(answer.value), sent: { review, answer: answer.value }, review: null, choice: NO_CHOICE });
  // What the clean changed shows in the coins, in «Recent» and in the next read.
  useWallet.getState().refreshHoldings(AFTER_MS);
  void useMoneyStore.getState().readActivity();
  for (const ms of AFTER_MS) setTimeout(() => {
    useMoneyStore.getState().readWallet();
    void readClean();
  }, ms);
}

/** After a signature, the wallet on screen now — another one, if the person switched while the wallet was open. */
function refollow(): void {
  const owner = useWallet.getState().connection?.address ?? null;
  if (owner !== useClean.getState().owner) followClean(owner);
}

/** The panel closed: a result is forgotten, a clean under way is not touched. */
export function settleClean(): void {
  const now = useClean.getState();
  if (busy(now.phase)) return;
  useClean.setState({ phase: 'idle', review: null, outcome: null, sent: null });
}

export function cleanBusy(): boolean {
  return busy(useClean.getState().phase);
}

/**
 * The short reader for the first minute: «≈ … SOL back» from the chain alone, for a screen that has only the wallet's
 * address. Null — nothing to get back, or no answer.
 */
export async function readBack(owner: string): Promise<WalletCleanBackResponse | null> {
  const answer = await getJson<WalletCleanBackResponse>(`/api/v1/wallet/clean/back?${new URLSearchParams({ owner })}`);
  return answer.ok && answer.value.lamports > 0 ? answer.value : null;
}
