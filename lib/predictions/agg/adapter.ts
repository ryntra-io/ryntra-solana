/**
 * The AGG aggregator behind the provider boundary (`RYN-PREDICTIONS-001`).
 *
 * Server only. One SDK client per process for the public reads (the app id
 * and, when the environment has it, the server key), and a fresh client with
 * the person's bearer for every user call — the adapter never keeps a user
 * token between calls; `session.ts` does, encrypted, in the Guard store.
 *
 * The SDK's own refresh-on-401 is deliberately not armed for user calls: only
 * the access token is set, never the refresh token, so a rotated refresh
 * token can never be lost inside the SDK. A 401 comes back as
 * `SESSION_EXPIRED` and the session layer decides whether to refresh.
 *
 * Short per-process caches on the public reads (categories five minutes,
 * lists twenty seconds, an event ten) keep a page view from becoming a burst
 * of identical provider calls; prices, books, routes and the paper account
 * are never cached — they are the live figures the Review is judged on.
 */

import { createAggClient, type AggClient, type VenueEventWithMarkets, type VenueMarket } from "@agg-build/sdk";

import { readPredictionsEnv } from "../env.ts";
import { classifyProviderError, failure } from "../failure.ts";
import {
  mapBook,
  mapChart,
  mapEvent,
  mapEventSummary,
  mapExecution,
  mapMarketPrices,
  mapNews,
  mapPaperBalance,
  mapPaperOrder,
  mapPaperPosition,
  mapRelated,
  mapRipple,
  mapRoute,
  mapSignals,
  eventStale,
  midpointMap,
  type PredictionCategory,
  type PredictionEngineState,
  type PredictionEventSummary,
  type PredictionMarketPrices,
} from "../model.ts";
import type { DiscoverQuery, PredictionProvider, ProviderUserProfile, ProviderUserSession, Result } from "../provider.ts";

const CATEGORIES_TTL_MS = 5 * 60_000;
const LIST_TTL_MS = 20_000;
const EVENT_TTL_MS = 10_000;
const CHART_TTL_MS = 20_000;
const RESEARCH_TTL_MS = 60_000;

type CacheEntry<T> = { at: number; value: Promise<T> };
const cache = new Map<string, CacheEntry<unknown>>();

/** Single-flight memory cache: one promise per key for its TTL, a rejected one dropped at once. */
function cached<T>(key: string, ttlMs: number, read: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = cache.get(key) as CacheEntry<T> | undefined;
  if (hit && now - hit.at < ttlMs) return hit.value;
  const value = read().catch((error) => {
    cache.delete(key);
    throw error;
  });
  cache.set(key, { at: now, value });
  if (cache.size > 2000) {
    for (const [k, entry] of cache) if (now - entry.at > CATEGORIES_TTL_MS) cache.delete(k);
  }
  return value;
}

/** For tests and the stand: forget every cached read. */
export function resetAggAdapterCache(): void {
  cache.clear();
}

/**
 * An SDK client for the server, with the SDK's cross-tab session sync closed.
 *
 * The SDK opens a `BroadcastChannel` for every client — in a browser, so that
 * signing out in one tab signs out the others. On the server every client
 * lives in one process: the channel outlived the request, held the client and
 * its session in memory for as long as the instance lived, and passed one
 * wallet's sign-out (`logout` clears the token) and sign-in (`login` starts a
 * refresh) to every other wallet's client alive at that moment
 * (`RYN-API-CONTRACT-002`, 2026-09-23). `destroy()` closes that channel and
 * nothing else; the client's HTTP calls are unchanged.
 */
export function serverAggClient(options: Parameters<typeof createAggClient>[0]): AggClient {
  const c = createAggClient(options);
  c.destroy();
  return c;
}

let publicClient: AggClient | null = null;
function client(): AggClient {
  if (publicClient) return publicClient;
  const env = readPredictionsEnv();
  publicClient = serverAggClient({ baseUrl: env.baseUrl, appId: env.appId, apiKey: env.apiKey ?? undefined, wsUrl: env.wsUrl, persistSession: false });
  return publicClient;
}

function userClient(session: ProviderUserSession): AggClient {
  const env = readPredictionsEnv();
  const c = serverAggClient({ baseUrl: env.baseUrl, appId: env.appId, apiKey: env.apiKey ?? undefined, persistSession: false });
  c.setAccessToken(session.accessToken);
  return c;
}

async function attempt<T>(read: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await read() };
  } catch (error) {
    return classifyProviderError(error);
  }
}

const SORT: Readonly<Record<NonNullable<DiscoverQuery["sort"]>, { sortBy: string; sortDir: "asc" | "desc" }>> = {
  volume24h: { sortBy: "volume24hr", sortDir: "desc" },
  volume: { sortBy: "volume", sortDir: "desc" },
  newest: { sortBy: "createdAt", sortDir: "desc" },
  /* The provider answers 500 to an endDate sort combined with endDateFrom (seen 2026-09-17); the list is read by volume with the end bound and ordered here. */
  ending: { sortBy: "volume24hr", sortDir: "desc" },
};

async function readCategories(): Promise<readonly PredictionCategory[]> {
  const page = await client().getCategories({ limit: 100 });
  return (page.data ?? [])
    .filter((c) => c.parentId === null)
    .map((c) => ({ id: c.id, slug: c.name, name: c.displayName ?? c.name, eventCount: c.eventCount, volume24h: c.volume24hr }));
}

/** The Yes midpoint of each event's first market, one batch call, a missing one left null. */
async function leadingPrices(events: readonly VenueEventWithMarkets[]): Promise<ReadonlyMap<string, number>> {
  const ids = events.map((e) => e.venueMarkets?.[0]?.id).filter((id): id is string => typeof id === "string");
  if (ids.length === 0) return new Map();
  try {
    const prices = await client().getMidpoints({ venueMarketIds: ids });
    return midpointMap((prices.data ?? []).map(mapMarketPrices));
  } catch {
    /* A list without live midpoints still lists; the cards say the price is the last known. */
    return new Map();
  }
}

async function summaries(events: readonly VenueEventWithMarkets[]): Promise<readonly PredictionEventSummary[]> {
  /* The provider keeps events "open" long after their end; a list is of markets a person can still decide on. */
  const current = events.filter((e) => !eventStale(e));
  const prices = await leadingPrices(current);
  return current.map((e) => mapEventSummary(e, prices));
}

function mapProfile(user: { id: string; username: string | null; externalId: string | null; wallets?: readonly { chain: string; address: string }[]; accounts?: readonly { provider: string; providerAccountId: string }[]; isLocationBlocked?: boolean }): ProviderUserProfile {
  /* The provider lists a SIWS user's wallet under `accounts` (provider `solana_wallet`), not always under `wallets`. */
  const fromAccounts = (user.accounts ?? [])
    .filter((a) => a.provider === "solana_wallet" || a.provider === "wallet")
    .map((a) => ({ chain: a.provider === "solana_wallet" ? "solana" : "evm", address: a.providerAccountId }));
  const wallets = [...(user.wallets ?? []).map((w) => ({ chain: String(w.chain), address: w.address })), ...fromAccounts];
  return { id: user.id, username: user.username, externalId: user.externalId, wallets, locationBlocked: Boolean(user.isLocationBlocked) };
}

export const aggProvider: PredictionProvider = {
  id: "agg",

  categories: () => attempt(() => cached("categories", CATEGORIES_TTL_MS, readCategories)),

  discover: (query) =>
    attempt(async () => {
      const key = `discover:${query.category ?? "*"}:${query.sort ?? "volume24h"}:${query.limit ?? 24}:${query.cursor ?? ""}:${query.endDateFrom ?? ""}`;
      return cached(key, LIST_TTL_MS, async () => {
        let categoryIds: string[] | undefined;
        if (query.category) {
          const categories = await cached("categories", CATEGORIES_TTL_MS, readCategories);
          const match = categories.find((c) => c.slug === query.category);
          if (!match) return { events: [], nextCursor: null, readAt: new Date().toISOString() };
          categoryIds = [match.id];
        }
        const sort = SORT[query.sort ?? "volume24h"];
        const limit = Math.min(Math.max(query.limit ?? 24, 1), 50);
        const ending = query.sort === "ending";
        const page = await client().getVenueEvents({
          status: ["open"] as never,
          categoryIds,
          sortBy: sort.sortBy,
          sortDir: sort.sortDir,
          limit: ending ? 50 : limit,
          cursor: query.cursor ?? undefined,
          endDateFrom: ending ? new Date().toISOString() : (query.endDateFrom ?? undefined),
        });
        let events = (page.data ?? []) as VenueEventWithMarkets[];
        if (ending) {
          /* The fifty largest events still ahead of us, soonest first. */
          const now = Date.now();
          events = events
            .filter((e) => e.endDate && Date.parse(e.endDate) > now)
            .sort((a, b) => Date.parse(a.endDate ?? "") - Date.parse(b.endDate ?? ""))
            .slice(0, limit);
        }
        return { events: await summaries(events), nextCursor: ending ? null : (page.nextCursor ?? null), readAt: new Date().toISOString() };
      });
    }),

  search: (q, limit = 16) =>
    attempt(async () => {
      const key = `search:${q.trim().toLowerCase()}:${limit}`;
      return cached(key, LIST_TTL_MS, async () => {
        const result = await client().search<VenueEventWithMarkets>({ q: q.trim(), type: "events", limit });
        return summaries(result.data ?? []);
      });
    }),

  event: (eventId) =>
    attempt(async () =>
      cached(`event:${eventId}`, EVENT_TTL_MS, async () => {
        const [event, markets] = await Promise.all([
          client().getVenueEventById(eventId) as Promise<VenueEventWithMarkets>,
          client().getVenueMarkets({ venueEventId: eventId, limit: 50, context: "detail" }),
        ]);
        /* Markets by volume, the largest first: the market a person opens the event for, and the default of the detail. */
        const list = ([...(markets.data ?? [])] as VenueMarket[]).sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0));
        let prices: ReadonlyMap<string, number> = new Map();
        if (list.length > 0) {
          try {
            const batch = await client().getMidpoints({ venueMarketIds: list.map((m) => m.id) });
            prices = midpointMap((batch.data ?? []).map(mapMarketPrices));
          } catch {
            prices = new Map();
          }
        }
        return mapEvent({ ...event, venueMarkets: event.venueMarkets ?? list }, list, prices);
      }),
    ),

  events: (eventIds) =>
    attempt(async () => {
      const ids = [...new Set(eventIds)].slice(0, 40);
      const settled = await Promise.all(
        ids.map((id) =>
          cached(`event-summary:${id}`, EVENT_TTL_MS, () => client().getVenueEventById(id) as Promise<VenueEventWithMarkets>).then(
            (e) => e,
            () => null,
          ),
        ),
      );
      const events = settled.filter((e): e is VenueEventWithMarkets => e !== null);
      /* The summary needs each event's first market; a by-id read carries none, so the cluster's markets are read once per event. */
      const withMarkets = await Promise.all(
        events.map(async (e) => {
          if (e.venueMarkets?.length) return e;
          try {
            const markets = await cached(`event-markets:${e.id}`, EVENT_TTL_MS, () => client().getVenueMarkets({ venueEventId: e.id, limit: 3, context: "list" }));
            return { ...e, venueMarkets: (markets.data ?? []) as VenueMarket[] };
          } catch {
            return { ...e, venueMarkets: [] };
          }
        }),
      );
      return summaries(withMarkets);
    }),

  prices: (venueMarketIds) =>
    attempt(async () => {
      const ids = [...new Set(venueMarketIds)].slice(0, 50);
      if (ids.length === 0) return [] as readonly PredictionMarketPrices[];
      const batch = await client().getMidpoints({ venueMarketIds: ids });
      return (batch.data ?? []).map(mapMarketPrices);
    }),

  book: (venueMarketId, depth = 10) =>
    attempt(async () => {
      const result = await client().getOrderbooks({ venueMarketIds: [venueMarketId], depth: Math.min(Math.max(depth, 1), 50) });
      const item = result.data?.[0];
      if (!item) throw Object.assign(new Error("empty orderbook answer"), { status: 404 });
      return mapBook(item, new Date().toISOString());
    }),

  chart: (outcomeId, resolution, countBack = 96) =>
    attempt(() =>
      cached(`chart:${outcomeId}:${resolution}:${countBack}`, CHART_TTL_MS, async () =>
        mapChart(await client().getChartBars({ venueMarketOutcomeId: outcomeId, resolution, to: Date.now(), countBack: Math.min(Math.max(countBack, 2), 500) })),
      ),
    ),

  signals: (venueMarketId) =>
    attempt(() =>
      cached(`signals:${venueMarketId}`, RESEARCH_TTL_MS, async () => {
        try {
          const batch = await client().getMarketCorrelatedSignals(venueMarketId);
          return batch && batch.signals ? mapSignals(batch) : null;
        } catch (error) {
          /* A market the engine has not processed answers 404: that is "none yet", not an outage. */
          if ((error as { status?: number })?.status === 404) return null;
          throw error;
        }
      }),
    ),

  related: (text, limit = 10) =>
    attempt(() =>
      cached(`related:${text.trim().toLowerCase()}:${limit}`, RESEARCH_TTL_MS, async () => {
        const result = await client().queryCorrelatedMarkets({ text: text.trim(), limit });
        return mapRelated(result.results ?? []);
      }),
    ),

  ripple: (venueMarketId, mode, limit = 10) =>
    attempt(() =>
      cached(`ripple:${venueMarketId}:${mode}:${limit}`, RESEARCH_TTL_MS, async () => {
        try {
          const result = await client().getCorrelatedMarketCascade({ venueMarketId, mode, limit });
          return mapRipple(mode, result.data ?? []);
        } catch (error) {
          if ((error as { status?: number })?.status === 404) return mapRipple(mode, []);
          throw error;
        }
      }),
    ),

  news: (venueMarketId, limit = 5) =>
    attempt(() =>
      cached(`news:${venueMarketId}:${limit}`, RESEARCH_TTL_MS, async () => mapNews(await client().getMarketNews({ venueMarketIds: [venueMarketId], limit: Math.min(limit, 5) }))),
    ),

  engine: () =>
    attempt(() =>
      cached("engine", RESEARCH_TTL_MS, async (): Promise<PredictionEngineState> => {
        const [config, status] = await Promise.all([client().getAppConfig(), client().getCorrelatedMarketsStatus().catch(() => null)]);
        const cfg = config as unknown as Record<string, unknown>;
        return {
          tradingMode: String(cfg.tradingMode ?? "unknown"),
          paperStartingBalance: typeof cfg.paperStartingBalance === "number" ? cfg.paperStartingBalance : null,
          disabledVenues: Array.isArray(cfg.disabledVenues) ? (cfg.disabledVenues as string[]) : [],
          signals: status ? { marketsProcessed: status.markets.processed, marketsTotal: status.markets.total, coveragePct: status.markets.coverage, total: status.signals.total } : null,
        };
      }),
    ),

  signInChallenge: ({ address, domain, uri, statement }) =>
    attempt(async () => {
      const start = await client().authStart({ provider: "siws" });
      if (start.type !== "nonce") throw Object.assign(new Error(`sign-in start answered ${start.type}`), { status: 503 });
      const text = statement ?? start.statement;
      const message = client().buildSiwsMessage({ address, chainId: "mainnet", nonce: start.nonce, domain, uri, statement: text });
      return { nonce: start.nonce, message, statement: text ?? null };
    }),

  verifySignIn: ({ message, signature }) =>
    attempt(async () => {
      /* A throwaway client: `verify` stores the session on the instance, and this one is discarded at once. */
      const env = readPredictionsEnv();
      const c = serverAggClient({ baseUrl: env.baseUrl, appId: env.appId, apiKey: env.apiKey ?? undefined, persistSession: false });
      try {
        const result = await c.verify({ message, signature });
        return { accessToken: result.accessToken, refreshToken: result.refreshToken ?? null, user: mapProfile(result.user) };
      } catch (error) {
        const status = (error as { status?: number })?.status;
        if (status === 400 || status === 401) throw Object.assign(new Error("signature refused"), { status: 401, kind: "signature" });
        throw error;
      }
    }).then((r) => (!r.ok && r.code === "SESSION_EXPIRED" ? failure("SIGNATURE_INVALID", "The provider refused that signature; start the link again.") : r)),

  refresh: (refreshToken) =>
    attempt(async () => {
      const env = readPredictionsEnv();
      const response = await fetch(`${env.baseUrl}/auth/token/refresh`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json", "x-app-id": env.appId, ...(env.apiKey ? { "x-app-api-key": env.apiKey } : {}) },
        body: JSON.stringify({ refreshToken }),
        cache: "no-store",
      });
      if (!response.ok) throw Object.assign(new Error(`refresh answered ${response.status}`), { status: response.status === 401 || response.status === 400 ? 401 : response.status });
      const body = (await response.json()) as { accessToken?: string; refreshToken?: string };
      if (!body.accessToken) throw Object.assign(new Error("refresh without an access token"), { status: 503 });
      return { accessToken: body.accessToken, refreshToken: body.refreshToken ?? null };
    }),

  profile: (session) => attempt(async () => mapProfile(await userClient(session).getCurrentUser())),

  linkExternalId: (session, assertion) => attempt(async () => mapProfile(await userClient(session).linkExternalId(assertion))),

  signOut: (session) =>
    attempt(async () => {
      await userClient(session).signOut();
      return null;
    }),

  paperBalance: (session) => attempt(async () => mapPaperBalance(await userClient(session).getManagedBalances({ mode: "paper" }))),

  paperPositions: (session, status) =>
    attempt(async () => {
      const page = await userClient(session).getExecutionPositions({ mode: "paper", status, limit: 50 });
      return (page.data ?? []).map(mapPaperPosition);
    }),

  paperOrders: (session, limit = 50) =>
    attempt(async () => {
      const page = await userClient(session).getExecutionOrders({ mode: "paper", limit: Math.min(limit, 100) });
      return (page.data ?? []).map(mapPaperOrder);
    }),

  route: (session, request) =>
    attempt(async () => {
      const c = session ? userClient(session) : client();
      const quotedAt = new Date().toISOString();
      const route =
        request.side === "buy"
          ? await c.getSmartRoute({ venueMarketOutcomeId: request.outcomeId, tradeSide: "buy", maxSpend: request.spendUsd ?? 0, mode: "paper", compareVenues: true, slipCapBps: request.slipCapBps })
          : await c.getSmartRoute({ venueMarketOutcomeId: request.outcomeId, tradeSide: "sell", sellShares: request.sellShares ?? 0, mode: "paper", compareVenues: true, slipCapBps: request.slipCapBps });
      return mapRoute(route, request.side, request.side === "buy" ? (request.spendUsd ?? 0) : (request.sellShares ?? 0), quotedAt);
    }),

  execute: (session, request) =>
    attempt(async () => {
      const accepted = await userClient(session).executeManaged({
        quoteId: request.quoteId,
        mode: "paper",
        fallbackToLatest: {
          outcomeId: request.fallback.outcomeId,
          side: request.fallback.side,
          maxSpend: request.fallback.spendUsd,
          sellShares: request.fallback.sellShares,
        },
      });
      return { quoteId: accepted.quoteId, orderIds: accepted.orderIds ?? [], status: accepted.status, alreadyAccepted: Boolean(accepted.alreadyAccepted) };
    }),

  executionStatus: (session, quoteId) => attempt(async () => mapExecution(await userClient(session).getExecutionStatus({ quoteId, mode: "paper" }))),
};

export function getPredictionProvider(): PredictionProvider {
  return aggProvider;
}
