import { after, NextResponse } from "next/server";

import { apiFailure, apiHeaders, apiMajorRefusal } from "@/lib/api/v1/http";
import { earnProGate } from "@/lib/earn-pro/gate";
import { earnProClosed } from "@/lib/earn-pro/http.server";
import { publicCacheHeaders } from "@/lib/http-control";
import { ANSWER_CACHE, daysAnswer } from "@/lib/pro-pools/answers.server";
import { readProDays } from "@/lib/pro-pools/days.server";
import { readProPools } from "@/lib/pro-pools/read.server";
import { proStore, restProStore, runProPoolsStep } from "@/lib/pro-pools/store.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `GET /api/pro/pools/days` — the day of every listed Meteora DLMM Pro pool in one answer, for the pools' table: each
 * pool `ready` (counted at `at`, from the depth `depth`, `stats` as `/api/pro/pools/<address>/stats` says them),
 * `counting` (not counted yet) or `unknown` (the node kept refusing it).
 *
 * One read of the database (`lib/pro-pools/answers.server.ts`): the rows the indexer counted, the same a pool's own
 * page reads — so the two say one number, whichever instance answers. An answer that saw the count grow old starts a
 * step of the indexer behind itself (the cron does every minute; the lease lets one through). Where the database does
 * not answer, the instance counts for itself as before (`lib/pro-pools/days.server.ts`).
 *
 * Its cost does not grow with the people asking, so it spends no one's read budget: the table's own read is never
 * refused for being busy. Public and read-only; kept fifteen seconds at the edge.
 */
export async function GET(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const gate = earnProGate(process.env);
  if (!gate.open) return earnProClosed();
  const { network } = gate;
  const now = Date.now();
  const result = await daysAnswer({
    network,
    store: proStore(now),
    pools: async () => (await readProPools(network)).pools,
    memory: (rows) => readProDays(network, rows),
    now,
  });
  if (result?.down) restProStore(now);
  if (result?.step) after(() => runProPoolsStep(network).then(() => undefined, () => undefined));
  if (!result) return apiFailure("UNAVAILABLE", "The chain did not answer for the pools. Try again.");
  const { refresh } = result;
  if (refresh) after(() => refresh.catch(() => undefined));
  return NextResponse.json(result.answer, { headers: { ...apiHeaders(), ...publicCacheHeaders(ANSWER_CACHE.fresh, ANSWER_CACHE.stale), Vary: "X-Ryntra-API" } });
}
