/**
 * Who may act on a SOL pier from the city (CITY-93): the Harbor's own switch, on top of the engine's gate
 * (`lib/liquidity/studio/gate.ts`, which this file only reads alongside, never changes). Three states, from
 * `NEXT_PUBLIC_RYNTRA_CITY_HARBOR`:
 *
 * - `closed` (the default, and any value it does not know): the Piers read and show, and offer nothing;
 * - `canary`: one wallet — the owner's, named only in the server's environment and compared character for character —
 *   may add, up to `PIER_CANARY_CEILING_USD`; to everyone else the Piers look closed (the canary is not announced);
 * - `open`: everyone the engine admits, up to the ceiling of the venue.
 *
 * And one switch that needs no new build: `RYNTRA_CITY_HARBOR_STOP` set to anything stops new money going in at once.
 * It never traps money: taking fees and leaving a position stay open whenever the engine allows them.
 *
 * Pure: the environment is passed in.
 */

import { depositUsd } from '../../../lib/liquidity/studio/gate.ts';
import { SOLANA_MAINNET_USDC_MINT } from '../../../lib/solana/send-kinds.ts';
import { LST_BY_MINT, SOL_MINT } from './lst.ts';

export const PIER_MODE_ENV = 'NEXT_PUBLIC_RYNTRA_CITY_HARBOR';
export const PIER_CANARY_WALLET_ENV = 'RYNTRA_CITY_HARBOR_CANARY_WALLET';
export const PIER_STOP_ENV = 'RYNTRA_CITY_HARBOR_STOP';

export const PIER_MODES = ['closed', 'canary', 'open'] as const;
export type PierMode = (typeof PIER_MODES)[number];

/** The canary's ceiling for one add, dollars at the venue's prices: the smallest live check. */
export const PIER_CANARY_CEILING_USD = 5;

/**
 * The ceiling for one add on each venue once open, dollars at the venue's prices. The SOL Pier builds on DLMM only;
 * a venue not named here takes no add from the city.
 */
export const PIER_CEILING_USD: Readonly<Record<string, number>> = { 'meteora-dlmm': 1_000 };

export type Env = Readonly<Record<string, string | undefined>>;

export function pierMode(value: string | undefined): PierMode {
  const v = value?.trim().toLowerCase();
  return v === 'open' || v === 'canary' ? v : 'closed';
}

/** The mode this build was made with: what the window draws before it asks the server. */
export const PIER_MODE: PierMode = pierMode(process.env.NEXT_PUBLIC_RYNTRA_CITY_HARBOR);

export function pierStopped(env: Env): boolean {
  const v = env[PIER_STOP_ENV]?.trim().toLowerCase();
  return Boolean(v) && v !== '0' && v !== 'false' && v !== 'off' && v !== 'no';
}

export type PierAdmission =
  | Readonly<{ ok: true; mode: Exclude<PierMode, 'closed'>; ceilingUsd: number }>
  | Readonly<{ ok: false; code: 'PIER_CLOSED' | 'PIER_STOPPED' | 'PIER_VENUE' }>;

/** Whether this wallet may put new money in on this venue through the city now, and up to how much. */
export function admitPierAdd(owner: string | null, venue: string, env: Env): PierAdmission {
  const mode = pierMode(env[PIER_MODE_ENV]);
  if (mode === 'closed') return { ok: false, code: 'PIER_CLOSED' };
  if (mode === 'canary') {
    const wallet = env[PIER_CANARY_WALLET_ENV]?.trim();
    if (!wallet || owner === null || owner !== wallet) return { ok: false, code: 'PIER_CLOSED' };
  }
  if (pierStopped(env)) return { ok: false, code: 'PIER_STOPPED' };
  const venueCeiling = Object.hasOwn(PIER_CEILING_USD, venue) ? PIER_CEILING_USD[venue]! : 0;
  if (!(venueCeiling > 0)) return { ok: false, code: 'PIER_VENUE' };
  return { ok: true, mode, ceilingUsd: mode === 'canary' ? Math.min(PIER_CANARY_CEILING_USD, venueCeiling) : venueCeiling };
}

/**
 * Whether the city path may take fees from or leave a position: whenever the Harbor is not closed to this wallet — the
 * stop does not apply, so nobody's money is ever held in by it. The engine's gate still decides.
 */
export function admitPierExit(owner: string | null, env: Env): boolean {
  const mode = pierMode(env[PIER_MODE_ENV]);
  if (mode === 'open') return true;
  if (mode === 'canary') {
    const wallet = env[PIER_CANARY_WALLET_ENV]?.trim();
    return Boolean(wallet) && owner !== null && owner === wallet;
  }
  return false;
}

/** An add's worth against its ceiling: a deposit without a price is refused rather than guessed. */
export function withinCeiling(depositUsd: number | null, ceilingUsd: number): boolean {
  return depositUsd !== null && Number.isFinite(depositUsd) && depositUsd > 0 && depositUsd <= ceilingUsd;
}

/** SOL against USDC or an LST of the SOL Saver: the only pairs the city's SOL Pier builds. */
export function isSolPair(xMint: string, yMint: string): boolean {
  const other = xMint === SOL_MINT ? yMint : yMint === SOL_MINT ? xMint : null;
  return other !== null && other !== SOL_MINT && (other === SOLANA_MAINNET_USDC_MINT || LST_BY_MINT.has(other));
}

type PricedToken = Readonly<{ mint: string; decimals: number | null; priceUsd: number | null }>;

export type AddCheck = Readonly<{ ok: true; usd: number }> | Readonly<{ ok: false; code: 'PIER_PAIR' | 'PIER_UNPRICED' | 'PIER_CEILING' }>;

/**
 * Before anything is built: the pool is a SOL pier, and the most the add can put in — the amounts asked, which the
 * engine never exceeds — is within the ceiling at the venue's own prices of those very mints.
 */
export function checkPierAdd(amounts: Readonly<{ amountX: string; amountY: string }>, pool: Readonly<{ x: PricedToken; y: PricedToken }> | null, ceilingUsd: number): AddCheck {
  if (!pool || !isSolPair(pool.x.mint, pool.y.mint)) return { ok: false, code: 'PIER_PAIR' };
  if (pool.x.decimals === null || pool.y.decimals === null) return { ok: false, code: 'PIER_UNPRICED' };
  const usd = depositUsd(
    { x: { units: amounts.amountX, decimals: pool.x.decimals }, y: { units: amounts.amountY, decimals: pool.y.decimals } },
    { x: pool.x.priceUsd, y: pool.y.priceUsd },
  );
  if (usd === null) return { ok: false, code: 'PIER_UNPRICED' };
  return withinCeiling(usd, ceilingUsd) ? { ok: true, usd } : { ok: false, code: 'PIER_CEILING' };
}

/** What the window asks the server for one wallet: the city's word joined with the engine's states. */
export type PierStates = Readonly<{
  add: 'on' | 'off';
  exit: 'on' | 'off';
  /** The add's ceiling in dollars for this wallet now; null when it may not add. */
  ceilingUsd: number | null;
  /** New money is stopped by the switch (exits still on). */
  stopped: boolean;
}>;

export type EngineStates = Readonly<{ add: Readonly<{ status: string }>; remove: Readonly<{ status: string }>; claim: Readonly<{ status: string }>; maxDepositUsd: number | null }>;

/** The city's admission and the engine's together: the lower ceiling, and on only where both say on. */
export function pierStates(owner: string | null, env: Env, engine: EngineStates): PierStates {
  const add = admitPierAdd(owner, 'meteora-dlmm', env);
  const exit = admitPierExit(owner, env) && engine.remove.status === 'on';
  const engineAdd = engine.add.status === 'on';
  const ceiling = add.ok && engineAdd ? (engine.maxDepositUsd === null ? add.ceilingUsd : Math.min(add.ceilingUsd, engine.maxDepositUsd)) : null;
  return {
    add: ceiling !== null ? 'on' : 'off',
    exit: exit ? 'on' : 'off',
    ceilingUsd: ceiling,
    // Said only to a wallet the Harbor is open to: the canary is not announced to anyone else.
    stopped: !add.ok && add.code === 'PIER_STOPPED',
  };
}
