/**
 * Reads of one kind taken in turn: no more than `atOnce` in flight, the first asked first, each key once while it waits
 * or flies. An answer the server refused for being busy (503, 429) is asked once more after `retryMs` — quietly, holding
 * its place in line meanwhile, so a busy server is not asked faster; a second refusal, or any other failure, is no
 * answer (`done(key, null)`). The screen draws what has come and never waits for the rest.
 *
 * The release check of 20.11: «/pro» asked every pool's day together and the engine refused part of them with 503,
 * while each alone answered 200.
 *
 * Pure of the browser: `read` and `wait` come in, so the tests drive it.
 */

export type QueueRead = (key: string) => Promise<Readonly<{ status: number; body: unknown }>>;

export type ReadQueue = Readonly<{
  /** Puts these keys in line, the first first; a key already waiting or in flight is not asked twice. */
  ask: (keys: readonly string[]) => void;
  /** Whether a key is waiting or in flight. */
  busy: (key: string) => boolean;
}>;

const BUSY_STATUSES: ReadonlySet<number> = new Set([429, 503]);

export function readQueue(options: Readonly<{ atOnce: number; retryMs: number; read: QueueRead; wait: (ms: number) => Promise<void>; done: (key: string, body: unknown | null) => void }>): ReadQueue {
  const waiting: string[] = [];
  const flying = new Set<string>();

  async function once(key: string): Promise<unknown | null> {
    try {
      const first = await options.read(key);
      if (first.status >= 200 && first.status < 300) return first.body;
      if (!BUSY_STATUSES.has(first.status)) return null;
      await options.wait(options.retryMs);
      const again = await options.read(key);
      return again.status >= 200 && again.status < 300 ? again.body : null;
    } catch {
      return null;
    }
  }

  function pump(): void {
    while (flying.size < options.atOnce && waiting.length) {
      const key = waiting.shift()!;
      flying.add(key);
      void once(key).then((body) => {
        flying.delete(key);
        try {
          options.done(key, body);
        } finally {
          // A listener that failed never stops the line.
          pump();
        }
      });
    }
  }

  return {
    ask(keys) {
      for (const key of keys) if (!flying.has(key) && !waiting.includes(key)) waiting.push(key);
      pump();
    },
    busy: (key) => flying.has(key) || waiting.includes(key),
  };
}
