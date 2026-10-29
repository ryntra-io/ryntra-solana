import { exactDecimal } from '../../../lib/solana/amounts.ts';
import type { SolanaEnvironmentContext } from '../../../lib/solana/environment.ts';
import type { SkrResolve } from '../../../lib/solana/skr.client.ts';
import { readAmount } from './amount.ts';
import type { MoneyAsset, WalletRead } from './assets.ts';
import { checkProblemWords, guardOf, readRecipient, riskLine, type RecipientCheck, type RecipientRead, type RiskRead } from './recipient.ts';
import { signable, type ResumeState, type SendBundle, type SendPhase, type Settled } from './send.ts';

/**
 * The Send tab's form and its one decision: what the action says and does, from what was typed, the engine's answers
 * and the wallet — the same ladder Ryntra's web «Send» climbs, so a transfer is offered to the wallet only when every
 * rung is clear. Pure: the window draws it, the tests climb it.
 */

export type Line = Readonly<{ tone: 'info' | 'warn' | 'error'; text: string }>;

export type NameRead = SkrResolve | Readonly<{ state: 'RESOLVING'; name: string }>;

export type CheckState = Readonly<{ key: string; status: 'checking' | 'done' | 'unread'; result: RecipientCheck | null }>;

export type SendState = Readonly<{
  assetId: string;
  to: string;
  amount: string;
  name: NameRead | null;
  check: CheckState | null;
  /** The security source's word on the address «To» points at; for that address only. */
  risk: RiskRead | null;
  /** The addresses the person said are the ones they meant (SEC-2), each for that exact address only. */
  accepted: Readonly<{ lookalike: string | null; fresh: string | null }>;
  review: Readonly<{ bundle: SendBundle; authorized: SolanaEnvironmentContext }> | null;
  phase: 'idle' | SendPhase;
  line: Line | null;
  settled: Settled | null;
  resumed: Readonly<{ signature: string; state: ResumeState }> | null;
  recents: readonly string[];
  recentsRead: boolean;
}>;

export const EMPTY_SEND: SendState = {
  assetId: '',
  to: '',
  amount: '',
  name: null,
  check: null,
  risk: null,
  accepted: { lookalike: null, fresh: null },
  review: null,
  phase: 'idle',
  line: null,
  settled: null,
  resumed: null,
  recents: [],
  recentsRead: false,
};

/** The coin chosen on Send, or null while the wallet is unread. */
export function chosenAsset(wallet: WalletRead | null, id: string): MoneyAsset | null {
  return wallet?.assets.find((asset) => asset.id === id) ?? null;
}

/** Where «To» points now: an address the engine can be asked to pay, or null. */
export function recipientAddress(send: Pick<SendState, 'name' | 'check'>, read: RecipientRead): string | null {
  if (read.kind === 'address') return read.address;
  if (read.kind === 'name') return send.name?.state === 'FOUND' && send.name.name === read.name ? send.name.address : null;
  if (read.kind === 'request') return send.check?.status === 'done' && send.check.result?.next === 'transfer' ? send.check.result.address : null;
  return null;
}

/** An earlier transfer whose outcome is open holds back a new one. */
export function blocksSend(send: Pick<SendState, 'resumed'>): boolean {
  return send.resumed?.state === 'CHECKING' || send.resumed?.state === 'UNKNOWN';
}

export type SendAction = 'connect' | 'review' | 'confirm' | 'accept-lookalike' | 'accept-fresh';

export type SendGate = Readonly<{
  /** The one action's words. */
  label: string;
  action: SendAction | null;
  /** A line about «To», when it has something to say. */
  toLine: Line | null;
  amountLine: string | null;
  recipient: string | null;
  lookalike: string | null;
  isNew: boolean;
  /** The security source's word on the recipient, when it should be read before signing. Never holds the action. */
  riskLine: Line | null;
}>;

export type GateInput = Readonly<{
  connected: boolean;
  owner: string | null;
  wallet: WalletRead | null;
  walletRead: 'none' | 'reading' | 'ready' | 'failed';
  send: SendState;
}>;

export function sendGate(input: GateInput): SendGate {
  const { send } = input;
  const none = { toLine: null, amountLine: null, recipient: null, lookalike: null, isNew: false, riskLine: null } as const;
  if (!input.connected || !input.owner) return { ...none, label: 'Connect wallet', action: 'connect' };
  if (send.phase === 'reviewing') return { ...none, label: 'Preparing transfer…', action: null };
  if (send.phase === 'preparing') return { ...none, label: 'Checking it again…', action: null };
  if (send.phase === 'wallet') return { ...none, label: 'Check your wallet…', action: null };
  if (send.phase === 'sending') return { ...none, label: 'Sending…', action: null };
  if (blocksSend(send)) return { ...none, label: 'Waiting for an earlier transfer', action: null };
  if (!input.wallet) return { ...none, label: input.walletRead === 'failed' ? 'Balances unavailable' : 'Reading your balances…', action: null };
  const asset = chosenAsset(input.wallet, send.assetId);
  if (!asset) return { ...none, label: 'Choose a coin', action: null };

  const read = readRecipient(send.to, input.owner);
  let toLine: Line | null = read.kind === 'problem' ? { tone: 'error', text: read.text } : null;
  if (read.kind === 'name') {
    if (!send.name || send.name.state === 'RESOLVING') toLine = { tone: 'info', text: `Finding ${read.name}…` };
    else if (send.name.state === 'NOT_FOUND') toLine = { tone: 'error', text: `No such name: ${read.name}.` };
    else if (send.name.state === 'UNAVAILABLE') toLine = { tone: 'warn', text: 'The name could not be checked right now.' };
  }
  const recipient = recipientAddress(send, read);
  const check = recipient || read.kind === 'request' ? send.check : null;
  if (check?.status === 'done' && check.result) {
    if (check.result.next === 'none') toLine = { tone: 'error', text: checkProblemWords(check.result.problem) };
    else if (check.result.next === 'pay-link') toLine = { tone: 'info', text: 'This is a Ryntra payment link. Open it to pay.' };
    // An account opened for them is not a line under «To»: its cost is on the Review's one line, before the wallet.
  }
  const amount = readAmount(send.amount, { spendableRaw: asset.spendableRaw, decimals: asset.decimals, symbol: asset.symbol });
  const amountLine = send.amount.trim() !== '' && !amount.ok ? amount.text : null;
  const guard = recipient ? guardOf(recipient, input.owner, send.recents, send.recentsRead) : { lookalike: null, isNew: false };
  const risk = recipient && send.risk?.address === recipient ? riskLine(send.risk.summary) : null;
  const base = { toLine, amountLine, recipient, lookalike: guard.lookalike, isNew: guard.isNew, riskLine: risk };

  if (read.kind === 'empty') return { ...base, label: 'Enter who gets it', action: null };
  if (read.kind === 'problem') return { ...base, label: read.problem === 'OTHER_NETWORK' ? 'Use Bridge' : 'Check the recipient', action: null };
  if (read.kind === 'name' && send.name?.state !== 'FOUND') {
    return { ...base, label: send.name?.state === 'RESOLVING' || !send.name ? 'Finding the name…' : 'Check the name', action: null };
  }
  if (read.kind === 'request' && !recipient) return { ...base, label: check?.status === 'checking' || !check ? 'Reading the request…' : 'Check the recipient', action: null };
  if (!recipient) return { ...base, label: 'Check the recipient', action: null };
  if (check?.status === 'checking') return { ...base, label: 'Checking the recipient…', action: null };
  if (check?.status === 'done' && check.result && check.result.next !== 'transfer') return { ...base, label: 'Check the recipient', action: null };
  if (guard.lookalike && send.accepted.lookalike !== recipient) return { ...base, label: 'Check the whole address', action: 'accept-lookalike' };
  if (guard.isNew && send.accepted.fresh !== recipient) return { ...base, label: 'Check the new address', action: 'accept-fresh' };
  if (!amount.ok) return { ...base, label: amount.problem === 'OVER_BALANCE' ? `Not enough ${asset.symbol}` : 'Enter an amount', action: null };
  if (send.review) return signable(send.review.bundle) ? { ...base, label: 'Confirm in wallet', action: 'confirm' } : { ...base, label: 'Cannot be sent', action: null };
  return { ...base, label: 'Review transfer', action: 'review' };
}

export type ReviewTotal = Readonly<{
  /** What leaves in the coin sent, exact; null for SOL, whose total is all in `sol`. */
  coin: string | null;
  /** What leaves in SOL: the amount for a SOL transfer, plus the network fee and an account opened for them. */
  sol: string;
  /** False when a figure the total needs could not be read by the engine: then no total is shown as whole. */
  whole: boolean;
}>;

const DIGITS = /^\d+$/;
const raw = (value: string | null | undefined): bigint | null => (typeof value === 'string' && DIGITS.test(value) ? BigInt(value) : null);

/**
 * What the transfer takes from the wallet, from the engine's Review alone: the amount, the network fee and — for a
 * token whose recipient has no account yet — the account's cost, which the sender pays on top. For SOL to a new
 * address the least it must carry is not an extra cost and is not added (`lib/solana/send-check.ts`).
 */
export function reviewTotal(check: Pick<SendBundle['check'], 'send' | 'networkFee' | 'setup' | 'asset'>, symbol: string): ReviewTotal {
  const native = check.asset.mint === null;
  const fee = raw(check.networkFee.lamports);
  const setup = check.setup ? raw(check.setup.lamports) : 0n;
  const send = raw(check.send.raw);
  const whole = fee !== null && setup !== null && send !== null;
  const lamports = (native ? (send ?? 0n) : 0n) + (fee ?? 0n) + (setup ?? 0n);
  return {
    coin: native ? null : `${exactDecimal((send ?? 0n).toString(), check.asset.decimals)} ${symbol}`,
    sol: `${exactDecimal(lamports.toString(), 9)} SOL`,
    whole,
  };
}
