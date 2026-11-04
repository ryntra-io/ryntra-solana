/**
 * The ladder composer's one connection: devnet's endpoint, and no other
 * network. Every read, build, simulation and relay of the composer goes
 * through it (`build.server.ts`, `relay.server.ts`).
 */

import { Connection } from "@solana/web3.js";

import { resolveEndpoint } from "../../solana/rpc.ts";

let cached: { url: string; connection: Connection } | null = null;

export function ladderConnection(): Connection {
  const url = resolveEndpoint("devnet");
  if (!cached || cached.url !== url) cached = { url, connection: new Connection(url, { commitment: "confirmed", disableRetryOnRateLimit: true }) };
  return cached.connection;
}

/** Devnet's genesis hash: the chain itself says which network an endpoint serves, whatever its address says. */
export const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";

const verified = new WeakMap<object, true>();

/**
 * Whether a connection really serves devnet. The endpoint can be overridden (`RYNTRA_SOLANA_RPC_DEVNET`), so a wrong
 * address must not put a ladder on another network: every build, read and relay asks the chain first. A yes is kept per
 * connection; a no or no answer is asked again next time.
 */
export async function onDevnet(connection: Pick<Connection, "getGenesisHash">): Promise<boolean> {
  if (verified.has(connection)) return true;
  try {
    const ok = (await connection.getGenesisHash()) === DEVNET_GENESIS;
    if (ok) verified.set(connection, true);
    return ok;
  } catch {
    return false;
  }
}
