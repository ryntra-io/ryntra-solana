/**
 * The keeper's screen as data: whether a position's pool is one the agent keeps here, the one line the door
 * says under the position, and the figures the bounds' choices show. Pure: the screen draws it, the tests read it.
 */

import { KEEPER_COSTS, KEEPER_PACES, KEEPER_WIDTHS, type KeeperChoice, type KeeperCost, type KeeperPace, type KeeperStatus, type KeeperView, type KeeperWidth } from '../../../lib/care/stock-keeper-terms.ts';
import type { KeeperMode } from '../../../lib/care/range-limits.ts';

export const WIDTH_IDS = Object.keys(KEEPER_WIDTHS) as KeeperWidth[];
export const PACE_IDS = Object.keys(KEEPER_PACES) as KeeperPace[];
export const COST_IDS = Object.keys(KEEPER_COSTS) as KeeperCost[];

/** A pool the agent keeps here: a checked stock's, or a stand pool the deployment names. */
export function keeperPool(pier: Readonly<{ address: string; stock?: Readonly<{ issuer: string }> | null }>, status: Pick<KeeperStatus, 'standPools'> | null): boolean {
  if (!status) return false;
  return (pier.stock ?? null) !== null || status.standPools.includes(pier.address);
}

/** The keeper given this position, the newest first; null — none, or only one that stopped and was let go. */
export function keeperOf(status: Pick<KeeperStatus, 'keepers'> | null, nftMint: string): KeeperView | null {
  return status?.keepers.find((view) => view.nftMint === nftMint) ?? null;
}

export type DoorLine = 'off' | 'narrow' | 'wide' | 'pullOpen' | 'pullClosed' | 'hold' | 'waits' | 'waitsYou' | 'reading' | 'stopped';

/** The one line under the position: what the keeper does now, in the person's terms. */
export function doorLine(view: KeeperView | null): DoorLine {
  if (!view) return 'off';
  if (view.status === 'stopped') return 'stopped';
  if (view.wait === 'dividend-hold') return 'hold';
  if (view.wait === 'approval') return 'waitsYou';
  if (view.waiting && (view.wait === 'needs-owner' || view.mode === 'pull')) return 'waits';
  /* A keeper that only takes out lays no range: it says what it will do at the close, or that the range may stay. */
  if (view.hours === 'open') return view.mode === 'pull' ? 'pullOpen' : 'narrow';
  if (view.hours === 'closing' || view.hours === 'closed') return view.mode === 'pull' ? 'pullClosed' : 'wide';
  return 'reading';
}

/** A half-width in basis points as a person reads it: «1%», «0.5%». */
export const pctOf = (bps: number): string => `${Number((bps / 100).toFixed(2))}%`;

export const widthOf = (id: KeeperWidth) => ({ day: pctOf(KEEPER_WIDTHS[id].narrowestBps), night: pctOf(KEEPER_WIDTHS[id].widestBps) });
export const movesOf = (id: KeeperPace): number => KEEPER_PACES[id].maxShiftsPerDay;
/** The most a move costs, in SOL, as the screen says it. */
export const costSolOf = (id: KeeperCost): string => `${Number((KEEPER_COSTS[id] / 1e9).toFixed(3))} SOL`;

/** The modes the screen offers here: a keeper that only takes out everywhere; one that lays back only where it is served. */
export const modesOf = (status: Pick<KeeperStatus, 'modes'> | null): readonly KeeperMode[] => (status?.modes.includes('shift') ? ['pull', 'shift'] : ['pull']);

/** A choice the screen may send: laying back only where it is offered. */
export function choiceFor(choice: KeeperChoice, modes: readonly KeeperMode[]): KeeperChoice {
  return choice.putBack && !modes.includes('shift') ? { ...choice, putBack: false } : choice;
}

export const sameChoice = (a: KeeperChoice, b: KeeperChoice): boolean => a.width === b.width && a.pace === b.pace && a.cost === b.cost && a.plan === b.plan && a.putBack === b.putBack;

/** Each choice's word on screen. */
export const WIDTH_WORD = { tight: 'widthTight', usual: 'widthUsual', loose: 'widthLoose' } as const satisfies Record<KeeperWidth, string>;
export const PACE_WORD = { calm: 'paceCalm', usual: 'paceUsual', busy: 'paceBusy' } as const satisfies Record<KeeperPace, string>;
export const MODE_WORD = { pull: 'modePull', shift: 'modeShift' } as const satisfies Record<KeeperMode, string>;

/** The server's refusals the screen says in its own words; any other is «not available». */
const FAILURE_WORD = {
  KEEPER_CLOSED: 'failKeeperClosed',
  KEEPER_MODE: 'failKeeperMode',
  KEEPER_POOL: 'failKeeperPool',
  KEEPER_POSITION: 'failKeeperPosition',
  KEEPER_EMPTY: 'failKeeperEmpty',
  KEEPER_REFUSED: 'failKeeperRefused',
  KEEPER_SIGNED: 'failKeeperSigned',
  KEEPER_RELAY: 'failKeeperRelay',
  KEEPER_UNKNOWN: 'failKeeperUnknown',
  /* The position's approval not read on the chain: the stop is not built blind. */
  KEEPER_UNREAD: 'failKeeperPosition',
  /* The endpoint is another network than the switch names: on this deployment the keeper does not work. */
  NOT_NETWORK: 'failKeeperClosed',
} as const;
export type FailureWord = (typeof FAILURE_WORD)[keyof typeof FAILURE_WORD] | 'failUnavailable';

/** A refusal's code as the key of one of the screen's own words. */
export function failureOf(code: string | null): FailureWord {
  return code && Object.hasOwn(FAILURE_WORD, code) ? FAILURE_WORD[code as keyof typeof FAILURE_WORD] : 'failUnavailable';
}
