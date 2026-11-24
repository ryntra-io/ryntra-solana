import { VersionedTransaction } from '@solana/web3.js';
import { doneWindows, paidOf, recordOf, type AutopayRecord } from '../../../lib/autopay/record.ts';
import type { AutopayNetwork } from './open.ts';
import { AUTOPAY_EVERY, COUNT_MAX, PERIOD_SECONDS, amountOf, countUntil, dueAt, lastDueAt, networkOf, standingAt, totalOf, type AutopayCoin, type AutopayEvery } from '../../../lib/autopay/schedule.ts';

/**
 * «Autopay» as data: when the tab stands, the form's numbers and what one
 * signature moves, the check of the engine's answer before the wallet opens, and how an autopay of the list reads. The
 * engine decides everything (`lib/autopay/**`): the policy the person signs lets the executor pay only the named address,
 * only that amount, once a period, until the end; «Stop» is the person's one signature.
 *
 * Pure: no clock it is not given, no network, no store — the tests read it as it is.
 */

export const AUTOPAY_ENDPOINT = '/api/v1/autopay';

export { autopayNetwork, autopayOpen, type AutopayNetwork } from './open.ts';

/** The wallet's chain for the person's signature. */
export const chainOf = (network: AutopayNetwork): 'solana:devnet' | 'solana:mainnet' => (network === 'mainnet' ? 'solana:mainnet' : 'solana:devnet');

export const AUTOPAY_COIN_LIST = [
  { symbol: 'SOL', mint: null },
  { symbol: 'USDC', mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' },
] as const satisfies readonly Readonly<{ symbol: AutopayCoin; mint: string | null }>[];

export { AUTOPAY_EVERY };

/** How many payments a rhythm starts at: a month of days, a quarter of weeks, a year of months. */
export const COUNT_DEFAULT: Readonly<Record<AutopayEvery, number>> = { day: 30, week: 12, month: 12 };

/** A day as the date field writes it (`YYYY-MM-DD`, UTC), from Unix seconds. */
export function dayOf(seconds: bigint): string {
  return new Date(Number(seconds) * 1000).toISOString().slice(0, 10);
}

/** The end of the day a date field holds, Unix seconds (UTC); null when it is not a date. */
export function untilOf(day: string): bigint | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const at = Date.parse(`${day}T23:59:59Z`);
  return Number.isFinite(at) ? BigInt(Math.floor(at / 1000)) : null;
}

/** The date a rhythm's default count of payments ends on. */
export function defaultUntil(every: AutopayEvery, startSeconds: bigint): string {
  return dayOf(dueAt({ every, startAt: startSeconds }, COUNT_DEFAULT[every] - 1));
}

/** The form as the person filled it. */
export type AutopayForm = Readonly<{ to: string; coin: AutopayCoin; amount: string; every: AutopayEvery; until: string }>;

/** What the form makes, now: the payments, the total the signature moves, the executor's network fee, the last day. */
export type FormPlan = Readonly<{ amount: bigint; count: number; total: bigint; network: bigint; lastAt: bigint }>;

/** The plan of a filled form at `nowSeconds`; null while the amount or the date is not one. */
export function planOf(form: AutopayForm, nowSeconds: bigint): FormPlan | null {
  const amount = amountOf(form.amount, form.coin);
  const until = untilOf(form.until);
  if (amount === null || until === null || until < nowSeconds) return null;
  const count = countUntil({ every: form.every, startAt: nowSeconds }, until);
  if (count < 1 || count > COUNT_MAX) return null;
  const schedule = { every: form.every, startAt: nowSeconds, count, amount };
  return { amount, count, total: totalOf(schedule), network: networkOf(schedule), lastAt: lastDueAt(schedule) };
}

/** What `/api/v1/autopay/review` must say back before the wallet opens: the same recipient, amount, count, total and fee. */
export type Review = Readonly<{ draft: AutopayRecord; transactions: readonly string[]; fund: string; network: string; recipient: string }>;

/** The engine's review, read; null when it is not one. */
export function reviewOf(body: unknown): Review | null {
  if (!body || typeof body !== 'object') return null;
  const value = body as Record<string, unknown>;
  const draft = recordOf(value.draft);
  if (!draft || !Array.isArray(value.transactions) || !value.transactions.every((item) => typeof item === 'string')) return null;
  if (typeof value.fund !== 'string' || typeof value.network !== 'string' || typeof value.recipient !== 'string') return null;
  return { draft, transactions: value.transactions as string[], fund: value.fund, network: value.network, recipient: value.recipient };
}

/**
 * Whether the review is exactly what the form showed: the wallet is asked only for the numbers the person read — the
 * owner, the coin, one payment, how many, the rhythm, the total and the executor's fee — and the address, when one was typed.
 */
export function reviewMatches(review: Review, input: Readonly<{ owner: string; coin: AutopayCoin; every: AutopayEvery; plan: FormPlan; address: string | null }>): boolean {
  const { draft } = review;
  return (
    draft.owner === input.owner &&
    draft.coin === input.coin &&
    draft.every === input.every &&
    draft.amount === input.plan.amount.toString() &&
    draft.count === input.plan.count &&
    review.fund === input.plan.total.toString() &&
    review.network === input.plan.network.toString() &&
    draft.recipient === review.recipient &&
    (input.address === null || review.recipient === input.address)
  );
}

/** The list as the screen holds it. */
export type AutopaysRead = Readonly<{ state: 'reading' }> | Readonly<{ state: 'ready'; autopays: readonly AutopayRecord[] }> | Readonly<{ state: 'locked' }> | Readonly<{ state: 'failed' }>;

export function listOf(status: number, body: unknown, owner: string): AutopaysRead {
  if (status === 401) return { state: 'locked' };
  if (status < 200 || status >= 300 || !body || typeof body !== 'object') return { state: 'failed' };
  const answer = body as { address?: unknown; autopays?: unknown };
  if (answer.address !== owner) return { state: 'locked' };
  if (!Array.isArray(answer.autopays)) return { state: 'failed' };
  return { state: 'ready', autopays: answer.autopays.map(recordOf).filter((record): record is AutopayRecord => record !== null) };
}

/** One autopay as a row says it: paid so far, the next payment, its state and its tone. */
export type RowSummary = Readonly<{
  paid: number;
  of: number;
  /** The next payment's moment, Unix seconds; null — none is coming. */
  next: bigint | null;
  state: 'working' | 'stopped' | 'ended' | 'lastFailed';
  tone: 'ok' | 'warn' | 'plain';
}>;

export function rowOf(record: AutopayRecord, nowSeconds: bigint): RowSummary {
  const schedule = { every: record.every, startAt: BigInt(record.startAt), count: record.count };
  const paid = paidOf(record).count;
  const last = record.payments.filter((row) => row.state !== 'sending').at(-1);
  const standing = standingAt(schedule, nowSeconds, doneWindows(record));
  const next = record.status !== 'working' ? null : standing.kind === 'due' ? dueAt(schedule, standing.window) : standing.kind === 'wait' ? standing.at : null;
  if (record.status === 'stopped') return { paid, of: record.count, next: null, state: 'stopped', tone: 'plain' };
  if (record.status === 'ended' || standing.kind === 'ended') return { paid, of: record.count, next: null, state: 'ended', tone: 'plain' };
  if (last && (last.state === 'failed' || last.state === 'missed')) return { paid, of: record.count, next, state: 'lastFailed', tone: 'warn' };
  return { paid, of: record.count, next, state: 'working', tone: 'ok' };
}

/** A recipient as a row names it: the contact's or `.skr` name, else the address shortened. */
export function whoOf(record: Pick<AutopayRecord, 'label' | 'recipient'>): string {
  return record.label ?? `${record.recipient.slice(0, 4)}…${record.recipient.slice(-4)}`;
}

/** A period in seconds — for the screen's own clock arithmetic. */
export const periodSeconds = (every: AutopayEvery): bigint => PERIOD_SECONDS[every];

/** What a stop or a start came to, as the screen says it. */
export type Outcome = 'done' | 'declined' | 'changed' | 'refused' | 'unreachable' | 'locked';

const SSA = 'SMRTzfY6DfH5ik3TKiyLFfXexV8uSG3d2UksSCYdunG';
const ALLOWED = new Set([SSA, '11111111111111111111111111111111', 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL']);
const fromBase64 = (value: string) => Uint8Array.from(atob(value), (character) => character.charCodeAt(0));

/**
 * The server's transactions, read here from their own bytes before the wallet sees them: one or two, the person pays and
 * alone signs, no lookup tables, only the smart account, system, token and token-account programs, and the smart
 * account's own instruction among them (the policy, or its removal).
 */
export function checkAutopayUnsigned(transactions: readonly string[], owner: string): boolean {
  if (!transactions.length || transactions.length > 2) return false;
  let smartAccount = false;
  for (const wire of transactions) {
    let tx: VersionedTransaction;
    try {
      tx = VersionedTransaction.deserialize(fromBase64(wire));
    } catch {
      return false;
    }
    const keys = tx.message.staticAccountKeys.map((key) => key.toBase58());
    if (keys[0] !== owner || tx.message.header.numRequiredSignatures !== 1 || tx.message.addressTableLookups.length) return false;
    if (tx.message.compiledInstructions.some((ix) => !ALLOWED.has(keys[ix.programIdIndex] ?? ''))) return false;
    if (tx.message.compiledInstructions.some((ix) => keys[ix.programIdIndex] === SSA)) smartAccount = true;
  }
  return smartAccount;
}
