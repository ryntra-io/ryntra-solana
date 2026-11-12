import type { AgentView, Books, TradeState } from './store.ts';
import type { AUTOPILOT } from './words.ts';

/**
 * CITY-70 — the mission on the agent's card, in its words: one state at the top (working, confirming a trade, frozen,
 * paused, done, stopped), the money in one line behind «Details», each of its last trades by what it really is. A trade
 * whose fate is unknown reads «Confirming» — never «Didn't go through». Pure: the card and the tests share it.
 */

type W = (typeof AUTOPILOT)['en'];

export type MissionTone = 'live' | 'confirming' | 'frozen' | 'paused' | 'done';

export type MissionFace = Readonly<{ text: string; tone: MissionTone; line: string | null; nextAt: number | null }>;

/** The card's state, from the engine's mission; an engine of before — from the book's state as it was. */
export function missionFace(view: Pick<AgentView, 'status' | 'mission' | 'frozen'> | null, w: W): MissionFace | null {
  const mission = view?.mission;
  if (!view) return null;
  if (!mission) {
    if (view.status === 'working') return { text: w.working, tone: 'live', line: null, nextAt: null };
    if (view.status === 'paused') return { text: w.missionPaused, tone: 'paused', line: null, nextAt: null };
    return { text: view.status === 'stopped' ? w.missionStopped : w.missionDone, tone: 'done', line: null, nextAt: null };
  }
  switch (mission.state) {
    case 'working':
    case 'waiting':
      return { text: w.working, tone: 'live', line: null, nextAt: mission.state === 'waiting' ? mission.nextAt : null };
    case 'confirming':
      return { text: w.missionConfirming, tone: 'confirming', line: w.confirmingLine, nextAt: null };
    case 'frozen':
      return { text: w.missionFrozen, tone: 'frozen', line: w.frozenLine, nextAt: null };
    case 'paused':
      return { text: w.missionPaused, tone: 'paused', line: mission.reason === 'mismatch' ? w.pausedMismatch : null, nextAt: null };
    case 'done':
      return { text: w.missionDone, tone: 'done', line: null, nextAt: null };
    case 'stopped':
      return { text: w.missionStopped, tone: 'done', line: null, nextAt: null };
  }
}

/** One trade as the card names it. */
export function tradeWord(state: TradeState | undefined, ok: boolean, w: W): string {
  switch (state ?? (ok ? 'ok' : 'failed')) {
    case 'ok':
      return w.tradeOk;
    case 'unknown':
      return w.tradeUnknown;
    case 'refused':
      return w.tradeRefused;
    case 'held':
      return w.tradeHeld;
    default:
      return w.tradeFailed;
  }
}

/** The money in one line: «Budget 0.1 SOL = spent 0.04 + left 0.06 SOL» when it adds up exactly; null when it is not told. */
export function booksLine(books: Books | undefined, w: W, sol: (lamports: string) => string): string | null {
  if (!books) return null;
  if (books.state === 'settling') return w.booksSettling;
  if (books.state !== 'exact' || books.leftRaw === null) return null;
  return w.booksLine(sol(books.budgetRaw), sol(books.spentRaw), sol(books.leftRaw));
}

/** Whether «Withdraw» has anything to take back: the policy still stands, or the vault still holds some of the budget. */
export function canWithdraw(live: boolean, books: Books | undefined): boolean {
  if (live) return true;
  return Boolean(books && books.state !== 'closed' && books.leftRaw !== null && BigInt(books.leftRaw) > 0n);
}
