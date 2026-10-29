"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { GUEST_ACCESS, type AccessFacts } from "@/lib/predictions/access";
import type { DataStatus, SeriesPoint } from "@ryntra/core/adapters";

import { aggStatus, barsFromAgg } from "@/lib/predictions/chart-feed";
import type { PredictionChart } from "@/lib/predictions/model";

import { changeOver } from "./[eventId]/prediction-chart";
import type { AccountState } from "./use-paper-account";

/**
 * The facts a card or a Review needs beyond the event itself, each read once
 * and shared: the provider's disabled venues (its app configuration, one read
 * per page), the person's access as the provider's profile states it (from the
 * account the page already holds), and an outcome's week — its line for the
 * card's compact chart and its move over the last day (its own price history,
 * read only when the card is on screen).
 */

let engineRead: Promise<readonly string[] | null> | null = null;

/** The provider's disabled venues; null when it did not answer — never read as "none disabled", and asked again next time. */
function disabledVenues(): Promise<readonly string[] | null> {
  engineRead ??= fetch("/api/predictions/engine", { headers: { accept: "application/json" } })
    .then(async (r) => {
      const list = r.ok ? (((await r.json()) as { engine?: { disabledVenues?: unknown } }).engine?.disabledVenues ?? null) : null;
      if (!Array.isArray(list)) throw new Error("no configuration");
      return list as string[];
    })
    .catch(() => {
      engineRead = null;
      return null;
    });
  return engineRead;
}

/** The person's access facts: guest until the account is read, the provider's own flags after. */
export function useAccessFacts(state: AccountState): AccessFacts {
  const [disabled, setDisabled] = useState<readonly string[] | null>(null);
  useEffect(() => {
    let live = true;
    void disabledVenues().then((v) => {
      if (live) setDisabled(v);
    });
    return () => {
      live = false;
    };
  }, []);
  const access = state.account?.access ?? null;
  return useMemo(
    () => (access ? { locationBlocked: access.locationBlocked, venueAccounts: access.venueAccounts ?? null, disabledVenues: disabled } : { ...GUEST_ACCESS, disabledVenues: disabled }),
    [access, disabled],
  );
}

/* ------------------------------------------------------------- the week and its 24h move */

const MOVE_COUNT_BACK = 168; // the week of hourly bars the market page reads too, so the server's cache serves both
const PARALLEL = 3;

/** An outcome's week: its points on the probability scale, the state of the numbers (null when unread), the day's move. */
export type OutcomeWeek = Readonly<{ move: number | null; points: readonly SeriesPoint[]; status: DataStatus | null }>;
const NO_WEEK: OutcomeWeek = { move: null, points: [], status: null };

/*
 * The cards' weeks share one source, said once under them (`useWeeksStatus`), from the cards on the screen only: a card
 * that leaves takes its status with it. The caption speaks for the fresh cards — aged now from the oldest fresh card's
 * read; a stale card says so on itself (`event-card.tsx`). Stale, from the oldest card, only when every shown card is.
 */
const shownWeeks = new Map<symbol, DataStatus>();
let weeksStatus: DataStatus | null = null;
const weeksListeners = new Set<() => void>();

function weeksChanged(): void {
  const all = [...shownWeeks.values()];
  const fresh = all.filter((s) => s.state !== "stale");
  const pool = fresh.length > 0 ? fresh : all;
  if (pool.length === 0) weeksStatus = null;
  else {
    const oldest = pool.reduce((a, b) => (b.at < a.at ? b : a));
    const now = Date.now();
    weeksStatus = { ...oldest, source: { ...oldest.source, label: "AGG" }, derived: false, gateway_at: now, age_ms: Math.max(0, now - oldest.at) };
  }
  for (const listener of weeksListeners) listener();
}

/** The state of the cards' weeks, for the one caption under them; null until a week is read. */
export function useWeeksStatus(): DataStatus | null {
  return useSyncExternalStore(
    (listener) => {
      weeksListeners.add(listener);
      return () => weeksListeners.delete(listener);
    },
    () => weeksStatus,
    () => null,
  );
}

/** A week read this long ago is read again, not shown again under a fresher caption. */
const WEEK_TTL_MS = 3 * 60_000;
const weeks = new Map<string, Readonly<{ at: number; value: Promise<OutcomeWeek> }>>();
const queue: (() => void)[] = [];
let running = 0;

function pump() {
  while (running < PARALLEL && queue.length > 0) {
    running += 1;
    queue.shift()!();
  }
}

function readWeek(outcomeId: string): Promise<OutcomeWeek> {
  const hit = weeks.get(outcomeId);
  if (hit && Date.now() - hit.at < WEEK_TTL_MS) return hit.value;
  const value = new Promise<OutcomeWeek>((resolve) => {
    queue.push(() => {
      void fetch(`/api/predictions/outcomes/${encodeURIComponent(outcomeId)}/chart?resolution=1h&countBack=${MOVE_COUNT_BACK}`, { headers: { accept: "application/json" } })
        .then(async (r) => {
          if (!r.ok) throw new Error("no history");
          return ((await r.json()) as { chart: PredictionChart }).chart;
        })
        .then((chart) => {
          const now = Date.now();
          const bars = barsFromAgg(chart.bars);
          resolve({ move: changeOver(chart.bars, 24, now), points: bars.map((b) => ({ t: b.t, v: b.c })), status: aggStatus(chart, bars.at(-1)?.t ?? null, now) });
        })
        .catch(() => {
          weeks.delete(outcomeId);
          resolve(NO_WEEK);
        })
        .finally(() => {
          running -= 1;
          pump();
        });
    });
    pump();
  });
  weeks.set(outcomeId, { at: Date.now(), value });
  return value;
}

/** An outcome's week and its move over the last 24 hours, read once the element is near the screen; `undefined` while unread. */
export function useOutcomeWeek(outcomeId: string | null): Readonly<{ ref: React.RefObject<HTMLElement | null>; week: OutcomeWeek | undefined }> {
  const ref = useRef<HTMLElement | null>(null);
  const [week, setWeek] = useState<OutcomeWeek | undefined>(undefined);
  useEffect(() => {
    setWeek(undefined);
    if (!outcomeId) return undefined;
    let live = true;
    const mine = Symbol(outcomeId);
    const start = () => {
      void readWeek(outcomeId).then((w) => {
        if (!live) return;
        // Aged now, not when it was read: a card shown again from the kept read says how old its numbers are.
        const at = Date.now();
        const status = w.status ? { ...w.status, gateway_at: at, age_ms: Math.max(0, at - w.status.at) } : null;
        setWeek({ ...w, status });
        if (status) {
          shownWeeks.set(mine, status);
          weeksChanged();
        }
      });
    };
    const leave = () => {
      if (shownWeeks.delete(mine)) weeksChanged();
    };
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      start();
      return () => {
        live = false;
        leave();
      };
    }
    const seen = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          seen.disconnect();
          start();
        }
      },
      { rootMargin: "200px" },
    );
    seen.observe(el);
    return () => {
      live = false;
      seen.disconnect();
      leave();
    };
  }, [outcomeId]);
  return { ref, week };
}
