/**
 * Reads the market map of one market from the provider: the model's links
 * with and against the person's outcome and on the same theme, then each
 * linked market's event and its last day of prices. Every read answers on its
 * own within its time, and the whole map within one deadline under the
 * route's own limit — a link whose market could not be read in time is drawn
 * with what the model said. One map sends no more than four of its reads at
 * once, since the provider's limit is shared with the live prices and the
 * ticket; a map whose every read answered is kept a minute, one with a failed
 * read a few seconds, so an outage is not asked again on every view.
 */

import { failure } from "./failure.ts";
import { factsOf, finishMarketMap, firstOfEachGroup, isOwn, mapCandidates, dayChange, sideOf, type MapFacts, type MarketMap } from "./market-map.ts";
import type { PredictionEvent, PredictionMarket, PredictionRelatedMarket } from "./model.ts";
import type { PredictionProvider } from "./provider.ts";

const TTL_MS = 60_000;
const FAILED_TTL_MS = 10_000;
const KEPT_LIMIT = 500;
/** A read that has not answered in this time is drawn as not answered. */
const BUDGET_MS = 6_000;
/** The whole map, well under the route's 30 seconds: a read not started by then is not started. */
const DEADLINE_MS = 20_000;
const PARALLEL = 4;
/** The same-theme search returns markets without their event; as many are looked up by title as the group shows. */
const SEARCHES = 5;

const kept = new Map<string, { at: number; ttl: number; value: Promise<MarketMap> }>();

type Options = Readonly<{ budgetMs?: number; deadlineMs?: number }>;

/** The time a read may take: its own budget, never past the map's deadline; nothing once the deadline has passed. */
type Clock = Readonly<{ budgetMs: number; endsAt: number }>;

function withBudget<T>(read: () => Promise<T>, fallback: T, clock: Clock): Promise<T> {
  const budgetMs = Math.min(clock.budgetMs, clock.endsAt - Date.now());
  if (budgetMs <= 0) return Promise.resolve(fallback);
  let timer: ReturnType<typeof setTimeout> | null = null;
  const late = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), budgetMs);
  });
  return Promise.race([read().catch(() => fallback), late]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/** Runs the jobs at most `PARALLEL` at a time, in order. */
async function inTurn<T>(jobs: readonly (() => Promise<T>)[]): Promise<T[]> {
  const out: T[] = new Array(jobs.length);
  let next = 0;
  const lane = async () => {
    while (next < jobs.length) {
      const at = next++;
      out[at] = await jobs[at]!();
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, jobs.length) }, lane));
  return out;
}

const sameTitle = (a: string, b: string) => a.replace(/\s+/g, " ").trim().toLowerCase() === b.replace(/\s+/g, " ").trim().toLowerCase();

async function changeOf(provider: PredictionProvider, outcomeId: string | null, nowMs: number): Promise<number | null> {
  if (!outcomeId) return null;
  const chart = await provider.chart(outcomeId, "1h", 30);
  return chart.ok ? dayChange(chart.value.bars, nowMs) : null;
}

const FAILED = failure("PROVIDER_UNAVAILABLE", "No answer in time.");

const NONE = { ok: true as const, value: null };

async function compose(provider: PredictionProvider, event: PredictionEvent, market: PredictionMarket, outcomeId: string, options: Options): Promise<MarketMap> {
  const nowMs = Date.now();
  const clock: Clock = { budgetMs: options.budgetMs ?? BUDGET_MS, endsAt: nowMs + (options.deadlineMs ?? DEADLINE_MS) };
  const side = sideOf(market, outcomeId);
  /* An outcome of a market of more than two, not named Yes or No: which side the model's lists mean is unknown, so only the theme is asked. */
  const [expand, hedge, related, anchorChange] = await Promise.all([
    side ? withBudget(() => provider.ripple(market.id, "expand", 8, side), FAILED, clock) : NONE,
    side ? withBudget(() => provider.ripple(market.id, "hedge", 8, side), FAILED, clock) : NONE,
    withBudget(() => provider.related(market.question, 8), FAILED, clock),
    withBudget(() => changeOf(provider, outcomeId, nowMs), null, clock),
  ]);

  const anchorMarketIds = [market.id, ...market.matched.map((m) => m.id)];
  const anchorTitles = [event.title, market.question, ...market.matched.map((m) => m.question)];
  /* A same-theme market comes without its event: its event by the exact title — this market and its twins first left out, they would spend a search each. */
  const eventOf = new Map<string, string | null>();
  const unnamed = (related.ok ? related.value : []).filter((r) => !r.venueEventId && !isOwn(r, anchorMarketIds, anchorTitles)).slice(0, SEARCHES);
  await inTurn(
    unnamed.map((r) => async () => {
      const found = await withBudget(() => provider.search(r.eventTitle, 5), null, clock);
      eventOf.set(r.venueMarketId, found?.ok ? (found.value.find((e) => sameTitle(e.title, r.eventTitle))?.id ?? null) : null);
    }),
  );

  const candidates = mapCandidates({
    anchorEventId: event.id,
    anchorMarketIds,
    anchorTitles,
    /* More than the group shows: a namesake left out below makes room for the next. */
    themeKeep: 8,
    expand: expand.ok ? expand.value : null,
    hedge: hedge.ok ? hedge.value : null,
    related: related.ok ? related.value : null,
    relatedEvent: (r: PredictionRelatedMarket) => eventOf.get(r.venueMarketId) ?? null,
  });

  const facts = new Map<string, MapFacts>();
  /* An event read that does not hold the market the model named — a namesake found by title — is not that market's: the row goes. */
  const elsewhere = new Set<string>();
  await inTurn(
    candidates.map((c) => async () => {
      const f = await withBudget(
        async () => {
          const linked = await provider.event(c.eventId);
          if (!linked.ok) return null;
          const base = factsOf(linked.value, c.marketId, c.there);
          if (!base) {
            elsewhere.add(c.eventId);
            return null;
          }
          return { ...base, change24h: await changeOf(provider, base.outcomeId, nowMs) };
        },
        null,
        clock,
      );
      if (f) facts.set(c.eventId, f);
    }),
  );

  return finishMarketMap({
    anchor: { eventId: event.id, marketId: market.id, outcomeId, side, endDate: market.endDate ?? event.endDate, change24h: anchorChange },
    candidates: firstOfEachGroup(candidates.filter((c) => !elsewhere.has(c.eventId))),
    facts,
    parts: { with: expand.ok ? "ok" : "failed", against: hedge.ok ? "ok" : "failed", theme: related.ok ? "ok" : "failed" },
    readAt: new Date(nowMs).toISOString(),
  });
}

/**
 * The map of one of an event's markets for the outcome the person picked,
 * kept a minute; a map any of whose reads failed only a few seconds, so the
 * next views soon ask again without asking on every one.
 */
export function readMarketMap(provider: PredictionProvider, event: PredictionEvent, market: PredictionMarket, outcomeId: string, options: Options = {}): Promise<MarketMap> {
  const key = `${event.id}:${market.id}:${outcomeId}`;
  const now = Date.now();
  const hit = kept.get(key);
  if (hit && now - hit.at < hit.ttl) return hit.value;
  for (const [k, v] of kept) if (now - v.at >= v.ttl) kept.delete(k);
  /* Still full of fresh maps: the oldest go first. */
  for (const k of kept.keys()) {
    if (kept.size < KEPT_LIMIT) break;
    kept.delete(k);
  }
  const value = compose(provider, event, market, outcomeId, options);
  const entry = { at: now, ttl: TTL_MS, value };
  kept.set(key, entry);
  value.then(
    (map) => {
      /* Counted from the answer, not the ask: a failing map can take the whole deadline to come. */
      entry.at = Date.now();
      if (Object.values(map.parts).some((part) => part === "failed")) entry.ttl = FAILED_TTL_MS;
    },
    () => {
      if (kept.get(key)?.value === value) kept.delete(key);
    },
  );
  return value;
}
