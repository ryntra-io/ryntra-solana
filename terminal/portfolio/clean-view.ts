import type { WalletCleanItem, WalletCleanReadResponse, WalletCleanReviewResponse, WalletCleanSubmitResponse } from '../../lib/api/v1/contract.ts';
import { SWAP_MIN_USD } from '../../lib/wallet-clean/rules.ts';

/**
 * «Clean the wallet» on the Portfolio — its rules, without React: which accounts a clean takes with the person's own
 * choice over the engine's, what it gives back before and after the engine built it, the groups the panel lists, and
 * what a relay's answer means. The engine (`/api/v1/wallet/clean/**`) sorts, marks, builds and sends; nothing here
 * prices, routes or signs.
 *
 * Pure: the tests hold them as they are written.
 */

export type CleanRead = WalletCleanReadResponse;
export type CleanReview = WalletCleanReviewResponse;
export type CleanItem = WalletCleanItem;
export type RiskReason = CleanItem['risk'][number];

/** The person's own choice over the engine's: the accounts put in by hand (a marked coin) and those taken out. */
export type Choice = Readonly<{ add: readonly string[]; drop: readonly string[] }>;
export const NO_CHOICE: Choice = { add: [], drop: [] };

/** Whether an item is in the clean with this choice. */
export function inClean(item: Pick<CleanItem, 'account' | 'picked'>, choice: Choice): boolean {
  if (choice.drop.includes(item.account)) return false;
  return item.picked || choice.add.includes(item.account);
}

/** The choice after one switch: on puts an item in, off takes it out — never both at once. */
export function toggled(choice: Choice, item: Pick<CleanItem, 'account' | 'picked'>, on: boolean): Choice {
  const add = choice.add.filter((account) => account !== item.account);
  const drop = choice.drop.filter((account) => account !== item.account);
  if (on && !item.picked) add.push(item.account);
  if (!on && item.picked) drop.push(item.account);
  return { add, drop };
}

/** The choice a request carries: only what still stands in the read. */
export function choiceFor(read: Pick<CleanRead, 'items'>, choice: Choice): Choice {
  const here = new Set(read.items.map((item) => item.account));
  return { add: choice.add.filter((account) => here.has(account)), drop: choice.drop.filter((account) => here.has(account)) };
}

export type Groups = Readonly<{ small: readonly CleanItem[]; empty: readonly CleanItem[]; litter: readonly CleanItem[] }>;

/** The panel's three lists: coins into SOL (wrapped SOL among them), empty accounts, litter to burn. */
export function groupsOf(items: readonly CleanItem[]): Groups {
  return {
    small: items.filter((item) => item.kind === 'small' || item.kind === 'wrapped'),
    empty: items.filter((item) => item.kind === 'empty'),
    litter: items.filter((item) => item.kind === 'litter'),
  };
}

const LAMPORTS = 1_000_000_000;

/**
 * Whether the clean with these items swaps anything — the engine's own rule (`planOf`, `lib/wallet-clean/rules.ts`): a
 * small coin worth a cent or more is swapped, and then the wrapped SOL account waits for a clean without swaps, which
 * may use it themselves.
 */
function swapsIn(taken: readonly CleanItem[]): boolean {
  return taken.some((item) => item.kind === 'small' && (item.valueUsd ?? 0) >= SWAP_MIN_USD);
}

/**
 * What a clean gives back before the engine built it, in SOL: the rent of every account it closes — a wrapped SOL
 * account's only when it closes now — and the small coins at the market's price in SOL; an estimate, said with «≈».
 * Null — nothing is in it.
 */
export function estimateSol(read: CleanRead, choice: Choice): number | null {
  const taken = read.items.filter((item) => inClean(item, choice));
  if (!taken.length) return null;
  const waits = swapsIn(taken);
  const lamports = taken.reduce((sum, item) => sum + (waits && item.kind === 'wrapped' ? 0 : item.lamports), 0);
  const usd = taken.reduce((sum, item) => sum + (item.kind === 'small' && item.valueUsd !== null ? item.valueUsd : 0), 0);
  return lamports / LAMPORTS + (read.solUsd ? usd / read.solUsd : 0);
}

/**
 * The wrapped SOL a clean unwraps with this choice, in whole SOL: closing a wrapped account turns what is in
 * it into the person's own SOL — nothing is lost, nor «got back», so the panel says it apart. `now` false — the same
 * clean swaps coins, so the unwrap waits for the next one (the engine's own order). Null — none is in it.
 */
export function unwrapOf(read: Pick<CleanRead, 'items'>, choice: Choice): Readonly<{ sol: number; now: boolean }> | null {
  const taken = read.items.filter((item) => inClean(item, choice));
  const raw = taken.filter((item) => item.kind === 'wrapped' && /^\d+$/.test(item.amountRaw)).reduce((sum, item) => sum + BigInt(item.amountRaw), 0n);
  return raw > 0n ? { sol: Number(raw) / LAMPORTS, now: !swapsIn(taken) } : null;
}

/** What the built clean gives back, in SOL: its own summary — the rent and the swaps' quotes. */
export function reviewedSol(review: Pick<CleanReview, 'summary'>): number {
  return Number(review.summary.receiveLamports) / LAMPORTS;
}

/** The short reader's figure for the first minute: «≈ … SOL back», or null when there is nothing. */
export function backSol(lamports: number): number | null {
  return lamports > 0 ? lamports / LAMPORTS : null;
}

/**
 * How many of each a clean takes, for the tile's one line: the coins are the dust's own kinds — small coins swapped and
 * litter burnt — so they compare with the «Dust» group's count (QA 19.11, eyes 28); a wrapped SOL account is an account
 * (closing it gives its rent back, the SOL in it is the person's already).
 */
export function counts(read: CleanRead, choice: Choice): Readonly<{ coins: number; accounts: number }> {
  const taken = read.items.filter((item) => inClean(item, choice));
  return { coins: taken.filter((item) => item.kind === 'small' || item.kind === 'litter').length, accounts: taken.filter((item) => item.kind === 'empty' || item.kind === 'wrapped').length };
}

/** Ryntra's fee as a person reads it: «0.1 %»; null — no swap, the clean is free. */
export function feeText(bps: number | null): string | null {
  if (bps === null) return null;
  const pct = bps / 100;
  return `${pct.toLocaleString('en-US', { maximumFractionDigits: 2 })} %`;
}

/** An SOL amount for the eye: four significant places under one, two above. */
export function solFigure(sol: number): string {
  if (!Number.isFinite(sol) || sol <= 0) return '0';
  if (sol >= 1) return sol.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const places = Math.min(9, -Math.floor(Math.log10(sol)) + 3);
  return sol.toFixed(places).replace(/0+$/, '').replace(/\.$/, '');
}

/**
 * A review is signed as it is only this soon after it arrived — by this browser's own clock, never the server's: its
 * bytes live about half a minute, and the wallet needs the rest. Older, it is built again at the press.
 */
export const SIGN_WITHIN_MS = 12_000;
export function reviewFresh(reviewAt: number, now: number): boolean {
  return reviewAt > 0 && now - reviewAt < SIGN_WITHIN_MS;
}

export type Outcome = 'done' | 'part' | 'none';

/** A relay's answer: everything landed, some of it, or none — what did not stays for the next clean. */
export function outcomeOf(answer: Pick<WalletCleanSubmitResponse, 'results'>): Outcome {
  const landed = answer.results.filter((result) => result.state === 'LANDED').length;
  if (landed === answer.results.length) return 'done';
  return landed > 0 ? 'part' : 'none';
}

/** Whether a coin of the wallet carries a mark: the engine's `risky`, by mint. */
export function riskMap(read: Pick<CleanRead, 'risky'> | null): ReadonlyMap<string, readonly RiskReason[]> {
  return new Map((read?.risky ?? []).map((row) => [row.mint, row.risk]));
}
