import type { DuelStore } from "./service.ts";

/**
 * When the duels answer people (CITY-51). Pure, so the rule is tested without a server; `server.ts` applies it.
 *
 * The duels' own switch must say `open` (`NEXT_PUBLIC_RYNTRA_CITY_RING_DUELS`, closed by default) on top of the
 * Ring's. In production the duel store must also be one every instance shares: the database
 * (`supabase/migrations/20261108120100_ring_v2_arena.sql`, CITY-217); on one instance's memory production stays closed.
 */
export function duelsReady(store: Pick<DuelStore, "durable">, flag: string | undefined, mode: string | undefined): boolean {
  return flag?.trim() === "open" && (store.durable || mode !== "production");
}

/** The harness's Ed25519 private key (PKCS#8 PEM) that stamps each seat's log: the server's environment, never the repository. */
export const STAMP_KEY_ENV = "RYNTRA_RING_STAMP_KEY";

/** The pool whose recorded candles Market Replay plays: an address, the market-data gateway's `solana:pool:<address>`. */
export const MARKET_POOL_ENV = "RYNTRA_RING_MARKET_POOL";

/** SOL/USDC on Orca, the pool Ryntra's fixtures name; a deployment may name another. */
export const DEFAULT_MARKET_POOL = "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE";

/** The day's ceiling on what the duels' models spend, in dollars (CITY-217). */
export const DAILY_CAP_ENV = "RYNTRA_RING_DAILY_USD";

/** The ceiling where the deployment names none, and the most it may name. */
export const DAILY_CAP_DEFAULT_USD = 5;
export const DAILY_CAP_MAX_USD = 500;

/**
 * The ceiling in micro-dollars: a number of dollars from 0 to `DAILY_CAP_MAX_USD` (0 — no duel with a model plays,
 * sparring between house agents still does); anything else is the default.
 */
export function dailyCapMicroUsd(value: string | undefined): number {
  const text = value?.trim();
  const usd = text && /^\d{1,4}(\.\d{1,2})?$/.test(text) ? Number(text) : DAILY_CAP_DEFAULT_USD;
  return Math.round(Math.min(usd, DAILY_CAP_MAX_USD) * 1_000_000);
}

/**
 * One move's time on the deployed server: a function lives at most `maxDuration` (300 s), and a duel plays in it after
 * the answer. Twenty steps of Market Replay at 12 s each fit with room for the writes; a model that has not answered
 * in 12 s is out of time for that move, as the published harness says for any limit.
 */
export const SERVER_MOVE_MS = 12_000;
