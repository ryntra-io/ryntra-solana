import { COPY_SHARES, COPY_TERMS, COPY_WORST_DAYS, copyBudgetIssue, copyBudgetOf, copyMonthFees, solOf, type CopyFees } from '../../lib/wallet-watch/copy-agent.ts';
import { isAddress, type WalletRead } from '../watch/watch-view.ts';

/**
 * «Copy a wallet» — the pure half of the screen: her numbers as the engine takes them, the month's fees on the
 * wallet's own read, and the copies the engine keeps (`/api/wallet-watch/copy`) as the list draws them. Read only.
 */

export const COPY_PATH = '/api/wallet-watch/copy';

/** Her numbers, as typed and picked. */
export type CopyForm = Readonly<{ day: string; share: number; days: number; bound: number }>;

/** A typed amount as a number: a comma or a point; nothing typed, or no number — null. */
export function typedSol(text: string): number | null {
  const value = Number(text.trim().replace(',', '.'));
  return text.trim() && Number.isFinite(value) && value > 0 ? value : null;
}

export type FormIssue = 'zero' | 'tradeMin' | 'tooLarge';

/** What is wrong with her numbers, in the screen's words; null when the engine takes them. */
export function formIssue(form: CopyForm): FormIssue | null {
  const perDaySol = typedSol(form.day);
  if (perDaySol === null) return 'zero';
  const issue = copyBudgetIssue({ perDaySol, sharePct: form.share, days: form.days });
  if (issue === null) return null;
  return issue === 'tradeMin' ? 'tradeMin' : issue === 'tooLarge' ? 'tooLarge' : 'zero';
}

/** Her trade and how many a day her day holds, SOL; null while the numbers are no budget. */
export function tradeOf(form: CopyForm): Readonly<{ tradeSol: number; perDay: number }> | null {
  const perDaySol = typedSol(form.day);
  if (perDaySol === null || formIssue(form) !== null) return null;
  const budget = copyBudgetOf({ perDaySol, sharePct: form.share, days: form.days });
  return { tradeSol: solOf(budget.perTrade), perDay: Math.max(1, Math.floor(100 / form.share)) };
}

/**
 * Her copy's worst day with money, SOL: `COPY_WORST_DAYS` × her budget a day, however many coins she picks — the
 * one line before her signature; null while the numbers are no budget.
 */
export function worstOf(form: CopyForm): number | null {
  const perDaySol = typedSol(form.day);
  return perDaySol === null || formIssue(form) !== null ? null : perDaySol * COPY_WORST_DAYS;
}

/** The month's fees of copying this wallet on her numbers, from its own read; null until both are there. */
export function feesOf(form: CopyForm, read: WalletRead | null, nowMs: number): CopyFees | null {
  const trade = tradeOf(form);
  if (!trade || !read) return null;
  return copyMonthFees({ trades: read.trades, oldestAt: read.oldestAt, nowS: Math.floor(nowMs / 1000), perTradeSol: trade.tradeSol, perDaySol: typedSol(form.day)! });
}

/** The span a wallet's read covers, from its oldest trade read to now: hours under two days, days past them. */
export function readSpan(read: WalletRead, nowMs: number): Readonly<{ unit: 'h' | 'd'; n: number }> | null {
  if (read.oldestAt === null) return null;
  const hours = Math.max(1, Math.round((nowMs / 1000 - read.oldestAt) / 3_600));
  return hours < 48 ? { unit: 'h', n: hours } : { unit: 'd', n: Math.round(hours / 24) };
}

/** The coin the chart beside the form shows: the wallet's newest trade's, else none. */
export function chartMint(read: WalletRead | null): Readonly<{ mint: string; symbol: string | null; icon: string | null }> | null {
  const newest = read?.trades[0];
  return newest ? { mint: newest.mint, symbol: newest.symbol, icon: newest.icon } : null;
}

export const SHARE_IDS = COPY_SHARES.map(String) as readonly string[];
export const TERM_IDS = COPY_TERMS.map(String) as readonly string[];

/* ---------------------------------------------------------------- the copies the engine keeps */

export type CopyRow = Readonly<{
  leader: string;
  name: string | null;
  since: string;
  sizeSol: number;
  boundPct: number;
  /** Her terms; null — a copy of a fixed size, kept from before. */
  terms: Readonly<{ perDaySol: number; perTradeSol: number; days: number; sharePct: number; endsAt: string; todaySol: number; ended: boolean }> | null;
  filled: number;
  missed: number;
  /** The copy at the price now, SOL; null — not priced. */
  resultSol: number | null;
  pct: number | null;
  /** Held coins with no price now, counted at nothing. */
  unpriced: number;
}>;

const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const obj = (value: unknown): Record<string, unknown> | null => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null);

function rowOf(raw: unknown): CopyRow | null {
  const row = obj(raw);
  const leader = row?.leader;
  if (!row || typeof leader !== 'string' || !isAddress(leader) || typeof row.since !== 'string') return null;
  const summary = obj(row.summary);
  const agent = obj(row.agent);
  const terms = agent
    ? {
        perDaySol: num(agent.perDaySol) ?? 0,
        perTradeSol: num(agent.perTradeSol) ?? 0,
        days: num(agent.days) ?? 0,
        sharePct: num(agent.sharePct) ?? 0,
        endsAt: typeof agent.endsAt === 'string' ? agent.endsAt : row.since,
        todaySol: num(agent.todaySol) ?? 0,
        ended: agent.ended === true,
      }
    : null;
  return {
    leader,
    name: typeof row.name === 'string' && row.name ? row.name.slice(0, 32) : null,
    since: row.since,
    sizeSol: num(row.sizeSol) ?? 0,
    boundPct: num(row.slippagePct) ?? 0,
    terms,
    filled: Math.max(0, num(summary?.filled) ?? 0),
    missed: Math.max(0, num(summary?.missed) ?? 0),
    resultSol: num(summary?.resultSol),
    pct: num(summary?.pct),
    unpriced: Math.max(0, num(summary?.unpriced) ?? 0),
  };
}

/** The engine's copies as the list reads them; null when the answer is not one. */
export function copiesOf(body: unknown): CopyRow[] | null {
  const data = obj(body);
  if (!data || data.ok !== true || !Array.isArray(data.copies)) return null;
  return data.copies.map(rowOf).filter((row): row is CopyRow => row !== null);
}

/** The copies at work: started and within their term. */
export const copiesWorking = (rows: readonly CopyRow[]): number => rows.filter((row) => !row.terms?.ended).length;

/* ---------------------------------------------------------------- her copies with money */

/**
 * Her copy with money as the list draws it. `pending` — her start landed only in part (`review` names the
 * server's record of it): to finish, or to take home; `rest` — something of hers still stands in her vault after her stop:
 * «Take the rest» stays while it does, after a reload too.
 */
export type MoneyRow = Readonly<{
  policy: string;
  leader: string;
  status: 'working' | 'stopped' | 'pending';
  frozen: boolean;
  since: string;
  endsAt: string;
  ended: boolean;
  perDaySol: number;
  perTradeSol: number;
  todaySol: number;
  coins: number;
  bought: number;
  sold: number;
  missed: number;
  rest: boolean;
  review: string | null;
}>;

const REVIEW = /^[0-9a-f]{32}$/;

function moneyRowOf(raw: unknown): MoneyRow | null {
  const row = obj(raw);
  if (!row || typeof row.policy !== 'string' || !isAddress(row.policy) || typeof row.leader !== 'string' || !isAddress(row.leader) || typeof row.since !== 'string') return null;
  const count = (value: unknown) => Math.max(0, num(value) ?? 0);
  return {
    policy: row.policy,
    leader: row.leader,
    status: row.status === 'stopped' ? 'stopped' : row.status === 'pending' && typeof row.review === 'string' && REVIEW.test(row.review) ? 'pending' : 'working',
    frozen: row.frozen === true,
    since: row.since,
    endsAt: typeof row.endsAt === 'string' ? row.endsAt : row.since,
    ended: row.ended === true,
    perDaySol: count(row.perDaySol),
    perTradeSol: count(row.perTradeSol),
    todaySol: count(row.todaySol),
    coins: count(row.coins),
    bought: count(row.bought),
    sold: count(row.sold),
    missed: count(row.missed),
    rest: row.rest === true,
    review: typeof row.review === 'string' && REVIEW.test(row.review) ? row.review : null,
  };
}

/** Her copies with money as the list reads them, whatever the switch: [] — none; null — the book did not answer. */
export function moneyOf(body: unknown): MoneyRow[] | null {
  const data = obj(body);
  if (!data || data.ok !== true) return null;
  if (!('moneyCopies' in data)) return [];
  if (!Array.isArray(data.moneyCopies)) return null;
  return data.moneyCopies.map(moneyRowOf).filter((row): row is MoneyRow => row !== null);
}

/** A copy with money at work: in the book, not stopped, within its term. */
export const moneyWorking = (row: MoneyRow): boolean => row.status === 'working' && !row.ended;

/**
 * Why a coin stays in her vault after her stop, in the screen's words: the engine's reasons (`lib/wallet-watch/copy-money.server.ts`
 * `coinHome`) each to a line of `COPY`; any other — «cannot be moved now».
 */
export const STUCK_WORDS = {
  'its issuer froze it in your vault': 'whyFrozen',
  'the coin cannot be moved': 'whyLocked',
  "the coin runs its issuer's own program on every transfer": 'whyHook',
  'its issuer can stop every transfer of the coin': 'whyPaused',
  'its issuer can take the coin out of any wallet': 'whyTaker',
  'its issuer can make new wallets of this coin start frozen': 'whyStartsFrozen',
  'the coin can hide its amounts': 'whyHidden',
  "the coin's shown amount changes on its own": 'whyDrifts',
  'its issuer can close the coin itself': 'whyClosable',
  'it carries a Token-2022 feature the agent does not know': 'whyUnknown',
  'its mint does not read': 'whyUnread',
  'its mint does not read whole': 'whyUnread',
} as const;
export type StuckWord = (typeof STUCK_WORDS)[keyof typeof STUCK_WORDS] | 'whyCannotMove';
export const stuckWordOf = (reason: string): StuckWord => (STUCK_WORDS as Readonly<Record<string, StuckWord>>)[reason] ?? 'whyCannotMove';
