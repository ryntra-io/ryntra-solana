/**
 * The one handler behind the three open reads of a DLMM Pro pool's tape: `/api/pro/pools/<address>/stats`,
 * `/trades` and `/fills`.
 *
 * The same door as the pool's own read (`app/api/pro/pools/[address]/route.ts`): the contract's major, the read
 * budget of a person's address, the gate of DLMM Pro; then the pool itself (`./read.server.ts`, kept twenty seconds),
 * whose coins name the sides; then its answer from the database (`./answers.server.ts`) — the day from the pool's own
 * row, the same the pools' table reads, the lists from its newest stored transactions. Where the database does not
 * hold the pool the instance reads the node for itself, as before (`./tape.server.ts`). Neither answering is
 * `UNAVAILABLE` (503) — never a day of zeros; a day only partly read answers what was read, and its `depth` says so.
 *
 * Public and read-only; kept fifteen seconds at the edge. An answer that saw the count grow old starts a step of the
 * indexer behind itself.
 */

import "server-only";

import { after, NextResponse } from "next/server";

import { apiFailure, apiHeaders } from "../api/v1/http.ts";
import { isPoolAddress } from "../earn-pools/bins.ts";
import { earnProGate } from "../earn-pro/gate.ts";
import { earnProClosed, openEarnProRead } from "../earn-pro/http.server.ts";
import { publicCacheHeaders, rateLimitHeaders } from "../http-control.ts";
import { ANSWER_CACHE, tapeAnswer, type TapeRead } from "./answers.server.ts";
import { readProPool } from "./read.server.ts";
import { proStore, restProStore, runProPoolsStep } from "./store.server.ts";
import { pageLimitOf, tapePoolOf, TAPE_PAGE_DEFAULT, TAPE_PAGE_MAX } from "./tape.ts";
import { readProTape } from "./tape.server.ts";

export type { TapeRead };

type Context = Readonly<{ params: Promise<{ address: string }> }>;

export function tapeRoute(kind: TapeRead) {
  return async function GET(request: Request, { params }: Context): Promise<NextResponse> {
    const door = openEarnProRead(request);
    if (!door.ok) return door.response;
    const gate = earnProGate(process.env);
    if (!gate.open) return earnProClosed(door.rate);
    const headers = rateLimitHeaders(door.rate);
    const { address } = await params;
    if (!isPoolAddress(address)) return apiFailure("VALIDATION_ERROR", "address: a pool's address.", { headers });
    const limit = kind === "stats" ? TAPE_PAGE_DEFAULT : pageLimitOf(new URL(request.url).searchParams.get("limit"));
    if (limit === null) return apiFailure("VALIDATION_ERROR", `limit: a whole number from 1 to ${TAPE_PAGE_MAX}.`, { headers });
    const row = await readProPool(gate.network, address).catch(() => undefined);
    if (row === undefined) return apiFailure("UNAVAILABLE", "The chain did not answer for the pool. Try again.", { headers });
    if (row === null) return apiFailure("EARN_PRO_NOT_A_PIER", "No Meteora DLMM Pro pool at the address.", { headers });
    const now = Date.now();
    const { network } = gate;
    const answer = await tapeAnswer({ network, store: proStore(now), row, kind, limit, now, memory: () => readProTape(network, tapePoolOf(row), now) });
    if (answer?.down) restProStore(now);
    if (answer?.step) after(() => runProPoolsStep(network).then(() => undefined, () => undefined));
    if (!answer) return apiFailure("UNAVAILABLE", "The chain did not answer for the pool's transactions. Try again.", { headers });
    return NextResponse.json(answer.body, { headers: { ...apiHeaders(), ...publicCacheHeaders(ANSWER_CACHE.fresh, ANSWER_CACHE.stale), ...headers, Vary: "X-Ryntra-API" } });
  };
}
