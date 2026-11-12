import { FEE_SHARE_MAX_RECIPIENTS, FEE_SHARE_MIN_BPS, FEE_SHARE_TOTAL_BPS, TYPED_SHARES_OWNER_WORD, feeShareProblems, withCreatorShare, type FeeShare } from '../../../lib/core/launch/fee-shares.ts';
import type { Network } from './engine.ts';

/**
 * «Share earnings» in the city's launch (CITY-212): the creator's fees split between the creator and one to four more
 * wallets, written once at launch and never changed after — Meteora's Dynamic Fee Sharing, the engine's own vault and
 * handover (`lib/core/venues/meteora-dbc/fee-sharing.server.ts`). The city only says who gets what: it types the other
 * wallets and their parts, the creator keeps the rest, and the rule is the engine's (`feeShareProblems`).
 *
 * A door behind two locks (CITY-220), both shut by default:
 * - the city's switch, `NEXT_PUBLIC_RYNTRA_CITY_SHARE=open` — closed unless a deployment opens it, so the door can be
 *   shut again without a code change;
 * - the network: the devnet stand, and mainnet only on typed shares — the very value the engine
 *   reads (`TYPED_SHARES_OWNER_WORD`), so the door and the engine never disagree. The crews' word is another one.
 *
 * Pure and client-safe.
 */

/** One more wallet and its part of the creator's fees, in whole per cent as the sheet types it. */
export type ShareRow = Readonly<{ address: string; percent: number }>;

/** Besides the creator: one to four wallets — the program's two to five. */
export const SHARE_MAX_OTHERS = FEE_SHARE_MAX_RECIPIENTS - 1;
/** The least part a wallet takes, and the creator keeps: one per cent. */
export const SHARE_MIN_PERCENT = FEE_SHARE_MIN_BPS / 100;
/** A new row starts at a tenth, or what is left above the creator's least. */
export const SHARE_START_PERCENT = 10;

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** The city's switch for people: closed unless the deployment opens it. */
export const CITY_SHARE_SWITCH = process.env.NEXT_PUBLIC_RYNTRA_CITY_SHARE === 'open';

/** Whether the door shows on this network: the switch is open, and the network is the stand. */
export function shareOpen(network: Network | null, ownerWord: boolean = TYPED_SHARES_OWNER_WORD, switchOpen: boolean = CITY_SHARE_SWITCH): boolean {
  if (!switchOpen) return false;
  return network === 'solana:devnet' || (network === 'solana:mainnet' && ownerWord === true);
}

/** What the creator keeps, in per cent: everything the others do not take. */
export function keptPercent(rows: readonly ShareRow[]): number {
  return 100 - rows.reduce((total, row) => total + (Number.isFinite(row.percent) ? row.percent : 0), 0);
}

/** The others' rows as the engine takes them: basis points, addresses trimmed. */
export function othersOf(rows: readonly ShareRow[]): readonly FeeShare[] {
  return rows.map((row) => ({ address: row.address.trim(), bps: Math.round(row.percent * 100) }));
}

/** The whole split the engine is asked for — the creator first, keeping the rest — or null when nothing is shared. */
export function sharesOf(creator: string, rows: readonly ShareRow[]): readonly FeeShare[] | null {
  return rows.length ? withCreatorShare(creator, othersOf(rows)) : null;
}

/** The first thing to fix in the rows, as the sheet says it; null — they hold (or nothing is shared). */
export type ShareProblem = 'address' | 'repeated' | 'self' | 'small' | 'whole' | 'tooMuch' | 'tooMany';

export function shareProblem(rows: readonly ShareRow[], creator: string | null): ShareProblem | null {
  if (!rows.length) return null;
  if (rows.length > SHARE_MAX_OTHERS) return 'tooMany';
  const others = othersOf(rows);
  if (others.some((row) => !BASE58.test(row.address))) return 'address';
  if (creator !== null && others.some((row) => row.address === creator)) return 'self';
  if (new Set(others.map((row) => row.address)).size !== others.length) return 'repeated';
  if (rows.some((row) => !Number.isInteger(row.percent))) return 'whole';
  if (others.some((row) => row.bps < FEE_SHARE_MIN_BPS)) return 'small';
  if (keptPercent(rows) < SHARE_MIN_PERCENT) return 'tooMuch';
  /* The engine's own rule last, once the creator is known: whatever it would refuse, the sheet refuses first. */
  if (creator !== null && feeShareProblems(creator, withCreatorShare(creator, others)).length) return 'address';
  return null;
}

/** Two splits are one when the same wallets take the same parts in the same order. */
export function sameShares(a: readonly FeeShare[] | null | undefined, b: readonly FeeShare[] | null | undefined): boolean {
  const x = a ?? [];
  const y = b ?? [];
  return x.length === y.length && x.every((share, i) => share.address === y[i]!.address && share.bps === y[i]!.bps);
}

/** A row added after the last one: what is left above the creator's least, at most a tenth. */
export function nextRow(rows: readonly ShareRow[]): ShareRow {
  const room = keptPercent(rows) - SHARE_MIN_PERCENT;
  return { address: '', percent: Math.max(SHARE_MIN_PERCENT, Math.min(SHARE_START_PERCENT, room)) };
}

/** The total the program counts in: the creator's whole fee. */
export const SHARE_TOTAL_BPS = FEE_SHARE_TOTAL_BPS;
