/**
 * The Hall's guard on the server: one time budget for the whole work, a timeout on every read, one work in flight per
 * instance, the last whole Hall kept a few minutes, and a pause after a failed work so a down engine is not asked again
 * on every visit. Pure — no engine imports — so it is tested on its own (`hall-guard.test.mjs`).
 */

type Clock = () => number;

/** A promise's answer, or null once `ms` have passed — the work itself goes on; nothing waits on it any more. */
export function inTime<T>(work: Promise<T>, ms: number): Promise<T | null> {
  if (ms <= 0) {
    work.catch(() => undefined);
    return Promise.resolve(null);
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

/** Run `work` over `items`, `limit` at a time, in order. */
export async function inTurn<T, R>(items: readonly T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        out[index] = await work(items[index]!);
      }
    }),
  );
  return out;
}

/** One budget for a whole work: what is left of it, and a read bounded by both its own cap and what is left. */
export type Deadline = Readonly<{
  left: () => number;
  over: () => boolean;
  within: <T>(work: Promise<T>, capMs: number) => Promise<T | null>;
}>;

export function deadline(ms: number, clock: Clock = Date.now): Deadline {
  const until = clock() + ms;
  const left = () => Math.max(0, until - clock());
  return {
    left,
    over: () => left() <= 0,
    within: (work, capMs) => inTime(work, Math.min(capMs, left())),
  };
}

/** How a kept answer stands: worked out whole, worked out with a part cut by the budget, or an older one standing in. */
export type HallMark = 'fresh' | 'partial' | 'stale';
export type WorkAnswer<V, C extends string> = Readonly<{ ok: true; view: V; partial: boolean }> | Readonly<{ ok: false; code: C }>;
export type GuardAnswer<V, C extends string> = Readonly<{ ok: true; view: V; mark: HallMark }> | Readonly<{ ok: false; code: C }>;

export type KeptWorkOptions<V, C extends string> = Readonly<{
  /** A whole answer is served this long before the next ask works it out again behind the answer. */
  keepMs: number;
  /** After a failed work, no new one starts for this long: the kept answer (or the failure) stands. */
  pauseMs: number;
  /** A caller waits at most this long; the work, already bounded inside, finishes behind. */
  answerMs: number;
  /** The code of a work that threw or did not answer in time. */
  failCode: C;
  work: (now: number) => Promise<WorkAnswer<V, C>>;
}>;

/** One work in flight per instance, the last whole answer kept, a pause after a failure. */
export class KeptWork<V, C extends string> {
  private held: Readonly<{ at: number; view: V; partial: boolean }> | null = null;
  private failed: Readonly<{ at: number; code: C }> | null = null;
  private running: Promise<GuardAnswer<V, C>> | null = null;

  private readonly options: KeptWorkOptions<V, C>;

  constructor(options: KeptWorkOptions<V, C>) {
    this.options = options;
  }

  /** Whether a work is in flight now. */
  get busy(): boolean {
    return this.running !== null;
  }

  /** The kept answer and whether it is still fresh. */
  kept(now: number): Readonly<{ view: V; fresh: boolean; partial: boolean }> | null {
    return this.held ? { view: this.held.view, fresh: now - this.held.at < this.options.keepMs, partial: this.held.partial } : null;
  }

  /** Whether a failed work still holds new ones back. */
  paused(now: number): boolean {
    return this.failed !== null && now - this.failed.at < this.options.pauseMs;
  }

  private fallback(code: C): GuardAnswer<V, C> {
    return this.held ? { ok: true, view: this.held.view, mark: 'stale' } : { ok: false, code };
  }

  /** Work the answer out now — or join the work in flight; during a pause, the kept answer or the failure at once. */
  refresh(now: number): Promise<GuardAnswer<V, C>> {
    if (!this.running && this.failed && this.paused(now)) return Promise.resolve(this.fallback(this.failed.code));
    this.running ??= this.options
      .work(now)
      .catch((): WorkAnswer<V, C> => ({ ok: false, code: this.options.failCode }))
      .then((answer): GuardAnswer<V, C> => {
        if (answer.ok) {
          this.held = { at: now, view: answer.view, partial: answer.partial };
          this.failed = null;
          return { ok: true, view: answer.view, mark: answer.partial ? 'partial' : 'fresh' };
        }
        this.failed = { at: now, code: answer.code };
        return this.fallback(answer.code);
      })
      .finally(() => {
        this.running = null;
      });
    return inTime(this.running, this.options.answerMs).then((answer) => answer ?? this.fallback(this.options.failCode));
  }

  /**
   * The answer: a kept one at once — one past its few minutes is worked out again behind it (`behind` keeps that work
   * alive after the response), unless a work is in flight or paused — or, with none kept, one worked out now.
   */
  read(now: number, behind: (work: () => Promise<unknown>) => void): Promise<GuardAnswer<V, C>> {
    const kept = this.kept(now);
    if (!kept) return this.refresh(now);
    if (!kept.fresh && !this.running && !this.paused(now)) behind(() => this.refresh(now));
    return Promise.resolve({ ok: true, view: kept.view, mark: !kept.fresh ? 'stale' : kept.partial ? 'partial' : 'fresh' });
  }
}
