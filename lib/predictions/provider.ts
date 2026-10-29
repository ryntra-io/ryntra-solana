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
import type { TradeMode } from "./live.ts";
import type { DepositRow, DepositTarget, LiveBalance, ProviderWithdrawal, WithdrawPreview } from "./funding.ts";
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
  PredictionLimitOrder,
  PredictionLimitPlaced,
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
  /** Paper unless named; a live route is priced only across `allowedVenues`. */
  mode?: TradeMode;
  allowedVenues?: readonly string[];
}>;

export type ExecuteRequest = Readonly<{
  quoteId: string;
  /** The mode the quote was priced in; a live fill cannot execute a paper quote, nor the other way round. */
  mode?: TradeMode;
  /**
   * The route the quote was made for, so a stale paper quote can be re-priced
   * by the provider at the same bound. Null on a live order: real money is
   * spent only at the price the person reviewed, never at a newer one.
   */
  fallback: Readonly<{ outcomeId: string; side: "buy" | "sell"; spendUsd?: number; sellShares?: number }> | null;
}>;

export type ExecuteAccepted = Readonly<{ quoteId: string; orderIds: readonly string[]; status: string; alreadyAccepted: boolean }>;

/**
 * A limit order on one venue, priced by the person rather than by a route.
 * `clientOrderId` is Ryntra's own id for it: the same id sent again answers
 * the same order, so a send with no clear answer is never a second order.
 */
export type PlaceLimitRequest = Readonly<{
  venue: string;
  outcomeId: string;
  side: "buy" | "sell";
  /** The price on the venue's grid, 0–1. */
  price: number;
  shares: number;
  timeInForce: "GTC" | "GTD";
  /** Required by `GTD`, left out by `GTC`. */
  expiresAt?: string | null;
  clientOrderId: string;
}>;

/** What a cancel came to: gone at once, or asked of the venue and still to be confirmed by the status. */
export type CancelAnswer = Readonly<{ orderIds: readonly string[]; status: "cancelled" | "cancel_pending" }>;

/** One resolved outcome asked to pay out, as the provider answered for it. */
export type RedeemLeg = Readonly<{ outcomeId: string; status: "submitted" | "confirmed" | "ineligible" | "rejected" | "unknown"; txHash: string | null; reason: string | null }>;
export type RedeemAnswer = Readonly<{ redeemId: string; legs: readonly RedeemLeg[] }>;

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
  /** The person's accounts on venues that trade only through one (Kalshi, Novig, ProphetX), with the provider's identity-check state; null when the profile lists none. */
  venueAccounts: readonly Readonly<{ venue: string; status: string; kycStatus: string }>[] | null;
}>;

export type ProviderUserSession = Readonly<{ accessToken: string }>;

/** A withdrawal of USDC from the managed balance to one address on one chain. */
export type WithdrawRequest = Readonly<{ amountRaw: string; destinationAddress: string; destinationChainId: number }>;

/**
 * What a withdrawal send came to. `refused` — the provider answered and
 * created nothing; `unknown` — no answer that says either way (no response,
 * a timeout, a server error): the same request id is asked again, never a
 * new one, and nothing is said to the person about money that was or was not
 * sent.
 */
export type WithdrawSend =
  | Readonly<{ outcome: "accepted"; withdrawal: ProviderWithdrawal }>
  | Readonly<{ outcome: "refused"; failure: PredictionFailure }>
  | Readonly<{ outcome: "unknown"; reason: string }>;

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
  /** Bars up to `to` (ms, exclusive; now without it), `countBack` of them at most. */
  chart(outcomeId: string, resolution: "1m" | "5m" | "1h" | "1d", countBack?: number, to?: number): Promise<Result<PredictionChart>>;
  signals(venueMarketId: string): Promise<Result<PredictionSignals | null>>;
  related(text: string, limit?: number): Promise<Result<readonly PredictionRelatedMarket[]>>;
  /** `side` is the side of this market the candidates are for; Yes when left out. */
  ripple(venueMarketId: string, mode: "expand" | "hedge", limit?: number, side?: "yes" | "no"): Promise<Result<PredictionRipple>>;
  news(venueMarketId: string, limit?: number): Promise<Result<PredictionNews>>;
  engine(): Promise<Result<PredictionEngineState>>;
  /** The app's own trading mode, read fresh (never cached): a paper app has no real-money path. */
  appMode(): Promise<Result<"paper" | "live" | "unknown">>;
  /* ------------------------------------------------------ sign-in and link */
  /** The wallet prompt's statement: the one the provider's app is set up with when it has one (any other is refused), Ryntra's own sentence otherwise. */
  /** CHALLENGE_REQUIRED (with `siteKey`) when the provider wants its bot check first; `turnstileToken` is that check's answer on the next start. */
  signInChallenge(input: Readonly<{ chain: "solana"; address: string; domain: string; uri: string; statement?: string | null; turnstileToken?: string | null }>): Promise<Result<ProviderSignInChallenge>>;
  verifySignIn(input: Readonly<{ message: string; signature: string }>): Promise<Result<ProviderSession>>;
  refresh(refreshToken: string): Promise<Result<Readonly<{ accessToken: string; refreshToken: string | null }>>>;
  profile(session: ProviderUserSession): Promise<Result<ProviderUserProfile>>;
  linkExternalId(session: ProviderUserSession, assertion: Readonly<{ externalId: string; timestamp: number; hmac: string }>): Promise<Result<ProviderUserProfile>>;
  signOut(session: ProviderUserSession): Promise<Result<null>>;
  /* ------------------------------------------------------ the trading account (paper unless `mode` says live) */
  paperBalance(session: ProviderUserSession): Promise<Result<PaperBalance | null>>;
  paperPositions(session: ProviderUserSession, status: "active" | "closed", mode?: TradeMode): Promise<Result<readonly PaperPosition[]>>;
  paperOrders(session: ProviderUserSession, limit?: number, mode?: TradeMode): Promise<Result<readonly PaperOrder[]>>;
  route(session: ProviderUserSession | null, request: RouteRequest): Promise<Result<PredictionRoute>>;
  execute(session: ProviderUserSession, request: ExecuteRequest): Promise<Result<ExecuteAccepted>>;
  executionStatus(session: ProviderUserSession, quoteId: string, mode?: TradeMode): Promise<Result<PaperExecution>>;
  /** Cancels one of the provider's orders that is still working; a filled one stays filled. */
  cancelOrder(session: ProviderUserSession, orderId: string): Promise<Result<CancelAnswer>>;
  /**
   * Places a limit order on one venue at the price the person named. Live
   * only: the provider's limit call takes no mode, so there is no paper limit
   * order at the provider and a simulated one is Ryntra's own.
   */
  placeLimitOrder(session: ProviderUserSession, request: PlaceLimitRequest): Promise<Result<PredictionLimitPlaced>>;
  /** The provider's own limit orders of this person, newest first. */
  limitOrders(session: ProviderUserSession, limit?: number): Promise<Result<readonly PredictionLimitOrder[]>>;
  /** Asks the venues to pay out resolved winning outcomes; live only. */
  redeem(session: ProviderUserSession, outcomeIds: readonly string[]): Promise<Result<RedeemAnswer>>;
  /* ------------------------------------------------------ live money: the managed account */
  /** The managed wallet's Solana deposit address, while the provider still creates it `preparing`. */
  depositTarget(session: ProviderUserSession): Promise<Result<DepositTarget>>;
  liveBalance(session: ProviderUserSession): Promise<Result<LiveBalance>>;
  deposits(session: ProviderUserSession, limit?: number): Promise<Result<readonly DepositRow[]>>;
  /** The most USDC that can be delivered to that chain now. */
  withdrawable(session: ProviderUserSession, destinationChainId: number): Promise<Result<Readonly<{ maxDeliverableRaw: string | null }>>>;
  /** The fee and the amount delivered, priced now; creates nothing. */
  withdrawPreview(session: ProviderUserSession, request: WithdrawRequest): Promise<Result<WithdrawPreview>>;
  /** Sends a withdrawal under the caller's request id — the same id and body always answer the same withdrawal. */
  withdraw(session: ProviderUserSession, request: WithdrawRequest & Readonly<{ requestId: string }>): Promise<Result<WithdrawSend>>;
  withdrawal(session: ProviderUserSession, withdrawalId: string): Promise<Result<ProviderWithdrawal>>;
}>;
