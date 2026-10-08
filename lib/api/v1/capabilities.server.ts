/**
 * `/api/v1/capabilities` — the product registry projected for a native client.
 *
 * What a module is and whether it is available comes from
 * `app/shell/product-routes.ts`, the one registry the rail is drawn from; the
 * route families are named here beside each module so a client knows which
 * calls belong to which readiness. Nothing is promised that the registry does
 * not say, and a module with no API yet lists no routes.
 */

import { PAGE_GROUP } from "../../../app/shell/domains.ts";
import { PRODUCT_ROUTES } from "../../../app/shell/product-routes.ts";
import { EVIDENCE_CONDITIONS_LIMIT } from "../../evidence/conditions.ts";
import { EVIDENCE_PROVIDERS, EVIDENCE_WINDOWS, metricsOfProvider, type EvidenceWindow } from "../../evidence/metrics.ts";
import { NANSEN_RIGHTS, providerRights } from "../../evidence/rights.ts";
import { resolveAgentBudgetConfig } from "../../agent/budget.ts";
import { toolNames } from "../../agent/tools/registry.ts";
import { pushProviderConfigured } from "../../monitoring/push.ts";
import { ASSET_CAP_PCT, CAPS_FROM_USD, PRIVATE_CAP_PCT } from "../../monitoring/portfolio-risk.ts";
import { ABOVE_EXCHANGE_PCT, NEAR_LIMIT_PCT, WATCH_PRICE_MAX_AGE_MS, WATCH_STATES } from "../../monitoring/watch-state.ts";
import { DEFAULT_PAYMENT_EXPIRATION } from "../../pay/model.ts";
import { launchNetwork } from "../../launch/config.server.ts";
import { LOSS_LIMIT_PRESETS } from "../../plans/purchase.ts";
import { resolveServiceFeeConfig } from "../../swap/service-fee.server.ts";
import {
  AGENT_ANSWER_SECTIONS,
  AGENT_BRIEF_SECTIONS,
  AGENT_CRITIC_KINDS,
  AGENT_QUESTION_MAX,
  AGENT_TURNS_KEPT,
  API_CONTRACT_VERSION,
  API_MAJOR,
  CHALLENGE_TTL_SECONDS,
  MINIMUM_APP_VERSION,
  NATIVE_SESSION_TTL_SECONDS,
  NETWORK,
  PLAN_ASSET_KINDS,
  PLAN_LIST_LIMIT,
  PLAN_VERSIONS_LIMIT,
  POPULAR_DEFAULT_LIMIT,
  POPULAR_MAX_LIMIT,
  PAY_LINK_DESCRIPTION_MAX,
  PAY_LINK_EXPIRATIONS,
  PAY_LINK_LIST_LIMIT_V1,
  POSITION_WATCH_PRESETS_V1,
  BUDGET_MAXIMUM_USD,
  BUDGET_MINIMUM_USD,
  PAYMENT_EVENTS_KEPT,
  PAYMENT_FIXED_MAX_USD,
  PAYMENT_FIXED_MIN_USD,
  PAYMENT_PERCENT_MAX,
  PAYMENT_PERCENT_MIN,
  PAYMENT_ROUNDUP_STEPS_USD,
  RULE_PAYMENT_MODES,
  RULE_ASSET_CLASSES,
  RULE_FLOOR_AGE_HOURS,
  RULE_FLOOR_LIQUIDITY_USD,
  PRICE_CONDITION_DEFAULT_PCT,
  PRICE_CONDITION_MAX_AGE_MINUTES,
  PRICE_CONDITION_MAX_PCT,
  PRICE_CONDITION_MIN_PCT,
  RULE_CADENCES,
  RULE_DIP_MAX_PCT,
  RULE_DIP_MIN_PCT,
  RULE_KINDS,
  RULE_LIST_LIMIT,
  RULE_MAXIMUM_USD,
  RULE_MINIMUM_USD,
  RULE_REMINDER_HOURS,
  WATCHLIST_LIMIT,
  evidenceMetricDefinitions,
  type Capabilities,
} from "./contract.ts";

export const MINIMUM_APP_VERSION_ENV = "RYNTRA_MIN_APP_VERSION_ANDROID";

/** The route families behind each registered module, by module id. */
const MODULE_ROUTES: Readonly<Record<string, readonly string[]>> = {
  swap: ["/api/solana/swap/quote", "/api/solana/swap/order", "/api/solana/swap/execute", "/api/solana/swap/recover"],
  spot: ["/api/spot/markets", "/api/spot/market", "/api/spot/candles", "/api/spot/watchlist", "/api/v1/watchlist", "/api/v1/research/evidence"],
  stocks: ["/api/stocks/universe", "/api/stocks/asset", "/api/stocks/quote", "/api/v1/stocks/popular", "/api/v1/research/evidence", "/api/v1/rules"],
  send: ["/api/solana/transfer", "/api/v1/research/address-evidence", "/api/v1/money"],
  receive: ["/api/pay", "/api/v1/pay"],
  bridge: ["/api/solana/bridge", "/api/solana/cross-swap"],
  rewards: ["/api/rewards"],
  portfolio: ["/api/solana/holdings"],
  activity: ["/api/solana/activity", "/api/solana/receipts"],
  "my-strategies": ["/api/v1/plans", "/api/v1/plans/asset", "/api/v1/notifications/devices", "/api/v1/notifications/telegram", "/api/monitoring", "/api/v1/agent/session", "/api/v1/agent/message"],
};

export function minimumAppVersion(env: NodeJS.ProcessEnv = process.env): Capabilities["minimumAppVersion"] {
  const override = env[MINIMUM_APP_VERSION_ENV]?.trim();
  return { android: override && /^\d+\.\d+\.\d+$/.test(override) ? override : MINIMUM_APP_VERSION.android };
}

export function buildCapabilities(deps: Readonly<{ env?: NodeJS.ProcessEnv; now?: () => Date }> = {}): Capabilities {
  const env = deps.env ?? process.env;
  return {
    api: { major: API_MAJOR, contractVersion: API_CONTRACT_VERSION, supportedMajors: [API_MAJOR], sunsetOf: null },
    minimumAppVersion: minimumAppVersion(env),
    network: NETWORK,
    modules: PRODUCT_ROUTES.map((route) => ({
      id: route.id,
      group: PAGE_GROUP[route.id],
      readiness: route.readiness,
      routes: [...(MODULE_ROUTES[route.id] ?? [])],
    })),
    signing: {
      modes: ["APP_SIGNS_SERVER_SUBMITS"],
      /* Announced only when the adopt route exists — it does not yet. */
      adoptSignature: false,
    },
    auth: {
      challenge: "/api/v1/auth/challenge",
      verify: "/api/v1/auth/verify",
      session: "/api/v1/auth/session",
      refresh: "/api/v1/auth/refresh",
      sessionTtlSeconds: NATIVE_SESSION_TTL_SECONDS,
      challengeTtlSeconds: CHALLENGE_TTL_SECONDS,
    },
    watchlist: { limit: WATCHLIST_LIMIT, merge: "/api/v1/watchlist/merge" },
    /* 1.7.0: the asset read that resolves any mint the way a create will, and the kinds a plan may name here. */
    /* 1.9.0: Results and memory are routes a client may read for this wallet, so a deployment says whether it serves them. */
    plans: { list: "/api/v1/plans", limit: PLAN_LIST_LIMIT, versionsLimit: PLAN_VERSIONS_LIMIT, asset: "/api/v1/plans/asset", assetKinds: [...PLAN_ASSET_KINDS], results: "/api/v1/plans/results", memory: "/api/v1/plans/memory" },
    /* 1.7.0: whether push delivery is switched on at all — the provider key on the server, or its absence, said plainly. */
    push: { provider: pushProviderConfigured(env) ? "configured" : "absent" },
    /* 1.12.0: «Автоінвест» — the rules route and its bounds; a rule reminds, the wallet signs every purchase. */
    rules: {
      list: "/api/v1/rules",
      limit: RULE_LIST_LIMIT,
      cadences: [...RULE_CADENCES],
      minimumUsd: RULE_MINIMUM_USD,
      maximumUsd: RULE_MAXIMUM_USD,
      reminderHours: RULE_REMINDER_HOURS,
      kinds: [...RULE_KINDS],
      dip: { minPct: RULE_DIP_MIN_PCT, maxPct: RULE_DIP_MAX_PCT },
      budget: { route: "/api/v1/rules/budget", minimumUsd: BUDGET_MINIMUM_USD, maximumUsd: BUDGET_MAXIMUM_USD },
      /* 1.18.0: «Умова ціни» — a rule waits while its price stands above the reference by more than the person's limit or the data are old. */
      priceCondition: { defaultPct: PRICE_CONDITION_DEFAULT_PCT, minPct: PRICE_CONDITION_MIN_PCT, maxPct: PRICE_CONDITION_MAX_PCT, maxAgeMinutes: PRICE_CONDITION_MAX_AGE_MINUTES },
      /* 1.19.0: «З кожної оплати» — the wallet's own USDC payments and incoming transfers; the rule gathers, the wallet signs every purchase. */
      payments: {
        modes: [...RULE_PAYMENT_MODES],
        roundToUsd: [...PAYMENT_ROUNDUP_STEPS_USD],
        fixedMinUsd: PAYMENT_FIXED_MIN_USD,
        fixedMaxUsd: PAYMENT_FIXED_MAX_USD,
        percentMin: PAYMENT_PERCENT_MIN,
        percentMax: PAYMENT_PERCENT_MAX,
        eventsKept: PAYMENT_EVENTS_KEPT,
        ownAccount: "/api/v1/rules/payments/own",
      },
      /* 1.31.0: «Регулярна купівля для всього» — any token with liquidity: a company, a coin, a meme or a new token on the floor. */
      assets: { classes: [...RULE_ASSET_CLASSES], floor: { liquidityUsd: RULE_FLOOR_LIQUIDITY_USD, ageHours: RULE_FLOOR_AGE_HOURS }, read: "/api/v1/rules/asset" },
    },
    attribution: { referralAccount: resolveServiceFeeConfig(env).jupiterReferralAccount, stats: "/api/stats" },
    /* 1.8.0: Ryn — its routes, whether a model composes the words here, the tools by kind and the boundary said as a fact. */
    agent: {
      session: "/api/v1/agent/session",
      message: "/api/v1/agent/message",
      drafts: "/api/v1/agent/drafts",
      budget: "/api/v1/agent/budget",
      suggestions: "/api/v1/agent/suggestions",
      /* 1.10.0: the Brief and the Critic — two formats over the same engine and the same budget. */
      brief: "/api/v1/agent/brief",
      critic: "/api/v1/agent/critic",
      model: resolveAgentBudgetConfig(env).modelEnabled ? "configured" : "absent",
      tools: { research: [...toolNames("research")], prepare: [...toolNames("prepare")], execute: false },
      answerSections: [...AGENT_ANSWER_SECTIONS],
      briefSections: [...AGENT_BRIEF_SECTIONS],
      criticKinds: [...AGENT_CRITIC_KINDS],
      limits: { questionChars: AGENT_QUESTION_MAX, turnsKept: AGENT_TURNS_KEPT },
    },
    research: {
      evidence: "/api/v1/research/evidence",
      provider: NANSEN_RIGHTS.provider,
      attribution: NANSEN_RIGHTS.attribution,
      windows: [...EVIDENCE_WINDOWS],
      metrics: evidenceMetricDefinitions(),
      conditionsLimit: EVIDENCE_CONDITIONS_LIMIT,
      /* 1.6.0: every provider with the windows its metrics serve, in registry order. */
      providers: EVIDENCE_PROVIDERS.map((provider) => {
        const windows = [...new Set(metricsOfProvider(provider).flatMap((metric) => [...metric.windows]))] as EvidenceWindow[];
        return { provider, attribution: providerRights(provider).attribution, windows };
      }),
      addressEvidence: "/api/v1/research/address-evidence",
    },
    /* 1.20.0: «Популярне» the server lists; «Перевірка» travels as `check` on the swap's quote and order. */
    stocks: { popular: "/api/v1/stocks/popular", popularLimit: POPULAR_DEFAULT_LIMIT, popularMaxLimit: POPULAR_MAX_LIMIT },
    /* 1.21.0: Нагляд over positions — the states, the thresholds they are judged by, and «Ryntra попередить» with its presets. */
    positions: {
      list: "/api/v1/positions",
      watch: "/api/v1/positions/watch",
      presets: POSITION_WATCH_PRESETS_V1.map((id) => ({ id, stopPct: LOSS_LIMIT_PRESETS[id].stopPct, targetPct: LOSS_LIMIT_PRESETS[id].targetPct })),
      states: [...WATCH_STATES],
      nearLimitPct: NEAR_LIMIT_PCT,
      aboveExchangePct: ABOVE_EXCHANGE_PCT,
      priceMaxAgeMinutes: WATCH_PRICE_MAX_AGE_MS / 60_000,
      /* 1.23.0: «Ризик портфеля» — the route and the caps it judges. */
      risk: "/api/v1/positions/risk",
      assetCapPct: ASSET_CAP_PCT,
      privateCapPct: PRIVATE_CAP_PCT,
      capsFromUsd: CAPS_FROM_USD,
    },
    /* 1.22.0: «Гроші» — the payment links and their bounds, the recipient check, what the wallet returned, the transfer routes. */
    money: {
      payLinks: "/api/v1/pay/requests",
      expirations: [...PAY_LINK_EXPIRATIONS],
      defaultExpiration: DEFAULT_PAYMENT_EXPIRATION,
      descriptionMax: PAY_LINK_DESCRIPTION_MAX,
      listLimit: PAY_LINK_LIST_LIMIT_V1,
      recipient: "/api/v1/money/recipient",
      returned: "/api/v1/money/send/returned",
      transfer: "/api/solana/transfer",
    },
    /* 1.25.0: Ryntra Launch — only where it is served (the devnet stand now), with the network it launches on. */
    ...launchCapability(env),
    observedAt: (deps.now ?? (() => new Date()))().toISOString(),
  };
}

function launchCapability(env: NodeJS.ProcessEnv): Pick<Capabilities, "launch"> {
  const network = launchNetwork(env);
  if (!network) return {};
  return {
    launch: {
      network: network.chain,
      presets: "/api/v1/launch/presets",
      metadata: "/api/v1/launch/metadata",
      quote: "/api/v1/launch/quote",
      build: "/api/v1/launch/build",
      submit: "/api/v1/launch/submit",
      token: "/api/v1/launch/{mint}",
      market: "/api/v1/launch/{mint}/market",
      wallet: "/api/v1/launch/{mint}/wallet/{address}",
      tradeQuote: "/api/v1/launch/{mint}/trade/quote",
      tradeBuild: "/api/v1/launch/{mint}/trade/build",
      tradeSubmit: "/api/v1/launch/{mint}/trade/submit",
      creator: "/api/v1/launch/{mint}/creator",
      creators: "/api/v1/launch/creators/{address}",
      claimBuild: "/api/v1/launch/{mint}/claim/build",
      claimSubmit: "/api/v1/launch/{mint}/claim/submit",
      journal: "/api/v1/launch/{mint}/journal",
      holder: "/api/v1/launch/{mint}/holder/{address}",
      holderQuote: "/api/v1/launch/{mint}/holder/quote",
      holderBuild: "/api/v1/launch/{mint}/holder/build",
      holderSubmit: "/api/v1/launch/{mint}/holder/submit",
      holderPermissionBuild: "/api/v1/launch/{mint}/holder/permission/build",
      holderPermissionSubmit: "/api/v1/launch/{mint}/holder/permission/submit",
      holders: "/api/v1/launch/holders/{address}",
      tradeReceipt: "/api/v1/launch/{mint}/trade/receipt",
    },
  };
}
