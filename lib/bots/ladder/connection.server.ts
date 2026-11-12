/**
 * The ladder composer's connections: one per network, on that network's own
 * endpoint. Every read, build, simulation and relay of the composer goes
 * through the connection of the network the request names (`build.server.ts`,
 * `relay.server.ts`), and the chain is asked which network it is before any of
 * them.
 */

import { Connection } from "@solana/web3.js";

import { resolveEndpoint } from "../../solana/rpc.ts";
import type { LadderNetwork } from "./network.ts";

const cached = new Map<LadderNetwork, { url: string; connection: Connection }>();

export function ladderConnection(network: LadderNetwork = "devnet"): Connection {
  const url = resolveEndpoint(network);
  const kept = cached.get(network);
  if (kept && kept.url === url) return kept.connection;
  const connection = new Connection(url, { commitment: "confirmed", disableRetryOnRateLimit: true });
  cached.set(network, { url, connection });
  return connection;
}

/** Devnet's genesis hash: the chain itself says which network an endpoint serves, whatever its address says. */
export const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
/** Mainnet-beta's genesis hash. */
export const MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";

export const GENESIS: Readonly<Record<LadderNetwork, string>> = { devnet: DEVNET_GENESIS, mainnet: MAINNET_GENESIS };

const verified = new WeakMap<object, LadderNetwork>();

/**
 * Whether a connection really serves the network. An endpoint can be overridden (`RYNTRA_SOLANA_RPC_DEVNET`,
 * `RYNTRA_SOLANA_RPC_MAINNET`), so a wrong address must not put a ladder on another network: every build, read and
 * relay asks the chain first. A yes is kept per connection; a no or no answer is asked again next time.
 */
export async function onNetwork(connection: Pick<Connection, "getGenesisHash">, network: LadderNetwork): Promise<boolean> {
  if (verified.get(connection) === network) return true;
  try {
    const ok = (await connection.getGenesisHash()) === GENESIS[network];
    if (ok) verified.set(connection, network);
    return ok;
  } catch {
    return false;
  }
}

/** Devnet's own check, as CITY-135 named it. */
export const onDevnet = (connection: Pick<Connection, "getGenesisHash">): Promise<boolean> => onNetwork(connection, "devnet");
