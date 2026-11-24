import type { CreatorAction, CreatorAnswer, CreatorCoin, CreatorDid } from '../../../lib/spot/creator.ts';

/**
 * How the creator's tab reads the engine's answer: the answer checked for its shape, what the creator did
 * said in one line with its tone, and when each coin was launched. Pure: the words are the screen's.
 */

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const DIDS: readonly CreatorDid[] = ['holds', 'soldSome', 'soldAll', 'moved', 'never'];

function coinOf(raw: unknown): CreatorCoin | null {
  const row = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
  if (!row || typeof row.mint !== 'string' || !BASE58.test(row.mint)) return null;
  return {
    mint: row.mint,
    symbol: typeof row.symbol === 'string' && row.symbol ? row.symbol : null,
    name: typeof row.name === 'string' && row.name ? row.name : null,
    icon: row.icon === true,
    launchedAt: typeof row.launchedAt === 'string' ? row.launchedAt : null,
    capUsd: num(row.capUsd),
    peakCapUsd: num(row.peakCapUsd),
    listed: typeof row.listed === 'boolean' ? row.listed : null,
    current: row.current === true,
  };
}

function actionOf(raw: unknown): CreatorAction | null {
  const row = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
  if (!row || !DIDS.includes(row.did as CreatorDid)) return null;
  return {
    did: row.did as CreatorDid,
    soldPct: num(row.soldPct),
    movedPct: num(row.movedPct),
    holds: num(row.holds),
    holdsPct: num(row.holdsPct),
    movedTo: Array.isArray(row.movedTo) ? row.movedTo.filter((wallet): wallet is string => typeof wallet === 'string' && BASE58.test(wallet)) : [],
    moves: num(row.moves) ?? 0,
    whole: row.whole === true,
  };
}

/** The engine's answer, or null when it is not the creator's shape. */
export function creatorOf(body: unknown): CreatorAnswer | null {
  const row = body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
  if (!row || typeof row.creator !== 'string' || !BASE58.test(row.creator) || !Array.isArray(row.coins)) return null;
  return {
    creator: row.creator,
    launched: num(row.launched),
    listed: num(row.listed),
    coins: row.coins.map(coinOf).filter((coin): coin is CreatorCoin => coin !== null),
    coinsWhole: row.coinsWhole === true,
    action: actionOf(row.action),
    observedAt: typeof row.observedAt === 'string' ? row.observedAt : '',
    stale: row.stale === true,
  };
}

/** A share as the tab writes it: «30%», «1.5%», «0.04%», «<0.01%». */
export function shareText(pct: number): string {
  if (!Number.isFinite(pct) || pct <= 0) return '0%';
  if (pct < 0.01) return '<0.01%';
  const places = pct >= 10 ? 0 : pct >= 1 ? 1 : 2;
  return `${Number(pct.toFixed(places))}%`;
}

/**
 * What the creator did, for its one line: the word, its tone and the figure after it. Moving the coin to other wallets
 * and selling everything are a risk a person needs to see (`down`); selling part is a warning (`warn`); holding is plain;
 * never holding it is quiet.
 */
export type DidLine = Readonly<{
  did: CreatorDid;
  tone: 'down' | 'warn' | 'plain' | 'dim';
  /** The figure after the word: what share moved and to how many wallets, what share was sold, what is held now. */
  moved: Readonly<{ share: string; wallets: number }> | null;
  sold: string | null;
  holds: string | null;
  /** Nothing is left of what the creator had. */
  empty: boolean;
}>;

export function didLineOf(action: CreatorAction): DidLine {
  const tone: DidLine['tone'] = action.did === 'moved' || action.did === 'soldAll' ? 'down' : action.did === 'soldSome' ? 'warn' : action.did === 'never' ? 'dim' : 'plain';
  const moved = action.did === 'moved' && action.movedPct !== null ? { share: shareText(action.movedPct), wallets: Math.max(1, action.movedTo.length) } : null;
  const sold = (action.did === 'soldSome' || action.did === 'moved') && action.soldPct !== null && action.soldPct > 0 ? shareText(action.soldPct) : null;
  const holds = action.holdsPct !== null && action.holds !== null && action.holds > 0 ? shareText(action.holdsPct) : null;
  return { did: action.did, tone, moved, sold, holds, empty: action.holds === 0 && action.did !== 'never' };
}

/** When a coin was launched: minutes, hours or days ago within a month; past it, the date. */
export type Launched = Readonly<{ kind: 'ago'; unit: 'm' | 'h' | 'd'; n: number }> | Readonly<{ kind: 'date'; at: number }> | null;

export function launchedOf(at: string | null, now: number): Launched {
  const t = at ? Date.parse(at) : Number.NaN;
  if (!Number.isFinite(t)) return null;
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 3_600) return { kind: 'ago', unit: 'm', n: Math.max(1, Math.floor(s / 60)) };
  if (s < 86_400) return { kind: 'ago', unit: 'h', n: Math.floor(s / 3_600) };
  if (s < 30 * 86_400) return { kind: 'ago', unit: 'd', n: Math.floor(s / 86_400) };
  return { kind: 'date', at: t };
}

/** The creator's other coins first — what the tab is for — the newest first, and this coin last, for the measure. */
export function othersFirst(coins: readonly CreatorCoin[]): CreatorCoin[] {
  return [...coins.filter((coin) => !coin.current), ...coins.filter((coin) => coin.current)];
}
