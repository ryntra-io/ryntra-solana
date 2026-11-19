import "server-only";

import { withBoundedCasRetry, type GuardStore } from "../guard/store.ts";
import { SENTENCE_LIMITS, type SentenceMeter } from "./serve.ts";

/**
 * The sentence's day counted in the store every instance shares (the Guard store, compare-and-set), beside
 * the assistant's own counters and never in them: a caller's day and everyone's day. Counted first, judged after: the
 * one past a limit gives its counts back, so two callers at once cannot slip past it.
 */

const COUNTERS = "agentBudget" as const;

type Counter = { version: number; key: string; count: number; updatedAt: string };

const dayOf = (nowMs: number) => new Date(nowMs).toISOString().slice(0, 10);

function isCounter(value: unknown): value is Counter {
  const v = value as Partial<Counter> | null;
  return typeof v === "object" && v !== null && Number.isInteger(v.version) && typeof v.key === "string" && Number.isInteger(v.count) && (v.count ?? -1) >= 0;
}

async function advance(store: GuardStore, key: string, delta: number, nowMs: number): Promise<number> {
  const counters = store.versioned<Counter>(COUNTERS);
  return withBoundedCasRetry(async () => {
    const raw = await counters.get(key);
    const current = isCounter(raw) ? raw : null;
    const count = Math.max(0, (current?.count ?? 0) + delta);
    const next: Counter = { version: (current?.version ?? 0) + 1, key, count, updatedAt: new Date(nowMs).toISOString() };
    return (await counters.compareAndSet(key, current?.version ?? null, next)) ? count : false;
  });
}

/** The everyone's day the deployment may set lower (`RYNTRA_SENTENCE_DAY`), never higher than the code's ceiling. */
export function allDayOf(env: Readonly<Record<string, string | undefined>>): number {
  const set = Number(env.RYNTRA_SENTENCE_DAY?.trim());
  return Number.isInteger(set) && set > 0 ? Math.min(set, SENTENCE_LIMITS.allDay) : SENTENCE_LIMITS.allDay;
}

export function guardSentenceMeter(store: GuardStore, allDay: number = SENTENCE_LIMITS.allDay): SentenceMeter {
  return {
    async take(caller, nowMs) {
      const day = dayOf(nowMs);
      const rungs = [
        [`sentence:caller:${caller}:day:${day}`, SENTENCE_LIMITS.callerDay],
        [`sentence:all:day:${day}`, allDay],
      ] as const;
      const advanced: string[] = [];
      const giveBack = async () => {
        for (const key of advanced) await advance(store, key, -1, nowMs).catch(() => 0);
      };
      try {
        for (const [key, limit] of rungs) {
          const count = await advance(store, key, 1, nowMs);
          advanced.push(key);
          if (count > limit) {
            await giveBack();
            return { ok: false, reason: "limit" };
          }
        }
      } catch {
        await giveBack();
        return { ok: false, reason: "down" };
      }
      return { ok: true, give: giveBack };
    },
  };
}
