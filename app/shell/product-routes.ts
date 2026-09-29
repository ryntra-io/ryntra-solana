import type { PageRoute } from "./domains";

/**
 * Where each registered page of Ryntra opens, and everything it owns.
 *
 * Owner decision of 2026-09-04, unchanged: one product, one active network. The
 * routes below stay under `/app`, which is the wallet provider's subtree — the
 * directive is explicit that physical URL unification is not required where
 * moving a page would risk wallet state, recovery, receipts or a financial
 * boundary, and every money surface in this product lives under one wallet
 * provider. Clean single-segment customer URLs are a recorded future migration,
 * not a risk taken for tidiness.
 *
 * **Canon v4.0, adopted 2026-09-14 (MASTER-PLAN Part A §5).** TRADE is Swap ·
 * Spot · Stocks · Trends, with Perps and Predictions registered PLANNED and
 * not drawn — and since canon v4.3 (2026-09-17, §6.5, `RYN-PREDICTIONS-001`)
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
 *   canon renamed the page. Bridge answers for itself, so a person standing on
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
 * **Canon v5.3 (2026-09-24, В28): one version.** The menu is five places, not
 * these pages; which place holds a page is `PLACE_PAGES` in `domains.ts`. The
 * comments below keep the group each page was written for — TRADE, MONEY,
 * MANAGE — because that is still the kind of work it does (the API's
 * capabilities carry it), not because the rail draws it.
 */

const BASE = "/app";

export const PRODUCT_ROUTES: readonly PageRoute[] = [
  /* ------------------------------------------------------------------ TRADE */
  {
    id: "swap",
    href: `${BASE}/swap`,
    icon: "swap",
    readiness: "available",
    /* Swap is Solana-only and Jupiter-only (Owner decision 2026-09-10). The
       page itself still redirects a cross-network link to Bridge, so old URLs
       keep leading to the new place — they lead there rather than being
       absorbed here. */
    match: [`${BASE}/swap`, `${BASE}/trade`],
  },
  {
    id: "spot",
    href: `${BASE}/spot`,
    icon: "spot",
    /* Live since `RYN-SPOT-V1-001`: one market terminal with Crypto, Memes and
       Stocks/RWA inside it, on the engine Swap runs on. */
    readiness: "available",
    match: [`${BASE}/spot`],
  },
  {
    id: "stocks",
    /* The screener since canon v5.3 (2026-09-24, `RYN-NAV-V5-001`): Stocks is
       a tool of Markets' «Для досвідчених», and it opens on every confirmed
       token with its filters. `/app/stocks` itself is Markets for everyone —
       companies first — the address the landing gives. */
    href: `${BASE}/stocks/screener`,
    icon: "stocks",
    /*
     * Canon v4.0 §7: the research workspace for tokenized stocks and ETFs on
     * Solana. `building` on the day it shipped (2026-09-14) with a composed
     * first screen; `available` since `RYN-STOCKS-PRO-001` (2026-09-15) on
     * the evidence the readiness model asks for — the confirmed universe,
     * the screener, the asset page with the issuer's reference, the session
     * and the units from the chain, the size-aware quote, the Spot handoff,
     * and the first purchase of a tokenized stock landed through Spot on
     * 2026-09-14 (the Owner's own signature, `RYN-SPOT-LIVE-002`), with the
     * quote path made reliable under concurrent use in the same task. What
     * the Strategy layer will add is not part of this readiness.
     */
    readiness: "available",
    match: [`${BASE}/stocks`],
  },
  {
    id: "trends",
    href: `${BASE}/trends`,
    icon: "trends",
    /* `available` since `RYN-SURFACE-CLEAN-001` (2026-09-23): the two modes
       with no list left the surface (canon v5.0 §0.0 rule 10), and what is
       drawn — Trending and Memes over the ranked universe Spot reads, and the
       door to Stocks — lists the provider's own figures and opens Spot. */
    readiness: "available",
    /* The old Markets landing is this page's earlier form, and the Asset
       Passport is what one of its rows opens into. Both belong here. */
    match: [`${BASE}/trends`, `${BASE}/markets`, `${BASE}/assets`],
  },
  {
    id: "perps",
    href: `${BASE}/perps`,
    icon: "perps",
    /* Registered and served; not a row until it is ready (canon v4.0 §6.4). */
    readiness: "planned",
    match: [`${BASE}/perps`],
  },
  {
    id: "predictions",
    href: `${BASE}/predictions`,
    icon: "predictions",
    /* Owner decision 2026-09-11: prediction markets through aggregated venues,
       registered planned until access existed. Owner decision 2026-09-17
       (canon v4.3 §6.5, `RYN-PREDICTIONS-001`): the paper product exists —
       discovery across the aggregator's venues, the market detail with
       Research and Market depth, the Prediction Plan, the Review over the
       smart route, a paper order the provider's own ledgers confirm, the
       identity mapped behind the Ryntra account — so the page earns
       `available` on the readiness model's own terms: a verified capability
       (paper trading, said as such on every surface) the person can carry
       out here. Live trading is a separate future Owner decision. */
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
    href: `${BASE}/strategies`,
    icon: "strategies",
    /* `RYN-STRATEGY-PLAN-001` stage A: the Trading Plan is the page — the
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
    href: `${BASE}/results`,
    icon: "results",
    /* Available since RYN-RESULTS-MEMORY-001: the five things Results owns
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
     * A page in MONEY (canon v4.0 §6.3): cross-network execution has other
     * wallets, other states, other providers and its own recovery, so it is a
     * funding surface beside Send and Receive rather than a second trading
     * form. Restored as a page by Owner decision of 2026-09-10 — "exchange two
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
     * Owner decision of 2026-09-10: Rewards is a page in MONEY, because Send
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
    /* History. The id and the address stay; the label is the canon's word.
       Not `/app/operations`: that path redirects to Settings, and a registry
       that claims a route the router sends elsewhere gives one URL two
       answers. */
    match: [`${BASE}/activity`, `${BASE}/receipts`],
  },
];
