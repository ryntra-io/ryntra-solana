/**
 * Launch's own index of decoded transactions, and the market reader every
 * Launch read goes through.
 *
 * A confirmed transaction's trades never change. Once any instance has read
 * one from the node and decoded it, it is kept in the store under
 * `<cluster>:<token>:<fee wallet>:<signature>`, and every other instance —
 * a cold one first of all — reads the token's history from here and asks the
 * node only for what is new. The node is asked once per transaction, not once
 * per instance.
 *
 * Server-only: the Guard store of the deployment.
 */

import type { Connection } from "@solana/web3.js";

import { createLaunchMarketReader, type Decoded, type DecodedIndex, type LaunchMarketReader } from "../core/venues/meteora-dbc/market.server.ts";
import type { GuardStore } from "../guard/store.ts";
import { launchArchiveEndpoint, launchHistoryEndpoint, launchIndexedEndpoint, type LaunchNetwork } from "./config.server.ts";

type IndexedTransaction = Readonly<{ cluster: string; token: string; feeWallet: string; signature: string; decoded: Decoded }>;

export function launchDecodedIndex(store: GuardStore, cluster: string, feeWallet: string | null): DecodedIndex {
  const collection = store.collection<IndexedTransaction>("launchTradeIndex");
  const fee = feeWallet ?? "";
  const prefix = (token: string) => `${cluster}:${token}:${fee}:`;
  return {
    async load(token) {
      const rows = await collection.valuesWithPrefix(prefix(token));
      return new Map(rows.filter((row) => row.token === token && row.feeWallet === fee).map((row) => [row.signature, row.decoded]));
    },
    async save(token, signature, decoded) {
      await collection.insertIfAbsent(`${prefix(token)}${signature}`, { cluster, token, feeWallet: fee, signature, decoded });
    },
  };
}

/**
 * The market reader of a Launch read: this network's fee wallet, its endpoints for indexed reads, for whole signature
 * lists and for older transactions, and the shared index.
 */
export function launchMarketReader(deps: Readonly<{ network: LaunchNetwork; connection: Connection; store: GuardStore }>): LaunchMarketReader {
  return createLaunchMarketReader(deps.connection, {
    feeWallet: deps.network.feeWallet,
    indexed: launchIndexedEndpoint(deps.network),
    index: launchDecodedIndex(deps.store, deps.network.cluster, deps.network.feeWallet),
    history: launchHistoryEndpoint(deps.network),
    archive: launchArchiveEndpoint(deps.network),
  });
}
