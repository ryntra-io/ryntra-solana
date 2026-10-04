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
 * Only an answer `ok` accepts is kept: the callback throws on anything else,
 * so a provider's silence is never served for minutes, and the caller gets
 * that answer as it came. After `seconds` the kept copy is served while the
 * next one is read behind it. Outside a Next request (tests, scripts) the
 * platform layer is absent and the read runs as it always did.
 */
export async function sharedRead<T>(key: readonly string[], seconds: number, read: () => Promise<T>, ok: (value: T) => boolean): Promise<T> {
  let refused: Readonly<{ value: T }> | null = null;
  const kept = unstable_cache(
    async (): Promise<T> => {
      const value = await read();
      if (!ok(value)) {
        refused = { value };
        throw new Error("sharedRead: an answer that is not kept");
      }
      return value;
    },
    ["shared-read", "v1", ...key],
    { revalidate: seconds },
  );
  try {
    return await kept();
  } catch (failure) {
    if (refused) return (refused as { value: T }).value;
    if (failure instanceof Error && /incrementalCache missing/.test(failure.message)) return read();
    throw failure;
  }
}
