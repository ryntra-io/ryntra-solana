import type { PageRoute } from "./domains";

/**
 * Where each registered page of Ryntra opens, and everything it owns.
 *
 * One product, one active network. The
 * routes below stay under `/app`, which is the wallet provider's subtree —
 * physical URL unification is not required where
 * moving a page would risk wallet state, recovery, receipts or a financial
 * boundary, and every money surface in this product lives under one wallet
 * provider. Clean single-segment customer URLs are a recorded future migration,
 * not a risk taken for tidiness.
 *
 * **The four groups, since 2026-09-14.** TRADE is Swap ·
 * Spot · Stocks · Trends, with Perps and Predictions registered PLANNED and
 * not drawn — and since 2026-09-17
 * Predictions drawn as a paper-mode market; MONEY is Send · Receive · Bridge · Rewards; MANAGE is Portfolio ·
 * History. Stocks is a page of its own — the research workspace for tokenized
 * stocks and ETFs — while Spot remains the execution surface for every class.
 * Memes stay a category inside Spot and a mode inside Trends; screeners for
 * crypto are Trends; the strategy types are inside My strategies; Research →
 * Critic → Risk are inside Ideas; Strategy Memory is inside Results; a
 * receipt is History detail. None of those is a row here.
 *
 * `match` is the load-bearing half, and it is what keeps *old URLs lead to the
 * new place, and operations already under way stay reachable* from being a
 * promise nobody implemented:
 *
 * - **Swap owns `/app/trade`**, the address its form answered to before the
 *   page was renamed. Bridge answers for itself, so a person standing on
 *   it sees Bridge marked current rather than Swap.
 * - **Trends owns `/app/assets`.** Asset detail is what a token opens into.
 * - **History owns `/app/receipts`.** A receipt is the detail of an operation,
 *   not a competing application. `/app/history` is a permanent redirect *to*
 *   `/app/activity` that browsers have cached since the six-domain model, so
 *   the address stays and only the word changed — reversing a cached 308
 *   would loop every browser that had followed it.
 * - **My strategies owns the decision surfaces** — plans, action cases, alerts
 *   and the agent directory — because the bell links to that same record
 *   rather than to a second queue with its own status.
 *
 * `readiness` is the other load-bearing half. Declaring it once here is what
 * stops the rail and the page from disagreeing: both read this field, neither
 * owns the answer. A planned page is registered, served and honest on itself,
 * and is not projected into the rail.
 *
 * **The menu v6.2, since 2026-10-06**. The menu is
 * sections, not these pages; which section holds a page is `MENU_SECTIONS` in
 * `domains.ts`, and its pages are tabs at the top of it. Stocks and Trends are
 * one screener in «Ринки» (`/app/markets`); My strategies and Results are
 * «Боти → Мої боти» (`/app/bots`). The comments below keep the group each page
 * was written for — TRADE, MONEY, MANAGE — because that is still the kind of
 * work it does (the API's capabilities carry it), not because the rail draws it.
 */

const BASE = "/app";

export const PRODUCT_ROUTES: readonly PageRoute[] = [
  /* ------------------------------------------------------------------ TRADE */
  {
    id: "swap",
    href: `${BASE}/swap`,
    icon: "swap",
    readiness: "available",
    /* Swap is Solana-only and Jupiter-only. The
       page itself still redirects a cross-network link to Bridge, so old URLs
       keep leading to the new place — they lead there rather than being
       absorbed here. */
    match: [`${BASE}/swap`, `${BASE}/trade`],
  },
  {
    id: "spot",
    href: `${BASE}/spot`,
    icon: "spot",
    /* Live: one market terminal with Crypto, Memes and
       Stocks/RWA inside it, on the engine Swap runs on. */
    readiness: "available",
    match: [`${BASE}/spot`],
  },
  {
    id: "stocks",
    /* Since the menu v6.2 (2026-10-06) the stock screener is «Ринки»'s
       «Акції» tab — one table for every asset; `/app/stocks` and
       `/app/stocks/screener` lead there, and a company's page stays at
       `/app/stocks/<ticker>`. */
    href: `${BASE}/markets`,
    icon: "stocks",
    /*
     * The research workspace for tokenized stocks and ETFs on
     * Solana. `building` on the day it shipped (2026-09-14) with a composed
     * first screen; `available` since 2026-09-15 on
     * the evidence the readiness model asks for — the confirmed universe,
     * the screener, the asset page with the issuer's reference, the session
     * and the units from the chain, the size-aware quote, the Spot handoff,
     * and the first purchase of a tokenized stock landed through Spot on
     * 2026-09-14, with the
     * quote path made reliable under concurrent use in the same change. What
     * the Strategy layer will add is not part of this readiness.
     */
    readiness: "available",
    match: [`${BASE}/stocks`],
  },
  {
    id: "trends",
    icon: "trends",
    /* `available` since 2026-09-23: the two modes
       with no list left the surface, and what is
       drawn — Trending and Memes over the ranked universe Spot reads, and the
       door to Stocks — lists the provider's own figures and opens Spot. */
    readiness: "available",
    /* Since the menu v6.2 (2026-10-06) Trends is a sort of «Ринки» —
       «У тренді» — not a page: its address leads there. The Asset Passport is
       what one of its rows opened into. */
    href: `${BASE}/markets`,
    match: [`${BASE}/trends`, `${BASE}/assets`],
  },
  {
    id: "perps",
    href: `${BASE}/perps`,
    icon: "perps",
    /* Planned as the registered page of trading from Ryntra (B6b); its address is the row Perps' own already — Phoenix
       inside Solana, view only and collateral (B7, PERP-1) — so the not-yet surface is drawn nowhere. */
    readiness: "planned",
    match: [`${BASE}/perps`],
  },
  {
    id: "predictions",
    href: `${BASE}/predictions`,
    icon: "predictions",
    /* Prediction markets through aggregated venues,
       registered planned until access existed. Since 2026-09-17
       the paper product exists —
       discovery across the aggregator's venues, the market detail with
       Research and Market depth, the Prediction Plan, the Review over the
       smart route, a paper order the provider's own ledgers confirm, the
       identity mapped behind the Ryntra account — so the page earns
       `available` on the readiness model's own terms: a verified capability
       (paper trading, said as such on every surface) the person can carry
       out here. Live trading is a separate future decision. */
    readiness: "available",
    match: [`${BASE}/predictions`],
  },

  /* ------------------------------------------------------------- STRATEGIES */
  {
    id: "ideas",
    href: `${BASE}/ideas`,
    icon: "ideas",
    /* The research and adviser surfaces exist and are real, but their sources
       are Arcus and Robinhood Chain and their records are scoped to an account
       rather than to the connected wallet. Nothing in this product turns a note
       into an analysis yet, so the page is the structure and says so. */
    readiness: "planned",
    /* Not `/app/strategy-lab`. That surface is live and deliberately outside
       every menu (`FLAGS.strategyLab.navigation` is false), so claiming it here
       would light a row over a working page — and redirecting it would delete
       a tool somebody may be mid-draft in. It stays served and unowned, the
       way Settings is. */
    match: [`${BASE}/ideas`, `${BASE}/research`, `${BASE}/adviser`],
  },
  {
    id: "my-strategies",
    /* «Боти → Мої боти» since the menu v6.2 (2026-10-06): the plans and the
       recurring-buy rules in one list; the builder and a plan's page stay under
       `/app/strategies`. */
    href: `${BASE}/bots`,
    icon: "strategies",
    /* Stage A: the Trading Plan is the page — the
       wallet's plans, the builder with its deterministic size and check, the
       detail with versions and journal — live on the plan store behind the
       wallet's proof. The Review's Strategy block and Plan vs Actual are
       stage B and do not gate the page. */
    readiness: "available",
    /*
     * One page, one queue. Plans is not a second duplicating system and the
     * bell points at the same record the queue holds, so every surface that
     * used to answer "what needs me" resolves here: saved plans, action cases,
     * alerts and what the Agents entry used to open.
     */
    match: [
      `${BASE}/bots`,
      `${BASE}/strategies`,
      `${BASE}/plans`,
      `${BASE}/action-cases`,
      `${BASE}/alerts`,
      `${BASE}/control`,
      `${BASE}/agents`,
    ],
  },
  {
    id: "results",
    /* A plan's result is on its card in «Мої боти» since the menu v6.2. */
    href: `${BASE}/bots`,
    icon: "results",
    /* Available: the five things Results owns
       are all drawn — an operation as an entry or an exit, what a plan's own
       executions add up to as a position, an exit judged only by rules that
       existed before it, a plan that made no trade with the rule that
       refused it, and a memory of facts that each cite their record. What
       cannot be established is said to be unknown rather than left out. */
    readiness: "available",
    match: [`${BASE}/results`, `${BASE}/journal`, `${BASE}/brief`, `${BASE}/coverage`],
  },

  /* ------------------------------------------------------------------ MONEY */
  {
    id: "send",
    href: `${BASE}/send`,
    icon: "send",
    readiness: "available",
    match: [`${BASE}/send`],
  },
  {
    id: "receive",
    href: `${BASE}/receive`,
    icon: "receive",
    readiness: "available",
    match: [`${BASE}/receive`],
  },
  {
    id: "bridge",
    href: `${BASE}/bridge`,
    icon: "bridge",
    readiness: "available",
    /*
     * A page in MONEY: cross-network execution has other
     * wallets, other states, other providers and its own recovery, so it is a
     * funding surface beside Send and Receive rather than a second trading
     * form. Restored as a page on 2026-09-10 — "exchange two
     * assets on Solana" and "move value from another network" share a shape
     * and share no code, and each page owns one provider and one failure, so
     * Relay being down leaves Swap working and a Jupiter problem leaves Bridge
     * working. Moving the row changed no financial mechanism.
     */
    match: [`${BASE}/bridge`],
  },
  {
    id: "rewards",
    href: `${BASE}/rewards`,
    icon: "rewards",
    /*
     * Rewards is a page in MONEY, because Send
     * and Receive are money moving and Rewards is money arriving.
     *
     * `available` because the surface is real on the day it ships: a person
     * sees what they have earned, what is pending, their own referral link and
     * the claim control with the reason it is or is not offered. What the page
     * cannot do without a funded treasury is pay — and it says so in a sentence
     * rather than by pretending to be unfinished.
     */
    readiness: "available",
    match: [`${BASE}/rewards`],
  },

  /* ----------------------------------------------------------------- MANAGE */
  {
    id: "portfolio",
    href: `${BASE}/portfolio`,
    icon: "portfolio",
    readiness: "available",
    /*
     * Portfolio is the functional overview of what a person owns, where the
     * funds are and what is open. `${BASE}` itself redirects here — see
     * `lib/product/customer-routing.ts` — so the product root is not listed as
     * an owned prefix, which would otherwise make every unowned page under
     * `/app` mark Portfolio current.
     */
    match: [`${BASE}/portfolio`],
  },
  {
    id: "activity",
    href: `${BASE}/activity`,
    icon: "activity",
    readiness: "available",
    /* History. The id and the address stay; the label is the product's word.
       Not `/app/operations`: that path redirects to Settings, and a registry
       that claims a route the router sends elsewhere gives one URL two
       answers. */
    match: [`${BASE}/activity`, `${BASE}/receipts`, `${BASE}/fees`],
  },
];
