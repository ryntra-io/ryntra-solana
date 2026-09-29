/**
 * The metric registry of the evidence layer — what an observation may be
 * called, in what unit, over which window, and whether a plan may make a
 * rule of it.
 *
 * A condition on a plan names a metric from this list and nothing else. The
 * list is deliberately short: every entry is a figure the adapter can fetch
 * from a permitted family, whose unit and aggregation are known, and whose
 * sentence a person can read without a glossary. "Any field the provider
 * returns" is not a registry; it is a leak with a schema.
 *
 * Two aggregations, because they mean different things:
 *
 * - `whole-market` — the figure covers every DEX trade of the token in the
 *   window as the source counts them. A required condition may stand on it.
 * - `cohort` — the figure covers the subset of addresses the source labels
 *   (exchanges, large holders). A transfer is not a purchase and a label is
 *   the source's classification, not a fact about a person; such a figure
 *   informs, so it is advisory only. That is the canon's *flows ≠ trades*
 *   written where a validator can read it.
 *
 * Two providers, one table: Nansen's figures are
 * rolling-window market activity; DD.xyz's are point-in-time facts about the
 * token's structure — a share of supply, a count, an authority that is
 * present or renounced, a tax — read over the `now` window, which is not a
 * duration but the moment the source last analysed the token. The sniper,
 * bundler and developer shares are the source's classification of addresses,
 * so they are cohort figures and advisory only, exactly like Nansen's
 * labelled groups: a label is not a fact about a person.
 *
 * Pure and client-safe. Provider-neutral: the names are Ryntra's, and the
 * mapping from a provider's fields to these ids lives in that provider's
 * adapter. The Ukrainian words sit beside the English ones because the web
 * and the phone both read this table and neither should retype it.
 */

export const EVIDENCE_PROVIDERS = ["nansen", "ddxyz"] as const;
export type EvidenceProvider = (typeof EVIDENCE_PROVIDERS)[number];

/**
 * The windows a person may choose. `24h` is the rolling day; `7d` the rolling
 * week; `now` is not a duration — it names a point-in-time observation (the
 * source's last analysis of the token), the only window a structural figure
 * has.
 */
export const EVIDENCE_WINDOWS = ["24h", "7d", "now"] as const;
export type EvidenceWindow = (typeof EVIDENCE_WINDOWS)[number];

/** The rolling windows a market figure covers — every window but `now`. */
export const MARKET_WINDOWS = ["24h", "7d"] as const;
export type MarketWindow = (typeof MARKET_WINDOWS)[number];

export const EVIDENCE_METRIC_IDS = [
  "dex_volume_usd",
  "dex_buy_volume_usd",
  "dex_sell_volume_usd",
  "dex_net_volume_usd",
  "exchange_net_flow_usd",
  "whale_net_flow_usd",
  "whale_wallet_count",
  /* DD.xyz — the token's structure, point in time. */
  "top10_holder_share_pct",
  "holder_count",
  "mint_authority",
  "freeze_authority",
  "transfer_tax_pct",
  "sniper_holding_pct",
  "bundler_holding_pct",
  "dev_holding_pct",
] as const;
export type EvidenceMetricId = (typeof EVIDENCE_METRIC_IDS)[number];

/**
 * `usd` and `wallets` are Nansen's; `percent` is a share of the supply,
 * `count` a whole number of addresses, `flag` an authority that is either
 * present (1) or renounced (0) — a figure so a condition can name it, never
 * a score.
 */
export type EvidenceUnit = "usd" | "wallets" | "percent" | "count" | "flag";
export type EvidenceAggregation = "whole-market" | "cohort";
export type EvidenceConditionMode = "advisory" | "required";
export type EvidenceOperator = "gt" | "gte" | "lt" | "lte";

export type EvidenceMetricWords = Readonly<{
  /** The short label a card shows. */
  label: string;
  /** What the figure is, in one sentence, for the `?` beside it. */
  meaning: string;
  /** The verb phrase a condition sentence uses, e.g. "24h DEX trading volume". */
  sentence: string;
}>;

export type EvidenceMetricDefinition = Readonly<{
  id: EvidenceMetricId;
  /** The provider whose adapter answers this figure; a condition on it is judged on that provider's read. */
  provider: EvidenceProvider;
  family: "dex-activity" | "cohort-flow" | "token-structure" | "holder-structure" | "launch-cohort";
  unit: EvidenceUnit;
  aggregation: EvidenceAggregation;
  /** Negative values carry meaning (a net outflow) or the figure is a count/volume that cannot be below zero. */
  sign: "signed" | "non-negative";
  windows: readonly EvidenceWindow[];
  /** The modes a condition on this metric may take; a cohort figure never carries `required`. */
  conditionModes: readonly EvidenceConditionMode[];
  words: Readonly<{ en: EvidenceMetricWords; uk: EvidenceMetricWords }>;
}>;

const BOTH_WINDOWS: readonly EvidenceWindow[] = ["24h", "7d"];
const NOW_ONLY: readonly EvidenceWindow[] = ["now"];

export const EVIDENCE_METRICS: readonly EvidenceMetricDefinition[] = [
  {
    id: "dex_volume_usd",
    provider: "nansen",
    family: "dex-activity",
    unit: "usd",
    aggregation: "whole-market",
    sign: "non-negative",
    windows: BOTH_WINDOWS,
    conditionModes: ["advisory", "required"],
    words: {
      en: { label: "DEX trading volume", meaning: "Everything bought and sold on decentralised exchanges in the window, in USD, as the source counts it.", sentence: "DEX trading volume" },
      uk: { label: "Обсяг торгів на DEX", meaning: "Усе куплене й продане на децентралізованих біржах за вікно, у USD, як його рахує джерело.", sentence: "обсяг торгів на DEX" },
    },
  },
  {
    id: "dex_buy_volume_usd",
    provider: "nansen",
    family: "dex-activity",
    unit: "usd",
    aggregation: "whole-market",
    sign: "non-negative",
    windows: BOTH_WINDOWS,
    conditionModes: ["advisory", "required"],
    words: {
      en: { label: "DEX buys", meaning: "The USD value of confirmed DEX purchases of the token in the window.", sentence: "DEX buy volume" },
      uk: { label: "Покупки на DEX", meaning: "Вартість підтверджених DEX-покупок токена за вікно, у USD.", sentence: "обсяг покупок на DEX" },
    },
  },
  {
    id: "dex_sell_volume_usd",
    provider: "nansen",
    family: "dex-activity",
    unit: "usd",
    aggregation: "whole-market",
    sign: "non-negative",
    windows: BOTH_WINDOWS,
    conditionModes: ["advisory", "required"],
    words: {
      en: { label: "DEX sells", meaning: "The USD value of confirmed DEX sales of the token in the window.", sentence: "DEX sell volume" },
      uk: { label: "Продажі на DEX", meaning: "Вартість підтверджених DEX-продажів токена за вікно, у USD.", sentence: "обсяг продажів на DEX" },
    },
  },
  {
    id: "dex_net_volume_usd",
    provider: "nansen",
    family: "dex-activity",
    unit: "usd",
    aggregation: "whole-market",
    sign: "signed",
    windows: BOTH_WINDOWS,
    conditionModes: ["advisory", "required"],
    words: {
      en: { label: "DEX buys minus sells", meaning: "Buy volume minus sell volume in the window; above zero more was bought than sold.", sentence: "DEX buys minus sells" },
      uk: { label: "Покупки мінус продажі на DEX", meaning: "Обсяг покупок мінус обсяг продажів за вікно; вище нуля — купили більше, ніж продали.", sentence: "покупки мінус продажі на DEX" },
    },
  },
  {
    id: "exchange_net_flow_usd",
    provider: "nansen",
    family: "cohort-flow",
    unit: "usd",
    aggregation: "cohort",
    sign: "signed",
    windows: BOTH_WINDOWS,
    conditionModes: ["advisory"],
    words: {
      en: { label: "Moved to or from exchanges", meaning: "The net USD value of the token that moved into (above zero) or out of (below zero) addresses the source labels as exchanges. A movement is not a trade.", sentence: "net token movement to exchanges" },
      uk: { label: "Рух на біржі та з бірж", meaning: "Чиста вартість токена, що перемістилася на адреси, які джерело позначає як біржі (вище нуля), або з них (нижче нуля), у USD. Переміщення — не угода.", sentence: "чистий рух токенів на біржі" },
    },
  },
  {
    id: "whale_net_flow_usd",
    provider: "nansen",
    family: "cohort-flow",
    unit: "usd",
    aggregation: "cohort",
    sign: "signed",
    windows: BOTH_WINDOWS,
    conditionModes: ["advisory"],
    words: {
      en: { label: "Moved by large holders", meaning: "The net USD value of the token that moved into (above zero) or out of (below zero) addresses the source labels as large holders. A movement is not a trade; a label is not an identity.", sentence: "net token movement by large holders" },
      uk: { label: "Рух великих власників", meaning: "Чиста вартість токена, що перемістилася на адреси, які джерело позначає як великих власників (вище нуля), або з них (нижче нуля), у USD. Переміщення — не угода; мітка — не особа.", sentence: "чистий рух токенів великих власників" },
    },
  },
  {
    id: "whale_wallet_count",
    provider: "nansen",
    family: "cohort-flow",
    unit: "wallets",
    aggregation: "cohort",
    sign: "non-negative",
    windows: BOTH_WINDOWS,
    conditionModes: ["advisory"],
    words: {
      en: { label: "Large-holder addresses active", meaning: "How many addresses the source labels as large holders moved the token in the window. Addresses, not people; one person may hold several.", sentence: "large-holder addresses active" },
      uk: { label: "Активних адрес великих власників", meaning: "Скільки адрес, які джерело позначає як великих власників, рухали токен за вікно. Адреси, не люди; одна людина може мати кілька.", sentence: "активних адрес великих власників" },
    },
  },
  /* ------------------------------------------------------------ DD.xyz — the token's structure, point in time */
  {
    id: "top10_holder_share_pct",
    provider: "ddxyz",
    family: "holder-structure",
    unit: "percent",
    aggregation: "whole-market",
    sign: "non-negative",
    windows: NOW_ONLY,
    conditionModes: ["advisory", "required"],
    words: {
      en: { label: "Held by the top 10", meaning: "How much of the supply the ten largest holders hold together, as the source counts it. An issuer's, a program's or an exchange's own accounts may be among them.", sentence: "share held by the top 10 holders" },
      uk: { label: "У 10 найбільших власників", meaning: "Скільки всієї пропозиції разом тримають десять найбільших власників, як рахує джерело. Серед них можуть бути рахунки емітента, програми чи біржі.", sentence: "частка у 10 найбільших власників" },
    },
  },
  {
    id: "holder_count",
    provider: "ddxyz",
    family: "holder-structure",
    unit: "count",
    aggregation: "whole-market",
    sign: "non-negative",
    windows: NOW_ONLY,
    conditionModes: ["advisory", "required"],
    words: {
      en: { label: "Holders", meaning: "How many addresses hold the token, as the source counts them. Addresses, not people.", sentence: "holders" },
      uk: { label: "Власників", meaning: "Скільки адрес тримають токен, як рахує джерело. Адреси, не люди.", sentence: "власників" },
    },
  },
  {
    id: "mint_authority",
    provider: "ddxyz",
    family: "token-structure",
    unit: "flag",
    aggregation: "whole-market",
    sign: "non-negative",
    windows: NOW_ONLY,
    conditionModes: ["advisory", "required"],
    words: {
      en: { label: "Mint authority", meaning: "Whether the supply can still be increased by the token's authority (present) or that right was given up (renounced), as the source reads the mint.", sentence: "mint authority" },
      uk: { label: "Право емісії", meaning: "Чи може пропозицію токена ще збільшити його авторитет (є), чи це право відкинуто (відкинуто) — як джерело читає мінт.", sentence: "право емісії" },
    },
  },
  {
    id: "freeze_authority",
    provider: "ddxyz",
    family: "token-structure",
    unit: "flag",
    aggregation: "whole-market",
    sign: "non-negative",
    windows: NOW_ONLY,
    conditionModes: ["advisory", "required"],
    words: {
      en: { label: "Freeze authority", meaning: "Whether an authority can freeze token accounts (present) or that right was given up (renounced). An issuer-backed instrument may keep it by design.", sentence: "freeze authority" },
      uk: { label: "Право заморозки", meaning: "Чи може авторитет заморожувати рахунки токена (є), чи це право відкинуто (відкинуто). Інструмент із емітентом може тримати його за задумом.", sentence: "право заморозки" },
    },
  },
  {
    id: "transfer_tax_pct",
    provider: "ddxyz",
    family: "token-structure",
    unit: "percent",
    aggregation: "whole-market",
    sign: "non-negative",
    windows: NOW_ONLY,
    conditionModes: ["advisory", "required"],
    words: {
      en: { label: "Transfer tax", meaning: "A fee the token itself takes on every transfer (a Token-2022 extension), in percent of the amount; zero when it has none.", sentence: "transfer tax" },
      uk: { label: "Податок на переказ", meaning: "Комісія, яку сам токен бере з кожного переказу (розширення Token-2022), у відсотках від суми; нуль, коли її немає.", sentence: "податок на переказ" },
    },
  },
  {
    id: "sniper_holding_pct",
    provider: "ddxyz",
    family: "launch-cohort",
    unit: "percent",
    aggregation: "cohort",
    sign: "non-negative",
    windows: NOW_ONLY,
    conditionModes: ["advisory"],
    words: {
      en: { label: "Held by early snipers", meaning: "The share of supply held now by addresses the source labels as snipers — buyers in the first moments after launch. A label is the source's classification, not a fact about a person; on a token launched long ago it means little.", sentence: "share held by early snipers" },
      uk: { label: "У ранніх снайперів", meaning: "Частка пропозиції, яку зараз тримають адреси, що джерело позначає як снайперів — покупців у перші хвилини після запуску. Мітка — класифікація джерела, не факт про особу; для давно запущеного токена вона мало що означає.", sentence: "частка у ранніх снайперів" },
    },
  },
  {
    id: "bundler_holding_pct",
    provider: "ddxyz",
    family: "launch-cohort",
    unit: "percent",
    aggregation: "cohort",
    sign: "non-negative",
    windows: NOW_ONLY,
    conditionModes: ["advisory"],
    words: {
      en: { label: "Held by bundled buyers", meaning: "The share held now by addresses the source labels as bundlers — buys packed into the launch transactions. The source's classification, not a fact about a person.", sentence: "share held by bundled buyers" },
      uk: { label: "У пакетних покупців", meaning: "Частка, яку зараз тримають адреси, що джерело позначає як бандлерів — покупки, зібрані в транзакції запуску. Класифікація джерела, не факт про особу.", sentence: "частка у пакетних покупців" },
    },
  },
  {
    id: "dev_holding_pct",
    provider: "ddxyz",
    family: "launch-cohort",
    unit: "percent",
    aggregation: "cohort",
    sign: "non-negative",
    windows: NOW_ONLY,
    conditionModes: ["advisory"],
    words: {
      en: { label: "Held by the developer", meaning: "The share held by the address the source identifies as the token's developer. For an issuer-backed instrument this is usually the issuer's own supply, kept by design.", sentence: "share held by the developer" },
      uk: { label: "У розробника", meaning: "Частка, яку тримає адреса, що джерело визначає як розробника токена. Для інструмента з емітентом це зазвичай власна пропозиція емітента, за задумом.", sentence: "частка у розробника" },
    },
  },
];

const BY_ID: ReadonlyMap<EvidenceMetricId, EvidenceMetricDefinition> = new Map(EVIDENCE_METRICS.map((metric) => [metric.id, metric]));

export function evidenceMetric(id: string): EvidenceMetricDefinition | null {
  return BY_ID.get(id as EvidenceMetricId) ?? null;
}

export function isEvidenceMetricId(id: string): id is EvidenceMetricId {
  return BY_ID.has(id as EvidenceMetricId);
}

export function isEvidenceWindow(window: string): window is EvidenceWindow {
  return (EVIDENCE_WINDOWS as readonly string[]).includes(window);
}

export function isEvidenceProvider(provider: string): provider is EvidenceProvider {
  return (EVIDENCE_PROVIDERS as readonly string[]).includes(provider);
}

/** The provider that serves a window when none is named: `now` is DD.xyz's, the rolling windows are Nansen's. */
export function providerOfWindow(window: EvidenceWindow): EvidenceProvider {
  return window === "now" ? "ddxyz" : "nansen";
}

/** The metrics one provider serves, in registry order. */
export function metricsOfProvider(provider: EvidenceProvider): readonly EvidenceMetricDefinition[] {
  return EVIDENCE_METRICS.filter((metric) => metric.provider === provider);
}
