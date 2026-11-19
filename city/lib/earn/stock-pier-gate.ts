/**
 * Who may build or moor at a Stock Pier from the city, on top of Earn's own switch and the engine's gate
 * (`lib/liquidity/studio/gate.ts`, read alongside, never changed — its relay asks it again). The product's own switch,
 * from `NEXT_PUBLIC_RYNTRA_CITY_STOCK_PIER`:
 *
 * - `closed` (the default, and any value it does not know): the verified pairs read and show, and nothing is offered;
 * - `canary`: one wallet — named only in the server's environment and compared character for character — may build or
 *   moor; to everyone else it looks closed (the operator tries it first, decision 92);
 * - `open`: everyone the engine admits.
 *
 * No sum of Ryntra's on a build in either state.
 *
 * And a stop that needs no new build: `RYNTRA_CITY_STOCK_PIER_STOP` set to anything stops new money at once. It never
 * holds money in: taking fees and leaving stay open whenever the engine allows them.
 *
 * Pure: the environment is passed in.
 */

export const STOCK_PIER_MODE_ENV = 'NEXT_PUBLIC_RYNTRA_CITY_STOCK_PIER';
export const STOCK_PIER_CANARY_WALLET_ENV = 'RYNTRA_CITY_STOCK_PIER_CANARY_WALLET';
export const STOCK_PIER_STOP_ENV = 'RYNTRA_CITY_STOCK_PIER_STOP';

export const STOCK_PIER_MODES = ['closed', 'canary', 'open'] as const;
export type StockPierMode = (typeof STOCK_PIER_MODES)[number];

export type Env = Readonly<Record<string, string | undefined>>;

export function stockPierMode(value: string | undefined): StockPierMode {
  const v = value?.trim().toLowerCase();
  return v === 'open' || v === 'canary' ? v : 'closed';
}

/** The mode this build was made with: what the window draws before it asks the server. */
export const STOCK_PIER_MODE: StockPierMode = stockPierMode(process.env.NEXT_PUBLIC_RYNTRA_CITY_STOCK_PIER);

export function stockPierStopped(env: Env): boolean {
  const v = env[STOCK_PIER_STOP_ENV]?.trim().toLowerCase();
  return Boolean(v) && v !== '0' && v !== 'false' && v !== 'off' && v !== 'no';
}

function named(owner: string | null, env: Env): boolean {
  const wallet = env[STOCK_PIER_CANARY_WALLET_ENV]?.trim();
  return Boolean(wallet) && owner !== null && owner === wallet;
}

export type StockAdmission =
  | Readonly<{
      ok: true;
      mode: Exclude<StockPierMode, 'closed'>;
    }>
  | Readonly<{ ok: false; code: 'STOCK_PIER_CLOSED' | 'STOCK_PIER_STOPPED' }>;

/** Whether this wallet may put new money in at a Stock Pier now: no sum of Ryntra's on it. */
export function admitStockBuild(owner: string | null, env: Env): StockAdmission {
  const mode = stockPierMode(env[STOCK_PIER_MODE_ENV]);
  if (mode === 'closed' || (mode === 'canary' && !named(owner, env))) return { ok: false, code: 'STOCK_PIER_CLOSED' };
  if (stockPierStopped(env)) return { ok: false, code: 'STOCK_PIER_STOPPED' };
  return { ok: true, mode };
}

/** Taking fees and leaving: whenever the Stock Pier is not closed to this wallet — the stop never applies. */
export function admitStockExit(owner: string | null, env: Env): boolean {
  const mode = stockPierMode(env[STOCK_PIER_MODE_ENV]);
  return mode === 'open' || (mode === 'canary' && named(owner, env));
}

/** A deposit's worth, priced, against the engine's own bound if it names one (null — none): a deposit without a price is refused rather than guessed. */
export function withinStockCeiling(usd: number | null, ceilingUsd: number | null = null): boolean {
  return usd !== null && Number.isFinite(usd) && usd > 0 && (ceilingUsd === null || usd <= ceilingUsd);
}

export type StockPierStates = Readonly<{
  build: 'on' | 'off';
  exit: 'on' | 'off';
  /** The engine's own bound on one build in dollars, if it names one; null — none (no sum of Ryntra's). */
  ceilingUsd: number | null;
  /** New money stopped by the switch (exits still on). Said only to a wallet the product is open to. */
  stopped: boolean;
}>;

export type EngineStates = Readonly<{
  add: Readonly<{ status: string }>;
  remove: Readonly<{ status: string }>;
  maxDepositUsd: number | null;
}>;

/** The city's admission and the engine's together: on only where both say on. */
export function stockPierStates(owner: string | null, env: Env, engine: EngineStates): StockPierStates {
  const build = admitStockBuild(owner, env);
  const on = build.ok && engine.add.status === 'on';
  return {
    build: on ? 'on' : 'off',
    exit: admitStockExit(owner, env) && engine.remove.status === 'on' ? 'on' : 'off',
    ceilingUsd: on ? engine.maxDepositUsd : null,
    stopped: !build.ok && build.code === 'STOCK_PIER_STOPPED',
  };
}

export const CLOSED_STATES: StockPierStates = {
  build: 'off',
  exit: 'off',
  ceilingUsd: null,
  stopped: false,
};
