/**
 * The AGG aggregator behind the provider boundary.
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

import { createAggClient, loadImmutableHistory, type AggAuthStartResult, type AggClient, type Venue, type VenueEventWithMarkets, type VenueMarket } from "@agg-build/sdk";

import { readBotSiteKey, startThroughBotCheck } from "../bot-check.ts";
import { limitRaw } from "../limit-model.ts";
import { readPredictionsEnv, type PredictionsEnv } from "../env.ts";
import { classifyProviderError, failure } from "../failure.ts";
import {
  mapBook,
  mapChart,
  mapEvent,
  mapEventSummary,
  mapExecution,
  mapLimitOrder,
  mapLimitPlaced,
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
  eventTradable,
  leadMarket,
  rawInPlay,
  midpointMap,
  type PredictionCategory,
  type PredictionChart,
  type PredictionEngineState,
  type PredictionEventSummary,
  type PredictionMarketPrices,
} from "../model.ts";
import { PROVIDER_REFRESH_TIMEOUT_MS, WITHDRAW_SEND_TIMEOUT_MS, mapDeposits, mapLiveBalance, mapPreview, mapWithdrawal, solanaDepositTarget } from "../funding.ts";
import type { DiscoverQuery, PredictionProvider, ProviderUserProfile, ProviderUserSession, Result } from "../provider.ts";

const CATEGORIES_TTL_MS = 5 * 60_000;
const LIST_TTL_MS = 20_000;
const EVENT_TTL_MS = 10_000;
const CHART_TTL_MS = 20_000;
const EMPTY_CHART_TTL_MS = 4_000;
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
  /* The shared client keeps the base URL it was made with; a reset makes the next read take the environment again. */
  publicClient = null;
}

/**
 * An SDK client for the server, with the SDK's cross-tab session sync closed.
 *
 * The SDK opens a `BroadcastChannel` for every client — in a browser, so that
 * signing out in one tab signs out the others. On the server every client
 * lives in one process: the channel outlived the request, held the client and
 * its session in memory for as long as the instance lived, and passed one
 * wallet's sign-out (`logout` clears the token) and sign-in (`login` starts a
 * refresh) to every other wallet's client alive at that moment (found
 * 2026-09-23). `destroy()` closes that channel and nothing else; the client's
 * HTTP calls are unchanged.
 */
export function serverAggClient(options: Parameters<typeof createAggClient>[0]): AggClient {
  const c = createAggClient(options);
  c.destroy();
  return c;
}

/** Thrown when the deployment was given no aggregator app; `attempt` turns it into the product's own *not configured*. */
class NotConfigured extends Error {}

/** The environment with an app id, or the refusal to call the provider at all. */
function configuredEnv(): PredictionsEnv & { appId: string } {
  const env = readPredictionsEnv();
  if (!env.appId) throw new NotConfigured("no aggregator app is configured");
  return env as PredictionsEnv & { appId: string };
}

let publicClient: AggClient | null = null;
function client(): AggClient {
  if (publicClient) return publicClient;
  const env = configuredEnv();
  publicClient = serverAggClient({ baseUrl: env.baseUrl, appId: env.appId, apiKey: env.apiKey ?? undefined, wsUrl: env.wsUrl, persistSession: false });
  return publicClient;
}

function userClient(session: ProviderUserSession): AggClient {
  const env = configuredEnv();
  const c = serverAggClient({ baseUrl: env.baseUrl, appId: env.appId, apiKey: env.apiKey ?? undefined, persistSession: false });
  c.setAccessToken(session.accessToken);
  return c;
}

async function attempt<T>(read: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await read() };
  } catch (error) {
    if (error instanceof NotConfigured) return failure("PROVIDER_UNAVAILABLE", "This deployment has no prediction provider configured.");
    if ((error as { kind?: unknown })?.kind === "domain") return failure("LINK_UNAVAILABLE", "The market provider does not accept sign-ins from this site yet.");
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
async function leadingPrices(events: readonly VenueEventWithMarkets[], now: number): Promise<ReadonlyMap<string, number>> {
  const ids = events.map((e) => leadMarket(e.venueMarkets, now, rawInPlay(e, now))?.id).filter((id): id is string => typeof id === "string");
  if (ids.length === 0) return new Map();
  try {
    const prices = await client().getMidpoints({ venueMarketIds: ids });
    return midpointMap((prices.data ?? []).map(mapMarketPrices));
  } catch {
    /* A list without live midpoints still lists; the cards say the price is the last known. */
    return new Map();
  }
}

/**
 * The provider keeps events "open" long after their end. A search answers
 * every event still within two days of its end, each to be shown in its own
 * state; a browsed list holds only what a person can still trade — not an
 * event past its close, not one whose every market has stopped.
 */
async function summaries(events: readonly VenueEventWithMarkets[], tradableOnly = false): Promise<readonly PredictionEventSummary[]> {
  const now = Date.now();
  const current = events.filter((e) => !eventStale(e, now));
  const prices = await leadingPrices(current, now);
  const mapped = current.map((e) => mapEventSummary(e, prices, now));
  return tradableOnly ? mapped.filter((e) => eventTradable(e, now)) : mapped;
}

function mapProfile(user: { id: string; username: string | null; externalId: string | null; wallets?: readonly { chain: string; address: string }[]; accounts?: readonly { provider: string; providerAccountId: string }[]; isLocationBlocked?: boolean; venueAccounts?: readonly { venue: string; status: string; kycStatus: string }[] | null }): ProviderUserProfile {
  /* The provider lists a SIWS user's wallet under `accounts` (provider `solana_wallet`), not always under `wallets`. */
  const fromAccounts = (user.accounts ?? [])
    .filter((a) => a.provider === "solana_wallet" || a.provider === "wallet")
    .map((a) => ({ chain: a.provider === "solana_wallet" ? "solana" : "evm", address: a.providerAccountId }));
  const wallets = [...(user.wallets ?? []).map((w) => ({ chain: String(w.chain), address: w.address })), ...fromAccounts];
  const venueAccounts = Array.isArray(user.venueAccounts) ? user.venueAccounts.map((a) => ({ venue: String(a.venue), status: String(a.status), kycStatus: String(a.kycStatus) })) : null;
  return { id: user.id, username: user.username, externalId: user.externalId, wallets, locationBlocked: Boolean(user.isLocationBlocked), venueAccounts };
}

/**
 * An outcome's bars. AGG answers `/charts/bars` with no bars and a state of its own (`warming`, `unsupported`) for a
 * series it serves another way: its finalized history is published as files it signs with their SHA-256, which the
 * SDK fetches and checks (`loadImmutableHistory`), and the bars after them come from `/charts/bars` again. Found
 * 29.10 (CITY-77): the busiest markets answered empty bars at every resolution, and the chart drew nothing. The files
 * are a second way and never a promise — any doubt about them leaves the first answer as it was.
 */
async function readChart(outcomeId: string, resolution: "1m" | "5m" | "1h" | "1d", countBack: number, to: number): Promise<PredictionChart> {
  const first = await client().getChartBars({ venueMarketOutcomeId: outcomeId, resolution, to, countBack });
  if (first.data.length > 0 || first.meta?.state === "empty") return mapChart(first);
  try {
    const manifest = await client().getChartHistoryManifest({ venueMarketOutcomeId: outcomeId, resolution, to, countBack });
    if (manifest.venueMarketOutcomeId !== outcomeId || !manifest.meta?.complete || manifest.resolution !== resolution) return mapChart(first);
    const history = (await loadImmutableHistory({ manifest })).filter((b) => b.t < to);
    let tail: typeof history = [];
    if (manifest.finalizedThrough < to) {
      const after = await client()
        .getChartBars({ venueMarketOutcomeId: outcomeId, resolution, from: manifest.finalizedThrough, to })
        .catch(() => null);
      if (after && after.venue === manifest.venue && after.resolution === manifest.resolution) tail = after.data.filter((b) => b.t >= manifest.finalizedThrough && b.t < to);
    }
    const data = [...history, ...tail].slice(-countBack);
    if (data.length === 0) return mapChart(first);
    const serverTime = Number.isFinite(manifest.meta.serverTime) ? manifest.meta.serverTime : Date.now();
    const last = data.at(-1)!.t;
    return mapChart({ venueMarketOutcomeId: outcomeId, venue: manifest.venue, resolution: manifest.resolution, data, meta: { ...manifest.meta, serverTime, lastBarOpenTime: last, staleSeconds: Math.max(0, (serverTime - last) / 1000) } });
  } catch {
    return mapChart(first);
  }
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
            .sort((a, b) => Date.parse(a.endDate ?? "") - Date.parse(b.endDate ?? ""));
        }
        /* The page is cut after the untradable ones are out, so Ending soon stays full. */
        const listed = await summaries(events, true);
        return { events: ending ? listed.slice(0, limit) : listed, nextCursor: ending ? null : (page.nextCursor ?? null), readAt: new Date().toISOString() };
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

  chart: (outcomeId, resolution, countBack = 96, to) =>
    attempt(async () => {
      const key = `chart:${outcomeId}:${resolution}:${countBack}:${to ?? "now"}`;
      const chart = await cached(key, CHART_TTL_MS, () => readChart(outcomeId, resolution, Math.min(Math.max(countBack, 2), 500), to ?? Date.now()));
      /* An empty answer is often a series AGG is still building: kept a few seconds only, so the next ask reads again. */
      const hit = cache.get(key);
      if (chart.bars.length === 0 && hit) hit.at = Math.min(hit.at, Date.now() - CHART_TTL_MS + EMPTY_CHART_TTL_MS);
      return chart;
    }),

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

  ripple: (venueMarketId, mode, limit = 10, side = "yes") =>
    attempt(() =>
      /* Yes is the provider's own default: asked for it, the key stays the one the research reads share. */
      cached(`ripple:${venueMarketId}:${mode}:${limit}${side === "no" ? ":no" : ""}`, RESEARCH_TTL_MS, async () => {
        try {
          const result = await client().getCorrelatedMarketCascade({ venueMarketId, mode, limit, ...(side === "no" ? { side } : {}) });
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

  appMode: () =>
    attempt(async () => {
      const cfg = (await client().getAppConfig({ cache: "no-store" })) as unknown as Record<string, unknown>;
      return cfg.tradingMode === "live" ? "live" : cfg.tradingMode === "paper" ? "paper" : "unknown";
    }),

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

  signInChallenge: async ({ chain, address, domain, uri, statement, turnstileToken }) => {
    /* Under load the provider answers the start with its bot check instead of a nonce: that is a step for the person, not an outage. */
    let started: Result<Exclude<AggAuthStartResult, { type: "challenge_required" }>>;
    try {
      if (chain !== "solana") throw Object.assign(new Error("only a Solana wallet signs in here"), { status: 400 });
      started = await startThroughBotCheck((body) => client().authStart(body), { provider: "siws" as const }, turnstileToken, () => readBotSiteKey(configuredEnv()));
    } catch (error) {
      return attempt(() => Promise.reject(error));
    }
    if (!started.ok) return started;
    const start = started.value;
    return attempt(async () => {
      if (start.type !== "nonce") throw Object.assign(new Error(`sign-in start answered ${start.type}`), { status: 503 });
      /* The provider checks the statement it was set up with: once the app has one, a message with any other text is refused. */
      const text = start.statement ?? statement ?? undefined;
      const message = client().buildSiwsMessage({ address, chainId: "mainnet", nonce: start.nonce, domain, uri, statement: text });
      return { nonce: start.nonce, message, statement: text ?? null };
    });
  },

  verifySignIn: ({ message, signature }) =>
    attempt(async () => {
      /* A throwaway client: `verify` stores the session on the instance, and this one is discarded at once. */
      const env = configuredEnv();
      const c = serverAggClient({ baseUrl: env.baseUrl, appId: env.appId, apiKey: env.apiKey ?? undefined, persistSession: false });
      try {
        const result = await c.verify({ message, signature });
        return { accessToken: result.accessToken, refreshToken: result.refreshToken ?? null, user: mapProfile(result.user) };
      } catch (error) {
        const status = (error as { status?: number })?.status;
        /* A site the provider does not allow for this app is not a bad signature: the person can do nothing about it, the operator can. */
        if (/unregistered_domain|is not allowed for this app/i.test(String((error as { message?: unknown })?.message ?? ""))) {
          throw Object.assign(new Error("site not allowed"), { status: 403, kind: "domain" });
        }
        if (status === 400 || status === 401) throw Object.assign(new Error("signature refused"), { status: 401, kind: "signature" });
        throw error;
      }
    }).then((r) => (!r.ok && r.code === "SESSION_EXPIRED" ? failure("SIGNATURE_INVALID", "The provider refused that signature; start the link again.") : r)),

  refresh: (refreshToken) =>
    attempt(async () => {
      const env = configuredEnv();
      const response = await fetch(`${env.baseUrl}/auth/token/refresh`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json", "x-app-id": env.appId, ...(env.apiKey ? { "x-app-api-key": env.apiKey } : {}) },
        body: JSON.stringify({ refreshToken }),
        cache: "no-store",
        /* Bounded, so a withdrawal send's lease (WITHDRAW_SEND_LEASE_MS) outlasts the refreshes it may wait on. */
        signal: AbortSignal.timeout(PROVIDER_REFRESH_TIMEOUT_MS),
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

  paperPositions: (session, status, mode = "paper") =>
    attempt(async () => {
      const page = await userClient(session).getExecutionPositions({ mode, status, limit: 50 });
      return (page.data ?? []).map(mapPaperPosition);
    }),

  paperOrders: (session, limit = 50, mode = "paper") =>
    attempt(async () => {
      const page = await userClient(session).getExecutionOrders({ mode, limit: Math.min(limit, 100) });
      return (page.data ?? []).map(mapPaperOrder);
    }),

  route: (session, request) =>
    attempt(async () => {
      const c = session ? userClient(session) : client();
      const quotedAt = new Date().toISOString();
      const mode = request.mode ?? "paper";
      /* A live buy asks for every cost, one-time setup included, so the Review and the cap see the whole of it. */
      const deepEstimate = mode === "live" && request.side === "buy" ? true : undefined;
      /* A live route is priced only where live orders are open; an empty list would mean every venue, so it is never sent empty. */
      const allowedVenues = mode === "live" ? (request.allowedVenues ?? []).map((v) => v as Venue) : undefined;
      if (mode === "live" && (!allowedVenues || allowedVenues.length === 0)) throw Object.assign(new Error("a live route needs its venues"), { status: 400 });
      const route =
        request.side === "buy"
          ? await c.getSmartRoute({ venueMarketOutcomeId: request.outcomeId, tradeSide: "buy", maxSpend: request.spendUsd ?? 0, mode, compareVenues: true, slipCapBps: request.slipCapBps, allowedVenues, deepEstimate })
          : await c.getSmartRoute({ venueMarketOutcomeId: request.outcomeId, tradeSide: "sell", sellShares: request.sellShares ?? 0, mode, compareVenues: true, slipCapBps: request.slipCapBps, allowedVenues });
      return mapRoute(route, request.side, request.side === "buy" ? (request.spendUsd ?? 0) : (request.sellShares ?? 0), quotedAt);
    }),

  execute: (session, request) =>
    attempt(async () => {
      const mode = request.mode ?? "paper";
      const fallback = mode === "paper" ? request.fallback : null;
      const accepted = await userClient(session)
        .executeManaged({
          quoteId: request.quoteId,
          mode,
          ...(fallback
            ? {
                fallbackToLatest: {
                  outcomeId: fallback.outcomeId,
                  side: fallback.side,
                  maxSpend: fallback.spendUsd,
                  sellShares: fallback.sellShares,
                },
              }
            : {}),
        })
        .catch((error: unknown) => {
          /* A timeout or a conflict on the fill says nothing about whether it ran: never read as a refusal. */
          const status = (error as { status?: unknown })?.status;
          if (status === 408 || status === 409) throw Object.assign(new Error("the fill got no clear answer"), { status: 503 });
          throw error;
        });
      return { quoteId: accepted.quoteId, orderIds: accepted.orderIds ?? [], status: accepted.status, alreadyAccepted: Boolean(accepted.alreadyAccepted) };
    }),

  executionStatus: (session, quoteId, mode = "paper") => attempt(async () => mapExecution(await userClient(session).getExecutionStatus({ quoteId, mode }))),

  cancelOrder: (session, orderId) =>
    attempt(async () => {
      const answer = await userClient(session).cancelManagedOrder(orderId);
      return { orderIds: answer.orderIds ?? [orderId], status: answer.status === "cancelled" ? "cancelled" : "cancel_pending" };
    }),

  placeLimitOrder: (session, request) =>
    attempt(async () => {
      const answer = await userClient(session)
        .placeLimitOrder({
          venue: request.venue as Venue,
          venueMarketOutcomeId: request.outcomeId,
          side: request.side,
          limitPriceRaw: limitRaw(request.price),
          sizeRaw: limitRaw(request.shares),
          timeInForce: request.timeInForce,
          clientOrderId: request.clientOrderId,
          ...(request.timeInForce === "GTD" && request.expiresAt ? { expiresAt: request.expiresAt } : {}),
        })
        .catch((error: unknown) => {
          /* A timeout or a conflict says nothing about whether the venue took it: never read as a refusal. The same client id is asked about, never sent again as a new order. */
          const status = (error as { status?: unknown })?.status;
          if (status === 408 || status === 409) throw Object.assign(new Error("the limit order got no clear answer"), { status: 503 });
          throw error;
        });
      return mapLimitPlaced(answer);
    }),

  limitOrders: (session, limit = 50) =>
    attempt(async () => {
      const page = await userClient(session).getExecutionOrders({ mode: "live", orderType: "limit", limit: Math.min(limit, 100) });
      return (page.data ?? []).map(mapLimitOrder);
    }),

  redeem: (session, outcomeIds) =>
    attempt(async () => {
      const answer = await userClient(session).redeem({ venueMarketOutcomeIds: [...outcomeIds], mode: "live" });
      const known = new Set(["submitted", "confirmed", "ineligible", "rejected"]);
      /* A leg status this reader does not know is not a refusal: it is kept as unknown. */
      return {
        redeemId: String(answer.redeemId ?? ""),
        legs: (answer.results ?? []).map((leg) => ({
          outcomeId: String(leg.venueMarketOutcomeId ?? ""),
          status: (known.has(leg.status) ? leg.status : "unknown") as "submitted" | "confirmed" | "ineligible" | "rejected" | "unknown",
          txHash: leg.txHash ?? null,
          reason: leg.reason ?? null,
        })),
      };
    }),

  depositTarget: (session) => attempt(async () => solanaDepositTarget(await userClient(session).getDepositAddresses())),

  liveBalance: (session) => attempt(async () => mapLiveBalance(await userClient(session).getManagedBalances({ mode: "live" }))),

  deposits: (session, limit = 10) => attempt(async () => mapDeposits(await userClient(session).getUserActivity({ type: "deposit", limit: Math.min(Math.max(limit, 1), 50) }))),

  withdrawable: (session, destinationChainId) =>
    attempt(async () => {
      const quote = await userClient(session).getWithdrawalQuote({ tokenSymbol: "USDC", destinationChainId });
      return { maxDeliverableRaw: typeof quote.maxDeliverableRaw === "string" && /^\d+$/.test(quote.maxDeliverableRaw) ? quote.maxDeliverableRaw : null };
    }),

  withdrawPreview: (session, request) =>
    attempt(async () =>
      mapPreview(
        await userClient(session).withdrawPreview({ amountRaw: request.amountRaw, tokenSymbol: "USDC", destinationAddress: request.destinationAddress, destinationChainId: request.destinationChainId }),
        request.amountRaw,
      ),
    ),

  withdraw: async (session, request) => {
    let c: AggClient;
    try {
      c = userClient(session);
    } catch (error) {
      /* No client, no request: nothing could have been sent. */
      return attempt(() => Promise.reject(error));
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const send = c.withdrawManaged({ requestId: request.requestId, amountRaw: request.amountRaw, tokenSymbol: "USDC", destinationAddress: request.destinationAddress, destinationChainId: request.destinationChainId });
      /* After a timeout the send may still settle; its late answer is read by the next status check, not here. */
      send.catch(() => null);
      const answer = await Promise.race([
        send,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(Object.assign(new Error("withdrawal send timed out"), { timedOut: true })), WITHDRAW_SEND_TIMEOUT_MS);
        }),
      ]);
      const withdrawal = mapWithdrawal(answer);
      return { ok: true, value: withdrawal ? { outcome: "accepted", withdrawal } : { outcome: "unknown", reason: "answer_without_id" } };
    } catch (error) {
      const status = typeof (error as { status?: unknown })?.status === "number" ? ((error as { status: number }).status as number) : null;
      /* The provider refused the session before it looked at the request: refresh and ask again under the same id. */
      if (status === 401) return failure("SESSION_EXPIRED", "The account's session expired; sign with the wallet again.");
      /* Refusals that create nothing. Anything else — no answer, a timeout, a server error, a conflict on the id — may have created one. */
      if (status === 400 || status === 403 || status === 422 || status === 429) return { ok: true, value: { outcome: "refused", failure: classifyProviderError(error) } };
      return { ok: true, value: { outcome: "unknown", reason: (error as { timedOut?: boolean })?.timedOut ? "timeout" : status === null ? "no_answer" : `status_${status}` } };
    } finally {
      if (timer) clearTimeout(timer);
    }
  },

  withdrawal: (session, withdrawalId) =>
    attempt(async () => {
      const mapped = mapWithdrawal(await userClient(session).getWithdrawalStatus(withdrawalId));
      if (!mapped) throw Object.assign(new Error("withdrawal answer without an id"), { status: 503 });
      return mapped;
    }),
};

export function getPredictionProvider(): PredictionProvider {
  return aggProvider;
}
