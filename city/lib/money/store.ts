import { create } from 'zustand';
import type { DepositAddress, DepositNetwork, DepositProgress } from '../../../lib/relay/deposit-address.ts';
import { checkReturnedBytes } from '../../../lib/solana/fingerprint.client.ts';
import { readWalletHoldingsUntilComplete } from '../../../lib/solana/holdings.client.ts';
import { fetchReceiptForAction } from '../../../lib/solana/receipt-fetch.client.ts';
import { findReceiptForAction, receiptBinding, type StoredReceiptView } from '../../../lib/solana/receipt-view.ts';
import { forgetPendingSend, readPendingSend, rememberPendingSend } from '../../../lib/solana/send-pending.client.ts';
import { readSolanaReceipts, storeBoundSolanaReceipt, storeSolanaReceipt } from '../../../lib/solana/send-receipt-vault.client.ts';
import { recentSendRecipients, rememberSendRecipient } from '../../../lib/solana/send-recipients.client.ts';
import { resolveSkrName, type SkrResolve } from '../../../lib/solana/skr.client.ts';
import type { SolanaWalletAction } from '../../../lib/solana/action-ledger.ts';
import { SOLANA_USDC_MINT } from '../../../lib/swap/catalog.ts';
import type { CrossSwapQuote } from '../../../lib/swap/cross-swap-quote.ts';
import { citySigner } from '../app-bridge/route.ts';
import { wordsNow } from '../i18n/dict.ts';
import { useWallet } from '../trade/wallet.ts';
import { readActivity, type ActivityRead } from './activity.ts';
import { readAmount } from './amount.ts';
import { assetsOf, NATIVE_ID, sendable, type WalletRead } from './assets.ts';
import {
  bridgeEditable,
  bridgeRefusalWords,
  bridgeRoute,
  browserRuns,
  confirmBridge,
  orderPhase,
  planBridge,
  quoteBridge,
  readBridgeReceipt,
  readDestination,
  readOrder,
  type BridgePlan,
  type OrderView,
  type QuoteBody,
  type RunStore,
} from './bridge.ts';
import { keepAddress, keptAddress, readDepositAddress, readDepositProgress } from './deposit.ts';
import { ask, browserFetch, V1, type FetchLike } from './engine.ts';
import { MONEY_OPEN } from './flag.ts';
import { useMoney } from './open.ts';
import { chosenAsset, EMPTY_SEND, recipientAddress, sendGate, type Line, type SendState } from './form.ts';
import { parseRecipientCheck, readRecipient, riskOf } from './recipient.ts';
import { BRIDGE_WORDS, STORE_WORDS } from './words.ts';
import { blockedLine, confirmSend, resumeSend, reviewSend, signable, type SendDeps, type SendIntent, type SignResult } from './send.ts';

export type { Line, SendState } from './form.ts';

/**
 * The Money window's state: the wallet as the engine reads it, and the three things the window does — a transfer on
 * Send, a move out on Bridge, an address on Top up — each held here so switching tabs never loses one mid-way. Every
 * figure is the engine's; the store only holds what was asked and what came back, and opens the wallet only for bytes
 * the engine built and the person reviewed.
 */

export type BridgeState = Readonly<{
  network: DepositNetwork;
  to: string;
  amount: string;
  quote: Readonly<{ key: string; body: QuoteBody; at: number }> | null;
  plan: Readonly<{ key: string; plan: BridgePlan }> | null;
  phase: 'idle' | 'quoting' | 'planning' | 'wallet' | 'sending' | 'tracking';
  line: Line | null;
  order: OrderView | null;
  receipt: Record<string, unknown> | null;
}>;

export type DepositState = Readonly<{
  network: DepositNetwork | null;
  address: DepositAddress | null;
  status: 'idle' | 'loading' | 'failed';
  progress: Readonly<{ progress: DepositProgress; amount: string | null }> | null;
  /** When the address went on screen: only deposits since then (less half an hour) are asked about. */
  since: number;
}>;

/** A receipt open in the window: the action's row and the receipt the engine issued for it. */
export type ShownReceipt = Readonly<{ actionId: string; receipt: Readonly<Record<string, unknown>> }>;

export type ActivityState = Readonly<{
  read: ActivityRead | null;
  status: 'none' | 'reading' | 'ready' | 'failed';
  opening: string | null;
  line: Line | null;
  /** The receipt open over the rows (CITY-150): a WebView downloads nothing, so it is shown, not saved. */
  shown: ShownReceipt | null;
}>;

export type MoneyEnv = Readonly<{
  fetch: FetchLike;
  sign: (connection: Readonly<{ wallet: string; address: string }>, wire: string) => Promise<SignResult>;
  checkReturned: SendDeps['checkReturned'];
  resolveName: (name: string) => Promise<SkrResolve>;
  storage: () => Storage | null;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  runs: RunStore;
  /** The city's own wallet balances, read again after money moved. */
  refreshCity: () => void;
  connection: () => Readonly<{ wallet: string; address: string }> | null;
  open: boolean;
}>;

const local = (): Storage | null => {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

let env: MoneyEnv = {
  fetch: browserFetch,
  sign: (connection, wire) => citySigner.signTransaction({ wallet: connection.wallet, address: connection.address, unsignedWireBase64: wire, chain: 'solana:mainnet' }),
  checkReturned: (plan, signed) => checkReturnedBytes({ plan, signedWireBase64: signed }),
  resolveName: (name) => resolveSkrName(name),
  storage: local,
  now: () => Date.now(),
  sleep,
  runs: browserRuns(local),
  refreshCity: () => useWallet.getState().refreshHoldings([1_500, 7_000]),
  connection: () => useWallet.getState().connection,
  open: MONEY_OPEN,
};

/** Swap what the window reaches: for tests, and nothing else. */
export function setMoneyEnv(next: Partial<MoneyEnv>): void {
  env = { ...env, ...next };
}

/** A typed amount is read once the person stops typing for this long; so is «To». */
export const TYPING_MS = 400;
const AFTER_MOVE_MS = [1_500, 7_000];
const ORDER_POLL_MS = 4_000;

const EMPTY_BRIDGE: BridgeState = { network: 'base', to: '', amount: '', quote: null, plan: null, phase: 'idle', line: null, order: null, receipt: null };
const EMPTY_DEPOSIT: DepositState = { network: null, address: null, status: 'idle', progress: null, since: 0 };
const EMPTY_ACTIVITY: ActivityState = { read: null, status: 'none', opening: null, line: null, shown: null };

type MoneyStore = {
  owner: string | null;
  wallet: WalletRead | null;
  walletRead: 'none' | 'reading' | 'ready' | 'failed';
  send: SendState;
  bridge: BridgeState;
  deposit: DepositState;
  activity: ActivityState;

  /** A wallet connected, changed or left: everything of the last one goes. */
  follow: (owner: string | null) => void;
  readWallet: () => void;

  setSendAsset: (id: string) => void;
  setTo: (to: string) => void;
  setAmount: (amount: string) => void;
  acceptLookalike: () => void;
  acceptFresh: () => void;
  reviewSend: () => Promise<void>;
  confirmSend: () => Promise<void>;
  newSend: () => void;
  resumeSend: () => void;

  setBridgeNetwork: (network: DepositNetwork) => void;
  setBridgeTo: (to: string) => void;
  setBridgeAmount: (amount: string) => void;
  quoteBridge: () => Promise<void>;
  reviewBridge: () => Promise<void>;
  confirmBridge: () => Promise<void>;
  followOrder: () => Promise<void>;
  newBridge: () => void;

  pickDeposit: (network: DepositNetwork) => Promise<void>;
  readDepositProgress: () => Promise<void>;

  readActivity: () => Promise<void>;
  /** Opens an action's receipt in the window: the copy this browser keeps, or the one the engine issues again. */
  openReceipt: (action: SolanaWalletAction) => Promise<void>;
  closeReceipt: () => void;
};

let tickets = { wallet: 0, to: 0, quote: 0, deposit: 0, activity: 0, resume: 0 };
let toTimer: ReturnType<typeof setTimeout> | null = null;
let quoteTimer: ReturnType<typeof setTimeout> | null = null;
/** The order being followed now, so a second follower never starts. */
let following: string | null = null;

function bump(key: keyof typeof tickets): number {
  tickets = { ...tickets, [key]: tickets[key] + 1 };
  return tickets[key];
}

/** The wallet's USDC on Solana: what Bridge moves out. */
export function bridgeUsdc(wallet: WalletRead | null) {
  return wallet?.assets.find((asset) => asset.mint === SOLANA_USDC_MINT) ?? null;
}

function checkKey(owner: string, assetId: string, target: string): string {
  return `${owner}|${assetId}|${target}`;
}

export const useMoneyStore = create<MoneyStore>((set, get) => {
  const patchSend = (patch: Partial<SendState>) => set((st) => ({ send: { ...st.send, ...patch } }));
  const patchBridge = (patch: Partial<BridgeState>) => set((st) => ({ bridge: { ...st.bridge, ...patch } }));
  // From the moment a confirmed transfer is being built again, the wallet is about to open: the window stays.
  const busy = () => {
    const { send, bridge } = get();
    useMoney.getState().setBusy(send.phase === 'preparing' || send.phase === 'wallet' || send.phase === 'sending' || bridge.phase === 'wallet' || bridge.phase === 'sending');
  };

  const sendDeps = (owner: string): SendDeps => ({
    fetch: env.fetch,
    sign: (wire) => {
      const connection = env.connection();
      if (!connection || connection.address !== owner) return Promise.resolve({ ok: false, reason: 'The wallet changed. Nothing was signed.' });
      return env.sign(connection, wire);
    },
    checkReturned: env.checkReturned,
    resolveName: env.resolveName,
    pending: {
      remember: (pending) => void rememberPendingSend(env.storage() ?? memory, pending),
      forget: (wallet) => void forgetPendingSend(env.storage() ?? memory, wallet),
    },
    keepReceipt: (wallet, receipt) => void storeSolanaReceipt(env.storage() ?? memory, wallet, receipt),
    rememberRecipient: (wallet, recipient) => {
      const storage = env.storage();
      if (storage) patchSend({ recents: rememberSendRecipient(storage, wallet, recipient) });
    },
    now: env.now,
    onPhase: (phase) => {
      patchSend({ phase });
      busy();
    },
  });

  /** The form's one decision, climbed again here: a stale render never opens a Review or a wallet. */
  const gateNow = () => {
    const { owner, wallet, walletRead, send } = get();
    const connection = env.connection();
    return sendGate({ connected: !!connection && connection.address === owner, owner, wallet, walletRead, send }).action;
  };

  /** The intent on the form now, or null with the reason it is not one yet. */
  const intentNow = (): SendIntent | null => {
    const { owner, wallet, send } = get();
    const connection = env.connection();
    if (!owner || !connection || connection.address !== owner) return null;
    const asset = chosenAsset(wallet, send.assetId);
    if (!asset) return null;
    const read = readRecipient(send.to, owner);
    const recipient = recipientAddress(send, read);
    if (!recipient || recipient === owner) return null;
    const amount = readAmount(send.amount, { spendableRaw: asset.spendableRaw, decimals: asset.decimals, symbol: asset.symbol });
    if (!amount.ok) return null;
    return {
      wallet: connection.wallet,
      sender: owner,
      asset: { native: asset.native, mint: asset.mint, decimals: asset.decimals, symbol: asset.symbol },
      recipient,
      amountRaw: amount.raw,
      name: read.kind === 'name' ? read.name : null,
    };
  };

  /** The security source's word on an address the money would go to — read beside the check, never in its way. */
  const readRisk = async (address: string, ticket: number) => {
    if (get().send.risk?.address === address) return;
    const answer = await ask<unknown>(env.fetch, `/api/v1/research/address-evidence?address=${encodeURIComponent(address)}`, { headers: V1 });
    if (ticket !== tickets.to) return;
    patchSend({ risk: { address, summary: answer.ok ? riskOf(answer.value) : 'unavailable' } });
  };

  /** «To» read the engine's way once the person stops typing: a name resolved, a recipient checked. */
  const readTo = async () => {
    const ticket = bump('to');
    const { owner, send } = get();
    const read = readRecipient(send.to, owner);
    let target: string | null = null;
    if (read.kind === 'name') {
      patchSend({ name: { state: 'RESOLVING', name: read.name } });
      const answer = await env.resolveName(read.name).catch((): SkrResolve => ({ state: 'UNAVAILABLE', name: read.name }));
      if (ticket !== tickets.to) return;
      patchSend({ name: answer });
      if (answer.state === 'FOUND') target = answer.address;
    } else {
      patchSend({ name: null });
      if (read.kind === 'address') target = read.address;
      if (read.kind === 'request') target = read.text;
    }
    if (target && read.kind !== 'request' && target !== owner) void readRisk(target, ticket);
    if (!target || !owner || !send.assetId) return;
    const asset = chosenAsset(get().wallet, send.assetId);
    const key = checkKey(owner, send.assetId, target);
    patchSend({ check: { key, status: 'checking', result: null } });
    const query = new URLSearchParams({ to: target, from: owner, ...(asset?.mint ? { mint: asset.mint } : {}) });
    const answer = await ask<unknown>(env.fetch, `/api/v1/money/recipient?${query}`, { headers: V1 });
    if (ticket !== tickets.to) return;
    const result = answer.ok ? parseRecipientCheck(answer.value) : null;
    patchSend({ check: { key, status: result ? 'done' : 'unread', result } });
    if (read.kind === 'request' && result?.next === 'transfer' && result.address && result.address !== owner) void readRisk(result.address, ticket);
    // A scanned request that names an amount fills an empty field; the person still reads and taps.
    if (result?.next === 'transfer' && result.askedAmount && get().send.amount === '') patchSend({ amount: result.askedAmount });
  };

  const scheduleTo = () => {
    if (toTimer) clearTimeout(toTimer);
    bump('to');
    toTimer = setTimeout(() => void readTo(), TYPING_MS);
  };

  /** Any edit drops the Review: what the wallet would sign must be what is on the form. */
  const editSend = (patch: Partial<SendState>) => patchSend({ ...patch, review: null, line: null, settled: patch.settled ?? null });

  const bridgeKey = (): string | null => {
    const { owner, wallet, bridge } = get();
    const usdc = bridgeUsdc(wallet);
    const destination = readDestination(bridge.to);
    const amount = readAmount(bridge.amount, usdc ? { spendableRaw: usdc.spendableRaw, decimals: usdc.decimals, symbol: 'USDC' } : null);
    if (!owner || !destination.ok || !amount.ok) return null;
    return `${owner}|${bridge.network}|${destination.address}|${amount.raw}`;
  };

  const bridgeAsk = (key: string) => {
    const [owner, network, destination, amountRaw] = key.split('|');
    const route = bridgeRoute(network as DepositNetwork);
    return route ? { route, owner, destination, amountRaw } : null;
  };

  // A price being asked for never holds the keyboard: the edit drops it, and the fresh figures are asked for next.
  const editBridge = (patch: Partial<BridgeState>) => {
    patchBridge({ ...patch, plan: null, line: null, phase: 'idle' });
    if (quoteTimer) clearTimeout(quoteTimer);
    bump('quote');
    if (bridgeKey()) quoteTimer = setTimeout(() => void get().quoteBridge(), 700);
    else patchBridge({ quote: null });
  };

  /** One order followed until it ends, while the window is open; reopening the window follows it again. */
  const follow = async (intentDigest: string, owner: string) => {
    if (get().bridge.phase !== 'tracking') patchBridge({ phase: 'tracking' });
    for (;;) {
      const order = await readOrder(env.fetch, intentDigest);
      if (get().owner !== owner || env.runs.read()?.intentDigest !== intentDigest) return;
      if (order) {
        patchBridge({ order });
        const phase = orderPhase(order.state);
        if (phase === 'done' || phase === 'refunded' || phase === 'failed') {
          env.runs.clear();
          patchBridge({ phase: 'idle' });
          const receipt = await readBridgeReceipt(env.fetch, intentDigest);
          if (receipt && get().owner === owner) {
            patchBridge({ receipt });
            storeBoundSolanaReceipt(env.storage() ?? memory, receiptBinding(receipt as never)?.wallet ?? owner, owner, receipt);
          }
          get().readWallet();
          env.refreshCity();
          return;
        }
      }
      if (!useMoney.getState().open) return;
      await env.sleep(ORDER_POLL_MS);
    }
  };

  return {
    owner: null,
    wallet: null,
    walletRead: 'none',
    send: EMPTY_SEND,
    bridge: EMPTY_BRIDGE,
    deposit: EMPTY_DEPOSIT,
    activity: EMPTY_ACTIVITY,

    follow: (owner) => {
      if (owner === get().owner) return;
      for (const key of Object.keys(tickets) as (keyof typeof tickets)[]) bump(key);
      const storage = env.storage();
      set({
        owner,
        wallet: null,
        walletRead: 'none',
        send: { ...EMPTY_SEND, recents: owner && storage ? recentSendRecipients(storage, owner) : [], recentsRead: Boolean(owner && storage) },
        bridge: EMPTY_BRIDGE,
        deposit: EMPTY_DEPOSIT,
        activity: EMPTY_ACTIVITY,
      });
      useMoney.getState().setBusy(false);
      if (!owner) return;
      get().readWallet();
      if (env.open) {
        get().resumeSend();
        if (env.runs.read()) void get().followOrder();
      }
    },

    readWallet: () => {
      const owner = get().owner;
      if (!owner) return;
      const ticket = bump('wallet');
      if (!get().wallet) set({ walletRead: 'reading' });
      void readWalletHoldingsUntilComplete<unknown>({
        owner,
        onRead: (answer) => {
          if (ticket !== tickets.wallet || get().owner !== owner) return;
          if (!answer.ok) {
            if (!get().wallet) set({ walletRead: 'failed' });
            return;
          }
          const assets = assetsOf(answer.rows);
          set({ wallet: { owner, assets, complete: answer.tokenRead === 'COMPLETE', at: env.now() }, walletRead: 'ready' });
          // The coin last chosen while it is still held; else USDC, else SOL.
          const send = get().send;
          if (!assets.some((asset) => asset.id === send.assetId)) {
            const list = sendable(assets);
            const usdc = list.find((asset) => asset.symbol === 'USDC' && asset.verified);
            patchSend({ assetId: (usdc ?? list[0])?.id ?? NATIVE_ID, check: null });
            // «To» typed before the balances arrived is read now that there is a coin to read it for.
            if (get().send.to.trim()) scheduleTo();
          }
        },
      });
    },

    setSendAsset: (id) => {
      if (get().send.phase !== 'idle') return;
      editSend({ assetId: id, amount: '', check: null });
      if (get().send.to.trim()) scheduleTo();
    },
    setTo: (to) => {
      if (get().send.phase !== 'idle') return;
      editSend({ to, check: null, name: null, risk: null });
      scheduleTo();
    },
    setAmount: (amount) => {
      if (get().send.phase !== 'idle') return;
      editSend({ amount });
    },
    acceptLookalike: () => {
      const read = readRecipient(get().send.to, get().owner);
      const address = recipientAddress(get().send, read);
      if (address) patchSend({ accepted: { ...get().send.accepted, lookalike: address } });
    },
    acceptFresh: () => {
      const read = readRecipient(get().send.to, get().owner);
      const address = recipientAddress(get().send, read);
      if (address) patchSend({ accepted: { ...get().send.accepted, fresh: address } });
    },

    reviewSend: async () => {
      if (!env.open || gateNow() !== 'review') return;
      const intent = intentNow();
      if (!intent) return;
      const owner = intent.sender;
      const outcome = await reviewSend(sendDeps(owner), intent);
      if (get().owner !== owner) return;
      if (outcome.kind === 'refused') {
        patchSend({ phase: 'idle', review: null, line: { tone: 'error', text: outcome.refusal.message } });
        return;
      }
      patchSend({
        phase: 'idle',
        review: { bundle: outcome.bundle, authorized: outcome.authorized },
        line: signable(outcome.bundle) ? null : { tone: 'error', text: blockedLine(outcome.bundle) },
      });
    },

    confirmSend: async () => {
      const { send } = get();
      if (!env.open || !send.review || gateNow() !== 'confirm') return;
      const intent = intentNow();
      if (!intent) return;
      const owner = intent.sender;
      const outcome = await confirmSend(sendDeps(owner), intent, send.review.authorized).finally(() => {
        patchSend({ phase: 'idle' });
        busy();
      });
      if (get().owner !== owner) return;
      switch (outcome.kind) {
        case 'settled':
          patchSend({ review: null, settled: outcome.settled, amount: outcome.settled.observed ? '' : get().send.amount, line: outcome.line ? { tone: 'warn', text: outcome.line } : null });
          get().readWallet();
          setTimeout(() => get().owner === owner && get().readWallet(), AFTER_MOVE_MS[1]);
          env.refreshCity();
          return;
        case 'unresolved':
          patchSend({ review: null, line: { tone: 'warn', text: outcome.line } });
          get().resumeSend();
          return;
        case 'review':
          patchSend({ review: { bundle: outcome.bundle, authorized: outcome.authorized }, line: { tone: 'warn', text: outcome.line } });
          return;
        case 'cancelled':
          patchSend({ line: { tone: 'info', text: outcome.line } });
          return;
        case 'refused':
          patchSend({ review: null, line: { tone: 'error', text: outcome.refusal.message } });
          // A signature kept before a refusal is read back by the engine's rule before anything new is built.
          if (readPendingSend(env.storage() ?? memory, owner)) get().resumeSend();
          return;
      }
    },

    newSend: () => {
      if (get().send.phase !== 'idle') return;
      patchSend({ settled: null, review: null, line: null, amount: '' });
    },

    resumeSend: () => {
      const owner = get().owner;
      if (!owner) return;
      const pending = readPendingSend(env.storage() ?? memory, owner);
      if (!pending || pending.network !== 'mainnet') return;
      const ticket = bump('resume');
      void resumeSend(
        {
          fetch: env.fetch,
          forget: (wallet) => void forgetPendingSend(env.storage() ?? memory, wallet),
          now: env.now,
          sleep: env.sleep,
          live: () => ticket === tickets.resume && get().owner === owner,
          onState: (state) => patchSend({ resumed: state ? { signature: pending.signature, state } : null }),
        },
        pending,
      ).then((state) => {
        if (state === 'LANDED' && ticket === tickets.resume) {
          get().readWallet();
          env.refreshCity();
        }
      });
    },

    setBridgeNetwork: (network) => {
      if (!bridgeEditable(get().bridge.phase)) return;
      editBridge({ network, quote: null });
    },
    setBridgeTo: (to) => {
      if (!bridgeEditable(get().bridge.phase)) return;
      editBridge({ to });
    },
    setBridgeAmount: (amount) => {
      if (!bridgeEditable(get().bridge.phase)) return;
      editBridge({ amount });
    },

    quoteBridge: async () => {
      if (!env.open) return;
      const key = bridgeKey();
      const input = key ? bridgeAsk(key) : null;
      if (!key || !input) return;
      const ticket = bump('quote');
      patchBridge({ phase: get().bridge.phase === 'idle' ? 'quoting' : get().bridge.phase });
      const answer = await quoteBridge(env.fetch, input);
      if (ticket !== tickets.quote || bridgeKey() !== key) return;
      if (get().bridge.phase === 'quoting') patchBridge({ phase: 'idle' });
      if (!answer.ok) {
        patchBridge({ quote: null, line: { tone: 'error', text: bridgeRefusalWords(answer.failure.code) } });
        return;
      }
      patchBridge({
        quote: { key, body: answer.body, at: env.now() },
        line: answer.body.buildable ? null : { tone: 'warn', text: wordsNow(BRIDGE_WORDS).pausedHere },
      });
    },

    reviewBridge: async () => {
      const { bridge } = get();
      const key = bridgeKey();
      if (!env.open || !key || bridge.phase !== 'idle' || bridge.quote?.key !== key || !bridge.quote.body.buildable || env.runs.read()) return;
      const input = bridgeAsk(key);
      if (!input) return;
      patchBridge({ phase: 'planning', line: null });
      const answer = await planBridge(env.fetch, input, bridge.quote.body.quote, env.now);
      if (bridgeKey() !== key) return patchBridge({ phase: 'idle' });
      if (!answer.ok) {
        const fresh: CrossSwapQuote | null = answer.fresh;
        patchBridge({
          phase: 'idle',
          plan: null,
          quote: fresh && bridge.quote ? { ...bridge.quote, body: { ...bridge.quote.body, quote: fresh }, at: env.now() } : get().bridge.quote,
          line: { tone: 'error', text: bridgeRefusalWords(answer.failure.code) },
        });
        return;
      }
      patchBridge({ phase: 'idle', plan: { key, plan: answer.plan }, quote: { ...bridge.quote, body: { ...bridge.quote.body, quote: answer.plan.quote } } });
    },

    confirmBridge: async () => {
      const { bridge, owner } = get();
      const key = bridgeKey();
      if (!env.open || !owner || !key || bridge.phase !== 'idle' || bridge.plan?.key !== key) return;
      const input = bridgeAsk(key);
      if (!input) return;
      const outcome = await confirmBridge(
        {
          fetch: env.fetch,
          sign: (wire) => {
            const connection = env.connection();
            if (!connection || connection.address !== owner) return Promise.resolve({ ok: false, reason: 'The wallet changed. Nothing was signed.' });
            return env.sign(connection, wire);
          },
          runs: env.runs,
          now: env.now,
          onPhase: (phase) => {
            patchBridge({ phase });
            busy();
          },
        },
        bridge.plan.plan,
        input.route.tuple.id,
      ).finally(() => {
        if (get().bridge.phase === 'wallet' || get().bridge.phase === 'sending') patchBridge({ phase: 'idle' });
        busy();
      });
      if (get().owner !== owner) return;
      if (outcome.kind === 'tracking') {
        patchBridge({ plan: null, phase: 'tracking', line: null });
        void get().followOrder();
        return;
      }
      patchBridge({ plan: null, line: { tone: outcome.kind === 'cancelled' ? 'info' : outcome.kind === 'stale' ? 'warn' : 'error', text: outcome.line } });
      if (outcome.kind === 'stale') void get().quoteBridge();
    },

    followOrder: async () => {
      const run = env.runs.read();
      const owner = get().owner;
      if (!env.open || !run || !owner || following === run.intentDigest) return;
      following = run.intentDigest;
      try {
        await follow(run.intentDigest, owner);
      } finally {
        if (following === run.intentDigest) following = null;
      }
    },

    newBridge: () => {
      if (get().bridge.phase !== 'idle') return;
      patchBridge({ order: null, receipt: null, plan: null, line: null, amount: '' });
    },

    pickDeposit: async (network) => {
      const owner = get().owner;
      // A deposit from another network is money moving into the wallet: behind the switch, like Send and Bridge.
      if (!owner || !env.open) return;
      const ticket = bump('deposit');
      const kept = keptAddress(env.storage(), owner, network, env.now());
      const since = Math.max(0, Math.floor(env.now() / 1000) - 30 * 60);
      if (kept) return set({ deposit: { network, address: kept, status: 'idle', progress: null, since } });
      set({ deposit: { network, address: null, status: 'loading', progress: null, since } });
      const address = await readDepositAddress(env.fetch, network, owner);
      if (ticket !== tickets.deposit || get().owner !== owner) return;
      if (!address) return set({ deposit: { ...get().deposit, status: 'failed' } });
      keepAddress(env.storage(), address, env.now());
      set({ deposit: { network, address, status: 'idle', progress: null, since } });
    },

    readDepositProgress: async () => {
      const { deposit, owner } = get();
      if (!env.open || !deposit.address || !owner) return;
      const address = deposit.address.address;
      const answer = await readDepositProgress(env.fetch, address, deposit.since);
      if (get().deposit.address?.address !== address) return;
      if (answer.progress === 'UNKNOWN' || answer.progress === 'NONE') return;
      // An arrival already seen is never taken back by a later «on the way».
      if (get().deposit.progress?.progress === 'ARRIVED' && answer.progress === 'ON_THE_WAY') return;
      set({ deposit: { ...get().deposit, progress: { progress: answer.progress, amount: answer.amount } } });
      if (answer.progress === 'ARRIVED') {
        get().readWallet();
        env.refreshCity();
      }
    },

    readActivity: async () => {
      const owner = get().owner;
      if (!owner) return;
      const ticket = bump('activity');
      set({ activity: { ...get().activity, status: get().activity.read ? 'ready' : 'reading' } });
      const read = await readActivity(env.fetch, owner, env.now);
      if (ticket !== tickets.activity || get().owner !== owner) return;
      if (!read) return set({ activity: { ...get().activity, status: get().activity.read ? 'ready' : 'failed' } });
      set({ activity: { ...get().activity, read, status: 'ready' } });
    },

    openReceipt: async (action) => {
      const owner = get().owner;
      if (!owner || get().activity.opening) return;
      const kept = keptReceipts(owner);
      const local = findReceiptForAction(kept, action);
      if (local) {
        set({ activity: { ...get().activity, line: null, shown: { actionId: action.actionId, receipt: local.receipt } } });
        return;
      }
      set({ activity: { ...get().activity, opening: action.actionId, line: null } });
      const fetched = await fetchReceiptForAction(action, owner, (url, init) => fetch(url, init));
      if (get().owner !== owner) return;
      if (fetched.ok) {
        storeBoundSolanaReceipt(env.storage() ?? memory, receiptBinding(fetched.receipt as never)?.wallet ?? owner, owner, fetched.receipt);
        set({ activity: { ...get().activity, opening: null, shown: { actionId: action.actionId, receipt: fetched.receipt } } });
      } else {
        set({ activity: { ...get().activity, opening: null, line: { tone: 'warn', text: wordsNow(STORE_WORDS).receiptFailed } } });
      }
    },

    closeReceipt: () => {
      if (get().activity.shown) set({ activity: { ...get().activity, shown: null } });
    },
  };
});

/** A browser that refuses storage still sends; it loses only the reload path. */
const memory: Storage = (() => {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, value),
  };
})();

/** The receipts this browser keeps for the wallet. */
export function keptReceipts(owner: string): readonly StoredReceiptView[] {
  return readSolanaReceipts(env.storage() ?? memory, owner) as unknown as readonly StoredReceiptView[];
}

if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') Object.assign(window, { __moneyStore: useMoneyStore });
