/**
 * The price of starting a launch from a set.
 *
 * Today every set is free: no launch from a set pays anything more than a launch without one, and the screen says
 * nothing about a price. The setting only names the figure for when the operator turns it on: Meteora DBC carries a pool
 * creation fee on a config (0.001–100 SOL, 90 % of it the partner's), and a set's own config with that fee is where a
 * launchpad starting from Ryntra's set would pay it. Until that config exists the figure is read by the sets' read for
 * launchpads and nowhere else — no transaction carries it.
 *
 * `RYNTRA_LAUNCH_SET_USE_FEE_LAMPORTS`: whole lamports; absent, zero or anything outside DBC's bounds — zero.
 */

export const SET_USE_FEE_ENV = "RYNTRA_LAUNCH_SET_USE_FEE_LAMPORTS";

/** DBC's own bounds of a pool creation fee: 0.001 SOL to 100 SOL. */
export const SET_USE_FEE_BOUNDS = Object.freeze({ minLamports: 1_000_000, maxLamports: 100_000_000_000 });

/** The price of starting from a set, in lamports; zero unless the operator set a figure within DBC's bounds. */
export function setUseFeeLamports(env: Readonly<Record<string, string | undefined>> = process.env): number {
  const raw = env[SET_USE_FEE_ENV]?.trim();
  if (!raw || !/^\d+$/.test(raw)) return 0;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= SET_USE_FEE_BOUNDS.minLamports && value <= SET_USE_FEE_BOUNDS.maxLamports ? value : 0;
}
