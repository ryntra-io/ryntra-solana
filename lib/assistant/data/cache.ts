/**
 * A small read cache for the assistant's public sources (AI-03).
 *
 * One answer per key, kept `ttlMs` as fresh; after that a failed read falls
 * back to the last good answer for `staleMs`, marked stale, so a source that
 * blinks does not turn a figure into «unavailable»; one read per key in
 * flight, so a hundred questions about SOL in the same second make one
 * request. A refusal with no good answer to stand in is remembered for
 * `failMs`, so a source that answers 429 is not asked again by every
 * question. The map is bounded: the oldest key falls off first.
 *
 * Pure apart from the clock it is handed: no fetch, no store.
 */

export type CachedRead<T> = Readonly<{ ok: true; value: T; observedAt: string; stale: boolean }> | Readonly<{ ok: false; reason: string }>;

type Entry<T> = { value: T; at: number };

export type ReadCache<T> = Readonly<{
  read(key: string, load: () => Promise<Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; reason: string }>>): Promise<CachedRead<T>>;
  reset(): void;
  size(): number;
}>;

export function createReadCache<T>(input: Readonly<{ ttlMs: number; staleMs: number; failMs?: number; max?: number; now?: () => number }>): ReadCache<T> {
  const now = input.now ?? Date.now;
  const max = input.max ?? 400;
  const failMs = input.failMs ?? 15_000;
  const entries = new Map<string, Entry<T>>();
  const failures = new Map<string, { reason: string; at: number }>();
  const flying = new Map<string, Promise<CachedRead<T>>>();

  const remember = (key: string, value: T, at: number) => {
    entries.delete(key);
    entries.set(key, { value, at });
    while (entries.size > max) {
      const oldest = entries.keys().next().value;
      if (oldest === undefined) break;
      entries.delete(oldest);
    }
  };

  return {
    async read(key, load) {
      const at = now();
      const kept = entries.get(key);
      if (kept && at - kept.at <= input.ttlMs) return { ok: true, value: kept.value, observedAt: new Date(kept.at).toISOString(), stale: false };
      const pending = flying.get(key);
      if (pending) return pending;
      const refused = failures.get(key);
      const usable = kept !== undefined && at - kept.at <= input.ttlMs + input.staleMs;
      if (!usable && refused && at - refused.at <= failMs) return { ok: false, reason: refused.reason };
      const run = (async (): Promise<CachedRead<T>> => {
        try {
          const loaded = await load();
          if (loaded.ok) {
            const when = now();
            failures.delete(key);
            remember(key, loaded.value, when);
            return { ok: true, value: loaded.value, observedAt: new Date(when).toISOString(), stale: false };
          }
          if (kept && now() - kept.at <= input.ttlMs + input.staleMs) return { ok: true, value: kept.value, observedAt: new Date(kept.at).toISOString(), stale: true };
          failures.set(key, { reason: loaded.reason, at: now() });
          if (failures.size > max) failures.delete(failures.keys().next().value as string);
          return { ok: false, reason: loaded.reason };
        } catch (error) {
          if (kept && now() - kept.at <= input.ttlMs + input.staleMs) return { ok: true, value: kept.value, observedAt: new Date(kept.at).toISOString(), stale: true };
          return { ok: false, reason: error instanceof Error ? error.message.slice(0, 160) : "The source could not be read." };
        } finally {
          flying.delete(key);
        }
      })();
      flying.set(key, run);
      return run;
    },
    reset() {
      entries.clear();
      flying.clear();
      failures.clear();
    },
    size() {
      return entries.size;
    },
  };
}
