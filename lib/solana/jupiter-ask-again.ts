/**
 * One more ask of Jupiter after a refusal for rate alone.
 *
 * The rule: a person's own request is never refused to protect the budget, and
 * a read that moves nothing may be asked once more after the provider's own
 * pause, when that pause is short enough to be worth it (`retryWaitMs`, at most
 * `JUPITER_RETRY_WAIT_MAX_MS`). Only once: a longer reset, or a second refusal,
 * is answered as it is — no loop, no storm.
 *
 * Since 2026-09-28 the signable order is asked the same way: the order route
 * crosses no lock and stores no Review before the provider answers, so a second
 * ask can build at most the one Review the first would have — and the person's
 * press is not lost to the shared window. The order may wait longer than a read
 * (`JUPITER_ORDER_RETRY_WAIT_MAX_MS`, the window's own ten seconds): a $1
 * purchase that day was refused with the reset 4 s away. `/execute` is never
 * asked again.
 */

import { JUPITER_RETRY_WAIT_MAX_MS } from "./jupiter-budget.ts";

type Answer = Readonly<{ ok: true }> | Readonly<{ ok: false; code: string; retryWaitMs?: number | null }>;

type Options = Readonly<{
  sleep?: (ms: number) => Promise<void>;
  /** The longest pause worth waiting for: a read's 2.5 s unless the caller names its own. */
  maxWaitMs?: number;
}>;

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The provider's own pause after a refusal for rate alone, when it is worth waiting; otherwise null. */
export function rateWaitOf(answer: Answer, maxWaitMs: number = JUPITER_RETRY_WAIT_MAX_MS): number | null {
  if (answer.ok || answer.code !== "RATE_LIMITED") return null;
  const wait = answer.retryWaitMs;
  return typeof wait === "number" && Number.isFinite(wait) && wait >= 0 && wait <= maxWaitMs ? wait : null;
}

/** Ask; after a refusal for rate alone with a short enough pause, wait that pause and ask once more. */
export async function askOnceMoreAfterRate<T extends Answer>(ask: () => Promise<T>, options: Options = {}): Promise<T> {
  const first = await ask();
  const wait = rateWaitOf(first, options.maxWaitMs);
  if (wait === null) return first;
  await (options.sleep ?? pause)(wait);
  return ask();
}

/**
 * The pause before the signable order is asked again after the venue's own
 * 4xx or 5xx. Production on 2026-10-03 and 10-04 carried `ORDER_REFUSED` two
 * and three times within seconds, and the next press passed: the venue would
 * not build the order for a moment. A second — the venue's moment, and well
 * inside the press a person is waiting on.
 */
export const JUPITER_ORDER_REFUSAL_PAUSE_MS = 1_000;

/**
 * A first answer that took longer than this is not asked again: the order
 * route has sixty seconds (`maxDuration`), and a second ask may itself take
 * up to ~26 s (a fetch, the rate window's ten, a fetch) before the simulation
 * and the proof — so ten for the first, one for the pause, and the rest is
 * kept. The refusal is said instead — the person may press again.
 */
export const JUPITER_ORDER_REFUSAL_ASK_AGAIN_WITHIN_MS = 10_000;

/** The venue answered the order with its own 4xx (`REFUSED`) or 5xx (`HTTP_ERROR`) — never its rate, a missing route or a wallet short of funds. */
export function refusedForAMoment(answer: Answer): boolean {
  return !answer.ok && (answer.code === "REFUSED" || answer.code === "HTTP_ERROR");
}

/**
 * Ask; after the venue's own 4xx or 5xx, pause and ask once more — the
 * signable order only, in the swap's prepare half, where nothing is locked,
 * stored or signed before the venue answers (the owner's lock is reserved at
 * its very end), so the second ask builds at most the one Review the first
 * would have. Once: a second refusal is the answer. `/execute` is never asked
 * again. `noted` hears the first refusal, for the log.
 */
export async function askOnceMoreAfterRefusal<T extends Answer>(
  ask: () => Promise<T>,
  options: Readonly<{ sleep?: (ms: number) => Promise<void>; pauseMs?: number; noted?: (first: T) => void; now?: () => number }> = {},
): Promise<T> {
  const now = options.now ?? Date.now;
  const started = now();
  const first = await ask();
  if (!refusedForAMoment(first)) return first;
  if (now() - started > JUPITER_ORDER_REFUSAL_ASK_AGAIN_WITHIN_MS) return first;
  options.noted?.(first);
  await (options.sleep ?? pause)(options.pauseMs ?? JUPITER_ORDER_REFUSAL_PAUSE_MS);
  return ask();
}
