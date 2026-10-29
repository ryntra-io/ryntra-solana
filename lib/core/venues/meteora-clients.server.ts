/**
 * Meteora's SDK clients, one per connection (SOL-P1). Each client builds its programs' coders from their IDLs when it
 * is made — hundreds of milliseconds of processor — and holds nothing of a request: made once per connection, not
 * once per read. Under a crowd the server was busy building coders more than answering (profile 19.10: Anchor's
 * `typeDefLayout`/`fieldLayout` the hottest code on a token's page).
 *
 * The DBC client is the adapter's (`./meteora-dbc/sdk.server.ts`, SOL-L9): SDK 1.5.13 unless the flag names 2.0.0.
 */

import { CpAmm } from "@meteora-ag/cp-amm-sdk";
import type { Connection } from "@solana/web3.js";

import { createDbcClient, dbcSdkOf, type DbcClient, type DbcSdkVersion } from "./meteora-dbc/sdk.server.ts";

const DBC: Record<DbcSdkVersion, WeakMap<Connection, DbcClient>> = { "1.5.13": new WeakMap(), "2.0.0": new WeakMap() };
const DAMM = new WeakMap<Connection, CpAmm>();

/** The Dynamic Bonding Curve client of this connection, at `confirmed`, on the SDK the flag names. */
export function dbcClientOf(connection: Connection, sdk: DbcSdkVersion = dbcSdkOf()): DbcClient {
  let client = DBC[sdk].get(connection);
  if (!client) {
    client = createDbcClient(connection, sdk);
    DBC[sdk].set(connection, client);
  }
  return client;
}

/** The DAMM v2 client of this connection. */
export function cpAmmOf(connection: Connection): CpAmm {
  let client = DAMM.get(connection);
  if (!client) {
    client = new CpAmm(connection);
    DAMM.set(connection, client);
  }
  return client;
}
