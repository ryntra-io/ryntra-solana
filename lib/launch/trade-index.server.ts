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
import { addressHistoryOf } from "../core/history/address-history.ts";
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
      const key = `${prefix(token)}${signature}`;
      const row = { cluster, token, feeWallet: fee, signature, decoded };
      if (await collection.insertIfAbsent(key, row)) return;
      /* Written once — except a decode made before `marks` (SOL-L2), which the same transaction read again replaces. */
      const kept = await collection.get(key);
      if (kept && !kept.decoded.marks && decoded.marks) await collection.set(key, row);
    },
  };
}

/**
 * The market reader of a Launch read: this network's fee wallet and referral owner, its endpoints for indexed reads, for
 * whole signature lists and for older transactions, and the shared index. Where the history endpoint is Helius on
 * mainnet, its Parsed Events Scan finds the signatures first (CITY-245); elsewhere there is none and the node is paged.
 */
export function launchMarketReader(deps: Readonly<{ network: LaunchNetwork; connection: Connection; store: GuardStore }>): LaunchMarketReader {
  return createLaunchMarketReader(deps.connection, {
    feeWallet: deps.network.feeWallet,
    referralOwner: deps.network.referralOwner,
    indexed: launchIndexedEndpoint(deps.network),
    index: launchDecodedIndex(deps.store, deps.network.cluster, deps.network.feeWallet),
    history: launchHistoryEndpoint(deps.network),
    archive: launchArchiveEndpoint(deps.network),
    scan: deps.network.cluster === "mainnet" ? addressHistoryOf(launchHistoryEndpoint(deps.network)) : null,
  });
}
