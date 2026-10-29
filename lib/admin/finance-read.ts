/**
 * The financial panel's reads against their deadline (SOL-F1). Pure; the reads themselves are `finance.server.ts`.
 *
 * - `settleBy` — a read that runs out of time answers with what it reached — its accumulator, marked incomplete — rather
 *   than with nothing: a partial history of claims or fees is a floor the panel can draw, an empty answer only «not read».
 * - `createReadKeeper` — one read shared by every request for a while: a kept read older than `keepMs` is answered at
 *   once (with its own moment) while a new one runs behind it; «Read again» waits for a new one; a read still running past
 *   its budget is dead — a new one starts, and the dead one never becomes the last answer.
 */

/** `work`, or at `deadline` (and on failure) what it has gathered so far, `partial()`. */
export function settleBy<T>(work: Promise<T>, deadline: number, partial: () => T): Promise<T> {
  const left = deadline - Date.now();
  if (left <= 0) return Promise.resolve(partial());
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(partial()), left);
  });
  return Promise.race([work.catch(() => partial()), late]).finally(() => clearTimeout(timer));
}

export type KeptRead<T> = Readonly<{ at: number; value: T }>;

export type ReadKeeper<T> = Readonly<{
  /**
   * The read to answer with, and the read still running behind it — which the caller keeps alive after its response
   * (`after()` in a route), or null when nothing runs.
   */
  get(fresh?: boolean): Readonly<{ answer: Promise<KeptRead<T>>; running: Promise<unknown> | null }>;
}>;

export function createReadKeeper<T>(options: Readonly<{ read: (deadline: number) => Promise<T>; keepMs: number; budgetMs: number; graceMs: number; now?: () => number }>): ReadKeeper<T> {
  const now = options.now ?? (() => Date.now());
  type Kept = { at: number; value: Promise<T>; settled: boolean };
  let kept: Kept | null = null;
  let last: KeptRead<T> | null = null;

  const start = (at: number): Kept => {
    const entry: Kept = { at, value: options.read(at + options.budgetMs), settled: false };
    kept = entry;
    entry.value.then(
      (value) => {
        entry.settled = true;
        /* Only the read still kept becomes the last answer: one given up as dead never does. */
        if (kept === entry) last = { at: entry.at, value };
      },
      () => {
        entry.settled = true;
        if (kept === entry) kept = null;
      },
    );
    return entry;
  };

  return {
    get(fresh = false) {
      const at = now();
      const dead = kept !== null && !kept.settled && at - kept.at > options.budgetMs + options.graceMs;
      const current = kept;
      const started = current === null || dead || (current.settled && (fresh || at - current.at > options.keepMs)) ? start(at) : null;
      const entry = started ?? current!;
      const running = entry.settled ? null : entry.value;
      if (last && !fresh && !entry.settled) return { answer: Promise.resolve(last), running };
      return { answer: entry.value.then((value) => ({ at: entry.at, value })), running };
    },
  };
}
