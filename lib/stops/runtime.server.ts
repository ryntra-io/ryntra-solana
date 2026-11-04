/**
 * The production side of the stops' cron (CITY-149): the stops' database, the swap engine's quote on mainnet, the
 * Guard store the monitoring engine reads, and the monitoring delivery for the notes (Telegram, the phone's push, the
 * browser's push, quiet hours, retries). Reads and writes notes only.
 */

import { onlyRows } from "../assistant/watch/runtime.server.ts";
import type { GuardStore } from "../guard/store.ts";
import { deliverOutbox } from "../monitoring/service.server.ts";
import { engineQuote } from "./quote.server.ts";
import { runStopsPass } from "./run.ts";
import { stopsStore } from "./server.ts";

export function runSpotStops(guard: GuardStore) {
  return runStopsPass({
    stops: stopsStore(),
    guard,
    quote: engineQuote,
    clock: Date.now,
    /* This pass's own deliveries, sent at once through the monitoring delivery — it sees only their rows. */
    deliver: (rows, atMs) => deliverOutbox(onlyRows(guard, rows), atMs),
  });
}
