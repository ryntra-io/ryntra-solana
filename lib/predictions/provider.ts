/**
 * The provider boundary: what a prediction-market aggregator must give
 * Ryntra, stated in Ryntra's own view models. The AGG adapter
 * (`agg/adapter.ts`) is the one implementation; the pages, the routes and the
 * Agent tools read this interface and never the SDK. A second provider, or
 * the same one after a breaking release, is a second adapter — nothing above
 * this line moves.
 *
 * Two kinds of calls: **public** reads that need only the app id (discovery,
 * markets, prices, books, charts, research), and **user** calls that act for
 * one provider session (`ProviderUserSession`) — the paper account, the
 * route, the fill. The session is held by the server (`session.ts`); the
 * adapter receives a bearer and never stores one.
 */

import type { PredictionFailure } from "./failure.ts";
import type {
  PaperBalance,
  PaperExecution,
  PaperOrder,
  PaperPosition,
  PredictionBook,
  PredictionCategory,
  PredictionChart,
  PredictionEngineState,
  PredictionEvent,
  PredictionEventSummary,
  PredictionMarketPrices,
  PredictionNews,
  PredictionRelatedMarket,
  PredictionRipple,
  PredictionRoute,
  PredictionSignals,
} from "./model.ts";

export type Result<T> = Readonly<{ ok: true; value: T }> | PredictionFailure;

export type DiscoverQuery = Readonly<{
  /** The provider's category slug; omitted = every category. */
  category?: string | null;
  sort?: "volume24h" | "volume" | "newest" | "ending";
  limit?: number;
  cursor?: string | null;
  /** Keep only events that end after this ISO time (ending-soon lists). */
  endDateFrom?: string | null;
}>;

export type DiscoverPage = Readonly<{ events: readonly PredictionEventSummary[]; nextCursor: string | null; readAt: string }>;

export type RouteRequest = Readonly<{
  outcomeId: string;
  side: "buy" | "sell";
  /** USD to spend on a buy. */
  spendUsd?: number;
  /** Shares to sell on a sell. */
  sellShares?: number;
  slipCapBps?: number;
}>;

export type ExecuteRequest = Readonly<{
  quoteId: string;
  /** The route the quote was made for, so a stale quote can be re-priced by the provider at the same bound. */
  fallback: Readonly<{ outcomeId: string; side: "buy" | "sell"; spendUsd?: number; sellShares?: number }>;
}>;

export type ExecuteAccepted = Readonly<{ quoteId: string; orderIds: readonly string[]; status: string; alreadyAccepted: boolean }>;

/** What the provider says a wallet signature must contain to open its session. */
export type ProviderSignInChallenge = Readonly<{ nonce: string; message: string; statement: string | null }>;

export type ProviderSession = Readonly<{
  accessToken: string;
  refreshToken: string | null;
  user: ProviderUserProfile;
}>;

export type ProviderUserProfile = Readonly<{
  id: string;
  username: string | null;
  externalId: string | null;
  /** The wallet addresses the provider knows for this user, by chain. */
  wallets: readonly Readonly<{ chain: string; address: string }>[];
  locationBlocked: boolean;
}>;

export type ProviderUserSession = Readonly<{ accessToken: string }>;

export type PredictionProvider = Readonly<{
  id: "agg";
  /* ------------------------------------------------------ public reads */
  categories(): Promise<Result<readonly PredictionCategory[]>>;
  discover(query: DiscoverQuery): Promise<Result<DiscoverPage>>;
  search(q: string, limit?: number): Promise<Result<readonly PredictionEventSummary[]>>;
  event(eventId: string): Promise<Result<PredictionEvent>>;
  /** Several events by id, for the watchlist and the plans — missing ids are dropped, never invented. */
  events(eventIds: readonly string[]): Promise<Result<readonly PredictionEventSummary[]>>;
  prices(venueMarketIds: readonly string[]): Promise<Result<readonly PredictionMarketPrices[]>>;
  book(venueMarketId: string, depth?: number): Promise<Result<PredictionBook>>;
  chart(outcomeId: string, resolution: "1m" | "5m" | "1h" | "1d", countBack?: number): Promise<Result<PredictionChart>>;
  signals(venueMarketId: string): Promise<Result<PredictionSignals | null>>;
  related(text: string, limit?: number): Promise<Result<readonly PredictionRelatedMarket[]>>;
  ripple(venueMarketId: string, mode: "expand" | "hedge", limit?: number): Promise<Result<PredictionRipple>>;
  news(venueMarketId: string, limit?: number): Promise<Result<PredictionNews>>;
  engine(): Promise<Result<PredictionEngineState>>;
  /* ------------------------------------------------------ sign-in and link */
  /** The statement is Ryntra's sentence in the wallet prompt; the provider accepts a partner's own (verified 2026-09-17). */
  signInChallenge(input: Readonly<{ address: string; domain: string; uri: string; statement?: string | null }>): Promise<Result<ProviderSignInChallenge>>;
  verifySignIn(input: Readonly<{ message: string; signature: string }>): Promise<Result<ProviderSession>>;
  refresh(refreshToken: string): Promise<Result<Readonly<{ accessToken: string; refreshToken: string | null }>>>;
  profile(session: ProviderUserSession): Promise<Result<ProviderUserProfile>>;
  linkExternalId(session: ProviderUserSession, assertion: Readonly<{ externalId: string; timestamp: number; hmac: string }>): Promise<Result<ProviderUserProfile>>;
  signOut(session: ProviderUserSession): Promise<Result<null>>;
  /* ------------------------------------------------------ the paper account */
  paperBalance(session: ProviderUserSession): Promise<Result<PaperBalance | null>>;
  paperPositions(session: ProviderUserSession, status: "active" | "closed"): Promise<Result<readonly PaperPosition[]>>;
  paperOrders(session: ProviderUserSession, limit?: number): Promise<Result<readonly PaperOrder[]>>;
  route(session: ProviderUserSession | null, request: RouteRequest): Promise<Result<PredictionRoute>>;
  execute(session: ProviderUserSession, request: ExecuteRequest): Promise<Result<ExecuteAccepted>>;
  executionStatus(session: ProviderUserSession, quoteId: string): Promise<Result<PaperExecution>>;
}>;
