import { unstable_cache } from "next/cache.js";

/**
 * A slow fact, read once for every instance of the deployment.
 *
 * A company's page reads the facts beside its price on every request — the
 * mint as the chain states it, the issuer's reserves and multiplier, the pool
 * the chart is drawn from — and each instance kept them only in its own
 * memory, so every cold instance paid the chain and two providers again:
 * measured on 2026-09-27, 1.2–2.5 s for a first visit against 0.3–0.4 s for a
 * second. The facts are cached and the price stays live: the platform's data
 * cache holds the facts for every instance; the price is not among them — it
 * comes from the catalogue's minute-fresh row and the page's own live read.
 *
 * Only an answer `ok` accepts is kept: a provider's silence is never served
 * for minutes, and the caller gets that answer as it came. After `seconds` the
 * kept copy is served while the next one is read behind it. Outside a Next
 * request (tests, scripts) the platform layer is absent and the read runs as
 * it always did.
 *
 * A read behind a kept copy that the provider refused. The
 * platform answers the old copy at once and reads behind it; a refusal thrown
 * there was logged as an error on every request («sharedRead: an answer that
 * is not kept», the chart source refusing the platform's shared addresses for
 * hours), and the copy stayed past its time, so every next request read the
 * refusing provider again. Now the copy that was served is kept as it is: the
 * same value, read at the same moment (the callers state its age from their
 * own `observedAt`), its time restarted — the provider is asked again after
 * `seconds`, not on every request, and nothing is logged. A first read with no
 * copy is refused as before: its caller gets the refusal.
 */
export async function sharedRead<T>(key: readonly string[], seconds: number, read: () => Promise<T>, ok: (value: T) => boolean): Promise<T> {
  let refused: Readonly<{ value: T }> | null = null;
  /* The copy the platform answered this call with, once it has: set only when the read did not wait on `read`. */
  let served: Readonly<{ value: T }> | null = null;
  const kept = unstable_cache(
    async (): Promise<T> => {
      const value = await read();
      if (ok(value)) return value;
      refused = { value };
      /* A read behind a served copy: the platform has already answered it by the next turn of the event loop. A first
         read is still awaited by the caller, so nothing has been served. */
      await nextTurn();
      if (served) return (served as { value: T }).value;
      throw new Error(NOT_KEPT);
    },
    ["shared-read", "v1", ...key],
    { revalidate: seconds },
  );
  try {
    const value = await kept();
    served = { value };
    return value;
  } catch (failure) {
    if (refused) return (refused as { value: T }).value;
    if (failure instanceof Error && /incrementalCache missing/.test(failure.message)) return read();
    throw failure;
  }
}

/** The refusal of a first read: never seen outside this file, its caller gets the refused answer. */
export const NOT_KEPT = "sharedRead: an answer that is not kept";

/** After everything the event loop already has to do now: a promise that settled with no wait has been seen. */
const nextTurn = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
