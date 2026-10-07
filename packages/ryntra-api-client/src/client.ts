/**
 * The Ryntra API v1 client — fetch in, typed answers out, one error class.
 *
 * Built for the native line: no cookie is ever read or sent; the bearer comes
 * from the `token` provider the app wires to its secure storage; every request
 * names the contract major; every refusal is a `RyntraApiError` with the
 * server's stable `code`, so the app switches on the code and never parses a
 * message. The client validates nothing itself — the server is the contract;
 * the types are the contract's shapes.
 */

import {
  API_HEADER,
  API_MAJOR,
  API_VERSION_HEADER,
  type AgentBriefResponse,
  type AgentBudgetState,
  type AgentCriticResponse,
  type AgentDraftResponse,
  type AgentLensRequest,
  type AgentMessageRequest,
  type AgentMessageResponse,
  type AgentSessionOpenRequest,
  type AgentSessionResponse,
  type AgentSuggestionsResponse,
  type ApiError,
  type AddressEvidenceRead,
  type ApiErrorCode,
  type Capabilities,
  type ChallengeRequest,
  type ChallengeResponse,
  type EvidenceWindow,
  type HoldingsRequest,
  type HoldingsResponse,
  type MarketEvidenceRead,
  type PlanAssetRead,
  type PlanCreateRequest,
  type PlanListResponse,
  type PlanResponse,
  type PlanMemoryResponse,
  type PlanResultsResponse,
  type PlanStatusRequest,
  type PlanUpdateRequest,
  type PlanVersionResponse,
  type PopularCompaniesResponse,
  type PayLinkCreateRequest,
  type PayLinkListResponse,
  type PayLinkResponse,
  type PaySubmitRequest,
  type PaySubmitResponse,
  type PayTransactionRequest,
  type PayTransactionResponse,
  type PositionsResponse,
  type PortfolioRiskResponse,
  type PositionWatchRequest,
  type PositionWatchResponse,
  type RecipientCheckQuery,
  type RecipientCheckResponse,
  type RevokeResponse,
  type RuleBudgetRequest,
  type RuleBudgetResponse,
  type RuleAssetResponse,
  type RuleCreateRequest,
  type RuleDeleteResponse,
  type RuleListResponse,
  type RuleResponse,
  type RuleStatusRequest,
  type SendReturnedRequest,
  type SendReturnedResponse,
  type SessionResponse,
  type SpotCandlesResponse,
  type SpotCategory,
  type SpotMarketResponse,
  type SpotMarketsResponse,
  type SpotTimeframe,
  type StockAssetResponse,
  type StockQuoteResponse,
  type StockUniverseResponse,
  type StockUniverseSlimResponse,
  type TelegramChannelResponse,
  type TelegramConnectRequest,
  type TelegramConnectResponse,
  type PredictionChartResolution,
  type PredictionDiscoverSort,
  type PredictionsAccountResponse,
  type PredictionsBookResponse,
  type PredictionsChartResponse,
  type PredictionsDiscoverResponse,
  type PredictionsEngineResponse,
  type PredictionsEventResponse,
  type PredictionsEventsResponse,
  type PredictionsLinkResponse,
  type PredictionsLinkVerifyRequest,
  type PredictionLinkChallenge,
  type PredictionsOrderPlacedResponse,
  type PredictionsOrderResponse,
  type PredictionsOrdersRequest,
  type PredictionsOrdersResponse,
  type PredictionsPlanRequest,
  type PredictionsPlanResponse,
  type PredictionsPlansRequest,
  type PredictionsPlansResponse,
  type PredictionsPlanStatusRequest,
  type PredictionsPricesResponse,
  type PredictionsQuoteRequest,
  type PredictionsQuoteResponse,
  type PredictionsResearchResponse,
  type PredictionsWatchlistRequest,
  type PredictionsWatchlistResponse,
  type ActivityRequest,
  type ActivityResponse,
  type MonitoringSurfaceResponse,
  type MonitoringWriteRequest,
  type MonitoringWriteResponse,
  type ReceiptsArchiveGetResponse,
  type ReceiptsArchivePutRequest,
  type ReceiptsArchivePutResponse,
  type RewardsReferralGetResponse,
  type RewardsResponse,
  type SwapCancelReviewRequest,
  type SwapCancelReviewResponse,
  type SwapExecuteRequest,
  type SwapExecuteResponse,
  type SwapOrderRequest,
  type SwapOrderResponse,
  type SwapQuoteRequest,
  type SwapQuoteResponse,
  type SwapRecoverRequest,
  type SwapRecoverResponse,
  type TransferAdoptResponse,
  type TransferPlanRequest,
  type TransferRecoverRequest,
  type TransferRecoverResponse,
  type TransferReviewResponse,
  type TransferSettleRequest,
  type TransferSettleResponse,
  type VerifyRequest,
  type VerifyResponse,
  type WatchlistMergeRequest,
  type WatchlistMergeResponse,
  type WatchlistPutRequest,
  type WatchlistResponse,
} from "./types.ts";

export class RyntraApiError extends Error {
  readonly code: ApiErrorCode | "NETWORK" | "MALFORMED";
  readonly status: number;
  readonly minimumAppVersion: string | null;
  readonly contractVersion: string | null;
  /** On `PLAN_INVALID`: every field that fails, for the form to mark (1.7.0: with a stable `code` where the server has one); empty otherwise. */
  readonly issues: readonly Readonly<{ path: string; message: string; code?: string }>[];
  constructor(input: Readonly<{ code: RyntraApiError["code"]; status: number; message: string; minimumAppVersion?: string | null; contractVersion?: string | null; issues?: readonly Readonly<{ path: string; message: string; code?: string }>[] }>) {
    super(input.message);
    this.name = "RyntraApiError";
    this.code = input.code;
    this.status = input.status;
    this.minimumAppVersion = input.minimumAppVersion ?? null;
    this.contractVersion = input.contractVersion ?? null;
    this.issues = input.issues ?? [];
  }
  /** The session must be signed for again: the bearer is absent, expired or revoked. */
  get needsSignIn(): boolean {
    return this.code === "UNAUTHORIZED" || this.code === "SESSION_EXPIRED" || this.code === "SESSION_REVOKED";
  }
}

/**
 * 1.11.0: a refusal from a consumed route — one outside `/api/v1` (the
 * markets, the stocks, the holdings, the activity, the rewards, the
 * monitoring, the predictions, the swap). Its `code` is the route's own
 * (`MARKETS_RATE_LIMITED`, `UNKNOWN_ASSET`, `CANDLES_NO_POOL`, …), not one
 * of the v1 codes, so it is a class of its own rather than a
 * `RyntraApiError` with a code the v1 union does not hold. `NETWORK` and
 * `MALFORMED` mean what they mean on `RyntraApiError`.
 */
export class RyntraRouteError extends Error {
  readonly code: string;
  readonly status: number;
  /** The whole refusal as the route sent it — the swap's `planReview`, `ownerLock`, `submitBoundary`, the rewards' `proof: false` — or null when there was no body. */
  readonly details: Readonly<Record<string, unknown>> | null;
  constructor(input: Readonly<{ code: string; status: number; message: string; details?: Readonly<Record<string, unknown>> | null }>) {
    super(input.message);
    this.name = "RyntraRouteError";
    this.code = input.code;
    this.status = input.status;
    this.details = input.details ?? null;
  }
}

export type FetchLike = (input: string, init: Readonly<{ method: string; headers: Record<string, string>; body?: string }>) => Promise<
  Readonly<{ status: number; headers: Readonly<{ get(name: string): string | null }>; text(): Promise<string> }>
>;

export type RyntraApiClientOptions = Readonly<{
  /** `https://ryntra.io` — no trailing slash. */
  baseUrl: string;
  /** The app's fetch; `globalThis.fetch` when omitted. */
  fetch?: FetchLike;
  /** The current bearer from secure storage, or null when signed out. */
  token?: () => string | null | Promise<string | null>;
  /** Extra headers on every request, e.g. a client identifier. */
  headers?: Readonly<Record<string, string>>;
}>;

function isApiError(value: unknown): value is ApiError {
  if (!value || typeof value !== "object") return false;
  const error = (value as { error?: unknown }).error;
  return Boolean(error && typeof error === "object" && typeof (error as { code?: unknown }).code === "string" && typeof (error as { message?: unknown }).message === "string");
}

export function createRyntraApiClient(options: RyntraApiClientOptions) {
  const base = options.baseUrl.replace(/\/+$/, "");
  const doFetch: FetchLike = options.fetch ?? ((input, init) => globalThis.fetch(input, init));

  async function call<T>(method: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: unknown, auth = false, extra: Readonly<Record<string, string>> = {}): Promise<T> {
    const headers: Record<string, string> = { accept: "application/json", [API_HEADER]: String(API_MAJOR), ...(options.headers ?? {}), ...extra };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (auth) {
      const token = await options.token?.();
      if (!token) throw new RyntraApiError({ code: "UNAUTHORIZED", status: 401, message: "No bearer session." });
      headers.authorization = `Bearer ${token}`;
    }
    let response: Awaited<ReturnType<FetchLike>>;
    try {
      response = await doFetch(`${base}${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    } catch (failure) {
      throw new RyntraApiError({ code: "NETWORK", status: 0, message: failure instanceof Error ? failure.message : String(failure) });
    }
    const contractVersion = response.headers.get(API_VERSION_HEADER);
    const text = await response.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      throw new RyntraApiError({ code: "MALFORMED", status: response.status, message: "The answer was not JSON.", contractVersion });
    }
    if (response.status >= 200 && response.status < 300) return json as T;
    if (isApiError(json)) {
      throw new RyntraApiError({ code: json.error.code, status: response.status, message: json.error.message, minimumAppVersion: json.error.minimumAppVersion ?? null, contractVersion, issues: json.error.issues ?? [] });
    }
    throw new RyntraApiError({ code: "MALFORMED", status: response.status, message: `HTTP ${response.status} without the contract's error shape.`, contractVersion });
  }

  /* 1.11.0 — a consumed route: the same request discipline, its own error (`RyntraRouteError`). `auth` "optional" sends the bearer when the app holds one. */
  async function routeCall<T>(method: "GET" | "POST" | "PUT" | "PATCH", path: string, body?: unknown, auth: "none" | "optional" | "required" = "none"): Promise<T> {
    const headers: Record<string, string> = { accept: "application/json", [API_HEADER]: String(API_MAJOR), ...(options.headers ?? {}) };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (auth !== "none") {
      const token = await options.token?.();
      if (token) headers.authorization = `Bearer ${token}`;
      else if (auth === "required") throw new RyntraRouteError({ code: "UNAUTHORIZED", status: 401, message: "No bearer session." });
    }
    let response: Awaited<ReturnType<FetchLike>>;
    try {
      response = await doFetch(`${base}${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    } catch (failure) {
      throw new RyntraRouteError({ code: "NETWORK", status: 0, message: failure instanceof Error ? failure.message : String(failure) });
    }
    const text = await response.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      throw new RyntraRouteError({ code: "MALFORMED", status: response.status, message: "The answer was not JSON." });
    }
    if (response.status >= 200 && response.status < 300) return json as T;
    const error = json && typeof json === "object" ? (json as { error?: unknown }).error : undefined;
    if (error && typeof error === "object" && typeof (error as { code?: unknown }).code === "string") {
      const { code, message } = error as { code: string; message?: unknown };
      throw new RyntraRouteError({ code, status: response.status, message: typeof message === "string" ? message : code, details: error as Record<string, unknown> });
    }
    /* A route with an older error body names its refusal as a string (`{ error: "proof required" }`) — kept as the message, the status as the code, the body as the details. */
    if (typeof error === "string") throw new RyntraRouteError({ code: `HTTP_${response.status}`, status: response.status, message: error, details: json as Record<string, unknown> });
    throw new RyntraRouteError({ code: "MALFORMED", status: response.status, message: `HTTP ${response.status} without an error body.` });
  }

  const query = (params: Readonly<Record<string, string | number | undefined>>) => {
    const entries = Object.entries(params).filter((entry): entry is [string, string | number] => entry[1] !== undefined);
    return entries.length === 0 ? "" : `?${entries.map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`).join("&")}`;
  };

  return {
    capabilities: () => call<Capabilities>("GET", "/api/v1/capabilities"),
    auth: {
      challenge: (request: ChallengeRequest) => call<ChallengeResponse>("POST", "/api/v1/auth/challenge", request),
      verify: (request: VerifyRequest) => call<VerifyResponse>("POST", "/api/v1/auth/verify", request),
      session: () => call<SessionResponse>("GET", "/api/v1/auth/session", undefined, true),
      refresh: () => call<VerifyResponse>("POST", "/api/v1/auth/refresh", undefined, true),
      revoke: () => call<RevokeResponse>("DELETE", "/api/v1/auth/session", undefined, true),
    },
    watchlist: {
      get: () => call<WatchlistResponse>("GET", "/api/v1/watchlist", undefined, true),
      put: (request: WatchlistPutRequest) => call<WatchlistResponse>("PUT", "/api/v1/watchlist", request, true),
      merge: (request: WatchlistMergeRequest) => call<WatchlistMergeResponse>("POST", "/api/v1/watchlist/merge", request, true),
    },
    /* 1.2.0 — the proven wallet's trading plans; every call needs the bearer. */
    plans: {
      list: () => call<PlanListResponse>("GET", "/api/v1/plans", undefined, true),
      create: (request: PlanCreateRequest) => call<PlanResponse>("POST", "/api/v1/plans", request, true),
      get: (planId: string) => call<PlanResponse>("GET", `/api/v1/plans/${encodeURIComponent(planId)}`, undefined, true),
      update: (planId: string, request: PlanUpdateRequest) => call<PlanResponse>("PUT", `/api/v1/plans/${encodeURIComponent(planId)}`, request, true),
      setStatus: (planId: string, request: PlanStatusRequest) => call<PlanResponse>("POST", `/api/v1/plans/${encodeURIComponent(planId)}/status`, request, true),
      version: (planId: string, version: number) => call<PlanVersionResponse>("GET", `/api/v1/plans/${encodeURIComponent(planId)}/versions/${version}`, undefined, true),
      /* 1.3.0 — Plan · Before signing · Actual, per plan and across the wallet's plans. */
      results: (planId: string) => call<PlanResultsResponse>("GET", `/api/v1/plans/${encodeURIComponent(planId)}/results`, undefined, true),
      allResults: () => call<PlanResultsResponse>("GET", "/api/v1/plans/results", undefined, true),
      /* 1.9.0: the wallet's strategy memory — facts over its own records, each with the citation of the record it stands on. */
      memory: () => call<PlanMemoryResponse>("GET", "/api/v1/plans/memory", undefined, true),
      /* 1.7.0 — any mint resolved the way a create will, with the planning price now; public, no bearer. */
      asset: (mint: string) => call<PlanAssetRead>("GET", `/api/v1/plans/asset?mint=${encodeURIComponent(mint)}`),
    },
    /* 1.12.0 — «Автоінвест»: the proven wallet's rules; every call needs the bearer. A rule reminds; the wallet signs every purchase (`origin.rule` on the swap order). */
    rules: {
      list: () => call<RuleListResponse>("GET", "/api/v1/rules", undefined, true),
      create: (request: RuleCreateRequest) => call<RuleResponse>("POST", "/api/v1/rules", request, true),
      get: (ruleId: string) => call<RuleResponse>("GET", `/api/v1/rules/${encodeURIComponent(ruleId)}`, undefined, true),
      setStatus: (ruleId: string, request: RuleStatusRequest) => call<RuleResponse>("POST", `/api/v1/rules/${encodeURIComponent(ruleId)}/status`, request, true),
      remove: (ruleId: string) => call<RuleDeleteResponse>("DELETE", `/api/v1/rules/${encodeURIComponent(ruleId)}`, undefined, true),
      /* 1.31.0 — what a rule on a token would stand on, before it is written: the floor and the facts of its risk. Public: no bearer. */
      asset: (mint: string) => call<RuleAssetResponse>("GET", `/api/v1/rules/asset?mint=${encodeURIComponent(mint)}`, undefined, false),
      /* 1.13.0 — «Бюджет місяця»: the wallet's own ceiling for every rule; only the person sets it. */
      budget: {
        get: () => call<RuleBudgetResponse>("GET", "/api/v1/rules/budget", undefined, true),
        set: (request: RuleBudgetRequest) => call<RuleBudgetResponse>("PUT", "/api/v1/rules/budget", request, true),
        clear: () => call<RuleBudgetResponse>("DELETE", "/api/v1/rules/budget", undefined, true),
      },
    },
    /* 1.21.0 — Нагляд over the proven wallet's company positions: each with its exit, its state and its one action, decided by the server; «Ryntra попередить» turned on with a preset (Telegram must be connected). Every call needs the bearer. */
    positions: {
      list: () => call<PositionsResponse>("GET", "/api/v1/positions", undefined, true),
      watch: (request: PositionWatchRequest) => call<PositionWatchResponse>("PUT", "/api/v1/positions/watch", request, true),
      /* 1.23.0 — «Ризик портфеля»: one word for the wallet as a whole, with every rule broken or what could not be read, decided by the server. */
      risk: () => call<PortfolioRiskResponse>("GET", "/api/v1/positions/risk", undefined, true),
    },
    /* 1.22.0 — «Гроші»: payment links. Making and listing need the bearer (the recipient is always its wallet); one link reads for anyone with it. Paying a Ryntra link runs on the page's own routes, the bearer paying as its own wallet (`RyntraRouteError`). */
    pay: {
      create: (request: PayLinkCreateRequest) => call<PayLinkResponse>("POST", "/api/v1/pay/requests", request, true),
      list: () => call<PayLinkListResponse>("GET", "/api/v1/pay/requests", undefined, true),
      get: (id: string) => call<PayLinkResponse>("GET", `/api/v1/pay/requests/${encodeURIComponent(id)}`),
      transaction: (id: string, request: PayTransactionRequest) => routeCall<PayTransactionResponse>("POST", `/api/pay/${encodeURIComponent(id)}/transaction`, request, "required"),
      submit: (id: string, request: PaySubmitRequest) => routeCall<PaySubmitResponse>("POST", `/api/pay/${encodeURIComponent(id)}/submit`, request, "required"),
    },
    /* 1.22.0 — Send on the web's own transfer routes (`RyntraRouteError`): the Review with «Перевірка» counted by the server, adopt when the wallet added only its fee guards (ask `money.returned`), settle once, recover by the signature. `recover` takes the bearer in place of the site's origin; the others need no session — the review proof and the wallet's signature bind the transfer. */
    transfer: {
      plan: (request: TransferPlanRequest) => routeCall<TransferReviewResponse>("POST", "/api/solana/transfer/plan", request),
      adopt: (request: TransferSettleRequest) => routeCall<TransferAdoptResponse>("POST", "/api/solana/transfer/adopt", request),
      settle: (request: TransferSettleRequest) => routeCall<TransferSettleResponse>("POST", "/api/solana/transfer/settle", request),
      recover: (request: TransferRecoverRequest) => routeCall<TransferRecoverResponse>("POST", "/api/solana/transfer/recover", request, "required"),
    },
    /* 1.22.0 — «Гроші»: the recipient check before a transfer and the reading of what the wallet returned; public, no session. */
    money: {
      recipient: (request: RecipientCheckQuery) => call<RecipientCheckResponse>("GET", `/api/v1/money/recipient${query({ to: request.to, mint: request.mint, from: request.from })}`),
      returned: (request: SendReturnedRequest) => call<SendReturnedResponse>("POST", "/api/v1/money/send/returned", request),
    },
    /* 1.8.0 — Ryn, the agent: the proven wallet's conversation; every call but the suggestions needs the bearer. */
    agent: {
      openSession: (request: AgentSessionOpenRequest = {}) => call<AgentSessionResponse>("POST", "/api/v1/agent/session", request, true),
      session: (sessionId: string) => call<AgentSessionResponse>("GET", `/api/v1/agent/session/${encodeURIComponent(sessionId)}`, undefined, true),
      message: (request: AgentMessageRequest) => call<AgentMessageResponse>("POST", "/api/v1/agent/message", request, true),
      draft: (draftId: string) => call<AgentDraftResponse>("GET", `/api/v1/agent/drafts/${encodeURIComponent(draftId)}`, undefined, true),
      budget: () => call<AgentBudgetState>("GET", "/api/v1/agent/budget", undefined, true),
      /* 1.10.0 — the two formats on a subject; `compose` defaults to `deterministic`, which never reaches a model and never spends. */
      brief: (request: AgentLensRequest) => call<AgentBriefResponse>("POST", "/api/v1/agent/brief", request, true),
      critic: (request: AgentLensRequest) => call<AgentCriticResponse>("POST", "/api/v1/agent/critic", request, true),
      /** Public: `context` as the route reads it (`asset:<mint>[:<symbol>]`, `plan:<id>`, `portfolio`, `note:<id>`, `page:<name>`). */
      suggestions: (context?: string, locale: "en" | "uk" = "en") => call<AgentSuggestionsResponse>("GET", `/api/v1/agent/suggestions?locale=${locale}${context ? `&context=${encodeURIComponent(context)}` : ""}`),
    },
    /* 1.5.0 — the observation a plan's evidence conditions are judged on; public, no bearer. 1.6.0 — the point-in-time window `now` (the security provider's) and the recipient check. */
    research: {
      evidence: (mint: string, window: EvidenceWindow = "24h") => call<MarketEvidenceRead>("GET", `/api/v1/research/evidence?mint=${encodeURIComponent(mint)}&window=${window}`),
      addressEvidence: (address: string) => call<AddressEvidenceRead>("GET", `/api/v1/research/address-evidence?address=${encodeURIComponent(address)}`),
    },
    /* 1.11.0 — the proven wallet's Telegram channel, the one Settings connects on ryntra.io; every call needs the bearer. */
    notifications: {
      telegram: () => call<TelegramChannelResponse>("GET", "/api/v1/notifications/telegram", undefined, true),
      connectTelegram: (request: TelegramConnectRequest = {}) => call<TelegramConnectResponse>("POST", "/api/v1/notifications/telegram", request, true),
      disconnectTelegram: () => call<TelegramChannelResponse>("DELETE", "/api/v1/notifications/telegram", undefined, true),
    },
    /* 1.11.0 — the consumed routes (not v1 paths); a refusal is a `RyntraRouteError` with the route's own code. Public reads carry no bearer. */
    markets: {
      list: (view: "all" | SpotCategory = "all", limit?: number) => routeCall<SpotMarketsResponse>("GET", `/api/spot/markets${query({ view, limit })}`),
      search: (q: string, limit?: number) => routeCall<SpotMarketsResponse>("GET", `/api/spot/markets${query({ q, limit })}`),
      byMints: (mints: readonly string[]) => routeCall<SpotMarketsResponse>("GET", `/api/spot/markets${query({ mints: mints.join(",") })}`),
      get: (mint: string) => routeCall<SpotMarketResponse>("GET", `/api/spot/market${query({ mint })}`),
      candles: (mint: string, timeframe: SpotTimeframe = "1h", limit?: number) => routeCall<SpotCandlesResponse>("GET", `/api/spot/candles${query({ mint, tf: timeframe, limit })}`),
    },
    stocks: {
      /* 1.20.0 — «Популярне» as the server lists it, a v1 path: the listed companies by the day's trading; `exclude` a company's mint beside its own page. Public. */
      popular: (options: Readonly<{ limit?: number; exclude?: string }> = {}) => call<PopularCompaniesResponse>("GET", `/api/v1/stocks/popular${query({ limit: options.limit, exclude: options.exclude })}`),
      universe: () => routeCall<StockUniverseResponse>("GET", "/api/stocks/universe"),
      slim: (options: Readonly<{ q?: string; mints?: readonly string[]; limit?: number }> = {}) =>
        routeCall<StockUniverseSlimResponse>("GET", `/api/stocks/universe${query({ shape: "slim", q: options.q, mints: options.mints?.join(","), limit: options.limit })}`),
      asset: (ticker: string) => routeCall<StockAssetResponse>("GET", `/api/stocks/asset${query({ ticker })}`),
      quote: (ticker: string, usd: number, side: "BUY" | "SELL" = "BUY") => routeCall<StockQuoteResponse>("GET", `/api/stocks/quote${query({ ticker, side, usd })}`),
    },
    /* Public: any address, as the chain states it. */
    holdings: (request: HoldingsRequest) => routeCall<HoldingsResponse>("POST", "/api/solana/holdings", request),
    /* Public by address; the bearer, when the app holds one, adds the owner's reward rows. */
    activity: (request: ActivityRequest) => routeCall<ActivityResponse>("POST", "/api/solana/activity", request, "optional"),
    /* The proven wallet's receipt archive — the bearer's own address only. */
    receipts: {
      archive: (address: string) => routeCall<ReceiptsArchiveGetResponse>("GET", `/api/solana/receipts/archive${query({ address })}`, undefined, "required"),
      store: (request: ReceiptsArchivePutRequest) => routeCall<ReceiptsArchivePutResponse>("PUT", "/api/solana/receipts/archive", request, "required"),
    },
    /* Read-only: what the proven wallet earned, and a referral code's preview. A claim is a payout and has no method here. */
    rewards: {
      get: (address: string, locale: "en" | "uk" = "en") => routeCall<RewardsResponse>("GET", `/api/rewards${query({ address, locale })}`, undefined, "required"),
      previewReferral: (code: string) => routeCall<RewardsReferralGetResponse>("GET", `/api/rewards/referral${query({ code })}`),
    },
    /* The monitoring surface answers the v1 envelope: a refusal is a `RyntraApiError`. The words follow the locale; the shape does not. */
    monitoring: {
      surface: (locale: "en" | "uk" = "en") => call<MonitoringSurfaceResponse>("GET", "/api/monitoring", undefined, true, { "accept-language": locale }),
      write: (request: MonitoringWriteRequest) => call<MonitoringWriteResponse>("POST", "/api/monitoring", request, true),
    },
    /* The five routes a real trade goes through (APP_SIGNS_SERVER_SUBMITS): the app signs the reviewed bytes, the server submits. `quote` is public; the rest need the bearer, whose wallet must be the taker. 1.20.0: `quote` and `order` answer `check` — «Перевірка»'s four lines and the reserve, counted by the server; draw them, count none. */
    swap: {
      quote: (request: SwapQuoteRequest) => routeCall<SwapQuoteResponse>("POST", "/api/solana/swap/quote", request),
      order: (request: SwapOrderRequest) => routeCall<SwapOrderResponse>("POST", "/api/solana/swap/order", request, "required"),
      execute: (request: SwapExecuteRequest) => routeCall<SwapExecuteResponse>("POST", "/api/solana/swap/execute", request, "required"),
      cancelReview: (request: SwapCancelReviewRequest) => routeCall<SwapCancelReviewResponse>("POST", "/api/solana/swap/cancel-review", request, "required"),
      recover: (request: SwapRecoverRequest) => routeCall<SwapRecoverResponse>("POST", "/api/solana/swap/recover", request, "required"),
    },
    /* Ryntra Predictions in paper mode (request 18). The market reads are public — `discover` and `event` add the wallet's watch state when the app holds a bearer; the rest need it. Nothing moves funds. */
    predictions: {
      discover: (options: Readonly<{ q?: string; category?: string; sort?: PredictionDiscoverSort; limit?: number; cursor?: string }> = {}) => routeCall<PredictionsDiscoverResponse>("GET", `/api/predictions/discover${query(options)}`, undefined, "optional"),
      engine: () => routeCall<PredictionsEngineResponse>("GET", "/api/predictions/engine"),
      events: (ids: readonly string[]) => routeCall<PredictionsEventsResponse>("GET", `/api/predictions/events${query({ ids: ids.join(",") })}`),
      event: (id: string) => routeCall<PredictionsEventResponse>("GET", `/api/predictions/events/${encodeURIComponent(id)}`, undefined, "optional"),
      book: (marketId: string, depth?: number) => routeCall<PredictionsBookResponse>("GET", `/api/predictions/markets/${encodeURIComponent(marketId)}/book${query({ depth })}`),
      prices: (marketId: string, also: readonly string[] = []) => routeCall<PredictionsPricesResponse>("GET", `/api/predictions/markets/${encodeURIComponent(marketId)}/prices${query({ also: also.length > 0 ? also.join(",") : undefined })}`),
      research: (marketId: string, text?: string) => routeCall<PredictionsResearchResponse>("GET", `/api/predictions/markets/${encodeURIComponent(marketId)}/research${query({ text })}`),
      chart: (outcomeId: string, resolution?: PredictionChartResolution, countBack?: number) => routeCall<PredictionsChartResponse>("GET", `/api/predictions/outcomes/${encodeURIComponent(outcomeId)}/chart${query({ resolution, countBack })}`),
      account: () => routeCall<PredictionsAccountResponse>("GET", "/api/predictions/account", undefined, "required"),
      link: {
        start: () => routeCall<PredictionLinkChallenge>("POST", "/api/predictions/link/start", undefined, "required"),
        verify: (request: PredictionsLinkVerifyRequest) => routeCall<PredictionsLinkResponse>("POST", "/api/predictions/link/verify", request, "required"),
        revoke: () => routeCall<PredictionsLinkResponse>("POST", "/api/predictions/link/revoke", undefined, "required"),
      },
      quote: (request: PredictionsQuoteRequest) => routeCall<PredictionsQuoteResponse>("POST", "/api/predictions/quote", request, "required"),
      orders: {
        list: () => routeCall<PredictionsOrdersResponse>("GET", "/api/predictions/orders", undefined, "required"),
        place: (request: PredictionsOrdersRequest) => routeCall<PredictionsOrderPlacedResponse>("POST", "/api/predictions/orders", request, "required"),
        get: (quoteId: string) => routeCall<PredictionsOrderResponse>("GET", `/api/predictions/orders/${encodeURIComponent(quoteId)}`, undefined, "required"),
      },
      plans: {
        list: () => routeCall<PredictionsPlansResponse>("GET", "/api/predictions/plans", undefined, "required"),
        create: (request: PredictionsPlansRequest) => routeCall<PredictionsPlanResponse>("POST", "/api/predictions/plans", request, "required"),
        get: (planId: string) => routeCall<PredictionsPlanResponse>("GET", `/api/predictions/plans/${encodeURIComponent(planId)}`, undefined, "required"),
        update: (planId: string, request: PredictionsPlanRequest) => routeCall<PredictionsPlanResponse>("PATCH", `/api/predictions/plans/${encodeURIComponent(planId)}`, request, "required"),
        setStatus: (planId: string, request: PredictionsPlanStatusRequest) => routeCall<PredictionsPlanResponse>("POST", `/api/predictions/plans/${encodeURIComponent(planId)}/status`, request, "required"),
      },
      watchlist: {
        get: () => routeCall<PredictionsWatchlistResponse>("GET", "/api/predictions/watchlist", undefined, "required"),
        set: (request: PredictionsWatchlistRequest) => routeCall<PredictionsWatchlistResponse>("PUT", "/api/predictions/watchlist", request, "required"),
      },
    },
  };
}

export type RyntraApiClient = ReturnType<typeof createRyntraApiClient>;
