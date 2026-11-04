/**
 * Who may place a limit order from the city (CITY-97, Sell Higher · Buy Lower · the Wheel): the product's own switch,
 * on top of the engine's gate (`lib/liquidity/studio/gate.ts`, read alongside, never changed). The spec gives every
 * product of Earn its own switch, ceiling and stop. Three states, from `NEXT_PUBLIC_RYNTRA_CITY_EARN_LIMITS`:
 *
 * - `closed` (the default, and any value it does not know): the Shelf keeps its calm card; no route builds an order;
 * - `canary`: one wallet — named only in the server's environment, compared character for character — may place, up
 *   to `LIMIT_CANARY_CEILING_USD`; to everyone else it looks closed (the canary is not announced);
 * - `open`: everyone the engine admits, up to `LIMIT_CEILING_USD`.
 *
 * And a stop that needs no new build: `RYNTRA_CITY_EARN_LIMITS_STOP` set to anything stops new orders at once. It never
 * holds money in: cancelling an order — taking back what it holds — stays open whenever the engine allows it.
 *
 * Pure: the environment is passed in.
 */

export const LIMIT_MODE_ENV = 'NEXT_PUBLIC_RYNTRA_CITY_EARN_LIMITS';
export const LIMIT_CANARY_WALLET_ENV = 'RYNTRA_CITY_EARN_LIMITS_CANARY_WALLET';
export const LIMIT_STOP_ENV = 'RYNTRA_CITY_EARN_LIMITS_STOP';

export const LIMIT_MODES = ['closed', 'canary', 'open'] as const;
export type LimitMode = (typeof LIMIT_MODES)[number];

/** The canary's ceiling for one order, dollars at the venue's prices: the smallest live check. */
export const LIMIT_CANARY_CEILING_USD = 5;
/** One order's ceiling once open, dollars at the venue's prices. */
export const LIMIT_CEILING_USD = 1_000;

export type Env = Readonly<Record<string, string | undefined>>;

export function limitMode(value: string | undefined): LimitMode {
  const v = value?.trim().toLowerCase();
  return v === 'open' || v === 'canary' ? v : 'closed';
}

/** The mode this build was made with: what the window draws before it asks the server. */
export const LIMIT_MODE: LimitMode = limitMode(process.env.NEXT_PUBLIC_RYNTRA_CITY_EARN_LIMITS);

export function limitStopped(env: Env): boolean {
  const v = env[LIMIT_STOP_ENV]?.trim().toLowerCase();
  return Boolean(v) && v !== '0' && v !== 'false' && v !== 'off' && v !== 'no';
}

export type LimitAdmission = Readonly<{ ok: true; mode: Exclude<LimitMode, 'closed'>; ceilingUsd: number }> | Readonly<{ ok: false; code: 'LIMITS_CLOSED' | 'LIMITS_STOPPED' }>;

/** Whether this wallet may place a new order through the city now, and up to how much. */
export function admitLimitPlace(owner: string | null, env: Env): LimitAdmission {
  const mode = limitMode(env[LIMIT_MODE_ENV]);
  if (mode === 'closed') return { ok: false, code: 'LIMITS_CLOSED' };
  if (mode === 'canary') {
    const wallet = env[LIMIT_CANARY_WALLET_ENV]?.trim();
    if (!wallet || owner === null || owner !== wallet) return { ok: false, code: 'LIMITS_CLOSED' };
  }
  if (limitStopped(env)) return { ok: false, code: 'LIMITS_STOPPED' };
  return { ok: true, mode, ceilingUsd: mode === 'canary' ? LIMIT_CANARY_CEILING_USD : LIMIT_CEILING_USD };
}

/** Whether the city may cancel an order for this wallet: whenever the product is not closed to it — the stop does not apply. */
export function admitLimitExit(owner: string | null, env: Env): boolean {
  const mode = limitMode(env[LIMIT_MODE_ENV]);
  if (mode === 'open') return true;
  if (mode === 'canary') {
    const wallet = env[LIMIT_CANARY_WALLET_ENV]?.trim();
    return Boolean(wallet) && owner !== null && owner === wallet;
  }
  return false;
}

/** An order's worth against its ceiling: an order without a price is refused rather than guessed. */
export function withinLimitCeiling(usd: number | null, ceilingUsd: number): boolean {
  return usd !== null && Number.isFinite(usd) && usd > 0 && usd <= ceilingUsd;
}

/** What the window asks the server for one wallet. */
export type LimitStates = Readonly<{
  place: 'on' | 'off';
  exit: 'on' | 'off';
  /** One order's ceiling in dollars for this wallet now; null when it may not place. */
  ceilingUsd: number | null;
  /** New orders are stopped by the switch (cancelling still on). */
  stopped: boolean;
}>;

export type EngineStates = Readonly<{ add: Readonly<{ status: string }>; remove: Readonly<{ status: string }>; maxDepositUsd: number | null }>;

/** The city's admission and the engine's together: the lower ceiling, and on only where both say on. */
export function limitStates(owner: string | null, env: Env, engine: EngineStates): LimitStates {
  const place = admitLimitPlace(owner, env);
  const exit = admitLimitExit(owner, env) && engine.remove.status === 'on';
  const enginePlace = engine.add.status === 'on';
  const ceiling = place.ok && enginePlace ? (engine.maxDepositUsd === null ? place.ceilingUsd : Math.min(place.ceilingUsd, engine.maxDepositUsd)) : null;
  return {
    place: ceiling !== null ? 'on' : 'off',
    exit: exit ? 'on' : 'off',
    ceilingUsd: ceiling,
    // Said only to a wallet the product is open to: the canary is not announced to anyone else.
    stopped: !place.ok && place.code === 'LIMITS_STOPPED',
  };
}
