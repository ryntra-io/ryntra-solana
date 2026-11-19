/**
 * The Bridge form's reasoning, apart from React: the typed amount in a coin's units, which one press the form
 * shows, and where a transfer stands — from the Relay SDK's progress while the page carries it, from Relay's status
 * after a reload. Pure, so the tests read it as it is.
 */

import type { BridgeChainView, BridgeTokenView, BridgeVm } from '../../lib/relay/bridge-chains.ts';
import type { BridgeFacts } from '../../lib/relay/bridge-quote.ts';

export type BridgeCoin = Readonly<{
  chainId: number;
  address: string;
  symbol: string;
  name: string | null;
  decimals: number;
  verified: boolean;
  logo: boolean;
}>;

export function coinOf(token: BridgeTokenView): BridgeCoin {
  return { chainId: token.chainId, address: token.address, symbol: token.symbol, name: token.name, decimals: token.decimals, verified: token.verified, logo: token.logo };
}

export const sameCoin = (a: Pick<BridgeCoin, 'chainId' | 'address'>, b: Pick<BridgeCoin, 'chainId' | 'address'>) => a.chainId === b.chainId && a.address.toLowerCase() === b.address.toLowerCase();

/** A coin's logo on this page: Relay's, served by this site; the network's mark for its own coin. */
export function coinLogo(coin: Pick<BridgeCoin, 'chainId' | 'address' | 'logo'>): string | null {
  return coin.logo ? `/api/swap/bridge/icon?chain=${coin.chainId}&token=${encodeURIComponent(coin.address)}` : null;
}

export function chainLogo(chainId: number): string {
  return `/api/swap/bridge/icon?chain=${chainId}`;
}

/** A typed decimal in a coin's raw units; null when it is not a positive amount the coin can hold. */
export function toRaw(typed: string, decimals: number): string | null {
  const value = typed.trim();
  if (!/^\d*\.?\d*$/.test(value) || value === '' || value === '.') return null;
  const [whole = '', fraction = ''] = value.split('.');
  if (fraction.length > decimals) return null;
  const raw = BigInt(`${whole || '0'}${fraction.padEnd(decimals, '0')}`);
  return raw > 0n ? raw.toString() : null;
}

/** Raw units as a plain decimal for a field (no grouping, no rounding): what MAX writes. */
export function fromRaw(raw: string, decimals: number): string {
  if (!/^\d+$/.test(raw)) return '';
  const text = raw.padStart(decimals + 1, '0');
  const whole = text.slice(0, text.length - decimals) || '0';
  const fraction = decimals > 0 ? text.slice(text.length - decimals).replace(/0+$/, '') : '';
  return fraction ? `${whole}.${fraction}` : whole;
}

/** Seconds as a person reads a wait: under a minute in seconds, after that in whole minutes. */
export function etaOf(seconds: number | null, w: { seconds: (n: number) => string; minutes: (n: number) => string }): string | null {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return null;
  if (seconds < 60) return w.seconds(Math.max(1, Math.round(seconds)));
  return w.minutes(Math.round(seconds / 60));
}

/** Dollars as the fee line says them: cents under a dollar, never «$0.00» for a fee that is there. */
export function dollarsOf(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) return null;
  if (value > 0 && value < 0.01) return '<$0.01';
  return `$${value.toFixed(2)}`;
}

/** The way's whole cost in dollars: Relay's fee, the origin network's gas and Ryntra's fee, as Relay states them. */
export function costOf(facts: BridgeFacts): number | null {
  const parts = [facts.fees.relayUsd, facts.fees.gasUsd, facts.fees.ryntraUsd].filter((part): part is number => part !== null);
  return parts.length ? parts.reduce((sum, part) => sum + part, 0) : null;
}

/* ── the one press ─────────────────────────────────────────────────────── */

export type QuoteState =
  | Readonly<{ status: 'idle' }>
  | Readonly<{ status: 'loading'; key: string }>
  | Readonly<{ status: 'ready'; key: string; facts: BridgeFacts; preview: boolean; quote: unknown }>
  | Readonly<{ status: 'failed'; key: string; code: string }>;

export type Press =
  | 'chains'
  | 'enter'
  | 'notEnough'
  | 'connectOrigin'
  | 'connectDestination'
  | 'address'
  | 'pricing'
  | 'noRoute'
  | 'tooSmall'
  | 'tooLarge'
  | 'busy'
  | 'unavailable'
  | 'move'
  | 'deposit';

/**
 * Which one press the form shows, in the order a person meets the steps: an amount, the wallet that sends, where the
 * money lands, a price, then the move. A price is shown before any wallet is connected (a preview), so the press asks
 * for the wallet only once there is something to move.
 */
export function pressOf(args: Readonly<{
  chainsReady: boolean;
  origin: Pick<BridgeChainView, 'wallet' | 'deposit' | 'send'> | null;
  destination: Pick<BridgeChainView, 'owner'> | null;
  amountRaw: string | null;
  /** The origin coin the wallet holds, raw; null when not read. */
  heldRaw: string | null;
  originAddress: string | null;
  recipient: string | null;
  recipientTyped: boolean;
  quote: QuoteState;
}>): Press {
  if (!args.chainsReady || !args.origin || !args.destination) return 'chains';
  // A network money cannot leave from here (turned into the sending side): no way, before anything is typed.
  if (!args.origin.send) return 'noRoute';
  if (args.amountRaw === null) return 'enter';
  if (args.heldRaw !== null && BigInt(args.heldRaw) < BigInt(args.amountRaw)) return 'notEnough';
  const quote = args.quote;
  if (quote.status === 'failed') {
    if (['QUOTE_NO_ROUTE', 'QUOTE_MISMATCH', 'SAME_COIN', 'UNKNOWN_CHAIN', 'SENDER_INVALID', 'RECIPIENT_INVALID'].includes(quote.code)) return 'noRoute';
    if (quote.code === 'QUOTE_AMOUNT_TOO_SMALL') return 'tooSmall';
    if (quote.code === 'QUOTE_AMOUNT_TOO_LARGE') return 'tooLarge';
    if (quote.code === 'RATE_LIMITED' || quote.code === 'QUOTE_RATE_LIMITED') return 'busy';
    return 'unavailable';
  }
  // Another address chosen and not a whole one yet: the press asks for it, whatever the price is doing (M13).
  if (args.recipientTyped && args.recipient === null) return 'address';
  if (quote.status !== 'ready') return 'pricing';
  if (args.origin.wallet !== null && args.originAddress === null) return 'connectOrigin';
  if (args.recipient === null) return args.destination.owner !== null && !args.recipientTyped ? 'connectDestination' : 'address';
  // A network no wallet signs on is priced as a preview; its address opens on the press.
  if (args.origin.wallet === null) return 'deposit';
  if (quote.preview) return 'pricing';
  return 'move';
}

/** Whether a typed recipient has the shape of an address on the receiving network's machine (mirrors the server). */
export { bridgeAddressOk as addressOk } from '../../lib/relay/bridge-chains.ts';
export type { BridgeVm };

/**
 * Relay's or the route's refusal that says «not this moment» — its window, a cut answer, its own failure — asked again
 * quietly before anything is said. A slow answer (`TRANSPORT`) already took twelve seconds and is said.
 */
export function bridgeQuietlyAgain(code: string): boolean {
  return /^(QUOTE_)?(RATE_LIMITED|HTTP_ERROR|UNREADABLE)$|^(CHAINS_UNAVAILABLE|UNAVAILABLE)$/.test(code);
}

/* ── a transfer ────────────────────────────────────────────────────────── */

/**
 * `expired`: the order can no longer land and nothing left the wallet (its blockhash is past). `reverted`: the deposit
 * failed on its own network — the money stayed, only the network's fee was spent. `unconfirmed`: a day without Relay
 * ever naming a deposit — no longer followed, the transfer opens at Relay.
 */
export type TransferState = 'sign' | 'sent' | 'bridging' | 'done' | 'refunded' | 'failed' | 'slow' | 'cancelled' | 'waiting' | 'expired' | 'reverted' | 'unconfirmed';

export type Transfer = Readonly<{
  requestId: string;
  at: number;
  state: TransferState;
  from: Readonly<{ chainId: number; symbol: string; amountRaw: string; decimals: number; address?: string; logo?: boolean }>;
  to: Readonly<{ chainId: number; symbol: string; amountRaw: string; decimals: number; address?: string; logo?: boolean }>;
  /** Where the money left, and where it landed: [chain id, hash]. */
  originTx: readonly [number, string] | null;
  destinationTx: readonly [number, string] | null;
  /** Relay's address for a deposit-address order. */
  depositAddress: string | null;
}>;

/** A state that will not change again. */
export const settled = (state: TransferState) => state === 'done' || state === 'refunded' || state === 'failed' || state === 'cancelled' || state === 'expired' || state === 'reverted' || state === 'unconfirmed';

/**
 * How often an unsettled transfer of this age is asked about: often while it is fresh, then less and less; after a day,
 * not at all (null).
 */
export function followEvery(ageMs: number): number | null {
  if (ageMs < 10 * 60_000) return 6_000;
  if (ageMs < 60 * 60_000) return 30_000;
  if (ageMs < 24 * 60 * 60_000) return 180_000;
  return null;
}

type Hash = Readonly<{ txHash: string; chainId: number }>;
type StepItem = Readonly<{ status?: string; progressState?: string; checkStatus?: string; check?: unknown; txHashes?: readonly Hash[]; internalTxHashes?: readonly Hash[] }>;
type Step = Readonly<{ id?: string; items?: readonly StepItem[] }>;
type Progress = Readonly<{ steps?: readonly Step[]; currentStepItem?: StepItem | null; txHashes?: readonly Hash[]; refunded?: boolean; error?: unknown }>;

/** The step that moves the money: Relay's deposit — the one its status is checked on — never an approval before it. */
function depositItems(progress: Progress): readonly StepItem[] {
  const steps = progress.steps ?? [];
  const deposit = steps.find((step) => step.id === 'deposit') ?? steps.find((step) => (step.items ?? []).some((item) => item.check));
  return deposit?.items ?? [];
}

/** Where the money left: the deposit's own transaction on the sending network, once the wallet has sent it. */
export function originOf(progress: Progress, originChain: number): readonly [number, string] | null {
  for (const item of depositItems(progress)) {
    const hit = [...(item.internalTxHashes ?? []), ...(item.txHashes ?? [])].find((entry) => entry.chainId === originChain);
    if (hit) return [hit.chainId, hit.txHash];
  }
  return null;
}

/** Where a transfer stands, from the SDK's progress: asked of the wallet, sent, crossing, landed or returned. */
export function stateOfProgress(progress: Progress): TransferState {
  if (progress.refunded) return 'refunded';
  const items = (progress.steps ?? []).flatMap((step) => step.items ?? []);
  const last = items.at(-1);
  if (items.length > 0 && items.every((item) => item.status === 'complete') && (last?.checkStatus === undefined || last.checkStatus === 'success')) return 'done';
  if (items.some((item) => item.checkStatus === 'refund')) return 'refunded';
  if (items.some((item) => item.checkStatus === 'failure')) return 'failed';
  if (items.some((item) => item.checkStatus === 'pending' || item.checkStatus === 'submitted')) return 'bridging';
  const current = progress.currentStepItem;
  if (current?.progressState === 'validating' || (progress.txHashes ?? []).length > 0) return 'sent';
  return 'sign';
}

/** The landing transaction the SDK saw once Relay says the order is filled: on the receiving network, never the deposit. */
export function landingOf(progress: Progress, destinationChain: number): readonly [number, string] | null {
  for (const item of depositItems(progress)) {
    if (item.checkStatus !== 'success') continue;
    const hit = (item.txHashes ?? []).find((entry) => entry.chainId === destinationChain);
    if (hit) return [hit.chainId, hit.txHash];
  }
  return null;
}

/** Relay's status words (`/intents/status/v3`) as a transfer's state. `failure` of an order nobody paid into is waiting. */
export function stateOfStatus(status: string | null | undefined, paid: boolean): TransferState | null {
  switch (status) {
    case 'success':
      return 'done';
    case 'refund':
      return 'refunded';
    case 'pending':
    case 'submitted':
    case 'depositing':
      return 'bridging';
    case 'waiting':
      return paid ? 'sent' : 'waiting';
    case 'failure':
      return paid ? 'failed' : null;
    default:
      return null;
  }
}

/** Whether a wallet's refusal is the person saying no (not a fault): every wallet words it a little differently. */
export function refusedInWallet(error: unknown): boolean {
  const text = error instanceof Error ? `${error.name} ${error.message}` : typeof error === 'string' ? error : JSON.stringify(error ?? '');
  const code = error && typeof error === 'object' && 'code' in error ? (error as { code: unknown }).code : null;
  return code === 4001 || code === 'ACTION_REJECTED' || /reject|denied|cancel|declin|user refused/i.test(text);
}

/** At most this many transfers are kept on the device. */
export const TRANSFERS_KEPT = 20;

/** The list after one transfer changed or arrived: newest first, at most `TRANSFERS_KEPT`. */
export function withTransfer(list: readonly Transfer[], next: Transfer): Transfer[] {
  return [next, ...list.filter((entry) => entry.requestId !== next.requestId)].sort((a, b) => b.at - a.at).slice(0, TRANSFERS_KEPT);
}

/** A stored list, read defensively: anything that is not a transfer is dropped. */
export function readTransfers(raw: unknown): Transfer[] {
  if (!Array.isArray(raw)) return [];
  const coin = (value: unknown) => {
    const entry = value as Record<string, unknown> | null;
    return Boolean(entry && typeof entry.chainId === 'number' && typeof entry.symbol === 'string' && typeof entry.amountRaw === 'string' && /^\d+$/.test(entry.amountRaw) && typeof entry.decimals === 'number');
  };
  return raw
    .filter((entry): entry is Transfer => {
      const value = entry as Record<string, unknown> | null;
      return Boolean(value && typeof value.requestId === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value.requestId) && typeof value.at === 'number' && typeof value.state === 'string' && coin(value.from) && coin(value.to));
    })
    .slice(0, TRANSFERS_KEPT);
}

/** An explorer link for a transaction on a chain, from the chain's own explorer as Relay lists it. */
export function txLink(explorer: string | null, hash: string): string | null {
  if (!explorer || !/^https:\/\//.test(explorer)) return null;
  return `${explorer.replace(/\/+$/, '')}/tx/${hash}`;
}

/** Short form of an address or a hash for the eye: the first and last four. */
export function shortOf(value: string): string {
  return value.length > 12 ? `${value.slice(0, 4)}…${value.slice(-4)}` : value;
}
