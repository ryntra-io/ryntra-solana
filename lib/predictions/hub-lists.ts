/**
 * What the hub's lists hold, and in what state a card stands. A browsed list
 * (Trending, Ending soon, New, a category) is of events a person can still
 * trade; a search and the watchlist keep every event they find, each shown in
 * its own state — an event past its close is awaiting its result, a settled
 * one is resolved, and neither offers a payout.
 *
 * New leaves the short recurring rounds — «Up or Down» over minutes or hours
 * — out unless the person asks for them; asked for, each series stands as one
 * card, its round closing soonest, as the big venues show them. They stay in
 * search and in their category. Nothing is switched off.
 *
 * Pure.
 */

import { eventTradable, type PredictionMarketStatus } from "./model.ts";

export type CardPhase = "live" | "awaiting" | "resolved";

type Listed = Readonly<{ title: string; status: PredictionMarketStatus; endDate: string | null; recurrence?: string | null; sport?: string | null; gameStartTime?: string | null }>;

/** Where the card's event stands: still trading, past its close with no result yet, or settled. */
export function cardPhase(event: Listed, nowMs: number): CardPhase {
  if (event.status === "resolved") return "resolved";
  return eventTradable(event, nowMs) ? "live" : "awaiting";
}

/* «Up or Down» with a clock time in the title («10:10PM-10:15PM ET», «10PM ET», «22:10–22:15 ET»): a round of minutes or hours, never a daily one. */
const UP_OR_DOWN = /\bup\s+or\s+down\b/i;
const CLOCK = /\b\d{1,2}(?::\d{2})?\s?[ap]\.?m\.?(?![a-z])|\b\d{1,2}:\d{2}\s?[-–]\s?\d{1,2}:\d{2}\b/i;

const DURATION = /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/;

/** An ISO-8601 duration (`PT5M`, `PT1H`, `P1D`, `P1W`, `P1M`) in milliseconds — months and years roughly; null when it is not one. */
export function durationMs(value: string | null | undefined): number | null {
  const text = value?.trim().toUpperCase() ?? "";
  const m = DURATION.exec(text);
  if (!m || text === "P" || text.endsWith("T")) return null;
  const [y, mo, w, d, h, min, s] = m.slice(1).map((x) => Number(x ?? 0));
  const days = y * 365 + mo * 30 + w * 7 + d;
  return ((days * 24 + h) * 60 + min) * 60_000 + s * 1000;
}

const DAY_MS = 24 * 3_600_000;

/**
 * A recurring round shorter than a day: by the provider's series cadence
 * when it gives one, else by an «Up or Down» title with a clock time in it.
 */
export function shortRound(event: Readonly<{ title: string; recurrence?: string | null }>): boolean {
  const cadence = durationMs(event.recurrence);
  if (cadence != null) return cadence < DAY_MS;
  return UP_OR_DOWN.test(event.title) && CLOCK.test(event.title);
}

/** The series a round belongs to: its cadence and its title before the window («PT5M|bnb up or down»), so a 5-minute and an hourly series stay apart. */
export function seriesKey(event: Readonly<{ title: string; recurrence?: string | null }>): string {
  return `${event.recurrence ?? ""}|${event.title.split(/\s[-–]\s/)[0].trim().toLowerCase()}`;
}

/** The cadence in a person's words, for a round's card: «5 min», «1 h»; null when there is none or it is a day or longer. */
export function cadenceLabel(recurrence: string | null | undefined, locale: "en" | "uk"): string | null {
  const ms = durationMs(recurrence);
  if (ms == null || ms <= 0 || ms >= DAY_MS) return null;
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return locale === "uk" ? `${minutes} хв` : `${minutes} min`;
  const hours = Math.round(minutes / 60);
  return locale === "uk" ? `${hours} год` : `${hours} h`;
}

export type HubTab = "trending" | "ending" | "newest" | "watchlist" | `category:${string}`;

/**
 * The cards a tab shows and how many short rounds New held back. A search
 * and the watchlist show every event; a browsed tab only the tradable ones.
 */
export function hubList<T extends Listed>(events: readonly T[], view: Readonly<{ tab: HubTab; searching: boolean; rounds: boolean }>, nowMs: number): Readonly<{ events: readonly T[]; heldRounds: number }> {
  if (view.searching || view.tab === "watchlist") return { events, heldRounds: 0 };
  const tradable = events.filter((e) => cardPhase(e, nowMs) === "live");
  if (view.tab !== "newest") return { events: tradable, heldRounds: 0 };
  /* One card per series: the round that closes soonest stands for it. */
  const next = new Map<string, T>();
  for (const e of tradable) {
    if (!shortRound(e)) continue;
    const key = seriesKey(e);
    const held = next.get(key);
    const end = (x: T) => (x.endDate ? Date.parse(x.endDate) : Infinity);
    if (!held || end(e) < end(held)) next.set(key, e);
  }
  if (!view.rounds) return { events: tradable.filter((e) => !shortRound(e)), heldRounds: tradable.filter((e) => shortRound(e)).length };
  const shown = new Set(next.values());
  return { events: tradable.filter((e) => !shortRound(e) || shown.has(e)), heldRounds: 0 };
}
