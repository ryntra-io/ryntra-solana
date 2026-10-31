/**
 * What the window asks the server about the stocks a wallet holds, and what it gets back: for each mint that carries
 * the Scaled UI Amount extension (an xStock and its kin), the multiplier the chain states now and the one step of
 * history the extension keeps. A mint without the extension is no such stock and is left out.
 */

export type ScaledConfig = Readonly<{
  mint: string;
  multiplier: number;
  newMultiplier: number;
  newMultiplierEffectiveAt: string | null;
}>;

export type StocksAnswer = Readonly<{ stocks: readonly ScaledConfig[]; at: string }>;

/** The most mints one ask carries. */
export const MAX_STOCK_MINTS = 24;

const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** The mints of a query, checked, unique, at most {@link MAX_STOCK_MINTS}. */
export function mintsOf(query: string | null): string[] {
  if (!query) return [];
  return [...new Set(query.split(',').map((m) => m.trim()).filter((m) => MINT.test(m)))].slice(0, MAX_STOCK_MINTS);
}

export function readStocks(raw: unknown): ScaledConfig[] {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { stocks?: unknown }).stocks)) return [];
  const out: ScaledConfig[] = [];
  for (const entry of (raw as { stocks: unknown[] }).stocks) {
    if (!entry || typeof entry !== 'object') continue;
    const v = entry as Record<string, unknown>;
    if (typeof v.mint !== 'string' || !MINT.test(v.mint)) continue;
    if (typeof v.multiplier !== 'number' || typeof v.newMultiplier !== 'number' || !(v.multiplier > 0) || !(v.newMultiplier > 0)) continue;
    const at = typeof v.newMultiplierEffectiveAt === 'string' && Number.isFinite(Date.parse(v.newMultiplierEffectiveAt)) ? v.newMultiplierEffectiveAt : null;
    out.push({ mint: v.mint, multiplier: v.multiplier, newMultiplier: v.newMultiplier, newMultiplierEffectiveAt: at });
  }
  return out;
}

/** The multiplier in force at `nowMs`: the new one once its time has come. */
export function activeMultiplier(config: ScaledConfig, nowMs: number): number {
  const at = config.newMultiplierEffectiveAt === null ? Number.NaN : Date.parse(config.newMultiplierEffectiveAt);
  return Number.isFinite(at) && at <= nowMs ? config.newMultiplier : config.multiplier;
}
