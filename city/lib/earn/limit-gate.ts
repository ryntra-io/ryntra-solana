/**
 * Who may place a limit order from the city (Sell Higher · Buy Lower · the Wheel): the product's own switch,
 * on top of the engine's gate (`lib/liquidity/studio/gate.ts`, read alongside, never changed). The spec gives every
 * product of Earn its own switch and stop. Three states, from `NEXT_PUBLIC_RYNTRA_CITY_EARN_LIMITS`:
 *
 * - `closed` (the default, and any value it does not know): the Shelf keeps its calm card; no route builds an order;
 * - `canary`: one wallet — named only in the server's environment, compared character for character — may place; to
 *   everyone else it looks closed (the operator tries it first, decision 92);
 * - `open`: everyone the engine admits.
 *
 * No sum of Ryntra's on an order in either state: an order is
 * what the person asks and holds. The engine's own bound, if it ever names one, still applies.
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

export type LimitAdmission = Readonly<{ ok: true; mode: Exclude<LimitMode, 'closed'> }> | Readonly<{ ok: false; code: 'LIMITS_CLOSED' | 'LIMITS_STOPPED' }>;

/** Whether this wallet may place a new order through the city now: no sum of Ryntra's on it. */
export function admitLimitPlace(owner: string | null, env: Env): LimitAdmission {
  const mode = limitMode(env[LIMIT_MODE_ENV]);
  if (mode === 'closed') return { ok: false, code: 'LIMITS_CLOSED' };
  if (mode === 'canary') {
    const wallet = env[LIMIT_CANARY_WALLET_ENV]?.trim();
    if (!wallet || owner === null || owner !== wallet) return { ok: false, code: 'LIMITS_CLOSED' };
  }
  if (limitStopped(env)) return { ok: false, code: 'LIMITS_STOPPED' };
  return { ok: true, mode };
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

/** An order's worth, priced, against the engine's own bound if it names one (null — none): an order without a price is refused rather than guessed. */
export function withinLimitCeiling(usd: number | null, ceilingUsd: number | null): boolean {
  return usd !== null && Number.isFinite(usd) && usd > 0 && (ceilingUsd === null || usd <= ceilingUsd);
}

/** What the window asks the server for one wallet. */
export type LimitStates = Readonly<{
  place: 'on' | 'off';
  exit: 'on' | 'off';
  /** The engine's own bound on one order in dollars, if it names one; null — none (no sum of Ryntra's). */
  ceilingUsd: number | null;
  /** New orders are stopped by the switch (cancelling still on). */
  stopped: boolean;
}>;

export type EngineStates = Readonly<{ add: Readonly<{ status: string }>; remove: Readonly<{ status: string }>; maxDepositUsd: number | null }>;

/** The city's admission and the engine's together: on only where both say on. */
export function limitStates(owner: string | null, env: Env, engine: EngineStates): LimitStates {
  const place = admitLimitPlace(owner, env);
  const exit = admitLimitExit(owner, env) && engine.remove.status === 'on';
  const on = place.ok && engine.add.status === 'on';
  return {
    place: on ? 'on' : 'off',
    exit: exit ? 'on' : 'off',
    ceilingUsd: on ? engine.maxDepositUsd : null,
    // Said only to a wallet the product is open to: the canary is not announced to anyone else.
    stopped: !place.ok && place.code === 'LIMITS_STOPPED',
  };
}
