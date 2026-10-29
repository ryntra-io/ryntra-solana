import type { DomainLabel, PageReadiness } from "../../app/shell/domains.ts";

/**
 * The strategy types Ryntra will offer, and how far each one is.
 *
 * **My strategies owns the strategy types** (since 2026-09-11). DCA, Grid,
 * Free Capital / Treasury, Rebalancing, Liquidity and Spend & Invest are types
 * inside that page, beside Trading Plan — never rows of the rail, and never a
 * builder that pretends to run before its engine exists.
 *
 * **Registered, not drawn** (since 2026-09-23): only what is built reaches a
 * customer screen, so the six locked types are kept here as the target product
 * and shown nowhere — no *Coming soon*, no *Planned* row, no count. Deferred
 * work is tracked outside the interface, and the folded catalog left My
 * strategies with that rule.
 *
 * The one type not locked is Trading Plan: the plans a person has saved are
 * already read back from the store that wrote them, and the plan engine —
 * thesis, entry, exit, size, horizon, Review — was the next piece of
 * development work and is now live. Its readiness uses the same three-word
 * vocabulary the pages use, so the rail and this catalog can never disagree
 * about what a word means.
 *
 * **The library of «Боти»**: a bot is a strategy
 * from this list and an executor that depends on the market. «Боти → Каталог»
 * draws the available types from here and nothing else, each with how it runs
 * and where it is set up. Three are live on Solana: the trade plan, the
 * recurring buy (the DCA type: Ryntra reminds, the person signs every buy) and
 * the grid on Meteora DLMM — liquidity spread evenly over the pool's own price
 * steps, so the pool itself fills each level both ways; placed and collected by
 * the person's signature, with no delegate, no durable nonce and no server key.
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
  /** Available types only: one line on how it runs — who signs, what holds the money. */
  runs?: DomainLabel;
  /** Available types only: where it is set up. */
  setup?: string;
}>;

export const STRATEGY_TYPES: readonly StrategyType[] = [
  {
    id: "trading-plan",
    /* Live since 2026-09-15: the plan on the server with versions, a deterministic size and check. */
    readiness: "available",
    name: { en: "Trade plan", uk: "План угоди" },
    blurb: {
      en: "Your rules before you sign, kept beside the result.",
      uk: "Твої правила до підпису, збережені поруч із результатом.",
    },
    runs: { en: "Entry, size, stop and target; you sign the trade.", uk: "Вхід, розмір, стоп і ціль; угоду підписуєш ти." },
    setup: "/app/strategies/new",
  },
  {
    id: "dca",
    /* Live as «Регулярна купівля» (1.31.0): Ryntra reminds, the person signs every buy. */
    readiness: "available",
    name: { en: "Recurring buy", uk: "Регулярна купівля" },
    blurb: {
      en: "A set amount on a rhythm, on a dip or from each payment.",
      uk: "Сума в ритмі, на падінні чи з кожної оплати.",
    },
    runs: { en: "Ryntra reminds you; you sign every buy and the money stays in your wallet.", uk: "Ryntra нагадує; кожну купівлю підписуєш ти, гроші — у твоєму гаманці." },
    /* SOL-C15 (UX-701): set up from «Боти» — «Обрати токен» opens the picker, then the rule's sheet; no detour through Markets. */
    setup: "/app/bots",
  },
  {
    id: "grid",
    /* Live since B10 (20.10.2026): Meteora DLMM, the pool's bins are the levels. */
    readiness: "available",
    name: { en: "Grid", uk: "Грід" },
    blurb: {
      en: "Buy levels below the price and sell levels above it, in a pool's own price steps.",
      uk: "Рівні купівлі нижче ціни й продажу вище неї — у власних кроках ціни пулу.",
    },
    runs: { en: "The pool fills each level both ways; you earn a share of its fee.", uk: "Пул виконує рівні в обидва боки; ти отримуєш частку комісії." },
    setup: "/app/bots/grid",
  },
  {
    id: "free-capital",
    readiness: "planned",
    /* The Ukrainian name is deliberately the short one; the blurb says treasury. */
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
