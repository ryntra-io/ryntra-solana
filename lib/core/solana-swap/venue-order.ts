/**
 * The venue's order for one intent, as the swap's prepare half asks it
 * (`./prepare.ts`, step `venue-order`): asked once more after the venue's own
 * 4xx or 5xx, the first refusal written to the log, and a refusal put in the
 * route's words. Kept apart from the pipeline so it is proven on its own.
 */

import { askOnceMoreAfterRefusal } from "../../solana/jupiter-ask-again.ts";
import type { JupiterExecutableOrderFailure } from "../../solana/quotes.ts";
import type { TradeIntent } from "../contracts.ts";
import { JupiterOrderRefusal, type JupiterQuote, type JupiterSwapVenue } from "../venues/jupiter.ts";
import { swapOrderLogLine } from "./refusal.ts";

/**
 * The venue's order for the intent, asked once more after its own 4xx or 5xx
 * (`askOnceMoreAfterRefusal`), the first refusal written to the log. A
 * refusal comes back as the venue's answer; anything else it throws is thrown.
 */
export async function askVenueOrder(
  venue: Pick<JupiterSwapVenue, "quote">,
  intent: TradeIntent,
  options: Readonly<{ sleep?: (ms: number) => Promise<void>; now?: () => number }> = {},
): Promise<Readonly<{ ok: true; quote: JupiterQuote }> | JupiterExecutableOrderFailure> {
  const askVenue = async () => {
    try {
      return { ok: true, quote: await venue.quote(intent) } as const;
    } catch (cause) {
      if (!(cause instanceof JupiterOrderRefusal)) throw cause;
      return cause.failure;
    }
  };
  return askOnceMoreAfterRefusal(askVenue, {
    noted: (first) => {
      if (!first.ok) console.warn(swapOrderLogLine("asked again", { ...venueRefusal(first), status: null }));
    },
    ...options,
  });
}

/** The venue's refusal in the route's words: its status, `ORDER_<code>`, the venue's own sentence, its error code and router. */
export function venueRefusal(failure: JupiterExecutableOrderFailure): Readonly<{ status: number; code: string; message: string; extra: object }> {
  const status =
    failure.code === "NO_ROUTE" || failure.code === "BUILD_FAILED"
      ? 409
      : failure.code === "RATE_LIMITED"
        ? 429
        : 502;
  return {
    status,
    code: `ORDER_${failure.code}`,
    message: failure.reason,
    extra: { provider: { errorCode: failure.errorCode, router: failure.router ?? null } },
  };
}
