import type { DomainLabel, PageReadiness } from "../../app/shell/domains.ts";

/**
 * The strategy types Ryntra will offer, and how far each one is.
 *
 * Owner decision of 2026-09-11: **My strategies owns the strategy types.**
 * DCA, Grid, Free Capital / Treasury, Rebalancing, Liquidity and Spend &
 * Invest are types inside that page, beside Trading Plan — never rows of the
 * rail, and never a builder that pretends to run before its engine exists.
 *
 * **Registered, not drawn** (canon v5.0 §0.0 rule 10, adopted 2026-09-23):
 * only what is built reaches a customer screen, so the six locked types are
 * kept here as the target product and shown nowhere — no *Coming soon*, no
 * *Planned* row, no count. Deferred work lives in the registry and in canon
 * B.17, not in the interface; `RYN-SURFACE-CLEAN-001` took the folded
 * catalog off My strategies.
 *
 * The one type not locked is Trading Plan: the plans a person has saved are
 * already read back from the store that wrote them, and the plan engine —
 * thesis, entry, exit, size, horizon, Review — is the next development WIP
 * by the Owner's selection. It is `building`, in the same three-word
 * vocabulary the pages use (§14.2), so the rail and this catalog can never
 * disagree about what a word means.
 *
 * *Spend & Invest* is a rule that connects a spending event to an investment
 * — a purchase or a round-up sends a defined amount into SOL, a basket or a
 * tokenized stock. It is a strategy type, not a page.
 */

export const STRATEGY_TYPE_IDS = [
  "trading-plan",
  "dca",
  "grid",
  "free-capital",
  "rebalancing",
  "liquidity",
  "spend-invest",
] as const;

export type StrategyTypeId = (typeof STRATEGY_TYPE_IDS)[number];

export type StrategyType = Readonly<{
  id: StrategyTypeId;
  readiness: PageReadiness;
  name: DomainLabel;
  /** One line: what the type is. Never a promise about its result. */
  blurb: DomainLabel;
}>;

export const STRATEGY_TYPES: readonly StrategyType[] = [
  {
    id: "trading-plan",
    /* Live since RYN-STRATEGY-PLAN-001 stage A: the plan on the server with versions, a deterministic size and check. */
    readiness: "available",
    name: { en: "Trading Plan", uk: "Торговий план" },
    blurb: {
      en: "Rules you write before you sign — checked on the Review, kept beside the result.",
      uk: "Правила, які ти пишеш до підпису — перевірені в Review, збережені поруч із результатом.",
    },
  },
  {
    id: "dca",
    readiness: "planned",
    name: { en: "DCA", uk: "DCA" },
    blurb: {
      en: "A fixed amount at a fixed rhythm, every buy under Review.",
      uk: "Фіксована сума з фіксованим ритмом, кожна купівля через Review.",
    },
  },
  {
    id: "grid",
    readiness: "planned",
    name: { en: "Grid", uk: "Сітка" },
    blurb: {
      en: "Trade a range by set levels, a budget and a risk.",
      uk: "Торгуй діапазон за заданими рівнями, бюджетом і ризиком.",
    },
  },
  {
    id: "free-capital",
    readiness: "planned",
    /* The Owner's wording of 2026-09-15: the Ukrainian name is the short one, the blurb says treasury. */
    name: { en: "Free Capital / Treasury", uk: "Вільний капітал" },
    blurb: {
      en: "A treasury rule: spread idle capital across stablecoins, RWA and a trading reserve.",
      uk: "Казначейська стратегія: розподіл вільного капіталу між stablecoins, RWA і торговим резервом.",
    },
  },
  {
    id: "rebalancing",
    readiness: "planned",
    name: { en: "Rebalancing", uk: "Ребалансування" },
    blurb: {
      en: "Target weights, and the trades that bring a portfolio back to them.",
      uk: "Цільові ваги і угоди, що повертають портфель до них.",
    },
  },
  {
    id: "liquidity",
    readiness: "planned",
    name: { en: "Liquidity", uk: "Ліквідність" },
    blurb: {
      en: "A pool position with its range, fees and risk in view.",
      uk: "Позиція в пулі з видимими діапазоном, комісіями та ризиком.",
    },
  },
  {
    id: "spend-invest",
    readiness: "planned",
    name: { en: "Spend & Invest", uk: "Витрати та інвестиції" },
    blurb: {
      en: "A purchase or a round-up sends a set amount into SOL, a basket or a stock.",
      uk: "Покупка або округлення відправляє визначену суму в SOL, кошик або акцію.",
    },
  },
];
