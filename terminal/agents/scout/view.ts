import { digits } from '../../../city/lib/i18n/dict.ts';
import type { Lang } from '../../../city/lib/i18n/langs.ts';
import type { JournalEntry, ScoutCheck } from '../../../lib/scout/journal.ts';
import { closeReason, paperFor, type PaperPosition, type PersonPaper } from '../../../lib/scout/paper.ts';
import { SCOUT_EXIT, SCOUT_PAPER } from '../../../lib/scout/rules.ts';
import { isUnread, type ScoutView } from '../../../lib/scout/view.ts';
import type { ScoutWords } from './words.ts';

/**
 * The Scout's screen, pure: what each code says, the person's own paper from the shared desk, the one line of a check.
 * Relative imports only: `node --test` reads this module directly.
 */

const LAMPORTS = 1_000_000_000n;
/** The span the person's paper result covers. */
export const RESULT_SPAN_MS = 7 * 24 * 60 * 60_000;

type WordKey = keyof ScoutWords;

/** A code in the person's words; a code the screen has no words for is not shown. */
export function codeWord(w: ScoutWords, prefix: 'f' | 'a' | 'i' | 'r' | 'x' | 'o', code: string): string | null {
  const value = w[`${prefix}_${code}` as WordKey];
  return typeof value === 'string' ? value : null;
}

/** A reason of any stage: the bars and rules first, then the thesis's codes. */
export function reasonWord(w: ScoutWords, code: string): string | null {
  return codeWord(w, 'r', code) ?? codeWord(w, 'a', code) ?? codeWord(w, 'f', code) ?? codeWord(w, 'x', code);
}

/** The first reason a person can read: a fact about the coin before a read that did not happen. */
export function firstReason(w: ScoutWords, codes: readonly string[]): string {
  const ordered = [...codes.filter((code) => !isUnread(code)), ...codes.filter(isUnread)];
  return ordered.map((code) => reasonWord(w, code)).find((word): word is string => Boolean(word)) ?? '';
}

/** Whether every reason of a check is a read that did not happen: the Scout has nothing to say of the coin yet. */
export const onlyUnread = (check: Pick<ScoutCheck, 'codes'>): boolean => check.codes.length > 0 && check.codes.every(isUnread);

/** The one line a check makes beside a coin in «New»: what the Scout did and its first reason. */
export function checkLine(w: ScoutWords, check: ScoutCheck): string | null {
  const outcome = codeWord(w, 'o', check.outcome);
  if (!outcome) return null;
  /* Nothing read is no verdict: the coin is said to be not checked yet, not left out. */
  if (onlyUnread(check)) return w.checkOf(w.notCheckedYet, '');
  return w.checkOf(outcome, firstReason(w, check.codes));
}

/** The tone of a check: a buy is growth, a refusal is said quietly — the Scout's «no» is a fact, not an alarm. */
export function checkTone(check: ScoutCheck): 'up' | undefined {
  return check.outcome === 'took' ? 'up' : undefined;
}

/** SOL as the person types it → lamports; null for anything else. Any amount: the budget is the person's own. */
export function solTyped(text: string): bigint | null {
  const value = text.trim().replace(',', '.');
  if (!/^\d{0,9}(\.\d{0,9})?$/u.test(value) || !/\d/u.test(value)) return null;
  const [whole = '', fraction = ''] = value.split('.');
  const raw = BigInt(whole || '0') * LAMPORTS + BigInt((fraction + '000000000').slice(0, 9));
  return raw > 0n ? raw : null;
}

/** Lamports as a field shows them: no trailing zeros, the language's decimal mark. */
export function solField(lamports: bigint, lang: Lang): string {
  const whole = lamports / LAMPORTS;
  const fraction = (lamports % LAMPORTS).toString().padStart(9, '0').replace(/0+$/u, '');
  return digits(fraction ? `${whole}.${fraction}` : `${whole}`, lang);
}

/** Lamports as SOL with a sign: «+0.0421», «−0.012», four places, cut — never rounded in the Scout's favour. */
export function solSigned(lamports: bigint, lang: Lang): string {
  const negative = lamports < 0n;
  const abs = negative ? -lamports : lamports;
  const units = abs / 100_000n;
  const text = `${units / 10_000n}.${(units % 10_000n).toString().padStart(4, '0')}`;
  const sign = units === 0n ? '' : negative ? '−' : '+';
  return digits(`${sign}${text}`, lang);
}

export type PaperBudget = Readonly<{ perDayLamports: bigint; perTradeLamports: bigint }>;

export const DEFAULT_BUDGET: PaperBudget = { perDayLamports: SCOUT_PAPER.perDayLamports, perTradeLamports: SCOUT_PAPER.perTradeLamports };

/** The shared desk on the person's numbers, over the last seven days. */
export function personPaper(view: Pick<ScoutView, 'open' | 'closed'> | null, budget: PaperBudget, now: number): PersonPaper {
  const positions = view ? [...view.open, ...view.closed].filter((position) => now - position.openedAt <= RESULT_SPAN_MS) : [];
  return paperFor(budget, positions);
}

export type PositionState = 'holding' | 'half' | 'closed';

export function positionState(position: PaperPosition): PositionState {
  if (position.closedAt !== null) return 'closed';
  return position.sales.some((sale) => sale.reason === 'half') ? 'half' : 'holding';
}

/** The state of a position in a word: holding, half sold, or how it closed. */
export function stateWord(w: ScoutWords, position: PaperPosition): string {
  const state = positionState(position);
  if (state === 'holding') return w.holding;
  if (state === 'half') return w.halfSold;
  const reason = closeReason(position);
  return (reason && codeWord(w, 'x', reason)) ?? w.o_closed;
}

/** Why it was bought, in one short line: the thesis's first reason. */
export function whyWord(w: ScoutWords, position: PaperPosition): string {
  return position.why.map((code) => codeWord(w, 'f', code)).find((word): word is string => Boolean(word)) ?? '—';
}

/** A decision in one line: the coin's outcome and its first reason. */
export function decisionLine(w: ScoutWords, entry: JournalEntry): string | null {
  return checkLine(w, { at: entry.at, stage: entry.stage, outcome: entry.outcome, codes: entry.codes });
}

/**
 * The decisions a person reads, each with its line, at most `limit`: the coins the Scout could not read are said once —
 * the newest of them — never a column of the same words.
 */
export function decisionRows(w: ScoutWords, entries: readonly JournalEntry[], limit: number): { entry: JournalEntry; line: string }[] {
  const out: { entry: JournalEntry; line: string }[] = [];
  let unreadShown = false;
  for (const entry of entries) {
    if (out.length >= limit) break;
    const line = decisionLine(w, entry);
    if (!line) continue;
    if (onlyUnread(entry)) {
      if (unreadShown) continue;
      unreadShown = true;
    }
    out.push({ entry, line });
  }
  return out;
}

/** The exits' numbers as the «i» says them. */
export function exitWords(w: ScoutWords): string {
  return w.howExit(String(SCOUT_EXIT.stopBps / 100), String(SCOUT_EXIT.halfAt), String(SCOUT_EXIT.maxHoldMs / 3_600_000));
}

/** Whole minutes since a moment, never below zero. */
export const minutesSince = (at: number, now: number): number => Math.max(0, Math.floor((now - at) / 60_000));
