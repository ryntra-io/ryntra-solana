/**
 * The Ryntra API v1 contract, as types — mirrored from `lib/api/v1/contract.ts`
 * (the zod schemas the routes validate with) so this package stands on its
 * own with no dependency; `lib/api/v1/client-types.test.ts` proves the two
 * agree at compile time. Contract version 1.8.0 — Ryn, the agent: the
 * proven wallet's durable conversation (`agent.*` below — the session, the
 * message, the structured answer with its citations, the typed cards, the
 * drafts, the handoffs, the budget state; `capabilities.agent`), additive
 * over 1.7.0 — a plan on a verified
 * crypto or meme token (`PlanAsset.kind`, `unitBasis: "token"`, the
 * planning price every version records (`PlanVersion.planningPrice`), the
 * asset read `plans.asset` — `PlanAssetRead`), the issue code beside the
 * message (`ApiErrorIssue.code`) and the push provider's state
 * (`capabilities.push`), additive over 1.6.0 — a second evidence
 * provider (`ddxyz`, the token's structure over the point-in-time window
 * `now`; `research.providers`) and the recipient check
 * (`research.addressEvidence`, `AddressEvidence*` below), additive over
 * 1.5.0 — the evidence observation, the registry a condition may name, the
 * `evidence` check and block on the Review (`research.*`, `Evidence*`,
 * `MarketEvidence*`, `PlanReviewEvidence` below). Since 1.3.0 the plan routes are live
 * (`plans.*` below) and so are the results (`plans.results`, Plan · Before
 * signing · Actual); the Review's Strategy block is judged by the order
 * route on `origin.plan` and refused as `PLAN_REVIEW_BLOCKED` when a
 * required check fails; the device registry's routes are live too
 * (`/api/v1/notifications/devices`).
 */

export const API_MAJOR = 1 as const;
export const API_CONTRACT_VERSION = "1.24.0" as const;
export const API_HEADER = "X-Ryntra-API" as const;
export const API_VERSION_HEADER = "X-Ryntra-API-Version" as const;
export const NETWORK = "solana:mainnet" as const;
export const WATCHLIST_LIMIT = 200 as const;
export const PLAN_LIST_LIMIT = 50 as const;
/** 1.12.0: how many autoinvest rules one wallet may hold, paused ones included. */
export const RULE_LIST_LIMIT = 20 as const;
/** 1.13.0: how far below its reference point a «Якщо впаде» rule may wait for a price, in whole per cent. */
export const RULE_DIP_MIN_PCT = 1 as const;
export const RULE_DIP_MAX_PCT = 50 as const;
/** 1.13.0: the least and the most a month's autoinvest budget is; 1.16.0: from a dollar (it was ten). */
export const BUDGET_MINIMUM_USD = 1 as const;
export const BUDGET_MAXIMUM_USD = 1_000_000 as const;

export type ApiErrorCode =
  | "VALIDATION_ERROR"
  | "UNSUPPORTED_API"
  | "UNSUPPORTED_CLIENT"
  | "RATE_LIMITED"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NONCE_INVALID"
  | "SIGNATURE_INVALID"
  | "SESSION_EXPIRED"
  | "SESSION_REVOKED"
  | "WALLET_MISMATCH"
  | "CAPABILITY_UNAVAILABLE"
  | "UNAVAILABLE"
  | "PLAN_INVALID"
  | "ASSET_UNCONFIRMED"
  | "PLAN_NOT_FOUND"
  | "PLAN_VERSION_CONFLICT"
  | "PLAN_STATE_REFUSED"
  | "PLAN_REVIEW_BLOCKED"
  /* 1.8.0 — the agent */
  | "AGENT_SESSION_NOT_FOUND"
  | "AGENT_DRAFT_NOT_FOUND"
  | "AGENT_BUDGET_EXHAUSTED"
  | "AGENT_BUSY"
  /* 1.12.0 — autoinvest rules */
  | "RULE_NOT_FOUND"
  | "RULE_LIMIT_REACHED"
  /* 1.21.0 — «Ryntra попередить» */
  | "CHANNEL_REQUIRED"
  | "PRICE_UNAVAILABLE"
  /* 1.22.0 — «Гроші» */
  | "AMOUNT_INVALID"
  | "MINT_UNREADABLE"
  | "PAY_LINK_NOT_FOUND";

/** 1.7.0: the stable ids a plan issue may carry beside its message. */
export type PlanIssueCode =
  | "INVALIDATION_NOT_BELOW_ENTRY"
  | "MAX_PRICE_BELOW_ENTRY"
  | "ENTRY_VALIDITY_OVER"
  | "RESERVE_LEAVES_NOTHING"
  | "RISK_ABOVE_BUDGET"
  | "TARGET_NOT_ABOVE_ENTRY"
  | "TIME_EXIT_IN_PAST"
  | "TIME_EXIT_BEFORE_VALIDITY"
  | "LOSS_PER_UNIT_NOT_POSITIVE"
  | "SIZES_TO_NOTHING"
  | "REFERENCE_NOT_ON_TOKEN"
  | "DEVIATION_NOT_ON_TOKEN";

/** 1.7.0: `code` is a stable id for the rule that failed, where the server has one; absent on a schema refusal. */
export type ApiErrorIssue = Readonly<{ path: string; message: string; code?: PlanIssueCode }>;

export type ApiError = Readonly<{ error: Readonly<{ code: ApiErrorCode; message: string; minimumAppVersion?: string; issues?: readonly ApiErrorIssue[]; planReview?: PlanReview }> }>;

export type ModuleReadiness = "available" | "building" | "planned";
export type SigningMode = "APP_SIGNS_SERVER_SUBMITS" | "WALLET_SENDS_SERVER_ADOPTS";

export type Capabilities = Readonly<{
  api: Readonly<{ major: 1; contractVersion: string; supportedMajors: readonly number[]; sunsetOf: Readonly<Record<string, string>> | null }>;
  minimumAppVersion: Readonly<{ android: string }>;
  network: typeof NETWORK;
  modules: readonly Readonly<{ id: string; group: string; readiness: ModuleReadiness; routes: readonly string[] }>[];
  signing: Readonly<{ modes: readonly SigningMode[]; adoptSignature: boolean }>;
  auth: Readonly<{
    challenge: "/api/v1/auth/challenge";
    verify: "/api/v1/auth/verify";
    session: "/api/v1/auth/session";
    refresh: "/api/v1/auth/refresh";
    sessionTtlSeconds: number;
    challengeTtlSeconds: number;
  }>;
  watchlist: Readonly<{ limit: number; merge: "/api/v1/watchlist/merge" }>;
  /** 1.7.0: `asset` resolves any mint the way a create will; `assetKinds` the kinds a plan may name here. */
  plans: Readonly<{ list: "/api/v1/plans"; limit: number; versionsLimit: number; asset?: "/api/v1/plans/asset"; assetKinds?: readonly PlanAssetKind[]; results?: "/api/v1/plans/results"; memory?: "/api/v1/plans/memory" }>;
  /** 1.7.0: whether the server's push provider is configured — a phone registered into silence can say so honestly. */
  push?: Readonly<{ provider: "configured" | "absent" }>;
  /** 1.12.0: «Автоінвест» — the rules route and its bounds; 1.13.0: the kinds, the fall a «Якщо впаде» rule may wait for, and the month's budget; 1.16.0: `minimumUsd` 1 for a rule and a budget alike. */
  rules?: Readonly<{
    list: "/api/v1/rules";
    limit: number;
    cadences: readonly RuleCadence[];
    minimumUsd: number;
    maximumUsd: number;
    reminderHours: number;
    kinds?: readonly RuleKind[];
    dip?: Readonly<{ minPct: number; maxPct: number }>;
    budget?: Readonly<{ route: "/api/v1/rules/budget"; minimumUsd: number; maximumUsd: number }>;
    /** 1.18.0: «Умова ціни» — the limit a new rule opens on, its bounds in whole per cent, and how old, in minutes, the price and its reference may be. */
    priceCondition?: Readonly<{ defaultPct: number; minPct: number; maxPct: number; maxAgeMinutes: number }>;
    /** 1.19.0: «З кожної оплати» — the modes, the round-up steps, the bounds, how many events a rule shows, and the route that names an account as the person's own. */
    payments?: Readonly<{ modes: readonly RulePaymentMode[]; roundToUsd: readonly number[]; fixedMinUsd: number; fixedMaxUsd: number; percentMin: number; percentMax: number; eventsKept: number; ownAccount: "/api/v1/rules/payments/own" }>;
  }>;
  attribution: Readonly<{ referralAccount: string | null; stats: "/api/stats" }>;
  /** 1.5.0: the evidence route, the provider behind it, the windows and the metric registry a condition may name; 1.6.0: every provider, and the address route. */
  research: Readonly<{
    evidence: "/api/v1/research/evidence";
    /** The first provider (the market one); 1.6.0 lists them all in `providers`. */
    provider: EvidenceProvider;
    attribution: EvidenceAttribution;
    windows: readonly EvidenceWindow[];
    metrics: readonly EvidenceMetricDefinition[];
    conditionsLimit: number;
    /** 1.6.0: every provider behind the route, its attribution and the windows it serves. */
    providers?: readonly Readonly<{ provider: EvidenceProvider; attribution: EvidenceAttribution; windows: readonly EvidenceWindow[] }>[];
    /** 1.6.0: the recipient check before a transfer. */
    addressEvidence?: "/api/v1/research/address-evidence";
  }>;
  /** 1.8.0: Ryn, the agent — its routes, whether a model composes the words here, the tools by kind and the boundary said as a fact. */
  agent?: Readonly<{
    session: "/api/v1/agent/session";
    message: "/api/v1/agent/message";
    drafts: "/api/v1/agent/drafts";
    budget: "/api/v1/agent/budget";
    suggestions: "/api/v1/agent/suggestions";
    /** 1.10.0: the two formats on a subject. */
    brief?: "/api/v1/agent/brief";
    critic?: "/api/v1/agent/critic";
    model: "configured" | "absent";
    tools: Readonly<{ research: readonly string[]; prepare: readonly string[]; execute: false }>;
    answerSections: readonly ("observation" | "meaning" | "counter" | "risks" | "checks" | "actions")[];
    /** 1.10.0: the sections a Brief carries, and the kinds a Critic finding may be. */
    briefSections?: readonly AgentBriefSection[];
    criticKinds?: readonly AgentCriticKind[];
    limits: Readonly<{ questionChars: number; turnsKept: number }>;
  }>;
  /** 1.20.0: «Популярне» — the route, and how many companies it answers by default and at most. «Перевірка» travels as `check` on the swap's quote and order. */
  stocks?: Readonly<{ popular: "/api/v1/stocks/popular"; popularLimit: number; popularMaxLimit: number }>;
  /** 1.21.0: Нагляд over positions — the routes, the presets «Ryntra попередить» offers, and the thresholds the states are judged by. */
  positions?: Readonly<{
    list: "/api/v1/positions";
    watch: "/api/v1/positions/watch";
    presets: readonly Readonly<{ id: PositionWatchPreset; stopPct: number; targetPct: number }>[];
    states: readonly WatchState[];
    nearLimitPct: number;
    aboveExchangePct: number;
    priceMaxAgeMinutes: number;
    /** 1.23.0: «Ризик портфеля» — its route, and the caps it judges. */
    risk?: "/api/v1/positions/risk";
    assetCapPct?: number;
    privateCapPct?: number;
    capsFromUsd?: number;
  }>;
  /** 1.22.0: «Гроші» — the payment links and their bounds, the recipient check, the reading of what the wallet returned, and the transfer routes Send runs on. */
  money?: Readonly<{
    payLinks: "/api/v1/pay/requests";
    expirations: readonly PayLinkExpiration[];
    defaultExpiration: PayLinkExpiration;
    descriptionMax: number;
    listLimit: number;
    recipient: "/api/v1/money/recipient";
    returned: "/api/v1/money/send/returned";
    transfer: "/api/solana/transfer";
  }>;
  observedAt: string;
}>;

/* ------------------------------------------------------------ evidence (1.5.0) */

/** `nansen` — market activity over rolling windows; `ddxyz` — the token's structure at a point in time (1.6.0). */
export type EvidenceProvider = "nansen" | "ddxyz";
/** `now` (1.6.0) is not a duration: the moment the source last analysed the token. */
export type EvidenceWindow = "24h" | "7d" | "now";
export type EvidenceMetricId =
  | "dex_volume_usd"
  | "dex_buy_volume_usd"
  | "dex_sell_volume_usd"
  | "dex_net_volume_usd"
  | "exchange_net_flow_usd"
  | "whale_net_flow_usd"
  | "whale_wallet_count"
  | "top10_holder_share_pct"
  | "holder_count"
  | "mint_authority"
  | "freeze_authority"
  | "transfer_tax_pct"
  | "sniper_holding_pct"
  | "bundler_holding_pct"
  | "dev_holding_pct";
/** 1.6.0: `percent` a share of supply, `count` a whole number, `flag` an authority present (1) or renounced (0). */
export type EvidenceUnit = "usd" | "wallets" | "percent" | "count" | "flag";
export type EvidenceReadState = "FRESH" | "STALE" | "UNKNOWN" | "UNAVAILABLE";
export type EvidenceAttribution = Readonly<{ text: string; href: string }>;
export type EvidenceMetricWords = Readonly<{ label: string; meaning: string; sentence: string }>;

/** One entry of the metric registry: what a condition may name, in what unit, over which windows, in which modes. */
export type EvidenceMetricDefinition = Readonly<{
  id: EvidenceMetricId;
  /** 1.6.0: the provider whose read judges a condition on this figure; absent in 1.5.0 answers. */
  provider?: EvidenceProvider;
  unit: EvidenceUnit;
  /** `whole-market` may be required; `cohort` (the source's labelled groups) informs and never blocks. */
  aggregation: "whole-market" | "cohort";
  windows: readonly EvidenceWindow[];
  conditionModes: readonly ("advisory" | "required")[];
  words: Readonly<{ en: EvidenceMetricWords; uk: EvidenceMetricWords }>;
}>;

export type EvidenceMetricValue = Readonly<{
  id: EvidenceMetricId;
  /** Null when the source answered without the figure — never zero in its place. */
  value: number | null;
  unit: EvidenceUnit;
  window: EvidenceWindow;
  coverage: "full" | "partial" | "absent";
  note: string | null;
}>;

/** A permitted, attributed set of figures about one mint over one window, its times stated separately. */
export type MarketEvidenceSnapshot = Readonly<{
  provider: EvidenceProvider;
  subject: Readonly<{ network: typeof NETWORK; mint: string; symbol: string | null }>;
  window: EvidenceWindow;
  /** When Ryntra asked. */
  fetchedAt: string;
  /** The provider's own statement of when the data stands as of; null when it states none. */
  observedAt: string | null;
  /** The provider's documented response cache, seconds. */
  providerLagSeconds: number;
  /** After this the snapshot is stale and a required condition does not pass on it. */
  expiresAt: string;
  metrics: readonly EvidenceMetricValue[];
  warnings: readonly string[];
  attribution: EvidenceAttribution;
  rightsPolicy: string;
  families: readonly string[];
}>;

/** `GET /api/v1/research/evidence?mint=&window=`. */
export type MarketEvidenceRead = Readonly<{
  state: EvidenceReadState;
  snapshot: MarketEvidenceSnapshot | null;
  reason: string | null;
  served: "provider" | "cache" | "stale-cache" | "none";
}>;

/* ------------------------------------------------------------ address evidence (1.6.0) */

/** The source's own words for a sanctions screening; `unavailable` when it did not answer. */
export type SanctionsState = "clean" | "sanctioned" | "unknown" | "unavailable";
/** Whether the findings engine answered for this address at all; `unsupported` is a kind of address it does not read — never green. */
export type FindingsState = "answered" | "unsupported" | "unavailable";
/** The source's documented bands for its 0–100 figure. */
export type RiskBand = "low" | "medium" | "high" | "critical";

/** The recipient check: what the security provider says about one plain address before a transfer. Never a verdict, never a block. */
export type AddressEvidence = Readonly<{
  provider: EvidenceProvider;
  subject: Readonly<{ network: typeof NETWORK; address: string; kind: "wallet" | "program" | "unknown" }>;
  fetchedAt: string;
  observedAt: string | null;
  providerLagSeconds: number;
  expiresAt: string;
  sanctions: Readonly<{ state: SanctionsState; related: boolean | null }>;
  findings: Readonly<{ state: FindingsState; count: number | null; high: number | null; medium: number | null; score: number | null; band: RiskBand | null }>;
  warnings: readonly string[];
  attribution: EvidenceAttribution;
  rightsPolicy: string;
  families: readonly string[];
}>;

export type AddressEvidenceRead = Readonly<{
  state: EvidenceReadState;
  evidence: AddressEvidence | null;
  reason: string | null;
  served: "provider" | "cache" | "stale-cache" | "none";
}>;

export type ApiClient = Readonly<{ platform: "android"; appVersion: string; package?: string }>;

export type ChallengeRequest = Readonly<{ address: string; locale?: "en" | "uk"; client: ApiClient }>;

export type SiwsInput = Readonly<{
  domain: string;
  address: string;
  statement: string;
  uri: string;
  version: "1";
  chainId: typeof NETWORK;
  nonce: string;
  issuedAt: string;
  expirationTime: string;
}>;

export type ChallengeResponse = Readonly<{ input: SiwsInput; message: string; nonce: string; expiresAt: string }>;

export type VerifyRequest = Readonly<{ address: string; signedMessage: string; signature: string; client: ApiClient }>;

export type ApiSession = Readonly<{ id: string; address: string; network: typeof NETWORK; issuedAt: string; expiresAt: string }>;

export type VerifyResponse = Readonly<{ tokenType: "Bearer"; accessToken: string; session: ApiSession }>;

export type SessionResponse = Readonly<{ session: ApiSession }>;

export type RevokeResponse = Readonly<{ revoked: true }>;

export type WatchlistResponse = Readonly<{ address: string; mints: readonly string[]; version: number; updatedAt: string | null }>;

export type WatchlistPutRequest = Readonly<{ address: string; mints: readonly string[]; ifVersion?: number }>;

export type WatchlistMergeRequest = Readonly<{ address: string; mints: readonly string[]; removed?: readonly string[]; syncedAt: string | null }>;

export type WatchlistMergeResponse = Readonly<{
  address: string;
  mints: readonly string[];
  notKept: readonly string[];
  droppedByServer: readonly string[];
  version: number;
  syncedAt: string;
}>;

/* ------------------------------------------------------------ plans (1.1.0) */

export type PlanStatus = "draft" | "active" | "executed" | "cancelled" | "expired";
export type PlanSide = "BUY";

/** 1.7.0: what a plan's asset is; absent means `stock`. */
export type PlanAssetKind = "stock" | "crypto" | "meme";

export type PlanAsset = Readonly<{
  network: typeof NETWORK;
  mint: string;
  symbol: string;
  /** The tokenizing issuer of a stock; on a `crypto` or `meme` asset (1.7.0) the list that confirms the token (`jupiter-verified`) — present so every reader keeps rendering; `kind` is the way to know. */
  issuer: Readonly<{ id: string; label: string }>;
  /** The underlying share of a stock; on a `crypto` or `meme` asset (1.7.0) the token itself. */
  underlying: Readonly<{ symbol: string; name: string | null }>;
  decimals: number | null;
  /** 1.4.0: the unit every per-unit price of the plan is in; absent means `share`. `token` on a pre-IPO instrument and (1.7.0) on every crypto or meme asset. */
  unitBasis?: "share" | "token";
  /** 1.7.0: `stock` (absent on every plan written before), `crypto` or `meme`. A token plan has no reference, session, issuer mark or multiplier. */
  kind?: PlanAssetKind;
}>;

/** 1.7.0: the planning price the server read when a version was written — context beside the person's own entry, never the executable quote, never invented. */
export type PlanningPriceSource = "issuer-reference" | "jupiter-per-share" | "jupiter-token-price";
export type PlanningPrice = Readonly<{ perUnit: number; source: PlanningPriceSource; observedAt: string; state: "current" | "stale" }>;

/** 1.7.0: `GET /api/v1/plans/asset?mint=` — the asset a plan on this mint would carry, the planning price now (or null), the catalogue's liquidity. */
export type PlanAssetRead = Readonly<{ asset: PlanAsset; planningPrice: PlanningPrice | null; liquidityUsd: number | null; observedAt: string }>;

export type PlanThesis = Readonly<{
  text: string;
  whyNow: string | null;
  horizon: Readonly<{ unit: "days" | "weeks" | "months"; value: number }> | null;
  sources: readonly string[];
  assumptions: readonly string[];
}>;

export type PlanEntry = Readonly<{ pricePerShare: number; maxPricePerShare: number | null; validUntil: string | null }>;
export type PlanCapital = Readonly<{ budgetUsd: number; reserveForCostsUsd: number }>;
export type PlanRisk = Readonly<{ invalidationPerShare: number; plannedRiskUsd: number; costBufferBps: number }>;
export type PlanExit = Readonly<{ targetPerShare: number | null; timeExitAt: string | null; invalidationIsOrder: false }>;
export type PlanExecutionRules = Readonly<{
  maxSlippageBps: number;
  maxQuoteAgeSeconds: number;
  maxReferenceDeviationPct: number | null;
  referenceRequired: boolean;
  minLiquidityUsd: number | null;
}>;
/** Served since 1.5.0: `metric` and `window` are the registry's; `required` blocks on unknown, `advisory` warns. */
export type EvidenceCondition = Readonly<{
  metric: EvidenceMetricId;
  window: EvidenceWindow;
  operator: "gt" | "gte" | "lt" | "lte";
  threshold: number;
  mode: "advisory" | "required";
  onUnknown: "warn" | "block";
}>;

export type PlanRules = Readonly<{
  thesis: PlanThesis;
  entry: PlanEntry;
  capital: PlanCapital;
  risk: PlanRisk;
  exit: PlanExit;
  execution: PlanExecutionRules;
  evidenceConditions: readonly EvidenceCondition[];
}>;

export type PlanSizing = Readonly<{
  model: "spot-long-v1";
  lossPerShareUsd: number;
  riskLimitedUnits: number;
  capitalLimitedUnits: number;
  units: number;
  notionalUsd: number;
  limitedBy: "risk" | "capital";
  assumptions: readonly string[];
}>;

/** 1.7.0: `planningPrice` is the indication the server read at the write, or null when none was available; absent on a version written before 1.7.0. */
export type PlanVersion = Readonly<{ version: number; rules: PlanRules; sizing: PlanSizing; createdAt: string; reason: string | null; planningPrice?: PlanningPrice | null }>;
export type PlanVersionSummary = Readonly<{ version: number; createdAt: string; reason: string | null }>;

export type PlanEvent = "created" | "edited" | "activated" | "cancelled" | "reviewed" | "executed" | "expired";
export type PlanJournalEntry = Readonly<{ at: string; event: PlanEvent; version: number; note: string | null; ref: string | null }>;
export type PlanExecutionRef = Readonly<{
  signature: string;
  version: number;
  reviewedAt: string;
  recordedAt: string;
  outcome: "DONE" | "FAILED" | "UNKNOWN";
  reviewId: string | null;
  /** 1.9.0: the side off the signed bundle's origin; null on an execution recorded before the field, which reads as not established. */
  side: "BUY" | "SELL" | null;
}>;

export type TradingPlan = Readonly<{
  id: string;
  owner: string;
  network: typeof NETWORK;
  status: PlanStatus;
  side: PlanSide;
  asset: PlanAsset;
  version: number;
  current: PlanVersion;
  versions: readonly PlanVersionSummary[];
  journal: readonly PlanJournalEntry[];
  executions: readonly PlanExecutionRef[];
  createdAt: string;
  updatedAt: string;
}>;

export type PlanCreateRequest = Readonly<{ asset: Readonly<{ mint: string }>; rules: PlanRules; activate?: boolean }>;
export type PlanUpdateRequest = Readonly<{ rules: PlanRules; ifVersion: number; reason?: string | null }>;
export type PlanStatusRequest = Readonly<{ status: "active" | "cancelled"; ifVersion: number; reason?: string | null }>;
/** 1.3.0: whether every execution History holds under a plan is on the plan; `pending` counts the ones a re-read will still try to write. */
export type PlanSync = Readonly<{ state: "complete" | "pending"; pending: number }>;
export type PlanResponse = Readonly<{ plan: TradingPlan; sync?: PlanSync }>;
export type PlanListResponse = Readonly<{ address: string; plans: readonly TradingPlan[]; total: number }>;
export type PlanVersionResponse = Readonly<{ planId: string; version: PlanVersion }>;

/* ------------------------------------------------------------ reviews (1.1.0) */

export type PlanCheckId =
  | "status"
  | "asset"
  | "side"
  | "version"
  | "validity"
  | "budget"
  | "entryPrice"
  | "reference"
  | "deviation"
  | "slippage"
  | "quoteAge"
  | "liquidity"
  | "units"
  | "invalidation"
  | "spend"
  | "risk"
  | "size"
  /** 1.5.0: one per evidence condition of the version, in its order. */
  | "evidence"
  /* 1.9.0: the exit, judged only against rules that existed before it. */
  | "exitTarget"
  | "exitInvalidation"
  | "exitTime";

export type PlanCheck = Readonly<{ id: PlanCheckId; outcome: "pass" | "fail" | "unknown"; required: boolean; expected: string; actual: string | null }>;

export type PlanReview = Readonly<{
  planId: string;
  version: number;
  latestVersion: number;
  /** The operation's own id — the same id the execution and the Receipt carry. */
  reviewId: string;
  checkedAt: string;
  verdict: "ready" | "attention" | "blocked";
  checks: readonly PlanCheck[];
  quote: Readonly<{
    side: PlanSide;
    usd: number;
    amount: string;
    unit: "underlying" | "token";
    multiplier: number | null;
    perShareUsd: number | null;
    referencePerShareUsd: number | null;
    referenceState: "current" | "stale" | "unavailable";
    deviationPct: number | null;
    priceImpactPct: number | null;
    slippageBps: number;
    feeBps: number;
    observedAt: string;
    reviewExpiresAt: string;
    /** The loss this exact deal models at the executable price; null when the units are unknown. */
    modelledLossUsd: number | null;
    /** The USD amount that fits the plan at this price; null when the units are unknown. */
    fitUsd: number | null;
  }>;
  /** 1.5.0: the observation the `evidence` checks were judged on; absent on a version without conditions. */
  evidence?: PlanReviewEvidence;
}>;

/** 1.5.0: what the Review knew about the observation before the signature; the figures stay until `retainedUntil`, the verdict stays. */
export type PlanReviewEvidence = Readonly<{
  /** The first provider read; 1.6.0 lists every one in `sources`. */
  provider: EvidenceProvider;
  attribution: EvidenceAttribution;
  /** 1.6.0: every provider the Review read, with its attribution. */
  sources?: readonly Readonly<{ provider: EvidenceProvider; attribution: EvidenceAttribution }>[];
  reads: readonly Readonly<{ provider?: EvidenceProvider; window: EvidenceWindow; state: EvidenceReadState; fetchedAt: string | null; observedAt: string | null; providerLagSeconds: number | null; reason: string | null }>[];
  conditions: readonly Readonly<{
    metric: EvidenceMetricId;
    window: EvidenceWindow;
    operator: "gt" | "gte" | "lt" | "lte";
    threshold: number;
    mode: "advisory" | "required";
    outcome: "pass" | "fail" | "unknown";
    /** The figure judged; null when none, or after `retainedUntil`. */
    value: number | null;
    unit: EvidenceUnit;
  }>[];
  retainedUntil: string;
}>;

/* ------------------------------------------------------------ results (1.3.0; 1.9.0 beyond the entry) */

/** 1.9.0: what one execution did to the position a plan describes. */
export type PlanLeg = "entry" | "exit";

/** 1.9.0: how a figure was established — measured from a settled record, modelled before the signature, or not established at all. */
export type FigureBasis = "known" | "estimated" | "unknown";

export type PlanActual = Readonly<{
  signature: string;
  outcome: "DONE" | "FAILED" | "UNKNOWN";
  settledAt: string;
  usd: number | null;
  amount: string | null;
  unit: "underlying" | "token";
  perShareUsd: number | null;
  modelledLossUsd: number | null;
  feeUsd: number | null;
  receiptHash: string | null;
  /** 1.9.0: the side off the signed bundle's origin. */
  side: "BUY" | "SELL" | null;
  /** 1.9.0: an entry established the position, an exit reduced it. */
  leg: PlanLeg | null;
  /** 1.9.0: what arrived in USD — an exit's proceeds. */
  proceedsUsd: number | null;
  /** 1.9.0: the asset units that left, in `unit` — an exit's size. */
  unitsOut: string | null;
  valueBasis: "PAR" | "PROVIDER_STATED" | null;
  feeBasis: "PROVIDER_STATED" | "PAR" | "NOT_TAKEN" | null;
  /** 1.9.0: `binding` — declared under the plan before signing; `asset` — a settled sell of this plan's mint paired to it by the product, never a declaration. */
  matchedBy: "binding" | "asset" | null;
}>;

/** 1.9.0: one part of the difference between what was planned and what was paid, with what established it. */
export type PlanCostPart = Readonly<{ usd: number | null; pct: number | null; basis: FigureBasis; reason: string | null }>;

/** 1.9.0: where the difference went, in parts that are never added into one number. */
export type PlanCosts = Readonly<{
  plannedPerUnitUsd: number | null;
  quotedPerUnitUsd: number | null;
  filledPerUnitUsd: number | null;
  /** The plan's own price against the Review's executable one: the market between the writing and the Review. */
  marketMove: PlanCostPart;
  /** The executable price against the fill: slippage, price impact and the seconds in between. */
  execution: PlanCostPart;
  /** The service fee the settled row recorded — never the quoted one. */
  fee: PlanCostPart;
  /** What the Review modelled before the signature; an estimate by construction. */
  expected: Readonly<{ feeBps: number | null; slippageBps: number | null; priceImpactPct: number | null; quotedUsd: number | null; referencePerUnitUsd: number | null }>;
}>;

/** 1.9.0: an exit against the rules that existed before it; a later rule is never applied backwards. */
export type PlanExitAdherence = Readonly<{ ruledByVersion: number | null; checks: readonly PlanCheck[]; verdict: "followed" | "deviated" | "unknown"; notBackdated: boolean }>;

/** 1.9.0: what a plan's own executions add up to; a realised figure only with its method and no unknowns. */
export type PlanPosition = Readonly<{
  state: "open" | "closed" | "none";
  unitsIn: string;
  unitsOut: string;
  unitsHeld: string;
  entries: number;
  exits: number;
  costBasisUsd: number | null;
  proceedsUsd: number | null;
  feesUsd: number | null;
  realisedUsd: number | null;
  realisedMethod: "proceeds-minus-cost-basis-and-fees" | null;
  unknowns: readonly string[];
}>;

/** Plan · Before signing · Actual for one execution; the verdict speaks of the entry only. */
export type PlanResult = Readonly<{
  planId: string;
  version: number;
  asset: PlanAsset;
  plan: Readonly<{
    entryPerShareUsd: number;
    maxPricePerShareUsd: number | null;
    budgetUsd: number;
    spendableUsd: number;
    plannedRiskUsd: number;
    invalidationPerShareUsd: number;
    costBufferBps: number;
    sizedUnits: number;
    sizedNotionalUsd: number;
  }>;
  beforeSigning: PlanReview | null;
  actual: PlanActual;
  checks: readonly PlanCheck[];
  /** On an exit this is `unknown` and `checks` is empty — `exit.verdict` is the verdict that speaks of an exit. */
  verdict: "followed" | "deviated" | "unknown";
  /** 1.9.0 */
  costs: PlanCosts;
  /** 1.9.0: null on an entry and wherever the side is not established. */
  exit: PlanExitAdherence | null;
}>;

/* ------------------------------------------------------------ no-trade outcomes (1.9.0) */

/** 1.9.0: why a plan has no trade. None of these is a failure. */
export type PlanNoTradeReason =
  | "review-blocked"
  | "entry-bound-unmet"
  | "liquidity-unavailable"
  | "conditions-unmet"
  | "expired"
  | "cancelled"
  | "invalidated-before-entry"
  | "reviewed-not-taken"
  | "no-review";

export type PlanNoTradeOutcome = Readonly<{
  kind: "no-trade";
  planId: string;
  version: number;
  asset: PlanAsset;
  status: PlanStatus;
  reason: PlanNoTradeReason;
  blockedBy: PlanCheckId | null;
  expected: string | null;
  found: string | null;
  reviews: number;
  /** True when `blockedBy` refused every Review the plan judged. */
  everyReview: boolean;
  lastReview: Readonly<{ reviewId: string; checkedAt: string; verdict: "ready" | "attention" | "blocked" }> | null;
  observedAt: string;
  failure: false;
}>;

export type PlanPositionRow = Readonly<{ planId: string; asset: PlanAsset; status: PlanStatus; version: number; position: PlanPosition }>;

export type PlanResultsSummary = Readonly<{ plans: number; trades: number; entries: number; exits: number; noTrade: number; openPositions: number; closedPositions: number }>;

export type PlanResultsResponse = Readonly<{
  address: string;
  results: readonly PlanResult[];
  sync: PlanSync;
  /** 1.9.0 */
  outcomes: readonly PlanNoTradeOutcome[];
  /** 1.9.0 */
  positions: readonly PlanPositionRow[];
  /** 1.9.0 */
  summary: PlanResultsSummary;
}>;

/* ------------------------------------------------------------ strategy memory (1.9.0) */

export type PlanMemoryKind = "plans-written" | "trades-made" | "blocked-by-rule" | "entry-vs-plan" | "position-open" | "exit-adherence" | "monitoring-said";

export type PlanMemoryCitation = Readonly<{ kind: "plan" | "version" | "review" | "execution" | "ledger" | "note"; id: string; at: string | null; href: string | null }>;

/** 1.9.0: one fact derived from the records at read time, carrying what it stands on; the client composes the sentence. */
export type PlanMemoryFact = Readonly<{
  id: string;
  kind: PlanMemoryKind;
  scope: Readonly<{ kind: "wallet" | "asset" | "plan"; mint: string | null; symbol: string | null; planId: string | null }>;
  figures: readonly Readonly<{ key: string; value: number | null; text: string | null; unit: "usd" | "pct" | "count" | "units" | "word" }>[];
  cites: readonly PlanMemoryCitation[];
  observedAt: string;
}>;

export type PlanMemoryResponse = Readonly<{ address: string; facts: readonly PlanMemoryFact[]; sync: PlanSync }>;

/* ------------------------------------------------------------ executions (1.1.0) */

/** Sent as `origin.plan` on `POST /api/solana/swap/order`. */
export type ExecutionPlanBinding = Readonly<{ planId: string; version: number }>;

/* ------------------------------------------------------------ notifications (1.1.0, schema only) */

export type NotificationCategory = "plan" | "operation" | "market" | "system";
export type QuietHours = Readonly<{ start: string; end: string; timezone: string }>;

export type DeviceRegistrationRequest = Readonly<{
  platform: "android";
  token: string;
  appVersion: string;
  locale?: "en" | "uk";
  categories?: readonly NotificationCategory[];
  quietHours?: QuietHours | null;
}>;

export type DeviceRegistrationResponse = Readonly<{
  deviceId: string;
  address: string;
  platform: "android";
  categories: readonly NotificationCategory[];
  quietHours: QuietHours | null;
  registeredAt: string;
}>;

/* ------------------------------------------------------------ agent (1.8.0) */

export const AGENT_QUESTION_MAX = 2000 as const;
export const AGENT_TURNS_KEPT = 40 as const;

/** Where a conversation was opened from; the agent reads it as context, never as authority. */
export type AgentPage = "spot" | "stocks" | "swap" | "trends" | "strategies" | "results" | "activity" | "predictions";
export type AgentContext =
  | Readonly<{ kind: "asset"; mint: string; symbol?: string }>
  | Readonly<{ kind: "plan"; planId: string }>
  | Readonly<{ kind: "portfolio" }>
  | Readonly<{ kind: "note"; inboxId: string }>
  | Readonly<{ kind: "page"; page: AgentPage }>;

export type AgentQuestionClass =
  | "market"
  | "stock"
  | "evidence"
  | "portfolio"
  | "plans"
  | "plan"
  | "results"
  | "monitoring"
  | "compare"
  | "prepare_plan"
  | "prepare_monitoring"
  | "prepare_trade"
  | "execute"
  | "secret"
  | "help"
  | "unknown";

/** The state of a figure or a read, decided by age against the source's own rule. */
export type AgentState = "current" | "stale" | "unavailable" | "unknown";

/** What a sentence stands on: the source, when it was observed, its state, the reference where one exists, the product page that shows the same read. */
export type AgentCitation = Readonly<{ id: string; tool: string; source: string; observedAt: string | null; state: AgentState; ref: string | null; href: string | null }>;

/** A figure as a card states it: printed text, the number behind it where there is one, the unit, the state, the citation. */
export type AgentFigure = Readonly<{ label: string; value: string; number: number | null; unit: string | null; state: AgentState; cite: string }>;

export type AgentHandoffKind = "builder" | "review" | "plan" | "monitoring" | "market" | "stocks" | "portfolio" | "results" | "compare";
/** A page of this product the person may open next — never an action the agent took. */
export type AgentHandoff = Readonly<{ kind: AgentHandoffKind; href: string; label: string; primary: boolean }>;

export type AgentComparisonCell = Readonly<{ text: string; established: boolean; cite: string | null }>;

export type AgentPlanDraftCard = Readonly<{
  kind: "planDraft";
  draftId: string;
  asset: PlanAsset;
  /** The rules as the builder will open them; null when no entry price could be established and the builder asks for it. */
  rules: PlanRules | null;
  sizing: PlanSizing | null;
  planningPrice: PlanningPrice | null;
  /** What was established for the builder's fields, each null when nothing was; money is never invented. */
  prefill: Readonly<{ entryUsd: number | null; maxPriceUsd: number | null; invalidationUsd: number | null; targetUsd: number | null; budgetUsd: number | null; riskUsd: number | null; validUntil: string | null }>;
  issues: readonly ApiErrorIssue[];
  assumptions: readonly string[];
  handoff: AgentHandoff;
}>;

export type AgentMonitoringDraftCard = Readonly<{
  kind: "monitoringDraft";
  draftId: string;
  subject: Readonly<{ kind: "plan"; planId: string; symbol: string }> | Readonly<{ kind: "asset"; mint: string; symbol: string }>;
  condition: EvidenceCondition;
  observed: AgentFigure | null;
  assumptions: readonly string[];
  handoff: AgentHandoff;
}>;

export type AgentTradeDraftCard = Readonly<{
  kind: "tradeDraft";
  draftId: string;
  side: "BUY" | "SELL";
  mint: string;
  symbol: string;
  amountUsd: number | null;
  plan: Readonly<{ planId: string; version: number }> | null;
  /** Said on every trade draft: nothing is signed or submitted here. */
  boundary: string;
  handoff: AgentHandoff;
}>;

export type AgentDraftCard = AgentPlanDraftCard | AgentMonitoringDraftCard | AgentTradeDraftCard;

/** The typed cards a turn carries beside its words; every figure on a card is a figure a tool read, with its citation. */
export type AgentCard =
  | Readonly<{ kind: "market"; mint: string; symbol: string; name: string; category: "crypto" | "meme" | "stock" | null; verified: boolean; figures: readonly AgentFigure[]; cite: string; href: string }>
  | Readonly<{
      kind: "stock";
      mint: string;
      symbol: string;
      name: string;
      issuer: Readonly<{ id: string; label: string }>;
      instrument: Readonly<{ class: "listed-equity" | "pre-ipo"; unitBasis: "share" | "token"; rights: "issuer-terms" | "economic-exposure" | "loan-participation" }>;
      session: Readonly<{ period: string; exchangeOpen: boolean | null; nextChangeAt: string | null }>;
      lifecycle: Readonly<{ state: string; tradable: boolean }>;
      figures: readonly AgentFigure[];
      cite: string;
      href: string;
    }>
  | Readonly<{ kind: "evidence"; mint: string; provider: EvidenceProvider; window: EvidenceWindow; state: EvidenceReadState; reason: string | null; figures: readonly AgentFigure[]; attribution: EvidenceAttribution | null; cite: string; href: string | null }>
  | Readonly<{
      kind: "holdings";
      tokenRead: "COMPLETE" | "PARTIAL" | "UNAVAILABLE";
      rows: readonly Readonly<{ mint: string; symbol: string; amount: string; priceUsd: number | null; verified: boolean; category: "crypto" | "meme" | "stock" | null; plans: readonly string[] }>[];
      unpriced: number;
      cite: string;
      href: string;
    }>
  | Readonly<{
      kind: "plan";
      planId: string;
      symbol: string;
      assetKind: PlanAssetKind;
      status: PlanStatus;
      version: number;
      figures: readonly AgentFigure[];
      review: Readonly<{ reviewId: string; checkedAt: string; verdict: "ready" | "attention" | "blocked"; failed: readonly Readonly<{ id: PlanCheckId; outcome: "fail" | "unknown"; required: boolean; expected: string; actual: string | null }>[] }> | null;
      cite: string;
      href: string;
    }>
  | Readonly<{
      kind: "note";
      inboxId: string;
      subject: Readonly<{ kind: "trading-plan" | "prediction-plan"; id: string }> | null;
      title: string;
      reason: string;
      createdAt: string;
      finding: Readonly<{ kind: string; outcome: string; observedAt: string | null }> | null;
      cite: string;
      href: string;
    }>
  | Readonly<{ kind: "comparison"; title: string; columns: readonly Readonly<{ id: string; label: string }>[]; rows: readonly Readonly<{ label: string; cells: readonly AgentComparisonCell[] }>[]; note: string; href: string | null }>
  | AgentPlanDraftCard
  | AgentMonitoringDraftCard
  | AgentTradeDraftCard;

/** One sentence and what it stands on; a sentence with no citation is the agent's own reasoning. */
export type AgentSentence = Readonly<{ text: string; cites: readonly string[] }>;

/** The canonical structure of a substantive answer; `insufficient` when the reads did not give enough to judge. */
export type AgentAnswer = Readonly<{
  observation: readonly AgentSentence[];
  meaning: readonly AgentSentence[];
  counter: readonly AgentSentence[];
  risks: readonly AgentSentence[];
  checks: readonly AgentSentence[];
  actions: readonly AgentSentence[];
  insufficient: boolean;
}>;

export type AgentToolOutcome = Readonly<{ tool: string; kind: "research" | "prepare"; outcome: "ok" | "empty" | "unavailable" | "refused"; state: AgentState | null; latencyMs: number }>;

/* ------------------------------------------------------------ brief and critic (1.10.0) */

export const AGENT_BRIEF_SECTIONS = ["changed", "matters", "supports", "unknown", "checks"] as const;
export type AgentBriefSection = (typeof AGENT_BRIEF_SECTIONS)[number];

/** 1.10.0: the short answer — what changed, what matters for this thesis or plan, which data supports it, what is unknown, what to check next. */
export type AgentBrief = Readonly<{
  changed: readonly AgentSentence[];
  matters: readonly AgentSentence[];
  supports: readonly AgentSentence[];
  unknown: readonly AgentSentence[];
  checks: readonly AgentSentence[];
  insufficient: boolean;
}>;

export const AGENT_CRITIC_KINDS = ["assumption-conflict", "risk-not-established", "plan-condition-unmet", "previous-result", "evidence-missing", "asset-structure", "thesis-weakness"] as const;
export type AgentCriticKind = (typeof AGENT_CRITIC_KINDS)[number];

/** 1.10.0: one argument against the thesis, with the figures it stands on. Never directive: no kind here has a direction. */
export type AgentCriticFinding = Readonly<{ id: string; kind: AgentCriticKind; text: string; figures: readonly AgentFigure[]; cites: readonly string[]; state: AgentState }>;

/** 1.10.0: `gaps` say what could not be challenged and why, so silence is never read as agreement. */
export type AgentCritic = Readonly<{ findings: readonly AgentCriticFinding[]; gaps: readonly AgentSentence[]; insufficient: boolean }>;

export type AgentTurn = Readonly<{
  id: string;
  role: "person" | "ryn";
  at: string;
  text: string;
  class: AgentQuestionClass | null;
  answer: AgentAnswer | null;
  cards: readonly AgentCard[];
  citations: readonly AgentCitation[];
  handoffs: readonly AgentHandoff[];
  tools: readonly AgentToolOutcome[];
  /** On Ryn's turn: the configured model, or the deterministic composer over the same reads. */
  composedBy: "model" | "deterministic" | null;
  refusal: Readonly<{ code: "execute" | "secret"; reason: string }> | null;
  /** 1.10.0: the Brief, when the person asked for one; null otherwise. `answer` is always written beside it. */
  brief: AgentBrief | null;
  /** 1.10.0: the Critic, when the person asked to be argued with; null otherwise. */
  critic: AgentCritic | null;
}>;

export type AgentSession = Readonly<{ id: string; owner: string; network: typeof NETWORK; locale: "en" | "uk"; context: AgentContext | null; turns: readonly AgentTurn[]; createdAt: string; updatedAt: string }>;

export type AgentBudgetState = Readonly<{
  unit: "calls";
  day: Readonly<{ used: number; allowance: number; resetsAt: string }>;
  month: Readonly<{ used: number; allowance: number; resetsAt: string }>;
  inFlight: Readonly<{ used: number; limit: number }>;
  exhausted: boolean;
  reason: string | null;
  model: "configured" | "absent";
}>;

export type AgentSuggestion = Readonly<{ text: string; class: AgentQuestionClass }>;

export type AgentSessionOpenRequest = Readonly<{ context?: AgentContext | null; locale?: "en" | "uk"; sessionId?: string }>;
export type AgentSessionResponse = Readonly<{ session: AgentSession; budget: AgentBudgetState; suggestions: readonly AgentSuggestion[] }>;
export type AgentMessageRequest = Readonly<{ sessionId: string; text: string; locale?: "en" | "uk" }>;
export type AgentMessageResponse = Readonly<{ sessionId: string; person: AgentTurn; ryn: AgentTurn; budget: AgentBudgetState }>;
export type AgentDraftResponse = Readonly<{ draft: AgentDraftCard; sessionId: string; turnId: string; createdAt: string; expiresAt: string }>;
export type AgentSuggestionsResponse = Readonly<{ context: AgentContext | null; suggestions: readonly AgentSuggestion[] }>;

/**
 * 1.10.0: the two formats on a subject, for a surface that is not a
 * conversation. `compose` is the budget boundary said in the request:
 * `deterministic` (the default) never reaches a model and never spends;
 * `model` words the same reads under the wallet's existing agent allowance.
 */
export type AgentLensRequest = Readonly<{ subject: AgentContext; locale?: "en" | "uk"; compose?: "deterministic" | "model" }>;

type AgentLensShape = Readonly<{
  subject: AgentContext;
  title: string;
  cards: readonly AgentCard[];
  citations: readonly AgentCitation[];
  handoffs: readonly AgentHandoff[];
  tools: readonly AgentToolOutcome[];
  composedBy: "model" | "deterministic";
  budget: AgentBudgetState;
  observedAt: string;
}>;

export type AgentBriefResponse = AgentLensShape & Readonly<{ format: "brief"; brief: AgentBrief }>;
export type AgentCriticResponse = AgentLensShape & Readonly<{ format: "critic"; critic: AgentCritic }>;

/* ============================================================ 1.11.0 — the consumed routes, described */

/**
 * 1.11.0: the routes the web and the phone already read outside `/api/v1`,
 * typed exactly as they are served — the Spot markets, one market and its
 * candles; the stock universe (whole and slim), one stock and its quote; the
 * holdings. They are not v1 paths: no contract major is checked and no
 * version header is answered; a refusal is `RouteError`, thrown by the client
 * as `RyntraRouteError`. Beside them, the Telegram channel over the bearer is
 * a v1 path.
 */
export const SPOT_CATEGORIES = ["crypto", "meme", "stock"] as const;
export type SpotCategory = (typeof SPOT_CATEGORIES)[number];
export const SPOT_TIMEFRAMES = ["1m", "5m", "15m", "1h", "4h", "1d"] as const;
export type SpotTimeframe = (typeof SPOT_TIMEFRAMES)[number];
/** 1.14.0: the last value stays for records written before private companies moved to PreStocks only; no new answer carries it. */
export const STOCK_ISSUER_IDS = ["xstocks", "backpack", "ondo", "prestocks", "tessera"] as const;
export type StockIssuerId = (typeof STOCK_ISSUER_IDS)[number];
export const STOCK_REFERENCE_STATES = ["current", "last-available", "confirmed-close", "stale", "unavailable"] as const;
export type StockReferenceState = (typeof STOCK_REFERENCE_STATES)[number];
export const STOCK_SESSION_PERIODS = ["market", "extended", "overnight", "closed", "unknown"] as const;
export type StockSessionPeriod = (typeof STOCK_SESSION_PERIODS)[number];
export const STOCK_LIFECYCLE_STATES = ["active", "paused", "conversion-open", "redeem-only", "expired", "unknown"] as const;
export type StockLifecycleState = (typeof STOCK_LIFECYCLE_STATES)[number];
/** The refusal of a consumed route: the v1 envelope with the route's own code (`MARKETS_RATE_LIMITED`, `UNKNOWN_ASSET`, `CANDLES_NO_POOL`, …). The client throws it as `RyntraRouteError`. */
export type RouteError = Readonly<{ error: Readonly<{ code: string; message: string }> }>;

export type SpotIssuer = Readonly<{ label: string; tag: string }>;

/** The compact row every Spot list carries. A figure the venue did not state is null, never a zero; `verified` false means *not verified by Jupiter*, never unknown. */
export type SpotMarketListRow = Readonly<{
  mint: string;
  symbol: string;
  name: string;
  icon: string | null;
  decimals: number | null;
  tokenProgram: string | null;
  price: number | null;
  change24hPct: number | null;
  volume24hUsd: number | null;
  liquidityUsd: number | null;
  verified: boolean;
  suspicious: boolean;
  category: SpotCategory | null;
  issuer: SpotIssuer | null;
}>;

export type SpotStats = Readonly<{
  priceChangePct: number | null;
  volumeUsd: number | null;
  buys: number | null;
  sells: number | null;
  traders: number | null;
}>;

/** One market whole — `GET /api/spot/market?mint=`. */
export type SpotMarket = Readonly<{
  mint: string;
  symbol: string;
  name: string;
  icon: string | null;
  decimals: number | null;
  tokenProgram: string | null;
  price: number | null;
  change24hPct: number | null;
  change1hPct: number | null;
  volume24hUsd: number | null;
  liquidityUsd: number | null;
  marketCapUsd: number | null;
  fdvUsd: number | null;
  holders: number | null;
  organicScore: number | null;
  organicScoreLabel: string | null;
  verified: boolean;
  tags: readonly string[];
  category: SpotCategory | null;
  issuer: SpotIssuer | null;
  firstPoolAt: string | null;
  audit: Readonly<{
    mintAuthorityDisabled: boolean | null;
    freezeAuthorityDisabled: boolean | null;
    topHoldersPct: number | null;
    devBalancePct: number | null;
    suspicious: boolean;
  }>;
  links: Readonly<{ website: string | null; twitter: string | null; telegram: string | null }>;
  stats: Readonly<{ h1: SpotStats; h24: SpotStats }>;
  updatedAt: string | null;
}>;

/** `GET /api/spot/markets` — a view (`partial` when a category may be missing rows), a search, or mints in the order given (`missing` names the unknown ones). */
export type SpotMarketsResponse = Readonly<{
  rows: readonly SpotMarketListRow[];
  observedAt: string;
  stale: boolean;
  partial?: boolean;
  source?: Readonly<{ label: string; tier: "lite" | "pro" }>;
  missing?: readonly string[];
}>;

/** `market: null` is an answer — the catalogue does not list the mint — not a failure. */
export type SpotMarketResponse = Readonly<{ market: SpotMarket | null; observedAt: string; stale: boolean }>;

/** One bar; `time` is Unix seconds (UTC), oldest first; `volume` only where the source states it. */
export type SpotCandle = Readonly<{
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  isFinal?: boolean;
}>;

export type SpotPool = Readonly<{
  address: string;
  name: string;
  dex: string | null;
  side: "base" | "quote";
  reserveUsd: number | null;
  volume24hUsd: number | null;
}>;

/** `GET /api/spot/candles?mint=&tf=[&limit=]` — `limit` and `available` only when a limit was asked. A market without a chart is a 404 with the reason in the code. */
export type SpotCandlesResponse = Readonly<{
  timeframe: SpotTimeframe;
  candles: readonly SpotCandle[];
  pool: SpotPool;
  observedAt: string;
  stale: boolean;
  source: Readonly<{ label: "GeckoTerminal"; url: "https://www.geckoterminal.com" }>;
  limit?: number;
  available?: number;
}>;

export type StockExchange = Readonly<{ mic: string; name: string; timezone: string }>;

export type StockMultiplier = Readonly<{ current: number; pending: number | null; effectiveAt: string | null }>;

export type StockRepresentation = Readonly<{
  mint: string;
  symbol: string;
  name: string;
  issuer: Readonly<{ id: StockIssuerId; label: string; catalogue: boolean }>;
  issuerConfirmation: "issuer-catalogue" | "tag-only";
  instrument: Readonly<{
    class: "listed-equity" | "pre-ipo";
    unitBasis: "share" | "token";
    rights: "issuer-terms" | "economic-exposure" | "loan-participation";
  }>;
  underlying: Readonly<{ symbol: string; isin: string | null; listingCountry: string | null; name: string | null }>;
  companyKey: string | null;
  exchange: StockExchange | null;
  tokenProgram: string | null;
  decimals: number | null;
  tradingHalted: boolean | null;
  issuerUrl: string | null;
  issuerNote: string | null;
  sources: readonly string[];
}>;

export type StockReference = Readonly<{
  state: StockReferenceState;
  perShare: number | null;
  currency: string;
  source: Readonly<{ id: "issuer-xstocks" | "pyth" | "none"; label: string }>;
  observedAt: string | null;
  fetchedAt: string | null;
  note: string | null;
}>;

export type StockSession = Readonly<{
  period: StockSessionPeriod;
  exchangeOpen: boolean | null;
  nextChangeAt: string | null;
  exchange: StockExchange | null;
  source: "issuer" | "feed-catalogue" | "none";
}>;

export type StockTransferFee = Readonly<{
  basisPoints: number;
  maximumFeeRaw: string;
  configUsed: "NEWER" | "OLDER";
  epoch: string | null;
  pending: Readonly<{ basisPoints: number; maximumFeeRaw: string; fromEpoch: string }> | null;
  source: "chain";
}>;

export type StockLifecycle = Readonly<{
  state: StockLifecycleState;
  tradable: boolean;
  source: "chain" | "issuer-catalogue" | "event-registry" | "none";
  observedAt: string | null;
  url: string | null;
  recheckBy: string | null;
  deadline: string | null;
  note: string | null;
}>;

/** A token of a company's path: its mint and symbol. */
export type StockCompanyPathToken = Readonly<{ mint: string; symbol: string }>;

/**
 * 1.17.0 — «Шлях компанії»: the company's way from a private token to its
 * stock on Solana — `private` → `ipo` → `exchange` → `solana`, each `passed`,
 * `current` or `unannounced` — and `at`, the step this token stands at; `swap`
 * is the private token's cut-off once the company has gone public, `swapMonths`
 * the issuer's rule while it has not.
 */
export type StockCompanyPath = Readonly<{
  at: "private" | "solana";
  steps: readonly Readonly<{
    step: "private" | "ipo" | "exchange" | "solana";
    state: "passed" | "current" | "unannounced";
    date: string | null;
    priceUsd: number | null;
    exchange: string | null;
    ticker: string | null;
    token: StockCompanyPathToken | null;
  }>[];
  swap: Readonly<{ from: StockCompanyPathToken; into: StockCompanyPathToken | null; deadline: string; open: boolean }> | null;
  swapMonths: number | null;
  sources: readonly Readonly<{ label: string; url: string; publishedAt: string | null; readAt: string }>[];
  version: string;
}>;

/** One confirmed representation, whole. A reference is a cached figure with its own time and state, never an executable price. */
export type StockRow = Readonly<{
  representation: StockRepresentation;
  market: Readonly<{
    priceUsd: number | null;
    change24hPct: number | null;
    volume24hUsd: number | null;
    liquidityUsd: number | null;
    verified: boolean;
    observedAt: string | null;
    icon: string | null;
  }>;
  tokenPerShareUsd: number | null;
  multiplier: StockMultiplier | null;
  multiplierState: "active" | "pending" | "activation-window" | null;
  reference: StockReference;
  session: StockSession;
  deviationPct: number | null;
  issuerMark: Readonly<{
    source: Readonly<{ id: "issuer-prestocks" | "issuer-tessera"; label: string }>;
    perUnit: number | null;
    valuationUsd: number | null;
    impliedValuationUsd: number | null;
    supply: number | null;
    holders: number | null;
    observedAt: null;
    fetchedAt: string;
    stale: boolean;
  }> | null;
  markPremiumPct: number | null;
  companyIndex: Readonly<{
    source: Readonly<{ id: "pyth"; label: string }>;
    symbol: string;
    feedId: string;
    valueUsd: number | null;
    state: "current" | "stale" | "unavailable";
    observedAt: string | null;
    fetchedAt: string | null;
    note: string | null;
  }> | null;
  transferFee: StockTransferFee | null;
  lifecycle: StockLifecycle;
  /** 1.17.0: «Шлях компанії»; null where there is nothing to say. */
  companyPath: StockCompanyPath | null;
}>;

export type StockCatalogueState = Readonly<{ ok: boolean; stale: boolean; fetchedAt: string | null; reason: string | null }>;

/** `GET /api/stocks/universe`. */
export type StockUniverseResponse = Readonly<{
  rows: readonly StockRow[];
  marketsObservedAt: string;
  issuerCatalogue: Readonly<{ ok: boolean; reason: string | null }>;
  /** 1.14.0: the third catalogue is optional and absent from every new answer. */
  issuerCatalogues: Readonly<{ xstocks: StockCatalogueState; prestocks: StockCatalogueState; tessera?: StockCatalogueState }>;
  fetchedAt: string;
}>;

/** The row as the stock surfaces draw it. 1.11.0 adds `multiplierPending`, `multiplierPendingAt` (judged at answer time) and `sessionNextChangeAt`. */
export type StockSlimRow = Readonly<{
  mint: string;
  symbol: string;
  name: string;
  issuer: StockIssuerId;
  kind: "listed-equity" | "pre-ipo";
  unitBasis: "share" | "token";
  tradable: boolean;
  mark: number | null;
  icon: string | null;
  halted: boolean;
  price: number | null;
  change24h: number | null;
  reference: number | null;
  referenceState: StockReferenceState;
  referenceAt: string | null;
  deviation: number | null;
  period: StockSessionPeriod;
  volume: number | null;
  liquidity: number | null;
  multiplierPending: number | null;
  multiplierPendingAt: string | null;
  sessionNextChangeAt: string | null;
  /** 1.14.0: a pre-IPO token's price against the issuer's own mark, per cent — context, never a deviation; null on a listed row. */
  markPremium: number | null;
  /** 1.14.0: when the issuer's mark behind `markPremium` was read. */
  markAt: string | null;
}>;

/** `GET /api/stocks/universe?shape=slim[&q=][&mints=][&limit=]` — `query` and `total` only when a search was asked. */
export type StockUniverseSlimResponse = Readonly<{ rows: readonly StockSlimRow[]; fetchedAt: string; query?: string; total?: number }>;

export type StockOnchainMint = Readonly<{
  programKind: string;
  decimals: number;
  supplyRaw: string;
  mintAuthority: string | null;
  freezeAuthority: string | null;
  extensions: readonly string[];
  scaledUi: Readonly<{
    multiplier: number;
    newMultiplier: number;
    newMultiplierEffectiveAt: string | null;
    authority: string;
  }> | null;
  transferFeeConfig: Readonly<{
    older: Readonly<{ epoch: string; basisPoints: number; maximumFeeRaw: string }>;
    newer: Readonly<{ epoch: string; basisPoints: number; maximumFeeRaw: string }>;
    withheldRaw: string;
  }> | null;
  pausable: Readonly<{ paused: boolean; authority: string | null }> | null;
  permanentDelegate: string | null;
  defaultAccountFrozen: boolean | null;
  observedAt: string;
  slot: string | null;
}>;

/** `GET /api/stocks/asset?ticker=` — 404 `UNKNOWN_ASSET` when the token is not a confirmed representation. */
export type StockAssetResponse = Readonly<{
  row: StockRow;
  onchain: StockOnchainMint | Readonly<{ error: string }>;
  chainMultiplier: StockMultiplier | null;
  chainMultiplierState: "active" | "pending" | "activation-window" | null;
  issuerMultiplier: StockMultiplier | null;
  multiplierAgreement: "agree" | "differ" | "unknown";
  reserves: Readonly<{
    symbol: string;
    sharesHeld: string;
    circulatingSupply: string;
    observedAt: string;
    custodians: readonly string[];
  }> | null;
  pool: SpotPool | null;
  fetchedAt: string;
}>;

/** `GET /api/stocks/quote?ticker=&side=&usd=` — the size-aware executable quote; `reviewExpiresAt` is when it stops being signable. */
export type StockQuoteResponse = Readonly<{
  mint: string;
  symbol: string;
  side: "BUY" | "SELL";
  usd: number;
  tokenRaw: string;
  tokenScaled: string;
  minReceivedRaw: string;
  minReceivedScaled: string;
  multiplier: number | null;
  unitBasis: "share" | "token";
  executablePerShare: number | null;
  reference: StockReference;
  deviationPct: number | null;
  priceImpactPct: string;
  feeBasisPoints: number;
  slippageBps: number;
  router: string;
  observedAt: string;
  reviewExpiresAt: string;
  source: Readonly<{ label: string }>;
  transferFee: StockTransferFee | null;
  lifecycle: StockLifecycle;
}>;

/** 1.20.0: how many companies «Популярне» answers when not asked (Home's wide list), and the most it answers. */
export const POPULAR_DEFAULT_LIMIT = 12 as const;
export const POPULAR_MAX_LIMIT = 24 as const;

/** 1.20.0: one card of «Популярні компанії» — the company as a person names it, the token the card opens, its price per token, the day's move in per cent, the company's day of trading in whole dollars (the order). */
export type PopularCompany = Readonly<{
  name: string;
  ticker: string;
  mint: string;
  icon: string | null;
  price: number;
  change24h: number | null;
  volume24h: number;
  issuer: "xstocks" | "backpack" | "ondo" | "prestocks";
}>;

/** 1.20.0: `GET /api/v1/stocks/popular[?limit=][&exclude=<mint>]` — public; the listed companies by the day's trading, the same for everyone. */
export type PopularCompaniesResponse = Readonly<{ companies: readonly PopularCompany[]; order: "volume-24h"; fetchedAt: string }>;

/** `POST /api/solana/holdings` — public: any address. */
export type HoldingsRequest = Readonly<{ owner: string; network?: "mainnet" | "devnet" }>;

export type HoldingsSourceAccount = Readonly<{
  address: string;
  mint: string;
  tokenProgram: string;
  amountRaw: string;
  decimals: number;
  state: "INITIALIZED" | "FROZEN" | "UNKNOWN";
  canonical?: boolean;
}>;

export type HoldingsCatalogEntry = Readonly<{
  mint: string;
  symbol: string | null;
  name: string | null;
  isVerified: boolean | null;
  isSuspicious: boolean;
  usdPrice: string | null;
  source: Readonly<{ ref: string; label: string }>;
  icon?: string | null;
  category?: string | null;
  dayChangePct?: number | null;
  decimals?: number | null;
}>;

/** Native SOL has no mint: `kind: "NATIVE_SOL"`, `mint: null` — priced through wrapped SOL's catalogue entry. */
export type HoldingsNativeRow = Readonly<{
  kind: "NATIVE_SOL";
  mint: null;
  tokenProgram: null;
  canonicalAta: null;
  programKind: null;
  amountRaw: string;
  spendableRaw: string;
  decimals: number;
  sourceAccounts: readonly HoldingsSourceAccount[];
  extensions: readonly string[];
  name: string | null;
  symbol: string | null;
  nameAuthority: string | null;
  catalog: HoldingsCatalogEntry | null;
  /** 1.15.0: the Scaled UI Amount multiplier in force for the mint — the wallet shows `amountRaw × uiMultiplier`, and `catalog.usdPrice` is per that unit; absent or null where the mint carries none or was not read. */
  uiMultiplier?: number | null;
}>;

export type HoldingsTokenRow = Readonly<{
  kind: "TOKEN";
  mint: string;
  tokenProgram: string | null;
  canonicalAta: string | null;
  programKind: "TOKEN_2022" | "SPL_TOKEN" | "NOT_A_MINT" | null;
  amountRaw: string;
  spendableRaw: string;
  decimals: number;
  sourceAccounts: readonly HoldingsSourceAccount[];
  extensions: readonly string[];
  name: string | null;
  symbol: string | null;
  nameAuthority: string | null;
  catalog: HoldingsCatalogEntry | null;
  /** 1.15.0: the Scaled UI Amount multiplier in force for the mint — the wallet shows `amountRaw × uiMultiplier`, and `catalog.usdPrice` is per that unit; absent or null where the mint carries none or was not read. */
  uiMultiplier?: number | null;
}>;

export type HoldingsRow = HoldingsNativeRow | HoldingsTokenRow;

/** `tokenRead` decides whether an empty list means *nothing held* (`COMPLETE`) or *nothing known* (`PARTIAL`, `UNAVAILABLE`). Amounts are the chain's raw integers as decimal text. */
export type HoldingsResponse = Readonly<{
  data: Readonly<{
    owner: string;
    network: "mainnet" | "devnet";
    lamports: string;
    holdings: readonly HoldingsRow[];
    held: number;
    tokenRead: "COMPLETE" | "PARTIAL" | "UNAVAILABLE";
    returned: number;
    detailed: number;
    observedAt: string;
    source: Readonly<{
      host: string;
      hosts: readonly string[];
      health: "HEALTHY" | "DEGRADED" | "UNAVAILABLE" | "UNKNOWN";
      detail: string;
    }>;
    catalog: Readonly<{ status: "PRESENT"; missing: readonly string[] }> | Readonly<{ status: "ABSENT"; reason: string }>;
  }>;
}>;

export type TelegramChannelView = Readonly<{ connected: boolean; username: string | null; connectedAt: string | null }>;

/** `GET`/`DELETE /api/v1/notifications/telegram` — the handle and the moment, never the Telegram id; reading creates nothing. */
export type TelegramChannelResponse = Readonly<{ telegram: TelegramChannelView }>;

/** `POST /api/v1/notifications/telegram` — the language an account created by this connect opens in. */
export type TelegramConnectRequest = Readonly<{ locale?: "en" | "uk" }>;

/** The bot link with a signed code naming the wallet's account; the binding is written only when the person presses Start in Telegram. */
export type TelegramConnectResponse = Readonly<{ link: string; expiresAt: string }>;

/* ------------------------------------------------------------ 1.11.0 — the activity, the receipt archive, the rewards, the monitoring surface, the swap */

/**
 * The routes a statement, the rewards, the monitoring inbox and a real trade
 * go through, typed as they are served. The rewards and the receipt archive
 * answer their own older error bodies (typed below); the monitoring surface
 * answers the v1 envelope and version header; the swap routes answer
 * `{ error: { code, message, …extra } }` with each route's own codes.
 */

export const REWARD_ROW_KINDS = ["CASHBACK", "REFERRAL_L1", "REFERRAL_L2", "CLAIM"] as const;
export type RewardRowKind = (typeof REWARD_ROW_KINDS)[number];

export const ACTIVITY_LANES = ["SEND", "SWAP", "BRIDGE", "RECEIVE", "CROSS_SWAP"] as const;
export type ActivityLane = (typeof ACTIVITY_LANES)[number];

/** Four words, not the lanes' states: `IN_FLIGHT` is never success or failure; `NEEDS_YOU` waits on this person. */
export const ACTIVITY_OUTCOMES = ["IN_FLIGHT", "DONE", "FAILED", "NEEDS_YOU"] as const;
export type ActivityOutcome = (typeof ACTIVITY_OUTCOMES)[number];

export const ACTIVITY_DESTINATIONS = ["SOLANA", "BASE", "ETHEREUM", "ROBINHOOD"] as const;
export type ActivityDestination = (typeof ACTIVITY_DESTINATIONS)[number];

export const ACTIVITY_FEE_STATES = ["COLLECTED", "NOT_COLLECTED", "NOT_APPLIED", "UNCONFIGURED", "NONE"] as const;
export type ActivityFeeState = (typeof ACTIVITY_FEE_STATES)[number];

export const RECEIPT_KINDS = ["send", "swap", "bridge", "receive", "other"] as const;
export type ReceiptKind = (typeof RECEIPT_KINDS)[number];

export const REWARD_PENDING_REASONS = ["AWAITING_VALUATION", "AWAITING_RESERVE"] as const;
export type RewardPendingReason = (typeof REWARD_PENDING_REASONS)[number];

export const REWARD_CLAIM_STATES = ["CLAIMING", "SUBMITTED_UNKNOWN", "PAID", "FAILED"] as const;
export type RewardClaimState = (typeof REWARD_CLAIM_STATES)[number];

export const REFERRAL_REFUSALS = ["SELF_REFERRAL", "UNKNOWN_CODE", "ALREADY_REFERRED", "ALREADY_EARNING", "CYCLE"] as const;
export type ReferralRefusal = (typeof REFERRAL_REFUSALS)[number];

export const MONITOR_STATUSES = ["watching", "needs_attention", "paused", "unavailable"] as const;
export type MonitorStatus = (typeof MONITOR_STATUSES)[number];

/** 1.21.0: `position` — «Ryntra попередить» on a company the wallet holds, `id` the token's mint. */
export const MONITOR_SUBJECT_KINDS = ["trading-plan", "prediction-plan", "position"] as const;
export type MonitorSubjectKind = (typeof MONITOR_SUBJECT_KINDS)[number];
/** 1.12.0: a note may also be an autoinvest rule's reminder — a note's subject, never a card's; 1.13.0: or the month's autoinvest budget, spent; 1.15.0: or an issuer's event about a token the wallet holds (`id` its mint) — a window to swap it before the issuer's cut-off. */
export type MonitorNoteSubjectKind = MonitorSubjectKind | "autoinvest-rule" | "autoinvest-budget" | "issuer-event";

/** 1.21.0: `plan.target` — a position's target, reached. */
export const MONITOR_CONDITION_KINDS = ["plan.price_bound", "plan.invalidation", "plan.expiry", "plan.deviation", "plan.evidence", "prediction.probability", "prediction.resolution", "prediction.signal", "plan.target"] as const;
export type MonitorConditionKind = (typeof MONITOR_CONDITION_KINDS)[number];

export const MONITOR_FINDING_OUTCOMES = ["pass", "fail", "stale", "unavailable", "unknown"] as const;
export type MonitorFindingOutcome = (typeof MONITOR_FINDING_OUTCOMES)[number];

/* 1.21.0 — Нагляд over positions and «Ryntra попередить» */

/** The state a company position is in: «Все за планом», «Увага», «Дія», «Пауза емітента», «Увага: куплено — вихід не налаштований», or «Не вдалося перевірити». */
export const WATCH_STATES = ["on-plan", "attention", "action", "issuer-paused", "exit-not-set", "unknown"] as const;
export type WatchState = (typeof WATCH_STATES)[number];
/** Why: `between` the limit and the target; `near-limit` ≤2 % above the limit; `issuer-event` a swap window; `above-exchange` >1 % above the exchange; `exchange-closed`; `limit` or `target` reached; `issuer-paused`; `no-exit`; `no-price`. */
export const WATCH_REASONS = ["between", "near-limit", "issuer-event", "above-exchange", "exchange-closed", "limit", "target", "issuer-paused", "no-exit", "no-price"] as const;
export type WatchReason = (typeof WATCH_REASONS)[number];
/** The one action: «Подивитись», «Відкрити продаж», «Деталі», «Увімкнути „Ryntra попередить“», «Підключи Telegram». */
export const WATCH_ACTIONS = ["look", "open-sale", "details", "warn", "connect-telegram"] as const;
export type WatchAction = (typeof WATCH_ACTIONS)[number];
/** Where an exit comes from: the plan the position was bought under, or «Ryntra попередить» on the position. */
export const WATCH_SOURCES = ["plan", "watch"] as const;
export type WatchSource = (typeof WATCH_SOURCES)[number];
/** The presets «Ryntra попередить» offers: «Обережно» −5 % / +10 %, «Збалансовано» −10 % / +20 %. */
export const POSITION_WATCH_PRESETS = ["careful", "balanced"] as const;
export type PositionWatchPreset = (typeof POSITION_WATCH_PRESETS)[number];

/** A position's exit: the loss limit and the target in USD per unit as the wallet shows the token. */
export type PositionExit = Readonly<{ source: WatchSource; limit: number; target: number | null; preset: PositionWatchPreset | null; planId: string | null }>;

/** One company the wallet holds, as Нагляд sees it. Draw the state and its one action; decide nothing. */
export type PositionWatchView = Readonly<{
  mint: string;
  symbol: string;
  name: string;
  icon: string | null;
  unitBasis: "share" | "token";
  amountRaw: string;
  valueUsd: number | null;
  price: number | null;
  observedAt: string | null;
  deviationPct: number | null;
  exit: PositionExit | null;
  state: WatchState;
  reason: WatchReason;
  action: WatchAction | null;
  toLimitPct: number | null;
}>;

/** `GET /api/v1/positions` — the proven wallet's company positions; `read` says what answered. Bearer. */
export type PositionsResponse = Readonly<{
  address: string;
  positions: readonly PositionWatchView[];
  channel: Readonly<{ telegram: boolean }>;
  read: Readonly<{ holdings: "complete" | "partial" | "failed"; market: "ok" | "failed"; at: string }>;
}>;

/** `PUT /api/v1/positions/watch` — «Ryntra попередить» on a company the wallet holds. Bearer; Telegram must be connected. */
export type PositionWatchRequest = Readonly<{ mint: string; preset: PositionWatchPreset; locale?: "en" | "uk" }>;

/** «Ryntra попередить» as written: the figures the server counted from the price then. */
export type PositionWatch = Readonly<{
  mint: string;
  symbol: string;
  preset: PositionWatchPreset;
  stopPct: number;
  targetPct: number;
  basisPerUnit: number;
  basisObservedAt: string;
  limitPerUnit: number;
  targetPerUnit: number;
  createdAt: string;
  updatedAt: string;
}>;

export type PositionWatchResponse = Readonly<{ watch: PositionWatch; position: PositionWatchView | null }>;

/** 1.23.0: «Ризик портфеля» — «Нормальний», «Увага: <причина>», «Не вдалося перевірити». */
export const RISK_STATES = ["normal", "attention", "unknown"] as const;
export type RiskState = (typeof RISK_STATES)[number];
/** The rules «Увага» names, the most urgent first: a position in «Дія», a listed company with no loss limit over the weekend, one asset above its cap, the private companies together above theirs. */
export const RISK_REASONS = ["action", "weekend-no-limit", "concentration", "private-share"] as const;
export type RiskReason = (typeof RISK_REASONS)[number];
/** What could not be read: the token accounts, the companies' market, the positions' exits (plans and «Ryntra попередить»), the SOL balance, a price. */
export const RISK_GAPS = ["holdings", "market", "exits", "balance", "prices"] as const;
export type RiskGap = (typeof RISK_GAPS)[number];
export const RISK_ASSET_KINDS = ["company", "private", "crypto", "dollar"] as const;
export type RiskAssetKind = (typeof RISK_ASSET_KINDS)[number];

/** One rule «Ризик портфеля» found broken, and what it names. Draw it; decide nothing. */
export type PortfolioRiskFinding = Readonly<{
  reason: RiskReason;
  kind: RiskAssetKind | null;
  mint: string | null;
  symbol: string | null;
  name: string | null;
  sharePct: number | null;
  capPct: number | null;
  watchReason: "limit" | "target" | null;
}>;

/** «Ризик портфеля» as the server judged it; «Нормальний» never on incomplete data. */
export type PortfolioRisk = Readonly<{
  state: RiskState;
  findings: readonly PortfolioRiskFinding[];
  gaps: readonly RiskGap[];
  totalUsd: number | null;
  capsApplied: boolean;
}>;

/** `GET /api/v1/positions/risk` — «Ризик портфеля» of the proven wallet. Bearer. */
export type PortfolioRiskResponse = Readonly<{ address: string; risk: PortfolioRisk; at: string }>;

/** `COLLECTED` is the only income. */
export const SWAP_SERVICE_FEE_STATES = ["NONE", "UNCONFIGURED", "NOT_APPLIED", "QUOTED", "COLLECTED", "NOT_COLLECTED"] as const;
export type SwapServiceFeeState = (typeof SWAP_SERVICE_FEE_STATES)[number];

export const SWAP_ASSET_POLICY_RULES = ["NETWORK_ALLOWED", "MINT_ALLOWED", "TOKEN_PROGRAM_ALLOWED", "NOT_STRUCTURALLY_DOOMED", "PERMANENT_DELEGATE_ACCEPTED", "TRANSFER_HOOK_ALLOWLISTED", "FEE_WITHIN_CAP", "RECIPIENT_ALLOWED", "AMOUNT_WITHIN_LIMIT", "DEFAULT_FROZEN_ACCEPTED", "EVIDENCE_FRESH", "EXTENSIONS_UNDERSTOOD", "HUMAN_APPROVAL"] as const;
export type SwapAssetPolicyRule = (typeof SWAP_ASSET_POLICY_RULES)[number];

/** The swap policy's twelve rules, in the order a person checks them. */
export const SWAP_POLICY_RULES = ["NETWORK_MAINNET", "PAIR_DISTINCT", "OUTPUT_ASSET_REVIEWED", "PAYOUT_TO_SIGNER", "FEE_PAYER_IS_SIGNER", "BYTES_INSPECTED", "SIMULATION_OK", "OWNER_EFFECTS_PROVEN", "SLIPPAGE_BOUNDED", "PRICE_IMPACT_DISCLOSED", "VALUE_DISCLOSED", "REVIEW_FRESH"] as const;
export type SwapPolicyRule = (typeof SWAP_POLICY_RULES)[number];

export const SWAP_PRE_SIGN_REFUSAL_CODES = ["POLICY_BLOCKED", "PROOF_NOT_SIGNED", "SIMULATION_NOT_CLEAR", "EFFECTS_NOT_VERIFIED", "ORDER_EXPIRED", "ORDER_TOO_SHORT", "REVIEW_INVALIDATED"] as const;
export type SwapPreSignRefusalCode = (typeof SWAP_PRE_SIGN_REFUSAL_CODES)[number];

export const SWAP_RECEIPT_DEVIATIONS = ["PROVIDER_REQUEST_MISMATCH", "PROVIDER_SIGNATURE_MISMATCH", "PROVIDER_INPUT_MISMATCH", "PROVIDER_OUTPUT_MISMATCH", "PROVIDER_EVIDENCE_UNAVAILABLE", "INPUT_MISMATCH", "OUTPUT_MISMATCH", "BELOW_MINIMUM", "BASE_FEE_MISMATCH", "PRIORITY_FEE_MISMATCH"] as const;
export type SwapReceiptDeviation = (typeof SWAP_RECEIPT_DEVIATIONS)[number];

export const SWAP_OWNER_LOCK_STATES = ["REVIEW_ISSUED", "SIGNED", "SUBMITTED_UNKNOWN", "EXPIRED_BEFORE_SUBMIT", "EXPIRED_AFTER_SUBMIT", "FAILED", "RECEIPTED"] as const;
export type SwapOwnerLockState = (typeof SWAP_OWNER_LOCK_STATES)[number];

export const SWAP_SEND_ATTEMPT_STATES = ["RESERVED", "SUBMITTED_UNKNOWN", "CONFIRMED", "FINALIZED", "LANDED_FAILED", "EXPIRED_BEFORE_SUBMIT", "EXPIRED_AFTER_SUBMIT", "RECOVERY_REQUIRED", "RECEIPTED"] as const;
export type SwapSendAttemptState = (typeof SWAP_SEND_ATTEMPT_STATES)[number];

export const SWAP_QUOTE_ERROR_CODES = ["RATE_LIMITED", "JSON_REQUIRED", "INVALID_CONTENT_LENGTH", "BODY_TOO_LARGE", "BODY_REQUIRED", "INVALID_BODY_STREAM", "INVALID_JSON", "VALIDATION_ERROR", "ASSET_NOT_OFFERED", "PROVIDER_KEY_MISSING", "MINT_UNREADABLE", "PASSPORT_REFUSED", "QUOTE_PRODUCTION_KEY_REQUIRED", "QUOTE_NO_ROUTE", "QUOTE_REFUSED", "QUOTE_RATE_LIMITED", "QUOTE_HTTP_ERROR", "QUOTE_UNREACHABLE", "QUOTE_MALFORMED", "QUOTE_IMPLAUSIBLE_QUOTE", "PREFLIGHT_REFUSED"] as const;
export type SwapQuoteErrorCode = (typeof SWAP_QUOTE_ERROR_CODES)[number];

export const SWAP_ORDER_ERROR_CODES = ["RATE_LIMITED", "FORBIDDEN_ORIGIN", "UNAUTHORIZED", "SESSION_EXPIRED", "SESSION_REVOKED", "UNAVAILABLE", "SWAP_PAUSED", "JSON_REQUIRED", "INVALID_CONTENT_LENGTH", "BODY_TOO_LARGE", "BODY_REQUIRED", "INVALID_BODY_STREAM", "INVALID_JSON", "VALIDATION_ERROR", "WALLET_MISMATCH", "ASSET_NOT_OFFERED", "PLAN_NOT_FOUND", "RULE_NOT_FOUND", "RULE_NOT_DUE", "RULE_MISMATCH", "RULE_BUDGET_EXHAUSTED", "RULE_PRICE_CONDITION", "STORE_NOT_DURABLE", "OWNER_SWAP_LOCKED", "OWNER_SWAP_LOCK_ABSENT", "OWNER_SWAP_LOCK_MISMATCH", "OWNER_SWAP_LOCK_UNAVAILABLE", "PROVIDER_KEY_MISSING", "PROOF_NOT_SIGNED", "MINT_UNREADABLE", "PASSPORT_REFUSED", "ORDER_PRODUCTION_KEY_REQUIRED", "ORDER_NO_ROUTE", "ORDER_REFUSED", "ORDER_RATE_LIMITED", "ORDER_HTTP_ERROR", "ORDER_UNREACHABLE", "ORDER_MALFORMED", "ORDER_IMPLAUSIBLE_QUOTE", "ORDER_BUILD_FAILED", "TRANSACTION_UNREADABLE", "TRANSACTION_TOO_LARGE", "TRANSACTION_VERSION_UNSUPPORTED", "TRANSACTION_FEE_PAYER_MISMATCH", "TRANSACTION_TAKER_NOT_SIGNER", "TRANSACTION_NO_INSTRUCTIONS", "TRANSACTION_DANGEROUS_TOKEN_INSTRUCTION", "TRANSACTION_DANGEROUS_ACCOUNT_INSTRUCTION", "TRANSACTION_PROGRAM_INDEX_OUT_OF_RANGE", "SIMULATION_EFFECT_CONTRACT_UNREADABLE", "SIMULATION_EFFECT_PAIR_UNSUPPORTED", "SIMULATION_EFFECT_GASLESS_UNSUPPORTED", "SIMULATION_EFFECT_FEE_PAYER_MISMATCH", "SIMULATION_EFFECT_FEE_MISMATCH", "SIMULATION_EFFECT_RENT_UNSUPPORTED", "SIMULATION_EFFECT_SIMULATION_METADATA_UNAVAILABLE", "SIMULATION_EFFECT_ACCOUNT_VECTOR_MISMATCH", "SIMULATION_EFFECT_TOKEN_METADATA_UNAVAILABLE", "SIMULATION_EFFECT_TOKEN_METADATA_INVALID", "SIMULATION_EFFECT_TOKEN_OWNER_UNRESOLVED", "SIMULATION_EFFECT_UNSAFE_TOKEN_MUTATION", "SIMULATION_EFFECT_UNSAFE_ACCOUNT_MUTATION", "SIMULATION_EFFECT_UNRESOLVED_INNER_PROGRAM", "SIMULATION_EFFECT_UNRELATED_TOKEN_DELTA", "SIMULATION_EFFECT_INPUT_DELTA_MISMATCH", "SIMULATION_EFFECT_OUTPUT_DELTA_MISMATCH", "SIMULATION_EFFECT_NATIVE_DELTA_MISMATCH", "SIMULATION_UNAVAILABLE", "SIMULATION_FAILED", "INTENT_REFUSED", "PLAN_REVIEW_BLOCKED", "PLAN_VERSION_CONFLICT", "PLAN_STATE_REFUSED", "SWAP_PRE_SIGN_REFUSED"] as const;
export type SwapOrderErrorCode = (typeof SWAP_ORDER_ERROR_CODES)[number];

export const SWAP_EXECUTE_ERROR_CODES = ["RATE_LIMITED", "FORBIDDEN_ORIGIN", "UNAUTHORIZED", "SESSION_EXPIRED", "SESSION_REVOKED", "UNAVAILABLE", "SWAP_PAUSED", "JSON_REQUIRED", "INVALID_CONTENT_LENGTH", "BODY_TOO_LARGE", "BODY_REQUIRED", "INVALID_BODY_STREAM", "INVALID_JSON", "VALIDATION_ERROR", "WALLET_MISMATCH", "ISSUER_KEY_MISSING", "REVIEW_PROOF_REFUSED", "REVIEW_NOT_FRESH", "ORDER_EXPIRED", "SIMULATION_FAILED", "SIGNED_UNREADABLE", "SIGNED_TOO_LARGE", "SIGNED_VERSION_UNSUPPORTED", "SIGNED_FEE_PAYER_MISMATCH", "SIGNED_TAKER_NOT_SIGNER", "SIGNED_NO_INSTRUCTIONS", "SIGNED_DANGEROUS_TOKEN_INSTRUCTION", "SIGNED_DANGEROUS_ACCOUNT_INSTRUCTION", "SIGNED_PROGRAM_INDEX_OUT_OF_RANGE", "WALLET_MODIFIED_BYTES", "REVIEWED_BYTES_MISMATCH", "WALLET_PRIORITY_FEE_TOO_HIGH", "WALLET_BUDGET_UNREADABLE", "SIGNATURE_REFUSED", "SIGNATURE_UNREADABLE", "PROVIDER_KEY_MISSING", "STORE_NOT_DURABLE", "SWAP_POLICY_BLOCKED", "PLAN_REVIEW_BLOCKED", "PLAN_NOT_FOUND", "PLAN_VERSION_CONFLICT", "PLAN_STATE_REFUSED", "NO_INDEPENDENT_RPC", "ADOPTED_SIMULATION_FAILED", "ADOPTED_EFFECT_CONTRACT_UNREADABLE", "ADOPTED_EFFECT_PAIR_UNSUPPORTED", "ADOPTED_EFFECT_GASLESS_UNSUPPORTED", "ADOPTED_EFFECT_FEE_PAYER_MISMATCH", "ADOPTED_EFFECT_FEE_MISMATCH", "ADOPTED_EFFECT_RENT_UNSUPPORTED", "ADOPTED_EFFECT_SIMULATION_METADATA_UNAVAILABLE", "ADOPTED_EFFECT_ACCOUNT_VECTOR_MISMATCH", "ADOPTED_EFFECT_TOKEN_METADATA_UNAVAILABLE", "ADOPTED_EFFECT_TOKEN_METADATA_INVALID", "ADOPTED_EFFECT_TOKEN_OWNER_UNRESOLVED", "ADOPTED_EFFECT_UNSAFE_TOKEN_MUTATION", "ADOPTED_EFFECT_UNSAFE_ACCOUNT_MUTATION", "ADOPTED_EFFECT_UNRESOLVED_INNER_PROGRAM", "ADOPTED_EFFECT_UNRELATED_TOKEN_DELTA", "ADOPTED_EFFECT_INPUT_DELTA_MISMATCH", "ADOPTED_EFFECT_OUTPUT_DELTA_MISMATCH", "ADOPTED_EFFECT_NATIVE_DELTA_MISMATCH", "ADOPTED_SIMULATION_UNAVAILABLE", "OWNER_SWAP_LOCKED", "OWNER_SWAP_LOCK_ABSENT", "OWNER_SWAP_LOCK_MISMATCH", "OWNER_SWAP_LOCK_UNAVAILABLE", "SEND_ATTEMPT_CONFLICT", "SEND_ATTEMPT_UNAVAILABLE", "ALREADY_SUBMITTED", "SEND_SETTLEMENT_FAILED", "SUBMISSION_UNKNOWN", "EXECUTE_FAILED", "LANDED_FAILED"] as const;
export type SwapExecuteErrorCode = (typeof SWAP_EXECUTE_ERROR_CODES)[number];

export const SWAP_CANCEL_REVIEW_ERROR_CODES = ["RATE_LIMITED", "FORBIDDEN_ORIGIN", "UNAUTHORIZED", "SESSION_EXPIRED", "SESSION_REVOKED", "UNAVAILABLE", "JSON_REQUIRED", "INVALID_CONTENT_LENGTH", "BODY_TOO_LARGE", "BODY_REQUIRED", "INVALID_BODY_STREAM", "INVALID_JSON", "VALIDATION_ERROR", "WALLET_MISMATCH", "STORE_NOT_DURABLE", "OWNER_SWAP_LOCKED", "OWNER_SWAP_LOCK_ABSENT", "OWNER_SWAP_LOCK_MISMATCH", "OWNER_SWAP_LOCK_UNAVAILABLE", "NO_INDEPENDENT_RPC", "BLOCKHASH_VALIDITY_UNKNOWN", "BLOCKHASH_STILL_VALID"] as const;
export type SwapCancelReviewErrorCode = (typeof SWAP_CANCEL_REVIEW_ERROR_CODES)[number];

export const SWAP_RECOVER_ERROR_CODES = ["RATE_LIMITED", "FORBIDDEN_ORIGIN", "UNAUTHORIZED", "SESSION_EXPIRED", "SESSION_REVOKED", "UNAVAILABLE", "JSON_REQUIRED", "INVALID_CONTENT_LENGTH", "BODY_TOO_LARGE", "BODY_REQUIRED", "INVALID_BODY_STREAM", "INVALID_JSON", "VALIDATION_ERROR", "WALLET_MISMATCH", "ISSUER_KEY_MISSING", "STORE_NOT_DURABLE", "NO_INDEPENDENT_RPC", "REVIEW_PROOF_REFUSED", "OWNER_SWAP_LOCKED", "OWNER_SWAP_LOCK_ABSENT", "OWNER_SWAP_LOCK_MISMATCH", "OWNER_SWAP_LOCK_UNAVAILABLE", "SEND_ATTEMPT_CONFLICT", "SEND_ATTEMPT_UNAVAILABLE", "SEND_ATTEMPT_ABSENT", "SEND_ATTEMPT_TRANSITION_REFUSED", "SEND_ATTEMPT_CONTENDED", "ATTEMPT_BINDING_MISMATCH", "SUBMIT_NOT_RECORDED", "MINT_FAILED"] as const;
export type SwapRecoverErrorCode = (typeof SWAP_RECOVER_ERROR_CODES)[number];

export type RewardsRow = Readonly<{
  kind: RewardRowKind;
  display: string;
  amount: string;
  valued: boolean;
  detail: string | null;
  at: string;
}>;

export type ActivityRequest = Readonly<{ owner: string; network?: "mainnet" | "devnet" }>;

/** One row of the wallet's own history through Ryntra: public chain facts only, never a note, a label or a counterparty. */
export type ActivityAction = Readonly<{
  schema: "ryntra.solana.wallet-action";
  schemaVersion: "1.0.0";
  version: number;
  network: "mainnet" | "devnet";
  wallet: string;
  actionId: string;
  lane: ActivityLane;
  outcome: ActivityOutcome;
  out: Readonly<{ mint: string | null; amountRaw: string; decimals: number | null; symbol: string | null }> | null;
  in: Readonly<{ mint: string | null; amountRaw: string; decimals: number | null; symbol: string | null }> | null;
  destination: ActivityDestination | null;
  signature: string | null;
  receiptHash: string | null;
  sourceTx: string | null;
  destinationTx: string | null;
  fee: Readonly<{
    collected: boolean;
    basisPoints: number | null;
    amountRaw: string | null;
    decimals: number | null;
    symbol: string | null;
    usd: number | null;
    asset: string | null;
    providerRaw: string | null;
    ryntraRaw: string | null;
    state: ActivityFeeState | null;
    note: string | null;
  }> | null;
  origin: Readonly<{
    surface: "SPOT";
    side: "BUY" | "SELL";
    plan?: Readonly<{ planId: string; version: number; reviewId: string }>;
    /** 1.12.0: the autoinvest reminder a purchase was made under. */
    rule?: RuleBinding;
  }> | null;
  providerRef: string | null;
  statedUsd: number | null;
  startedAt: string;
  updatedAt: string;
}>;

/** `POST /api/solana/activity` — `rewards` null when the request is not the owner's, `[]` when there are none; `complete: false` when a stored row could not be read. */
export type ActivityResponse = Readonly<{
  data: Readonly<{
    actions: readonly ActivityAction[];
    rewards: readonly RewardsRow[] | null;
    complete: boolean;
    coverage: "RYNTRA_ACTIONS";
  }>;
}>;

export type ReceiptsArchiveRow = Readonly<{
  kind: ReceiptKind;
  contentHash: string;
  payload: Readonly<Record<string, unknown>>;
  occurredAt: string | null;
  createdAt: string;
}>;

export type ReceiptsArchiveGetResponse = Readonly<{ ok: true; address: string; rows: readonly ReceiptsArchiveRow[] }>;

export type ReceiptsArchivePutRequest = Readonly<{
  address: string;
  rows: readonly Readonly<{
    kind: ReceiptKind;
    contentHash: string;
    payload: Readonly<Record<string, unknown>>;
    occurredAt?: string | null;
  }>[];
}>;

export type ReceiptsArchivePutResponse = Readonly<{ ok: true; inserted: number; offered: number }>;

/** The receipt archive's own error bodies (not the v1 envelope). */
export type ReceiptsArchiveError = Readonly<{ error: "proof required"; proof: false }> | Readonly<{ error: "unavailable" | "forbidden" | "payload too large" | "bad request" }>;

export type RewardsPoints = Readonly<{
  points: string;
  level: number;
  levelFrom: string;
  nextLevelAt: string | null;
  rank: number | null;
  ranked: number;
  volume: string;
  trades: number;
  activeDays: number;
  policyVersion: string;
  excluded: boolean;
}>;

/** `GET /api/rewards?address=&locale=` — read-only; a claim is not described here. */
export type RewardsResponse = Readonly<{
  ok: true;
  address: string;
  available: string;
  pending: string;
  lifetime: string;
  cashback: string;
  referralL1: string;
  referralL2: string;
  sourceAmounts: Readonly<{ CASHBACK: string; REFERRAL_L1: string; REFERRAL_L2: string }>;
  claimable: boolean;
  claimBlockedReason: string | null;
  pendingReasons: readonly RewardPendingReason[];
  referrals: Readonly<{ level1: number; level2: number }>;
  rows: readonly RewardsRow[];
  referral: Readonly<{ code: string; link: string }>;
  claim: Readonly<{ state: RewardClaimState; text: string; signature: string | null }> | null;
  invitedBy: string | null;
  points: RewardsPoints | null;
  started: boolean;
}>;

/** The rewards route's own error bodies (not the v1 envelope): 429 `rate limited`, 401 `proof required`, 503 `REWARDS_UNAVAILABLE`. */
export type RewardsError = Readonly<{ error: "rate limited" }> | Readonly<{ error: "proof required"; proof: false }> | Readonly<{ ok: false; error: "REWARDS_UNAVAILABLE" }>;

export type RewardsReferralPreview = Readonly<{ code: string; inviterMasked: string; codeMasked: string }>;

export type RewardsReferralState = Readonly<{
  ok: true;
  pending: RewardsReferralPreview | null;
  confirmed: Readonly<{ inviterMasked: string; codeMasked: string | null }> | null;
}>;

export type RewardsReferralGetResponse = Readonly<{ ok: true; found: true; preview: RewardsReferralPreview }> | Readonly<{ ok: true; found: false; preview: null }> | RewardsReferralState;

export type RewardsReferralRequest = Readonly<{ action: "pending"; code: string }> | Readonly<{ action: "dismiss" }> | Readonly<{ action: "confirm"; code: string; address: string }>;

export type RewardsReferralError = Readonly<{ error: "rate limited" | "forbidden origin" | "bad request" }> | Readonly<{ ok: false; found: false; reason: "REFERRAL_CODE_NOT_FOUND" }> | Readonly<{ ok: false; reason: "PROOF_REQUIRED"; proof: false }> | Readonly<{ ok: false; reason: ReferralRefusal }>;

/** One monitor as a card: the latest unread note's words where there is one, else the status's own word. */
export type MonitoringCard = Readonly<{
  monitorId: string;
  label: string;
  status: MonitorStatus;
  title: string;
  reason: string;
  href: string;
  cta: string;
  paper: boolean;
  lastCheckedAt: string | null;
  lastTriggeredAt: string | null;
  subject: Readonly<{ kind: MonitorSubjectKind; id: string }>;
  finding: Readonly<{
    kind: MonitorConditionKind;
    outcome: MonitorFindingOutcome;
    facts: Readonly<{
      symbol?: string;
      price?: number | null;
      bound?: number | null;
      invalidation?: number | null;
      /** 1.21.0: a position's target. */
      target?: number | null;
      deviationPct?: number | null;
      maxDeviationPct?: number | null;
      validUntil?: string | null;
      metric?: string;
      probability?: number | null;
      maxProbability?: number | null;
      observedAt?: string | null;
    }>;
  }> | null;
}>;

/** One note: written once when a condition crossed, never permission to trade. */
export type MonitoringNote = Readonly<{
  id: string;
  owner: string;
  monitorId: string;
  triggerId: string;
  title: string;
  reason: string;
  context: string;
  href: string;
  cta: string;
  paper: boolean;
  unread: boolean;
  createdAt: string;
  locale: "en" | "uk";
  /** 1.12.0: `autoinvest-rule` on a rule's reminder (`id` the rule's id). */
  subject?: Readonly<{ kind: MonitorNoteSubjectKind; id: string }>;
  text?: Readonly<{ en: Readonly<{ title: string; reason: string }>; uk: Readonly<{ title: string; reason: string }> }>;
  finding?: Readonly<{
    kind: MonitorConditionKind;
    outcome: MonitorFindingOutcome;
    facts: Readonly<{
      symbol?: string;
      price?: number | null;
      bound?: number | null;
      invalidation?: number | null;
      /** 1.21.0: a position's target. */
      target?: number | null;
      deviationPct?: number | null;
      maxDeviationPct?: number | null;
      validUntil?: string | null;
      metric?: string;
      probability?: number | null;
      maxProbability?: number | null;
      observedAt?: string | null;
    }>;
  }>;
  /** 1.13.0: on a rule's reminder, what became of it as the rule reads it now; absent on every other note and where the rule is gone. */
  ruleState?: RuleOccurrenceState;
}>;

export type MonitoringPreferences = Readonly<{
  telegram: boolean;
  push: boolean;
  quietHours: Readonly<{ start: string; end: string; timezone: string }> | null;
}>;

/** `GET /api/monitoring` — the words follow `Accept-Language`, never the shape. */
export type MonitoringSurfaceResponse = Readonly<{
  attention: readonly MonitoringCard[];
  watching: readonly MonitoringCard[];
  recent: readonly MonitoringNote[];
  unread: number;
  preferences: MonitoringPreferences;
}>;

/** `POST /api/monitoring` — a read mark, or where notes go with each field of its own type (checked since 1.11.0). */
export type MonitoringWriteRequest = Readonly<{ read: string }> | Readonly<{
  telegram?: boolean;
  push?: boolean;
  quietHours?: Readonly<{ start: string; end: string; timezone: string }> | null;
}>;

export type MonitoringWriteResponse = Readonly<{ ok: true }>;

export type SwapQuoteRequest = Readonly<{ inputMint: string; outputMint: string; amountRaw: string; access?: "production" | "degraded" }>;

/** 1.12.0: `rule` — the autoinvest reminder the purchase is made under. */
export type SwapOriginRequest = Readonly<{ surface: "SPOT"; side: "BUY" | "SELL"; plan?: ExecutionPlanBinding; rule?: RuleBinding }>;

export type SwapOrderRequest = Readonly<{
  input: Readonly<{ inputMint: string; outputMint: string; amountRaw: string; taker: string }>;
  origin?: SwapOriginRequest;
}>;

export type SwapServiceFee = Readonly<{
  mechanism: "JUPITER_REFERRAL" | "JUPITER_PLATFORM_FEE" | "RELAY_APP_FEE" | "MAYAN_REFERRER" | "NONE";
  state: SwapServiceFeeState;
  basisPoints: number;
  requestedBasisPoints: number;
  asset: string | null;
  symbol: string | null;
  decimals: number | null;
  amountRaw: string | null;
  usd: number | null;
  accrual: "JUPITER_REFERRAL_TOKEN_ACCOUNT" | "FEE_WALLET_TOKEN_ACCOUNT" | "RELAY_APP_BALANCE_USDC" | "MAYAN_ONCHAIN_REFERRER" | "NONE";
  providerRetainedPercent: number | null;
  settlement: Readonly<{
    userPaidRaw: string | null;
    providerRaw: string | null;
    ryntraRaw: string | null;
    asset: string | null;
    symbol: string | null;
    decimals: number | null;
    basis: "OBSERVED" | "RYNTRA_OBSERVED_SPLIT_DOCUMENTED";
    operationRef: string;
  }> | null;
  note: string | null;
}>;

export type SwapJupiterRouteHop = Readonly<{
  ammKey: string;
  label: string;
  inputMint: string;
  outputMint: string;
  inAmountRaw: string;
  outAmountRaw: string;
  basisPoints: number;
}>;

export type SwapJupiterQuote = Readonly<{
  schema: "ryntra.solana.jupiter-order-quote";
  execution: "NOT_EXECUTED";
  taker: null;
  transactionBase64: null;
  schemaVersion: "1.0.0";
  provider: "jupiter";
  path: "ORDER_EXECUTE" | "BUILD_SUBMIT";
  access: "production" | "degraded";
  tier: "pro" | "lite";
  swapType: string;
  swapMode: string;
  router: string;
  mode: string;
  inputMint: string;
  outputMint: string;
  inAmountRaw: string;
  outAmountRaw: string;
  minReceivedRaw: string;
  slippageBps: number;
  priceImpactPct: string;
  inUsdValue: string | null;
  outUsdValue: string | null;
  swapUsdValue: string | null;
  totalFeeBasisPoints: number;
  totalFeeMint: string;
  platformFee: Readonly<{ basisPoints: number; mint: string; amountRaw: string | null }>;
  providerFee: Readonly<{ basisPoints: null; mint: null; amountRaw: null }>;
  ryntraFee: SwapServiceFee;
  providerReferralAccount: string | null;
  /** 1.24.0, `BUILD_SUBMIT` only: the fee wallet and its token account the fee is paid into. */
  ryntraFeeAccount?: Readonly<{ owner: string; account: string }>;
  signatureFeeLamports: string;
  signatureFeePayer: string | null;
  priorityFeeLamports: string;
  priorityFeePayer: string | null;
  rentFeeLamports: string;
  rentFeePayer: string | null;
  gasless: boolean;
  guaranteedPrice: boolean;
  jitOptimized: boolean;
  route: readonly SwapJupiterRouteHop[];
  routeAffectingOptions: readonly string[];
  requestId: string;
  providerExpiresAt: string | null;
  reviewExpiresAt: string;
  latencyMs: number;
  observedAt: string;
  source: Readonly<{ ref: string; label: string }>;
}>;

export type SwapJupiterOrder = Readonly<{
  schema: "ryntra.solana.jupiter-executable-order";
  execution: "EXECUTABLE_NOT_SUBMITTED";
  taker: string;
  transactionBase64: string;
  lastValidBlockHeight: string;
  schemaVersion: "1.0.0";
  provider: "jupiter";
  path: "ORDER_EXECUTE" | "BUILD_SUBMIT";
  access: "production" | "degraded";
  tier: "pro" | "lite";
  swapType: string;
  swapMode: string;
  router: string;
  mode: string;
  inputMint: string;
  outputMint: string;
  inAmountRaw: string;
  outAmountRaw: string;
  minReceivedRaw: string;
  slippageBps: number;
  priceImpactPct: string;
  inUsdValue: string | null;
  outUsdValue: string | null;
  swapUsdValue: string | null;
  totalFeeBasisPoints: number;
  totalFeeMint: string;
  platformFee: Readonly<{ basisPoints: number; mint: string; amountRaw: string | null }>;
  providerFee: Readonly<{ basisPoints: null; mint: null; amountRaw: null }>;
  ryntraFee: SwapServiceFee;
  providerReferralAccount: string | null;
  /** 1.24.0, `BUILD_SUBMIT` only: the fee wallet and its token account the fee is paid into. */
  ryntraFeeAccount?: Readonly<{ owner: string; account: string }>;
  signatureFeeLamports: string;
  signatureFeePayer: string | null;
  priorityFeeLamports: string;
  priorityFeePayer: string | null;
  rentFeeLamports: string;
  rentFeePayer: string | null;
  gasless: boolean;
  guaranteedPrice: boolean;
  jitOptimized: boolean;
  route: readonly SwapJupiterRouteHop[];
  routeAffectingOptions: readonly string[];
  requestId: string;
  providerExpiresAt: string | null;
  reviewExpiresAt: string;
  latencyMs: number;
  observedAt: string;
  source: Readonly<{ ref: string; label: string }>;
}>;

/** The Swap Quote Review: the quote a person reviews, hash-bound twice (`quoteDigest`, `reviewDigest`). */
export type SwapReview = Readonly<{
  schema: "ryntra.solana.swap-quote-review";
  schemaVersion: "1.0.0";
  state: "FRESH" | "STALE" | "PROVIDER_DEGRADED";
  execution: "NOT_EXECUTED";
  quoteDigest: string;
  reviewDigest: string;
  quote: Readonly<{
    schema: "ryntra.solana.jupiter-order-quote";
    schemaVersion: "1.0.0";
    provider: "jupiter";
    path: "ORDER_EXECUTE" | "BUILD_SUBMIT";
    access: "production" | "degraded";
    tier: "pro" | "lite";
    execution: "NOT_EXECUTED";
    router: string;
    mode: string;
    swapType: string;
    swapMode: string;
    requestId: string;
    inputMint: string;
    outputMint: string;
    inputRaw: string;
    quotedOutputRaw: string;
    minimumOutputRaw: string;
    slippageBps: number;
    priceImpactPct: string;
    inUsdValue: string | null;
    outUsdValue: string | null;
    swapUsdValue: string | null;
    totalFeeBasisPoints: number;
    totalFeeMint: string;
    platformFee: Readonly<{ basisPoints: number | null; mint: string | null; amountRaw: string | null }>;
    providerFee: Readonly<{ basisPoints: number | null; mint: string | null; amountRaw: string | null }>;
    ryntraFee: SwapServiceFee;
    providerReferralAccount: string | null;
    /** 1.24.0, `BUILD_SUBMIT` only: the fee wallet and its token account the fee is paid into. */
    ryntraFeeAccount?: Readonly<{ owner: string; account: string }>;
    signatureFeeLamports: string;
    signatureFeePayer: string | null;
    priorityFeeLamports: string;
    priorityFeePayer: string | null;
    rentFeeLamports: string;
    rentFeePayer: string | null;
    gasless: boolean;
    guaranteedPrice: boolean;
    jitOptimized: boolean;
    route: readonly Readonly<{
      ammKey: string;
      label: string;
      inputMint: string;
      outputMint: string;
      inAmountRaw: string;
      outAmountRaw: string;
      basisPoints: number;
    }>[];
    routeAffectingOptions: readonly string[];
    taker: null;
    transactionBase64: null;
    observedAt: string;
    providerExpiresAt: string | null;
    reviewExpiresAt: string;
    latencyMs: number;
    sourceRef: string;
    sourceLabel: string;
  }>;
  limitations: readonly ["QUOTE_ONLY", "NO_SIGNATURE", "NO_EXECUTION", "NO_RECEIPT"];
}>;

export type SwapPassport = Readonly<{
  schema: "ryntra.solana.asset-passport";
  schemaVersion: "0.1.0";
  network: "mainnet" | "devnet";
  identity: Readonly<{
    mint: string;
    programKind: "SPL_TOKEN" | "TOKEN_2022" | "NOT_A_MINT";
    programId: string;
    decimals: Readonly<{
      value: number;
      provenance: "ONCHAIN_VERIFIED" | "DECLARED" | "DERIVED" | "CONFLICTING" | "UNKNOWN" | "UNSUPPORTED";
      meaning: string;
    }>;
    supply: Readonly<{
      value: string;
      provenance: "ONCHAIN_VERIFIED" | "DECLARED" | "DERIVED" | "CONFLICTING" | "UNKNOWN" | "UNSUPPORTED";
      meaning: string;
    }>;
    mintAuthority: Readonly<{
      value: string | null;
      provenance: "ONCHAIN_VERIFIED" | "DECLARED" | "DERIVED" | "CONFLICTING" | "UNKNOWN" | "UNSUPPORTED";
      meaning: string;
    }>;
    freezeAuthority: Readonly<{
      value: string | null;
      provenance: "ONCHAIN_VERIFIED" | "DECLARED" | "DERIVED" | "CONFLICTING" | "UNKNOWN" | "UNSUPPORTED";
      meaning: string;
    }>;
    isInitialized: Readonly<{
      value: boolean;
      provenance: "ONCHAIN_VERIFIED" | "DECLARED" | "DERIVED" | "CONFLICTING" | "UNKNOWN" | "UNSUPPORTED";
      meaning: string;
    }>;
  }>;
  extensions: readonly Readonly<{
    kind: string;
    provenance: "ONCHAIN_VERIFIED" | "DECLARED" | "DERIVED" | "CONFLICTING" | "UNKNOWN" | "UNSUPPORTED";
    meaning: string;
    fields: Readonly<Record<string, string | number | boolean | null>>;
    affectsTransfers: boolean;
  }>[];
  unsupportedKinds: readonly string[];
  observedAt: string;
  source: Readonly<{ ref: string; label: string }>;
}>;

/** The review policy's verdict over the output mint; never "safe" — the best verdict is `NO_KNOWN_BLOCKER`. */
export type SwapAssetVerdict = Readonly<{
  schema: "ryntra.solana.policy-verdict";
  schemaVersion: "0.1.0";
  verdict: "NO_KNOWN_BLOCKER" | "REVIEW_REQUIRED" | "BLOCKED" | "INCOMPLETE";
  findings: readonly Readonly<{
    rule: SwapAssetPolicyRule;
    outcome: "ALLOWED" | "REVIEW_REQUIRED" | "BLOCKED" | "INCOMPLETE";
    detail: string;
  }>[];
  evaluatedAt: string;
}>;

/** 1.20.0: which way a company goes — bought with USDC, or sold into it. */
export type CheckSide = "buy" | "sell";
/** 1.20.0: `quote` the live quote's figures, before a Review; `order` the exact order the wallet will sign. */
export type CheckBasis = "quote" | "order";
/** 1.20.0: USDC counted as dollars, or the company's share or token as the wallet shows it. */
export type CheckUnit = "usdc" | "share" | "token";
export type CheckWords = Readonly<{ en: string; uk: string }>;

/**
 * 1.20.0 — «Перевірка» as the server counts it: Спишеться (`spend`) · Отримаєш
 * (`get`, with `atLeast` the chain's minimum) · Усі витрати (`costs`, the
 * issuer's fee inside it said alone) · Що це (`what`), and the account's
 * one-time reserve (`reserve`, on the order only; `first` — say it before the
 * four lines). Draw these figures; count none of them. An amount that could
 * not be counted is null, never zero.
 */
export type SwapCheck = Readonly<{
  side: CheckSide;
  basis: CheckBasis;
  company: Readonly<{ mint: string; symbol: string; name: string; issuer: "xstocks" | "backpack" | "ondo" | "prestocks"; unit: "share" | "token"; privateCompany: boolean; decimals: number; multiplier: number | null }>;
  spend: Readonly<{ mint: string; unit: CheckUnit; amount: number | null; usd: number | null }>;
  get: Readonly<{ mint: string; unit: CheckUnit; amount: number | null; atLeast: number | null; usd: number | null }>;
  costs: Readonly<{ usd: number; issuerFee: Readonly<{ basisPoints: number; usd: number }> | null }> | null;
  reserve: Readonly<{ lamports: string; usd: number | null; first: boolean }> | null;
  what: Readonly<{ truth: CheckWords; note: Readonly<{ kind: "issuer-event" | "sale-may-fail"; en: string; uk: string }> | null; caution: boolean }>;
  sol: Readonly<{ usd: number | null; observedAt: string | null }>;
}>;

export type SwapQuoteResponse = Readonly<{
  order: SwapJupiterQuote;
  review: SwapReview;
  verdict: SwapAssetVerdict;
  decimals: Readonly<Record<string, number>>;
  outputFee: Readonly<{ basisPoints: number; feeRaw: string; capApplied: boolean }>;
  passports: Readonly<Record<string, SwapPassport>>;
  expiresAt: string;
  /** 1.20.0: «Перевірка» on the quote (no reserve); null unless a company is bought with USDC or sold into it. */
  check: SwapCheck | null;
}>;

export type SwapInspection = Readonly<{
  messageHashHex: string;
  version: 0;
  feePayer: string;
  signerAddresses: readonly string[];
  providerPresignedCount: number;
  blockhash: string;
  programs: readonly string[];
  tokenProgramIndices: readonly number[];
  staticAccountCount: number;
  staticAccounts: readonly string[];
  lookupTables: readonly Readonly<{ table: string; writableCount: number; readonlyCount: number }>[];
  instructionCount: number;
  wireBytes: number;
  nativeWrapRoundTrip: Readonly<{ accountIndex: number; account: string | null; fundedLamportsRaw: string; closesToTaker: true }> | null;
  nativeWrapCandidate: Readonly<{ accountIndex: number; account: string | null; fundedLamportsRaw: string }> | null;
}>;

export type SwapOwnerEffects = Readonly<{
  status: "VERIFIED";
  method: "SIMULATION_OWNER_DELTAS_V1";
  tokenInstructionAudit: "NO_UNSAFE_MUTATIONS";
  nativeWrapRoundTrip: boolean;
  programs: readonly string[];
  taker: string;
  inputMint: string;
  outputMint: string;
  inputAmountRaw: string;
  outputAmountRaw: string;
  minimumOutputRaw: string;
  inputRepresentation: "TOKEN" | "NATIVE_SOL";
  outputRepresentation: "TOKEN" | "NATIVE_SOL";
  feeLamports: string;
  takerLamportDelta: string;
  ownerTokenDeltas: readonly Readonly<{ mint: string; rawDelta: string }>[];
  accountVectorCount: number;
  durableRentLamports?: string;
  rentProof?: "EXACT_MINIMUM" | "REVIEWED_CEILING" | "NONE";
}>;

export type SwapSimulation = Readonly<{
  status: "OK" | "FAILED";
  unitsConsumed: string | null;
  error: string | null;
  sourceHost: string;
  observedAt: string;
  ownerEffects: SwapOwnerEffects | null;
}>;

export type SwapIntent = Readonly<{
  schema: "ryntra.solana.swap-intent";
  schemaVersion: "1.0.0";
  intentId: string;
  revision: number;
  network: "mainnet";
  signer: string;
  inputMint: string;
  outputMint: string;
  inputAmountRaw: string;
  quotedOutputRaw: string;
  minimumOutputRaw: string;
  slippageBps: number;
  priceImpactPct: string;
  programs: readonly string[];
  usd: Readonly<{ inValue: string | null; outValue: string | null; swapValue: string | null; sourceRef: string }> | null;
  reviewExpiresAt: string;
}>;

export type SwapVerdict = Readonly<{
  schema: "ryntra.solana.swap-verdict";
  schemaVersion: "1.0.0";
  decision: "ALLOW" | "REVIEW" | "BLOCK";
  policyId: "ryntra-solana-swap-v1";
  policyDigest: string;
  intentDigest: string;
  findings: readonly Readonly<{ rule: SwapPolicyRule; outcome: "PASS" | "REVIEW" | "BLOCK"; detail: string }>[];
  evaluatedAt: string;
}>;

export type SwapOrigin = Readonly<{
  surface: "SPOT";
  side: "BUY" | "SELL";
  plan?: Readonly<{ planId: string; version: number; reviewId: string }>;
  /** 1.12.0: the autoinvest reminder, as the order named it. */
  rule?: RuleBinding;
}>;

/** The issuer-signed execution bundle `/order` serves and `/execute` demands back unchanged. */
export type SwapBundle = Readonly<{
  review: SwapReview;
  taker: string;
  lastValidBlockHeight: string;
  inspection: SwapInspection;
  simulation: SwapSimulation;
  policyIntent: SwapIntent;
  policyVerdict: SwapVerdict;
  origin?: SwapOrigin;
  planReview?: PlanReview;
}>;

export type SwapSignedProof = Readonly<{
  schema: "ryntra.solana.swap-execution-proof";
  schemaVersion: "1.0.0";
  status: "SIGNED";
  algorithm: "Ed25519";
  digest: string;
  keyId: string;
  publicKey: string;
  signature: string;
  issuedAt: string;
}>;

export type SwapProof = SwapSignedProof | Readonly<{
  schema: "ryntra.solana.swap-execution-proof";
  schemaVersion: "1.0.0";
  status: "UNSIGNED";
  digest: string;
  reasonCode: "NO_ISSUER_KEY_CONFIGURED";
  issuedAt: string;
}>;

export type SwapPreSign = Readonly<{ ready: true; code: "READY_FOR_HUMAN_APPROVAL"; reason: string }>;

export type SwapOrderResponse = Readonly<{
  order: SwapJupiterOrder;
  review: SwapReview;
  inspection: SwapInspection;
  simulation: SwapSimulation;
  passports: Readonly<Record<string, SwapPassport>>;
  decimals: Readonly<Record<string, number>>;
  assetReview: SwapAssetVerdict | null;
  policy: Readonly<{ intent: SwapIntent; verdict: SwapVerdict }>;
  bundle: SwapBundle;
  proof: SwapSignedProof;
  preSign: SwapPreSign;
  expiresAt: string;
  planReview: PlanReview | null;
  /** 1.20.0: «Перевірка» on this exact order, with the reserve the simulation proved; null unless a company is bought with USDC or sold into it. */
  check: SwapCheck | null;
}>;

/** `POST /api/solana/swap/execute` — the bundle and the proof exactly as `/order` served them, and the wallet's signed bytes (`reviewedTransactionBase64` only when the wallet changed them). */
export type SwapExecuteRequest = Readonly<{ bundle: SwapBundle; proof: SwapProof; signedTransactionBase64: string; reviewedTransactionBase64?: string }>;

export type SwapExecuteReport = Readonly<{
  schema: "ryntra.solana.jupiter-execute-report";
  schemaVersion: "1.0.0";
  status: "Success" | "Failed";
  code: number;
  signature: string | null;
  totalInputAmountRaw: string | null;
  totalOutputAmountRaw: string | null;
  inputAmountResultRaw: string | null;
  outputAmountResultRaw: string | null;
  providerError: string | null;
  httpStatus: number;
  latencyMs: number;
  observedAt: string;
  source: Readonly<{ ref: string; label: string }>;
}>;

export type SwapObservation = Readonly<{
  signature: string;
  slot: string;
  finality: "confirmed" | "finalized";
  actualInputRaw: string;
  actualOutputRaw: string;
  baseFeeLamports: string;
  priorityFeeLamports: string;
  programs: readonly string[];
  observedAt: string;
  source: Readonly<{ ref: string; label: string }>;
  serviceFeeCollectedRaw: string | null;
}>;

export type SwapFacts = Readonly<{
  schema: "ryntra.solana.swap-receipt-facts";
  schemaVersion: "1.0.0";
  reviewDigest: string;
  quoteDigest: string;
  quote: Readonly<{
    inputMint: string;
    outputMint: string;
    inputRaw: string;
    outputRaw: string;
    minimumOutputRaw: string;
  }>;
  routing: Readonly<{
    router: string;
    mode: string;
    route: readonly Readonly<{ ammKey: string; basisPoints: number }>[];
  }>;
  fees: Readonly<{
    platform: Readonly<{ basisPoints: number; mint: string | null; amountRaw: string | null }>;
    referral: Readonly<{ basisPoints: number; mint: string | null; amountRaw: string | null }>;
    serviceFee?: SwapServiceFee;
    baseLamports: string;
    priorityLamports: string;
  }>;
  provider: Readonly<{
    requestId: string;
    signature: string;
    status: string;
    inputRaw: string;
    outputRaw: string;
    source: Readonly<{ ref: string; label: string; observedAt: string }>;
  }> | null;
  independentObservation: Readonly<{
    signature: string;
    slot: string;
    finality: "confirmed" | "finalized";
    actualInputRaw: string;
    actualOutputRaw: string;
    baseFeeLamports: string;
    priorityFeeLamports: string;
    programs: readonly string[];
    observedAt: string;
    source: Readonly<{ ref: string; label: string }>;
    serviceFeeCollectedRaw?: string | null;
  }>;
  reconciliation: Readonly<{
    state: "MATCHED" | "DEVIATION_RECORDED" | "FAILED" | "UNKNOWN" | "RECOVERY";
    outputDeltaRaw: string;
    minimumMet: boolean;
    deviations: readonly SwapReceiptDeviation[];
  }>;
}>;

export type SwapReceipt = Readonly<{
  schemaVersion: "2.0.0";
  id: string;
  createdAt: string;
  registry: Readonly<{ registryDigest: string; refs: readonly Readonly<{ ref: string; contentHash: string }>[] }>;
  contentHash: string;
  issuer: Readonly<{
    status: "SIGNED";
    algorithm: "Ed25519";
    keyId: string;
    publicKey: string;
    signature: string;
    signedAt: string;
  }> | Readonly<{
    status: "UNSIGNED";
    reasonCode: "NO_ISSUER_KEY_CONFIGURED" | "ISSUER_KEY_UNAVAILABLE" | "SIGNING_NOT_REQUESTED";
    keyId: null;
    publicKey: null;
    signature: null;
    signedAt: null;
  }>;
  integrity: Readonly<{ algorithm: "SHA-256"; hash: string }>;
  kind: "OUTCOME_RECEIPT";
  maturity: "OBSERVED";
  actionPassportHash: string;
  outcome: Readonly<{
    status: "MATCHED" | "DEVIATION_RECORDED" | "FAILED";
    chainRef: string;
    transactionHash: string;
    observedEffects: readonly Readonly<{ description: string; sourceRef: string; observedAt: string }>[];
    reconciledAt: string;
  }>;
  limitations: readonly ["OUTCOME RECEIPT — AN OBSERVATION, NOT AN INSTRUCTION", "Ryntra observed and reconciled this outcome. The wallet supplied any required signature; submission responsibility is stated by the receipt's bound action path."] | readonly ["OUTCOME RECEIPT — AN OBSERVATION, NOT AN INSTRUCTION", "Ryntra observed and reconciled this outcome; it did not sign, submit, fund or execute it."];
}>;

/** Switch on `state`: 200 settled with its Receipt; 202 `SUBMITTED_UNKNOWN` or `RECOVERY_PENDING` — read again by signature, never execute again. */
export type SwapExecuteResponse = Readonly<{
  state: "MATCHED" | "DEVIATION_RECORDED" | "RECOVERY";
  signature: string;
  finality: "confirmed" | "finalized";
  report: SwapExecuteReport | null;
  observation: SwapObservation;
  takerLamportDelta: string;
  feeLamports: string;
  facts: SwapFacts;
  factsRefusal: null;
  receipt: SwapReceipt;
  policy: Readonly<{ verdict: SwapVerdict }>;
}> | Readonly<{
  state: "SUBMITTED_UNKNOWN";
  signature: string;
  report: null;
  providerFailure: Readonly<{
    code: "PRODUCTION_KEY_REQUIRED" | "PINNED_CONTRACT" | "AMBIGUOUS_NETWORK" | "AMBIGUOUS_HTTP" | "AMBIGUOUS_MALFORMED" | "BROADCAST_UNANSWERED";
    reason: string;
  }>;
  recovery: string;
}> | Readonly<{
  state: "RECOVERY_PENDING";
  signature: string;
  report: SwapExecuteReport | null;
  observationFailure: Readonly<{ code: "RPC_FAILED" | "NOT_FOUND" | "UNREADABLE" | "LEG_UNRESOLVED"; reason: string }>;
  recovery: string;
}> | Readonly<{
  state: "RECOVERY_PENDING";
  signature: string;
  report: SwapExecuteReport | null;
  observation: SwapObservation;
  facts: null;
  factsRefusal: string;
  recovery: string;
}> | Readonly<{ state: "RECOVERY_PENDING"; signature: string; recovery: string }>;

export type SwapCancelReviewRequest = Readonly<{ owner: string; requestId: string }>;

export type SwapCancelReviewResponse = Readonly<{ state: "EXPIRED_BEFORE_SUBMIT"; owner: string; requestId: string; blockhashValid: false }>;

export type SwapRecoverRequest = Readonly<{ owner: string; signature: string; requestId?: string }>;

/** Switch on `state`. `ALREADY_RECEIPTED` carries the observation and facts the Receipt sealed (1.11.0, request 14). */
export type SwapRecoverResponse = Readonly<{ state: "PENDING"; signature: string; reason: string }> | Readonly<{ state: "SEEN_WITHOUT_RECORD"; signature: string; reason: string }> | Readonly<{ state: "UNKNOWN_TO_CHAIN"; signature: string; reason: string }> | Readonly<{ state: "FAILED"; signature: string; reason: string; chainError: string | null }> | Readonly<{
  state: "EXPIRED_BEFORE_SUBMIT";
  signature: string;
  blockhashValid: false;
  lastValidBlockHeight: string;
}> | Readonly<{
  state: "EXPIRED_AFTER_SUBMIT";
  signature: string;
  blockhashValid: false;
  lastValidBlockHeight: string;
}> | Readonly<{
  state: "ALREADY_RECEIPTED";
  signature: string;
  receiptHash: string;
  receipt: SwapReceipt;
  observation: SwapObservation | null;
  facts: SwapFacts | null;
}> | Readonly<{
  state: "RECOVERED";
  signature: string;
  finality: "confirmed" | "finalized";
  observation: SwapObservation;
  facts: SwapFacts;
  receipt: SwapReceipt;
}>;

export type SwapQuoteError = Readonly<{
  error: Readonly<{
    code: SwapQuoteErrorCode;
    message: string;
    lifecycle?: Readonly<{ state: "redeem-only" | "expired"; url: string }>;
    provider?: Readonly<{ errorCode: string | null }>;
  }>;
}>;

export type SwapOrderError = Readonly<{
  error: Readonly<{
    code: SwapOrderErrorCode;
    message: string;
    provider?: Readonly<{ errorCode: string | null; router: string | null }>;
    ownerLock?: Readonly<{ state: SwapOwnerLockState; requestId: string; signature: string | null }> | null;
    simulation?: SwapSimulation;
    planReview?: PlanReview;
    policy?: Readonly<{ verdict: SwapVerdict }>;
    preSign?: Readonly<{ ready: false; code: SwapPreSignRefusalCode; reason: string }>;
  }>;
}>;

/** Every refusal before the signature claim carries `submitBoundary: "NOT_CROSSED"`: the network never saw the bytes. */
export type SwapExecuteError = Readonly<{
  error: Readonly<{
    code: SwapExecuteErrorCode;
    message: string;
    submitBoundary?: "NOT_CROSSED";
    comparisons?: readonly Readonly<{ field: string; expected: string; actual: string; matched: boolean }>[];
    policy?: Readonly<{ verdict: SwapVerdict }>;
    planReview?: PlanReview | null;
    signature?: string | null;
    report?: SwapExecuteReport | null;
    chainError?: string | null;
    durableState?: "RESERVED" | "SUBMITTED_UNKNOWN" | "CONFIRMED" | "FINALIZED" | "LANDED_FAILED" | "EXPIRED_BEFORE_SUBMIT" | "EXPIRED_AFTER_SUBMIT" | "RECOVERY_REQUIRED" | "RECEIPTED" | "UNKNOWN";
    recovery?: string;
  }>;
}>;

export type SwapCancelReviewError = Readonly<{ error: Readonly<{ code: SwapCancelReviewErrorCode; message: string }> }>;

export type SwapRecoverError = Readonly<{ error: Readonly<{ code: SwapRecoverErrorCode; message: string }> }>;

/* ------------------------------------------------------------ 1.11.0 — Ryntra Predictions in paper mode */

/**
 * Every route under `/api/predictions/*`, typed as it is served. The market
 * reads are public; the paper account, the link, quotes, orders, plans and
 * the watchlist need the proven wallet (the bearer). A refusal is
 * `PredictionsError` — the route's own `PredictionsFailure`, or the v1
 * wallet-proof refusal before its handler runs — thrown by the client as
 * `RyntraRouteError`. Nothing here moves funds: every order is a paper order.
 */

export const PREDICTION_FAILURE_CODES = ["VALIDATION_ERROR", "UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND", "RATE_LIMITED", "PROVIDER_UNAVAILABLE", "NOT_LINKED", "LINK_UNAVAILABLE", "SESSION_EXPIRED", "WALLET_MISMATCH", "SIGNATURE_INVALID", "QUOTE_UNAVAILABLE", "QUOTE_EXPIRED", "ORDER_REFUSED", "PLAN_INVALID", "PLAN_NOT_FOUND", "PLAN_VERSION_CONFLICT", "PLAN_STATE_REFUSED", "UNAVAILABLE"] as const;
export type PredictionFailureCode = (typeof PREDICTION_FAILURE_CODES)[number];

export const PREDICTION_MARKET_STATUSES = ["open", "closed", "resolved", "unknown"] as const;
export type PredictionMarketStatus = (typeof PREDICTION_MARKET_STATUSES)[number];

export const PREDICTION_ORDER_STATES = ["reviewed", "submitted", "filled", "partially_filled", "failed", "expired", "cancelled"] as const;
export type PredictionOrderState = (typeof PREDICTION_ORDER_STATES)[number];

export const PREDICTION_LINK_STATES = ["none", "active", "expired", "revoked"] as const;
export type PredictionLinkState = (typeof PREDICTION_LINK_STATES)[number];

export const PREDICTION_DISCOVER_SORTS = ["volume24h", "volume", "newest", "ending"] as const;
export type PredictionDiscoverSort = (typeof PREDICTION_DISCOVER_SORTS)[number];

export const PREDICTION_CHART_RESOLUTIONS = ["1m", "5m", "1h", "1d"] as const;
export type PredictionChartResolution = (typeof PREDICTION_CHART_RESOLUTIONS)[number];

export const PREDICTION_PLAN_STATUSES = ["draft", "active", "executed", "cancelled", "expired"] as const;
export type PredictionPlanStatus = (typeof PREDICTION_PLAN_STATUSES)[number];

export const PREDICTION_MONITOR_METRICS = ["probability", "volume24h", "signal", "resolution", "plan"] as const;
export type PredictionMonitorMetric = (typeof PREDICTION_MONITOR_METRICS)[number];

/** A prediction route's own refusal; `issues` (at most 32) on VALIDATION_ERROR and PLAN_INVALID. */
export type PredictionsFailure = Readonly<{
  error: Readonly<{
    code: PredictionFailureCode;
    message: string;
    issues?: readonly Readonly<{ path: string; message: string }>[];
  }>;
}>;

/** Every error a prediction route answers from JSON: its own, or the v1 wallet-proof refusal before its handler runs. */
export type PredictionsError = PredictionsFailure | ApiError;

export type PredictionFailureValue = Readonly<{
  ok: false;
  code: PredictionFailureCode;
  message: string;
  issues?: readonly Readonly<{ path: string; message: string }>[];
  retryAfterSeconds?: number;
}>;

export type PredictionCategory = Readonly<{ id: string; slug: string; name: string; eventCount: number; volume24h: number }>;

export type PredictionOutcome = Readonly<{
  id: string;
  label: string;
  probability: number | null;
  venueMarketId: string;
  winner: boolean | null;
  matched: readonly Readonly<{ venueMarketId: string; outcomeId: string }>[];
}>;

export type PredictionVenueMarket = Readonly<{
  id: string;
  venue: string;
  question: string;
  status: PredictionMarketStatus;
  outcomes: readonly Readonly<{ id: string; label: string; probability: number | null; winner: boolean | null }>[];
  volume: number | null;
  description: string | null;
  rules: Readonly<{ primary: string | null; secondary: string | null }>;
}>;

export type PredictionMarket = Readonly<{
  id: string;
  venue: string;
  question: string;
  status: PredictionMarketStatus;
  outcomes: readonly PredictionOutcome[];
  volume: number | null;
  endDate: string | null;
  resolutionDate: string | null;
  description: string | null;
  rules: Readonly<{ primary: string | null; secondary: string | null }>;
  tickSize: number | null;
  minOrderSize: number | null;
  aggKey: string | null;
  arbReturn: number | null;
  matched: readonly PredictionVenueMarket[];
  image: string | null;
}>;

export type PredictionSettlement = Readonly<{
  sharedSummary: string;
  differences: readonly Readonly<{ type: string; title: string; summary: string | null; perVenue: Readonly<Record<string, string>> }>[];
}>;

/** An event as a list shows it. */
export type PredictionEventSummary = Readonly<{
  id: string;
  title: string;
  subtitle: string | null;
  image: string | null;
  status: PredictionMarketStatus;
  venue: string;
  venues: readonly string[];
  volume: number | null;
  endDate: string | null;
  categories: readonly Readonly<{ id: string; slug: string; name: string }>[];
  marketCount: number;
  aggKey: string | null;
  structureType: string | null;
  arbReturn: number | null;
  leading: readonly Readonly<{ id: string; label: string; probability: number | null; venueMarketId: string }>[];
}>;

export type PredictionEvent = Readonly<{
  id: string;
  title: string;
  subtitle: string | null;
  image: string | null;
  status: PredictionMarketStatus;
  venue: string;
  venues: readonly string[];
  volume: number | null;
  endDate: string | null;
  categories: readonly Readonly<{ id: string; slug: string; name: string }>[];
  marketCount: number;
  aggKey: string | null;
  structureType: string | null;
  arbReturn: number | null;
  leading: readonly Readonly<{ id: string; label: string; probability: number | null; venueMarketId: string }>[];
  description: string | null;
  startDate: string | null;
  markets: readonly PredictionMarket[];
  settlement: PredictionSettlement | null;
}>;

export type PredictionBookLevel = Readonly<{ price: number; size: number; venues: Readonly<Record<string, number>> }>;

export type PredictionVenueBook = Readonly<{
  venue: string;
  venueMarketId: string;
  tickSize: number | null;
  bids: readonly PredictionBookLevel[];
  asks: readonly PredictionBookLevel[];
}>;

export type PredictionBook = Readonly<{
  venueMarketId: string;
  status: string;
  error: string | null;
  requested: Readonly<{ venue: string; marketStatus: string | null; tickSize: number | null }> | null;
  venues: readonly PredictionVenueBook[];
  matched: readonly Readonly<{ venue: string; venueMarketId: string; hasOrderbook: boolean }>[];
  aggregated: Readonly<{ bids: readonly PredictionBookLevel[]; asks: readonly PredictionBookLevel[] }>;
  readAt: string;
}>;

export type PredictionBar = Readonly<{ t: number; o: number; h: number; l: number; c: number; v: number | null }>;

export type PredictionChart = Readonly<{
  outcomeId: string;
  venue: string;
  resolution: PredictionChartResolution;
  bars: readonly PredictionBar[];
  staleSeconds: number | null;
  lastBarAt: number | null;
}>;

export type PredictionVenuePrice = Readonly<{
  venue: string;
  venueMarketId: string;
  midpoint: number | null;
  spread: number | null;
  bestBid: number | null;
  bestAsk: number | null;
  timestamp: number | null;
}>;

export type PredictionMarketPrices = Readonly<{
  venueMarketId: string;
  venue: string;
  midpoint: number | null;
  spread: number | null;
  timestamp: number | null;
  arbReturn: number | null;
  marketStatus: string | null;
  error: string | null;
  outcomes: readonly Readonly<{
    outcomeId: string;
    label: string;
    midpoint: number | null;
    bestBid: number | null;
    bestAsk: number | null;
  }>[];
  venues: readonly PredictionVenuePrice[];
}>;

export type PredictionSignal = Readonly<{ id: string; text: string; side: string; direction: string; domain: string }>;

/** The provider's generated signals: advisory content, never evidence. */
export type PredictionSignals = Readonly<{
  signals: readonly PredictionSignal[];
  sourceModel: string;
  promptVersion: string | number;
  createdAt: string;
}>;

export type PredictionRelatedMarket = Readonly<{
  score: number;
  venue: string;
  venueMarketId: string;
  venueEventId: string | null;
  marketQuestion: string;
  eventTitle: string;
  matchSource: string;
  matchedSignal: string | null;
}>;

export type PredictionRipple = Readonly<{
  mode: "expand" | "hedge";
  items: readonly Readonly<{
    eventId: string;
    title: string;
    status: string;
    score: number;
    action: string;
    reason: string;
    domain: string;
    endDate: string | null;
  }>[];
}>;

export type PredictionNewsArticle = Readonly<{ title: string; source: string; publishedAt: string | null; url: string | null; summary: string }>;

export type PredictionNews = Readonly<{ window: string | null; query: string | null; articles: readonly PredictionNewsArticle[] }>;

export type PredictionEngineState = Readonly<{
  tradingMode: string;
  paperStartingBalance: number | null;
  disabledVenues: readonly string[];
  signals: Readonly<{ marketsProcessed: number; marketsTotal: number; coveragePct: number; total: number }> | null;
}>;

export type PredictionMonitorCondition = Readonly<{
  metric: PredictionMonitorMetric;
  direction: "above" | "below" | "any";
  threshold: number | null;
  note: string | null;
}>;

export type PredictionPlanRules = Readonly<{
  thesis: string;
  whyNow: string | null;
  eventId: string;
  eventTitle: string;
  venueMarketId: string;
  question: string;
  outcomeId: string;
  outcomeLabel: string;
  amountUsd: number;
  entryProbability: number;
  maxProbability: number | null;
  invalidation: Readonly<{ text: string; probabilityBelow: number | null }>;
  resolutionDeadline: string | null;
  monitoring: readonly PredictionMonitorCondition[];
  references: readonly string[];
  assumptions: readonly string[];
}>;

export type PredictionPlanSizing = Readonly<{
  model: "prediction-long-v1";
  sharesAtEntry: number;
  maxLossUsd: number;
  payoutIfRightUsd: number;
  profitIfRightUsd: number;
  returnIfRightPct: number;
  breakEvenProbability: number;
}>;

export type PredictionPlanVersion = Readonly<{
  version: number;
  createdAt: string;
  reason: string | null;
  rules: PredictionPlanRules;
  sizing: PredictionPlanSizing;
}>;

export type PredictionPlanJournalEntry = Readonly<{
  at: string;
  kind: "created" | "edited" | "activated" | "cancelled" | "expired" | "reviewed" | "executed" | "note";
  version: number;
  note: string | null;
  ref: string | null;
}>;

/** A Prediction Plan, versioned: an edit is a new version, a status change a journal entry. */
export type PredictionPlan = Readonly<{
  id: string;
  kind: "prediction";
  owner: string;
  status: PredictionPlanStatus;
  createdAt: string;
  updatedAt: string;
  version: number;
  current: PredictionPlanVersion;
  versions: readonly Readonly<{ version: number; createdAt: string; reason: string | null }>[];
  journal: readonly PredictionPlanJournalEntry[];
  executions: readonly Readonly<{ quoteId: string; at: string; state: string }>[];
}>;

export type PredictionPaperBalance = Readonly<{
  startingBalance: number;
  cashBalance: number;
  positionsValue: number;
  realizedPnl: number;
  unrealizedPnl: number;
  earnings: number;
}>;

export type PredictionPaperPosition = Readonly<{
  eventId: string | null;
  venueEventId: string;
  question: string;
  image: string | null;
  marketStatus: string;
  status: "active" | "closed";
  redeemStatus: string;
  resolutionDate: string | null;
  outcomes: readonly Readonly<{
    label: string;
    totalSize: number;
    avgEntryPrice: number;
    currentPrice: number;
    totalValue: number;
    unrealizedPnl: number;
    unrealizedPnlPercent: number;
    winner: boolean | null;
    venues: readonly Readonly<{ venue: string; size: number; venueMarketId: string; outcomeId: string }>[];
  }>[];
}>;

export type PredictionPaperOrder = Readonly<{
  id: string;
  quoteId: string | null;
  status: string;
  venue: string;
  side: string;
  createdAt: string;
  updatedAt: string;
  amountUsd: number | null;
  filledUsd: number | null;
  quotedPrice: number | null;
  executionPrice: number | null;
  quotedShares: number | null;
  actualShares: number | null;
  quotedToWin: number | null;
  actualToWin: number | null;
  partialFillReason: string | null;
  error: string | null;
  question: string | null;
  venueEventId: string | null;
  outcomeLabel: string | null;
}>;

export type PredictionPaperExecution = Readonly<{
  quoteId: string;
  executionId: string | null;
  orderIds: readonly string[];
  state: string;
  terminal: boolean;
  error: string | null;
  pollAfterMs: number | null;
  steps: readonly Readonly<{ label: string; kind: string; status: string; error: string | null }>[];
  orders: readonly Readonly<{
    orderId: string;
    venue: string;
    status: string;
    event: string | null;
    filledUsd: number | null;
    actualShares: number | null;
    executionPrice: number | null;
    error: string | null;
  }>[];
}>;

export type PredictionRouteFill = Readonly<{
  venue: string;
  chain: string;
  avgPrice: number;
  shares: number;
  fees: Readonly<{ venue: number | null; builder: number | null; settlement: number | null }>;
}>;

export type PredictionRoute = Readonly<{
  quoteId: string;
  status: string;
  side: "buy" | "sell";
  outcomeId: string;
  venueMarketId: string;
  requested: number;
  shares: number;
  costUsd: number;
  totalCostIncFeesUsd: number | null;
  avgProbability: number | null;
  estimatedPayoutUsd: number | null;
  estimatedProfitUsd: number | null;
  returnPct: number | null;
  fees: Readonly<{ venue: number; builder: number; settlement: number; app: number | null }>;
  fills: readonly PredictionRouteFill[];
  venueSolo: readonly Readonly<{ venue: string; fields: Readonly<Record<string, string | number | boolean | null>> }>[];
  warnings: readonly Readonly<{ venue: string; reason: string }>[];
  matchedMarkets: readonly Readonly<{ venue: string; venueMarketId: string }>[];
  expiresAt: string;
  refreshAt: string;
  solveMs: number;
  verifyMs: number;
  error: string | null;
  quotedAt: string;
}>;

export type PredictionReviewCheck = Readonly<{ id: string; state: "pass" | "warn" | "fail"; detail: string; figure?: string | null }>;

/** The Review of a paper order: `canPlace` is false exactly when `blockedBy` names a refusing check. */
export type PredictionPaperReview = Readonly<{
  mode: "paper";
  quoteId: string;
  event: Readonly<{ id: string; title: string; endDate: string | null }>;
  market: Readonly<{
    id: string;
    question: string;
    venue: string;
    resolutionDate: string | null;
    rules: Readonly<{ primary: string | null; secondary: string | null }>;
  }>;
  outcome: Readonly<{ id: string; label: string }>;
  side: "buy" | "sell";
  requested: number;
  route: PredictionRoute;
  figures: Readonly<{
    probability: number | null;
    shares: number;
    costUsd: number;
    feesUsd: number;
    totalUsd: number;
    payoutIfRightUsd: number;
    profitIfRightUsd: number;
    maxLossUsd: number;
    returnIfRightPct: number | null;
  }>;
  quote: Readonly<{ quotedAt: string; expiresAt: string; ageSeconds: number; expired: boolean }>;
  venues: readonly string[];
  settlement: PredictionSettlement | null;
  balance: PredictionPaperBalance | null;
  checks: readonly PredictionReviewCheck[];
  warnings: readonly string[];
  plan: Readonly<{ id: string; version: number; checks: readonly PredictionReviewCheck[] }> | null;
  canPlace: boolean;
  blockedBy: readonly string[];
}>;

export type PredictionOrderRecord = Readonly<{
  version: number;
  wallet: string;
  quoteId: string;
  eventId: string;
  eventTitle: string;
  venueMarketId: string;
  question: string;
  outcomeId: string;
  outcomeLabel: string;
  side: "buy" | "sell";
  requested: number;
  review: PredictionPaperReview;
  planId: string | null;
  planVersion: number | null;
  state: PredictionOrderState;
  providerOrderIds: readonly string[];
  execution: PredictionPaperExecution | null;
  providerOrders: readonly PredictionPaperOrder[];
  submittedAt: string | null;
  settledAt: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type PredictionLinkStatus = Readonly<{
  state: PredictionLinkState;
  externalIdLinked: boolean;
  linkError: string | null;
  providerUserId: string | null;
  since: string | null;
  refreshedAt: string | null;
  available: boolean;
  unavailableReason: string | null;
}>;

export type PredictionLinkChallenge = Readonly<{ message: string; nonce: string; statement: string | null; wallet: string }>;

export type PredictionWatchEntry = Readonly<{
  eventId: string;
  watchedAt: string;
  venueMarketId: string | null;
  outcomeLabel: string | null;
  probabilityAtWatch: number | null;
}>;

export type PredictionsDiscoverQuery = Readonly<{ q?: string; category?: string; sort?: PredictionDiscoverSort; limit?: number; cursor?: string }>;

export type PredictionsLinkVerifyRequest = Readonly<{ message: string; signature: string; encoding?: "base64" | "base58" }>;

export type PredictionsQuoteRequest = Readonly<{
  eventId: string;
  venueMarketId: string;
  outcomeId: string;
  side: "buy" | "sell";
  spendUsd?: number;
  sellShares?: number;
  planId?: string | null;
  locale?: "en" | "uk";
}>;

export type PredictionsOrdersRequest = Readonly<{ quoteId: string }>;

export type PredictionsPlansRequest = Readonly<{ rules: PredictionPlanRules; activate?: boolean }>;

export type PredictionsPlanRequest = Readonly<{ version: number; rules: PredictionPlanRules; reason?: string | null }>;

export type PredictionsPlanStatusRequest = Readonly<{ version: number; status: "active" | "cancelled"; note?: string | null }>;

export type PredictionsWatchlistRequest = Readonly<{
  eventId: string;
  watched: boolean;
  venueMarketId?: string | null;
  outcomeLabel?: string | null;
  probabilityAtWatch?: number | null;
}>;

export type PredictionsDiscoverResponse = Readonly<{
  categories: readonly PredictionCategory[];
  categoriesUnavailable: boolean;
  query: Readonly<{ q: string | null; category: string | null; sort: PredictionDiscoverSort; limit: number }>;
  events: readonly PredictionEventSummary[];
  nextCursor: string | null;
  readAt: string;
  watched: readonly string[];
  wallet: string | null;
}>;

export type PredictionsEngineResponse = Readonly<{ engine: PredictionEngineState; readAt: string }>;

export type PredictionsEventsResponse = Readonly<{ events: readonly PredictionEventSummary[]; readAt: string }>;

export type PredictionsEventResponse = Readonly<{
  event: PredictionEvent;
  watch: PredictionWatchEntry | null;
  wallet: string | null;
  readAt: string;
}>;

export type PredictionsBookResponse = Readonly<{ book: PredictionBook }>;

export type PredictionsPricesResponse = Readonly<{ prices: readonly PredictionMarketPrices[]; readAt: string }>;

/** Each part is `{ ok: true, value }` or `{ ok: false, code }` — a state of that part, never a failed page. */
export type PredictionsResearchResponse = Readonly<{
  signals: Readonly<{ ok: true; value: PredictionSignals | null }> | Readonly<{ ok: false; code: PredictionFailureCode }>;
  expand: Readonly<{ ok: true; value: PredictionRipple }> | Readonly<{ ok: false; code: PredictionFailureCode }>;
  hedge: Readonly<{ ok: true; value: PredictionRipple }> | Readonly<{ ok: false; code: PredictionFailureCode }>;
  news: Readonly<{ ok: true; value: PredictionNews }> | Readonly<{ ok: false; code: PredictionFailureCode }>;
  related: Readonly<{ ok: true; value: readonly PredictionRelatedMarket[] }> | Readonly<{ ok: false; code: PredictionFailureCode }>;
  readAt: string;
}>;

export type PredictionsChartResponse = Readonly<{ chart: PredictionChart; readAt: string }>;

export type PredictionsLinkResponse = Readonly<{ wallet: string; link: PredictionLinkStatus }>;

export type PredictionsAccountResponse = Readonly<{
  wallet: string;
  link: PredictionLinkStatus;
  balance: PredictionPaperBalance | null;
  positions: readonly PredictionPaperPosition[];
  closedPositions: readonly PredictionPaperPosition[];
  providerOrders: readonly PredictionPaperOrder[];
  orders: readonly PredictionOrderRecord[];
  readAt: string;
  providerFailure: PredictionFailureValue | null;
  watchlist: readonly PredictionWatchEntry[];
  plans: readonly PredictionPlan[];
}>;

export type PredictionsQuoteResponse = Readonly<{
  wallet: string;
  review: PredictionPaperReview;
  link: PredictionLinkStatus;
  order: PredictionOrderRecord;
}>;

export type PredictionsOrdersResponse = Readonly<{ wallet: string; orders: readonly PredictionOrderRecord[] }>;

export type PredictionsOrderPlacedResponse = Readonly<{ wallet: string; order: PredictionOrderRecord }>;

export type PredictionsOrderResponse = Readonly<{
  wallet: string;
  order: PredictionOrderRecord;
  sync?: Readonly<{ code: PredictionFailureCode; message: string }>;
}>;

export type PredictionsPlansResponse = Readonly<{ wallet: string; plans: readonly PredictionPlan[] }>;

export type PredictionsPlanResponse = Readonly<{ wallet: string; plan: PredictionPlan }>;

export type PredictionsWatchlistResponse = Readonly<{ wallet: string; entries: readonly PredictionWatchEntry[] }>;

/* ============================================================ 1.12.0 — «Автоінвест» */

/**
 * 1.12.0: an autoinvest rule — «Регулярно» — is the proven wallet's company,
 * a sum in dollars, how often and when on the person's own clock. It only
 * schedules a reminder; every purchase is the wallet's own signature on a
 * fresh Review. `GET`/`POST /api/v1/rules`, `GET`/`DELETE /api/v1/rules/{id}`,
 * `POST /api/v1/rules/{id}/status`.
 */
export type RuleCadence = "daily" | "weekly" | "monthly";
/** `schedule` — «Регулярно»; 1.13.0: `dip` — «Якщо впаде»; 1.19.0: `payments` — «З кожної оплати». */
export type RuleKind = "schedule" | "dip" | "payments";
/** 1.19.0: `roundup` every payment rounded up to the next $1 or $5 · `fixed` a sum from every payment · `percent` a per cent of every USDC that comes in. */
export type RulePaymentMode = "roundup" | "fixed" | "percent";
/** 1.19.0: `out` a payment · `in` money that came in. */
export type RulePaymentDirection = "out" | "in";
export type RuleStatus = "active" | "paused";
/** `due` the reminder is open · `pending` a signed purchase not yet settled · `bought` settled · `missed` the day passed without a signature · `held` (1.13.0) the month's budget did not cover it, nothing was reminded · `deferred` (1.18.0) the price condition holds it back; the rule judges it again while it is open. */
export type RuleOccurrenceState = "due" | "pending" | "bought" | "missed" | "held" | "deferred";

/** 1.18.0: «Умова ціни» — the most, in whole per cent (1–50), the price may stand above its reference for the rule to offer its purchase. */
export type RulePriceCondition = Readonly<{ limitPct: number }>;
/** 1.18.0: `met` · `above` the price is over the limit · `stale` the data are older than the freshness bound · `unavailable` a figure is missing. */
export type RuleConditionVerdict = "met" | "above" | "stale" | "unavailable";
/** 1.18.0: PreStocks' valuation of one token · the issuer's reference per share · the market feed's. */
export type RulePriceReference = "prestocks" | "issuer" | "market";
/** 1.18.0: one judgement of a rule's price condition — the figures on one basis, the deviation to a tenth of a per cent, the data's time (the older of the two). */
export type RuleConditionCheck = Readonly<{
  verdict: RuleConditionVerdict;
  reference: RulePriceReference | null;
  limitPct: number;
  priceUsd: number | null;
  referenceUsd: number | null;
  deviationPct: number | null;
  dataAt: string | null;
  checkedAt: string;
}>;

/** What an order names to buy under a rule's reminder: sent as `origin.rule` on `POST /api/solana/swap/order`. */
export type RuleBinding = Readonly<{ ruleId: string; dueAt: string }>;

/** `weekday` 1 Monday … 7 Sunday on a weekly rule; `monthDay` 1–31 on a monthly one (a shorter month falls on its last day); `time` «HH:MM» on the wall clock of `timeZone`. */
export type RuleSchedule = Readonly<{ cadence: RuleCadence; weekday: number | null; monthDay: number | null; time: string; timeZone: string }>;

/** 1.13.0: the price that opened a «Якщо впаде» reminder and the reference point it fell from, per unit as the wallet shows it. */
export type RuleTrigger = Readonly<{ priceUsd: number; anchorUsd: number }>;

export type RuleOccurrence = Readonly<{
  dueAt: string;
  openUntil: string;
  state: RuleOccurrenceState;
  remindedAt: string | null;
  signature: string | null;
  spentUsd: number | null;
  boughtAt: string | null;
  /** 1.13.0: on a «Якщо впаде» occurrence; null on a «Регулярно» one. */
  trigger: RuleTrigger | null;
  /** 1.18.0: the price condition's judgement that opened or deferred it; null where the rule has no condition. */
  condition: RuleConditionCheck | null;
  /** 1.19.0: the occurrence's own purchase sum — what a «З кожної оплати» rule gathered; null on the other kinds (the rule's `amountUsd`). */
  amountUsd: number | null;
  /** 1.19.0: how many payments or incoming transfers gathered it; null on the other kinds. */
  events: number | null;
}>;

/** 1.19.0: how a «З кожної оплати» rule is asked for — the mode and its one figure (the others null), and the person's time zone. */
export type RulePaymentsRequest = Readonly<{ mode: RulePaymentMode; roundToUsd: number | null; fixedUsd: number | null; percent: number | null; timeZone: string }>;

/** 1.19.0: one counted event — the wallet's USDC it moved, the rule's share in cents, the block's time, the Solana Pay label, the reminder that took it (null while it waits). Never the other side's name. */
export type RulePaymentEvent = Readonly<{ signature: string; direction: RulePaymentDirection; amountUsd: number; addUsd: number; at: string; label: string | null; dueAt: string | null }>;

/** 1.19.0: a «З кожної оплати» rule as it stands — the terms, the instant it counts from, what waits, the newest events and the last read of the wallet. */
export type RulePayments = Readonly<{
  mode: RulePaymentMode;
  roundToUsd: number | null;
  fixedUsd: number | null;
  percent: number | null;
  timeZone: string;
  since: string;
  gatheredUsd: number;
  gatheredCount: number;
  events: readonly RulePaymentEvent[];
  read: Readonly<{ at: string; state: "ok" | "partial" | "unavailable" }> | null;
}>;

/**
 * 1.13.0: a «Якщо впаде» rule — the fall in whole per cent, the reference
 * point (the price when turned on, or what the last purchase under it paid)
 * and the trigger (the point less the fall); `armed` false from a crossing's
 * reminder until the price is read back above the trigger; `heldAt` when the
 * month's budget held the crossing that stands now.
 */
export type RuleDip = Readonly<{
  dropPct: number;
  timeZone: string;
  anchorUsd: number;
  anchorAt: string;
  anchorFrom: "enabled" | "purchase";
  triggerUsd: number;
  armed: boolean;
  heldAt: string | null;
}>;

export type AutoinvestRule = Readonly<{
  id: string;
  owner: string;
  network: typeof NETWORK;
  kind: RuleKind;
  asset: PlanAsset;
  /** The company as a person names it («Apple»). */
  name: string;
  /** The sum every purchase is; 1.19.0: on a «З кожної оплати» rule, the least sum a reminder opens at. */
  amountUsd: number;
  /** Null on a «Якщо впаде» rule (1.13.0) and a «З кожної оплати» one (1.19.0). */
  schedule: RuleSchedule | null;
  /** 1.13.0: null on the other kinds. */
  dip: RuleDip | null;
  /** 1.19.0: a «З кожної оплати» rule's terms and what waits; null on the other kinds. */
  payments: RulePayments | null;
  /** 1.18.0: «Умова ціни»; null — no condition. */
  priceCondition: RulePriceCondition | null;
  status: RuleStatus;
  /** Null on a paused rule and on a «Якщо впаде» rule. */
  nextDueAt: string | null;
  /** Newest first. */
  occurrences: readonly RuleOccurrence[];
  createdAt: string;
  updatedAt: string;
}>;

/** 1.13.0: how a «Якщо впаде» rule is asked for. */
export type RuleDipRequest = Readonly<{ dropPct: number; timeZone: string }>;
/** `kind` absent is «Регулярно» with `schedule`; 1.13.0 `kind: "dip"` names `dip`; 1.18.0 `priceCondition` absent or null — none. */
export type RuleCreateRequest = Readonly<{ asset: Readonly<{ mint: string }>; amountUsd: number; kind?: RuleKind; schedule?: RuleSchedule; dip?: RuleDipRequest; payments?: RulePaymentsRequest; priceCondition?: RulePriceCondition | null; locale?: "en" | "uk" }>;
/** 1.19.0: `POST /api/v1/rules/payments/own` — the other side of one counted event is the person's own account. */
export type RulePaymentOwnRequest = Readonly<{ signature: string }>;
export type RuleStatusRequest = Readonly<{ status: RuleStatus }>;
export type RuleResponse = Readonly<{ rule: AutoinvestRule }>;

/**
 * 1.13.0: «Бюджет місяця» — the wallet's own ceiling for every rule in a
 * calendar month on `timeZone`'s clock: settled purchases (`spentUsd`) and
 * signed ones not settled yet (`unknownUsd`, counted as spent); `exhausted`
 * when no active rule's purchase fits what is left — the rules stand until
 * `monthEndsAt`. `capUsd` null: no ceiling.
 */
export type RuleBudget = Readonly<{
  capUsd: number | null;
  timeZone: string;
  monthStartsAt: string;
  monthEndsAt: string;
  spentUsd: number;
  unknownUsd: number;
  remainingUsd: number | null;
  exhausted: boolean;
  updatedAt: string | null;
}>;
/** 1.13.0: `PUT /api/v1/rules/budget`. */
export type RuleBudgetRequest = Readonly<{ capUsd: number; timeZone: string; locale?: "en" | "uk" }>;
/** 1.13.0: `GET`, `PUT` and `DELETE /api/v1/rules/budget`. */
export type RuleBudgetResponse = Readonly<{ budget: RuleBudget }>;
/** 1.13.0: with the month's budget. */
export type RuleListResponse = Readonly<{ address: string; rules: readonly AutoinvestRule[]; total: number; budget: RuleBudget }>;
export type RuleDeleteResponse = Readonly<{ deleted: true; id: string }>;

/* ------------------------------------------------------------ «Гроші» for the phone (1.22.0) */

/** How long a payment link stays open; the server clamps to these. */
export const PAY_LINK_EXPIRATIONS = ["1h", "24h", "7d", "30d"] as const;
export type PayLinkExpiration = (typeof PAY_LINK_EXPIRATIONS)[number];

export const PAY_LINK_STATUSES = ["AWAITING", "PAID", "EXPIRED", "CHECKING", "UNKNOWN"] as const;
export type PayLinkStatus = (typeof PAY_LINK_STATUSES)[number];

/** What a link's page says aloud: less, another token, or more came. */
export const PAY_LINK_NOTES = ["UNDERPAID", "WRONG_TOKEN", "OVERPAID"] as const;
export type PayLinkNote = (typeof PAY_LINK_NOTES)[number];

export const RECIPIENT_INPUTS = ["address", "solana-pay", "pay-link"] as const;
export type RecipientInput = (typeof RECIPIENT_INPUTS)[number];

export const RECIPIENT_NEXT = ["transfer", "pay-link", "none"] as const;
export type RecipientNext = (typeof RECIPIENT_NEXT)[number];

export const RECIPIENT_PROBLEMS = ["EMPTY", "NOT_AN_ADDRESS", "MISREAD_CHARACTER", "WRONG_LENGTH", "REQUEST_INVALID", "REQUEST_UNSUPPORTED", "REFERENCE_UNSUPPORTED", "LINK_INVALID", "LINK_NOT_FOUND", "LINK_PAID", "LINK_EXPIRED", "LINK_MISMATCH", "LINK_UNCONFIRMED", "SELF", "MINT_UNREADABLE", "UNSAFE_SOL_RECIPIENT", "RECIPIENT_MINT_MISMATCH", "RECIPIENT_PROGRAM_MISMATCH", "RECIPIENT_ACCOUNT_MALFORMED", "OFF_CURVE_OWNER_UNSUPPORTED", "RECIPIENT_FROZEN", "RECIPIENT_UNREADABLE"] as const;
export type RecipientProblem = (typeof RECIPIENT_PROBLEMS)[number];

export const SEND_RETURNED_VERDICTS = ["BYTES_MATCH", "BYTES_FEE_ADDED", "BYTES_CHANGED", "NOT_SIGNED", "UNREADABLE"] as const;
export type SendReturnedVerdict = (typeof SEND_RETURNED_VERDICTS)[number];

/** 1.22.0 — «Перевірка» of a transfer as the server counts it, on the plan and adopt answers: the card's lines in exact decimals, whether the wallet may be opened, why not, and the warnings in the card's words (English and Ukrainian). `minimum`: SOL to an address with no account — the least it must carry, never a cost; `setup`: a token account opened for the recipient, paid by the sender. */
export type TransferCheck = Readonly<{
  asset: Readonly<{ mint: string | null; decimals: number }>;
  from: string;
  to: Readonly<{
    address: string;
    kind: "wallet" | "token-account";
    owner: string;
    account: string;
    opensAccount: boolean;
  }>;
  send: Readonly<{ raw: string; amount: string }>;
  issuerFee: Readonly<{ raw: string; amount: string; basisPoints: number }> | null;
  receive: Readonly<{ raw: string; amount: string; less: boolean }>;
  networkFee: Readonly<{ lamports: string; sol: string }>;
  setup: Readonly<{ lamports: string; sol: string }> | Readonly<{ lamports: null; sol: null }> | null;
  minimum: Readonly<{ lamports: string; sol: string }> | Readonly<{ lamports: null; sol: null }> | null;
  signable: boolean;
  blocked: Readonly<{ en: string; uk: string; code: string }> | null;
  warnings: readonly Readonly<{ en: string; uk: string; code: string; stops: boolean }>[];
}>;

/** 1.22.0 — a payment link: its page (`url`), the Solana Pay request a wallet scans (`payUrl`), its state, and what arrived when paid. */
export type PayLink = Readonly<{
  id: string;
  url: string;
  payUrl: string;
  status: PayLinkStatus;
  note: PayLinkNote | null;
  token: Readonly<{ symbol: string; mint: string | null; decimals: number }>;
  amount: Readonly<{ raw: string; display: string }> | null;
  description: string | null;
  recipient: Readonly<{ abbreviated: string; address: string }>;
  reference: string;
  createdAt: string;
  expiresAt: string;
  paid: Readonly<{ signature: string; creditedRaw: string; credited: string; paidAt: string | null }> | null;
}>;

/** `POST /api/v1/pay/requests` — `mint` null or absent for SOL, `amount` in the token's units or absent to let the payer choose, 7 days by default. */
export type PayLinkCreateRequest = Readonly<{
  mint?: string | null;
  amount?: string | null;
  description?: string | null;
  expiration?: PayLinkExpiration;
}>;

export type PayLinkResponse = Readonly<{ link: PayLink }>;

export type PayLinkListResponse = Readonly<{ address: string; links: readonly PayLink[] }>;

/** `GET /api/v1/money/recipient` — what was entered, the asset (absent for SOL) and the sending wallet. */
export type RecipientCheckQuery = Readonly<{ to: string; mint?: string; from?: string }>;

/** 1.22.0 — the recipient check: `next` is the one decision — `transfer`, `pay-link` or `none` with `problem`. */
export type RecipientCheckResponse = Readonly<{
  input: RecipientInput;
  next: RecipientNext;
  problem: RecipientProblem | null;
  address: string | null;
  asset: Readonly<{ mint: string | null }>;
  destination: Readonly<{ kind: "wallet" | "token-account"; owner: string; account: string; opensAccount: boolean }> | null;
  asked: Readonly<{ amount: string | null; mint: string | null; label: string | null; message: string | null }> | null;
  link: PayLink | null;
  checkedAt: string;
}>;

/** `POST /api/v1/money/send/returned` — the Review's `plan` as served (only four fields are read) and the bytes the wallet signed. */
export type SendReturnedRequest = Readonly<{
  plan: Readonly<{
    actionKind: "NATIVE_SOL" | "SPL_TRANSFER_CHECKED" | "TOKEN_2022" | "TOKEN_ATA_CREATE";
    unsignedWireBase64: string;
    fingerprint: Readonly<{ messageHash: string; feePayer: string }>;
  }>;
  signedWireBase64: string;
}>;

/** `settle`, `adopt` (then settle the adopted Review) or `stop`; `signature` whenever the wallet signed — keep it before settling. */
export type SendReturnedResponse = Readonly<{
  verdict: SendReturnedVerdict;
  next: "settle" | "adopt" | "stop";
  signature: string | null;
  detail: string;
}>;

/* ---- the consumed routes: Send on the transfer routes (1.22.0) — the web's own; echo the Review's parts, count none of them */

export const TRANSFER_ACTION_KINDS = ["NATIVE_SOL", "SPL_TRANSFER_CHECKED", "TOKEN_2022", "TOKEN_ATA_CREATE"] as const;
export type TransferActionKind = (typeof TRANSFER_ACTION_KINDS)[number];

export const TRANSFER_SUPPORT_DECISIONS = ["SUPPORTED", "REVIEW_REQUIRED", "BLOCKED", "UNKNOWN"] as const;
export type TransferSupportDecision = (typeof TRANSFER_SUPPORT_DECISIONS)[number];

export const TRANSFER_SAFETY_DECISIONS = ["ALLOW", "REVIEW", "BLOCK", "PAUSE", "UNKNOWN"] as const;
export type TransferSafetyDecision = (typeof TRANSFER_SAFETY_DECISIONS)[number];

export const TRANSFER_CANARY_FAMILIES = ["SEND", "ATA_CREATE", "SWAP", "CCTP", "TOKEN_2022"] as const;
export type TransferCanaryFamily = (typeof TRANSFER_CANARY_FAMILIES)[number];

export const TRANSFER_CANARY_DECISIONS = ["ALLOW", "REVIEW", "BLOCK", "PAUSE", "UNKNOWN"] as const;
export type TransferCanaryDecision = (typeof TRANSFER_CANARY_DECISIONS)[number];

export const TRANSFER_CANARY_RULES = ["CONFIG_VALID", "EMERGENCY_STOP", "MAINNET_ONLY", "DESTINATION_ALLOWLISTED", "MINTS_ALLOWLISTED", "PROGRAMS_ALLOWLISTED", "VALUATION_CURRENT", "FAMILY_LIMIT", "TOTAL_LIMIT", "HUMAN_APPROVAL"] as const;
export type TransferCanaryRule = (typeof TRANSFER_CANARY_RULES)[number];

export const TRANSFER_SETTLE_STATES = ["RECEIPTED", "RECOVERY", "SUBMITTED", "EXPIRED", "UNKNOWN"] as const;
export type TransferSettleState = (typeof TRANSFER_SETTLE_STATES)[number];

export const TRANSFER_PLAN_ERROR_CODES = ["RATE_LIMITED", "JSON_REQUIRED", "INVALID_CONTENT_LENGTH", "BODY_TOO_LARGE", "BODY_REQUIRED", "INVALID_BODY_STREAM", "INVALID_JSON", "VALIDATION_ERROR", "ACCOUNT_NOT_FOUND", "NOT_A_MINT", "DECODE_FAILED", "RPC_FAILED", "EPOCH_UNAVAILABLE", "INPUT_MINT_MISMATCH", "SENDER_ACCOUNT_MISSING", "INSUFFICIENT_BALANCE", "INSUFFICIENT_FEE_BALANCE", "BLOCKHASH_UNAVAILABLE", "FEE_UNAVAILABLE", "ZERO_AMOUNT", "SENDER_RECIPIENT_SAME", "RECIPIENT_UNSUPPORTED", "SOURCE_TOTAL_MISMATCH", "TRANSACTION_TOO_LARGE", "HOOK_ACCOUNTS_UNAVAILABLE", "ACCOUNT_STATE_UNREADABLE", "BUILD_FAILED", "MINT_NOT_INITIALIZED", "CANARY_EVIDENCE_UNAVAILABLE"] as const;
export type TransferPlanErrorCode = (typeof TRANSFER_PLAN_ERROR_CODES)[number];

export const TRANSFER_ADOPT_ERROR_CODES = ["RATE_LIMITED", "JSON_REQUIRED", "INVALID_CONTENT_LENGTH", "BODY_TOO_LARGE", "BODY_REQUIRED", "INVALID_BODY_STREAM", "INVALID_JSON", "VALIDATION_ERROR", "SEND_NOT_PERMITTED", "REVIEW_PROOF_UNAVAILABLE", "REVIEW_PROOF_INVALID", "ORIGINAL_REVIEW_DISAGREES", "ORIGINAL_REVIEW_NOT_READY", "WALLET_MODIFICATION_REJECTED", "WALLET_SIGNATURE_REJECTED", "REVIEW_PROVIDER_CHANGED", "WALLET_TRANSACTION_UNREADABLE", "WALLET_TRANSACTION_EXPIRED", "WALLET_PRIORITY_FEE_INVALID", "WALLET_PRIORITY_FEE_TOO_HIGH", "WALLET_FEE_MISMATCH", "WALLET_SIMULATION_UNAVAILABLE", "WALLET_SIMULATION_FAILED", "WALLET_ADOPTION_OUT_OF_SCOPE"] as const;
export type TransferAdoptErrorCode = (typeof TRANSFER_ADOPT_ERROR_CODES)[number];

export const TRANSFER_SETTLE_ERROR_CODES = ["RATE_LIMITED", "OWNER_CANARY_UNAVAILABLE", "JSON_REQUIRED", "INVALID_CONTENT_LENGTH", "BODY_TOO_LARGE", "BODY_REQUIRED", "INVALID_BODY_STREAM", "INVALID_JSON", "VALIDATION_ERROR", "SEND_NOT_PERMITTED", "REVIEW_PROOF_UNAVAILABLE", "SETTLEMENT_STORE_UNAVAILABLE", "REVIEW_PROVIDER_CHANGED", "INDEPENDENT_READBACK_UNAVAILABLE", "PLAN_INVALID", "PLAN_PREFLIGHT_DISAGREE", "REVIEW_PROOF_INVALID", "NOT_READY", "SIGNED_BYTES_REJECTED", "SEND_ATTEMPT_CONFLICT", "SEND_ATTEMPT_UNAVAILABLE", "SEND_SETTLEMENT_FAILED", "SUBMISSION_UNKNOWN", "REQUEST_DEADLINE", "CURRENT_HEIGHT_UNKNOWN", "PLAN_EXPIRED", "NOT_CLEARED", "REJECTED", "DUPLICATE", "NO_EXPECTATIONS", "MINT_FAILED"] as const;
export type TransferSettleErrorCode = (typeof TRANSFER_SETTLE_ERROR_CODES)[number];

export const TRANSFER_RECOVER_ERROR_CODES = ["RATE_LIMITED", "FORBIDDEN_ORIGIN", "UNAUTHORIZED", "SESSION_EXPIRED", "SESSION_REVOKED", "UNAVAILABLE", "JSON_REQUIRED", "INVALID_CONTENT_LENGTH", "BODY_TOO_LARGE", "BODY_REQUIRED", "INVALID_BODY_STREAM", "INVALID_JSON", "VALIDATION_ERROR", "STORE_NOT_DURABLE", "SEND_ATTEMPT_UNAVAILABLE"] as const;
export type TransferRecoverErrorCode = (typeof TRANSFER_RECOVER_ERROR_CODES)[number];

export type TransferSplInput = Readonly<{
  schemaVersion: "1.0.0";
  actionRef: "action:solana-token-2022/spl-transfer@1";
  network: "mainnet" | "devnet";
  mint: string;
  sender: string;
  recipient: string;
  amountRaw: string;
}>;

export type TransferNativeSolInput = Readonly<{
  schemaVersion: "1.0.0";
  actionRef: "action:solana-token-2022/native-sol-transfer@1";
  network: "mainnet" | "devnet";
  sender: string;
  recipient: string;
  amountRaw: string;
}>;

export type TransferInput = TransferSplInput | TransferNativeSolInput;

/** `POST /api/solana/transfer/plan` — the proposal and nothing else; the policy is the server's. */
export type TransferPlanRequest = Readonly<{ input: TransferInput }>;

export type TransferSupport = Readonly<{
  decision: TransferSupportDecision;
  findings: readonly Readonly<{ code: string; outcome: "PASS" | "REVIEW" | "BLOCK" | "UNKNOWN"; detail: string }>[];
}>;

/** The exact transfer the wallet signs (`unsignedWireBase64`), with everything the Review states about it; echoed unchanged into adopt and settle. */
export type TransferPlan = Readonly<{
  actionKind: TransferActionKind;
  network: "mainnet" | "devnet";
  mint: string;
  tokenProgram: string;
  decimals: number;
  sender: string;
  recipient: string;
  senderTokenAccount: string;
  recipientTokenAccount: string;
  sources: readonly Readonly<{ account: string; amountRaw: string; feeRaw: string }>[];
  recipientKind: "WALLET_OWNER" | "EXISTING_TOKEN_ACCOUNT";
  recipientOwner: string;
  memo: string | null;
  transferHook: Readonly<{ program: string; extraAccounts: readonly string[] }> | null;
  support: TransferSupport;
  createsRecipientAccount: boolean;
  ataRentLamports: string | null;
  amountRaw: string;
  senderBalanceRaw: string;
  baseFeeLamports: string;
  priorityFeeLamports: string;
  walletAugmentation?: Readonly<{
    computeUnitLimit: number;
    microLamportsPerUnit: string;
    maximumPriorityFeeLamports: string;
    lighthouseAssertions: readonly Readonly<{ kind: "ASSERT_ACCOUNT_INFO_MULTI" | "ASSERT_TOKEN_ACCOUNT_MULTI"; account: string }>[];
  }>;
  programs: readonly string[];
  blockhash: string;
  lastValidBlockHeight: string;
  unsignedWireBase64: string;
  fingerprint: Readonly<{
    messageHash: string;
    feePayer: string;
    blockhash: string;
    instructionCount: number;
    transfer: Readonly<{
      programAddress: string;
      source: string;
      mint: string;
      destination: string;
      authority: string;
      amountRaw: string;
      decimals: number;
    }>;
    transfers: readonly Readonly<{
      programAddress: string;
      source: string;
      mint: string;
      destination: string;
      authority: string;
      amountRaw: string;
      decimals: number;
    }>[];
  }>;
  builtAt: string;
}>;

export type TransferPreflight = Readonly<{
  schema: "ryntra.solana.spl-transfer-preflight";
  schemaVersion: "0.1.0";
  network: "mainnet" | "devnet";
  mint: string;
  sender: string;
  recipient: string;
  amountRequestedRaw: string;
  transferFee: Readonly<{
    feeRaw: string;
    basisPoints: number;
    maximumFeeRaw: string;
    capApplied: boolean;
    configUsed: "NEWER" | "OLDER" | "NONE";
    epochBasis: string | null;
  }>;
  estimatedReceivedRaw: string;
  expectedBalanceDeltas: readonly Readonly<{ account: string; mint: string; rawDelta: string }>[];
  feeWithheldRaw: string;
  hookProgramId: string | null;
  structuralBlockers: readonly ("NON_TRANSFERABLE" | "PAUSED" | "DEFAULT_ACCOUNT_STATE_FROZEN")[];
  unsupportedKinds: readonly string[];
  networkFeeLamports: string | null;
  computeBudget: string | null;
  unfilledReason: string;
  simulation: Readonly<{ status: "SKIPPED"; reason: string }> | Readonly<{ status: "PRESENT"; succeeded: boolean; error: string | null; unitsConsumed: string | null }>;
  observedAt: string;
}>;

export type TransferPolicyVerdict = Readonly<{
  schema: "ryntra.solana.policy-verdict";
  schemaVersion: "0.1.0";
  verdict: "NO_KNOWN_BLOCKER" | "REVIEW_REQUIRED" | "BLOCKED" | "INCOMPLETE";
  findings: readonly Readonly<{
    rule: "NETWORK_ALLOWED" | "MINT_ALLOWED" | "TOKEN_PROGRAM_ALLOWED" | "NOT_STRUCTURALLY_DOOMED" | "PERMANENT_DELEGATE_ACCEPTED" | "TRANSFER_HOOK_ALLOWLISTED" | "FEE_WITHIN_CAP" | "RECIPIENT_ALLOWED" | "AMOUNT_WITHIN_LIMIT" | "DEFAULT_FROZEN_ACCEPTED" | "EVIDENCE_FRESH" | "EXTENSIONS_UNDERSTOOD" | "HUMAN_APPROVAL";
    outcome: "ALLOWED" | "REVIEW_REQUIRED" | "BLOCKED" | "INCOMPLETE";
    detail: string;
  }>[];
  evaluatedAt: string;
}>;

export type TransferProvider = Readonly<{ role: "primary" | "fallback"; host: string }>;

export type TransferCanaryIntent = Readonly<{
  schema: "ryntra.solana.canary-intent";
  schemaVersion: "1.0.0";
  intentId: string;
  revision: number;
  family: TransferCanaryFamily;
  network: "mainnet";
  destination: string;
  mints: readonly string[];
  programs: readonly string[];
  principalUsdMicros: string | null;
  feeReserveUsdMicros: string | null;
  usdMicros: string | null;
  valuation: Readonly<{
    method: "USDC_NOMINAL" | "PROVIDER_QUOTE" | "CHAIN_READ";
    sourceRef: string;
    observedAt: string;
    validUntil: string;
  }> | null;
  humanApproval: "NOT_RECORDED" | "RECORDED";
}>;

export type TransferCanaryVerdict = Readonly<{
  schema: "ryntra.solana.canary-verdict";
  schemaVersion: "1.0.0";
  decision: TransferCanaryDecision;
  newRiskAllowed: boolean;
  scope: Readonly<{
    status: "INSIDE_ENVELOPE" | "OUTSIDE_ENVELOPE";
    decidedBy: "OWNER_CANARY" | "TRANSFER_CAPABILITY";
    detail: string;
  }>;
  policyId: string;
  policyDigest: string;
  intentDigest: string;
  budgetObservedAt: string;
  findings: readonly Readonly<{
    rule: TransferCanaryRule;
    outcome: "PASS" | "REVIEW" | "BLOCK" | "PAUSE" | "UNKNOWN";
    detail: string;
  }>[];
  evaluatedAt: string;
}>;

export type TransferSignedReviewProof = Readonly<{
  schema: "ryntra.solana.send-review-proof";
  schemaVersion: "2.0.0";
  status: "SIGNED";
  algorithm: "Ed25519";
  digest: string;
  keyId: string;
  publicKey: string;
  signature: string;
  issuedAt: string;
}>;

export type TransferReviewProof = TransferSignedReviewProof | Readonly<{
  schema: "ryntra.solana.send-review-proof";
  schemaVersion: "2.0.0";
  status: "UNSIGNED";
  digest: string;
  reasonCode: "NO_ISSUER_KEY_CONFIGURED";
  issuedAt: string;
}>;

export type TransferSafety = Readonly<{
  decision: TransferCanaryDecision;
  findings: readonly Readonly<{ code: string; outcome: "PASS" | "REVIEW" | "BLOCK" | "PAUSE" | "UNKNOWN"; detail: string }>[];
}>;

/** The Review: the bundle to echo, and `check` — «Перевірка» counted by the server (1.22.0). */
export type TransferReview = Readonly<{
  passport: SwapPassport | null;
  preflight: TransferPreflight;
  verdict: TransferPolicyVerdict;
  plan: TransferPlan;
  provider: TransferProvider;
  canaryIntent: TransferCanaryIntent;
  canaryVerdict: TransferCanaryVerdict;
  support: TransferSupport;
  safety: TransferSafety;
  check: TransferCheck;
  reviewProof: TransferReviewProof;
}>;

export type TransferReviewResponse = Readonly<{ data: TransferReview }>;

export type TransferAdoptedReview = Readonly<{
  passport: null;
  preflight: TransferPreflight;
  verdict: TransferPolicyVerdict;
  plan: TransferPlan;
  provider: TransferProvider;
  canaryIntent: TransferCanaryIntent;
  canaryVerdict: TransferCanaryVerdict;
  support: TransferSupport;
  safety: TransferSafety;
  check: TransferCheck;
  reviewProof: TransferSignedReviewProof;
}>;

export type TransferAdoptResponse = Readonly<{ data: TransferAdoptedReview }>;

/** `POST /api/solana/transfer/settle` and `…/adopt` — the Review's parts exactly as served, and the bytes the wallet signed. */
export type TransferSettleRequest = Readonly<{
  plan: TransferPlan;
  preflight: TransferPreflight;
  verdict: TransferPolicyVerdict;
  provider: TransferProvider;
  canaryIntent: TransferCanaryIntent;
  canaryVerdict: TransferCanaryVerdict;
  reviewProof: TransferReviewProof;
  signedWireBase64: string;
}>;

export type TransferSignatureStatus = Readonly<{
  confirmationStatus: "processed" | "confirmed" | "finalized" | null;
  err: string | null;
  seen: boolean;
  slot: string | null;
}>;

export type TransferStatusRead = Readonly<{ state: "READ"; status: TransferSignatureStatus }> | Readonly<{ state: "UNKNOWN"; status: TransferSignatureStatus; reason: string }>;

export type TransferObservation = Readonly<{
  schemaVersion: "1.0.0";
  actionRef: "action:solana-token-2022/spl-transfer@1" | "action:solana-token-2022/native-sol-transfer@1";
  network: "mainnet" | "devnet";
  signature: string;
  slot: string;
  blockTime: string | null;
  feeLamports: string;
  balanceDeltas: readonly Readonly<{ account: string; mint: string; rawDelta: string }>[];
  lamportBalanceDeltas: readonly Readonly<{ account: string; rawDelta: string }>[];
  sources: readonly Readonly<{ ref: string; label: string }>[];
  observedAt: string;
}>;

export type TransferReconciliation = Readonly<{
  status: "MATCHED" | "DEVIATION_RECORDED" | "FAILED";
  findings: readonly Readonly<{ expectation: string; status: "MATCHED" | "NOT_OBSERVED"; matchedBy: string | null }>[];
  unexpected: readonly string[];
  matched: number;
  expected: number;
}>;

export type TransferReceiptFacts = Readonly<{
  schema: "ryntra.solana.send-receipt";
  schemaVersion: "1.2.0";
  reviewDigest: string;
  augmentation: Readonly<{
    status: "NONE";
    summary: "The signed message matched the reviewed plan without wallet augmentation.";
  }> | Readonly<{ status: "PRESENT"; summary: string; actualPriorityFeeLamports: string }>;
  actionKind: TransferActionKind;
  network: "mainnet" | "devnet";
  mint: string;
  sender: string;
  recipient: string;
  expectedDebitRaw: string;
  expectedCreditRaw: string;
  actualDebitRaw: string | null;
  actualCreditRaw: string | null;
  transferFeeRaw: string;
  baseFeeLamports: string | null;
  priorityFeeLamports: string | null;
  ataRentLamports: string | null;
  plannedAta: Readonly<{ createsRecipientAccount: boolean; rentLamports: string | null }>;
  observedAta: Readonly<{
    created: boolean;
    rentLamports: string | null;
    owner: string | null;
    tokenProgram: string | null;
    rentPayer: string | null;
  }>;
  observedPrograms: readonly string[];
  plannedBaseFeeLamports: string;
  actualBaseFeeLamports: string;
  plannedPriorityFeeLamports: string;
  actualPriorityFeeLamports: string;
  programs: readonly string[];
  signature: string;
  slot: string;
  finality: "processed" | "confirmed" | "finalized" | "unknown";
  reconciliation: "MATCHED" | "DEVIATION_RECORDED" | "FAILED";
}>;

export type TransferVerification = Readonly<{
  recognised: boolean;
  generation: "v2" | "legacy-1.0.0" | null;
  kind: "AGENT_PASSPORT" | "ACTION_PASSPORT" | "OUTCOME_RECEIPT" | "ACTION_PASSPORT_PREVIEW" | null;
  schemaVersion: string | null;
  integrity: Readonly<{ valid: boolean; issues: readonly string[] }>;
  issuer: Readonly<{
    verdict: "SIGNATURE_VALID" | "SIGNATURE_INVALID" | "UNSIGNED" | "UNTRUSTED_KEY";
    keyId: string | null;
    detail: string;
  }>;
  authorization: Readonly<{
    verdict: "AUTHORIZED" | "NOT_AUTHORIZED" | "DEMO_ACKNOWLEDGEMENT_ONLY" | "NOT_APPLICABLE";
    detail: string;
  }>;
  observation: Readonly<{ verdict: "OBSERVED" | "NOT_OBSERVED" | "NOT_APPLICABLE"; detail: string }>;
}>;

export type TransferSettled = Readonly<{
  ok: true;
  state: "RECEIPTED";
  landingState: "CONFIRMED" | "FINALIZED" | "LANDED_FAILED";
  signature: string;
  confirmation: Readonly<{ slot: string; status: "confirmed" | "finalized"; err: string | null }>;
  observation: TransferObservation;
  observedEffects: readonly Readonly<{ description: string; sourceRef: string; observedAt: string }>[];
  reconciliation: TransferReconciliation;
  receipt: SwapReceipt;
  sendReceiptFacts: TransferReceiptFacts;
  verification: TransferVerification;
}>;

export type TransferSettlePending = Readonly<{ ok: true; state: "UNKNOWN"; signature: string; receipt: null }>;

export type TransferSettleRecovery = Readonly<{
  ok: true;
  state: "SUBMITTED" | "EXPIRED" | "UNKNOWN";
  signature: string;
  receipt: null;
  recovery: Readonly<{
    signature: string;
    status: TransferSignatureStatus;
    statusRead: TransferStatusRead;
    blockHeight: string | null;
    lastValidBlockHeight: string;
  }>;
  effectReadback: Readonly<{
    state: "READ";
    value: Readonly<{
      ok: true;
      observation: TransferObservation;
      transactionSucceeded: boolean;
      transactionError: string | null;
      invokedPrograms: readonly string[];
      postTokenAccounts: readonly Readonly<{
        account: string;
        mint: string;
        owner: string | null;
        tokenProgram: string | null;
        amountRaw: string;
        decimals: number;
      }>[];
      observedEffects: readonly Readonly<{ description: string; sourceRef: string; observedAt: string }>[];
    }> | Readonly<{ ok: false; code: "NOT_FOUND" | "UNREADABLE" | "RPC_FAILED"; reason: string }>;
  }> | Readonly<{ state: "UNKNOWN"; reason: string }>;
}>;

export type TransferSettleUnobserved = Readonly<{
  ok: true;
  state: "RECOVERY";
  landingState: "CONFIRMED" | "FINALIZED" | "LANDED_FAILED";
  signature: string;
  confirmation: Readonly<{ slot: string; status: "confirmed" | "finalized"; err: string | null }>;
  receipt: null;
}>;

export type TransferSettleResult = TransferSettled | TransferSettlePending | TransferSettleRecovery | TransferSettleUnobserved;

/** 200 with the receipt, or 202 while the outcome is open — never send again; recover by the signature. */
export type TransferSettleResponse = Readonly<{ data: TransferSettleResult }>;

export type TransferRecoverRequest = Readonly<{ network: "mainnet" | "devnet"; signature: string }>;

export type TransferRecovery = Readonly<{
  network: "mainnet" | "devnet";
  signature: string;
  attempt: Readonly<{
    state: "RESERVED" | "SUBMITTED_UNKNOWN" | "CONFIRMED" | "FINALIZED" | "LANDED_FAILED" | "EXPIRED_BEFORE_SUBMIT" | "EXPIRED_AFTER_SUBMIT" | "RECOVERY_REQUIRED" | "RECEIPTED";
    reservedAt: string;
    updatedAt: string;
    receiptHash: string | null;
  }> | null;
  primary: TransferStatusRead;
  independent: TransferStatusRead | null;
}>;

export type TransferRecoverResponse = Readonly<{ data: TransferRecovery }>;

export type TransferPlanError = Readonly<{ error: Readonly<{ code: TransferPlanErrorCode; message: string }> }>;

export type TransferAdoptError = Readonly<{ error: Readonly<{ code: TransferAdoptErrorCode; message: string }> }>;

export type TransferSettleError = Readonly<{ error: Readonly<{ code: TransferSettleErrorCode; message: string; signature?: string | null }> }>;

export type TransferRecoverError = Readonly<{ error: Readonly<{ code: TransferRecoverErrorCode; message: string }> }>;

/** The settle answer's receipt is the swap's Outcome Receipt artifact, one shape for both. */
export type TransferReceipt = SwapReceipt;

/** `POST /api/solana/transfer/adopt` takes the settle request's shape. */
export type TransferAdoptRequest = TransferSettleRequest;


/* ---- the consumed routes: a payment link paid (1.22.0) — the page's own routes; the bearer pays as its own wallet */

export const PAY_PUBLIC_ERROR_CODES = ["RATE_LIMITED", "NOT_FOUND"] as const;
export type PayPublicErrorCode = (typeof PAY_PUBLIC_ERROR_CODES)[number];

export const PAY_TRANSACTION_ERROR_CODES = ["RATE_LIMITED", "FORBIDDEN", "UNAUTHORIZED", "SESSION_EXPIRED", "SESSION_REVOKED", "UNAVAILABLE", "JSON_REQUIRED", "INVALID_CONTENT_LENGTH", "BODY_TOO_LARGE", "BODY_REQUIRED", "INVALID_BODY_STREAM", "INVALID_JSON", "VALIDATION_ERROR", "WALLET_MISMATCH", "NOT_FOUND", "ALREADY_PAID", "EXPIRED", "PAYMENT_PENDING", "AMOUNT_REQUIRED", "AMOUNT_INVALID", "REQUEST_NOT_PAYABLE", "SELF_PAYMENT", "MINT_UNREADABLE", "EPOCH_UNAVAILABLE", "BUILD_FAILED", "SIMULATION_FAILED", "STORE_FAILED"] as const;
export type PayTransactionErrorCode = (typeof PAY_TRANSACTION_ERROR_CODES)[number];

export const PAY_SUBMIT_ERROR_CODES = ["RATE_LIMITED", "FORBIDDEN", "UNAUTHORIZED", "SESSION_EXPIRED", "SESSION_REVOKED", "UNAVAILABLE", "JSON_REQUIRED", "INVALID_CONTENT_LENGTH", "BODY_TOO_LARGE", "BODY_REQUIRED", "INVALID_BODY_STREAM", "INVALID_JSON", "VALIDATION_ERROR", "WALLET_MISMATCH", "NOT_FOUND", "INTENT_UNKNOWN", "INTENT_MISMATCH", "INTENT_EXPIRED", "ALREADY_SUBMITTED", "BYTES_UNREADABLE", "BYTES_MISMATCH", "SIGNATURE_MISSING", "SUBMIT_FAILED"] as const;
export type PaySubmitErrorCode = (typeof PAY_SUBMIT_ERROR_CODES)[number];

/** The payer page's projection of a link: what the creator put in it and what the chain publishes. */
export type PayPublicRequest = Readonly<{
  id: string;
  network: "mainnet";
  status: PayLinkStatus;
  note: PayLinkNote | null;
  token: Readonly<{ symbol: string; mint: string | null; decimals: number }>;
  amount: Readonly<{ raw: string; display: string }> | null;
  description: string | null;
  recipient: Readonly<{ abbreviated: string; address: string }>;
  reference: string;
  createdAt: string;
  expiresAt: string;
  paid: Readonly<{ signature: string; creditedRaw: string; paidAt: string | null }> | null;
}>;

export type PayPublicView = Readonly<{ request: PayPublicRequest; payUrl: string }>;

/** `GET /api/pay/{id}` — public, observed like the v1 read. */
export type PayPublicResponse = Readonly<{ data: PayPublicView }>;

export type PayPublicError = Readonly<{ error: Readonly<{ code: PayPublicErrorCode; message: string }> }>;

/** `POST /api/pay/{id}/transaction` — the payer (the bearer's own wallet) and, for an open link only, the amount. */
export type PayTransactionRequest = Readonly<{ payer: string; amount?: string | null }>;

/** The unsigned transfer with the link's reference, pinned by its message hash for three minutes. */
export type PayTransactionResponse = Readonly<{
  data: Readonly<{
    ok: true;
    intentId: string;
    unsignedWireBase64: string;
    messageHash: string;
    amountRaw: string;
    mint: string | null;
    simulated: Readonly<{ succeeded: boolean; error: string | null }> | null;
    createsRecipientAccount: boolean;
    networkFeeLamports: string;
  }>;
}>;

export type PayTransactionError = Readonly<{ error: Readonly<{ code: PayTransactionErrorCode; message: string }> }>;

/** `POST /api/pay/{id}/submit` — the intent and the bytes the wallet signed. */
export type PaySubmitRequest = Readonly<{ intentId: string; signedWireBase64: string }>;

/** Sent once: the signature, and the link as its page now reads it. */
export type PaySubmitResponse = Readonly<{ data: Readonly<{ signature: string; view: PayPublicView | null }> }>;

export type PaySubmitError = Readonly<{ error: Readonly<{ code: PaySubmitErrorCode; message: string }> }>;
