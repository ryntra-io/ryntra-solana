import { REWARD_RULES_CURRENT } from '../../../lib/rewards/rules.ts';
import { SOLANA_MAINNET_USDC_MINT, WRAPPED_SOL_MINT } from '../../../lib/solana/send-kinds.ts';
import { dateText, wordsNow } from '../i18n/dict.ts';
import type { Tower } from '../market/types.ts';
import { SCOUTS_LINE } from './words.ts';

/**
 * «Scouts» (CITY-8): what the Growth engine says about the people you brought, as the city shows it. Everything comes
 * from `/api/rewards` — the same read, the same rules and the same figures as the rest of Ryntra; the city never counts
 * a reward itself. Rewards are counted in dollars and paid in SOL (decision 73), so every figure reads «$ ≈ SOL» at the
 * city's own SOL price. No React and no three.js here: the tests run it in Node.
 */

/** A row of the history, as the engine projects it (`lib/rewards/view.ts`). */
export type ScoutRowKind = 'CASHBACK' | 'REFERRAL_L1' | 'REFERRAL_L2' | 'CLAIM';

export type ScoutRow = Readonly<{
  kind: ScoutRowKind;
  /** The unsigned dollar figure, `12.40`, `<0.01`, or `—` while it has no value yet. */
  amount: string;
  /** Negative for a payout. */
  out: boolean;
  /** The coin of the fee the share came from, when the engine names it. Never an address. */
  coin: string | null;
  at: string;
}>;

export type ScoutsView = Readonly<{
  /** The link to share; null while the engine has none for this wallet. */
  link: string | null;
  /** People who chose this wallet as their inviter, and the people they brought. */
  friends: number;
  friendsOfFriends: number;
  /** Dollar figures as the engine prints them: `12.40`, `<0.01`. */
  earned: string;
  fromFriends: string;
  cashback: string;
  /** Earned and not yet free to pay: a valuation, a check, a window. */
  pending: string;
  /** The share of a friend's trade at this wallet's rank, of a friend's friend, and the cashback, in per cent. */
  friendShare: number | null;
  secondShare: number;
  cashbackShare: number;
  /** A friend's first days pay more: the share and the days; null outside those rules. */
  firstDays: Readonly<{ share: number; days: number }> | null;
  rank: string | null;
  rows: readonly ScoutRow[];
}>;

const KINDS: ReadonlySet<string> = new Set<ScoutRowKind>(['CASHBACK', 'REFERRAL_L1', 'REFERRAL_L2', 'CLAIM']);
const USD = /^(?:<0\.01|\d+\.\d{2})$/;

const record = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const usd = (value: unknown): string => (typeof value === 'string' && USD.test(value) ? value : '0.00');
const count = (value: unknown): number => (typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0);
const share = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null);

/** The engine's answer as the window reads it; null when it is not the answer of a proven wallet. */
export function scoutsOf(body: unknown): ScoutsView | null {
  const answer = record(body);
  if (answer.ok !== true) return null;
  const referral = record(answer.referral);
  const referrals = record(answer.referrals);
  const rank = answer.rank === null ? null : record(answer.rank);
  const programme = record(answer.programme);
  const inviter = record(programme.inviterWindow);
  const rows: ScoutRow[] = [];
  for (const raw of Array.isArray(answer.rows) ? answer.rows : []) {
    const row = record(raw);
    if (typeof row.kind !== 'string' || !KINDS.has(row.kind) || typeof row.at !== 'string') continue;
    const amount = typeof row.amount === 'string' && (USD.test(row.amount) || row.amount === '—') ? row.amount : '—';
    const detail = typeof row.detail === 'string' ? row.detail.split(' · ')[0]!.trim() : '';
    rows.push({
      kind: row.kind as ScoutRowKind,
      amount,
      out: typeof row.display === 'string' && row.display.startsWith('−'),
      coin: detail || null,
      at: row.at,
    });
  }
  const days = count(inviter.days);
  const firstShare = share(inviter.share);
  return {
    link: typeof referral.link === 'string' && /^https?:\/\//.test(referral.link) ? referral.link : null,
    friends: count(referrals.level1),
    friendsOfFriends: count(referrals.level2),
    earned: usd(answer.lifetime),
    fromFriends: addUsd(usd(answer.referralL1), usd(answer.referralL2)),
    cashback: usd(answer.cashback),
    pending: usd(answer.pending),
    friendShare: rank ? share(rank.friendShare) : null,
    secondShare: share(rank?.secondLevelShare) ?? REWARD_RULES_CURRENT.referralL2Bps / 100,
    cashbackShare: REWARD_RULES_CURRENT.cashbackBps / 100,
    firstDays: firstShare !== null && days > 0 ? { share: firstShare, days } : null,
    rank: rank && typeof rank.rank === 'string' ? rank.rank : null,
    rows,
  };
}

/** Two engine figures added in cents; a sub-cent part stays told apart from nothing. */
export function addUsd(a: string, b: string): string {
  const cents = (text: string) => (text === '<0.01' ? 0n : BigInt(text.replace('.', '')));
  const sum = cents(a) + cents(b);
  if (sum === 0n) return a === '<0.01' || b === '<0.01' ? '<0.01' : '0.00';
  const text = sum.toString().padStart(3, '0');
  return `${text.slice(0, -2)}.${text.slice(-2)}`;
}

/** One figure as the window prints it: the dollars the engine counted, and about how much SOL that is now. */
export type Figure = Readonly<{ usd: string; sol: string | null }>;

/**
 * `12.40` at $180 a SOL → `$12.40` and `≈ 0.0689 SOL`. A figure with no value yet is a dash with nothing beside it; a
 * sub-cent one keeps its `<$0.01` and no SOL; without a SOL price only the dollars show — never a guessed SOL.
 */
export function figure(text: string, solUsd: number | null): Figure {
  if (text === '—' || !USD.test(text)) return { usd: '—', sol: null };
  if (text === '<0.01') return { usd: '<$0.01', sol: null };
  const [whole, cents] = text.split('.') as [string, string];
  const dollars = `$${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${cents}`;
  if (solUsd === null || !Number.isFinite(solUsd) || solUsd <= 0) return { usd: dollars, sol: null };
  const micros = BigInt(whole) * 1_000_000n + BigInt(cents) * 10_000n;
  // Nothing yet is one figure, not two zeros on top of each other.
  if (micros === 0n) return { usd: dollars, sol: null };
  return { usd: dollars, sol: `≈ ${approx(Number(micros) / 1_000_000 / solUsd)} SOL` };
}

/** An estimate reads as one: three significant figures, whole SOL grouped — `0.0689`, `12.4`, `1,240`. */
function approx(sol: number): string {
  if (sol >= 1_000) return Math.round(sol).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  if (sol < 0.0001) return '<0.0001';
  return String(Number(sol.toPrecision(3)));
}

/** The city's price of SOL: the SOL tower's, when it stands and has one. */
export function solPrice(towers: readonly Pick<Tower, 'id' | 'price'>[]): number | null {
  const sol = towers.find((tower) => tower.id === WRAPPED_SOL_MINT);
  return sol && Number.isFinite(sol.price) && sol.price > 0 ? sol.price : null;
}

/** At most this many towers carry a scout's flag. */
export const MAX_FLAGS = 24;

/** The coins a fee is taken in when it is no coin of the city's skyline: never a flag. */
const BASE_SYMBOLS: ReadonlySet<string> = new Set(['SOL', 'WSOL', 'USDC', 'USDT']);
const BASE_MINTS: ReadonlySet<string> = new Set([WRAPPED_SOL_MINT, SOLANA_MAINNET_USDC_MINT, 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB']);

const bare = (symbol: string) => symbol.replace(/^\$/, '').trim().toUpperCase();

/**
 * The towers a scout's flag stands on: the coins the people you brought traded, as the engine names them on the
 * friends' rows of your history — a share taken in a coin means a friend's trade went through that coin. A fee taken in
 * SOL or a stablecoin names no tower; a coin whose ticker more than one named tower carries is not guessed at; an
 * unnamed tower gets no flag. Newest first, at most `MAX_FLAGS`.
 */
export function flaggedMints(rows: readonly ScoutRow[], towers: readonly Pick<Tower, 'id' | 'symbol' | 'verified'>[]): readonly string[] {
  const bySymbol = new Map<string, string | null>();
  for (const tower of towers) {
    if (!tower.verified || BASE_MINTS.has(tower.id)) continue;
    const symbol = bare(tower.symbol);
    bySymbol.set(symbol, bySymbol.has(symbol) ? null : tower.id);
  }
  const flags: string[] = [];
  const sorted = [...rows].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  for (const row of sorted) {
    if ((row.kind !== 'REFERRAL_L1' && row.kind !== 'REFERRAL_L2') || !row.coin) continue;
    const symbol = bare(row.coin);
    if (BASE_SYMBOLS.has(symbol)) continue;
    const mint = bySymbol.get(symbol);
    if (!mint || flags.includes(mint)) continue;
    flags.push(mint);
    if (flags.length >= MAX_FLAGS) break;
  }
  return flags;
}

/** The link as the window shows it: no scheme, `ryntra.io/r/K7Q2…`. The whole link is what is copied. */
export function linkText(link: string): string {
  return link.replace(/^https?:\/\//, '').replace(/\/+$/, '');
}

/** The post a scout shares on X: a line and the link. */
export function xIntent(link: string): string {
  const words = wordsNow(SCOUTS_LINE).post;
  return `https://x.com/intent/post?text=${encodeURIComponent(words)}&url=${encodeURIComponent(link)}`;
}

/** What the window shows: who is asked, from the wallet and the read. */
export type ScoutsScreen = 'connect' | 'prove' | 'reading' | 'ready' | 'failed';

export function screenOf(owner: string | null, status: 'none' | 'reading' | 'proof' | 'proving' | 'ready' | 'failed', view: ScoutsView | null): ScoutsScreen {
  if (!owner) return 'connect';
  if (status === 'proof' || status === 'proving') return 'prove';
  if (view) return 'ready';
  if (status === 'failed') return 'failed';
  return 'reading';
}

/** How long ago, short, in the language on screen: `now`, `5m`, `3h`, `2d`, then the day. */
export function ago(at: string, now: number): string {
  const ms = now - Date.parse(at);
  if (!Number.isFinite(ms)) return '';
  const w = wordsNow(SCOUTS_LINE);
  if (ms < 60_000) return w.now;
  if (ms < 3_600_000) return w.minutes(Math.floor(ms / 60_000));
  if (ms < 86_400_000) return w.hours(Math.floor(ms / 3_600_000));
  if (ms < 7 * 86_400_000) return w.days(Math.floor(ms / 86_400_000));
  return dateText(new Date(at), { day: 'numeric', month: 'short' });
}
