import type {
  LaunchEarlyAccessActionBuildRequest,
  LaunchEarlyAccessActionBuildResponse,
  LaunchEarlyAccessActionSubmitRequest,
  LaunchEarlyAccessActionSubmitResponse,
  LaunchEarlyAccessDepositBuildRequest,
  LaunchEarlyAccessDepositBuildResponse,
  LaunchEarlyAccessDepositSubmitRequest,
  LaunchEarlyAccessDepositSubmitResponse,
  LaunchEarlyAccessViewResponse,
} from '../../../lib/api/v1/contract.ts';
import { engineCall, type Answer } from './engine.ts';

/**
 * «Your people first» from the people's side (CITY-220): the creator's link opens one window on the early launch, and
 * the window has one thing to do at each moment — come in with USDC while the window is open, start the one buy for
 * everyone in the hour before trading, then take the tokens and whatever the vault did not spend. The engine reads the
 * vault on chain and builds every byte (`/api/v1/launch/{mint}/early-access/*`, SOL-L5); the city reads the bytes back
 * before the wallet (`entry-check.ts`) and signs nothing by itself.
 *
 * Coming in is behind the early door (`early.ts`): the city's switch, the engine's bounds, the network. Taking one's own
 * tokens and USDC back is never closed — not by the switch, not by Ryntra.
 *
 * Pure and client-safe.
 */

export type EarlyView = LaunchEarlyAccessViewResponse;
export type EntryAction = LaunchEarlyAccessActionBuildRequest['action'];

/** The engine's early-access routes for one launch — the same ones every Ryntra client calls. */
export interface EntryEngine {
  view(mint: string, wallet: string | null): Promise<Answer<EarlyView>>;
  depositBuild(mint: string, body: LaunchEarlyAccessDepositBuildRequest): Promise<Answer<LaunchEarlyAccessDepositBuildResponse>>;
  depositSubmit(mint: string, body: LaunchEarlyAccessDepositSubmitRequest): Promise<Answer<LaunchEarlyAccessDepositSubmitResponse>>;
  actionBuild(mint: string, body: LaunchEarlyAccessActionBuildRequest): Promise<Answer<LaunchEarlyAccessActionBuildResponse>>;
  actionSubmit(mint: string, body: LaunchEarlyAccessActionSubmitRequest): Promise<Answer<LaunchEarlyAccessActionSubmitResponse>>;
}

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const refused = <T>(): Promise<Answer<T>> => Promise.resolve({ ok: false, code: 'VALIDATION_ERROR', message: '' });

export function httpEntryEngine(fetcher: typeof fetch = (input, init) => fetch(input, init)): EntryEngine {
  const call = engineCall(fetcher);
  const post = <T>(path: string, body: unknown) => call<T>(path, { method: 'POST', body: JSON.stringify(body) });
  const at = (mint: string) => `/api/v1/launch/${mint}/early-access`;
  return {
    view: (mint, wallet) => (BASE58.test(mint) && (wallet === null || BASE58.test(wallet)) ? call(`${at(mint)}${wallet ? `?wallet=${wallet}` : ''}`) : refused()),
    depositBuild: (mint, body) => (BASE58.test(mint) ? post(`${at(mint)}/deposit/build`, body) : refused()),
    depositSubmit: (mint, body) => (BASE58.test(mint) ? post(`${at(mint)}/deposit/submit`, body) : refused()),
    actionBuild: (mint, body) => (BASE58.test(mint) ? post(`${at(mint)}/action/build`, body) : refused()),
    actionSubmit: (mint, body) => (BASE58.test(mint) ? post(`${at(mint)}/action/submit`, body) : refused()),
  };
}

/* ---------------------------------------------------------------- the link */

/** The link the creator hands their people: the city with the coin, nothing of a wallet in it. */
export function earlyLink(origin: string, mint: string): string {
  return `${origin.replace(/\/$/, '')}/?early=${mint}`;
}

/** The coin a link carries, from the city's own address; null when it carries none. */
export function earlyFrom(search: string): string | null {
  const mint = new URLSearchParams(search).get('early');
  return mint && BASE58.test(mint) ? mint : null;
}

/* ---------------------------------------------------------------- the one thing to do now */

export type EntryStep =
  /** The engine knows no early launch of this coin here. */
  | Readonly<{ kind: 'missing' }>
  /** The creation is still landing, or its vault is not on chain yet. */
  | Readonly<{ kind: 'setting' }>
  /** The creation landed only in part: nobody can come in. */
  | Readonly<{ kind: 'broken' }>
  /** The vault could not be read now. */
  | Readonly<{ kind: 'unread' }>
  | Readonly<{ kind: 'soon'; opensAt: number; publicAt: number }>
  /** The window is open. `open` — the door lets people in here; `room` — what this wallet may still bring (null — any). */
  | Readonly<{ kind: 'join'; open: boolean; depositedRaw: string; capRaw: string; mineRaw: string; roomRaw: string | null; takeBack: boolean; closesAt: number; publicAt: number }>
  /** The hour before trading, nothing bought yet: anyone may start the one buy for everyone, of what is deposited. */
  | Readonly<{ kind: 'fill'; publicAt: number; mineRaw: string; depositedRaw: string }>
  /** Before trading: bought already, nothing to buy with, or the minutes between the window and the hour of the buy. */
  | Readonly<{ kind: 'wait'; publicAt: number; filled: boolean; empty: boolean; mineRaw: string }>
  | Readonly<{ kind: 'claim'; amountRaw: string }>
  | Readonly<{ kind: 'refund'; amountRaw: string }>
  /** Trading is open and this wallet has nothing left to take. */
  | Readonly<{ kind: 'done'; mineRaw: string }>;

const big = (raw: string | null | undefined) => {
  try {
    return BigInt(raw ?? '0');
  } catch {
    return 0n;
  }
};

/**
 * What the window offers for a view at `now` (unix seconds): one step, from the engine's phase and the vault as read.
 * `doorOpen` — whether people may come in here (`earlyDoorOpen`); it never closes a way back to one's own money.
 */
export function entryStep(view: EarlyView | null, now: number, doorOpen: boolean): EntryStep {
  if (!view) return { kind: 'missing' };
  if (view.creation.state === 'PARTIAL') return { kind: 'broken' };
  if (view.creation.state === 'PENDING' || view.read === 'MISSING') return { kind: 'setting' };
  if (view.read === 'FAILED') return { kind: 'unread' };
  const s = view.schedule;
  const mine = view.mine;
  const mineRaw = mine?.depositedRaw ?? '0';
  if (now < s.depositStartsAt) return { kind: 'soon', opensAt: s.depositStartsAt, publicAt: s.activatesAt };
  if (now <= s.depositEndsAt) {
    const room = mine?.roomRaw ?? null;
    const full = view.rules.mode === 'FCFS' && big(view.depositedRaw) >= big(view.capRaw);
    return {
      kind: 'join',
      open: doorOpen && !full && (room === null || big(room) > 0n),
      depositedRaw: view.depositedRaw ?? '0',
      capRaw: view.capRaw,
      mineRaw,
      roomRaw: room,
      takeBack: view.rules.mode === 'PRO_RATA' && big(mineRaw) > 0n,
      closesAt: s.depositEndsAt,
      publicAt: s.activatesAt,
    };
  }
  if (now < s.activatesAt) {
    if (view.filled === false && big(view.depositedRaw) > 0n && now >= s.fillStartsAt) return { kind: 'fill', publicAt: s.activatesAt, mineRaw, depositedRaw: view.depositedRaw! };
    return { kind: 'wait', publicAt: s.activatesAt, filled: view.filled === true, empty: big(view.depositedRaw) === 0n, mineRaw };
  }
  if (mine && big(mine.claimableRaw) > 0n) return { kind: 'claim', amountRaw: mine.claimableRaw };
  if (mine && !mine.refunded && big(mine.remainingQuoteRaw) > 0n) return { kind: 'refund', amountRaw: mine.remainingQuoteRaw };
  return { kind: 'done', mineRaw };
}

/** The action a step's one button sends, or null where there is none. */
export function stepAction(step: EntryStep): 'DEPOSIT' | EntryAction | null {
  if (step.kind === 'join') return step.open ? 'DEPOSIT' : null;
  if (step.kind === 'fill') return 'FILL';
  if (step.kind === 'claim') return 'CLAIM';
  if (step.kind === 'refund') return 'WITHDRAW_REMAINING';
  return null;
}

/**
 * Whether the window asks for a wallet: where its step has an action, and once trading is open without one connected —
 * only a wallet says what is its own to take.
 */
export function wantsWallet(step: EntryStep, view: EarlyView | null): boolean {
  return stepAction(step) !== null || (step.kind === 'done' && view !== null && view.mine === null);
}

/**
 * Ryntra's share of this launch, in basis points, from the engine's terms (`view.terms.ryntraShareBps`, review 8.11):
 * the window says «takes nothing» only when the terms say 0; a figure not read is null and nothing is said of it.
 */
export function ryntraShare(view: EarlyView | null | undefined): number | null {
  const bps = view?.terms?.ryntraShareBps as number | undefined;
  return typeof bps === 'number' && Number.isSafeInteger(bps) && bps >= 0 && bps <= 10_000 ? bps : null;
}

/* ---------------------------------------------------------------- amounts */

/** USDC has six decimals. */
export const USDC_DECIMALS = 6;
/** The amounts a person taps instead of typing, in US dollars. */
export const ENTRY_AMOUNTS_USD = [50, 100, 500] as const;

/** Dollars as typed — «100», «2.5», «1,000» — as raw USDC; null when it is not an amount above zero. */
export function usdcRaw(text: string): string | null {
  const clean = text.replace(/[\s,_$]/g, '');
  if (!/^\d{1,9}(\.\d{0,6})?$/.test(clean)) return null;
  const [whole, part = ''] = clean.split('.');
  const raw = BigInt(whole!) * 1_000_000n + BigInt((part + '000000').slice(0, USDC_DECIMALS));
  return raw > 0n ? raw.toString() : null;
}

/** Raw units as a plain number for the eye: 1 234 500 000 with six decimals → 1234.5. Never sent back. */
export function units(raw: string | null | undefined, decimals = USDC_DECIMALS): number {
  const value = big(raw);
  const scale = 10n ** BigInt(decimals);
  return Number(value / scale) + Number(value % scale) / Number(scale);
}

/** Why an amount cannot go in: none typed, above what this wallet may still bring. Null — it may. */
export function amountProblem(raw: string | null, step: EntryStep): 'none' | 'room' | null {
  if (!raw) return 'none';
  if (step.kind === 'join' && step.roomRaw !== null && big(raw) > big(step.roomRaw)) return 'room';
  return null;
}
