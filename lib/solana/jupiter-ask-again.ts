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
