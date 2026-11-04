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
export const API_CONTRACT_VERSION = "1.90.0" as const;
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
  /* 1.52.0 — the assistant's credits */
  | "WELCOME_TAKEN"
  | "WELCOME_NOT_ELIGIBLE"
  /* 1.54.0 — buying credits */
  | "CREDIT_ORDER_NOT_FOUND"
  /* 1.57.0 — token watches */
  | "WATCH_NOT_FOUND"
  | "WATCH_LIMIT_REACHED"
  | "WATCH_VERSION_CONFLICT"
  | "MEMORY_NOTE_NOT_FOUND"
  | "MEMORY_SECRET_REFUSED"
  | "TASK_NOT_FOUND"
  | "TASK_LIMIT_REACHED"
  | "TASK_RUNS_CAP"
  | "TASK_VERSION_CONFLICT"
  | "TASK_PRICE_NOT_SHOWN"
  /* 1.61.0 — the trade plan and its critic */
  | "ASSISTANT_PLAN_NOT_FOUND"
  | "ASSISTANT_PLAN_VERSION_CONFLICT"
  | "ASSISTANT_PLAN_STATE_REFUSED"
  /* 1.64.0 — voice heard on the server */
  | "VOICE_TOO_LONG"
  | "VOICE_NOT_HEARD"
  | "VOICE_PRICE_NOT_SHOWN"
  | "VOICE_DAY_SPENT"
  | "CREDITS_DAY_CAP"
  /* 1.12.0 — autoinvest rules */
  | "RULE_NOT_FOUND"
  | "RULE_LIMIT_REACHED"
  /* 1.31.0 — a rule's token of the venue's list stands below the floor (liquidity or age) */
  | "RULE_LIQUIDITY_LOW"
  /* 1.21.0 — «Ryntra попередить» */
  | "CHANNEL_REQUIRED"
  | "PRICE_UNAVAILABLE"
  /* 1.22.0 — «Гроші» */
  | "AMOUNT_INVALID"
  | "MINT_UNREADABLE"
  | "PAY_LINK_NOT_FOUND"
  /* 1.25.0 — Ryntra Launch */
  | "LAUNCH_UNAVAILABLE"
  | "LAUNCH_NAME_BORROWED"
  | "LAUNCH_IMAGE_INVALID"
  | "LAUNCH_IMAGE_REFUSED"
  | "LAUNCH_IMAGE_CHECK_UNAVAILABLE"
  | "LAUNCH_WALLET_V1_REQUIRED"
  | "LAUNCH_LIMIT"
  | "LAUNCH_PAUSED"
  | "LAUNCH_BUSY"
  | "LAUNCH_QUOTE_PAUSED"
  | "LAUNCH_FIRST_BUY_ABOVE_CAP"
  | "LAUNCH_BUILD_EXPIRED"
  | "LAUNCH_BUILD_USED"
  | "LAUNCH_SIGNED_OTHER_BYTES"
  | "LAUNCH_SUBMIT_FAILED"
  | "LAUNCH_NOT_FOUND"
  /* 1.27.0 — a launch's market and trading on it */
  | "LAUNCH_BALANCE_LOW"
  | "LAUNCH_GRADUATING"
  | "LAUNCH_SLIPPAGE"
  /* 1.29.0 — the creator's cabinet */
  | "LAUNCH_SHARES_INVALID"
  | "LAUNCH_NOTHING_TO_CLAIM"
  | "LAUNCH_NO_TRANSFER_FEE"
  /* 1.33.0 — a holder's position in the pool */
  | "LAUNCH_HOLDER_CLOSED"
  | "LAUNCH_NOT_GRADUATED"
  /** 1.81.0 (MOS-2): Team Launch is not open on this deployment, or not to this wallet. */
  | "LAUNCH_TEAM_CLOSED"
  /* 1.75.0 — a team's roles and rights (TEAM-1) */
  | "TEAM_NOT_FOUND"
  | "TEAM_FORBIDDEN"
  | "TEAM_LIMIT"
  | "TEAM_MEMBER_EXISTS"
  | "TEAM_LAST_OWNER"
  | "TEAM_CHANGED"
  | "TEAM_TREASURY_REFUSED"
  /* 1.86.0 — the developer console (DEV-2) */
  | "DEV_NOT_FOUND"
  | "DEV_FORBIDDEN"
  | "DEV_LIMIT"
  | "DEV_CHANGED"
  | "DEV_KEY_INVALID"
  | "DEV_ORIGIN_REFUSED"
  | "DEV_SCOPE_REFUSED"
  | "DEV_QUOTA_EXCEEDED"
  /* 1.90.0 — prepared actions (CITY-161) */
  | "INTENT_NOT_FOUND"
  | "INTENT_EXPIRED"
  | "INTENT_USED"
  | "INTENT_BUSY"
  | "INTENT_CHANGED"
  | "INTENT_NOT_CLAIMED"
  | "INTENT_RECEIPT_UNSEEN"
  | "INTENT_RECEIPT_MISMATCH"
  | "INTENT_ORIGIN_REFUSED"
  | "INTENT_ACTION_CLOSED"
  | "INTENT_LIMIT"
  | "INTENT_CANCELLED"
  | "INTENT_WRONG_WALLET"
  | "INTENT_KEY_INVALID"
  | "INTENT_SENT"
  | "INTENT_SIGNATURE_INVALID";

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
    /** 1.31.0: what a rule may name, the floor a token of the venue's list stands on, and the route that reads a token's standing. */
    assets?: Readonly<{ classes: readonly RuleAssetClass[]; floor: Readonly<{ liquidityUsd: number; ageHours: number }>; read: "/api/v1/rules/asset" }>;
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
    /** 1.65.0: a `.skr` name to its address and an address to its name. */
    skrName?: "/api/v1/research/skr-name";
    /** 1.68.0: «Події ринку» — one feed of market events, each with its source and its transaction. */
    events?: "/api/v1/events";
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
  /** 1.25.0: Ryntra Launch — present only where Launch is served, with the network it launches on. */
  launch?: Readonly<{
    network: LaunchNetworkId;
    presets: "/api/v1/launch/presets";
    metadata: "/api/v1/launch/metadata";
    quote: "/api/v1/launch/quote";
    build: "/api/v1/launch/build";
    submit: "/api/v1/launch/submit";
    token: "/api/v1/launch/{mint}";
    /* 1.27.0 */
    market: "/api/v1/launch/{mint}/market";
    wallet: "/api/v1/launch/{mint}/wallet/{address}";
    tradeQuote: "/api/v1/launch/{mint}/trade/quote";
    tradeBuild: "/api/v1/launch/{mint}/trade/build";
    tradeSubmit: "/api/v1/launch/{mint}/trade/submit";
    creator: "/api/v1/launch/{mint}/creator";
    /* 1.29.0 */
    creators?: "/api/v1/launch/creators/{address}";
    claimBuild?: "/api/v1/launch/{mint}/claim/build";
    claimSubmit?: "/api/v1/launch/{mint}/claim/submit";
    /** 1.73.0 — «Забрати все»: the Review before the claim. */
    claimReview?: "/api/v1/launch/{mint}/claim/review";
    /* 1.32.0 */
    journal?: "/api/v1/launch/{mint}/journal";
    /* 1.33.0 */
    holder?: "/api/v1/launch/{mint}/holder/{address}";
    holderQuote?: "/api/v1/launch/{mint}/holder/quote";
    holderBuild?: "/api/v1/launch/{mint}/holder/build";
    holderSubmit?: "/api/v1/launch/{mint}/holder/submit";
    holderPermissionBuild?: "/api/v1/launch/{mint}/holder/permission/build";
    holderPermissionSubmit?: "/api/v1/launch/{mint}/holder/permission/submit";
    holders?: "/api/v1/launch/holders/{address}";
    /* 1.34.0 — a trade's receipt */
    tradeReceipt?: "/api/v1/launch/{mint}/trade/receipt";
    /* 1.36.0 — the markets launched on Ryntra, one market's card, its health */
    markets?: "/api/v1/launch/markets";
    marketCard?: "/api/v1/launch/markets/{mint}";
    health?: "/api/v1/launch/{mint}/health";
    /* 1.49.0 — a launch's figures for its creator's cabinet, the creator's public profile */
    stats?: "/api/v1/launch/{mint}/stats";
    profile?: "/api/v1/launch/creators/{address}/profile";
    /* 1.55.0 — the survival of the markets launched on Ryntra at 7, 30 and 90 days */
    survival?: "/api/v1/launch/survival";
    /* 1.89.0 — a launch's flow: the launch slot, the bundles, the creator's strip, the independent buyers */
    flow?: "/api/v1/launch/{mint}/flow";
    /* 1.56.0 — «Розширений»: the launch's own config, built and sent */
    advancedConfigBuild?: "/api/v1/launch/advanced/config/build";
    advancedConfigSubmit?: "/api/v1/launch/advanced/config/submit";
    /* 1.56.0 — Launch Boost: a token's creator campaign, its commitment and its payout */
    boost?: "/api/v1/launch/{mint}/boost";
    boostBuild?: "/api/v1/launch/{mint}/boost/build";
    boostSubmit?: "/api/v1/launch/{mint}/boost/submit";
    boostPayoutBuild?: "/api/v1/launch/{mint}/boost/payout/build";
    boostPayoutSubmit?: "/api/v1/launch/{mint}/boost/payout/submit";
    /** 1.69.0 — the creator's split (SOL-L2b). */
    split?: "/api/v1/launch/{mint}/split";
    splitRuleBuild?: "/api/v1/launch/{mint}/split/rule/build";
    splitRuleSubmit?: "/api/v1/launch/{mint}/split/rule/submit";
    splitDepthBuild?: "/api/v1/launch/{mint}/split/depth/build";
    splitDepthSubmit?: "/api/v1/launch/{mint}/split/depth/submit";
    splitPayoutBuild?: "/api/v1/launch/{mint}/split/payout/build";
    splitPayoutSubmit?: "/api/v1/launch/{mint}/split/payout/submit";
    /* 1.56.0 — early access: the launch built and sent, its read and a deposit */
    earlyAccessBuild?: "/api/v1/launch/early-access/build";
    earlyAccessSubmit?: "/api/v1/launch/early-access/submit";
    earlyAccess?: "/api/v1/launch/{mint}/early-access";
    earlyAccessDepositBuild?: "/api/v1/launch/{mint}/early-access/deposit/build";
    earlyAccessDepositSubmit?: "/api/v1/launch/{mint}/early-access/deposit/submit";
    earlyAccessActionBuild?: "/api/v1/launch/{mint}/early-access/action/build";
    earlyAccessActionSubmit?: "/api/v1/launch/{mint}/early-access/action/submit";
  }>;
  /** 1.67.0 — the capability and authority matrix (EXE-1); absent on a deployment before it. */
  authority?: AuthorityMatrixV1;
  observedAt: string;
}>;

/* ------------------------------------------------- authority matrix (1.67.0) */

export type HonestState = "LIVE" | "PAPER" | "PREVIEW" | "DISABLED" | "UNAVAILABLE" | "UNKNOWN" | "RECOVERY";
export type AuthorityEnforcement = "PROGRAM_ENFORCED" | "PROVIDER_NATIVE" | "RYNTRA_GATEWAY_ENFORCED" | "OBSERVE_ONLY";
export type AuthorityMode = "MANUAL" | "ASSISTED" | "AUTONOMOUS";
export type AuthorityAutomationElement = "strategyDefinition" | "trigger" | "riskPolicy" | "authorizedExecutor" | "reconciler" | "runtime" | "resultLedger";

/** One venue × action on this deployment: its honest state, who may act, who holds the bound, how it runs. */
export type AuthorityRowV1 = Readonly<{
  id: string;
  venue: "jupiter" | "meteora-dlmm" | "meteora-damm2" | "meteora-dbc" | "relay" | "circle-cctp" | "phoenix" | "squads" | "subscriptions" | "solana" | "solana-pay" | "agg" | "ryntra";
  action: string;
  surface: "trade" | "perps" | "pools" | "bots" | "launch" | "money" | "treasury" | "predictions" | "agents";
  provider: "MAINNET" | "BETA" | "DEVNET" | "NOT_OFFERED";
  readiness: "PROVEN" | "BUILT" | "PARTIAL" | "MISSING";
  state: HonestState;
  eligibility: "EVERYONE" | "CANARY" | "PILOT" | "OPERATOR" | "NOBODY";
  gate: "OPEN" | "CANARY" | "DEVNET" | "CLOSED" | "NONE";
  enforcement: AuthorityEnforcement;
  mode: AuthorityMode;
  signer: "PERSON_EACH" | "PERSON_ONCE" | "MULTISIG" | "PROVIDER" | "RYNTRA_KEY" | "NONE";
  runsAlone: "NOTHING" | "REMINDER" | "VENUE" | "EXECUTOR";
  network: "mainnet" | "devnet";
  automation: Readonly<Record<AuthorityAutomationElement, boolean>>;
  /** True only with all seven elements of spec §6.1. */
  automatic: boolean;
  evidence: string | null;
  notCovered: string | null;
  note: string;
}>;

export type AuthorityMatrixV1 = Readonly<{
  states: readonly HonestState[];
  enforcement: readonly AuthorityEnforcement[];
  modes: readonly AuthorityMode[];
  rows: readonly AuthorityRowV1[];
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

/**
 * 1.65.0: `GET /api/v1/research/skr-name` — with `name`, the address that owns it now (read every time, never
 * cached: ask again before a signature and show the whole address); with `address`, the wallet's primary name.
 * `UNAVAILABLE` is «the chain did not answer», never «no name».
 */
export type SkrNameRead =
  | Readonly<{ direction: "name"; state: "FOUND" | "NOT_FOUND" | "UNAVAILABLE"; name: string; address: string | null }>
  | Readonly<{ direction: "address"; state: "FOUND" | "NOT_FOUND" | "UNAVAILABLE"; address: string; name: string | null; source: "primary" | "owned" | null }>;

/** 1.68.0: the kinds of «Події ринку», in the feed's own order. */
export type MarketEventKind = "TOKEN_CREATED" | "DEX_LISTED" | "ALPHA_VAULT" | "LIQUIDITY_CHANGED" | "CONCENTRATION_CHANGED" | "AUTHORITY_OPEN" | "UNLOCK" | "CREATOR_SOLD" | "QUOTE_CHANGED" | "LAUNCH_LOG";
/** 1.68.0: `chain` — Ryntra read it on Solana; `jupiter` — Jupiter Tokens V2 states it; `launch` — Ryntra Launch's records and MarketOS's receipts. */
export type MarketEventSource = "chain" | "jupiter" | "launch";

/**
 * 1.68.0: one market event — one fact with its kind, when it happened (null when no source states it) and when Ryntra
 * saw it, its sources, its transaction or account with the explorer's link, its finality, and the token's Pulse risk
 * flags. `id` is `signature:index` for a fact with a transaction. Never advice; a trade opens on `token.href`.
 */
export type MarketEvent = Readonly<{
  id: string;
  kind: MarketEventKind;
  network: "mainnet" | "devnet";
  token: Readonly<{ mint: string; symbol: string; name: string; icon: string | null; href: string; launchedOnRyntra: boolean }>;
  happenedAt: string | null;
  happenedWithin: "h1" | "h24" | null;
  observedAt: string;
  sources: readonly MarketEventSource[];
  finality: "confirmed" | "reported" | "scheduled";
  stale: boolean;
  signature: string | null;
  account: string | null;
  explorerUrl: string;
  route: Readonly<{ from: "pump" | "meteora-dbc" | "launchlab" | null; to: "damm-v2" | null }> | null;
  actor: "creator" | "ryntra" | "meteora" | "other" | null;
  journalKind: "LAUNCHED" | "CREATOR_LOCKED" | "FEES_SHARED" | "CREATOR_SOLD" | "GRADUATED" | "FLOOR_POOL" | "FLOOR_PLACED" | "FLOOR_WITHDRAWN" | "FLOOR_RAISED" | "FLOOR_ADDED" | "FEE_CLAIMED" | "CREATOR_BOUGHT" | null;
  soldBps: number | null;
  soldOf: "bought" | "supply" | null;
  changePct: number | null;
  authority: "MINT" | "FREEZE" | null;
  unlock: "cliff" | "end" | null;
  pairRaw: string | null;
  tokensRaw: string | null;
  pair: Readonly<{ symbol: string; decimals: number }> | null;
  tokenDecimals: number | null;
  flags: readonly ("MINT_AUTHORITY" | "FREEZE_AUTHORITY" | "FLAGGED" | "BORROWED_NAME" | "CREATOR_MANY" | "LIQUIDITY_THIN" | "HOLDERS_FEW" | "BRAND_NEW")[];
  unstated: readonly ("RIGHTS" | "HOLDERS" | "CREATOR" | "AGE")[];
  borrowedLabel: string | null;
  suspicious: readonly ("FLAGGED" | "BORROWED_NAME" | "NAME_COPY")[];
}>;

/** 1.68.0: `GET /api/v1/events` — the feed, the newest first, a suspicious token's event never above the first five clean ones; public. */
export type MarketEventsResponse = Readonly<{
  events: readonly MarketEvent[];
  total: number;
  observedAt: string;
  stale: boolean;
  partial: boolean;
  sources: readonly MarketEventSource[];
  /** The flight logs read for this answer against the people's markets launched on Ryntra; null where Launch is not served. */
  logs: Readonly<{ read: number; markets: number }> | null;
  coverage: readonly Readonly<{ kind: MarketEventKind; state: "read" | "partial" | "not-read"; sources: readonly MarketEventSource[] }>[];
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
/** 1.66.0: one Seeker Genesis Token the proven wallet holds — its mint and its place in the SGT group (a decimal string). */
export type SeekerToken = Readonly<{ mint: string; memberNumber: string }>;
/** 1.66.0: `GET /api/v1/auth/seeker` — «Перевірено Seeker»: whether the wallet the session proved holds an SGT, read by the server on mainnet. A chain that could not be read is UNAVAILABLE (503), never `verified: false`. */
export type SeekerCheckResponse = Readonly<{ address: string; verified: boolean; tokens: readonly SeekerToken[]; network: "solana:mainnet"; checkedAt: string }>;

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
export type AgentPage = "spot" | "stocks" | "swap" | "trends" | "strategies" | "results" | "activity" | "predictions" | "tasks";
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
/** 1.44.0: what kind of news an item is. */
export type AgentNewsTopic = "security" | "etf" | "regulation" | "listing" | "funding" | "partnership" | "upgrade" | "launch" | "macro" | "market" | "other";
/** 1.44.0: the mark on a line of «What moved the price?». */
export type AgentMoveMark = "fact" | "unverified" | "inference" | "unknown";

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
  /* 1.44.0 — a token's or the market's news, and «What moved the price?» with every line marked. */
  | Readonly<{
      kind: "news";
      mint: string | null;
      symbol: string | null;
      items: readonly Readonly<{ id: string; title: string; source: string; publishedAt: string; url: string; topic: AgentNewsTopic; also: number; cite: string }>[];
      day: Readonly<{ stories: number; sources: number }>;
      collectedAt: string;
      state: AgentState;
    }>
  | Readonly<{ kind: "move"; mint: string; symbol: string; window: "1h" | "24h"; change: AgentFigure | null; rows: readonly Readonly<{ mark: AgentMoveMark; text: string; cites: readonly string[] }>[] }>
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

/** 1.52.0: the assistant's credits — the service's own units (1 000 = 1 USDC), never a token, never paid out. */
export type AssistantCredits = Readonly<{
  unit: "credits";
  balance: number;
  welcome: number;
  bought: number;
  free: Readonly<{ used: number; left: number; daily: number; resetsAt: string }>;
  reserved: number;
  dailySpend: Readonly<{ used: number; cap: number; resetsAt: string }>;
  prices: Readonly<{ question: number; alertExplain: number; tokenReport: number; priceMove: number; voice: number; deep: number; plan: number }>;
  welcomeOffer: "open" | "taken";
  holder: "wallet" | "account";
}>;

/** 1.52.0: one entry of the credits' history; never a word of the question. */
export type AssistantCreditEntry = Readonly<{
  at: string;
  kind: "grant" | "hold" | "capture" | "release" | "expire" | "merge-out" | "merge-in";
  action: "question" | "alertExplain" | "tokenReport" | "priceMove" | "voice" | "deep" | "plan" | null;
  reason: "welcome" | "purchase" | "adjust" | null;
  credits: number;
  charged: number | null;
}>;

/** 1.52.0: `GET /api/v1/assistant/credits` and `POST /api/v1/assistant/credits/welcome` (`granted`). */
export type AssistantCreditsResponse = Readonly<{ credits: AssistantCredits; entries: readonly AssistantCreditEntry[]; granted?: number; purchase?: AssistantCreditPurchase }>;

/** 1.54.0: one package of credits for USDC. */
export type AssistantCreditPackage = Readonly<{ id: "usdc-2" | "usdc-5" | "usdc-10" | "usdc-25"; usdc: string; credits: number; bonusPercent: number }>;

/** 1.54.0: whether credits are sold here, the packages and the treasury they are paid to. */
export type AssistantCreditPurchase = Readonly<{
  available: boolean;
  packages: readonly AssistantCreditPackage[];
  treasury: Readonly<{ address: string; abbreviated: string }> | null;
  orderMinutes: number;
}>;

/** 1.54.0: one order of credits — what to pay, where, what arrived and what was credited; `payments` with `credited` is the receipt. */
export type AssistantCreditOrder = Readonly<{
  id: string;
  package: AssistantCreditPackage;
  status: "awaiting" | "checking" | "underpaid" | "paid" | "expired";
  amount: Readonly<{ raw: string; display: string; symbol: "USDC"; mint: string }>;
  received: Readonly<{ raw: string; display: string }>;
  credited: number;
  payPage: string;
  payUrl: string;
  reference: string;
  treasury: Readonly<{ address: string; abbreviated: string }>;
  createdAt: string;
  expiresAt: string;
  payments: readonly Readonly<{ signature: string; amount: string; at: string | null }>[];
  wrongToken: boolean;
}>;

/** 1.54.0: `POST /api/v1/assistant/credits/orders` and `GET …/orders/<id>`. */
export type AssistantCreditOrderResponse = Readonly<{ order: AssistantCreditOrder; credits: AssistantCredits }>;

/** 1.54.0: `GET /api/v1/assistant/credits/orders`. */
export type AssistantCreditOrdersResponse = Readonly<{ orders: readonly AssistantCreditOrder[]; credits: AssistantCredits }>;

/** 1.54.0: the body of `POST /api/v1/assistant/credits/orders`. */
export type AssistantCreditOrderRequest = Readonly<{ package: AssistantCreditPackage["id"]; locale?: "uk" | "en" }>;

export type AgentBudgetState = Readonly<{
  unit: "calls";
  day: Readonly<{ used: number; allowance: number; resetsAt: string }>;
  month: Readonly<{ used: number; allowance: number; resetsAt: string }>;
  inFlight: Readonly<{ used: number; limit: number }>;
  exhausted: boolean;
  reason: string | null;
  model: "configured" | "absent";
  /** 1.52.0: the credits a question that reaches the model is paid in. */
  credits?: AssistantCredits;
}>;

export type AgentSuggestion = Readonly<{ text: string; class: AgentQuestionClass }>;

export type AgentSessionOpenRequest = Readonly<{ context?: AgentContext | null; locale?: "en" | "uk"; sessionId?: string; fresh?: boolean }>;
/** 1.43.0: how long a conversation is kept after its last turn. */
export const AGENT_SESSION_RETENTION_DAYS = 90 as const;
/** 1.43.0: one conversation as the list shows it — its first question, dates and expiry; never its answers. */
export type AgentSessionSummary = Readonly<{ id: string; locale: "en" | "uk"; context: AgentContext | null; title: string | null; turnCount: number; createdAt: string; updatedAt: string; expiresAt: string }>;
export type AgentSessionListResponse = Readonly<{ sessions: readonly AgentSessionSummary[]; retentionDays: typeof AGENT_SESSION_RETENTION_DAYS }>;
/** 1.43.0: a market question without a wallet; the context is an asset or a page, never someone's own. */
export type AgentGuestRequest = Readonly<{ text: string; locale?: "en" | "uk"; context?: Readonly<{ kind: "asset"; mint: string; symbol?: string }> | Readonly<{ kind: "page"; page: AgentPage }> | null }>;
export type AgentGuestResponse = Readonly<{ person: AgentTurn; ryn: AgentTurn; guest: Readonly<{ day: Readonly<{ used: number; allowance: number; resetsAt: string }>; model: "configured" | "absent"; needsWallet: boolean }> }>;

/* 1.46.0 — «Ранковий огляд» (AI-10): GET and PUT /api/v1/assistant/brief. */
export type AssistantBriefLineKind = "sol" | "btc" | "mover" | "market-news" | "token" | "token-news" | "plan";
export type AssistantBriefLine = Readonly<{ kind: AssistantBriefLineKind; mark: "fact" | "unverified"; text: string; source: string; observedAt: string | null; href: string | null }>;
export type AssistantBriefPart = Readonly<{ title: string; words: string[]; lines: AssistantBriefLine[]; note: string | null }>;
export type AssistantBrief = Readonly<{
  day: string;
  title: string;
  market: AssistantBriefPart;
  personal: AssistantBriefPart & Readonly<{ state: "changed" | "unchanged" | "unread" }>;
  deliveredAt: string;
}>;
export type AssistantBriefSettings = Readonly<{ enabled: boolean; time: string; zone: string; locale: "en" | "uk" }>;
export type AssistantBriefResponse = Readonly<{
  settings: AssistantBriefSettings;
  next: Readonly<{ at: string | null; quiet: boolean }>;
  channels: Readonly<{ inbox: true; telegram: boolean; push: boolean }>;
  priceCredits: number;
  charged: false;
  latest: AssistantBrief | null;
}>;
export type AssistantBriefUpdate = Readonly<{ enabled: boolean; time?: string; zone?: string; locale?: "en" | "uk" }>;

/** 1.57.0: a token watch's rule — the person's own threshold, judged without a model. */
export type AssistantWatchRule =
  | Readonly<{ kind: "price"; direction: "above" | "below"; level: number }>
  | Readonly<{ kind: "move"; window: "m5" | "h1" | "h24"; direction: "up" | "down" | "any"; pct: number }>
  | Readonly<{ kind: "volume"; factor: number }>
  | Readonly<{ kind: "liquidity"; window: "h1" | "h24"; direction: "drop" | "rise" | "any"; pct: number; pool: string | null }>;
export type AssistantWatchPreset = "drop24h" | "rise24h" | "below" | "above" | "volume3x" | "liquidityDrop";
export type AssistantWatchState = "armed" | "rang" | "cooling" | "unread" | "learning" | "paused";

/** 1.57.0: one token watch as the reader sees it — what it reads now, its latest alert and «Чому?» at its price. */
export type AssistantWatch = Readonly<{
  id: string;
  version: number;
  mint: string;
  symbol: string;
  rule: AssistantWatchRule;
  ruleText: string;
  status: "active" | "paused";
  cooldownMinutes: number;
  channels: Readonly<{ telegram: boolean; push: boolean }>;
  now: Readonly<{ state: AssistantWatchState; text: string | null; source: string | null; observedAt: string | null }>;
  last: Readonly<{ at: string; title: string; reason: string; inboxId: string }> | null;
  explain: Readonly<{ question: string; priceCredits: number }> | null;
  createdAt: string;
  updatedAt: string;
}>;

/** 1.57.0: `GET /api/v1/assistant/watches` and every write's answer. */
export type AssistantWatchesResponse = Readonly<{
  watches: readonly AssistantWatch[];
  limit: Readonly<{ free: number; used: number; left: number }>;
  presets: readonly Readonly<{ id: AssistantWatchPreset; text: string }>[];
  explainPriceCredits: number;
  channels: Readonly<{ inbox: true; telegram: boolean; push: boolean }>;
  deliveriesPerHour: number;
}>;

/** 1.57.0: `POST /api/v1/assistant/watches` — a token by mint and a preset or a rule (one of the two). */
export type AssistantWatchCreate = Readonly<{
  mint: string;
  preset?: AssistantWatchPreset;
  rule?: AssistantWatchRule;
  cooldownMinutes?: number;
  channels?: Readonly<{ telegram: boolean; push: boolean }>;
  locale?: "en" | "uk";
}>;

/** 1.57.0: `PATCH /api/v1/assistant/watches/{id}` — pause, resume or change; a changed rule starts afresh. */
export type AssistantWatchUpdate = Readonly<{
  ifVersion?: number;
  status?: "active" | "paused";
  rule?: AssistantWatchRule;
  cooldownMinutes?: number;
  channels?: Readonly<{ telegram: boolean; push: boolean }>;
}>;

/** 1.58.0 «Знайомство»: the proven wallet's answers, or that the person skipped them; they shape only Ryntra's wording. */
export type AssistantProfile = Readonly<{
  skipped: boolean;
  goal: "learn" | "trade" | "hold" | null;
  experience: "new" | "some" | "pro" | null;
  riskPct: 0.5 | 1 | 2 | null;
  horizon: "hours" | "days" | "weeks" | null;
  updatedAt: string;
}>;
/** 1.58.0: `GET /api/v1/assistant/profile` and the answer to `PUT` — the profile (null until answered or skipped) and where notes go. */
export type AssistantProfileResponse = Readonly<{
  profile: AssistantProfile | null;
  delivery: Readonly<{ inbox: true; telegram: boolean; push: boolean; quietHours: QuietHours | null }>;
}>;
/** 1.58.0: `PUT /api/v1/assistant/profile` — the four answers (with `delivery`, Нагляд's preferences too), or `{ skipped: true }`. */
export type AssistantProfileUpdate =
  | Readonly<{
      goal: "learn" | "trade" | "hold";
      experience: "new" | "some" | "pro";
      riskPct: 0.5 | 1 | 2;
      horizon: "hours" | "days" | "weeks";
      delivery?: Readonly<{ telegram: boolean; push: boolean; quietHours: QuietHours | null }>;
    }>
  | Readonly<{ skipped: true }>;

/** 1.59.0 (AI-18): one thing Ryntra keeps about the person, in their own words. */
export type AssistantMemoryNote = Readonly<{ id: string; text: string; source: "said" | "asked" | "typed"; at: string }>;
/** 1.59.0: what the wallet shows, read now — never kept. */
export type AssistantWalletPicture = Readonly<{ state: "current" | "unavailable"; tokens: number | null; largest: readonly Readonly<{ symbol: string; mint: string }>[] }>;
/** 1.59.0: `GET /api/v1/assistant/memory` and every write's answer. */
export type AssistantMemoryResponse = Readonly<{
  about: string | null;
  noticing: boolean;
  notes: readonly AssistantMemoryNote[];
  profile: AssistantProfile | null;
  wallet: AssistantWalletPicture;
  updatedAt: string | null;
}>;
/** 1.59.0: `PUT /api/v1/assistant/memory` — «Про мене», whether to notice, or a note typed by hand. */
export type AssistantMemoryUpdate = Readonly<{ about?: string | null; noticing?: boolean; note?: string }>;

/** 1.59.0 (AI-19): what a «Доручення» asks. */
export type AssistantTaskAsk =
  | Readonly<{ kind: "question"; text: string }>
  | Readonly<{ kind: "news"; mint: string; symbol: string }>
  | Readonly<{ kind: "move"; mint: string; symbol: string }>
  | Readonly<{ kind: "portfolio" }>;
export type AssistantTaskEvery = "10m" | "30m" | "1h" | "1d";
export type AssistantTask = Readonly<{
  id: string;
  ask: AssistantTaskAsk;
  name: string;
  every: AssistantTaskEvery;
  time: string | null;
  zone: string;
  rhythm: string;
  onlyWhenNew: boolean;
  channels: Readonly<{ telegram: boolean; push: boolean }>;
  status: "active" | "paused";
  pausedBy: "person" | "credits" | "price" | null;
  priceCredits: number;
  perDayCredits: number;
  nextRunAt: string | null;
  skippedAt: string | null;
  last: Readonly<{ at: string; headline: string; delivered: boolean }> | null;
  runs: number;
  href: string;
  sessionId: string | null;
  version: number;
}>;
/** 1.59.0: `GET /api/v1/assistant/tasks` and every write's answer. */
export type AssistantTasksResponse = Readonly<{
  tasks: readonly AssistantTask[];
  limit: number;
  pricePerRun: number;
  rhythms: readonly Readonly<{ every: AssistantTaskEvery; runsPerDay: number; perDayCredits: number; fits: boolean }>[];
  runs: Readonly<{ used: number; cap: number }>;
}>;
/** 1.59.0: `POST /api/v1/assistant/tasks` — `acceptCredits` is the price of a run the client showed. */
export type AssistantTaskCreate = Readonly<{
  ask: AssistantTaskAsk;
  every: AssistantTaskEvery;
  time?: string;
  zone?: string;
  locale?: "en" | "uk";
  onlyWhenNew?: boolean;
  channels: Readonly<{ telegram: boolean; push: boolean }>;
  acceptCredits: number;
}>;
/** 1.59.0: `PATCH /api/v1/assistant/tasks/<id>`. */
export type AssistantTaskUpdate = Readonly<{
  ifVersion: number;
  status?: "active" | "paused";
  every?: AssistantTaskEvery;
  time?: string;
  channels?: Readonly<{ telegram: boolean; push: boolean }>;
  onlyWhenNew?: boolean;
  acceptCredits?: number;
}>;
/** 1.59.0: push to a computer's browser — whether the deployment can, its key, and how many browsers receive it. */
export type AssistantPushState = Readonly<{ configured: boolean; publicKey: string | null; browsers: number; thisBrowser: boolean | null }>;
/** 1.59.0: `GET /api/v1/assistant/push/latest` — what the service worker shows. */
export type AssistantPushLatest = Readonly<{ note: Readonly<{ id: string; title: string; body: string; href: string }> | null }>;
/** 1.64.0: `POST /api/v1/assistant/voice` — a recording (base64, at most two minutes) for the question field; `acceptCredits` is the price the client showed. */
export type AssistantVoiceRequest = Readonly<{ id: string; audio: string; mime: string; seconds: number; locale?: "en" | "uk"; acceptCredits: number }>;
/** 1.64.0: the words heard — for the field, never asked by themselves — what they cost, and the credits after. */
export type AssistantVoiceResponse = Readonly<{ text: string; seconds: number; spent: number; free: number; repeat: boolean; credits: AssistantCredits | null }>;
/** 1.61.0: who set a level or an assumption of a trade plan. */
export type AssistantPlanAuthor = "person" | "ryntra" | "market" | "rules";
export type AssistantPlanState = "draft" | "checked" | "approved" | "watching" | "done" | "cancelled" | "broken";
export type AssistantPlanLevel = Readonly<{ priceUsd: number; by: AssistantPlanAuthor; why: string | null }>;
/** 1.61.0: the fees and both outcomes of a sized plan, as the plan engine estimates them — never a quote. */
export type AssistantPlanFees = Readonly<{
  model: "estimate-v1";
  feePolicy: string;
  ryntraFeeBps: number;
  costBufferBps: number;
  notionalUsd: number;
  ryntraFeeUsd: number;
  costBufferUsd: number;
  networkUsd: number;
  totalUsd: number;
  lossAtInvalidationUsd: number;
  rewardAtTargetUsd: number;
  rewardToRisk: number | null;
}>;
/** 1.61.0: one version's plan — the loss limit and the budget are always the person's. */
export type AssistantPlanBody = Readonly<{
  thesis: Readonly<{ text: string; whyNow: string | null; horizonDays: number | null; by: AssistantPlanAuthor }>;
  entry: Readonly<{ priceUsd: number; maxPriceUsd: number; validUntil: string; condition: string | null; by: AssistantPlanAuthor }>;
  invalidation: AssistantPlanLevel;
  lossLimit: Readonly<{ riskUsd: number; budgetUsd: number }>;
  targets: readonly AssistantPlanLevel[];
  fees: AssistantPlanFees;
  sizing: PlanSizing;
  assumptions: readonly Readonly<{ text: string; by: AssistantPlanAuthor }>[];
  sources: readonly Readonly<{ id: string; source: string; observedAt: string; state: AgentState; href: string | null }>[];
}>;
export type AssistantPlanFinding = Readonly<{
  id: string;
  severity: "major" | "minor" | "note";
  kind: "fees" | "loss-scenario" | "contradiction" | "level" | "thesis" | "data" | "size" | "liquidity";
  field: "thesis" | "entry" | "invalidation" | "lossLimit" | "targets" | "fees" | "sizing" | "sources";
  text: string;
  cites: readonly string[];
  by: "rules" | "model";
}>;
/** 1.61.0: the critic on one version — the rules' checks always, the strong model's findings when it ran. */
export type AssistantPlanCritic = Readonly<{ by: "rules" | "model"; model: string | null; findings: readonly AssistantPlanFinding[]; summary: string | null; gaps: readonly string[]; checkedAt: string }>;
export type AssistantPlanVersion = Readonly<{ n: number; body: AssistantPlanBody; critic: AssistantPlanCritic; createdAt: string; by: "ryntra" | "person" | "plan-page"; reason: string | null; tradingPlanVersion: number | null }>;
/** 1.61.0: one trade under the plan against it — the receipt and the risk in words. */
export type AssistantPlanTrade = Readonly<{
  signature: string;
  at: string;
  side: "BUY" | "SELL" | null;
  outcome: "DONE" | "FAILED" | "UNKNOWN";
  planned: Readonly<{ priceUsd: number; maxPriceUsd: number | null; units: number }>;
  actual: Readonly<{ priceUsd: number | null; units: number | null; usd: number | null; feeUsd: number | null }>;
  priceDeviationPct: number | null;
  sizeDeviationPct: number | null;
  verdict: "followed" | "deviated" | "unknown";
  receipt: readonly string[];
  risk: readonly string[];
  receiptHash: string | null;
}>;
export type AssistantPlanReality = Readonly<{
  trades: readonly AssistantPlanTrade[];
  position: Readonly<{ state: "open" | "closed" | "none"; unitsHeld: number | null; costBasisUsd: number | null; realisedUsd: number | null }>;
  summary: readonly string[];
  complete: boolean;
}>;
/** 1.61.0: a trade plan Ryntra composed with the person — its state, every version, its journal, what Нагляд says and «План проти реальності». */
export type AssistantPlan = Readonly<{
  id: string;
  mint: string;
  symbol: string;
  state: AssistantPlanState;
  stateReason: "invalidation" | "expired" | "position-closed" | "person" | null;
  version: number;
  current: AssistantPlanVersion;
  versions: readonly Readonly<{ n: number; createdAt: string; by: "ryntra" | "person" | "plan-page"; reason: string | null; critic: "rules" | "model" }>[];
  journal: readonly Readonly<{ at: string; event: "created" | "edited" | "checked" | "approved" | "watching" | "synced" | "broken" | "done" | "cancelled"; version: number; note: string | null }>[];
  tradingPlan: Readonly<{ id: string; status: PlanStatus; version: number; href: string }> | null;
  watch: Readonly<{ status: "none" | "watching" | "needs_attention" | "paused" | "unavailable"; lastCheckedAt: string | null; line: string | null }>;
  reality: AssistantPlanReality | null;
  actions: Readonly<{ approve: boolean; watch: boolean; edit: boolean; recheck: boolean; cancel: boolean }>;
  createdAt: string;
  updatedAt: string;
}>;
export type AssistantPlanResponse = Readonly<{
  plan: AssistantPlan;
  prices: Readonly<{ plan: number; recheck: number }>;
  spent: Readonly<{ credits: number; architect: "model" | "rules"; critic: "model" | "rules" }> | null;
  budget: AgentBudgetState | null;
}>;
export type AssistantPlansResponse = Readonly<{ plans: readonly AssistantPlan[]; prices: Readonly<{ plan: number; recheck: number }>; budget: AgentBudgetState | null }>;
/** 1.61.0: `POST /api/v1/assistant/plans` — the token, the person's idea, their loss limit or budget, any level they know, or a draft; `acceptCredits` the price shown. */
export type AssistantPlanCreate = Readonly<{
  mint: string;
  idea: string;
  riskUsd?: number | null;
  budgetUsd?: number | null;
  entryUsd?: number | null;
  maxPriceUsd?: number | null;
  invalidationUsd?: number | null;
  targetsUsd?: readonly number[];
  horizonDays?: number | null;
  draftId?: string | null;
  acceptCredits?: number | null;
  locale?: "en" | "uk";
}>;
/** 1.61.0: `PUT /api/v1/assistant/plans/{id}` — the person's change, a new version. */
export type AssistantPlanUpdate = Readonly<{
  ifVersion: number;
  thesis?: string;
  entryUsd?: number;
  maxPriceUsd?: number;
  invalidationUsd?: number;
  targetsUsd?: readonly number[];
  riskUsd?: number;
  budgetUsd?: number;
  reason?: string | null;
  locale?: "en" | "uk";
}>;
export type AssistantPlanRecheck = Readonly<{ ifVersion: number; acceptCredits?: number | null; locale?: "en" | "uk" }>;
export type AssistantPlanStateRequest = Readonly<{ to: "approved" | "watching" | "cancelled"; ifVersion: number; locale?: "en" | "uk" }>;
export type AgentSessionResponse = Readonly<{ session: AgentSession; budget: AgentBudgetState; suggestions: readonly AgentSuggestion[] }>;
/** 1.52.0 `acceptCredits`: the price the client showed; absent, only the day's free credits are spent. */
export type AgentMessageRequest = Readonly<{ sessionId: string; text: string; locale?: "en" | "uk"; acceptCredits?: number; typed?: boolean }>;
export type AgentMessageResponse = Readonly<{ sessionId: string; person: AgentTurn; ryn: AgentTurn; budget: AgentBudgetState }>;
export type AgentDraftResponse = Readonly<{ draft: AgentDraftCard; sessionId: string; turnId: string; createdAt: string; expiresAt: string }>;
export type AgentSuggestionsResponse = Readonly<{ context: AgentContext | null; suggestions: readonly AgentSuggestion[] }>;

/**
 * 1.10.0: the two formats on a subject, for a surface that is not a
 * conversation. `compose` is the budget boundary said in the request:
 * `deterministic` (the default) never reaches a model and never spends;
 * `model` words the same reads under the wallet's existing agent allowance.
 */
export type AgentLensRequest = Readonly<{ subject: AgentContext; locale?: "en" | "uk"; compose?: "deterministic" | "model"; acceptCredits?: number }>;

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
  /** 1.53.0: true only when the oldest read behind the rows shown is older than five minutes, or one is held after a failed refresh. */
  stale: boolean;
  /** 1.53.0: that oldest read's time, present when `stale`. */
  lastGoodAt?: string;
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

export const REFERRAL_REFUSALS = ["SELF_REFERRAL", "UNKNOWN_CODE", "ALREADY_REFERRED", "ALREADY_EARNING", "CYCLE", "ALREADY_CHANGED"] as const;
export type ReferralRefusal = (typeof REFERRAL_REFUSALS)[number];

export const MONITOR_STATUSES = ["watching", "needs_attention", "paused", "unavailable"] as const;
export type MonitorStatus = (typeof MONITOR_STATUSES)[number];

/** 1.21.0: `position` — «Ryntra попередить» on a company the wallet holds, `id` the token's mint. */
export const MONITOR_SUBJECT_KINDS = ["trading-plan", "prediction-plan", "position"] as const;
export type MonitorSubjectKind = (typeof MONITOR_SUBJECT_KINDS)[number];
/** 1.12.0: a note may also be an autoinvest rule's reminder — a note's subject, never a card's; 1.13.0: or the month's autoinvest budget, spent; 1.15.0: or an issuer's event about a token the wallet holds (`id` its mint) — a window to swap it before the issuer's cut-off; 1.42.0: or a spot limit order Ryntra recorded (`id` its order account) — «Ордер виконано» and «Квитанція готова». */
/** 1.46.0: `assistant-brief` — «Ранковий огляд» of a day, `id` the person's day. */
export type MonitorNoteSubjectKind = MonitorSubjectKind | "autoinvest-rule" | "autoinvest-budget" | "issuer-event" | "limit-order" | "assistant-brief" | "launch-creator" | "token-watch" | "assistant-task" | "wallet-watch";

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

export const SWAP_ORDER_ERROR_CODES = ["RATE_LIMITED", "FORBIDDEN_ORIGIN", "UNAUTHORIZED", "SESSION_EXPIRED", "SESSION_REVOKED", "UNAVAILABLE", "SWAP_PAUSED", "JSON_REQUIRED", "INVALID_CONTENT_LENGTH", "BODY_TOO_LARGE", "BODY_REQUIRED", "INVALID_BODY_STREAM", "INVALID_JSON", "VALIDATION_ERROR", "WALLET_MISMATCH", "ASSET_NOT_OFFERED", "PLAN_NOT_FOUND", "RULE_NOT_FOUND", "RULE_NOT_DUE", "RULE_MISMATCH", "RULE_BUDGET_EXHAUSTED", "RULE_PRICE_CONDITION", "RULE_LIQUIDITY_LOW", "STORE_NOT_DURABLE", "OWNER_SWAP_LOCKED", "OWNER_SWAP_LOCK_ABSENT", "OWNER_SWAP_LOCK_MISMATCH", "OWNER_SWAP_LOCK_UNAVAILABLE", "PROVIDER_KEY_MISSING", "PROOF_NOT_SIGNED", "MINT_UNREADABLE", "PASSPORT_REFUSED", "ORDER_PRODUCTION_KEY_REQUIRED", "ORDER_NO_ROUTE", "ORDER_REFUSED", "ORDER_RATE_LIMITED", "ORDER_HTTP_ERROR", "ORDER_UNREACHABLE", "ORDER_MALFORMED", "ORDER_IMPLAUSIBLE_QUOTE", "ORDER_BUILD_FAILED", "TRANSACTION_UNREADABLE", "TRANSACTION_TOO_LARGE", "TRANSACTION_VERSION_UNSUPPORTED", "TRANSACTION_FEE_PAYER_MISMATCH", "TRANSACTION_TAKER_NOT_SIGNER", "TRANSACTION_NO_INSTRUCTIONS", "TRANSACTION_DANGEROUS_TOKEN_INSTRUCTION", "TRANSACTION_DANGEROUS_ACCOUNT_INSTRUCTION", "TRANSACTION_PROGRAM_INDEX_OUT_OF_RANGE", "SIMULATION_EFFECT_CONTRACT_UNREADABLE", "SIMULATION_EFFECT_PAIR_UNSUPPORTED", "SIMULATION_EFFECT_GASLESS_UNSUPPORTED", "SIMULATION_EFFECT_FEE_PAYER_MISMATCH", "SIMULATION_EFFECT_FEE_MISMATCH", "SIMULATION_EFFECT_RENT_UNSUPPORTED", "SIMULATION_EFFECT_SIMULATION_METADATA_UNAVAILABLE", "SIMULATION_EFFECT_ACCOUNT_VECTOR_MISMATCH", "SIMULATION_EFFECT_TOKEN_METADATA_UNAVAILABLE", "SIMULATION_EFFECT_TOKEN_METADATA_INVALID", "SIMULATION_EFFECT_TOKEN_OWNER_UNRESOLVED", "SIMULATION_EFFECT_UNSAFE_TOKEN_MUTATION", "SIMULATION_EFFECT_UNSAFE_ACCOUNT_MUTATION", "SIMULATION_EFFECT_UNRESOLVED_INNER_PROGRAM", "SIMULATION_EFFECT_UNRELATED_TOKEN_DELTA", "SIMULATION_EFFECT_INPUT_DELTA_MISMATCH", "SIMULATION_EFFECT_OUTPUT_DELTA_MISMATCH", "SIMULATION_EFFECT_NATIVE_DELTA_MISMATCH", "SIMULATION_UNAVAILABLE", "SIMULATION_FAILED", "INTENT_REFUSED", "PLAN_REVIEW_BLOCKED", "PLAN_VERSION_CONFLICT", "PLAN_STATE_REFUSED", "SWAP_PRE_SIGN_REFUSED"] as const;
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
    /** 1.34.0: `LAUNCH` — a buy or a sale of a Ryntra launch, with its token and venue. */
    surface: "SPOT" | "LAUNCH";
    side: "BUY" | "SELL";
    plan?: Readonly<{ planId: string; version: number; reviewId: string }>;
    /** 1.12.0: the autoinvest reminder a purchase was made under. */
    rule?: RuleBinding;
    /** 1.34.0, `LAUNCH` only: the launched token. */
    token?: string;
    /** 1.34.0, `LAUNCH` only: the bonding curve, or the DAMM v2 pool it graduated into. */
    venue?: "curve" | "pool";
  }> | null;
  providerRef: string | null;
  statedUsd: number | null;
  startedAt: string;
  updatedAt: string;
}>;

/** 1.60.0 (SOL-X1): the cashback one trade earned, by its signature — `usdMicros` null while unvalued, `held` while part waits on «First $10 back»'s check. */
export type ActivityTradeCashback = Readonly<{ signature: string; usdMicros: string | null; held: boolean }>;

/** `POST /api/solana/activity` — `rewards` and `cashback` null when the request is not the owner's, `[]` when there are none; `complete: false` when a stored row could not be read. */
export type ActivityResponse = Readonly<{
  data: Readonly<{
    actions: readonly ActivityAction[];
    rewards: readonly RewardsRow[] | null;
    cashback: readonly ActivityTradeCashback[] | null;
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

export type RewardRank = "BRONZE" | "SILVER" | "GOLD" | "SAPPHIRE" | "DIAMOND";

/** The rank over the last 30 days and the level-1 share of the received fee it pays (Growth line, rules 2.0.0). */
export type RewardsRank = Readonly<{
  rank: RewardRank;
  points: string;
  fromTrades: string;
  fromFriends: string;
  fromLaunches: string;
  rankFrom: string;
  next: Readonly<{ rank: RewardRank; at: string; toGo: string; friendShare: number }> | null;
  friendShare: number;
  secondLevelShare: number;
  ladder: readonly Readonly<{ rank: RewardRank; from: string; friendShare: number }>[];
  windowDays: number;
  rulesVersion: string;
}>;

export type RewardAchievement = "FIRST_FRIEND" | "FIVE_FRIENDS" | "LAUNCH_ON_DEX";

/** Every rank reached since ranks began (with the points it begins at) and the achievements held, each with the moment it was earned (Growth line). `LAUNCH_ON_DEX` is absent until earned. */
export type RewardsAchievements = Readonly<{
  ranks: readonly Readonly<{ rank: RewardRank; reached: boolean; at: string | null; from: string }>[];
  badges: readonly Readonly<{ id: RewardAchievement; earned: boolean; at: string | null }>[];
}>;

/** The rules in force as the wallet meets them (`2.1.0`, or `2.2.0` once its ladder is in force); absent before they are in force. */
export type RewardsProgramme = Readonly<{
  rulesVersion: "2.1.0" | "2.2.0";
  claimMinimum: string;
  claimMinimumWithAccount: string;
  claimMinimumWithoutAccount: string;
  usdcAccount: "EXISTS" | "MISSING" | "UNKNOWN";
  firstTenOffer: Readonly<{ cap: string; days: number; walletsPerMonth: number }>;
  firstTen: Readonly<{ state: "OPEN" | "CLOSED"; check: "PENDING" | "PASSED" | "FAILED"; returned: string; cap: string; held: string; endsAt: string }> | null;
  inviterWindow: Readonly<{ share: number; days: number }>;
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
  /** Null when the rank could not be read; absent from a deployment before ranks. */
  rank?: RewardsRank | null;
  /** Null when the badges could not be read; absent from a deployment before badges. */
  achievements?: RewardsAchievements | null;
  started: boolean;
  /** Absent before rules 2.1.0 are in force. */
  programme?: RewardsProgramme;
}>;

/** The rewards route's own error bodies (not the v1 envelope): 429 `rate limited`, 401 `proof required`, 503 `REWARDS_UNAVAILABLE`. */
export type RewardsError = Readonly<{ error: "rate limited" }> | Readonly<{ error: "proof required"; proof: false }> | Readonly<{ ok: false; error: "REWARDS_UNAVAILABLE" }>;

export type RewardsReferralPreview = Readonly<{ code: string; inviterMasked: string; codeMasked: string }>;

/** Whether the proven wallet can still take an inviter: before its first trade (`until` null), seven days after it, then not. */
export type RewardsReferralBinding = Readonly<{ open: boolean; until: string | null }>;

export type RewardsReferralState = Readonly<{
  ok: true;
  pending: RewardsReferralPreview | null;
  confirmed: Readonly<{ inviterMasked: string; codeMasked: string | null }> | null;
  binding?: RewardsReferralBinding;
  /** With an inviter: whether it can still be changed — once, inside the same window. */
  change?: RewardsReferralBinding;
  /** True on the read that bound the carried invitation on its own. */
  bound?: true;
}>;

export type RewardsReferralGetResponse = Readonly<{ ok: true; found: true; preview: RewardsReferralPreview }> | Readonly<{ ok: true; found: false; preview: null }> | RewardsReferralState;

export type RewardsReferralRequest = Readonly<{ action: "pending"; code: string }> | Readonly<{ action: "dismiss" }> | Readonly<{ action: "confirm"; code: string; address: string }> | Readonly<{ action: "change"; code: string; address: string }>;

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
  mechanism: "JUPITER_REFERRAL" | "JUPITER_PLATFORM_FEE" | "RELAY_APP_FEE" | "MAYAN_REFERRER" | "METEORA_LAUNCH" | "NONE";
  state: SwapServiceFeeState;
  basisPoints: number;
  requestedBasisPoints: number;
  asset: string | null;
  symbol: string | null;
  decimals: number | null;
  amountRaw: string | null;
  usd: number | null;
  accrual: "JUPITER_REFERRAL_TOKEN_ACCOUNT" | "FEE_WALLET_TOKEN_ACCOUNT" | "RELAY_APP_BALANCE_USDC" | "MAYAN_ONCHAIN_REFERRER" | "METEORA_PARTNER_VAULT" | "NONE";
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

/**
 * 1.85.0 — the risk verdict over one trade. Thirteen named facts, each with
 * the source that produced it and the time it was read; `missing` names what
 * is absent on an `INCOMPLETE` one, and `limits` states the thresholds the
 * measured facts were read against, so a client can show a person exactly
 * what put a trade where it is.
 *
 * `NO_KNOWN_BLOCKER` reports the absence of known blockers. It is not "safe",
 * and must never be drawn as such.
 */
export type TradeRiskFact =
  | "MINT_AND_PROGRAM"
  | "TOKEN_EXTENSIONS"
  | "MINT_AUTHORITY"
  | "FREEZE_AUTHORITY"
  | "TOKEN_RESTRICTIONS"
  | "SLIPPAGE"
  | "LIQUIDITY_PATH"
  | "QUOTE_FRESHNESS"
  | "VENUE_STATUS"
  | "HOLDER_CONCENTRATION"
  | "CREATOR_BEHAVIOUR"
  | "RWA_ELIGIBILITY"
  | "TRADE_BUDGET";

export type TradeRiskKind = "SWAP" | "SPOT_LIMIT" | "PERP" | "LAUNCH" | "BRIDGE_SWAP";

export type TradeRisk = Readonly<{
  schema: "ryntra.solana.trade-risk-verdict";
  schemaVersion: "1.0.0";
  trade: Readonly<{ kind: TradeRiskKind; network: "mainnet" | "devnet"; mint: string }>;
  verdict: "NO_KNOWN_BLOCKER" | "REVIEW_REQUIRED" | "BLOCKED" | "INCOMPLETE";
  findings: readonly Readonly<{
    fact: TradeRiskFact;
    outcome: "ALLOWED" | "REVIEW_REQUIRED" | "BLOCKED" | "INCOMPLETE";
    detail: string;
    source: Readonly<{ ref: string; label: string; readAt: string; slot: number | null }> | null;
    missing: string | null;
  }>[];
  limits: Readonly<{
    slippageReviewBps: number;
    slippageBlockBps: number;
    quoteFreshSeconds: number;
    factsFreshSeconds: number;
    topPlainHolderReviewShare: number;
    topFivePlainHoldersReviewShare: number;
    creatorHoldsReviewShare: number;
    transferFeeReviewBps: number;
  }>;
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
  /** 1.85.0: the risk verdict over this trade. */
  risk: TradeRisk;
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
  /** 1.85.0: the risk verdict over this trade, built on the exact order the wallet will be asked to sign. */
  risk: TradeRisk;
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

export const PREDICTION_FAILURE_CODES = ["VALIDATION_ERROR", "UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND", "RATE_LIMITED", "PROVIDER_UNAVAILABLE", "NOT_LINKED", "LINK_UNAVAILABLE", "SESSION_EXPIRED", "WALLET_MISMATCH", "SIGNATURE_INVALID", "CHALLENGE_REQUIRED", "CHALLENGE_FAILED", "QUOTE_UNAVAILABLE", "QUOTE_EXPIRED", "ORDER_REFUSED", "PLAN_INVALID", "PLAN_NOT_FOUND", "PLAN_VERSION_CONFLICT", "PLAN_STATE_REFUSED", "FUNDING_OFF", "WITHDRAWAL_OPEN", "UNAVAILABLE"] as const;
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

/** A prediction route's own refusal; `issues` (at most 32) on VALIDATION_ERROR and PLAN_INVALID; `siteKey` on CHALLENGE_REQUIRED — show the bot check (Turnstile) with it, then start again with its token. */
export type PredictionsFailure = Readonly<{
  error: Readonly<{
    code: PredictionFailureCode;
    message: string;
    issues?: readonly Readonly<{ path: string; message: string }>[];
    siteKey?: string;
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
  siteKey?: string;
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
  /** the first market's question when the event holds more than one market; null otherwise. */
  leadingQuestion?: string | null;
  /** the provider's series cadence as an ISO-8601 duration (PT5M, PT1H, P1D…); null for a one-off event. */
  recurrence?: string | null;
  /** the provider's sport slug; null for an event that is not a game. */
  sport?: string | null;
  /** the game's scheduled start, for a sports event. */
  gameStartTime?: string | null;
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
  /** the first market's question when the event holds more than one market; null otherwise. */
  leadingQuestion?: string | null;
  /** the provider's series cadence as an ISO-8601 duration (PT5M, PT1H, P1D…); null for a one-off event. */
  recurrence?: string | null;
  /** the provider's sport slug; null for an event that is not a game. */
  sport?: string | null;
  /** the game's scheduled start, for a sports event. */
  gameStartTime?: string | null;
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
  /** the route's own cost breakdown, USD; null when the provider stated none. */
  costs?: Readonly<{
    contractsUsd: number;
    venueFeesUsd: number;
    builderFeeUsd: number;
    bridgeUsd: number;
    gasUsd: number;
    appFeeUsd: number | null;
    appFeeBips: number | null;
    referralUsd: number | null;
    setupUsd: number | null;
    totalUsd: number;
  }> | null;
  /** each venue's own quote for the same order. */
  solos?: readonly Readonly<{ venue: string; status: string; shares: number; avgPrice: number | null; directCostUsd: number | null; unavailableReason: string | null; levels?: readonly Readonly<{ price: number; qty: number }>[] }>[];
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

/** The Review of an order — `live` is real money, `paper` simulated: `canPlace` is false exactly when `blockedBy` names a refusing check. */
export type PredictionPaperReview = Readonly<{
  mode: "paper" | "live";
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
  /** a buy's cost line by line, Ryntra's fee, the total, and a saving against the cheapest single venue only where it is true; null on a sell. */
  costs?: Readonly<{
    lines: readonly Readonly<{ id: "contracts" | "venue" | "ryntra" | "gas" | "bridge" | "setup" | "referral"; usd: number | null }>[];
    ryntra: Readonly<{ bips: number; usd: number; charged: boolean }>;
    totalUsd: number;
    saving: Readonly<{ usd: number; venue: string; venueCostUsd: number }> | null;
  }> | null;
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

/** `POST /api/predictions/link/start` — no body, or the bot check's token after a CHALLENGE_REQUIRED. */
export type PredictionsLinkStartRequest = Readonly<{ turnstileToken?: string }>;

export type PredictionsLinkVerifyRequest = Readonly<{ message: string; signature: string; encoding?: "base64" | "base58" | "hex" }>;

export type PredictionsQuoteRequest = Readonly<{
  eventId: string;
  venueMarketId: string;
  outcomeId: string;
  side: "buy" | "sell";
  spendUsd?: number;
  sellShares?: number;
  planId?: string | null;
  locale?: "en" | "uk";
  mode?: "paper" | "live";
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
  /** The provider's own word on whether this person may trade from where they are; null when not read. */
  access: Readonly<{ locationBlocked: boolean; venueAccounts?: readonly Readonly<{ venue: string; status: string; kycStatus: string }>[] | null }> | null;
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
/** 1.31.0: a rule's price condition as it stands — on a token of the venue's list, with the market price when the rule was turned on (`referenceUsd`, `referenceAt`); absent on a company's rule. */
export type RulePriceConditionState = Readonly<{ limitPct: number; referenceUsd?: number; referenceAt?: string }>;
/** 1.31.0: what a rule may name — a tokenized stock, a coin the venue verified, a meme or a token the venue has not verified. */
export type RuleAssetClass = "stock" | "crypto" | "meme";
/** 1.31.0: `met` the token stands on the floor · `below` its liquidity or its age is under it · `unavailable` a figure is missing or old. */
export type RuleFloorVerdict = "met" | "below" | "unavailable";
/** 1.31.0: one judgement of the floor a rule's token of the venue's list stands on. */
export type RuleFloorCheck = Readonly<{
  verdict: RuleFloorVerdict;
  liquidityUsd: number | null;
  floorUsd: number;
  ageHours: number | null;
  minAgeHours: number;
  dataAt: string | null;
  checkedAt: string;
}>;
/** 1.18.0: `met` · `above` the price is over the limit · `stale` the data are older than the freshness bound · `unavailable` a figure is missing. */
export type RuleConditionVerdict = "met" | "above" | "stale" | "unavailable";
/** 1.18.0: PreStocks' valuation of one token · the issuer's reference per share · the market feed's; 1.31.0: a token's market price when its rule was turned on. */
export type RulePriceReference = "prestocks" | "issuer" | "market" | "enabled";
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
  /** 1.31.0: on a rule's token of the venue's list, the floor's judgement that opened or deferred it; absent on a company's rule. */
  floor?: RuleFloorCheck;
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
  /** The company as a person names it («Apple»); 1.31.0: a token's symbol («SOL»). */
  name: string;
  /** The sum every purchase is; 1.19.0: on a «З кожної оплати» rule, the least sum a reminder opens at. */
  amountUsd: number;
  /** Null on a «Якщо впаде» rule (1.13.0) and a «З кожної оплати» one (1.19.0). */
  schedule: RuleSchedule | null;
  /** 1.13.0: null on the other kinds. */
  dip: RuleDip | null;
  /** 1.19.0: a «З кожної оплати» rule's terms and what waits; null on the other kinds. */
  payments: RulePayments | null;
  /** 1.18.0: «Умова ціни»; null — no condition. 1.31.0: on a token of the venue's list, with the price it stands against. */
  priceCondition: RulePriceConditionState | null;
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

/**
 * 1.31.0: `GET /api/v1/rules/asset?mint=` — what a rule on a token would
 * stand on: the asset, its class, the price now, the reference a condition
 * would stand against, and on a token of the venue's list the floor and the
 * facts of its risk; `refusal` why no rule can name it, null when one can.
 */
export type RuleAssetRead = Readonly<{
  asset: PlanAsset;
  name: string;
  class: RuleAssetClass;
  priceUsd: number | null;
  priceAt: string | null;
  reference: RulePriceReference | null;
  floor: RuleFloorCheck | null;
  risk: Readonly<{
    verified: boolean;
    ageHours: number | null;
    liquidityUsd: number | null;
    topHoldersPct: number | null;
    mintAuthorityDisabled: boolean | null;
    freezeAuthorityDisabled: boolean | null;
    organicScore: number | null;
  }> | null;
  refusal: Readonly<{ code: "ASSET_UNCONFIRMED" | "RULE_LIQUIDITY_LOW"; message: string }> | null;
  observedAt: string;
}>;
export type RuleAssetResponse = Readonly<{ read: RuleAssetRead }>;

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
  /** 1.78.0 — what arrived in the requested token so far, summed over every payment, and what its own transfer fee withheld; null while nothing arrived. */
  received: Readonly<{ raw: string; amount: string; feeWithheldRaw: string | null; feeWithheld: string | null }> | null;
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
  /** 1.78.0 — what arrived in the requested token so far, and what its own transfer fee withheld of it. */
  received: Readonly<{ raw: string; feeWithheldRaw: string | null }> | null;
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
    /** How long from arriving the payer may still sign: the bytes' life (~30 s) less a margin. Past it, prepare again. */
    signableMs: number;
  }>;
}>;

export type PayTransactionError = Readonly<{ error: Readonly<{ code: PayTransactionErrorCode; message: string }> }>;

/** `POST /api/pay/{id}/submit` — the intent and the bytes the wallet signed. */
export type PaySubmitRequest = Readonly<{ intentId: string; signedWireBase64: string }>;

/** Sent once: the signature, and the link as its page now reads it. */
export type PaySubmitResponse = Readonly<{ data: Readonly<{ signature: string; view: PayPublicView | null }> }>;

export type PaySubmitError = Readonly<{ error: Readonly<{ code: PaySubmitErrorCode; message: string }> }>;

/* ------------------------------------------------------------ 1.25.0 — Ryntra Launch */

/**
 * «Запустити токен» — one set of routes for the web and the phone, served only
 * where `capabilities.launch` is present. No bearer or cookie: the creator's
 * signature inside the transaction is the proof. The phone signs with its
 * wallet the bytes `build` returns (the creation and, when chosen, the lock)
 * and hands both to `submit` unchanged.
 */
/** 1.38.0: `micro` for people, `demo` — Ryntra's technical validation, never in the presets for people. */
/** 1.80.0: `rules` — «Правила на кривій» (SOL-L8), offered only where its format is. */
export type LaunchPresetId = "classic" | "protected" | "community" | "micro" | "demo" | "advanced" | "rules";
export type LaunchLockId = "1m-3m" | "3m-6m" | "6m-12m";
export type LaunchNetworkId = "solana:devnet" | "solana:mainnet";

export type LaunchPreset = Readonly<{
  id: LaunchPresetId;
  name: Readonly<{ uk: string; en: string }>;
  pair: Readonly<{ mint: string; symbol: string; decimals: number }>;
  startMarketCapUsd: number;
  graduationMarketCapUsd: number;
  sniperFee: Readonly<{ startBps: number; endBps: number; seconds: number }>;
  creatorTradingFeePct: number;
  graduationFee: Readonly<{ pct: number; creatorPct: number }>;
  firstBuyCapBps: number;
  /** 1.38.0: a first purchase must go under the creator's lock with at least this many days before anything unlocks; null — the creator's choice. */
  creatorLockMinDays: number | null;
  /** 1.38.0: the pair currency a curve must raise to reach the DEX (Micro: 750); null — named by its market cap. */
  graduationQuote: number | null;
  /** 1.38.0: the demo market — Ryntra's technical validation. */
  technicalValidation: boolean;
  lpLockedForeverPct: 100;
  /** 1.80.0 — SOL-L8: this preset's token runs Ryntra's rules on purchases until the DEX, so no mark says «no rule on transfers» on it. */
  curveRules?: true;
  /** 1.50.0 — who receives every fee, basis points of it: the curve, the same through Ryntra, the move to the DEX, the DEX pool. */
  terms?: Readonly<{
    curveSplit: LaunchFeeShares;
    curveSplitThroughRyntra: LaunchFeeShares;
    graduation: Readonly<{ feeBps: number; creatorBps: number; ryntraBps: number; toBudget: boolean }>;
    pool: Readonly<{ startFeeBps: number; endFeeBps: number; meteoraBps: number; compoundingBps: number; creatorPositionBps: number; ryntraPositionBps: number }>;
  }>;
}>;

/** `GET /api/v1/launch/presets` */
export type LaunchPresetsResponse = Readonly<{
  network: LaunchNetworkId;
  presets: readonly LaunchPreset[];
  /** 1.56.0 — «Спільнота»'s community tokens, each with its own config; absent or empty — one pair, the preset's own. */
  communities?: readonly Readonly<{ config: string; mint: string; symbol: string; decimals: number }>[];
  /** 1.56.0 — the formats of «Розширені параметри» offered here; each null where it is not (on mainnet until the operator's bounds). */
  formats?: Readonly<{
    advanced: Readonly<{ bounds: LaunchAdvancedBounds }> | null;
    boost?: Readonly<{ bounds: LaunchBoostBounds }> | null;
    earlyAccess?: Readonly<{ bounds: LaunchEarlyAccessBounds }> | null;
    /** 1.80.0 — SOL-L8: null until the operator opens the format after the independent audit of its rule program. */
    curveRules?: LaunchCurveRulesFormat | null;
  }>;
  locks: readonly Readonly<{ id: LaunchLockId; cliffDays: number; vestDays: number }>[];
  limits: Readonly<{ nameMax: number; symbolMax: number; descriptionMax: number; imageMaxBytes: number; imageTypes: readonly string[]; launchesPerDay: number }>;
}>;

/** `POST /api/v1/launch/metadata` — the picture's bytes as base64, the fields as typed. */
export type LaunchMetadataRequest = Readonly<{ name: string; symbol: string; description: string; website: string; x: string; telegram: string; imageBase64: string }>;
export type LaunchMetadataResponse = Readonly<{ metadataUri: string; imageUrl: string; name: string; symbol: string }>;

/** `POST /api/v1/launch/quote` */
export type LaunchQuoteRequest = Readonly<{
  preset: LaunchPresetId;
  amountRaw: string;
  /** 1.56.0: «Спільнота» — the community token the curve pairs against. */
  pairMint?: string;
  /** 1.56.0: «Розширений» — the config the creator made for the launch. */
  advancedConfig?: string;
}>;
export type LaunchQuoteResponse = Readonly<{ preset: LaunchPresetId; pairMint: string; amountInRaw: string; tokensOutRaw: string; capRaw: string; maxAmountInRaw: string; withinCap: boolean }>;

/** `POST /api/v1/launch/build` */
export type LaunchBuildRequest = Readonly<{
  creator: string;
  preset: LaunchPresetId;
  metadataUri: string;
  firstBuyRaw: string;
  lock: LaunchLockId | null;
  /** 1.29.0, «Спільнота» only: the creator's fees shared — the creator among two to five wallets, basis points adding up to 10 000. */
  feeShares?: readonly LaunchFeeShare[];
  /** The creator's partner: "offered" — the one the review showed; "none" — removed; a code or `/r/<code>` link — another in its place. Absent — no partner is bound. */
  partner?: "offered" | "none" | Readonly<{ code: string }>;
  /** 1.56.0, «Спільнота» only: the community token to pair against. */
  pairMint?: string;
  /** 1.56.0, «Розширений» only, and always: the config the creator made for this launch. */
  advancedConfig?: string;
  /** 1.71.0: "v1" — the wallet signs v1; on Micro and the demo market the only way a first purchase (and its lock, in the same transaction) is built. */
  format?: "v1";
  /** 1.74.0, Classic and Protected: the crew whose members said yes — the vault's rows are read from it on the server; with it, no `feeShares`. */
  crew?: string;
}>;
/** One fee split, basis points of it (1.50.0). */
export type LaunchFeeShares = Readonly<{ creatorBps: number; ryntraBps: number; meteoraBps: number }>;
/** One wallet's share of a launch's creator fees, whole basis points (at least 100). */
export type LaunchFeeShare = Readonly<{ address: string; bps: number }>;
export type LaunchBuildResponse = Readonly<{
  buildId: string;
  network: LaunchNetworkId;
  unsignedWireBase64: string;
  lockUnsignedWireBase64: string | null;
  token: string;
  firstBuyOutRaw: string;
  payerCoveredLamports: string;
  creatorCostLamports: string;
  expiresAt: string;
  /** 1.29.0: the sharing of the creator's fees, signed already by the new mint; the creator signs it too. */
  splitUnsignedWireBase64?: string | null;
  feeVault?: string | null;
  /** The partner this build binds the pool to, masked as the review shows it; null — none. */
  partner?: Readonly<{ partnerMasked: string; codeMasked: string; source: "previous" | "inviter" | "carried" | "chosen" | "none" }> | null;
}>;

/** `POST /api/v1/launch/submit` */
export type LaunchSubmitRequest = Readonly<{ buildId: string; creator: string; signedWireBase64: string; signedLockWireBase64: string | null; signedSplitWireBase64?: string | null }>;
export type LaunchLock = Readonly<{ schedule: LaunchLockId; escrow: string; signature: string | null; state: "LOCKED" | "PENDING" | "FAILED"; reason: string | null }>;
/** 1.29.0: «Спільнота» sharing the creator's fees — SHARED once the vault holds the curve's creator role; FAILED, the creator keeps every fee. */
export type LaunchFeeSharing = Readonly<{ vault: string; shares: readonly LaunchFeeShare[]; signature: string | null; state: "SHARED" | "PENDING" | "FAILED"; reason: string | null }>;
export type LaunchSubmitResponse = Readonly<{ token: string; signature: string; state: "LAUNCHED" | "PENDING"; lock: LaunchLock | null; feeSharing?: LaunchFeeSharing | null; tokenPath: string }>;

export type LaunchMarkCode =
  | "MINT_REVOKED"
  | "NO_FREEZE"
  | "METADATA_FIXED"
  | "NO_TRANSFER_HOOK"
  | "TRANSFER_FEE_UNTIL_DEX"
  /** 1.80.0 — SOL-L8: Ryntra's rules on purchases until the DEX, in place of «no rule on transfers». */
  | "CURVE_RULES_UNTIL_DEX"
  | "CURVE_HOLDS_FUNDS"
  | "LP_LOCKED_FOREVER"
  | "CREATOR_BUY_LOCKED";

/** 1.80.0 — SOL-L8: the rules of Ryntra's verified set, the rules that lock a buyer in, and how a rule program may be changed. */
export type LaunchCurveRuleId = "WALLET_CAP" | "ANTI_BUNDLE" | "CREATOR_VESTING" | "SNIPER_CEILING";
export type LaunchLockedInRuleId =
  | "SELL_FORBIDDEN"
  | "SELL_ALLOWLIST"
  | "SELL_CAP_PER_PERIOD"
  | "TRANSFER_ALLOWLIST"
  | "TRANSFER_BLOCKLIST"
  | "TRANSFERS_PAUSABLE"
  | "FORCED_TRANSFER"
  | "BALANCE_FREEZE";
export type LaunchCurveRulesUpgrade = "FROZEN" | "MULTISIG";
export type LaunchCurveHookPhase = "CURVE" | "REMOVED" | "OUTSIDE_RULE";
export type LaunchCurveRulesFormat = Readonly<{
  rules: readonly Readonly<{ id: LaunchCurveRuleId; bounds: Readonly<Record<string, Readonly<{ min: number; max: number }>>> }>[];
  forbidden: readonly Readonly<{ id: LaunchLockedInRuleId; reason: string }>[];
  scope: "UNTIL_DEX";
  side: "PURCHASE";
  program: Readonly<{ program: string; upgrade: LaunchCurveRulesUpgrade; upgradeAuthority: string | null; audit: string }>;
}>;

/** «Комісія за переказ» (SOL-L10): where a launch's RevokeZeroFee timeline stands. */
export type LaunchTransferFeePhase = "CURVE" | "ZERO_SCHEDULED" | "ZERO" | "OUTSIDE_RULE";

/** The launch receipt's facts, as the chain shows them; every mark names the account where anyone can see it. */
export type LaunchReceiptFacts = Readonly<{
  source: "ryntra.solana.launch-receipt.facts@1";
  network: "solana";
  cluster: "mainnet" | "devnet";
  preset: LaunchPresetId;
  config: string;
  token: string;
  pool: string;
  creator: string;
  created: Readonly<{ signature: string; slot: number; at: string | null }>;
  creatorFirstBuy: Readonly<{ quoteInRaw: string; tokensOutRaw: string; capRaw: string }> | null;
  creatorLock?: Readonly<{ escrow: string; lockedRaw: string; cliffAt: string; endsAt: string }> | null;
  /** 1.29.0: the vault holding the curve's creator role and the shares written in it, from the chain. */
  feeSharing?: Readonly<{ vault: string; shares: readonly LaunchFeeShare[] }> | null;
  token2022: Readonly<{
    supplyRaw: string;
    decimals: number;
    mintAuthority: null;
    freezeAuthority: null;
    /** 1.80.0 — SOL-L8: the audited rule program while the token is on its curve; null on every other launch and after the DEX. */
    transferHookProgram: string | null;
    metadataUpdateAuthority: null;
    metadataPointerAuthority: null;
    extensions: readonly ("MetadataPointer" | "TokenMetadata" | "TransferFeeConfig" | "TransferHook")[];
  }>;
  /** SOL-L10: the token's fee on transfers until the DEX, from the chain; absent or null — none. */
  transferFee?: Readonly<{
    bps: number;
    mode: "REVOKE_ZERO_FEE";
    withdrawAuthority: string;
    phase: Exclude<LaunchTransferFeePhase, "OUTSIDE_RULE">;
    bpsNow: number;
    zeroFromEpoch: string | null;
    epoch: string;
  }> | null;
  /**
   * 1.80.0 — SOL-L8: «Правила на кривій». `program` and `phase` are read from the chain; `rules`, `upgrade`,
   * `upgradeAuthority` and `audit` are the launch's own record, and `program` is the account where anyone checks the
   * governance. Absent or null — the token runs no rule on a transfer.
   */
  curveRules?: Readonly<{
    program: string;
    scope: "UNTIL_DEX";
    phase: Exclude<LaunchCurveHookPhase, "OUTSIDE_RULE">;
    rules: readonly LaunchCurveRuleId[];
    upgrade: LaunchCurveRulesUpgrade;
    upgradeAuthority: string | null;
    audit: string;
  }> | null;
  curve: Readonly<{ quoteReserveRaw: string; migrationQuoteThresholdRaw: string; progressBps: number; migrated: boolean }>;
  graduated: Readonly<{
    pool: string;
    compounding: true;
    compoundingFeeBps: number;
    feeFallsWithMarketCap: true;
    positions: readonly Readonly<{ position: string; owner: string; permanentLockedLiquidity: string }>[];
  }> | null;
  marks: readonly Readonly<{ code: LaunchMarkCode; account: string }>[];
  observedAt: string;
}>;

/** `GET /api/v1/launch/{mint}` */
export type LaunchTokenResponse = Readonly<{
  network: LaunchNetworkId;
  token: string;
  name: string;
  symbol: string;
  description: string;
  image: string | null;
  links: Readonly<{ website: string | null; x: string | null; telegram: string | null }>;
  preset: LaunchPresetId;
  creator: string;
  launchedAt: string;
  signature: string;
  progressBps: number | null;
  migrated: boolean | null;
  lock: (LaunchLock & Readonly<{ cliffAt: string | null; endsAt: string | null }>) | null;
  /** 1.29.0 */
  feeSharing?: LaunchFeeSharing | null;
  receipt: LaunchReceiptFacts | null;
  receiptProblems: readonly string[];
  shareLink: string;
  /** 1.55.0 — the metadata and picture: by sha256, their IPFS address, and their pinned IPFS copy (null until pinned). */
  storage?: Readonly<{ metadata: LaunchStoredFile; image: LaunchStoredFile | null }> | null;
  /** 1.56.0 — «Розширений»: the launch's own numbers and what makes its tokenomics unusual; absent or null on a preset's launch. */
  advanced?: Readonly<{ terms: LaunchAdvancedTerms; unusual: readonly LaunchUnusualReason[] }> | null;
  /** 1.56.0 — «Спільнота»: the community token the curve pairs against. */
  pair?: Readonly<{ mint: string; symbol: string; decimals: number }>;
  /** 1.73.0 (SOL-L12) — the pair currency's watch; absent or null while not read. */
  pairWatch?: LaunchPairWatch | null;
  observedAt: string;
}>;

/** 1.55.0 — a file Ryntra keeps for a launch: its sha256, its IPFS address (CID v1 raw), its pinned IPFS copy. */
export type LaunchStoredFile = Readonly<{ sha256: string; cid: string; ipfs: Readonly<{ url: string; pinnedAt: string }> | null }>;

/* ------------------------------------------------------------ 1.56.0 — Формати запуску 2 */

/** 1.56.0 — «Розширений»: what the creator chooses in «Розширені параметри». */
export type LaunchAdvancedChoice = Readonly<{
  /** Whole tokens, one of the bounds' supplies. */
  supply: number;
  startMarketCapUsd: number;
  graduationMarketCapUsd: number;
  /** The creator's share of the curve's fee after Meteora's 20 %, percent. */
  creatorTradingFeePct: number;
  sniper: LaunchSniperStrength;
  poolStartFeeBps: number;
  poolEndFeeBps: number;
  /** 1.72.0 (SOL-L10): «Комісія за переказ» until the DEX, basis points; absent — none. */
  transferFeeBps?: number;
}>;
export type LaunchSniperStrength = "standard" | "strong";
export type LaunchUnusualReason = "SUPPLY" | "STEEP" | "FLAT" | "LOW_START" | "HIGH_CREATOR_SHARE" | "SOFT_SNIPERS";
type LaunchRange = Readonly<{ min: number; max: number }>;
/** 1.56.0 — a launch's own numbers as kept: the choice and the bounds' part in force when its config was made. */
export type LaunchAdvancedTerms = LaunchAdvancedChoice & Readonly<{ graduationFee: Readonly<{ pct: number; creatorPct: number }>; firstBuyCapBps: number }>;
/** 1.56.0 — the bounds the operator approved for «Розширений» on this network. */
export type LaunchAdvancedBounds = Readonly<{
  supplies: readonly number[];
  startMarketCapUsd: LaunchRange;
  graduationMarketCapUsd: LaunchRange;
  multiple: LaunchRange;
  creatorTradingFeePct: LaunchRange;
  snipers: readonly LaunchSniperStrength[];
  poolStartFeeBps: LaunchRange;
  poolEndFeeBps: LaunchRange;
  graduationFee: Readonly<{ pct: number; creatorPct: number }>;
  firstBuyCapBps: number;
  /** 1.72.0 (SOL-L10): the ceiling of «Комісія за переказ» where it is offered; absent — not offered. */
  transferFeeMaxBps?: number;
}>;

/** `POST /api/v1/launch/advanced/config/build` (1.56.0) — the launch's own config, the creator's transaction before the launch's. */
export type LaunchAdvancedConfigBuildRequest = Readonly<{ creator: string; choice: LaunchAdvancedChoice }>;
export type LaunchAdvancedConfigBuildResponse = Readonly<{
  buildId: string;
  network: LaunchNetworkId;
  config: string;
  unsignedWireBase64: string;
  terms: LaunchAdvancedTerms;
  /** The creator's SOL the config takes as simulated; null when the network would not say. */
  creatorCostLamports: string | null;
  expiresAt: string;
  signableMs: number;
}>;
/** `POST /api/v1/launch/advanced/config/submit` (1.56.0) */
export type LaunchAdvancedConfigSubmitRequest = Readonly<{ buildId: string; creator: string; signedWireBase64: string }>;
export type LaunchAdvancedConfigSubmitResponse = Readonly<{ config: string; signature: string; state: "CREATED" | "PENDING"; terms: LaunchAdvancedTerms }>;

/** 1.56.0 — Launch Boost: what the bonus is paid in (the pair currency or the token) and which purchases count. */
export type LaunchBoostCurrencyId = "PAIR" | "TOKEN";
export type LaunchBoostRoute = "ryntra" | "any";
/** 1.56.0 — the bounds a campaign stays inside on this network. */
export type LaunchBoostBounds = Readonly<{
  currencies: readonly LaunchBoostCurrencyId[];
  routes: readonly LaunchBoostRoute[];
  minBonusBps: number;
  maxBonusBps: number;
  minMinutes: number;
  maxDays: number;
  maxStartDays: number;
  minHoldHours: number;
  maxHoldHours: number;
  minBuyFloorRaw: string;
  maxCapShareBps: number;
  maxBudgetRaw: Readonly<{ PAIR: string | null; TOKEN: string | null }>;
}>;
/** 1.56.0 — a campaign's rules, as kept and read. */
export type LaunchBoostRules = Readonly<{
  currency: LaunchBoostCurrencyId;
  bonusBps: number;
  minBuyRaw: string;
  capPerWalletRaw: string;
  budgetRaw: string;
  /** Unix seconds. */
  startsAt: number;
  endsAt: number;
  holdHours: number;
  routes: LaunchBoostRoute;
}>;
/** The rules as sent: `routes` defaults to "ryntra". */
export type LaunchBoostRulesInput = Omit<LaunchBoostRules, "routes"> & Readonly<{ routes?: LaunchBoostRoute }>;
export type LaunchBoostLines = Readonly<{ uk: readonly string[]; en: readonly string[] }>;
export type LaunchBoostCurrency = Readonly<{ mint: string; symbol: string; decimals: number; program: string }>;

/** `POST /api/v1/launch/{mint}/boost/build` (1.56.0) */
export type LaunchBoostBuildRequest = Readonly<{ creator: string; rules: LaunchBoostRulesInput }>;
export type LaunchBoostBuildResponse = Readonly<{
  buildId: string;
  network: LaunchNetworkId;
  /** The commitment for the creator to sign first — the fee payer; the escrow's fresh base key signs after. */
  unsignedWireBase64: string;
  escrow: string;
  currency: LaunchBoostCurrency;
  budgetRaw: string;
  /** From when purchases count, and when the budget unlocks for the payout (unix seconds). */
  countsFrom: number;
  unlocksAt: number;
  lines: LaunchBoostLines;
  expiresAt: string;
  signableMs: number;
}>;
/** `POST /api/v1/launch/{mint}/boost/submit` (1.56.0) */
export type LaunchBoostSubmitRequest = Readonly<{ buildId: string; creator: string; signedWireBase64: string }>;
export type LaunchBoostSubmitResponse = Readonly<{ state: "LOCKED" | "PENDING" | "FAILED"; signature: string; escrow: string; reason: string | null }>;
/** `POST /api/v1/launch/{mint}/boost/payout/build` (1.56.0) */
export type LaunchBoostPayoutBuildRequest = Readonly<{ creator: string }>;
export type LaunchBoostPayoutBuildResponse = Readonly<{
  buildId: string;
  network: LaunchNetworkId;
  /** The creator signs every one in one window: the escrow claimed back first, then the transfers. */
  unsignedWireBase64: readonly string[];
  rows: readonly Readonly<{ wallet: string; bonusRaw: string; firstBuyAt: number; signature: string }>[];
  remaining: number;
  totalRaw: string;
  leftoverRaw: string;
  claimsEscrow: boolean;
  currency: LaunchBoostCurrency;
  expiresAt: string;
  signableMs: number;
}>;
/** `POST /api/v1/launch/{mint}/boost/payout/submit` (1.56.0) */
export type LaunchBoostPayoutSubmitRequest = Readonly<{ buildId: string; creator: string; signedWireBase64: readonly string[] }>;
export type LaunchBoostPayoutSubmitResponse = Readonly<{
  state: "PAID" | "PARTIAL" | "PENDING";
  txs: readonly Readonly<{ signature: string; state: "CONFIRMED" | "PENDING" | "FAILED"; wallets: number; amountRaw: string; reason: string | null }>[];
  paidRaw: string;
}>;
/** `GET /api/v1/launch/{mint}/boost` (1.56.0) — the campaign as shown before a purchase; NOT_READ — the figures that need the chain are null, never zero. */
export type LaunchBoostView = Readonly<{
  network: LaunchNetworkId;
  token: string;
  state: "PENDING" | "LOCKED" | "FAILED";
  read: "OK" | "NOT_READ";
  rules: LaunchBoostRules;
  lines: LaunchBoostLines;
  escrow: string;
  currency: LaunchBoostCurrency;
  countsFrom: number;
  unlocksAt: number;
  funded: Readonly<{ totalRaw: string; heldRaw: string; claimedRaw: string }> | null;
  payout: Readonly<{
    state: "NOT_READ" | "WAITING" | "READY" | "PENDING" | "PARTIAL" | "PAID";
    recipients: number | null;
    plannedRaw: string | null;
    paidRaw: string;
    leftoverRaw: string | null;
    signatures: readonly string[];
  }>;
  observedAt: string;
}>;

/** 1.69.0 — the creator's rule: each bucket's part of the creator's own share, whole basis points adding up to 10 000. */
export type LaunchSplitRule = Readonly<{ shares: Readonly<{ self: number; depth: number; community: number; holders: number }>; community: string | null }>;
type LaunchSplitTxState = "PENDING" | "CONFIRMED" | "FAILED";
type LaunchSplitGiven = Readonly<{ depth: string; community: string; holders: string }>;
type LaunchSplitExcluded = Readonly<{ wallets: number; amountRaw: string }>;
/** 1.69.0 — who a round left out and why; `unbought` — tokens held beyond what the wallet bought on the market. */
export type LaunchSplitSnapshot = Readonly<{
  eligible: number;
  excluded: Readonly<{ creator: LaunchSplitExcluded; linked: LaunchSplitExcluded; bundle: LaunchSplitExcluded; program: LaunchSplitExcluded; ryntra: LaunchSplitExcluded; unbought: LaunchSplitExcluded }>;
}>;
/** 1.69.0 — POOL: the token's DLMM pool made; SYNC: its price taken up to the market's; STEPS: the creator's steps placed. */
export type LaunchSplitDepthPhase = "POOL" | "SYNC" | "STEPS";
/** 1.69.0 — `POST /api/v1/launch/{mint}/split/rule/build`. */
export type LaunchSplitRuleBuildRequest = Readonly<{ creator: string; rule: LaunchSplitRule }>;
export type LaunchSplitRuleBuildResponse = Readonly<{
  buildId: string;
  network: LaunchNetworkId;
  unsignedWireBase64: string;
  memo: string;
  rule: LaunchSplitRule;
  lines: LaunchBoostLines;
  expiresAt: string;
  signableMs: number;
}>;
/** 1.69.0 — the signed rule or depth act: one transaction. */
export type LaunchSplitSubmitRequest = Readonly<{ buildId: string; creator: string; signedWireBase64: string }>;
export type LaunchSplitRuleSubmitResponse = Readonly<{ state: LaunchSplitTxState; signature: string; reason: string | null }>;
/** 1.69.0 — a depth act or a payout asked for. */
export type LaunchSplitActBuildRequest = Readonly<{ creator: string }>;
export type LaunchSplitDepthBuildResponse = Readonly<{
  buildId: string;
  network: LaunchNetworkId;
  phase: LaunchSplitDepthPhase;
  unsignedWireBase64: string;
  pool: string;
  position: string | null;
  amountRaw: string;
  owedRaw: string;
  ladder: Readonly<{ lowerBinId: number; upperBinId: number; fromPct: number; toPct: number }> | null;
  expiresAt: string;
  signableMs: number;
}>;
export type LaunchSplitDepthSubmitResponse = LaunchSplitRuleSubmitResponse & Readonly<{ phase: LaunchSplitDepthPhase; position: string | null; amountRaw: string }>;
export type LaunchSplitPayoutBuildResponse = Readonly<{
  buildId: string;
  network: LaunchNetworkId;
  unsignedWireBase64: readonly string[];
  round: number;
  root: string;
  memo: string;
  rows: readonly Readonly<{ wallet: string; holdingRaw: string; amountRaw: string }>[];
  community: Readonly<{ wallet: string; amountRaw: string }> | null;
  holdersRaw: string;
  communityRaw: string;
  owed: Readonly<{ holdersRaw: string; communityRaw: string }>;
  snapshot: LaunchSplitSnapshot | null;
  pair: Readonly<{ mint: string; program: string; decimals: number; symbol: string; usdPrice: number; dollar: boolean }>;
  expiresAt: string;
  signableMs: number;
}>;
export type LaunchSplitPayoutSubmitRequest = Readonly<{ buildId: string; creator: string; signedWireBase64: readonly string[] }>;
export type LaunchSplitPayoutSubmitResponse = Readonly<{
  state: "PAID" | "PARTIAL" | "PENDING";
  round: number;
  txs: readonly Readonly<{ signature: string; state: LaunchSplitTxState; memo: boolean; wallets: number; amountRaw: string; reason: string | null }>[];
  paidRaw: string;
}>;
/** `GET /api/v1/launch/{mint}/split` (1.69.0) — the creator's division of their own share; NOT_READ — the figures that need the chain are null, never zero. */
export type LaunchSplitView = Readonly<{
  network: LaunchNetworkId;
  token: string;
  creator: string;
  open: boolean;
  read: "OK" | "NOT_READ";
  rule: LaunchSplitRule | null;
  since: number | null;
  pendingRule: LaunchSplitRule | null;
  segments: readonly Readonly<{ rule: LaunchSplitRule; since: number; signature: string; fromEarnedRaw: string }>[];
  lines: LaunchBoostLines;
  pair: Readonly<{ mint: string; symbol: string; decimals: number; dollar: boolean }>;
  ledger: Readonly<{
    earnedRaw: string;
    claimedRaw: string;
    subjectRaw: string;
    due: LaunchSplitGiven & Readonly<{ self: string }>;
    done: LaunchSplitGiven;
    owed: LaunchSplitGiven;
    warnings: readonly ("ROLE_MOVED" | "LP_MOVED")[];
  }> | null;
  minimums: Readonly<{ depthRaw: string; communityRaw: string; holdersRoundRaw: string; perHolderRaw: string }>;
  depth: Readonly<{
    pool: string | null;
    rule: Readonly<{ topGapPct: number; deepestPct: number; maxBins: number; minBinStep: number }>;
    placements: readonly Readonly<{
      kind: LaunchSplitDepthPhase;
      signature: string;
      validUntil: string;
      state: LaunchSplitTxState;
      reason: string | null;
      pool: string;
      position: string | null;
      amountRaw: string;
      lowerBinId: number | null;
      upperBinId: number | null;
      at: string;
    }>[];
    steps: readonly Readonly<{ position: string; pool: string; lowerBinId: number; upperBinId: number; pairRaw: string | null; tokenRaw: string | null; feePairRaw: string | null }>[];
  }>;
  rounds: readonly Readonly<{
    round: number;
    root: string;
    rows: readonly Readonly<{ wallet: string; holdingRaw: string; amountRaw: string }>[];
    community: Readonly<{ wallet: string; amountRaw: string }> | null;
    snapshot: LaunchSplitSnapshot | null;
    txs: readonly Readonly<{ signature: string; validUntil: string; state: LaunchSplitTxState; reason: string | null; memo: boolean; wallets: readonly string[]; holdersRaw: string; communityRaw: string }>[];
    at: string;
  }>[];
  observedAt: string;
}>;

/** 1.56.0 — early access: FCFS or Pro Rata, and the phase the launch is in. */
export type LaunchEarlyAccessMode = "FCFS" | "PRO_RATA";
export type LaunchEarlyAccessPhase = "UPCOMING" | "DEPOSITS" | "FILLING" | "VESTING" | "DONE";
/** 1.56.0 — the bounds early access stays inside on this network. */
export type LaunchEarlyAccessBounds = Readonly<{
  modes: readonly LaunchEarlyAccessMode[];
  minCapRaw: string;
  maxCapRaw: string;
  minIndividualCapRaw: string;
  minDepositMinutes: number;
  maxDepositHours: number;
  maxStartDelayHours: number;
  minVestingHours: number;
  maxVestingHours: number;
  minStartMarketCapUsd: number;
  maxStartMarketCapUsd: number;
  maxPresaleBps: number;
}>;
/** 1.56.0 — an early-access launch's rules, as kept and read (unix seconds). */
export type LaunchEarlyAccessRules = Readonly<{
  mode: LaunchEarlyAccessMode;
  depositStartsAt: number;
  depositEndsAt: number;
  maxCapRaw: string;
  individualCapRaw: string | null;
  vestingHours: number;
  startMarketCapUsd: number;
  supply: number;
}>;
/** The rules as sent: `supply` defaults to 1 000 000 000. */
export type LaunchEarlyAccessRulesInput = Omit<LaunchEarlyAccessRules, "supply"> & Readonly<{ supply?: number }>;
export type LaunchEarlyAccessSchedule = Readonly<{ depositStartsAt: number; depositEndsAt: number; fillStartsAt: number; activatesAt: number; vestingStartsAt: number; vestingEndsAt: number }>;
export type LaunchEarlyAccessStep = Readonly<{ signature: string | null; state: "CONFIRMED" | "PENDING" | "FAILED" | "NOT_SENT"; reason: string | null }>;
export type LaunchEarlyAccessSteps = Readonly<{ MINT: LaunchEarlyAccessStep; POOL: LaunchEarlyAccessStep; VAULT: LaunchEarlyAccessStep }>;
export type LaunchEarlyAccessFill = Readonly<{
  spentRaw: string;
  feeRaw: string;
  tokensOutRaw: string;
  shareBps: number;
  averagePriceUsd: number;
  priceAfterUsd: number;
  marketCapAfterUsd: number;
  refundRaw: string;
}>;
export type LaunchEarlyAccessLines = Readonly<{ uk: readonly string[]; en: readonly string[] }>;

/** `POST /api/v1/launch/early-access/build` (1.56.0) */
export type LaunchEarlyAccessBuildRequest = Readonly<{ creator: string; metadataUri: string; rules: LaunchEarlyAccessRulesInput }>;
export type LaunchEarlyAccessBuildResponse = Readonly<{
  buildId: string;
  network: LaunchNetworkId;
  /** MINT, POOL, VAULT — the creator's wallet signs all three; sent in this order. */
  unsignedWireBase64: readonly string[];
  mint: string;
  pool: string;
  vault: string;
  schedule: LaunchEarlyAccessSchedule;
  lines: LaunchEarlyAccessLines;
  presaleBps: number;
  expiresAt: string;
  signableMs: number;
}>;
/** `POST /api/v1/launch/early-access/submit` (1.56.0) */
export type LaunchEarlyAccessSubmitRequest = Readonly<{ buildId: string; creator: string; signedWireBase64: readonly string[] }>;
export type LaunchEarlyAccessSubmitResponse = Readonly<{ mint: string; pool: string; vault: string; state: "PENDING" | "OPEN" | "PARTIAL"; steps: LaunchEarlyAccessSteps; tokenPath: string }>;
/** `POST /api/v1/launch/{mint}/early-access/deposit/build` (1.56.0) */
export type LaunchEarlyAccessDepositBuildRequest = Readonly<{ wallet: string; amountRaw: string }>;
export type LaunchEarlyAccessDepositBuildResponse = Readonly<{
  buildId: string;
  network: LaunchNetworkId;
  unsignedWireBase64: string;
  escrow: string;
  opensEscrow: boolean;
  amountRaw: string;
  expiresAt: string;
  signableMs: number;
}>;
/** `POST /api/v1/launch/{mint}/early-access/deposit/submit` (1.56.0) */
export type LaunchEarlyAccessDepositSubmitRequest = Readonly<{ buildId: string; wallet: string; signedWireBase64: string }>;
export type LaunchEarlyAccessDepositSubmitResponse = Readonly<{ state: "CONFIRMED" | "PENDING"; signature: string }>;
/**
 * `POST /api/v1/launch/{mint}/early-access/action/build` (1.56.0) — after the deposits: CLAIM the vested tokens,
 * WITHDRAW_REMAINING the unspent USDC, WITHDRAW a Pro Rata deposit (all unless `amountRaw` names a part), FILL the
 * vault's permissionless purchase.
 */
export type LaunchEarlyAccessAction = "CLAIM" | "WITHDRAW_REMAINING" | "WITHDRAW" | "FILL";
export type LaunchEarlyAccessActionBuildRequest = Readonly<{ wallet: string; action: LaunchEarlyAccessAction; amountRaw?: string | null }>;
export type LaunchEarlyAccessActionBuildResponse = Readonly<{
  buildId: string;
  network: LaunchNetworkId;
  unsignedWireBase64: string;
  action: LaunchEarlyAccessAction;
  /** What it moves as read at the build; null for FILL. */
  amountRaw: string | null;
  expiresAt: string;
  signableMs: number;
}>;
/** `POST /api/v1/launch/{mint}/early-access/action/submit` (1.56.0) */
export type LaunchEarlyAccessActionSubmitRequest = Readonly<{ buildId: string; wallet: string; signedWireBase64: string }>;
export type LaunchEarlyAccessActionSubmitResponse = Readonly<{ state: "CONFIRMED" | "PENDING"; signature: string }>;
/** `GET /api/v1/launch/{mint}/early-access[?wallet=]` (1.56.0) — a figure not read now is null, never zero. */
export type LaunchEarlyAccessViewResponse = Readonly<{
  network: LaunchNetworkId;
  mint: string;
  pool: string;
  vault: string;
  creator: string;
  name: string;
  symbol: string;
  rules: LaunchEarlyAccessRules;
  schedule: LaunchEarlyAccessSchedule;
  lines: LaunchEarlyAccessLines;
  state: LaunchEarlyAccessPhase;
  creation: Readonly<{ state: "PENDING" | "OPEN" | "PARTIAL"; steps: LaunchEarlyAccessSteps }>;
  terms: Readonly<{ startPriceUsd: number; presaleBps: number; ryntraShareBps: 0; atCap: LaunchEarlyAccessFill }>;
  read: "OK" | "MISSING" | "FAILED";
  depositedRaw: string | null;
  capRaw: string;
  depositors: string | null;
  boughtRaw: string | null;
  filled: boolean | null;
  atDeposited: LaunchEarlyAccessFill | null;
  chainProblems: readonly string[];
  mine: Readonly<{
    depositedRaw: string;
    claimableRaw: string;
    claimedRaw: string;
    allocatedRaw: string;
    remainingQuoteRaw: string;
    roomRaw: string | null;
    refunded: boolean;
  }> | null;
}>;

/* ------------------------------------------------------------ 1.27.0 — a launch's market and trading on it */

/**
 * The token's market as the chain shows it — `GET /api/v1/launch/{mint}/market`
 * — and a buy or a sale on its curve or, after graduation, in its pool:
 * quote, build (the wallet signs, the fee payer and only signer), submit (the
 * bytes unchanged but for the wallet's own fee and guard instructions). The
 * facts of risk are codes with figures: a client says them in its own words,
 * never as a verdict.
 */
export type LaunchTradeSide = "buy" | "sell";
export type LaunchTradeVenue = "curve" | "pool";
export type LaunchHolderLabel = "creator" | "sniper" | "bundle" | "curve" | "pool" | "lock";
export type LaunchRiskCode =
  | "CREATOR_SOLD"
  | "CREATOR_HOLDS"
  | "BUNDLE_HOLDS"
  | "SNIPERS_HOLD"
  | "TOP10_HOLD"
  | "FEW_HOLDERS"
  | "HOLDERS_UNCOUNTED"
  | "YOUNG"
  | "CREATOR_OTHER_CURVES"
  | "OPENING_UNREAD"
  | "HISTORY_PARTIAL";
export type LaunchMoney = Readonly<{ pair: number; usd: number | null }>;

export type LaunchTradeRow = Readonly<{
  signature: string;
  at: string;
  side: LaunchTradeSide;
  venue: LaunchTradeVenue;
  trader: string;
  payer: string;
  traderLabels: readonly LaunchHolderLabel[];
  tokensRaw: string;
  pairRaw: string;
  feeRaw: string;
  marketCapPair: number;
}>;

export type LaunchHolderRow = Readonly<{ owner: string; amountRaw: string; shareBps: number; labels: readonly LaunchHolderLabel[] }>;

export type LaunchRiskFact = Readonly<{
  code: LaunchRiskCode;
  level: "attention" | "info";
  values: Readonly<Record<string, number>>;
  source: Readonly<{ kind: "tx" | "account"; id: string }> | null;
}>;

export type LaunchCreatorLaunch = Readonly<{
  token: string;
  name: string;
  symbol: string;
  preset: LaunchPresetId;
  launchedAt: string;
  progressBps: number | null;
  migrated: boolean | null;
  /** How much the creator sold, by `creatorSoldOf`; 0 when nothing; null when not read. */
  creatorSoldBps: number | null;
  /** Of what they bought here, or of the supply when they sold more than that. */
  creatorSoldOf: "bought" | "supply" | null;
}>;

/** `GET /api/v1/launch/{mint}/market` */
export type LaunchMarketResponse = Readonly<{
  network: LaunchNetworkId;
  token: string;
  venue: LaunchTradeVenue;
  pair: Readonly<{ mint: string; symbol: string; decimals: number; dollar: boolean }>;
  supplyRaw: string;
  tokenDecimals: number;
  price: LaunchMoney;
  marketCap: LaunchMoney;
  sinceLaunchBps: number;
  liquidity: LaunchMoney;
  volume24h: LaunchMoney & Readonly<{ complete: boolean }>;
  progress: Readonly<{ bps: number; migrated: boolean; reserveRaw: string; thresholdRaw: string }>;
  curveFee: Readonly<{ nowBps: number | null; endBps: number; sniperUntil: string | null }> | null;
  holders: Readonly<{
    count: number;
    atLeast: boolean;
    rows: readonly LaunchHolderRow[];
    groups: Readonly<{
      creatorBps: number;
      snipers: Readonly<{ shareBps: number; wallets: number }> | null;
      /** `atLeast`: the history was read in part — a floor, not a count. */
      bundle: Readonly<{ shareBps: number; wallets: number; atLeast: boolean }> | null;
      top10Bps: number;
    }>;
  }>;
  trades: Readonly<{ rows: readonly LaunchTradeRow[]; complete: boolean; read: number }>;
  chart: Readonly<{
    points: readonly Readonly<{ t: number; marketCapPair: number }>[];
    markers: readonly Readonly<{ t: number; kind: "creator-buy" | "creator-sell" | "graduated"; signature: string }>[];
  }>;
  risk: readonly LaunchRiskFact[];
  /** `tradesComplete`: every trade of the creator's wallet on this token was read; false — «the creator sold» may be missing. */
  creator: Readonly<{ address: string; curves: number | null; tradesComplete: boolean }>;
  trading: Readonly<{ venue: LaunchTradeVenue; pool: string; referral: boolean; jupiter: boolean }>;
  observedAt: string;
}>;

/** `GET /api/v1/launch/{mint}/creator` — read after the market. */
export type LaunchCreatorResponse = Readonly<{ network: LaunchNetworkId; token: string; creator: string; launches: readonly LaunchCreatorLaunch[]; observedAt: string }>;

/** `GET /api/v1/launch/{mint}/wallet/{address}` */
export type LaunchWalletResponse = Readonly<{ wallet: string; token: string; tokenRaw: string; pairRaw: string; observedAt: string }>;

/** `POST /api/v1/launch/{mint}/trade/quote` */
export type LaunchTradeQuoteRequest = Readonly<{ side: LaunchTradeSide; amountRaw: string; slippageBps: number }>;
export type LaunchTradeQuoteResponse = Readonly<{
  venue: LaunchTradeVenue;
  side: LaunchTradeSide;
  amountInRaw: string;
  amountOutRaw: string;
  minimumOutRaw: string;
  amountLeftRaw: string;
  slippageBps: number;
  feeBps: number;
  fee: Readonly<{
    totalRaw: string;
    creatorRaw: string | null;
    ryntraRaw: string;
    meteoraRaw: string;
    liquidityRaw: string | null;
    /** 1.50.0 — in the pool, `liquidityRaw` split: the creator's and Ryntra's locked positions, the other positions, the compounding share; null on the curve or unread. */
    liquidity?: Readonly<{ creatorRaw: string; ryntraRaw: string; othersRaw: string; compoundingRaw: string }> | null;
  }>;
  priceMoveBps: number;
  marketCapAfter: LaunchMoney;
  referral: boolean;
  observedAt: string;
  /** 1.85.0: the risk verdict over this trade — apart from the token's own `risk` facts on the market read, which are a different list. */
  tradeRisk: TradeRisk;
}>;

/** `POST /api/v1/launch/{mint}/trade/build` */
export type LaunchTradeBuildRequest = Readonly<{ wallet: string; side: LaunchTradeSide; amountRaw: string; slippageBps: number }>;
export type LaunchTradeBuildResponse = Readonly<{ buildId: string; network: LaunchNetworkId; unsignedWireBase64: string; quote: LaunchTradeQuoteResponse; expiresAt: string }>;

/** `POST /api/v1/launch/{mint}/trade/submit` */
export type LaunchTradeSubmitRequest = Readonly<{ buildId: string; wallet: string; signedWireBase64: string }>;
export type LaunchTradeSubmitResponse = Readonly<{
  signature: string;
  state: "CONFIRMED" | "PENDING";
  filled: Readonly<{ tokensRaw: string; pairRaw: string }> | null;
  /** 1.34.0: the trade's Outcome Receipt, once the chain answered in time; null otherwise. */
  receiptHash?: string | null;
  /** 1.34.0: the launch's page through the person's own referral code, for «Поділитися угодою». */
  shareLink?: string | null;
}>;

/** 1.34.0 — `POST /api/v1/launch/{mint}/trade/receipt`: a trade's receipt, by the wallet that sent it and its signature. */
export type LaunchTradeReceiptRequest = Readonly<{ wallet: string; signature: string }>;
export type LaunchTradeReceiptResponse = Readonly<{ signature: string; state: "SENT" | "DONE" | "FAILED"; receipt: SwapReceipt | null }>;
/* ------------------------------------------------------------ 1.29.0 — the creator's cabinet */

/**
 * «Мої лаунчі» — `GET /api/v1/launch/creators/{address}`: the wallet's launches
 * as their creator and those whose creator fees it shares in, what the
 * creator's side earned by source (every figure a program's own counter) and
 * the wallet's part; «Забрати» — `POST …/{mint}/claim/build` and `…/claim/submit`
 * — with a receipt read back from the programs' events. `earnings` null —
 * not read now, never zero.
 */
/** 1.70.0: `surplus` — the creator's part of the curve's surplus, once the curve is full. */
export type LaunchFeeSource = "curve" | "graduation" | "lp" | "surplus";
export type LaunchSourceEarnings = Readonly<{ earnedRaw: string; unclaimedRaw: string }>;
export type LaunchPairView = Readonly<{ mint: string; symbol: string; decimals: number; dollar: boolean }>;
export type LaunchEarnings = Readonly<{
  role: Readonly<{ curve: LaunchSourceEarnings; graduation: LaunchSourceEarnings; lp: LaunchSourceEarnings; surplus: LaunchSourceEarnings; earnedRaw: string; unclaimedRaw: string }>;
  mine: Readonly<{ shareBps: number; earnedRaw: string; unclaimedRaw: string; claimedRaw: string }>;
}>;
export type LaunchCabinetRow = Readonly<{
  token: string;
  name: string;
  symbol: string;
  image: string | null;
  preset: LaunchPresetId;
  creator: string;
  role: "creator" | "recipient";
  launchedAt: string;
  pair: LaunchPairView;
  progressBps: number | null;
  migrated: boolean | null;
  earnings: LaunchEarnings | null;
  feeSharing: LaunchFeeSharing | null;
  claimable: boolean;
}>;
export type LaunchClaimReceipt = Readonly<{
  token: string;
  name: string;
  symbol: string;
  signature: string;
  at: string | null;
  pair: LaunchPairView;
  paid: Readonly<{ curve: string; graduation: string; lp: string; surplus: string }>;
  vaultPaidRaw: string | null;
  receivedRaw: string;
}>;
/** The creator earnings card's data: from the chain and the claim receipts, with its period; each currency apart. */
export type CreatorEarningsCard = Readonly<{
  source: "ryntra.launch.creator-earnings-card@1";
  kind: "creator";
  wallet: string;
  network: LaunchNetworkId;
  period: Readonly<{ from: string; to: string }>;
  launches: number;
  graduated: number;
  unread: number;
  amounts: readonly Readonly<{ pairMint: string; symbol: string; decimals: number; dollar: boolean; earnedRaw: string; claimedRaw: string }>[];
  receipts: readonly string[];
}>;
export type LaunchCreatorCabinetResponse = Readonly<{
  network: LaunchNetworkId;
  wallet: string;
  launches: readonly LaunchCabinetRow[];
  receipts: readonly LaunchClaimReceipt[];
  card: CreatorEarningsCard;
  observedAt: string;
}>;

/**
 * 1.49.0 — the creator's cabinet in figures and the public profile (SOL-L2). `GET /api/v1/launch/{mint}/stats`: what
 * the creator's side earned over the last day and week by source, the volume, the holders, the traders and those who
 * came back, the liquidity, after the DEX the depth ±2 % and the pool's fees, the creator's own trades and lock. A
 * window's figure is exact, a floor (`atLeast`) or not read (`raw: null`) — never a zero on a guess.
 * `GET /api/v1/launch/creators/{address}/profile`: the launches the wallet made through Ryntra.
 */
export type LaunchWindowFigure = Readonly<{ raw: string | null; atLeast: boolean }>;
export type LaunchCountFigure = Readonly<{ count: number | null; atLeast: boolean }>;
export type LaunchSourceWindows = Readonly<{ curve: LaunchWindowFigure; graduation: LaunchWindowFigure; lp: LaunchWindowFigure }>;
export type LaunchStatsResponse = Readonly<{
  network: LaunchNetworkId;
  token: string;
  creator: string;
  pair: LaunchPairView;
  tokenDecimals: number;
  venue: LaunchTradeVenue;
  progressBps: number;
  migrated: boolean;
  links: Readonly<{ curve: string; pool: string | null; position: string | null; lock: string | null }>;
  revenue: Readonly<{ day: LaunchSourceWindows; week: LaunchSourceWindows }>;
  volume: Readonly<{ day: LaunchWindowFigure; week: LaunchWindowFigure; all: LaunchWindowFigure }>;
  holders: LaunchCountFigure;
  traders: LaunchCountFigure;
  repeatTraders: LaunchCountFigure;
  liquidity: LaunchMoney;
  marketCap: LaunchMoney;
  market: Readonly<{ depth: Readonly<{ upRaw: string; downRaw: string }> | null; fees: Readonly<{ day: LaunchWindowFigure; week: LaunchWindowFigure }>; lpShareBps: number | null }> | null;
  creatorTrades: Readonly<{
    boughtRaw: string;
    soldRaw: string;
    soldBps: number | null;
    soldOf: "bought" | "supply" | null;
    sales: readonly Readonly<{ signature: string; at: string; tokensRaw: string; pairRaw: string }>[];
    complete: boolean;
  }>;
  lock: Readonly<{ state: "LOCKED" | "PENDING" | "FAILED"; schedule: LaunchLockId; escrow: string; lockedRaw: string | null; cliffAt: string; endAt: string }> | null;
  observedAt: string;
}>;
export type LaunchProfileLaunch = Readonly<{ token: string; name: string; symbol: string; image: string | null; preset: LaunchPresetId; launchedAt: string; pair: LaunchPairView }>;
export type LaunchCreatorProfileResponse = Readonly<{ network: LaunchNetworkId; creator: string; launches: readonly LaunchProfileLaunch[]; observedAt: string }>;

/** `POST /api/v1/launch/{mint}/claim/build` */
export type LaunchClaimBuildRequest = Readonly<{ wallet: string }>;
export type LaunchClaimBuildResponse = Readonly<{
  buildId: string;
  network: LaunchNetworkId;
  unsignedWireBase64: readonly string[];
  sources: readonly LaunchFeeSource[];
  expectedRaw: string;
  /** The wallet's SOL the network simulated the claim taking; null when not simulated. */
  networkCostLamports: string | null;
  pair: LaunchPairView;
  expiresAt: string;
}>;

/** 1.73.0 (SOL-L12) — the fields a mint's profile is compared by. */
export type MintProfileField =
  | "program"
  | "decimals"
  | "mintAuthority"
  | "freezeAuthority"
  | "extensions"
  | "transferFee"
  | "transferFeeAuthority"
  | "permanentDelegate"
  | "defaultAccountState"
  | "transferHook"
  | "closeAuthority"
  | "pausable";
/** 1.73.0 (SOL-L12) — a pair currency's watch: `CHANGED` when its issuer changed what it can do to holders, and since when. */
export type LaunchPairWatch = Readonly<{ mint: string; symbol: string; state: "OK" | "CHANGED"; changes: readonly MintProfileField[]; since: string | null; checkedAt: string }>;

/** `GET /api/v1/launch/{mint}/claim/review?wallet=` (1.73.0, SOL-L12) — «Забрати все»: the Review before the signature. */
export type LaunchClaimPocketId = "curve" | "graduation" | "surplus" | "lp" | "leftover" | "transferFee";
export type LaunchClaimPocketState = "IN_CLAIM" | "EMPTY" | "BEFORE_DEX" | "WAITING" | "CLOSED" | "NOT_YOURS" | "NONE" | "LATER" | "UNREAD";
export type LaunchClaimReviewResponse = Readonly<{
  network: LaunchNetworkId;
  token: string;
  wallet: string;
  pair: LaunchPairView;
  shared: boolean;
  claimsV2: boolean;
  pockets: readonly Readonly<{ pocket: LaunchClaimPocketId; state: LaunchClaimPocketState; amountRaw: string | null; transaction: number | null; holder: string | null }>[];
  blockedBy: "POSITION_MOVED" | null;
  transactions: readonly Readonly<{ index: number; sources: readonly LaunchFeeSource[]; payout: boolean }>[];
  expectedRaw: string;
  networkCostLamports: string | null;
  surplus: Readonly<{ totalRaw: string; creatorRaw: string; partnerRaw: string; protocolRaw: string }> | null;
  position: Readonly<{ address: string; pool: string; nftMint: string; holder: string | null; holderIs: "YOU" | "VAULT" | "OTHER" | "UNREAD"; permanentBps: number; forever: boolean }> | null;
  lock: Readonly<{ escrow: string; cliffAt: string; endAt: string; lockedRaw: string }> | null;
  observedAt: string;
}>;

/** `POST /api/v1/launch/{mint}/claim/submit` */
export type LaunchClaimSubmitRequest = Readonly<{ buildId: string; wallet: string; signedWireBase64: readonly string[] }>;
/** PARTIAL — the first transaction landed and a later one did not (`failed`): part was taken, the rest still waits. */
export type LaunchClaimSubmitResponse = Readonly<{
  state: "CONFIRMED" | "PENDING" | "PARTIAL";
  receipts: readonly LaunchClaimReceipt[];
  pending: readonly string[];
  failed: readonly Readonly<{ signature: string; reason: string }>[];
}>;

/* ------------------------------------------------------------ 1.72.0 — «Комісія за переказ» (SOL-L10) */

export type LaunchTransferFeeStep = "HARVEST" | "WITHDRAW";
export type LaunchTransferFeeReceipt = Readonly<{ step: LaunchTransferFeeStep; signature: string; amountRaw: string; accounts: number | null; at: string }>;
/** `GET /api/v1/launch/{mint}/transfer-fee` — the rate, the RevokeZeroFee timeline by epoch and the withheld cycle. */
export type LaunchTransferFeeResponse = Readonly<{
  network: LaunchNetworkId;
  token: string;
  decimals: number;
  bps: number;
  mode: "REVOKE_ZERO_FEE";
  withdrawAuthority: string | null;
  timeline: Readonly<{ phase: LaunchTransferFeePhase; bpsNow: number; curveBps: number; zeroFromEpoch: string | null; authorityLive: boolean; epoch: string }>;
  cycle: Readonly<{ inAccountsRaw: string | null; accountsWithWithheld: number | null; onMintRaw: string; withdrawnRaw: string }>;
  actions: Readonly<{ harvest: boolean; withdraw: boolean }>;
  receipts: readonly LaunchTransferFeeReceipt[];
  observedAt: string;
}>;
/** `POST /api/v1/launch/{mint}/transfer-fee/build` */
export type LaunchTransferFeeBuildRequest = Readonly<{ wallet: string; step: LaunchTransferFeeStep }>;
export type LaunchTransferFeeBuildResponse = Readonly<{
  buildId: string;
  network: LaunchNetworkId;
  step: LaunchTransferFeeStep;
  unsignedWireBase64: string;
  expectedRaw: string;
  accounts: number;
  networkCostLamports: string | null;
  expiresAt: string;
  signableMs: number;
}>;
/** `POST /api/v1/launch/{mint}/transfer-fee/submit` */
export type LaunchTransferFeeSubmitRequest = Readonly<{ buildId: string; wallet: string; signedWireBase64: string }>;
export type LaunchTransferFeeSubmitResponse = Readonly<{ step: LaunchTransferFeeStep; state: "CONFIRMED" | "PENDING"; signature: string; receipt: LaunchTransferFeeReceipt | null }>;

/* ------------------------------------------------------------ 1.32.0 — the flight log */

/** 1.39.0 adds `FEE_CLAIMED`: the executor claimed a partner fee of a market whose fee claimer it is, into the market's budget. 1.40.0 adds `CREATOR_BOUGHT`: a purchase from the creator's wallet after the launch. */
export type LaunchJournalKind = "LAUNCHED" | "CREATOR_LOCKED" | "FEES_SHARED" | "CREATOR_SOLD" | "GRADUATED" | "FLOOR_POOL" | "FLOOR_PLACED" | "FLOOR_WITHDRAWN" | "FLOOR_RAISED" | "FLOOR_ADDED" | "FEE_CLAIMED" | "CREATOR_BOUGHT";
/** 1.39.0: the partner fees a market's budget comes from. */
export type LaunchBudgetSource = "migration" | "surplus" | "curve" | "lp";
/** 1.39.0: the budget's risk limits — each stops new money into Ryntra's steps. */
export type LaunchBudgetRisk = "DROP" | "CREATOR_SOLD" | "LOW_SOL";
/** Who did it: the creator, Ryntra's executor, Meteora's keeper, another wallet. */
export type LaunchJournalActor = "creator" | "ryntra" | "meteora" | "other";

/** One entry of a launch's flight log — every one with the transaction anyone can open. */
export type LaunchJournalEvent = Readonly<{
  kind: LaunchJournalKind;
  at: string | null;
  signature: string;
  actor: LaunchJournalActor;
  pairRaw: string | null;
  tokensRaw: string | null;
  /** The Fee-Funded Liquidity Ladder: the lowest and the highest step's price, pair currency per token. */
  priceLow: number | null;
  priceHigh: number | null;
  /** A sale of the creator's: the share sold by then, basis points — of what they bought, or of the supply. */
  soldBps: number | null;
  soldOf: "bought" | "supply" | null;
  /** 1.36.0: what governs the entry — `rule` (a program enforces it), `policy` (Ryntra's server runs it), null for what the log observes. */
  enforcement?: "rule" | "policy" | null;
  /** 1.39.0, `FEE_CLAIMED`: which partner fee, and the market budget's part of `pairRaw` — the rest is Ryntra's revenue. */
  source?: LaunchBudgetSource | null;
  budgetRaw?: string | null;
}>;

/** The Fee-Funded Liquidity Ladder on a graduated launch as it stands: in steps below the price, from Ryntra's fees on this token. It holds no price. */
export type LaunchFloorView = Readonly<{
  pool: string;
  position: string;
  pairRaw: string;
  tokensRaw: string;
  priceLow: number;
  priceHigh: number;
  placedRaw: string;
  observedAt: string;
}>;

/** 1.37.0: what the executor's flight log notes beside the chain's events — none of it a transaction of its own. */
export type LaunchJournalMarkKind = "WATCH_STARTED" | "STATE" | "STOPPED" | "RESUMED" | "GRADUATION_FAILED";

/**
 * 1.37.0: a mark of the executor's or its operator's — its first pass over the market, a state of the market's cycle as it
 * read it, the operator's stop and resume (`scope`: this market or every market), a failed graduation it sends again.
 */
export type LaunchJournalMark = Readonly<{
  kind: LaunchJournalMarkKind;
  /** When it was written — the server's clock, not a block's. */
  at: string;
  actor: "ryntra" | "operator";
  state: LaunchMarketCycleState | null;
  from: LaunchMarketCycleState | null;
  /** The transaction it rests on; null when there is none. */
  signature: string | null;
  scope: "market" | "all" | null;
  /** `ENDOWMENT_FUNDED`: the ladder's budget, raw in the pair currency. */
  pairRaw: string | null;
  /** 1.39.0: a `STATE` mark into `PAUSED_RISK` — the budget's limits that hold. */
  risks?: LaunchBudgetRisk[] | null;
}>;

/** `GET /api/v1/launch/{mint}/journal` — the newest first. `complete` false: something was not read (the creator's trades in part, or a graduation not known yet) — an entry not read is not «none». `floorUnread`: the ladder is there, its position not read now. */
export type LaunchJournalResponse = Readonly<{
  network: LaunchNetworkId;
  token: string;
  pair: LaunchPairView;
  tokenDecimals: number;
  executor: string | null;
  events: readonly LaunchJournalEvent[];
  /** 1.36.0: every entry the log holds — more than `events` when only the newest 200 are given. Absent before 1.36.0. */
  total?: number;
  complete: boolean;
  floor: LaunchFloorView | null;
  floorUnread: boolean;
  /** 1.37.0: the executor's and its operator's marks, the oldest first, the newest 200. Absent before 1.37.0. */
  marks?: readonly LaunchJournalMark[];
  observedAt: string;
}>;

/* ------------------------------------------------------------ a holder's position in the pool (1.33.0) */

export type LaunchHolderInput = "pair" | "token";
/** The permission as Ryntra's collector reads it: GRANTED is the only state it acts on. */
export type LaunchHolderGrantState = "GRANTED" | "NONE" | "OTHER_DELEGATE" | "WIDER" | "TRANSFERABLE";
export type LaunchPositionPermission =
  | "AddLiquidity"
  | "RemoveLiquidity"
  | "RemoveLiquidityToOwner"
  | "ClaimPositionFee"
  | "ClaimPositionFeeToOwner"
  | "ClaimReward"
  | "ClaimRewardToOwner"
  | "LockPosition";

/** A claim Ryntra's collector made for the position's owner: what the owner's own accounts received. */
export type LaunchHolderClaim = Readonly<{ signature: string; at: string | null; pairRaw: string; tokenRaw: string }>;

/** A position entered through Ryntra, and how it stands on chain now; `now` null — not read now. */
export type LaunchHolderPositionView = Readonly<{
  token: string;
  pool: string;
  position: string;
  nftMint: string;
  pending: boolean;
  enteredAt: string;
  entrySignature: string;
  input: LaunchHolderInput;
  enteredRaw: string;
  enteredPairRaw: string;
  feeRaw: string;
  now: Readonly<{
    state: "OPEN" | "MOVED" | "CLOSED";
    tokenRaw: string;
    pairRaw: string;
    valuePairRaw: string;
    feesPairRaw: string;
    unclaimedPairRaw: string;
    unclaimedTokenRaw: string;
    claimedPairRaw: string;
    grant: LaunchHolderGrantState;
    /** 1.41.0: the owner's accounts the fees are paid into that are closed now; the collector waits on them. */
    closedAccounts?: ReadonlyArray<"token" | "pair">;
  }> | null;
  collectedPairRaw: string;
  /** 1.41.0: every claim the collector made; `claims` keeps the newest 20. */
  claimsCount?: number;
  claims: readonly LaunchHolderClaim[];
  /** 1.40.0: the collector's queue — the earliest next claim and whether a dollar waits; null when it does not claim here. */
  nextCollection?: Readonly<{ notBefore: string; enoughWaiting: boolean }> | null;
}>;

/** `GET /api/v1/launch/{mint}/holder/{address}` — the token's pool for a holder; `open` false — draw nothing of the entry (1.41.0: the same for every address unless the request proved an operator's wallet). */
export type LaunchHolderResponse = Readonly<{
  network: LaunchNetworkId;
  token: string;
  pool: string | null;
  open: boolean;
  collector: string | null;
  grant: Readonly<{ bitmask: number; permissions: readonly LaunchPositionPermission[] }>;
  fee: Readonly<{ bps: number; charged: boolean }>;
  compoundingBps: number | null;
  pair: LaunchPairView;
  tokenDecimals: number;
  price: number | null;
  positions: readonly LaunchHolderPositionView[];
  observedAt: string;
}>;

export type LaunchHolderQuoteRequest = Readonly<{ wallet: string; input: LaunchHolderInput; amountRaw: string; slippageBps: number }>;
export type LaunchHolderQuoteView = Readonly<{
  input: LaunchHolderInput;
  amountRaw: string;
  feeRaw: string;
  feeBps: number;
  depositRaw: string;
  swappedRaw: string;
  positionTokenRaw: string;
  positionPairRaw: string;
  valuePairRaw: string;
  positionValuePairRaw: string;
  shareBps: number;
  priceImpactBps: number;
  grant: boolean;
}>;
export type LaunchHolderQuoteResponse = Readonly<{ quote: LaunchHolderQuoteView; price: number; observedAt: string }>;
export type LaunchHolderBuildRequest = LaunchHolderQuoteRequest;
export type LaunchHolderBuildResponse = Readonly<{ buildId: string; network: LaunchNetworkId; unsignedWireBase64: string; position: string; quote: LaunchHolderQuoteView; expiresAt: string }>;
export type LaunchHolderSubmitRequest = Readonly<{ buildId: string; wallet: string; signedWireBase64: string }>;
export type LaunchHolderSubmitResponse = Readonly<{ signature: string; state: "CONFIRMED" | "PENDING"; position: string }>;
export type LaunchHolderPermissionBuildRequest = Readonly<{ wallet: string; position: string; action: "grant" | "revoke" }>;
export type LaunchHolderPermissionBuildResponse = Readonly<{ buildId: string; network: LaunchNetworkId; unsignedWireBase64: string; action: "grant" | "revoke"; expiresAt: string }>;
export type LaunchHolderPermissionSubmitRequest = LaunchHolderSubmitRequest;
export type LaunchHolderPermissionSubmitResponse = Readonly<{ signature: string; state: "CONFIRMED" | "PENDING"; action: "grant" | "revoke" }>;

/** The data of a holder's earnings card: what went in, what it is worth now, the fees, each currency apart, with its period. */
export type HolderEarningsCard = Readonly<{
  source: "ryntra.launch.holder-position-card@1";
  kind: "holder-position";
  wallet: string;
  network: string;
  period: Readonly<{ from: string; to: string }>;
  positions: number;
  unread: number;
  amounts: ReadonlyArray<Readonly<{ pairMint: string; symbol: string; decimals: number; dollar: boolean; enteredRaw: string; valueRaw: string; feesRaw: string; collectedRaw: string }>>;
  receipts: readonly string[];
}>;

/** `GET /api/v1/launch/holders/{address}` — «Мої позиції» across launches, and the card's data. */
export type LaunchHolderPositionsResponse = Readonly<{
  network: LaunchNetworkId;
  wallet: string;
  open: boolean;
  collector: string | null;
  positions: ReadonlyArray<LaunchHolderPositionView & Readonly<{ name: string | null; symbol: string | null; pair: LaunchPairView | null; tokenDecimals: number | null }>>;
  card: HolderEarningsCard;
  observedAt: string;
}>;

/* ------------------------------------------------------------ the markets launched on Ryntra and their health (1.36.0) */

/**
 * A market's state in its cycle: ten states and two of failure. `GRADUATION_READY` — the curve full, waiting for its
 * move; `MIGRATING` — only while the executor's own migration is in flight; `PAUSED_RISK` — Ryntra's acts on the market
 * stopped. `MATURE` is not assigned by this version.
 */
export type LaunchMarketCycleState =
  | "CREATED"
  | "PRICE_DISCOVERY"
  | "GRADUATION_READY"
  | "MIGRATING"
  | "CORE_MARKET_LIVE"
  | "ENDOWMENT_FUNDED"
  | "LADDER_ACTIVE"
  | "MAINTAINING"
  | "PAUSED_RISK"
  | "MATURE"
  | "MIGRATION_FAILED"
  | "ENDOWMENT_EXHAUSTED";

/** Who keeps a rule of the market: a program enforces a `rule`; Ryntra's server runs a `policy`. */
export type LaunchMarketEnforcement = "rule" | "policy";
export type LaunchMarketKeeper = "token-2022" | "meteora-dbc" | "meteora-damm-v2" | "met-lock" | "dynamic-fee-sharing" | "solana-loader" | "ryntra";
export type LaunchMarketRuleCode =
  | "MINT_REVOKED"
  | "NO_FREEZE"
  | "METADATA_FIXED"
  | "NO_TRANSFER_HOOK"
  | "TRANSFER_FEE_UNTIL_DEX"
  /** 1.80.0 — SOL-L8: the rules on the curve, and who may change the program that keeps them. */
  | "CURVE_RULES_UNTIL_DEX"
  | "CURVE_RULES_PROGRAM_GOVERNED"
  | "CONFIG_FIXED"
  | "CURVE_HOLDS_FUNDS"
  | "GRADUATION_AT_THRESHOLD"
  | "LP_LOCKED_FOREVER"
  | "CREATOR_LOCK"
  | "CREATOR_FEES_SHARED"
  | "CREATOR_FIRST_BUY_CAP"
  | "GRADUATION_BY_RYNTRA"
  | "FEE_FUNDED_LADDER"
  | "CREATOR_SALE_MARK"
  | "CONCENTRATION_MARK";

export type LaunchMarketStateView = Readonly<{ code: LaunchMarketCycleState; since: string | null }>;

/**
 * The market's budget. `NOT_COUNTED`: no budget kept here — earned and reserve null, never zero; `IN_POOL`: no ladder, what
 * it earned waits in Meteora's pools; `COUNTED`: the executor claims its fees into its budget. `ladder` says whether Ryntra's
 * steps stand and were read. 1.39.0: `sources`, `placedRaw`, `revenueRaw` (Ryntra's, never the market's), `inPoolRaw`, `exhausted`.
 * 1.51.0: `claims` — Ryntra's executor claims this budget and keeps its ladder (Ryntra's market, or a person's Micro market
 * while Ryntra keeps people's markets open).
 */
export type LaunchMarketBudget = Readonly<{
  state: "NOT_COUNTED" | "IN_POOL" | "COUNTED";
  earnedRaw: string | null;
  reserveRaw: string | null;
  ladder: "NONE" | "PLACED" | "UNREAD";
  deployed: Readonly<{ pairRaw: string; tokensRaw: string }> | null;
  sources?: Readonly<{ migration: string; surplus: string; curve: string; lp: string }> | null;
  placedRaw?: string | null;
  revenueRaw?: string | null;
  inPoolRaw?: string | null;
  exhausted?: boolean;
  claims?: boolean;
}>;

/** Executable depth at one drop (200, 500 or 1 000 basis points): the pair currency paid out until then, raw — `"0"` while the curve is full; null when not read. */
export type LaunchMarketDepth = Readonly<{ dropBps: 200 | 500 | 1000; pairRaw: string | null; ladderRaw: string | null }>;

export type LaunchMarketRule = Readonly<{
  code: LaunchMarketRuleCode;
  enforcement: LaunchMarketEnforcement;
  by: LaunchMarketKeeper;
  source: Readonly<{ kind: "tx" | "account"; id: string }> | null;
  values: Readonly<Record<string, number | string>>;
}>;

export type LaunchMarketLock = Readonly<{ escrow: string; cliffAt: string | null; endsAt: string | null }>;

/** One market of «Лаунчі на Ryntra». `read: false` — the record's facts only, every figure null; `creatorLock` as the record holds it. */
export type LaunchMarketRow = Readonly<{
  token: string;
  name: string;
  symbol: string;
  image: string | null;
  preset: LaunchPresetId;
  launchedAt: string;
  creator: string;
  technicalValidation: boolean;
  pair: LaunchPairView;
  read: boolean;
  state: LaunchMarketStateView | null;
  venue: LaunchTradeVenue | null;
  progress: Readonly<{ bps: number; migrated: boolean }> | null;
  poolLiquidity: LaunchMoney | null;
  budget: LaunchMarketBudget;
  depth5Raw: string | null;
  daysSinceDex: number | null;
  traded24h: boolean | null;
  holders: number | null;
  holdersAtLeast: boolean;
  creatorLock: LaunchMarketLock | null;
  creatorSold: boolean | null;
  /** 1.87.0 — Ryntra took the token's picture, description and links down; the chain keeps the token. Absent when not. */
  hidden?: true;
  observedAt: string;
}>;

/** `GET /api/v1/launch/markets` — with a trade in the last day first, then by state and the newest. */
export type LaunchMarketsResponse = Readonly<{ network: LaunchNetworkId; markets: readonly LaunchMarketRow[]; complete: boolean; observedAt: string }>;

/** 1.52.0 — markets at least N days old: alive (someone other than the creator and Ryntra traded in the week to day N), quiet, or not read. */
export type LaunchSurvivalTally = Readonly<{ eligible: number; alive: number; quiet: number; unread: number }>;

/**
 * `GET /api/v1/launch/survival` (1.55.0) — the survival of every market launched on Ryntra at 7, 30 and 90 days; each
 * market that lived carries the transaction of the trade that proves it; people's markets and Ryntra's own apart.
 */
export type LaunchSurvivalResponse = Readonly<{
  network: LaunchNetworkId;
  windowDays: 7;
  horizons: readonly Readonly<{ days: 7 | 30 | 90; people: LaunchSurvivalTally; ryntra: LaunchSurvivalTally }>[];
  markets: readonly Readonly<{
    token: string;
    symbol: string;
    launchedAt: string;
    own: boolean;
    outcomes: readonly Readonly<{ days: 7 | 30 | 90; state: "young" | "alive" | "quiet" | "unread"; proof: Readonly<{ signature: string; at: string }> | null }>[];
  }>[];
  /** `markets` names every market counted; false — the newest 500, the tallies count them all. */
  listedAll: boolean;
  ownWalletsComplete: boolean;
  complete: boolean;
  observedAt: string;
}>;

/** 1.74.0 — a launch window: the opening to the minute names it; a launch whose creation landed while it was open is in it. */
export type LaunchWindow = Readonly<{ id: string; kind: "hourly" | "evening"; opensAt: string; closesAt: string }>;

/** `GET /api/v1/launch/windows` (1.74.0) — the published schedule: hourly at :00 UTC for 10 min, every evening at 20:00 UTC for 30 min. */
export type LaunchWindowsResponse = Readonly<{
  open: LaunchWindow | null;
  next: LaunchWindow;
  nextEvening: LaunchWindow;
  schedule: Readonly<{ hourlyMinutes: 10; eveningHourUtc: 20; eveningMinutes: 30 }>;
  observedAt: string;
}>;

/** 1.74.0 — a crew member: the X handle (the person's word, confirmed by their wallet), the part of the creator's fees, the answer. */
export type LaunchCrewMember = Readonly<{
  handle: string;
  bps: number;
  state: "INVITED" | "ACCEPTED" | "DECLINED";
  /** The wallet that said yes; null otherwise. */
  wallet: string | null;
  answeredAt: string | null;
  /** The words the invitee says yes to. */
  consent: readonly string[];
}>;

export type LaunchCrew = Readonly<{
  id: string;
  creator: string;
  creatorHandle: string | null;
  symbol: string;
  name: string;
  preset: "classic" | "protected";
  window: string | null;
  members: readonly LaunchCrewMember[];
  creatorBps: number;
  createdAt: string;
  expiresAt: string;
  expired: boolean;
  token: string | null;
  launchedAt: string | null;
}>;

/** `GET /api/v1/launch/crews/{id}`, and the answer of a write (1.74.0); `open` — crews may be made and answered on this network now. */
export type LaunchCrewResponse = Readonly<{ network: LaunchNetworkId; crew: LaunchCrew; open: boolean }>;

/** `POST /api/v1/launch/crews` (1.74.0) — the creator's proven wallet invites one to four people by X handle. */
export type LaunchCrewCreateRequest = Readonly<{
  creator: string;
  creatorHandle: string | null;
  symbol: string;
  name: string;
  preset: "classic" | "protected";
  window: string | null;
  invites: readonly Readonly<{ handle: string; bps: number }>[];
}>;

/** `POST /api/v1/launch/crews/{id}/answer` (1.74.0) — an invitee's own yes, or that wallet taking it back ("decline"). */
export type LaunchCrewAnswerRequest = Readonly<{ handle: string; answer: "accept" | "decline" }>;

/** `GET /api/v1/launch/crews` (1.74.0) — the crews in flight: the Dynamic Fee Sharing vault's own rows, by wallet (no handle). */
export type LaunchCrewsResponse = Readonly<{
  network: LaunchNetworkId;
  crews: readonly Readonly<{
    token: string;
    symbol: string;
    creator: string;
    creatorBps: number;
    members: readonly Readonly<{ wallet: string; bps: number }>[];
    window: string | null;
    launchedAt: string | null;
  }>[];
  observedAt: string;
}>;

/** `GET /api/v1/launch/markets/{mint}` — the row and the addresses the market lives at. */
export type LaunchMarketCardResponse = Readonly<{
  network: LaunchNetworkId;
  market: LaunchMarketRow;
  addresses: Readonly<{
    config: string;
    curve: string;
    pairMint: string;
    pool: string | null;
    lockedPositions: readonly Readonly<{ position: string; owner: string }>[];
    creatorLock: string | null;
    feeVault: string | null;
    ladder: Readonly<{ pool: string; position: string | null }> | null;
    executor: string | null;
  }>;
  observedAt: string;
}>;

/** `GET /api/v1/launch/{mint}/health` — by fixed definitions; a figure not read is null, never zero. */
export type LaunchMarketHealthResponse = Readonly<{
  network: LaunchNetworkId;
  token: string;
  pair: LaunchPairView;
  tokenDecimals: number;
  /** The price now, the pair currency per token. */
  price: LaunchMoney;
  state: LaunchMarketStateView;
  technicalValidation: boolean;
  venue: LaunchTradeVenue;
  depth: readonly LaunchMarketDepth[];
  budget: LaunchMarketBudget;
  /** Ryntra's steps as they stand; `pairFrom`/`pairTo` — the prices of the steps holding the pair currency, null when none does. */
  ladder: Readonly<{ pool: string; pairRaw: string; tokensRaw: string; pairFrom: number | null; pairTo: number | null }> | null;
  survival: Readonly<{ graduatedAt: string | null; daysSinceDex: number | null; priceVsDexBps: number | null; traded24h: boolean | null; lastTradeAt: string | null }>;
  holders: Readonly<{ count: number | null; atLeast: boolean; minUsd: 1 }>;
  /** 1.38.0 `lockRequired`: the preset locks the creator's first buy and they bought — a null `lock` then is the rule not kept. */
  creator: Readonly<{ address: string; lock: LaunchMarketLock | null; lockRequired: boolean; sold: boolean | null; soldBps: number | null; soldOf: "bought" | "supply" | null }>;
  /** `atLeast`: from the mint's largest accounts — a floor. */
  concentration: Readonly<{ top10Bps: number | null; atLeast: boolean; marked: boolean | null; markBps: 6000 }>;
  engine: Readonly<{
    executor: string | null;
    /** Whether the executor acts on this network now: its key on the server, Launch open, a pass of its own in the last 15 minutes, every market not stopped by Ryntra's operator (1.37.0), the switch read. */
    acts: boolean;
    /** 1.47.0: true when whether it acts could not be read now — `acts` is false by not knowing, never a stop; absent when read. */
    actsUnread?: boolean;
    lastAction: Readonly<{ kind: LaunchJournalKind; at: string | null; signature: string }> | null;
    /** 1.37.0: `OPERATOR` — Ryntra's operator stopped the executor on this market or on every market. */
    pause: Readonly<{ code: "OPERATOR" | "STOPPED" | "RISK_LIMIT"; at: string | null; /** 1.39.0, `RISK_LIMIT`: the budget's limits that hold. */ risks?: LaunchBudgetRisk[] }> | null;
  }>;
  rules: readonly LaunchMarketRule[];
  /** False when the token's receipt was not read: its own rules and the pool's locked positions are missing from `rules`. */
  rulesComplete: boolean;
  observedAt: string;
}>;

/* ------------------------------------------------- teams (1.75.0, TEAM-1) */

export type TeamKind = "SOLO_CREATOR" | "PROJECT_TEAM" | "DAO_COMMUNITY" | "AGENCY" | "ENTERPRISE";
export type TeamRole = "OWNER" | "ADMIN" | "FINANCE" | "LAUNCH_OPERATOR" | "MARKET_OPERATOR" | "DEVELOPER" | "ANALYST" | "VIEWER" | "AGENT";
/** The nine rights of spec §9.2 and `members` — keeping the team's list. */
export type TeamPermission = "view" | "draft" | "submit" | "sign" | "deploy" | "payout" | "withdraw" | "policy" | "receipts" | "members";
/** `MULTISIG` — only as a proposal on the team's Squads treasury, approved on chain; a high-risk right is never `ALLOW`. */
export type TeamGrant = "ALLOW" | "MULTISIG" | "DENY";
export type TeamRisk = "LOW" | "MEDIUM" | "HIGH";
export type TeamMemberStatus = "INVITED" | "ACTIVE";
export type TeamNetworkId = "solana:devnet" | "solana:mainnet";
export type TeamGrants = Readonly<Record<TeamPermission, TeamGrant>>;
export type TeamJournalAction = "TEAM_CREATED" | "TEAM_RENAMED" | "MEMBER_INVITED" | "MEMBER_JOINED" | "ROLE_CHANGED" | "MEMBER_REMOVED" | "MEMBER_LEFT" | "TREASURY_LINKED" | "TREASURY_UNLINKED";
export type TeamRefusal = "NOT_A_MEMBER" | "NOT_JOINED" | "ROLE_DENIES" | "NO_TREASURY" | "NO_MULTISIG_PATH" | "AUTHORITY_CLOSED" | "NOT_A_SIGNER" | "SIGNERS_UNREAD";

/** `GET /api/v1/teams/roles` (1.75.0) — the matrix every team check runs on, and whether teams are served here. */
export type TeamRolesResponse = Readonly<{
  kinds: readonly TeamKind[];
  roles: readonly TeamRole[];
  permissions: readonly Readonly<{ id: TeamPermission; risk: TeamRisk; authority: readonly string[]; squadsPermission: "initiate" | "vote" | null }>[];
  matrix: Readonly<Record<TeamRole, TeamGrants>>;
  limits: Readonly<{ membersPerTeam: number; teamsCreatedPerWallet: number; membershipsPerWallet: number; invitationsPerWallet: number; inviteDays: number }>;
  open: boolean;
  network: TeamNetworkId | null;
}>;

export type TeamSummary = Readonly<{ id: string; name: string; kind: TeamKind; treasury: string | null; role: TeamRole; status: TeamMemberStatus; members: number }>;

/** `GET /api/v1/teams` (1.75.0) — the proven wallet's teams, invitations included. */
export type TeamsResponse = Readonly<{ network: TeamNetworkId; teams: readonly TeamSummary[] }>;

/** `POST /api/v1/teams` (1.75.0) — a team made by the proven wallet, its first Owner. */
export type TeamCreateRequest = Readonly<{ name: string; kind: TeamKind }>;

export type TeamMember = Readonly<{ wallet: string; role: TeamRole; status: TeamMemberStatus; label: string | null; invitedBy: string; invitedAt: string; joinedAt: string | null }>;

export type TeamJournalRow = Readonly<{ at: string; actor: string; action: TeamJournalAction; subject: string | null; role: TeamRole | null; previousRole: TeamRole | null }>;

export type TeamSigner = Readonly<{ address: string; initiate: boolean; vote: boolean; execute: boolean; inTeam: boolean; role: TeamRole | null }>;

export type Team = Readonly<{
  id: string;
  network: TeamNetworkId;
  name: string;
  kind: TeamKind;
  treasury: string | null;
  createdBy: string;
  createdAt: string;
  version: number;
  you: Readonly<{ wallet: string; role: TeamRole; status: TeamMemberStatus; grants: TeamGrants }>;
  /** To an active member only. */
  members: readonly TeamMember[] | null;
  /** To a member who reads receipts. */
  journal: readonly TeamJournalRow[] | null;
  /** The treasury's members on chain beside the list; null without a treasury. */
  signers: Readonly<{ read: "OK"; rows: readonly TeamSigner[] }> | Readonly<{ read: "UNREAD" }> | null;
}>;

/** `GET /api/v1/teams/{id}` and the team writes (1.75.0). */
export type TeamResponse = Readonly<{ team: Team }>;

/** `POST /api/v1/teams/{id}/members` (1.75.0) — an invitation. */
export type TeamInviteRequest = Readonly<{ wallet: string; role: TeamRole; label?: string | null }>;

/** `POST /api/v1/teams/{id}/members/{wallet}` (1.75.0). */
export type TeamMemberChangeRequest = Readonly<{ action: "accept" }> | Readonly<{ action: "role"; role: TeamRole }> | Readonly<{ action: "remove" }>;

/** The team after a member change, or null once the wallet left it. */
export type TeamMemberChangeResponse = Readonly<{ team: Team | null }>;

/** `POST /api/v1/teams/{id}/treasury` (1.75.0) — a Squads v4 multisig the operator's wallet is on, linked once. */
export type TeamTreasuryRequest = Readonly<{ multisig: string }>;

/** `GET /api/v1/teams/{id}/check` (1.75.0) — the server's decision for the proven wallet and one right. */
export type TeamCheckResponse = Readonly<{
  teamId: string;
  wallet: string;
  allowed: boolean;
  permission: TeamPermission;
  role: TeamRole | null;
  grant: TeamGrant;
  risk: TeamRisk;
  requires: "NOTHING" | "MULTISIG";
  refusal: TeamRefusal | null;
  authority: Readonly<{ id: string; state: HonestState; enforcement: AuthorityEnforcement; signer: "PERSON_EACH" | "PERSON_ONCE" | "MULTISIG" | "PROVIDER" | "RYNTRA_KEY" | "NONE" }> | null;
  multisig: string | null;
  squadsPermission: "initiate" | "vote" | null;
}>;

/* ---- 1.88.0 — the pre-sign check (CITY-152; working name «ward»): allow · warn · block with every reason, never a score */

export type WardVerdict = "allow" | "warn" | "block";
export type WardLevel = "block" | "warn" | "unknown" | "info";
export type WardCheckKind = "input" | "simulation" | "authority" | "nonce" | "recipient" | "token" | "intent" | "program";
export type WardNetwork = "mainnet" | "devnet";
export type WardReasonCode =
  | "LINK_NOT_READ"
  | "TX_SIGNER_ABSENT"
  | "SIMULATION_FAILED"
  | "SIMULATION_UNAVAILABLE"
  | "LOOKUPS_UNREAD"
  | "SWEEPS_ASSETS"
  | "OWNER_CHANGED"
  | "TOKEN_OWNER_CHANGED"
  | "CLOSE_AUTHORITY_CHANGED"
  | "CLOSE_TO_OTHER"
  | "DELEGATE_UNLIMITED"
  | "DELEGATE_SET"
  | "STAKE_AUTHORITY_CHANGED"
  | "UPGRADE_AUTHORITY_CHANGED"
  | "MINT_AUTHORITY_CHANGED"
  | "NONCE_AUTHORITY_CHANGED"
  | "DURABLE_NONCE"
  | "RECIPIENT_KNOWN_THREAT"
  | "RECIPIENT_SANCTIONED"
  | "RECIPIENT_LOOKALIKE"
  | "RECIPIENT_REFUSED"
  | "RECIPIENT_FLAGGED"
  | "RECIPIENT_NEW"
  | "RECIPIENT_LINK"
  | "RECIPIENT_UNREAD"
  | "RECIPIENT_PROGRAM"
  | "TOKEN_NON_TRANSFERABLE"
  | "TOKEN_FROZEN_ON_ARRIVAL"
  | "TOKEN_PAUSED"
  | "TOKEN_PERMANENT_DELEGATE"
  | "TOKEN_TRANSFER_HOOK"
  | "TOKEN_FREEZE_AUTHORITY"
  | "TOKEN_MINT_AUTHORITY"
  | "TOKEN_PAUSABLE"
  | "TOKEN_TRANSFER_FEE"
  | "TOKEN_CONCENTRATED"
  | "TOKEN_UNREAD"
  | "TOKEN_FACTS_UNREAD"
  | "INTENT_AMOUNT_OVER"
  | "INTENT_RECIPIENT"
  | "INTENT_ASSET"
  | "INTENT_AMOUNT_UNDER"
  | "INTENT_NOT_RECEIVED"
  | "INTENT_UNREADABLE"
  | "INTENT_UNCHECKED"
  | "INTENT_MATCH"
  | "PROGRAMS_UNKNOWN";

/** What the agent says the transaction does. `mint: null` is SOL; amounts are plain decimals in the asset's units. */
export type WardIntent =
  | Readonly<{ kind: "transfer"; to: string; amount: string; mint: string | null }>
  | Readonly<{ kind: "swap"; give: Readonly<{ mint: string | null; amount: string }>; get: Readonly<{ mint: string | null; min: string | null }> }>;

/** `POST /api/v1/ward/check` — exactly one of `transaction` (base64) and `link`. */
export type WardCheckRequest = Readonly<{
  transaction?: string;
  link?: string;
  signer?: string;
  intent?: WardIntent;
  intentText?: string;
  known?: readonly string[];
  network?: WardNetwork;
}>;

export type WardReason = Readonly<{
  code: WardReasonCode;
  check: WardCheckKind;
  level: WardLevel;
  line: string;
  detail: string | null;
  accounts: readonly string[];
  source: string;
}>;

/** The verdict: `allow` is only «nothing known stands against it, and what it does was read» — never «safe». */
export type WardCheckResponse = Readonly<{
  schema: "ryntra.ward.check";
  schemaVersion: "1.0.0";
  verdict: WardVerdict;
  line: string;
  reasons: readonly WardReason[];
  notRead: number;
  input: Readonly<{
    kind: "transaction" | "link";
    network: WardNetwork;
    version: "legacy" | "v0" | null;
    signer: string | null;
    signed: boolean;
    programs: readonly Readonly<{ id: string; label: string | null }>[];
  }>;
  effects: Readonly<{
    simulated: boolean;
    changes: readonly Readonly<{ holder: string; kind: "you" | "wallet" | "program"; mint: string | null; symbol: string | null; decimals: number | null; raw: string }>[];
    feeLamports: string | null;
    rentLamports: string | null;
  }>;
  intent: WardIntent | null;
  checkedAt: string;
}>;

/* ------------------------------------------------------------ prepared actions (1.90.0, CITY-161) */

export const INTENT_STATUSES = ["OPEN", "CLAIMED", "DONE", "EXPIRED", "LAPSED", "CANCELLED"] as const;
export type IntentStatus = (typeof INTENT_STATUSES)[number];
export const INTENT_ORIGIN_KINDS = ["agent", "chat", "partner"] as const;
export type IntentOriginKind = (typeof INTENT_ORIGIN_KINDS)[number];

/** Who prepared the intent, as the sheet says «Prepared by …». */
export type IntentOrigin = Readonly<{ kind: IntentOriginKind; name: string }>;
/** A swap: the coin, bought with `pay` or sold into it; `amountRaw` is what leaves the wallet. */
export type IntentSwapSpec = Readonly<{ action: "swap"; coin: string; side: "buy" | "sell"; pay: "SOL" | "USDC"; amountRaw: string }>;
/** A transfer: `"SOL"` or a mint, the raw amount and the recipient. */
export type IntentTransferSpec = Readonly<{ action: "transfer"; coin: string; amountRaw: string; to: string }>;
export type IntentSpec = IntentSwapSpec | IntentTransferSpec;

export type IntentReceipt = Readonly<{ wallet: string; signature: string; at: string; chain: "CONFIRMED" | "FAILED" | "UNCHECKED" }>;

/** 1.90.0: an intent as served — its frozen fields, where it stands, its digest and Ryntra's own https links. `receipt` only to the creator's key and the claiming wallet's own step; `origin.verified` false in phase 1. */
export type Intent = Readonly<{
  id: string;
  status: IntentStatus;
  network: "solana:mainnet";
  spec: IntentSpec;
  origin: IntentOrigin & Readonly<{ verified: boolean }>;
  for: string | null;
  createdAt: string;
  expiresAt: string;
  digest: string;
  claimedUntil: string | null;
  sentSignature: string | null;
  receipt: IntentReceipt | null;
  links: Readonly<{ url: string; qr: string }>;
}>;
export type IntentResponse = Readonly<{ intent: Intent }>;
/** `POST /api/v1/intents` (201): the intent and the creator's key, shown once. */
export type IntentCreatedResponse = Readonly<{ intent: Intent; creatorKey: string }>;

/** `POST /api/v1/intents` — no wallet, no key; `pay` defaults to SOL, `expiresIn` to 900 seconds; `for` binds one wallet. A transfer is closed in phase 1. */
export type IntentCreateRequest =
  | Readonly<{ action: "swap"; coin: string; side: "buy" | "sell"; pay?: "SOL" | "USDC"; amountRaw: string; expiresIn?: number; origin: IntentOrigin; for?: string }>
  | Readonly<{ action: "transfer"; coin: string; amountRaw: string; to: string; expiresIn?: number; origin: IntentOrigin; for?: string }>;
/** `POST /api/v1/intents/{id}/claim` and `/release` — the digest the sheet showed and the pressing wallet. */
export type IntentStepRequest = Readonly<{ digest: string; wallet: string }>;
/** `POST /api/v1/intents/{id}/signed` — the claiming wallet's signed bytes, before they may leave. */
export type IntentMarkRequest = Readonly<{ digest: string; wallet: string; signedWireBase64: string; replaces?: string | null }>;
/** `POST /api/v1/intents/{id}/receipt` — the claiming wallet's signature (the marked one). */
export type IntentReceiptRequest = Readonly<{ digest: string; wallet: string; signature: string }>;
