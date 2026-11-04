import { randomBytes } from "node:crypto";

import { expiresAtOf, inputMintOf, MAX_STOPS, outputMintOf, STOP_ID, stopReached, stopThreshold, stopView, type EngineStop } from "./model.ts";
import type { StopCreate } from "./schema.ts";
import { StopsStoreUnavailable, type StopsStore } from "./store.ts";

/**
 * What the stop routes do (CITY-149), after the route has proved the wallet: plain inputs, a plain answer, so every
 * rule is tested without a server. The routes (`app/api/v1/stops/**`) prove the wallet first — a read takes the
 * wallet's proof, a change takes its own signature (Sign In With Solana) — and only hand the proven address here.
 *
 * The engine works out the stop's line itself from the side, the coins, the amount and the price, by the limits
 * engine's arithmetic; a client never names it. A stop that the swap engine's quote says is already reached is a
 * market order, not a stop, and is refused as one. Nothing here signs, sends or holds a key.
 */

export type StopsErrorCode = "STOP_NOT_FOUND" | "STOP_LIMIT" | "STOP_REACHED" | "STOP_INVALID" | "STOPS_CLOSED" | "UNAVAILABLE";

export const STOPS_ERROR_STATUS: Readonly<Record<StopsErrorCode, number>> = {
  STOP_NOT_FOUND: 404,
  STOP_LIMIT: 409,
  STOP_REACHED: 409,
  STOP_INVALID: 400,
  STOPS_CLOSED: 503,
  UNAVAILABLE: 503,
};

export type StopsAnswer = Readonly<{ status: number; body: unknown }>;

/** What the swap engine's quote says `amountRaw` of one mint brings of the other now; null when it could not say. */
export type QuoteNow = (input: Readonly<{ inputMint: string; outputMint: string; amountRaw: string }>) => Promise<string | null>;

export type StopsApiDeps = Readonly<{
  store: StopsStore;
  /** Whether stops are open on this deployment (`ready.ts`). */
  open: () => boolean;
  quote: QuoteNow;
  now: () => number;
  id?: () => string;
}>;

const failure = (code: StopsErrorCode, message: string): StopsAnswer => ({ status: STOPS_ERROR_STATUS[code], body: { error: { code, message } } });

/** A stop as a client reads it: its state as it stands now (an expired one says so before the cron writes it). */
export function stopForClient(stop: EngineStop, now: number) {
  return {
    id: stop.id,
    side: stop.side,
    base: stop.base,
    quote: stop.quote,
    amountRaw: stop.amountRaw,
    price: stop.price,
    thresholdRaw: stop.thresholdRaw,
    createdAt: stop.createdAt,
    expiresAt: stop.expiresAt,
    state: stopView(stop, now),
    reachedAt: stop.reachedAt,
  };
}

export const newStopId = () => `stp_${randomBytes(10).toString("hex")}`;

async function guarded(deps: StopsApiDeps, run: () => Promise<StopsAnswer>): Promise<StopsAnswer> {
  if (!deps.open()) return failure("STOPS_CLOSED", "Stops are not open here yet.");
  try {
    return await run();
  } catch (error) {
    if (error instanceof StopsStoreUnavailable) return failure("UNAVAILABLE", "Stops did not answer. Try again in a moment.");
    throw error;
  }
}

export function createStopsApi(deps: StopsApiDeps) {
  return {
    /** `GET /api/v1/stops` — the wallet's stops, the newest first. */
    list: (owner: string) =>
      guarded(deps, async () => {
        const now = deps.now();
        const stops = await deps.store.list(owner, now);
        return { status: 200, body: { stops: stops.map((stop) => stopForClient(stop, now)), max: MAX_STOPS } };
      }),

    /** `POST /api/v1/stops` — a new stop under the wallet. */
    create: (owner: string, input: StopCreate) =>
      guarded(deps, async () => {
        const now = deps.now();
        const terms = { side: input.side, base: input.base, quote: input.quote, amountRaw: input.amountRaw, price: input.price };
        const thresholdRaw = stopThreshold(terms);
        if (!thresholdRaw || thresholdRaw === "0") return failure("STOP_INVALID", "This amount and price make no stop.");
        const nowOut = await deps.quote({ inputMint: inputMintOf(terms), outputMint: outputMintOf(terms), amountRaw: input.amountRaw }).catch(() => null);
        if (nowOut !== null && stopReached({ thresholdRaw }, nowOut)) return failure("STOP_REACHED", "The price is already there: this is a market order.");
        const stop: EngineStop = {
          id: (deps.id ?? newStopId)(),
          owner,
          side: input.side,
          base: { ...input.base, name: input.base.name ?? input.base.symbol },
          quote: input.quote,
          amountRaw: input.amountRaw,
          price: input.price,
          thresholdRaw,
          locale: input.locale,
          createdAt: now,
          expiresAt: expiresAtOf(input.expiry, now),
          state: "watching",
          reachedAt: null,
          reachedOutRaw: null,
          updatedAt: now,
        };
        const kept = await deps.store.create(stop, MAX_STOPS, now);
        if (!kept.ok && kept.reason === "limit") return failure("STOP_LIMIT", `A wallet keeps at most ${MAX_STOPS} stops.`);
        if (!kept.ok) return failure("UNAVAILABLE", "The stop was not kept. Try again.");
        return { status: 201, body: { stop: stopForClient(stop, now) } };
      }),

    /** `DELETE /api/v1/stops/{id}` — let the stop go. A finished stop stays as it was. */
    cancel: (owner: string, id: string) =>
      guarded(deps, async () => {
        if (!STOP_ID.test(id)) return failure("STOP_NOT_FOUND", "No such stop.");
        const now = deps.now();
        const stop = await deps.store.cancel(owner, id, now);
        return stop ? { status: 200, body: { stop: stopForClient(stop, now) } } : failure("STOP_NOT_FOUND", "No such stop.");
      }),

    /** `PATCH /api/v1/stops/{id}` `{ state: "done" }` — the reached stop's sale settled. */
    finish: (owner: string, id: string) =>
      guarded(deps, async () => {
        if (!STOP_ID.test(id)) return failure("STOP_NOT_FOUND", "No such stop.");
        const now = deps.now();
        const stop = await deps.store.finish(owner, id, now);
        return stop ? { status: 200, body: { stop: stopForClient(stop, now) } } : failure("STOP_NOT_FOUND", "No such stop.");
      }),
  };
}

export type StopsApi = ReturnType<typeof createStopsApi>;
