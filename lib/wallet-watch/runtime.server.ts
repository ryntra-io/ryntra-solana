/**
 * The production side of «Стеження за гаманцями» (SOL-R4): mainnet as Ryntra reads it, Jupiter's catalogue for the
 * tickers and creators, and the monitoring delivery for the notes. Reads only.
 */

import { onlyRows } from "../assistant/watch/runtime.server.ts";
import type { GuardStore } from "../guard/store.ts";
import { deliverOutbox } from "../monitoring/service.server.ts";
import { productionChain, productionFacts } from "./chain.server.ts";
import { runWalletWatchPass } from "./run.ts";

export function runWalletWatches(store: GuardStore) {
  return runWalletWatchPass({
    store,
    chain: productionChain(),
    facts: productionFacts,
    clock: Date.now,
    /* This pass's own deliveries, sent at once through the monitoring delivery (Telegram, push, quiet hours, retries) — it sees only their rows. */
    deliver: (rows, atMs) => deliverOutbox(onlyRows(store, rows), atMs),
  });
}
