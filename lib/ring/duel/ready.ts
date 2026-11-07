import type { DuelStore } from "./service.ts";

/**
 * When the duels answer people (CITY-51). Pure, so the rule is tested without a server; `server.ts` applies it.
 *
 * The duels' own switch must say `open` (`NEXT_PUBLIC_RYNTRA_CITY_RING_DUELS`, closed by default) on top of the
 * Ring's. In production the duel store must also be one every instance shares — there is none yet, so production keeps
 * the duels closed whatever the switches say.
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
