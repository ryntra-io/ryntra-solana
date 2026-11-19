'use client';

import { create } from 'zustand';
import type { BridgeChainView, BridgeTokenView } from '@/lib/relay/bridge-chains';
import type { BridgeFacts } from '@/lib/relay/bridge-quote';
import { RELAY_EVM_NATIVE_ADDRESS, RELAY_SOLANA_CHAIN_ID, RELAY_SOLANA_NATIVE_ADDRESS } from '@/lib/relay/chains';
import { bridgeQuietlyAgain, coinOf, followEvery, landingOf, originOf, readTransfers, refusedInWallet, sameCoin, settled, stateOfProgress, stateOfStatus, toRaw, withTransfer, type BridgeCoin, type QuoteState, type Transfer, type TransferState } from './bridge-form';
import { expired, notSent, reverted, runQuote, timedOut, type RunWallet } from './bridge-run';

/**
 * The Bridge page's state: the networks, the two coins, the amount and where it lands; the price Relay gives
 * for it; the transfer being carried; and the transfers of this device, followed until they settle — after a reload too
 * («незавершений переказ видно після перезавантаження»).
 */

const BASE_CHAIN_ID = 8453;
const DEFAULT_FROM: BridgeCoin = { chainId: BASE_CHAIN_ID, address: RELAY_EVM_NATIVE_ADDRESS, symbol: 'ETH', name: 'Ether', decimals: 18, verified: true, logo: true };
const DEFAULT_TO: BridgeCoin = { chainId: RELAY_SOLANA_CHAIN_ID, address: RELAY_SOLANA_NATIVE_ADDRESS, symbol: 'SOL', name: 'Solana', decimals: 9, verified: true, logo: true };
const STORE_KEY = 'ryntra.bridge.transfers';
/** A quote is asked again after the typing settles, and again while it stands on screen. */
const QUOTE_DELAY_MS = 450;
const QUOTE_FRESH_MS = 18_000;
/** The round in which unsettled transfers are asked about — each at its own pace (`followEvery`), a few per round. */
const FOLLOW_MS = 6_000;
const FOLLOW_PER_ROUND = 4;

/**
 * The transfer on the form. `draft` is the transfer before its deposit is sent: it is shown, never kept — a transfer
 * the wallet was never made to send leaves nothing in «My transfers».
 */
export type Run = Readonly<{ requestId: string; state: TransferState; error: string | null; draft: Transfer | null }>;

type BridgeState = Readonly<{
  chains: readonly BridgeChainView[] | null;
  chainsFailed: boolean;
  from: BridgeCoin;
  to: BridgeCoin;
  typed: string;
  /** An address typed for the receiving network; null lands in the person's own wallet there. */
  recipientTyped: string | null;
  quote: QuoteState;
  quotedAt: number;
  run: Run | null;
  transfers: readonly Transfer[];
  /** The price changed between the screen and the press: the new one stands, and the press is asked again. */
  moved: boolean;
}>;

export const useBridge = create<BridgeState>(() => ({
  chains: null,
  chainsFailed: false,
  from: DEFAULT_FROM,
  to: DEFAULT_TO,
  typed: '',
  recipientTyped: null,
  quote: { status: 'idle' },
  quotedAt: 0,
  run: null,
  transfers: [],
  moved: false,
}));

export const chainOf = (chains: readonly BridgeChainView[] | null, id: number) => chains?.find((chain) => chain.id === id) ?? null;

/* ── the networks and the coins ────────────────────────────────────────── */

let chainsAsked = false;
export async function loadChains(): Promise<void> {
  if (chainsAsked && useBridge.getState().chains) return;
  chainsAsked = true;
  try {
    const response = await fetch('/api/swap/bridge/chains');
    const payload = (await response.json()) as { chains?: BridgeChainView[] };
    if (!response.ok || !Array.isArray(payload.chains)) throw new Error('chains');
    useBridge.setState({ chains: payload.chains, chainsFailed: false });
  } catch {
    chainsAsked = false;
    useBridge.setState({ chainsFailed: true });
  }
}

const tokenCache = new Map<string, Promise<BridgeTokenView[]>>();
/** A network's coins: Relay's own list, or a search. Cached for the visit; a failed read is asked again next time. */
export function tokensOf(chainId: number, term: string): Promise<BridgeTokenView[]> {
  const key = `${chainId}:${term.trim().toLowerCase()}`;
  let found = tokenCache.get(key);
  if (!found) {
    found = fetch(`/api/swap/bridge/tokens?chain=${chainId}&q=${encodeURIComponent(term.trim())}`)
      .then(async (response) => {
        const payload = (await response.json()) as { tokens?: BridgeTokenView[] };
        if (!response.ok || !Array.isArray(payload.tokens)) throw new Error('tokens');
        return payload.tokens;
      })
      .catch((error: unknown) => {
        tokenCache.delete(key);
        throw error;
      });
    tokenCache.set(key, found);
  }
  return found;
}

export function pickCoin(side: 'from' | 'to', token: BridgeTokenView): void {
  const coin = coinOf(token);
  const state = useBridge.getState();
  const other = side === 'from' ? state.to : state.from;
  // The same coin on both sides puts the two in each other's place.
  if (sameCoin(coin, other)) return turn();
  const otherChainChanged = side === 'to' ? coin.chainId !== state.to.chainId : false;
  useBridge.setState({ [side]: coin, quote: { status: 'idle' }, moved: false, ...(otherChainChanged ? { recipientTyped: null } : {}) } as Partial<BridgeState>);
}

export function turn(): void {
  const { from, to } = useBridge.getState();
  useBridge.setState({ from: to, to: from, typed: '', recipientTyped: null, quote: { status: 'idle' }, moved: false });
}

export function setTyped(typed: string): void {
  useBridge.setState({ typed, moved: false });
}

/**
 * Where the money lands: another address typed, or the person's own wallet again. The price on screen stays while the
 * address is typed: it is asked again by the form only once a whole address changes who receives, and
 * a press always asks a fresh one (`move`).
 */
export function setRecipient(address: string | null): void {
  useBridge.setState({ recipientTyped: address, moved: false });
}

/* ── the price ─────────────────────────────────────────────────────────── */

export type Parties = Readonly<{ user: string | null; recipient: string | null; deposit: boolean }>;

let quoteTimer: ReturnType<typeof setTimeout> | null = null;
let quoteSeq = 0;

function keyOf(from: BridgeCoin, to: BridgeCoin, amountRaw: string, parties: Parties): string {
  return [from.chainId, from.address, to.chainId, to.address, amountRaw, parties.user ?? '-', parties.recipient ?? '-', parties.deposit ? 'd' : 'w'].join('|');
}

async function ask(from: BridgeCoin, to: BridgeCoin, amountRaw: string, parties: Parties, preview: boolean): Promise<QuoteState> {
  const key = keyOf(from, to, amountRaw, parties);
  try {
    const response = await fetch('/api/swap/bridge/quote', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ from: { chain: from.chainId, token: from.address }, to: { chain: to.chainId, token: to.address }, amount: amountRaw, user: parties.deposit ? null : parties.user, recipient: parties.recipient, preview }),
      // The route waits for Relay at most 12 s (`maxDuration` 20): an answer later than this is not coming.
      signal: AbortSignal.timeout(20_000),
    });
    const payload = (await response.json().catch(() => null)) as { facts?: BridgeFacts; quote?: unknown; preview?: boolean; error?: { code?: string } } | null;
    if (!response.ok || !payload?.facts) return { status: 'failed', key, code: payload?.error?.code ?? (response.status === 429 ? 'RATE_LIMITED' : 'UNAVAILABLE') };
    return { status: 'ready', key, facts: payload.facts, preview: payload.preview === true, quote: payload.quote ?? null };
  } catch (error) {
    // A slow answer already took twenty seconds: it is said, never asked again.
    return { status: 'failed', key, code: error instanceof DOMException && error.name === 'TimeoutError' ? 'TIMEOUT' : 'UNAVAILABLE' };
  }
}

/** A price refused only for the moment — Relay's window, a slow or lost answer — is asked again this long apart. */
export const BRIDGE_QUIET_RETRY_MS: readonly number[] = [1_000];

/** The price, asked again quietly while it is refused only for the moment; `live` says whether it is still wanted. */
async function askQuietly(from: BridgeCoin, to: BridgeCoin, amountRaw: string, parties: Parties, preview: boolean, live: () => boolean): Promise<QuoteState | null> {
  let answer = await ask(from, to, amountRaw, parties, preview);
  for (const wait of BRIDGE_QUIET_RETRY_MS) {
    if (answer.status !== 'failed' || !bridgeQuietlyAgain(answer.code)) break;
    await new Promise((resolve) => setTimeout(resolve, wait + Math.round(Math.random() * 400)));
    if (!live()) return null;
    answer = await ask(from, to, amountRaw, parties, preview);
  }
  return live() ? answer : null;
}

/**
 * Asks for the price of what is on the form, once the typing settles. A deposit-address network is priced as a preview
 * only: its address is opened when the person presses for it, not on every keystroke.
 */
export function requestQuote(parties: Parties, now = false): void {
  const { from, to, typed } = useBridge.getState();
  const amountRaw = toRaw(typed, from.decimals);
  if (quoteTimer) clearTimeout(quoteTimer);
  if (!amountRaw) {
    // A price still being asked, quietly or not, is for a form that is gone.
    quoteSeq += 1;
    useBridge.setState({ quote: { status: 'idle' } });
    return;
  }
  const preview = parties.deposit || parties.user === null || parties.recipient === null;
  const key = keyOf(from, to, amountRaw, parties);
  const current = useBridge.getState().quote;
  if (!now && current.status !== 'idle' && 'key' in current && current.key === key && Date.now() - useBridge.getState().quotedAt < QUOTE_FRESH_MS) return;
  if (current.status !== 'ready' || current.key !== key) useBridge.setState({ quote: { status: 'loading', key } });
  const seq = ++quoteSeq;
  quoteTimer = setTimeout(
    async () => {
      const answer = await askQuietly(from, to, amountRaw, parties, preview, () => seq === quoteSeq);
      if (!answer || seq !== quoteSeq) return;
      useBridge.setState({ quote: answer, quotedAt: Date.now() });
    },
    now ? 0 : QUOTE_DELAY_MS,
  );
}

/* ── the transfers of this device ──────────────────────────────────────── */

export function loadTransfers(): void {
  try {
    useBridge.setState({ transfers: readTransfers(JSON.parse(window.localStorage.getItem(STORE_KEY) ?? '[]')) });
  } catch {
    useBridge.setState({ transfers: [] });
  }
}

function keep(transfer: Transfer): void {
  const transfers = withTransfer(useBridge.getState().transfers, transfer);
  useBridge.setState({ transfers });
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(transfers));
  } catch {
    // A browser that keeps nothing still shows the transfer while the page is open.
  }
}

function update(requestId: string, change: Partial<Transfer>): void {
  const current = useBridge.getState().transfers.find((entry) => entry.requestId === requestId);
  if (current) keep({ ...current, ...change });
}

const asked = new Map<string, number>();
/** The transfers asked one last time, a day old. */
const finals = new Set<string>();

/**
 * Asks Relay where the unsettled transfers of this device are, except the one the SDK is carrying right now — each at
 * the pace its age deserves, a few per round, so following never eats the page's quotes.
 */
export async function followTransfers(now = Date.now()): Promise<void> {
  const { transfers, run } = useBridge.getState();
  const carried = run && run.state !== 'slow' && !settled(run.state) ? run.requestId : '';
  const open = transfers.filter((entry) => !settled(entry.state) && entry.requestId !== carried);
  // Due at its pace; a day old, asked one last time. The least recently asked first, so no transfer waits on fresher ones.
  const due = open
    .filter((entry) => {
      const pace = followEvery(now - entry.at);
      return now - (asked.get(entry.requestId) ?? 0) >= (pace ?? 0) && !(pace === null && finals.has(entry.requestId));
    })
    .sort((a, b) => (asked.get(a.requestId) ?? 0) - (asked.get(b.requestId) ?? 0))
    .slice(0, FOLLOW_PER_ROUND);
  await Promise.all(
    due.map(async (entry) => {
      asked.set(entry.requestId, now);
      const last = followEvery(now - entry.at) === null;
      if (last) finals.add(entry.requestId);
      try {
        const response = await fetch(`/api/swap/bridge/relay/intents/status/v3?requestId=${entry.requestId}`);
        if (!response.ok) {
          if (last) update(entry.requestId, { state: 'unconfirmed' });
          return;
        }
        const status = (await response.json()) as { status?: string; inTxHashes?: string[] | null; txHashes?: string[] | null };
        // Paid only on Relay's own word: a deposit it has seen. A hash the page holds may be a deposit that reverted.
        const paid = (status.inTxHashes?.length ?? 0) > 0;
        let state = stateOfStatus(status.status, paid);
        // A deposit the wallet sent and Relay has not indexed yet stays where it is.
        if (state === 'waiting' && entry.originTx) state = null;
        // A day without Relay naming a deposit: no longer followed, never left «on its way».
        if (last && (state === null || !settled(state))) state = 'unconfirmed';
        const landed = status.txHashes?.[0];
        const sent = status.inTxHashes?.[0];
        const change: { -readonly [K in keyof Transfer]?: Transfer[K] } = {};
        if (state && state !== entry.state) change.state = state;
        if (!entry.originTx && sent) change.originTx = [entry.from.chainId, sent];
        // Relay's own word on where it landed wins over anything read before.
        if (landed && (state === 'done' || state === 'refunded')) change.destinationTx = [state === 'refunded' ? entry.from.chainId : entry.to.chainId, landed];
        if (Object.keys(change).length) update(entry.requestId, change);
        const live = useBridge.getState().run;
        if (live?.requestId === entry.requestId && change.state) useBridge.setState({ run: { ...live, state: change.state } });
      } catch {
        // Asked again on a later round — or, a day old, let go: never left «on its way».
        if (last) update(entry.requestId, { state: 'unconfirmed' });
      }
    }),
  );
}

let followTimer: ReturnType<typeof setInterval> | null = null;
export function startFollowing(): () => void {
  if (!followTimer) {
    void followTransfers();
    followTimer = setInterval(() => {
      if (document.visibilityState === 'visible') void followTransfers();
    }, FOLLOW_MS);
  }
  return () => {
    if (followTimer) clearInterval(followTimer);
    followTimer = null;
  };
}

/* ── carrying one transfer ─────────────────────────────────────────────── */

function transferOf(facts: BridgeFacts, from: BridgeCoin, to: BridgeCoin, state: TransferState): Transfer | null {
  if (!facts.requestId) return null;
  return {
    requestId: facts.requestId,
    at: Date.now(),
    state,
    from: { chainId: from.chainId, symbol: facts.send.symbol, amountRaw: facts.send.amountRaw, decimals: facts.send.decimals, address: from.address, logo: from.logo },
    to: { chainId: to.chainId, symbol: facts.get.symbol, amountRaw: facts.get.expectedRaw, decimals: facts.get.decimals, address: to.address, logo: to.logo },
    originTx: null,
    destinationTx: null,
    depositAddress: facts.depositAddress,
  };
}

/** How far the guaranteed minimum may fall between the screen and the press before the person is asked again: 0.5 %. */
const MOVED_PER_MILLE = 995n;

/**
 * Presses «move»: a fresh quote for exactly what is on the form — if its minimum fell from the one on screen, the new
 * price stands and the press is asked again — then the SDK carries it in the wallet. The transfer is kept in «My
 * transfers» from the moment its deposit is sent; the form stays on it until it settles or the person starts a new one.
 */
export async function move(parties: Parties, wallet: RunWallet | null): Promise<void> {
  const { from, to, typed, quote: shown } = useBridge.getState();
  const amountRaw = toRaw(typed, from.decimals);
  if (!amountRaw || !parties.recipient || (!parties.deposit && !parties.user)) return;
  const shownMinimum = shown.status === 'ready' && !shown.preview ? BigInt(shown.facts.get.minimumRaw) : null;
  useBridge.setState({ run: { requestId: '', state: 'sign', error: null, draft: null }, moved: false });
  const fresh = await ask(from, to, amountRaw, parties, false);
  if (fresh.status !== 'ready' || !fresh.facts.requestId || (!parties.deposit && !fresh.quote)) {
    useBridge.setState({ run: null, quote: fresh.status === 'ready' ? { status: 'failed', key: fresh.key, code: 'UNAVAILABLE' } : fresh, quotedAt: Date.now() });
    return;
  }
  useBridge.setState({ quote: fresh, quotedAt: Date.now() });
  if (shownMinimum !== null && BigInt(fresh.facts.get.minimumRaw) * 1000n < shownMinimum * MOVED_PER_MILLE) {
    useBridge.setState({ run: null, moved: true });
    return;
  }
  const facts = fresh.facts;
  const requestId = facts.requestId!;
  const draft = transferOf(facts, from, to, parties.deposit ? 'waiting' : 'sign');
  if (!draft) return;

  if (parties.deposit) {
    keep(draft);
    useBridge.setState({ run: { requestId, state: 'waiting', error: null, draft: null } });
    return;
  }
  if (!wallet) return;
  useBridge.setState({ run: { requestId, state: 'sign', error: null, draft } });
  let last: Record<string, unknown> | null = null;
  // The transfer as kept, or as drafted while nothing has left the wallet.
  const current = () => useBridge.getState().transfers.find((entry) => entry.requestId === requestId) ?? null;
  const set = (state: TransferState, change: Partial<Transfer> = {}, error: string | null = null) => {
    const kept = current();
    if (kept) update(requestId, { state, ...change });
    else if (change.originTx) keep({ ...draft, state, ...change });
    const run = useBridge.getState().run;
    // A transfer the person stepped away from goes on in «My transfers» without taking the form back.
    if (run?.requestId === requestId) useBridge.setState({ run: { ...run, state, error, draft: { ...(kept ?? run.draft ?? draft), state, ...change } } });
  };
  try {
    await runQuote(
      fresh.quote,
      wallet,
      (progress) => {
        last = progress;
        const origin = originOf(progress, from.chainId);
        const landing = landingOf(progress, to.chainId);
        set(stateOfProgress(progress), { ...(origin ? { originTx: origin } : {}), ...(landing ? { destinationTx: landing } : {}) });
      },
      // A Solana order is kept the moment the wallet signs it: its id is known before it is sent.
      (signature) => set('sent', { originTx: [from.chainId, signature] }),
    );
    // Landed — or, to a network the SDK stops following at «submitted», still on its way: the page follows it.
    set(last && stateOfProgress(last) === 'done' ? 'done' : 'bridging');
  } catch (error) {
    const state = current()?.state ?? useBridge.getState().run?.state;
    if (state && settled(state)) return;
    // Refused before the network, though already signed: nothing was sent, and the signature it was kept by leads nowhere.
    if (notSent(error) || expired(error)) return set('expired', { originTx: null });
    const sent = Boolean(current()?.originTx);
    // The deposit failed on its own network: the money stayed, the network kept its fee — said exactly, not «on its way».
    // A «revert» before anything was sent (the wallet's own estimate) is not that: nothing was spent at all.
    if (sent && reverted(error)) return set('reverted');
    if (!sent && refusedInWallet(error)) return set('cancelled');
    // Sent, or the SDK stopped following: the order may still land — the page keeps asking Relay.
    if (sent || timedOut(error)) return set('slow');
    set('failed', {}, error instanceof Error ? error.message : String(error));
  }
}

/** Leaves the transfer on screen for a new one; a kept transfer stays in «My transfers» and is still followed. */
export function newTransfer(): void {
  useBridge.setState({ run: null, typed: '', quote: { status: 'idle' }, moved: false });
}

/** Reopens a transfer of this device on the form (a deposit address still waiting, or one still crossing). */
export function openTransfer(requestId: string): void {
  const entry = useBridge.getState().transfers.find((transfer) => transfer.requestId === requestId);
  if (entry) useBridge.setState({ run: { requestId, state: entry.state, error: null, draft: null } });
}
