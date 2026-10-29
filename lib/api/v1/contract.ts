/**
 * The versioned API contract for native clients — v1.
 *
 * One place says what the contract is: its version, its headers, its error
 * shape, and the schema of every message the native client sends or receives
 * on the v1 routes. The routes validate with these schemas, the examples under
 * `docs/api/examples/` are checked against them by a test, the OpenAPI
 * document mirrors them, and the client package's types are inferred from
 * them — so a change here is a change everywhere, and a shape the native
 * client reads is never a guess.
 *
 * Pure and client-safe: no clock, no store, no `process.env`.
 *
 * ## Versioning
 *
 * - `X-Ryntra-API` names the **major** contract a client speaks; v1 routes
 *   accept `1` and answer `X-Ryntra-API-Version: 1.0.0` (the exact contract
 *   version they implement). A request without the header is answered too —
 *   the header is not a contract, the routes are — but a request naming a
 *   major this server does not serve is refused `UNSUPPORTED_API` (426) rather
 *   than answered with a shape the client will misread.
 * - Within a major, fields are only added, never renamed or removed; a new
 *   optional field is not a new version. A removed or re-typed field is a new
 *   major, served beside the old one for the window `/api/v1/capabilities`
 *   announces.
 * - Clients below `minimumAppVersion` are refused `UNSUPPORTED_CLIENT` (426) at
 *   sign-in and told the version they need; nothing degrades silently.
 *
 * ## Semantics every route shares
 *
 * - An asset is identified by **network + mint** (`solana:mainnet`, base58).
 *   A symbol is a label, never an identity.
 * - Units are named: `token` units are the chain's; `underlying` units are
 *   the issuer's share. A figure without a stated unit does not exist here.
 * - Every reference carries `source` and `observedAt`; `state` is one of
 *   `current`, `stale`, `unavailable` — decided by age against the stated
 *   rule, never promoted by a session.
 * - Errors are `{ error: { code, message } }` with an HTTP status; `code` is
 *   stable and machine-readable, `message` is for a log, not a screen.
 * - Capability availability is read from `/api/v1/capabilities`, which
 *   projects the product registry (`app/shell/product-routes.ts`): a module is
 *   `available`, `building` or `planned`, and a route of a module that is not
 *   available answers `CAPABILITY_UNAVAILABLE` (503) rather than a fixture.
 *
 * ## 1.1.0 — the plan, its review, its execution binding, the device registry
 *
 * Additive. The Trading Plan (spot-long without leverage) is one shape for
 * the web and the phone: rules that make a version, a deterministic size
 * computed from them, a journal of decisions, and the executions bound to a
 * version before signing. The Review's Strategy block (`PlanReview`) is the
 * list of checks a plan's version passes or fails on the quote in front of
 * the person; an unknown is never a pass. An order names the plan version it
 * executes under (`ExecutionPlanBinding`) and the issuer-signed bundle
 * carries it, so the operation row is bound to the version that existed
 * before the signature. The notification device registry is a schema here;
 * its route comes with push monitoring.
 *
 * ## 1.2.0 — the plan routes are live
 *
 * Additive. `/api/v1/plans`, `/api/v1/plans/{id}`, `…/{id}/status` and
 * `…/{id}/versions/{n}` serve the 1.1.0 shapes behind the proven wallet —
 * the native bearer or the web's proof cookie, the same routes for both
 * clients — and `capabilities.plans` names them.
 *
 * ## 1.3.0 — the plan joined to the deal
 *
 * Additive. The Strategy block is judged on the order route
 * (`origin.plan` on `POST /api/solana/swap/order`, for the proven wallet
 * that is the taker): four checks join the thirteen — `invalidation`,
 * `spend`, `risk` and `size` — so a deal that fits the budget but exceeds
 * the planned risk at this price is refused (`PLAN_REVIEW_BLOCKED`, 409,
 * the block in the error) before any bytes reach the wallet. `PlanReview`
 * carries `reviewId` (the operation's own id), the modelled loss at the
 * quote and the amount that fits the plan at this price. The plan records
 * the Review before the signature and the execution after the History row;
 * `executions[]` names the Review; `PlanResult` is Plan · Before signing ·
 * Actual for one execution, served by `GET /api/v1/plans/{id}/results` and
 * `GET /api/v1/plans/results`, with `sync` saying whether every execution
 * History holds is on the plan yet.
 *
 * ## 1.4.0 — the unit a plan is priced in
 *
 * Additive. `PlanAsset.unitBasis` names the unit every per-unit price of the
 * plan is in: `share` (the underlying share — every plan written before this
 * version, and every listed-equity issuer) or `token` (one token as the wallet
 * shows it — the pre-IPO issuers, PreStocks and Tessera, whose documents state
 * no unit of one share Ryntra can check). A reader that does not know the
 * field reads a share plan exactly as before; a plan on a token-priced asset
 * carries `unitBasis: "token"` and its Review answers `quote.unit: "token"`
 * with the same figures on the scaled amount. The rules, the sizing and the
 * checks do not change; the word beside the figure does. The issuer's own
 * mark of a pre-IPO token is not a reference: `reference` stays unavailable
 * and a plan that requires one stays blocked on it.
 *
 * ## 1.5.0 — evidence: the observation, the condition, the check
 *
 * Additive. An **observation** (`MarketEvidenceSnapshot`, served by
 * `GET /api/v1/research/evidence?mint=&window=`) is a permitted, attributed
 * set of figures about one mint over one window from an external evidence
 * provider, with its own three times (`fetchedAt`, the provider's
 * `observedAt` or null, the provider's documented lag) and Ryntra's
 * `expiresAt`; the read carries a state (`FRESH`, `STALE`, `UNKNOWN`,
 * `UNAVAILABLE`) and where it was served from. A plan's **evidence
 * conditions** (`rules.evidenceConditions`, accepted empty since 1.1.0) are
 * now served: `metric` and `window` are bounded to the registry
 * `capabilities.research` announces, a cohort figure is advisory only, and a
 * required condition blocks when it cannot be judged. The Review gains one
 * check id, `evidence` (one check per condition, in the order the version
 * lists them) and an `evidence` block naming the observation it judged and
 * how long its figures are retained with the review; after that the values
 * are redacted and Ryntra's own verdict stays. A plan without conditions,
 * and every client that never sends one, reads and trades exactly as before.
 *
 * ## 1.6.0 — a second evidence provider: the token's structure, the recipient check
 *
 * Additive. The registry gains a provider (`ddxyz`, security and due
 * diligence), a window (`now` — a point-in-time observation, the moment the
 * source last analysed the token, not a duration) and three units (`percent`
 * a share of supply, `count` a whole number, `flag` an authority present (1)
 * or renounced (0)); every metric definition names its `provider`, and
 * `capabilities.research.providers` lists each provider with its attribution
 * (`provider` and `attribution` stay, naming the first). The same
 * `GET /api/v1/research/evidence` serves `window=now` (the provider follows
 * from the window, or `provider=` names it). A condition on a `ddxyz` metric
 * is judged the same way — a cohort figure (the source's sniper, bundler and
 * developer labels) is advisory only; an authority rule is `lte 0`
 * (renounced) or `gte 1` (present). The Review's `evidence` block lists every
 * source it read (`sources`) and names the provider on each read. A new read,
 * `GET /api/v1/research/address-evidence?address=`, is the recipient check
 * before a transfer (`AddressEvidenceRead`): sanctions in the source's own
 * words, findings as counts by severity with the source's own figure and
 * band, and `unsupported` for a kind of address the source does not read —
 * never a verdict, never a block. Every client that never sends a `now`
 * condition and never asks the address route reads and trades exactly as
 * before.
 *
 * ## 1.7.0 — a plan on a token: crypto and memes, the planning price with its time
 *
 * Additive. The same plan engine reaches the verified, tradable crypto and
 * meme assets of the Spot catalogue. `PlanAsset.kind` says what the asset is
 * — `stock` (every plan written before this version, where the field is
 * absent), `crypto` or `meme` (the catalogue's own category, on a token
 * Jupiter's verified list carries). A token plan is priced per token
 * (`unitBasis: "token"`) and carries no reference, no session, no issuer mark
 * and no multiplier; `issuer` and `underlying` stay present on it with their
 * honest token meaning — `underlying` is the token itself (a plan on SOL is a
 * plan on SOL) and `issuer` names the list that confirms the token
 * (`jupiter-verified`), because such a token has no tokenizing issuer — so a
 * 1.x reader that prints them keeps rendering; `kind` is the way to know. On
 * a token plan the reference rule cannot be required and no deviation bound
 * can be set (`PLAN_INVALID`, the path named); its Review answers
 * `quote.unit: "token"` with `multiplier: null`, judges the reference and the
 * deviation as not applicable (advisory, passing) and the liquidity from the
 * catalogue.
 *
 * Every version records the **planning price** the server read when the
 * version was written (`PlanVersion.planningPrice`): the figure, its source
 * (the issuer's reference, the token's per-share price or the token's own
 * market price from Jupiter), the time it was observed and whether it was
 * current or stale at the write — planning context, never the executable
 * quote, and never invented: `null` says no indication was available and the
 * entry is the person's own figure. `GET /api/v1/plans/asset?mint=` resolves
 * any mint the way `POST /api/v1/plans` will — the asset as the plan would
 * carry it, the planning price now, the catalogue's liquidity — or refuses
 * `ASSET_UNCONFIRMED` with the reason; `capabilities.plans.asset` names it.
 * `ApiError.issues[].code` is a stable id beside the message, so a client can
 * say a contradiction in its own words with the person's figures.
 * `capabilities.push.provider` says honestly whether the server's push
 * provider is configured. A plan on a stock reads and trades exactly as
 * before.
 *
 * ## 1.8.0 — Ryn, the agent: a durable conversation that researches and prepares, never executes
 *
 * Additive. One agent, Ryn, server-side and text-first, over the product's
 * own reads. `POST /api/v1/agent/session` opens (or resumes) the proven
 * wallet's conversation for a context — an asset, a plan, the portfolio, a
 * monitoring note, a page — and answers the session with its budget state and
 * suggested questions; `GET /api/v1/agent/session/{id}` reads it back; `POST
 * /api/v1/agent/message` sends the person's words and answers the two turns
 * the exchange made. Ryn's turn is structured (`AgentAnswer`: *observation →
 * what it means → counter-argument → risks and unknowns → what to check →
 * possible next actions*), every sentence citing the `AgentCitation` it
 * stands on — source, observed time, state (`current`, `stale`,
 * `unavailable`, `unknown`) and the reference id where one exists — with
 * typed cards (`AgentCard`: a market, a stock, an observation, the holdings,
 * a plan, a note, a comparison, and the drafts) and handoffs (`AgentHandoff`:
 * the builder, the Review, a plan, Monitoring, a market). A **draft** is
 * never a write to the product: a plan draft is the contract's own
 * `PlanRules` with the size the engine computes and the issues it names, read
 * by `GET /api/v1/agent/drafts/{id}` and opened in the builder; a monitoring
 * draft is a condition the builder carries; a trade draft is a side, a mint
 * and a sum that open the Spot ticket — the Review, the confirmation and the
 * wallet's signature stay where they are. There is no execute tool. The
 * agent's budget (`AgentBudgetState`, `GET /api/v1/agent/budget`) is per
 * wallet per day and per month with an in-flight limit, metered in the
 * durable store; a call over it is `AGENT_BUDGET_EXHAUSTED` (429) with the
 * reason, a second question while one is answered `AGENT_BUSY` (409). A
 * deployment without a model composes every answer deterministically from the
 * same reads (`composedBy: "deterministic"`); `capabilities.agent.model` says
 * which. `GET /api/v1/agent/suggestions?context=` is public. Every figure Ryn
 * states is a figure a tool read, never one the model wrote.
 *
 * ## 1.9.0 — Results beyond the entry: the exit, the position, the cost parts, a no-trade outcome, and a memory that cites
 *
 * Additive. A plan's result stopped at the entry; it now answers *what
 * actually happened against what I planned*. `PlanExecutionRef.side` carries
 * the side off the signed bundle's origin, so a sell under a plan is a sell
 * rather than a buy read backwards from the order of two legs, and
 * `PlanActual.leg` says what the execution did to the position — `entry`
 * establishes it, `exit` reduces it. A sell's `proceedsUsd` and `unitsOut`
 * are read off the leg that arrived and the leg that left, with `valueBasis`
 * naming how the dollars were established (`PAR`, `PROVIDER_STATED`) and
 * `feeBasis` how the fee was. `PlanResult.costs` keeps three parts apart and
 * never adds them into one number: the market's own move between the plan
 * being written and the Review, what execution added between the Review and
 * the fill, and the service fee the settled row recorded — each with `basis`
 * (`known`, `estimated`, `unknown`) and a reason where nothing was
 * established; `costs.expected` holds what the Review modelled before the
 * signature and is never spoken of as paid. `PlanResult.exit` judges an exit
 * only against the rules that existed before it (`ruledByVersion` is the
 * newest version written at or before the exit's own time; `notBackdated`
 * says a later rule was not applied backwards), with the three exit checks
 * `exitTarget`, `exitInvalidation` and `exitTime`.
 *
 * A plan that never traded is a result too. `PlanResultsResponse.outcomes`
 * carries `PlanNoTradeOutcome` — the reason as a stable id
 * (`entry-bound-unmet`, `liquidity-unavailable`, `expired`, `cancelled`,
 * `conditions-unmet`, `review-blocked`, `reviewed-not-taken`,
 * `invalidated-before-entry`, `no-review`), the check that established it,
 * the bound and what was found — with `failure: false` on the shape
 * itself, because a rule that was never satisfied did its work.
 * `positions` states each plan's position — units in, units out, units
 * held, the cost basis and the proceeds where both sides are valued, and a
 * realised figure **only** with `realisedMethod` beside it and `unknowns`
 * empty. `summary` counts the feed.
 *
 * `GET /api/v1/plans/memory` answers `PlanMemoryFact`s: a kind, a scope, the
 * figures, and `cites` — the plan, the version, the Review, the execution,
 * the ledger row, the monitoring note or the result each fact stands on,
 * with its time. Every fact is derived from those records at read time, so
 * memory can neither drift from them nor be written by a model; the client
 * composes the sentence in the reader's language from the figures.
 *
 * **1.10.0 — the Brief and the Critic.** Two formats over the same agent
 * engine, never a second one. `AgentBrief` answers five things and no more:
 * what changed, what matters for this thesis or plan, which data supports
 * it, what is unknown, what to check next. `AgentCritic` argues against a
 * thesis in `AgentCriticFinding`s of seven kinds — an assumption that
 * conflicts with a read figure, a risk that was never established, a plan
 * condition currently unmet, a previous result of the wallet's own memory,
 * evidence that is stale or missing, a structural property of the asset, a
 * thesis under-specified on its own terms — with `gaps` saying what could
 * **not** be challenged, so silence is never agreement. Neither format ever
 * says buy or sell: there is no direction in any kind, and the server drops
 * a directive sentence before a person sees it.
 *
 * `POST /api/v1/agent/brief` and `POST /api/v1/agent/critic` take the same
 * `AgentContext` a conversation is opened from as their subject, and
 * `compose`: `deterministic` (the default) never reaches a model and never
 * spends, so a surface may render a Brief on load; `model` words the same
 * reads under the wallet's **existing** agent allowance — the same counters,
 * the same in-flight lease, the same receipt. `AgentTurn.brief` and
 * `AgentTurn.critic` carry the two formats inside a conversation and default
 * to null, and the six-section `answer` is always written beside them.
 *
 * **1.11.0 — the consumed routes, described.** The routes the web and the
 * native client already read outside `/api/v1` become schemas exactly as
 * they are served — nothing about a route changed to be described: the Spot
 * markets, one market and its candles; the stock universe (whole and slim),
 * one stock and its quote; the holdings; the activity statement; the receipt
 * archive; the rewards; the monitoring surface and its writes; Ryntra
 * Predictions in paper mode; and the swap the phone trades through. Each is
 * proven equal to the type its route builds its answer from
 * (`route-types.test.ts`) and parsed against its route's answers in the
 * tests; `RouteErrorSchema` is their error, and the older bodies are named
 * where a route answers another. Three additive changes answer the native
 * client: the slim stock row names a pending multiplier with its time and
 * when the session next changes; the Telegram channel is a v1 path over the
 * bearer, `/api/v1/notifications/telegram`; and the recovery of a swap the
 * server had already receipted carries the same `observation` and `facts` as
 * a fresh recovery.
 *
 * **1.12.0 — «Автоінвест»: a rule that reminds, a purchase the person
 * signs.** Additive. An `AutoinvestRule` is the proven wallet's «Регулярно»:
 * a company (network + mint, a confirmed stock representation), a sum in
 * dollars, how often (`daily`, `weekly`, `monthly`) and when — the day and
 * the time in the person's own time zone, an IANA name — and whether it is
 * `active` or `paused`. `GET /api/v1/rules` lists the wallet's rules, `POST`
 * writes one, `POST /api/v1/rules/{id}/status` pauses or resumes it, `GET`
 * and `DELETE /api/v1/rules/{id}` read and remove one — one set of routes for
 * the phone's bearer and the web's proof cookie, like the plan routes. A rule
 * is never a mandate and never an authorization: it only schedules a
 * reminder. When a rule falls due, the monitoring tick writes one note
 * (`subject.kind: "autoinvest-rule"`) and, where the channel is confirmed, a
 * Telegram message; the note opens a fresh Review on the rule's sum. The
 * order names the rule and the occurrence (`origin.rule` on `POST
 * /api/solana/swap/order`, the proven wallet the taker); the order route
 * refuses a reminder that is not open (`RULE_NOT_DUE`) or an order that is
 * not the rule's purchase (`RULE_MISMATCH`) before any bytes are built; the
 * issuer-signed bundle and the History row carry the binding, and the rule
 * reads each occurrence's state from History: `due` (the reminder is open),
 * `pending` (a signed purchase not yet settled), `bought` (settled, with its
 * signature and the dollars spent) or `missed` (the reminder's day passed
 * without a signature — never caught up). `capabilities.rules` names the
 * routes and the bounds.
 *
 * **1.13.0 — «Якщо впаде» and «Бюджет місяця».** Additive. A rule may be
 * `kind: "dip"`: «Якщо {компанія} впаде на N % — докупити $X», with `dip`
 * (the fall in whole per cent, the reference point — the price when the rule
 * was turned on, or what the last purchase under it paid — and the trigger)
 * in place of `schedule`, which is null on it; a request without `kind` is
 * «Регулярно», as before. The monitoring tick reads the price the company's
 * page shows: the first read at or below the trigger opens one reminder — one
 * note per crossing — and the rule arms again only when the price is read
 * back above it; after a purchase the point moves to that purchase. The
 * month's budget is the wallet's own ceiling for every rule
 * (`GET`/`PUT`/`DELETE /api/v1/rules/budget`, and `budget` on the rule list):
 * only settled purchases under rules count, a signed one whose outcome is
 * unknown counts as spent, and a purchase that does not fit what is left is
 * not reminded of — the occurrence is `held`, one note says the budget is
 * spent (`subject.kind: "autoinvest-budget"`), and the rules stand until the
 * 1st; the order route refuses such a purchase (`RULE_BUDGET_EXHAUSTED`). A
 * rule's reminder on the monitoring surface carries `ruleState`, what became
 * of it (`due`, `pending`, `bought`, `missed`).
 *
 * **1.14.0 — private companies through PreStocks only.** Additive. The other
 * pre-IPO issuer is disconnected: no answer carries its tokens any more, and
 * its values stay in the enums only so that a record written before — a plan,
 * a note, an agent card — still parses (`issuer.id` `tessera`,
 * `issuerMark.source.id` `issuer-tessera`, `instrument.rights`
 * `loan-participation`). The universe's `issuerCatalogues.tessera` is
 * optional and absent from every new answer. A quote or an order that buys or
 * sells one of its tokens is refused `ASSET_NOT_OFFERED`, a plan cannot name
 * one (`ASSET_UNCONFIRMED`), and Spot's lists and search leave them out; a
 * holder reads the token by its address, with `issuer` saying it is no longer
 * supported. The slim stock row gains `markPremium` — the token's price
 * against the issuer's own mark, per cent, the one figure the private shelf
 * and the screener draw — and `markAt`, when the issuer's mark was read; both
 * null on a listed row.
 *
 * **1.15.0 — the IPO and conversion watch.** Additive. A note's subject may
 * be `issuer-event`, `id` a token's mint: the wallet holds a token whose
 * issuer opened a window to swap it before a cut-off, after which it expires
 * worthless (PreStocks SPACEX, until 23:59 UTC on 12 March 2027). One such
 * note the day Ryntra first sees the wallet hold the token, then 90, 30, 7
 * and 1 days before the cut-off, never more than one a day about one token;
 * its link and its Telegram button open the token's page with the swap's
 * Review (`/app/stocks/SPACEX?convert=1`), an ordinary swap at the live quote
 * the holder signs. A client that shows notes shows it like any other; a
 * client that knows the kind may route it straight to the swap. A purchase of
 * a token whose window has passed its cut-off is refused `ASSET_NOT_OFFERED`
 * by the clock, whatever the registry still says.
 *
 * **1.16.0 — from $1.** A relaxation, and nothing a client sends today stops
 * being valid. A rule's `amountUsd` and the month's budget `capUsd` start at
 * one dollar, not ten: `capabilities.rules.minimumUsd` and
 * `capabilities.rules.budget.minimumUsd` say 1, and a client that reads its
 * bounds from them needs no release. The $10 had been copied from Jupiter's
 * own minimums for its DCA vault, Trigger orders and the gasless swap; a
 * plain Swap v2 order has none. A purchase is from a dollar too — where the
 * live quote finds no route for the sum, the client asks the same read-only
 * quote (`POST /api/solana/swap/quote`) at larger sums and says the least
 * that routes. No route, field or error changes shape.
 *
 * **1.17.0 — «Шлях компанії».** Additive. A stock row gains `companyPath`,
 * null where there is nothing to say: the company's way from a private token
 * to its stock on Solana, four steps always in order — `private` (the token
 * through PreStocks), `ipo` (the first trading day and the offering price),
 * `exchange` (the exchange and the ticker), `solana` (the listed share's
 * token) — each `passed`, `current` or `unannounced`, with its day where one
 * is recorded; `at` is the step this token stands at. SpaceX: every step
 * passed, SPACEX at `private` and SPCXx at `solana`, each naming the other in
 * its step's `token`, and `swap` — the private token's cut-off, `open` judged
 * by the clock at answer time. A PreStocks company that announced nothing:
 * `private` current, the rest `unannounced`, and `swapMonths` — after an IPO,
 * up to nine months to swap. `sources` name each document with its date and
 * Ryntra's read. The facts are the registry's
 * (`lib/stocks/lifecycle-events.ts`), never a parser's. Served on `GET
 * /api/stocks/universe` and `GET /api/stocks/asset`; a client that does not
 * read it needs no release.
 *
 * **1.18.0 — «Умова ціни».** Additive. A rule may carry
 * `priceCondition: { limitPct }` — «Не купувати, якщо дорожче за орієнтир
 * більш ніж на N %», whole per cent 1–50; null — every rule written before,
 * and a request that names none — is no condition. The reference is
 * PreStocks' valuation of one token for a private company, and the reference
 * per share for a listed one (the issuer's quote, or the market feed where
 * one is configured), set against the token's own price on the same basis.
 * When a rule falls due (a «Регулярно» due, a «Якщо впаде» crossing) the tick
 * judges the condition: `met` reminds as before; otherwise the occurrence is
 * `deferred` — a new state: nothing is to be bought, one note says why
 * («Купівлю відкладено» with the reason, the figure and the data's time), and
 * every pass while the occurrence is open judges it again — met in time, it
 * becomes `due` and reminds; never met, it is `missed` at its end. Every
 * judged occurrence carries `condition`: the verdict (`met` · `above` ·
 * `stale` · `unavailable`), the reference, the limit, the price and the
 * reference figure, the deviation to a tenth of a per cent, the data's time
 * (the older of the two) and when it was judged; null where the rule has
 * none. Data older than `capabilities.rules.priceCondition.maxAgeMinutes` or
 * a missing figure never pass. `POST /api/solana/swap/order` under a rule
 * with a condition judges it again on the server's own row and refuses
 * `RULE_PRICE_CONDITION` (409) unless it is met now; a `deferred` occurrence
 * is `RULE_NOT_DUE`. `capabilities.rules.priceCondition` names the default,
 * the bounds and the freshness. A client that reads occurrence states as a
 * closed list adds `deferred`; one that reads neither new field needs no
 * release.
 *
 * **1.19.0 — «З кожної оплати».** Additive. A rule may be `kind: "payments"`:
 * money goes into a company from the wallet's own USDC on Solana —
 * `payments.mode` `roundup` (every payment rounded up to the next
 * `roundToUsd`, $1 or $5), `fixed` (`fixedUsd` from every payment) or
 * `percent` (`percent` of every USDC that comes in); `schedule` and `dip` are
 * null on it, and `amountUsd` is the least sum a reminder opens at. A payment
 * is a transfer of the wallet's USDC to another owner, signed by the wallet;
 * money that came in is USDC from another owner the wallet did not sign for;
 * a swap, Ryntra's own purchase, a bridge and a transfer between the person's
 * own accounts never count, and each event counts once — from the instant the
 * rule was turned on (`since`). The monitoring tick reads the wallet's USDC
 * account every five minutes; each counted event adds its share in whole
 * cents to what waits (`gatheredUsd`, `gatheredCount`), the money staying in
 * the wallet; once it reaches `amountUsd`, one reminder opens on that sum —
 * an occurrence's new `amountUsd` (null on the other kinds: the rule's sum)
 * with `events`, how many events it gathered — and it goes the way every
 * rule's purchase goes: the month's budget, the price condition, a fresh
 * Review, the signature, the receipt. `POST /api/solana/swap/order` under
 * such an occurrence must buy exactly its `amountUsd` (`RULE_MISMATCH`
 * otherwise). `payments.events` lists the newest counted events — the sum,
 * the share, the time, the Solana Pay label where the transfer carried one,
 * and the reminder that took it — never the other side's name;
 * `payments.read` says when the wallet was last read and whether that read
 * proved itself. `POST /api/v1/rules/payments/own` names an event's other
 * side as the person's own account: no transfer to or from it counts from
 * then on, and the event leaves what waits. `capabilities.rules.payments`
 * names the modes and the bounds. A client that reads rule kinds as a closed
 * list adds `payments`; a client that buys under a reminder reads its
 * `amountUsd` before the rule's.
 *
 * **1.20.0 — «Перевірка» from the server, and «Популярне».** Additive. The
 * four lines a person reads before the signature — Спишеться · Отримаєш · Усі
 * витрати · Що це — and the account's reserve are counted by the server, for
 * a company bought with USDC and for a company sold into USDC:
 * `POST /api/solana/swap/quote` and `POST /api/solana/swap/order` answer
 * `check` (`SwapCheckSchema`), null on any other pair or when the company
 * cannot be read. `side` says which; `basis` says where the figures stand —
 * `quote`, the live quote before a Review, or `order`, the exact order the
 * wallet will sign. `spend` and `get` are what leaves and what arrives
 * (`get.atLeast` the chain's minimum) in the unit the wallet shows — `usdc`,
 * or the company's `share` or `token` through the Scaled UI Amount multiplier
 * — each with its dollars where known; `costs.usd` is «Усі витрати» (the
 * venue's dollar values of what leaves and what arrives, never less than the
 * stated fees and impact, and the network's fee at SOL's price), with
 * `costs.issuerFee` — the issuer's fee inside it at the rate the chain states
 * — said alone; null when a figure it needs is unknown, never a smaller
 * number. `reserve` is the one-time rent an account the transaction opens
 * keeps in the wallet — the figure the simulation proved, so on the order
 * only — never a cost, with `first` when a purchase's reserve is more than
 * the purchase. `what` is «Що це» in both languages: the truth line, and
 * under it the issuer's event said to a buyer (`issuer-event`) or, on a
 * private company's sale, «Продати може не вийти» (`sale-may-fail`);
 * `caution` marks a private company. `sol` is the price the network's fee and
 * the reserve were counted at. A client draws these figures and counts none
 * of them: the same sum shows the same lines on the web and the phone.
 * `GET /api/v1/stocks/popular` is «Популярні компанії» — the listed
 * companies, one card each, by the day's trading across their representations
 * (the order `volume-24h`, the same for everyone), `limit` 1–24 (12 by
 * default) and `exclude` a company's mint to leave that company out beside
 * its own page; `capabilities.stocks` names it. A client that does not read
 * the new fields needs no release.
 *
 * **1.21.0 — «Ryntra попередить»: the states of Нагляд.** Additive.
 * `GET /api/v1/positions` is the proven wallet's company positions as Нагляд
 * sees them — every listed or private company the chain says the wallet
 * holds, dust under a cent left out — each with its exit, the state it is in
 * and its one action, decided on the server by deterministic rules and prices
 * (`lib/monitoring/watch-state.ts`): `issuer-paused` («Пауза емітента» — the
 * issuer halted or paused the token, or froze the wallet's account;
 * `details`: selling is impossible now), `action` («Дія» — the price reached
 * the loss limit or the target; `open-sale`), `exit-not-set` («Увага: куплено
 * — вихід не налаштований» — no plan watched as the position and no «Ryntra
 * попередить»; `warn` with a connected Telegram, `connect-telegram` without),
 * `unknown` (an exit, but no price observed within half an hour; no action),
 * `attention` («Увага»: `near-limit` ≤2 % above the limit, `issuer-event` a
 * swap window the holder must act in, `above-exchange` >1 % above the
 * exchange's current reference, `exchange-closed` the issuer says its
 * exchange is closed; `look`) and `on-plan` («Все за планом», no action).
 * `exit` says where the exit comes from — `plan`, the executed plan the
 * position was bought under while it is watched as the position, or `watch`,
 * «Ryntra попередить» with its preset — whichever was written last. `read`
 * says whether both token programs answered (`holdings`) and the universe did
 * (`market`): a position that could not be read is never called unprotected.
 * `PUT /api/v1/positions/watch` turns «Ryntra попередить» on for a company
 * the wallet holds with a preset (`careful` −5 % / +10 %, `balanced` −10 % /
 * +20 %): the server counts the loss limit and the target from the token's
 * price now, never from a client's figure, and afresh on every call; it needs
 * a connected Telegram (409 `CHANNEL_REQUIRED`) and a fresh price (503
 * `PRICE_UNAVAILABLE`); a mint that is not a company is 422
 * `ASSET_UNCONFIRMED`. Monitoring checks it every five minutes — a monitor
 * with `subject.kind` `position` (`id` the mint) — and at the limit or the
 * target writes one note (`subject.kind` `position`, its action «Відкрити
 * продаж») to the inbox and Telegram, whose link opens the company with the
 * sale's sheet; a position sold in full closes its watch. A bought plan's
 * target is watched too (`plan.target`, `facts.target`).
 * `capabilities.positions` names the routes, the presets and the thresholds.
 * A client that reads monitor or note subjects, condition kinds or error
 * codes as closed lists adds `position`, `plan.target`, `CHANNEL_REQUIRED`
 * and `PRICE_UNAVAILABLE`; one that does not read the new routes needs no
 * release.
 *
 * **1.22.0 — «Гроші» for the phone.** Additive. What the web's «Отримати» and
 * «Надіслати» do, the phone does through the contract and counts nothing
 * itself. Payment links are v1 routes over the engine of the web's
 * `/api/pay/requests` and `/pay/{id}`: `POST /api/v1/pay/requests` makes one
 * for the proven wallet — the recipient is always that wallet, never a field
 * — with a token (`mint`, null for SOL), an amount in the token's units or
 * none (the payer chooses), a note and how long it stays open (`1h`, `24h`,
 * `7d`, `30d`); `GET /api/v1/pay/requests` lists the wallet's own, newest
 * first, in the state the last observation left;
 * `GET /api/v1/pay/requests/{id}` reads one as its page does — observed on
 * the chain by its reference when the last read is older than eight seconds,
 * paid for good once paid — for anyone with the link. A `PayLink` carries the
 * page's address (`url`), the Solana Pay request a wallet scans (`payUrl`),
 * the state (`AWAITING`, `PAID`, `EXPIRED`, `CHECKING`, `UNKNOWN`, with
 * `note` when less, more or another token came) and what arrived. `GET
 * /api/v1/money/recipient?to=&mint=&from=` is the recipient check before a
 * transfer: it reads what was typed, pasted or scanned — an address, a Solana
 * Pay request or a Ryntra link — says why it is not an address or that it is
 * the sender's own, and what the chain says of it for the asset (the transfer
 * builder's own classifier: a wallet, a token account entered on purpose, an
 * account that opens, or the refusal), and answers `next`: `transfer`,
 * `pay-link` (a Ryntra link, or a request whose reference is one and whose
 * terms are the link's own — paid through the link so that its reference goes
 * in) or `none`; a reference is public, so a request that names a link by it
 * but states other terms learns nothing of the link (`LINK_MISMATCH`), and a
 * link the chain could not be read about is not payable (`LINK_UNCONFIRMED`);
 * the security source's read stays `research/address-evidence`. Send is the
 * web's own routes, described as consumed: `POST /api/solana/transfer/plan`
 * and `…/adopt` answer `check` — «Перевірка» counted by the server (what
 * leaves, the issuer's fee, what arrives, the network's fee, the account that
 * opens — its figures null when the rent could not be read — whether the
 * wallet may be opened, why not, and the card's warnings in its words,
 * English and Ukrainian; every amount an exact decimal with no separator);
 * `POST /api/v1/money/send/returned` reads what the wallet signed against the
 * Review and says `settle`, `adopt` (the wallet added only its fee guards) or
 * `stop`, with the transaction's signature; `…/settle` submits once and
 * answers the receipt; `…/recover` takes the bearer in place of the site's
 * origin. A Ryntra link is paid from the phone through
 * `/api/pay/{id}/transaction` and `…/submit`, which take the bearer too — the
 * payer is the session's wallet (`WALLET_MISMATCH` otherwise).
 * `capabilities.money` names the routes and the bounds. New error codes
 * `AMOUNT_INVALID`, `MINT_UNREADABLE` and `PAY_LINK_NOT_FOUND`; a client that
 * reads error codes as a closed list adds them; one that does not call the
 * new routes needs no release.
 *
 * **1.23.0 — «Ризик портфеля».** Additive. `GET /api/v1/positions/risk` is
 * one word for the proven wallet as a whole, decided on the server by
 * deterministic rules and prices (`lib/monitoring/portfolio-risk.ts`):
 * `normal` («Нормальний» — no position in «Дія», no asset above 25 % of the
 * wallet, the private companies together at most 10 %, no listed company
 * without a loss limit over the weekend, and every figure read), `attention`
 * («Увага: <причина>» — `findings`, every rule broken, the most urgent first:
 * `action` a position reached its loss limit or target (`watchReason`),
 * `weekend-no-limit` a listed company with no loss limit from Friday through
 * Sunday in New York or while its exchange is closed for more than a night,
 * `concentration` one asset — a company across its tokens, a coin — above
 * `capPct` with its `sharePct`, `private-share` the private companies
 * together) or `unknown` («Не вдалося перевірити» — `gaps` names what could
 * not be read: `holdings`, `market`, `exits` (the plans and the watches that
 * hold the positions' limits), `balance`, `prices`). «Нормальний» is never
 * answered on incomplete data; a rule broken on what was read is answered
 * even then, a share never is. The one-asset cap holds from a wallet of $500
 * (`capsApplied`), the private companies' cap at any size; dollars (USDC,
 * USDT, PYUSD, USDS) are in `totalUsd` and outside the caps; only a token the
 * catalogue verifies counts in the total. `capabilities.positions` names the
 * route and the caps. A client that does not call the route needs no release.
 *
 * **1.24.0 — Fee policy v2.** Additive. A swap's Ryntra fee is its flow's —
 * memes and new tokens 1.00 %, verified tokens 0.50 %, majors 0.10 %, dollar to
 * dollar 0, xStocks 0.25 %, Ondo 0.50 %, PreStocks and anything the table does
 * not name as before. On the web most flows take Jupiter's `/build`: the order
 * says `path: "BUILD_SUBMIT"`, its fee says `mechanism: "JUPITER_PLATFORM_FEE"`
 * and `accrual: "FEE_WALLET_TOKEN_ACCOUNT"` — paid whole into Ryntra's fee
 * wallet in the same transaction, `providerRetainedPercent: 0` — and the order
 * names `ryntraFeeAccount` (`owner`, the fee wallet, and `account`, its
 * token account for the fee mint). On the input side `ryntraFee.amountRaw` is
 * the exact fee before the signature. Such an order is sent once through
 * Ryntra's own RPC by the same `execute` route; its outcome receipt pins the
 * action `action:jupiter-swap/build-own-rpc-submit@1`. A `/order` order is unchanged, except that its referral
 * rate is now the flow's. The native carrier stayed on `/order` until its client
 * read this version (line B's M30); since 2026-10-05 it takes the same lanes as
 * the web, with no change to any shape: a client that sums a fee by mechanism adds the new one
 * beside `JUPITER_REFERRAL` — the fee is already inside Jupiter's total.
 *
 * **1.25.0 — Ryntra Launch, «Запустити токен».** Additive, and served only
 * where `capabilities.launch` is present — on the devnet stand now, on
 * mainnet when Launch opens to people; a deployment without it answers every
 * launch route `LAUNCH_UNAVAILABLE`. The flow is one set of routes for the
 * web and the phone: `GET /api/v1/launch/presets` (the three presets with
 * their numbers, the lock schedules, the form's limits), `POST
 * /api/v1/launch/metadata` (the picture as base64 and the fields → the
 * metadata URI the mint will name for ever, its address the sha256 of its
 * bytes; a name or ticker that borrows a known brand or person is
 * `LAUNCH_NAME_BORROWED` with the names), `POST /api/v1/launch/quote` (what
 * the creator's first purchase buys on the fresh curve and the most it may
 * spend under the preset's cap), `POST /api/v1/launch/build` (the creation
 * the creator signs — Ryntra's pool payer pays and is paid back in the same
 * transaction, `payerCoveredLamports` — and, when the creator locks the
 * purchase, the lock as a second transaction), `POST /api/v1/launch/submit`
 * (both signed, byte for byte as built; the server adds the pool payer's
 * signature, sends once, and answers the token's path) and `GET
 * /api/v1/launch/{mint}` (the token as the chain shows it: the receipt's facts
 * and marks, «Творець заблокував свою покупку» when the lock holds, the curve's
 * progress, and the link the creator shares with their referral code). No
 * bearer or cookie: the creator's signature inside the transaction is the
 * proof. New error codes: `LAUNCH_UNAVAILABLE`, `LAUNCH_NAME_BORROWED`,
 * `LAUNCH_IMAGE_INVALID`, `LAUNCH_LIMIT`, `LAUNCH_PAUSED`,
 * `LAUNCH_FIRST_BUY_ABOVE_CAP`, `LAUNCH_BUILD_EXPIRED`, `LAUNCH_BUILD_USED`,
 * `LAUNCH_SIGNED_OTHER_BYTES`, `LAUNCH_SUBMIT_FAILED`, `LAUNCH_NOT_FOUND`.
 *
 * **1.26.0 — Rewards ranks.** Additive. `GET /api/rewards` gains an optional
 * `rank` (`RewardsRankSchema`): the wallet's rank — Bronze, Silver, Gold,
 * Sapphire, Diamond — by points over the last 30 days (a dollar of fee Ryntra
 * received on the wallet's own trades or its invited friends' trades is a
 * point; a launch that reached a DEX adds a fixed number), where the points
 * came from, the next rank and how many points it still needs, the share of
 * the received fee a friend's trade pays at this rank and at the second level,
 * and the ladder of all five under the rules in force. `null` when the rank
 * could not be read — unavailable, never Bronze; absent from a deployment
 * before ranks. Under rules 2.0.0 every share is of the fee Ryntra received —
 * cashback 50 %, the inviter 10–30 % by rank, the second level 5 % — and
 * `points` (the earlier Points programme) stays as it was. A client that does
 * not read `rank` needs no release.
 *
 * **1.27.0 — a launch's market and trading on it.** Additive, and served only
 * where `capabilities.launch` is present, like the rest of Launch. `GET
 * /api/v1/launch/{mint}/market` — the token's market as the chain shows it:
 * the price and market cap from the curve's or the graduated pool's own
 * square-root price, the curve's way to the DEX, the curve's fee now (the
 * falling fee for snipers included), the holders with the labels each earned
 * (creator · sniper · bundle — a wallet that bought in the creation's block or
 * whose buy the creator's wallet paid for as the swap's payer — and the curve's
 * and the pool's vaults and the creator's lock, which are not people) and the
 * shares of those groups (the snipers' and the bundle's null when the opening
 * minutes could not be read; the bundle's `atLeast` when neither the history
 * nor the creator's own accounts were read whole), the creator's own trades
 * read whole from their accounts (`creator.tradesComplete`), the trades from
 * the programs' own swap events
 * with the market cap each left (what moved in the pair currency counts Ryntra's
 * own fee of the same transaction), the chart of the market cap with the
 * creator's trades and the graduation marked, the facts of risk as codes with
 * figures and the transaction or account each rests on («the creator sold», what
 * the creator, the bundle, the snipers and the ten largest hold, too few
 * holders, a count of holders that is only a floor, a young token, the
 * creator's other curves, opening minutes or a history read only in part) —
 * never a verdict. `GET /api/v1/launch/{mint}/creator` — the creator's other
 * Ryntra launches with what became of them (how much the creator sold, and of
 * what), read after the market. `GET
 * /api/v1/launch/{mint}/wallet/{address}` — what a wallet holds of the token
 * and of the pair currency, for the trade's «Max». `POST
 * /api/v1/launch/{mint}/trade/quote`, `…/trade/build` and `…/trade/submit` —
 * a buy or a sale on the curve by Meteora DBC's own swap instruction, after
 * graduation in its DAMM v2 pool; the fee is inside the swap in the same
 * transaction (on the curve the config's — the creator's and Ryntra's shares —
 * and Meteora's, with Ryntra's referral when it exists; in the pool the pool's,
 * the referral and, a graduated launch being a new token, the policy's Ryntra
 * fee into Ryntra's fee wallet — only on a network that records the trade for
 * the person's cashback, History and receipt), and the quote names who gets
 * what. The wallet is the only signer and the fee payer; `submit`
 * takes the signed bytes, refuses any change but the wallet's own fee and guard
 * instructions, sends once and answers `CONFIRMED` (with what the trade
 * filled, from the program's event) or `PENDING`. New error
 * codes: `LAUNCH_BALANCE_LOW`, `LAUNCH_GRADUATING`, `LAUNCH_SLIPPAGE`. The launch receipt's mark
 * `CURVE_HOLDS_FUNDS` is now given only while the token is on its curve: after
 * graduation the buyers' money is in the pool, named by the two
 * `LP_LOCKED_FOREVER` marks (each position's owner is in `graduated.positions`).
 *
 * **1.28.0 — Rewards badges.** Additive. `GET /api/rewards` gains an optional
 * `achievements` (`RewardsAchievementsSchema`): the five ranks, each with the
 * points it begins at, whether the wallet has reached it since ranks began and
 * when (the badge stays when the 30-day rank falls; Bronze and a rank reached
 * where the start of ranks is unknown have `at` null), and the achievements
 * (`REWARD_ACHIEVEMENTS_V1` — `FIRST_FRIEND`, `FIVE_FRIENDS`, `LAUNCH_ON_DEX`),
 * each with whether it is earned and when. An achievement shown only once
 * earned (`LAUNCH_ON_DEX`) is absent until it is. `null` when the badges could
 * not be read; absent from a deployment before badges. The list of
 * achievements is closed but grows: a new one is a new value, so a client
 * skips an id it does not know. A client that does not read `achievements`
 * needs no release.
 *
 * **1.29.0 — Ryntra Launch: the creator's cabinet.** Additive. `GET
 * /api/v1/launch/creators/{address}` — «Мої лаунчі»: the wallet's launches as
 * their creator and the launches whose creator fees it shares in, each with
 * the curve's way to the DEX and what the creator's side earned by source
 * (`curve` — the curve's creator share, `graduation` — the creator's part of
 * the graduation fee, `lp` — the fees of the creator's locked LP after
 * graduation), every figure a program's own counter read from the chain, and
 * the wallet's part of it (`earnings.mine`: its share, earned, unclaimed,
 * claimed); `earnings` null when the chain could not be read — never zero.
 * Also the wallet's claim receipts and `card`, the creator earnings card's
 * data (`CreatorEarningsCardSchema`: the period, the launches and those that
 * reached a DEX, each currency apart, the receipts it rests on). `POST
 * /api/v1/launch/{mint}/claim/build` and `…/claim/submit` — «Забрати»: every
 * source holding a fee now in one transaction (two when a pool's accounts do
 * not fit) for the wallet to sign as the only signer and fee payer; `submit`
 * refuses any change but the wallet's own fee and guard instructions, sends
 * once and answers the receipt read back from the programs' own events
 * (`paid` by source) and the wallet's own balance (`receivedRaw`), or
 * `PENDING`. «Спільнота» can share the creator's fees through Meteora's
 * Dynamic Fee Sharing: `POST /api/v1/launch/build` takes optional `feeShares`
 * (the creator among two to five wallets, whole basis points adding up to
 * 10 000, each at least 100) and answers `splitUnsignedWireBase64` and
 * `feeVault` — a second transaction, signed already by the new mint, that
 * makes the vault with the shares written for ever and hands it the curve's
 * creator role; `submit` takes `signedSplitWireBase64` and answers
 * `feeSharing` (`SHARED`, `PENDING` or `FAILED` — then the creator's wallet
 * keeps every fee). The token's read gains `feeSharing` and the receipt's
 * `feeSharing` (the vault and the shares, from the chain); the receipt's
 * `creator` is the wallet the creation names. New error codes:
 * `LAUNCH_SHARES_INVALID`, `LAUNCH_NOTHING_TO_CLAIM`; a wallet that takes no
 * part of a launch's creator fees gets `WALLET_MISMATCH`.
 *
 * **1.30.0 — Ryntra Launch on mainnet.** No shape changes. Launch is served
 * for people: `capabilities.launch` is present on production with `network`
 * `solana:mainnet`, and the presets there are «Класичний» and «Захищений»
 * («Спільнота» gets a config per community token when one launches; until then
 * `presets` does not list it and a build with it is refused). Building and
 * sending through Launch — `metadata`, `quote`, `build`, `submit`, a trade's
 * `build` and `submit`, a claim's `build` and `submit` — obey Launch's own
 * operator stop and answer `LAUNCH_PAUSED` while it is closed (a trade and a
 * claim included now); the reads — the token, its market, a wallet's holding,
 * the creator's launches, the cabinet, a trade's quote — answer while it is
 * closed, and the token's read no longer answers `LAUNCH_PAUSED`. The link a
 * token's read names is its page until the referral route lands there.
 *
 * **1.32.0 — the flight log and the Fee-Funded Liquidity Ladder.** Additive. `GET
 * /api/v1/launch/{mint}/journal` — what happened to a launch, the newest
 * first, each with its time, its amount and its transaction: the launch and
 * the creator's first purchase, the creator's lock, the sharing of the
 * creator's fees, every sale of the creator's (`CREATOR_SOLD`, with the share
 * of what they bought sold by then — the event a holder's protection and a
 * notification take), the graduation and who sent it (Ryntra's executor,
 * Meteora's keeper or another wallet), and the Fee-Funded Liquidity Ladder: its DLMM pool
 * opened, placed, emptied to move up, moved up, added to (`FLOOR_POOL`,
 * `FLOOR_PLACED`, `FLOOR_WITHDRAWN`, `FLOOR_RAISED`, `FLOOR_ADDED`). `floor` — the ladder as it
 * stands: the pair currency in its steps, the token they bought and hold, the
 * steps' prices; it holds no price and promises none — `floorUnread` when it is
 * there but its position was not read. `complete` — whether everything the log
 * rests on was read: the creator's trades whole and, once the token graduated,
 * its graduation; read in part, the entries listed are the ones found, never
 * «none». `capabilities.launch.journal` names the route.
 *
 * **1.33.0 — a holder's position in a graduated launch's pool.** Additive.
 * One coin into the token's DAMM v2 pool through Meteora's Zap, and in the
 * same signature the permission Ryntra's collector asks for: an SPL Approve of
 * 0 on the position NFT's account and the program's bitmask with two bits —
 * `ClaimPositionFeeToOwner`, `ClaimRewardToOwner` — with which the program pays
 * the fees only to the owner's own token accounts; the collector cannot close,
 * split, move, lock or take liquidity out of the position, and «Відкликати» is
 * one signature. `GET /api/v1/launch/{mint}/holder/{address}` — the pool,
 * whether the entry is built for this wallet (`open`), the collector, Ryntra's
 * share at entry (`fee`: its rate and whether it is charged here), and the
 * wallet's positions in the pool with what each holds and is worth now, the
 * fees waiting and claimed, its permission (`grant`) and what the collector
 * brought; `POST …/holder/{quote,build,submit}` — the entry; `POST
 * …/holder/permission/{build,submit}` — «Увімкнути» or «Відкликати»; `GET
 * /api/v1/launch/holders/{address}` — «Мої позиції» across launches with the
 * holder's earnings card data. Until our own security review and a lawyer's
 * opinion the entry is built on mainnet only for the operator's own wallets —
 * `LAUNCH_HOLDER_CLOSED` for anyone else; `LAUNCH_NOT_GRADUATED` while the token
 * is on its curve. `capabilities.launch.holder*` name the routes.
 *
 * **1.34.0 — a launch's trades in History, with a receipt.** Additive. A buy or
 * a sale of a Ryntra launch — on its curve or in its graduated pool — is a
 * `SWAP` row of `POST /api/solana/activity` whose `origin` is `{ surface:
 * "LAUNCH", side, token, venue }` (`venue`: `curve` or `pool`): `IN_FLIGHT`
 * from the send, `DONE` with the legs the chain shows, `FAILED` when nothing
 * moved. Its `fee` is Ryntra's part of the trade's fee — on the curve the
 * partner's part of the trading fee and Meteora's referral, in the pool the
 * referral — read from the swap event; the person paid nothing on top of the
 * curve's or the pool's fee. `POST /api/v1/launch/{mint}/trade/submit` answers
 * also `receiptHash` (the trade's Outcome Receipt, once the chain answered in
 * time; null otherwise) and `shareLink` (the token's short address
 * `/t/<8>/<code>` with the person's own referral code — it previews the
 * token's card and sends a person on to its page, SOL-L1e — for «Поділитися
 * угодою»; null when it could not be made). `POST /api/v1/launch/{mint}/trade/receipt` with `{ wallet,
 * signature }` — the trade's issuer-signed Outcome Receipt
 * (`LaunchTradeReceiptResponseSchema`): its facts are chunked JSON under
 * `ryntra.solana.launch-trade-receipt.facts@1`, as a swap's; a trade still in
 * flight is settled from the chain first. `capabilities.launch.tradeReceipt`
 * names it. A client that does not know `LAUNCH` reads the row as a swap.
 *
 * **1.35.0 — the referral binds on its own (the Growth line's «Ріст v6-9»).**
 * `GET /api/rewards/referral` and `POST` share `RewardsReferralStateSchema`,
 * which gains three optional keys: `binding` (`{ open, until }` — with no
 * inviter yet, whether one can still be added: before the first trade `until`
 * null, for seven days after it the last moment, then `open` false), `change`
 * (the same shape — with an inviter, whether the one change is still open) and
 * `bound: true` (the read that bound the carried code on its own). `POST`
 * takes the action `change`; `REFERRAL_REFUSALS_V1` gains `ALREADY_CHANGED`.
 * A client that skips unknown keys is unaffected; one that parses the state
 * strictly must take the new keys and treat an unknown refusal as a refusal.
 *
 * **1.36.0 — the markets launched on Ryntra and each market's health.** Additive, and served only where
 * `capabilities.launch` is present; public, no wallet. `GET /api/v1/launch/markets` — every market launched on Ryntra on
 * this network, a row each: its state of the cycle (`state.code` — `CREATED`, `PRICE_DISCOVERY`, `GRADUATION_READY` — the
 * curve full, waiting for its move —, `MIGRATING` — only while the executor's own migration is in flight —,
 * `CORE_MARKET_LIVE`, `ENDOWMENT_FUNDED`, `LADDER_ACTIVE`, `MAINTAINING`, `PAUSED_RISK` — Ryntra's acts on the market
 * stopped —, `MATURE`, and the failures `MIGRATION_FAILED` — a full curve not migrated after ten minutes — and
 * `ENDOWMENT_EXHAUSTED`; a state the executor has not recorded is never inferred, and this version assigns no `MATURE`,
 * `ENDOWMENT_*` or `RISK_LIMIT` pause), the curve's way to the DEX, the DAMM v2 pool's liquidity, the market's budget,
 * executable depth at −5 %, whole days since the DEX, a trade in the last day, holders, and the creator (the lock's
 * dates, whether they sold; a row not read keeps the lock its record holds); markets with a trade in the last day first, then by
 * state and the newest launch; Ryntra's own launches — a creator among Ryntra's own wallets — carry
 * `technicalValidation: true`; `read: false` is a row with the record's facts only, its chain not read in time. `GET
 * /api/v1/launch/markets/{mint}` — one market's row and the addresses it lives at: the config, the curve, the DAMM v2
 * pool and its positions locked for ever, the creator's lock, the fee-sharing vault, Ryntra's steps and executor. `GET
 * /api/v1/launch/{mint}/health` — the market's health by fixed definitions: `depth` at −2, −5 and −10 % — the pair
 * currency the market pays out while sales move the price that far down: on the curve what the DBC curve releases
 * between the two prices (`"0"` on a full curve — it takes no sale until it moves), after the DEX what the DAMM v2 pool
 * releases plus Ryntra's DLMM steps at or above the lower price; the pools' fee is not taken off and other venues are
 * not counted; `price` — the price now; `budget` — what Ryntra earned on the market for its liquidity, what is in its
 * steps, what is left (`NOT_COUNTED` — not accounted yet: earned and reserve null, never zero); `ladder` — Ryntra's steps
 * as they stand, with the prices of those holding the pair currency; `survival` — days since the DEX, the price against
 * the pool's opening price, a trade in the last 24 hours; `holders` — wallets worth more than $1 at the price now,
 * without pools, locks and Ryntra's own wallets (`atLeast` — the node would not list every account: the ones found, a
 * floor); `creator` — the lock's dates and whether the creator sold; `concentration` — the ten largest balances without
 * pools and locks as a share of the tokens outside them (`atLeast` — from the mint's largest accounts, a floor), marked
 * above 60 %; `engine` — Ryntra's executor on this network, whether it acts here now, its last act on the market and a
 * pause; `rules` — what keeps the market now, each a `rule` (a program enforces it: Token-2022, Meteora DBC, DAMM v2, a
 * lock, the fee-sharing vault) or a `policy` (Ryntra's server runs it — listed only while it runs), `rulesComplete` false
 * when the token's receipt was not read and its rules are missing. A figure not read is null — never zero. The flight
 * log's entries gain `enforcement` (`rule`, `policy`, or null for what the log observes, a sale of the creator's) and the
 * answer `total` — every entry the log holds, more than `events` when only the newest 200 are given.
 * `capabilities.launch.markets`, `marketCard` and `health` name the routes. A client that does not call them, and one
 * that skips unknown keys of the flight log, needs no release; one that parses the flight log strictly takes
 * `enforcement` and `total` (the phone reads no flight log).
 *
 * **1.37.0 — the executor's own marks and its switch.** Additive. The flight log's answer gains `marks` — what the log
 * notes beside the chain's own events, none of it a transaction of its own, the oldest first: `WATCH_STARTED` (Ryntra's
 * executor passed over this market for the first time and acts here by its rules from now on), `STATE` (the market moved
 * into another state of its cycle as the executor read it — from the move to the DEX on: `MIGRATING`,
 * `MIGRATION_FAILED`, `CORE_MARKET_LIVE`, `ENDOWMENT_FUNDED`, `LADDER_ACTIVE`, `MAINTAINING`, `MATURE`,
 * `ENDOWMENT_EXHAUSTED` — with `signature`, the transaction it rests on, when there is one), `STOPPED` and `RESUMED`
 * (Ryntra's operator stopped or resumed the executor on this market or on every market — `scope`; while stopped the
 * executor signs nothing on the market) and `GRADUATION_FAILED` (the executor's graduation of a full curve was refused,
 * failed on chain — `signature` — or expired unseen; the executor sends it again itself). A market's health `engine.pause`
 * gains the code `OPERATOR` — the operator's stop — and its state assigns `MATURE` (thirty days on the DEX),
 * `MIGRATING` (the executor's graduation in flight) and `MIGRATION_FAILED` at once when the executor's own graduation
 * failed. Ryntra's liquidity is named the Fee-Funded Liquidity Ladder in the words of this contract; its fields keep their
 * names (`floor`, `FLOOR_*`). A client that skips unknown keys needs no release; one that parses the flight log or the
 * pause strictly takes `marks` and `OPERATOR` (the phone reads neither).
 *
 * **1.38.0 — Micro and the demo market.** Additive. `LaunchPresetId` gains `micro` — a small market for people: USDC,
 * graduation at exactly 750 USDC raised (Meteora's keepers migrate it too), the whole migration fee of 8 % to the
 * partner — the market's budget, the creator 0 % of it — the creator 40 % of the curve's trading fees, the first buy at
 * most 2 % of supply and always under the creator's lock, the graduated pool's fee from 2 % down to 0.25 % with its
 * market cap and a quarter of the LP fee compounded — and `demo`, the demo market: Ryntra's technical validation of the
 * whole cycle (50 USDC, a 30 % migration fee, otherwise as Micro), never in `GET /launch/presets`; a build on it from
 * any wallet but Ryntra's own answers `VALIDATION_ERROR`. A preset gains `creatorLockMinDays` — a first purchase on
 * it must go under the creator's lock with at least that many days before anything unlocks (Micro 180; null — the lock
 * is the creator's choice; a build without it answers `VALIDATION_ERROR`) — and `technicalValidation`. A market's health
 * gains `creator.lockRequired`: with it true and `lock` null the preset's lock did not land. A preset gains `graduationQuote`
 * (Micro 750); `GET /launch/presets` lists a preset with `creatorLockMinDays` only to a client naming 1.38.0 or later in
 * `X-Ryntra-API-Version`. A client that
 * draws every preset from the list and skips unknown keys needs no release to show Micro; it must send a lock whose
 * `cliffDays` reaches `creatorLockMinDays` with a first purchase on Micro, or the build is refused.
 *
 * **1.39.0 — a market's budget from its fees.** Additive. On Micro and the demo market Ryntra's executor is the config's
 * fee claimer itself and claims, on the markets Ryntra launched itself, the migration fee and the partner's surplus whole
 * and the partner's curve fees and locked DAMM v2 position's fees — a quarter of each of those two into the market's
 * budget, three quarters Ryntra's revenue apart; on a market with no ladder (people's markets for now) nothing is claimed
 * and the fees wait in Meteora's pools. A market's `budget` (row and health) gains `sources`, `placedRaw`, `revenueRaw`,
 * `inPoolRaw` and `exhausted`; `state` `COUNTED` and `IN_POOL` are now assigned. The flight log gains the entry kind
 * `FEE_CLAIMED` with `source` (`migration`, `surplus`, `curve`, `lp`) and `budgetRaw` (the budget's part), and its
 * marks `risks` on a `STATE` mark into `PAUSED_RISK`: the budget's risk limits that hold (`DROP` — the price fell more
 * than 30 % within an hour; `CREATOR_SOLD` — a sale from the creator's wallet in the market's first week; `LOW_SOL` — the
 * executor below 0.1 SOL), each stopping new money into the steps. A market's health `engine.pause` with code
 * `RISK_LIMIT` gains `risks`. A client that skips unknown keys needs no release; one that parses the flight log's kinds
 * strictly takes `FEE_CLAIMED` (the phone reads no flight log).
 *
 * **1.40.0 — the creator's purchases in the flight log.** Additive. The flight log gains the entry kind `CREATOR_BOUGHT`:
 * a purchase from the creator's wallet after the launch, one entry a transaction with `tokensRaw` and `pairRaw` — the
 * first one, in the creation transaction itself, stays `LAUNCHED`'s. Every trade of the creator's is now in the log, a
 * purchase as a sale. Its enforcement is null: a fact the log observes, not an act under a rule. A client
 * that parses the flight log's kinds strictly takes `CREATOR_BOUGHT` (the phone reads no flight log). A holder's position
 * gains `nextCollection` — the collector's queue by the collector's own rule and attempts.
 *
 * **1.41.0 — a holder's entry for people.** Additive. A holder's position read now gains `closedAccounts`: the owner's
 * token or pair account the program pays the fees into, closed — the collector waits and never reopens it at its cost;
 * `nextCollection` is then null — and `claimsCount`, every claim the collector made (`claims` keeps the newest 20). `open` on `GET /api/v1/launch/{mint}/holder/{address}` and `GET
 * /api/v1/launch/holders/{address}` is the same for every address: true wherever the entry is open to people; while it
 * is closed, true only for an operator's own wallet that the request proved it signs for (a wallet sign-in) — a named
 * address alone never tells whose it is. A client that skips unknown keys needs no release.
 *
 * **1.43.0 — the assistant's core v2 (AI-02, 2026-10-17).** Additive. `POST /api/v1/agent/session` takes `fresh`
 * («Нова розмова»: a new conversation even where one for the same context exists). `GET /api/v1/agent/sessions` lists
 * the proven wallet's conversations — the first question, the turn count, the dates and `expiresAt`: a conversation
 * lives `AGENT_SESSION_RETENTION_DAYS` (90) days from its last turn and is then neither read back nor listed.
 * `POST /api/v1/assistant/guest` answers a market question without a wallet — a price, a move, an asset's evidence, a
 * comparison — the same tools and verifier as a conversation, nothing of anyone's own read and nothing stored; a
 * question about a portfolio, a plan or a trade is answered with the way to connect a wallet. A guest's model answers
 * are limited per day by a keyed digest of the request's address (`guest.day`), the request rate per minute
 * (`RATE_LIMITED`); over the day the answer is still given, composed from the reads. No response shape changed.
 * **1.42.0 — notes from the spot limits (2026-10-16).** Additive. A note's subject may be `limit-order`, `id` the order
 * account of a spot limit order Ryntra recorded (Jupiter's Trigger or Meteora DLMM): «Ордер виконано» / "Limit order
 * filled" when the order fills — on DLMM, converted and waiting to be taken back in «Мої ордери» — and «Квитанція
 * готова» / "Receipt ready" when the reconciler settles a placement or a cancellation the request left without an answer
 * (placed, not placed, cancelled, taken back to the wallet, or not cancelled — the order still waits). One note per event and order, in the language of the
 * wallet's newest registered device, both languages in `text`; the words name the side, the token and the venue — never
 * an amount or a price, so they stand on a lock screen. Its action is «Мої ордери»; its link opens the base token's
 * Spot page (`/app/spot?mint=`), where the orders are, and so does its Telegram button. The limits routes `POST
 * /api/solana/limits/{market,review,orders,cancel,submit}` answer the native bearer for its own wallet as they answer the
 * site's own origin; the phone's limits go through them. A client that reads note subjects as a closed list adds
 * `limit-order`; one that skips an unknown kind needs no release.
 *
 * **1.45.0 — Rewards 2.1.0 (Ріст 2, the Growth line, 2026-10-18).** Additive. `GET /api/rewards` gains an optional `programme`:
 * the claim floor for this wallet now ($0.25 with a USDC account, $1 when the payout opens one or the account
 * could not be read; `usdcAccount` says which), the offer «First $10 back» (cap, days from the first trade, new
 * wallets a month), the wallet's own window when it holds one (open or closed, its check, what came back, the part
 * waiting for the check, when it ends) and the inviter's window (share and days from a friend's first trade). The
 * field is absent until rules 2.1.0 are in force. A client that does not read it needs no release.
 *
 * **1.46.0 — «Ранковий огляд» (the assistant line, AI-10, 2026-10-18).** Additive. `GET /api/v1/assistant/brief` reads
 * the proven wallet's morning brief — whether it is on, its time and zone (09:00 Europe/Kyiv unless the person chose
 * another quarter hour), when the next one comes (after the quiet hours of Нагляд when the time falls inside them),
 * where it goes (the inbox always; Telegram and push as Нагляд's preferences say) and the latest brief: «Сьогодні на
 * ринку», one for everyone, and the person's own changes in their tokens, positions and plans, each part the
 * model's blocks over the server's lines, every line marked `fact` or `unverified` with its source and time. `PUT`
 * turns it on or off and sets the time. A note's subject may be `assistant-brief`, `id` the person's day
 * (`2026-10-18`): its words are the brief's text, its action «Відкрити огляд», its link the assistant's page with the
 * day's brief open (`/app/ryn?brief=<day>`). `priceCredits` says what the brief will cost once credits exist; until
 * then `charged` is false. A client that skips an unknown note kind needs no release.
 *
 * **1.47.0 — whether Ryntra's executor acts, not read (line A, SOL-L1a, 2026-10-18).** Additive. A market's health
 * `engine.actsUnread` is `true` when the executor's switch or its passes could not be read now and no recent read stands
 * in: `engine.acts` is then false by not knowing, not because the executor stopped — a client says «not read», never
 * that Ryntra's collector or executor does not run. Absent when it was read. A client that does not read it needs no
 * release.
 *
 * **1.50.0 — the price of a launch before the signature (line A, SOL-L1b, 2026-10-19).** Additive. A pool trade's quote
 * `fee.liquidity` splits `fee.liquidityRaw`: the creator's and Ryntra's locked positions of the move to the DEX (half
 * each of the pool's permanently locked liquidity, by the pool's liquidity read with the quote), every other position,
 * and the share compounded back into the pool (it grows all of the pool's liquidity); null on the curve, or when the
 * pool's liquidity was not read. The
 * launch's build takes `partner` — the creator's partner as the review showed it («offered»), removed («none»), or
 * another one by `{ code }` — and answers the partner it binds, masked; absent, nobody is bound. Each preset of
 * `GET /api/v1/launch/presets` carries `terms`: who receives every fee on the curve, at the move to the DEX and in the
 * DEX pool, in basis points. A launch refused because
 * too many launches go out on the network this hour answers `LAUNCH_BUSY` (429) to a client that names 1.50.0 or later
 * in `X-Ryntra-API-Version`, and `LAUNCH_PAUSED` as before to any other. A client that does not read them needs no
 * release.
 *
 * **1.52.0 — the assistant's credits (the assistant line, AI-04, 2026-10-20).** Additive. A question that reaches the
 * model is paid in credits, not counted against a call allowance: the day's free credits first (20 a UTC day, not
 * carried over), then the welcome and the bought ones. `budget.credits` (`AssistantCredits`) says what there is — the
 * free credits of the day, the balance, what is held, the day's cap, every action's price — and `budget.reason` says why
 * the next question would be answered without the model. `acceptCredits` on `POST /api/v1/agent/message` and on the
 * lens routes is the price the client showed before the question: past the free credits nothing of the balance is taken
 * without it, and a price above it is refused; absent, only free credits are spent. Over the credits the answer is still
 * given — composed from the reads. `GET /api/v1/assistant/credits` reads the credits and their latest entries;
 * `POST /api/v1/assistant/credits/welcome` asks for the welcome credits once per wallet and per account —
 * `WELCOME_TAKEN` (409), `WELCOME_NOT_ELIGIBLE` (403) for a wallet younger or quieter than the check. Credits are the
 * service's own units, never a token, never paid out. A client that does not read them needs no release; a client that
 * does not send `acceptCredits` gets the free credits of every day.
 *
 * **1.54.0 — buying credits for USDC (the assistant line, AI-12, 2026-10-20).** Additive. `GET /api/v1/assistant/credits`
 * carries `purchase` — whether credits are sold on this deployment, the packages ($2 → 2 000, $5 → 5 250, $10 → 11 000,
 * $25 → 28 750) and the treasury they are paid to. `POST /api/v1/assistant/credits/orders` opens an order for one
 * package: a payment request to the treasury with its own Solana Pay reference, valid 15 minutes, paid on the page the
 * product already has (`payPage`, `/pay/<id>`; the phone builds the transfer through `POST /api/pay/<id>/transaction`
 * and signs it with MWA). `GET /api/v1/assistant/credits/orders` and `GET /api/v1/assistant/credits/orders/<id>` read
 * the chain for the reference and credit once — USDC that reached the treasury in a successful transaction carrying it;
 * each signature counts for one order. Less than the package is credited at 1 000 for 1 USDC without the bonus, more —
 * the package and the rest at that rate; another token is not credited (`wrongToken`). `CREDIT_ORDER_NOT_FOUND` (404).
 *
 * **1.55.0 — Proof-of-Launch (line A, SOL-L3, 2026-10-20).** Additive. `GET /api/v1/launch/survival`: the survival of
 * every market launched on Ryntra on this network at 7, 30 and 90 days — alive at day N when someone other than its
 * creator and Ryntra's own wallets traded it in the week up to day N, each proven by that trade's transaction, quiet when
 * that week was read whole without one, not read otherwise (a client gives no rate while any market at that age is not
 * read: it is most often a busy one); people's markets and Ryntra's own apart. A token's
 * `GET /api/v1/launch/{mint}` carries `storage`: its metadata and picture by sha256, their IPFS address and their pinned
 * IPFS copy. A client that does not read them needs no release.
 *
 * **1.56.0 — Формати запуску 2 (line A, SOL-L5, 2026-10-20).** Additive. `GET /api/v1/launch/presets` carries
 * `communities` — «Спільнота»'s community tokens, each with the operator's own config — and `formats`, the formats of
 * «Розширені параметри» with their bounds, each null where it is not offered (on mainnet until the operator gives its
 * bounds; early access also until his word). The preset `advanced` — «Розширений»: a config of one launch from the
 * creator's choice within the operator's bounds, made by `POST /api/v1/launch/advanced/config/build|submit` and named by
 * the launch's quote and build (`advancedConfig`); two signatures, the config's and the launch's. `pairMint` on the quote
 * and the build names the community token «Спільнота» pairs against. `GET /api/v1/launch/{mint}` carries `advanced` (the
 * launch's own numbers and what makes them unusual) and `pair`. Launch Boost — a creator's campaign for buyers from the
 * creator's own money: `GET /api/v1/launch/{mint}/boost` shows its rules before a purchase; `POST
 * /api/v1/launch/{mint}/boost/build|submit` locks its budget in Met Lock from the creator to the creator until the
 * campaign and its hold are over; `POST /api/v1/launch/{mint}/boost/payout/build|submit` — the payout counted from the
 * chain and signed by the creator. Ryntra takes 0. Early access — `POST /api/v1/launch/early-access/build|submit`: an
 * honest Token-2022 mint, a DAMM v2 pool with the creator's position locked for ever and a Meteora Alpha Vault (FCFS or
 * Pro Rata) people deposit USDC into before trading opens; `GET /api/v1/launch/{mint}/early-access[?wallet=]`, `POST
 * /api/v1/launch/{mint}/early-access/deposit/build|submit`, and after the deposits `POST
 * /api/v1/launch/{mint}/early-access/action/build|submit` — CLAIM the vested tokens, WITHDRAW_REMAINING the unspent USDC,
 * WITHDRAW a Pro Rata deposit while deposits are open, FILL the vault's permissionless purchase. A client that does not
 * read them needs no release.
 *
 * **1.57.0 — «Стежити за токеном» (the assistant line, AI-05, 2026-10-20).** Additive. `GET /api/v1/assistant/watches`
 * lists the proven wallet's token watches — each its token by mint, its rule (`price` — the price crossed a level,
 * with a 1 % band so a price on the line rings once; `move` — ±N % over 5 min, 1 h or 24 h; `volume` — the hour traded
 * N times the day's hourly average; `liquidity` — the depth of the token's pools against USDC, USDT or SOL, or of one
 * named pool, changed by N % over 1 h or 24 h), on or paused, its pause between notes, its channels, what it reads now
 * and its latest note — with the presets a newcomer picks from, how many of the three free watches are left and the
 * price of «Чому?» (`explain`: the question put to the assistant only when the person asks it, at that price). `POST`
 * starts a watch from a preset or a rule; `PATCH /api/v1/assistant/watches/{id}` pauses, resumes or changes it (a
 * changed rule starts afresh), `DELETE` removes it. `WATCH_LIMIT_REACHED` (409) past three, `WATCH_NOT_FOUND` (404),
 * `WATCH_VERSION_CONFLICT` (409) on a stale `ifVersion`, `ASSET_UNCONFIRMED` (422) for a mint Jupiter does not know.
 * Every token is read once for everyone who watches it; a note goes to the inbox always and to Telegram and push as
 * Нагляд's preferences and the watch's channels say, at most 20 an hour, held through quiet hours. A note's subject
 * may be `token-watch`, `id` the watch: its link is the assistant's page with the watch open (`/app/ryn?watch=<id>`). A
 * client that skips an unknown note kind needs no release.
 *
 * **1.58.0 — «Знайомство» (the assistant line, AI-06, 2026-10-20).** Additive. `GET /api/v1/assistant/profile` reads
 * the proven wallet's five answers — the goal (`learn`, `trade`, `hold`), the experience (`new`, `some`, `pro`), the
 * risk per trade (0.5, 1 or 2 %), the horizon (`hours`, `days`, `weeks`) — or that the person skipped them, and where
 * notes go (Нагляд's preferences: Telegram, push, quiet hours). `PUT` writes the four answers or `{ "skipped": true }`
 * and, with `delivery`, the same preferences the monitoring settings write. The answers shape only how Ryntra words an
 * answer (plainer for a newcomer, the horizon's window first); they never become a buy or a sell. A client that does not
 * read them needs no release.
 *
 * **1.60.0 — execution truth (line A, SOL-X1, 2026-10-21).** Additive. `POST /api/solana/activity` answers `cashback`
 * beside `rewards`, behind the same wallet proof: the cashback each trade earned, by the trade's signature (the
 * wallet's CASHBACK accruals summed per operation, every trade that has one; `usdMicros` null while unvalued, `held` while part
 * waits on «First $10 back»'s check). A receipt's execution truth states it beside its own facts. Read-only over the
 * Rewards ledger — no rate, route or receipt changed. A client that does not read it needs no release.
 *
 * **1.61.0 — «План угоди й критик» (the assistant line, AI-11, 2026-10-21).** Additive. `POST /api/v1/assistant/plans`
 * composes a trade plan with the strong model from the person's idea, their loss limit and budget and any level they
 * know (or a conversation's draft, `draftId`) — a structure: the thesis, the entry and its bound, the invalidation, up to
 * three targets, the fees and the size the plan engine computes, every assumption with who made it, the sources read —
 * and the critic, the same strong model under its own instruction, argues with it beside the plan engine's own checks;
 * at `prices.plan` credits, held before the first call and taken by what stood: the plan's part when its words did, the critic's part (`prices.recheck`) when its findings did, nothing otherwise (`acceptCredits`). `GET
 * /api/v1/assistant/plans[/{id}]` reads the plans with their state (`draft` → `checked` → `approved` → `watching` →
 * `done` / `cancelled` / `broken`), versions, journal, what Нагляд says of each and «План проти реальності» — every trade
 * under the plan against it, its receipt and its risk in words. `PUT …/{id}` is the person's change: a new version,
 * checked by the rules; `POST …/{id}/critic` the strong critic again at `prices.recheck`; `POST …/{id}/state` the
 * person's word — `approved` writes their own Trading Plan from the version, `watching` activates it so Нагляд watches it,
 * `cancelled` ends both while nothing was traded. Ryntra never trades: no route here quotes, builds, signs or sends. New
 * error codes `ASSISTANT_PLAN_NOT_FOUND` (404), `ASSISTANT_PLAN_VERSION_CONFLICT` (409), `ASSISTANT_PLAN_STATE_REFUSED`
 * (409). A client that does not call the routes needs no release.
 *
 * **1.62.0 — the Predictions failure vocabulary after PM-S1 (the predictions line, 2026-10-21).** Additive. The
 * prediction failure codes add `FUNDING_OFF` (403 — live money is switched off on this deployment) and `WITHDRAWAL_OPEN`
 * (409 — a withdrawal whose state is not known yet stands for this wallet), as `lib/predictions/failure.ts` has them
 * since PM-S1; only the funding routes (`/api/predictions/funding/**`, live money behind `PREDICTIONS_LIVE_FUNDING`,
 * not described in this contract yet) answer them. A prediction route acts only for a Solana wallet since PM-S1: an
 * EVM proof is refused by the handler with UNAUTHORIZED 401. No described route's answer changed. A client that does
 * not call the funding routes needs no release.
 *
 * **1.63.0 — a followed wallet's note (SOL-R4, line A, 2026-10-21).** Additive. A note's subject may be `wallet-watch`,
 * `id` the followed wallet's address: a trade that wallet made, read from the chain — bought or sold a token, or «the
 * creator of a token sells» — written by «Стеження за гаманцями» («Ринки» → «Гаманці», `/app/markets?tab=wallets`).
 * The note opens the wallet there; it has no monitor and no «Чому?». The wallets a person follows are served outside
 * v1 (`/api/wallet-watch`), not described here yet. A client that does not read the notes' subject needs no release;
 * one that switches on it treats an unknown kind as a plain note.
 *
 * **1.64.0 — «Голос у вебі» (the assistant line, AI-08, 2026-10-21).** Additive. `POST /api/v1/assistant/voice` hears a
 * recording on the server where the browser's own recognition is missing or failed: the recording's own `id` (a UUID
 * the client makes when it stops — the same id is heard once and answered again with its words, never charged twice),
 * the audio (base64, at most two minutes, its length read from its own WebM, MP4 or Ogg container before anything is
 * paid), its type, the seconds the client counted, the language, and `acceptCredits` — the price the client showed,
 * `prices.voice` credits for each started 30 seconds. The price is held, the recording heard (`gpt-transcribe` with the
 * language and the product's tickers), and the hold kept only when words were heard. The answer is the words for the
 * question field — `text`, `seconds`, `spent` (`free` of them the day's free credits), `repeat` and the credits
 * after — never a question asked: the client puts them in the field for the person to correct and ask. Voice gives no
 * permission and starts no action. New error codes `VOICE_TOO_LONG` (413 — over two minutes, heavier than its length
 * allows, or longer than it says), `VOICE_NOT_HEARD` (422 — no words; nothing charged), `VOICE_PRICE_NOT_SHOWN` (409 —
 * read `prices.voice` again), `VOICE_DAY_SPENT` (429 — the deployment's day of voice on the server is spent),
 * `CREDITS_DAY_CAP` (429 — the holder's day's spending cap is reached). A client that does not call the route needs no
 * release.
 *
 * **1.65.0 — «Імена .skr» (line A, SKR-4, 2026-10-22).** Additive. `GET /api/v1/research/skr-name` reads a Seeker
 * owner's `.skr` name on mainnet through Solana Mobile's `@solana-mobile/skr-domain`: `?name=alice.skr` answers the
 * address that owns the name now — read from the chain every time, never cached, because it is where money goes (a
 * client asks again right before a signature and shows the whole address in Review); `?address=` answers the wallet's
 * primary name, the one it chose, cached an hour; `&self=1` — only when the request proves that wallet (the proof
 * cookie or the bearer), otherwise ignored — the first of the names it holds when it chose none, read on the server alone. `state` is `FOUND`, `NOT_FOUND` (no such name, or it
 * expired; for an address: no name) or `UNAVAILABLE` (the chain did not answer — never «no name»). A name is one
 * label of ASCII letters, digits, `-` and `_` before `.skr`. `capabilities.research.skrName` names the route. A client
 * that does not call it needs no release.
 *
 * **1.66.0 — «Перевірено Seeker» (SKR-3, line A, 2026-10-22).** Additive. `GET /api/v1/auth/seeker` says whether the
 * wallet the session proved by signature (the web's cookie or the phone's bearer — `requireWalletProof`, a read)
 * holds a Seeker Genesis Token: `address`, `verified`, `tokens` (each `mint` and its `memberNumber` in the SGT group,
 * as a string), `network` and `checkedAt`. The server reads it on mainnet with Solana Mobile's
 * `@solana-mobile/skr-genesis-token` — membership in the SGT group from the mint's own bytes — and keeps a found
 * answer an hour, «none» five minutes. A chain that could not be read is `UNAVAILABLE` (503), never `verified: false`.
 * No new error codes. It is a mark, not a permission: nothing is paid or unlocked by it. A client that does not call
 * the route needs no release.
 *
 * **1.66.0, words only (the assistant line, AI-21, 2026-10-24).** No shape changed, no version moves. (1) A recording
 * heard as nothing but the recogniser's own word list («Ryntra, SOL, Solana, BONK, …» — what silence came back as) is
 * `VOICE_NOT_HEARD` with nothing charged, on `POST /api/v1/assistant/voice` and for a voice in Telegram alike — a
 * recording of a single ticker alone («SOL») included; the seconds the provider billed still count in the deployment's
 * day. (2) An evidence card's `reason`, a note card's `reason`, and every sentence of the answer, the Brief and the
 * Critic that says why an observation or a read is missing, is the server's words in the person's language — never a
 * provider's status code or transport sentence («(422)», «The request was refused»). (3) The head of an answer to «what
 * moved the price?» is the move card's own line: one figure, one source (DexScreener), its time; over 24 h, the moved
 * token's catalogue change and candles' day move are not said beside it, by the composer or by the model. A client
 * needs no release.
 *
 * **1.67.0 — «Матриця можливостей і повноважень» (EXE-1, line A, 2026-10-24).** Additive. `capabilities.authority`: one
 * row per venue × action on Solana — its honest state on the deployment that answers, who holds the bound when the
 * person is not signing, the mode, the signer and what runs alone; `automatic` is false on every row. No new route, no
 * new error code. A client that does not read the field needs no release.
 *
 * **1.68.0 — «Події ринку» (DSC-1, line A, 2026-10-24).** Additive. `GET /api/v1/events` is one public feed of what
 * happened on Solana's markets — a new token, a token out to a DEX (DBC → DAMM v2 for a launch on Ryntra), an Alpha
 * Vault opened, a pool's liquidity changed, a mint or freeze right still on, a creator's lock opening, a creator's sale,
 * an act of a launch's flight log — each with its type, `happenedAt` and `observedAt`, its `sources`, its `signature`
 * or `account` with the explorer's link, its `finality` and whether its figures are `stale`, and the token's Pulse
 * risk flags. One fact, one record: `id` is `signature:index` for a fact with a transaction, and a fact told twice —
 * by two sources or by one twice — is one record. A suspicious token's event never stands above the first five clean
 * ones, after any filter. `observedAt` is when the server first saw the fact. `coverage` says which kinds are read, in
 * part or not yet; `logs` how many launches' flight logs were read. No wallet; no advice, no «signal», no trade. No new error codes. A
 * client that does not call it needs no release.
 *
 * **1.69.0 — «Частка творця за його вибором» (line A, SOL-L2b, 2026-10-24).** Additive. `GET /api/v1/launch/{mint}/split`
 * — the creator's division of their own share of the fees, собі · глибина · спільнота · холдерам: the rule in force and
 * its lines (the token's page shows them before a purchase), what it owes by the chain's count of the creator's claims
 * and what was done, the creator's depth steps in the token's DLMM pool as the chain holds them, each payout round with
 * its rows and root; for a launch with no rule, the empty split. `POST /api/v1/launch/{mint}/split/rule/build|submit` —
 * a rule the creator signs as a memo on chain, only raised once in force, its community wallet kept; `POST
 * /api/v1/launch/{mint}/split/depth/build|submit` — after the DEX, the buy steps from what depth is owed, from the
 * creator's wallet (the pool made first where there is none); `POST /api/v1/launch/{mint}/split/payout/build|submit` —
 * the community's part and the holders' by a snapshot without the creator's wallets, the bundle, programs and Ryntra's
 * wallets and of tokens not bought on the market, the round's root in a memo first. Only the creator signs; Ryntra takes
 * 0. `open` is false on mainnet, and every build answers CAPABILITY_UNAVAILABLE there. No new
 * error codes. A client that does not read
 * them needs no release.
 *
 * **1.70.0 — Ryntra Launch: the curve's surplus in «Мої лаунчі» (SOL-L1d, line A, 2026-10-24).** Additive. The creator's
 * side of a launch earns a fourth source, `surplus` — once the curve is full, the creator's part of what the last
 * purchase raised above the threshold (Meteora's formula: 80 % of it to the partner and the creator, the creator's part
 * by its trading share), withdrawn or not by the curve's own flag: `LaunchEarnings.role.surplus`, the claim's
 * `sources` may name it, and a receipt's `paid.surplus` is what the program's `EvtCreatorWithdrawSurplus` says it paid.
 * A claim may now take up to five transactions and name up to four sources. «Забрати» after the DEX takes the locked
 * LP's fee from the creator role's exit position the move to the DEX opened (no longer from the first position a node's
 * index lists for the wallet). No new routes, no new error codes. A client that reads `role` by its named sources needs
 * no release; one that adds up `paid` should add `surplus`.
 *
 * **1.71.0 — Ryntra Launch: a safe launch (MC-1, line A, 2026-10-25).** Additive. On Micro and the demo market a
 * creator's first purchase and its lock are one v1 transaction: `POST /api/v1/launch/build` takes `format: "v1"`, and
 * then answers the creation with the lock inside it and `lockUnsignedWireBase64: null`; without it a first purchase there
 * is refused `LAUNCH_WALLET_V1_REQUIRED` (422) — a launch without one is built as before. The token's picture is checked
 * before it is stored: one Ryntra took down, or — when the operator switched the check on — one the moderation model reads as sexual, violent, graphic or self-harm,
 * is `LAUNCH_IMAGE_REFUSED` (422); a check that could not run stores nothing, `LAUNCH_IMAGE_CHECK_UNAVAILABLE` (503). A
 * token whose details Ryntra took down reads with no picture, no description, no links and no IPFS copies. No new routes. A client that
 * launches Micro with a first purchase sends `format: "v1"` where its wallet signs v1.
 *
 * **1.72.0 — «Комісія за переказ» (SOL-L10, line A, 2026-10-25).** Additive. Where the format is offered (its flag
 * `RYNTRA_LAUNCH_TRANSFER_FEE=open` on DBC SDK 2.0.0 — opened after devnet and the operator's canary), «Розширений»'s bounds carry
 * `transferFeeMaxBps` (2 %) and its choice may carry `transferFeeBps`: the config is made by `createConfig2` with the
 * token's `TransferFeeConfig` — RevokeZeroFee (the rate works on the curve; the move to the DEX sets 0 % two epochs on and
 * revokes the authority), the creator withdraws what is withheld. Without `transferFeeBps` nothing changes and the token
 * carries no such extension. A launch receipt may name `TransferFeeConfig` among the extensions, carries `transferFee`
 * (the rate, the creator, the timeline's phase at the read) and the mark `TRANSFER_FEE_UNTIL_DEX` in place of
 * `NO_TRANSFER_HOOK`; a market's rules may name it too. New routes: `GET /api/v1/launch/{mint}/transfer-fee` (the cycle —
 * in holders' accounts, harvested to the mint, withdrawn — and the timeline by epoch, public) and
 * `POST /api/v1/launch/{mint}/transfer-fee/build|submit` (the creator's harvest or withdraw, signed by the wallet alone).
 * New error code `LAUNCH_NO_TRANSFER_FEE` (404). A client that draws marks by code should draw the new one by its words.
 *
 * **1.73.0 — Ryntra Launch: the pair-currency watch and «Забрати все» (SOL-L12, line A, 2026-10-25).** Additive. One
 * new route, `GET /api/v1/launch/{mint}/claim/review?wallet=` — the Review before «Забрати»: every pocket of the
 * creator's side (the curve's fee, the DEX exit's fee, the surplus, the locked position's fees, the curve's leftover,
 * a transfer fee) with what it holds and whether this claim takes it, the transactions the wallet will sign and what
 * each takes, the creator role's exit position as the NFT it is (who holds it, locked for ever), the surplus as Meteora
 * splits it and the creator's own lock's dates. The token's read carries `pairWatch`: the pair currency's mint as Ryntra
 * watches it — `CHANGED` with the fields that changed when its issuer changed the transfer fee, an authority or an
 * extension. One new error code: a launch on a changed pair is refused `LAUNCH_QUOTE_PAUSED` (503) — to a client naming
 * 1.73.0 or later; an older one gets `LAUNCH_PAUSED`. A note of kind `launch-creator` may now say the pair changed.
 *
 * **1.74.0 — Ryntra Launch: launch windows and crews (MC-2, line A, 2026-10-25).** Additive: five routes and one field.
 * `GET /api/v1/launch/windows` — the windows' schedule (a small one at the top of every hour UTC, a big one every
 * evening), the one open now and the next ones. `POST /api/v1/launch/crews` — the creator's proven wallet invites one to
 * four people by X handle, each with a part of the creator's fees; `GET /api/v1/launch/crews/{id}` — the crew as anyone
 * reads it, each invitee's words to say yes to; `POST /api/v1/launch/crews/{id}/answer` — an invitee's own yes, or that
 * wallet taking it back; `GET /api/v1/launch/crews` — the crews in flight, the vault's rows by wallet. `POST
 * /api/v1/launch/build` takes `crew` on Classic and Protected: the Dynamic Fee Sharing vault's rows are the creator and
 * the members who said yes. Crew writes answer `CAPABILITY_UNAVAILABLE` where crews are not open. No new error codes. A client that does not make crews needs no release.
 *
 * **1.75.0 — a team's roles and rights (TEAM-1, line A, 2026-10-25).** Additive: eight routes and seven error codes.
 * `GET /api/v1/teams/roles` — the matrix: nine roles (Owner · Admin · Finance · Launch Operator · Market Operator ·
 * Developer · Analyst · Viewer · Agent) × the nine rights of spec §9.2 and `members`, each `ALLOW`, `MULTISIG` or `DENY`;
 * a high-risk right (sign, deploy, payouts, withdraw, change rules) is never `ALLOW` — only a proposal on the team's
 * Squads treasury, through an EXE-1 row signed by the multisig. `GET`/`POST /api/v1/teams` — the proven wallet's teams
 * (one wallet, many teams) and a new one, its maker the first Owner; `GET /api/v1/teams/{id}` — the team as the wallet
 * may read it: the list to an active member, the journal to one who reads receipts, the treasury's signers on chain
 * beside the list; `POST /api/v1/teams/{id}/members` — an invitation; `POST /api/v1/teams/{id}/members/{wallet}` — the
 * wallet's own yes, a new role, or removal; `POST /api/v1/teams/{id}/treasury` — an Owner links a multisig their wallet
 * is on, once — a linked treasury changes only by its own multisig; `GET /api/v1/teams/{id}/check` — the server's decision for one right. Every right is checked on the server
 * from the stored list. Writes answer `CAPABILITY_UNAVAILABLE` where teams are not open (`open: false` in the roles
 * read). New codes: `TEAM_NOT_FOUND` 404, `TEAM_FORBIDDEN` 403, `TEAM_LIMIT` · `TEAM_MEMBER_EXISTS` · `TEAM_LAST_OWNER`
 * · `TEAM_CHANGED` 409, `TEAM_TREASURY_REFUSED` 422. A client that does not show teams needs no release.
 *
 * **1.76.0 — Perps: the market's data and its life, and the ticket's margin by Phoenix's SDK (PERP-4, line A,
 * 2026-10-25).** Additive, outside `/api/v1` (the routes the clients consume, as 1.11.0 describes them): the markets'
 * rows carry `state`, `group`, `name`, `aliases`, `fundingIntervalSeconds` and `nextFundingAt`;
 * `GET /api/solana/futures/funding?symbol=` — the funding rate now; `GET /api/solana/futures/ticket` — the margin, the
 * most, the account's health and the estimated liquidation by the SDK's margin calculator. No new error codes.
 *
 * **1.78.0 — /pay counts only money that arrived (FIX-PAY-1, SEC-1, line A, 2026-10-25).** Additive: one field. A payment
 * link's state is decided by what reached the recipient in the requested token, summed over every transaction that
 * carried the reference: a transaction that moved nothing is no payment (an open request is no longer «Paid» by it, two
 * of them are no overpayment), a top-up after a short payment completes it, and another token arriving first no longer
 * stops the requested one being counted. `PayLink.received` and `PayPublicRequest.received` — what arrived so far and
 * what a Token-2022 token's own transfer fee withheld of it — null while nothing in the token arrived. No new routes,
 * states, notes or error codes.
 *
 * **1.79.0 — the cross-chain swap checked before the signature (FIX-XSWAP-1, line A, 2026-10-25).** No `/api/v1`
 * schema changes; the web routes `/api/solana/cross-swap/*` refuse what they used to sign: a Mayan quote or a Relay
 * quote that does not answer the request (`QUOTE_MISMATCH`), a Mayan order reaching a program a Swift order does not
 * need (`UNEXPECTED_PROGRAM`), a simulated effect on the wallet beyond the amount, the fee and the order's rent
 * (`SIMULATION_EFFECT_*`); `plan.ownerEffects` states what the simulation proved. `ABANDON` releases a crossed EVM
 * order only with the chain's unchanged pending count (`RELEASE_NOT_ESTABLISHED`, `SOURCE_ACCOUNT_UNREADABLE`).
 *
 * **1.81.0 — Team Launch (MOS-2, line A, 2026-10-26).** Additive: two routes and one error code.
 * `GET /api/v1/launch/team/plan` — the eight steps of the wizard, the rights each one needs, the bounds the steps obey
 * and, with `team=`, the proven wallet's own decision for every step; `POST /api/v1/launch/team/step` — one step
 * committed, answering with the `actionId` the EXE-2 journal recorded and, on step 08, the review the signature is
 * made over (the simulation, every fee as its own row, the market's budget, the Constitution's fields and the
 * chronicle). `LAUNCH_TEAM_CLOSED` — Team Launch is not open on this deployment, or not to this wallet. Nothing is
 * built, signed or sent by either route.
 *
 * **1.82.0 — Perps: the deal's core (PERP-5, line A, 2026-10-26).** Additive, outside `/api/v1`:
 * `GET /api/solana/futures/history?wallet=&kind=trades|orders|funding[&symbol=]` — one wallet's own fills, orders and
 * funding settlements from Phoenix's public reads; the order routes take a time in force (`tif`) and the kinds
 * `cancelAll` and `cancelConditional`, and a Review carries `tif`, `impact`, `book`, `cancelAll`, `conditional` and
 * `fees.venueLiquidity`. New refusals of the order routes: `POST_ONLY_CROSS` 422, `NO_ORDERS` · `NO_CONDITIONAL` 409.
 *
 * **1.83.0 — Ryntra Launch: a launch in a pair with a checked pair currency (SOL-L11, line A, 2026-10-26).** Additive.
 * One new route, `GET /api/v1/launch/quote-assets` — the pair currencies this deployment checked, each as any pair is
 * said (the mint, the symbol, the decimals), with whether a launch in it is open now, the DBC version its own transfer
 * fee needs (0.2.1, or 0.2.2 and `createConfig2`), the rate a transfer of it pays now, its price with the moment it was
 * observed, and — where it is closed — the reasons in the register's own codes, the token badge among them: a pair
 * Meteora has given no badge is never offered, and only Meteora can give one. Public; reads the chain. «Розширений»'s
 * choice may name `quoteMint` (a mint of that register) and then the config is made in that pair: the build's answer
 * carries `quote` — the pair, the version and the figures of this very config, the threshold and the liquidity that
 * reaches the DEX after the move's fee and the fee the pair's mint withholds, each in the pair's own units and in
 * dollars at the price read. Any difference between the mint as it reads now and as it was checked refuses the build
 * `LAUNCH_QUOTE_PAUSED` (503, as 1.73.0 brought it) with the reasons said; a client before 1.73.0 reads `LAUNCH_PAUSED`.
 * No new error codes. A launch in such a pair says nothing of what stands behind the pair currency, on any surface.
 *
 * **1.84.0 — «Кампанія розподілу»: vesting and a Merkle claim (DROP-2, line A, 2026-10-26).** Additive: nine routes, no
 * new error codes. A campaign publishes a list and a root on Met Lock's root escrow, locks exactly what the list adds
 * up to, and then does nothing — each recipient takes their own allocation with their own signature, and a second claim
 * of a row cannot exist on chain (its escrow is created, not written to). `GET /api/v1/launch/{mint}/distribution` —
 * the token's campaigns; `GET /api/v1/launch/{mint}/distribution/{id}` — one campaign with its Review, the chain against
 * the list, what is left and the report; `POST …/distribution/build` and `…/submit` — the owner's one signature that
 * writes the root and funds it; `GET …/distribution/{id}/claim/{address}` — the claim panel (what is owed, what was
 * taken, what is left, the chain's receipts); `POST …/{id}/claim/build` and `…/claim/submit` — the recipient's own
 * claim, in which they are the only signer and the only payer; `POST …/{id}/recover/build` and `…/recover/submit` —
 * the owner's cancellation of a row where the campaign published that they may, which returns only what has not
 * vested. A client that does not show campaigns needs no release.
 *
 * **1.85.0 — the risk verdict before a trade (line A, 2026-10-26).** Additive: `risk` on the answers of
 * `POST /api/solana/swap/quote` and `POST /api/solana/swap/order` (outside `/api/v1`), and `tradeRisk` on
 * `POST /api/v1/launch/{mint}/trade/quote` — and so inside the `quote` of `…/trade/build` — named apart there because
 * that product's market read already has a `risk` of its own, the token's facts, a different list. The spot limit
 * order's Review (`/api/solana/limits/review`) carries the same object. `TradeRiskSchema`: the four words `BLOCKED` ·
 * `INCOMPLETE` · `REVIEW_REQUIRED` · `NO_KNOWN_BLOCKER` over thirteen named facts, each with the source that produced
 * it and the time it was read, and the thresholds the measured ones were read against. One shape for every kind of
 * trade; `NO_KNOWN_BLOCKER` is the absence of known blockers and never "safe"; a fact that was not read is
 * `INCOMPLETE` naming what is missing rather than a quiet pass. Nothing is removed and no field changes meaning.
 *
 * **1.86.0 — the developer console (DEV-2, line A, 2026-10-26).** Additive: twelve routes and eight error codes.
 * `GET /api/v1/developer/plan` — public: the two environments, the scopes, the events, the bounds, the quota windows
 * with whichever numbers this deployment states, the webhook signing scheme, and the *shape* a tariff has with
 * nothing filling it (`pricing.stated: false` — a price is set outside this build). `GET`/`POST
 * /api/v1/developer/projects`, `GET /api/v1/developer/projects/{id}` — a team's projects and one of them, with its
 * credentials, its endpoints, what each environment has spent and what the reading wallet may do. `POST
 * …/{id}/keys` and `POST …/{id}/keys/{keyId}` — issuing, rotating (a successor, the predecessor on a clock),
 * revoking, and changing scopes and origins. A **secret key** (`rsk_…`) is a server's: its token is returned once, in
 * the answer that makes it, the store keeps only a SHA-256 of it, no read carries it again, and a request carrying
 * an `Origin` is refused outright (`DEV_ORIGIN_REFUSED`) — it is never in a browser. A **public key** (`rpk_…`) has
 * no secret at all and answers only the origins it names. `POST …/{id}/endpoints` and `POST
 * …/{id}/endpoints/{endpointId}` — a signed-webhook endpoint (made off, its signing secret shown once), turning it
 * on, its events, a new secret with the old one signing for one window, removal, a test delivery, and `verify`: the
 * server's own check of a delivery a receiver got — signature, timestamp window, and the delivery id against what
 * this endpoint already had verified, which is what makes a replayed copy fail (`refusal: "REPLAYED"`). `GET
 * …/{id}/deliveries` — the log, for a role that reads receipts. Three routes are read by the credential itself in
 * `X-Ryntra-Key` rather than a wallet: `GET /api/v1/developer/key`, `…/usage` and `…/events`, each needing its own
 * scope, each counted against the project's quota and answering `X-Ryntra-Quota-*`. Every right is the team's
 * (TEAM-1), checked on the server on every request. New codes: `DEV_NOT_FOUND` 404, `DEV_FORBIDDEN` ·
 * `DEV_ORIGIN_REFUSED` · `DEV_SCOPE_REFUSED` 403, `DEV_LIMIT` · `DEV_CHANGED` 409, `DEV_KEY_INVALID` 401,
 * `DEV_QUOTA_EXCEEDED` 429. A client that does not show the console needs no release.
 */

import {
  BUDGET_MAXIMUM_USD,
  BUDGET_MINIMUM_USD,
  PAYMENT_EVENTS_KEPT,
  PAYMENT_FIXED_MAX_USD,
  PAYMENT_FIXED_MIN_USD,
  PAYMENT_PERCENT_MAX,
  PAYMENT_PERCENT_MIN,
  PAYMENT_ROUNDUP_STEPS_USD,
  PRICE_CONDITION_DEFAULT_PCT,
  PRICE_CONDITION_MAX_AGE_MINUTES,
  PRICE_CONDITION_MAX_PCT,
  PRICE_CONDITION_MIN_PCT,
  RULE_DIP_MAX_PCT,
  RULE_DIP_MIN_PCT,
  RULE_LIST_LIMIT,
  RULE_MAXIMUM_USD,
  RULE_MINIMUM_USD,
  RULE_FLOOR_AGE_HOURS,
  RULE_FLOOR_LIQUIDITY_USD,
  RULE_OCCURRENCES_KEPT,
} from "../../autoinvest/limits.ts";
import { RULE_ASSET_CLASSES, RULE_FLOOR_VERDICTS } from "../../autoinvest/floor.ts";
import { PAYMENT_DIRECTIONS, RULE_PAYMENT_MODES } from "../../autoinvest/payments.ts";
import { PRICE_CONDITION_VERDICTS, PRICE_REFERENCES } from "../../autoinvest/price-condition.ts";
import { RULE_CADENCES as SCHEDULE_CADENCES, isTimeZone as isTimeZoneName } from "../../autoinvest/schedule.ts";
import { FINDINGS_STATES, RISK_BANDS, SANCTIONS_STATES } from "../../evidence/address.ts";
import { EVIDENCE_METRIC_IDS, EVIDENCE_METRICS, EVIDENCE_PROVIDERS, EVIDENCE_WINDOWS } from "../../evidence/metrics.ts";
import { EVIDENCE_READ_STATES } from "../../evidence/snapshot.ts";
import { COMPANY_PATH_STEP_STATES, COMPANY_PATH_STEPS } from "../../stocks/company-path.ts";
import { RISK_ASSET_KINDS, RISK_GAPS, RISK_REASONS, RISK_STATES } from "../../monitoring/portfolio-risk.ts";
import { WATCH_ACTIONS, WATCH_REASONS, WATCH_SOURCES, WATCH_STATES } from "../../monitoring/watch-state.ts";
import { WATCH_PRESETS, WatchRuleSchema } from "../../assistant/watch/rules.ts";
import { POPULAR_LIMIT, POPULAR_LIMIT_MAX } from "../../stocks/popular.ts";
import { STOCK_ISSUER_IDS } from "../../stocks/representations.ts";
import { z } from "zod";

import { CREATOR_LOCK_IDS } from "../../core/launch/creator-lock.ts";
import { FEE_SOURCES } from "../../core/launch/creator-earnings.ts";
import { EARNINGS_CARD_SOURCE } from "../../core/launch/earnings-card.ts";
import { FEE_SHARE_MAX_RECIPIENTS, FEE_SHARE_MIN_BPS, FEE_SHARE_MIN_RECIPIENTS, FEE_SHARE_TOTAL_BPS } from "../../core/launch/fee-shares.ts";
import { JOURNAL_ACTORS, JOURNAL_KINDS, JOURNAL_MARK_ACTORS, JOURNAL_MARK_KINDS } from "../../core/launch/autopilot.ts";
import {
  AUTHORITY_SURFACES,
  AUTHORITY_VENUES,
  AUTOMATION_ELEMENTS,
  ELIGIBILITY,
  ENFORCEMENT_LEVELS,
  EXECUTION_MODES,
  HONEST_STATES,
  PROVIDER_STATUSES,
  RUNS_ALONE,
  RYNTRA_READINESS,
  SIGNERS,
} from "../../core/authority-matrix.ts";
import { BUDGET_RISKS, BUDGET_SOURCES } from "../../core/launch/budget.ts";
import { CONCENTRATION_MARK_BPS, DEPTH_DROPS_BPS, HOLDER_MIN_USD, MARKET_CYCLE_STATES, MARKET_ENFORCEMENT, MARKET_KEEPERS, MARKET_RULE_CODES } from "../../core/launch/market-health.ts";
import { HOLDER_CARD_SOURCE, HOLDER_GRANT_STATES, POSITION_PERMISSIONS } from "../../core/launch/holder.ts";
import { LAUNCH_CHART_MARKERS, LAUNCH_HOLDER_LABELS, LAUNCH_RISK_CODES, LAUNCH_TRADE_SIDES, LAUNCH_TRADE_VENUES } from "../../core/venues/meteora-dbc/market.ts";
import { LAUNCH_PRESET_IDS } from "../../core/venues/meteora-dbc/presets.ts";
import { ADVANCED_SUPPLIES, SNIPER_STRENGTHS, UNUSUAL_REASONS } from "../../core/launch/advanced.ts";
import { CURVE_RULES_SCOPE, CURVE_RULES_SIDE, CURVE_RULES_UPGRADE, CURVE_RULE_IDS, LOCKED_IN_RULE_IDS } from "../../core/launch/curve-rules.ts";
import { TRANSFER_FEE_MAX_BPS, TRANSFER_FEE_PHASES } from "../../core/launch/transfer-fee.ts";
import { QUOTE_ASSET_REFUSALS, QUOTE_CONFIG_VERSIONS } from "../../core/launch/quote-asset.ts";
import { BOOST_CURRENCIES, BOOST_ROUTES } from "../../core/launch/boost.ts";
import { EARLY_ACCESS_MODES, EARLY_ACCESS_PHASES, EARLY_ACCESS_TOKEN } from "../../core/launch/early-access.ts";
import { LaunchReceiptFactsSchema } from "../../core/venues/meteora-dbc/receipt.ts";
import { CLAIM_POCKET_STATES, CLAIM_POCKETS } from "../../core/launch/claim-review.ts";
import { CALCULATION_MODES, ELIGIBILITY_REASONS, SNAPSHOT_EXCLUSIONS } from "../../core/launch/distribution-audience.ts";
import { MET_LOCK_ACTORS } from "../../core/launch/distribution-merkle.ts";
import {
  CLAIM_STATES,
  DISTRIBUTION_PROTOCOLS,
  DISTRIBUTION_SCENARIOS,
  DISTRIBUTION_STAGES,
  DISTRIBUTION_WARNINGS,
  LEFTOVER_KINDS,
  PROTOCOL_REASONS,
  RECONCILE_STATES,
  VESTING_MAX_DAYS,
} from "../../core/launch/distribution.ts";
import { MINT_PROFILE_FIELDS } from "../../solana/mint-profile-fields.ts";
import { TRADE_KINDS, TRADE_RISK_FACTS, TRADE_RISK_NETWORKS } from "../../solana/trade-risk.ts";
import { SURVIVAL_HORIZONS_DAYS, SURVIVAL_STATES, SURVIVAL_WINDOW_DAYS } from "../../core/launch/survival-stats.ts";
import { CREW_MAX_MEMBERS, CREW_MEMBER_STATES, CREW_MIN_BPS, CREW_MIN_MEMBERS, CREW_PRESETS } from "../../core/launch/crew.ts";
import { EVENING_WINDOW_HOUR_UTC, EVENING_WINDOW_MINUTES, HOURLY_WINDOW_MINUTES, WINDOW_KINDS } from "../../core/launch/windows.ts";
import { TEAM_GRANTS, TEAM_JOURNAL_ACTIONS, TEAM_KINDS, TEAM_MEMBER_STATUSES, TEAM_PERMISSIONS, TEAM_REFUSALS, TEAM_RISKS, TEAM_ROLES } from "../../core/team/roles.ts";
import {
  DEV_ACTIONS,
  DEV_CREDENTIAL_KINDS,
  DEV_DELIVERY_ID,
  DEV_ENDPOINT_ID,
  DEV_ENVIRONMENTS,
  DEV_KEY_ID,
  DEV_KEY_STATES,
  DEV_LIMITS,
  DEV_PLAN_FIELDS,
  DEV_PROJECT_ID,
  DEV_QUOTA_WINDOWS,
  DEV_SCOPES,
  DEV_WEBHOOK_EVENTS,
} from "../../core/developer/console.ts";
import { CONSTITUTION_ENFORCEMENT } from "../../core/launch/constitution.ts";
import {
  ALLOCATION_CATEGORIES,
  ALLOCATION_MAX_DAYS,
  ALLOCATION_TOTAL_PCT,
  TEAM_LAUNCH_PROBLEMS,
  TEAM_LAUNCH_STEP_KEYS,
} from "../../core/launch/team-launch.ts";
import { EVENT_FINALITY, EVENT_FLAGS, EVENT_KINDS, EVENT_SOURCES, EVENT_UNSTATED, EVENT_VENUES, EVENTS_MAX, SUSPICION_REASONS } from "../../events/market-events.ts";

export const API_MAJOR = 1;
export const API_CONTRACT_VERSION = "1.86.0";
export const API_HEADER = "X-Ryntra-API";
export const API_VERSION_HEADER = "X-Ryntra-API-Version";
export const NETWORK = "solana:mainnet";

/** The oldest native client this contract still serves. */
export const MINIMUM_APP_VERSION = { android: "1.0.0" } as const;

export const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const Address = z.string().regex(BASE58);
const Iso = z.string().datetime({ offset: true });
const Semver = z.string().regex(/^\d+\.\d+\.\d+$/);

/* ------------------------------------------------------------ errors */

export const ERROR_CODES = [
  "VALIDATION_ERROR",
  "UNSUPPORTED_API",
  "UNSUPPORTED_CLIENT",
  "RATE_LIMITED",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NONCE_INVALID",
  "SIGNATURE_INVALID",
  "SESSION_EXPIRED",
  "SESSION_REVOKED",
  "WALLET_MISMATCH",
  "CAPABILITY_UNAVAILABLE",
  "UNAVAILABLE",
  /* 1.1.0 — plans */
  /** The rules do not make a plan; `issues` names each field. */
  "PLAN_INVALID",
  /** The mint is neither a confirmed stock representation nor a verified, tradable token of the catalogue (1.7.0), so no plan can name it. */
  "ASSET_UNCONFIRMED",
  "PLAN_NOT_FOUND",
  /** `ifVersion` is not the plan's current version: somebody else edited it; re-read and decide again. */
  "PLAN_VERSION_CONFLICT",
  /** The plan's status refuses the action (an executed plan is not edited, a cancelled one not activated). */
  "PLAN_STATE_REFUSED",
  /* 1.3.0 — the Review on the order route */
  /** The plan's version refuses this order: a required check failed or is unknown; `planReview` names each one. */
  "PLAN_REVIEW_BLOCKED",
  /* 1.8.0 — the agent */
  /** No session of the proven wallet has that id. */
  "AGENT_SESSION_NOT_FOUND",
  /** No draft of the proven wallet has that id (a draft is kept for a bounded time). */
  "AGENT_DRAFT_NOT_FOUND",
  /** The wallet's daily or monthly allowance, or the deployment's ceiling, is spent; `message` says which and when it resets. */
  "AGENT_BUDGET_EXHAUSTED",
  /** A question of this wallet is being answered right now; ask again when it is done. */
  "AGENT_BUSY",
  /* 1.52.0 — the assistant's credits */
  /** The welcome credits were already given to this wallet or its account. */
  "WELCOME_TAKEN",
  /** The wallet is younger or quieter than the welcome check asks; the free credits of every day are its anyway. */
  "WELCOME_NOT_ELIGIBLE",
  /* 1.54.0 — buying credits */
  /** No credit order of the proven wallet has that id. */
  "CREDIT_ORDER_NOT_FOUND",
  /* 1.57.0 — token watches */
  /** No watch of the proven wallet has that id. */
  "WATCH_NOT_FOUND",
  /** Three watches are free and that is the ceiling for now: remove one first (pause is not remove). */
  "WATCH_LIMIT_REACHED",
  /** `ifVersion` is not the watch's current version: it changed meanwhile; read again and decide again. */
  "WATCH_VERSION_CONFLICT",
  /* 1.59.0: «Забути» a note this wallet's memory does not hold (AI-18). */
  "MEMORY_NOTE_NOT_FOUND",
  /** A note or «Про мене» that looks like a key, a password or a recovery phrase: never kept. */
  "MEMORY_SECRET_REFUSED",
  /* 1.59.0 — «Доручення» (AI-19) */
  /** No task of the proven wallet has that id. */
  "TASK_NOT_FOUND",
  /** Five tasks a wallet: remove one first (pause is not remove). */
  "TASK_LIMIT_REACHED",
  /** The tasks together would run more times a day than this deployment allows (`runs.cap`): a slower rhythm, or pause one. */
  "TASK_RUNS_CAP",
  /** `ifVersion` is not the task's current version: it changed meanwhile (a run, another tab); read it again. */
  "TASK_VERSION_CONFLICT",
  /** `acceptCredits` is not the price of a run now: read the price again before turning the task on. */
  "TASK_PRICE_NOT_SHOWN",
  /* 1.61.0 — the trade plan and its critic */
  /** No assistant plan of the proven wallet has that id. */
  "ASSISTANT_PLAN_NOT_FOUND",
  /** `ifVersion` is not the plan's current version: it changed meanwhile; read again and decide again. */
  "ASSISTANT_PLAN_VERSION_CONFLICT",
  /** The plan's state refuses the action — a plan already approved is changed on its own page, an ended one not at all. */
  "ASSISTANT_PLAN_STATE_REFUSED",
  /* 1.64.0 — voice heard on the server (AI-08) */
  /** Over two minutes, heavier than its length allows, or longer than it says: not heard, nothing charged. */
  "VOICE_TOO_LONG",
  /** No words were heard in the recording; nothing was charged. */
  "VOICE_NOT_HEARD",
  /** `acceptCredits` is not the price of hearing this recording now: read `prices.voice` again before sending it. */
  "VOICE_PRICE_NOT_SHOWN",
  /** The deployment's day of voice heard on the server is spent; the browser's own recognition and typing still work. */
  "VOICE_DAY_SPENT",
  /** The credits' day's spending cap is reached (`dailySpend`): it starts again at `resetsAt`. Buying more does not lift it. */
  "CREDITS_DAY_CAP",
  /* 1.12.0 — autoinvest rules */
  /** No rule of the proven wallet has that id. */
  "RULE_NOT_FOUND",
  /** The wallet already holds as many rules as a wallet may; pause is not delete — remove one first. */
  "RULE_LIMIT_REACHED",
  /** 1.31.0: the token stands below the floor a rule names a token of the venue's list on — its liquidity or its age; the message says which. */
  "RULE_LIQUIDITY_LOW",
  /* 1.21.0 — «Ryntra попередить» */
  /** «Ryntra попередить» warns through a channel: connect Telegram first. */
  "CHANNEL_REQUIRED",
  /** No price of the token observed within half an hour: the loss limit cannot be counted now. */
  "PRICE_UNAVAILABLE",
  /* 1.22.0 — «Гроші» */
  /** The amount is not one the token can hold: more decimals than the mint has, zero, or not a number. */
  "AMOUNT_INVALID",
  /** The mint could not be read from the chain, or the account is not a mint. */
  "MINT_UNREADABLE",
  /** No payment link has that id. */
  "PAY_LINK_NOT_FOUND",
  /* 1.25.0 — Ryntra Launch */
  /** This deployment does not serve Launch: `capabilities.launch` is absent. */
  "LAUNCH_UNAVAILABLE",
  /** The name or ticker reads as a known brand or person; the message names them. */
  "LAUNCH_NAME_BORROWED",
  /** The picture is not a PNG, JPEG, WebP or GIF, or is above the size the presets' limits name. */
  "LAUNCH_IMAGE_INVALID",
  /** 1.71.0: the picture was refused — Ryntra took it down before, or its check reads it as sexual, violent, graphic or self-harm. */
  "LAUNCH_IMAGE_REFUSED",
  /** 1.71.0: the picture could not be checked right now; nothing was stored — try again. */
  "LAUNCH_IMAGE_CHECK_UNAVAILABLE",
  /** 1.71.0: on Micro and the demo market a first purchase and its lock are one v1 transaction; this request did not ask for v1. */
  "LAUNCH_WALLET_V1_REQUIRED",
  /** The wallet has launched as many tokens today as one wallet may. */
  "LAUNCH_LIMIT",
  /** Launch is paused on Ryntra's side — all of it, or new launches alone; nothing was built or sent. */
  "LAUNCH_PAUSED",
  /** 1.50.0 — too many launches went out on the network this hour; nothing was sent; try again later. */
  "LAUNCH_BUSY",
  /** 1.73.0 (SOL-L12) — the pair currency's issuer changed its token's rules since Ryntra first read it; launches on it wait for Ryntra's check; nothing was built. */
  "LAUNCH_QUOTE_PAUSED",
  /** The first purchase would receive more than the preset's cap. */
  "LAUNCH_FIRST_BUY_ABOVE_CAP",
  /** The build waited too long for the signature; build again. */
  "LAUNCH_BUILD_EXPIRED",
  /** This build was already submitted. */
  "LAUNCH_BUILD_USED",
  /** The signed bytes are not the built ones, or a signature is missing or wrong; nothing was sent. */
  "LAUNCH_SIGNED_OTHER_BYTES",
  /** The network did not confirm the creation; the message says why. */
  "LAUNCH_SUBMIT_FAILED",
  /** No launch, build or metadata by that id here. */
  "LAUNCH_NOT_FOUND",
  /* 1.27.0 — a launch's market and trading on it */
  /** The wallet does not hold what the trade would spend. */
  "LAUNCH_BALANCE_LOW",
  /** The curve is full and the token is moving to its pool; trading opens there. */
  "LAUNCH_GRADUATING",
  /** The price moved past the trade's slippage before it landed — the program refused it; nothing moved. */
  "LAUNCH_SLIPPAGE",
  /* 1.29.0 — the creator's cabinet */
  /** The sharing of the creator's fees does not hold: only «Спільнота», the creator among two to five wallets, whole basis points of at least 100 adding up to 10 000. */
  "LAUNCH_SHARES_INVALID",
  /** No source holds a fee for this wallet now; nothing was built. */
  "LAUNCH_NOTHING_TO_CLAIM",
  /** 1.72.0 (SOL-L10): the launch's token takes no fee on transfers. */
  "LAUNCH_NO_TRANSFER_FEE",
  /* 1.33.0 — a holder's position in the pool */
  /** Entering the pool is not open to this wallet yet; nothing was built. */
  "LAUNCH_HOLDER_CLOSED",
  /** The token is still on its curve: its pool opens when it reaches the DEX. */
  "LAUNCH_NOT_GRADUATED",
  /** 1.81.0 (MOS-2): Team Launch is not open on this deployment, or not to this wallet — the owner's own canary and whitelist first. Nothing was built. */
  "LAUNCH_TEAM_CLOSED",
  /* 1.75.0 — a team's roles and rights (TEAM-1) */
  /** No such team for this wallet — the same answer whether the team is not there or the wallet is not in it. */
  "TEAM_NOT_FOUND",
  /** The member's role does not hold this right, or does not keep this member's place. */
  "TEAM_FORBIDDEN",
  /** A limit of the team or of the wallet: members of a team, teams made, teams a wallet is in. */
  "TEAM_LIMIT",
  /** The wallet is already in the team or invited, or already holds what was asked. */
  "TEAM_MEMBER_EXISTS",
  /** The last active Owner neither leaves nor is demoted: ownership passes first. */
  "TEAM_LAST_OWNER",
  /** The team changed while this was decided, three times over; read it again. */
  "TEAM_CHANGED",
  /** Not a Squads v4 multisig on this network, or the operator's wallet is not one of its members. */
  "TEAM_TREASURY_REFUSED",
  /* 1.86.0 — the developer console (DEV-2) */
  /** No such project, key or endpoint for this wallet — the same answer whether it is not there or the wallet's team does not own it. */
  "DEV_NOT_FOUND",
  /** The member's role in the project's team does not hold the right this action needs. */
  "DEV_FORBIDDEN",
  /** A bound of the console: projects a team holds, live keys of one kind in one environment, endpoints a project holds. */
  "DEV_LIMIT",
  /** The project changed while this was decided, three times over; read it again. */
  "DEV_CHANGED",
  /** The credential on the request does not answer: unknown, revoked, past its rotation, or the wrong secret. */
  "DEV_KEY_INVALID",
  /** A secret key on a request that carries an Origin (a browser: never), or a public key from an origin it does not name. */
  "DEV_ORIGIN_REFUSED",
  /** The credential does not hold the scope this read needs. */
  "DEV_SCOPE_REFUSED",
  /** The project has spent a quota window whose number this deployment states; the answer says when it starts again. */
  "DEV_QUOTA_EXCEEDED",
] as const;
export type ApiErrorCode = (typeof ERROR_CODES)[number];

/**
 * 1.7.0: the stable ids a plan issue may carry beside its message, so a client
 * says the contradiction in its own words with the person's own figures.
 */
export const PLAN_ISSUE_CODES = [
  "INVALIDATION_NOT_BELOW_ENTRY",
  "MAX_PRICE_BELOW_ENTRY",
  "ENTRY_VALIDITY_OVER",
  "RESERVE_LEAVES_NOTHING",
  "RISK_ABOVE_BUDGET",
  "TARGET_NOT_ABOVE_ENTRY",
  "TIME_EXIT_IN_PAST",
  "TIME_EXIT_BEFORE_VALIDITY",
  "LOSS_PER_UNIT_NOT_POSITIVE",
  "SIZES_TO_NOTHING",
  "REFERENCE_NOT_ON_TOKEN",
  "DEVIATION_NOT_ON_TOKEN",
] as const;
export type PlanIssueCode = (typeof PLAN_ISSUE_CODES)[number];

export const ApiErrorIssueSchema = z
  .object({
    path: z.string().min(1).max(128),
    message: z.string().min(1).max(256),
    /** 1.7.0: a stable id for the rule that failed, where the server has one; absent on a schema refusal. */
    code: z.enum(PLAN_ISSUE_CODES).optional(),
  })
  .strict();

export const ApiErrorSchema = z
  .object({
    error: z
      .object({
        code: z.enum(ERROR_CODES),
        message: z.string().min(1).max(512),
        /** Only on `UNSUPPORTED_CLIENT`: the version the client needs. */
        minimumAppVersion: Semver.optional(),
        /** Only on `PLAN_INVALID`: every field that fails, so a form can mark each one. */
        issues: z.array(ApiErrorIssueSchema).min(1).max(32).optional(),
        /** Only on `PLAN_REVIEW_BLOCKED`: the Strategy block that refused, every check with what was expected and found. */
        planReview: z.lazy(() => PlanReviewSchema).optional(),
      })
      .strict(),
  })
  .strict();
export type ApiError = z.infer<typeof ApiErrorSchema>;

export const ERROR_STATUS: Readonly<Record<ApiErrorCode, number>> = {
  VALIDATION_ERROR: 400,
  UNSUPPORTED_API: 426,
  UNSUPPORTED_CLIENT: 426,
  RATE_LIMITED: 429,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NONCE_INVALID: 400,
  SIGNATURE_INVALID: 401,
  SESSION_EXPIRED: 401,
  SESSION_REVOKED: 401,
  WALLET_MISMATCH: 403,
  CAPABILITY_UNAVAILABLE: 503,
  UNAVAILABLE: 503,
  PLAN_INVALID: 400,
  ASSET_UNCONFIRMED: 422,
  PLAN_NOT_FOUND: 404,
  PLAN_VERSION_CONFLICT: 409,
  PLAN_STATE_REFUSED: 409,
  PLAN_REVIEW_BLOCKED: 409,
  AGENT_SESSION_NOT_FOUND: 404,
  AGENT_DRAFT_NOT_FOUND: 404,
  AGENT_BUDGET_EXHAUSTED: 429,
  AGENT_BUSY: 409,
  WELCOME_TAKEN: 409,
  WELCOME_NOT_ELIGIBLE: 403,
  CREDIT_ORDER_NOT_FOUND: 404,
  WATCH_NOT_FOUND: 404,
  WATCH_LIMIT_REACHED: 409,
  WATCH_VERSION_CONFLICT: 409,
  MEMORY_NOTE_NOT_FOUND: 404,
  MEMORY_SECRET_REFUSED: 400,
  TASK_NOT_FOUND: 404,
  TASK_LIMIT_REACHED: 409,
  TASK_RUNS_CAP: 409,
  TASK_VERSION_CONFLICT: 409,
  TASK_PRICE_NOT_SHOWN: 409,
  ASSISTANT_PLAN_NOT_FOUND: 404,
  ASSISTANT_PLAN_VERSION_CONFLICT: 409,
  ASSISTANT_PLAN_STATE_REFUSED: 409,
  VOICE_TOO_LONG: 413,
  VOICE_NOT_HEARD: 422,
  VOICE_PRICE_NOT_SHOWN: 409,
  VOICE_DAY_SPENT: 429,
  CREDITS_DAY_CAP: 429,
  RULE_NOT_FOUND: 404,
  RULE_LIMIT_REACHED: 409,
  RULE_LIQUIDITY_LOW: 422,
  CHANNEL_REQUIRED: 409,
  PRICE_UNAVAILABLE: 503,
  AMOUNT_INVALID: 400,
  MINT_UNREADABLE: 422,
  PAY_LINK_NOT_FOUND: 404,
  LAUNCH_UNAVAILABLE: 404,
  LAUNCH_NAME_BORROWED: 422,
  LAUNCH_IMAGE_INVALID: 422,
  LAUNCH_IMAGE_REFUSED: 422,
  LAUNCH_IMAGE_CHECK_UNAVAILABLE: 503,
  LAUNCH_WALLET_V1_REQUIRED: 422,
  LAUNCH_LIMIT: 429,
  LAUNCH_PAUSED: 503,
  LAUNCH_BUSY: 429,
  LAUNCH_QUOTE_PAUSED: 503,
  TEAM_NOT_FOUND: 404,
  TEAM_FORBIDDEN: 403,
  TEAM_LIMIT: 409,
  TEAM_MEMBER_EXISTS: 409,
  TEAM_LAST_OWNER: 409,
  TEAM_CHANGED: 409,
  TEAM_TREASURY_REFUSED: 422,
  LAUNCH_FIRST_BUY_ABOVE_CAP: 422,
  LAUNCH_BUILD_EXPIRED: 410,
  LAUNCH_BUILD_USED: 409,
  LAUNCH_SIGNED_OTHER_BYTES: 422,
  LAUNCH_SUBMIT_FAILED: 502,
  LAUNCH_NOT_FOUND: 404,
  LAUNCH_BALANCE_LOW: 422,
  LAUNCH_GRADUATING: 409,
  LAUNCH_SLIPPAGE: 409,
  LAUNCH_SHARES_INVALID: 422,
  LAUNCH_NOTHING_TO_CLAIM: 409,
  LAUNCH_NO_TRANSFER_FEE: 404,
  LAUNCH_HOLDER_CLOSED: 403,
  LAUNCH_NOT_GRADUATED: 409,
  LAUNCH_TEAM_CLOSED: 403,
  DEV_NOT_FOUND: 404,
  DEV_FORBIDDEN: 403,
  DEV_LIMIT: 409,
  DEV_CHANGED: 409,
  DEV_KEY_INVALID: 401,
  DEV_ORIGIN_REFUSED: 403,
  DEV_SCOPE_REFUSED: 403,
  DEV_QUOTA_EXCEEDED: 429,
};

/* ------------------------------------------------------------ capabilities */

/** 1.21.0: the presets «Ryntra попередить» offers — the published ones of the purchase with a loss limit. */
/** 1.22.0: how long a payment link stays open — the server clamps to these, never a free timestamp (`lib/pay/model.ts`). */
export const PAY_LINK_EXPIRATIONS = ["1h", "24h", "7d", "30d"] as const;
export const POSITION_WATCH_PRESETS_V1 = ["careful", "balanced"] as const;

export const MODULE_READINESS = ["available", "building", "planned"] as const;

/** The one submitter: the mode a client may use to execute. */
export const SIGNING_MODES = [
  /** The app signs the server-built transaction; the server submits and observes. Live. */
  "APP_SIGNS_SERVER_SUBMITS",
  /** The wallet signs-and-sends; the server adopts the one signature. Announced only when the adopt route exists. */
  "WALLET_SENDS_SERVER_ADOPTS",
] as const;
export type SigningMode = (typeof SIGNING_MODES)[number];

/**
 * 1.67.0 — the capability and authority matrix (EXE-1; spec §5.3, §6.1, §13.4): one row per venue × action, resolved
 * on this deployment. `state` is one of the seven honest states, said as a word on every surface; `automatic` is true
 * only with all seven elements of spec §6.1 — false on every row today.
 */
export const AUTHORITY_GATE_POSITIONS = ["OPEN", "CANARY", "DEVNET", "CLOSED", "NONE"] as const;
export const AuthorityRowV1Schema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+\.[a-z0-9-]+$/),
    venue: z.enum(AUTHORITY_VENUES),
    action: z.string().min(1).max(32),
    surface: z.enum(AUTHORITY_SURFACES),
    /** What the venue itself offers. */
    provider: z.enum(PROVIDER_STATUSES),
    /** How far Ryntra has built it; `PROVEN` — a full mainnet cycle is recorded (`evidence`). */
    readiness: z.enum(RYNTRA_READINESS),
    /** The honest state on this deployment: the row's ceiling narrowed by its switch. */
    state: z.enum(HONEST_STATES),
    /** Who may act right now. */
    eligibility: z.enum(ELIGIBILITY),
    /** Where the row's switch stands; the variable itself is not named. */
    gate: z.enum(AUTHORITY_GATE_POSITIONS),
    enforcement: z.enum(ENFORCEMENT_LEVELS),
    mode: z.enum(EXECUTION_MODES),
    signer: z.enum(SIGNERS),
    runsAlone: z.enum(RUNS_ALONE),
    network: z.enum(["mainnet", "devnet"]),
    automation: z.object(Object.fromEntries(AUTOMATION_ELEMENTS.map((element) => [element, z.boolean()])) as Record<(typeof AUTOMATION_ELEMENTS)[number], z.ZodBoolean>).strict(),
    automatic: z.boolean(),
    evidence: z.string().min(1).max(200).nullable(),
    notCovered: z.string().min(1).max(200).nullable(),
    note: z.string().min(1).max(200),
  })
  .strict();
export type AuthorityRowV1 = z.infer<typeof AuthorityRowV1Schema>;

export const AuthorityMatrixV1Schema = z
  .object({
    states: z.array(z.enum(HONEST_STATES)).length(HONEST_STATES.length),
    enforcement: z.array(z.enum(ENFORCEMENT_LEVELS)).length(ENFORCEMENT_LEVELS.length),
    modes: z.array(z.enum(EXECUTION_MODES)).length(EXECUTION_MODES.length),
    rows: z.array(AuthorityRowV1Schema).min(1),
  })
  .strict();
export type AuthorityMatrixV1 = z.infer<typeof AuthorityMatrixV1Schema>;

export const CapabilitiesSchema = z
  .object({
    api: z
      .object({
        major: z.literal(API_MAJOR),
        contractVersion: Semver,
        /** Majors this deployment still serves, oldest first. */
        supportedMajors: z.array(z.number().int().min(1)).min(1),
        /** ISO date after which the oldest listed major may stop being served; null when none is announced. */
        sunsetOf: z.record(z.string(), Iso).nullable(),
      })
      .strict(),
    minimumAppVersion: z.object({ android: Semver }).strict(),
    network: z.literal(NETWORK),
    /** The product registry, projected: every module with its readiness and the route family behind it. */
    modules: z.array(
      z
        .object({
          id: z.string().min(1).max(32),
          group: z.string().min(1).max(32),
          readiness: z.enum(MODULE_READINESS),
          /** Route prefixes a client of this module calls; empty for a module that has no API yet. */
          routes: z.array(z.string().min(1).max(128)),
        })
        .strict(),
    ),
    signing: z
      .object({
        modes: z.array(z.enum(SIGNING_MODES)).min(1),
        /** True once `/api/v1/executions/adopt` exists; false is honest today. */
        adoptSignature: z.boolean(),
      })
      .strict(),
    auth: z
      .object({
        challenge: z.literal("/api/v1/auth/challenge"),
        verify: z.literal("/api/v1/auth/verify"),
        session: z.literal("/api/v1/auth/session"),
        refresh: z.literal("/api/v1/auth/refresh"),
        /** Seconds a session lives from issuance; refresh reissues for the same span while it is valid. */
        sessionTtlSeconds: z.number().int().positive(),
        /** Seconds a challenge stays signable. */
        challengeTtlSeconds: z.number().int().positive(),
      })
      .strict(),
    watchlist: z.object({ limit: z.number().int().positive(), merge: z.literal("/api/v1/watchlist/merge") }).strict(),
    /** The plan routes (1.2.0): the list route, how many plans a list carries at most, how many versions a plan keeps; 1.7.0: the asset read that resolves any mint the way a create will. */
    plans: z
      .object({
        list: z.literal("/api/v1/plans"),
        limit: z.number().int().positive(),
        versionsLimit: z.number().int().positive(),
        /** 1.7.0: `GET …?mint=` answers the plan asset, the planning price now and the catalogue's liquidity, or `ASSET_UNCONFIRMED`. */
        asset: z.literal("/api/v1/plans/asset").optional(),
        /** 1.7.0: the kinds of asset a plan may name on this deployment. */
        assetKinds: z.array(z.enum(["stock", "crypto", "meme"])).min(1).optional(),
        /** 1.9.0: Plan vs Actual across the wallet's plans, with the no-trade outcomes and the positions. */
        results: z.literal("/api/v1/plans/results").optional(),
        /** 1.9.0: the wallet's strategy memory — facts derived from its own records, each carrying its citations. */
        memory: z.literal("/api/v1/plans/memory").optional(),
      })
      .strict(),
    /** 1.7.0: whether the server's push provider is configured — a phone registered into silence can say so honestly. */
    push: z.object({ provider: z.enum(["configured", "absent"]) }).strict().optional(),
    /** 1.12.0: «Автоінвест» — the rules route, how many rules a wallet may hold, the cadences, the least a purchase is, and how long a reminder stays open before it is missed. */
    rules: z
      .object({
        list: z.literal("/api/v1/rules"),
        limit: z.number().int().positive(),
        cadences: z.array(z.enum(SCHEDULE_CADENCES)).min(1),
        minimumUsd: z.number().positive(),
        maximumUsd: z.number().positive(),
        reminderHours: z.number().int().positive(),
        /** 1.13.0: the kinds of rule this deployment writes — «Регулярно» and «Якщо впаде»; 1.19.0: and «З кожної оплати». */
        kinds: z.array(z.enum(["schedule", "dip", "payments"])).min(1).optional(),
        /** 1.13.0: how far below its reference point a «Якщо впаде» rule may wait for the price, in whole per cent. */
        dip: z.object({ minPct: z.number().int().positive(), maxPct: z.number().int().positive() }).strict().optional(),
        /** 1.13.0: the month's budget route and its bounds. */
        budget: z.object({ route: z.literal("/api/v1/rules/budget"), minimumUsd: z.number().positive(), maximumUsd: z.number().positive() }).strict().optional(),
        /** 1.18.0: «Умова ціни» — the limit a new rule opens on, its bounds in whole per cent, and how old, in minutes, the price and its reference may be. */
        priceCondition: z
          .object({ defaultPct: z.number().int().positive(), minPct: z.number().int().positive(), maxPct: z.number().int().positive(), maxAgeMinutes: z.number().int().positive() })
          .strict()
          .optional(),
        /** 1.19.0: «З кожної оплати» — the modes, the round-up steps, the fixed sum's and the per cent's bounds, how many events a rule shows, and the route that names an account as the person's own. */
        payments: z
          .object({
            modes: z.array(z.enum(RULE_PAYMENT_MODES)).min(1),
            roundToUsd: z.array(z.number().positive()).min(1),
            fixedMinUsd: z.number().positive(),
            fixedMaxUsd: z.number().positive(),
            percentMin: z.number().int().positive(),
            percentMax: z.number().int().positive(),
            eventsKept: z.number().int().positive(),
            ownAccount: z.literal("/api/v1/rules/payments/own"),
          })
          .strict()
          .optional(),
        /** 1.31.0: what a rule may name — a company, a coin, a meme or a new token — the floor a token of the venue's list stands on, and the route that reads a token's standing before a rule is written. */
        assets: z
          .object({
            classes: z.array(z.enum(RULE_ASSET_CLASSES)).min(1),
            floor: z.object({ liquidityUsd: z.number().positive(), ageHours: z.number().int().positive() }).strict(),
            read: z.literal("/api/v1/rules/asset"),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    /** The referral account fees land in — public, so a client can name the rule; null when unconfigured. */
    attribution: z.object({ referralAccount: Address.nullable(), stats: z.literal("/api/stats") }).strict(),
    /** 1.5.0: the evidence route, the provider behind it, the windows and the metric registry a condition may name; 1.6.0: every provider, and the address route. */
    research: z
      .object({
        evidence: z.literal("/api/v1/research/evidence"),
        /** The first provider (the market one); 1.6.0 lists them all in `providers`. */
        provider: z.enum(EVIDENCE_PROVIDERS),
        /** The attribution the first provider's terms require beside its figures. */
        attribution: z.object({ text: z.string().min(1).max(64), href: z.string().url() }).strict(),
        windows: z.array(z.enum(EVIDENCE_WINDOWS)).min(1),
        metrics: z.array(z.lazy(() => EvidenceMetricDefinitionSchema)).min(1),
        /** How many conditions one plan version may carry. */
        conditionsLimit: z.number().int().positive(),
        /** 1.6.0: every provider behind the route, its attribution and the windows it serves. */
        providers: z
          .array(
            z
              .object({
                provider: z.enum(EVIDENCE_PROVIDERS),
                attribution: z.object({ text: z.string().min(1).max(64), href: z.string().url() }).strict(),
                windows: z.array(z.enum(EVIDENCE_WINDOWS)).min(1),
              })
              .strict(),
          )
          .min(1)
          .optional(),
        /** 1.6.0: the recipient check before a transfer. */
        addressEvidence: z.literal("/api/v1/research/address-evidence").optional(),
        /** 1.65.0: a `.skr` name to its address and an address to its name (SKR-4). */
        skrName: z.literal("/api/v1/research/skr-name").optional(),
        /** 1.68.0: «Події ринку» — one feed of what happened on Solana's markets, each event with its source and its transaction (DSC-1). */
        events: z.literal("/api/v1/events").optional(),
      })
      .strict(),
    /** 1.8.0: Ryn, the agent — its routes, whether a model composes the words here, and the boundary said as a fact. */
    agent: z
      .object({
        session: z.literal("/api/v1/agent/session"),
        message: z.literal("/api/v1/agent/message"),
        drafts: z.literal("/api/v1/agent/drafts"),
        budget: z.literal("/api/v1/agent/budget"),
        suggestions: z.literal("/api/v1/agent/suggestions"),
        /** 1.10.0: the two formats on a subject — the same engine, the same budget, never a second one. */
        brief: z.literal("/api/v1/agent/brief").optional(),
        critic: z.literal("/api/v1/agent/critic").optional(),
        /** `configured`: a model composes the words of an answer; `absent`: every answer is composed deterministically from the same reads. */
        model: z.enum(["configured", "absent"]),
        /** What the agent may do — read, prepare — and the one thing it never does; a client may print it as it stands. */
        tools: z.object({ research: z.array(z.string().min(1).max(48)).min(1), prepare: z.array(z.string().min(1).max(48)).min(1), execute: z.literal(false) }).strict(),
        /** The sections every substantive answer carries, in order. */
        answerSections: z.array(z.enum(["observation", "meaning", "counter", "risks", "checks", "actions"])).length(6),
        /** 1.10.0: the sections a Brief carries, in order. */
        briefSections: z.array(z.enum(["changed", "matters", "supports", "unknown", "checks"])).length(5).optional(),
        /** 1.10.0: the kinds a Critic finding may be; none of them carries a direction. */
        criticKinds: z.array(z.enum(["assumption-conflict", "risk-not-established", "plan-condition-unmet", "previous-result", "evidence-missing", "asset-structure", "thesis-weakness"])).length(7).optional(),
        /** How many characters one question may carry, and how many turns a session keeps. */
        limits: z.object({ questionChars: z.number().int().positive(), turnsKept: z.number().int().positive() }).strict(),
      })
      .strict()
      .optional(),
    /** 1.20.0: «Популярне» — the route, and how many companies it answers by default and at most. «Перевірка» travels as `check` on the swap's quote and order. */
    stocks: z
      .object({ popular: z.literal("/api/v1/stocks/popular"), popularLimit: z.number().int().positive(), popularMaxLimit: z.number().int().positive() })
      .strict()
      .optional(),
    /** 1.21.0: Нагляд over positions — the routes, the presets «Ryntra попередить» offers, and the thresholds the states are judged by. */
    positions: z
      .object({
        list: z.literal("/api/v1/positions"),
        watch: z.literal("/api/v1/positions/watch"),
        presets: z.array(z.object({ id: z.enum(POSITION_WATCH_PRESETS_V1), stopPct: z.number().int().positive(), targetPct: z.number().int().positive() }).strict()).min(1),
        states: z.array(z.enum(WATCH_STATES)).min(1),
        /** Within this per cent of the price above the loss limit, a position reads «Увага». */
        nearLimitPct: z.number().positive(),
        /** Above the exchange by more than this per cent, a position reads «Увага». */
        aboveExchangePct: z.number().positive(),
        /** A price older than this many minutes decides nothing. */
        priceMaxAgeMinutes: z.number().int().positive(),
        /** 1.23.0: «Ризик портфеля» — its route, and the caps it judges: one asset (from a wallet of `capsFromUsd`) and the private companies together (at any size). */
        risk: z.literal("/api/v1/positions/risk").optional(),
        assetCapPct: z.number().int().positive().optional(),
        privateCapPct: z.number().int().positive().optional(),
        capsFromUsd: z.number().int().positive().optional(),
      })
      .strict()
      .optional(),
    /** 1.22.0: «Гроші» — the payment links and their bounds, the recipient check, the reading of what the wallet returned, and the transfer routes Send runs on. */
    money: z
      .object({
        payLinks: z.literal("/api/v1/pay/requests"),
        expirations: z.array(z.enum(PAY_LINK_EXPIRATIONS)).min(1),
        defaultExpiration: z.enum(PAY_LINK_EXPIRATIONS),
        /** The longest note a link may carry, in characters. */
        descriptionMax: z.number().int().positive(),
        /** How many links a list carries at most, newest first. */
        listLimit: z.number().int().positive(),
        recipient: z.literal("/api/v1/money/recipient"),
        returned: z.literal("/api/v1/money/send/returned"),
        /** The prefix of the transfer routes: `…/plan`, `…/adopt`, `…/settle`, `…/recover`. */
        transfer: z.literal("/api/solana/transfer"),
      })
      .strict()
      .optional(),
    /** 1.25.0: Ryntra Launch — present only where Launch is served, with the network it launches on. */
    launch: z
      .object({
        network: z.enum(["solana:devnet", "solana:mainnet"]),
        presets: z.literal("/api/v1/launch/presets"),
        metadata: z.literal("/api/v1/launch/metadata"),
        quote: z.literal("/api/v1/launch/quote"),
        build: z.literal("/api/v1/launch/build"),
        submit: z.literal("/api/v1/launch/submit"),
        /** The token's read: `/api/v1/launch/{mint}`. */
        token: z.literal("/api/v1/launch/{mint}"),
        /* 1.27.0 — the token's market and trading on it. */
        market: z.literal("/api/v1/launch/{mint}/market"),
        wallet: z.literal("/api/v1/launch/{mint}/wallet/{address}"),
        tradeQuote: z.literal("/api/v1/launch/{mint}/trade/quote"),
        tradeBuild: z.literal("/api/v1/launch/{mint}/trade/build"),
        tradeSubmit: z.literal("/api/v1/launch/{mint}/trade/submit"),
        creator: z.literal("/api/v1/launch/{mint}/creator"),
        /* 1.29.0 — the creator's cabinet and «Забрати»; absent on a deployment before it. */
        creators: z.literal("/api/v1/launch/creators/{address}").optional(),
        claimBuild: z.literal("/api/v1/launch/{mint}/claim/build").optional(),
        claimSubmit: z.literal("/api/v1/launch/{mint}/claim/submit").optional(),
        /* 1.73.0 — «Забрати все»: the Review before the claim; absent on a deployment before it. */
        claimReview: z.literal("/api/v1/launch/{mint}/claim/review").optional(),
        /* 1.32.0 — the flight log and the Fee-Funded Liquidity Ladder; absent on a deployment before it. */
        journal: z.literal("/api/v1/launch/{mint}/journal").optional(),
        /* 1.33.0 — a holder's position in the pool; absent on a deployment before it. */
        holder: z.literal("/api/v1/launch/{mint}/holder/{address}").optional(),
        holderQuote: z.literal("/api/v1/launch/{mint}/holder/quote").optional(),
        holderBuild: z.literal("/api/v1/launch/{mint}/holder/build").optional(),
        holderSubmit: z.literal("/api/v1/launch/{mint}/holder/submit").optional(),
        holderPermissionBuild: z.literal("/api/v1/launch/{mint}/holder/permission/build").optional(),
        holderPermissionSubmit: z.literal("/api/v1/launch/{mint}/holder/permission/submit").optional(),
        holders: z.literal("/api/v1/launch/holders/{address}").optional(),
        /* 1.34.0 — a trade's receipt; absent on a deployment before it. */
        tradeReceipt: z.literal("/api/v1/launch/{mint}/trade/receipt").optional(),
        /* 1.36.0 — the markets launched on Ryntra, one market's card and its health; absent on a deployment before it. */
        markets: z.literal("/api/v1/launch/markets").optional(),
        marketCard: z.literal("/api/v1/launch/markets/{mint}").optional(),
        health: z.literal("/api/v1/launch/{mint}/health").optional(),
        /* 1.49.0 — a launch's figures for its creator's cabinet and the creator's public profile; absent on a deployment before it. */
        stats: z.literal("/api/v1/launch/{mint}/stats").optional(),
        profile: z.literal("/api/v1/launch/creators/{address}/profile").optional(),
        /** 1.55.0 — the survival of the markets launched on Ryntra at 7, 30 and 90 days (SOL-L3). */
        survival: z.literal("/api/v1/launch/survival").optional(),
        /** 1.56.0 — «Розширений»: the launch's own config, built and sent (SOL-L5). */
        advancedConfigBuild: z.literal("/api/v1/launch/advanced/config/build").optional(),
        advancedConfigSubmit: z.literal("/api/v1/launch/advanced/config/submit").optional(),
        /** 1.56.0 — Launch Boost: a token's creator campaign, its commitment and its payout (SOL-L5). */
        boost: z.literal("/api/v1/launch/{mint}/boost").optional(),
        boostBuild: z.literal("/api/v1/launch/{mint}/boost/build").optional(),
        boostSubmit: z.literal("/api/v1/launch/{mint}/boost/submit").optional(),
        boostPayoutBuild: z.literal("/api/v1/launch/{mint}/boost/payout/build").optional(),
        boostPayoutSubmit: z.literal("/api/v1/launch/{mint}/boost/payout/submit").optional(),
        /** 1.69.0 — the creator's split: the rule, the depth steps and the payout (SOL-L2b). */
        split: z.literal("/api/v1/launch/{mint}/split").optional(),
        splitRuleBuild: z.literal("/api/v1/launch/{mint}/split/rule/build").optional(),
        splitRuleSubmit: z.literal("/api/v1/launch/{mint}/split/rule/submit").optional(),
        splitDepthBuild: z.literal("/api/v1/launch/{mint}/split/depth/build").optional(),
        splitDepthSubmit: z.literal("/api/v1/launch/{mint}/split/depth/submit").optional(),
        splitPayoutBuild: z.literal("/api/v1/launch/{mint}/split/payout/build").optional(),
        splitPayoutSubmit: z.literal("/api/v1/launch/{mint}/split/payout/submit").optional(),
        /** 1.56.0 — early access: the launch built and sent, its read and a deposit (SOL-L5). */
        earlyAccessBuild: z.literal("/api/v1/launch/early-access/build").optional(),
        earlyAccessSubmit: z.literal("/api/v1/launch/early-access/submit").optional(),
        earlyAccess: z.literal("/api/v1/launch/{mint}/early-access").optional(),
        earlyAccessDepositBuild: z.literal("/api/v1/launch/{mint}/early-access/deposit/build").optional(),
        earlyAccessDepositSubmit: z.literal("/api/v1/launch/{mint}/early-access/deposit/submit").optional(),
        earlyAccessActionBuild: z.literal("/api/v1/launch/{mint}/early-access/action/build").optional(),
        earlyAccessActionSubmit: z.literal("/api/v1/launch/{mint}/early-access/action/submit").optional(),
      })
      .strict()
      .optional(),
    /** 1.67.0 — the capability and authority matrix (EXE-1); absent on a deployment before it. */
    authority: AuthorityMatrixV1Schema.optional(),
    observedAt: Iso,
  })
  .strict();
export type Capabilities = z.infer<typeof CapabilitiesSchema>;

/* ------------------------------------------------------------ evidence (1.5.0) */

export const EvidenceMetricWordsSchema = z.object({ label: z.string().min(1).max(64), meaning: z.string().min(1).max(240), sentence: z.string().min(1).max(64) }).strict();

/** One entry of the metric registry, as a client renders a picker or a sentence from it. */
export const EVIDENCE_UNITS = ["usd", "wallets", "percent", "count", "flag"] as const;

export const EvidenceMetricDefinitionSchema = z
  .object({
    id: z.enum(EVIDENCE_METRIC_IDS),
    /** 1.6.0: the provider whose read judges a condition on this figure; absent in 1.5.0 answers, where every figure was the first provider's. */
    provider: z.enum(EVIDENCE_PROVIDERS).optional(),
    unit: z.enum(EVIDENCE_UNITS),
    /** `whole-market`: the whole token as the source counts it; `cohort`: the subset of addresses the source labels — informs, never blocks. */
    aggregation: z.enum(["whole-market", "cohort"]),
    windows: z.array(z.enum(EVIDENCE_WINDOWS)).min(1),
    conditionModes: z.array(z.enum(["advisory", "required"])).min(1),
    words: z.object({ en: EvidenceMetricWordsSchema, uk: EvidenceMetricWordsSchema }).strict(),
  })
  .strict();
export type EvidenceMetricDefinitionDto = z.infer<typeof EvidenceMetricDefinitionSchema>;

/** The registry projected for the wire — the same table `lib/evidence/metrics.ts` owns. */
export function evidenceMetricDefinitions(): EvidenceMetricDefinitionDto[] {
  return EVIDENCE_METRICS.map((metric) => ({ id: metric.id, provider: metric.provider, unit: metric.unit, aggregation: metric.aggregation, windows: [...metric.windows], conditionModes: [...metric.conditionModes], words: metric.words }));
}

export const EvidenceMetricValueSchema = z
  .object({
    id: z.enum(EVIDENCE_METRIC_IDS),
    /** Null when the source answered without the figure — never zero in its place. */
    value: z.number().finite().nullable(),
    unit: z.enum(EVIDENCE_UNITS),
    window: z.enum(EVIDENCE_WINDOWS),
    coverage: z.enum(["full", "partial", "absent"]),
    note: z.string().max(240).nullable(),
  })
  .strict();

/** A permitted, attributed set of figures about one mint over one window, with its times stated separately. */
export const MarketEvidenceSnapshotSchema = z
  .object({
    provider: z.enum(EVIDENCE_PROVIDERS),
    subject: z.object({ network: z.literal(NETWORK), mint: Address, symbol: z.string().max(32).nullable() }).strict(),
    window: z.enum(EVIDENCE_WINDOWS),
    /** When Ryntra asked. */
    fetchedAt: Iso,
    /** The provider's own statement of when the data stands as of; null when it states none. */
    observedAt: Iso.nullable(),
    /** The provider's documented response cache, seconds — how far behind a fresh answer may already be. */
    providerLagSeconds: z.number().int().nonnegative(),
    /** After this the snapshot is not served from the cache and a required condition counts it stale. */
    expiresAt: Iso,
    metrics: z.array(EvidenceMetricValueSchema).min(1).max(32),
    warnings: z.array(z.string().max(240)).max(8),
    attribution: z.object({ text: z.string().min(1).max(64), href: z.string().url() }).strict(),
    rightsPolicy: z.string().min(1).max(64),
    families: z.array(z.string().min(1).max(64)).max(8),
  })
  .strict();
export type MarketEvidenceSnapshotDto = z.infer<typeof MarketEvidenceSnapshotSchema>;

/** The answer of `GET /api/v1/research/evidence`: a state, the snapshot when there is one, the reason when there is not, and where it was served from. */
export const MarketEvidenceReadSchema = z
  .object({
    state: z.enum(EVIDENCE_READ_STATES),
    snapshot: MarketEvidenceSnapshotSchema.nullable(),
    reason: z.string().max(240).nullable(),
    served: z.enum(["provider", "cache", "stale-cache", "none"]),
  })
  .strict();
export type MarketEvidenceReadDto = z.infer<typeof MarketEvidenceReadSchema>;

/* ------------------------------------------------------------ address evidence (1.6.0) */

/**
 * The recipient check (`GET /api/v1/research/address-evidence?address=`):
 * what the security provider says about one address before a transfer.
 * Sanctions in the source's own words (`clean` · `unknown` · `sanctioned`,
 * `unavailable` when it did not answer); findings as counts by the source's
 * severities with its own 0–100 figure and the band it documents for it;
 * `unsupported` for a kind of address the source does not read (a program,
 * a vault, a PDA) — never green. Ryntra never blocks a transfer on it.
 */
export const AddressEvidenceSchema = z
  .object({
    provider: z.enum(EVIDENCE_PROVIDERS),
    subject: z.object({ network: z.literal(NETWORK), address: Address, kind: z.enum(["wallet", "program", "unknown"]) }).strict(),
    fetchedAt: Iso,
    observedAt: Iso.nullable(),
    providerLagSeconds: z.number().int().nonnegative(),
    expiresAt: Iso,
    sanctions: z.object({ state: z.enum(SANCTIONS_STATES), related: z.boolean().nullable() }).strict(),
    findings: z
      .object({
        state: z.enum(FINDINGS_STATES),
        count: z.number().int().nonnegative().nullable(),
        high: z.number().int().nonnegative().nullable(),
        medium: z.number().int().nonnegative().nullable(),
        score: z.number().min(0).max(100).nullable(),
        band: z.enum(RISK_BANDS).nullable(),
      })
      .strict(),
    warnings: z.array(z.string().max(240)).max(8),
    attribution: z.object({ text: z.string().min(1).max(64), href: z.string().url() }).strict(),
    rightsPolicy: z.string().min(1).max(64),
    families: z.array(z.string().min(1).max(64)).max(8),
  })
  .strict();
export type AddressEvidenceDto = z.infer<typeof AddressEvidenceSchema>;

export const AddressEvidenceReadSchema = z
  .object({
    state: z.enum(EVIDENCE_READ_STATES),
    evidence: AddressEvidenceSchema.nullable(),
    reason: z.string().max(240).nullable(),
    served: z.enum(["provider", "cache", "stale-cache", "none"]),
  })
  .strict();
export type AddressEvidenceReadDto = z.infer<typeof AddressEvidenceReadSchema>;

/**
 * 1.65.0 — a `.skr` name (`GET /api/v1/research/skr-name`, SKR-4). With `name`: the address that owns it now, read
 * from the chain every time — never cached. With `address`: the wallet's primary name, cached an hour; with `self`
 * also the first name it holds when it chose none. `UNAVAILABLE` is «the chain did not answer», never «no name».
 */
export const SKR_NAME = /^[a-z0-9_-]{1,63}\.skr$/;
export const SkrNameReadSchema = z.discriminatedUnion("direction", [
  z
    .object({
      direction: z.literal("name"),
      state: z.enum(["FOUND", "NOT_FOUND", "UNAVAILABLE"]),
      name: z.string().regex(SKR_NAME),
      address: Address.nullable(),
    })
    .strict(),
  z
    .object({
      direction: z.literal("address"),
      state: z.enum(["FOUND", "NOT_FOUND", "UNAVAILABLE"]),
      address: Address,
      name: z.string().regex(SKR_NAME).nullable(),
      /** `primary`: the name the wallet chose; `owned`: the first of the names it holds (only with `self`). */
      source: z.enum(["primary", "owned"]).nullable(),
    })
    .strict(),
]);
export type SkrNameReadDto = z.infer<typeof SkrNameReadSchema>;

/* ------------------------------------------------------------ auth */

export const CHALLENGE_TTL_SECONDS = 300;
export const NATIVE_SESSION_TTL_SECONDS = 24 * 3600;
/** Distinct from every web nonce context, so a native challenge is never accepted by a web route and vice versa. */
export const NATIVE_NONCE_CONTEXT_PREFIX = "native:v1:";

export const ClientSchema = z
  .object({
    platform: z.literal("android"),
    appVersion: Semver,
    /** The app's package name, so a session records which build asked. */
    package: z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/).max(128).optional(),
  })
  .strict();
export type ApiClient = z.infer<typeof ClientSchema>;

export const ChallengeRequestSchema = z
  .object({
    address: Address,
    locale: z.enum(["en", "uk"]).default("en"),
    client: ClientSchema,
  })
  .strict();
export type ChallengeRequest = z.input<typeof ChallengeRequestSchema>;

export const SiwsInputSchema = z
  .object({
    domain: z.string().min(1),
    address: Address,
    statement: z.string().min(1),
    uri: z.string().url(),
    version: z.literal("1"),
    chainId: z.literal(NETWORK),
    nonce: z.string().min(16).max(128),
    issuedAt: Iso,
    expirationTime: Iso,
  })
  .strict();

export const ChallengeResponseSchema = z
  .object({
    /** The `solana:signIn` input; a wallet that builds the message from it produces exactly `message`. */
    input: SiwsInputSchema,
    /** The exact text to sign with `signMessage` when `signIn` is not offered. */
    message: z.string().min(1).max(4096),
    nonce: z.string().min(16).max(128),
    expiresAt: Iso,
  })
  .strict();
export type ChallengeResponse = z.infer<typeof ChallengeResponseSchema>;

export const VerifyRequestSchema = z
  .object({
    address: Address,
    /** base64 of the exact bytes the wallet signed. */
    signedMessage: z.string().min(16).max(8192),
    /** base64 of the 64-byte Ed25519 signature. */
    signature: z.string().min(80).max(96),
    client: ClientSchema,
  })
  .strict();
export type VerifyRequest = z.input<typeof VerifyRequestSchema>;

export const SessionSchema = z
  .object({
    id: z.string().min(8).max(64),
    address: Address,
    network: z.literal(NETWORK),
    issuedAt: Iso,
    expiresAt: Iso,
  })
  .strict();
export type ApiSession = z.infer<typeof SessionSchema>;

export const VerifyResponseSchema = z
  .object({
    tokenType: z.literal("Bearer"),
    /** Opaque; sent as `Authorization: Bearer …`; kept in secure storage, never in a cookie or a log. */
    accessToken: z.string().min(16).max(1024),
    session: SessionSchema,
  })
  .strict();
export type VerifyResponse = z.infer<typeof VerifyResponseSchema>;

export const SessionResponseSchema = z.object({ session: SessionSchema }).strict();
export type SessionResponse = z.infer<typeof SessionResponseSchema>;

/* ---- 1.66.0 — «Перевірено Seeker» (SKR-3, line A) */

/** One Seeker Genesis Token the proven wallet holds. */
export const SeekerTokenSchema = z
  .object({
    mint: Address,
    /** Its place in the SGT group, a decimal string (a u64 on chain). */
    memberNumber: z.string().regex(/^\d{1,20}$/),
  })
  .strict();
export type SeekerToken = z.infer<typeof SeekerTokenSchema>;

/**
 * `GET /api/v1/auth/seeker` — whether the proven wallet holds a Seeker Genesis Token, read on mainnet by the server.
 * The same answer for the web (the cookie) and the phone (the bearer).
 */
export const SeekerCheckResponseSchema = z
  .object({
    /** The wallet the session proved by signature — never one a client names. */
    address: Address,
    /** «Перевірено Seeker»: at least one SGT on this address when it was read. */
    verified: z.boolean(),
    /** Every SGT on the address, by member number; empty when `verified` is false. */
    tokens: z.array(SeekerTokenSchema).max(100),
    network: z.literal(NETWORK),
    /** When the chain was read; the server keeps a found answer an hour and «none» five minutes. */
    checkedAt: Iso,
  })
  .strict();
export type SeekerCheckResponse = z.infer<typeof SeekerCheckResponseSchema>;

export const RevokeResponseSchema = z.object({ revoked: z.literal(true) }).strict();

/* ------------------------------------------------------------ watchlist */

export const WATCHLIST_LIMIT = 200;

export const WatchlistResponseSchema = z
  .object({
    address: Address,
    mints: z.array(Address).max(WATCHLIST_LIMIT),
    /** The server list's version; sent back on a put so a lost update is refused, not silently overwritten. */
    version: z.number().int().min(0),
    updatedAt: Iso.nullable(),
  })
  .strict();
export type WatchlistResponse = z.infer<typeof WatchlistResponseSchema>;

export const WatchlistPutRequestSchema = z
  .object({
    address: Address,
    mints: z.array(Address).max(WATCHLIST_LIMIT),
    /** The version the client last read; omit to overwrite unconditionally. */
    ifVersion: z.number().int().min(0).optional(),
  })
  .strict();

export const WatchlistMergeRequestSchema = z
  .object({
    address: Address,
    /** The device's list, oldest first. */
    mints: z.array(Address).max(WATCHLIST_LIMIT),
    /** Mints the device removed since `syncedAt` (or ever, on a first sign-in); they leave the server list. */
    removed: z.array(Address).max(WATCHLIST_LIMIT).default([]),
    /** When the device last took the server's answer; null on the first sign-in of this wallet on this device. */
    syncedAt: Iso.nullable(),
  })
  .strict();
export type WatchlistMergeRequest = z.input<typeof WatchlistMergeRequestSchema>;

export const WatchlistMergeResponseSchema = z
  .object({
    address: Address,
    /** The merged list the device keeps: the server's order first, then the device's additions in the device's order. */
    mints: z.array(Address).max(WATCHLIST_LIMIT),
    /** Device mints that did not fit under the limit — named, so the device keeps them as its own and says so. */
    notKept: z.array(Address),
    /** Device mints the server had removed after `syncedAt`; not re-added, named so the device drops them. */
    droppedByServer: z.array(Address),
    version: z.number().int().min(0),
    syncedAt: Iso,
  })
  .strict();
export type WatchlistMergeResponse = z.infer<typeof WatchlistMergeResponseSchema>;

/* ------------------------------------------------------------ plans (1.1.0) */

/**
 * Trading Plan v1.
 *
 * Spot-long only, without leverage: the person buys a confirmed stock
 * representation with their own USD and states, before the Review, the rules
 * they will be checked against. Every edit is a new **version**; an execution
 * is bound to the version that existed before the signature and a later edit
 * never rewrites it. Prices are USD per **underlying share** — the unit the
 * reference is in and the size-aware quote is stated in — so the multiplier
 * of a Token-2022 mint is applied once, by the quote, never by the plan.
 *
 * `sizing` is computed by the server from the rules and stored on the
 * version; it is a planning model under stated assumptions, never a
 * guaranteed maximum loss: gaps, slippage, missing liquidity or a missed
 * manual exit change what is lost. The client shows the assumptions.
 */

export const PLAN_STATUSES = ["draft", "active", "executed", "cancelled", "expired"] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];
/** v1 plans one side. */
export const PLAN_SIDES = ["BUY"] as const;
export const PLAN_LIST_LIMIT = 50;
export const PLAN_VERSIONS_LIMIT = 100;
export const PLAN_JOURNAL_LIMIT = 200;
export const PLAN_EXECUTIONS_LIMIT = 50;
export const PLAN_THESIS_MAX = 2000;
export const PLAN_ID = /^plan_[0-9a-f]{32}$/;

const Usd = z.number().finite().positive().max(1_000_000_000);
const UsdOrZero = z.number().finite().min(0).max(1_000_000_000);
const Units = z.number().finite().min(0).max(1_000_000_000_000);
const Note = z.string().max(240);
const Url = z.string().url().max(512);

/** 1.7.0: what a plan's asset is. Absent on a plan written before 1.7.0, which means `stock`. */
export const PLAN_ASSET_KINDS = ["stock", "crypto", "meme"] as const;
export type PlanAssetKind = (typeof PLAN_ASSET_KINDS)[number];

/** 1.7.0: the id `issuer` carries on a token plan — the list that confirms the token, since a token of the network has no tokenizing issuer. */
export const TOKEN_CONFIRMATION_ISSUER = { id: "jupiter-verified", label: "Jupiter verified" } as const;

export const PlanAssetSchema = z
  .object({
    network: z.literal(NETWORK),
    mint: Address,
    /** The token's own symbol, as the venue lists it — a label beside the mint, never the identity. */
    symbol: z.string().min(1).max(32),
    /**
     * Who stands behind the asset. On a stock, the tokenizing issuer. On a
     * `crypto` or `meme` asset (1.7.0) the list that confirms the token
     * (`jupiter-verified`) — the field stays so that every 1.x reader keeps
     * rendering; `kind` is the way to know what the asset is.
     */
    issuer: z.object({ id: z.string().min(1).max(32), label: z.string().min(1).max(64) }).strict(),
    /** The underlying share on a stock; on a `crypto` or `meme` asset (1.7.0) the token itself — a plan on SOL is a plan on SOL. */
    underlying: z.object({ symbol: z.string().min(1).max(16), name: z.string().min(1).max(128).nullable() }).strict(),
    decimals: z.number().int().min(0).max(30).nullable(),
    /**
     * 1.4.0: the unit every per-unit price of this plan is in. Absent on a
     * plan written before 1.4.0, which means `share`. `token` on a pre-IPO
     * instrument, whose issuer states no unit of one share Ryntra can check,
     * and (1.7.0) on every `crypto` or `meme` asset.
     */
    unitBasis: z.enum(["share", "token"]).optional(),
    /**
     * 1.7.0: `stock` (absent on every plan written before this version), or
     * `crypto` / `meme` — the Spot catalogue's own category on a verified,
     * tradable token. A token plan carries no reference, session, issuer mark
     * or multiplier, and its Review judges those checks as not applicable.
     */
    kind: z.enum(PLAN_ASSET_KINDS).optional(),
  })
  .strict();
export type PlanAsset = z.infer<typeof PlanAssetSchema>;

/** The unit a plan is priced in: a plan from before 1.4.0 states none and is a share plan. */
export function planUnitBasis(asset: Pick<PlanAsset, "unitBasis">): "share" | "token" {
  return asset.unitBasis ?? "share";
}

/** What a plan's asset is: a plan from before 1.7.0 states none and is a stock plan. */
export function planAssetKind(asset: Pick<PlanAsset, "kind">): PlanAssetKind {
  return asset.kind ?? "stock";
}

/** True on a `crypto` or `meme` asset — priced per token, with no issuer reference to judge. */
export function isTokenPlanAsset(asset: Pick<PlanAsset, "kind">): boolean {
  return planAssetKind(asset) !== "stock";
}

/**
 * 1.7.0: the price the server read for planning when a version was written —
 * context beside the person's own entry, never the executable quote. `source`
 * says which figure it was: the issuer's reference per share, the token's
 * per-share price through the known multiplier, or the token's own market
 * price as the wallet shows it (the catalogue's figure, on a token plan). A
 * version without one (`null`) was written on the person's figure alone,
 * because no indication was available then; nothing is ever invented.
 */
export const PLANNING_PRICE_SOURCES = ["issuer-reference", "jupiter-per-share", "jupiter-token-price"] as const;
export type PlanningPriceSource = (typeof PLANNING_PRICE_SOURCES)[number];

export const PlanningPriceSchema = z
  .object({
    /** USD per unit of the plan (`unitBasis`). */
    perUnit: Usd,
    source: z.enum(PLANNING_PRICE_SOURCES),
    /** When the figure was observed by its source, or when Ryntra read it where the source states no time. */
    observedAt: Iso,
    /** `stale` when the read was served from a cache past its own rule at the write. */
    state: z.enum(["current", "stale"]),
  })
  .strict();
export type PlanningPrice = z.infer<typeof PlanningPriceSchema>;

export const PlanThesisSchema = z
  .object({
    text: z.string().min(1).max(PLAN_THESIS_MAX),
    whyNow: z.string().max(500).nullable(),
    horizon: z.object({ unit: z.enum(["days", "weeks", "months"]), value: z.number().int().min(1).max(60) }).strict().nullable(),
    sources: z.array(Url).max(10),
    assumptions: z.array(z.string().min(1).max(240)).max(10),
  })
  .strict();

export const PlanEntrySchema = z
  .object({
    /** USD per underlying share — the planned entry, the basis every size is computed on. */
    pricePerShare: Usd,
    /** The bound the Review checks the executable per-share price against; null means reported, never refused. */
    maxPricePerShare: Usd.nullable(),
    /** After this moment the entry rule is expired and the Review refuses the plan; null means no expiry. */
    validUntil: Iso.nullable(),
  })
  .strict();

export const PlanCapitalSchema = z
  .object({
    /** What this plan may spend, USD; the Review refuses an amount above it. */
    budgetUsd: Usd,
    /** Kept back for costs; sizing spends `budgetUsd − reserveForCostsUsd`. */
    reserveForCostsUsd: UsdOrZero,
  })
  .strict();

export const PlanRiskSchema = z
  .object({
    /** USD per underlying share, below the entry: where the thesis is wrong. */
    invalidationPerShare: Usd,
    /** The loss the person plans for if the invalidation is hit, USD. */
    plannedRiskUsd: Usd,
    /** Modelled cost and slippage on the way in and out, basis points of the entry. */
    costBufferBps: z.number().int().min(0).max(2000),
  })
  .strict();

export const PlanExitSchema = z
  .object({
    targetPerShare: Usd.nullable(),
    timeExitAt: Iso.nullable(),
    /** v1 places no exit order: the invalidation is a rule the person acts on, and the UI says so. */
    invalidationIsOrder: z.literal(false),
  })
  .strict();

export const PlanExecutionRulesSchema = z
  .object({
    maxSlippageBps: z.number().int().min(1).max(2000),
    /** A quote older than this at the Review is refused, not signed. */
    maxQuoteAgeSeconds: z.number().int().min(5).max(600),
    /** Executable per share against the reference, %; null means reported, never refused. */
    maxReferenceDeviationPct: z.number().finite().min(0).max(100).nullable(),
    /** True: a missing or stale reference blocks the execution of this version; false: it is named and the person decides. */
    referenceRequired: z.boolean(),
    minLiquidityUsd: Usd.nullable(),
  })
  .strict();

/**
 * A typed evidence condition. Accepted empty in 1.1.0; served since 1.5.0:
 * `metric` and `window` are the registry's (`capabilities.research`),
 * `threshold` is in the metric's unit, `mode` decides whether the check
 * blocks (`required`, which then always blocks on unknown) or names
 * (`advisory`, which warns on unknown). The server validates the pairing and
 * the metric's allowed modes and answers `PLAN_INVALID` with the path.
 */
export const EvidenceConditionSchema = z
  .object({
    metric: z.enum(EVIDENCE_METRIC_IDS),
    window: z.enum(EVIDENCE_WINDOWS),
    operator: z.enum(["gt", "gte", "lt", "lte"]),
    threshold: z.number().finite(),
    mode: z.enum(["advisory", "required"]),
    onUnknown: z.enum(["warn", "block"]),
  })
  .strict();
export type EvidenceCondition = z.infer<typeof EvidenceConditionSchema>;

/** The rules that make one version of a plan. */
export const PlanRulesSchema = z
  .object({
    thesis: PlanThesisSchema,
    entry: PlanEntrySchema,
    capital: PlanCapitalSchema,
    risk: PlanRiskSchema,
    exit: PlanExitSchema,
    execution: PlanExecutionRulesSchema,
    evidenceConditions: z.array(EvidenceConditionSchema).max(10),
  })
  .strict();
export type PlanRules = z.infer<typeof PlanRulesSchema>;

/**
 * The deterministic size, computed by the server from the rules:
 *
 *   lossPerShare        = entry − invalidation + entry × costBufferBps / 10 000
 *   riskLimitedUnits    = plannedRiskUsd / lossPerShare
 *   capitalLimitedUnits = (budgetUsd − reserveForCostsUsd) / entry
 *   units               = min(riskLimitedUnits, capitalLimitedUnits)
 *   notionalUsd         = units × entry
 */
export const PlanSizingSchema = z
  .object({
    model: z.literal("spot-long-v1"),
    lossPerShareUsd: Usd,
    riskLimitedUnits: Units,
    capitalLimitedUnits: Units,
    /** Underlying units, truncated to six decimals. */
    units: Units,
    notionalUsd: UsdOrZero,
    limitedBy: z.enum(["risk", "capital"]),
    /** What the model assumes, in the person's language; shown beside the figure, never hidden. */
    assumptions: z.array(z.string().min(1).max(240)).min(1).max(10),
  })
  .strict();
export type PlanSizing = z.infer<typeof PlanSizingSchema>;

export const PlanVersionSchema = z
  .object({
    version: z.number().int().min(1),
    rules: PlanRulesSchema,
    sizing: PlanSizingSchema,
    createdAt: Iso,
    /** Why this version exists, in the person's words; null on the first. */
    reason: Note.nullable(),
    /** 1.7.0: the planning price the server read at the write, or null when none was available; absent on a version written before 1.7.0. */
    planningPrice: PlanningPriceSchema.nullable().optional(),
  })
  .strict();
export type PlanVersion = z.infer<typeof PlanVersionSchema>;

export const PlanVersionSummarySchema = z.object({ version: z.number().int().min(1), createdAt: Iso, reason: Note.nullable() }).strict();

export const PLAN_EVENTS = ["created", "edited", "activated", "cancelled", "reviewed", "executed", "expired"] as const;

/** One decision or transition, with its time and the version it happened on. */
export const PlanJournalEntrySchema = z
  .object({
    at: Iso,
    event: z.enum(PLAN_EVENTS),
    version: z.number().int().min(1),
    note: Note.nullable(),
    /** A signature for `executed`, a review id for `reviewed`, else null. */
    ref: z.string().max(128).nullable(),
  })
  .strict();

/**
 * An operation bound to a version before it was signed, as the plan records
 * it once the server observed it. `reviewId` (1.3.0) names the Review that
 * stood before the signature — the operation's own id — and is null only on
 * a row History holds that the plan could not match to a Review it kept.
 */
export const PlanExecutionRefSchema = z
  .object({
    signature: z.string().min(64).max(128),
    version: z.number().int().min(1),
    reviewedAt: Iso,
    recordedAt: Iso,
    outcome: z.enum(["DONE", "FAILED", "UNKNOWN"]),
    reviewId: z.string().min(8).max(64).nullable().default(null),
    /**
     * 1.9.0: the side the operation was made as, read off the signed
     * bundle's origin (`SolanaActionOrigin.side`) and never inferred from
     * the order of the two legs afterwards. Null on an execution recorded
     * before the field existed — which reads as *not established*, not as
     * a buy.
     */
    side: z.enum(["BUY", "SELL"]).nullable().default(null),
  })
  .strict();
export type PlanExecutionRef = z.infer<typeof PlanExecutionRefSchema>;

export const TradingPlanSchema = z
  .object({
    id: z.string().regex(PLAN_ID),
    owner: Address,
    network: z.literal(NETWORK),
    status: z.enum(PLAN_STATUSES),
    side: z.enum(PLAN_SIDES),
    asset: PlanAssetSchema,
    /** The current version's number; also the `ifVersion` an edit must name. */
    version: z.number().int().min(1),
    current: PlanVersionSchema,
    /** Every version, oldest first; a version's rules are read by `GET …/versions/{n}`. */
    versions: z.array(PlanVersionSummarySchema).min(1).max(PLAN_VERSIONS_LIMIT),
    journal: z.array(PlanJournalEntrySchema).min(1).max(PLAN_JOURNAL_LIMIT),
    executions: z.array(PlanExecutionRefSchema).max(PLAN_EXECUTIONS_LIMIT),
    createdAt: Iso,
    updatedAt: Iso,
  })
  .strict();
export type TradingPlan = z.infer<typeof TradingPlanSchema>;

export const PlanCreateRequestSchema = z
  .object({
    /** The mint the person confirmed; the server resolves the representation and refuses an unconfirmed one. */
    asset: z.object({ mint: Address }).strict(),
    rules: PlanRulesSchema,
    /** True: the plan is `active` at once; false: a `draft` to activate later. */
    activate: z.boolean().default(false),
  })
  .strict();
export type PlanCreateRequest = z.input<typeof PlanCreateRequestSchema>;

/** New rules make a new version; `ifVersion` is the version the client read. */
export const PlanUpdateRequestSchema = z
  .object({
    rules: PlanRulesSchema,
    ifVersion: z.number().int().min(1),
    reason: Note.nullable().default(null),
  })
  .strict();
export type PlanUpdateRequest = z.input<typeof PlanUpdateRequestSchema>;

export const PlanStatusRequestSchema = z
  .object({
    status: z.enum(["active", "cancelled"]),
    ifVersion: z.number().int().min(1),
    reason: Note.nullable().default(null),
  })
  .strict();
export type PlanStatusRequest = z.input<typeof PlanStatusRequestSchema>;

/** 1.3.0: whether every execution History holds under a plan is on the plan; `pending` counts the ones a re-read will still try to write. */
export const PlanSyncSchema = z.object({ state: z.enum(["complete", "pending"]), pending: z.number().int().min(0) }).strict();
export type PlanSync = z.infer<typeof PlanSyncSchema>;

export const PlanResponseSchema = z
  .object({
    plan: TradingPlanSchema,
    /** 1.3.0, on a read of one plan: whether every execution History holds under it is on the plan yet. */
    sync: PlanSyncSchema.optional(),
  })
  .strict();
export type PlanResponse = z.infer<typeof PlanResponseSchema>;

export const PlanListResponseSchema = z
  .object({
    address: Address,
    /** Newest updated first, at most `PLAN_LIST_LIMIT`. */
    plans: z.array(TradingPlanSchema).max(PLAN_LIST_LIMIT),
    total: z.number().int().min(0),
  })
  .strict();
export type PlanListResponse = z.infer<typeof PlanListResponseSchema>;

export const PlanVersionResponseSchema = z.object({ planId: z.string().regex(PLAN_ID), version: PlanVersionSchema }).strict();
export type PlanVersionResponse = z.infer<typeof PlanVersionResponseSchema>;

/**
 * 1.7.0: `GET /api/v1/plans/asset?mint=` — any mint resolved the way a create
 * resolves it: the asset as the plan would carry it, the planning price read
 * now (or null, and the builder asks for the person's own figure), the
 * catalogue's liquidity where it has one. An unconfirmed or untradable mint is
 * `ASSET_UNCONFIRMED` (422) with the reason in `message`.
 */
export const PlanAssetReadSchema = z
  .object({
    asset: PlanAssetSchema,
    planningPrice: PlanningPriceSchema.nullable(),
    /** The venue's liquidity for the mint, USD, where the catalogue states one; a token plan's Review judges its liquidity floor on this figure. */
    liquidityUsd: UsdOrZero.nullable(),
    observedAt: Iso,
  })
  .strict();
export type PlanAssetRead = z.infer<typeof PlanAssetReadSchema>;

/* ------------------------------------------------------------ reviews (1.1.0) */

export const PLAN_CHECKS = [
  /** The plan is `active`. */
  "status",
  /** The order's mint is the plan's mint — the exact representation, not the company. */
  "asset",
  "side",
  /** The version reviewed is the plan's current one; an edit after the Review voids it. */
  "version",
  /** `entry.validUntil` has not passed. */
  "validity",
  /** The USD amount is within `capital.budgetUsd`. */
  "budget",
  /** The executable per-share price is within `entry.maxPricePerShare`. */
  "entryPrice",
  /** A reference exists and is current — required or advisory as the rules say. */
  "reference",
  /** Executable against the reference within `execution.maxReferenceDeviationPct`. */
  "deviation",
  "slippage",
  "quoteAge",
  "liquidity",
  /** The multiplier is known and not inside an activation window, so the units are the units. */
  "units",
  /* 1.3.0 — the money at this price, on the sizing's own model */
  /** The executable per-share price is above `risk.invalidationPerShare`: the thesis is not already wrong at this price. */
  "invalidation",
  /** The USD amount is within `capital.budgetUsd − capital.reserveForCostsUsd`, what the plan may actually spend. */
  "spend",
  /** The modelled loss of this exact deal — units × (executable − invalidation + executable × costBuffer) — is within `risk.plannedRiskUsd`. */
  "risk",
  /** Advisory: the USD amount against the version's own sized spend; over it, the person decides. */
  "size",
  /* 1.5.0 — the evidence conditions */
  /** One per condition of the version, in its order: the observation against the person's rule; required blocks on unmet or unknown, advisory names. */
  "evidence",
  /* 1.9.0 — the exit, judged only against rules that existed before it */
  /** The exit price against `exit.targetPerShare`, when the version in force at the exit named one. */
  "exitTarget",
  /** The exit price against `risk.invalidationPerShare` — whether the position was left at or below the level the thesis called wrong. */
  "exitInvalidation",
  /** The exit's own time against `exit.timeExitAt`, when the version in force named one. */
  "exitTime",
] as const;
export type PlanCheckId = (typeof PLAN_CHECKS)[number];

/** One check. `unknown` is never a pass: required, it blocks; advisory, it is named. */
export const PlanCheckSchema = z
  .object({
    id: z.enum(PLAN_CHECKS),
    outcome: z.enum(["pass", "fail", "unknown"]),
    required: z.boolean(),
    expected: z.string().min(1).max(160),
    actual: z.string().max(160).nullable(),
  })
  .strict();
export type PlanCheck = z.infer<typeof PlanCheckSchema>;

/** The Strategy block of the one Review: a plan version judged on the quote in front of the person. */
export const PlanReviewSchema = z
  .object({
    planId: z.string().regex(PLAN_ID),
    /** The version judged — the plan's current version when the Review was built; the execution binds to it. */
    version: z.number().int().min(1),
    latestVersion: z.number().int().min(1),
    /** 1.3.0: the operation's own id (the order's request id) — the same id the execution and the Receipt carry. */
    reviewId: z.string().min(8).max(64),
    checkedAt: Iso,
    /** `blocked`: a required check failed or is unknown; `attention`: only advisory ones did; `ready`: every check passed. */
    verdict: z.enum(["ready", "attention", "blocked"]),
    checks: z.array(PlanCheckSchema).min(1),
    quote: z
      .object({
        side: z.enum(PLAN_SIDES),
        usd: Usd,
        /** The token leg as a decimal string, in `unit`. */
        amount: z.string().regex(/^[0-9]+(\.[0-9]+)?$/),
        unit: z.enum(["underlying", "token"]),
        multiplier: z.number().finite().positive().nullable(),
        perShareUsd: Usd.nullable(),
        referencePerShareUsd: Usd.nullable(),
        referenceState: z.enum(["current", "stale", "unavailable"]),
        deviationPct: z.number().finite().nullable(),
        priceImpactPct: z.number().finite().nullable(),
        slippageBps: z.number().int().min(0),
        feeBps: z.number().int().min(0),
        observedAt: Iso,
        reviewExpiresAt: Iso,
        /** 1.3.0: the loss this exact deal models at the executable price, on the sizing's formula; null when the units are unknown. */
        modelledLossUsd: UsdOrZero.nullable().default(null),
        /** 1.3.0: the USD amount that fits the plan at this price — the smaller of the risk-limited and the spendable size; null when the units are unknown. */
        fitUsd: UsdOrZero.nullable().default(null),
      })
      .strict(),
    /** 1.5.0: the observation the `evidence` checks were judged on; absent on a version without conditions. */
    evidence: z.lazy(() => PlanReviewEvidenceSchema).optional(),
  })
  .strict();
export type PlanReview = z.infer<typeof PlanReviewSchema>;

/**
 * 1.5.0: what the Review knew about the observation before the signature —
 * the provider, its attribution, when it was asked, how far behind it may
 * have been, and each condition's judged figure. The figures are retained
 * with the review until `retainedUntil` (the rights map's window); a read
 * after that answers `value: null` and the check's `actual` as *retained
 * until …*, while `outcome` — Ryntra's own verdict — stays.
 */
export const PlanReviewEvidenceSchema = z
  .object({
    /** The first provider read; 1.6.0 lists every one in `sources`. */
    provider: z.enum(EVIDENCE_PROVIDERS),
    attribution: z.object({ text: z.string().min(1).max(64), href: z.string().url() }).strict(),
    /** 1.6.0: every provider the Review read, with its attribution — a plan may carry conditions on both. */
    sources: z
      .array(z.object({ provider: z.enum(EVIDENCE_PROVIDERS), attribution: z.object({ text: z.string().min(1).max(64), href: z.string().url() }).strict() }).strict())
      .max(4)
      .optional(),
    /** One entry per (provider, window) the conditions needed. */
    reads: z
      .array(
        z
          .object({
            /** 1.6.0: the provider of this read; absent in 1.5.0 reviews, where every read was the first provider's. */
            provider: z.enum(EVIDENCE_PROVIDERS).optional(),
            window: z.enum(EVIDENCE_WINDOWS),
            state: z.enum(EVIDENCE_READ_STATES),
            fetchedAt: Iso.nullable(),
            observedAt: Iso.nullable(),
            providerLagSeconds: z.number().int().nonnegative().nullable(),
            reason: z.string().max(240).nullable(),
          })
          .strict(),
      )
      .max(4),
    conditions: z
      .array(
        z
          .object({
            metric: z.enum(EVIDENCE_METRIC_IDS),
            window: z.enum(EVIDENCE_WINDOWS),
            operator: z.enum(["gt", "gte", "lt", "lte"]),
            threshold: z.number().finite(),
            mode: z.enum(["advisory", "required"]),
            outcome: z.enum(["pass", "fail", "unknown"]),
            /** The figure judged; null when none, or after `retainedUntil`. */
            value: z.number().finite().nullable(),
            unit: z.enum(EVIDENCE_UNITS),
          })
          .strict(),
      )
      .max(10),
    retainedUntil: Iso,
  })
  .strict();
export type PlanReviewEvidence = z.infer<typeof PlanReviewEvidenceSchema>;

/* ------------------------------------------------------------ results (1.3.0; 1.9.0 beyond the entry) */

/** 1.9.0: what one execution did to the position a plan describes. */
export const PLAN_LEGS = ["entry", "exit"] as const;
export type PlanLeg = (typeof PLAN_LEGS)[number];

/**
 * 1.9.0: how a figure was established, said on the figure itself.
 *
 * `known` — measured from a settled record. `estimated` — modelled before
 * the signature, and never spoken of as paid. `unknown` — not established;
 * the figure is null and `reason` says why. There is no fourth word, and a
 * missing figure is never a zero.
 */
export const FIGURE_BASES = ["known", "estimated", "unknown"] as const;
export type FigureBasis = (typeof FIGURE_BASES)[number];

/** 1.9.0: a decimal amount as text, in the unit its row names. */
const Decimal = z.string().regex(/^[0-9]+(\.[0-9]+)?$/);


/**
 * The actual leg of one execution, read off the History row the chain
 * settled — never off the quote. Figures through the multiplier the Review
 * stored, so an old result is explained in the units of its own moment.
 */
export const PlanActualSchema = z
  .object({
    signature: z.string().min(64).max(128),
    outcome: z.enum(["DONE", "FAILED", "UNKNOWN"]),
    settledAt: Iso,
    /** What left the wallet, USD; null unless the settlement asset was USDC and the row holds it. */
    usd: UsdOrZero.nullable(),
    /** What arrived, in `unit`; null while nothing has arrived. */
    amount: z.string().regex(/^[0-9]+(\.[0-9]+)?$/).nullable(),
    unit: z.enum(["underlying", "token"]),
    perShareUsd: Usd.nullable(),
    /** The loss this fill models at its own price, on the sizing's formula; null when a leg is unknown. */
    modelledLossUsd: UsdOrZero.nullable(),
    /** The service fee the row recorded, USD; null when the row holds none. */
    feeUsd: UsdOrZero.nullable(),
    receiptHash: z.string().max(80).nullable(),
    /**
     * 1.9.0: the side this operation was made as, off the signed bundle's
     * origin; null where the execution was recorded before the side was
     * carried, which reads as *not established*.
     */
    side: z.enum(["BUY", "SELL"]).nullable().default(null),
    /** 1.9.0: what it did to the position — `entry` established it, `exit` reduced it; null while the side is not established. */
    leg: z.enum(PLAN_LEGS).nullable().default(null),
    /** 1.9.0: what arrived in USD — an exit's proceeds; null on an entry and wherever no stablecoin leg gives par. */
    proceedsUsd: UsdOrZero.nullable().default(null),
    /** 1.9.0: the asset units that left, in `unit` — an exit's size; null on an entry. */
    unitsOut: Decimal.nullable().default(null),
    /** 1.9.0: how the dollars of this fill were established — a stablecoin leg at par, or the provider's own figure for the exact fill. */
    valueBasis: z.enum(["PAR", "PROVIDER_STATED"]).nullable().default(null),
    /** 1.9.0: how the fee figure was established — the provider's own dollars, a USDC amount at par, or a fee the provider reported as not taken. */
    feeBasis: z.enum(["PROVIDER_STATED", "PAR", "NOT_TAKEN"]).nullable().default(null),
    /**
     * 1.9.0: how this operation came to be part of the plan's result.
     *
     * `binding` — the person declared it under the plan before signing, and
     * the signed bundle carries the plan, the version and the Review's id.
     * `asset` — the operation was not declared under any plan, and the
     * product paired it here because it is a settled **sell of this plan's
     * exact mint** by this wallet after the plan's own entry, with no other
     * plan of the same mint holding an open position. The side is the row's
     * own (`origin.side`), never read backwards off the legs; what is
     * established by matching is the association, and a surface says so
     * rather than letting it read as a declaration. A matched operation is
     * a projection: nothing is written onto the plan, so it is undone by a
     * read, not by an edit.
     */
    matchedBy: z.enum(["binding", "asset"]).nullable().default(null),
  })
  .strict();
export type PlanActual = z.infer<typeof PlanActualSchema>;

/**
 * 1.9.0: one part of the difference between what was planned and what was
 * paid. Never a bare number: the part carries what established it, and a
 * part nothing established is `unknown` with its reason rather than a zero.
 */
export const PlanCostPartSchema = z
  .object({
    usd: z.number().finite().nullable(),
    pct: z.number().finite().nullable(),
    basis: z.enum(FIGURE_BASES),
    /** Why nothing was established; null when something was. */
    reason: z.string().max(160).nullable(),
  })
  .strict();
export type PlanCostPart = z.infer<typeof PlanCostPartSchema>;

/**
 * 1.9.0: where the difference went, in parts that are not added together.
 *
 * `marketMove` is the plan's own entry price against the executable price
 * the Review judged — two observed figures with two times, so the market's
 * own move between writing the plan and reviewing it is not charged to
 * execution. `execution` is that executable price against the fill —
 * slippage, price impact and the seconds in between. `fee` is the service
 * fee the settled row recorded, measured and never the quoted one.
 * `expected` is what the Review modelled before the signature; it is an
 * estimate by construction and no field here calls it paid.
 */
export const PlanCostsSchema = z
  .object({
    plannedPerUnitUsd: Usd.nullable(),
    quotedPerUnitUsd: Usd.nullable(),
    filledPerUnitUsd: Usd.nullable(),
    marketMove: PlanCostPartSchema,
    execution: PlanCostPartSchema,
    fee: PlanCostPartSchema,
    expected: z
      .object({
        feeBps: z.number().int().min(0).nullable(),
        slippageBps: z.number().int().min(0).nullable(),
        priceImpactPct: z.number().finite().nullable(),
        /** The USD leg the Review quoted — what would be spent on an entry, what would arrive on an exit. */
        quotedUsd: UsdOrZero.nullable(),
        referencePerUnitUsd: Usd.nullable(),
      })
      .strict(),
  })
  .strict();
export type PlanCosts = z.infer<typeof PlanCostsSchema>;

/**
 * 1.9.0: how an exit stood against the rules that existed **before** it.
 *
 * `ruledByVersion` is the newest version written at or before the exit's own
 * time — never the current one, because a rule written afterwards is not a
 * rule the exit could have followed. `notBackdated` is true when the plan's
 * current version carries an exit rule that this version did not, so the
 * reader knows a later rule was deliberately not applied backwards.
 */
export const PlanExitAdherenceSchema = z
  .object({
    ruledByVersion: z.number().int().min(1).nullable(),
    checks: z.array(PlanCheckSchema).max(6),
    /** `followed`: every rule that existed was met; `deviated`: one was not; `unknown`: the price, the time or the rules could not be established. */
    verdict: z.enum(["followed", "deviated", "unknown"]),
    notBackdated: z.boolean(),
  })
  .strict();
export type PlanExitAdherence = z.infer<typeof PlanExitAdherenceSchema>;

/**
 * 1.9.0: the position a plan's own executions add up to.
 *
 * Units in and out are summed from the executions the plan holds, in the
 * plan's unit. A realised figure is stated **only** when the position is
 * closed, every leg on both sides is valued and the fees are known or
 * explicitly nothing — and then `realisedMethod` names how it was computed.
 * Otherwise it is null and `unknowns` says what is missing; nothing here
 * invents a profit.
 */
export const PlanPositionSchema = z
  .object({
    state: z.enum(["open", "closed", "none"]),
    unitsIn: Decimal,
    unitsOut: Decimal,
    unitsHeld: Decimal,
    entries: z.number().int().min(0),
    exits: z.number().int().min(0),
    /** What the entries cost, USD, where every entry is valued; null otherwise. */
    costBasisUsd: UsdOrZero.nullable(),
    /** What the exits brought, USD, where every exit is valued; null otherwise. */
    proceedsUsd: UsdOrZero.nullable(),
    /** The service fees of the legs, USD, where every leg states one. */
    feesUsd: UsdOrZero.nullable(),
    realisedUsd: z.number().finite().nullable(),
    realisedMethod: z.literal("proceeds-minus-cost-basis-and-fees").nullable(),
    /** What is missing for a realised figure, as stable ids; empty when one is stated. */
    unknowns: z.array(z.string().min(1).max(64)).max(6),
  })
  .strict();
export type PlanPosition = z.infer<typeof PlanPositionSchema>;



/**
 * Plan · Before signing · Actual for one execution. `plan` is the version the
 * execution was bound to; `beforeSigning` the Strategy block that stood
 * before the signature (null only when the plan kept no copy); `actual` the
 * settled row; `checks` the money checks re-judged on the fill. `verdict`
 * speaks of the entry only — no exit adherence, no realised profit.
 */
export const PlanResultSchema = z
  .object({
    planId: z.string().regex(PLAN_ID),
    version: z.number().int().min(1),
    asset: PlanAssetSchema,
    plan: z
      .object({
        entryPerShareUsd: Usd,
        maxPricePerShareUsd: Usd.nullable(),
        budgetUsd: Usd,
        spendableUsd: UsdOrZero,
        plannedRiskUsd: Usd,
        invalidationPerShareUsd: Usd,
        costBufferBps: z.number().int().min(0).max(2000),
        sizedUnits: Units,
        sizedNotionalUsd: UsdOrZero,
      })
      .strict(),
    beforeSigning: PlanReviewSchema.nullable(),
    actual: PlanActualSchema,
    checks: z.array(PlanCheckSchema),
    /**
     * `followed`: every money check passes on the fill; `deviated`: one
     * fails; `unknown`: the fill or its units are not known. 1.9.0: on an
     * exit this is `unknown` and `checks` is empty, because the entry's
     * money checks do not speak of an exit — `exit.verdict` is the one that
     * does.
     */
    verdict: z.enum(["followed", "deviated", "unknown"]),
    /** 1.9.0: where the difference between the planned price and the paid one came from, in parts that are not added together. */
    costs: PlanCostsSchema,
    /** 1.9.0: an exit judged against the rules that existed before it; null on an entry and wherever the side is not established. */
    exit: PlanExitAdherenceSchema.nullable().default(null),
  })
  .strict();
export type PlanResult = z.infer<typeof PlanResultSchema>;

/* ------------------------------------------------------------ no-trade outcomes (1.9.0) */

/**
 * 1.9.0: why a plan has no trade. A stable id, never a sentence — the
 * client says it in the reader's language, and none of these is a failure:
 * a plan whose maximum-price rule was never satisfied did exactly what it
 * was written to do.
 */
export const PLAN_NO_TRADE_REASONS = [
  /** A Review was asked for and a required check refused it. */
  "review-blocked",
  /** A Review was refused specifically because the executable price was over `entry.maxPricePerShare`. */
  "entry-bound-unmet",
  /** A Review was refused because the venue's liquidity was under the version's floor, or could not be read. */
  "liquidity-unavailable",
  /** A required evidence condition was unmet or could not be judged. */
  "conditions-unmet",
  /** `entry.validUntil` passed with no execution. */
  "expired",
  /** The person cancelled the plan. */
  "cancelled",
  /** A Review found the executable price at or below the invalidation: the thesis was already wrong before the entry. */
  "invalidated-before-entry",
  /** A Review passed and no execution followed it — the person looked and did not proceed. */
  "reviewed-not-taken",
  /** The plan is live and nothing has been reviewed under it yet. */
  "no-review",
] as const;
export type PlanNoTradeReason = (typeof PLAN_NO_TRADE_REASONS)[number];

/**
 * 1.9.0: a plan that made no trade, as a result of its own. The reason
 * stands on the records the plan kept — the Reviews it judged, its status,
 * its validity — and `blockedBy` names the check that established it where
 * a Review did. `failure` is `false` on the shape itself: this is an
 * outcome, not a fault.
 */
export const PlanNoTradeOutcomeSchema = z
  .object({
    kind: z.literal("no-trade"),
    planId: z.string().regex(PLAN_ID),
    version: z.number().int().min(1),
    asset: PlanAssetSchema,
    status: z.enum(PLAN_STATUSES),
    reason: z.enum(PLAN_NO_TRADE_REASONS),
    /** The check that established the reason; null where the plan's own state did. */
    blockedBy: z.enum(PLAN_CHECKS).nullable(),
    /** The rule as it stood, and what was found against it — the Review's own words for the check. */
    expected: z.string().max(160).nullable(),
    found: z.string().max(160).nullable(),
    /** How many Reviews the plan judged. */
    reviews: z.number().int().min(0),
    /** True when `blockedBy` refused **every** Review the plan judged — the one fact that makes *the rule was never satisfied* a safe sentence rather than a guess from the last one. */
    everyReview: z.boolean(),
    lastReview: z.object({ reviewId: z.string().min(8).max(64), checkedAt: Iso, verdict: z.enum(["ready", "attention", "blocked"]) }).strict().nullable(),
    /** When the outcome was established — the last Review, the expiry, the cancellation or the plan's own last write. */
    observedAt: Iso,
    failure: z.literal(false),
  })
  .strict();
export type PlanNoTradeOutcome = z.infer<typeof PlanNoTradeOutcomeSchema>;

/** 1.9.0: a plan's position, with the plan it belongs to. */
export const PlanPositionRowSchema = z
  .object({ planId: z.string().regex(PLAN_ID), asset: PlanAssetSchema, status: z.enum(PLAN_STATUSES), version: z.number().int().min(1), position: PlanPositionSchema })
  .strict();
export type PlanPositionRow = z.infer<typeof PlanPositionRowSchema>;

/** 1.9.0: what the feed holds, counted. */
export const PlanResultsSummarySchema = z
  .object({
    plans: z.number().int().min(0),
    trades: z.number().int().min(0),
    entries: z.number().int().min(0),
    exits: z.number().int().min(0),
    noTrade: z.number().int().min(0),
    openPositions: z.number().int().min(0),
    closedPositions: z.number().int().min(0),
  })
  .strict();
export type PlanResultsSummary = z.infer<typeof PlanResultsSummarySchema>;

export const PlanResultsResponseSchema = z
  .object({
    address: Address,
    /** Newest settled first, across the plans asked for. */
    results: z.array(PlanResultSchema).max(PLAN_EXECUTIONS_LIMIT * 4),
    sync: PlanSyncSchema,
    /** 1.9.0: the plans that made no trade, newest established first — a first-class outcome, not an absence. */
    outcomes: z.array(PlanNoTradeOutcomeSchema).max(PLAN_LIST_LIMIT).default([]),
    /** 1.9.0: what each plan's own executions add up to. */
    positions: z.array(PlanPositionRowSchema).max(PLAN_LIST_LIMIT).default([]),
    /** 1.9.0: the feed counted. */
    summary: PlanResultsSummarySchema.default({ plans: 0, trades: 0, entries: 0, exits: 0, noTrade: 0, openPositions: 0, closedPositions: 0 }),
  })
  .strict();
export type PlanResultsResponse = z.infer<typeof PlanResultsResponseSchema>;

/* ------------------------------------------------------------ strategy memory (1.9.0) */

/**
 * 1.9.0: what a memory fact is about. Every kind is a count or a comparison
 * over records the wallet already holds — never an interpretation, never a
 * model's summary, never encouragement.
 */
export const PLAN_MEMORY_KINDS = [
  /** How many plans were written on this asset, and how many are live. */
  "plans-written",
  /** How many were reviewed, and how many of those became trades. */
  "trades-made",
  /** How many plans a named rule refused — the maximum price, the liquidity floor, an evidence condition. */
  "blocked-by-rule",
  /** How the actual entry stood against the planned one, as a percentage. */
  "entry-vs-plan",
  /** A position established under a plan and not yet reduced. */
  "position-open",
  /** An exit against the rules that existed before it. */
  "exit-adherence",
  /** What Monitoring wrote about a plan, as its own finding. */
  "monitoring-said",
] as const;
export type PlanMemoryKind = (typeof PLAN_MEMORY_KINDS)[number];

/** 1.9.0: the record a fact stands on. A fact without one is not written. */
export const PlanMemoryCitationSchema = z
  .object({
    kind: z.enum(["plan", "version", "review", "execution", "ledger", "note"]),
    /** The plan id, the version as text, the review id, the signature, the action id or the note id. */
    id: z.string().min(1).max(128),
    at: Iso.nullable(),
    href: z.string().max(256).nullable(),
  })
  .strict();
export type PlanMemoryCitation = z.infer<typeof PlanMemoryCitationSchema>;

/**
 * 1.9.0: one fact of strategy memory, derived from the records at read time
 * and carrying the records it stands on. The server states the kind and the
 * figures; the client composes the sentence in the reader's language, so no
 * prose is stored and none can drift from the record it describes.
 */
export const PlanMemoryFactSchema = z
  .object({
    id: z.string().min(4).max(96),
    kind: z.enum(PLAN_MEMORY_KINDS),
    scope: z
      .object({ kind: z.enum(["wallet", "asset", "plan"]), mint: Address.nullable(), symbol: z.string().max(32).nullable(), planId: z.string().regex(PLAN_ID).nullable() })
      .strict(),
    /** The figures the fact is made of; `text` carries a word where a number would not say it (a check id, an outcome). */
    figures: z
      .array(z.object({ key: z.string().min(1).max(32), value: z.number().finite().nullable(), text: z.string().max(80).nullable(), unit: z.enum(["usd", "pct", "count", "units", "word"]) }).strict())
      .max(6),
    cites: z.array(PlanMemoryCitationSchema).min(1).max(8),
    observedAt: Iso,
  })
  .strict();
export type PlanMemoryFact = z.infer<typeof PlanMemoryFactSchema>;

export const PLAN_MEMORY_LIMIT = 50;

export const PlanMemoryResponseSchema = z
  .object({
    address: Address,
    /** Newest first; at most `PLAN_MEMORY_LIMIT`. */
    facts: z.array(PlanMemoryFactSchema).max(PLAN_MEMORY_LIMIT),
    sync: PlanSyncSchema,
  })
  .strict();
export type PlanMemoryResponse = z.infer<typeof PlanMemoryResponseSchema>;

/* ------------------------------------------------------------ executions (1.1.0) */

/**
 * What an order names to execute under a plan: the plan and the version the
 * client read. Sent as `origin.plan` on `POST /api/solana/swap/order`; the
 * server judges the version again (`PlanReview`), writes the binding into the
 * issuer-signed bundle, and `execute` carries it onto the operation row. A
 * version that is no longer current is refused before any bytes are built.
 */
export const ExecutionPlanBindingSchema = z.object({ planId: z.string().regex(PLAN_ID), version: z.number().int().min(1) }).strict();
export type ExecutionPlanBinding = z.infer<typeof ExecutionPlanBindingSchema>;

/** 1.12.0: an autoinvest rule's id — `rule_` and 32 hex characters. */
export const RULE_ID = /^rule_[0-9a-f]{32}$/;

/**
 * 1.12.0: what an order names to buy under a rule's reminder — the rule and
 * the occurrence (the instant the purchase fell due). Sent as `origin.rule`
 * on `POST /api/solana/swap/order`; the server refuses a reminder that is not
 * open or an order that is not the rule's purchase, writes the binding into
 * the issuer-signed bundle, and `execute` carries it onto the History row the
 * rule reads its occurrence from. A reference for the check, never an
 * authorization: the wallet's signature is.
 */
export const RuleBindingSchema = z.object({ ruleId: z.string().regex(RULE_ID), dueAt: Iso }).strict();
export type RuleBinding = z.infer<typeof RuleBindingSchema>;

/**
 * What became of one reminder of a rule: `due` it is open · `pending` a signed
 * purchase not yet settled · `bought` settled · `missed` its day passed
 * without a signature — never caught up · `held` (1.13.0) the month's budget
 * did not cover the purchase, so nothing was reminded and the rules stand
 * until the 1st · `deferred` (1.18.0) the rule's price condition was not met
 * or its data were not fresh: nothing is to be bought, and the rule judges it
 * again while the occurrence is open. Here, before the notes that carry it
 * (1.13.0), and on every rule's occurrences.
 */
export const RULE_OCCURRENCE_STATES = ["due", "pending", "bought", "missed", "held", "deferred"] as const;
export type RuleOccurrenceState = (typeof RULE_OCCURRENCE_STATES)[number];

/* ------------------------------------------------------------ notifications (1.1.0, schema only) */

export const NOTIFICATION_CATEGORIES = ["plan", "operation", "market", "system"] as const;
const ClockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

/** A device that may be sent notifications; the route comes with push monitoring. */
export const DeviceRegistrationRequestSchema = z
  .object({
    platform: z.literal("android"),
    /** The push provider's opaque token; never logged, never shown. */
    token: z.string().min(16).max(4096),
    appVersion: Semver,
    locale: z.enum(["en", "uk"]).default("en"),
    categories: z.array(z.enum(NOTIFICATION_CATEGORIES)).max(NOTIFICATION_CATEGORIES.length).default([...NOTIFICATION_CATEGORIES]),
    /** Local wall-clock window in which nothing is pushed; null means none. */
    quietHours: z.object({ start: ClockTime, end: ClockTime, timezone: z.string().min(1).max(64) }).strict().nullable().default(null),
  })
  .strict();
export type DeviceRegistrationRequest = z.input<typeof DeviceRegistrationRequestSchema>;

export const DeviceRegistrationResponseSchema = z
  .object({
    deviceId: z.string().min(8).max(64),
    address: Address,
    platform: z.literal("android"),
    categories: z.array(z.enum(NOTIFICATION_CATEGORIES)).max(NOTIFICATION_CATEGORIES.length),
    quietHours: z.object({ start: ClockTime, end: ClockTime, timezone: z.string().min(1).max(64) }).strict().nullable(),
    registeredAt: Iso,
  })
  .strict();
export type DeviceRegistrationResponse = z.infer<typeof DeviceRegistrationResponseSchema>;

/* ------------------------------------------------------------ agent (1.8.0) */

export const AGENT_SESSION_ID = /^ags_[0-9a-f]{32}$/;
export const AGENT_TURN_ID = /^agt_[0-9a-f]{24}$/;
export const AGENT_DRAFT_ID = /^agd_[0-9a-f]{24}$/;
export const AGENT_QUESTION_MAX = 2000;
export const AGENT_TURNS_KEPT = 40;
export const AGENT_CARDS_MAX = 12;
export const AGENT_CITATIONS_MAX = 40;
/** 1.43.0: how long a conversation is kept after its last turn; past it the session is neither read back nor listed. */
export const AGENT_SESSION_RETENTION_DAYS = 90;

const Sentence = z.string().min(1).max(400);
const Words = z.string().min(1).max(160);
const CitationId = z.string().regex(/^c[0-9]{1,3}$/);
/** A path of this product, never a foreign address: every handoff opens a page of Ryntra. */
const AppHref = z.string().regex(/^\/app\/[A-Za-z0-9\-_./?=&%:+]{1,400}$/);

/** Where a conversation was opened from; the agent reads it as context, never as authority. */
export const AGENT_CONTEXT_KINDS = ["asset", "plan", "portfolio", "note", "page"] as const;
/* 1.59.0: `tasks` — the conversation «Доручення» write their runs into (AI-19), never a person's own. */
export const AGENT_PAGES = ["spot", "stocks", "swap", "trends", "strategies", "results", "activity", "predictions", "tasks"] as const;
export const AgentContextSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("asset"), mint: Address, symbol: z.string().min(1).max(32).optional() }).strict(),
  z.object({ kind: z.literal("plan"), planId: z.string().regex(PLAN_ID) }).strict(),
  z.object({ kind: z.literal("portfolio") }).strict(),
  /** A monitoring note of the inbox (`/api/monitoring`), by its id. */
  z.object({ kind: z.literal("note"), inboxId: z.string().min(4).max(64) }).strict(),
  z.object({ kind: z.literal("page"), page: z.enum(AGENT_PAGES) }).strict(),
]);
export type AgentContext = z.infer<typeof AgentContextSchema>;

/** What a question was taken to be. `execute` and `secret` are the two refusals; `unknown` is answered with what the agent can do. */
export const AGENT_QUESTION_CLASSES = [
  "market",
  "stock",
  "evidence",
  "portfolio",
  "plans",
  "plan",
  "results",
  "monitoring",
  "compare",
  "prepare_plan",
  "prepare_monitoring",
  "prepare_trade",
  "execute",
  "secret",
  "help",
  "unknown",
] as const;
export type AgentQuestionClass = (typeof AGENT_QUESTION_CLASSES)[number];

/** The state of a figure or a read, decided by age against the source's own rule — never promoted by the conversation. */
export const AGENT_STATES = ["current", "stale", "unavailable", "unknown"] as const;
export type AgentState = (typeof AGENT_STATES)[number];

/** 1.44.0 (AI-09): what kind of news an item is — a fixed list; the labeller chooses one, it never names one. */
export const AGENT_NEWS_TOPICS = ["security", "etf", "regulation", "listing", "funding", "partnership", "upgrade", "launch", "macro", "market", "other"] as const;
export type AgentNewsTopic = (typeof AGENT_NEWS_TOPICS)[number];

/** 1.44.0 (AI-09): the mark on each line of «What moved the price?» — a stated figure, a publication's report, Ryntra's reading, or what no source says. */
export const AGENT_MOVE_MARKS = ["fact", "unverified", "inference", "unknown"] as const;
export type AgentMoveMark = (typeof AGENT_MOVE_MARKS)[number];

/**
 * What a sentence stands on: the source that stated it, when it was observed
 * (null where the source states no time), its state, and the reference where
 * one exists — an evidence snapshot's provider and window, a plan id, a
 * signature, an inbox id. `href` is the product page that shows the same read.
 */
export const AgentCitationSchema = z
  .object({
    id: CitationId,
    /** The tool that read it, one of `capabilities.agent.tools`. */
    tool: z.string().min(1).max(48),
    source: Words,
    observedAt: Iso.nullable(),
    state: z.enum(AGENT_STATES),
    ref: z.string().max(160).nullable(),
    href: AppHref.nullable(),
  })
  .strict();
export type AgentCitation = z.infer<typeof AgentCitationSchema>;

/** A figure as a card states it: the label, the text as it should be printed, the unit, and the citation it came from. */
export const AgentFigureSchema = z
  .object({
    label: Words,
    /** Already formatted for a person (`$1,234.50`, `12.3 %`, `unavailable`); a client prints it as it is. */
    value: z.string().min(1).max(80),
    /** The number behind the text where there is one; null when the value is a state, not a figure. */
    number: z.number().finite().nullable(),
    unit: z.string().max(24).nullable(),
    state: z.enum(AGENT_STATES),
    cite: CitationId,
  })
  .strict();
export type AgentFigure = z.infer<typeof AgentFigureSchema>;

/** A page of this product the person may open next — every action is a handoff to the existing surface, never an action the agent took. */
export const AGENT_HANDOFF_KINDS = ["builder", "review", "plan", "monitoring", "market", "stocks", "portfolio", "results", "compare"] as const;
export const AgentHandoffSchema = z
  .object({
    kind: z.enum(AGENT_HANDOFF_KINDS),
    href: AppHref,
    label: Words,
    /** True on the one primary handoff of a turn, if any. */
    primary: z.boolean(),
  })
  .strict();
export type AgentHandoff = z.infer<typeof AgentHandoffSchema>;

const AgentIssue = z.object({ path: z.string().min(1).max(128), message: z.string().min(1).max(256), code: z.enum(PLAN_ISSUE_CODES).optional() }).strict();

/**
 * A comparison cell: the text, whether the fact is established by a source
 * (an unestablished one prints as *unknown / not established*), and the
 * citation where established.
 */
const ComparisonCell = z.object({ text: z.string().min(1).max(160), established: z.boolean(), cite: CitationId.nullable() }).strict();

export const AgentPlanDraftCardSchema = z
  .object({
    kind: z.literal("planDraft"),
    draftId: z.string().regex(AGENT_DRAFT_ID),
    asset: PlanAssetSchema,
    /** The rules as the builder will open them — the contract's own shape, judged the way a create judges them; null when no entry price could be established (nothing is invented) and the builder asks for it. */
    rules: PlanRulesSchema.nullable(),
    /** The size the engine computes from those rules, or null when the rules do not make a plan (`issues` say why). */
    sizing: PlanSizingSchema.nullable(),
    planningPrice: PlanningPriceSchema.nullable(),
    /** What was established for the builder's fields, each null when nothing was — the builder prefills these when `rules` is null and asks for the rest; money is never invented. */
    prefill: z
      .object({
        entryUsd: Usd.nullable(),
        maxPriceUsd: Usd.nullable(),
        invalidationUsd: Usd.nullable(),
        targetUsd: Usd.nullable(),
        budgetUsd: Usd.nullable(),
        riskUsd: Usd.nullable(),
        validUntil: Iso.nullable(),
      })
      .strict(),
    issues: z.array(AgentIssue).max(32),
    /** What the draft took from the person's words and what it assumed; every assumption is named. */
    assumptions: z.array(Sentence).max(10),
    handoff: AgentHandoffSchema,
  })
  .strict();
export const AgentMonitoringDraftCardSchema = z
  .object({
    kind: z.literal("monitoringDraft"),
    draftId: z.string().regex(AGENT_DRAFT_ID),
    subject: z.discriminatedUnion("kind", [z.object({ kind: z.literal("plan"), planId: z.string().regex(PLAN_ID), symbol: z.string().min(1).max(32) }).strict(), z.object({ kind: z.literal("asset"), mint: Address, symbol: z.string().min(1).max(32) }).strict()]),
    /** The condition in the contract's own shape — the builder judges it against the registry at save. */
    condition: EvidenceConditionSchema,
    /** The observation the condition was drafted against, where one was read. */
    observed: AgentFigureSchema.nullable(),
    assumptions: z.array(Sentence).max(6),
    handoff: AgentHandoffSchema,
  })
  .strict();
export const AgentTradeDraftCardSchema = z
  .object({
    kind: z.literal("tradeDraft"),
    draftId: z.string().regex(AGENT_DRAFT_ID),
    side: z.enum(["BUY", "SELL"]),
    mint: Address,
    symbol: z.string().min(1).max(32),
    /** The sum the person named, USD, or null when they named none — the ticket asks. */
    amountUsd: z.number().finite().positive().max(1_000_000_000).nullable(),
    /** The plan the ticket binds to, when the draft was prepared under one. */
    plan: z.object({ planId: z.string().regex(PLAN_ID), version: z.number().int().min(1) }).strict().nullable(),
    /** Said on every trade draft: nothing is signed or submitted here. */
    boundary: Sentence,
    handoff: AgentHandoffSchema,
  })
  .strict();

/**
 * The typed cards a turn carries beside its words. Every figure on a card is a
 * figure a tool read, with its citation; a draft carries the contract's own
 * shapes so the builder and the ticket open on exactly what the person saw.
 */
export const AgentCardSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("market"),
      mint: Address,
      symbol: z.string().min(1).max(32),
      name: z.string().min(1).max(128),
      category: z.enum(["crypto", "meme", "stock"]).nullable(),
      verified: z.boolean(),
      figures: z.array(AgentFigureSchema).max(12),
      cite: CitationId,
      href: AppHref,
    })
    .strict(),
  z
    .object({
      kind: z.literal("stock"),
      mint: Address,
      symbol: z.string().min(1).max(32),
      name: z.string().min(1).max(128),
      issuer: z.object({ id: z.string().min(1).max(32), label: z.string().min(1).max(64) }).strict(),
      instrument: z.object({ class: z.enum(["listed-equity", "pre-ipo"]), unitBasis: z.enum(["share", "token"]), rights: z.enum(["issuer-terms", "economic-exposure", "loan-participation"]) }).strict(),
      session: z.object({ period: z.string().min(1).max(32), exchangeOpen: z.boolean().nullable(), nextChangeAt: Iso.nullable() }).strict(),
      lifecycle: z.object({ state: z.string().min(1).max(48), tradable: z.boolean() }).strict(),
      figures: z.array(AgentFigureSchema).max(12),
      cite: CitationId,
      href: AppHref,
    })
    .strict(),
  z
    .object({
      kind: z.literal("evidence"),
      mint: Address,
      provider: z.enum(EVIDENCE_PROVIDERS),
      window: z.enum(EVIDENCE_WINDOWS),
      state: z.enum(EVIDENCE_READ_STATES),
      reason: z.string().max(400).nullable(),
      figures: z.array(AgentFigureSchema).max(16),
      attribution: z.object({ text: z.string().min(1).max(64), href: z.string().url() }).strict().nullable(),
      cite: CitationId,
      href: AppHref.nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("holdings"),
      tokenRead: z.enum(["COMPLETE", "PARTIAL", "UNAVAILABLE"]),
      rows: z
        .array(
          z
            .object({
              mint: Address,
              symbol: z.string().min(1).max(32),
              /** The wallet's amount as the wallet shows it, decimal text — the chain's figure, never computed here. */
              amount: z.string().regex(/^[0-9]+(\.[0-9]+)?$/),
              /** The venue's price per unit at the read, or null when the catalogue prices no such token. */
              priceUsd: z.number().finite().nonnegative().nullable(),
              verified: z.boolean(),
              category: z.enum(["crypto", "meme", "stock"]).nullable(),
              /** The plan ids this wallet holds on the mint, so a position says whether a plan stands behind it. */
              plans: z.array(z.string().regex(PLAN_ID)).max(10),
            })
            .strict(),
        )
        .max(60),
      /** How many held tokens the catalogue does not price — said, never dropped or summed as zero. */
      unpriced: z.number().int().min(0),
      cite: CitationId,
      href: AppHref,
    })
    .strict(),
  z
    .object({
      kind: z.literal("plan"),
      planId: z.string().regex(PLAN_ID),
      symbol: z.string().min(1).max(32),
      assetKind: z.enum(PLAN_ASSET_KINDS),
      status: z.enum(PLAN_STATUSES),
      version: z.number().int().min(1),
      figures: z.array(AgentFigureSchema).max(14),
      /** The latest Review the plan kept, as its verdict and the checks that did not pass; null when it kept none. */
      review: z
        .object({
          reviewId: z.string().min(8).max(64),
          checkedAt: Iso,
          verdict: z.enum(["ready", "attention", "blocked"]),
          failed: z.array(z.object({ id: z.enum(PLAN_CHECKS), outcome: z.enum(["fail", "unknown"]), required: z.boolean(), expected: z.string().min(1).max(160), actual: z.string().max(160).nullable() }).strict()).max(24),
        })
        .strict()
        .nullable(),
      cite: CitationId,
      href: AppHref,
    })
    .strict(),
  z
    .object({
      kind: z.literal("note"),
      inboxId: z.string().min(4).max(64),
      subject: z.object({ kind: z.enum(["trading-plan", "prediction-plan"]), id: z.string().min(4).max(64) }).strict().nullable(),
      title: z.string().min(1).max(200),
      reason: z.string().max(600),
      createdAt: Iso,
      /** The finding as figures, where the note carries one. */
      finding: z.object({ kind: z.string().min(1).max(48), outcome: z.string().min(1).max(24), observedAt: Iso.nullable() }).strict().nullable(),
      cite: CitationId,
      href: AppHref,
    })
    .strict(),
  z
    .object({
      kind: z.literal("comparison"),
      title: Words,
      columns: z.array(z.object({ id: z.string().min(1).max(64), label: Words }).strict()).min(2).max(5),
      rows: z.array(z.object({ label: Words, cells: z.array(ComparisonCell).min(2).max(5) }).strict()).min(1).max(24),
      /** Nothing here ranks an instrument as best; the note says what the comparison is and is not. */
      note: Sentence,
      href: AppHref.nullable(),
    })
    .strict(),
  /*
   * 1.44.0 (AI-09): the news a token — or the market — carries: the stories
   * Ryntra collected from its allow-listed feeds in the last 48 h, each with
   * its publisher, its time and the publisher's own link, newest first. A
   * headline is what a publisher reports, never a verified fact.
   */
  z
    .object({
      kind: z.literal("news"),
      /** The token the stories are about; null for the market as a whole. */
      mint: Address.nullable(),
      symbol: z.string().min(1).max(32).nullable(),
      items: z
        .array(
          z
            .object({
              id: z.string().regex(/^nw_[0-9a-f]{24}$/),
              title: z.string().min(1).max(200),
              source: z.string().min(1).max(48),
              publishedAt: Iso,
              /** The publisher's page — https, on that publisher's own host. */
              url: z.string().url().max(600).regex(/^https:\/\//),
              topic: z.enum(AGENT_NEWS_TOPICS),
              /** Other sources that told the same story. */
              also: z.number().int().min(0).max(20),
              cite: CitationId,
            })
            .strict(),
        )
        .max(6),
      /** The last 24 h: how many stories and how many sources. */
      day: z.object({ stories: z.number().int().min(0), sources: z.number().int().min(0) }).strict(),
      /** When the collector last read the feeds. */
      collectedAt: Iso,
      state: z.enum(AGENT_STATES),
    })
    .strict(),
  /*
   * 1.44.0 (AI-09): «What moved the price?» — the move as read, and each line
   * of the explanation marked: a fact (a figure a source stated), unverified
   * (what a publication reports), an inference (Ryntra's reading of the two —
   * a coincidence in time is no proof of cause) or unknown (what no source
   * says). The server writes and marks every line; a model never does.
   */
  z
    .object({
      kind: z.literal("move"),
      mint: Address,
      symbol: z.string().min(1).max(32),
      window: z.enum(["1h", "24h"]),
      /** The move itself, as the source states it; null when no source stated one. */
      change: AgentFigureSchema.nullable(),
      rows: z.array(z.object({ mark: z.enum(AGENT_MOVE_MARKS), text: Sentence, cites: z.array(CitationId).max(4) }).strict()).min(1).max(10),
    })
    .strict(),
  AgentPlanDraftCardSchema,
  AgentMonitoringDraftCardSchema,
  AgentTradeDraftCardSchema,
]);
export type AgentCard = z.infer<typeof AgentCardSchema>;

/** One sentence and what it stands on. A sentence with no citation is the agent's own reasoning, and the format marks it so. */
export const AgentSentenceSchema = z.object({ text: Sentence, cites: z.array(CitationId).max(6) }).strict();
export type AgentSentence = z.infer<typeof AgentSentenceSchema>;

/**
 * The fixed structure of a substantive answer: what is actually known now,
 * what it means for the person's question or plan, what could make that
 * reading wrong, what is missing or stale, what is worth checking, and
 * neutral next steps — never a command to buy or sell. `insufficient` is true
 * when the reads did not give enough to judge, and the answer says so instead
 * of inventing.
 */
export const AGENT_ANSWER_SECTIONS = ["observation", "meaning", "counter", "risks", "checks", "actions"] as const;
export const AgentAnswerSchema = z
  .object({
    observation: z.array(AgentSentenceSchema).max(8),
    meaning: z.array(AgentSentenceSchema).max(6),
    counter: z.array(AgentSentenceSchema).max(4),
    risks: z.array(AgentSentenceSchema).max(6),
    checks: z.array(AgentSentenceSchema).max(6),
    actions: z.array(AgentSentenceSchema).max(6),
    insufficient: z.boolean(),
  })
  .strict();
export type AgentAnswer = z.infer<typeof AgentAnswerSchema>;

/** What a tool did for a turn: its name, whether it answered, and the state of what it read — never its arguments in full. */
export const AgentToolOutcomeSchema = z
  .object({
    tool: z.string().min(1).max(48),
    kind: z.enum(["research", "prepare"]),
    outcome: z.enum(["ok", "empty", "unavailable", "refused"]),
    state: z.enum(AGENT_STATES).nullable(),
    latencyMs: z.number().int().min(0),
  })
  .strict();
export type AgentToolOutcome = z.infer<typeof AgentToolOutcomeSchema>;

/* ------------------------------------------------------------ brief and critic (1.10.0) */

/**
 * 1.10.0: the Brief — the short answer a person wants before deciding, in
 * five parts and no more: what changed, what matters for this thesis or
 * plan, which data supports it, what is unknown, what is worth checking
 * next. It is a **format over the same agent engine**, not a second one:
 * the same Research tools read, the same citations stand under every
 * sentence, the same budget meters any model call. `insufficient` is true
 * when the reads gave nothing to stand on, and the Brief says so rather
 * than filling the five parts with words.
 */
export const AGENT_BRIEF_SECTIONS = ["changed", "matters", "supports", "unknown", "checks"] as const;
export type AgentBriefSection = (typeof AGENT_BRIEF_SECTIONS)[number];

export const AgentBriefSchema = z
  .object({
    changed: z.array(AgentSentenceSchema).max(6),
    matters: z.array(AgentSentenceSchema).max(6),
    supports: z.array(AgentSentenceSchema).max(8),
    unknown: z.array(AgentSentenceSchema).max(6),
    checks: z.array(AgentSentenceSchema).max(6),
    insufficient: z.boolean(),
  })
  .strict();
export type AgentBrief = z.infer<typeof AgentBriefSchema>;

/**
 * 1.10.0: what a Critic finding is about. The Critic argues against a
 * thesis; it never instructs a trade, and no kind here has a direction.
 * Each kind is a sentence the product can stand behind:
 *
 * - `assumption-conflict` — *this assumption conflicts with …* a figure that
 *   was actually read.
 * - `risk-not-established` — *this risk is not established …* the number it
 *   would need was never observed.
 * - `plan-condition-unmet` — *this plan condition is currently unmet …* a
 *   required check of the person's own plan did not pass.
 * - `previous-result` — *your previous result shows …* a fact of the
 *   wallet's own strategy memory that argues against the new decision.
 * - `evidence-missing` — the evidence the reading rests on is stale, absent
 *   or was never measured.
 * - `asset-structure` — a structural property of the asset itself (an
 *   authority still held, concentration, thin liquidity, the instrument's
 *   rights, a closed session, a lifecycle that is not open).
 * - `thesis-weakness` — the thesis is under-specified on its own terms: no
 *   measurable condition, no exit, an expired horizon, one source only.
 */
export const AGENT_CRITIC_KINDS = ["assumption-conflict", "risk-not-established", "plan-condition-unmet", "previous-result", "evidence-missing", "asset-structure", "thesis-weakness"] as const;
export type AgentCriticKind = (typeof AGENT_CRITIC_KINDS)[number];

/**
 * 1.10.0: one finding. `text` is the challenge in the reader's language;
 * `figures` are the figures it stands on, each carrying its own citation and
 * state; `cites` are the citations of the reads behind it. A finding whose
 * figures are all `unavailable` is still written — that is the point of
 * `risk-not-established` — but it never turns a missing figure into a zero.
 */
export const AgentCriticFindingSchema = z
  .object({
    id: z.string().min(2).max(64),
    kind: z.enum(AGENT_CRITIC_KINDS),
    text: Sentence,
    figures: z.array(AgentFigureSchema).max(6),
    cites: z.array(CitationId).max(6),
    state: z.enum(AGENT_STATES),
  })
  .strict();
export type AgentCriticFinding = z.infer<typeof AgentCriticFindingSchema>;

/**
 * 1.10.0: the Critic. `findings` are what could be argued against the
 * thesis on the reads; `gaps` say what could **not** be challenged and why,
 * so silence is never mistaken for agreement. `insufficient` is true when
 * nothing at all could be established.
 */
export const AgentCriticSchema = z
  .object({
    findings: z.array(AgentCriticFindingSchema).max(12),
    gaps: z.array(AgentSentenceSchema).max(6),
    insufficient: z.boolean(),
  })
  .strict();
export type AgentCritic = z.infer<typeof AgentCriticSchema>;

export const AgentTurnSchema = z
  .object({
    id: z.string().regex(AGENT_TURN_ID),
    role: z.enum(["person", "ryn"]),
    at: Iso,
    /** The person's words as sent; on Ryn's turn one line that says what the answer is about. */
    text: z.string().min(1).max(AGENT_QUESTION_MAX),
    class: z.enum(AGENT_QUESTION_CLASSES).nullable(),
    answer: AgentAnswerSchema.nullable(),
    cards: z.array(AgentCardSchema).max(AGENT_CARDS_MAX),
    citations: z.array(AgentCitationSchema).max(AGENT_CITATIONS_MAX),
    handoffs: z.array(AgentHandoffSchema).max(6),
    tools: z.array(AgentToolOutcomeSchema).max(16),
    /** On Ryn's turn: who wrote the words — the configured model, or the deterministic composer over the same reads. */
    composedBy: z.enum(["model", "deterministic"]).nullable(),
    /** A refusal said as a fact: the class that was refused and the sentence a person reads; the turn still answers what can be done instead. */
    refusal: z.object({ code: z.enum(["execute", "secret"]), reason: Sentence }).strict().nullable(),
    /** 1.10.0: the Brief, when the person asked for one in the conversation; null otherwise. The six-section `answer` is always written beside it, so a client that knows nothing of the Brief still reads a whole answer. */
    brief: AgentBriefSchema.nullable().default(null),
    /** 1.10.0: the Critic, when the person asked to be argued with; null otherwise. Never directive, and never present without `answer`. */
    critic: AgentCriticSchema.nullable().default(null),
  })
  .strict();
export type AgentTurn = z.infer<typeof AgentTurnSchema>;

export const AgentSessionSchema = z
  .object({
    id: z.string().regex(AGENT_SESSION_ID),
    owner: Address,
    network: z.literal(NETWORK),
    locale: z.enum(["en", "uk"]),
    context: AgentContextSchema.nullable(),
    /** The last `AGENT_TURNS_KEPT` turns, oldest first. */
    turns: z.array(AgentTurnSchema).max(AGENT_TURNS_KEPT),
    createdAt: Iso,
    updatedAt: Iso,
  })
  .strict();
export type AgentSession = z.infer<typeof AgentSessionSchema>;

/**
 * 1.52.0: the assistant's credits — the service's own units (1 000 = 1 USDC), never a token and never paid out. What a
 * question costs is in `prices` before it is asked; free credits go first, then `welcome`, then `bought`.
 */
const CreditCount = z.number().int().min(0);
export const AssistantCreditsSchema = z
  .object({
    unit: z.literal("credits"),
    /** The welcome and the bought credits together: what is spent once the day's free ones are. */
    balance: CreditCount,
    welcome: CreditCount,
    bought: CreditCount,
    /** The day's free credits: not carried over; `resetsAt` is the next UTC midnight. */
    free: z.object({ used: CreditCount, left: CreditCount, daily: CreditCount, resetsAt: Iso }).strict(),
    /** Held for questions being answered now; given back if the model is not reached. */
    reserved: CreditCount,
    /** Credits of the balance spent today against the day's cap — no quiet overspend. */
    dailySpend: z.object({ used: CreditCount, cap: CreditCount, resetsAt: Iso }).strict(),
    /** Every paid action's price in credits. `voice` is per started 30 s heard on the server. */
    prices: z.object({ question: CreditCount, alertExplain: CreditCount, tokenReport: CreditCount, priceMove: CreditCount, voice: CreditCount, deep: CreditCount, plan: CreditCount }).strict(),
    /** Whether the welcome credits may still be asked for (`POST /api/v1/assistant/credits/welcome`). */
    welcomeOffer: z.enum(["open", "taken"]),
    /** Whose they are: the wallet's own, or its account's once the wallet is linked (a wallet's credits move into it). */
    holder: z.enum(["wallet", "account"]),
  })
  .strict();
export type AssistantCredits = z.infer<typeof AssistantCreditsSchema>;

/** 1.52.0: one entry of the credits' history — what was given, held, kept or given back; never a word of the question. */
export const AssistantCreditEntrySchema = z
  .object({
    at: Iso,
    kind: z.enum(["grant", "hold", "capture", "release", "expire", "merge-out", "merge-in"]),
    action: z.enum(["question", "alertExplain", "tokenReport", "priceMove", "voice", "deep", "plan"]).nullable(),
    reason: z.enum(["welcome", "purchase", "adjust"]).nullable(),
    /** What the entry did to the credits: negative taken, positive given or given back. */
    credits: z.number().int(),
    /** For a capture: the credits kept in the end. */
    charged: CreditCount.nullable(),
  })
  .strict();
export type AssistantCreditEntry = z.infer<typeof AssistantCreditEntrySchema>;

/** 1.54.0: one package of credits for USDC (AI-12). */
export const AssistantCreditPackageSchema = z
  .object({
    id: z.enum(["usdc-2", "usdc-5", "usdc-10", "usdc-25"]),
    /** The price in USDC, as a decimal string. */
    usdc: z.string().regex(/^[0-9]+(\.[0-9]+)?$/),
    credits: CreditCount,
    /** The bonus over 1 000 credits for 1 USDC, in percent. */
    bonusPercent: z.number().int().min(0).max(100),
  })
  .strict();
export type AssistantCreditPackage = z.infer<typeof AssistantCreditPackageSchema>;

const CreditAddress = z.object({ address: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/), abbreviated: z.string().min(1).max(16) }).strict();

/** 1.54.0: whether credits are sold here, for what, and to which treasury. */
export const AssistantCreditPurchaseSchema = z
  .object({
    /** False until the treasury is set on this deployment: no order can be opened. */
    available: z.boolean(),
    packages: z.array(AssistantCreditPackageSchema).max(8),
    treasury: CreditAddress.nullable(),
    /** How long an order invites a payment; a payment that lands later still counts. */
    orderMinutes: z.number().int().min(1),
  })
  .strict();
export type AssistantCreditPurchase = z.infer<typeof AssistantCreditPurchaseSchema>;

/**
 * 1.54.0: one order of credits — what to pay, where, and what the chain says. `status`: `awaiting` (nothing yet),
 * `checking` (the chain could not be read just now), `underpaid` (less arrived — credited at the base rate), `paid`,
 * `expired` (nothing arrived in time; a late payment still counts). The receipt is `payments` with `credited`.
 */
export const AssistantCreditOrderSchema = z
  .object({
    id: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{14,20}$/),
    package: AssistantCreditPackageSchema,
    status: z.enum(["awaiting", "checking", "underpaid", "paid", "expired"]),
    amount: z.object({ raw: z.string().regex(/^[0-9]+$/), display: z.string().min(1).max(40), symbol: z.literal("USDC"), mint: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/) }).strict(),
    /** USDC counted for this order so far. */
    received: z.object({ raw: z.string().regex(/^[0-9]+$/), display: z.string().min(1).max(40) }).strict(),
    /** Credits added for this order so far. */
    credited: CreditCount,
    /** The payment page: QR for a phone camera, a wallet in the browser. */
    payPage: z.string().url(),
    /** The standard Solana Pay transfer request with this order's reference. */
    payUrl: z.string().min(8).max(600),
    reference: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/),
    treasury: CreditAddress,
    createdAt: Iso,
    expiresAt: Iso,
    payments: z.array(z.object({ signature: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,90}$/), amount: z.string().min(1).max(40), at: Iso.nullable() }).strict()).max(16),
    /** Another token arrived under this reference: not credited; it goes back by hand to the paying wallet. */
    wrongToken: z.boolean(),
  })
  .strict();
export type AssistantCreditOrder = z.infer<typeof AssistantCreditOrderSchema>;

export const AssistantCreditsResponseSchema = z
  .object({
    credits: AssistantCreditsSchema,
    entries: z.array(AssistantCreditEntrySchema).max(50),
    /** `POST …/welcome`: the credits just given. */
    granted: CreditCount.optional(),
    /** 1.54.0: buying credits for USDC. */
    purchase: AssistantCreditPurchaseSchema.optional(),
  })
  .strict();
export type AssistantCreditsResponse = z.infer<typeof AssistantCreditsResponseSchema>;

/** 1.54.0: `POST /api/v1/assistant/credits/orders` and `GET …/orders/<id>` — the order and the credits after it. */
export const AssistantCreditOrderResponseSchema = z.object({ order: AssistantCreditOrderSchema, credits: AssistantCreditsSchema }).strict();
export type AssistantCreditOrderResponse = z.infer<typeof AssistantCreditOrderResponseSchema>;

/** 1.54.0: `GET /api/v1/assistant/credits/orders` — the newest orders (the receipts) and the credits after reading them. */
export const AssistantCreditOrdersResponseSchema = z.object({ orders: z.array(AssistantCreditOrderSchema).max(10), credits: AssistantCreditsSchema }).strict();
export type AssistantCreditOrdersResponse = z.infer<typeof AssistantCreditOrdersResponseSchema>;

/** 1.54.0: the body of `POST /api/v1/assistant/credits/orders`. */
export const AssistantCreditOrderRequestSchema = z.object({ package: z.enum(["usdc-2", "usdc-5", "usdc-10", "usdc-25"]), locale: z.enum(["uk", "en"]).optional() }).strict();
export type AssistantCreditOrderRequest = z.infer<typeof AssistantCreditOrderRequestSchema>;

/** The wallet's allowance and what is spent of it, from the durable meter; a client shows it as it is. */
export const AgentBudgetStateSchema = z
  .object({
    /** What is counted: questions that reach the model. A deterministic answer costs none. */
    unit: z.literal("calls"),
    day: z.object({ used: z.number().int().min(0), allowance: z.number().int().min(0), resetsAt: Iso }).strict(),
    month: z.object({ used: z.number().int().min(0), allowance: z.number().int().min(0), resetsAt: Iso }).strict(),
    inFlight: z.object({ used: z.number().int().min(0), limit: z.number().int().min(1) }).strict(),
    exhausted: z.boolean(),
    /** Why the next model call would be refused, in a sentence; null while one would be allowed. */
    reason: Sentence.nullable(),
    model: z.enum(["configured", "absent"]),
    /** 1.52.0: the credits a question that reaches the model is paid in; absent where credits are not served. */
    credits: AssistantCreditsSchema.optional(),
  })
  .strict();
export type AgentBudgetState = z.infer<typeof AgentBudgetStateSchema>;

export const AgentSuggestionSchema = z.object({ text: Sentence, class: z.enum(AGENT_QUESTION_CLASSES) }).strict();
export type AgentSuggestion = z.infer<typeof AgentSuggestionSchema>;

export const AgentSessionOpenRequestSchema = z
  .object({
    context: AgentContextSchema.nullable().default(null),
    locale: z.enum(["en", "uk"]).default("en"),
    /** A session id to resume; absent, the wallet's latest session for the same context is resumed, else a new one is opened. */
    sessionId: z.string().regex(AGENT_SESSION_ID).optional(),
    /** 1.43.0: «Нова розмова» — open a new session even where one for the same context exists; ignored beside `sessionId`. */
    fresh: z.boolean().default(false),
  })
  .strict();
export type AgentSessionOpenRequest = z.input<typeof AgentSessionOpenRequestSchema>;

/** 1.43.0: one conversation as the list shows it — never its answers. `title` is the first question, null before one is asked. */
export const AgentSessionSummarySchema = z
  .object({
    id: z.string().regex(AGENT_SESSION_ID),
    locale: z.enum(["en", "uk"]),
    context: AgentContextSchema.nullable(),
    title: z.string().min(1).max(120).nullable(),
    turnCount: z.number().int().min(0),
    createdAt: Iso,
    updatedAt: Iso,
    /** When the conversation stops being kept: its last turn plus `AGENT_SESSION_RETENTION_DAYS`. */
    expiresAt: Iso,
  })
  .strict();
export type AgentSessionSummary = z.infer<typeof AgentSessionSummarySchema>;

/** 1.43.0: `GET /api/v1/agent/sessions` — the proven wallet's conversations within their retention, the most recent first. */
export const AgentSessionListResponseSchema = z
  .object({
    sessions: z.array(AgentSessionSummarySchema).max(20),
    retentionDays: z.literal(AGENT_SESSION_RETENTION_DAYS),
  })
  .strict();
export type AgentSessionListResponse = z.infer<typeof AgentSessionListResponseSchema>;

/**
 * 1.43.0: `POST /api/v1/assistant/guest` — a market question without a
 * wallet. The context, when given, is an asset or a page — never a plan, a
 * portfolio or a note, which are someone's own.
 */
export const AgentGuestRequestSchema = z
  .object({
    text: z.string().min(1).max(AGENT_QUESTION_MAX),
    locale: z.enum(["en", "uk"]).default("en"),
    context: z
      .discriminatedUnion("kind", [
        z.object({ kind: z.literal("asset"), mint: Address, symbol: z.string().min(1).max(32).optional() }).strict(),
        z.object({ kind: z.literal("page"), page: z.enum(AGENT_PAGES) }).strict(),
      ])
      .nullable()
      .default(null),
  })
  .strict();
export type AgentGuestRequest = z.input<typeof AgentGuestRequestSchema>;

export const AgentGuestResponseSchema = z
  .object({
    /** The two turns of the exchange, as a conversation's; nothing is stored — the client keeps them. */
    person: AgentTurnSchema,
    ryn: AgentTurnSchema,
    guest: z
      .object({
        /** The guest's model answers today, counted by a keyed digest of the request's address and the day. */
        day: z.object({ used: z.number().int().min(0), allowance: z.number().int().min(0), resetsAt: Iso }).strict(),
        model: z.enum(["configured", "absent"]),
        /** True when the words asked about something of one's own — a portfolio, a plan, a trade — and the answer is the way to connect a wallet. */
        needsWallet: z.boolean(),
      })
      .strict(),
  })
  .strict();
export type AgentGuestResponse = z.infer<typeof AgentGuestResponseSchema>;

/* ---- 1.46.0: «Ранковий огляд» (AI-10) */

/** A brief's time: a quarter hour on the person's clock. */
const BriefClock = z.string().regex(/^([01]\d|2[0-3]):(00|15|30|45)$/);
export const ASSISTANT_BRIEF_MARKS = ["fact", "unverified"] as const;
export const ASSISTANT_BRIEF_LINE_KINDS = ["sol", "btc", "mover", "market-news", "token", "token-news", "plan"] as const;

/** One line the server wrote from a read, in the reader's language: a claim — a figure, or a publication's report — and beside it its source and time. */
export const AssistantBriefLineSchema = z
  .object({
    kind: z.enum(ASSISTANT_BRIEF_LINE_KINDS),
    mark: z.enum(ASSISTANT_BRIEF_MARKS),
    text: z.string().min(1).max(600),
    source: z.string().min(1).max(48),
    observedAt: Iso.nullable(),
    /** Where the line opens — a token's page, a plan's note, a publication's story. */
    href: z.string().max(600).nullable(),
  })
  .strict();
export type AssistantBriefLine = z.infer<typeof AssistantBriefLineSchema>;

/** A part of the brief: the model's blocks (none when it was off, busy or said nothing that held) over the server's lines. */
const AssistantBriefPart = z
  .object({
    title: z.string().min(1).max(80),
    words: z.array(z.string().min(1).max(400)).max(2),
    lines: z.array(AssistantBriefLineSchema).max(12),
    /** What the part says instead of lines, or beside them: the market not read, nothing of one's own changed, what of one's own was not read. */
    note: z.string().max(200).nullable(),
  })
  .strict();

export const AssistantBriefSchema = z
  .object({
    /** The person's day on their clock. */
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    title: z.string().min(1).max(80),
    market: AssistantBriefPart,
    /** `changed` — lines below; `unchanged` — every read answered and nothing changed; `unread` — the wallet did not answer, nothing is claimed. */
    personal: AssistantBriefPart.extend({ state: z.enum(["changed", "unchanged", "unread"]) }).strict(),
    deliveredAt: Iso,
  })
  .strict();
export type AssistantBrief = z.infer<typeof AssistantBriefSchema>;

export const AssistantBriefSettingsSchema = z
  .object({
    enabled: z.boolean(),
    time: BriefClock,
    zone: z.string().min(1).max(64),
    locale: z.enum(["en", "uk"]),
  })
  .strict();
export type AssistantBriefSettings = z.infer<typeof AssistantBriefSettingsSchema>;

export const AssistantBriefResponseSchema = z
  .object({
    settings: AssistantBriefSettingsSchema,
    /** When the next brief comes; null while it is off. `quiet` — the time falls in the quiet hours and the brief comes when they end. */
    next: z.object({ at: Iso.nullable(), quiet: z.boolean() }).strict(),
    /** Where it goes: the inbox always, Telegram and push as Нагляд's preferences say. */
    channels: z.object({ inbox: z.literal(true), telegram: z.boolean(), push: z.boolean() }).strict(),
    /** What a brief costs in credits — 0 since 1.52.0: the morning brief is free every day; `charged` stays false. */
    priceCredits: z.number().int().min(0),
    charged: z.literal(false),
    latest: AssistantBriefSchema.nullable(),
  })
  .strict();
export type AssistantBriefResponse = z.infer<typeof AssistantBriefResponseSchema>;

/** `PUT /api/v1/assistant/brief` — on or off, the time, the zone (the default Europe/Kyiv), the language the brief is written in. */
export const AssistantBriefUpdateSchema = z
  .object({
    enabled: z.boolean(),
    time: BriefClock.default("09:00"),
    zone: z.string().min(1).max(64).default("Europe/Kyiv"),
    locale: z.enum(["en", "uk"]).default("uk"),
  })
  .strict();
export type AssistantBriefUpdate = z.input<typeof AssistantBriefUpdateSchema>;

/* ---- 1.57.0 — «Стежити за токеном» (AI-05) */

/** A watch's rule — the person's own threshold, judged without a model (`lib/assistant/watch/rules.ts`). */
export const AssistantWatchRuleSchema = WatchRuleSchema;
export type AssistantWatchRule = z.infer<typeof AssistantWatchRuleSchema>;
export const ASSISTANT_WATCH_PRESETS = WATCH_PRESETS;
/** `armed` — watching; `rang` — it rang and waits for the market to leave the threshold; `cooling` — past the threshold within its pause; `unread` — the market was not read now; `learning` — not enough history yet (a liquidity change over an hour needs an hour); `paused`. */
export const ASSISTANT_WATCH_STATES = ["armed", "rang", "cooling", "unread", "learning", "paused"] as const;

export const AssistantWatchSchema = z
  .object({
    id: z.string().regex(/^wch_[0-9a-f]{24}$/),
    version: z.number().int().min(1),
    mint: Address,
    symbol: z.string().min(1).max(32),
    rule: AssistantWatchRuleSchema,
    /** The rule in the reader's language: «Падіння на 10 % за добу». */
    ruleText: z.string().min(1).max(120),
    status: z.enum(["active", "paused"]),
    cooldownMinutes: z.number().int().min(5).max(1_440),
    channels: z.object({ telegram: z.boolean(), push: z.boolean() }).strict(),
    now: z
      .object({
        state: z.enum(ASSISTANT_WATCH_STATES),
        /** The figure the rule reads now, in the reader's language («−3,2 % за добу», «$182,40»); null where it was not read. */
        text: z.string().max(80).nullable(),
        source: z.string().max(32).nullable(),
        observedAt: Iso.nullable(),
      })
      .strict(),
    /** The latest note: its words in the reader's language and its id in the inbox. */
    last: z.object({ at: Iso, title: z.string().min(1).max(160), reason: z.string().min(1).max(400), inboxId: z.string().regex(/^inb_[0-9a-f]{24}$/) }).strict().nullable(),
    /** «Чому?»: the question put to the assistant, only when the person asks it, at `priceCredits`; null before the first note. */
    explain: z.object({ question: z.string().min(1).max(400), priceCredits: z.number().int().min(0) }).strict().nullable(),
    createdAt: Iso,
    updatedAt: Iso,
  })
  .strict();
export type AssistantWatch = z.infer<typeof AssistantWatchSchema>;

export const AssistantWatchesResponseSchema = z
  .object({
    watches: z.array(AssistantWatchSchema).max(20),
    /** Three watches are free; that is the ceiling for now. */
    limit: z.object({ free: z.number().int().min(0), used: z.number().int().min(0), left: z.number().int().min(0) }).strict(),
    presets: z.array(z.object({ id: z.enum(ASSISTANT_WATCH_PRESETS), text: z.string().min(1).max(60) }).strict()).max(12),
    /** What «Чому?» costs in credits — asked only when the person presses it. */
    explainPriceCredits: z.number().int().min(0),
    /** Where notes go: the inbox always, Telegram and push as Нагляд's preferences say. */
    channels: z.object({ inbox: z.literal(true), telegram: z.boolean(), push: z.boolean() }).strict(),
    deliveriesPerHour: z.number().int().min(1),
  })
  .strict();
export type AssistantWatchesResponse = z.infer<typeof AssistantWatchesResponseSchema>;

const WatchChannels = z.object({ telegram: z.boolean(), push: z.boolean() }).strict();

/** `POST /api/v1/assistant/watches` — a token by mint and a preset or a rule; the notes in `locale`. */
export const AssistantWatchCreateSchema = z
  .object({
    mint: Address,
    preset: z.enum(ASSISTANT_WATCH_PRESETS).optional(),
    rule: AssistantWatchRuleSchema.optional(),
    cooldownMinutes: z.number().int().min(5).max(1_440).default(60),
    channels: WatchChannels.default({ telegram: true, push: true }),
    locale: z.enum(["en", "uk"]).default("uk"),
  })
  .strict()
  .refine((body) => (body.preset === undefined) !== (body.rule === undefined), { message: "Name a preset or a rule, one of the two." });
export type AssistantWatchCreate = z.input<typeof AssistantWatchCreateSchema>;

/** `PATCH /api/v1/assistant/watches/{id}` — pause, resume or change; a changed rule starts afresh. */
export const AssistantWatchUpdateSchema = z
  .object({
    ifVersion: z.number().int().min(1).optional(),
    status: z.enum(["active", "paused"]).optional(),
    rule: AssistantWatchRuleSchema.optional(),
    cooldownMinutes: z.number().int().min(5).max(1_440).optional(),
    channels: WatchChannels.optional(),
  })
  .strict();
export type AssistantWatchUpdate = z.infer<typeof AssistantWatchUpdateSchema>;

/* ---- 1.58.0 — «Знайомство» (AI-06) */

export const ASSISTANT_GOALS = ["learn", "trade", "hold"] as const;
export const ASSISTANT_EXPERIENCE = ["new", "some", "pro"] as const;
export const ASSISTANT_HORIZONS = ["hours", "days", "weeks"] as const;
/** The risk per trade a person names, in per cent of what they trade with; 1 % unless they pick another. */
export const ASSISTANT_RISK_PCTS = [0.5, 1, 2] as const;

const ProfileRisk = z.union([z.literal(0.5), z.literal(1), z.literal(2)]);
const ProfileQuietHours = z.object({ start: ClockTime, end: ClockTime, timezone: z.string().min(1).max(64) }).strict();

/** The five answers; `skipped` — the person pressed «Пропустити» and the answers are null. */
export const AssistantProfileSchema = z
  .object({
    skipped: z.boolean(),
    goal: z.enum(ASSISTANT_GOALS).nullable(),
    experience: z.enum(ASSISTANT_EXPERIENCE).nullable(),
    riskPct: ProfileRisk.nullable(),
    horizon: z.enum(ASSISTANT_HORIZONS).nullable(),
    updatedAt: Iso,
  })
  .strict();
export type AssistantProfile = z.infer<typeof AssistantProfileSchema>;

export const AssistantProfileResponseSchema = z
  .object({
    /** Null until the person answers or skips: the assistant then asks the five questions. */
    profile: AssistantProfileSchema.nullable(),
    /** Where notes go — Нагляд's preferences, the same the monitoring settings show: the inbox always. */
    delivery: z.object({ inbox: z.literal(true), telegram: z.boolean(), push: z.boolean(), quietHours: ProfileQuietHours.nullable() }).strict(),
  })
  .strict();
export type AssistantProfileResponse = z.infer<typeof AssistantProfileResponseSchema>;

const ProfileDelivery = z.object({ telegram: z.boolean(), push: z.boolean(), quietHours: ProfileQuietHours.nullable() }).strict();

/** `PUT /api/v1/assistant/profile` — the four answers, or `{ "skipped": true }`; `delivery` also writes where notes go. */
export const AssistantProfileUpdateSchema = z.union([
  z
    .object({
      goal: z.enum(ASSISTANT_GOALS),
      experience: z.enum(ASSISTANT_EXPERIENCE),
      riskPct: ProfileRisk,
      horizon: z.enum(ASSISTANT_HORIZONS),
      delivery: ProfileDelivery.optional(),
    })
    .strict(),
  z.object({ skipped: z.literal(true) }).strict(),
]);
export type AssistantProfileUpdate = z.infer<typeof AssistantProfileUpdateSchema>;

/* ---- 1.59.0 — what Ryntra knows about the person (AI-18) */

export const ASSISTANT_MEMORY_NOTES_MAX = 30;
export const ASSISTANT_MEMORY_NOTE_MAX = 160;
export const ASSISTANT_MEMORY_ABOUT_MAX = 600;

/** One thing Ryntra keeps about the person, in their own words: noticed in the conversation, asked for, or typed. */
export const AssistantMemoryNoteSchema = z
  .object({
    id: z.string().regex(/^m_[0-9a-f]{12}$/),
    text: z.string().min(2).max(ASSISTANT_MEMORY_NOTE_MAX),
    source: z.enum(["said", "asked", "typed"]),
    at: Iso,
  })
  .strict();
export type AssistantMemoryNote = z.infer<typeof AssistantMemoryNoteSchema>;

/** What the wallet shows, read now — never kept: the count of tokens and the largest by value. */
export const AssistantWalletPictureSchema = z
  .object({
    state: z.enum(["current", "unavailable"]),
    tokens: z.number().int().min(0).nullable(),
    largest: z.array(z.object({ symbol: z.string().min(1).max(16), mint: z.string().min(32).max(44) }).strict()).max(5),
  })
  .strict();
export type AssistantWalletPicture = z.infer<typeof AssistantWalletPictureSchema>;

export const AssistantMemoryResponseSchema = z
  .object({
    /** «Про мене» in the person's own words; null until written. */
    about: z.string().max(ASSISTANT_MEMORY_ABOUT_MAX).nullable(),
    /** Whether Ryntra keeps what it notices about the person in the conversation. */
    noticing: z.boolean(),
    notes: z.array(AssistantMemoryNoteSchema).max(ASSISTANT_MEMORY_NOTES_MAX),
    /** The answers of «Знайомство» (1.58.0), as they are. */
    profile: AssistantProfileSchema.nullable(),
    wallet: AssistantWalletPictureSchema,
    updatedAt: Iso.nullable(),
  })
  .strict();
export type AssistantMemoryResponse = z.infer<typeof AssistantMemoryResponseSchema>;

/** `PUT /api/v1/assistant/memory` — «Про мене», whether to notice, or one note typed by hand; each optional. */
export const AssistantMemoryUpdateSchema = z
  .object({
    about: z.string().max(ASSISTANT_MEMORY_ABOUT_MAX).nullable().optional(),
    noticing: z.boolean().optional(),
    note: z.string().min(2).max(ASSISTANT_MEMORY_NOTE_MAX).optional(),
  })
  .strict()
  .refine((body) => body.about !== undefined || body.noticing !== undefined || body.note !== undefined, { message: "Nothing to change." });
export type AssistantMemoryUpdate = z.infer<typeof AssistantMemoryUpdateSchema>;

/* ---- 1.59.0 — «Доручення» (AI-19): a question the server asks on a schedule, its answer to the inbox, Telegram and push */

export const ASSISTANT_TASK_EVERY = ["10m", "30m", "1h", "1d"] as const;
export const ASSISTANT_TASKS_MAX = 5;
const TaskMint = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);

export const AssistantTaskAskSchema = z.discriminatedUnion("kind", [
  /** The person's own question, asked as typed. */
  z.object({ kind: z.literal("question"), text: z.string().min(3).max(300) }).strict(),
  z.object({ kind: z.literal("news"), mint: TaskMint, symbol: z.string().min(1).max(16) }).strict(),
  z.object({ kind: z.literal("move"), mint: TaskMint, symbol: z.string().min(1).max(16) }).strict(),
  z.object({ kind: z.literal("portfolio") }).strict(),
]);
export type AssistantTaskAsk = z.infer<typeof AssistantTaskAskSchema>;

const TaskChannels = z.object({ telegram: z.boolean(), push: z.boolean() }).strict();
/** A time zone the server can compute a day in — an unknown one is refused, never a failed run. */
const TaskZone = z
  .string()
  .min(1)
  .max(64)
  .refine((zone) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: zone });
      return true;
    } catch {
      return false;
    }
  }, "Unknown time zone.");

export const AssistantTaskSchema = z
  .object({
    id: z.string().regex(/^t_[0-9a-f]{12}$/),
    ask: AssistantTaskAskSchema,
    /** «Новини SOL», «Рух ціни JUP», «Мій портфель», or the question's first words. */
    name: z.string().min(1).max(80),
    every: z.enum(ASSISTANT_TASK_EVERY),
    /** For `1d`: the time on the person's clock (`zone`). */
    time: ClockTime.nullable(),
    zone: z.string().min(1).max(64),
    /** «кожні 10 хв», «щодня о 09:00» — in the task's language. */
    rhythm: z.string().min(1).max(40),
    onlyWhenNew: z.boolean(),
    channels: TaskChannels,
    status: z.enum(["active", "paused"]),
    /** `price` — the price of a question rose above the one shown: «Продовжити» shows the new one. */
    pausedBy: z.enum(["person", "credits", "price"]).nullable(),
    /** One run costs one question with the model, at the price shown when it was turned on. */
    priceCredits: z.number().int().min(0),
    perDayCredits: z.number().int().min(0),
    nextRunAt: Iso.nullable(),
    /** A slot passed today because every wallet's tasks spent their share of the deployment's day; null once it runs again. */
    skippedAt: Iso.nullable(),
    last: z.object({ at: Iso, headline: z.string().max(200), delivered: z.boolean() }).strict().nullable(),
    runs: z.number().int().min(0),
    /** The assistant's page with this task's conversation. */
    href: z.string().startsWith("/app/ryn"),
    /** The conversation the runs are written into — opened by `href`; null before the first run. */
    sessionId: z.string().min(1).max(80).nullable(),
    version: z.number().int().min(1),
  })
  .strict();
export type AssistantTask = z.infer<typeof AssistantTaskSchema>;

export const AssistantTasksResponseSchema = z
  .object({
    tasks: z.array(AssistantTaskSchema).max(ASSISTANT_TASKS_MAX),
    limit: z.number().int().min(1),
    /** The price of one run now, in credits — what `acceptCredits` must say. */
    pricePerRun: z.number().int().min(0),
    /** `fits` — a new task at this rhythm stays within `runs.cap`. */
    rhythms: z.array(z.object({ every: z.enum(ASSISTANT_TASK_EVERY), runsPerDay: z.number().int().min(1), perDayCredits: z.number().int().min(0), fits: z.boolean() }).strict()),
    /** How many runs a day the active tasks take together (`used`) and may take (`cap`) — the person's own questions keep the rest. */
    runs: z.object({ used: z.number().int().min(0), cap: z.number().int().min(0) }).strict(),
  })
  .strict();
export type AssistantTasksResponse = z.infer<typeof AssistantTasksResponseSchema>;

/** `POST /api/v1/assistant/tasks` — a new task; `acceptCredits` is the price of a run the client showed. */
export const AssistantTaskCreateSchema = z
  .object({
    ask: AssistantTaskAskSchema,
    every: z.enum(ASSISTANT_TASK_EVERY),
    time: ClockTime.optional(),
    zone: TaskZone.default("Europe/Kyiv"),
    locale: z.enum(["en", "uk"]).default("uk"),
    onlyWhenNew: z.boolean().default(true),
    channels: TaskChannels,
    acceptCredits: z.number().int().min(0).max(1_000),
  })
  .strict();
export type AssistantTaskCreate = z.infer<typeof AssistantTaskCreateSchema>;

/** `PATCH /api/v1/assistant/tasks/<id>` — pause, resume (at the price shown), the rhythm, the channels, «лише коли є що сказати». */
export const AssistantTaskUpdateSchema = z
  .object({
    ifVersion: z.number().int().min(1),
    status: z.enum(["active", "paused"]).optional(),
    every: z.enum(ASSISTANT_TASK_EVERY).optional(),
    time: ClockTime.optional(),
    channels: TaskChannels.optional(),
    onlyWhenNew: z.boolean().optional(),
    acceptCredits: z.number().int().min(0).max(1_000).optional(),
  })
  .strict();
export type AssistantTaskUpdate = z.infer<typeof AssistantTaskUpdateSchema>;

/* ---- 1.59.0 — push to a computer's browser (AI-19, Web Push without a payload) */

export const AssistantPushStateSchema = z
  .object({
    /** Whether this deployment has its VAPID key: without it a browser cannot subscribe, and the inbox and Telegram carry every note. */
    configured: z.boolean(),
    /** The application server key a browser subscribes with (base64url, the uncompressed P-256 point); null when not configured. */
    publicKey: z.string().min(80).max(100).nullable(),
    /** How many browsers of this wallet receive push now. */
    browsers: z.number().int().min(0),
    /**
     * Whether the browser that asked is one of them — `GET` with the header `x-ryntra-push-endpoint` (its subscription's
     * endpoint, never in the URL), `POST` / `DELETE` for the endpoint sent; null when no endpoint was given.
     */
    thisBrowser: z.boolean().nullable(),
  })
  .strict();
export type AssistantPushState = z.infer<typeof AssistantPushStateSchema>;

/** `POST` / `DELETE /api/v1/assistant/push` — a browser's push subscription endpoint, as `PushSubscription.endpoint` gives it. */
export const AssistantPushSubscriptionRequestSchema = z.object({ endpoint: z.string().url().max(1_000) }).passthrough();
export type AssistantPushSubscriptionRequest = z.infer<typeof AssistantPushSubscriptionRequestSchema>;

/** `GET /api/v1/assistant/push/latest` — what the service worker shows: the wallet's newest note of the last minutes, or null. */
export const AssistantPushLatestSchema = z
  .object({
    note: z.object({ id: z.string().min(1).max(120), title: z.string().min(1).max(200), body: z.string().max(400), href: z.string().startsWith("/") }).strict().nullable(),
  })
  .strict();
export type AssistantPushLatest = z.infer<typeof AssistantPushLatestSchema>;

/* ---- 1.64.0 — «Голос у вебі» (AI-08) */

/** The longest recording heard on the server, in seconds — and the most one may weigh: 24 KB a second of it. */
export const ASSISTANT_VOICE_MAX_SECONDS = 120;
export const ASSISTANT_VOICE_MAX_BYTES = ASSISTANT_VOICE_MAX_SECONDS * 24 * 1024;
/** That many bytes in base64. */
export const ASSISTANT_VOICE_MAX_BASE64 = Math.ceil(ASSISTANT_VOICE_MAX_BYTES / 3) * 4;

/** `POST /api/v1/assistant/voice` — a recording for the question field; `acceptCredits` is the price the client showed. */
export const AssistantVoiceRequestSchema = z
  .object({
    /** The recording's own id — a UUID the client makes when it stops; sent again, it is answered with the same words. */
    id: z.string().uuid(),
    audio: z.string().min(16).max(ASSISTANT_VOICE_MAX_BASE64).regex(/^[A-Za-z0-9+/]+={0,2}$/),
    /** The recorder's type: `audio/webm;codecs=opus`, `audio/ogg;codecs=opus`, `audio/mp4`… */
    mime: z.string().min(7).max(80).regex(/^audio\/[a-z0-9.+-]+(?:;\s*codecs="?[a-z0-9.,+ -]+"?)?$/i),
    seconds: z.number().int().min(1).max(ASSISTANT_VOICE_MAX_SECONDS),
    locale: z.enum(["en", "uk"]).default("uk"),
    acceptCredits: z.number().int().min(0).max(1_000),
  })
  .strict();
export type AssistantVoiceRequest = z.infer<typeof AssistantVoiceRequestSchema>;

/** The words heard — for the field, never asked by themselves — what they cost, and the credits after. */
export const AssistantVoiceResponseSchema = z
  .object({
    text: z.string().min(1).max(2_000),
    seconds: z.number().int().min(1).max(ASSISTANT_VOICE_MAX_SECONDS),
    spent: CreditCount,
    /** How many of `spent` were the day's free credits. */
    free: CreditCount,
    /** The recording was heard before: these are its words, and nothing was charged this time. */
    repeat: z.boolean(),
    /** The credits after; null when they could not be read again — the client reads them itself then. */
    credits: AssistantCreditsSchema.nullable(),
  })
  .strict();
export type AssistantVoiceResponse = z.infer<typeof AssistantVoiceResponseSchema>;
/* ---- 1.61.0 — «План угоди й критик» (AI-11) */

/**
 * A trade plan Ryntra composes with the person and a critic argues with
 * (`lib/assistant/plans/`). It is a structure, never text in a conversation:
 * the thesis, the entry, where the thesis is wrong, the person's own loss
 * limit and budget, up to three targets, the fees and the size the plan
 * engine computes, every assumption with who made it, and the sources read.
 * Every change is a new version; the critic's findings stand on the version
 * they were written for. The plan never trades: approving it writes the
 * person's own Trading Plan (`/api/v1/plans`), which Нагляд watches, and the
 * Review before any signature stays where it is.
 */
export const ASSISTANT_PLAN_ID = /^apl_[0-9a-f]{24}$/;
/** `draft` — composed, the critic has not checked this version; `checked` — it has; `approved` — the person approved it and it is their plan, not watched; `watching` — Нагляд watches it; `done` — the position it opened is closed; `cancelled`; `broken` — the price reached the invalidation: the thesis is wrong. */
export const ASSISTANT_PLAN_STATES = ["draft", "checked", "approved", "watching", "done", "cancelled", "broken"] as const;
export type AssistantPlanState = (typeof ASSISTANT_PLAN_STATES)[number];
/** Who set a level or an assumption: the person, Ryntra (a proposal the person replaces), the market read, or the plan engine's rule. */
export const ASSISTANT_PLAN_AUTHORS = ["person", "ryntra", "market", "rules"] as const;
/** Why a plan stands where it stands, when the state alone does not say: the invalidation reached, the entry window passed, the position closed, the person's own word. */
export const ASSISTANT_PLAN_REASONS = ["invalidation", "expired", "position-closed", "person"] as const;
export const ASSISTANT_PLAN_EVENTS = ["created", "edited", "checked", "approved", "watching", "synced", "broken", "done", "cancelled"] as const;
/** A critic's finding is of one kind — what a person about to act will not look for themselves. */
export const ASSISTANT_PLAN_FINDING_KINDS = ["fees", "loss-scenario", "contradiction", "level", "thesis", "data", "size", "liquidity"] as const;
export const ASSISTANT_PLAN_FIELDS = ["thesis", "entry", "invalidation", "lossLimit", "targets", "fees", "sizing", "sources"] as const;
export const ASSISTANT_PLAN_VERSIONS_LIMIT = 50;
export const ASSISTANT_PLANS_LIMIT = 20;

const PlanAuthor = z.enum(ASSISTANT_PLAN_AUTHORS);
const PlanWhy = z.string().min(1).max(300);

export const AssistantPlanLevelSchema = z.object({ priceUsd: Usd, by: PlanAuthor, why: PlanWhy.nullable() }).strict();
export type AssistantPlanLevel = z.infer<typeof AssistantPlanLevelSchema>;

/**
 * The fees and the loss as the plan engine estimates them — never a quote.
 * Ryntra's fee is the flow's under fee policy 2.0.0 (a major 0.10 %, a
 * verified token 0.50 %, a new one 1.00 %), counted in and out; the cost
 * buffer is the plan's own (slippage and price impact); the network's fee
 * is a small fixed estimate. `lossAtInvalidationUsd` is what the sized
 * position loses at the invalidation with every cost; `rewardAtTargetUsd`
 * what it makes at the first target after them; `rewardToRisk` their ratio.
 */
export const AssistantPlanFeesSchema = z
  .object({
    model: z.literal("estimate-v1"),
    feePolicy: z.string().min(1).max(16),
    ryntraFeeBps: z.number().int().min(0).max(1_000),
    costBufferBps: z.number().int().min(0).max(2_000),
    notionalUsd: UsdOrZero,
    ryntraFeeUsd: UsdOrZero,
    costBufferUsd: UsdOrZero,
    networkUsd: UsdOrZero,
    totalUsd: UsdOrZero,
    lossAtInvalidationUsd: UsdOrZero,
    rewardAtTargetUsd: z.number().finite(),
    rewardToRisk: z.number().finite().min(0).nullable(),
  })
  .strict();
export type AssistantPlanFees = z.infer<typeof AssistantPlanFeesSchema>;

export const AssistantPlanSourceSchema = z
  .object({ id: z.string().min(1).max(16), source: z.string().min(1).max(80), observedAt: Iso, state: z.enum(AGENT_STATES), href: z.string().max(512).nullable() })
  .strict();

/** One version's plan. `lossLimit` is always the person's own money — a model never writes it. */
export const AssistantPlanBodySchema = z
  .object({
    thesis: z.object({ text: z.string().min(1).max(600), whyNow: z.string().max(300).nullable(), horizonDays: z.number().int().min(1).max(365).nullable(), by: PlanAuthor }).strict(),
    entry: z.object({ priceUsd: Usd, maxPriceUsd: Usd, validUntil: Iso, condition: z.string().max(300).nullable(), by: PlanAuthor }).strict(),
    invalidation: AssistantPlanLevelSchema,
    lossLimit: z.object({ riskUsd: Usd, budgetUsd: Usd }).strict(),
    targets: z.array(AssistantPlanLevelSchema).min(1).max(3),
    fees: AssistantPlanFeesSchema,
    sizing: PlanSizingSchema,
    assumptions: z.array(z.object({ text: Sentence, by: PlanAuthor }).strict()).max(12),
    sources: z.array(AssistantPlanSourceSchema).max(12),
  })
  .strict();
export type AssistantPlanBody = z.infer<typeof AssistantPlanBodySchema>;

export const AssistantPlanFindingSchema = z
  .object({
    id: z.string().min(1).max(32),
    severity: z.enum(["major", "minor", "note"]),
    kind: z.enum(ASSISTANT_PLAN_FINDING_KINDS),
    field: z.enum(ASSISTANT_PLAN_FIELDS),
    text: Sentence,
    cites: z.array(z.string().min(1).max(16)).max(6),
    /** `rules` — the plan engine's own check, the same on every read; `model` — the critic's. */
    by: z.enum(["rules", "model"]),
  })
  .strict();
export type AssistantPlanFinding = z.infer<typeof AssistantPlanFindingSchema>;

/** The critic on one version: the rules' checks always, the strong model's findings when it ran (`by: "model"`). Silence is never agreement: `gaps` says what was not challenged. */
export const AssistantPlanCriticSchema = z
  .object({
    by: z.enum(["rules", "model"]),
    model: z.string().max(64).nullable(),
    findings: z.array(AssistantPlanFindingSchema).max(16),
    summary: Sentence.nullable(),
    gaps: z.array(Sentence).max(6),
    checkedAt: Iso,
  })
  .strict();
export type AssistantPlanCritic = z.infer<typeof AssistantPlanCriticSchema>;

export const AssistantPlanVersionSchema = z
  .object({
    n: z.number().int().min(1),
    body: AssistantPlanBodySchema,
    critic: AssistantPlanCriticSchema,
    createdAt: Iso,
    /** Who wrote the version: Ryntra composed it, the person edited it here, or the person edited their plan on its own page (`plan-page`). */
    by: z.enum(["ryntra", "person", "plan-page"]),
    reason: z.string().max(240).nullable(),
    /** The Trading Plan's version this one is, once the plan was approved. */
    tradingPlanVersion: z.number().int().min(1).nullable(),
  })
  .strict();
export type AssistantPlanVersion = z.infer<typeof AssistantPlanVersionSchema>;

/**
 * One trade of the plan against the plan — «План проти реальності» — and
 * what its receipt says in words: what was paid, at what price against the
 * plan's entry and its bound, the size against the sized one, the fees, and
 * what the position risks now against the person's loss limit.
 */
export const AssistantPlanTradeSchema = z
  .object({
    signature: z.string().min(64).max(128),
    at: Iso,
    side: z.enum(["BUY", "SELL"]).nullable(),
    outcome: z.enum(["DONE", "FAILED", "UNKNOWN"]),
    planned: z.object({ priceUsd: Usd, maxPriceUsd: Usd.nullable(), units: Units }).strict(),
    actual: z.object({ priceUsd: Usd.nullable(), units: z.number().finite().min(0).nullable(), usd: UsdOrZero.nullable(), feeUsd: UsdOrZero.nullable() }).strict(),
    /** The fill's price against the plan's entry, per cent; null where the fill's price is not known. */
    priceDeviationPct: z.number().finite().nullable(),
    sizeDeviationPct: z.number().finite().nullable(),
    verdict: z.enum(["followed", "deviated", "unknown"]),
    /** The receipt in words — two lines at most each. */
    receipt: z.array(Sentence).max(4),
    /** The risk of the trade now, in words: the loss at the invalidation against the limit. */
    risk: z.array(Sentence).max(3),
    receiptHash: z.string().max(80).nullable(),
  })
  .strict();
export type AssistantPlanTrade = z.infer<typeof AssistantPlanTradeSchema>;

export const AssistantPlanRealitySchema = z
  .object({
    trades: z.array(AssistantPlanTradeSchema).max(20),
    position: z.object({ state: z.enum(["open", "closed", "none"]), unitsHeld: z.number().finite().min(0).nullable(), costBasisUsd: UsdOrZero.nullable(), realisedUsd: z.number().finite().nullable() }).strict(),
    summary: z.array(Sentence).max(4),
    /** Whether every trade History holds under the plan is on it yet. */
    complete: z.boolean(),
  })
  .strict();
export type AssistantPlanReality = z.infer<typeof AssistantPlanRealitySchema>;

export const AssistantPlanSchema = z
  .object({
    id: z.string().regex(ASSISTANT_PLAN_ID),
    mint: Address,
    symbol: z.string().min(1).max(32),
    state: z.enum(ASSISTANT_PLAN_STATES),
    stateReason: z.enum(ASSISTANT_PLAN_REASONS).nullable(),
    /** The current version's number — also the `ifVersion` a change must name. */
    version: z.number().int().min(1),
    current: AssistantPlanVersionSchema,
    versions: z.array(z.object({ n: z.number().int().min(1), createdAt: Iso, by: z.enum(["ryntra", "person", "plan-page"]), reason: z.string().max(240).nullable(), critic: z.enum(["rules", "model"]) }).strict()).min(1).max(ASSISTANT_PLAN_VERSIONS_LIMIT),
    journal: z.array(z.object({ at: Iso, event: z.enum(ASSISTANT_PLAN_EVENTS), version: z.number().int().min(1), note: z.string().max(240).nullable() }).strict()).min(1).max(200),
    /** The person's Trading Plan once they approved: its page holds the Review. */
    tradingPlan: z.object({ id: z.string().regex(PLAN_ID), status: z.enum(PLAN_STATUSES), version: z.number().int().min(1), href: z.string().min(1).max(200) }).strict().nullable(),
    /** What Нагляд says of the plan now; `none` before it is watched. */
    watch: z.object({ status: z.enum(["none", "watching", "needs_attention", "paused", "unavailable"]), lastCheckedAt: Iso.nullable(), line: z.string().max(240).nullable() }).strict(),
    reality: AssistantPlanRealitySchema.nullable(),
    /** What the person may do now; the server refuses the rest. */
    actions: z.object({ approve: z.boolean(), watch: z.boolean(), edit: z.boolean(), recheck: z.boolean(), cancel: z.boolean() }).strict(),
    createdAt: Iso,
    updatedAt: Iso,
  })
  .strict();
export type AssistantPlan = z.infer<typeof AssistantPlanSchema>;

const PlanPrices = z.object({ plan: z.number().int().min(0), recheck: z.number().int().min(0) }).strict();

export const AssistantPlanResponseSchema = z
  .object({
    plan: AssistantPlanSchema,
    /** What a plan with its critic and a re-check cost in credits — shown before the press. */
    prices: PlanPrices,
    /** What the call spent: the credits taken and whether the strong model ran for the plan and for the critic. */
    spent: z.object({ credits: z.number().int().min(0), architect: z.enum(["model", "rules"]), critic: z.enum(["model", "rules"]) }).strict().nullable(),
    budget: AgentBudgetStateSchema.nullable(),
  })
  .strict();
export type AssistantPlanResponse = z.infer<typeof AssistantPlanResponseSchema>;

export const AssistantPlansResponseSchema = z
  .object({
    plans: z.array(AssistantPlanSchema).max(ASSISTANT_PLANS_LIMIT),
    prices: PlanPrices,
    budget: AgentBudgetStateSchema.nullable(),
  })
  .strict();
export type AssistantPlansResponse = z.infer<typeof AssistantPlansResponseSchema>;

const PersonLevels = {
  entryUsd: Usd.nullable().default(null),
  maxPriceUsd: Usd.nullable().default(null),
  invalidationUsd: Usd.nullable().default(null),
  targetsUsd: z.array(Usd).max(3).default([]),
};

/**
 * `POST /api/v1/assistant/plans` — compose a plan with its critic: the
 * token by mint, the person's idea in their words, their loss limit and
 * budget, any level they already know; or a draft the conversation made
 * (`draftId`), whose figures stand in for the ones not given. The price
 * (`prices.plan`) is held before the strong model runs and taken only when
 * a plan came back — `acceptCredits` is the price the person was shown.
 */
export const AssistantPlanCreateSchema = z
  .object({
    mint: Address,
    idea: z.string().min(1).max(600),
    riskUsd: Usd.nullable().default(null),
    budgetUsd: Usd.nullable().default(null),
    ...PersonLevels,
    horizonDays: z.number().int().min(1).max(365).nullable().default(null),
    draftId: z.string().regex(AGENT_DRAFT_ID).nullable().default(null),
    acceptCredits: z.number().int().min(0).max(100_000).nullable().default(null),
    locale: z.enum(["en", "uk"]).default("uk"),
  })
  .strict();
export type AssistantPlanCreate = z.input<typeof AssistantPlanCreateSchema>;

/** `PUT /api/v1/assistant/plans/{id}` — the person's change: a new version, checked by the rules; the critic again only on `POST …/critic`. */
export const AssistantPlanUpdateSchema = z
  .object({
    ifVersion: z.number().int().min(1),
    thesis: z.string().min(1).max(600).optional(),
    entryUsd: Usd.optional(),
    maxPriceUsd: Usd.optional(),
    invalidationUsd: Usd.optional(),
    targetsUsd: z.array(Usd).min(1).max(3).optional(),
    riskUsd: Usd.optional(),
    budgetUsd: Usd.optional(),
    reason: z.string().max(240).nullable().default(null),
    locale: z.enum(["en", "uk"]).default("uk"),
  })
  .strict();
export type AssistantPlanUpdate = z.input<typeof AssistantPlanUpdateSchema>;

/** `POST /api/v1/assistant/plans/{id}/critic` — the strong model's critic again on the current version, at `prices.recheck`. */
export const AssistantPlanRecheckSchema = z
  .object({ ifVersion: z.number().int().min(1), acceptCredits: z.number().int().min(0).max(100_000).nullable().default(null), locale: z.enum(["en", "uk"]).default("uk") })
  .strict();
export type AssistantPlanRecheck = z.input<typeof AssistantPlanRecheckSchema>;

/**
 * `POST /api/v1/assistant/plans/{id}/state` — the person's word: `approved`
 * writes their Trading Plan from the current version as a draft, `watching`
 * makes it active so Нагляд watches it, `cancelled` ends the plan (and
 * cancels their Trading Plan while it has no trade).
 */
export const AssistantPlanStateRequestSchema = z
  .object({ to: z.enum(["approved", "watching", "cancelled"]), ifVersion: z.number().int().min(1), locale: z.enum(["en", "uk"]).default("uk") })
  .strict();
export type AssistantPlanStateRequest = z.input<typeof AssistantPlanStateRequestSchema>;

export const AgentSessionResponseSchema = z
  .object({
    session: AgentSessionSchema,
    budget: AgentBudgetStateSchema,
    suggestions: z.array(AgentSuggestionSchema).max(8),
  })
  .strict();
export type AgentSessionResponse = z.infer<typeof AgentSessionResponseSchema>;

export const AgentMessageRequestSchema = z
  .object({
    sessionId: z.string().regex(AGENT_SESSION_ID),
    text: z.string().min(1).max(AGENT_QUESTION_MAX),
    locale: z.enum(["en", "uk"]).default("en"),
    /** 1.52.0: the price in credits the client showed before the question; absent, only the day's free credits are spent. */
    acceptCredits: z.number().int().min(0).max(100_000).optional(),
    /** 1.59.0: the person typed these words in the field — only typed words may be kept in the memory (AI-18), never a link's or a starter's. */
    typed: z.boolean().optional(),
  })
  .strict();
export type AgentMessageRequest = z.input<typeof AgentMessageRequestSchema>;

export const AgentMessageResponseSchema = z
  .object({
    sessionId: z.string().regex(AGENT_SESSION_ID),
    person: AgentTurnSchema,
    ryn: AgentTurnSchema,
    budget: AgentBudgetStateSchema,
  })
  .strict();
export type AgentMessageResponse = z.infer<typeof AgentMessageResponseSchema>;

const AgentDraftCardSchema = z.discriminatedUnion("kind", [AgentPlanDraftCardSchema, AgentMonitoringDraftCardSchema, AgentTradeDraftCardSchema]);
export type AgentDraftCard = z.infer<typeof AgentDraftCardSchema>;

export const AgentDraftResponseSchema = z
  .object({
    draft: AgentDraftCardSchema,
    sessionId: z.string().regex(AGENT_SESSION_ID),
    turnId: z.string().regex(AGENT_TURN_ID),
    createdAt: Iso,
    /** After this moment the draft is gone; the builder keeps what it opened. */
    expiresAt: Iso,
  })
  .strict();
export type AgentDraftResponse = z.infer<typeof AgentDraftResponseSchema>;

export const AgentSuggestionsResponseSchema = z.object({ context: AgentContextSchema.nullable(), suggestions: z.array(AgentSuggestionSchema).max(8) }).strict();
export type AgentSuggestionsResponse = z.infer<typeof AgentSuggestionsResponseSchema>;

/* ------------------------------------------------------------ the lens routes (1.10.0) */

/**
 * 1.10.0: `POST /api/v1/agent/brief` and `POST /api/v1/agent/critic` — the
 * two formats on a subject, for a surface that is not a conversation. The
 * subject is the same `AgentContext` a conversation is opened from, so an
 * asset, a plan, the portfolio, a monitoring note and a page all read the
 * same way in both places.
 *
 * `compose` is the budget's boundary said in the request: `deterministic`
 * (the default) never reaches a model and never spends, so a surface may
 * render a Brief on load; `model` asks the configured model to word the
 * same reads **under the wallet's existing agent allowance** — the same
 * counters, the same in-flight lease, the same receipt. There is no second
 * allowance anywhere in this contract.
 */
export const AgentLensRequestSchema = z
  .object({
    subject: AgentContextSchema,
    locale: z.enum(["en", "uk"]).default("en"),
    compose: z.enum(["deterministic", "model"]).default("deterministic"),
    /** 1.52.0: with `compose: "model"`, the price in credits the client showed; absent, only the day's free credits are spent. */
    acceptCredits: z.number().int().min(0).max(100_000).optional(),
  })
  .strict();
export type AgentLensRequest = z.input<typeof AgentLensRequestSchema>;

const AgentLensShape = {
  subject: AgentContextSchema,
  /** One line naming what the format is about — an asset, a plan, the portfolio. */
  title: Words,
  cards: z.array(AgentCardSchema).max(AGENT_CARDS_MAX),
  citations: z.array(AgentCitationSchema).max(AGENT_CITATIONS_MAX),
  handoffs: z.array(AgentHandoffSchema).max(6),
  tools: z.array(AgentToolOutcomeSchema).max(16),
  composedBy: z.enum(["model", "deterministic"]),
  budget: AgentBudgetStateSchema,
  observedAt: Iso,
} as const;

export const AgentBriefResponseSchema = z.object({ format: z.literal("brief"), brief: AgentBriefSchema, ...AgentLensShape }).strict();
export type AgentBriefResponse = z.infer<typeof AgentBriefResponseSchema>;

export const AgentCriticResponseSchema = z.object({ format: z.literal("critic"), critic: AgentCriticSchema, ...AgentLensShape }).strict();
export type AgentCriticResponse = z.infer<typeof AgentCriticResponseSchema>;

/* ------------------------------------------------------------ the consumed routes: shared parts (1.11.0) */

/**
 * 1.11.0: the routes the web and the native client already consume outside
 * `/api/v1` — markets, stocks, holdings, activity, receipts, rewards,
 * monitoring, predictions and the swap — described as they are served.
 * Nothing about a route changed to be described; the schemas are the routes'
 * own shapes, proven equal to the types the routes build their answers from
 * (`lib/api/v1/route-types.test.ts`) and parsed against their answers in the
 * routes' tests. They are not v1 paths: they do not take the `X-Ryntra-API`
 * major or answer the version header, and their errors are their own (below).
 */

/** A time as a provider stated it — an issuer, a feed, the chain — kept verbatim, not guaranteed ISO. */
const ProviderTime = z.string().min(1).max(64);

/**
 * The error of the consumed routes: the v1 envelope with the route's own code
 * and no v1 extras. A provider's failure is named by the route
 * (`MARKETS_RATE_LIMITED`, `CANDLES_NO_POOL`, `UNKNOWN_ASSET`, …); the HTTP
 * status says who failed — 4xx the request or the asset, 429 the rate, 503 the
 * source. Rewards and a few older routes answer other error bodies; their
 * sections say which.
 */
export const RouteErrorSchema = z
  .object({ error: z.object({ code: z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/), message: z.string().min(1).max(2000) }).strict() })
  .strict();
export type RouteError = z.infer<typeof RouteErrorSchema>;

/* ------------------------------------------------------------ the consumed routes: holdings (1.11.0) */

/**
 * 1.11.0: the answer of `POST /api/solana/holdings` — the route the web's
 * Portfolio, the phone's Portfolio and Trade, and the agent's holdings tool
 * all read. Described as it is served since contract 1.1.0; nothing about the
 * route changed. Two facts a client must not assume away: the native SOL row
 * is `kind: "NATIVE_SOL"` with **`mint: null`** (native SOL has no mint; the
 * route prices it through wrapped SOL's catalogue entry), and `tokenRead`
 * decides whether an empty list means *nothing held* (`COMPLETE`) or *nothing
 * known* (`PARTIAL`, `UNAVAILABLE`). Amounts are the chain's raw integers as
 * decimal text and are never summed here.
 */
const RawAmount = z.string().regex(/^[0-9]{1,40}$/);

export const HoldingsSourceAccountSchema = z
  .object({
    address: Address,
    mint: Address,
    tokenProgram: Address,
    amountRaw: RawAmount,
    decimals: z.number().int().min(0).max(255),
    state: z.enum(["INITIALIZED", "FROZEN", "UNKNOWN"]),
    canonical: z.boolean().optional(),
  })
  .strict();

/** The catalogue's word on a held mint, where the catalogue has one; `usdPrice` is decimal text as the catalogue states it. */
export const HoldingsCatalogEntrySchema = z
  .object({
    mint: Address,
    symbol: z.string().max(64).nullable(),
    name: z.string().max(256).nullable(),
    isVerified: z.boolean().nullable(),
    isSuspicious: z.boolean(),
    usdPrice: z.string().max(64).nullable(),
    source: z.object({ ref: z.string().min(1).max(256), label: z.string().min(1).max(256) }).strict(),
    icon: z.string().max(2048).nullable().optional(),
    category: z.string().max(32).nullable().optional(),
    dayChangePct: z.number().nullable().optional(),
    decimals: z.number().int().min(0).max(255).nullable().optional(),
  })
  .strict();

const HoldingsRowShape = {
  amountRaw: RawAmount,
  spendableRaw: RawAmount,
  decimals: z.number().int().min(0).max(255),
  sourceAccounts: z.array(HoldingsSourceAccountSchema).max(1024),
  extensions: z.array(z.string().max(64)).max(64),
  name: z.string().max(256).nullable(),
  symbol: z.string().max(64).nullable(),
  nameAuthority: z.string().max(64).nullable(),
  catalog: HoldingsCatalogEntrySchema.nullable(),
  /**
   * 1.15.0: the Scaled UI Amount multiplier in force for the mint, read from
   * the mint account with its name — the wallet shows `amountRaw × uiMultiplier`
   * and the catalogue's `usdPrice` is per that shown unit (a PreStocks SPACEX
   * is ×5). Absent or null where the mint carries none or was not read; the
   * amount is then as the chain counts it.
   */
  uiMultiplier: z.number().positive().max(1_000_000).nullable().optional(),
} as const;

export const HoldingsNativeRowSchema = z
  .object({ kind: z.literal("NATIVE_SOL"), mint: z.null(), tokenProgram: z.null(), canonicalAta: z.null(), programKind: z.null(), ...HoldingsRowShape })
  .strict();

export const HoldingsTokenRowSchema = z
  .object({ kind: z.literal("TOKEN"), mint: Address, tokenProgram: Address.nullable(), canonicalAta: Address.nullable(), programKind: z.enum(["TOKEN_2022", "SPL_TOKEN", "NOT_A_MINT"]).nullable(), ...HoldingsRowShape })
  .strict();

export const HoldingsRowSchema = z.discriminatedUnion("kind", [HoldingsNativeRowSchema, HoldingsTokenRowSchema]);
export type HoldingsRow = z.infer<typeof HoldingsRowSchema>;

export const HoldingsResponseSchema = z
  .object({
    data: z
      .object({
        owner: Address,
        network: z.enum(["mainnet", "devnet"]),
        lamports: RawAmount,
        /** Native SOL first, always; then the tokens, featured and verified first. */
        holdings: z.array(HoldingsRowSchema).max(4096),
        /** Token accounts with a non-zero balance, native SOL not counted; can exceed the rows because one asset can sit in several accounts. */
        held: z.number().int().min(0),
        tokenRead: z.enum(["COMPLETE", "PARTIAL", "UNAVAILABLE"]),
        /** Asset rows in this answer, native SOL included. */
        returned: z.number().int().min(0),
        /** How many mints were read for their name and program — a cost bound, never a truncation of the inventory. */
        detailed: z.number().int().min(0),
        observedAt: Iso,
        source: z
          .object({
            host: z.string().max(256),
            hosts: z.array(z.string().max(256)).max(8),
            health: z.enum(["HEALTHY", "DEGRADED", "UNAVAILABLE", "UNKNOWN"]),
            detail: z.string().max(512),
          })
          .strict(),
        catalog: z.discriminatedUnion("status", [
          z.object({ status: z.literal("PRESENT"), missing: z.array(z.string().max(64)).max(4096) }).strict(),
          z.object({ status: z.literal("ABSENT"), reason: z.string().max(512) }).strict(),
        ]),
      })
      .strict(),
  })
  .strict();
export type HoldingsResponse = z.infer<typeof HoldingsResponseSchema>;

/** The body `POST /api/solana/holdings` takes: the owner to read and the network, mainnet by default. */
export const HoldingsRequestSchema = z.object({ owner: z.string().min(32).max(44), network: z.enum(["mainnet", "devnet"]).default("mainnet") }).strict();
export type HoldingsRequest = z.input<typeof HoldingsRequestSchema>;

/* ------------------------------------------------------------ the consumed routes: markets (1.11.0) */

/**
 * The Spot reads — `GET /api/spot/markets` (a view, a search or a list of
 * mints), `GET /api/spot/market?mint=` and `GET /api/spot/candles?mint=&tf=`.
 * Public, wallet-free, cached briefly at the edge. Every figure is the
 * venue's (Jupiter's catalogue; GeckoTerminal for candles) under the read's
 * time and `stale`; a figure the venue did not state is `null`, never a zero.
 */
const SpotSymbol = z.string().min(1).max(32);
const SpotName = z.string().min(1).max(128);
const SpotUrl = z.string().url().max(2048);
const SpotTokenProgram = z.string().min(1).max(44);

export const SPOT_CATEGORIES_V1 = ["crypto", "meme", "stock"] as const;
export const SpotIssuerSchema = z.object({ label: z.string().min(1).max(64), tag: z.string().min(1).max(32) }).strict();

/** The compact row every list carries — about a quarter of the whole market. */
export const SpotMarketListRowSchema = z
  .object({
    mint: Address,
    symbol: SpotSymbol,
    name: SpotName,
    icon: SpotUrl.nullable(),
    decimals: z.number().int().min(0).max(18).nullable(),
    tokenProgram: SpotTokenProgram.nullable(),
    price: z.number().nullable(),
    change24hPct: z.number().nullable(),
    volume24hUsd: z.number().nullable(),
    liquidityUsd: z.number().nullable(),
    /** Jupiter's verification as a fact about its list: absent there is *not verified*, never *unknown*. */
    verified: z.boolean(),
    suspicious: z.boolean(),
    category: z.enum(SPOT_CATEGORIES_V1).nullable(),
    issuer: SpotIssuerSchema.nullable(),
  })
  .strict();
export type SpotMarketListRowV1 = z.infer<typeof SpotMarketListRowSchema>;

export const SpotStatsSchema = z
  .object({ priceChangePct: z.number().nullable(), volumeUsd: z.number().nullable(), buys: z.number().nullable(), sells: z.number().nullable(), traders: z.number().nullable() })
  .strict();

/** One market whole: the header's price, the stats strip, the audit facts behind a risk line, the issuer and the links. */
export const SpotMarketSchema = z
  .object({
    mint: Address,
    symbol: SpotSymbol,
    name: SpotName,
    icon: SpotUrl.nullable(),
    decimals: z.number().int().min(0).max(18).nullable(),
    tokenProgram: SpotTokenProgram.nullable(),
    price: z.number().nullable(),
    change24hPct: z.number().nullable(),
    change1hPct: z.number().nullable(),
    volume24hUsd: z.number().nullable(),
    liquidityUsd: z.number().nullable(),
    marketCapUsd: z.number().nullable(),
    fdvUsd: z.number().nullable(),
    holders: z.number().nullable(),
    organicScore: z.number().nullable(),
    organicScoreLabel: z.string().min(1).max(16).nullable(),
    verified: z.boolean(),
    tags: z.array(z.string().min(1).max(32)).max(24),
    category: z.enum(SPOT_CATEGORIES_V1).nullable(),
    issuer: SpotIssuerSchema.nullable(),
    /** The first pool Jupiter knows for the mint. */
    firstPoolAt: Iso.nullable(),
    audit: z
      .object({ mintAuthorityDisabled: z.boolean().nullable(), freezeAuthorityDisabled: z.boolean().nullable(), topHoldersPct: z.number().nullable(), devBalancePct: z.number().nullable(), suspicious: z.boolean() })
      .strict(),
    links: z.object({ website: SpotUrl.nullable(), twitter: SpotUrl.nullable(), telegram: SpotUrl.nullable() }).strict(),
    stats: z.object({ h1: SpotStatsSchema, h24: SpotStatsSchema }).strict(),
    updatedAt: Iso.nullable(),
  })
  .strict();
export type SpotMarketV1 = z.infer<typeof SpotMarketSchema>;

/**
 * `GET /api/spot/markets` in its three modes: `?view=all|crypto|meme|stock`
 * (the ranked list; `partial` when only the ranked lists answered and a
 * category may be missing rows — such an answer is never cached at the edge),
 * `?q=` (a search, at most 40 rows), `?mints=a,b,c` (a watchlist or holdings in
 * the order given, the mints the catalogue does not know in `missing`; neither
 * `source` nor `partial`). `limit` 1–300, default 150.
 */
export const SpotMarketsResponseSchema = z
  .object({
    rows: z.array(SpotMarketListRowSchema).max(300),
    observedAt: Iso,
    stale: z.boolean(),
    /** 1.53.0, additive (SOL-D1): the oldest read behind the rows shown, present when `stale` — the list's last good time. */
    lastGoodAt: Iso.optional(),
    partial: z.boolean().optional(),
    source: z.object({ label: z.string().min(1).max(128), tier: z.enum(["lite", "pro"]) }).strict().optional(),
    missing: z.array(z.string().max(64)).max(300).optional(),
  })
  .strict();
export type SpotMarketsResponse = z.infer<typeof SpotMarketsResponseSchema>;

/** `GET /api/spot/market?mint=` — `market: null` when the catalogue does not list the mint: a 200 that says *not listed*, not a failure. */
export const SpotMarketResponseSchema = z.object({ market: SpotMarketSchema.nullable(), observedAt: Iso, stale: z.boolean() }).strict();
export type SpotMarketResponse = z.infer<typeof SpotMarketResponseSchema>;

export const SPOT_TIMEFRAMES_V1 = ["1m", "5m", "15m", "1h", "4h", "1d"] as const;

/** One bar; `time` is Unix seconds (UTC), oldest first; `volume` only where the source states it. */
export const SpotCandleSchema = z
  .object({ time: z.number().int().min(0), open: z.number(), high: z.number(), low: z.number(), close: z.number(), volume: z.number().optional(), isFinal: z.boolean().optional() })
  .strict();

/** The pool a chart or a stock's liquidity is read from, with the side the mint is on. */
export const SpotPoolSchema = z
  .object({
    address: z.string().min(1).max(128),
    /** The source's own name for the pool; its address where it gives none. */
    name: z.string().max(512),
    dex: z.string().max(128).nullable(),
    side: z.enum(["base", "quote"]),
    reserveUsd: z.number().nullable(),
    volume24hUsd: z.number().nullable(),
  })
  .strict();

/**
 * `GET /api/spot/candles?mint=&tf=[&limit=]` — the deepest pool against a
 * major quote the chart source knows, with the pool and the venue so the page
 * can say whose price it is. `limit` (1–300) answers the newest bars and adds
 * `available`. A market without a chart is a 404 with the reason in the code
 * (`CANDLES_NO_POOL`, `CANDLES_NO_MAJOR_QUOTE`, `CANDLES_THIN`, `CANDLES_QUIET`,
 * `CANDLES_STALE`, `CANDLES_PRICE_MISMATCH`).
 */
export const SpotCandlesResponseSchema = z
  .object({
    timeframe: z.enum(SPOT_TIMEFRAMES_V1),
    candles: z.array(SpotCandleSchema).max(1000),
    pool: SpotPoolSchema,
    observedAt: Iso,
    stale: z.boolean(),
    source: z.object({ label: z.literal("GeckoTerminal"), url: z.literal("https://www.geckoterminal.com") }).strict(),
    limit: z.number().int().min(1).max(300).optional(),
    available: z.number().int().min(0).optional(),
  })
  .strict();
export type SpotCandlesResponse = z.infer<typeof SpotCandlesResponseSchema>;

/* ------------------------------------------------------------ the consumed routes: stocks (1.11.0) */

/**
 * The stock reads — `GET /api/stocks/universe` (whole, or `?shape=slim` as the
 * surfaces draw it), `GET /api/stocks/asset?ticker=` and
 * `GET /api/stocks/quote?ticker=&side=&usd=`. Public, wallet-free. A
 * reference is a cached issuer or feed figure with its own time and state,
 * never an executable price; the executable price is the quote's. A token the
 * universe does not hold is a 404 `UNKNOWN_ASSET` — *not a confirmed
 * representation*, which is not the same as *does not exist*.
 */
/** 1.14.0: `tessera` stays for records written before 1.14.0; no new answer carries it. */
export const STOCK_ISSUER_IDS_V1 = ["xstocks", "backpack", "ondo", "prestocks", "tessera"] as const;
export const STOCK_REFERENCE_STATES_V1 = ["current", "last-available", "confirmed-close", "stale", "unavailable"] as const;
export const STOCK_SESSION_PERIODS_V1 = ["market", "extended", "overnight", "closed", "unknown"] as const;
export const STOCK_LIFECYCLE_STATES_V1 = ["active", "paused", "conversion-open", "redeem-only", "expired", "unknown"] as const;
const StockMultiplierStates = z.enum(["active", "pending", "activation-window"]);

export const StockExchangeSchema = z.object({ mic: z.string().min(1).max(8), name: z.string().min(1).max(200), timezone: z.string().min(1).max(64) }).strict();

/** The multiplier in force, a published one not yet activated, and when it activates. */
export const StockMultiplierSchema = z.object({ current: z.number(), pending: z.number().nullable(), effectiveAt: ProviderTime.nullable() }).strict();

export const StockRepresentationSchema = z
  .object({
    mint: Address,
    symbol: SpotSymbol,
    name: SpotName,
    issuer: z.object({ id: z.enum(STOCK_ISSUER_IDS_V1), label: z.string().min(1).max(64), catalogue: z.boolean() }).strict(),
    issuerConfirmation: z.enum(["issuer-catalogue", "tag-only"]),
    instrument: z.object({ class: z.enum(["listed-equity", "pre-ipo"]), unitBasis: z.enum(["share", "token"]), rights: z.enum(["issuer-terms", "economic-exposure", "loan-participation"]) }).strict(),
    underlying: z.object({ symbol: z.string().min(1).max(32), isin: z.string().min(1).max(16).nullable(), listingCountry: z.string().min(1).max(4).nullable(), name: z.string().min(1).max(200).nullable() }).strict(),
    companyKey: z.string().min(1).max(200).nullable(),
    exchange: StockExchangeSchema.nullable(),
    tokenProgram: SpotTokenProgram.nullable(),
    decimals: z.number().int().min(0).max(18).nullable(),
    tradingHalted: z.boolean().nullable(),
    issuerUrl: z.string().url().max(2048).nullable(),
    issuerNote: z.string().min(1).max(512).nullable(),
    sources: z.array(z.string().min(1).max(64)).max(8),
  })
  .strict();

export const StockReferenceSchema = z
  .object({
    state: z.enum(STOCK_REFERENCE_STATES_V1),
    /** Per underlying share, in `currency`. */
    perShare: z.number().nullable(),
    currency: z.string().min(1).max(8),
    /** `label` is empty when nobody stated a figure. */
    source: z.object({ id: z.enum(["issuer-xstocks", "pyth", "none"]), label: z.string().max(64) }).strict(),
    observedAt: ProviderTime.nullable(),
    fetchedAt: ProviderTime.nullable(),
    note: z.string().min(1).max(1000).nullable(),
  })
  .strict();

export const StockSessionSchema = z
  .object({
    period: z.enum(STOCK_SESSION_PERIODS_V1),
    exchangeOpen: z.boolean().nullable(),
    nextChangeAt: ProviderTime.nullable(),
    exchange: StockExchangeSchema.nullable(),
    source: z.enum(["issuer", "feed-catalogue", "none"]),
  })
  .strict();

const StockFeeConfig = { basisPoints: z.number().int().min(0).max(10_000), maximumFeeRaw: RawAmount } as const;

/** The fee the mint itself withholds on every transfer, from the chain — the issuer's condition, not Ryntra's fee. */
export const StockTransferFeeSchema = z
  .object({
    ...StockFeeConfig,
    configUsed: z.enum(["NEWER", "OLDER"]),
    epoch: z.string().regex(/^[0-9]{1,20}$/).nullable(),
    pending: z.object({ ...StockFeeConfig, fromEpoch: z.string().regex(/^[0-9]{1,20}$/) }).strict().nullable(),
    source: z.literal("chain"),
  })
  .strict();

/** Where the token stands in its issuer's life for it; `tradable` is about a new purchase through Ryntra. */
export const StockLifecycleSchema = z
  .object({
    state: z.enum(STOCK_LIFECYCLE_STATES_V1),
    tradable: z.boolean(),
    source: z.enum(["chain", "issuer-catalogue", "event-registry", "none"]),
    observedAt: ProviderTime.nullable(),
    url: z.string().url().max(2048).nullable(),
    recheckBy: ProviderTime.nullable(),
    deadline: ProviderTime.nullable(),
    note: z.string().min(1).max(2000).nullable(),
  })
  .strict();

const PathDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const PathToken = z.object({ mint: Address, symbol: SpotSymbol }).strict();

/** 1.17.0 — «Шлях компанії»: the company's way from a private token to its stock on Solana, and this token's step on it. */
export const StockCompanyPathSchema = z
  .object({
    at: z.enum(["private", "solana"]),
    steps: z
      .array(
        z
          .object({
            step: z.enum(COMPANY_PATH_STEPS),
            state: z.enum(COMPANY_PATH_STEP_STATES),
            date: PathDay.nullable(),
            priceUsd: z.number().positive().nullable(),
            exchange: z.string().min(1).max(64).nullable(),
            ticker: z.string().min(1).max(16).nullable(),
            token: PathToken.nullable(),
          })
          .strict(),
      )
      .length(4),
    swap: z.object({ from: PathToken, into: PathToken.nullable(), deadline: ProviderTime, open: z.boolean() }).strict().nullable(),
    swapMonths: z.number().int().min(1).max(60).nullable(),
    sources: z.array(z.object({ label: z.string().min(1).max(128), url: z.string().url().max(2048), publishedAt: PathDay.nullable(), readAt: PathDay }).strict()).max(16),
    version: z.string().min(1).max(32),
  })
  .strict();

export const StockRowSchema = z
  .object({
    representation: StockRepresentationSchema,
    market: z
      .object({
        /** Per token as the wallet shows it (the scaled unit), USD, the venue's figure. */
        priceUsd: z.number().nullable(),
        change24hPct: z.number().nullable(),
        volume24hUsd: z.number().nullable(),
        liquidityUsd: z.number().nullable(),
        verified: z.boolean(),
        observedAt: ProviderTime.nullable(),
        icon: z.string().min(1).max(2048).nullable(),
      })
      .strict(),
    /** Per underlying share, USD, on the list basis; null where the unit is a token. */
    tokenPerShareUsd: z.number().nullable(),
    multiplier: StockMultiplierSchema.nullable(),
    multiplierState: StockMultiplierStates.nullable(),
    reference: StockReferenceSchema,
    session: StockSessionSchema,
    /** Token per share against the reference on the list basis — an estimate for orientation, not a quote. */
    deviationPct: z.number().nullable(),
    /** The issuer's own mark of a pre-IPO token and company; never a market reference. 1.14.0: `issuer-prestocks` on every new answer. */
    issuerMark: z
      .object({
        source: z.object({ id: z.enum(["issuer-prestocks", "issuer-tessera"]), label: z.string().min(1).max(64) }).strict(),
        perUnit: z.number().nullable(),
        valuationUsd: z.number().nullable(),
        impliedValuationUsd: z.number().nullable(),
        supply: z.number().nullable(),
        holders: z.number().nullable(),
        /** The issuer states no observation time; only the fetch is dated. */
        observedAt: z.null(),
        fetchedAt: ProviderTime,
        stale: z.boolean(),
      })
      .strict()
      .nullable(),
    markPremiumPct: z.number().nullable(),
    /** Pyth's informational company index behind a pre-IPO instrument — context, never the row's reference. */
    companyIndex: z
      .object({
        source: z.object({ id: z.literal("pyth"), label: z.string().min(1).max(64) }).strict(),
        symbol: z.string().min(1).max(32),
        feedId: z.string().min(1).max(128),
        valueUsd: z.number().nullable(),
        state: z.enum(["current", "stale", "unavailable"]),
        observedAt: ProviderTime.nullable(),
        fetchedAt: ProviderTime.nullable(),
        note: z.string().min(1).max(2000).nullable(),
      })
      .strict()
      .nullable(),
    transferFee: StockTransferFeeSchema.nullable(),
    lifecycle: StockLifecycleSchema,
    /** 1.17.0: «Шлях компанії»; null where the strip has nothing to say. */
    companyPath: StockCompanyPathSchema.nullable().default(null),
  })
  .strict();
export type StockRowV1 = z.infer<typeof StockRowSchema>;

export const StockCatalogueStateSchema = z.object({ ok: z.boolean(), stale: z.boolean(), fetchedAt: ProviderTime.nullable(), reason: z.string().min(1).max(2000).nullable() }).strict();

/** `GET /api/stocks/universe` — every confirmed representation, whole, with the state of each issuer catalogue it was built from. 1.14.0: `tessera` optional — absent from every new answer. */
export const StockUniverseResponseSchema = z
  .object({
    rows: z.array(StockRowSchema).max(5000),
    marketsObservedAt: ProviderTime,
    issuerCatalogue: z.object({ ok: z.boolean(), reason: z.string().min(1).max(2000).nullable() }).strict(),
    issuerCatalogues: z.object({ xstocks: StockCatalogueStateSchema, prestocks: StockCatalogueStateSchema, tessera: StockCatalogueStateSchema.optional() }).strict(),
    fetchedAt: ProviderTime,
  })
  .strict();
export type StockUniverseResponse = z.infer<typeof StockUniverseResponseSchema>;

/**
 * The row as the stock surfaces draw it: the identity, the figures (a price
 * to six significant digits, a percent to two decimals, a sum in whole
 * dollars) and the states. `referenceState` is judged at answer time from the
 * reference's own observation; a client judges it again from `referenceAt`.
 * 1.11.0 adds the issuer events a list can name without a read per asset:
 * `multiplierPending` and `multiplierPendingAt` (the published multiplier not
 * yet in force, judged at answer time) and `sessionNextChangeAt` (when
 * `period` next changes, as its source stated it). 1.14.0 adds `markPremium`
 * — a pre-IPO token's price against the issuer's own mark, per cent to two
 * decimals, context and never a deviation from a market reference — and
 * `markAt`, when the issuer's mark was read; both null on a listed row.
 */
export const StockSlimRowSchema = z
  .object({
    mint: Address,
    symbol: SpotSymbol,
    /** The company or fund from the issuer where it names it, else the token's own name. */
    name: z.string().min(1).max(200),
    issuer: z.enum(STOCK_ISSUER_IDS_V1),
    kind: z.enum(["listed-equity", "pre-ipo"]),
    unitBasis: z.enum(["share", "token"]),
    tradable: z.boolean(),
    mark: z.number().nullable(),
    icon: z.string().min(1).max(2048).nullable(),
    halted: z.boolean(),
    price: z.number().nullable(),
    change24h: z.number().nullable(),
    reference: z.number().nullable(),
    referenceState: z.enum(STOCK_REFERENCE_STATES_V1),
    referenceAt: ProviderTime.nullable(),
    deviation: z.number().nullable(),
    period: z.enum(STOCK_SESSION_PERIODS_V1),
    volume: z.number().nullable(),
    liquidity: z.number().nullable(),
    multiplierPending: z.number().nullable().default(null),
    multiplierPendingAt: ProviderTime.nullable().default(null),
    sessionNextChangeAt: ProviderTime.nullable().default(null),
    markPremium: z.number().nullable().default(null),
    markAt: ProviderTime.nullable().default(null),
  })
  .strict();
export type StockSlimRow = z.infer<typeof StockSlimRowSchema>;

/** `GET /api/stocks/universe?shape=slim[&q=][&mints=][&limit=]` — `query` and `total` only when a search was asked; `mints` (up to 200) narrows to those. */
export const StockUniverseSlimResponseSchema = z
  .object({ rows: z.array(StockSlimRowSchema).max(5000), fetchedAt: ProviderTime, query: z.string().min(1).max(64).optional(), total: z.number().int().min(0).optional() })
  .strict();
export type StockUniverseSlimResponse = z.infer<typeof StockUniverseSlimResponseSchema>;

const StockOnchainFeeConfig = z.object({ epoch: z.string().regex(/^[0-9]{1,20}$/), basisPoints: z.number().int().min(0).max(10_000), maximumFeeRaw: RawAmount }).strict();

/** The mint as the chain states it — authorities, extensions, the Scaled UI Amount configuration, the transfer fee, the pause. */
export const StockOnchainMintSchema = z
  .object({
    programKind: z.string().min(1).max(32),
    decimals: z.number().int().min(0).max(255),
    supplyRaw: RawAmount,
    mintAuthority: z.string().min(1).max(64).nullable(),
    freezeAuthority: z.string().min(1).max(64).nullable(),
    extensions: z.array(z.string().min(1).max(64)).max(64),
    scaledUi: z.object({ multiplier: z.number(), newMultiplier: z.number(), newMultiplierEffectiveAt: ProviderTime.nullable(), authority: z.string().min(1).max(64) }).strict().nullable(),
    transferFeeConfig: z.object({ older: StockOnchainFeeConfig, newer: StockOnchainFeeConfig, withheldRaw: RawAmount }).strict().nullable(),
    pausable: z.object({ paused: z.boolean(), authority: z.string().min(1).max(64).nullable() }).strict().nullable(),
    permanentDelegate: z.string().min(1).max(64).nullable(),
    defaultAccountFrozen: z.boolean().nullable(),
    observedAt: ProviderTime,
    slot: z.string().regex(/^[0-9]{1,20}$/).nullable(),
  })
  .strict();

/**
 * `GET /api/stocks/asset?ticker=<symbol or mint>` — the row, the mint as the
 * chain states it (or why it could not be read), the multiplier from both
 * sides and whether they agree, the issuer's attested reserves, the pool.
 */
export const StockAssetResponseSchema = z
  .object({
    row: StockRowSchema,
    onchain: z.union([StockOnchainMintSchema, z.object({ error: z.string().min(1).max(2000) }).strict()]),
    chainMultiplier: StockMultiplierSchema.nullable(),
    chainMultiplierState: StockMultiplierStates.nullable(),
    issuerMultiplier: StockMultiplierSchema.nullable(),
    multiplierAgreement: z.enum(["agree", "differ", "unknown"]),
    reserves: z
      .object({ symbol: z.string().min(1).max(24), sharesHeld: z.string().min(1).max(64), circulatingSupply: z.string().min(1).max(64), observedAt: ProviderTime, custodians: z.array(z.string().min(1).max(64)).max(64) })
      .strict()
      .nullable(),
    pool: SpotPoolSchema.nullable(),
    fetchedAt: ProviderTime,
  })
  .strict();
export type StockAssetResponse = z.infer<typeof StockAssetResponseSchema>;

/**
 * `GET /api/stocks/quote?ticker=&side=BUY|SELL&usd=` (1 – 1,000,000) — the
 * size-aware executable quote; `reviewExpiresAt` is when it stops being
 * signable. `409 NO_ROUTE` / `409 LIFECYCLE` (the issuer does not offer a new
 * purchase now), `400 AMOUNT` / `400 UNITS`, `404 UNKNOWN_ASSET`, `503 PROVIDER`.
 */
export const StockQuoteResponseSchema = z
  .object({
    mint: Address,
    symbol: SpotSymbol,
    side: z.enum(["BUY", "SELL"]),
    /** The USD leg: paid on a Buy, arriving on a Sell. */
    usd: z.number().min(0),
    tokenRaw: RawAmount,
    tokenScaled: z.string().min(1).max(64),
    minReceivedRaw: RawAmount,
    minReceivedScaled: z.string().min(1).max(64),
    multiplier: z.number().nullable(),
    unitBasis: z.enum(["share", "token"]),
    executablePerShare: z.number().nullable(),
    reference: StockReferenceSchema,
    deviationPct: z.number().nullable(),
    priceImpactPct: z.string().max(64),
    feeBasisPoints: z.number().int().min(0).max(10_000),
    slippageBps: z.number().int().min(0).max(10_000),
    router: z.string().min(1).max(64),
    observedAt: ProviderTime,
    reviewExpiresAt: ProviderTime,
    source: z.object({ label: z.string().min(1).max(128) }).strict(),
    transferFee: StockTransferFeeSchema.nullable(),
    lifecycle: StockLifecycleSchema,
  })
  .strict();
export type StockQuoteResponse = z.infer<typeof StockQuoteResponseSchema>;

/* ------------------------------------------------------------ «Популярне» (1.20.0) */

/** How many companies «Популярне» answers when not asked (Home's wide list), and the most it answers. */
export const POPULAR_DEFAULT_LIMIT = POPULAR_LIMIT;
export const POPULAR_MAX_LIMIT = POPULAR_LIMIT_MAX;

/**
 * One card of «Популярні компанії» (`lib/stocks/popular.ts`): the company as a
 * person names it, the token the card opens and would buy — the issuer's own
 * catalogue first, then the deepest pool — its price per token as the wallet
 * shows it, the day's move in per cent to two decimals, and the company's
 * trading over the day in whole dollars across every representation, the
 * list's order.
 */
export const PopularCompanySchema = z
  .object({
    name: z.string().min(1).max(200),
    ticker: SpotSymbol,
    mint: Address,
    icon: z.string().min(1).max(2048).nullable(),
    price: z.number().finite().positive(),
    change24h: z.number().finite().nullable(),
    volume24h: z.number().int().nonnegative(),
    issuer: z.enum(STOCK_ISSUER_IDS),
  })
  .strict();
export type PopularCompany = z.infer<typeof PopularCompanySchema>;

/**
 * `GET /api/v1/stocks/popular[?limit=1–24][&exclude=<mint>]` — public, the v1
 * envelope. The listed companies a beginner is shown (xStocks and Backpack),
 * one card each, by the day's trading — `order` names the rule, the same for
 * everyone, never anyone's opinion. `exclude` leaves out the company a mint
 * belongs to (the same underlying, and its name), so the list beside a
 * company's page is the way on to the next one. `fetchedAt` is when the market
 * was read. Fails `VALIDATION_ERROR` (a limit or mint out of shape),
 * `RATE_LIMITED`, `UNAVAILABLE` (the universe could not be read).
 */
export const PopularCompaniesResponseSchema = z
  .object({
    companies: z.array(PopularCompanySchema).max(POPULAR_MAX_LIMIT),
    order: z.literal("volume-24h"),
    fetchedAt: ProviderTime,
  })
  .strict();
export type PopularCompaniesResponse = z.infer<typeof PopularCompaniesResponseSchema>;

/* ------------------------------------------------------------ notifications: the Telegram channel over the bearer (1.11.0) */

/**
 * 1.11.0 — the proven wallet's Telegram channel as a v1 path, `GET · POST ·
 * DELETE /api/v1/notifications/telegram`, over the bearer or the web's proof
 * cookie. The same channel Settings connects on ryntra.io: an account is the
 * wallet that signed, Telegram is a place to be told something and never a
 * way in. `GET` never creates anything; `POST` resolves the wallet's account
 * the way the web's sign-in does (creating it on the first connect) and
 * answers the bot link with a signed code that dies at `expiresAt`; the
 * binding is written only by the bot when the person presses Start. `DELETE`
 * removes the binding and nothing else. Whether a note goes to Telegram at all
 * stays the wallet's own preference on `POST /api/monitoring { telegram }`.
 */
export const TelegramChannelViewSchema = z
  .object({ connected: z.boolean(), username: z.string().min(1).max(64).nullable(), connectedAt: Iso.nullable() })
  .strict();
export type TelegramChannelView = z.infer<typeof TelegramChannelViewSchema>;

export const TelegramChannelResponseSchema = z.object({ telegram: TelegramChannelViewSchema }).strict();
export type TelegramChannelResponse = z.infer<typeof TelegramChannelResponseSchema>;

/** The language an account created by this connect is opened in; an existing account keeps its own. */
export const TelegramConnectRequestSchema = z.object({ locale: z.enum(["en", "uk"]).default("en") }).strict();
export type TelegramConnectRequest = z.input<typeof TelegramConnectRequestSchema>;

export const TelegramConnectResponseSchema = z
  .object({
    /** `https://t.me/<bot>?start=<code>` — open it; the code names the account and is signed. */
    link: z.string().regex(/^https:\/\/t\.me\/[A-Za-z0-9_]{5,32}\?start=ntf_[A-Za-z0-9_-]{22}_[0-9a-z]{1,10}_[0-9a-f]{16}$/),
    expiresAt: Iso,
  })
  .strict();
export type TelegramConnectResponse = z.infer<typeof TelegramConnectResponseSchema>;

/* ------------------------------------------------------------ the consumed routes: activity, receipts, rewards, monitoring (1.11.0) */

/*
 * Uses, by name, what `contract.ts` already defines above this point: `Address`,
 * `Iso`, `RawAmount`, `ProviderTime`, `ClockTime` (notifications, 1.1.0),
 * `ExecutionPlanBindingSchema` (executions, 1.1.0), `RouteErrorSchema` (the
 * consumed routes' shared parts) and `ApiErrorSchema`. Local helpers carry the
 * prefixes `Act`, `Rcpt`, `Rew`, `Mon`.
 */

/* ---- a reward row: shared by Activity and Rewards */

export const REWARD_ROW_KINDS_V1 = ["CASHBACK", "REFERRAL_L1", "REFERRAL_L2", "CLAIM"] as const;

/** A dollar figure as decimal text with two decimals, or `<0.01` for a positive amount under a cent (`usdText`). */
const RewUsdText = z.string().max(64).regex(/^(?:<0\.01|-?(?:0|[1-9][0-9]*)\.[0-9]{2})$/);

/** One settled reward or claim, as a person reads it: no reference, no mechanism, no other wallet. */
export const RewardsRowSchema = z
  .object({
    kind: z.enum(REWARD_ROW_KINDS_V1),
    /** Ready to print: `+$1.25`, `+<$0.01`, `−$3.00` (U+2212 before a claim), or `—` (U+2014) for a reward with no dollar figure yet. */
    display: z.string().max(64).regex(/^(?:—|[+−](?:<\$0\.01|\$(?:0|[1-9][0-9]*)\.[0-9]{2}))$/),
    /** The unsigned figure without dressing (`1.25`, `<0.01`), or `—` (U+2014) when `valued` is false. */
    amount: z.string().max(64).regex(/^(?:—|<0\.01|(?:0|[1-9][0-9]*)\.[0-9]{2})$/),
    valued: z.boolean(),
    /** The fee asset's symbol as the settlement named it; never an address. Null on a claim. */
    detail: z.string().min(1).max(40).nullable(),
    at: Iso,
  })
  .strict();
export type RewardsRow = z.infer<typeof RewardsRowSchema>;

/* ---- activity */

export const ACTIVITY_LANES_V1 = ["SEND", "SWAP", "BRIDGE", "RECEIVE", "CROSS_SWAP"] as const;
export const ACTIVITY_OUTCOMES_V1 = ["IN_FLIGHT", "DONE", "FAILED", "NEEDS_YOU"] as const;
export const ACTIVITY_DESTINATIONS_V1 = ["SOLANA", "BASE", "ETHEREUM", "ROBINHOOD"] as const;
export const ACTIVITY_FEE_STATES_V1 = ["COLLECTED", "NOT_COLLECTED", "NOT_APPLIED", "UNCONFIGURED", "NONE"] as const;

/**
 * The request the route reads — exactly its own schema, which is strict: an
 * extra key is refused `VALIDATION_ERROR`. `owner` is length-checked only; an
 * address that is not base58 is read and finds nothing.
 */
export const ActivityRequestSchema = z
  .object({ owner: z.string().min(32).max(44), network: z.enum(["mainnet", "devnet"]).default("mainnet") })
  .strict();
export type ActivityRequest = z.input<typeof ActivityRequestSchema>;

/**
 * One leg of value in raw base units. `decimals` null means the product does
 * not know the scale and a surface shows no figure; `symbol` is the ledger's
 * own, else the catalogue's (up to 32 characters), else null.
 */
const ActMovement = z
  .object({
    mint: Address.nullable(),
    amountRaw: RawAmount,
    decimals: z.number().int().min(0).max(18).nullable(),
    symbol: z.string().min(1).max(32).nullable(),
  })
  .strict();

/** What Ryntra charged on the operation and whether it was taken; `usd` is the provider's own figure for the fill. */
const ActFee = z
  .object({
    collected: z.boolean(),
    basisPoints: z.number().int().min(0).max(10_000).nullable(),
    amountRaw: RawAmount.nullable(),
    decimals: z.number().int().min(0).max(18).nullable(),
    symbol: z.string().min(1).max(24).nullable(),
    usd: z.number().nullable(),
    asset: z.string().min(1).max(64).nullable(),
    providerRaw: RawAmount.nullable(),
    ryntraRaw: RawAmount.nullable(),
    state: z.enum(ACTIVITY_FEE_STATES_V1).nullable(),
    /** The provider's stated reason, bounded by the ledger. */
    note: z.string().max(400).nullable(),
  })
  .strict();

/**
 * Where the action was started: Spot with a side, and the plan version (with the Review's id) an order was made under.
 * 1.34.0: `LAUNCH` — a buy or a sale of a Ryntra launch on its curve or in its graduated pool, with the token and the venue.
 */
const ActOrigin = z
  .object({
    surface: z.enum(["SPOT", "LAUNCH"]),
    side: z.enum(["BUY", "SELL"]),
    plan: ExecutionPlanBindingSchema.extend({ reviewId: z.string().min(8).max(64) }).strict().optional(),
    /** 1.12.0: the autoinvest reminder a purchase was made under — the row the rule reads its occurrence from. */
    rule: RuleBindingSchema.optional(),
    /** 1.34.0, `LAUNCH` only: the launched token. */
    token: Address.optional(),
    /** 1.34.0, `LAUNCH` only: where the trade ran — the bonding curve, or the DAMM v2 pool it graduated into. */
    venue: z.enum(["curve", "pool"]).optional(),
  })
  .strict();

/** One row of the wallet's own history: public chain facts only, never a note, a label or a counterparty. */
export const ActivityActionSchema = z
  .object({
    schema: z.literal("ryntra.solana.wallet-action"),
    schemaVersion: z.literal("1.0.0"),
    version: z.number().int().min(0),
    network: z.enum(["mainnet", "devnet"]),
    wallet: Address,
    /** The signature for Send and Swap, the burn intent digest for Bridge, the order intent for a cross-chain swap. */
    actionId: z.string().min(8).max(128),
    lane: z.enum(ACTIVITY_LANES_V1),
    /** Four words, not the lanes' states: `IN_FLIGHT` is never success or failure; `NEEDS_YOU` waits on this person. */
    outcome: z.enum(ACTIVITY_OUTCOMES_V1),
    /** What left the wallet; null where the lane has not resolved it. */
    out: ActMovement.nullable(),
    /** What arrived; null for a Send and for anything not settled. */
    in: ActMovement.nullable(),
    destination: z.enum(ACTIVITY_DESTINATIONS_V1).nullable(),
    signature: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,90}$/).nullable(),
    receiptHash: z.string().regex(/^0x[0-9a-f]{64}$/).nullable(),
    /** A cross-chain lane's transactions in each chain's own form (a Base hash is not base58). */
    sourceTx: z.string().min(3).max(128).nullable(),
    destinationTx: z.string().min(3).max(128).nullable(),
    fee: ActFee.nullable(),
    origin: ActOrigin.nullable(),
    /** The provider's own id for the operation (Jupiter's `requestId` on a swap). */
    providerRef: z.string().min(1).max(128).nullable(),
    /** The provider's dollar figure for this exact fill; never a price read later. */
    statedUsd: z.number().min(0).nullable(),
    startedAt: Iso,
    updatedAt: Iso,
  })
  .strict();
export type ActivityAction = z.infer<typeof ActivityActionSchema>;

/**
 * `POST /api/solana/activity` with `ActivityRequestSchema` — public by address,
 * like holdings, on the read limiter (120 a minute per IP). It answers what the
 * wallet did through Ryntra: `actions`, newest `updatedAt` first, every row the
 * ledger holds for the wallet (the 25 newest re-read from their lane's own record,
 * so `outcome` can be newer than the stored row), and `rewards` — the wallet's 25
 * newest settled reward rows — only when the request carries a wallet proof (the
 * `rw` cookie or the native bearer) for exactly `owner`: `null` means not yours to
 * see, `[]` means none. `complete: false` means a stored row could not be read and
 * was left out; `coverage` says the list begins where Ryntra's ledger does, not at
 * the wallet's first transaction. Errors are `RouteErrorSchema`: 429
 * `RATE_LIMITED`; from the body reader 415 `JSON_REQUIRED`, 413 `BODY_TOO_LARGE`
 * (96 KiB), 400 `INVALID_CONTENT_LENGTH` · `BODY_REQUIRED` · `INVALID_BODY_STREAM`
 * · `INVALID_JSON`; 400 `VALIDATION_ERROR` for a body the request schema refuses. A
 * store fault is an unhandled 500 with no JSON body.
 */
export const ActivityResponseSchema = z
  .object({
    data: z
      .object({
        /** Unbounded in the code (every row of the wallet); the bound is a ceiling a wallet cannot reach through the product. */
        actions: z.array(ActivityActionSchema).max(100_000),
        rewards: z.array(RewardsRowSchema).max(25).nullable(),
        /**
         * Since 1.60.0 (SOL-X1): the cashback each trade earned, by the trade's signature — the wallet's CASHBACK
         * accruals summed per operation, every trade that has one; `usdMicros` null while a row is unvalued, `held` when part
         * waits on the wallet's «First $10 back» check. The same proof as `rewards`, null on the same terms. A
         * receipt's execution truth reads its own signature here.
         */
        cashback: z
          .array(
            z
              .object({
                signature: z.string().min(1).max(200),
                usdMicros: z.string().regex(/^-?(?:0|[1-9][0-9]*)$/).nullable(),
                held: z.boolean(),
              })
              .strict(),
          )
          .max(100_000)
          .nullable(),
        complete: z.boolean(),
        coverage: z.literal("RYNTRA_ACTIONS"),
      })
      .strict(),
  })
  .strict();
export type ActivityResponse = z.infer<typeof ActivityResponseSchema>;

/* ---- the receipts archive */

export const RECEIPT_KINDS_V1 = ["send", "swap", "bridge", "receive", "other"] as const;

/**
 * A time as the account store renders its own `timestamptz` (ISO 8601 with an
 * offset and up to microseconds, e.g. `2026-09-06T12:00:00.123456+00:00`) — not
 * Ryntra's `toISOString`, so read as text.
 */
const RcptStoreTime = ProviderTime;

/** One archived receipt. `payload` is the receipt as the client stored it — opaque here; the store bounds it to 32 KiB. */
export const ReceiptsArchiveRowSchema = z
  .object({
    kind: z.enum(RECEIPT_KINDS_V1),
    contentHash: z.string().regex(/^[0-9a-f]{64}$/),
    payload: z.record(z.string(), z.unknown()),
    occurredAt: RcptStoreTime.nullable(),
    createdAt: RcptStoreTime,
  })
  .strict();
export type ReceiptsArchiveRow = z.infer<typeof ReceiptsArchiveRowSchema>;

/**
 * `GET /api/solana/receipts/archive?address=` and `PUT
 * /api/solana/receipts/archive` — the server copy of a wallet's receipt vault,
 * behind a wallet proof (the `rw` cookie or the native bearer) for exactly that
 * address; no rate limiter. GET answers at most 200 rows, newest first
 * (`occurredAt`, else `createdAt`). PUT (`ReceiptsArchivePutRequestSchema`) stores
 * rows deduplicated by `contentHash` and never overwrites one, answering how many
 * were new (`inserted`) of those offered (`offered`); a request that carries a
 * bearer skips the origin check a cookie needs. Errors are this route's own bodies
 * (`ReceiptsArchiveErrorSchema`): 401 `{ error: "proof required", proof: false }`,
 * 503 `{ error: "unavailable" }` (the account store), and on PUT 403
 * `{ error: "forbidden" }`, 413 `{ error: "payload too large" }` (a body over
 * 512 000 characters), 400 `{ error: "bad request" }`.
 */
export const ReceiptsArchiveGetResponseSchema = z
  .object({ ok: z.literal(true), address: Address, rows: z.array(ReceiptsArchiveRowSchema).max(200) })
  .strict();
export type ReceiptsArchiveGetResponse = z.infer<typeof ReceiptsArchiveGetResponseSchema>;

/**
 * The body PUT accepts — exactly the route's own schema. Not `.strict()`: the
 * route drops keys it does not read, at the top and in a row; a stricter schema
 * here would refuse a body the route accepts.
 */
export const ReceiptsArchivePutRequestSchema = z.object({
  address: z.string().min(32).max(44),
  rows: z
    .array(
      z.object({
        kind: z.enum(RECEIPT_KINDS_V1),
        contentHash: z.string().regex(/^[0-9a-f]{64}$/),
        payload: z.record(z.string(), z.unknown()),
        occurredAt: z.string().datetime({ offset: true }).nullable().optional(),
      }),
    )
    .min(1)
    .max(200),
});
export type ReceiptsArchivePutRequest = z.input<typeof ReceiptsArchivePutRequestSchema>;

export const ReceiptsArchivePutResponseSchema = z
  .object({ ok: z.literal(true), inserted: z.number().int().min(0).max(200), offered: z.number().int().min(1).max(200) })
  .strict();
export type ReceiptsArchivePutResponse = z.infer<typeof ReceiptsArchivePutResponseSchema>;

export const ReceiptsArchiveErrorSchema = z.union([
  /** 401 */
  z.object({ error: z.literal("proof required"), proof: z.literal(false) }).strict(),
  /** 503 `unavailable`; PUT only: 403 `forbidden`, 413 `payload too large`, 400 `bad request`. */
  z.object({ error: z.enum(["unavailable", "forbidden", "payload too large", "bad request"]) }).strict(),
]);
export type ReceiptsArchiveError = z.infer<typeof ReceiptsArchiveErrorSchema>;

/* ---- rewards */

export const REWARD_PENDING_REASONS_V1 = ["AWAITING_VALUATION", "AWAITING_RESERVE"] as const;
export const REWARD_CLAIM_STATES_V1 = ["CLAIMING", "SUBMITTED_UNKNOWN", "PAID", "FAILED"] as const;

/** USD micro-units (a millionth of a dollar) as a signed decimal integer. */
const RewMicros = z.string().regex(/^-?(?:0|[1-9][0-9]*)$/).max(41);
/** Whole points grouped by thousands with a narrow no-break space (U+202F), not a plain space: `1 234 567`. */
const RewGrouped = z.string().max(64).regex(/^[0-9]{1,3}(?: [0-9]{3})*$/);
/** A wallet or a code as shown to somebody who is not its owner: four characters, `…` (U+2026), four characters. */
const RewMasked = z.string().regex(/^.{4}….{4}$/);
/** A referral code: twelve characters of a 30-letter alphabet without vowels. */
const RewReferralCode = z.string().regex(/^[0-9BCDFGHJKLMNPQRSTVWXZ]{12}$/);

/** Ryntra Points for this wallet and where it stands among external wallets; no other wallet is named. */
export const RewardsPointsSchema = z
  .object({
    points: RewGrouped,
    level: z.number().int().min(1),
    /** Points at which the current level began. */
    levelFrom: RewGrouped,
    /** Points at which the next level begins, or null at the top level. */
    nextLevelAt: RewGrouped.nullable(),
    /** Position among external wallets; null for a wallet that is not ranked (an internal one, or none yet). */
    rank: z.number().int().min(1).nullable(),
    ranked: z.number().int().min(0),
    /** Lifetime eligible volume, `$` then the whole dollars grouped like the points (U+202F), two decimals. */
    volume: z.string().max(64).regex(/^\$[0-9]{1,3}(?: [0-9]{3})*\.[0-9]{2}$/),
    trades: z.number().int().min(0),
    activeDays: z.number().int().min(0),
    policyVersion: z.string().min(1).max(20),
    /** True for a wallet the deployment lists as internal: it keeps its points and has no rank. */
    excluded: z.boolean(),
  })
  .strict();
export type RewardsPoints = z.infer<typeof RewardsPointsSchema>;

export const REWARD_RANKS_V1 = ["BRONZE", "SILVER", "GOLD", "SAPPHIRE", "DIAMOND"] as const;

/**
 * The wallet's rank (Growth line, rules 2.0.0): Ryntra points over the last 30
 * days — a dollar of fee Ryntra received on the wallet's own trades or its
 * invited friends' trades is a point, a launch that reached a DEX adds a fixed
 * number — and the share of the received fee a friend's trade pays at this rank.
 */
export const RewardsRankSchema = z
  .object({
    rank: z.enum(REWARD_RANKS_V1),
    points: RewGrouped,
    fromTrades: RewGrouped,
    fromFriends: RewGrouped,
    fromLaunches: RewGrouped,
    /** Points at which the current rank began. */
    rankFrom: RewGrouped,
    /** The next rank, the points it begins at, how many are still needed and its level-1 share; null at Diamond. */
    next: z
      .object({ rank: z.enum(REWARD_RANKS_V1), at: RewGrouped, toGo: RewGrouped, friendShare: z.number().int().min(0).max(100) })
      .strict()
      .nullable(),
    /** Whole percent of the received fee: level 1 at this rank, and level 2. */
    friendShare: z.number().int().min(0).max(100),
    secondLevelShare: z.number().int().min(0).max(100),
    /** All five ranks under the rules in force: where each begins and its level-1 share. */
    ladder: z.array(z.object({ rank: z.enum(REWARD_RANKS_V1), from: RewGrouped, friendShare: z.number().int().min(0).max(100) }).strict()).length(5),
    windowDays: z.number().int().min(1),
    rulesVersion: z.string().min(1).max(20),
  })
  .strict();
export type RewardsRank = z.infer<typeof RewardsRankSchema>;

export const REWARD_ACHIEVEMENTS_V1 = ["FIRST_FRIEND", "FIVE_FRIENDS", "LAUNCH_ON_DEX"] as const;

/**
 * The wallet's badges: every rank it has reached since ranks began — the
 * badge stays when the 30-day rank falls — with the points each rank begins
 * at, and its achievements, each with the moment it was earned. Bronze is
 * held from the start (`at` null); a rank reached on a deployment that does
 * not know when ranks began has `at` null too. An achievement that is shown
 * only once earned (`LAUNCH_ON_DEX`) is absent until it is.
 */
export const RewardsAchievementsSchema = z
  .object({
    ranks: z
      .array(z.object({ rank: z.enum(REWARD_RANKS_V1), reached: z.boolean(), at: z.string().datetime({ offset: true }).nullable(), from: RewGrouped }).strict())
      .length(5),
    badges: z
      .array(z.object({ id: z.enum(REWARD_ACHIEVEMENTS_V1), earned: z.boolean(), at: z.string().datetime({ offset: true }).nullable() }).strict())
      .max(20),
  })
  .strict();
export type RewardsAchievements = z.infer<typeof RewardsAchievementsSchema>;

/**
 * Rules 2.1.0 as the wallet meets them (the decision of 2026-10-17), present only once those rules are in force:
 * the claim floor for this wallet now (`claimMinimum` — $0.25 when it holds a USDC account, $1 when the payout opens
 * one or the account could not be read; `usdcAccount` says which), the offer «First $10 back» (`firstTenOffer`: the
 * cap, the days from the first trade, the new wallets a month), the wallet's own window when it holds one (`firstTen`:
 * open or closed, the cluster check, what came back of the cap, the part still waiting for the check, when the window
 * ends; null otherwise), and the inviter's window (`inviterWindow`: the share of a friend's trades and its days from
 * that friend's first trade). Additive: a client that does not read it needs no release.
 */
export const RewardsProgrammeSchema = z
  .object({
    /* Growth line, 2026-10-27: `2.2.0` moved the rank ladder one decade down and changed nothing else, so the
       field widens rather than breaking — a client that pins the old value keeps reading every other field. */
    rulesVersion: z.enum(["2.1.0", "2.2.0"]),
    claimMinimum: RewUsdText,
    claimMinimumWithAccount: RewUsdText,
    claimMinimumWithoutAccount: RewUsdText,
    usdcAccount: z.enum(["EXISTS", "MISSING", "UNKNOWN"]),
    firstTenOffer: z.object({ cap: RewUsdText, days: z.number().int().min(1), walletsPerMonth: z.number().int().min(1) }).strict(),
    firstTen: z
      .object({
        state: z.enum(["OPEN", "CLOSED"]),
        check: z.enum(["PENDING", "PASSED", "FAILED"]),
        returned: RewUsdText,
        cap: RewUsdText,
        held: RewUsdText,
        endsAt: z.string().datetime({ offset: true }),
      })
      .strict()
      .nullable(),
    inviterWindow: z.object({ share: z.number().int().min(1).max(100), days: z.number().int().min(1) }).strict(),
  })
  .strict();
export type RewardsProgramme = z.infer<typeof RewardsProgrammeSchema>;

/**
 * `GET /api/rewards?address=&locale=en|uk` — what the proven wallet has earned,
 * behind a wallet proof (the `rw` cookie or the native bearer) for exactly
 * `address`, on the read limiter. The six figures are dollar text (`RewUsdText`);
 * `sourceAmounts` states the three sources as signed USD micro-units. `claimable`
 * is false whenever payouts are not configured on the deployment, and
 * `claimBlockedReason` then says so in the locale; `referral` is always present
 * here (the account is created on first read); `claim` is the last claim and its
 * sentence (the phone never claims); `points` is null when the points ledger could
 * not be read — unavailable, not zero; `started` says whether accrual has begun on
 * this deployment. Errors are this route's own bodies, never the v1 envelope
 * (`RewardsErrorSchema`): 429 `{ error: "rate limited" }`, 401 `{ error: "proof
 * required", proof: false }`, 503 `{ ok: false, error: "REWARDS_UNAVAILABLE" }`.
 * `/api/rewards/claim` (a payout) is not described here.
 */
export const RewardsResponseSchema = z
  .object({
    ok: z.literal(true),
    address: Address,
    available: RewUsdText,
    pending: RewUsdText,
    lifetime: RewUsdText,
    cashback: RewUsdText,
    referralL1: RewUsdText,
    referralL2: RewUsdText,
    sourceAmounts: z.object({ CASHBACK: RewMicros, REFERRAL_L1: RewMicros, REFERRAL_L2: RewMicros }).strict(),
    claimable: z.boolean(),
    /** One sentence in the locale, or null when Claim may be pressed. */
    claimBlockedReason: z.string().min(1).max(200).nullable(),
    pendingReasons: z.array(z.enum(REWARD_PENDING_REASONS_V1)).max(2),
    /** How many wallets confirmed this one as their inviter, and how many sit one level below those. */
    referrals: z.object({ level1: z.number().int().min(0), level2: z.number().int().min(0) }).strict(),
    rows: z.array(RewardsRowSchema).max(20),
    /** `link` is `<origin>/r/<code>`, the origin as the request's forwarded host and protocol state it. */
    referral: z.object({ code: RewReferralCode, link: z.string().min(1).max(2048) }).strict(),
    claim: z
      .object({
        state: z.enum(REWARD_CLAIM_STATES_V1),
        text: z.string().max(200),
        signature: z.string().min(1).max(120).nullable(),
      })
      .strict()
      .nullable(),
    /** The confirmed inviter, masked; null when nobody invited this wallet. */
    invitedBy: RewMasked.nullable(),
    points: RewardsPointsSchema.nullable(),
    /** Null when the rank could not be read — unavailable, not Bronze. Absent from a deployment before ranks. */
    rank: RewardsRankSchema.nullable().optional(),
    /** Null when the badges could not be read. Absent from a deployment before badges. */
    achievements: RewardsAchievementsSchema.nullable().optional(),
    started: z.boolean(),
    /** Absent before rules 2.1.0 are in force (`RewardsProgrammeSchema`). */
    programme: RewardsProgrammeSchema.optional(),
  })
  .strict();
export type RewardsResponse = z.infer<typeof RewardsResponseSchema>;

export const RewardsErrorSchema = z.union([
  /** 429 */
  z.object({ error: z.literal("rate limited") }).strict(),
  /** 401 */
  z.object({ error: z.literal("proof required"), proof: z.literal(false) }).strict(),
  /** 503 */
  z.object({ ok: z.literal(false), error: z.literal("REWARDS_UNAVAILABLE") }).strict(),
]);
export type RewardsError = z.infer<typeof RewardsErrorSchema>;

/* ---- rewards: the referral */

/** `ALREADY_CHANGED` (Growth v6-9): the one change of inviter was already made. A new value — a strict client should treat unknown ones as a refusal. */
export const REFERRAL_REFUSALS_V1 = ["SELF_REFERRAL", "UNKNOWN_CODE", "ALREADY_REFERRED", "ALREADY_EARNING", "CYCLE", "ALREADY_CHANGED"] as const;

/** A code and whose it is, masked. */
export const RewardsReferralPreviewSchema = z
  .object({ code: RewReferralCode, inviterMasked: RewMasked, codeMasked: RewMasked })
  .strict();
export type RewardsReferralPreview = z.infer<typeof RewardsReferralPreviewSchema>;

/**
 * A window on the proven wallet's own read (Growth v6-9; optional fields — a
 * client that ignores unknown keys is unaffected, one that parses this state
 * strictly must take the new keys): `binding` — with no inviter yet, whether one can still be added:
 * always before the first trade (`until` null), for seven days after it
 * (`until` the last moment), then not (`open` false); `change` — with an
 * inviter, whether it can still be changed: once, inside that same window.
 */
export const RewardsReferralBindingSchema = z
  .object({ open: z.boolean(), until: z.string().datetime({ offset: true }).nullable() })
  .strict();
export type RewardsReferralBinding = z.infer<typeof RewardsReferralBindingSchema>;

/** What is being considered and what is decided; `codeMasked` is null on an inviter read from the account rather than a code. */
export const RewardsReferralStateSchema = z
  .object({
    ok: z.literal(true),
    pending: RewardsReferralPreviewSchema.nullable(),
    confirmed: z.object({ inviterMasked: RewMasked, codeMasked: RewMasked.nullable() }).strict().nullable(),
    binding: RewardsReferralBindingSchema.optional(),
    change: RewardsReferralBindingSchema.optional(),
    /** True on the read that bound the carried invitation on its own. */
    bound: z.literal(true).optional(),
  })
  .strict();
export type RewardsReferralState = z.infer<typeof RewardsReferralStateSchema>;

/**
 * `GET /api/rewards/referral[?code=][&address=]` — public, on the read limiter,
 * writes nothing. With `?code=` it previews that code: `found` and the inviter
 * masked (a code that does not normalise is `found: false`). Without it, it
 * reports the code this browser carries (the `rref` cookie) as `pending`, and —
 * only for the `rw` cookie's own wallet named by `address`, never over the
 * bearer — binds that code on its own while the window is open (`bound: true`,
 * the one write this read makes), then answers the inviter `confirmed` with
 * `change`, or, with none, `binding`. A carried code for another inviter stays
 * `pending` only while the one change is still open. Errors
 * (`RewardsReferralErrorSchema`): 429 `{ error: "rate limited" }`.
 */
export const RewardsReferralGetResponseSchema = z.union([
  z.object({ ok: z.literal(true), found: z.literal(true), preview: RewardsReferralPreviewSchema }).strict(),
  z.object({ ok: z.literal(true), found: z.literal(false), preview: z.null() }).strict(),
  RewardsReferralStateSchema,
]);
export type RewardsReferralGetResponse = z.infer<typeof RewardsReferralGetResponseSchema>;

/**
 * The body `POST /api/rewards/referral` accepts — exactly the route's own
 * schema. Not `.strict()`: the route drops keys it does not read. `code` is
 * normalised on the server (case and dashes are noise).
 */
export const RewardsReferralRequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("pending"), code: z.string().min(1).max(40) }),
  z.object({ action: z.literal("dismiss") }),
  z.object({ action: z.literal("confirm"), code: z.string().min(1).max(40), address: Address }),
  /** Growth v6-9: the one change of inviter, inside the window (a plain binding with none yet). */
  z.object({ action: z.literal("change"), code: z.string().min(1).max(40), address: Address }),
]);
export type RewardsReferralRequest = z.input<typeof RewardsReferralRequestSchema>;

/**
 * `POST /api/rewards/referral` with `RewardsReferralRequestSchema` — on the read
 * limiter and the site's origin check (a bearer does not skip it). `pending`
 * (Change code) answers the code as `pending` and sets the cookie; `dismiss`
 * answers both null and clears it; `confirm` binds the inviter once and answers
 * it `confirmed` (`ALREADY_EARNING`: the seven days after the wallet's first
 * trade are over) — it needs the `rw` cookie for exactly `address` (the native
 * bearer is not read here). Errors (`RewardsReferralErrorSchema`): 429
 * `{ error: "rate limited" }`, 403 `{ error: "forbidden origin" }`, 400 · 413 ·
 * 415 `{ error: "bad request" }`, 404 `{ ok: false, found: false, reason:
 * "REFERRAL_CODE_NOT_FOUND" }`, 401 `{ ok: false, reason: "PROOF_REQUIRED", proof:
 * false }`, 409 `{ ok: false, reason: <REFERRAL_REFUSALS_V1> }`.
 */
export const RewardsReferralPostResponseSchema = RewardsReferralStateSchema;
export type RewardsReferralPostResponse = z.infer<typeof RewardsReferralPostResponseSchema>;

export const RewardsReferralErrorSchema = z.union([
  /** 429 (GET and POST) · 403 `forbidden origin` · 400, 413 or 415 `bad request` (POST). */
  z.object({ error: z.enum(["rate limited", "forbidden origin", "bad request"]) }).strict(),
  /** 404 */
  z.object({ ok: z.literal(false), found: z.literal(false), reason: z.literal("REFERRAL_CODE_NOT_FOUND") }).strict(),
  /** 401 */
  z.object({ ok: z.literal(false), reason: z.literal("PROOF_REQUIRED"), proof: z.literal(false) }).strict(),
  /** 409 */
  z.object({ ok: z.literal(false), reason: z.enum(REFERRAL_REFUSALS_V1) }).strict(),
]);
export type RewardsReferralError = z.infer<typeof RewardsReferralErrorSchema>;

/* ---- monitoring */

export const MONITOR_STATUSES_V1 = ["watching", "needs_attention", "paused", "unavailable"] as const;
/** 1.21.0: `position` — «Ryntra попередить» on a company the wallet holds, `id` the token's mint. */
export const MONITOR_SUBJECT_KINDS_V1 = ["trading-plan", "prediction-plan", "position"] as const;
/** 1.12.0: a note may also be an autoinvest rule's reminder — a note's subject, never a monitor's (the rule is not a monitor). 1.13.0: or the month's autoinvest budget, spent (`id` «budget:2026-09»). 1.15.0: or an issuer's event about a token the wallet holds (`id` the token's mint) — a window to swap it before the issuer's cut-off. 1.42.0: or a spot limit order Ryntra recorded (`id` its order account) — «Ордер виконано» and «Квитанція готова». */
export const MONITOR_NOTE_SUBJECT_KINDS_V1 = [...MONITOR_SUBJECT_KINDS_V1, "autoinvest-rule", "autoinvest-budget", "issuer-event", "limit-order", "assistant-brief", "launch-creator", "token-watch", "assistant-task", "wallet-watch"] as const;
export const MONITOR_CONDITION_KINDS_V1 = [
  "plan.price_bound",
  "plan.invalidation",
  "plan.expiry",
  "plan.deviation",
  "plan.evidence",
  "prediction.probability",
  "prediction.resolution",
  "prediction.signal",
  /* 1.21.0: a position's target, reached. */
  "plan.target",
] as const;
export const MONITOR_FINDING_OUTCOMES_V1 = ["pass", "fail", "stale", "unavailable", "unknown"] as const;

const MonMonitorId = z.string().regex(/^mon_[0-9a-f]{24}$/);
const MonNoteId = z.string().regex(/^inb_[0-9a-f]{24}$/);
/** A trading plan's symbol (up to 32) or a prediction plan's event title (up to 300). */
const MonLabel = z.string().min(1).max(300);
const MonTitle = z.string().min(1).max(400);
/** Ryntra's sentence; it can carry an evidence read's own reason, so it is bounded generously. */
const MonReason = z.string().max(4000);
const MonCta = z.string().min(1).max(64);

/** The exact record a card or a note stands for: two plans on one symbol are two ids. */
const MonSubject = z.object({ kind: z.enum(MONITOR_SUBJECT_KINDS_V1), id: z.string().min(1).max(64) }).strict();
/** 1.12.0: a note's subject — a card's kinds, and an autoinvest rule whose reminder the note is (`id` the rule's id). */
const MonNoteSubject = z.object({ kind: z.enum(MONITOR_NOTE_SUBJECT_KINDS_V1), id: z.string().min(1).max(64) }).strict();

/** The figures behind a finding, for a reader in any language; a kind names the ones it uses, a reader prints what is there. */
const MonFacts = z
  .object({
    symbol: z.string().min(1).max(32).optional(),
    /** USD per unit of the plan at the tick. */
    price: z.number().nullable().optional(),
    bound: z.number().nullable().optional(),
    invalidation: z.number().nullable().optional(),
    /** 1.21.0: a position's target, USD per unit. */
    target: z.number().nullable().optional(),
    /** Percent. */
    deviationPct: z.number().nullable().optional(),
    maxDeviationPct: z.number().nullable().optional(),
    /** The plan's own entry window end. */
    validUntil: Iso.nullable().optional(),
    /** The evidence metric an evidence finding names. */
    metric: z.string().min(1).max(64).optional(),
    probability: z.number().nullable().optional(),
    maxProbability: z.number().nullable().optional(),
    /** When the market was observed, as the read stated it. */
    observedAt: ProviderTime.nullable().optional(),
  })
  .strict();

const MonFinding = z
  .object({ kind: z.enum(MONITOR_CONDITION_KINDS_V1), outcome: z.enum(MONITOR_FINDING_OUTCOMES_V1), facts: MonFacts })
  .strict();

const MonWords = z.object({ title: MonTitle, reason: MonReason }).strict();

/** A local wall-clock window in an IANA timezone; Telegram and push wait inside it, the inbox does not. */
const MonQuietHours = z.object({ start: ClockTime, end: ClockTime, timezone: z.string().min(1).max(64) }).strict();

/** One monitor as a card: the latest unread note's words where there is one, else the status's own word. */
export const MonitoringCardSchema = z
  .object({
    monitorId: MonMonitorId,
    label: MonLabel,
    status: z.enum(MONITOR_STATUSES_V1),
    title: MonTitle,
    /** Empty when the monitor has no unread note. */
    reason: MonReason,
    /** The note it opens (`inb_…`), else the monitor itself (`mon_…`). */
    href: z.string().regex(/^\/app\/alerts\/open\?n=(?:inb|mon)_[0-9a-f]{24}$/),
    cta: MonCta,
    /** True for a prediction plan: paper, never real money. */
    paper: z.boolean(),
    lastCheckedAt: Iso.nullable(),
    lastTriggeredAt: Iso.nullable(),
    subject: MonSubject,
    finding: MonFinding.nullable(),
  })
  .strict();
export type MonitoringCard = z.infer<typeof MonitoringCardSchema>;

/** One note: written once when a condition crossed, never permission to trade. */
export const MonitoringNoteSchema = z
  .object({
    id: MonNoteId,
    owner: Address,
    monitorId: MonMonitorId,
    /** The crossing's identity; opaque, and it can carry a provider's signal ids, so it is bounded generously. */
    triggerId: z.string().min(1).max(8192),
    /** In the reader's language where the note holds both (`text`), else as the tick wrote it (`locale`). */
    title: MonTitle,
    reason: MonReason,
    /** The monitor's label when the note was written. */
    context: MonLabel,
    href: z.string().regex(/^\/app\/alerts\/open\?n=inb_[0-9a-f]{24}$/),
    cta: MonCta,
    paper: z.boolean(),
    unread: z.boolean(),
    createdAt: Iso,
    locale: z.enum(["en", "uk"]),
    /** Absent on a note written before 2026-09-22, like `text` and `finding`. 1.12.0: `autoinvest-rule` on a rule's reminder. 1.13.0: `autoinvest-budget` on the note that the month's budget is spent. 1.15.0: `issuer-event` on a reminder of an issuer's swap deadline, `id` the token's mint. 1.42.0: `limit-order` on a spot limit order's note, `id` the order account. */
    subject: MonNoteSubject.optional(),
    text: z.object({ en: MonWords, uk: MonWords }).strict().optional(),
    /** Absent on a note whose finding carried no figures (every prediction plan's). */
    finding: MonFinding.optional(),
    /**
     * 1.13.0: on a rule's reminder, what became of it as the rule reads it now —
     * `due` (one tap still buys), `pending`, `bought`, `missed` (no action) — read
     * when the surface is read, never stored; absent on every other note and
     * where the rule is gone.
     */
    ruleState: z.enum(RULE_OCCURRENCE_STATES).optional(),
  })
  .strict();
export type MonitoringNote = z.infer<typeof MonitoringNoteSchema>;

/** Where notes go: `quietHours` null means no window. A wallet that never wrote them reads `{ true, true, null }`. */
export const MonitoringPreferencesSchema = z
  .object({ telegram: z.boolean(), push: z.boolean(), quietHours: MonQuietHours.nullable() })
  .strict();
export type MonitoringPreferences = z.infer<typeof MonitoringPreferencesSchema>;

/**
 * `GET /api/monitoring` — the proven wallet's monitoring surface, behind the
 * native bearer or the `rw` cookie; no rate limiter. It takes `X-Ryntra-API`
 * (another major is 426) and answers `X-Ryntra-API-Version`. `attention` holds
 * the cards whose status is `needs_attention`, `watching` the rest (`watching`,
 * `paused`, `unavailable`), one card per monitored plan; `recent` is every note
 * of the wallet, newest first (nothing removes a monitor or a note); `unread`
 * counts the unread notes in `recent`. The words
 * follow `Accept-Language` (`uk…` Ukrainian, else English) — the words change,
 * never the shape. Errors are the v1 envelope (`ApiErrorSchema`): 426
 * `UNSUPPORTED_API`; 401 `UNAUTHORIZED` · `SESSION_EXPIRED` · `SESSION_REVOKED`
 * and 503 `UNAVAILABLE` from the bearer; and on POST 403 `FORBIDDEN` (a cookie
 * request from another origin) and 400 `VALIDATION_ERROR` (*A JSON body is
 * required.* · *No such note.* · *Quiet hours need a start, an end and a
 * timezone.*). A store fault is an unhandled 500 with no JSON body.
 */
export const MonitoringSurfaceResponseSchema = z
  .object({
    /** Unbounded in the code (one card per plan, every note ever); the bounds are ceilings a wallet cannot reach through the product. */
    attention: z.array(MonitoringCardSchema).max(10_000),
    watching: z.array(MonitoringCardSchema).max(10_000),
    recent: z.array(MonitoringNoteSchema).max(100_000),
    unread: z.number().int().min(0),
    preferences: MonitoringPreferencesSchema,
  })
  .strict();
export type MonitoringSurfaceResponse = z.infer<typeof MonitoringSurfaceResponseSchema>;

/**
 * `POST /api/monitoring` marks a note read: idempotent; another wallet's note or
 * an unknown id is 400 *No such note.* Any string is read as an id (`inb_…`).
 */
export const MonitoringReadRequestSchema = z.object({ read: z.string() });
export type MonitoringReadRequest = z.input<typeof MonitoringReadRequestSchema>;

/**
 * `POST /api/monitoring` writes where notes go: a field left out keeps its
 * value, `quietHours: null` clears the window, an invalid window is 400.
 */
export const MonitoringPreferencesRequestSchema = z.object({
  telegram: z.boolean().optional(),
  push: z.boolean().optional(),
  quietHours: z.object({ start: ClockTime, end: ClockTime, timezone: z.string().min(1).max(64) }).nullable().optional(),
});
export type MonitoringPreferencesRequest = z.input<typeof MonitoringPreferencesRequestSchema>;

/**
 * The two bodies `POST /api/monitoring` accepts, as the handler tells them
 * apart: a string `read` is a read mark and every other key is ignored;
 * anything else is a preferences write. Not `.strict()` anywhere: the handler
 * ignores keys it does not read — including a non-string `read` — so a stricter
 * schema would refuse a body the route accepts.
 */
export const MonitoringWriteRequestSchema = z.union([MonitoringReadRequestSchema, MonitoringPreferencesRequestSchema]);
export type MonitoringWriteRequest = z.input<typeof MonitoringWriteRequestSchema>;

/** Both writes answer `{ ok: true }`. */
export const MonitoringWriteResponseSchema = z.object({ ok: z.literal(true) }).strict();
export type MonitoringWriteResponse = z.infer<typeof MonitoringWriteResponseSchema>;

/* ------------------------------------------------------------ the consumed swap routes: quote, order, execute, cancel-review, recover (1.11.0) */

/**
 * 1.11.0: the five swap routes the web's Swap and Spot cards and the phone's
 * Trade use for real trades, described as they serve today; nothing about a
 * route changed. They are not `/api/v1` routes: they send no
 * `X-Ryntra-API-Version`, and their error is `{ error: { code, message,
 * …extra } }` with route-specific codes and extra fields (each route's error
 * schema below lists both). An unexpected exception inside a handler is the
 * platform's bodyless 500, not this shape.
 *
 * Two rules shape the schemas that travel both ways. The execute request
 * echoes the order answer's `bundle` and `proof`; the parts of the bundle
 * mirror the execute handler's own validator (`SwapExecutionBundleSchema`)
 * rule for rule, so a request schema here is never stricter than the
 * handler — which is why those parts use `SwapDigits` and unbounded provider
 * text where the order route's normalizer in fact bounds the served values
 * (text 44–256 characters, amounts u64). Everything only served (the Jupiter
 * order, the passports, the observation, the facts, the receipt) is bounded
 * as the code that builds it bounds it.
 */

/** A Solana transaction signature: base58 of 64 bytes, the rule `/recover` validates with. */
const SwapSignature = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,90}$/);
/** `0x` and a SHA-256 in lowercase hex — every digest a swap artifact carries. */
const SwapDigest = z.string().regex(/^0x[0-9a-f]{64}$/);
/** The raw-amount rule of the execute handler's bundle validator (no length bound); u64 values in practice. */
const SwapDigits = z.string().regex(/^[0-9]+$/);
/** A signed raw integer as decimal text — a delta. */
const SwapSignedRaw = z.string().regex(/^-?[0-9]{1,40}$/);
/** Exception, RPC or provider text the code does not bound; the bound is a generous one, not the code's. */
const SwapText = z.string().max(16_384);
/** Where a figure was read: a machine reference and the words a person reads. */
const SwapSource = z.object({ ref: z.string().min(1).max(512), label: z.string().min(1).max(512) }).strict();

function swapDistinctMints(value: { inputMint: string; outputMint: string }, context: z.RefinementCtx): void {
  if (value.inputMint === value.outputMint) {
    context.addIssue({ code: "custom", path: ["outputMint"], message: "The two sides are the same mint." });
  }
}

/* ---- requests */

/** The quote request (`POST /api/solana/swap/quote`): strict, `access` defaults to `production`. */
export const SwapQuoteRequestSchema = z
  .object({
    inputMint: Address,
    outputMint: Address,
    amountRaw: z.string().regex(/^[1-9][0-9]{0,19}$/),
    access: z.enum(["production", "degraded"]).default("production"),
  })
  .strict()
  .superRefine(swapDistinctMints);
export type SwapQuoteRequest = z.input<typeof SwapQuoteRequestSchema>;

/** Spot names itself with a side; a plan names itself with the version the client read; (1.12.0) a rule's reminder names the rule and the occurrence. The Swap card sends nothing. */
export const SwapOriginRequestSchema = z
  .object({
    surface: z.enum(["SPOT"]),
    side: z.enum(["BUY", "SELL"]),
    plan: ExecutionPlanBindingSchema.optional(),
    rule: RuleBindingSchema.optional(),
  })
  .strict();
export type SwapOriginRequest = z.infer<typeof SwapOriginRequestSchema>;

/** The order request (`POST /api/solana/swap/order`): strict at both levels. */
export const SwapOrderRequestSchema = z
  .object({
    input: z
      .object({
        inputMint: Address,
        outputMint: Address,
        amountRaw: z.string().regex(/^[1-9][0-9]{0,19}$/),
        taker: Address,
      })
      .strict()
      .superRefine(swapDistinctMints),
    origin: SwapOriginRequestSchema.optional(),
  })
  .strict();
export type SwapOrderRequest = z.infer<typeof SwapOrderRequestSchema>;

/* ---- the fee, the Jupiter order, the Review */

export const SWAP_SERVICE_FEE_STATES_V1 = ["NONE", "UNCONFIGURED", "NOT_APPLIED", "QUOTED", "COLLECTED", "NOT_COLLECTED"] as const;

/**
 * Ryntra's own fee on the swap, with its mechanism and whether it was ever
 * collected (`COLLECTED` is the only income). Mirrors `ServiceFeeSchema`
 * exactly, `settlement` defaulting to null as there: an execute request may
 * echo a bundle sealed before the split existed, and every answer carries it.
 */
export const SwapServiceFeeSchema = z
  .object({
    mechanism: z.enum(["JUPITER_REFERRAL", "JUPITER_PLATFORM_FEE", "RELAY_APP_FEE", "MAYAN_REFERRER", "METEORA_LAUNCH", "NONE"]),
    state: z.enum(SWAP_SERVICE_FEE_STATES_V1),
    basisPoints: z.number().int().min(0).max(10_000),
    requestedBasisPoints: z.number().int().min(0).max(10_000),
    asset: z.string().min(1).max(64).nullable(),
    symbol: z.string().min(1).max(32).nullable(),
    decimals: z.number().int().min(0).max(24).nullable(),
    amountRaw: SwapDigits.nullable(),
    usd: z.number().finite().nullable(),
    accrual: z.enum(["JUPITER_REFERRAL_TOKEN_ACCOUNT", "FEE_WALLET_TOKEN_ACCOUNT", "RELAY_APP_BALANCE_USDC", "MAYAN_ONCHAIN_REFERRER", "METEORA_PARTNER_VAULT", "NONE"]),
    providerRetainedPercent: z.number().int().min(0).max(100).nullable(),
    settlement: z
      .object({
        userPaidRaw: SwapDigits.nullable(),
        providerRaw: SwapDigits.nullable(),
        ryntraRaw: SwapDigits.nullable(),
        asset: z.string().min(1).max(64).nullable(),
        symbol: z.string().min(1).max(32).nullable(),
        decimals: z.number().int().min(0).max(24).nullable(),
        basis: z.enum(["OBSERVED", "RYNTRA_OBSERVED_SPLIT_DOCUMENTED"]),
        operationRef: z.string().min(1).max(128),
      })
      .strict()
      .nullable()
      .default(null),
    note: z.string().min(1).max(400).nullable(),
  })
  .strict();
export type SwapServiceFee = z.infer<typeof SwapServiceFeeSchema>;

/** One hop of the route as Jupiter stated it (normalizer bounds: ammKey 44, label 96). */
export const SwapJupiterRouteHopSchema = z
  .object({
    ammKey: z.string().min(1).max(44),
    label: z.string().min(1).max(96),
    inputMint: z.string().min(1).max(44),
    outputMint: z.string().min(1).max(44),
    inAmountRaw: RawAmount,
    outAmountRaw: RawAmount,
    basisPoints: z.number().int().min(0).max(10_000),
  })
  .strict();
export type SwapJupiterRouteHop = z.infer<typeof SwapJupiterRouteHopSchema>;

/** Jupiter's `/order`, normalized (`quotes.ts`): every text bounded by the normalizer, the mints and input amount equal to the request's. */
const SwapJupiterOrderShape = {
  schemaVersion: z.literal("1.0.0"),
  provider: z.literal("jupiter"),
  /** 1.24.0: `BUILD_SUBMIT` — Jupiter's `/build` instructions, assembled and sent by Ryntra. */
  path: z.enum(["ORDER_EXECUTE", "BUILD_SUBMIT"]),
  access: z.enum(["production", "degraded"]),
  tier: z.enum(["pro", "lite"]),
  swapType: z.string().min(1).max(64),
  swapMode: z.string().min(1).max(64),
  router: z.string().min(1).max(64),
  mode: z.string().min(1).max(64),
  inputMint: Address,
  outputMint: Address,
  inAmountRaw: RawAmount,
  outAmountRaw: RawAmount,
  minReceivedRaw: RawAmount,
  slippageBps: z.number().int().min(0).max(10_000),
  /** Provider text, as Jupiter states it. */
  priceImpactPct: z.string().min(1).max(128),
  /** Provider figures as text (a number Jupiter sent is `String(n)`); not validated as decimals. */
  inUsdValue: z.string().min(1).max(128).nullable(),
  outUsdValue: z.string().min(1).max(128).nullable(),
  swapUsdValue: z.string().min(1).max(128).nullable(),
  totalFeeBasisPoints: z.number().int().min(0).max(10_000),
  totalFeeMint: z.string().min(1).max(44),
  platformFee: z
    .object({ basisPoints: z.number().int().min(0).max(10_000), mint: z.string().min(1).max(44), amountRaw: RawAmount.nullable() })
    .strict(),
  /** `/order` quotes no separate provider amount; never inferred. */
  providerFee: z.object({ basisPoints: z.null(), mint: z.null(), amountRaw: z.null() }).strict(),
  ryntraFee: SwapServiceFeeSchema,
  /** The referral account Jupiter echoed back — the field that decides whether the fee exists. */
  providerReferralAccount: z.string().min(1).max(44).nullable(),
  /** 1.24.0, `BUILD_SUBMIT` only: the fee wallet and its token account the fee is paid into. */
  ryntraFeeAccount: z.object({ owner: Address, account: Address }).strict().optional(),
  signatureFeeLamports: RawAmount,
  signatureFeePayer: z.string().min(1).max(44).nullable(),
  priorityFeeLamports: RawAmount,
  priorityFeePayer: z.string().min(1).max(44).nullable(),
  /** On `/order` the rent the simulation proved replaces the venue's estimate when they differ. */
  rentFeeLamports: RawAmount,
  rentFeePayer: z.string().min(1).max(44).nullable(),
  gasless: z.boolean(),
  guaranteedPrice: z.boolean(),
  jitOptimized: z.boolean(),
  route: z.array(SwapJupiterRouteHopSchema).max(32),
  /** Every optional routing parameter sent (`excludeRouters=…`, `slippageBps=…`, `referralFee=…`, `referralAccount=set`). */
  routeAffectingOptions: z.array(z.string().min(1).max(256)).max(8),
  requestId: z.string().min(1).max(128),
  providerExpiresAt: Iso.nullable(),
  /** The earlier of Ryntra's 45-second review window and the provider's own expiry. */
  reviewExpiresAt: Iso,
  latencyMs: z.number().int(),
  observedAt: Iso,
  source: SwapSource,
} as const;

/** The quote route's order: no taker, no transaction. */
export const SwapJupiterQuoteSchema = z
  .object({
    schema: z.literal("ryntra.solana.jupiter-order-quote"),
    execution: z.literal("NOT_EXECUTED"),
    taker: z.null(),
    transactionBase64: z.null(),
    ...SwapJupiterOrderShape,
  })
  .strict();
export type SwapJupiterQuote = z.infer<typeof SwapJupiterQuoteSchema>;

/** The order route's order: the taker and the provider-built bytes the wallet signs. */
export const SwapJupiterOrderSchema = z
  .object({
    schema: z.literal("ryntra.solana.jupiter-executable-order"),
    execution: z.literal("EXECUTABLE_NOT_SUBMITTED"),
    taker: Address,
    transactionBase64: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/).max(6_000),
    lastValidBlockHeight: RawAmount,
    ...SwapJupiterOrderShape,
  })
  .strict();
export type SwapJupiterOrder = z.infer<typeof SwapJupiterOrderSchema>;

const SwapReviewFeeSchema = z
  .object({ basisPoints: z.number().int().min(0).max(10_000).nullable(), mint: z.string().nullable(), amountRaw: SwapDigits.nullable() })
  .strict();

/** The reviewed quote snapshot inside the Review — the execute handler's rules (`swap-review.ts`), text unbounded there. */
const SwapReviewQuoteSchema = z
  .object({
    schema: z.literal("ryntra.solana.jupiter-order-quote"),
    schemaVersion: z.literal("1.0.0"),
    provider: z.literal("jupiter"),
    path: z.enum(["ORDER_EXECUTE", "BUILD_SUBMIT"]),
    access: z.enum(["production", "degraded"]),
    tier: z.enum(["pro", "lite"]),
    execution: z.literal("NOT_EXECUTED"),
    router: z.string().min(1),
    mode: z.string().min(1),
    swapType: z.string().min(1),
    swapMode: z.string().min(1),
    requestId: z.string().min(1),
    inputMint: z.string().min(32).max(44),
    outputMint: z.string().min(32).max(44),
    inputRaw: SwapDigits,
    quotedOutputRaw: SwapDigits,
    minimumOutputRaw: SwapDigits,
    slippageBps: z.number().int().min(0).max(10_000),
    priceImpactPct: z.string().min(1),
    inUsdValue: z.string().min(1).nullable(),
    outUsdValue: z.string().min(1).nullable(),
    swapUsdValue: z.string().min(1).nullable(),
    totalFeeBasisPoints: z.number().int().min(0).max(10_000),
    totalFeeMint: z.string().min(32).max(44),
    platformFee: SwapReviewFeeSchema,
    providerFee: SwapReviewFeeSchema,
    ryntraFee: SwapServiceFeeSchema,
    providerReferralAccount: z.string().min(32).max(44).nullable(),
    ryntraFeeAccount: z.object({ owner: z.string().min(32).max(44), account: z.string().min(32).max(44) }).strict().optional(),
    signatureFeeLamports: SwapDigits,
    signatureFeePayer: z.string().min(32).max(44).nullable(),
    priorityFeeLamports: SwapDigits,
    priorityFeePayer: z.string().min(32).max(44).nullable(),
    rentFeeLamports: SwapDigits,
    rentFeePayer: z.string().min(32).max(44).nullable(),
    gasless: z.boolean(),
    guaranteedPrice: z.boolean(),
    jitOptimized: z.boolean(),
    route: z
      .array(
        z
          .object({
            ammKey: z.string().min(1),
            label: z.string().min(1),
            inputMint: z.string().min(1),
            outputMint: z.string().min(1),
            inAmountRaw: SwapDigits,
            outAmountRaw: SwapDigits,
            basisPoints: z.number().int().min(0).max(10_000),
          })
          .strict(),
      )
      .max(32),
    routeAffectingOptions: z.array(z.string()).max(16),
    taker: z.null(),
    transactionBase64: z.null(),
    observedAt: Iso,
    providerExpiresAt: Iso.nullable(),
    reviewExpiresAt: Iso,
    latencyMs: z.number().int().min(0),
    sourceRef: z.string().min(1),
    sourceLabel: z.string().min(1),
  })
  .strict();

/**
 * The Swap Quote Review: the quote a person reviews, hash-bound twice
 * (`quoteDigest` over the snapshot, `reviewDigest` over the Review). Served
 * by `/quote` and `/order` and echoed inside the execute request's bundle.
 */
export const SwapReviewSchema = z
  .object({
    schema: z.literal("ryntra.solana.swap-quote-review"),
    schemaVersion: z.literal("1.0.0"),
    state: z.enum(["FRESH", "STALE", "PROVIDER_DEGRADED"]),
    execution: z.literal("NOT_EXECUTED"),
    quoteDigest: SwapDigest,
    reviewDigest: SwapDigest,
    quote: SwapReviewQuoteSchema,
    limitations: z.tuple([z.literal("QUOTE_ONLY"), z.literal("NO_SIGNATURE"), z.literal("NO_EXECUTION"), z.literal("NO_RECEIPT")]),
  })
  .strict();
export type SwapReview = z.infer<typeof SwapReviewSchema>;

/* ---- the asset: passports and the review policy over the output mint */

const SwapProvenance = z.enum(["ONCHAIN_VERIFIED", "DECLARED", "DERIVED", "CONFLICTING", "UNKNOWN", "UNSUPPORTED"]);
const swapFact = <T extends z.ZodType>(value: T) =>
  z.object({ value, provenance: SwapProvenance, meaning: z.string().min(1).max(1_024) }).strict();

/**
 * One mint's Asset Passport, read live from the chain for this answer
 * (`passport.ts`). Extension `fields` are the decoded on-chain values
 * flattened to dot paths — chain-sourced text the code does not bound.
 */
export const SwapPassportSchema = z
  .object({
    schema: z.literal("ryntra.solana.asset-passport"),
    schemaVersion: z.literal("0.1.0"),
    network: z.enum(["mainnet", "devnet"]),
    identity: z
      .object({
        mint: Address,
        programKind: z.enum(["SPL_TOKEN", "TOKEN_2022", "NOT_A_MINT"]),
        programId: Address,
        decimals: swapFact(z.number().int().min(0).max(255)),
        supply: swapFact(RawAmount),
        mintAuthority: swapFact(Address.nullable()),
        freezeAuthority: swapFact(Address.nullable()),
        isInitialized: swapFact(z.boolean()),
      })
      .strict(),
    extensions: z
      .array(
        z
          .object({
            kind: z.string().min(1).max(64),
            provenance: SwapProvenance,
            meaning: z.string().min(1).max(1_024),
            fields: z.record(z.string().max(256), z.union([z.string().max(65_536), z.number(), z.boolean(), z.null()])),
            affectsTransfers: z.boolean(),
          })
          .strict(),
      )
      .max(64),
    unsupportedKinds: z.array(z.string().min(1).max(64)).max(64),
    observedAt: Iso,
    source: SwapSource,
  })
  .strict();
export type SwapPassport = z.infer<typeof SwapPassportSchema>;

export const SWAP_ASSET_POLICY_RULES_V1 = [
  "NETWORK_ALLOWED",
  "MINT_ALLOWED",
  "TOKEN_PROGRAM_ALLOWED",
  "NOT_STRUCTURALLY_DOOMED",
  "PERMANENT_DELEGATE_ACCEPTED",
  "TRANSFER_HOOK_ALLOWLISTED",
  "FEE_WITHIN_CAP",
  "RECIPIENT_ALLOWED",
  "AMOUNT_WITHIN_LIMIT",
  "DEFAULT_FROZEN_ACCEPTED",
  "EVIDENCE_FRESH",
  "EXTENSIONS_UNDERSTOOD",
  "HUMAN_APPROVAL",
] as const;

/**
 * The review policy's verdict over the output mint — what receiving it would
 * subject any holder to (`policy.ts`), one finding per rule. Never "safe":
 * the best verdict is `NO_KNOWN_BLOCKER`.
 */
export const SwapAssetVerdictSchema = z
  .object({
    schema: z.literal("ryntra.solana.policy-verdict"),
    schemaVersion: z.literal("0.1.0"),
    verdict: z.enum(["NO_KNOWN_BLOCKER", "REVIEW_REQUIRED", "BLOCKED", "INCOMPLETE"]),
    findings: z
      .array(
        z
          .object({
            rule: z.enum(SWAP_ASSET_POLICY_RULES_V1),
            outcome: z.enum(["ALLOWED", "REVIEW_REQUIRED", "BLOCKED", "INCOMPLETE"]),
            detail: z.string().min(1).max(2_048),
          })
          .strict(),
      )
      .min(1)
      .max(13),
    evaluatedAt: Iso,
  })
  .strict();
export type SwapAssetVerdict = z.infer<typeof SwapAssetVerdictSchema>;

/* ---- 1.85.0: the risk verdict a trade is judged by before it is signed */

export const TRADE_RISK_FACTS_V1 = TRADE_RISK_FACTS;
export const TRADE_RISK_KINDS_V1 = TRADE_KINDS;

/**
 * The verdict over one trade (`lib/solana/trade-risk.ts`), in the four words
 * the review over a mint already uses — `BLOCKED` outranks `INCOMPLETE`,
 * which outranks `REVIEW_REQUIRED`, which outranks `NO_KNOWN_BLOCKER`.
 *
 * There is no score and no single number. Each of the thirteen facts carries
 * the source that produced it and the time it was read, a fact that was not
 * read is `INCOMPLETE` with `missing` naming what is absent, and `limits`
 * states the thresholds the measured facts were read against — so a client can
 * show a person exactly what put a trade where it is.
 *
 * `NO_KNOWN_BLOCKER` reports the absence of known blockers. It is not "safe",
 * and a client that renders it as "safe" is wrong about this contract.
 */
export const TradeRiskSchema = z
  .object({
    schema: z.literal("ryntra.solana.trade-risk-verdict"),
    schemaVersion: z.literal("1.0.0"),
    trade: z.object({ kind: z.enum(TRADE_RISK_KINDS_V1), network: z.enum(TRADE_RISK_NETWORKS), mint: Address }).strict(),
    verdict: z.enum(["NO_KNOWN_BLOCKER", "REVIEW_REQUIRED", "BLOCKED", "INCOMPLETE"]),
    findings: z
      .array(
        z
          .object({
            fact: z.enum(TRADE_RISK_FACTS_V1),
            outcome: z.enum(["ALLOWED", "REVIEW_REQUIRED", "BLOCKED", "INCOMPLETE"]),
            detail: z.string().min(1).max(2_048),
            /** Null only where nothing was read: an `INCOMPLETE` has no source to name. */
            source: z
              .object({ ref: z.string().min(1).max(128), label: z.string().min(1).max(256), readAt: Iso, slot: z.number().int().nonnegative().nullable() })
              .strict()
              .nullable(),
            /** What exactly is missing, in the words a Review shows. Null unless `INCOMPLETE`. */
            missing: z.string().min(1).max(512).nullable(),
          })
          .strict(),
      )
      .length(TRADE_RISK_FACTS_V1.length),
    limits: z
      .object({
        slippageReviewBps: z.number().int().min(0).max(10_000),
        slippageBlockBps: z.number().int().min(0).max(10_000),
        quoteFreshSeconds: z.number().int().min(1),
        factsFreshSeconds: z.number().int().min(1),
        topPlainHolderReviewShare: z.number().min(0).max(1),
        topFivePlainHoldersReviewShare: z.number().min(0).max(1),
        creatorHoldsReviewShare: z.number().min(0).max(1),
        transferFeeReviewBps: z.number().int().min(0).max(10_000),
      })
      .strict(),
    evaluatedAt: Iso,
  })
  .strict();
export type TradeRisk = z.infer<typeof TradeRiskSchema>;

/* ---- «Перевірка», counted by the server (1.20.0) */

export const CHECK_SIDES = ["buy", "sell"] as const;
/** `quote`: the live quote's figures, before a Review; `order`: the exact order the wallet will sign. */
export const CHECK_BASES = ["quote", "order"] as const;
/** The unit an amount is in: USDC counted as dollars, or the company's share or token as the wallet shows it. */
export const CHECK_UNITS = ["usdc", "share", "token"] as const;
export const CHECK_NOTE_KINDS = ["issuer-event", "sale-may-fail"] as const;

const CheckDollars = z.number().finite().nonnegative();
const CheckWordsSchema = z.object({ en: z.string().min(1).max(600), uk: z.string().min(1).max(600) }).strict();

/**
 * 1.20.0 — «Перевірка» as the server counts it (`lib/stocks/check.ts`): the
 * four lines a person reads before the signature — Спишеться · Отримаєш ·
 * Усі витрати · Що це — and the account's one-time reserve, for a company
 * bought with USDC or sold into it. A client draws these figures and counts
 * none of them. An amount that could not be counted is null, never zero.
 */
export const SwapCheckSchema = z
  .object({
    side: z.enum(CHECK_SIDES),
    basis: z.enum(CHECK_BASES),
    /** The company as its page names it, with the decimals and the multiplier read for this answer (null: the mint carries no Scaled UI Amount). */
    company: z
      .object({
        mint: Address,
        symbol: z.string().min(1).max(32),
        name: z.string().min(1).max(200),
        issuer: z.enum(STOCK_ISSUER_IDS),
        unit: z.enum(["share", "token"]),
        privateCompany: z.boolean(),
        decimals: z.number().int().min(0).max(255),
        multiplier: z.number().finite().positive().nullable(),
      })
      .strict(),
    /** «Спишеться»: what leaves the wallet; `usd` the purchase's dollars, or the venue's value of what a sale gives. */
    spend: z.object({ mint: Address, unit: z.enum(CHECK_UNITS), amount: CheckDollars.nullable(), usd: CheckDollars.nullable() }).strict(),
    /** «Отримаєш»: what arrives, about, and at least (the chain's minimum); `usd` the venue's value of it, or the sale's dollars. */
    get: z.object({ mint: Address, unit: z.enum(CHECK_UNITS), amount: CheckDollars.nullable(), atLeast: CheckDollars.nullable(), usd: CheckDollars.nullable() }).strict(),
    /** «Усі витрати» in dollars, with the issuer's fee inside it at the rate the chain states said alone; null when a figure it needs is unknown. */
    costs: z
      .object({ usd: CheckDollars, issuerFee: z.object({ basisPoints: z.number().int().min(1).max(10_000), usd: CheckDollars }).strict().nullable() })
      .strict()
      .nullable(),
    /** The one-time rent an account the transaction opens keeps in the wallet — on the order only, the figure the simulation proved; `first` when it is more than the purchase. */
    reserve: z.object({ lamports: RawAmount, usd: CheckDollars.nullable(), first: z.boolean() }).strict().nullable(),
    /** «Що це»: the truth line in both languages, the line under it, and whether it is said with care (a private company). */
    what: z
      .object({
        truth: CheckWordsSchema,
        note: z.object({ kind: z.enum(CHECK_NOTE_KINDS), en: z.string().min(1).max(600), uk: z.string().min(1).max(600) }).strict().nullable(),
        caution: z.boolean(),
      })
      .strict(),
    /** SOL's price the network's fee and the reserve were counted at, and when it was read; null when unread. */
    sol: z.object({ usd: z.number().finite().positive().nullable(), observedAt: ProviderTime.nullable() }).strict(),
  })
  .strict();
export type SwapCheckDto = z.infer<typeof SwapCheckSchema>;

/**
 * `POST /api/solana/swap/quote` — public and wallet-free (no origin or bearer
 * check), on the Solana read budget. Answers the live keyed Jupiter `/order`
 * without a taker, its Review, the review policy's verdict over the output
 * mint, both mints' decimals and Asset Passports (keyed by mint), the
 * Token-2022 transfer fee the output mint takes from the quoted output, and
 * the Review's expiry; 1.20.0: `check`, «Перевірка» on the quote (no
 * reserve), null unless a company is bought with USDC or sold into it. Builds
 * no transaction and cannot sign. Fails
 * `SwapQuoteErrorSchema`: 429 `RATE_LIMITED`; 415/413/400 body codes; 400
 * `VALIDATION_ERROR`; 409 `ASSET_NOT_OFFERED` (with `lifecycle`); 503
 * `PROVIDER_KEY_MISSING`; 422 `MINT_UNREADABLE` · `PASSPORT_REFUSED` ·
 * `PREFLIGHT_REFUSED`; `QUOTE_*` with `provider` — 409 `QUOTE_NO_ROUTE`,
 * 429 `QUOTE_RATE_LIMITED`, 502 the others.
 */
export const SwapQuoteResponseSchema = z
  .object({
    order: SwapJupiterQuoteSchema,
    review: SwapReviewSchema,
    verdict: SwapAssetVerdictSchema,
    decimals: z.record(Address, z.number().int().min(0).max(255)),
    /** The output mint's `TransferFeeConfig` applied to the quoted output (u16 basis points; zeros without the extension). */
    outputFee: z.object({ basisPoints: z.number().int().min(0).max(65_535), feeRaw: RawAmount, capApplied: z.boolean() }).strict(),
    passports: z.record(Address, SwapPassportSchema),
    expiresAt: Iso,
    /** 1.20.0: «Перевірка» on the quote — no reserve here; null unless a company is bought with USDC or sold into it. */
    check: SwapCheckSchema.nullable(),
    /** 1.85.0: the risk verdict over this trade — thirteen named facts, each with its source and its time. */
    risk: TradeRiskSchema,
  })
  .strict();
export type SwapQuoteResponse = z.infer<typeof SwapQuoteResponseSchema>;

/* ---- the exact bytes: inspection, simulation, policy, bundle, proof */

/** The pre-sign firewall's reading of the provider transaction (`SwapExecutionInspectionSchema`). */
export const SwapInspectionSchema = z
  .object({
    messageHashHex: z.string().regex(/^[0-9a-f]{64}$/),
    version: z.literal(0),
    feePayer: z.string().min(32).max(44),
    signerAddresses: z.array(z.string().min(32).max(44)).min(1).max(8),
    providerPresignedCount: z.number().int().min(0).max(8),
    blockhash: z.string().min(32).max(44),
    programs: z.array(z.string().min(32).max(44)).min(1).max(64),
    tokenProgramIndices: z.array(z.number().int().min(0).max(255)).max(2),
    staticAccountCount: z.number().int().min(1).max(256),
    staticAccounts: z.array(z.string().min(32).max(44)).min(1).max(256),
    lookupTables: z
      .array(
        z
          .object({
            table: z.string().min(32).max(44),
            writableCount: z.number().int().min(0).max(256),
            readonlyCount: z.number().int().min(0).max(256),
          })
          .strict(),
      )
      .max(8),
    instructionCount: z.number().int().min(1).max(64),
    wireBytes: z.number().int().min(1).max(4_096),
    nativeWrapRoundTrip: z
      .object({
        accountIndex: z.number().int().min(1).max(255),
        account: z.string().min(32).max(44).nullable(),
        fundedLamportsRaw: SwapDigits,
        closesToTaker: z.literal(true),
      })
      .strict()
      .nullable(),
    nativeWrapCandidate: z
      .object({
        accountIndex: z.number().int().min(1).max(255),
        account: z.string().min(32).max(44).nullable(),
        fundedLamportsRaw: SwapDigits,
      })
      .strict()
      .nullable(),
  })
  .strict();
export type SwapInspection = z.infer<typeof SwapInspectionSchema>;

const SwapEffectUint = z.string().regex(/^(0|[1-9][0-9]{0,39})$/);
const SwapEffectInt = z.string().regex(/^(0|-?[1-9][0-9]{0,39})$/);

/** What the simulation of the exact bytes proved the taker's own assets do (`SwapOwnerEffectProofSchema`). */
export const SwapOwnerEffectsSchema = z
  .object({
    status: z.literal("VERIFIED"),
    method: z.literal("SIMULATION_OWNER_DELTAS_V1"),
    tokenInstructionAudit: z.literal("NO_UNSAFE_MUTATIONS"),
    nativeWrapRoundTrip: z.boolean(),
    programs: z.array(z.string().min(32).max(44)).min(1).max(64),
    taker: z.string().min(32).max(44),
    inputMint: z.string().min(32).max(44),
    outputMint: z.string().min(32).max(44),
    inputAmountRaw: SwapEffectUint,
    outputAmountRaw: SwapEffectUint,
    minimumOutputRaw: SwapEffectUint,
    inputRepresentation: z.enum(["TOKEN", "NATIVE_SOL"]),
    outputRepresentation: z.enum(["TOKEN", "NATIVE_SOL"]),
    feeLamports: SwapEffectUint,
    takerLamportDelta: SwapEffectInt,
    ownerTokenDeltas: z.array(z.object({ mint: z.string().min(32).max(44), rawDelta: SwapEffectInt }).strict()).max(32),
    accountVectorCount: z.number().int().min(1).max(256),
    /** Always present on a Review built today; optional for a bundle issued before the field existed. */
    durableRentLamports: SwapEffectUint.optional(),
    rentProof: z.enum(["EXACT_MINIMUM", "REVIEWED_CEILING", "NONE"]).optional(),
  })
  .strict();
export type SwapOwnerEffects = z.infer<typeof SwapOwnerEffectsSchema>;

/** The simulation of the exact provider bytes: `OK` carries the owner-effect proof, `FAILED` never does. */
export const SwapSimulationSchema = z
  .object({
    status: z.enum(["OK", "FAILED"]),
    unitsConsumed: SwapDigits.nullable(),
    error: z.string().max(512).nullable(),
    sourceHost: z.string().min(1).max(128),
    observedAt: Iso,
    ownerEffects: SwapOwnerEffectsSchema.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.status === "OK" && value.ownerEffects === null) {
      context.addIssue({ code: "custom", path: ["ownerEffects"], message: "A successful simulation must carry a verified owner-effect proof." });
    }
    if (value.status === "FAILED" && value.ownerEffects !== null) {
      context.addIssue({ code: "custom", path: ["ownerEffects"], message: "A failed simulation cannot claim verified owner effects." });
    }
  });
export type SwapSimulation = z.infer<typeof SwapSimulationSchema>;

const SwapPolicyRaw = z.string().regex(/^(?:0|[1-9][0-9]{0,39})$/);
const SwapPolicyDecimal = z.string().regex(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/);

/** The swap intent the product policy judges (`SwapPolicyIntentSchema`). */
export const SwapIntentSchema = z
  .object({
    schema: z.literal("ryntra.solana.swap-intent"),
    schemaVersion: z.literal("1.0.0"),
    intentId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,127}$/),
    revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    network: z.literal("mainnet"),
    signer: Address,
    inputMint: Address,
    outputMint: Address,
    inputAmountRaw: SwapPolicyRaw,
    quotedOutputRaw: SwapPolicyRaw,
    minimumOutputRaw: SwapPolicyRaw,
    slippageBps: z.number().int().min(0).max(10_000),
    priceImpactPct: z.string().max(64),
    programs: z.array(Address).min(1).max(64),
    usd: z
      .object({
        inValue: SwapPolicyDecimal.nullable(),
        outValue: SwapPolicyDecimal.nullable(),
        swapValue: SwapPolicyDecimal.nullable(),
        sourceRef: z.string().min(1).max(256),
      })
      .strict()
      .nullable(),
    reviewExpiresAt: Iso,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.inputMint === value.outputMint) {
      context.addIssue({ code: "custom", path: ["outputMint"], message: "A swap intent needs two distinct mints." });
    }
    if (BigInt(value.minimumOutputRaw) > BigInt(value.quotedOutputRaw)) {
      context.addIssue({ code: "custom", path: ["minimumOutputRaw"], message: "The minimum received cannot exceed the quoted output." });
    }
  });
export type SwapIntent = z.infer<typeof SwapIntentSchema>;

/** The swap policy's twelve rules, in the order a person checks them (`swap-policy-rules.ts`). */
export const SWAP_POLICY_RULES_V1 = [
  "NETWORK_MAINNET",
  "PAIR_DISTINCT",
  "OUTPUT_ASSET_REVIEWED",
  "PAYOUT_TO_SIGNER",
  "FEE_PAYER_IS_SIGNER",
  "BYTES_INSPECTED",
  "SIMULATION_OK",
  "OWNER_EFFECTS_PROVEN",
  "SLIPPAGE_BOUNDED",
  "PRICE_IMPACT_DISCLOSED",
  "VALUE_DISCLOSED",
  "REVIEW_FRESH",
] as const;

/** The swap policy's verdict: one finding per rule; only a `BLOCK` stops the bytes. */
export const SwapVerdictSchema = z
  .object({
    schema: z.literal("ryntra.solana.swap-verdict"),
    schemaVersion: z.literal("1.0.0"),
    decision: z.enum(["ALLOW", "REVIEW", "BLOCK"]),
    policyId: z.literal("ryntra-solana-swap-v1"),
    policyDigest: SwapDigest,
    intentDigest: SwapDigest,
    findings: z
      .array(
        z
          .object({
            rule: z.enum(SWAP_POLICY_RULES_V1),
            outcome: z.enum(["PASS", "REVIEW", "BLOCK"]),
            detail: z.string().min(1).max(512),
          })
          .strict(),
      )
      .length(SWAP_POLICY_RULES_V1.length),
    evaluatedAt: Iso,
  })
  .strict();
export type SwapVerdict = z.infer<typeof SwapVerdictSchema>;

/** Where the order was started from, as the signed bundle records it: the plan binding gains the Review's id; (1.12.0) the rule binding travels as the order named it. */
export const SwapOriginSchema = z
  .object({
    surface: z.enum(["SPOT"]),
    side: z.enum(["BUY", "SELL"]),
    plan: ExecutionPlanBindingSchema.extend({ reviewId: z.string().min(8).max(64) }).strict().optional(),
    rule: RuleBindingSchema.optional(),
  })
  .strict();
export type SwapOrigin = z.infer<typeof SwapOriginSchema>;

const SwapBundleShape = {
  review: SwapReviewSchema,
  taker: z.string().min(32).max(44),
  lastValidBlockHeight: SwapDigits,
  inspection: SwapInspectionSchema,
  simulation: SwapSimulationSchema,
  policyIntent: SwapIntentSchema,
  policyVerdict: SwapVerdictSchema,
  /** Absent for a plain Swap. */
  origin: SwapOriginSchema.optional(),
  /** Present only under a plan: the Strategy block that stood before the signature. */
  planReview: PlanReviewSchema.optional(),
} as const;

/** The issuer-signed execution bundle as `/order` serves it — exactly these keys. */
export const SwapBundleSchema = z.object(SwapBundleShape).strict();
export type SwapBundle = z.infer<typeof SwapBundleSchema>;

/** The same bundle as `/execute` accepts it: the handler's validator passes unknown top-level keys through (and the proof then refuses any change). */
export const SwapBundleRequestSchema = z.object(SwapBundleShape).passthrough();
export type SwapBundleRequest = z.input<typeof SwapBundleRequestSchema>;

/** The issuer's Ed25519 proof over the canonical bundle; `/order` only ever serves the signed one. */
export const SwapSignedProofSchema = z
  .object({
    schema: z.literal("ryntra.solana.swap-execution-proof"),
    schemaVersion: z.literal("1.0.0"),
    status: z.literal("SIGNED"),
    algorithm: z.literal("Ed25519"),
    digest: SwapDigest,
    keyId: z.string().min(1).max(128),
    publicKey: z.string().min(32).max(256),
    signature: z.string().min(64).max(512),
    issuedAt: Iso,
  })
  .strict();
export type SwapSignedProof = z.infer<typeof SwapSignedProofSchema>;

/** Both proof forms the execute handler accepts (an unsigned one is then refused `REVIEW_PROOF_REFUSED`). */
export const SwapProofSchema = z.discriminatedUnion("status", [
  SwapSignedProofSchema,
  z
    .object({
      schema: z.literal("ryntra.solana.swap-execution-proof"),
      schemaVersion: z.literal("1.0.0"),
      status: z.literal("UNSIGNED"),
      digest: SwapDigest,
      reasonCode: z.literal("NO_ISSUER_KEY_CONFIGURED"),
      issuedAt: Iso,
    })
    .strict(),
]);
export type SwapProof = z.infer<typeof SwapProofSchema>;

export const SWAP_PRE_SIGN_REFUSAL_CODES_V1 = [
  "POLICY_BLOCKED",
  "PROOF_NOT_SIGNED",
  "SIMULATION_NOT_CLEAR",
  "EFFECTS_NOT_VERIFIED",
  "ORDER_EXPIRED",
  "ORDER_TOO_SHORT",
  "REVIEW_INVALIDATED",
] as const;

/** The pre-sign verdict an answered order carries: always ready — a refusal is the 409 `SWAP_PRE_SIGN_REFUSED`. */
export const SwapPreSignSchema = z
  .object({ ready: z.literal(true), code: z.literal("READY_FOR_HUMAN_APPROVAL"), reason: z.string().min(1).max(512) })
  .strict();
export type SwapPreSign = z.infer<typeof SwapPreSignSchema>;

const SwapPreSignRefusalSchema = z
  .object({ ready: z.literal(false), code: z.enum(SWAP_PRE_SIGN_REFUSAL_CODES_V1), reason: z.string().min(1).max(1_024) })
  .strict();

/**
 * `POST /api/solana/swap/order` — a browser on this site or the native
 * bearer (whose wallet must be `input.taker`); no owner session, on the
 * action budget. `origin.plan` also needs the proven wallet (the web's proof
 * cookie or the bearer) to be the taker. Answers everything a person reviews
 * before signing: the keyed Jupiter order with the signable bytes, the
 * Review, the firewall inspection and the simulation of those exact bytes,
 * both passports and decimals, the review policy over the output mint (null
 * when its preflight could not be built), the swap policy's intent and
 * verdict, the issuer-signed bundle and proof `/execute` demands back, the
 * ready pre-sign verdict, the expiry, and the plan's Strategy block (null
 * without a plan); 1.20.0: `check`, «Перевірка» on this exact order with the
 * reserve the simulation proved, null unless a company is bought with USDC or
 * sold into it. It reserves the wallet's durable owner lock and never
 * submits. Fails `SwapOrderErrorSchema` (statuses on the error schema).
 */
/** Milliseconds a build's bytes stay signable from arriving (AG-1, `lib/solana/blockhash-life.ts`). */
const SignableMs = z.number().int().min(0).max(120_000);

export const SwapOrderResponseSchema = z
  .object({
    order: SwapJupiterOrderSchema,
    review: SwapReviewSchema,
    inspection: SwapInspectionSchema,
    simulation: SwapSimulationSchema,
    passports: z.record(Address, SwapPassportSchema),
    decimals: z.record(Address, z.number().int().min(0).max(255)),
    assetReview: SwapAssetVerdictSchema.nullable(),
    policy: z.object({ intent: SwapIntentSchema, verdict: SwapVerdictSchema }).strict(),
    bundle: SwapBundleSchema,
    proof: SwapSignedProofSchema,
    preSign: SwapPreSignSchema,
    expiresAt: Iso,
    /** AG-1 (17.10): how long from arriving these exact bytes may still be signed — their blockhash's life less a margin. Inside the Review's reading window; past it, fresh bytes are fetched at the moment of signing. */
    signableMs: SignableMs.optional(),
    planReview: PlanReviewSchema.nullable(),
    /** 1.20.0: «Перевірка» on this order — the four lines and the proven reserve; null unless a company is bought with USDC or sold into it. */
    check: SwapCheckSchema.nullable(),
    /** 1.85.0: the risk verdict over this trade, built on the exact order the wallet will be asked to sign. */
    risk: TradeRiskSchema,
  })
  .strict();
export type SwapOrderResponse = z.infer<typeof SwapOrderResponseSchema>;

/* ---- execute */

/** The execute request: strict at the top; the bundle as the handler accepts it. */
export const SwapExecuteRequestSchema = z
  .object({
    bundle: SwapBundleRequestSchema,
    proof: SwapProofSchema,
    signedTransactionBase64: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/).max(6_000),
    /** The exact bytes handed to the wallet — needed only when the wallet changed them. */
    reviewedTransactionBase64: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/).max(6_000).optional(),
  })
  .strict();
export type SwapExecuteRequest = z.input<typeof SwapExecuteRequestSchema>;

/** Jupiter's `/execute` answer, normalized (`JupiterExecuteReport`); null on the adopted lane, where this deployment broadcast. */
export const SwapExecuteReportSchema = z
  .object({
    schema: z.literal("ryntra.solana.jupiter-execute-report"),
    schemaVersion: z.literal("1.0.0"),
    status: z.enum(["Success", "Failed"]),
    code: z.number().int().min(-1_000_000).max(1_000_000),
    signature: z.string().min(1).max(128).nullable(),
    totalInputAmountRaw: RawAmount.nullable(),
    totalOutputAmountRaw: RawAmount.nullable(),
    inputAmountResultRaw: RawAmount.nullable(),
    outputAmountResultRaw: RawAmount.nullable(),
    providerError: z.string().max(256).nullable(),
    httpStatus: z.number().int().min(200).max(299),
    latencyMs: z.number().int(),
    observedAt: Iso,
    source: SwapSource,
  })
  .strict();
export type SwapExecuteReport = z.infer<typeof SwapExecuteReportSchema>;

/** The independent chain read of the landed swap, the taker's own two legs (`observeSwap`). */
export const SwapObservationSchema = z
  .object({
    signature: SwapSignature,
    slot: RawAmount,
    finality: z.enum(["confirmed", "finalized"]),
    actualInputRaw: RawAmount,
    actualOutputRaw: RawAmount,
    baseFeeLamports: RawAmount,
    priorityFeeLamports: RawAmount,
    /** Top-level programs, sorted; up to 64 here, the facts accept 32. */
    programs: z.array(Address).min(1).max(64),
    observedAt: Iso,
    source: SwapSource,
    /** What reached Ryntra's referral account in this transaction; null when no fee was asked for, `"0"` when none arrived. */
    serviceFeeCollectedRaw: RawAmount.nullable(),
  })
  .strict();
export type SwapObservation = z.infer<typeof SwapObservationSchema>;

const SwapFactsSource = z.object({ ref: z.string().min(1).max(256), label: z.string().min(1).max(256) }).strict();
const SwapFactsFee = z
  .object({ basisPoints: z.number().int().min(0).max(10_000), mint: z.string().min(32).max(44).nullable(), amountRaw: RawAmount.nullable() })
  .strict();

export const SWAP_RECEIPT_DEVIATIONS_V1 = [
  "PROVIDER_REQUEST_MISMATCH",
  "PROVIDER_SIGNATURE_MISMATCH",
  "PROVIDER_INPUT_MISMATCH",
  "PROVIDER_OUTPUT_MISMATCH",
  "PROVIDER_EVIDENCE_UNAVAILABLE",
  "INPUT_MISMATCH",
  "OUTPUT_MISMATCH",
  "BELOW_MINIMUM",
  "BASE_FEE_MISMATCH",
  "PRIORITY_FEE_MISMATCH",
] as const;

/**
 * The Swap Receipt facts (`SwapReceiptFactsSchema`): the reviewed quote,
 * the route, the fees with Ryntra's settled fee, the provider's report when
 * there was one, the independent observation and the reconciliation. The
 * Receipt seals the same object inside its observed effects.
 */
export const SwapFactsSchema = z
  .object({
    schema: z.literal("ryntra.solana.swap-receipt-facts"),
    schemaVersion: z.literal("1.0.0"),
    reviewDigest: SwapDigest,
    quoteDigest: SwapDigest,
    quote: z
      .object({
        inputMint: z.string().min(32).max(44),
        outputMint: z.string().min(32).max(44),
        inputRaw: RawAmount,
        outputRaw: RawAmount,
        minimumOutputRaw: RawAmount,
      })
      .strict(),
    routing: z
      .object({
        router: z.string().min(1).max(64),
        mode: z.string().min(1).max(64),
        route: z.array(z.object({ ammKey: z.string().min(32).max(44), basisPoints: z.number().int().min(0).max(10_000) }).strict()).max(32),
      })
      .strict(),
    fees: z
      .object({
        platform: SwapFactsFee,
        referral: SwapFactsFee,
        /** Always present on facts built today; absent on a receipt sealed before the fee model. */
        serviceFee: SwapServiceFeeSchema.optional(),
        baseLamports: RawAmount,
        priorityLamports: RawAmount,
      })
      .strict(),
    provider: z
      .object({
        requestId: z.string().min(1).max(128),
        signature: z.string().min(64).max(96),
        status: z.string().min(1).max(64),
        inputRaw: RawAmount,
        outputRaw: RawAmount,
        source: SwapFactsSource.extend({ observedAt: Iso }).strict(),
      })
      .strict()
      .nullable(),
    independentObservation: z
      .object({
        signature: z.string().min(64).max(96),
        slot: RawAmount,
        finality: z.enum(["confirmed", "finalized"]),
        actualInputRaw: RawAmount,
        actualOutputRaw: RawAmount,
        baseFeeLamports: RawAmount,
        priorityFeeLamports: RawAmount,
        programs: z.array(z.string().min(32).max(44)).min(1).max(32),
        observedAt: Iso,
        source: SwapFactsSource,
        serviceFeeCollectedRaw: RawAmount.nullable().optional(),
      })
      .strict(),
    reconciliation: z
      .object({
        state: z.enum(["MATCHED", "DEVIATION_RECORDED", "FAILED", "UNKNOWN", "RECOVERY"]),
        outputDeltaRaw: SwapSignedRaw,
        minimumMet: z.boolean(),
        deviations: z.array(z.enum(SWAP_RECEIPT_DEVIATIONS_V1)).max(SWAP_RECEIPT_DEVIATIONS_V1.length),
      })
      .strict(),
  })
  .strict();
export type SwapFacts = z.infer<typeof SwapFactsSchema>;

const SwapBase64 = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * The issuer-signed Outcome Receipt (`OutcomeReceiptArtifactSchema`). A swap
 * receipt's `observedEffects` are two headline sentences and then the facts
 * as chunked JSON (`ryntra.solana.swap-receipt.facts@1:…#i/n`, 480
 * characters each) — the facts can be rebuilt from the receipt alone.
 */
export const SwapReceiptSchema = z
  .object({
    schemaVersion: z.literal("2.0.0"),
    id: z.string().min(3).max(128),
    createdAt: Iso,
    registry: z
      .object({
        registryDigest: SwapDigest,
        refs: z.array(z.object({ ref: z.string().min(3).max(128), contentHash: SwapDigest }).strict()).min(1).max(16),
      })
      .strict(),
    contentHash: SwapDigest,
    issuer: z.discriminatedUnion("status", [
      z
        .object({
          status: z.literal("SIGNED"),
          algorithm: z.literal("Ed25519"),
          keyId: z.string().min(3).max(128),
          publicKey: z.string().regex(SwapBase64).min(32).max(128),
          signature: z.string().regex(SwapBase64).min(64).max(256),
          signedAt: Iso,
        })
        .strict(),
      z
        .object({
          status: z.literal("UNSIGNED"),
          reasonCode: z.enum(["NO_ISSUER_KEY_CONFIGURED", "ISSUER_KEY_UNAVAILABLE", "SIGNING_NOT_REQUESTED"]),
          keyId: z.null(),
          publicKey: z.null(),
          signature: z.null(),
          signedAt: z.null(),
        })
        .strict(),
    ]),
    integrity: z.object({ algorithm: z.literal("SHA-256"), hash: SwapDigest }).strict(),
    kind: z.literal("OUTCOME_RECEIPT"),
    maturity: z.literal("OBSERVED"),
    /** A swap receipt binds the issuer-signed execution proof's digest here. */
    actionPassportHash: SwapDigest,
    outcome: z
      .object({
        status: z.enum(["MATCHED", "DEVIATION_RECORDED", "FAILED"]),
        chainRef: z.string().regex(/^[a-z0-9-]+:[A-Za-z0-9-]+$/),
        transactionHash: z.string().min(3).max(256),
        observedEffects: z
          .array(z.object({ description: z.string().min(1).max(512), sourceRef: z.string().min(1).max(512), observedAt: Iso }).strict())
          .min(1)
          .max(64),
        reconciledAt: Iso,
      })
      .strict(),
    limitations: z.union([
      z.tuple([
        z.literal("OUTCOME RECEIPT — AN OBSERVATION, NOT AN INSTRUCTION"),
        z.literal(
          "Ryntra observed and reconciled this outcome. The wallet supplied any required signature; submission responsibility is stated by the receipt's bound action path.",
        ),
      ]),
      z.tuple([
        z.literal("OUTCOME RECEIPT — AN OBSERVATION, NOT AN INSTRUCTION"),
        z.literal("Ryntra observed and reconciled this outcome; it did not sign, submit, fund or execute it."),
      ]),
    ]),
  })
  .strict();
export type SwapReceipt = z.infer<typeof SwapReceiptSchema>;

export const SWAP_EXECUTE_STATES_V1 = ["MATCHED", "DEVIATION_RECORDED", "RECOVERY", "RECOVERY_PENDING", "SUBMITTED_UNKNOWN"] as const;

/** 200: the swap settled and its Receipt exists. `state` is the facts' reconciliation state; `factsRefusal` is always null here. */
export const SwapExecuteSettledSchema = z
  .object({
    state: z.enum(["MATCHED", "DEVIATION_RECORDED", "RECOVERY"]),
    signature: SwapSignature,
    finality: z.enum(["confirmed", "finalized"]),
    report: SwapExecuteReportSchema.nullable(),
    observation: SwapObservationSchema,
    takerLamportDelta: SwapSignedRaw,
    feeLamports: RawAmount,
    facts: SwapFactsSchema,
    factsRefusal: z.null(),
    receipt: SwapReceiptSchema,
    policy: z.object({ verdict: SwapVerdictSchema }).strict(),
  })
  .strict();
export type SwapExecuteSettled = z.infer<typeof SwapExecuteSettledSchema>;

/** 202: the submit did not answer and the chain has not shown the signature; recover by signature, never execute again. */
export const SwapExecuteSubmittedUnknownSchema = z
  .object({
    state: z.literal("SUBMITTED_UNKNOWN"),
    signature: SwapSignature,
    report: z.null(),
    providerFailure: z
      .object({
        code: z.enum(["PRODUCTION_KEY_REQUIRED", "PINNED_CONTRACT", "AMBIGUOUS_NETWORK", "AMBIGUOUS_HTTP", "AMBIGUOUS_MALFORMED", "BROADCAST_UNANSWERED"]),
        reason: SwapText,
      })
      .strict(),
    recovery: z.string().min(1).max(512),
  })
  .strict();
export type SwapExecuteSubmittedUnknown = z.infer<typeof SwapExecuteSubmittedUnknownSchema>;

/** 202 `RECOVERY_PENDING`, first form: the bytes may have landed and the independent read has not resolved yet. */
export const SwapExecutePendingReadSchema = z
  .object({
    state: z.literal("RECOVERY_PENDING"),
    signature: SwapSignature,
    report: SwapExecuteReportSchema.nullable(),
    observationFailure: z.object({ code: z.enum(["RPC_FAILED", "NOT_FOUND", "UNREADABLE", "LEG_UNRESOLVED"]), reason: SwapText }).strict(),
    recovery: z.string().min(1).max(512),
  })
  .strict();
export type SwapExecutePendingRead = z.infer<typeof SwapExecutePendingReadSchema>;

/** 202 `RECOVERY_PENDING`, second form: the chain outcome is known and the facts could not be built; `factsRefusal` says why. */
export const SwapExecutePendingFactsSchema = z
  .object({
    state: z.literal("RECOVERY_PENDING"),
    signature: SwapSignature,
    report: SwapExecuteReportSchema.nullable(),
    observation: SwapObservationSchema,
    facts: z.null(),
    factsRefusal: SwapText,
    recovery: SwapText,
  })
  .strict();
export type SwapExecutePendingFacts = z.infer<typeof SwapExecutePendingFactsSchema>;

/** 202 `RECOVERY_PENDING`, third form: a closeout step after the facts did not record (finality, Receipt, owner artifact, attempt ledger). */
export const SwapExecutePendingCloseoutSchema = z
  .object({ state: z.literal("RECOVERY_PENDING"), signature: SwapSignature, recovery: SwapText })
  .strict();
export type SwapExecutePendingCloseout = z.infer<typeof SwapExecutePendingCloseoutSchema>;

/**
 * `POST /api/solana/swap/execute` — a browser on this site or the native
 * bearer (whose wallet must be `bundle.taker`); no owner session, on the
 * action budget. The authorization is the wallet's signature over exactly
 * the reviewed message under this deployment's issuer-signed bundle; a
 * wallet that re-priced the bytes is adopted and broadcast through Ryntra's
 * own RPC after a fresh simulation. Answers, discriminated on `state`: 200
 * settled (`MATCHED` · `DEVIATION_RECORDED` · `RECOVERY`, with the Receipt);
 * 202 `SUBMITTED_UNKNOWN`; 202 `RECOVERY_PENDING` in three exact forms
 * (hence `z.union` — zod's discriminated union refuses a repeated
 * discriminator value; a TypeScript switch on `state` narrows as usual).
 * Fails `SwapExecuteErrorSchema`; every refusal before the signature claim
 * carries `submitBoundary: "NOT_CROSSED"` — proof the network never saw
 * the bytes.
 */
export const SwapExecuteResponseSchema = z.union([
  SwapExecuteSettledSchema,
  SwapExecuteSubmittedUnknownSchema,
  SwapExecutePendingReadSchema,
  SwapExecutePendingFactsSchema,
  SwapExecutePendingCloseoutSchema,
]);
export type SwapExecuteResponse = z.infer<typeof SwapExecuteResponseSchema>;

/* ---- cancel-review */

export const SwapCancelReviewRequestSchema = z.object({ owner: Address, requestId: z.string().min(1).max(128) }).strict();
export type SwapCancelReviewRequest = z.infer<typeof SwapCancelReviewRequestSchema>;

/**
 * `POST /api/solana/swap/cancel-review` — a browser on this site or the
 * native bearer (whose wallet must be `owner`); no owner session, on the
 * action budget. Cancels only the exact issued, never-signed Review named by
 * `requestId`, and only once an independent operator says its blockhash can
 * no longer land. Answers 200 with the lock's new state. Fails
 * `SwapCancelReviewErrorSchema`.
 */
export const SwapCancelReviewResponseSchema = z
  .object({
    state: z.literal("EXPIRED_BEFORE_SUBMIT"),
    owner: Address,
    requestId: z.string().min(1).max(128),
    blockhashValid: z.literal(false),
  })
  .strict();
export type SwapCancelReviewResponse = z.infer<typeof SwapCancelReviewResponseSchema>;

/* ---- recover */

export const SwapRecoverRequestSchema = z
  .object({ owner: Address, signature: SwapSignature, requestId: z.string().min(1).max(128).optional() })
  .strict();
export type SwapRecoverRequest = z.infer<typeof SwapRecoverRequestSchema>;

export const SWAP_RECOVER_STATES_V1 = [
  "PENDING",
  "SEEN_WITHOUT_RECORD",
  "UNKNOWN_TO_CHAIN",
  "FAILED",
  "EXPIRED_BEFORE_SUBMIT",
  "EXPIRED_AFTER_SUBMIT",
  "ALREADY_RECEIPTED",
  "RECOVERED",
] as const;

/**
 * `POST /api/solana/swap/recover` — a browser on this site or the native
 * bearer (whose wallet must be `owner`); no owner session, on the read
 * budget; accepts no transaction bytes and submits nothing. A signature this
 * server never recorded answers `PENDING` (202), `SEEN_WITHOUT_RECORD` (202)
 * or `UNKNOWN_TO_CHAIN` (200); a recorded one answers `PENDING` (202) or,
 * with 200, `FAILED`, `EXPIRED_BEFORE_SUBMIT`, `EXPIRED_AFTER_SUBMIT`,
 * `ALREADY_RECEIPTED` (the stored Receipt and its hash, and — since 1.11.0 —
 * the `observation` and `facts` read back from the facts the Receipt sealed,
 * never from a second chain read; null only for a Receipt that seals none;
 * the finality is `facts.independentObservation.finality`) or `RECOVERED` (a
 * fresh chain read, the facts and the Receipt). A refused recovery is the 409
 * of `SwapRecoverErrorSchema`.
 */
export const SwapRecoverResponseSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("PENDING"), signature: SwapSignature, reason: SwapText }).strict(),
  z.object({ state: z.literal("SEEN_WITHOUT_RECORD"), signature: SwapSignature, reason: z.string().min(1).max(512) }).strict(),
  z.object({ state: z.literal("UNKNOWN_TO_CHAIN"), signature: SwapSignature, reason: z.string().min(1).max(512) }).strict(),
  z.object({ state: z.literal("FAILED"), signature: SwapSignature, reason: SwapText, chainError: SwapText.nullable() }).strict(),
  z
    .object({ state: z.literal("EXPIRED_BEFORE_SUBMIT"), signature: SwapSignature, blockhashValid: z.literal(false), lastValidBlockHeight: RawAmount })
    .strict(),
  z
    .object({ state: z.literal("EXPIRED_AFTER_SUBMIT"), signature: SwapSignature, blockhashValid: z.literal(false), lastValidBlockHeight: RawAmount })
    .strict(),
  z
    .object({
      state: z.literal("ALREADY_RECEIPTED"),
      signature: SwapSignature,
      receiptHash: SwapDigest,
      receipt: SwapReceiptSchema,
      observation: SwapObservationSchema.nullable(),
      facts: SwapFactsSchema.nullable(),
    })
    .strict(),
  z
    .object({
      state: z.literal("RECOVERED"),
      signature: SwapSignature,
      finality: z.enum(["confirmed", "finalized"]),
      observation: SwapObservationSchema,
      facts: SwapFactsSchema,
      receipt: SwapReceiptSchema,
    })
    .strict(),
]);
export type SwapRecoverResponse = z.infer<typeof SwapRecoverResponseSchema>;

/* ---- the errors */

/** The body reader's refusals (`readAgentControlJson`): 415, 400, 413, 400, 400, 400. */
export const SWAP_BODY_ERROR_CODES_V1 = [
  "JSON_REQUIRED",
  "INVALID_CONTENT_LENGTH",
  "BODY_TOO_LARGE",
  "BODY_REQUIRED",
  "INVALID_BODY_STREAM",
  "INVALID_JSON",
] as const;

/** Who carried the request (`swap-carrier.ts`): a browser from elsewhere 403; a bearer that fails 401, or 503 `UNAVAILABLE` when the session store did not answer. */
export const SWAP_CARRIER_ERROR_CODES_V1 = ["FORBIDDEN_ORIGIN", "UNAUTHORIZED", "SESSION_EXPIRED", "SESSION_REVOKED", "UNAVAILABLE"] as const;

/** The durable per-wallet owner lock (`swap-owner-lock.ts`). */
export const SWAP_OWNER_LOCK_ERROR_CODES_V1 = ["OWNER_SWAP_LOCKED", "OWNER_SWAP_LOCK_ABSENT", "OWNER_SWAP_LOCK_MISMATCH", "OWNER_SWAP_LOCK_UNAVAILABLE"] as const;

export const SWAP_OWNER_LOCK_STATES_V1 = [
  "REVIEW_ISSUED",
  "SIGNED",
  "SUBMITTED_UNKNOWN",
  "EXPIRED_BEFORE_SUBMIT",
  "EXPIRED_AFTER_SUBMIT",
  "FAILED",
  "RECEIPTED",
] as const;

/** Which Review or signature holds the wallet. */
const SwapOwnerLockViewSchema = z
  .object({
    state: z.enum(SWAP_OWNER_LOCK_STATES_V1),
    requestId: z.string().min(1).max(128),
    signature: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,90}$/).nullable(),
  })
  .strict();

export const SWAP_QUOTE_ERROR_CODES_V1 = [
  "RATE_LIMITED",
  ...SWAP_BODY_ERROR_CODES_V1,
  "VALIDATION_ERROR",
  "ASSET_NOT_OFFERED",
  "PROVIDER_KEY_MISSING",
  "MINT_UNREADABLE",
  "PASSPORT_REFUSED",
  "QUOTE_PRODUCTION_KEY_REQUIRED",
  "QUOTE_NO_ROUTE",
  "QUOTE_REFUSED",
  "QUOTE_RATE_LIMITED",
  "QUOTE_HTTP_ERROR",
  "QUOTE_UNREACHABLE",
  "QUOTE_MALFORMED",
  "QUOTE_IMPLAUSIBLE_QUOTE",
  "PREFLIGHT_REFUSED",
] as const;

/** The quote route's refusal (statuses on `SwapQuoteResponseSchema`). */
export const SwapQuoteErrorSchema = z
  .object({
    error: z
      .object({
        code: z.enum(SWAP_QUOTE_ERROR_CODES_V1),
        message: SwapText,
        /** Only on `ASSET_NOT_OFFERED`: the issuer's own state and notice for the output mint. */
        lifecycle: z.object({ state: z.enum(["redeem-only", "expired"]), url: z.string().min(1).max(2_048) }).strict().optional(),
        /** Only on `QUOTE_*`: Jupiter's own error code, when it stated a well-formed one. */
        provider: z.object({ errorCode: z.string().min(1).max(96).nullable() }).strict().optional(),
      })
      .strict(),
  })
  .strict();
export type SwapQuoteError = z.infer<typeof SwapQuoteErrorSchema>;

export const SWAP_ORDER_ERROR_CODES_V1 = [
  "RATE_LIMITED",
  ...SWAP_CARRIER_ERROR_CODES_V1,
  "SWAP_PAUSED",
  ...SWAP_BODY_ERROR_CODES_V1,
  "VALIDATION_ERROR",
  "WALLET_MISMATCH",
  "ASSET_NOT_OFFERED",
  "PLAN_NOT_FOUND",
  /* 1.12.0 — an order under a rule's reminder: no such rule for the proven wallet, a reminder that is not open, an order that is not the rule's purchase. */
  "RULE_NOT_FOUND",
  "RULE_NOT_DUE",
  "RULE_MISMATCH",
  /* 1.13.0 — what is left of the month's autoinvest budget does not cover the rule's purchase; the rules stand until the 1st. */
  "RULE_BUDGET_EXHAUSTED",
  /* 1.18.0 — the rule's price condition is not met now: the price stands above its reference by more than the limit, or the data are not fresh. */
  "RULE_PRICE_CONDITION",
  /* 1.31.0 — a rule's token of the venue's list stands below the floor now: a rule never buys into a thin pool (figures that cannot be read are UNAVAILABLE). */
  "RULE_LIQUIDITY_LOW",
  "STORE_NOT_DURABLE",
  ...SWAP_OWNER_LOCK_ERROR_CODES_V1,
  "PROVIDER_KEY_MISSING",
  "PROOF_NOT_SIGNED",
  "MINT_UNREADABLE",
  "PASSPORT_REFUSED",
  "ORDER_PRODUCTION_KEY_REQUIRED",
  "ORDER_NO_ROUTE",
  "ORDER_REFUSED",
  "ORDER_RATE_LIMITED",
  "ORDER_HTTP_ERROR",
  "ORDER_UNREACHABLE",
  "ORDER_MALFORMED",
  "ORDER_IMPLAUSIBLE_QUOTE",
  "ORDER_BUILD_FAILED",
  "TRANSACTION_UNREADABLE",
  "TRANSACTION_TOO_LARGE",
  "TRANSACTION_VERSION_UNSUPPORTED",
  "TRANSACTION_FEE_PAYER_MISMATCH",
  "TRANSACTION_TAKER_NOT_SIGNER",
  "TRANSACTION_NO_INSTRUCTIONS",
  "TRANSACTION_DANGEROUS_TOKEN_INSTRUCTION",
  "TRANSACTION_DANGEROUS_ACCOUNT_INSTRUCTION",
  "TRANSACTION_PROGRAM_INDEX_OUT_OF_RANGE",
  "SIMULATION_EFFECT_CONTRACT_UNREADABLE",
  "SIMULATION_EFFECT_PAIR_UNSUPPORTED",
  "SIMULATION_EFFECT_GASLESS_UNSUPPORTED",
  "SIMULATION_EFFECT_FEE_PAYER_MISMATCH",
  "SIMULATION_EFFECT_FEE_MISMATCH",
  "SIMULATION_EFFECT_RENT_UNSUPPORTED",
  "SIMULATION_EFFECT_SIMULATION_METADATA_UNAVAILABLE",
  "SIMULATION_EFFECT_ACCOUNT_VECTOR_MISMATCH",
  "SIMULATION_EFFECT_TOKEN_METADATA_UNAVAILABLE",
  "SIMULATION_EFFECT_TOKEN_METADATA_INVALID",
  "SIMULATION_EFFECT_TOKEN_OWNER_UNRESOLVED",
  "SIMULATION_EFFECT_UNSAFE_TOKEN_MUTATION",
  "SIMULATION_EFFECT_UNSAFE_ACCOUNT_MUTATION",
  "SIMULATION_EFFECT_UNRESOLVED_INNER_PROGRAM",
  "SIMULATION_EFFECT_UNRELATED_TOKEN_DELTA",
  "SIMULATION_EFFECT_INPUT_DELTA_MISMATCH",
  "SIMULATION_EFFECT_OUTPUT_DELTA_MISMATCH",
  "SIMULATION_EFFECT_NATIVE_DELTA_MISMATCH",
  "SIMULATION_UNAVAILABLE",
  "SIMULATION_FAILED",
  "INTENT_REFUSED",
  "PLAN_REVIEW_BLOCKED",
  "PLAN_VERSION_CONFLICT",
  "PLAN_STATE_REFUSED",
  "SWAP_PRE_SIGN_REFUSED",
] as const;

/**
 * The order route's refusal. Statuses: 429 `RATE_LIMITED`; carrier codes
 * 403/401/503; 409 `SWAP_PAUSED`; body codes; 400 `VALIDATION_ERROR` (the
 * message names up to three failing fields); 403 `WALLET_MISMATCH`; 409
 * `ASSET_NOT_OFFERED`; under a plan 401 `UNAUTHORIZED` (no proven wallet),
 * 404 `PLAN_NOT_FOUND`; 503 `STORE_NOT_DURABLE`; the owner lock — 409
 * `OWNER_SWAP_LOCKED` (with `ownerLock`) only while the wallet holds a
 * signature the server claimed (since SOL-S1, 2026-10-19: an unsigned Review
 * is replaced by the new order at once, and `execute` of the replaced bundle
 * answers 409 `OWNER_SWAP_LOCK_MISMATCH` before any send), 503
 * `OWNER_SWAP_LOCK_UNAVAILABLE` on the read and on the reservation, 409 on a
 * lost reservation (with `ownerLock`, null when no record); 503
 * `PROVIDER_KEY_MISSING` · `PROOF_NOT_SIGNED`; 422 `MINT_UNREADABLE` ·
 * `PASSPORT_REFUSED`; `ORDER_*` with `provider` — 409 `ORDER_NO_ROUTE` ·
 * `ORDER_BUILD_FAILED`, 429 `ORDER_RATE_LIMITED`, 502 the others; 409
 * `TRANSACTION_*` · `SIMULATION_EFFECT_*` · `INTENT_REFUSED`; 503
 * `SIMULATION_UNAVAILABLE`; 409 `SIMULATION_FAILED` (with `simulation`);
 * 409 `PLAN_REVIEW_BLOCKED` (with `planReview`); recording the Review — 503
 * `UNAVAILABLE`, 404 `PLAN_NOT_FOUND`, 409 `PLAN_VERSION_CONFLICT` ·
 * `PLAN_STATE_REFUSED` (with `planReview`); 409 `SWAP_PRE_SIGN_REFUSED`
 * (with `policy` and `preSign`).
 */
export const SwapOrderErrorSchema = z
  .object({
    error: z
      .object({
        code: z.enum(SWAP_ORDER_ERROR_CODES_V1),
        message: SwapText,
        /** Only on `ORDER_*`: Jupiter's error code and the router it named when the build failed. */
        provider: z.object({ errorCode: z.string().min(1).max(96).nullable(), router: z.string().min(1).max(64).nullable() }).strict().optional(),
        ownerLock: SwapOwnerLockViewSchema.nullable().optional(),
        simulation: SwapSimulationSchema.optional(),
        planReview: PlanReviewSchema.optional(),
        policy: z.object({ verdict: SwapVerdictSchema }).strict().optional(),
        preSign: SwapPreSignRefusalSchema.optional(),
      })
      .strict(),
  })
  .strict();
export type SwapOrderError = z.infer<typeof SwapOrderErrorSchema>;

export const SWAP_EXECUTE_ERROR_CODES_V1 = [
  "RATE_LIMITED",
  ...SWAP_CARRIER_ERROR_CODES_V1,
  "SWAP_PAUSED",
  ...SWAP_BODY_ERROR_CODES_V1,
  "VALIDATION_ERROR",
  "WALLET_MISMATCH",
  "ISSUER_KEY_MISSING",
  "REVIEW_PROOF_REFUSED",
  "REVIEW_NOT_FRESH",
  "ORDER_EXPIRED",
  "SIMULATION_FAILED",
  "SIGNED_UNREADABLE",
  "SIGNED_TOO_LARGE",
  "SIGNED_VERSION_UNSUPPORTED",
  "SIGNED_FEE_PAYER_MISMATCH",
  "SIGNED_TAKER_NOT_SIGNER",
  "SIGNED_NO_INSTRUCTIONS",
  "SIGNED_DANGEROUS_TOKEN_INSTRUCTION",
  "SIGNED_DANGEROUS_ACCOUNT_INSTRUCTION",
  "SIGNED_PROGRAM_INDEX_OUT_OF_RANGE",
  "WALLET_MODIFIED_BYTES",
  "REVIEWED_BYTES_MISMATCH",
  "WALLET_PRIORITY_FEE_TOO_HIGH",
  "WALLET_BUDGET_UNREADABLE",
  "SIGNATURE_REFUSED",
  "SIGNATURE_UNREADABLE",
  "PROVIDER_KEY_MISSING",
  "STORE_NOT_DURABLE",
  "SWAP_POLICY_BLOCKED",
  "PLAN_REVIEW_BLOCKED",
  "PLAN_NOT_FOUND",
  "PLAN_VERSION_CONFLICT",
  "PLAN_STATE_REFUSED",
  "NO_INDEPENDENT_RPC",
  "ADOPTED_SIMULATION_FAILED",
  "ADOPTED_EFFECT_CONTRACT_UNREADABLE",
  "ADOPTED_EFFECT_PAIR_UNSUPPORTED",
  "ADOPTED_EFFECT_GASLESS_UNSUPPORTED",
  "ADOPTED_EFFECT_FEE_PAYER_MISMATCH",
  "ADOPTED_EFFECT_FEE_MISMATCH",
  "ADOPTED_EFFECT_RENT_UNSUPPORTED",
  "ADOPTED_EFFECT_SIMULATION_METADATA_UNAVAILABLE",
  "ADOPTED_EFFECT_ACCOUNT_VECTOR_MISMATCH",
  "ADOPTED_EFFECT_TOKEN_METADATA_UNAVAILABLE",
  "ADOPTED_EFFECT_TOKEN_METADATA_INVALID",
  "ADOPTED_EFFECT_TOKEN_OWNER_UNRESOLVED",
  "ADOPTED_EFFECT_UNSAFE_TOKEN_MUTATION",
  "ADOPTED_EFFECT_UNSAFE_ACCOUNT_MUTATION",
  "ADOPTED_EFFECT_UNRESOLVED_INNER_PROGRAM",
  "ADOPTED_EFFECT_UNRELATED_TOKEN_DELTA",
  "ADOPTED_EFFECT_INPUT_DELTA_MISMATCH",
  "ADOPTED_EFFECT_OUTPUT_DELTA_MISMATCH",
  "ADOPTED_EFFECT_NATIVE_DELTA_MISMATCH",
  "ADOPTED_SIMULATION_UNAVAILABLE",
  ...SWAP_OWNER_LOCK_ERROR_CODES_V1,
  "SEND_ATTEMPT_CONFLICT",
  "SEND_ATTEMPT_UNAVAILABLE",
  "ALREADY_SUBMITTED",
  "SEND_SETTLEMENT_FAILED",
  "SUBMISSION_UNKNOWN",
  "EXECUTE_FAILED",
  "LANDED_FAILED",
] as const;

export const SWAP_SEND_ATTEMPT_STATES_V1 = [
  "RESERVED",
  "SUBMITTED_UNKNOWN",
  "CONFIRMED",
  "FINALIZED",
  "LANDED_FAILED",
  "EXPIRED_BEFORE_SUBMIT",
  "EXPIRED_AFTER_SUBMIT",
  "RECOVERY_REQUIRED",
  "RECEIPTED",
] as const;

/**
 * The execute route's refusal. Before the signature claim — every code
 * through the owner lock's — the error carries `submitBoundary:
 * "NOT_CROSSED"` and the network never saw the bytes: 429 `RATE_LIMITED`;
 * carrier codes 403/401/503; 409 `SWAP_PAUSED`; body codes; 400
 * `VALIDATION_ERROR`; 403 `WALLET_MISMATCH`; 503 `ISSUER_KEY_MISSING`; 409
 * `REVIEW_PROOF_REFUSED` · `REVIEW_NOT_FRESH` · `ORDER_EXPIRED` ·
 * `SIMULATION_FAILED` · `SIGNED_*` · `WALLET_MODIFIED_BYTES` ·
 * `REVIEWED_BYTES_MISMATCH` · `WALLET_PRIORITY_FEE_TOO_HIGH` ·
 * `WALLET_BUDGET_UNREADABLE` · `SIGNATURE_REFUSED` (with `comparisons`) ·
 * `SIGNATURE_UNREADABLE`; 503 `PROVIDER_KEY_MISSING` · `STORE_NOT_DURABLE`;
 * 409 `SWAP_POLICY_BLOCKED` (with `policy`); 409 `PLAN_REVIEW_BLOCKED` (with
 * `planReview`, null when the bundle carries none), 404 `PLAN_NOT_FOUND`,
 * 409 `PLAN_VERSION_CONFLICT` · `PLAN_STATE_REFUSED` (with `planReview`);
 * 503 `NO_INDEPENDENT_RPC`; 409 `ADOPTED_SIMULATION_FAILED` ·
 * `ADOPTED_EFFECT_*`; 503 `ADOPTED_SIMULATION_UNAVAILABLE`; the claim — 503
 * `OWNER_SWAP_LOCK_UNAVAILABLE`, 409 the other lock codes. After the claim,
 * without `submitBoundary`: 409 `SEND_ATTEMPT_CONFLICT` ·
 * `SEND_ATTEMPT_UNAVAILABLE` · `ALREADY_SUBMITTED` · `SEND_SETTLEMENT_FAILED`
 * · `SUBMISSION_UNKNOWN` (with `signature`, null only on
 * `SEND_SETTLEMENT_FAILED`); 409 `EXECUTE_FAILED` (with `report` and
 * `signature`); 409 `LANDED_FAILED` (with `signature`, `chainError`,
 * `report`, `durableState`, `recovery`).
 */
export const SwapExecuteErrorSchema = z
  .object({
    error: z
      .object({
        code: z.enum(SWAP_EXECUTE_ERROR_CODES_V1),
        message: SwapText,
        submitBoundary: z.literal("NOT_CROSSED").optional(),
        comparisons: z
          .array(z.object({ field: z.string().max(128), expected: z.string().max(1_024), actual: z.string().max(1_024), matched: z.boolean() }).strict())
          .max(16)
          .optional(),
        policy: z.object({ verdict: SwapVerdictSchema }).strict().optional(),
        planReview: PlanReviewSchema.nullable().optional(),
        signature: SwapSignature.nullable().optional(),
        report: SwapExecuteReportSchema.nullable().optional(),
        chainError: z.string().max(512).nullable().optional(),
        durableState: z.enum([...SWAP_SEND_ATTEMPT_STATES_V1, "UNKNOWN"]).optional(),
        recovery: z.string().min(1).max(512).optional(),
      })
      .strict(),
  })
  .strict();
export type SwapExecuteError = z.infer<typeof SwapExecuteErrorSchema>;

export const SWAP_CANCEL_REVIEW_ERROR_CODES_V1 = [
  "RATE_LIMITED",
  ...SWAP_CARRIER_ERROR_CODES_V1,
  ...SWAP_BODY_ERROR_CODES_V1,
  "VALIDATION_ERROR",
  "WALLET_MISMATCH",
  "STORE_NOT_DURABLE",
  ...SWAP_OWNER_LOCK_ERROR_CODES_V1,
  "NO_INDEPENDENT_RPC",
  "BLOCKHASH_VALIDITY_UNKNOWN",
  "BLOCKHASH_STILL_VALID",
] as const;

/**
 * The cancel-review route's refusal: 429 `RATE_LIMITED`; carrier codes; body
 * codes; 400 `VALIDATION_ERROR`; 403 `WALLET_MISMATCH`; 503
 * `STORE_NOT_DURABLE`; 409 the lock codes (reading the lock and expiring the
 * Review, including 409 `OWNER_SWAP_LOCK_UNAVAILABLE`), 409
 * `OWNER_SWAP_LOCK_MISMATCH` when the lock is not that exact unsigned
 * Review, 503 `OWNER_SWAP_LOCK_UNAVAILABLE` when its stored bundle is
 * malformed; 503 `NO_INDEPENDENT_RPC` · `BLOCKHASH_VALIDITY_UNKNOWN`; 409
 * `BLOCKHASH_STILL_VALID`.
 */
export const SwapCancelReviewErrorSchema = z
  .object({ error: z.object({ code: z.enum(SWAP_CANCEL_REVIEW_ERROR_CODES_V1), message: SwapText }).strict() })
  .strict();
export type SwapCancelReviewError = z.infer<typeof SwapCancelReviewErrorSchema>;

export const SWAP_RECOVER_ERROR_CODES_V1 = [
  "RATE_LIMITED",
  ...SWAP_CARRIER_ERROR_CODES_V1,
  ...SWAP_BODY_ERROR_CODES_V1,
  "VALIDATION_ERROR",
  "WALLET_MISMATCH",
  "ISSUER_KEY_MISSING",
  "STORE_NOT_DURABLE",
  "NO_INDEPENDENT_RPC",
  "REVIEW_PROOF_REFUSED",
  ...SWAP_OWNER_LOCK_ERROR_CODES_V1,
  "SEND_ATTEMPT_CONFLICT",
  "SEND_ATTEMPT_UNAVAILABLE",
  "SEND_ATTEMPT_ABSENT",
  "SEND_ATTEMPT_TRANSITION_REFUSED",
  "SEND_ATTEMPT_CONTENDED",
  "ATTEMPT_BINDING_MISMATCH",
  "SUBMIT_NOT_RECORDED",
  "MINT_FAILED",
] as const;

/**
 * The recover route's refusal: 429 `RATE_LIMITED`; carrier codes; body
 * codes; 400 `VALIDATION_ERROR`; 403 `WALLET_MISMATCH`; 503
 * `ISSUER_KEY_MISSING` · `STORE_NOT_DURABLE` · `NO_INDEPENDENT_RPC`; 503
 * `OWNER_SWAP_LOCK_UNAVAILABLE` when the stored bundle or proof is
 * malformed; 409 every refused recovery (`REVIEW_PROOF_REFUSED`, the lock
 * and send-attempt codes, `ATTEMPT_BINDING_MISMATCH`, `SUBMIT_NOT_RECORDED`,
 * `MINT_FAILED`).
 */
export const SwapRecoverErrorSchema = z
  .object({ error: z.object({ code: z.enum(SWAP_RECOVER_ERROR_CODES_V1), message: SwapText }).strict() })
  .strict();
export type SwapRecoverError = z.infer<typeof SwapRecoverErrorSchema>;

/* ------------------------------------------------------------ «Перевірка» of a transfer (1.22.0) */

/** An exact decimal in the token's units or in SOL — no grouping, no rounding, no sign; a client formats it. */
const TransferDecimal = z.string().regex(/^[0-9]{1,40}(\.[0-9]{1,255})?$/);
const TransferWords = z.object({ en: z.string().min(1).max(600), uk: z.string().min(1).max(600) }).strict();
const TransferLamports = z.object({ lamports: RawAmount, sol: TransferDecimal }).strict();
/** An account's rent: the figures, or both null when the server could not read them — never a zero for an unknown. */
const TransferRent = z.union([TransferLamports, z.object({ lamports: z.null(), sol: z.null() }).strict()]);

/**
 * 1.22.0 — «Перевірка» of a transfer as the server counts it
 * (`lib/solana/send-check.ts`), on the answers of `POST
 * /api/solana/transfer/plan` and `…/adopt`: the lines the web's «Надіслати»
 * card draws — «Надсилаєш», «Комісія емітента», «Отримувач отримає»,
 * «Комісія мережі (оцінка)», «Відкриття рахунку» — whether the wallet may be
 * opened (`signable`), why not (`blocked`) and the list read before
 * confirming (`warnings`), in the card's words. For SOL sent to an address
 * with no account, `minimum` is the least the transfer must carry — never a
 * cost on top; `setup` is a token account opened for the recipient, paid by
 * the sender. A client draws these and counts none of them.
 */
export const TransferCheckSchema = z
  .object({
    /** The asset sent; `mint` null for SOL. */
    asset: z.object({ mint: Address.nullable(), decimals: z.number().int().min(0).max(255) }).strict(),
    from: Address,
    to: z
      .object({
        /** What was entered. */
        address: Address,
        /** A wallet, or a token account entered on purpose. */
        kind: z.enum(["wallet", "token-account"]),
        /** Whose money it becomes (a token account's recorded owner). */
        owner: Address,
        /** The account that receives: the token account, or the wallet itself for SOL. */
        account: Address,
        opensAccount: z.boolean(),
      })
      .strict(),
    send: z.object({ raw: RawAmount, amount: TransferDecimal }).strict(),
    issuerFee: z.object({ raw: RawAmount, amount: TransferDecimal, basisPoints: z.number().int().min(0).max(10_000) }).strict().nullable(),
    /** What arrives; `less` when it is less than what leaves (the card says the line only then). */
    receive: z.object({ raw: RawAmount, amount: TransferDecimal, less: z.boolean() }).strict(),
    networkFee: TransferLamports,
    /** Present when a token account opens for the recipient; its figures null when the rent could not be read. */
    setup: TransferRent.nullable(),
    /** Present when SOL goes to an address with no account; its figures null when the rent could not be read. */
    minimum: TransferRent.nullable(),
    signable: z.boolean(),
    blocked: TransferWords.extend({ code: z.string().min(1).max(64) }).strict().nullable(),
    warnings: z.array(TransferWords.extend({ code: z.string().min(1).max(64), stops: z.boolean() }).strict()).max(64),
  })
  .strict();
export type TransferCheck = z.infer<typeof TransferCheckSchema>;

/* ------------------------------------------------------------ the consumed transfer routes: plan, adopt, settle, recover (1.22.0) */

/**
 * 1.22.0: the four routes the web's «Надіслати» card and the phone's «Гроші»
 * use to send SOL or a token — one address per function — described as they
 * serve. Nothing about a route changed to be described except the 1.22.0
 * additions: `check`, «Перевірка» counted by the server
 * (`TransferCheckSchema`), on the plan and adopt answers, and the native
 * bearer on recover. They are not `/api/v1` routes: they send no
 * `X-Ryntra-API-Version`, and their error is `{ error: { code, message } }`
 * with route-specific codes (settle adds `signature`; each route's error
 * schema below lists every code). An unexpected exception inside a handler is
 * the platform's bodyless 500, not this shape.
 *
 * The flow: `plan` answers the Review and the unsigned bytes → the wallet
 * signs `plan.unsignedWireBase64` → `POST /api/v1/money/send/returned` says
 * `settle` or `adopt` → `adopt` when the wallet added only its fee and guard
 * instructions (a compute budget, a priority fee, Lighthouse assertions); it
 * answers a new exact Review over those bytes, and that one is settled →
 * `settle` submits once, reads the outcome back from a second operator and
 * answers the signed Outcome Receipt (200) or an open outcome (202) →
 * `recover` by the signature while an outcome is open (a 202, or a settle
 * error that carries a `signature`), never settle again.
 *
 * A client echoes the answer's `plan`, `preflight`, `verdict`, `provider`,
 * `canaryIntent`, `canaryVerdict` and `reviewProof` into adopt and settle
 * byte for byte, with `signedWireBase64`, and counts none of them: the
 * issuer's review proof binds all six, so a changed one is refused. Those
 * parts mirror the handlers' own validator (`SettlementRequestSchema`,
 * `lib/solana/settlement.ts`) rule for rule, never stricter — which is why
 * several of them carry unbounded text and why the plan, the canary intent
 * and the fingerprint keep their cross-checks. Everything only served
 * (support, safety, the settle result, the receipt, the recover answer) is
 * bounded as the code that builds it bounds it; where the code does not,
 * with a generous bound (`SwapText`), not the code's.
 */

/** The raw-amount rule of the Send validators: a canonical non-negative integer, no length bound (u64 values in practice). */
const TransferRaw = z.string().regex(/^(0|[1-9][0-9]*)$/);
/** A signed canonical integer — a balance delta. */
const TransferDelta = z.string().regex(/^-?(0|[1-9][0-9]*)$/);
const TransferNetwork = z.enum(["mainnet", "devnet"]);
const TRANSFER_EVM_TARGET = /^eip155:[1-9][0-9]*:0x[0-9a-fA-F]{40}$/;
/** A canary target: a Solana address or a chain-qualified EVM address (`canary-policy.ts`). */
const TransferTarget = z
  .string()
  .min(1)
  .max(128)
  .refine((value) => BASE58.test(value) || TRANSFER_EVM_TARGET.test(value), "Target must be a Solana address or chain-qualified EVM address.");

/* ---- the plan request */

export const TRANSFER_SPL_ACTION_REF = "action:solana-token-2022/spl-transfer@1";
export const TRANSFER_NATIVE_SOL_ACTION_REF = "action:solana-token-2022/native-sol-transfer@1";

const TransferAmountRaw = TransferRaw.refine((value) => value !== "0", "The amount must be greater than zero base units.");
const TRANSFER_DISTINCT_PARTIES = { path: ["recipient"], message: "The recipient must be different from the sender." };

/** A token transfer proposal (`SplTransferInputSchema`): the amount in base units, the recipient not the sender. */
export const TransferSplInputSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    actionRef: z.literal(TRANSFER_SPL_ACTION_REF),
    network: TransferNetwork,
    mint: Address,
    sender: Address,
    recipient: Address,
    amountRaw: TransferAmountRaw,
  })
  .strict()
  .refine(({ sender, recipient }) => sender !== recipient, TRANSFER_DISTINCT_PARTIES);
export type TransferSplInput = z.infer<typeof TransferSplInputSchema>;

/** A native SOL proposal (`NativeSolTransferInputSchema`): no mint, the amount in lamports. */
export const TransferNativeSolInputSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    actionRef: z.literal(TRANSFER_NATIVE_SOL_ACTION_REF),
    network: TransferNetwork,
    sender: Address,
    recipient: Address,
    amountRaw: TransferAmountRaw,
  })
  .strict()
  .refine(({ sender, recipient }) => sender !== recipient, TRANSFER_DISTINCT_PARTIES);
export type TransferNativeSolInput = z.infer<typeof TransferNativeSolInputSchema>;

export const TransferInputSchema = z.discriminatedUnion("actionRef", [TransferSplInputSchema, TransferNativeSolInputSchema]);
export type TransferInput = z.infer<typeof TransferInputSchema>;

/** The plan request (`POST /api/solana/transfer/plan`): the proposal and nothing else — the owner policy is built on the server, with no field to override it. */
export const TransferPlanRequestSchema = z.object({ input: TransferInputSchema }).strict();
export type TransferPlanRequest = z.infer<typeof TransferPlanRequestSchema>;

/* ---- the plan and its support verdict */

/** The shape the transaction was built as. */
export const TRANSFER_ACTION_KINDS_V1 = ["NATIVE_SOL", "SPL_TRANSFER_CHECKED", "TOKEN_2022", "TOKEN_ATA_CREATE"] as const;
export const TRANSFER_SUPPORT_DECISIONS_V1 = ["SUPPORTED", "REVIEW_REQUIRED", "BLOCKED", "UNKNOWN"] as const;

/**
 * Whether this exact transfer is one the product can build, explain and
 * reconcile, from fresh mint and account facts (`send-support.ts`): one
 * finding per fact (`ACTION_KIND`, `PAUSED`, `SOURCE_FROZEN`,
 * `TRANSFER_HOOK`, `PERMANENT_DELEGATE`, `FREEZE_AUTHORITY`,
 * `TRANSFER_FEE`, `UNKNOWN_EXTENSION`, … — an open list). Served as the
 * answer's `support` and inside the plan, so its rules are the plan
 * validator's.
 */
export const TransferSupportSchema = z
  .object({
    decision: z.enum(TRANSFER_SUPPORT_DECISIONS_V1),
    findings: z
      .array(
        z
          .object({
            code: z.string().min(1).max(64),
            outcome: z.enum(["PASS", "REVIEW", "BLOCK", "UNKNOWN"]),
            detail: z.string().min(1).max(512),
          })
          .strict(),
      )
      .max(32),
  })
  .strict();
export type TransferSupport = z.infer<typeof TransferSupportSchema>;

const TRANSFER_COMPUTE_BUDGET_PROGRAM = "ComputeBudget111111111111111111111111111111";
const TRANSFER_LIGHTHOUSE_PROGRAM = "L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95";

const TransferLegSchema = z
  .object({
    programAddress: Address,
    source: Address,
    mint: Address,
    destination: Address,
    authority: Address,
    amountRaw: TransferRaw,
    decimals: z.number().int().min(0).max(255),
  })
  .strict();

/** What must not change between the built bytes and the signed ones: the message hash and every transfer leg, the first also as `transfer`. */
const TransferFingerprintSchema = z
  .object({
    messageHash: SwapDigest,
    feePayer: Address,
    blockhash: Address,
    instructionCount: z.number().int().min(1).max(16),
    transfer: TransferLegSchema,
    transfers: z.array(TransferLegSchema).min(1).max(12),
  })
  .strict()
  .superRefine((fingerprint, context) => {
    const [first] = fingerprint.transfers;
    for (const [key, value] of Object.entries(fingerprint.transfer)) {
      if ((first as Record<string, unknown>)[key] !== value) {
        context.addIssue({ code: "custom", path: ["transfer", key], message: "The single-leg projection must be the first transfer leg." });
      }
    }
  });

/** Present only on a plan the adopt route re-reviewed over a wallet's bounded modification. */
const TransferWalletAugmentationSchema = z
  .object({
    computeUnitLimit: z.number().int().positive().max(1_400_000),
    microLamportsPerUnit: TransferRaw,
    maximumPriorityFeeLamports: TransferRaw,
    lighthouseAssertions: z
      .array(z.object({ kind: z.enum(["ASSERT_ACCOUNT_INFO_MULTI", "ASSERT_TOKEN_ACCOUNT_MULTI"]), account: Address }).strict())
      .max(16),
  })
  .strict();

/**
 * The reviewed plan (`TransferPlanSchema` of `settlement.ts`, rule for rule
 * with its cross-checks): the exact accounts, amounts and fees, the support
 * verdict, the programs, the blockhash and its last valid height, the
 * unsigned bytes the wallet signs (`unsignedWireBase64`) and their
 * fingerprint. A native SOL plan binds the owner accounts and the System
 * Program in place of token accounts and a mint.
 */
export const TransferPlanSchema = z
  .object({
    actionKind: z.enum(TRANSFER_ACTION_KINDS_V1),
    network: TransferNetwork,
    mint: Address,
    tokenProgram: Address,
    decimals: z.number().int().min(0).max(255),
    sender: Address,
    recipient: Address,
    senderTokenAccount: Address,
    recipientTokenAccount: Address,
    sources: z.array(z.object({ account: Address, amountRaw: TransferRaw, feeRaw: TransferRaw }).strict()).min(1).max(12),
    recipientKind: z.enum(["WALLET_OWNER", "EXISTING_TOKEN_ACCOUNT"]),
    recipientOwner: Address,
    memo: z.string().min(1).max(566).nullable(),
    transferHook: z.object({ program: Address, extraAccounts: z.array(Address).max(32) }).strict().nullable(),
    support: TransferSupportSchema,
    createsRecipientAccount: z.boolean(),
    ataRentLamports: TransferRaw.nullable(),
    amountRaw: TransferRaw,
    senderBalanceRaw: TransferRaw,
    baseFeeLamports: TransferRaw,
    priorityFeeLamports: TransferRaw,
    walletAugmentation: TransferWalletAugmentationSchema.optional(),
    programs: z.array(Address).min(1).max(8),
    blockhash: Address,
    lastValidBlockHeight: TransferRaw,
    unsignedWireBase64: z.string().min(64).max(8_192),
    fingerprint: TransferFingerprintSchema,
    builtAt: Iso,
  })
  .strict()
  .superRefine((plan, context) => {
    const comparisons: Array<[string, unknown, unknown]> = [
      ["fingerprint.feePayer", plan.fingerprint.feePayer, plan.sender],
      ["fingerprint.blockhash", plan.fingerprint.blockhash, plan.blockhash],
      ["fingerprint.transfer.programAddress", plan.fingerprint.transfer.programAddress, plan.tokenProgram],
      ["fingerprint.transfer.source", plan.fingerprint.transfer.source, plan.senderTokenAccount],
      ["fingerprint.transfer.mint", plan.fingerprint.transfer.mint, plan.mint],
      ["fingerprint.transfer.destination", plan.fingerprint.transfer.destination, plan.recipientTokenAccount],
      ["fingerprint.transfer.authority", plan.fingerprint.transfer.authority, plan.sender],
      ["fingerprint.transfer.decimals", plan.fingerprint.transfer.decimals, plan.decimals],
      ["sources[0].account", plan.sources[0].account, plan.senderTokenAccount],
      ["sources.amountRaw", plan.sources.reduce((total, source) => total + BigInt(source.amountRaw), 0n).toString(), plan.amountRaw],
      ["fingerprint.transfers.length", plan.fingerprint.transfers.length, plan.sources.length],
    ];
    for (const [field, actual, expected] of comparisons) {
      if (actual !== expected) {
        context.addIssue({ code: "custom", path: field.split("."), message: `${field} does not match the reviewed plan.` });
      }
    }
    if (plan.walletAugmentation) {
      if (plan.walletAugmentation.maximumPriorityFeeLamports !== plan.priorityFeeLamports) {
        context.addIssue({
          code: "custom",
          path: ["walletAugmentation", "maximumPriorityFeeLamports"],
          message: "Wallet augmentation priority fee must match the exact reviewed plan.",
        });
      }
      if (!plan.programs.includes(TRANSFER_COMPUTE_BUDGET_PROGRAM)) {
        context.addIssue({ code: "custom", path: ["walletAugmentation"], message: "Wallet augmentation requires the reviewed ComputeBudget program." });
      }
      if (plan.walletAugmentation.lighthouseAssertions.length > 0 && !plan.programs.includes(TRANSFER_LIGHTHOUSE_PROGRAM)) {
        context.addIssue({
          code: "custom",
          path: ["walletAugmentation", "lighthouseAssertions"],
          message: "Reviewed Lighthouse assertions require the Lighthouse program.",
        });
      }
    }
    if (!plan.programs.includes(plan.fingerprint.transfer.programAddress)) {
      context.addIssue({ code: "custom", path: ["programs"], message: "The transfer program is absent from the reviewed program list." });
    }
    if (
      plan.actionKind === "NATIVE_SOL" &&
      (plan.senderTokenAccount !== plan.sender || plan.recipientTokenAccount !== plan.recipient || plan.mint !== plan.tokenProgram)
    ) {
      context.addIssue({ code: "custom", path: ["actionKind"], message: "A native SOL plan must bind the owner accounts and System Program directly." });
    }
  });
export type TransferPlan = z.infer<typeof TransferPlanSchema>;

/* ---- the preflight, the owner policy's verdict, the provider */

/**
 * The exact transfer preview (`SplTransferPreflightSchema`, the published
 * `spl-transfer-preflight` contract): raw base-unit strings, the mint's own
 * transfer fee and the epoch config it came from, the balance deltas the
 * transfer should cause, the structural blockers, and the simulation of the
 * exact bytes — `SKIPPED` with its reason, never a guessed success. Its text
 * is unbounded in the validator and therefore here.
 */
export const TransferPreflightSchema = z
  .object({
    schema: z.literal("ryntra.solana.spl-transfer-preflight"),
    schemaVersion: z.literal("0.1.0"),
    network: TransferNetwork,
    mint: Address,
    sender: Address,
    recipient: Address,
    amountRequestedRaw: TransferRaw,
    transferFee: z
      .object({
        feeRaw: TransferRaw,
        basisPoints: z.number().int().min(0).max(10_000),
        maximumFeeRaw: TransferRaw,
        capApplied: z.boolean(),
        configUsed: z.enum(["NEWER", "OLDER", "NONE"]),
        epochBasis: TransferRaw.nullable(),
      })
      .strict(),
    estimatedReceivedRaw: TransferRaw,
    expectedBalanceDeltas: z.array(z.object({ account: Address, mint: Address, rawDelta: TransferDelta }).strict()).min(1).max(4),
    feeWithheldRaw: TransferRaw,
    hookProgramId: Address.nullable(),
    structuralBlockers: z.array(z.enum(["NON_TRANSFERABLE", "PAUSED", "DEFAULT_ACCOUNT_STATE_FROZEN"])),
    unsupportedKinds: z.array(z.string()),
    networkFeeLamports: TransferRaw.nullable(),
    computeBudget: TransferRaw.nullable(),
    unfilledReason: z.string().min(1),
    simulation: z.discriminatedUnion("status", [
      z.object({ status: z.literal("SKIPPED"), reason: z.string().min(1) }).strict(),
      z.object({ status: z.literal("PRESENT"), succeeded: z.boolean(), error: z.string().nullable(), unitsConsumed: TransferRaw.nullable() }).strict(),
    ]),
    observedAt: z.string(),
  })
  .strict();
export type TransferPreflight = z.infer<typeof TransferPreflightSchema>;

/**
 * The owner policy's verdict over the transfer (`SolanaPolicyVerdictSchema`)
 * — the policy built on the server, never posted. The same vocabulary as
 * `SwapAssetVerdictSchema`, with the validator's own rules: unbounded text,
 * no cap on the findings, a time that is any string.
 */
export const TransferPolicyVerdictSchema = z
  .object({
    schema: z.literal("ryntra.solana.policy-verdict"),
    schemaVersion: z.literal("0.1.0"),
    verdict: z.enum(["NO_KNOWN_BLOCKER", "REVIEW_REQUIRED", "BLOCKED", "INCOMPLETE"]),
    findings: z
      .array(
        z
          .object({
            rule: z.enum(SWAP_ASSET_POLICY_RULES_V1),
            outcome: z.enum(["ALLOWED", "REVIEW_REQUIRED", "BLOCKED", "INCOMPLETE"]),
            detail: z.string().min(1),
          })
          .strict(),
      )
      .min(1),
    evaluatedAt: z.string(),
  })
  .strict();
export type TransferPolicyVerdict = z.infer<typeof TransferPolicyVerdictSchema>;

/** The RPC operator that built and simulated the Review; adopt and settle refuse `REVIEW_PROVIDER_CHANGED` when this deployment no longer has it. */
export const TransferProviderSchema = z.object({ role: z.enum(["primary", "fallback"]), host: z.string().min(1).max(253) }).strict();
export type TransferProvider = z.infer<typeof TransferProviderSchema>;

/* ---- the owner canary: evidence carried with the Review, never what decides a customer's transfer */

export const TRANSFER_CANARY_FAMILIES_V1 = ["SEND", "ATA_CREATE", "SWAP", "CCTP", "TOKEN_2022"] as const;
export const TRANSFER_CANARY_DECISIONS_V1 = ["ALLOW", "REVIEW", "BLOCK", "PAUSE", "UNKNOWN"] as const;
/** The canary policy's ten rules, in its order (`SOLANA_CANARY_RULES`). */
export const TRANSFER_CANARY_RULES_V1 = [
  "CONFIG_VALID",
  "EMERGENCY_STOP",
  "MAINNET_ONLY",
  "DESTINATION_ALLOWLISTED",
  "MINTS_ALLOWLISTED",
  "PROGRAMS_ALLOWLISTED",
  "VALUATION_CURRENT",
  "FAMILY_LIMIT",
  "TOTAL_LIMIT",
  "HUMAN_APPROVAL",
] as const;

/**
 * The owner-canary intent built over the plan (`SolanaCanaryIntentSchema`):
 * always `mainnet` whatever the plan's network, its exposure in USD micros
 * (null unless valued), with the validator's rule that a total equals
 * principal plus fee reserve.
 */
export const TransferCanaryIntentSchema = z
  .object({
    schema: z.literal("ryntra.solana.canary-intent"),
    schemaVersion: z.literal("1.0.0"),
    intentId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,127}$/),
    revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    family: z.enum(TRANSFER_CANARY_FAMILIES_V1),
    network: z.literal("mainnet"),
    destination: TransferTarget,
    mints: z.array(TransferTarget).min(1).max(8),
    programs: z.array(TransferTarget).min(1).max(64),
    principalUsdMicros: TransferRaw.nullable(),
    feeReserveUsdMicros: TransferRaw.nullable(),
    usdMicros: TransferRaw.nullable(),
    valuation: z
      .object({ method: z.enum(["USDC_NOMINAL", "PROVIDER_QUOTE", "CHAIN_READ"]), sourceRef: z.string().min(1).max(256), observedAt: Iso, validUntil: Iso })
      .strict()
      .nullable(),
    humanApproval: z.enum(["NOT_RECORDED", "RECORDED"]),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.usdMicros === null) return;
    if (value.principalUsdMicros === null || value.feeReserveUsdMicros === null) {
      context.addIssue({ code: "custom", path: ["usdMicros"], message: "Total USD-micro exposure requires principal and fee-reserve components." });
      return;
    }
    if (BigInt(value.principalUsdMicros) + BigInt(value.feeReserveUsdMicros) !== BigInt(value.usdMicros)) {
      context.addIssue({ code: "custom", path: ["usdMicros"], message: "Total USD-micro exposure must equal principal plus fee reserve." });
    }
  });
export type TransferCanaryIntent = z.infer<typeof TransferCanaryIntentSchema>;

/**
 * The owner-canary verdict (`SolanaCanaryVerdictSchema`): one finding per
 * rule, bound to the intent by `intentDigest`, and `scope` — whether the
 * action was ever inside the envelope the policy governs. An ordinary Send
 * reads `OUTSIDE_ENVELOPE`, decided by the transfer capability; its `BLOCK`
 * or `PAUSE` there refuses nothing.
 */
export const TransferCanaryVerdictSchema = z
  .object({
    schema: z.literal("ryntra.solana.canary-verdict"),
    schemaVersion: z.literal("1.0.0"),
    decision: z.enum(TRANSFER_CANARY_DECISIONS_V1),
    newRiskAllowed: z.boolean(),
    scope: z
      .object({
        status: z.enum(["INSIDE_ENVELOPE", "OUTSIDE_ENVELOPE"]),
        decidedBy: z.enum(["OWNER_CANARY", "TRANSFER_CAPABILITY"]),
        detail: z.string().min(1).max(512),
      })
      .strict(),
    policyId: z.string().min(1).max(96),
    policyDigest: SwapDigest,
    intentDigest: SwapDigest,
    budgetObservedAt: Iso,
    findings: z
      .array(z.object({ rule: z.enum(TRANSFER_CANARY_RULES_V1), outcome: z.enum(["PASS", "REVIEW", "BLOCK", "PAUSE", "UNKNOWN"]), detail: z.string().min(1).max(512) }).strict())
      .length(TRANSFER_CANARY_RULES_V1.length),
    evaluatedAt: Iso,
  })
  .strict();
export type TransferCanaryVerdict = z.infer<typeof TransferCanaryVerdictSchema>;

/* ---- the review proof, the safety gate */

/** The issuer's Ed25519 proof over the canonical plan · preflight · verdict · provider · canary intent · canary verdict bundle (`review-proof.ts`). */
export const TransferSignedReviewProofSchema = z
  .object({
    schema: z.literal("ryntra.solana.send-review-proof"),
    schemaVersion: z.literal("2.0.0"),
    status: z.literal("SIGNED"),
    algorithm: z.literal("Ed25519"),
    digest: SwapDigest,
    keyId: z.string().min(1).max(128),
    publicKey: z.string().min(32).max(256),
    signature: z.string().min(64).max(512),
    issuedAt: Iso,
  })
  .strict();
export type TransferSignedReviewProof = z.infer<typeof TransferSignedReviewProofSchema>;

/** Both proof forms: a deployment without an issuer key answers the unsigned one on `plan` (its safety then blocks), and adopt and settle refuse it. */
export const TransferReviewProofSchema = z.discriminatedUnion("status", [
  TransferSignedReviewProofSchema,
  z
    .object({
      schema: z.literal("ryntra.solana.send-review-proof"),
      schemaVersion: z.literal("2.0.0"),
      status: z.literal("UNSIGNED"),
      digest: SwapDigest,
      reasonCode: z.literal("NO_ISSUER_KEY_CONFIGURED"),
      issuedAt: Iso,
    })
    .strict(),
]);
export type TransferReviewProof = z.infer<typeof TransferReviewProofSchema>;

export const TRANSFER_SAFETY_DECISIONS_V1 = ["ALLOW", "REVIEW", "BLOCK", "PAUSE", "UNKNOWN"] as const;

/**
 * The gate between the Review and a wallet prompt, decided by the server
 * from what it established (`send-safety.ts`): the operator stop, the
 * network, the capability, the simulation of the exact bytes, the priced
 * fee, the visible rent, the programs, the durable store, the second
 * operator and — on `plan` — the issuer proof. Eight to ten findings with
 * the codes `EMERGENCY_STOP` · `NETWORK` · `CAPABILITY` · `SIMULATION` ·
 * `FEE_PRICED` · `RENT_VISIBLE` (only when the recipient's account is
 * created) · `PROGRAMS_SUPPORTED` · `SETTLEMENT_STORE` ·
 * `INDEPENDENT_READBACK` · `REVIEW_PROOF` (only on `plan`). The wallet may
 * be opened only on `ALLOW` or `REVIEW`; a detail may carry RPC text.
 */
export const TransferSafetySchema = z
  .object({
    decision: z.enum(TRANSFER_SAFETY_DECISIONS_V1),
    findings: z
      .array(z.object({ code: z.string().min(1).max(64), outcome: z.enum(["PASS", "REVIEW", "BLOCK", "PAUSE", "UNKNOWN"]), detail: SwapText.min(1) }).strict())
      .min(8)
      .max(10),
  })
  .strict();
export type TransferSafety = z.infer<typeof TransferSafetySchema>;

/* ---- plan and adopt: the Review */

const TransferReviewShape = {
  preflight: TransferPreflightSchema,
  verdict: TransferPolicyVerdictSchema,
  plan: TransferPlanSchema,
  provider: TransferProviderSchema,
  canaryIntent: TransferCanaryIntentSchema,
  canaryVerdict: TransferCanaryVerdictSchema,
  /** The plan's own `support`, served beside it. */
  support: TransferSupportSchema,
  safety: TransferSafetySchema,
  /** 1.22.0: «Перевірка», counted by the server from this Review. */
  check: TransferCheckSchema,
} as const;

/**
 * `POST /api/solana/transfer/plan` — no origin, bearer or owner-session
 * check; on the action budget. Reads the mint (a token), builds the exact
 * unsigned transaction, simulates it, judges it by the server's owner
 * policy, and answers the Review: the mint's Asset Passport (null for SOL),
 * the preflight, the policy verdict, the plan with the bytes the wallet
 * signs, the provider that simulated them, the owner canary's intent and
 * verdict, the support and safety verdicts, the issuer's review proof and
 * (1.22.0) `check`. Moves nothing and submits nothing, on either network.
 * Fails `TransferPlanErrorSchema`.
 */
export const TransferReviewSchema = z
  .object({ passport: SwapPassportSchema.nullable(), ...TransferReviewShape, reviewProof: TransferReviewProofSchema })
  .strict();
export type TransferReview = z.infer<typeof TransferReviewSchema>;

export const TransferReviewResponseSchema = z.object({ data: TransferReviewSchema }).strict();
export type TransferReviewResponse = z.infer<typeof TransferReviewResponseSchema>;

/**
 * `POST /api/solana/transfer/adopt` — no origin, bearer or owner-session
 * check; on the action budget; submits nothing. Takes the plan answer's
 * parts and the wallet's signed bytes when the wallet added only its fee
 * and guard instructions; verifies the original proof and the wallet's own
 * signature, reprices and re-simulates the exact returned message, and
 * answers a new Review over it: the same bundle as `plan` with `passport`
 * always null, the adopted plan (its `walletAugmentation` set, its
 * `unsignedWireBase64` the wallet's message), the preflight repriced, the
 * canary re-evaluated, a safety verdict without `REVIEW_PROOF` that is
 * always `ALLOW` or `REVIEW`, a signed proof, and (1.22.0) `check`. That
 * Review, with the same `signedWireBase64`, is what settle takes. Fails
 * `TransferAdoptErrorSchema`.
 */
export const TransferAdoptedReviewSchema = z
  .object({ passport: z.null(), ...TransferReviewShape, reviewProof: TransferSignedReviewProofSchema })
  .strict();
export type TransferAdoptedReview = z.infer<typeof TransferAdoptedReviewSchema>;

export const TransferAdoptResponseSchema = z.object({ data: TransferAdoptedReviewSchema }).strict();
export type TransferAdoptResponse = z.infer<typeof TransferAdoptResponseSchema>;

/* ---- adopt and settle: the request */

/**
 * The adopt and settle request (`SettlementRequestSchema`): the Review's six
 * bound parts and its proof, echoed exactly as answered, and the wallet's
 * signed transaction (base64, not validated as such here — the handler
 * decodes it). Strict at the top; the body is at most 96 KiB.
 */
export const TransferSettleRequestSchema = z
  .object({
    plan: TransferPlanSchema,
    preflight: TransferPreflightSchema,
    verdict: TransferPolicyVerdictSchema,
    provider: TransferProviderSchema,
    canaryIntent: TransferCanaryIntentSchema,
    canaryVerdict: TransferCanaryVerdictSchema,
    reviewProof: TransferReviewProofSchema,
    signedWireBase64: z.string().min(64).max(8_192),
  })
  .strict();
export type TransferSettleRequest = z.infer<typeof TransferSettleRequestSchema>;

/** Adopt takes the very same request. */
export const TransferAdoptRequestSchema = TransferSettleRequestSchema;
export type TransferAdoptRequest = TransferSettleRequest;

/* ---- settle: the outcome */

/** A signature status as one operator answered it (`SignatureStatusRead`): `seen` false when it returned no row. */
export const TransferSignatureStatusSchema = z
  .object({
    confirmationStatus: z.enum(["processed", "confirmed", "finalized"]).nullable(),
    /** The chain's error, as JSON text. */
    err: SwapText.nullable(),
    seen: z.boolean(),
    slot: RawAmount.nullable(),
  })
  .strict();
export type TransferSignatureStatus = z.infer<typeof TransferSignatureStatusSchema>;

/** One operator's read of a signature (`readSignatureStatus`): `UNKNOWN` when the read itself failed — never an unseen transaction. */
export const TransferStatusReadSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("READ"), status: TransferSignatureStatusSchema }).strict(),
  z.object({ state: z.literal("UNKNOWN"), status: TransferSignatureStatusSchema, reason: SwapText }).strict(),
]);
export type TransferStatusRead = z.infer<typeof TransferStatusReadSchema>;

/** What the recovery read established, with the read itself (`RecoveryFactsWithStatusRead`). */
const TransferRecoveryFactsSchema = z
  .object({
    signature: SwapSignature,
    status: TransferSignatureStatusSchema,
    statusRead: TransferStatusReadSchema,
    /** The chain's height; null when that read failed or the status read did. */
    blockHeight: RawAmount.nullable(),
    lastValidBlockHeight: TransferRaw,
  })
  .strict();

/** The independent read-back of the transfer (`SplTransferObservationSchema`): the transaction's own signed deltas, per token account and per lamport account. */
export const TransferObservationSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    actionRef: z.union([z.literal(TRANSFER_SPL_ACTION_REF), z.literal(TRANSFER_NATIVE_SOL_ACTION_REF)]),
    network: TransferNetwork,
    signature: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,88}$/),
    slot: TransferRaw,
    blockTime: Iso.nullable(),
    feeLamports: TransferRaw,
    balanceDeltas: z.array(z.object({ account: Address, mint: Address, rawDelta: TransferDelta }).strict()).max(16),
    lamportBalanceDeltas: z.array(z.object({ account: Address, rawDelta: TransferDelta }).strict()).max(64),
    sources: z.array(z.object({ ref: z.string().min(1).max(256), label: z.string().min(1).max(128) }).strict()).min(1).max(8),
    observedAt: Iso,
  })
  .strict();
export type TransferObservation = z.infer<typeof TransferObservationSchema>;

/** A read-back that happened during recovery (`ObserveResult`): the full observation, or why there is none. */
const TransferObserveResultSchema = z.union([
  z
    .object({
      ok: z.literal(true),
      observation: TransferObservationSchema,
      transactionSucceeded: z.boolean(),
      transactionError: SwapText.nullable(),
      invokedPrograms: z.array(z.string().min(1).max(128)).max(256),
      postTokenAccounts: z
        .array(
          z
            .object({
              account: z.string().min(1).max(128),
              mint: z.string().min(1).max(128),
              owner: z.string().min(1).max(128).nullable(),
              tokenProgram: z.string().min(1).max(128).nullable(),
              amountRaw: SwapDigits,
              decimals: z.number().int().min(0).max(255),
            })
            .strict(),
        )
        .max(256),
      observedEffects: z.array(z.object({ description: SwapText.min(1), sourceRef: z.string().min(1).max(512), observedAt: Iso }).strict()).min(1).max(65),
    })
    .strict(),
  z.object({ ok: z.literal(false), code: z.enum(["NOT_FOUND", "UNREADABLE", "RPC_FAILED"]), reason: SwapText }).strict(),
]);

/** The receipt's reconciliation of expected against observed, movement by movement (`Reconciliation`): seven expectations today. */
export const TransferReconciliationSchema = z
  .object({
    status: z.enum(["MATCHED", "DEVIATION_RECORDED", "FAILED"]),
    findings: z
      .array(z.object({ expectation: SwapText.min(1), status: z.enum(["MATCHED", "NOT_OBSERVED"]), matchedBy: z.string().min(1).max(512).nullable() }).strict())
      .min(1)
      .max(64),
    /** Observed effects no expectation accounted for — never silently dropped. */
    unexpected: z.array(z.string().min(1).max(512)).max(64),
    matched: z.number().int().min(0).max(64),
    expected: z.number().int().min(1).max(64),
  })
  .strict();
export type TransferReconciliation = z.infer<typeof TransferReconciliationSchema>;

/**
 * The Send Receipt facts (`SolanaSendReceiptFacts`, v1.2.0 — what this code
 * mints): planned against actual debit, credit, fees and account opening,
 * the programs planned and observed, the signature, finality and the
 * reconciliation. The Receipt seals the same object inside its observed
 * effects as chunked JSON (`ryntra.solana.send-receipt.facts@1:…#i/n`, 480
 * characters each).
 */
export const TransferReceiptFactsSchema = z
  .object({
    schema: z.literal("ryntra.solana.send-receipt"),
    schemaVersion: z.literal("1.2.0"),
    reviewDigest: SwapDigest,
    augmentation: z.discriminatedUnion("status", [
      z.object({ status: z.literal("NONE"), summary: z.literal("The signed message matched the reviewed plan without wallet augmentation.") }).strict(),
      z.object({ status: z.literal("PRESENT"), summary: z.string().min(1).max(512), actualPriorityFeeLamports: TransferRaw }).strict(),
    ]),
    actionKind: z.enum(TRANSFER_ACTION_KINDS_V1),
    network: TransferNetwork,
    mint: Address,
    sender: Address,
    recipient: Address,
    expectedDebitRaw: TransferDelta,
    expectedCreditRaw: TransferRaw,
    actualDebitRaw: TransferDelta.nullable(),
    actualCreditRaw: TransferRaw.nullable(),
    transferFeeRaw: TransferRaw,
    baseFeeLamports: TransferRaw.nullable(),
    priorityFeeLamports: TransferRaw.nullable(),
    ataRentLamports: TransferRaw.nullable(),
    plannedAta: z.object({ createsRecipientAccount: z.boolean(), rentLamports: TransferRaw.nullable() }).strict(),
    observedAta: z
      .object({
        created: z.boolean(),
        rentLamports: TransferRaw.nullable(),
        owner: z.string().min(32).max(44).nullable(),
        tokenProgram: z.string().min(32).max(44).nullable(),
        rentPayer: z.string().min(32).max(44).nullable(),
      })
      .strict(),
    observedPrograms: z.array(z.string().min(32).max(44)).max(16),
    plannedBaseFeeLamports: TransferRaw,
    actualBaseFeeLamports: TransferRaw,
    plannedPriorityFeeLamports: TransferRaw,
    actualPriorityFeeLamports: TransferRaw,
    programs: z.array(Address).min(1).max(8),
    signature: z.string().min(64).max(88),
    slot: TransferRaw,
    finality: z.enum(["processed", "confirmed", "finalized", "unknown"]),
    reconciliation: z.enum(["MATCHED", "DEVIATION_RECORDED", "FAILED"]),
  })
  .strict();
export type TransferReceiptFacts = z.infer<typeof TransferReceiptFactsSchema>;

/** The Send Receipt is the same issuer-signed Outcome Receipt as the swap's (`OutcomeReceiptArtifact`); its `actionPassportHash` is the review proof's digest. */
export const TransferReceiptSchema = SwapReceiptSchema;
export type TransferReceipt = SwapReceipt;

/**
 * The Artifact Verifier's reading of that Receipt (`ArtifactVerification`),
 * the three axes never collapsed. On this route it is always a recognised
 * v2 `OUTCOME_RECEIPT` signed by the issuer key settle requires; the issuer
 * axis is checked against the deployment's published key.
 */
export const TransferVerificationSchema = z
  .object({
    recognised: z.boolean(),
    generation: z.enum(["v2", "legacy-1.0.0"]).nullable(),
    kind: z.enum(["AGENT_PASSPORT", "ACTION_PASSPORT", "OUTCOME_RECEIPT", "ACTION_PASSPORT_PREVIEW"]).nullable(),
    schemaVersion: z.string().min(1).max(32).nullable(),
    integrity: z.object({ valid: z.boolean(), issues: z.array(SwapText).max(256) }).strict(),
    issuer: z
      .object({ verdict: z.enum(["SIGNATURE_VALID", "SIGNATURE_INVALID", "UNSIGNED", "UNTRUSTED_KEY"]), keyId: z.string().min(1).max(128).nullable(), detail: SwapText })
      .strict(),
    authorization: z.object({ verdict: z.enum(["AUTHORIZED", "NOT_AUTHORIZED", "DEMO_ACKNOWLEDGEMENT_ONLY", "NOT_APPLICABLE"]), detail: SwapText }).strict(),
    observation: z.object({ verdict: z.enum(["OBSERVED", "NOT_OBSERVED", "NOT_APPLICABLE"]), detail: SwapText }).strict(),
  })
  .strict();
export type TransferVerification = z.infer<typeof TransferVerificationSchema>;

const TransferLandingState = z.enum(["CONFIRMED", "FINALIZED", "LANDED_FAILED"]);
const TransferConfirmationSchema = z.object({ slot: RawAmount, status: z.enum(["confirmed", "finalized"]), err: SwapText.nullable() }).strict();

/** 200 `RECEIPTED`: the transfer landed, was read back independently, reconciled and receipted — or landed and failed (`landingState` `LANDED_FAILED`, the Receipt `FAILED`). */
export const TransferSettledSchema = z
  .object({
    ok: z.literal(true),
    state: z.literal("RECEIPTED"),
    landingState: TransferLandingState,
    signature: SwapSignature,
    confirmation: TransferConfirmationSchema,
    observation: TransferObservationSchema,
    /** The read-back's own sentences — the chain's verdict first, then one per movement. */
    observedEffects: z.array(z.object({ description: z.string().min(1).max(512), sourceRef: z.string().min(1).max(512), observedAt: Iso }).strict()).min(1).max(64),
    reconciliation: TransferReconciliationSchema,
    receipt: TransferReceiptSchema,
    sendReceiptFacts: TransferReceiptFactsSchema,
    verification: TransferVerificationSchema,
  })
  .strict();
export type TransferSettled = z.infer<typeof TransferSettledSchema>;

/** 202 `UNKNOWN`, first form: the route's deadline passed during the submit or the recovery read; recover by signature. */
export const TransferSettlePendingSchema = z
  .object({ ok: z.literal(true), state: z.literal("UNKNOWN"), signature: SwapSignature, receipt: z.null() })
  .strict();
export type TransferSettlePending = z.infer<typeof TransferSettlePendingSchema>;

/** 202, second form: the submit did not confirm and the recovery read found it not landed — `SUBMITTED` (processed), `EXPIRED` (past its height, never seen) or `UNKNOWN` — with the facts and the read-back it made. */
export const TransferSettleRecoverySchema = z
  .object({
    ok: z.literal(true),
    state: z.enum(["SUBMITTED", "EXPIRED", "UNKNOWN"]),
    signature: SwapSignature,
    receipt: z.null(),
    recovery: TransferRecoveryFactsSchema,
    effectReadback: z.discriminatedUnion("state", [
      z.object({ state: z.literal("READ"), value: TransferObserveResultSchema }).strict(),
      z.object({ state: z.literal("UNKNOWN"), reason: SwapText }).strict(),
    ]),
  })
  .strict();
export type TransferSettleRecovery = z.infer<typeof TransferSettleRecoverySchema>;

/** 202 `RECOVERY`: it landed (`landingState`, `confirmation`) and the independent read-back did not return it, or not in time; recover by signature. */
export const TransferSettleUnobservedSchema = z
  .object({
    ok: z.literal(true),
    state: z.literal("RECOVERY"),
    landingState: TransferLandingState,
    signature: SwapSignature,
    confirmation: TransferConfirmationSchema,
    receipt: z.null(),
  })
  .strict();
export type TransferSettleUnobserved = z.infer<typeof TransferSettleUnobservedSchema>;

/** The states a settle answer can carry: 200 `RECEIPTED`, 202 the others. */
export const TRANSFER_SETTLE_STATES_V1 = ["RECEIPTED", "RECOVERY", "SUBMITTED", "EXPIRED", "UNKNOWN"] as const;

/** The four exact forms, hence `z.union` (two of them share `UNKNOWN`); `receipt` null is exactly the 202. */
export const TransferSettleResultSchema = z.union([TransferSettledSchema, TransferSettlePendingSchema, TransferSettleRecoverySchema, TransferSettleUnobservedSchema]);
export type TransferSettleResult = z.infer<typeof TransferSettleResultSchema>;

/**
 * `POST /api/solana/transfer/settle` — the only route that submits a Solana
 * transaction. No origin, bearer or owner-session check; on the action
 * budget; `maxDuration` 60 s with a 50-second deadline of its own. Requires
 * the issuer key, a durable multi-writer store and a second RPC operator;
 * derives the safety verdict itself from the echoed plan (the request
 * carries none); verifies the review proof, the canary binding, the plan
 * against the preflight, readiness and the wallet's signature over the
 * exact bytes; claims the signature in the durable attempt ledger, submits
 * once, confirms, reads the outcome back from the second operator and mints
 * the Receipt. Answers `{ data }`: 200 `TransferSettledSchema` (with
 * `verification`), 202 one of the three open forms. Fails
 * `TransferSettleErrorSchema`.
 */
export const TransferSettleResponseSchema = z.object({ data: TransferSettleResultSchema }).strict();
export type TransferSettleResponse = z.infer<typeof TransferSettleResponseSchema>;

/* ---- recover */

/** The recover request: the network and the signature, nothing else — no transaction bytes. */
export const TransferRecoverRequestSchema = z.object({ network: TransferNetwork, signature: SwapSignature }).strict();
export type TransferRecoverRequest = z.infer<typeof TransferRecoverRequestSchema>;

/**
 * What recover reads: the durable attempt (null when this deployment never
 * recorded the signature — a fact, not a failure) and each operator's status
 * read (`independent` null when there is no second operator). The outcome is
 * the operators' reads: once the bytes crossed, settle leaves the attempt at
 * `SUBMITTED_UNKNOWN` (`RECOVERY_REQUIRED` after an exception) and never
 * records `CONFIRMED`, `FINALIZED`, `RECEIPTED` or the `receiptHash`, so a
 * receipted transfer still reads `SUBMITTED_UNKNOWN` here.
 */
export const TransferRecoverySchema = z
  .object({
    network: TransferNetwork,
    signature: SwapSignature,
    attempt: z.object({ state: z.enum(SWAP_SEND_ATTEMPT_STATES_V1), reservedAt: Iso, updatedAt: Iso, receiptHash: SwapDigest.nullable() }).strict().nullable(),
    primary: TransferStatusReadSchema,
    independent: TransferStatusReadSchema.nullable(),
  })
  .strict();
export type TransferRecovery = z.infer<typeof TransferRecoverySchema>;

/**
 * `POST /api/solana/transfer/recover` — a browser on this site or (1.22.0)
 * the native bearer, as the swap routes take it; no owner session; on the
 * read budget. Accepts no transaction bytes, holds no key and submits
 * nothing, so it stays open while Send is paused and never releases an
 * attempt. Answers 200 `{ data }` whatever the chain says; a client polls it
 * while an outcome is open. Fails `TransferRecoverErrorSchema`.
 */
export const TransferRecoverResponseSchema = z.object({ data: TransferRecoverySchema }).strict();
export type TransferRecoverResponse = z.infer<typeof TransferRecoverResponseSchema>;

/* ---- the errors */

/** The builders' refusals (`TransferBuildFailure`): the token builder's and native SOL's alike. */
export const TRANSFER_BUILD_ERROR_CODES_V1 = [
  "INPUT_MINT_MISMATCH",
  "SENDER_ACCOUNT_MISSING",
  "INSUFFICIENT_BALANCE",
  "INSUFFICIENT_FEE_BALANCE",
  "BLOCKHASH_UNAVAILABLE",
  "FEE_UNAVAILABLE",
  "ZERO_AMOUNT",
  "SENDER_RECIPIENT_SAME",
  "RECIPIENT_UNSUPPORTED",
  "SOURCE_TOTAL_MISMATCH",
  "TRANSACTION_TOO_LARGE",
  "HOOK_ACCOUNTS_UNAVAILABLE",
  "ACCOUNT_STATE_UNREADABLE",
  "BUILD_FAILED",
] as const;

/** The mint read's and the passport's refusals (`MintReadFailure`). */
export const TRANSFER_MINT_ERROR_CODES_V1 = ["ACCOUNT_NOT_FOUND", "NOT_A_MINT", "DECODE_FAILED", "RPC_FAILED"] as const;

export const TRANSFER_PLAN_ERROR_CODES_V1 = [
  "RATE_LIMITED",
  ...SWAP_BODY_ERROR_CODES_V1,
  "VALIDATION_ERROR",
  ...TRANSFER_MINT_ERROR_CODES_V1,
  "EPOCH_UNAVAILABLE",
  ...TRANSFER_BUILD_ERROR_CODES_V1,
  /* the preflight's one code the builders do not share */
  "MINT_NOT_INITIALIZED",
  "CANARY_EVIDENCE_UNAVAILABLE",
] as const;

/**
 * The plan route's refusal: 429 `RATE_LIMITED`; body codes; 400
 * `VALIDATION_ERROR` (the message names up to three failing fields); 422
 * the mint read's and the passport's codes, the builders' codes and the
 * preflight's (`INPUT_MINT_MISMATCH` · `MINT_NOT_INITIALIZED` ·
 * `ZERO_AMOUNT` · `SENDER_RECIPIENT_SAME`); 503 `EPOCH_UNAVAILABLE` (a
 * token's Token-2022 fee cannot be bound) · `CANARY_EVIDENCE_UNAVAILABLE`.
 */
export const TransferPlanErrorSchema = z
  .object({ error: z.object({ code: z.enum(TRANSFER_PLAN_ERROR_CODES_V1), message: SwapText }).strict() })
  .strict();
export type TransferPlanError = z.infer<typeof TransferPlanErrorSchema>;

export const TRANSFER_ADOPT_ERROR_CODES_V1 = [
  "RATE_LIMITED",
  ...SWAP_BODY_ERROR_CODES_V1,
  "VALIDATION_ERROR",
  "SEND_NOT_PERMITTED",
  "REVIEW_PROOF_UNAVAILABLE",
  "REVIEW_PROOF_INVALID",
  "ORIGINAL_REVIEW_DISAGREES",
  "ORIGINAL_REVIEW_NOT_READY",
  "WALLET_MODIFICATION_REJECTED",
  "WALLET_SIGNATURE_REJECTED",
  "REVIEW_PROVIDER_CHANGED",
  "WALLET_TRANSACTION_UNREADABLE",
  "WALLET_TRANSACTION_EXPIRED",
  "WALLET_PRIORITY_FEE_INVALID",
  "WALLET_PRIORITY_FEE_TOO_HIGH",
  "WALLET_FEE_MISMATCH",
  "WALLET_SIMULATION_UNAVAILABLE",
  "WALLET_SIMULATION_FAILED",
  "WALLET_ADOPTION_OUT_OF_SCOPE",
] as const;

/**
 * The adopt route's refusal: 429 `RATE_LIMITED`; body codes; 400
 * `VALIDATION_ERROR` (up to three failing fields); 403 `SEND_NOT_PERMITTED`
 * (the reviewed plan's re-derived safety, its first finding that did not
 * pass); 503 `REVIEW_PROOF_UNAVAILABLE`; 409 `REVIEW_PROOF_INVALID` (the
 * proof or the canary binding) · `ORIGINAL_REVIEW_DISAGREES` ·
 * `ORIGINAL_REVIEW_NOT_READY` · `WALLET_MODIFICATION_REJECTED` (more than
 * fee and guard instructions changed) · `WALLET_SIGNATURE_REJECTED` ·
 * `REVIEW_PROVIDER_CHANGED`; 400 `WALLET_TRANSACTION_UNREADABLE` when the
 * signed bytes do not decode, 409 when the adoption cannot read them; 409
 * `WALLET_TRANSACTION_EXPIRED` · `WALLET_PRIORITY_FEE_INVALID` ·
 * `WALLET_PRIORITY_FEE_TOO_HIGH` · `WALLET_FEE_MISMATCH`; 503
 * `WALLET_SIMULATION_UNAVAILABLE`; 409 `WALLET_SIMULATION_FAILED` ·
 * `WALLET_ADOPTION_OUT_OF_SCOPE`.
 */
export const TransferAdoptErrorSchema = z
  .object({ error: z.object({ code: z.enum(TRANSFER_ADOPT_ERROR_CODES_V1), message: SwapText }).strict() })
  .strict();
export type TransferAdoptError = z.infer<typeof TransferAdoptErrorSchema>;

export const TRANSFER_SETTLE_ERROR_CODES_V1 = [
  "RATE_LIMITED",
  "OWNER_CANARY_UNAVAILABLE",
  ...SWAP_BODY_ERROR_CODES_V1,
  "VALIDATION_ERROR",
  "SEND_NOT_PERMITTED",
  "REVIEW_PROOF_UNAVAILABLE",
  "SETTLEMENT_STORE_UNAVAILABLE",
  "REVIEW_PROVIDER_CHANGED",
  "INDEPENDENT_READBACK_UNAVAILABLE",
  /* the candidate's validation (`SettlementValidationFailure`) */
  "PLAN_INVALID",
  "PLAN_PREFLIGHT_DISAGREE",
  "REVIEW_PROOF_INVALID",
  "NOT_READY",
  "SIGNED_BYTES_REJECTED",
  /* the durable submit boundary (`send-attempt.ts`) */
  "SEND_ATTEMPT_CONFLICT",
  "SEND_ATTEMPT_UNAVAILABLE",
  "SEND_SETTLEMENT_FAILED",
  "SUBMISSION_UNKNOWN",
  /* before the one broadcast */
  "REQUEST_DEADLINE",
  "CURRENT_HEIGHT_UNKNOWN",
  "PLAN_EXPIRED",
  /* the broadcast refused without a signature (one that carries its signature is recovered, never answered as an error) */
  "NOT_CLEARED",
  "REJECTED",
  "DUPLICATE",
  /* the Receipt after a landed transfer */
  "NO_EXPECTATIONS",
  "MINT_FAILED",
] as const;

/**
 * The settle route's refusal. Before the body is read: 429 `RATE_LIMITED`;
 * 503 `OWNER_CANARY_UNAVAILABLE` (only a request that declares the
 * owner-canary flow, while its policy is unreadable); then body codes; 400
 * `VALIDATION_ERROR` (up to three failing fields); 403 `SEND_NOT_PERMITTED`;
 * 503 `REVIEW_PROOF_UNAVAILABLE` · `SETTLEMENT_STORE_UNAVAILABLE`; 409
 * `REVIEW_PROVIDER_CHANGED`; 503 `INDEPENDENT_READBACK_UNAVAILABLE`; 409
 * `SIGNED_BYTES_REJECTED` when no signature verified. Every 422 carries
 * `signature`: null for the candidate's refusals (`PLAN_INVALID` ·
 * `PLAN_PREFLIGHT_DISAGREE` · `REVIEW_PROOF_INVALID` · `NOT_READY` ·
 * `SIGNED_BYTES_REJECTED`), `SEND_SETTLEMENT_FAILED`, `REQUEST_DEADLINE` ·
 * `CURRENT_HEIGHT_UNKNOWN` · `PLAN_EXPIRED` and `NOT_CLEARED` · `REJECTED` ·
 * `DUPLICATE` — nothing reached the network; the signature for
 * `SEND_ATTEMPT_CONFLICT` · `SEND_ATTEMPT_UNAVAILABLE` (the claim),
 * `SUBMISSION_UNKNOWN` (these bytes already crossed the boundary, or the
 * settlement failed after it) and `NO_EXPECTATIONS` · `MINT_FAILED` (it
 * landed; the Receipt did not mint). A refusal with a signature is not
 * "nothing happened": the History records it in flight, and the client
 * recovers by that signature and never settles again.
 */
export const TransferSettleErrorSchema = z
  .object({
    error: z
      .object({
        code: z.enum(TRANSFER_SETTLE_ERROR_CODES_V1),
        message: SwapText,
        /** Only on a 422: the transaction's signature when these bytes may be live, else null. */
        signature: SwapSignature.nullable().optional(),
      })
      .strict(),
  })
  .strict();
export type TransferSettleError = z.infer<typeof TransferSettleErrorSchema>;

export const TRANSFER_RECOVER_ERROR_CODES_V1 = [
  "RATE_LIMITED",
  ...SWAP_CARRIER_ERROR_CODES_V1,
  ...SWAP_BODY_ERROR_CODES_V1,
  "VALIDATION_ERROR",
  "STORE_NOT_DURABLE",
  "SEND_ATTEMPT_UNAVAILABLE",
] as const;

/**
 * The recover route's refusal: 429 `RATE_LIMITED`; the carrier's codes
 * (403 `FORBIDDEN_ORIGIN` for a browser from elsewhere; 1.22.0: a bearer
 * that fails 401, or 503 `UNAVAILABLE` when the session store did not
 * answer); body codes; 400 `VALIDATION_ERROR`; 503 `STORE_NOT_DURABLE` ·
 * `SEND_ATTEMPT_UNAVAILABLE` (the stored attempt would not read).
 */
export const TransferRecoverErrorSchema = z
  .object({ error: z.object({ code: z.enum(TRANSFER_RECOVER_ERROR_CODES_V1), message: SwapText }).strict() })
  .strict();
export type TransferRecoverError = z.infer<typeof TransferRecoverErrorSchema>;

/* ------------------------------------------------------------ the consumed routes: predictions (1.11.0) */

/**
 * Ryntra Predictions in paper mode — every route under `/api/predictions/*`,
 * described as it is served; nothing about a route changed. The market
 * figures are the aggregator's, read through the provider boundary
 * (`lib/predictions/provider.ts`) and passed on as the provider states them:
 * a figure it does not state is `null`, and its text and ids are not checked
 * for form or length by the code (the bounds below are generous ceilings, not
 * the provider's promises). Nothing here moves funds: every order is a paper
 * order.
 *
 * The market reads (discover, engine, events, markets, outcomes) are public;
 * with a wallet proof, discover and one event also answer the wallet's watch
 * state. The paper account, the link, quotes, orders, plans and the
 * watchlist need the proven wallet — the phone's bearer or the web's proof
 * cookie; a cookie mutation must come from this site. Answers are
 * `private, no-store`.
 *
 * A handler's failure is `PredictionsFailureSchema` with the status its code
 * maps to. Before a wallet route's handler runs, a missing or refused proof
 * answers the v1 `ApiErrorSchema` instead (UNAUTHORIZED 401, SESSION_EXPIRED
 * 401, SESSION_REVOKED 401, FORBIDDEN 403, UNAVAILABLE 503). A provider
 * failure maps to RATE_LIMITED 429, SESSION_EXPIRED 401 (a provider 401,
 * also on a public read), FORBIDDEN 403, NOT_FOUND 404, VALIDATION_ERROR 400
 * (any other provider 4xx, with the provider's message) or
 * PROVIDER_UNAVAILABLE 503. An exception a handler does not catch (a store
 * that throws) is the platform's bare 500, in neither shape.
 */

/**
 * The wallet behind a prediction route. Since 1.62.0 (PM-S1) a prediction
 * route acts only for a Solana wallet — an EVM proof the shared reader still
 * accepts is refused by the handler with UNAUTHORIZED 401 — so a prediction
 * answer names a Solana address; the schema still admits a lower-case EVM
 * address because other shapes share it (a rule's owner, the recipient check).
 */
const PredictionWalletAddress = z.union([Address, z.string().regex(/^0x[0-9a-f]{40}$/)]);

/** An id the provider states (an event, a market, an outcome, a quote, an order); the code does not check its form. */
const PredId = z.string().max(256);
/** A short token the provider states — a venue, a chain, a status, a kind; not bounded by the code. */
const PredWord = z.string().max(256);
/** Provider text the code does not bound (a title, a question, a label, a reason); a generous ceiling. */
const PredText = z.string().max(4000);
/** A venue's verbatim description, resolution rules or settlement text; not bounded by the code, a generous ceiling. */
const PredLongText = z.string().max(32_768);
/** An image or article link as the provider states it; the code does not check it is a URL. */
const PredLink = z.string().max(2048);
/** A probability the code clamps to 0–1 and rounds to four decimals. */
const PredProbability = z.number().min(0).max(1);

/** An id as the prediction routes accept it in a path, a query or a body. */
export const PredictionRouteIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
/** A Prediction Plan's id. */
export const PredictionPlanIdSchema = z.string().regex(/^pplan_[0-9a-f]{24}$/);

export const PREDICTION_FAILURE_CODES_V1 = [
  "VALIDATION_ERROR",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "RATE_LIMITED",
  "PROVIDER_UNAVAILABLE",
  /** The paper account is not linked to this wallet yet — one wallet signature away. */
  "NOT_LINKED",
  /** This deployment cannot hold a link (no session secret, no durable store). */
  "LINK_UNAVAILABLE",
  /** The provider session no longer refreshes — sign again. */
  "SESSION_EXPIRED",
  /** The signed message, or the provider's user, is not the proven wallet. */
  "WALLET_MISMATCH",
  /** The provider refused the signature or the nonce; or a base64 signature is not 64 bytes. */
  "SIGNATURE_INVALID",
  /** The provider asks for its bot check before the sign-in starts: show Turnstile with `siteKey`, then start again with its token. */
  "CHALLENGE_REQUIRED",
  /** The start carried the bot check's token and the provider asked for the check again: the token was refused — start again from the beginning. */
  "CHALLENGE_FAILED",
  /** Declared; no route produces it today. */
  "QUOTE_UNAVAILABLE",
  "QUOTE_EXPIRED",
  /** The Review refused the order, or the provider refused the fill, with its reason. */
  "ORDER_REFUSED",
  "PLAN_INVALID",
  "PLAN_NOT_FOUND",
  "PLAN_VERSION_CONFLICT",
  "PLAN_STATE_REFUSED",
  /** 1.62.0 (PM-S1): live money is switched off on this deployment — only the funding routes answer it, which this contract does not describe yet. */
  "FUNDING_OFF",
  /** 1.62.0 (PM-S1): a withdrawal whose state is not known yet stands for this wallet — only the funding routes answer it. */
  "WITHDRAWAL_OPEN",
  "UNAVAILABLE",
] as const;
export const PREDICTION_MARKET_STATUSES_V1 = ["open", "closed", "resolved", "unknown"] as const;
export const PREDICTION_ORDER_STATES_V1 = ["reviewed", "submitted", "filled", "partially_filled", "failed", "expired", "cancelled"] as const;
export const PREDICTION_LINK_STATES_V1 = ["none", "active", "expired", "revoked"] as const;
export const PREDICTION_DISCOVER_SORTS_V1 = ["volume24h", "volume", "newest", "ending"] as const;
export const PREDICTION_CHART_RESOLUTIONS_V1 = ["1m", "5m", "1h", "1d"] as const;
export const PREDICTION_PLAN_STATUSES_V1 = ["draft", "active", "executed", "cancelled", "expired"] as const;
export const PREDICTION_MONITOR_METRICS_V1 = ["probability", "volume24h", "signal", "resolution", "plan"] as const;

/* ---- the failure */

/**
 * The refused fields an error names: `path` dotted (`""` for the body
 * itself), `message` the validator's words. Bounded since 1.11.0 — at most
 * thirty-two, the v1 routes' own cap, each path and message cut to a
 * readable length (`failureBody`); before, a refused 32 KB plan body drew
 * 43,672 issues and a message could quote a 32 KB key whole.
 */
const PredIssues = z.array(z.object({ path: z.string().max(256), message: z.string().min(1).max(512) }).strict()).min(1).max(32);
/** The same list as a failure object holds it before it is answered — unbounded by the code (only a failure answered as an error is cut). */
const PredRawIssues = z.array(z.object({ path: z.string().max(65_536), message: z.string().min(1).max(65_536) }).strict()).max(65_536);

/** A Turnstile site key: `0x…`, or one of Cloudflare's test keys `1x…`–`3x…`. */
const PredTurnstileSiteKey = z.string().regex(/^[0-9]x[0-9A-Za-z_-]{8,120}$/);

/**
 * The error a prediction route's handler answers, with the status the code
 * maps to: VALIDATION_ERROR 400, PLAN_INVALID 400, UNAUTHORIZED 401,
 * SESSION_EXPIRED 401, SIGNATURE_INVALID 401, FORBIDDEN 403, WALLET_MISMATCH
 * 403, CHALLENGE_FAILED 403, NOT_FOUND 404, PLAN_NOT_FOUND 404, NOT_LINKED 409, QUOTE_EXPIRED 409,
 * PLAN_VERSION_CONFLICT 409, PLAN_STATE_REFUSED 409, QUOTE_UNAVAILABLE 422,
 * ORDER_REFUSED 422, CHALLENGE_REQUIRED 428, RATE_LIMITED 429,
 * PROVIDER_UNAVAILABLE 503, LINK_UNAVAILABLE 503, UNAVAILABLE 503; since
 * 1.62.0 also FUNDING_OFF 403 and WITHDRAWAL_OPEN 409, from the funding
 * routes alone (`/api/predictions/funding/**`, not described here). `issues`
 * only on VALIDATION_ERROR (a body the schema refused, or an amount of zero)
 * and PLAN_INVALID; `siteKey` only on CHALLENGE_REQUIRED.
 */
export const PredictionsFailureSchema = z
  .object({
    error: z
      .object({
        code: z.enum(PREDICTION_FAILURE_CODES_V1),
        /** Ryntra's sentence — or, on a VALIDATION_ERROR or ORDER_REFUSED passed on from the provider, the provider's own message, cut to 1,000 characters. */
        message: z.string().min(1).max(1000),
        issues: PredIssues.optional(),
        /** The Cloudflare Turnstile site key the bot check is shown with; only on CHALLENGE_REQUIRED. */
        siteKey: PredTurnstileSiteKey.optional(),
      })
      .strict(),
  })
  .strict();
export type PredictionsFailure = z.infer<typeof PredictionsFailureSchema>;

/** Every error a prediction route can answer from JSON: the handler's own, or the wallet-proof refusal before it. */
export const PredictionsErrorSchema = z.union([PredictionsFailureSchema, ApiErrorSchema]);
export type PredictionsError = z.infer<typeof PredictionsErrorSchema>;

/** A provider failure carried inside a 200 answer (the paper account's `providerFailure`): the failure object whole, `ok: false` included. */
export const PredictionFailureValueSchema = z
  .object({
    ok: z.literal(false),
    code: z.enum(PREDICTION_FAILURE_CODES_V1),
    message: z.string().min(1).max(4000),
    issues: PredRawIssues.optional(),
    /** The wait the provider named on a RATE_LIMITED, in seconds. */
    retryAfterSeconds: z.number().positive().optional(),
    /** The bot check's site key on a CHALLENGE_REQUIRED. */
    siteKey: PredTurnstileSiteKey.optional(),
  })
  .strict();
export type PredictionFailureValueV1 = z.infer<typeof PredictionFailureValueSchema>;

/* ---- the market */

export const PredictionCategorySchema = z
  .object({
    id: PredId,
    /** The provider's slug (`crypto`, `politics`…) — what discover's `category` names. */
    slug: PredWord,
    name: PredText,
    eventCount: z.number(),
    volume24h: z.number(),
  })
  .strict();
export type PredictionCategoryV1 = z.infer<typeof PredictionCategorySchema>;

/** The venue's own resolution rules, verbatim; null where the source gives none. */
const PredRulesSchema = z.object({ primary: PredLongText.nullable(), secondary: PredLongText.nullable() }).strict();

export const PredictionOutcomeSchema = z
  .object({
    id: PredId,
    label: PredText,
    /** The venue's price of the outcome (the live midpoint where one was read; No as Yes's complement); null when the source gives none. */
    probability: PredProbability.nullable(),
    venueMarketId: PredId,
    winner: z.boolean().nullable(),
    /** The same outcome on the other venues of the matched cluster. */
    matched: z.array(z.object({ venueMarketId: PredId, outcomeId: PredId }).strict()).max(64),
  })
  .strict();
export type PredictionOutcomeV1 = z.infer<typeof PredictionOutcomeSchema>;

/** The same market on another venue of the matched cluster. */
export const PredictionVenueMarketSchema = z
  .object({
    id: PredId,
    venue: PredWord,
    question: PredText,
    status: z.enum(PREDICTION_MARKET_STATUSES_V1),
    outcomes: z.array(z.object({ id: PredId, label: PredText, probability: PredProbability.nullable(), winner: z.boolean().nullable() }).strict()).max(1024),
    volume: z.number().nullable(),
    description: PredLongText.nullable(),
    rules: PredRulesSchema,
  })
  .strict();
export type PredictionVenueMarketV1 = z.infer<typeof PredictionVenueMarketSchema>;

export const PredictionMarketSchema = z
  .object({
    id: PredId,
    venue: PredWord,
    question: PredText,
    status: z.enum(PREDICTION_MARKET_STATUSES_V1),
    /** Yes before No on a binary market, the rest in the venue's order. */
    outcomes: z.array(PredictionOutcomeSchema).max(1024),
    volume: z.number().nullable(),
    endDate: ProviderTime.nullable(),
    resolutionDate: ProviderTime.nullable(),
    description: PredLongText.nullable(),
    rules: PredRulesSchema,
    tickSize: z.number().nullable(),
    minOrderSize: z.number().nullable(),
    aggKey: PredWord.nullable(),
    /** The provider's cross-venue arbitrage return where it computes one. */
    arbReturn: z.number().nullable(),
    matched: z.array(PredictionVenueMarketSchema).max(64),
    image: PredLink.nullable(),
  })
  .strict();
export type PredictionMarketV1 = z.infer<typeof PredictionMarketSchema>;

/** How the venues of a cluster settle, and where they differ. */
export const PredictionSettlementSchema = z
  .object({
    sharedSummary: PredLongText,
    differences: z.array(z.object({ type: PredWord, title: PredText, summary: PredLongText.nullable(), perVenue: z.record(PredWord, PredLongText) }).strict()).max(256),
  })
  .strict();
export type PredictionSettlementV1 = z.infer<typeof PredictionSettlementSchema>;

const PredEventSummaryShape = {
  id: PredId,
  title: PredText,
  subtitle: PredText.nullable(),
  image: PredLink.nullable(),
  status: z.enum(PREDICTION_MARKET_STATUSES_V1),
  /** The anchor venue; `venues` every venue the cluster trades on (the anchor alone when the provider lists none). */
  venue: PredWord,
  venues: z.array(PredWord).min(1).max(64),
  volume: z.number().nullable(),
  endDate: ProviderTime.nullable(),
  categories: z.array(z.object({ id: PredId, slug: PredWord, name: PredText }).strict()).max(256),
  /** The markets counted where they were read; the provider's count when the read carried none. */
  marketCount: z.number(),
  aggKey: PredWord.nullable(),
  structureType: PredWord.nullable(),
  arbReturn: z.number().nullable(),
  /** The first market's outcomes with their last price — the card's leading figures. */
  leading: z.array(z.object({ id: PredId, label: PredText, probability: PredProbability.nullable(), venueMarketId: PredId }).strict()).max(1024),
  /** The first market's question when the event holds more than one market — what the leading figures are the odds of; null otherwise. */
  leadingQuestion: PredText.nullable().optional(),
  /** The provider's series cadence as an ISO-8601 duration (`PT5M`, `PT1H`, `P1D`…); null for a one-off event. */
  recurrence: PredWord.nullable().optional(),
  /** The provider's sport slug (`basketball`, `soccer`…); null for an event that is not a game. */
  sport: PredWord.nullable().optional(),
  /** The game's scheduled start, for a sports event; its markets may keep trading during play. */
  gameStartTime: ProviderTime.nullable().optional(),
} as const;

/** An event as a list shows it. Lists leave out an event whose end passed more than two days ago. */
export const PredictionEventSummarySchema = z.object(PredEventSummaryShape).strict();
export type PredictionEventSummaryV1 = z.infer<typeof PredictionEventSummarySchema>;

/** One event whole: its markets across venues (at most fifty asked, the largest first), live midpoints, rules and settlement differences. */
export const PredictionEventSchema = z
  .object({
    ...PredEventSummaryShape,
    description: PredLongText.nullable(),
    startDate: ProviderTime.nullable(),
    markets: z.array(PredictionMarketSchema).max(500),
    settlement: PredictionSettlementSchema.nullable(),
  })
  .strict();
export type PredictionEventV1 = z.infer<typeof PredictionEventSchema>;

/* ---- books, prices, charts */

/** A price level with its size, and the size per venue behind it. */
export const PredictionBookLevelSchema = z.object({ price: z.number(), size: z.number(), venues: z.record(PredWord, z.number()) }).strict();
export type PredictionBookLevelV1 = z.infer<typeof PredictionBookLevelSchema>;

export const PredictionVenueBookSchema = z
  .object({
    venue: PredWord,
    venueMarketId: PredId,
    tickSize: z.number().nullable(),
    bids: z.array(PredictionBookLevelSchema).max(4096),
    asks: z.array(PredictionBookLevelSchema).max(4096),
  })
  .strict();
export type PredictionVenueBookV1 = z.infer<typeof PredictionVenueBookSchema>;

export const PredictionBookSchema = z
  .object({
    venueMarketId: PredId,
    /** The provider's state of the book: `ok`, or why not (`market_resolved`, `book_not_loaded`…). */
    status: PredWord,
    /** The provider's error for the book, as JSON text; null when none. */
    error: PredText.nullable(),
    requested: z.object({ venue: PredWord, marketStatus: PredWord.nullable(), tickSize: z.number().nullable() }).strict().nullable(),
    venues: z.array(PredictionVenueBookSchema).max(64),
    matched: z.array(z.object({ venue: PredWord, venueMarketId: PredId, hasOrderbook: z.boolean() }).strict()).max(64),
    /** The best levels across venues, merged per price here: bids descending, asks ascending. */
    aggregated: z.object({ bids: z.array(PredictionBookLevelSchema).max(4096), asks: z.array(PredictionBookLevelSchema).max(4096) }).strict(),
    readAt: Iso,
  })
  .strict();
export type PredictionBookV1 = z.infer<typeof PredictionBookSchema>;

/** One bar as the provider states it: `t` the open time in Unix milliseconds, prices 0–1, `v` null when unavailable. */
export const PredictionBarSchema = z.object({ t: z.number(), o: z.number(), h: z.number(), l: z.number(), c: z.number(), v: z.number().nullable() }).strict();

export const PredictionChartSchema = z
  .object({
    outcomeId: PredId,
    venue: PredWord,
    resolution: z.enum(PREDICTION_CHART_RESOLUTIONS_V1),
    /** Oldest first; the route asks for at most 500. */
    bars: z.array(PredictionBarSchema).max(5000),
    staleSeconds: z.number().nullable(),
    /** The newest bar's open time, Unix milliseconds. */
    lastBarAt: z.number().nullable(),
  })
  .strict();
export type PredictionChartV1 = z.infer<typeof PredictionChartSchema>;

export const PredictionVenuePriceSchema = z
  .object({
    venue: PredWord,
    venueMarketId: PredId,
    midpoint: PredProbability.nullable(),
    spread: z.number().nullable(),
    bestBid: PredProbability.nullable(),
    bestAsk: PredProbability.nullable(),
    /** The provider's time of the price, as it states it. */
    timestamp: z.number().nullable(),
  })
  .strict();
export type PredictionVenuePriceV1 = z.infer<typeof PredictionVenuePriceSchema>;

/** The live prices of one market: its own midpoint, each outcome's, and every venue's — its own first. */
export const PredictionMarketPricesSchema = z
  .object({
    venueMarketId: PredId,
    venue: PredWord,
    midpoint: PredProbability.nullable(),
    spread: z.number().nullable(),
    timestamp: z.number().nullable(),
    arbReturn: z.number().nullable(),
    marketStatus: PredWord.nullable(),
    /** The provider's refusal for this market (`market_resolved`, `market_not_found`); its prices are null then. */
    error: PredWord.nullable(),
    outcomes: z
      .array(z.object({ outcomeId: PredId, label: PredText, midpoint: PredProbability.nullable(), bestBid: PredProbability.nullable(), bestAsk: PredProbability.nullable() }).strict())
      .max(1024),
    venues: z.array(PredictionVenuePriceSchema).min(1).max(64),
  })
  .strict();
export type PredictionMarketPricesV1 = z.infer<typeof PredictionMarketPricesSchema>;

/* ---- research and the engine */

export const PredictionSignalSchema = z.object({ id: PredId, text: PredText, side: PredWord, direction: PredWord, domain: PredWord }).strict();

/** The provider's generated signals for a market, with the model and prompt version it names: advisory content, never evidence. */
export const PredictionSignalsSchema = z
  .object({
    signals: z.array(PredictionSignalSchema).max(1000),
    sourceModel: PredWord,
    promptVersion: z.union([PredWord, z.number()]),
    createdAt: ProviderTime,
  })
  .strict();
export type PredictionSignalsV1 = z.infer<typeof PredictionSignalsSchema>;

export const PredictionRelatedMarketSchema = z
  .object({
    score: z.number(),
    venue: PredWord,
    venueMarketId: PredId,
    venueEventId: PredId.nullable(),
    marketQuestion: PredText,
    eventTitle: PredText,
    matchSource: PredWord,
    matchedSignal: PredText.nullable(),
  })
  .strict();
export type PredictionRelatedMarketV1 = z.infer<typeof PredictionRelatedMarketSchema>;

/** The provider's ripple candidates: events that move with this market (`expand`) or against it (`hedge`). */
export const PredictionRippleSchema = z
  .object({
    mode: z.enum(["expand", "hedge"]),
    items: z
      .array(z.object({ eventId: PredId, title: PredText, status: PredWord, score: z.number(), action: PredText, reason: PredText, domain: PredWord, endDate: ProviderTime.nullable() }).strict())
      .max(100),
  })
  .strict();
export type PredictionRippleV1 = z.infer<typeof PredictionRippleSchema>;

/** One article; `title`, `source` and `summary` are empty strings when the provider gave none. */
export const PredictionNewsArticleSchema = z
  .object({ title: PredText, source: PredText, publishedAt: ProviderTime.nullable(), url: PredLink.min(1).nullable(), summary: PredText })
  .strict();

export const PredictionNewsSchema = z
  .object({ window: PredText.nullable(), query: PredText.nullable(), articles: z.array(PredictionNewsArticleSchema).max(100) })
  .strict();
export type PredictionNewsV1 = z.infer<typeof PredictionNewsSchema>;

export const PredictionEngineStateSchema = z
  .object({
    /** The app's trading mode at the provider (`paper`); `unknown` when it states none. */
    tradingMode: PredWord,
    paperStartingBalance: z.number().nullable(),
    disabledVenues: z.array(PredWord).max(64),
    /** The signal engine's coverage; null when the provider did not answer it. */
    signals: z.object({ marketsProcessed: z.number(), marketsTotal: z.number(), coveragePct: z.number(), total: z.number() }).strict().nullable(),
  })
  .strict();
export type PredictionEngineStateV1 = z.infer<typeof PredictionEngineStateSchema>;

/* ---- the Prediction Plan (the web's `plan-model.ts`, re-stated) */

const PredUsd = z.number().finite().positive().max(1_000_000);
const PredPlanProbability = z.number().finite().min(0.001).max(0.999);
const PredNote = z.string().max(240);

/** A monitoring condition: `probability` crosses `threshold` (0–1) in `direction`; `volume24h` moves by `threshold` %; `resolution` fires `threshold` hours before the end; `signal` and `plan` take no threshold. */
export const PredictionMonitorConditionSchema = z
  .object({
    metric: z.enum(PREDICTION_MONITOR_METRICS_V1),
    direction: z.enum(["above", "below", "any"]),
    threshold: z.number().finite().nullable(),
    note: PredNote.nullable(),
  })
  .strict();
export type PredictionMonitorConditionV1 = z.infer<typeof PredictionMonitorConditionSchema>;

/**
 * A plan's rules in the three steps — why (the thesis and the outcome), risk
 * and money (the amount is the whole principal at risk), conditions. The
 * server refuses, as PLAN_INVALID with `issues`, a bound below the entry
 * probability, an invalidation at or above it, a deadline already past, and
 * a monitoring condition missing its threshold.
 */
export const PredictionPlanRulesSchema = z
  .object({
    thesis: z.string().min(1).max(2000),
    whyNow: z.string().max(500).nullable(),
    eventId: z.string().min(1).max(64),
    eventTitle: z.string().min(1).max(300),
    venueMarketId: z.string().min(1).max(64),
    question: z.string().min(1).max(300),
    outcomeId: z.string().min(1).max(64),
    outcomeLabel: z.string().min(1).max(64),
    amountUsd: PredUsd,
    entryProbability: PredPlanProbability,
    /** The Review refuses a quote whose average probability is above it; null: reported, never refused. */
    maxProbability: PredPlanProbability.nullable(),
    invalidation: z.object({ text: z.string().min(1).max(500), probabilityBelow: PredPlanProbability.nullable() }).strict(),
    resolutionDeadline: Iso.nullable(),
    monitoring: z.array(PredictionMonitorConditionSchema).max(8),
    references: z.array(z.string().url().max(512)).max(10),
    assumptions: z.array(z.string().min(1).max(240)).max(10),
  })
  .strict();
export type PredictionPlanRulesV1 = z.infer<typeof PredictionPlanRulesSchema>;

/**
 * What the rules imply, computed by the server. `maxLossUsd` is the amount
 * rounded to cents, so a plan of under half a cent sizes to 0 — the web's
 * own schema says positive, the stored value does not.
 */
export const PredictionPlanSizingSchema = z
  .object({
    model: z.literal("prediction-long-v1"),
    sharesAtEntry: z.number().finite().min(0),
    maxLossUsd: z.number().finite().min(0).max(1_000_000),
    payoutIfRightUsd: z.number().finite().min(0),
    profitIfRightUsd: z.number().finite(),
    returnIfRightPct: z.number().finite(),
    breakEvenProbability: PredPlanProbability,
  })
  .strict();
export type PredictionPlanSizingV1 = z.infer<typeof PredictionPlanSizingSchema>;

export const PredictionPlanVersionSchema = z
  .object({ version: z.number().int().min(1), createdAt: Iso, reason: PredNote.nullable(), rules: PredictionPlanRulesSchema, sizing: PredictionPlanSizingSchema })
  .strict();
export type PredictionPlanVersionV1 = z.infer<typeof PredictionPlanVersionSchema>;

export const PredictionPlanJournalSchema = z
  .object({
    at: Iso,
    kind: z.enum(["created", "edited", "activated", "cancelled", "expired", "reviewed", "executed", "note"]),
    version: z.number().int().min(1),
    /** The person's note; on `reviewed` and `executed`, the paper order's state. */
    note: PredNote.nullable(),
    /** On `reviewed` and `executed`, the provider's quote id. */
    ref: PredId.nullable(),
  })
  .strict();
export type PredictionPlanJournalEntryV1 = z.infer<typeof PredictionPlanJournalSchema>;

/** A Prediction Plan, versioned: an edit is a new version, a status change a journal entry. */
export const PredictionPlanSchema = z
  .object({
    id: PredictionPlanIdSchema,
    kind: z.literal("prediction"),
    owner: PredictionWalletAddress,
    /** Also `expired` when read: a draft or active plan whose resolution deadline passed reads as expired; the stored row is not rewritten. */
    status: z.enum(PREDICTION_PLAN_STATUSES_V1),
    createdAt: Iso,
    updatedAt: Iso,
    version: z.number().int().min(1),
    current: PredictionPlanVersionSchema,
    versions: z.array(z.object({ version: z.number().int().min(1), createdAt: Iso, reason: PredNote.nullable() }).strict()).max(50),
    journal: z.array(PredictionPlanJournalSchema).max(100),
    /** The paper orders placed under the plan, by the provider's quote id; `state` is the order's (`reviewed`, `submitted`, `filled`…). */
    executions: z.array(z.object({ quoteId: PredId, at: Iso, state: z.string().max(64) }).strict()).max(50),
  })
  .strict();
export type PredictionPlanV1 = z.infer<typeof PredictionPlanSchema>;

/* ---- the paper account */

export const PredictionPaperBalanceSchema = z
  .object({ startingBalance: z.number(), cashBalance: z.number(), positionsValue: z.number(), realizedPnl: z.number(), unrealizedPnl: z.number(), earnings: z.number() })
  .strict();
export type PredictionPaperBalance = z.infer<typeof PredictionPaperBalanceSchema>;

/** A paper position as the provider states it. */
export const PredictionPaperPositionSchema = z
  .object({
    eventId: PredId.nullable(),
    venueEventId: PredId,
    question: PredText,
    image: PredLink.nullable(),
    marketStatus: PredWord,
    status: z.enum(["active", "closed"]),
    redeemStatus: PredWord,
    resolutionDate: ProviderTime.nullable(),
    outcomes: z
      .array(
        z
          .object({
            label: PredText,
            totalSize: z.number(),
            avgEntryPrice: z.number(),
            currentPrice: z.number(),
            totalValue: z.number(),
            unrealizedPnl: z.number(),
            unrealizedPnlPercent: z.number(),
            winner: z.boolean().nullable(),
            venues: z.array(z.object({ venue: PredWord, size: z.number(), venueMarketId: PredId, outcomeId: PredId }).strict()).max(64),
          })
          .strict(),
      )
      .max(1024),
  })
  .strict();
export type PredictionPaperPosition = z.infer<typeof PredictionPaperPositionSchema>;

/** A paper order row as the provider states it; the USD and share figures are its 6-decimal raw amounts divided out. */
export const PredictionPaperOrderSchema = z
  .object({
    id: PredId,
    quoteId: PredId.nullable(),
    status: PredWord,
    venue: PredWord,
    side: PredWord,
    /** The provider's time — ISO where it sent a date object, verbatim where it sent text — or an empty string when it sent none. */
    createdAt: z.string().max(64),
    updatedAt: z.string().max(64),
    amountUsd: z.number().nullable(),
    filledUsd: z.number().nullable(),
    quotedPrice: z.number().nullable(),
    executionPrice: z.number().nullable(),
    quotedShares: z.number().nullable(),
    actualShares: z.number().nullable(),
    quotedToWin: z.number().nullable(),
    actualToWin: z.number().nullable(),
    partialFillReason: PredText.nullable(),
    error: PredText.nullable(),
    question: PredText.nullable(),
    venueEventId: PredId.nullable(),
    outcomeLabel: PredText.nullable(),
  })
  .strict();
export type PredictionPaperOrder = z.infer<typeof PredictionPaperOrderSchema>;

/** The provider's execution of a paper order, as last read. */
export const PredictionPaperExecutionSchema = z
  .object({
    quoteId: PredId,
    executionId: PredId.nullable(),
    orderIds: z.array(PredId).max(256),
    /** The provider's overall state (`placing`, `filled`, `partially_filled`, `failed`, `cancelled`, `expired`…). */
    state: PredWord,
    terminal: z.boolean(),
    error: PredText.nullable(),
    pollAfterMs: z.number().nullable(),
    steps: z.array(z.object({ label: PredText, kind: PredWord, status: PredWord, error: PredText.nullable() }).strict()).max(256),
    orders: z
      .array(
        z
          .object({
            orderId: PredId,
            venue: PredWord,
            status: PredWord,
            event: PredWord.nullable(),
            filledUsd: z.number().nullable(),
            actualShares: z.number().nullable(),
            executionPrice: z.number().nullable(),
            error: PredText.nullable(),
          })
          .strict(),
      )
      .max(256),
  })
  .strict();
export type PredictionPaperExecution = z.infer<typeof PredictionPaperExecutionSchema>;

export const PredictionRouteFillSchema = z
  .object({
    venue: PredWord,
    chain: PredWord,
    avgPrice: z.number(),
    shares: z.number(),
    fees: z.object({ venue: z.number().nullable(), builder: z.number().nullable(), settlement: z.number().nullable() }).strict(),
  })
  .strict();

/** The route's own cost breakdown in USD, as the provider states it; `appFeeUsd` null when no partner fee is configured, `setupUsd` null when the quote did not estimate one-time setup. */
const PredictionRouteCostsSchema = z
  .object({
    contractsUsd: z.number(),
    venueFeesUsd: z.number(),
    builderFeeUsd: z.number(),
    bridgeUsd: z.number(),
    gasUsd: z.number(),
    appFeeUsd: z.number().nullable(),
    appFeeBips: z.number().nullable(),
    referralUsd: z.number().nullable(),
    setupUsd: z.number().nullable(),
    totalUsd: z.number(),
  })
  .strict();

/** One venue's own quote for the same order: what it alone would fill, and its own total without a partner fee (null when it states none). */
const PredictionSoloQuoteSchema = z
  .object({
    venue: PredWord,
    status: PredWord,
    shares: z.number(),
    avgPrice: z.number().nullable(),
    directCostUsd: z.number().nullable(),
    unavailableReason: PredText.nullable(),
    /** The price levels the venue's own quote fills, with the contracts taken at each; absent on a quote stored before they were kept. */
    levels: z.array(z.object({ price: z.number(), qty: z.number() }).strict()).max(1024).optional(),
  })
  .strict();

/** The provider's smart route for a paper order, priced for the wallet's own session. */
export const PredictionRouteSchema = z
  .object({
    quoteId: PredId,
    /** `ok`, or the provider's reason it cannot route (`insufficient_depth`, `insufficient_balance`…). */
    status: PredWord,
    side: z.enum(["buy", "sell"]),
    outcomeId: PredId,
    venueMarketId: PredId,
    /** USD to spend on a buy, shares on a sell. */
    requested: z.number(),
    shares: z.number(),
    costUsd: z.number(),
    totalCostIncFeesUsd: z.number().nullable(),
    /** Cost over shares — the probability the route buys at; null when it fills nothing. */
    avgProbability: z.number().nullable(),
    estimatedPayoutUsd: z.number().nullable(),
    estimatedProfitUsd: z.number().nullable(),
    returnPct: z.number().nullable(),
    fees: z.object({ venue: z.number(), builder: z.number(), settlement: z.number(), app: z.number().nullable() }).strict(),
    fills: z.array(PredictionRouteFillSchema).max(256),
    /** Each venue's own quote: its scalar fields as the provider names them. */
    venueSolo: z.array(z.object({ venue: PredWord, fields: z.record(PredWord, z.union([PredText, z.number(), z.boolean(), z.null()])) }).strict()).max(64),
    /** The route's cost breakdown; null when the provider stated none, absent on a route stored before it was kept. */
    costs: PredictionRouteCostsSchema.nullable().optional(),
    /** Each venue's own quote for the same order; absent on a route stored before it was kept. */
    solos: z.array(PredictionSoloQuoteSchema).max(64).optional(),
    warnings: z.array(z.object({ venue: PredWord, reason: PredText }).strict()).max(256),
    matchedMarkets: z.array(z.object({ venue: PredWord, venueMarketId: PredId }).strict()).max(64),
    expiresAt: ProviderTime,
    refreshAt: ProviderTime,
    solveMs: z.number(),
    verifyMs: z.number(),
    error: PredText.nullable(),
    /** When Ryntra asked for the route. */
    quotedAt: Iso,
  })
  .strict();
export type PredictionRouteV1 = z.infer<typeof PredictionRouteSchema>;

/**
 * One check of the Review. Ids: `mode`, `route`, `fill`, `quote_age`,
 * `amount`, `balance`, `market`, `outcome`, `resolution`, `route_warning`,
 * `price_move`; a plan's: `status`, `outcome`, `amount`, `max_probability`,
 * `invalidation`, `deadline`. `detail` is written once, in the quote's
 * language, and can quote the provider's own reason.
 */
export const PredictionReviewCheckSchema = z
  .object({ id: z.string().max(64), state: z.enum(["pass", "warn", "fail"]), detail: PredText, figure: PredText.nullable().optional() })
  .strict();
export type PredictionReviewCheck = z.infer<typeof PredictionReviewCheckSchema>;

/**
 * The Review of a paper order: the event, the market and outcome, the route,
 * the figures (a buy's whole total is the principal at risk), the quote's
 * age, the balance, every check, and the plan's conditions. `canPlace` is
 * false exactly when `blockedBy` names a refusing check (`plan:<id>` for a
 * plan's); warnings leave the decision to the person.
 */
export const PredictionPaperReviewSchema = z
  .object({
    /** `live` — real USDC from the managed account, reviewed only where live trading is open to the wallet; `paper` — simulated. */
    mode: z.enum(["paper", "live"]),
    quoteId: PredId,
    event: z.object({ id: PredId, title: PredText, endDate: ProviderTime.nullable() }).strict(),
    /** The market reviewed; the event's title and venue with null dates and rules when the market is no longer in the event. */
    market: z.object({ id: PredId, question: PredText, venue: PredWord, resolutionDate: ProviderTime.nullable(), rules: PredRulesSchema }).strict(),
    /** `label` is `—` when the outcome is no longer in the market. */
    outcome: z.object({ id: PredictionRouteIdSchema, label: PredText }).strict(),
    side: z.enum(["buy", "sell"]),
    requested: z.number().positive().max(1_000_000),
    route: PredictionRouteSchema,
    figures: z
      .object({
        probability: z.number().nullable(),
        shares: z.number(),
        costUsd: z.number(),
        feesUsd: z.number(),
        totalUsd: z.number(),
        payoutIfRightUsd: z.number(),
        profitIfRightUsd: z.number(),
        /** The whole total on a buy; 0 on a sell. */
        maxLossUsd: z.number(),
        returnIfRightPct: z.number().nullable(),
      })
      .strict(),
    /**
     * A buy's cost line by line (`contracts`, `venue`, `ryntra`, `gas`, `bridge`, `setup`; a line the route does not state is null),
     * Ryntra's fee (`charged` false when the Review states it and nothing takes it), the total the order takes, and `saving` against
     * the least the same contracts cost on one venue alone (its own levels, before its fees) after Ryntra's fee — null unless it is a cent or more. Null on a sell; absent on a Review stored before it was kept.
     */
    costs: z
      .object({
        lines: z.array(z.object({ id: z.enum(["contracts", "venue", "ryntra", "gas", "bridge", "setup", "referral"]), usd: z.number().nullable() }).strict()).max(8),
        ryntra: z.object({ bips: z.number().int().min(0).max(10_000), usd: z.number().min(0), charged: z.boolean() }).strict(),
        totalUsd: z.number(),
        saving: z.object({ usd: z.number().positive(), venue: PredWord, venueCostUsd: z.number() }).strict().nullable(),
      })
      .strict()
      .nullable()
      .optional(),
    /** `expired` past the provider's expiry or at 90 seconds, whichever comes first. */
    quote: z.object({ quotedAt: Iso, expiresAt: ProviderTime, ageSeconds: z.number().int().min(0), expired: z.boolean() }).strict(),
    venues: z.array(PredWord).max(256),
    settlement: PredictionSettlementSchema.nullable(),
    balance: PredictionPaperBalanceSchema.nullable(),
    checks: z.array(PredictionReviewCheckSchema).max(512),
    warnings: z.array(PredText).max(512),
    plan: z.object({ id: PredictionPlanIdSchema, version: z.number().int().min(1), checks: z.array(PredictionReviewCheckSchema).max(16) }).strict().nullable(),
    canPlace: z.boolean(),
    blockedBy: z.array(z.string().max(64)).max(64),
  })
  .strict();
export type PredictionPaperReview = z.infer<typeof PredictionPaperReviewSchema>;

/**
 * Ryntra's record of one paper order, keyed by the quote: the Review as
 * written, and the provider's execution and order rows as last reconciled —
 * the provider's ledger is the truth, the record follows it.
 */
export const PredictionOrderRecordSchema = z
  .object({
    version: z.number().int().min(1),
    wallet: PredictionWalletAddress,
    quoteId: PredId,
    eventId: PredId,
    eventTitle: PredText,
    venueMarketId: PredId,
    question: PredText,
    outcomeId: PredictionRouteIdSchema,
    outcomeLabel: PredText,
    side: z.enum(["buy", "sell"]),
    requested: z.number().positive().max(1_000_000),
    review: PredictionPaperReviewSchema,
    planId: PredictionPlanIdSchema.nullable(),
    planVersion: z.number().int().min(1).nullable(),
    state: z.enum(PREDICTION_ORDER_STATES_V1),
    providerOrderIds: z.array(PredId).max(256),
    execution: PredictionPaperExecutionSchema.nullable(),
    providerOrders: z.array(PredictionPaperOrderSchema).max(1000),
    submittedAt: Iso.nullable(),
    settledAt: Iso.nullable(),
    createdAt: Iso,
    updatedAt: Iso,
  })
  .strict();
export type PredictionOrderRecordV1 = z.infer<typeof PredictionOrderRecordSchema>;

/* ---- the link and the watchlist */

export const PredictionLinkStatusSchema = z
  .object({
    state: z.enum(PREDICTION_LINK_STATES_V1),
    externalIdLinked: z.boolean(),
    /** Why the Ryntra id is not linked at the provider yet: `signing_key_missing`, `signing_key_invalid`, `provider_kept_other_id` or `provider_refused:<code>`. */
    linkError: z.string().max(64).nullable(),
    providerUserId: PredId.nullable(),
    since: Iso.nullable(),
    refreshedAt: Iso.nullable(),
    /** Whether this deployment can hold a link at all; `unavailableReason` says why not (`no_session_secret`, `store_not_durable`). */
    available: z.boolean(),
    unavailableReason: z.string().max(64).nullable(),
  })
  .strict();
export type PredictionLinkStatus = z.infer<typeof PredictionLinkStatusSchema>;

/** Step one of the link: the sign-in message the wallet signs exactly as given — the provider's nonce, this site, the proven wallet. */
export const PredictionLinkChallengeSchema = z
  .object({
    /** The verify route accepts at most 4,096 characters of it. */
    message: z.string().min(1).max(8192),
    nonce: PredWord,
    /** Ryntra's sentence the wallet shows, in the request's language. */
    statement: PredText.nullable(),
    wallet: PredictionWalletAddress,
  })
  .strict();
export type PredictionLinkChallenge = z.infer<typeof PredictionLinkChallengeSchema>;

/** One watched event, newest first; `probabilityAtWatch` is the leading probability the client sent at that moment. */
export const PredictionWatchEntrySchema = z
  .object({
    eventId: PredictionRouteIdSchema,
    watchedAt: Iso,
    venueMarketId: PredictionRouteIdSchema.nullable(),
    outcomeLabel: z.string().max(64).nullable(),
    probabilityAtWatch: z.number().min(0).max(1).nullable(),
  })
  .strict();
export type PredictionWatchEntry = z.infer<typeof PredictionWatchEntrySchema>;

/* ---- the queries (URL parameters; the routes normalize rather than refuse, as each field says) */

/** `GET /api/predictions/discover` parameters. */
export const PredictionsDiscoverQuerySchema = z
  .object({
    /** A text search, trimmed; over 200 characters is a VALIDATION_ERROR. With `q`, the provider is asked for at most 30 events (`limit` capped at 30) and `category`, `sort` and `cursor` are not used. */
    q: z.string().max(200).optional(),
    /** A category's `slug`; one the provider does not have answers no events. */
    category: z.string().max(16_384).optional(),
    /** Default `volume24h`; any other value reads as the default. `ending`: the soonest-ending of the fifty largest open events, one page. */
    sort: z.enum(PREDICTION_DISCOVER_SORTS_V1).optional(),
    /** Default 24; clamped to 1–50, a non-number reads as 24. */
    limit: z.number().int().min(1).max(50).optional(),
    /** The previous answer's `nextCursor`. */
    cursor: z.string().max(4096).optional(),
  })
  .strict();
export type PredictionsDiscoverQuery = z.infer<typeof PredictionsDiscoverQuerySchema>;

/** `GET /api/predictions/events` parameters. */
export const PredictionsEventsQuerySchema = z
  .object({
    /** Event ids, comma-separated; the first 40 that match `PredictionRouteIdSchema` are read, the rest dropped; none is a VALIDATION_ERROR. */
    ids: z.string().regex(/^[A-Za-z0-9_-]{1,64}(,[A-Za-z0-9_-]{1,64}){0,39}$/),
  })
  .strict();
export type PredictionsEventsQuery = z.infer<typeof PredictionsEventsQuerySchema>;

/** `GET /api/predictions/markets/{id}/book` parameters. */
export const PredictionsBookQuerySchema = z
  .object({
    /** Levels per side per venue; default 10, clamped to 1–50. */
    depth: z.number().int().min(1).max(50).optional(),
  })
  .strict();
export type PredictionsBookQuery = z.infer<typeof PredictionsBookQuerySchema>;

/** `GET /api/predictions/markets/{id}/prices` parameters. */
export const PredictionsPricesQuerySchema = z
  .object({
    /** More market ids, comma-separated, read in the same batch; the first 20 that match `PredictionRouteIdSchema`. */
    also: z.string().regex(/^[A-Za-z0-9_-]{1,64}(,[A-Za-z0-9_-]{1,64}){0,19}$/).optional(),
  })
  .strict();
export type PredictionsPricesQuery = z.infer<typeof PredictionsPricesQuerySchema>;

/** `GET /api/predictions/markets/{id}/research` parameters. */
export const PredictionsResearchQuerySchema = z
  .object({
    /** The market's question, for the related markets; trimmed and cut to 300 characters. Without it `related` is an empty list. */
    text: z.string().max(300).optional(),
  })
  .strict();
export type PredictionsResearchQuery = z.infer<typeof PredictionsResearchQuerySchema>;

/** `GET /api/predictions/outcomes/{id}/chart` parameters. */
export const PredictionsChartQuerySchema = z
  .object({
    /** Default `1h`; any other value reads as the default. */
    resolution: z.enum(PREDICTION_CHART_RESOLUTIONS_V1).optional(),
    /** Bars back from now; default 96, clamped to 2–500. */
    countBack: z.number().int().min(2).max(500).optional(),
  })
  .strict();
export type PredictionsChartQuery = z.infer<typeof PredictionsChartQuerySchema>;

/* ---- the request bodies (the routes' own validators, re-stated) */

/** `POST /api/predictions/link/verify` (at most 16 KB). */
export const PredictionsLinkVerifyRequestSchema = z
  .object({
    /** The challenge's `message`, exactly as signed. */
    message: z.string().min(40).max(4096),
    /** The wallet's signature over it: a Solana wallet's 64 bytes as base64 (the default), or base58 with `encoding: "base58"`; an EVM wallet's 65 bytes as 0x-prefixed hex with `encoding: "hex"`. */
    signature: z.string().min(16).max(512),
    encoding: z.enum(["base64", "base58", "hex"]).optional(),
  })
  .strict();
export type PredictionsLinkVerifyRequest = z.infer<typeof PredictionsLinkVerifyRequestSchema>;

/** `POST /api/predictions/quote` (at most 16 KB). A buy names `spendUsd`, a sell `sellShares`; the one the side needs missing is a VALIDATION_ERROR naming it. */
export const PredictionsQuoteRequestSchema = z
  .object({
    eventId: PredictionRouteIdSchema,
    venueMarketId: PredictionRouteIdSchema,
    outcomeId: PredictionRouteIdSchema,
    side: z.enum(["buy", "sell"]),
    spendUsd: z.number().finite().positive().max(10_000).optional(),
    sellShares: z.number().finite().positive().max(1_000_000).optional(),
    /** The plan whose conditions the Review judges. */
    planId: PredictionPlanIdSchema.nullable().optional(),
    /** The language the Review's sentences are written in, once; default `en`. */
    locale: z.enum(["en", "uk"]).optional(),
    /** `live` asks for a real-money Review; refused (FORBIDDEN) where live trading is not open to the wallet. Default `paper`. */
    mode: z.enum(["paper", "live"]).optional(),
  })
  .strict();
export type PredictionsQuoteRequest = z.infer<typeof PredictionsQuoteRequestSchema>;

/** `POST /api/predictions/orders` (at most 16 KB): place the paper order the quote's Review allowed. */
export const PredictionsOrdersRequestSchema = z.object({ quoteId: PredictionRouteIdSchema }).strict();
export type PredictionsOrdersRequest = z.infer<typeof PredictionsOrdersRequestSchema>;

/** `POST /api/predictions/plans` (at most 32 KB). */
export const PredictionsPlansRequestSchema = z.object({ rules: PredictionPlanRulesSchema, activate: z.boolean().optional() }).strict();
export type PredictionsPlansRequest = z.infer<typeof PredictionsPlansRequestSchema>;

/** `PATCH /api/predictions/plans/{id}` (at most 32 KB): a new version; `version` is the one the client read. */
export const PredictionsPlanRequestSchema = z.object({ version: z.number().int().min(1), rules: PredictionPlanRulesSchema, reason: PredNote.nullable().optional() }).strict();
export type PredictionsPlanRequest = z.infer<typeof PredictionsPlanRequestSchema>;

/** `POST /api/predictions/plans/{id}/status` (at most 16 KB): activate a draft or cancel a plan. */
export const PredictionsPlanStatusRequestSchema = z
  .object({ version: z.number().int().min(1), status: z.enum(["active", "cancelled"]), note: PredNote.nullable().optional() })
  .strict();
export type PredictionsPlanStatusRequest = z.infer<typeof PredictionsPlanStatusRequestSchema>;

/** `PUT /api/predictions/watchlist` (at most 16 KB): watch or unwatch one event. */
export const PredictionsWatchlistRequestSchema = z
  .object({
    eventId: PredictionRouteIdSchema,
    watched: z.boolean(),
    venueMarketId: PredictionRouteIdSchema.nullable().optional(),
    outcomeLabel: z.string().max(64).nullable().optional(),
    probabilityAtWatch: z.number().finite().min(0).max(1).nullable().optional(),
  })
  .strict();
export type PredictionsWatchlistRequest = z.infer<typeof PredictionsWatchlistRequestSchema>;

/* ---- the answers */

/**
 * `GET /api/predictions/discover` — public; with a wallet proof it also
 * names the wallet and every event id it watches. The provider's top-level
 * categories (`categoriesUnavailable` when they could not be read; the
 * events answer anyway), and a page of open events by category and sort or
 * a text search, with the leading probabilities read live. Fails with
 * VALIDATION_ERROR 400 (`q` over 200 characters) or the provider's failure
 * of the list (RATE_LIMITED 429, SESSION_EXPIRED 401, FORBIDDEN 403,
 * NOT_FOUND 404, VALIDATION_ERROR 400, PROVIDER_UNAVAILABLE 503).
 */
export const PredictionsDiscoverResponseSchema = z
  .object({
    categories: z.array(PredictionCategorySchema).max(1000),
    categoriesUnavailable: z.boolean(),
    /** The query as read: `q` trimmed, the category as sent, the sort, and the limit clamped to 1–50 but not rounded. */
    query: z
      .object({
        q: z.string().min(1).max(200).nullable(),
        category: z.string().min(1).max(16_384).nullable(),
        sort: z.enum(PREDICTION_DISCOVER_SORTS_V1),
        limit: z.number().min(1).max(50),
      })
      .strict(),
    events: z.array(PredictionEventSummarySchema).max(500),
    /** Null on the last page, on a search and on `ending`. */
    nextCursor: z.string().max(4096).nullable(),
    readAt: Iso,
    /** Every event id the wallet watches, on this page or not; empty without a wallet proof. */
    watched: z.array(PredictionRouteIdSchema).max(100),
    wallet: PredictionWalletAddress.nullable(),
  })
  .strict();
export type PredictionsDiscoverResponse = z.infer<typeof PredictionsDiscoverResponseSchema>;

/**
 * `GET /api/predictions/engine` — public. The provider's operational state:
 * the app's trading mode, the paper starting balance, the venues switched
 * off, the signal engine's coverage. Fails with the provider's failure.
 */
export const PredictionsEngineResponseSchema = z.object({ engine: PredictionEngineStateSchema, readAt: Iso }).strict();
export type PredictionsEngineResponse = z.infer<typeof PredictionsEngineResponseSchema>;

/**
 * `GET /api/predictions/events?ids=` — public. Several events as list
 * summaries (the watchlist's, the plans'); an id the provider no longer has
 * or whose event ended over two days ago is dropped, never invented. Fails
 * with VALIDATION_ERROR 400 (no valid id) or the provider's failure.
 */
export const PredictionsEventsResponseSchema = z.object({ events: z.array(PredictionEventSummarySchema).max(40), readAt: Iso }).strict();
export type PredictionsEventsResponse = z.infer<typeof PredictionsEventsResponseSchema>;

/**
 * `GET /api/predictions/events/{id}` — public; with a wallet proof, `watch`
 * is the wallet's entry for the event (null when not watched) and `wallet`
 * is set. Fails with VALIDATION_ERROR 400 (not an event id) or the
 * provider's failure (NOT_FOUND 404 for an event it does not have).
 */
export const PredictionsEventResponseSchema = z
  .object({ event: PredictionEventSchema, watch: PredictionWatchEntrySchema.nullable(), wallet: PredictionWalletAddress.nullable(), readAt: Iso })
  .strict();
export type PredictionsEventResponse = z.infer<typeof PredictionsEventResponseSchema>;

/**
 * `GET /api/predictions/markets/{id}/book?depth=` — public, never cached.
 * The market's books on every venue of its cluster and the best levels
 * across them. Fails with VALIDATION_ERROR 400 (not a market id), NOT_FOUND
 * 404 (the provider answered no book) or the provider's failure.
 */
export const PredictionsBookResponseSchema = z.object({ book: PredictionBookSchema }).strict();
export type PredictionsBookResponse = z.infer<typeof PredictionsBookResponseSchema>;

/**
 * `GET /api/predictions/markets/{id}/prices?also=` — public, never cached.
 * One row per market the provider answers for (the path's first, then
 * `also`). Fails with VALIDATION_ERROR 400 (not a market id) or the
 * provider's failure.
 */
export const PredictionsPricesResponseSchema = z.object({ prices: z.array(PredictionMarketPricesSchema).max(256), readAt: Iso }).strict();
export type PredictionsPricesResponse = z.infer<typeof PredictionsPricesResponseSchema>;

/** One part of the research: its answer, or the code it failed with — a state of that part, never a failed page. */
const PredPartFailureSchema = z.object({ ok: z.literal(false), code: z.enum(PREDICTION_FAILURE_CODES_V1) }).strict();
function predPart<T extends z.ZodType>(value: T) {
  return z.union([z.object({ ok: z.literal(true), value }).strict(), PredPartFailureSchema]);
}

/**
 * `GET /api/predictions/markets/{id}/research?text=` — public. Every part
 * answered on its own: the provider's signals (null when the engine has not
 * processed the market), the ripple candidates both ways, the news window,
 * and the markets related to `text`. Fails only with VALIDATION_ERROR 400
 * (not a market id).
 */
export const PredictionsResearchResponseSchema = z
  .object({
    signals: predPart(PredictionSignalsSchema.nullable()),
    expand: predPart(PredictionRippleSchema),
    hedge: predPart(PredictionRippleSchema),
    news: predPart(PredictionNewsSchema),
    related: predPart(z.array(PredictionRelatedMarketSchema).max(100)),
    readAt: Iso,
  })
  .strict();
export type PredictionsResearchResponse = z.infer<typeof PredictionsResearchResponseSchema>;

/**
 * `GET /api/predictions/outcomes/{id}/chart?resolution=&countBack=` —
 * public. An outcome's price history as the provider's bars. Fails with
 * VALIDATION_ERROR 400 (not an outcome id) or the provider's failure.
 */
export const PredictionsChartResponseSchema = z.object({ chart: PredictionChartSchema, readAt: Iso }).strict();
export type PredictionsChartResponse = z.infer<typeof PredictionsChartResponseSchema>;

/**
 * `POST /api/predictions/link/start` — the proven wallet; no body, or
 * `{ turnstileToken }` after a CHALLENGE_REQUIRED. The challenge itself, not
 * wrapped. Fails with LINK_UNAVAILABLE 503 (no session secret or durable
 * store here), CHALLENGE_REQUIRED 428 (the provider's bot check: show
 * Turnstile with `error.siteKey`, then post again with its token),
 * CHALLENGE_FAILED 403 (that token was refused — start again, no body),
 * VALIDATION_ERROR 400 (not a token) or the provider's failure.
 */
export const PredictionsLinkStartRequestSchema = z
  .object({
    /** The token Turnstile gave; at most 2,048 printable characters, no spaces. */
    turnstileToken: z.string().min(1).max(2048).regex(/^[!-~]+$/).optional(),
  })
  .strict();
export type PredictionsLinkStartRequest = z.infer<typeof PredictionsLinkStartRequestSchema>;
export const PredictionsLinkStartResponseSchema = PredictionLinkChallengeSchema;
export type PredictionsLinkStartResponse = z.infer<typeof PredictionsLinkStartResponseSchema>;

/**
 * `POST /api/predictions/link/verify` and `POST /api/predictions/link/revoke`
 * — the proven wallet. The link's state; never a token. Verify fails with
 * VALIDATION_ERROR 400, SIGNATURE_INVALID 401, WALLET_MISMATCH 403,
 * LINK_UNAVAILABLE 503, UNAVAILABLE 503 (the record changed under the
 * request) or the provider's failure; revoke with NOT_LINKED 409 or
 * UNAVAILABLE 503.
 */
export const PredictionsLinkResponseSchema = z.object({ wallet: PredictionWalletAddress, link: PredictionLinkStatusSchema }).strict();
export type PredictionsLinkResponse = z.infer<typeof PredictionsLinkResponseSchema>;

/**
 * `GET /api/predictions/account` — the proven wallet. The link state, the
 * paper balance, positions and the provider's order rows, Ryntra's own
 * order records (up to five still `submitted` re-read from the provider
 * first), the watchlist and the plans. A provider that cannot be read is
 * `providerFailure` in a 200, with the balance null and the provider lists
 * empty; an unlinked account answers the same way with `providerFailure`
 * null. Fails only with the wallet-proof refusal.
 */
export const PredictionsAccountResponseSchema = z
  .object({
    wallet: PredictionWalletAddress,
    link: PredictionLinkStatusSchema,
    balance: PredictionPaperBalanceSchema.nullable(),
    positions: z.array(PredictionPaperPositionSchema).max(500),
    closedPositions: z.array(PredictionPaperPositionSchema).max(500),
    providerOrders: z.array(PredictionPaperOrderSchema).max(1000),
    /** Newest first, at most 50. */
    orders: z.array(PredictionOrderRecordSchema).max(50),
    readAt: Iso,
    providerFailure: PredictionFailureValueSchema.nullable(),
    /** The provider's own word on whether this person may trade from where they are (its profile's location flag); null when not read. Ryntra adds no rule of its own. */
    access: z
      .object({
        locationBlocked: z.boolean(),
        /** The person's accounts on venues that trade only through one, with the provider's identity-check state; null when the profile lists none. */
        venueAccounts: z.array(z.object({ venue: PredWord, status: PredWord, kycStatus: PredWord }).strict()).max(64).nullable().optional(),
      })
      .strict()
      .nullable(),
    watchlist: z.array(PredictionWatchEntrySchema).max(100),
    plans: z.array(PredictionPlanSchema).max(50),
  })
  .strict();
export type PredictionsAccountResponse = z.infer<typeof PredictionsAccountResponseSchema>;

/**
 * `POST /api/predictions/quote` — the proven wallet. The Review, stored as a
 * `reviewed` record under the provider's quote id so the order placed is
 * the one reviewed. Fails with VALIDATION_ERROR 400, UNAVAILABLE 503 (no
 * durable store; the quote id already reviewed), PLAN_NOT_FOUND 404,
 * NOT_LINKED 409, SESSION_EXPIRED 401 or the provider's failure of the event
 * or the route. A refusing Review is a 200 with `canPlace: false`.
 */
export const PredictionsQuoteResponseSchema = z
  .object({ wallet: PredictionWalletAddress, review: PredictionPaperReviewSchema, link: PredictionLinkStatusSchema, order: PredictionOrderRecordSchema })
  .strict();
export type PredictionsQuoteResponse = z.infer<typeof PredictionsQuoteResponseSchema>;

/** `GET /api/predictions/orders` — the proven wallet. Ryntra's paper-order records, newest first, at most 50. Fails only with the wallet-proof refusal. */
export const PredictionsOrdersResponseSchema = z.object({ wallet: PredictionWalletAddress, orders: z.array(PredictionOrderRecordSchema).max(50) }).strict();
export type PredictionsOrdersResponse = z.infer<typeof PredictionsOrdersResponseSchema>;

/**
 * `POST /api/predictions/orders` — the proven wallet. 202 while the record
 * is `submitted` (the provider has not settled within twelve seconds), 200
 * otherwise; a quote already placed answers its record unchanged. Fails with
 * VALIDATION_ERROR 400, NOT_FOUND 404 (no Review), ORDER_REFUSED 422,
 * QUOTE_EXPIRED 409, NOT_LINKED 409, SESSION_EXPIRED 401, UNAVAILABLE 503 or
 * the provider's failure.
 */
export const PredictionsOrderPlacedResponseSchema = z.object({ wallet: PredictionWalletAddress, order: PredictionOrderRecordSchema }).strict();
export type PredictionsOrderPlacedResponse = z.infer<typeof PredictionsOrderPlacedResponseSchema>;

/**
 * `GET /api/predictions/orders/{quoteId}` — the proven wallet. One record,
 * re-read from the provider while `submitted`. Fails with VALIDATION_ERROR
 * 400 (not a quote id, checked before the proof) or NOT_FOUND 404.
 */
export const PredictionsOrderResponseSchema = z
  .object({
    wallet: PredictionWalletAddress,
    order: PredictionOrderRecordSchema,
    /** Present when the re-read failed: the stored record is answered, with the failure's code and message. */
    sync: z.object({ code: z.enum(PREDICTION_FAILURE_CODES_V1), message: z.string().min(1).max(4000) }).strict().optional(),
  })
  .strict();
export type PredictionsOrderResponse = z.infer<typeof PredictionsOrderResponseSchema>;

/** `GET /api/predictions/plans` — the proven wallet. Its Prediction Plans, the most recently updated first, at most 50. Fails only with the wallet-proof refusal. */
export const PredictionsPlansResponseSchema = z.object({ wallet: PredictionWalletAddress, plans: z.array(PredictionPlanSchema).max(50) }).strict();
export type PredictionsPlansResponse = z.infer<typeof PredictionsPlansResponseSchema>;

/**
 * One plan — the proven wallet: `POST /api/predictions/plans` (201; fails
 * with VALIDATION_ERROR 400, PLAN_INVALID 400 or UNAVAILABLE 503),
 * `GET /api/predictions/plans/{id}` (PLAN_NOT_FOUND 404),
 * `PATCH /api/predictions/plans/{id}` and
 * `POST /api/predictions/plans/{id}/status` (VALIDATION_ERROR 400,
 * PLAN_INVALID 400 on an edit, PLAN_NOT_FOUND 404, PLAN_VERSION_CONFLICT 409,
 * PLAN_STATE_REFUSED 409, UNAVAILABLE 503).
 */
export const PredictionsPlanResponseSchema = z.object({ wallet: PredictionWalletAddress, plan: PredictionPlanSchema }).strict();
export type PredictionsPlanResponse = z.infer<typeof PredictionsPlanResponseSchema>;

/** `GET` and `PUT /api/predictions/watchlist` — the proven wallet. The watched events, newest first, at most 100. `PUT` fails with VALIDATION_ERROR 400 or UNAVAILABLE 503. */
export const PredictionsWatchlistResponseSchema = z.object({ wallet: PredictionWalletAddress, entries: z.array(PredictionWatchEntrySchema).max(100) }).strict();
export type PredictionsWatchlistResponse = z.infer<typeof PredictionsWatchlistResponseSchema>;

/* ------------------------------------------------------------ autoinvest rules (1.12.0) */

/**
 * «Автоінвест» — «Регулярно»: a company, a sum in dollars, how often and
 * when, in the person's own time zone. Ryntra reminds on the day and at the
 * time; the person confirms every purchase with one signature on a fresh
 * Review; the money stays in the wallet. A rule is never a mandate and never
 * an authorization — it schedules a reminder, nothing more — and a reminder
 * whose day passed without a signature is `missed`, never caught up.
 */
export { RULE_CADENCES, RULE_REMINDER_HOURS, isTimeZone } from "../../autoinvest/schedule.ts";
/** `schedule` — «Регулярно»; 1.13.0: `dip` — «Якщо впаде»; 1.19.0: `payments` — «З кожної оплати». */
export const RULE_KINDS = ["schedule", "dip", "payments"] as const;
export type RuleKind = (typeof RULE_KINDS)[number];
export const RULE_STATUSES = ["active", "paused"] as const;
export type RuleStatus = (typeof RULE_STATUSES)[number];
/* How many rules a wallet holds, how many occurrences a rule keeps, the least and the most a purchase is, how far a «Якщо впаде» rule may wait for a price to fall, the least and the most a month's budget is — `lib/autoinvest/limits.ts`, so a page reads them without this module. */
export { RULE_LIST_LIMIT, RULE_MAXIMUM_USD, RULE_MINIMUM_USD, RULE_OCCURRENCES_KEPT, RULE_DIP_MIN_PCT, RULE_DIP_MAX_PCT, BUDGET_MINIMUM_USD, BUDGET_MAXIMUM_USD };

const cents = (value: number): boolean => Math.abs(Math.round(value * 100) - value * 100) < 1e-6;

const RuleUsd = z
  .number()
  .finite()
  .min(RULE_MINIMUM_USD)
  .max(RULE_MAXIMUM_USD)
  .refine(cents, { message: "Dollars and cents, never less than a cent." });

/** An IANA time zone this runtime knows. */
const RuleTimeZone = z.string().min(1).max(64).refine(isTimeZoneName, { message: "Not a time zone (an IANA name such as Europe/Kyiv)." });

/**
 * When the rule falls due: `daily` at `time`; `weekly` on `weekday` (1 Monday
 * … 7 Sunday) at `time`; `monthly` on `monthDay` at `time` — a month shorter
 * than the day falls on its last day. `time` is the wall clock in `timeZone`
 * (an IANA name), so a rule set in Kyiv at 19:00 reminds at 19:00 Kyiv in
 * summer and in winter.
 */
export const RuleScheduleSchema = z
  .object({
    cadence: z.enum(SCHEDULE_CADENCES),
    weekday: z.number().int().min(1).max(7).nullable(),
    monthDay: z.number().int().min(1).max(31).nullable(),
    time: ClockTime,
    timeZone: z.string().min(1).max(64),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.cadence === "weekly" && value.weekday === null) context.addIssue({ code: "custom", path: ["weekday"], message: "A weekly rule names its weekday." });
    if (value.cadence !== "weekly" && value.weekday !== null) context.addIssue({ code: "custom", path: ["weekday"], message: "Only a weekly rule names a weekday." });
    if (value.cadence === "monthly" && value.monthDay === null) context.addIssue({ code: "custom", path: ["monthDay"], message: "A monthly rule names its day of the month." });
    if (value.cadence !== "monthly" && value.monthDay !== null) context.addIssue({ code: "custom", path: ["monthDay"], message: "Only a monthly rule names a day of the month." });
    if (!isTimeZoneName(value.timeZone)) context.addIssue({ code: "custom", path: ["timeZone"], message: "Not a time zone (an IANA name such as Europe/Kyiv)." });
  });
export type RuleScheduleWire = z.infer<typeof RuleScheduleSchema>;

/** 1.13.0: the price that opened a «Якщо впаде» reminder and the reference point it fell from, per unit as the wallet shows it. */
export const RuleTriggerSchema = z.object({ priceUsd: z.number().finite().positive(), anchorUsd: z.number().finite().positive() }).strict();
export type RuleTrigger = z.infer<typeof RuleTriggerSchema>;

/* How far above its reference a rule's price may stand, the default and the freshness — `lib/autoinvest/limits.ts`, so a page reads them without this module. */
export { PRICE_CONDITION_DEFAULT_PCT, PRICE_CONDITION_MAX_AGE_MINUTES, PRICE_CONDITION_MAX_PCT, PRICE_CONDITION_MIN_PCT, PRICE_CONDITION_VERDICTS, PRICE_REFERENCES };

/**
 * 1.18.0: «Умова ціни» — «Не купувати, якщо дорожче за орієнтир більш ніж на
 * N %»: the most, in whole per cent, the token's price may stand above its
 * reference for the rule to offer its purchase. A discount always passes.
 */
export const RulePriceConditionSchema = z.object({ limitPct: z.number().int().min(PRICE_CONDITION_MIN_PCT).max(PRICE_CONDITION_MAX_PCT) }).strict();
export type RulePriceCondition = z.infer<typeof RulePriceConditionSchema>;

/**
 * 1.31.0: a rule's price condition as it stands. On a token of the venue's
 * list the reference is the market price when the rule was turned on —
 * `referenceUsd` per token and `referenceAt`, taken again whenever the rule is
 * turned on after a pause; absent on a company's rule, whose reference is the
 * issuer's or PreStocks' read at every judgement.
 */
export const RulePriceConditionStateSchema = z
  .object({
    limitPct: z.number().int().min(PRICE_CONDITION_MIN_PCT).max(PRICE_CONDITION_MAX_PCT),
    referenceUsd: z.number().finite().positive().optional(),
    referenceAt: Iso.optional(),
  })
  .strict();
export type RulePriceConditionState = z.infer<typeof RulePriceConditionStateSchema>;

/* The floor a rule's token of the venue's list stands on — `lib/autoinvest/floor.ts` and `lib/autoinvest/limits.ts`, so a page reads them without this module. */
export { RULE_ASSET_CLASSES, RULE_FLOOR_VERDICTS, RULE_FLOOR_LIQUIDITY_USD, RULE_FLOOR_AGE_HOURS };

/**
 * 1.31.0: one judgement of the floor a rule's token of the venue's list
 * stands on. `verdict`: `met` its liquidity and its age are on the floor ·
 * `below` one is under it · `unavailable` a figure is missing or older than
 * half an hour. `liquidityUsd` the venue's liquidity in the token's pools;
 * `ageHours` whole hours since its first pool; `dataAt` when the figures were
 * read; `checkedAt` when it was judged.
 */
export const RuleFloorCheckSchema = z
  .object({
    verdict: z.enum(RULE_FLOOR_VERDICTS),
    liquidityUsd: z.number().finite().nonnegative().nullable(),
    floorUsd: z.number().finite().positive(),
    ageHours: z.number().int().min(0).nullable(),
    minAgeHours: z.number().int().min(0),
    dataAt: Iso.nullable(),
    checkedAt: Iso,
  })
  .strict();
export type RuleFloorCheck = z.infer<typeof RuleFloorCheckSchema>;

/**
 * 1.18.0: one judgement of a rule's price condition. `verdict`: `met` the
 * purchase may be offered · `above` the price stands above the reference by
 * more than the limit · `stale` the price or the reference is older than the
 * freshness bound, or the source calls its copy stale · `unavailable` a figure
 * is missing. `reference`: `prestocks` PreStocks' valuation of one token ·
 * `issuer` the issuer's reference per share · `market` the market feed's; null
 * when the company has none. `priceUsd` and `referenceUsd` are on the same
 * basis (per token, per share); `deviationPct` is the price against the
 * reference to a tenth of a per cent; `dataAt` is the older of the two
 * figures' times; `checkedAt` is when it was judged.
 */
export const RuleConditionCheckSchema = z
  .object({
    verdict: z.enum(PRICE_CONDITION_VERDICTS),
    reference: z.enum(PRICE_REFERENCES).nullable(),
    limitPct: z.number().int().min(PRICE_CONDITION_MIN_PCT).max(PRICE_CONDITION_MAX_PCT),
    priceUsd: z.number().finite().positive().nullable(),
    referenceUsd: z.number().finite().positive().nullable(),
    deviationPct: z.number().finite().nullable(),
    dataAt: Iso.nullable(),
    checkedAt: Iso,
  })
  .strict();
export type RuleConditionCheck = z.infer<typeof RuleConditionCheckSchema>;

/** One occurrence of a rule: the instant it fell due, until when the reminder is open, and what happened. */
export const RuleOccurrenceSchema = z
  .object({
    /** A «Регулярно» rule's due instant; a «Якщо впаде» rule's the instant the price was read at or below its trigger (1.13.0). */
    dueAt: Iso,
    /** Until when one tap buys under this reminder — a day, or the next due when that comes sooner. */
    openUntil: Iso,
    state: z.enum(RULE_OCCURRENCE_STATES),
    /** When Ryntra wrote the reminder; null on an occurrence missed before a reminder could be written, and on a `held` one. */
    remindedAt: Iso.nullable(),
    /** The purchase's signature, once History holds one bound to this occurrence. */
    signature: z.string().min(64).max(128).nullable(),
    /** USDC that left the wallet, as History settled it; null until then. */
    spentUsd: z.number().nonnegative().nullable(),
    /** When History recorded the settled purchase. */
    boughtAt: Iso.nullable(),
    /** 1.13.0: on a «Якщо впаде» occurrence, the price that opened it and the point it fell from; null on a «Регулярно» one. */
    trigger: RuleTriggerSchema.nullable(),
    /** 1.18.0: the price condition's judgement that opened the reminder or deferred it — the last that changed its verdict; null where the rule has no condition. */
    condition: RuleConditionCheckSchema.nullable(),
    /** 1.19.0: the occurrence's own purchase sum — what a «З кожної оплати» rule gathered; null on the other kinds, whose purchase is the rule's `amountUsd`. */
    amountUsd: z.number().finite().positive().nullable(),
    /** 1.19.0: on a «З кожної оплати» occurrence, how many payments or incoming transfers its sum gathered; null on the other kinds. */
    events: z.number().int().min(0).nullable(),
    /** 1.31.0: on a rule's token of the venue's list, the floor's judgement that opened the reminder or deferred it — the last that changed its verdict; absent on a company's rule. */
    floor: RuleFloorCheckSchema.optional(),
  })
  .strict();
export type RuleOccurrence = z.infer<typeof RuleOccurrenceSchema>;

/** 1.13.0: how a «Якщо впаде» rule is asked for — how far the price must fall below its reference point, in whole per cent, and the person's own time zone. */
export const RuleDipRequestSchema = z
  .object({
    dropPct: z.number().int().min(RULE_DIP_MIN_PCT).max(RULE_DIP_MAX_PCT),
    timeZone: RuleTimeZone,
  })
  .strict();
export type RuleDipRequest = z.infer<typeof RuleDipRequestSchema>;

/**
 * 1.13.0: a «Якщо впаде» rule as it stands. `anchorUsd` is the reference
 * point per unit as the wallet shows it — the price when the rule was turned
 * on (`anchorFrom: "enabled"`, again whenever it is turned on after a pause)
 * or what the last purchase under it paid (`"purchase"`); `triggerUsd` is the
 * point less `dropPct` %. One note per crossing: `armed` is false from the
 * reminder of a crossing until the price is read back above the trigger.
 * `heldAt` is when the month's budget held the crossing that stands now —
 * nothing is reminded until the purchase fits again (the 1st, or a larger
 * budget); null otherwise.
 */
export const RuleDipSchema = z
  .object({
    dropPct: z.number().int().min(RULE_DIP_MIN_PCT).max(RULE_DIP_MAX_PCT),
    timeZone: RuleTimeZone,
    anchorUsd: z.number().finite().positive(),
    anchorAt: Iso,
    anchorFrom: z.enum(["enabled", "purchase"]),
    triggerUsd: z.number().finite().positive(),
    armed: z.boolean(),
    heldAt: Iso.nullable(),
  })
  .strict();
export type RuleDip = z.infer<typeof RuleDipSchema>;

/* The modes, the directions and the bounds of «З кожної оплати» — `lib/autoinvest/payments.ts` and `lib/autoinvest/limits.ts`, so a page reads them without this module. */
export { RULE_PAYMENT_MODES, PAYMENT_DIRECTIONS, PAYMENT_ROUNDUP_STEPS_USD, PAYMENT_FIXED_MIN_USD, PAYMENT_FIXED_MAX_USD, PAYMENT_PERCENT_MIN, PAYMENT_PERCENT_MAX, PAYMENT_EVENTS_KEPT };

const PaymentRoundTo = z.number().refine((value) => (PAYMENT_ROUNDUP_STEPS_USD as readonly number[]).includes(value), { message: `A round-up goes to the next $${PAYMENT_ROUNDUP_STEPS_USD.join(" or $")}.` });
const PaymentFixedUsd = z.number().finite().min(PAYMENT_FIXED_MIN_USD).max(PAYMENT_FIXED_MAX_USD).refine(cents, { message: "Dollars and cents, never less than a cent." });
const PaymentPercent = z.number().int().min(PAYMENT_PERCENT_MIN).max(PAYMENT_PERCENT_MAX);

function paymentTermsIssues(value: Readonly<{ mode: string; roundToUsd: unknown; fixedUsd: unknown; percent: unknown }>, context: z.RefinementCtx): void {
  if (value.mode === "roundup" && value.roundToUsd === null) context.addIssue({ code: "custom", path: ["roundToUsd"], message: "A round-up names the step: $1 or $5." });
  if (value.mode !== "roundup" && value.roundToUsd !== null) context.addIssue({ code: "custom", path: ["roundToUsd"], message: "Only a round-up names a step." });
  if (value.mode === "fixed" && value.fixedUsd === null) context.addIssue({ code: "custom", path: ["fixedUsd"], message: "A fixed sum from every payment names the sum." });
  if (value.mode !== "fixed" && value.fixedUsd !== null) context.addIssue({ code: "custom", path: ["fixedUsd"], message: "Only a fixed sum names one." });
  if (value.mode === "percent" && value.percent === null) context.addIssue({ code: "custom", path: ["percent"], message: "A per cent of what comes in names the per cent." });
  if (value.mode !== "percent" && value.percent !== null) context.addIssue({ code: "custom", path: ["percent"], message: "Only a per cent of what comes in names one." });
}

/**
 * 1.19.0: how a «З кожної оплати» rule is asked for — the mode and its one
 * figure (the others null), and the person's own time zone the events are
 * told in.
 */
export const RulePaymentsRequestSchema = z
  .object({
    mode: z.enum(RULE_PAYMENT_MODES),
    roundToUsd: PaymentRoundTo.nullable(),
    fixedUsd: PaymentFixedUsd.nullable(),
    percent: PaymentPercent.nullable(),
    timeZone: RuleTimeZone,
  })
  .strict()
  .superRefine(paymentTermsIssues);
export type RulePaymentsRequest = z.infer<typeof RulePaymentsRequestSchema>;

/**
 * 1.19.0: one counted event. `direction` `out` a payment, `in` money that
 * came in; `amountUsd` the wallet's USDC it moved; `addUsd` the rule's share
 * in whole cents; `at` the block's time; `label` the Solana Pay label — the
 * memo the transfer carried — null without one; `dueAt` the reminder that
 * took it, null while it waits. The other side is never named.
 */
export const RulePaymentEventSchema = z
  .object({
    signature: z.string().min(64).max(128),
    direction: z.enum(PAYMENT_DIRECTIONS),
    amountUsd: z.number().finite().nonnegative(),
    addUsd: z.number().finite().nonnegative(),
    at: Iso,
    label: z.string().max(80).nullable(),
    dueAt: Iso.nullable(),
  })
  .strict();
export type RulePaymentEvent = z.infer<typeof RulePaymentEventSchema>;

/**
 * 1.19.0: a «З кожної оплати» rule as it stands. The terms as asked; `since`
 * the instant events count from — when the rule was turned on, again after a
 * pause; `gatheredUsd` and `gatheredCount` what waits for the next reminder
 * (the money stays in the wallet); `events` the newest counted events, newest
 * first; `read` when the wallet's USDC was last read and whether that read
 * proved itself (`ok`), could not prove every transaction was read
 * (`partial`) or found no endpoint (`unavailable`) — null before the first
 * read.
 */
export const RulePaymentsSchema = z
  .object({
    mode: z.enum(RULE_PAYMENT_MODES),
    roundToUsd: z.number().positive().nullable(),
    fixedUsd: z.number().positive().nullable(),
    percent: z.number().int().positive().nullable(),
    timeZone: RuleTimeZone,
    since: Iso,
    gatheredUsd: z.number().finite().nonnegative(),
    gatheredCount: z.number().int().min(0),
    events: z.array(RulePaymentEventSchema).max(PAYMENT_EVENTS_KEPT * 2),
    read: z.object({ at: Iso, state: z.enum(["ok", "partial", "unavailable"]) }).strict().nullable(),
  })
  .strict();
export type RulePayments = z.infer<typeof RulePaymentsSchema>;

export const AutoinvestRuleSchema = z
  .object({
    id: z.string().regex(RULE_ID),
    owner: PredictionWalletAddress,
    network: z.literal(NETWORK),
    /** `schedule` — «Регулярно»; 1.13.0: `dip` — «Якщо впаде»; 1.19.0: `payments` — «З кожної оплати». */
    kind: z.enum(RULE_KINDS),
    /**
     * A confirmed stock representation — the identity; the plan's own asset
     * shape. 1.31.0: or a token of the venue's list on the floor — `kind`
     * `crypto` (verified by the venue, not a meme) or `meme` (a meme, or a
     * token the venue has not verified, whose `issuer` is then
     * `unverified`), priced per token.
     */
    asset: PlanAssetSchema,
    /** The company as a person names it («Apple»); 1.31.0: a token's symbol («SOL») — a word for a sentence, never the identity. */
    name: z.string().min(1).max(128),
    /** The sum every purchase is; 1.19.0: on a «З кожної оплати» rule, the least sum a reminder opens at — each reminder names its own. */
    amountUsd: RuleUsd,
    /** When a «Регулярно» rule falls due; null on a «Якщо впаде» rule (1.13.0) and a «З кожної оплати» one (1.19.0). */
    schedule: RuleScheduleSchema.nullable(),
    /** 1.13.0: a «Якщо впаде» rule's reference point and trigger; null on the other kinds. */
    dip: RuleDipSchema.nullable(),
    /** 1.19.0: a «З кожної оплати» rule's terms, what waits and the counted events; null on the other kinds. */
    payments: RulePaymentsSchema.nullable(),
    /** 1.18.0: «Умова ціни» — the most the price may stand above its reference for the rule to offer its purchase; null: no condition. 1.31.0: on a token of the venue's list, with the price it stands against. */
    priceCondition: RulePriceConditionStateSchema.nullable(),
    status: z.enum(RULE_STATUSES),
    /** The next instant a reminder falls due; null on a paused rule and on a «Якщо впаде» rule (the price decides). */
    nextDueAt: Iso.nullable(),
    /** Newest first, the last `RULE_OCCURRENCES_KEPT`. */
    occurrences: z.array(RuleOccurrenceSchema).max(RULE_OCCURRENCES_KEPT),
    createdAt: Iso,
    updatedAt: Iso,
  })
  .strict();
export type AutoinvestRule = z.infer<typeof AutoinvestRuleSchema>;

/**
 * 1.31.0: `GET /api/v1/rules/asset?mint=` — what a rule on a token would
 * stand on, read before it is written: the asset as a rule names it, its
 * class, the price now with its time, and — on a token of the venue's list —
 * the floor's judgement and the facts of its risk. `refusal` says why no rule
 * can name it (the same code and message `POST /api/v1/rules` would answer);
 * null when one can. Public data: no wallet is read.
 */
export const RuleAssetReadSchema = z
  .object({
    asset: PlanAssetSchema,
    name: z.string().min(1).max(128),
    class: z.enum(RULE_ASSET_CLASSES),
    priceUsd: z.number().finite().positive().nullable(),
    priceAt: Iso.nullable(),
    /** The reference a price condition would stand against: the company's own, or `enabled` — the price now, kept when the rule is turned on; null: none, and no condition is offered. */
    reference: z.enum(PRICE_REFERENCES).nullable(),
    floor: RuleFloorCheckSchema.nullable(),
    risk: z
      .object({
        verified: z.boolean(),
        ageHours: z.number().int().min(0).nullable(),
        liquidityUsd: z.number().finite().nonnegative().nullable(),
        topHoldersPct: z.number().finite().min(0).max(100).nullable(),
        mintAuthorityDisabled: z.boolean().nullable(),
        freezeAuthorityDisabled: z.boolean().nullable(),
        organicScore: z.number().finite().min(0).max(100).nullable(),
      })
      .strict()
      .nullable(),
    refusal: z.object({ code: z.enum(["ASSET_UNCONFIRMED", "RULE_LIQUIDITY_LOW"]), message: z.string().min(1).max(400) }).strict().nullable(),
    observedAt: Iso,
  })
  .strict();
export type RuleAssetRead = z.infer<typeof RuleAssetReadSchema>;
export const RuleAssetResponseSchema = z.object({ read: RuleAssetReadSchema }).strict();
export type RuleAssetResponse = z.infer<typeof RuleAssetResponseSchema>;

/**
 * `POST /api/v1/rules` — the company by mint and the sum; «Регулярно» names
 * its `schedule`, 1.13.0 «Якщо впаде» (`kind: "dip"`) names its `dip` — the
 * reference point is the price when the rule is written. `kind` absent is
 * «Регулярно», as every 1.12.0 request. `locale` is the language a
 * one-language channel (Telegram) carries the reminder in.
 */
export const RuleCreateRequestSchema = z
  .object({
    asset: z.object({ mint: Address }).strict(),
    amountUsd: RuleUsd,
    kind: z.enum(RULE_KINDS).default("schedule"),
    schedule: RuleScheduleSchema.optional(),
    dip: RuleDipRequestSchema.optional(),
    /** 1.19.0: a «З кожної оплати» rule's terms; its `amountUsd` is the least sum a reminder opens at. */
    payments: RulePaymentsRequestSchema.optional(),
    /** 1.18.0: the price condition; absent or null — none, as every 1.17.0 request. */
    priceCondition: RulePriceConditionSchema.nullable().optional(),
    locale: z.enum(["en", "uk"]).default("en"),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.kind === "schedule" && !value.schedule) context.addIssue({ code: "custom", path: ["schedule"], message: "A «Регулярно» rule names its schedule." });
    if (value.kind !== "dip" && value.dip) context.addIssue({ code: "custom", path: ["dip"], message: "Only a «Якщо впаде» rule names a fall." });
    if (value.kind === "dip" && !value.dip) context.addIssue({ code: "custom", path: ["dip"], message: "A «Якщо впаде» rule names how far the price falls." });
    if (value.kind !== "schedule" && value.schedule) context.addIssue({ code: "custom", path: ["schedule"], message: "Only a «Регулярно» rule has a schedule." });
    if (value.kind === "payments" && !value.payments) context.addIssue({ code: "custom", path: ["payments"], message: "A «З кожної оплати» rule names its mode." });
    if (value.kind !== "payments" && value.payments) context.addIssue({ code: "custom", path: ["payments"], message: "Only a «З кожної оплати» rule names payments." });
  });
export type RuleCreateRequest = z.input<typeof RuleCreateRequestSchema>;

/** `POST /api/v1/rules/{id}/status` — pause a rule, or turn it on again; the next reminder is computed from now, and nothing missed is caught up. */
export const RuleStatusRequestSchema = z.object({ status: z.enum(RULE_STATUSES) }).strict();
export type RuleStatusRequest = z.infer<typeof RuleStatusRequestSchema>;

export const RuleResponseSchema = z.object({ rule: AutoinvestRuleSchema }).strict();
export type RuleResponse = z.infer<typeof RuleResponseSchema>;

const BudgetUsd = z.number().finite().min(BUDGET_MINIMUM_USD).max(BUDGET_MAXIMUM_USD).refine(cents, { message: "Dollars and cents, never less than a cent." });

/**
 * 1.13.0: «Бюджет місяця» — the wallet's own ceiling for every rule's
 * purchases in a calendar month, from the 1st at 00:00 to the next 1st on
 * `timeZone`'s clock. Only proof counts: `spentUsd` is the USDC that left the
 * wallet on the month's settled purchases under rules; `unknownUsd` the
 * purchases signed and not settled yet — counted as spent until their outcome
 * is known; a reminder nobody bought counts nothing. `remainingUsd` is the
 * ceiling less both. A rule's purchase is reminded of only when it fits what
 * is left; `exhausted` is true when no active rule's purchase fits — the
 * rules stand until `monthEndsAt`. `capUsd` null: no ceiling (the month is
 * still counted, `remainingUsd` null, never `exhausted`). Only the person
 * sets or changes it; Ryntra never raises it.
 */
export const RuleBudgetSchema = z
  .object({
    capUsd: BudgetUsd.nullable(),
    /** The clock the month is counted on: the budget's, else the newest rule's. */
    timeZone: z.string().min(1).max(64),
    monthStartsAt: Iso,
    monthEndsAt: Iso,
    spentUsd: z.number().nonnegative(),
    unknownUsd: z.number().nonnegative(),
    remainingUsd: z.number().nonnegative().nullable(),
    exhausted: z.boolean(),
    /** When the person last set the ceiling; null without one. */
    updatedAt: Iso.nullable(),
  })
  .strict();
export type RuleBudget = z.infer<typeof RuleBudgetSchema>;

/** 1.13.0: `PUT /api/v1/rules/budget` — the ceiling in dollars and cents and the zone its month is counted in; `locale` is the language a one-language channel carries the note that it is spent in. */
export const RuleBudgetRequestSchema = z
  .object({
    capUsd: BudgetUsd,
    timeZone: RuleTimeZone,
    locale: z.enum(["en", "uk"]).default("en"),
  })
  .strict();
export type RuleBudgetRequest = z.input<typeof RuleBudgetRequestSchema>;

/** 1.13.0: `GET`, `PUT` and `DELETE /api/v1/rules/budget` — the month as it stands after the call. */
export const RuleBudgetResponseSchema = z.object({ budget: RuleBudgetSchema }).strict();
export type RuleBudgetResponse = z.infer<typeof RuleBudgetResponseSchema>;

/** `GET /api/v1/rules` — the proven wallet's rules, newest first; 1.13.0: and the month's budget. */
export const RuleListResponseSchema = z.object({ address: Address, rules: z.array(AutoinvestRuleSchema).max(RULE_LIST_LIMIT), total: z.number().int().min(0), budget: RuleBudgetSchema }).strict();
export type RuleListResponse = z.infer<typeof RuleListResponseSchema>;

/**
 * 1.19.0: `POST /api/v1/rules/payments/own` — the other side of one counted
 * event (by its signature) is the person's own account: no transfer to or from
 * it counts for any «З кожної оплати» rule of the wallet from now on, and the
 * event leaves what waits. The answer is the wallet's rules as they stand
 * after it — the account itself is never named back.
 */
export const RulePaymentOwnRequestSchema = z.object({ signature: z.string().min(64).max(128) }).strict();
export type RulePaymentOwnRequest = z.infer<typeof RulePaymentOwnRequestSchema>;

/** `DELETE /api/v1/rules/{id}` — the rule is gone; History keeps its purchases, each still naming it. */
export const RuleDeleteResponseSchema = z.object({ deleted: z.literal(true), id: z.string().regex(RULE_ID) }).strict();
export type RuleDeleteResponse = z.infer<typeof RuleDeleteResponseSchema>;

/* ------------------------------------------------------------ Нагляд over positions (1.21.0) */

export const POSITION_HOLDINGS_READS_V1 = ["complete", "partial", "failed"] as const;

/** A per-unit dollar figure a position is judged by. */
const PositionUsd = z.number().finite().positive().max(1_000_000_000);

/** Where a position's exit comes from, and what it is. */
export const PositionExitSchema = z
  .object({
    /** `plan`: the executed plan the position was bought under, while it is watched as the position; `watch`: «Ryntra попередить» turned on for it. */
    source: z.enum(WATCH_SOURCES),
    /** The loss limit, USD per unit as the wallet shows the token. */
    limit: PositionUsd,
    /** The target, the same unit; null where none is set. */
    target: PositionUsd.nullable(),
    /** The preset «Ryntra попередить» was turned on with; null for a plan's exit. */
    preset: z.enum(POSITION_WATCH_PRESETS_V1).nullable(),
    /** The plan the exit is from; null for «Ryntra попередить». */
    planId: z.string().regex(PLAN_ID).nullable(),
  })
  .strict();
export type PositionExit = z.infer<typeof PositionExitSchema>;

/** One company the wallet holds, as Нагляд sees it: its exit, its state and its one action. */
export const PositionWatchViewSchema = z
  .object({
    mint: Address,
    symbol: z.string().min(1).max(32),
    /** The company, as the issuer names it. */
    name: z.string().min(1).max(200),
    icon: z.string().min(1).max(2048).nullable(),
    unitBasis: z.enum(["share", "token"]),
    /** Raw units the chain says the wallet holds. */
    amountRaw: RawAmount,
    /** What the holding is worth at `price`; null where a figure it needs is unknown. */
    valueUsd: z.number().finite().nonnegative().nullable(),
    /** USD per unit as the wallet shows the token, and when the venue observed it; null where unread. */
    price: z.number().finite().positive().nullable(),
    observedAt: ProviderTime.nullable(),
    /** The token against the exchange's current reference, per cent; null where there is none. */
    deviationPct: z.number().finite().nullable(),
    exit: PositionExitSchema.nullable(),
    state: z.enum(WATCH_STATES),
    reason: z.enum(WATCH_REASONS),
    /** The one action; null where there is nothing to do. */
    action: z.enum(WATCH_ACTIONS).nullable(),
    /** How far the price stands above the loss limit, per cent of the price; null without a fresh price or an exit. */
    toLimitPct: z.number().finite().nullable(),
  })
  .strict();
export type PositionWatchView = z.infer<typeof PositionWatchViewSchema>;

/**
 * 1.21.0: `GET /api/v1/positions` — the proven wallet's company positions,
 * the one that needs the person first, then by value. `channel.telegram`: a
 * Telegram chat is connected, the channel «Ryntra попередить» warns through.
 * `read.holdings`: both token programs answered (`complete`), one did
 * (`partial`), none did (`failed`, and no position is listed); `read.market`:
 * whether the universe answered (`failed`: no position is listed). Errors are
 * the v1 envelope: 426 `UNSUPPORTED_API`; 401 from the proof.
 */
export const PositionsResponseSchema = z
  .object({
    address: Address,
    positions: z.array(PositionWatchViewSchema).max(500),
    channel: z.object({ telegram: z.boolean() }).strict(),
    read: z.object({ holdings: z.enum(POSITION_HOLDINGS_READS_V1), market: z.enum(["ok", "failed"]), at: Iso }).strict(),
  })
  .strict();
export type PositionsResponse = z.infer<typeof PositionsResponseSchema>;

/** 1.21.0: `PUT /api/v1/positions/watch` — «Ryntra попередить» on a company the wallet holds; `locale` is the language its notes and Telegram message speak. */
export const PositionWatchRequestSchema = z
  .object({
    mint: Address,
    preset: z.enum(POSITION_WATCH_PRESETS_V1),
    locale: z.enum(["en", "uk"]).default("en"),
  })
  .strict();
export type PositionWatchRequest = z.input<typeof PositionWatchRequestSchema>;

/** «Ryntra попередить» as written: the preset, the price the figures were counted from, the loss limit and the target. */
export const PositionWatchSchema = z
  .object({
    mint: Address,
    symbol: z.string().min(1).max(32),
    preset: z.enum(POSITION_WATCH_PRESETS_V1),
    stopPct: z.number().int().positive(),
    targetPct: z.number().int().positive(),
    basisPerUnit: PositionUsd,
    basisObservedAt: ProviderTime,
    limitPerUnit: PositionUsd,
    targetPerUnit: PositionUsd,
    createdAt: Iso,
    updatedAt: Iso,
  })
  .strict();
export type PositionWatch = z.infer<typeof PositionWatchSchema>;

/**
 * 1.21.0: the answer to `PUT /api/v1/positions/watch` — the watch, and the
 * position as Нагляд sees it now (null when the wallet's holdings could not be
 * read at that moment). Errors are the v1 envelope: 400 `VALIDATION_ERROR`;
 * 422 `ASSET_UNCONFIRMED` (not a company Ryntra lists); 409
 * `CHANNEL_REQUIRED` (no Telegram connected); 503 `PRICE_UNAVAILABLE` (no
 * fresh price) · `UNAVAILABLE` (no durable store); 401 and 403 from the proof.
 */
export const PositionWatchResponseSchema = z.object({ watch: PositionWatchSchema, position: PositionWatchViewSchema.nullable() }).strict();
export type PositionWatchResponse = z.infer<typeof PositionWatchResponseSchema>;

/* ------------------------------------------------------------ «Ризик портфеля» (1.23.0) */

/** One rule «Ризик портфеля» found broken, and what it names. */
export const PortfolioRiskFindingSchema = z
  .object({
    /** `action` a position reached its limit or target · `weekend-no-limit` a listed company with no loss limit over the weekend · `concentration` one asset above its cap · `private-share` the private companies together above theirs. */
    reason: z.enum(RISK_REASONS),
    /** What is named — a company, a private company, a coin; null for the private companies together. */
    kind: z.enum(RISK_ASSET_KINDS).nullable(),
    /** The token named (for a company across its tokens, its largest); null for the private companies together. */
    mint: Address.nullable(),
    symbol: z.string().min(1).max(32).nullable(),
    /** The company or the coin, as a person reads it. */
    name: z.string().min(1).max(200).nullable(),
    /** The share of the wallet, per cent to one decimal; null where the reason is not a cap. */
    sharePct: z.number().finite().min(0).max(100).nullable(),
    /** The cap the share is above, per cent; null where the reason is not a cap. */
    capPct: z.number().int().positive().nullable(),
    /** For `action`: the loss limit or the target was reached; null otherwise. */
    watchReason: z.enum(["limit", "target"]).nullable(),
  })
  .strict();
export type PortfolioRiskFinding = z.infer<typeof PortfolioRiskFindingSchema>;

/** «Ризик портфеля» — one word for the wallet as a whole. */
export const PortfolioRiskSchema = z
  .object({
    /** `normal` «Нормальний» · `attention` «Увага: <причина>» · `unknown` «Не вдалося перевірити». */
    state: z.enum(RISK_STATES),
    /** Every rule broken, the most urgent first; empty unless `attention`. */
    findings: z.array(PortfolioRiskFindingSchema).max(500),
    /** What could not be read: the token accounts, the companies' market, the positions' exits, the SOL balance, a price; empty when every figure was. */
    gaps: z.array(z.enum(RISK_GAPS)).max(RISK_GAPS.length),
    /** What the wallet is worth, dollars included — the whole the shares are of; null where a part could not be read. */
    totalUsd: z.number().finite().nonnegative().nullable(),
    /** The one-asset cap was judged: every figure read and the wallet worth at least `capabilities.positions.capsFromUsd`; the private companies' cap is judged whenever every figure was read. */
    capsApplied: z.boolean(),
  })
  .strict();
export type PortfolioRisk = z.infer<typeof PortfolioRiskSchema>;

/**
 * 1.23.0: `GET /api/v1/positions/risk` — «Ризик портфеля» of the proven
 * wallet, and when it was judged. Errors are the v1 envelope: 426
 * `UNSUPPORTED_API`; 401 from the proof.
 */
export const PortfolioRiskResponseSchema = z.object({ address: Address, risk: PortfolioRiskSchema, at: Iso }).strict();
export type PortfolioRiskResponse = z.infer<typeof PortfolioRiskResponseSchema>;

/* ------------------------------------------------------------ «Гроші»: payment links, the recipient check, what the wallet returned (1.22.0) */

export const PAY_LINK_STATUSES = ["AWAITING", "PAID", "EXPIRED", "CHECKING", "UNKNOWN"] as const;
/** What the page says aloud instead of pretending nothing arrived: less, more, or another token. */
export const PAY_LINK_NOTES = ["UNDERPAID", "WRONG_TOKEN", "OVERPAID"] as const;
export const PAY_LINK_DESCRIPTION_MAX = 120;
export const PAY_LINK_LIST_LIMIT_V1 = 50;
const PayLinkId = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{14,20}$/);
const PaySignature = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,90}$/);

/**
 * 1.22.0: a payment link — the page's own projection (`lib/pay/model.ts`) and
 * the two addresses a client shares: `url`, the page anyone opens, and
 * `payUrl`, the Solana Pay request with the link's reference that a wallet's
 * scanner reads. `status` is derived on the server from the reference-keyed
 * observation and the server's clock; `paid` only when paid, with what
 * arrived in the token's units. Nothing of the creator's account or session.
 */
export const PayLinkSchema = z
  .object({
    id: PayLinkId,
    url: z.string().url().max(512),
    payUrl: z.string().startsWith("solana:").max(2_048),
    status: z.enum(PAY_LINK_STATUSES),
    note: z.enum(PAY_LINK_NOTES).nullable(),
    token: z.object({ symbol: z.string().min(1).max(24), mint: Address.nullable(), decimals: z.number().int().min(0).max(18) }).strict(),
    /** The amount asked, raw and as the creator typed it; null when the payer chooses. */
    amount: z.object({ raw: RawAmount, display: z.string().min(1).max(40) }).strict().nullable(),
    description: z.string().min(1).max(PAY_LINK_DESCRIPTION_MAX).nullable(),
    /** The wallet paid: the full address (a wallet cannot pay an abbreviation) and the one a screen shows. */
    recipient: z.object({ abbreviated: z.string().min(1).max(44), address: Address }).strict(),
    /** The Solana Pay reference that makes this link findable on the chain. */
    reference: Address,
    createdAt: Iso,
    expiresAt: Iso,
    paid: z.object({ signature: PaySignature, creditedRaw: RawAmount, credited: TransferDecimal, paidAt: Iso.nullable() }).strict().nullable(),
    /**
     * 1.78.0 (FIX-PAY-1): what reached the recipient in the requested token so far, summed over every transaction that
     * carried the reference — raw and in the token's units — and what the token's own transfer fee withheld of it (null
     * when it withheld nothing). Null while nothing in the token arrived; another token is never counted here.
     */
    received: z
      .object({ raw: RawAmount, amount: TransferDecimal, feeWithheldRaw: RawAmount.nullable(), feeWithheld: TransferDecimal.nullable() })
      .strict()
      .nullable(),
  })
  .strict();
export type PayLink = z.infer<typeof PayLinkSchema>;

/**
 * 1.22.0: `POST /api/v1/pay/requests` — a link for the proven wallet (the
 * bearer, or the web's proof cookie with the site's origin). `mint` null or
 * absent asks for SOL; `amount` in the token's units, null or absent to let
 * the payer choose; `expiration` 7 days by default.
 */
export const PayLinkCreateRequestSchema = z
  .object({
    mint: Address.nullable().optional(),
    amount: z.string().min(1).max(40).nullable().optional(),
    description: z.string().max(PAY_LINK_DESCRIPTION_MAX).nullable().optional(),
    expiration: z.enum(PAY_LINK_EXPIRATIONS).optional(),
  })
  .strict();
export type PayLinkCreateRequest = z.input<typeof PayLinkCreateRequestSchema>;

/**
 * 1.22.0: one link — the answer to `POST /api/v1/pay/requests` (201) and to
 * `GET /api/v1/pay/requests/{id}`. Errors are the v1 envelope: 400
 * `VALIDATION_ERROR` · `AMOUNT_INVALID`; 422 `MINT_UNREADABLE`; 404
 * `PAY_LINK_NOT_FOUND`; 429 `RATE_LIMITED`; 503 `UNAVAILABLE` (the store, or
 * the chain while reading the mint); 401 and 403 from the proof on the create.
 */
export const PayLinkResponseSchema = z.object({ link: PayLinkSchema }).strict();
export type PayLinkResponse = z.infer<typeof PayLinkResponseSchema>;

/** 1.22.0: `GET /api/v1/pay/requests` — the proven wallet's links, newest first, at most `capabilities.money.listLimit`. */
export const PayLinkListResponseSchema = z.object({ address: Address, links: z.array(PayLinkSchema).max(PAY_LINK_LIST_LIMIT_V1) }).strict();
export type PayLinkListResponse = z.infer<typeof PayLinkListResponseSchema>;

export const RECIPIENT_INPUTS = ["address", "solana-pay", "pay-link"] as const;
export const RECIPIENT_NEXT = ["transfer", "pay-link", "none"] as const;
export const RECIPIENT_PROBLEMS = [
  /* what was entered */
  "EMPTY",
  "NOT_AN_ADDRESS",
  "MISREAD_CHARACTER",
  "WRONG_LENGTH",
  "REQUEST_INVALID",
  "REQUEST_UNSUPPORTED",
  "REFERENCE_UNSUPPORTED",
  "LINK_INVALID",
  "LINK_NOT_FOUND",
  "LINK_PAID",
  "LINK_EXPIRED",
  /** A scanned request names a Ryntra link by its reference but states other terms than the link's own — nothing of the link is answered. */
  "LINK_MISMATCH",
  /** The chain could not be read about the link: it may already be paid. */
  "LINK_UNCONFIRMED",
  "SELF",
  /* what the chain says */
  "MINT_UNREADABLE",
  "UNSAFE_SOL_RECIPIENT",
  "RECIPIENT_MINT_MISMATCH",
  "RECIPIENT_PROGRAM_MISMATCH",
  "RECIPIENT_ACCOUNT_MALFORMED",
  "OFF_CURVE_OWNER_UNSUPPORTED",
  "RECIPIENT_FROZEN",
  "RECIPIENT_UNREADABLE",
] as const;

/**
 * 1.22.0: `GET /api/v1/money/recipient` — the query. `to` is what was typed,
 * pasted or scanned (an address, a `solana:` request, a Ryntra link);
 * `mint` the asset to send, absent for SOL (a `solana:` request's own token
 * wins); `from` the sending wallet, for `SELF`.
 */
export const RecipientCheckQuerySchema = z
  .object({
    to: z.string().max(2_048),
    mint: Address.optional(),
    from: Address.optional(),
  })
  .strict();
export type RecipientCheckQuery = z.infer<typeof RecipientCheckQuerySchema>;

/**
 * 1.22.0: the recipient check before a transfer. Public (no wallet needed),
 * on the Solana read budget. `next` is the one decision a client acts on:
 * `transfer` — build the Review for `address` (`POST
 * /api/solana/transfer/plan`); `pay-link` — pay `link` through its own
 * routes, so that its reference goes in; `none` — `problem` says why. An
 * address the chain could not be asked about is `RECIPIENT_UNREADABLE`,
 * never a pass; a link found by a scanned reference is answered only when
 * the request states the link's own recipient, token, amount and note and it
 * can still be paid — a reference is public on the chain. A store that did
 * not answer is 503 `UNAVAILABLE`. `destination` is what the chain says for `asset`: whose
 * money it becomes, the account that receives and whether it opens (its cost
 * comes with the Review, `check.setup`). `asked` is what a `solana:`
 * request asks; `link` the Ryntra link, when it is one.
 */
export const RecipientCheckResponseSchema = z
  .object({
    input: z.enum(RECIPIENT_INPUTS),
    next: z.enum(RECIPIENT_NEXT),
    problem: z.enum(RECIPIENT_PROBLEMS).nullable(),
    /** The wallet or account that would be paid; null when none could be read from the input. */
    address: Address.nullable(),
    /** The asset the destination was checked for; `mint` null for SOL. */
    asset: z.object({ mint: Address.nullable() }).strict(),
    destination: z
      .object({ kind: z.enum(["wallet", "token-account"]), owner: PredictionWalletAddress, account: Address, opensAccount: z.boolean() })
      .strict()
      .nullable(),
    asked: z
      .object({
        amount: z.string().regex(/^(0|[1-9][0-9]*)(\.[0-9]+)?$/).max(64).nullable(),
        mint: Address.nullable(),
        label: z.string().min(1).max(200).nullable(),
        message: z.string().min(1).max(200).nullable(),
      })
      .strict()
      .nullable(),
    link: PayLinkSchema.nullable(),
    checkedAt: Iso,
  })
  .strict();
export type RecipientCheckResponse = z.infer<typeof RecipientCheckResponseSchema>;

export const SEND_RETURNED_VERDICTS = ["BYTES_MATCH", "BYTES_FEE_ADDED", "BYTES_CHANGED", "NOT_SIGNED", "UNREADABLE"] as const;

/**
 * 1.22.0: `POST /api/v1/money/send/returned` — what the wallet returned,
 * against the Review it was handed. `plan` is the Review's `plan` as the plan
 * or adopt route answered it (the route reads its `actionKind`, its
 * `unsignedWireBase64` and its fingerprint's `messageHash` and `feePayer`;
 * the rest is passed through unread); `signedWireBase64` what the wallet
 * signed.
 */
export const SendReturnedRequestSchema = z
  .object({
    plan: z
      .object({
        actionKind: z.enum(TRANSFER_ACTION_KINDS_V1),
        unsignedWireBase64: z.string().min(64).max(8_192),
        fingerprint: z.object({ messageHash: z.string().regex(/^0x[0-9a-f]{64}$/), feePayer: Address }).passthrough(),
      })
      .passthrough(),
    signedWireBase64: z.string().min(64).max(8_192),
  })
  .strict();
export type SendReturnedRequest = z.input<typeof SendReturnedRequestSchema>;

/**
 * 1.22.0: the answer — stateless and public, it moves and records nothing.
 * `next`: `settle` (the exact bytes, signed), `adopt` (the wallet added only
 * its fee and guard instructions; `POST /api/solana/transfer/adopt` with these
 * bytes, then settle the adopted Review) or `stop` (`BYTES_CHANGED`,
 * `NOT_SIGNED`, `UNREADABLE` — nothing is sent). `signature` is the
 * transaction's own, read from the bytes, whenever the wallet signed: keep it
 * before settling, so an outcome can always be recovered by it.
 */
export const SendReturnedResponseSchema = z
  .object({
    verdict: z.enum(SEND_RETURNED_VERDICTS),
    next: z.enum(["settle", "adopt", "stop"]),
    signature: PaySignature.nullable(),
    detail: z.string().min(1).max(1_024),
  })
  .strict();
export type SendReturnedResponse = z.infer<typeof SendReturnedResponseSchema>;

/* ------------------------------------------------------------ the consumed routes: a payment link paid (1.22.0) */

/**
 * 1.22.0: the three routes the payment page `/pay/{id}` runs, described as
 * they serve — so a phone that scanned or was sent a Ryntra link pays it
 * through the link, with its reference, exactly as the page does. Not
 * `/api/v1` routes: no version header; the error is
 * `{ error: { code, message } }` with each route's own codes. `…/transaction`
 * and `…/submit` take the native bearer in place of the page's origin (the
 * swap routes' own rule): the payer is the session's wallet,
 * `WALLET_MISMATCH` otherwise; a browser's refusal keeps `FORBIDDEN`.
 */

/** The payer page's projection (`projectPublicPaymentRequest`): what the creator put in the link and what the chain publishes. */
export const PayPublicRequestSchema = z
  .object({
    id: PayLinkId,
    network: z.literal("mainnet"),
    status: z.enum(PAY_LINK_STATUSES),
    note: z.enum(PAY_LINK_NOTES).nullable(),
    token: z.object({ symbol: z.string().min(1).max(24), mint: Address.nullable(), decimals: z.number().int().min(0).max(18) }).strict(),
    amount: z.object({ raw: RawAmount, display: z.string().min(1).max(40) }).strict().nullable(),
    description: z.string().min(1).max(PAY_LINK_DESCRIPTION_MAX).nullable(),
    recipient: z.object({ abbreviated: z.string().min(1).max(44), address: Address }).strict(),
    reference: Address,
    createdAt: Iso,
    expiresAt: Iso,
    paid: z.object({ signature: PaySignature, creditedRaw: RawAmount, paidAt: Iso.nullable() }).strict().nullable(),
    /** 1.78.0 (FIX-PAY-1): what arrived in the requested token so far, and what its own transfer fee withheld of it. */
    received: z.object({ raw: RawAmount, feeWithheldRaw: RawAmount.nullable() }).strict().nullable(),
  })
  .strict();
export type PayPublicRequest = z.infer<typeof PayPublicRequestSchema>;

/** The request and its Solana Pay request, as `/pay/{id}` and its poll read them. */
export const PayPublicViewSchema = z.object({ request: PayPublicRequestSchema, payUrl: z.string().startsWith("solana:").max(2_048) }).strict();
export type PayPublicView = z.infer<typeof PayPublicViewSchema>;

/** `GET /api/pay/{id}` — public; observed like the v1 read. Fails `PayPublicErrorSchema`: 429 `RATE_LIMITED`, 404 `NOT_FOUND`. */
export const PayPublicResponseSchema = z.object({ data: PayPublicViewSchema }).strict();
export type PayPublicResponse = z.infer<typeof PayPublicResponseSchema>;
export const PAY_PUBLIC_ERROR_CODES_V1 = ["RATE_LIMITED", "NOT_FOUND"] as const;
export const PayPublicErrorSchema = z.object({ error: z.object({ code: z.enum(PAY_PUBLIC_ERROR_CODES_V1), message: z.string().min(1).max(512) }).strict() }).strict();
export type PayPublicError = z.infer<typeof PayPublicErrorSchema>;

/** Who may ask the payer routes: the page's origin (`FORBIDDEN` otherwise) or the bearer, refused by its own code. */
const PAY_CARRIER_ERROR_CODES_V1 = ["FORBIDDEN", "UNAUTHORIZED", "SESSION_EXPIRED", "SESSION_REVOKED", "UNAVAILABLE"] as const;

/** `POST /api/pay/{id}/transaction` — the payer (the bearer's own wallet) and, for an open link only, the amount in the token's units. */
export const PayTransactionRequestSchema = z.object({ payer: Address, amount: z.string().max(40).nullable().optional() }).strict();
export type PayTransactionRequest = z.input<typeof PayTransactionRequestSchema>;

/**
 * The unsigned transfer a payer's wallet signs, carrying the link's
 * reference, pinned by its message hash for three minutes (`intentId`);
 * `simulated` null when the endpoint would not simulate.
 */
export const PayTransactionResponseSchema = z
  .object({
    data: z
      .object({
        ok: z.literal(true),
        intentId: z.string().min(8).max(64),
        unsignedWireBase64: z.string().min(64).max(8_192),
        messageHash: z.string().regex(/^0x[0-9a-f]{64}$/),
        amountRaw: RawAmount,
        mint: Address.nullable(),
        simulated: z.object({ succeeded: z.boolean(), error: z.string().max(4_096).nullable() }).strict().nullable(),
        createsRecipientAccount: z.boolean(),
        networkFeeLamports: RawAmount,
        /** AG-1 (17.10): how long from arriving the payer may still sign — the bytes' life on the chain (~30 s on 200 ms slots) less a margin to land. Past it, prepare again rather than sign. */
        signableMs: SignableMs,
      })
      .strict(),
  })
  .strict();
export type PayTransactionResponse = z.infer<typeof PayTransactionResponseSchema>;

export const PAY_TRANSACTION_ERROR_CODES_V1 = [
  "RATE_LIMITED",
  ...PAY_CARRIER_ERROR_CODES_V1,
  ...SWAP_BODY_ERROR_CODES_V1,
  "VALIDATION_ERROR",
  "WALLET_MISMATCH",
  "NOT_FOUND",
  "ALREADY_PAID",
  "EXPIRED",
  "PAYMENT_PENDING",
  "AMOUNT_REQUIRED",
  "AMOUNT_INVALID",
  "REQUEST_NOT_PAYABLE",
  "SELF_PAYMENT",
  "MINT_UNREADABLE",
  "EPOCH_UNAVAILABLE",
  "BUILD_FAILED",
  "SIMULATION_FAILED",
  "STORE_FAILED",
] as const;

/**
 * The transaction route's refusal: 429 `RATE_LIMITED`; 403 `FORBIDDEN`, the
 * bearer's codes; body codes; 400 `VALIDATION_ERROR` · `AMOUNT_REQUIRED` ·
 * `AMOUNT_INVALID`; 403 `WALLET_MISMATCH`; 404 `NOT_FOUND`; 409
 * `ALREADY_PAID` · `PAYMENT_PENDING`; 410 `EXPIRED`; 422 the builder's
 * refusals; 503 `MINT_UNREADABLE` · `EPOCH_UNAVAILABLE` · `STORE_FAILED`.
 */
export const PayTransactionErrorSchema = z
  .object({ error: z.object({ code: z.enum(PAY_TRANSACTION_ERROR_CODES_V1), message: z.string().min(1).max(4_096) }).strict() })
  .strict();
export type PayTransactionError = z.infer<typeof PayTransactionErrorSchema>;

/** `POST /api/pay/{id}/submit` — the intent the transaction route handed out and the bytes the wallet signed. */
export const PaySubmitRequestSchema = z.object({ intentId: z.string().min(8).max(64), signedWireBase64: z.string().min(64).max(20_000) }).strict();
export type PaySubmitRequest = z.input<typeof PaySubmitRequestSchema>;

/** Sent once: the signature, and the link as its page now reads it (usually still awaiting — confirmation comes from observing the reference). */
export const PaySubmitResponseSchema = z.object({ data: z.object({ signature: PaySignature, view: PayPublicViewSchema.nullable() }).strict() }).strict();
export type PaySubmitResponse = z.infer<typeof PaySubmitResponseSchema>;

export const PAY_SUBMIT_ERROR_CODES_V1 = [
  "RATE_LIMITED",
  ...PAY_CARRIER_ERROR_CODES_V1,
  ...SWAP_BODY_ERROR_CODES_V1,
  "VALIDATION_ERROR",
  "WALLET_MISMATCH",
  "NOT_FOUND",
  "INTENT_UNKNOWN",
  "INTENT_MISMATCH",
  "INTENT_EXPIRED",
  "ALREADY_SUBMITTED",
  "BYTES_UNREADABLE",
  "BYTES_MISMATCH",
  "SIGNATURE_MISSING",
  "SUBMIT_FAILED",
] as const;

/**
 * The submit route's refusal: 429; 403 `FORBIDDEN`, the bearer's codes,
 * `WALLET_MISMATCH`; body codes; 400 `VALIDATION_ERROR`; 404 `NOT_FOUND`;
 * 410 `INTENT_EXPIRED`; 502 `SUBMIT_FAILED`; 409 the rest — nothing was sent.
 */
export const PaySubmitErrorSchema = z
  .object({ error: z.object({ code: z.enum(PAY_SUBMIT_ERROR_CODES_V1), message: z.string().min(1).max(4_096) }).strict() })
  .strict();
export type PaySubmitError = z.infer<typeof PaySubmitErrorSchema>;

/* ------------------------------------------------------------ helpers */

/** `major.minor.patch` compared numerically; true when `version` is at least `minimum`. */
export function versionAtLeast(version: string, minimum: string): boolean {
  const a = version.split(".").map(Number);
  const b = minimum.split(".").map(Number);
  for (let i = 0; i < 3; i += 1) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return true;
}

/** The major a client asked for, or null when it named none; NaN-safe. */
export function requestedMajor(headerValue: string | null): number | null {
  if (headerValue === null || headerValue.trim() === "") return null;
  const major = Number(headerValue.trim());
  return Number.isInteger(major) && major > 0 ? major : Number.NaN;
}

/* ------------------------------------------------------------ Ryntra Launch (1.25.0) */

/** One wallet's share of a launch's creator fees, whole basis points (1.29.0). */
const LaunchFeeShareSchema = z.object({ address: Address, bps: z.number().int().min(FEE_SHARE_MIN_BPS).max(FEE_SHARE_TOTAL_BPS) }).strict();

const LaunchRaw = z.string().regex(/^[0-9]{1,30}$/);
const LaunchWords = z.object({ uk: z.string().min(1).max(64), en: z.string().min(1).max(64) }).strict();
const LaunchNetworkId = z.enum(["solana:devnet", "solana:mainnet"]);
const LaunchBuildId = z.string().regex(/^[0-9a-f]{32}$/);
/** 1.74.0 (MC-2): a mission's crew. */
const LaunchCrewId = z.string().regex(/^[0-9a-f]{24}$/);

const LaunchBpsShare = z.number().int().min(0).max(10_000);
/** One fee split, basis points of it; the three add up to 10 000 (1.50.0). */
const LaunchFeeSharesSchema = z.object({ creatorBps: LaunchBpsShare, ryntraBps: LaunchBpsShare, meteoraBps: LaunchBpsShare }).strict();

const LaunchCurveRuleRange = z.object({ min: z.number().int().nonnegative(), max: z.number().int().positive() }).strict();

/**
 * 1.80.0 — «Правила на кривій» (SOL-L8, `lib/core/launch/curve-rules.ts`): the four rules Ryntra allows on a curve with
 * their bounds, the rules that lock a buyer in with the reason each is refused for, the scope the rules run in
 * (`UNTIL_DEX`) and the side they act on (`PURCHASE`), and the audited program that keeps them with who may change it.
 */
export const LaunchCurveRulesFormatSchema = z
  .object({
    rules: z.array(z.object({ id: z.enum(CURVE_RULE_IDS), bounds: z.record(z.string(), LaunchCurveRuleRange) }).strict()).min(1),
    forbidden: z.array(z.object({ id: z.enum(LOCKED_IN_RULE_IDS), reason: z.string().min(1).max(300) }).strict()).min(1),
    scope: z.literal(CURVE_RULES_SCOPE),
    side: z.literal(CURVE_RULES_SIDE),
    program: z
      .object({ program: Address, upgrade: z.enum(CURVE_RULES_UPGRADE), upgradeAuthority: Address.nullable(), audit: z.string().min(1).max(300) })
      .strict(),
  })
  .strict();
export type LaunchCurveRulesFormat = z.infer<typeof LaunchCurveRulesFormatSchema>;

/** A preset as the form shows it: its numbers, each the config's own. */
export const LaunchPresetSchema = z
  .object({
    id: z.enum(LAUNCH_PRESET_IDS),
    name: LaunchWords,
    pair: z.object({ mint: Address, symbol: z.string().min(1).max(12), decimals: z.number().int().min(0).max(18) }).strict(),
    /** The curve's market cap in dollars, from launch to the DEX. */
    startMarketCapUsd: z.number().positive(),
    graduationMarketCapUsd: z.number().positive(),
    /** The fee on the curve: from `startBps` falling to `endBps` over `seconds`. */
    sniperFee: z.object({ startBps: z.number().int().positive(), endBps: z.number().int().positive(), seconds: z.number().int().positive() }).strict(),
    /** The creator's share of the curve's trading fee after Meteora's 20 %. */
    creatorTradingFeePct: z.number().int().min(0).max(100),
    graduationFee: z.object({ pct: z.number().min(0).max(100), creatorPct: z.number().int().min(0).max(100) }).strict(),
    /** The most of the supply the creator's first purchase may receive, basis points. */
    firstBuyCapBps: z.number().int().positive().max(10_000),
    /**
     * 1.38.0 — a first purchase on this preset must go under the creator's lock with at least this many days before
     * anything unlocks (Micro: 180); null — the lock is the creator's choice.
     */
    creatorLockMinDays: z.number().int().positive().nullable(),
    /** 1.38.0 — the pair currency a curve must raise to reach the DEX, when the preset is named by it (Micro: 750); null — by its market cap. */
    graduationQuote: z.number().positive().nullable(),
    /** 1.38.0 — the demo market: Ryntra's technical validation, launched by Ryntra's own wallets alone; never in the presets for people. */
    technicalValidation: z.boolean(),
    /** Every share of the graduated pool's liquidity locked for ever. */
    lpLockedForeverPct: z.literal(100),
    /**
     * 1.80.0 — «Правила на кривій» (SOL-L8): this preset's token runs Ryntra's verified transfer-hook rules until the
     * DEX, so no mark says «no rule on transfers» on it. Absent on every other preset.
     */
    curveRules: z.literal(true).optional(),
    /**
     * 1.50.0 — who receives every fee, basis points of it (`lib/core/launch/preset-terms.ts`): on the curve, the same
     * through Ryntra's referral, the move to the DEX (of its fee; `toBudget` — Ryntra's part is the market's budget), and
     * the DEX pool (its fee's schedule; Meteora's part, the compounding share, the two locked positions while they are the
     * pool's only liquidity).
     */
    terms: z
      .object({
        curveSplit: LaunchFeeSharesSchema,
        curveSplitThroughRyntra: LaunchFeeSharesSchema,
        graduation: z.object({ feeBps: LaunchBpsShare, creatorBps: LaunchBpsShare, ryntraBps: LaunchBpsShare, toBudget: z.boolean() }).strict(),
        pool: z
          .object({
            startFeeBps: LaunchBpsShare,
            endFeeBps: LaunchBpsShare,
            meteoraBps: LaunchBpsShare,
            compoundingBps: LaunchBpsShare,
            creatorPositionBps: LaunchBpsShare,
            ryntraPositionBps: LaunchBpsShare,
          })
          .strict(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type LaunchPresetView = z.infer<typeof LaunchPresetSchema>;

/** 1.56.0 (SOL-L5) — «Розширений»: what the creator chooses in «Розширені параметри». */
export const LaunchAdvancedChoiceSchema = z
  .object({
    /** Whole tokens, one of the bounds' supplies. */
    supply: z.number().int().refine((value) => (ADVANCED_SUPPLIES as readonly number[]).includes(value), "one of the offered supplies"),
    startMarketCapUsd: z.number().positive(),
    graduationMarketCapUsd: z.number().positive(),
    /** The creator's share of the curve's fee after Meteora's 20 %, percent. */
    creatorTradingFeePct: z.number().int().min(0).max(100),
    sniper: z.enum(SNIPER_STRENGTHS),
    poolStartFeeBps: z.number().int().min(0).max(10_000),
    poolEndFeeBps: z.number().int().min(0).max(10_000),
    /**
     * 1.72.0 (SOL-L10) — «Комісія за переказ»: the token's fee on every transfer until the DEX, basis points; absent — none
     * (no extension on the token). Taken only where the bounds carry `transferFeeMaxBps`; RevokeZeroFee, the creator collects.
     */
    transferFeeBps: z.number().int().min(1).max(TRANSFER_FEE_MAX_BPS).optional(),
    /**
     * 1.83.0 (SOL-L11) — the pair currency the curve runs in: a mint of the register this deployment checked
     * (`GET /api/v1/launch/quote-assets`); absent — the network's own pair. The mint is read again before anything is
     * built, and a difference from what was checked refuses the build.
     */
    quoteMint: Address.optional(),
  })
  .strict();
const LaunchRange = z.object({ min: z.number().nonnegative(), max: z.number().nonnegative() }).strict();
const LaunchGraduationFeeSchema = z.object({ pct: z.number().min(0).max(100), creatorPct: z.number().int().min(0).max(100) }).strict();
/** 1.56.0 — a launch's own numbers as kept: the choice and the bounds' part in force when its config was made. */
export const LaunchAdvancedTermsSchema = LaunchAdvancedChoiceSchema.extend({ graduationFee: LaunchGraduationFeeSchema, firstBuyCapBps: z.number().int().positive().max(10_000) }).strict();
/** 1.56.0 — the bounds the operator approved for «Розширений» on this network. */
export const LaunchAdvancedBoundsSchema = z
  .object({
    supplies: z.array(z.number().int().positive()).min(1),
    startMarketCapUsd: LaunchRange,
    graduationMarketCapUsd: LaunchRange,
    multiple: LaunchRange,
    creatorTradingFeePct: LaunchRange,
    snipers: z.array(z.enum(SNIPER_STRENGTHS)).min(1),
    poolStartFeeBps: LaunchRange,
    poolEndFeeBps: LaunchRange,
    graduationFee: LaunchGraduationFeeSchema,
    firstBuyCapBps: z.number().int().positive().max(10_000),
    /** 1.72.0 (SOL-L10): the ceiling of «Комісія за переказ» where it is offered here; absent — not offered. */
    transferFeeMaxBps: z.number().int().positive().max(TRANSFER_FEE_MAX_BPS).optional(),
  })
  .strict();

/** 1.56.0 — the bounds a campaign stays inside on this network (the operator's, once). */
export const LaunchBoostBoundsSchema = z
  .object({
    currencies: z.array(z.enum(BOOST_CURRENCIES)).min(1),
    routes: z.array(z.enum(BOOST_ROUTES)).min(1),
    minBonusBps: z.number().int().min(0).max(10_000),
    maxBonusBps: z.number().int().min(0).max(10_000),
    minMinutes: z.number().nonnegative(),
    maxDays: z.number().nonnegative(),
    maxStartDays: z.number().nonnegative(),
    minHoldHours: z.number().nonnegative(),
    maxHoldHours: z.number().nonnegative(),
    minBuyFloorRaw: LaunchRaw,
    maxCapShareBps: z.number().int().min(0).max(10_000),
    maxBudgetRaw: z.object({ PAIR: LaunchRaw.nullable(), TOKEN: LaunchRaw.nullable() }).strict(),
  })
  .strict();

/** 1.56.0 — the bounds early access stays inside on this network (the operator's, once; open to people only by his word). */
export const LaunchEarlyAccessBoundsSchema = z
  .object({
    modes: z.array(z.enum(EARLY_ACCESS_MODES)).min(1),
    minCapRaw: LaunchRaw,
    maxCapRaw: LaunchRaw,
    minIndividualCapRaw: LaunchRaw,
    minDepositMinutes: z.number().nonnegative(),
    maxDepositHours: z.number().nonnegative(),
    maxStartDelayHours: z.number().nonnegative(),
    minVestingHours: z.number().nonnegative(),
    maxVestingHours: z.number().nonnegative(),
    minStartMarketCapUsd: z.number().nonnegative(),
    maxStartMarketCapUsd: z.number().nonnegative(),
    maxPresaleBps: z.number().int().min(0).max(10_000),
  })
  .strict();

export const LaunchPresetsResponseSchema = z
  .object({
    network: LaunchNetworkId,
    presets: z.array(LaunchPresetSchema).min(1),
    /**
     * 1.56.0 (SOL-L5): «Спільнота»'s community tokens, each with its own config; absent or empty — one pair, the
     * preset's own.
     */
    communities: z.array(z.object({ config: Address, mint: Address, symbol: z.string().min(1).max(12), decimals: z.number().int().min(0).max(18) }).strict()).optional(),
    /**
     * 1.56.0 (SOL-L5): the formats of «Розширені параметри» offered here — each null where it is not (on mainnet until
     * the operator gives its bounds).
     */
    formats: z
      .object({
        advanced: z.object({ bounds: LaunchAdvancedBoundsSchema }).strict().nullable(),
        boost: z.object({ bounds: LaunchBoostBoundsSchema }).strict().nullable().optional(),
        earlyAccess: z.object({ bounds: LaunchEarlyAccessBoundsSchema }).strict().nullable().optional(),
        /** 1.80.0 — «Правила на кривій» (SOL-L8): null until the operator opens the format after the independent audit of its rule program. */
        curveRules: LaunchCurveRulesFormatSchema.nullable().optional(),
      })
      .strict()
      .optional(),
    locks: z.array(z.object({ id: z.enum(CREATOR_LOCK_IDS), cliffDays: z.number().int().positive(), vestDays: z.number().int().positive() }).strict()).min(1),
    limits: z
      .object({
        nameMax: z.number().int().positive(),
        symbolMax: z.number().int().positive(),
        descriptionMax: z.number().int().positive(),
        imageMaxBytes: z.number().int().positive(),
        imageTypes: z.array(z.string().min(1)).min(1),
        launchesPerDay: z.number().int().positive(),
      })
      .strict(),
  })
  .strict();
export type LaunchPresetsResponse = z.infer<typeof LaunchPresetsResponseSchema>;

export const LaunchMetadataRequestSchema = z
  .object({
    name: z.string().max(200),
    symbol: z.string().max(40),
    description: z.string().max(2_000),
    website: z.string().max(300),
    x: z.string().max(300),
    telegram: z.string().max(300),
    /** The picture's bytes, base64, as the page shrank it. */
    imageBase64: z.string().min(1).max(400_000),
  })
  .strict();
export type LaunchMetadataRequest = z.infer<typeof LaunchMetadataRequestSchema>;

export const LaunchMetadataResponseSchema = z
  .object({ metadataUri: z.string().url(), imageUrl: z.string().url(), name: z.string(), symbol: z.string() })
  .strict();
export type LaunchMetadataResponse = z.infer<typeof LaunchMetadataResponseSchema>;

export const LaunchQuoteRequestSchema = z
  .object({
    preset: z.enum(LAUNCH_PRESET_IDS),
    amountRaw: LaunchRaw,
    /** 1.56.0: «Спільнота» — the community token the curve pairs against. */
    pairMint: Address.optional(),
    /** 1.56.0: «Розширений» — the config the creator made for the launch. */
    advancedConfig: Address.optional(),
  })
  .strict();
export type LaunchQuoteRequest = z.infer<typeof LaunchQuoteRequestSchema>;
export const LaunchQuoteResponseSchema = z
  .object({
    preset: z.enum(LAUNCH_PRESET_IDS),
    pairMint: Address,
    amountInRaw: LaunchRaw,
    tokensOutRaw: LaunchRaw,
    capRaw: LaunchRaw,
    /** The most the first purchase may spend and stay under the cap. */
    maxAmountInRaw: LaunchRaw,
    withinCap: z.boolean(),
  })
  .strict();
export type LaunchQuoteResponse = z.infer<typeof LaunchQuoteResponseSchema>;

export const LaunchBuildRequestSchema = z
  .object({
    creator: Address,
    preset: z.enum(LAUNCH_PRESET_IDS),
    metadataUri: z.string().url().max(300),
    /** The first purchase in the pair's raw units; "0" for none. */
    firstBuyRaw: LaunchRaw,
    lock: z.enum(CREATOR_LOCK_IDS).nullable(),
    /** 1.29.0, «Спільнота» only: the creator's fees shared — the creator among the wallets; absent or empty, not shared. */
    feeShares: z.array(LaunchFeeShareSchema).max(FEE_SHARE_MAX_RECIPIENTS).optional(),
    /**
     * The creator's partner (the one who brought them): "offered" — the one the review showed; "none" — removed; a code
     * or a link `/r/<code>` — another partner in its place. Absent — a client without the review: no partner is bound.
     * Bound to the pool once the launch is signed, never after.
     */
    partner: z.union([z.literal("offered"), z.literal("none"), z.object({ code: z.string().min(1).max(200) }).strict()]).optional(),
    /** 1.56.0 (SOL-L5), «Спільнота» only: the community token to pair against; may be absent where one is offered. */
    pairMint: Address.optional(),
    /** 1.56.0 (SOL-L5), «Розширений» only, and always: the config the creator made for this launch (`/api/v1/launch/advanced/config/*`). */
    advancedConfig: Address.optional(),
    /**
     * 1.71.0 (MC-1): "v1" — the creator's wallet signs v1 transactions (SIMD-0385). On Micro and the demo market a first
     * purchase is built only so: the purchase and its lock are one v1 transaction, `lockUnsignedWireBase64` is null.
     * Absent — legacy bytes as before; a first purchase there is refused `LAUNCH_WALLET_V1_REQUIRED`.
     */
    format: z.literal("v1").optional(),
    /**
     * 1.74.0 (MC-2), Classic and Protected: the crew (`/api/v1/launch/crews`) that shares the creator's fees — the vault's
     * rows are the creator and every member who said yes, read from the crew, never sent; with it, no `feeShares`.
     */
    crew: LaunchCrewId.optional(),
  })
  .strict();
export type LaunchBuildRequest = z.infer<typeof LaunchBuildRequestSchema>;

/**
 * 1.83.0 (SOL-L11) — a checked pair currency: the pair as any pair is said, and beside it whether a launch in it is open
 * now, the DBC version its own transfer fee needs, the rate a transfer of it pays, its price with the moment of the read
 * and — where it is closed — the register's own reasons. Nothing of what stands behind the pair currency is said here.
 */
export const LaunchQuoteAssetSchema = z
  .object({
    mint: Address,
    symbol: z.string().min(1).max(12),
    decimals: z.number().int().min(0).max(18),
    state: z.enum(["OPEN", "CLOSED"]),
    /** `0.2.2` — its fee needs `createConfig2`; `0.2.1` — it does not; null — the mint was not read. */
    configVersion: z.enum(QUOTE_CONFIG_VERSIONS).nullable(),
    /** What one transfer of the pair currency pays now, and the mint's cap on one transfer's fee; null — no fee at all. */
    feeNow: z.object({ epoch: z.string().regex(/^[0-9]{1,20}$/), bps: z.number().int().min(0).max(10_000), maxRaw: LaunchRaw }).strict().nullable(),
    priceUsd: z.number().positive().nullable(),
    priceAt: Iso.nullable(),
    /** Why a launch in this pair is closed, each in the register's own code; empty while it is open. */
    reasons: z.array(z.enum(QUOTE_ASSET_REFUSALS)),
  })
  .strict();
export type LaunchQuoteAsset = z.infer<typeof LaunchQuoteAssetSchema>;

export const LaunchQuoteAssetsResponseSchema = z
  .object({ network: LaunchNetworkId, assets: z.array(LaunchQuoteAssetSchema), checkedAt: Iso })
  .strict();
export type LaunchQuoteAssetsResponse = z.infer<typeof LaunchQuoteAssetsResponseSchema>;

/** 1.83.0 — one amount of a pair currency: raw, in the pair's own units, and in dollars at the price read. */
const LaunchQuoteAmountSchema = z.object({ raw: LaunchRaw, units: z.string().min(1).max(40), usd: z.number().nonnegative().nullable() }).strict();

/**
 * 1.83.0 (SOL-L11) — what a launch in a checked pair raises and what of it reaches the DEX: the threshold of this very
 * config, the fee of the move itself, what the pair's mint withholds on the transfer into the pool, and the liquidity
 * left after both.
 */
export const LaunchQuoteFiguresSchema = z
  .object({
    threshold: LaunchQuoteAmountSchema,
    graduationFee: LaunchQuoteAmountSchema,
    transferFeeOnExit: LaunchQuoteAmountSchema,
    exitLiquidity: LaunchQuoteAmountSchema,
    priceUsd: z.number().positive().nullable(),
    priceAt: Iso.nullable(),
  })
  .strict();
export type LaunchQuoteFigures = z.infer<typeof LaunchQuoteFiguresSchema>;

/**
 * 1.56.0 (SOL-L5) — «Розширений»: the launch's own config, the creator's transaction before the launch's. The creator
 * pays its rent; its fresh key signs after the creator's signature; its fee claimer is Ryntra's partner vault.
 */
export const LaunchAdvancedConfigBuildRequestSchema = z.object({ creator: Address, choice: LaunchAdvancedChoiceSchema }).strict();
export type LaunchAdvancedConfigBuildRequest = z.infer<typeof LaunchAdvancedConfigBuildRequestSchema>;
export const LaunchAdvancedConfigBuildResponseSchema = z
  .object({
    buildId: LaunchBuildId,
    network: LaunchNetworkId,
    config: Address,
    unsignedWireBase64: z.string().min(1),
    terms: LaunchAdvancedTermsSchema,
    /** The creator's SOL the config takes as simulated — its rent and fee; null when the network would not say. */
    creatorCostLamports: LaunchRaw.nullable(),
    /** 1.83.0 (SOL-L11) — where the choice named a checked pair currency: the pair, the version its fee made this config, and its figures. */
    quote: z
      .object({
        mint: Address,
        symbol: z.string().min(1).max(12),
        decimals: z.number().int().min(0).max(18),
        configVersion: z.enum(QUOTE_CONFIG_VERSIONS),
        figures: LaunchQuoteFiguresSchema,
      })
      .strict()
      .optional(),
    expiresAt: Iso,
    signableMs: SignableMs,
  })
  .strict();
export type LaunchAdvancedConfigBuildResponse = z.infer<typeof LaunchAdvancedConfigBuildResponseSchema>;
export const LaunchAdvancedConfigSubmitRequestSchema = z.object({ buildId: LaunchBuildId, creator: Address, signedWireBase64: z.string().min(1).max(4_000) }).strict();
export type LaunchAdvancedConfigSubmitRequest = z.infer<typeof LaunchAdvancedConfigSubmitRequestSchema>;
export const LaunchAdvancedConfigSubmitResponseSchema = z
  .object({ config: Address, signature: z.string(), state: z.enum(["CREATED", "PENDING"]), terms: LaunchAdvancedTermsSchema })
  .strict();
export type LaunchAdvancedConfigSubmitResponse = z.infer<typeof LaunchAdvancedConfigSubmitResponseSchema>;

export const LaunchBuildResponseSchema = z
  .object({
    buildId: LaunchBuildId,
    network: LaunchNetworkId,
    /** The creation, signed already by the new mint; the creator signs it, the server adds the pool payer's signature. */
    unsignedWireBase64: z.string().min(1),
    /** The lock of the first purchase, when chosen: signed by the escrow's fresh key; the creator signs it too. */
    lockUnsignedWireBase64: z.string().min(1).nullable(),
    token: Address,
    firstBuyOutRaw: LaunchRaw,
    /** What the creator hands Ryntra's pool payer in the creation: the rent of the accounts it opens and the fee. */
    payerCoveredLamports: LaunchRaw,
    /** The creator's SOL both transactions take, simulated before the signature: what is handed to the pool payer, the creator's own token accounts, the lock's rent and fee. */
    creatorCostLamports: LaunchRaw,
    expiresAt: Iso,
    /** AG-1 (17.10): how long from arriving the bytes may still be signed — their blockhash's life on the chain (~30 s on 200 ms slots) less a margin to send and land. Relative, so a device counts it on its own clock; past it, build again rather than sign. */
    signableMs: SignableMs.optional(),
    /** 1.29.0: the sharing of the creator's fees, when asked — signed already by the new mint; the creator signs it too. */
    splitUnsignedWireBase64: z.string().min(1).nullable().optional(),
    /** The Dynamic Fee Sharing vault that will hold the curve's creator role. */
    feeVault: Address.nullable().optional(),
    /** The partner this build will bind the pool to, masked as the review shows it; null — none; absent — no choice was asked. */
    partner: z
      .object({ partnerMasked: z.string().max(20), codeMasked: z.string().max(20), source: z.enum(["previous", "inviter", "carried", "chosen", "none"]) })
      .strict()
      .nullable()
      .optional(),
  })
  .strict();
export type LaunchBuildResponse = z.infer<typeof LaunchBuildResponseSchema>;

export const LaunchSubmitRequestSchema = z
  .object({
    buildId: LaunchBuildId,
    creator: Address,
    signedWireBase64: z.string().min(1).max(4_000),
    signedLockWireBase64: z.string().min(1).max(4_000).nullable(),
    /** 1.29.0: the signed sharing of the creator's fees, when it was built. */
    signedSplitWireBase64: z.string().min(1).max(4_000).nullable().optional(),
  })
  .strict();
export type LaunchSubmitRequest = z.infer<typeof LaunchSubmitRequestSchema>;

const LaunchLockSchema = z
  .object({ schedule: z.enum(CREATOR_LOCK_IDS), escrow: Address, signature: z.string().nullable(), state: z.enum(["LOCKED", "PENDING", "FAILED"]), reason: z.string().max(512).nullable() })
  .strict();

/** «Спільнота» sharing the creator's fees (1.29.0): SHARED once the vault holds the curve's creator role on chain; FAILED — the creator's wallet keeps it and every fee. */
const LaunchFeeSharingSchema = z
  .object({
    vault: Address,
    shares: z.array(LaunchFeeShareSchema).min(FEE_SHARE_MIN_RECIPIENTS).max(FEE_SHARE_MAX_RECIPIENTS),
    signature: z.string().nullable(),
    state: z.enum(["SHARED", "PENDING", "FAILED"]),
    reason: z.string().max(512).nullable(),
  })
  .strict();

export const LaunchSubmitResponseSchema = z
  .object({
    token: Address,
    signature: z.string().min(64).max(90),
    /** LAUNCHED — the chain confirmed the creation; PENDING — it was sent and not confirmed in time: the token's read settles it from the chain (a refused or expired creation is then not found), and the lock was not sent. */
    state: z.enum(["LAUNCHED", "PENDING"]),
    lock: LaunchLockSchema.nullable(),
    /** 1.29.0: the sharing of the creator's fees, when it was asked. */
    feeSharing: LaunchFeeSharingSchema.nullable().optional(),
    tokenPath: z.string().startsWith("/app/launch/"),
  })
  .strict();
export type LaunchSubmitResponse = z.infer<typeof LaunchSubmitResponseSchema>;

/** 1.55.0 (SOL-L3): a file Ryntra keeps for a launch — its sha256, its IPFS address, and its pinned IPFS copy (null until pinned). */
export const LaunchStoredFileSchema = z
  .object({
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    cid: z.string().regex(/^bafkrei[a-z2-7]{52}$/),
    ipfs: z.object({ url: z.string().url(), pinnedAt: Iso }).strict().nullable(),
  })
  .strict();
export type LaunchStoredFile = z.infer<typeof LaunchStoredFileSchema>;

/** 1.73.0 (SOL-L12): a pair currency's watch — what its issuer changed, and since when. */
export const LaunchPairWatchSchema = z
  .object({
    mint: Address,
    symbol: z.string().min(1).max(12),
    state: z.enum(["OK", "CHANGED"]),
    changes: z.array(z.enum(MINT_PROFILE_FIELDS)).max(MINT_PROFILE_FIELDS.length),
    since: Iso.nullable(),
    checkedAt: Iso,
  })
  .strict();
export type LaunchPairWatch = z.infer<typeof LaunchPairWatchSchema>;

export const LaunchTokenResponseSchema = z
  .object({
    network: LaunchNetworkId,
    token: Address,
    name: z.string(),
    symbol: z.string(),
    description: z.string(),
    image: z.string().url().nullable(),
    /** Set by the creator, never checked by Ryntra. */
    links: z.object({ website: z.string().url().nullable(), x: z.string().url().nullable(), telegram: z.string().url().nullable() }).strict(),
    preset: z.enum(LAUNCH_PRESET_IDS),
    creator: Address,
    launchedAt: Iso,
    signature: z.string(),
    /** The curve's way to the DEX now, basis points; null when the chain could not be read. */
    progressBps: z.number().int().min(0).max(10_000).nullable(),
    migrated: z.boolean().nullable(),
    lock: LaunchLockSchema.extend({ cliffAt: Iso.nullable(), endsAt: Iso.nullable() }).strict().nullable(),
    /** 1.29.0: «Спільнота» sharing the creator's fees, as recorded and settled by the chain; absent or null when not shared. */
    feeSharing: LaunchFeeSharingSchema.nullable().optional(),
    /** The launch receipt's facts read from the chain now; null with `receiptProblems` when the chain could not be read or a rule does not hold. */
    receipt: LaunchReceiptFactsSchema.nullable(),
    receiptProblems: z.array(z.string().max(512)),
    /** The link the creator shares — their referral code, landing on this token. */
    shareLink: z.string().url(),
    /**
     * 1.55.0 (SOL-L3): where the token's metadata and picture are kept — by Ryntra under the sha256 of their bytes, which
     * is their IPFS address (`cid`, CID v1 raw) in other letters, and their IPFS copy once pinned. Absent or null when the
     * mint's metadata is not one Ryntra keeps; `image` null when the metadata names no picture of Ryntra's.
     */
    storage: z.object({ metadata: LaunchStoredFileSchema, image: LaunchStoredFileSchema.nullable() }).strict().nullable().optional(),
    /**
     * 1.56.0 (SOL-L5): «Розширений» — the launch's own numbers and what makes its tokenomics unusual («Незвична
     * токеноміка»); absent or null on a preset's launch.
     */
    advanced: z.object({ terms: LaunchAdvancedTermsSchema, unusual: z.array(z.enum(UNUSUAL_REASONS)) }).strict().nullable().optional(),
    /** 1.56.0 (SOL-L5): «Спільнота» — the community token the curve pairs against; absent on another preset. */
    pair: z.object({ mint: Address, symbol: z.string().min(1).max(12), decimals: z.number().int().min(0).max(18) }).strict().optional(),
    /**
     * 1.73.0 (SOL-L12): the pair currency's mint as Ryntra watches it — `CHANGED` when its issuer changed the transfer
     * fee, an authority or an extension since Ryntra first read it (`changes` names what, `since` when it was first read
     * so); new launches on it wait. Absent or null while the pair has not been read.
     */
    pairWatch: LaunchPairWatchSchema.nullable().optional(),
    observedAt: Iso,
  })
  .strict();
export type LaunchTokenResponse = z.infer<typeof LaunchTokenResponseSchema>;

/* ------------------------------------------------------------ Ryntra Launch — Launch Boost (1.56.0, SOL-L5) */

/*
 * `GET /api/v1/launch/{mint}/boost` and `POST /api/v1/launch/{mint}/boost/{build,submit,payout/build,payout/submit}`: a
 * creator's campaign for buyers, from the creator's own money, its rules shown before a purchase. The budget is locked
 * in Met Lock from the creator to the creator until the window and the hold are over; the payout is counted from the
 * chain and signed by the creator. Ryntra takes 0.
 */
const BoostSignature = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,88}$/);
const BoostWire = z.string().min(1).max(4_000);
const BoostLines = z.object({ uk: z.array(z.string().max(600)).max(8), en: z.array(z.string().max(600)).max(8) }).strict();

/** A Boost amount as a creator writes it: raw units without leading zeros ("0" only as zero), so one amount has one spelling. */
const BoostRaw = z.string().regex(/^(0|[1-9][0-9]{0,29})$/);

export const LaunchBoostRulesSchema = z
  .object({
    currency: z.enum(BOOST_CURRENCIES),
    bonusBps: z.number().int().min(1).max(10_000),
    minBuyRaw: BoostRaw,
    capPerWalletRaw: BoostRaw,
    budgetRaw: BoostRaw,
    startsAt: z.number().int().nonnegative(),
    endsAt: z.number().int().nonnegative(),
    holdHours: z.number().min(0).max(24 * 366),
    routes: z.enum(BOOST_ROUTES).default("ryntra"),
  })
  .strict();
export type LaunchBoostRules = z.infer<typeof LaunchBoostRulesSchema>;

const BoostCurrency = z.object({ mint: Address, symbol: z.string().min(1).max(24), decimals: z.number().int().min(0).max(12), program: Address }).strict();

export const LaunchBoostBuildRequestSchema = z.object({ creator: Address, rules: LaunchBoostRulesSchema }).strict();
export type LaunchBoostBuildRequest = z.infer<typeof LaunchBoostBuildRequestSchema>;

export const LaunchBoostBuildResponseSchema = z
  .object({
    buildId: LaunchBuildId,
    network: LaunchNetworkId,
    /** The commitment for the creator to sign first — the fee payer; the escrow's fresh base key signs after. */
    unsignedWireBase64: BoostWire,
    escrow: Address,
    currency: BoostCurrency,
    budgetRaw: LaunchRaw,
    /** From when purchases count, and when the budget unlocks for the payout (unix seconds). */
    countsFrom: z.number().int(),
    unlocksAt: z.number().int(),
    lines: BoostLines,
    expiresAt: Iso,
    signableMs: z.number().int().nonnegative(),
  })
  .strict();
export type LaunchBoostBuildResponse = z.infer<typeof LaunchBoostBuildResponseSchema>;

export const LaunchBoostSubmitRequestSchema = z.object({ buildId: LaunchBuildId, creator: Address, signedWireBase64: BoostWire }).strict();
export type LaunchBoostSubmitRequest = z.infer<typeof LaunchBoostSubmitRequestSchema>;

export const LaunchBoostSubmitResponseSchema = z
  .object({
    /** LOCKED — the escrow is on chain; PENDING — sent, not confirmed in time: the page settles it from the escrow; FAILED — the network refused it. */
    state: z.enum(["LOCKED", "PENDING", "FAILED"]),
    signature: BoostSignature,
    escrow: Address,
    reason: z.string().max(300).nullable(),
  })
  .strict();
export type LaunchBoostSubmitResponse = z.infer<typeof LaunchBoostSubmitResponseSchema>;

export const LaunchBoostPayoutBuildRequestSchema = z.object({ creator: Address }).strict();
export type LaunchBoostPayoutBuildRequest = z.infer<typeof LaunchBoostPayoutBuildRequestSchema>;

const BoostPayoutRow = z.object({ wallet: Address, bonusRaw: LaunchRaw, firstBuyAt: z.number().int(), signature: BoostSignature }).strict();

export const LaunchBoostPayoutBuildResponseSchema = z
  .object({
    buildId: LaunchBuildId,
    network: LaunchNetworkId,
    /** The payout for the creator to sign in one window — the only signer and fee payer: the escrow claimed back first, then the transfers. */
    unsignedWireBase64: z.array(BoostWire).min(1).max(12),
    /** The wallets this build pays, in order; `remaining` — eligible wallets left for a next build. */
    rows: z.array(BoostPayoutRow).max(200),
    remaining: z.number().int().nonnegative(),
    totalRaw: LaunchRaw,
    leftoverRaw: LaunchRaw,
    claimsEscrow: z.boolean(),
    currency: BoostCurrency,
    expiresAt: Iso,
    signableMs: z.number().int().nonnegative(),
  })
  .strict();
export type LaunchBoostPayoutBuildResponse = z.infer<typeof LaunchBoostPayoutBuildResponseSchema>;

export const LaunchBoostPayoutSubmitRequestSchema = z.object({ buildId: LaunchBuildId, creator: Address, signedWireBase64: z.array(BoostWire).min(1).max(12) }).strict();
export type LaunchBoostPayoutSubmitRequest = z.infer<typeof LaunchBoostPayoutSubmitRequestSchema>;

const BoostPayoutTx = z
  .object({ signature: BoostSignature, state: z.enum(["CONFIRMED", "PENDING", "FAILED"]), wallets: z.number().int().nonnegative(), amountRaw: LaunchRaw, reason: z.string().max(300).nullable() })
  .strict();

export const LaunchBoostPayoutSubmitResponseSchema = z
  .object({
    /** PAID — every eligible wallet is paid; PARTIAL — some transactions did not land, or wallets wait for a next build; PENDING — sent, not confirmed in time. */
    state: z.enum(["PAID", "PARTIAL", "PENDING"]),
    txs: z.array(BoostPayoutTx).max(12),
    paidRaw: LaunchRaw,
  })
  .strict();
export type LaunchBoostPayoutSubmitResponse = z.infer<typeof LaunchBoostPayoutSubmitResponseSchema>;

export const LaunchBoostViewSchema = z
  .object({
    network: LaunchNetworkId,
    token: Address,
    /** The commitment: PENDING — sent, its escrow not seen yet; LOCKED — the budget is in the escrow; FAILED — it never landed. */
    state: z.enum(["PENDING", "LOCKED", "FAILED"]),
    /** NOT_READ — a read of the chain failed: the figures below that need it are null, never zero. */
    read: z.enum(["OK", "NOT_READ"]),
    rules: LaunchBoostRulesSchema,
    lines: BoostLines,
    escrow: Address,
    currency: BoostCurrency,
    countsFrom: z.number().int(),
    unlocksAt: z.number().int(),
    /** The escrow as the chain stores it; null when not read. */
    funded: z.object({ totalRaw: LaunchRaw, heldRaw: LaunchRaw, claimedRaw: LaunchRaw }).strict().nullable(),
    payout: z
      .object({
        /** As counted from the chain now (NOT_READ, WAITING, READY), or as signed (PENDING, PARTIAL, PAID). */
        state: z.enum(["NOT_READ", "WAITING", "READY", "PENDING", "PARTIAL", "PAID"]),
        recipients: z.number().int().nonnegative().nullable(),
        plannedRaw: LaunchRaw.nullable(),
        paidRaw: LaunchRaw,
        leftoverRaw: LaunchRaw.nullable(),
        signatures: z.array(BoostSignature).max(200),
      })
      .strict(),
    observedAt: Iso,
  })
  .strict();
export type LaunchBoostView = z.infer<typeof LaunchBoostViewSchema>;

/* ------------------------------------------------------------ Ryntra Launch — the creator's split (1.69.0, SOL-L2b) */

/*
 * 1.69.0 — «Частка творця за його вибором» (SOL-L2b). `GET /api/v1/launch/{mint}/split` and `POST
 * /api/v1/launch/{mint}/split/{rule,depth,payout}/{build,submit}`: the creator divides their own share of the fees —
 * собі · глибина · спільнота · холдерам — by a rule the creator signs on chain (a memo), shown on the token's page
 * before a purchase; depth is the creator's buy steps in the token's DLMM pool, holders are paid by a snapshot of the
 * chain whose root the creator's payout carries. Only the creator signs; Ryntra takes 0 and holds nothing.
 */
const SplitBps = z.number().int().min(0).max(10_000);
const SplitTxState = z.enum(["PENDING", "CONFIRMED", "FAILED"]);
const SplitLines = BoostLines;
const SplitAmounts = z.object({ depth: LaunchRaw, community: LaunchRaw, holders: LaunchRaw }).strict();

export const LaunchSplitRuleSchema = z
  .object({
    shares: z.object({ self: SplitBps, depth: SplitBps, community: SplitBps, holders: SplitBps }).strict(),
    /** The community's wallet — named when the community takes a part, null otherwise. */
    community: Address.nullable().default(null),
  })
  .strict();
export type LaunchSplitRule = z.infer<typeof LaunchSplitRuleSchema>;

export const LaunchSplitRuleBuildRequestSchema = z.object({ creator: Address, rule: LaunchSplitRuleSchema }).strict();
export type LaunchSplitRuleBuildRequest = z.infer<typeof LaunchSplitRuleBuildRequestSchema>;

export const LaunchSplitRuleBuildResponseSchema = z
  .object({
    buildId: LaunchBuildId,
    network: LaunchNetworkId,
    /** The rule's transaction for the creator to sign — its only signer and fee payer: a memo with the rule, the creator among its signers. */
    unsignedWireBase64: BoostWire,
    memo: z.string().max(300),
    rule: LaunchSplitRuleSchema,
    lines: SplitLines,
    expiresAt: Iso,
    signableMs: z.number().int().nonnegative(),
  })
  .strict();
export type LaunchSplitRuleBuildResponse = z.infer<typeof LaunchSplitRuleBuildResponseSchema>;

/** The creator's signed rule or depth act: one transaction. */
export const LaunchSplitSubmitRequestSchema = z.object({ buildId: LaunchBuildId, creator: Address, signedWireBase64: BoostWire }).strict();
export type LaunchSplitSubmitRequest = z.infer<typeof LaunchSplitSubmitRequestSchema>;

export const LaunchSplitRuleSubmitResponseSchema = z
  .object({
    /** CONFIRMED — the rule is on chain and in force; PENDING — sent, not confirmed in time: the page settles it; FAILED — the network refused it. */
    state: SplitTxState,
    signature: BoostSignature,
    reason: z.string().max(300).nullable(),
  })
  .strict();
export type LaunchSplitRuleSubmitResponse = z.infer<typeof LaunchSplitRuleSubmitResponseSchema>;

/** A depth act or a payout asked for: the creator only. */
export const LaunchSplitActBuildRequestSchema = z.object({ creator: Address }).strict();
export type LaunchSplitActBuildRequest = z.infer<typeof LaunchSplitActBuildRequestSchema>;

const SplitLadder = z.object({ lowerBinId: z.number().int(), upperBinId: z.number().int(), fromPct: z.number(), toPct: z.number() }).strict();

export const LaunchSplitDepthBuildResponseSchema = z
  .object({
    buildId: LaunchBuildId,
    network: LaunchNetworkId,
    /** POOL — the token's DLMM pool made first, on Ryntra's rule; SYNC — its price taken up to the market's through its empty bins; STEPS — the creator's buy steps placed or added to. */
    phase: z.enum(["POOL", "SYNC", "STEPS"]),
    /** The act for the creator to sign first; a new position's fresh key signs after, on the server. */
    unsignedWireBase64: BoostWire,
    pool: Address,
    position: Address.nullable(),
    amountRaw: LaunchRaw,
    owedRaw: LaunchRaw,
    ladder: SplitLadder.nullable(),
    expiresAt: Iso,
    signableMs: z.number().int().nonnegative(),
  })
  .strict();
export type LaunchSplitDepthBuildResponse = z.infer<typeof LaunchSplitDepthBuildResponseSchema>;

export const LaunchSplitDepthSubmitResponseSchema = LaunchSplitRuleSubmitResponseSchema.extend({ phase: z.enum(["POOL", "SYNC", "STEPS"]), position: Address.nullable(), amountRaw: LaunchRaw }).strict();
export type LaunchSplitDepthSubmitResponse = z.infer<typeof LaunchSplitDepthSubmitResponseSchema>;

const SplitPayoutRow = z.object({ wallet: Address, holdingRaw: LaunchRaw, amountRaw: LaunchRaw }).strict();
const SplitCommunityRow = z.object({ wallet: Address, amountRaw: LaunchRaw }).strict();
const SplitExcluded = z.object({ wallets: z.number().int().nonnegative(), amountRaw: LaunchRaw }).strict();
const SplitSnapshot = z
  .object({
    eligible: z.number().int().nonnegative(),
    /** Left out of the round, by why: `unbought` — tokens a wallet holds beyond what it bought on the market (received by a transfer). */
    excluded: z.object({ creator: SplitExcluded, linked: SplitExcluded, bundle: SplitExcluded, program: SplitExcluded, ryntra: SplitExcluded, unbought: SplitExcluded }).strict(),
  })
  .strict();
const SplitRoot = z.string().regex(/^[0-9a-f]{64}$/);
const SplitPair = z.object({ mint: Address, symbol: z.string().min(1).max(24), decimals: z.number().int().min(0).max(12), dollar: z.boolean() }).strict();

export const LaunchSplitPayoutBuildResponseSchema = z
  .object({
    buildId: LaunchBuildId,
    network: LaunchNetworkId,
    /** The round's root as a memo first, then the transfers — all for the creator to sign in one window, its only signer and fee payer. */
    unsignedWireBase64: z.array(BoostWire).min(2).max(9),
    round: z.number().int().positive(),
    root: SplitRoot,
    memo: z.string().max(300),
    rows: z.array(SplitPayoutRow).max(60),
    community: SplitCommunityRow.nullable(),
    holdersRaw: LaunchRaw,
    communityRaw: LaunchRaw,
    owed: z.object({ holdersRaw: LaunchRaw, communityRaw: LaunchRaw }).strict(),
    snapshot: SplitSnapshot.nullable(),
    pair: z.object({ mint: Address, program: Address, decimals: z.number().int().min(0).max(12), symbol: z.string().min(1).max(24), usdPrice: z.number().nonnegative(), dollar: z.boolean() }).strict(),
    expiresAt: Iso,
    signableMs: z.number().int().nonnegative(),
  })
  .strict();
export type LaunchSplitPayoutBuildResponse = z.infer<typeof LaunchSplitPayoutBuildResponseSchema>;

export const LaunchSplitPayoutSubmitRequestSchema = z.object({ buildId: LaunchBuildId, creator: Address, signedWireBase64: z.array(BoostWire).min(2).max(9) }).strict();
export type LaunchSplitPayoutSubmitRequest = z.infer<typeof LaunchSplitPayoutSubmitRequestSchema>;

const SplitPayoutTx = z
  .object({ signature: BoostSignature, state: SplitTxState, memo: z.boolean(), wallets: z.number().int().nonnegative(), amountRaw: LaunchRaw, reason: z.string().max(300).nullable() })
  .strict();

export const LaunchSplitPayoutSubmitResponseSchema = z
  .object({
    /** PAID — every transaction landed; PARTIAL — one did not, and those after it were not sent; PENDING — sent, not confirmed in time. */
    state: z.enum(["PAID", "PARTIAL", "PENDING"]),
    round: z.number().int().positive(),
    txs: z.array(SplitPayoutTx).max(9),
    paidRaw: LaunchRaw,
  })
  .strict();
export type LaunchSplitPayoutSubmitResponse = z.infer<typeof LaunchSplitPayoutSubmitResponseSchema>;

const SplitPlacement = z
  .object({
    kind: z.enum(["POOL", "SYNC", "STEPS"]),
    signature: BoostSignature,
    validUntil: z.string().max(24),
    state: SplitTxState,
    reason: z.string().max(300).nullable(),
    pool: Address,
    position: Address.nullable(),
    amountRaw: LaunchRaw,
    lowerBinId: z.number().int().nullable(),
    upperBinId: z.number().int().nullable(),
    at: Iso,
  })
  .strict();

const SplitRoundTx = z
  .object({ signature: BoostSignature, validUntil: z.string().max(24), state: SplitTxState, reason: z.string().max(300).nullable(), memo: z.boolean(), wallets: z.array(Address).max(60), holdersRaw: LaunchRaw, communityRaw: LaunchRaw })
  .strict();

export const LaunchSplitViewSchema = z
  .object({
    network: LaunchNetworkId,
    token: Address,
    creator: Address,
    /** Whether a rule, a depth act or a payout may be signed here now — closed on mainnet. */
    open: z.boolean(),
    /** NOT_READ — a read of the chain failed: the figures that need it are null, never zero. */
    read: z.enum(["OK", "NOT_READ"]),
    /** The rule in force; null — the creator has not divided their share. */
    rule: LaunchSplitRuleSchema.nullable(),
    /** When the first rule came into force (unix seconds). */
    since: z.number().int().nullable(),
    /** A rule sent and not yet seen landed. */
    pendingRule: LaunchSplitRuleSchema.nullable(),
    segments: z.array(z.object({ rule: LaunchSplitRuleSchema, since: z.number().int(), signature: BoostSignature, fromEarnedRaw: LaunchRaw }).strict()).max(50),
    /** The rule's lines as the token's page shows them before a purchase. */
    lines: SplitLines,
    pair: SplitPair,
    ledger: z
      .object({
        earnedRaw: LaunchRaw,
        claimedRaw: LaunchRaw,
        subjectRaw: LaunchRaw,
        due: z.object({ self: LaunchRaw, depth: LaunchRaw, community: LaunchRaw, holders: LaunchRaw }).strict(),
        done: SplitAmounts,
        owed: SplitAmounts,
        /** ROLE_MOVED — the curve's creator role left the creator (and their fee-sharing vault); LP_MOVED — the locked LP position left the role: what the rules owe stops growing, and never falls. */
        warnings: z.array(z.enum(["ROLE_MOVED", "LP_MOVED"])).max(2),
      })
      .strict()
      .nullable(),
    minimums: z.object({ depthRaw: LaunchRaw, communityRaw: LaunchRaw, holdersRoundRaw: LaunchRaw, perHolderRaw: LaunchRaw }).strict(),
    depth: z
      .object({
        pool: Address.nullable(),
        rule: z.object({ topGapPct: z.number(), deepestPct: z.number(), maxBins: z.number().int(), minBinStep: z.number().int() }).strict(),
        placements: z.array(SplitPlacement).max(20),
        steps: z
          .array(z.object({ position: Address, pool: Address, lowerBinId: z.number().int(), upperBinId: z.number().int(), pairRaw: LaunchRaw.nullable(), tokenRaw: LaunchRaw.nullable(), feePairRaw: LaunchRaw.nullable() }).strict())
          .max(20),
      })
      .strict(),
    rounds: z
      .array(
        z
          .object({
            round: z.number().int().positive(),
            root: SplitRoot,
            rows: z.array(SplitPayoutRow).max(60),
            community: SplitCommunityRow.nullable(),
            snapshot: SplitSnapshot.nullable(),
            txs: z.array(SplitRoundTx).max(9),
            at: Iso,
          })
          .strict(),
      )
      .max(20),
    observedAt: Iso,
  })
  .strict();
export type LaunchSplitView = z.infer<typeof LaunchSplitViewSchema>;

/* ------------------------------------------------------------ Ryntra Launch — a distribution campaign (1.84.0, DROP-2) */

/*
 * «Кампанія розподілу»: vesting and a Merkle claim on Met Lock (spec §10.2–§10.5, the operator's variant А of 25.10).
 * The campaign publishes a list and a root, locks exactly what the list adds up to, and then does nothing — each
 * recipient takes their own allocation with their own signature, and a second claim of a row cannot exist on chain.
 */

const DistributionRaw = z.string().regex(/^(0|[1-9][0-9]{0,29})$/);
const DistributionHash = z.string().regex(/^[0-9a-f]{64}$/);
const DistributionLines = z.object({ uk: z.array(z.string().max(600)).max(8), en: z.array(z.string().max(600)).max(8) }).strict();

export const LaunchDistributionSnapshotSchema = z
  .object({ mint: Address, slot: z.number().int().positive(), finality: z.enum(["finalized", "confirmed"]), takenAt: z.number().int().nonnegative(), exclusions: z.array(z.enum(SNAPSHOT_EXCLUSIONS)).max(6) })
  .strict();

export const LaunchDistributionEligibilitySchema = z
  .object({
    minHoldingRaw: DistributionRaw,
    requireBought: z.boolean(),
    heldSinceSlot: z.number().int().positive().nullable(),
    oneWalletPerFundingSource: z.boolean(),
    oneWalletPerDevice: z.boolean(),
    maxPerCluster: z.number().int().min(0).max(100),
    kyc: z.boolean(),
    minTrust: z.number().int().min(0).max(100),
  })
  .strict();

export const LaunchDistributionCalculationSchema = z
  .object({
    mode: z.enum(CALCULATION_MODES),
    potRaw: DistributionRaw,
    capPerWalletRaw: DistributionRaw.nullable(),
    floorPerWalletRaw: DistributionRaw,
    maxWallets: z.number().int().positive().max(2_000),
    tiers: z.array(z.object({ fromRaw: DistributionRaw, weight: z.number().int().positive().max(1_000) }).strict()).max(8),
  })
  .strict();

export const LaunchDistributionDraftSchema = z
  .object({
    scenario: z.enum(DISTRIBUTION_SCENARIOS),
    token: Address,
    owner: Address,
    leftoverRecipient: Address,
    currency: z.object({ mint: Address, decimals: z.number().int().min(0).max(12), symbol: z.string().min(1).max(24) }).strict(),
    snapshot: LaunchDistributionSnapshotSchema.nullable(),
    eligibility: LaunchDistributionEligibilitySchema,
    calculation: LaunchDistributionCalculationSchema,
    vesting: z
      .object({ startsAt: z.number().int().nonnegative(), cliffDays: z.number().int().min(0).max(VESTING_MAX_DAYS), unlockDays: z.number().int().min(0).max(VESTING_MAX_DAYS), periodHours: z.number().positive().max(24 * 366) })
      .strict(),
    cancel: z.enum(MET_LOCK_ACTORS),
    expiry: z.number().int().positive().nullable(),
    kyc: z.boolean(),
    afterDex: z.boolean(),
  })
  .strict();
export type LaunchDistributionDraft = z.infer<typeof LaunchDistributionDraftSchema>;

const DistributionFee = z.object({ what: z.string().max(200), payer: z.enum(["owner", "recipient"]), amountRaw: DistributionRaw.nullable(), currency: z.enum(["token", "sol"]) }).strict();
const DistributionEnforced = z.object({ fact: z.string().max(300), by: z.enum(["program", "ryntra"]) }).strict();
const DistributionHeldBack = z.object({ wallet: Address, reasons: z.array(z.enum(ELIGIBILITY_REASONS)).max(8) }).strict();

export const LaunchDistributionReviewSchema = z
  .object({
    protocol: z
      .object({ protocol: z.enum(DISTRIBUTION_PROTOCOLS), why: z.enum(PROTOCOL_REASONS), open: z.boolean(), missing: z.array(z.string().max(300)).max(8) })
      .strict(),
    root: DistributionHash.nullable(),
    maxClaimAmountRaw: DistributionRaw,
    maxEscrow: z.number().int().nonnegative(),
    allocatedRaw: DistributionRaw,
    fundingRaw: DistributionRaw,
    leftoverRaw: DistributionRaw,
    wallets: z.number().int().nonnegative(),
    fees: z.array(DistributionFee).max(8),
    enforced: z.array(DistributionEnforced).max(12),
    warnings: z.array(z.enum(DISTRIBUTION_WARNINGS)).max(6),
  })
  .strict();
export type LaunchDistributionReview = z.infer<typeof LaunchDistributionReviewSchema>;

export const LaunchDistributionBuildRequestSchema = z.object({ owner: Address, draft: LaunchDistributionDraftSchema, list: z.array(z.object({ wallet: Address, holdingRaw: DistributionRaw }).strict()).max(2_000).optional() }).strict();
export type LaunchDistributionBuildRequest = z.infer<typeof LaunchDistributionBuildRequestSchema>;

export const LaunchDistributionBuildResponseSchema = z
  .object({
    buildId: LaunchBuildId,
    campaignId: LaunchBuildId,
    network: LaunchNetworkId,
    /** The one transaction the owner signs: the root written and funded with exactly the list's total. */
    unsignedWireBase64: z.string().min(1).max(4_000),
    rootEscrow: Address,
    root: DistributionHash,
    wallets: z.number().int().positive(),
    fundingRaw: DistributionRaw,
    review: LaunchDistributionReviewSchema,
    snapshotDigest: DistributionHash.nullable(),
    heldBack: z.array(DistributionHeldBack).max(200),
    expiresAt: Iso,
    signableMs: z.number().int().nonnegative(),
  })
  .strict();
export type LaunchDistributionBuildResponse = z.infer<typeof LaunchDistributionBuildResponseSchema>;

export const LaunchDistributionSubmitRequestSchema = z.object({ buildId: LaunchBuildId, owner: Address, signedWireBase64: z.string().min(1).max(4_000) }).strict();
export type LaunchDistributionSubmitRequest = z.infer<typeof LaunchDistributionSubmitRequestSchema>;

export const LaunchDistributionSubmitResponseSchema = z
  .object({
    /** FUNDED — the root escrow is on chain and holds the list; PENDING — sent, not confirmed in time; FAILED — refused. */
    state: z.enum(["FUNDED", "PENDING", "FAILED"]),
    campaignId: LaunchBuildId,
    signature: z.string().min(64).max(96),
    rootEscrow: Address,
    reason: z.string().max(300).nullable(),
  })
  .strict();
export type LaunchDistributionSubmitResponse = z.infer<typeof LaunchDistributionSubmitResponseSchema>;

const DistributionReconcile = z
  .object({
    state: z.enum(RECONCILE_STATES),
    fundedRaw: DistributionRaw.nullable(),
    distributedRaw: DistributionRaw.nullable(),
    escrowsMade: z.number().int().nonnegative().nullable(),
    listRaw: DistributionRaw,
    listWallets: z.number().int().nonnegative(),
    unassignedRaw: DistributionRaw.nullable(),
  })
  .strict();

const DistributionLeftover = z.object({ kind: z.enum(LEFTOVER_KINDS), amountRaw: DistributionRaw, recoverable: z.boolean(), how: z.string().max(300) }).strict();

export const LaunchDistributionViewSchema = z
  .object({
    campaignId: LaunchBuildId,
    token: Address,
    owner: Address,
    stage: z.enum(DISTRIBUTION_STAGES),
    protocol: z.enum(DISTRIBUTION_PROTOCOLS),
    state: z.enum(["PENDING", "FUNDED", "FAILED"]),
    /** NOT_READ — a read of the chain failed: the reconciliation's figures are null, never zero. */
    read: z.enum(["OK", "NOT_READ"]),
    currency: z.object({ mint: Address, program: Address, decimals: z.number().int().min(0).max(12), symbol: z.string().min(1).max(24) }).strict(),
    root: DistributionHash,
    rootEscrow: Address,
    snapshotDigest: DistributionHash.nullable(),
    wallets: z.number().int().nonnegative(),
    fundingRaw: DistributionRaw,
    review: LaunchDistributionReviewSchema,
    reconcile: DistributionReconcile,
    leftovers: z.array(DistributionLeftover).max(3),
    heldBack: z.array(DistributionHeldBack).max(200),
    claimed: z.object({ wallets: z.number().int().nonnegative(), amountRaw: DistributionRaw }).strict(),
    report: DistributionLines,
    observedAt: Iso,
  })
  .strict();
export type LaunchDistributionView = z.infer<typeof LaunchDistributionViewSchema>;

export const LaunchDistributionListSchema = z.object({ network: LaunchNetworkId, token: Address, campaigns: z.array(LaunchDistributionViewSchema).max(20), observedAt: Iso }).strict();
export type LaunchDistributionList = z.infer<typeof LaunchDistributionListSchema>;

const DistributionReceipt = z.object({ signature: z.string().min(64).max(96), amountRaw: DistributionRaw, at: z.number().int().nonnegative() }).strict();

export const LaunchDistributionClaimPanelSchema = z
  .object({
    state: z.enum(CLAIM_STATES),
    owedRaw: DistributionRaw.nullable(),
    takenRaw: DistributionRaw.nullable(),
    leftRaw: DistributionRaw.nullable(),
    claimableRaw: DistributionRaw.nullable(),
    nextUnlockAt: z.number().int().nullable(),
    endsAt: z.number().int().nullable(),
    receipts: z.array(DistributionReceipt).max(50),
    escrow: Address.nullable(),
  })
  .strict();
export type LaunchDistributionClaimPanel = z.infer<typeof LaunchDistributionClaimPanelSchema>;

export const LaunchDistributionClaimViewSchema = z
  .object({
    campaignId: LaunchBuildId,
    wallet: Address,
    currency: z.object({ mint: Address, program: Address, decimals: z.number().int().min(0).max(12), symbol: z.string().min(1).max(24) }).strict(),
    panel: LaunchDistributionClaimPanelSchema,
    /** Why the row waits for a person, when it does — never a word about who they are. */
    reviewReasons: z.array(z.enum(ELIGIBILITY_REASONS)).max(8),
  })
  .strict();
export type LaunchDistributionClaimView = z.infer<typeof LaunchDistributionClaimViewSchema>;

export const LaunchDistributionClaimBuildRequestSchema = z.object({ wallet: Address }).strict();
export type LaunchDistributionClaimBuildRequest = z.infer<typeof LaunchDistributionClaimBuildRequestSchema>;

export const LaunchDistributionClaimBuildResponseSchema = z
  .object({
    buildId: LaunchBuildId,
    network: LaunchNetworkId,
    /** The recipient's own transaction: they are the only signer and the only payer. */
    unsignedWireBase64: z.string().min(1).max(4_000),
    escrow: Address,
    amountRaw: DistributionRaw,
    panel: LaunchDistributionClaimPanelSchema,
    expiresAt: Iso,
    signableMs: z.number().int().nonnegative(),
  })
  .strict();
export type LaunchDistributionClaimBuildResponse = z.infer<typeof LaunchDistributionClaimBuildResponseSchema>;

export const LaunchDistributionClaimSubmitRequestSchema = z.object({ buildId: LaunchBuildId, wallet: Address, signedWireBase64: z.string().min(1).max(4_000) }).strict();
export type LaunchDistributionClaimSubmitRequest = z.infer<typeof LaunchDistributionClaimSubmitRequestSchema>;

export const LaunchDistributionClaimSubmitResponseSchema = z
  .object({
    state: z.enum(["CLAIMED", "PENDING", "FAILED"]),
    signature: z.string().min(64).max(96),
    amountRaw: DistributionRaw,
    escrow: Address,
    reason: z.string().max(300).nullable(),
  })
  .strict();
export type LaunchDistributionClaimSubmitResponse = z.infer<typeof LaunchDistributionClaimSubmitResponseSchema>;

export const LaunchDistributionRecoverBuildRequestSchema = z.object({ owner: Address, wallet: Address }).strict();
export type LaunchDistributionRecoverBuildRequest = z.infer<typeof LaunchDistributionRecoverBuildRequestSchema>;

export const LaunchDistributionRecoverBuildResponseSchema = z
  .object({
    buildId: LaunchBuildId,
    network: LaunchNetworkId,
    unsignedWireBase64: z.string().min(1).max(4_000),
    escrow: Address,
    /** What the cancellation returns to the owner, and what it leaves the recipient — everything that had vested. */
    toOwnerRaw: DistributionRaw,
    toRecipientRaw: DistributionRaw,
    expiresAt: Iso,
    signableMs: z.number().int().nonnegative(),
  })
  .strict();
export type LaunchDistributionRecoverBuildResponse = z.infer<typeof LaunchDistributionRecoverBuildResponseSchema>;

export const LaunchDistributionRecoverSubmitRequestSchema = z.object({ buildId: LaunchBuildId, owner: Address, signedWireBase64: z.string().min(1).max(4_000) }).strict();
export type LaunchDistributionRecoverSubmitRequest = z.infer<typeof LaunchDistributionRecoverSubmitRequestSchema>;

export const LaunchDistributionRecoverSubmitResponseSchema = z
  .object({
    state: z.enum(["RETURNED", "PENDING", "FAILED"]),
    signature: z.string().min(64).max(96),
    toOwnerRaw: DistributionRaw,
    toRecipientRaw: DistributionRaw,
    reason: z.string().max(300).nullable(),
  })
  .strict();
export type LaunchDistributionRecoverSubmitResponse = z.infer<typeof LaunchDistributionRecoverSubmitResponseSchema>;


/* ------------------------------------------------------------ Ryntra Launch — early access (1.56.0, SOL-L5) */

/*
 * «Пресейл і ранній доступ»: a kind of launch of its own on Meteora — an honest Token-2022 mint, a DAMM v2 pool whose
 * creator's position is locked for ever, and an Alpha Vault (FCFS or Pro Rata) that collects deposits and buys first at
 * the start price, its tokens released by a schedule. `POST /api/v1/launch/early-access/{build,submit}`,
 * `GET /api/v1/launch/{mint}/early-access`, `POST /api/v1/launch/{mint}/early-access/deposit/{build,submit}`. Closed to
 * people; on mainnet also until his bounds.
 */
const EaAddress = Address;
/* A raw amount the chain can hold: up to 20 digits, and no more than a u64 — above it is a VALIDATION_ERROR, never a build. */
const EaRaw = z
  .string()
  .regex(/^(0|[1-9]\d{0,19})$/)
  .refine((value) => !/^\d{1,20}$/.test(value) || BigInt(value) <= 18_446_744_073_709_551_615n, "The amount is above what the chain can hold (2^64 − 1).");
const EaBuildId = z.string().regex(/^[0-9a-f]{32}$/);
const EaWire = z.string().min(1).max(4_000);
const EaUnixSeconds = z.number().int().min(0).max(4_102_444_800);
const EaLines = z.object({ uk: z.array(z.string()), en: z.array(z.string()) }).strict();

export const LaunchEarlyAccessRulesSchema = z
  .object({
    mode: z.enum(EARLY_ACCESS_MODES),
    depositStartsAt: EaUnixSeconds,
    depositEndsAt: EaUnixSeconds,
    maxCapRaw: EaRaw,
    individualCapRaw: EaRaw.nullable(),
    vestingHours: z.number().min(0).max(24 * 365),
    startMarketCapUsd: z.number().positive().max(1e12),
    supply: z.number().int().min(EARLY_ACCESS_TOKEN.minSupply).max(EARLY_ACCESS_TOKEN.maxSupply).default(EARLY_ACCESS_TOKEN.defaultSupply),
  })
  .strict();

const EaScheduleSchema = z
  .object({ depositStartsAt: EaUnixSeconds, depositEndsAt: EaUnixSeconds, fillStartsAt: EaUnixSeconds, activatesAt: EaUnixSeconds, vestingStartsAt: EaUnixSeconds, vestingEndsAt: EaUnixSeconds })
  .strict();

const EaStepSchema = z.object({ signature: z.string().nullable(), state: z.enum(["CONFIRMED", "PENDING", "FAILED", "NOT_SENT"]), reason: z.string().nullable() }).strict();
const EaStepsSchema = z.object({ MINT: EaStepSchema, POOL: EaStepSchema, VAULT: EaStepSchema }).strict();

const EaFillSchema = z
  .object({
    spentRaw: EaRaw,
    feeRaw: EaRaw,
    tokensOutRaw: EaRaw,
    shareBps: z.number().int().min(0).max(10_000),
    averagePriceUsd: z.number().min(0),
    priceAfterUsd: z.number().min(0),
    marketCapAfterUsd: z.number().min(0),
    refundRaw: EaRaw,
  })
  .strict();

export const LaunchEarlyAccessBuildRequestSchema = z.object({ creator: EaAddress, metadataUri: z.string().url().max(512), rules: LaunchEarlyAccessRulesSchema }).strict();
export type LaunchEarlyAccessBuildRequest = z.infer<typeof LaunchEarlyAccessBuildRequestSchema>;

export const LaunchEarlyAccessBuildResponseSchema = z
  .object({
    buildId: EaBuildId,
    network: z.enum(["solana:devnet", "solana:mainnet"]),
    /** MINT, POOL, VAULT — the creator's wallet signs all three; sent in this order, each after the one before lands. */
    unsignedWireBase64: z.array(z.string().min(1)).length(3),
    mint: EaAddress,
    pool: EaAddress,
    vault: EaAddress,
    schedule: EaScheduleSchema,
    lines: EaLines,
    presaleBps: z.number().int().min(0).max(10_000),
    expiresAt: z.string(),
    signableMs: z.number().int().min(0),
  })
  .strict();
export type LaunchEarlyAccessBuildResponse = z.infer<typeof LaunchEarlyAccessBuildResponseSchema>;

export const LaunchEarlyAccessSubmitRequestSchema = z.object({ buildId: EaBuildId, creator: EaAddress, signedWireBase64: z.array(EaWire).length(3) }).strict();
export type LaunchEarlyAccessSubmitRequest = z.infer<typeof LaunchEarlyAccessSubmitRequestSchema>;

export const LaunchEarlyAccessSubmitResponseSchema = z
  .object({ mint: EaAddress, pool: EaAddress, vault: EaAddress, state: z.enum(["PENDING", "OPEN", "PARTIAL"]), steps: EaStepsSchema, tokenPath: z.string() })
  .strict();
export type LaunchEarlyAccessSubmitResponse = z.infer<typeof LaunchEarlyAccessSubmitResponseSchema>;

export const LaunchEarlyAccessDepositBuildRequestSchema = z.object({ wallet: EaAddress, amountRaw: EaRaw }).strict();
export type LaunchEarlyAccessDepositBuildRequest = z.infer<typeof LaunchEarlyAccessDepositBuildRequestSchema>;

export const LaunchEarlyAccessDepositBuildResponseSchema = z
  .object({ buildId: EaBuildId, network: z.enum(["solana:devnet", "solana:mainnet"]), unsignedWireBase64: z.string().min(1), escrow: EaAddress, opensEscrow: z.boolean(), amountRaw: EaRaw, expiresAt: z.string(), signableMs: z.number().int().min(0) })
  .strict();
export type LaunchEarlyAccessDepositBuildResponse = z.infer<typeof LaunchEarlyAccessDepositBuildResponseSchema>;

export const LaunchEarlyAccessDepositSubmitRequestSchema = z.object({ buildId: EaBuildId, wallet: EaAddress, signedWireBase64: EaWire }).strict();
export type LaunchEarlyAccessDepositSubmitRequest = z.infer<typeof LaunchEarlyAccessDepositSubmitRequestSchema>;

export const LaunchEarlyAccessDepositSubmitResponseSchema = z.object({ state: z.enum(["CONFIRMED", "PENDING"]), signature: z.string() }).strict();
export type LaunchEarlyAccessDepositSubmitResponse = z.infer<typeof LaunchEarlyAccessDepositSubmitResponseSchema>;

/**
 * After the deposits: CLAIM — the tokens vested so far; WITHDRAW_REMAINING — the USDC the vault did not spend, once
 * trading opens; WITHDRAW — Pro Rata, while deposits are open, the deposit back (all of it unless `amountRaw` names a
 * part); FILL — the vault's purchase, a permissionless crank any wallet sends and pays for, in the hour before trading.
 */
const EaActionSchema = z.enum(["CLAIM", "WITHDRAW_REMAINING", "WITHDRAW", "FILL"]);
export const LaunchEarlyAccessActionBuildRequestSchema = z.object({ wallet: EaAddress, action: EaActionSchema, amountRaw: EaRaw.nullable().optional() }).strict();
export type LaunchEarlyAccessActionBuildRequest = z.infer<typeof LaunchEarlyAccessActionBuildRequestSchema>;

export const LaunchEarlyAccessActionBuildResponseSchema = z
  .object({
    buildId: EaBuildId,
    network: z.enum(["solana:devnet", "solana:mainnet"]),
    /** For the wallet to sign as the fee payer and only signer. */
    unsignedWireBase64: z.string().min(1),
    action: EaActionSchema,
    /** What it moves as read at the build — the tokens claimed, the USDC taken back; null for FILL. */
    amountRaw: EaRaw.nullable(),
    expiresAt: z.string(),
    signableMs: z.number().int().min(0),
  })
  .strict();
export type LaunchEarlyAccessActionBuildResponse = z.infer<typeof LaunchEarlyAccessActionBuildResponseSchema>;

export const LaunchEarlyAccessActionSubmitRequestSchema = z.object({ buildId: EaBuildId, wallet: EaAddress, signedWireBase64: EaWire }).strict();
export type LaunchEarlyAccessActionSubmitRequest = z.infer<typeof LaunchEarlyAccessActionSubmitRequestSchema>;

export const LaunchEarlyAccessActionSubmitResponseSchema = z.object({ state: z.enum(["CONFIRMED", "PENDING"]), signature: z.string() }).strict();
export type LaunchEarlyAccessActionSubmitResponse = z.infer<typeof LaunchEarlyAccessActionSubmitResponseSchema>;

export const LaunchEarlyAccessViewSchema = z
  .object({
    network: z.enum(["solana:devnet", "solana:mainnet"]),
    mint: EaAddress,
    pool: EaAddress,
    vault: EaAddress,
    creator: EaAddress,
    name: z.string(),
    symbol: z.string(),
    rules: LaunchEarlyAccessRulesSchema,
    schedule: EaScheduleSchema,
    lines: EaLines,
    state: z.enum(EARLY_ACCESS_PHASES),
    creation: z.object({ state: z.enum(["PENDING", "OPEN", "PARTIAL"]), steps: EaStepsSchema }).strict(),
    terms: z.object({ startPriceUsd: z.number(), presaleBps: z.number().int(), ryntraShareBps: z.literal(0), atCap: EaFillSchema }).strict(),
    read: z.enum(["OK", "MISSING", "FAILED"]),
    depositedRaw: EaRaw.nullable(),
    capRaw: EaRaw,
    depositors: EaRaw.nullable(),
    boughtRaw: EaRaw.nullable(),
    filled: z.boolean().nullable(),
    atDeposited: EaFillSchema.nullable(),
    chainProblems: z.array(z.string()),
    mine: z
      .object({ depositedRaw: EaRaw, claimableRaw: EaRaw, claimedRaw: EaRaw, allocatedRaw: EaRaw, remainingQuoteRaw: EaRaw, roomRaw: EaRaw.nullable(), refunded: z.boolean() })
      .strict()
      .nullable(),
  })
  .strict();
export type LaunchEarlyAccessViewResponse = z.infer<typeof LaunchEarlyAccessViewSchema>;

/* ------------------------------------------------------------ Ryntra Launch — the market and trading (1.27.0) */

const LaunchSide = z.enum(LAUNCH_TRADE_SIDES);
const LaunchTradeVenueSchema = z.enum(LAUNCH_TRADE_VENUES);
const LaunchLabels = z.array(z.enum(LAUNCH_HOLDER_LABELS)).max(LAUNCH_HOLDER_LABELS.length);
const LaunchSignature = z.string().min(64).max(90);
const LaunchBps = z.number().int().min(0).max(10_000);
const LaunchFigure = z.number().nonnegative();
/** A figure in the pair currency and, when the pair is a dollar, in dollars. */
const LaunchMoney = z.object({ pair: LaunchFigure, usd: LaunchFigure.nullable() }).strict();
const LaunchSlippage = z.number().int().min(1).max(5_000);

export const LaunchTradeRowSchema = z
  .object({
    signature: LaunchSignature,
    at: Iso,
    side: LaunchSide,
    venue: LaunchTradeVenueSchema,
    /** Whose tokens moved: the owner of the account that received them on a buy, that gave them on a sale. */
    trader: Address,
    /** Who paid for it — another wallet than the trader when someone bought for someone else. */
    payer: Address,
    /** The labels the trader carries on this token. */
    traderLabels: LaunchLabels,
    tokensRaw: LaunchRaw,
    /** Paid by the buyer, fee included; received by the seller, fee taken — in the pair currency. */
    pairRaw: LaunchRaw,
    feeRaw: LaunchRaw,
    /** The market cap the trade left, in the pair currency. */
    marketCapPair: LaunchFigure,
  })
  .strict();
export type LaunchTradeRow = z.infer<typeof LaunchTradeRowSchema>;

export const LaunchHolderRowSchema = z
  .object({
    /** A wallet, or the vault or escrow account when the holder is not a person. */
    owner: Address,
    amountRaw: LaunchRaw,
    shareBps: LaunchBps,
    labels: LaunchLabels,
  })
  .strict();
export type LaunchHolderRow = z.infer<typeof LaunchHolderRowSchema>;

export const LaunchRiskFactSchema = z
  .object({
    code: z.enum(LAUNCH_RISK_CODES),
    /** `attention` — worth a look before a trade; `info` — context. Never a verdict. */
    level: z.enum(["attention", "info"]),
    /** The figures a client builds its words from: shares in basis points, counts, times in unix seconds. */
    values: z.record(z.string().min(1).max(32), z.number()),
    /** Where anyone can see it: the transaction or the account; null for a count over many. */
    source: z.object({ kind: z.enum(["tx", "account"]), id: z.string().min(32).max(90) }).strict().nullable(),
  })
  .strict();
export type LaunchRiskFactView = z.infer<typeof LaunchRiskFactSchema>;

export const LaunchCreatorLaunchSchema = z
  .object({
    token: Address,
    name: z.string(),
    symbol: z.string(),
    preset: z.enum(LAUNCH_PRESET_IDS),
    launchedAt: Iso,
    /** The curve's way to the DEX now; null when it could not be read. */
    progressBps: LaunchBps.nullable(),
    migrated: z.boolean().nullable(),
    /** How much the creator sold, by `creatorSoldOf`; 0 when nothing; null when the history could not be read whole. */
    creatorSoldBps: LaunchBps.nullable(),
    /** What `creatorSoldBps` is a share of: what they bought here, or the supply when they sold more than that; null when they sold nothing or it was not read. */
    creatorSoldOf: z.enum(["bought", "supply"]).nullable(),
  })
  .strict();

export const LaunchMarketResponseSchema = z
  .object({
    network: LaunchNetworkId,
    token: Address,
    /** Where the token trades now: its curve, or the pool it graduated into. */
    venue: LaunchTradeVenueSchema,
    pair: z.object({ mint: Address, symbol: z.string().min(1).max(12), decimals: z.number().int().min(0).max(18), dollar: z.boolean() }).strict(),
    supplyRaw: LaunchRaw,
    tokenDecimals: z.number().int().min(0).max(18),
    /** The price of one token now. */
    price: LaunchMoney,
    marketCap: LaunchMoney,
    /** The price now against the curve's opening price, basis points, signed. */
    sinceLaunchBps: z.number().int(),
    /** On the curve, what the curve holds of the pair currency; in the pool, the pool's two sides at the price now. */
    liquidity: LaunchMoney,
    volume24h: LaunchMoney.extend({ complete: z.boolean() }).strict(),
    progress: z.object({ bps: LaunchBps, migrated: z.boolean(), reserveRaw: LaunchRaw, thresholdRaw: LaunchRaw }).strict(),
    /** The curve's fee for a buy now and when the falling fee for snipers ends; null after graduation. */
    curveFee: z.object({ nowBps: LaunchBps.nullable(), endBps: LaunchBps, sniperUntil: Iso.nullable() }).strict().nullable(),
    holders: z
      .object({
        /** People holding the token; `atLeast` when the node could not count the whole mint and these are the ones found. */
        count: z.number().int().nonnegative(),
        atLeast: z.boolean(),
        rows: z.array(LaunchHolderRowSchema).max(100),
        groups: z
          .object({
            creatorBps: LaunchBps,
            /** Null when the token's opening minutes could not be read: not known, never «none». */
            snipers: z.object({ shareBps: LaunchBps, wallets: z.number().int().nonnegative() }).strict().nullable(),
            /** `atLeast`: the history was read only in part, and a buy the creator's wallet paid for may be among the trades not read — a floor, not a count. */
            bundle: z.object({ shareBps: LaunchBps, wallets: z.number().int().nonnegative(), atLeast: z.boolean() }).strict().nullable(),
            top10Bps: LaunchBps,
          })
          .strict(),
      })
      .strict(),
    trades: z
      .object({
        /** The newest first. */
        rows: z.array(LaunchTradeRowSchema).max(100),
        /** Every trade of the token was read; false when only the newest were. */
        complete: z.boolean(),
        read: z.number().int().nonnegative(),
      })
      .strict(),
    chart: z
      .object({
        /** The market cap in the pair currency, one point a second at most, from the curve's opening to now. */
        points: z.array(z.object({ t: z.number().int().nonnegative(), marketCapPair: LaunchFigure }).strict()).max(2_000),
        markers: z.array(z.object({ t: z.number().int().nonnegative(), kind: z.enum(LAUNCH_CHART_MARKERS), signature: LaunchSignature }).strict()).max(500),
      })
      .strict(),
    risk: z.array(LaunchRiskFactSchema).max(LAUNCH_RISK_CODES.length),
    creator: z
      .object({
        address: Address,
        /** Meteora DBC curves this wallet opened anywhere, this one included; null when the node does not answer. */
        curves: z.number().int().nonnegative().nullable(),
        /**
         * Whether every trade of the creator's wallet on this token was read — what they bought and sold and every buy
         * their wallet paid for, from their own accounts since the token opened. False: «the creator sold» may be
         * missing, and is said so rather than read as «did not sell».
         */
        tradesComplete: z.boolean(),
      })
      .strict(),
    trading: z
      .object({
        venue: LaunchTradeVenueSchema,
        /** The curve, or the graduated pool. */
        pool: Address,
        /** Whether Ryntra's referral account rides in each trade here. */
        referral: z.boolean(),
        /** Whether the token can also be traded through Jupiter on this network — after graduation, on mainnet. */
        jupiter: z.boolean(),
      })
      .strict(),
    observedAt: Iso,
  })
  .strict();
export type LaunchMarketResponse = z.infer<typeof LaunchMarketResponseSchema>;

/** `GET /api/v1/launch/{mint}/creator` — the creator's other Ryntra launches and what became of each, read after the market. */
export const LaunchCreatorResponseSchema = z
  .object({ network: LaunchNetworkId, token: Address, creator: Address, launches: z.array(LaunchCreatorLaunchSchema).max(10), observedAt: Iso })
  .strict();
export type LaunchCreatorResponse = z.infer<typeof LaunchCreatorResponseSchema>;

/** What a wallet holds for trading a launch: the token and the pair currency, raw. Public data, read from the chain now. */
export const LaunchWalletResponseSchema = z
  .object({ wallet: Address, token: Address, tokenRaw: LaunchRaw, pairRaw: LaunchRaw, observedAt: Iso })
  .strict();
export type LaunchWalletResponse = z.infer<typeof LaunchWalletResponseSchema>;

export const LaunchTradeQuoteRequestSchema = z.object({ side: LaunchSide, amountRaw: LaunchRaw, slippageBps: LaunchSlippage }).strict();
export type LaunchTradeQuoteRequest = z.infer<typeof LaunchTradeQuoteRequestSchema>;

export const LaunchTradeQuoteResponseSchema = z
  .object({
    venue: LaunchTradeVenueSchema,
    side: LaunchSide,
    /** What the trade spends: the pair currency on a buy, the token on a sale. */
    amountInRaw: LaunchRaw,
    amountOutRaw: LaunchRaw,
    /** The least it receives and still lands. */
    minimumOutRaw: LaunchRaw,
    /** A buy the curve cannot take whole before it graduates leaves this much unspent. */
    amountLeftRaw: LaunchRaw,
    slippageBps: LaunchSlippage,
    /** Every fee of the trade as a share of what moves. */
    feeBps: LaunchBps,
    /** Who gets the fee, in the pair currency: on the curve the creator, Ryntra (partner and referral) and Meteora; in the pool the locked liquidity, Meteora and Ryntra's referral. */
    fee: z
      .object({
        totalRaw: LaunchRaw,
        creatorRaw: LaunchRaw.nullable(),
        ryntraRaw: LaunchRaw,
        meteoraRaw: LaunchRaw,
        liquidityRaw: LaunchRaw.nullable(),
        /**
         * 1.50.0 — in the pool, `liquidityRaw` split: the creator's and Ryntra's locked positions of the move to the DEX,
         * every other position, and the share compounded back into the pool; the four add up to `liquidityRaw`. Null on
         * the curve or when the pool's liquidity was not read.
         */
        liquidity: z.object({ creatorRaw: LaunchRaw, ryntraRaw: LaunchRaw, othersRaw: LaunchRaw, compoundingRaw: LaunchRaw }).strict().nullable().optional(),
      })
      .strict(),
    /** How far the trade moves the price, basis points, signed. */
    priceMoveBps: z.number().int(),
    marketCapAfter: LaunchMoney,
    referral: z.boolean(),
    observedAt: Iso,
    /**
     * 1.85.0 — the risk verdict over this trade: the four words over thirteen
     * named facts, each with its source and its time. Named apart from the
     * token's own `risk` facts on `/api/v1/launch/{mint}/market`, which are a
     * different list about the token rather than about this trade.
     */
    tradeRisk: TradeRiskSchema,
  })
  .strict();
export type LaunchTradeQuoteResponse = z.infer<typeof LaunchTradeQuoteResponseSchema>;

export const LaunchTradeBuildRequestSchema = z.object({ wallet: Address, side: LaunchSide, amountRaw: LaunchRaw, slippageBps: LaunchSlippage }).strict();
export type LaunchTradeBuildRequest = z.infer<typeof LaunchTradeBuildRequestSchema>;

export const LaunchTradeBuildResponseSchema = z
  .object({
    buildId: LaunchBuildId,
    network: LaunchNetworkId,
    /** The trade for the wallet to sign — it is the fee payer and the only signer. */
    unsignedWireBase64: z.string().min(1),
    quote: LaunchTradeQuoteResponseSchema,
    expiresAt: Iso,
    /** AG-1 (17.10): how long from arriving the bytes may still be signed — their blockhash's life on the chain (~30 s on 200 ms slots) less a margin to send and land. Relative, so a device counts it on its own clock; past it, build again rather than sign. */
    signableMs: SignableMs.optional(),
  })
  .strict();
export type LaunchTradeBuildResponse = z.infer<typeof LaunchTradeBuildResponseSchema>;

export const LaunchTradeSubmitRequestSchema = z.object({ buildId: LaunchBuildId, wallet: Address, signedWireBase64: z.string().min(1).max(4_000) }).strict();
export type LaunchTradeSubmitRequest = z.infer<typeof LaunchTradeSubmitRequestSchema>;

export const LaunchTradeSubmitResponseSchema = z
  .object({
    signature: LaunchSignature,
    /** CONFIRMED — the chain confirmed it; PENDING — sent and not confirmed in time: read the signature, never send again. */
    state: z.enum(["CONFIRMED", "PENDING"]),
    /** What the trade did, from the program's own event in the confirmed transaction; null when it could not be read yet. */
    filled: z.object({ tokensRaw: LaunchRaw, pairRaw: LaunchRaw }).strict().nullable(),
    /** 1.34.0: the trade's Outcome Receipt, once the chain answered in time; null otherwise — `…/trade/receipt` has it later. */
    receiptHash: SwapDigest.nullable().optional(),
    /** 1.34.0: the launch's page through the person's own referral code, for «Поділитися угодою»; null when it could not be made. */
    shareLink: z.string().url().max(300).nullable().optional(),
  })
  .strict();
export type LaunchTradeSubmitResponse = z.infer<typeof LaunchTradeSubmitResponseSchema>;

/** 1.34.0 — `POST /api/v1/launch/{mint}/trade/receipt`: a trade's receipt, by the wallet that sent it and its signature. */
export const LaunchTradeReceiptRequestSchema = z.object({ wallet: Address, signature: LaunchSignature }).strict();
export type LaunchTradeReceiptRequest = z.infer<typeof LaunchTradeReceiptRequestSchema>;

/**
 * The trade as Ryntra settled it: `DONE` with its issuer-signed Outcome Receipt; `SENT` while the chain has not
 * answered (no receipt yet — never «failed»); `FAILED` when nothing moved.
 */
export const LaunchTradeReceiptResponseSchema = z
  .object({
    signature: LaunchSignature,
    state: z.enum(["SENT", "DONE", "FAILED"]),
    receipt: SwapReceiptSchema.nullable(),
  })
  .strict();
export type LaunchTradeReceiptResponse = z.infer<typeof LaunchTradeReceiptResponseSchema>;

/* ------------------------------------------------------------ Ryntra Launch — the creator's cabinet (1.29.0) */

const LaunchFeeSourceSchema = z.enum(FEE_SOURCES);
const LaunchSourceEarnings = z.object({ earnedRaw: LaunchRaw, unclaimedRaw: LaunchRaw }).strict();
const LaunchPairView = z.object({ mint: Address, symbol: z.string().min(1).max(12), decimals: z.number().int().min(0).max(18), dollar: z.boolean() }).strict();

/** What the creator's side of a launch earned by source, every figure a program's own counter, and one wallet's part of it. */
export const LaunchEarningsSchema = z
  .object({
    role: z.object({ curve: LaunchSourceEarnings, graduation: LaunchSourceEarnings, lp: LaunchSourceEarnings, surplus: LaunchSourceEarnings, earnedRaw: LaunchRaw, unclaimedRaw: LaunchRaw }).strict(),
    mine: z.object({ shareBps: z.number().int().min(0).max(FEE_SHARE_TOTAL_BPS), earnedRaw: LaunchRaw, unclaimedRaw: LaunchRaw, claimedRaw: LaunchRaw }).strict(),
  })
  .strict();
export type LaunchEarnings = z.infer<typeof LaunchEarningsSchema>;

export const LaunchCabinetRowSchema = z
  .object({
    token: Address,
    name: z.string(),
    symbol: z.string(),
    image: z.string().url().nullable(),
    preset: z.enum(LAUNCH_PRESET_IDS),
    creator: Address,
    /** The wallet's place: the launch's creator, or one of the wallets its creator fees are shared with. */
    role: z.enum(["creator", "recipient"]),
    launchedAt: Iso,
    pair: LaunchPairView,
    /** The curve's way to the DEX now; null when the chain could not be read. */
    progressBps: z.number().int().min(0).max(10_000).nullable(),
    migrated: z.boolean().nullable(),
    /** Null when the chain could not be read now — never zero. */
    earnings: LaunchEarningsSchema.nullable(),
    feeSharing: LaunchFeeSharingSchema.nullable(),
    /** Whether «Забрати» has something for this wallet now. */
    claimable: z.boolean(),
  })
  .strict();
export type LaunchCabinetRow = z.infer<typeof LaunchCabinetRowSchema>;

/** A claim's receipt: what each program said it paid in its own event, and what the wallet's account received. */
export const LaunchClaimReceiptSchema = z
  .object({
    token: Address,
    name: z.string(),
    symbol: z.string(),
    signature: LaunchSignature,
    at: Iso.nullable(),
    pair: LaunchPairView,
    /** By source, from the programs' events — to the wallet, or into the vault when shared. */
    paid: z.object({ curve: LaunchRaw, graduation: LaunchRaw, lp: LaunchRaw, surplus: LaunchRaw }).strict(),
    /** What the vault paid this wallet of its share; null when the fees are not shared. */
    vaultPaidRaw: LaunchRaw.nullable(),
    /** The change of the wallet's own balance of the pair currency in the transaction. */
    receivedRaw: LaunchRaw,
  })
  .strict();
export type LaunchClaimReceipt = z.infer<typeof LaunchClaimReceiptSchema>;

/** The creator earnings card's data — figures from the programs' own counters, with their period; the receipts are of the claims made through Ryntra. */
export const CreatorEarningsCardSchema = z
  .object({
    source: z.literal(EARNINGS_CARD_SOURCE),
    kind: z.literal("creator"),
    wallet: Address,
    network: LaunchNetworkId,
    period: z.object({ from: Iso, to: Iso }).strict(),
    launches: z.number().int().nonnegative(),
    graduated: z.number().int().nonnegative(),
    unread: z.number().int().nonnegative(),
    amounts: z
      .array(z.object({ pairMint: Address, symbol: z.string().min(1).max(12), decimals: z.number().int().min(0).max(18), dollar: z.boolean(), earnedRaw: LaunchRaw, claimedRaw: LaunchRaw }).strict())
      .max(20),
    receipts: z.array(LaunchSignature).max(100),
  })
  .strict();
export type CreatorEarningsCardView = z.infer<typeof CreatorEarningsCardSchema>;

/** `GET /api/v1/launch/creators/{address}` — «Мої лаунчі». Public data: launches and fees are on chain; the receipts are of public transactions. */
export const LaunchCreatorCabinetResponseSchema = z
  .object({
    network: LaunchNetworkId,
    wallet: Address,
    launches: z.array(LaunchCabinetRowSchema).max(50),
    receipts: z.array(LaunchClaimReceiptSchema).max(50),
    card: CreatorEarningsCardSchema,
    observedAt: Iso,
  })
  .strict();
export type LaunchCreatorCabinetResponse = z.infer<typeof LaunchCreatorCabinetResponseSchema>;

/* ------------------------------------------------------------ Ryntra Launch — the creator's cabinet in figures and the public profile (1.49.0, SOL-L2) */

/** A figure over a window, raw in the pair currency: exact, a floor (`atLeast`), or not read (`raw: null`) — never a zero on a guess. */
const LaunchWindowFigure = z.object({ raw: LaunchRaw.nullable(), atLeast: z.boolean() }).strict();
/** A count: exact, a floor (`atLeast`), or not read (`count: null`). */
const LaunchCountFigure = z.object({ count: z.number().int().nonnegative().nullable(), atLeast: z.boolean() }).strict();
const LaunchSourceWindows = z.object({ curve: LaunchWindowFigure, graduation: LaunchWindowFigure, lp: LaunchWindowFigure }).strict();

/**
 * `GET /api/v1/launch/{mint}/stats` — a launch as its creator's cabinet and public profile read it: what the creator's
 * side earned over the last day and week by source (all time is the cabinet's counters), the volume, the holders, the
 * traders and those who came back, the liquidity, after the DEX the depth ±2 % and the pool's fees, the creator's own
 * buys and sales and their lock. Every figure from the chain; public.
 */
export const LaunchStatsResponseSchema = z
  .object({
    network: LaunchNetworkId,
    token: Address,
    creator: Address,
    pair: LaunchPairView,
    tokenDecimals: z.number().int().min(0).max(18),
    venue: LaunchTradeVenueSchema,
    progressBps: LaunchBps,
    migrated: z.boolean(),
    /** Where each figure can be checked: the curve, the graduated pool, the creator role's position in it, the creator's lock. */
    links: z.object({ curve: Address, pool: Address.nullable(), position: Address.nullable(), lock: Address.nullable() }).strict(),
    /** The creator role's earnings, raw in the pair currency; a wallet sharing the role takes its share of each. */
    revenue: z.object({ day: LaunchSourceWindows, week: LaunchSourceWindows }).strict(),
    volume: z.object({ day: LaunchWindowFigure, week: LaunchWindowFigure, all: LaunchWindowFigure }).strict(),
    /** People holding the token, from the mint's accounts. */
    holders: LaunchCountFigure,
    /** Wallets that traded, and those that traded in two transactions or more — the creator's own and Ryntra's left out. */
    traders: LaunchCountFigure,
    repeatTraders: LaunchCountFigure,
    liquidity: LaunchMoney,
    marketCap: LaunchMoney,
    /** After the DEX; null on the curve. */
    market: z
      .object({
        /** The pair currency that moves the price 2 % up and 2 % down, before the pool's fee; null when it could not be read. */
        depth: z.object({ upRaw: LaunchRaw, downRaw: LaunchRaw }).strict().nullable(),
        /** Every fee the pool's swaps paid. */
        fees: z.object({ day: LaunchWindowFigure, week: LaunchWindowFigure }).strict(),
        /** The creator role's share of the pool's liquidity — locked for ever at the move to the DEX; null when not read. */
        lpShareBps: LaunchBps.nullable(),
      })
      .strict()
      .nullable(),
    /** The creator's own trades on the token; `complete` false: a sale may be missing, said as such. */
    creatorTrades: z
      .object({
        boughtRaw: LaunchRaw,
        soldRaw: LaunchRaw,
        soldBps: LaunchBps.nullable(),
        soldOf: z.enum(["bought", "supply"]).nullable(),
        sales: z.array(z.object({ signature: LaunchSignature, at: Iso, tokensRaw: LaunchRaw, pairRaw: LaunchRaw }).strict()).max(5),
        complete: z.boolean(),
      })
      .strict(),
    /** The creator's lock of their first purchase; null when they made none. `lockedRaw` — what the escrow holds now, null when not read. */
    lock: z
      .object({ state: z.enum(["LOCKED", "PENDING", "FAILED"]), schedule: z.enum(CREATOR_LOCK_IDS), escrow: Address, lockedRaw: LaunchRaw.nullable(), cliffAt: Iso, endAt: Iso })
      .strict()
      .nullable(),
    observedAt: Iso,
  })
  .strict();
export type LaunchStatsResponse = z.infer<typeof LaunchStatsResponseSchema>;

/** One of a creator's launches on the public profile; its figures come from `…/stats`. */
export const LaunchProfileLaunchSchema = z
  .object({
    token: Address,
    name: z.string(),
    symbol: z.string(),
    image: z.string().url().nullable(),
    preset: z.enum(LAUNCH_PRESET_IDS),
    launchedAt: Iso,
    pair: LaunchPairView,
  })
  .strict();
export type LaunchProfileLaunch = z.infer<typeof LaunchProfileLaunchSchema>;

/** `GET /api/v1/launch/creators/{address}/profile` — the creator's public profile: the launches they made through Ryntra, the newest first. */
export const LaunchCreatorProfileResponseSchema = z
  .object({ network: LaunchNetworkId, creator: Address, launches: z.array(LaunchProfileLaunchSchema).max(50), observedAt: Iso })
  .strict();
export type LaunchCreatorProfileResponse = z.infer<typeof LaunchCreatorProfileResponseSchema>;

export const LaunchClaimBuildRequestSchema = z.object({ wallet: Address }).strict();
export type LaunchClaimBuildRequest = z.infer<typeof LaunchClaimBuildRequestSchema>;

export const LaunchClaimBuildResponseSchema = z
  .object({
    buildId: LaunchBuildId,
    network: LaunchNetworkId,
    /** The claim for the wallet to sign — the fee payer and the only signer; one, or more when a pool's accounts do not fit one (1.70.0: up to five). */
    unsignedWireBase64: z.array(z.string().min(1)).min(1).max(5),
    /** The sources holding a fee now, each taken by the claim; empty when, shared, the wallet's part already sits in the vault. */
    sources: z.array(LaunchFeeSourceSchema).max(4),
    /** What the wallet's part comes to as read now; the receipt says what the programs paid. */
    expectedRaw: LaunchRaw,
    /** The wallet's SOL the network simulated the claim taking — its fees and the rent of any account it opens; null when it could not be simulated, never zero on a guess. */
    networkCostLamports: LaunchRaw.nullable(),
    pair: LaunchPairView,
    expiresAt: Iso,
    /** AG-1 (17.10): how long from arriving the bytes may still be signed — their blockhash's life on the chain (~30 s on 200 ms slots) less a margin to send and land. Relative, so a device counts it on its own clock; past it, build again rather than sign. */
    signableMs: SignableMs.optional(),
  })
  .strict();
export type LaunchClaimBuildResponse = z.infer<typeof LaunchClaimBuildResponseSchema>;

/**
 * `GET /api/v1/launch/{mint}/claim/review?wallet=` (1.73.0, SOL-L12) — «Забрати все»: the Review before the signature.
 * Every pocket of the creator's side, the transactions the wallet will sign, the exit position as an NFT, the surplus as
 * Meteora splits it, the creator's lock. Built from the same claim `…/claim/build` then builds; public data.
 */
export const LaunchClaimReviewResponseSchema = z
  .object({
    network: LaunchNetworkId,
    token: Address,
    wallet: Address,
    pair: LaunchPairView,
    /** The creator's fees are shared («Спільнота»): the claim funds the vault and the last transaction pays the wallet its share. */
    shared: z.boolean(),
    /** Whether SOL-L1d's claims are open here; closed, the surplus is said (`CLOSED`) and not taken. */
    claimsV2: z.boolean(),
    pockets: z
      .array(
        z
          .object({
            pocket: z.enum(CLAIM_POCKETS),
            state: z.enum(CLAIM_POCKET_STATES),
            /** What the pocket holds for the creator's side, raw — the pair currency; for `transferFee`, the token; null when not a figure here. */
            amountRaw: LaunchRaw.nullable(),
            /** 1-based: the transaction of this claim that takes it; null when this claim does not. */
            transaction: z.number().int().min(1).max(5).nullable(),
            /** Who takes it instead (`NOT_YOURS`). */
            holder: Address.nullable(),
          })
          .strict(),
      )
      .length(CLAIM_POCKETS.length),
    /**
     * Why the claim must not be signed as built, or null: `POSITION_MOVED` — a transaction takes the locked position's
     * fees while its NFT is with another wallet, and the program would refuse that whole transaction.
     */
    blockedBy: z.enum(["POSITION_MOVED"]).nullable(),
    /** The transactions the wallet signs, in order; empty — nothing to take now. `payout`: the vault paying the wallet its share. */
    transactions: z.array(z.object({ index: z.number().int().min(1).max(5), sources: z.array(LaunchFeeSourceSchema).max(4), payout: z.boolean() }).strict()).max(5),
    /** What the wallet's part comes to; "0" with no transactions. */
    expectedRaw: LaunchRaw,
    networkCostLamports: LaunchRaw.nullable(),
    /** The curve's surplus as Meteora splits it once the curve is full; null before. */
    surplus: z.object({ totalRaw: LaunchRaw, creatorRaw: LaunchRaw, partnerRaw: LaunchRaw, protocolRaw: LaunchRaw }).strict().nullable(),
    /**
     * The creator role's exit position in the DAMM v2 pool — an NFT: who holds it now (`holderIs`: the wallet, the vault
     * sharing the fees, someone else, or not read) and how much of it is locked for ever. Sending the NFT moves its fees,
     * never its locked liquidity. Null before the DEX or when no position was found.
     */
    position: z
      .object({
        address: Address,
        pool: Address,
        nftMint: Address,
        holder: Address.nullable(),
        holderIs: z.enum(["YOU", "VAULT", "OTHER", "UNREAD"]),
        permanentBps: LaunchBps,
        forever: z.boolean(),
      })
      .strict()
      .nullable(),
    /** The creator's lock of their first purchase — when it starts and ends unlocking, what it holds now; null without one or not read. */
    lock: z.object({ escrow: Address, cliffAt: Iso, endAt: Iso, lockedRaw: LaunchRaw }).strict().nullable(),
    observedAt: Iso,
  })
  .strict();
export type LaunchClaimReviewResponse = z.infer<typeof LaunchClaimReviewResponseSchema>;

export const LaunchClaimSubmitRequestSchema = z
  .object({ buildId: LaunchBuildId, wallet: Address, signedWireBase64: z.array(z.string().min(1).max(4_000)).min(1).max(5) })
  .strict();
export type LaunchClaimSubmitRequest = z.infer<typeof LaunchClaimSubmitRequestSchema>;

export const LaunchClaimSubmitResponseSchema = z
  .object({
    /**
     * CONFIRMED — every transaction landed and its receipt was read; PENDING — one was sent and not confirmed in time:
     * read its signature, never send again; PARTIAL — the first landed and a later one did not (`failed`): part was
     * taken, the rest still waits at its source or in the vault.
     */
    state: z.enum(["CONFIRMED", "PENDING", "PARTIAL"]),
    receipts: z.array(LaunchClaimReceiptSchema).max(5),
    pending: z.array(LaunchSignature).max(5),
    failed: z.array(z.object({ signature: LaunchSignature, reason: z.string().max(300) }).strict()).max(5),
  })
  .strict();
export type LaunchClaimSubmitResponse = z.infer<typeof LaunchClaimSubmitResponseSchema>;

/* ------------------------------------------------------------ «Комісія за переказ» (1.72.0, SOL-L10) */

/** A step of the withheld cycle the creator takes: harvest — holders' accounts to the mint; withdraw — the mint to the creator. */
export const LaunchTransferFeeStepSchema = z.enum(["HARVEST", "WITHDRAW"]);
export type LaunchTransferFeeStep = z.infer<typeof LaunchTransferFeeStepSchema>;

/** One step taken through Ryntra, by its transaction on chain. */
export const LaunchTransferFeeReceiptSchema = z
  .object({
    step: LaunchTransferFeeStepSchema,
    signature: LaunchSignature,
    /** The token moved, raw: withdrawn to the creator — what its transaction shows, 0 when the mint held nothing by then; harvested — what the accounts held when it was built. */
    amountRaw: LaunchRaw,
    /** Harvest: how many holders' accounts it named. */
    accounts: z.number().int().nonnegative().nullable(),
    at: Iso,
  })
  .strict();
export type LaunchTransferFeeReceipt = z.infer<typeof LaunchTransferFeeReceiptSchema>;

/**
 * `GET /api/v1/launch/{mint}/transfer-fee` — a launch's transfer fee as the chain shows it now: the rate, the RevokeZeroFee
 * timeline by epoch, and the withheld cycle — in holders' accounts, harvested to the mint, withdrawn by the creator — with
 * each step's receipt. Public; LAUNCH_NO_TRANSFER_FEE for a launch whose token takes no fee on transfers.
 */
export const LaunchTransferFeeResponseSchema = z
  .object({
    network: LaunchNetworkId,
    token: Address,
    decimals: z.number().int().min(0).max(18),
    /** The rate on the curve, basis points. */
    bps: z.number().int().min(1).max(10_000),
    mode: z.literal("REVOKE_ZERO_FEE"),
    /** Who withdraws what is withheld — the creator's wallet. */
    withdrawAuthority: Address.nullable(),
    timeline: z
      .object({
        phase: z.enum(TRANSFER_FEE_PHASES),
        bpsNow: z.number().int().min(0).max(10_000),
        curveBps: z.number().int().min(0).max(10_000),
        /** The first epoch at 0 %; null before the move to the DEX. */
        zeroFromEpoch: LaunchRaw.nullable(),
        authorityLive: z.boolean(),
        epoch: LaunchRaw,
      })
      .strict(),
    cycle: z
      .object({
        /** Withheld in holders' accounts; null — they were not read now. */
        inAccountsRaw: LaunchRaw.nullable(),
        accountsWithWithheld: z.number().int().nonnegative().nullable(),
        onMintRaw: LaunchRaw,
        withdrawnRaw: LaunchRaw,
      })
      .strict(),
    actions: z.object({ harvest: z.boolean(), withdraw: z.boolean() }).strict(),
    receipts: z.array(LaunchTransferFeeReceiptSchema).max(50),
    observedAt: Iso,
  })
  .strict();
export type LaunchTransferFeeResponse = z.infer<typeof LaunchTransferFeeResponseSchema>;

/** `POST /api/v1/launch/{mint}/transfer-fee/build` — one step for the creator's wallet to sign as the only signer. */
export const LaunchTransferFeeBuildRequestSchema = z.object({ wallet: Address, step: LaunchTransferFeeStepSchema }).strict();
export type LaunchTransferFeeBuildRequest = z.infer<typeof LaunchTransferFeeBuildRequestSchema>;

export const LaunchTransferFeeBuildResponseSchema = z
  .object({
    buildId: LaunchBuildId,
    network: LaunchNetworkId,
    step: LaunchTransferFeeStepSchema,
    unsignedWireBase64: z.string().min(1),
    /** What the step moves as read now; the receipt says what the token program moved. */
    expectedRaw: LaunchRaw,
    /** Harvest: the holders' accounts it names (at most a transaction's worth); withdraw: 0. */
    accounts: z.number().int().nonnegative(),
    networkCostLamports: LaunchRaw.nullable(),
    expiresAt: Iso,
    signableMs: z.number().int().nonnegative(),
  })
  .strict();
export type LaunchTransferFeeBuildResponse = z.infer<typeof LaunchTransferFeeBuildResponseSchema>;

export const LaunchTransferFeeSubmitRequestSchema = z.object({ buildId: LaunchBuildId, wallet: Address, signedWireBase64: z.string().min(1).max(4_000) }).strict();
export type LaunchTransferFeeSubmitRequest = z.infer<typeof LaunchTransferFeeSubmitRequestSchema>;

/** CONFIRMED with its receipt (null while its transaction is not read — the next read settles it); PENDING — sent and not confirmed in time: read the signature, never send again; a later read counts it once it lands. */
export const LaunchTransferFeeSubmitResponseSchema = z
  .object({ step: LaunchTransferFeeStepSchema, state: z.enum(["CONFIRMED", "PENDING"]), signature: LaunchSignature, receipt: LaunchTransferFeeReceiptSchema.nullable() })
  .strict();
export type LaunchTransferFeeSubmitResponse = z.infer<typeof LaunchTransferFeeSubmitResponseSchema>;

/* ------------------------------------------------------------ the flight log (1.32.0) */

/** One entry of a launch's flight log — every one with the transaction anyone can open. */
export const LaunchJournalEventSchema = z
  .object({
    kind: z.enum(JOURNAL_KINDS),
    at: Iso.nullable(),
    signature: LaunchSignature,
    actor: z.enum(JOURNAL_ACTORS),
    /** The pair currency the event moved, raw; null when it moved none. */
    pairRaw: LaunchRaw.nullable(),
    /** The token the event moved, raw; null when it moved none. */
    tokensRaw: LaunchRaw.nullable(),
    /** The Fee-Funded Liquidity Ladder: the lowest and the highest step's price, in the pair currency per token. */
    priceLow: z.number().positive().nullable(),
    priceHigh: z.number().positive().nullable(),
    /** A sale of the creator's: the share sold by then, basis points — of what they bought here, or of the supply when they sold more. */
    soldBps: z.number().int().min(0).max(1_000_000).nullable(),
    soldOf: z.enum(["bought", "supply"]).nullable(),
    /** 1.36.0: what governs the entry — `rule` (a program enforces it), `policy` (Ryntra's server runs it), null for what the log observes. Absent before 1.36.0. */
    enforcement: z.enum(MARKET_ENFORCEMENT).nullable().optional(),
    /** 1.39.0, `FEE_CLAIMED`: which partner fee the executor claimed; null or absent for every other kind. */
    source: z.enum(BUDGET_SOURCES).nullable().optional(),
    /** 1.39.0, `FEE_CLAIMED`: the market budget's part of it, raw; the rest of `pairRaw` is Ryntra's revenue. */
    budgetRaw: LaunchRaw.nullable().optional(),
  })
  .strict();
export type LaunchJournalEventView = z.infer<typeof LaunchJournalEventSchema>;

/** The Fee-Funded Liquidity Ladder on a graduated launch as it stands: in steps below the price, from Ryntra's fees on this token. */
export const LaunchFloorViewSchema = z
  .object({
    pool: Address,
    position: Address,
    /** The pair currency in the steps now, raw. */
    pairRaw: LaunchRaw,
    /** The token the steps bought and hold, raw. */
    tokensRaw: LaunchRaw,
    priceLow: z.number().positive(),
    priceHigh: z.number().positive(),
    /** Every amount the executor put in, raw. */
    placedRaw: LaunchRaw,
    observedAt: Iso,
  })
  .strict();
export type LaunchFloorView = z.infer<typeof LaunchFloorViewSchema>;

/**
 * 1.37.0: a mark of the executor's or its operator's in the flight log — none of it a transaction of its own: the
 * executor's first pass, a state of the market's cycle as the executor read it, the operator's stop and resume, a failed
 * graduation the executor sends again.
 */
export const LaunchJournalMarkSchema = z
  .object({
    kind: z.enum(JOURNAL_MARK_KINDS),
    /** When the executor or the operator wrote it — the server's clock, not a block's. */
    at: Iso,
    actor: z.enum(JOURNAL_MARK_ACTORS),
    /** The state the market moved into; null when the mark names none (a resume, a watch over a market on its curve). */
    state: z.enum(MARKET_CYCLE_STATES).nullable(),
    /** The state it left; null for the first one the log knows. */
    from: z.enum(MARKET_CYCLE_STATES).nullable(),
    /** The transaction it rests on — the graduation, the ladder placed or moved, a failed attempt; null when there is none. */
    signature: LaunchSignature.nullable(),
    /** A stop's or a resume's reach: this market alone, or every market; null for every other mark. */
    scope: z.enum(["market", "all"]).nullable(),
    /** `ENDOWMENT_FUNDED`: the budget the market's ladder got, raw in the pair currency; null for every other mark. */
    pairRaw: LaunchRaw.nullable(),
    /** 1.39.0: a `STATE` mark into `PAUSED_RISK` — the budget's risk limits that hold; absent or null for every other mark. */
    risks: z.array(z.enum(BUDGET_RISKS)).max(BUDGET_RISKS.length).nullable().optional(),
  })
  .strict();
export type LaunchJournalMarkView = z.infer<typeof LaunchJournalMarkSchema>;

/** `GET /api/v1/launch/{mint}/journal` — the flight log, the newest first, and the Fee-Funded Liquidity Ladder; public chain facts. */
export const LaunchJournalResponseSchema = z
  .object({
    network: LaunchNetworkId,
    token: Address,
    pair: LaunchPairView,
    tokenDecimals: z.number().int().min(0).max(18),
    /** Ryntra's executor on this network — the wallet whose actions the log names as Ryntra's; null while there is none. */
    executor: Address.nullable(),
    events: z.array(LaunchJournalEventSchema).max(200),
    /** 1.36.0: every entry the log holds — more than `events` when only the newest 200 are given. Absent before 1.36.0. */
    total: z.number().int().nonnegative().optional(),
    /** Whether everything the log rests on was read: the creator's trades whole, and the graduation once the token graduated. */
    complete: z.boolean(),
    floor: LaunchFloorViewSchema.nullable(),
    /** The ladder is there but its position could not be read now: said, never hidden. */
    floorUnread: z.boolean(),
    /** 1.37.0: the executor's and its operator's marks, the oldest first, the newest 200. Absent before 1.37.0. */
    marks: z.array(LaunchJournalMarkSchema).max(200).optional(),
    observedAt: Iso,
  })
  .strict();
export type LaunchJournalResponse = z.infer<typeof LaunchJournalResponseSchema>;

/* ------------------------------------------------------------ a holder's position in the pool (1.33.0) */

const HolderInput = z.enum(["pair", "token"]);

/** A claim Ryntra's collector made for the position's owner: what the owner's own accounts received, read from the confirmed transaction. */
export const LaunchHolderClaimSchema = z.object({ signature: LaunchSignature, at: Iso.nullable(), pairRaw: LaunchRaw, tokenRaw: LaunchRaw }).strict();

/** A position entered through Ryntra, and how it stands on chain now. */
export const LaunchHolderPositionSchema = z
  .object({
    token: Address,
    pool: Address,
    position: Address,
    nftMint: Address,
    /** The entry was sent and its answer is not in yet: read again, never enter twice. */
    pending: z.boolean(),
    enteredAt: Iso,
    entrySignature: z.string().max(90),
    input: HolderInput,
    /** What the entry spent of its coin, Ryntra's share included, raw. */
    enteredRaw: LaunchRaw,
    /** Its value in the pair currency at the entry's price, raw. */
    enteredPairRaw: LaunchRaw,
    /** Ryntra's share taken at entry, in the input coin, raw. */
    feeRaw: LaunchRaw,
    /** The position now; null when its chain could not be read now. */
    now: z
      .object({
        /** OPEN — the wallet holds it; MOVED — its NFT left the wallet; CLOSED — the position no longer exists. */
        state: z.enum(["OPEN", "MOVED", "CLOSED"]),
        tokenRaw: LaunchRaw,
        pairRaw: LaunchRaw,
        /** What it holds, in the pair currency at the pool's price now, raw. */
        valuePairRaw: LaunchRaw,
        /** The fees it earned in the pair currency — claimed by anyone, plus waiting now. */
        feesPairRaw: LaunchRaw,
        unclaimedPairRaw: LaunchRaw,
        unclaimedTokenRaw: LaunchRaw,
        claimedPairRaw: LaunchRaw,
        /** The permission as Ryntra's collector reads it: GRANTED is the only state it acts on. */
        grant: z.enum(HOLDER_GRANT_STATES),
        /**
         * 1.41.0: the owner's accounts the program pays the fees into that are closed now — the token's, the pair's. The
         * collector never reopens them at its cost and waits; the owner opens one again or claims the fees themselves.
         * Absent before 1.41.0.
         */
        closedAccounts: z.array(z.enum(["token", "pair"])).max(2).optional(),
      })
      .strict()
      .nullable(),
    /** What Ryntra's collector brought to the owner's wallet, in the pair currency, raw. */
    collectedPairRaw: LaunchRaw,
    /** 1.41.0: every claim the collector made for this position — `claims` carries the newest 20. Absent before 1.41.0. */
    claimsCount: z.number().int().nonnegative().optional(),
    claims: z.array(LaunchHolderClaimSchema).max(20),
    /**
     * 1.40.0: the collector's queue for this position, by the same rule and the same attempts the collector reads — the
     * earliest moment of its next claim (a day after its last attempt, sent or failed, or now) and whether a whole
     * dollar waits; both must hold. Null when the collector does not claim this position (no permission, not open, a
     * pair that is not a dollar). Absent before 1.40.0.
     */
    nextCollection: z.object({ notBefore: Iso, enoughWaiting: z.boolean() }).strict().nullable().optional(),
  })
  .strict();
export type LaunchHolderPositionView = z.infer<typeof LaunchHolderPositionSchema>;

/** `GET /api/v1/launch/{mint}/holder/{address}` — the token's pool for a holder, and the wallet's positions in it. */
export const LaunchHolderResponseSchema = z
  .object({
    network: LaunchNetworkId,
    token: Address,
    /** The graduated pool; null while the token is on its curve. */
    pool: Address.nullable(),
    /**
     * Whether the entry is built here — the same for every address (1.41.0): true wherever it is open to people; while it
     * is closed, true only for an operator's own wallet this request proved it signs for.
     */
    open: z.boolean(),
    /** Ryntra's collector — the delegate the permission names; null while this network has none. */
    collector: Address.nullable(),
    /** What the permission asks for: the program's bitmask and its bits by name. */
    grant: z.object({ bitmask: z.number().int().min(0).max(255), permissions: z.array(z.enum(POSITION_PERMISSIONS)).max(8) }).strict(),
    /** Ryntra's share at entry: the policy's rate on the part Zap swaps, and whether it is charged here. */
    fee: z.object({ bps: LaunchBps, charged: z.boolean() }).strict(),
    /** In a compounding pool, the share of the LP fee that stays in the pool by itself; the rest is claimable. */
    compoundingBps: LaunchBps.nullable(),
    pair: LaunchPairView,
    tokenDecimals: z.number().int().min(0).max(18),
    /** The token's price in the pair currency now; null while it is on its curve. */
    price: z.number().nonnegative().nullable(),
    positions: z.array(LaunchHolderPositionSchema).max(50),
    observedAt: Iso,
  })
  .strict();
export type LaunchHolderResponse = z.infer<typeof LaunchHolderResponseSchema>;

export const LaunchHolderQuoteRequestSchema = z
  .object({ wallet: Address, input: HolderInput, amountRaw: LaunchRaw, slippageBps: z.number().int().min(10).max(1_000) })
  .strict();
export type LaunchHolderQuoteRequest = z.infer<typeof LaunchHolderQuoteRequestSchema>;

/** The entry's figures before the signature. */
export const LaunchHolderQuoteSchema = z
  .object({
    input: HolderInput,
    /** What the wallet spends of its coin, raw — Ryntra's share included. */
    amountRaw: LaunchRaw,
    /** Ryntra's share, in the input coin, raw; "0" where it is not charged. */
    feeRaw: LaunchRaw,
    feeBps: LaunchBps,
    depositRaw: LaunchRaw,
    /** ≈ the part Zap swaps into the other coin; the program counts it exactly. */
    swappedRaw: LaunchRaw,
    positionTokenRaw: LaunchRaw,
    positionPairRaw: LaunchRaw,
    /** What the wallet spends, Ryntra's share included, in the pair currency at the price now, raw. */
    valuePairRaw: LaunchRaw,
    /** ≈ the position's worth right after the entry at the price now, raw: the swap's pool fee and price move are not in it. */
    positionValuePairRaw: LaunchRaw,
    shareBps: LaunchBps,
    priceImpactBps: z.number().int().min(0).max(10_000),
    /** Whether the collector's permission goes in the same signature. */
    grant: z.boolean(),
  })
  .strict();
export type LaunchHolderQuoteView = z.infer<typeof LaunchHolderQuoteSchema>;

export const LaunchHolderQuoteResponseSchema = z.object({ quote: LaunchHolderQuoteSchema, price: z.number().nonnegative(), observedAt: Iso }).strict();
export type LaunchHolderQuoteResponse = z.infer<typeof LaunchHolderQuoteResponseSchema>;

export const LaunchHolderBuildRequestSchema = LaunchHolderQuoteRequestSchema;
export type LaunchHolderBuildRequest = LaunchHolderQuoteRequest;

export const LaunchHolderBuildResponseSchema = z
  .object({
    buildId: LaunchBuildId,
    network: LaunchNetworkId,
    /** One transaction: the entry, and the permission where the network has a collector. The new position's NFT key has signed it. */
    unsignedWireBase64: z.string().min(1),
    position: Address,
    quote: LaunchHolderQuoteSchema,
    expiresAt: Iso,
    /** AG-1 (17.10): how long from arriving the bytes may still be signed — their blockhash's life on the chain (~30 s on 200 ms slots) less a margin to send and land. Relative, so a device counts it on its own clock; past it, build again rather than sign. */
    signableMs: SignableMs.optional(),
  })
  .strict();
export type LaunchHolderBuildResponse = z.infer<typeof LaunchHolderBuildResponseSchema>;

export const LaunchHolderSubmitRequestSchema = z.object({ buildId: LaunchBuildId, wallet: Address, signedWireBase64: z.string().min(1).max(4_000) }).strict();
export type LaunchHolderSubmitRequest = z.infer<typeof LaunchHolderSubmitRequestSchema>;

export const LaunchHolderSubmitResponseSchema = z.object({ signature: LaunchSignature, state: z.enum(["CONFIRMED", "PENDING"]), position: Address }).strict();
export type LaunchHolderSubmitResponse = z.infer<typeof LaunchHolderSubmitResponseSchema>;

export const LaunchHolderPermissionBuildRequestSchema = z.object({ wallet: Address, position: Address, action: z.enum(["grant", "revoke"]) }).strict();
export type LaunchHolderPermissionBuildRequest = z.infer<typeof LaunchHolderPermissionBuildRequestSchema>;

export const LaunchHolderPermissionBuildResponseSchema = z
  .object({ buildId: LaunchBuildId, network: LaunchNetworkId, unsignedWireBase64: z.string().min(1), action: z.enum(["grant", "revoke"]), expiresAt: Iso, signableMs: SignableMs.optional() })
  .strict();
export type LaunchHolderPermissionBuildResponse = z.infer<typeof LaunchHolderPermissionBuildResponseSchema>;

export const LaunchHolderPermissionSubmitRequestSchema = LaunchHolderSubmitRequestSchema;
export type LaunchHolderPermissionSubmitRequest = LaunchHolderSubmitRequest;

export const LaunchHolderPermissionSubmitResponseSchema = z
  .object({ signature: LaunchSignature, state: z.enum(["CONFIRMED", "PENDING"]), action: z.enum(["grant", "revoke"]) })
  .strict();
export type LaunchHolderPermissionSubmitResponse = z.infer<typeof LaunchHolderPermissionSubmitResponseSchema>;

/** The data of a holder's earnings card: what went in, what it is worth now, the fees, each currency apart, with its period. */
export const HolderEarningsCardSchema = z
  .object({
    source: z.literal(HOLDER_CARD_SOURCE),
    kind: z.literal("holder-position"),
    wallet: Address,
    network: z.string().min(1).max(40),
    period: z.object({ from: Iso, to: Iso }).strict(),
    positions: z.number().int().min(0),
    unread: z.number().int().min(0),
    amounts: z
      .array(
        z
          .object({
            pairMint: Address,
            symbol: z.string().min(1).max(12),
            decimals: z.number().int().min(0).max(18),
            dollar: z.boolean(),
            enteredRaw: LaunchRaw,
            valueRaw: LaunchRaw,
            feesRaw: LaunchRaw,
            collectedRaw: LaunchRaw,
          })
          .strict(),
      )
      .max(10),
    receipts: z.array(z.string().max(90)).max(200),
  })
  .strict();
export type HolderEarningsCardView = z.infer<typeof HolderEarningsCardSchema>;

/** `GET /api/v1/launch/holders/{address}` — «Мої позиції»: every position the wallet entered through Ryntra, and its card. */
export const LaunchHolderPositionsResponseSchema = z
  .object({
    network: LaunchNetworkId,
    wallet: Address,
    open: z.boolean(),
    /** Ryntra's collector on this network; null while there is none. */
    collector: Address.nullable(),
    positions: z
      .array(
        LaunchHolderPositionSchema.extend({
          name: z.string().max(64).nullable(),
          symbol: z.string().max(16).nullable(),
          pair: LaunchPairView.nullable(),
          tokenDecimals: z.number().int().min(0).max(18).nullable(),
        }).strict(),
      )
      .max(200),
    card: HolderEarningsCardSchema,
    observedAt: Iso,
  })
  .strict();
export type LaunchHolderPositionsResponse = z.infer<typeof LaunchHolderPositionsResponseSchema>;

/* ------------------------------------------------------------ the markets launched on Ryntra and their health (1.36.0) */

const MarketStateView = z
  .object({
    code: z.enum(MARKET_CYCLE_STATES),
    /** When the market entered it; null when the moment is not known. */
    since: Iso.nullable(),
  })
  .strict();

/**
 * The market's budget — what Ryntra earned on it for its liquidity, what is in Ryntra's steps, what is left. `NOT_COUNTED`:
 * Ryntra keeps no budget for this market (its partner fees go to the partner's multisig) — `earnedRaw` and `reserveRaw`
 * null, never zero; `IN_POOL`: the market has no steps and what it earned waits in Meteora's pools, unclaimed — `earnedRaw`
 * the budget's part of it; `COUNTED`: Ryntra's executor claims the market's fees into its budget — all read. `ladder` —
 * Ryntra's steps: `NONE`, `PLACED` (with `deployed`), or `UNREAD` (there, and their position not read now).
 *
 * 1.39.0, additive: `sources` — the budget's part by source (the migration fee and the partner's surplus whole, a
 * quarter of the partner's curve fees and of its locked DAMM v2 position's fees); `placedRaw` — what went into the
 * steps from the budget (at most 70 % of `earnedRaw`); `revenueRaw` — the other three quarters, Ryntra's revenue,
 * never the market's; `inPoolRaw` — the budget's part still waiting in Meteora's pools; `exhausted` — the steps hold
 * none of the pair currency and the reserve is below one step (5 USDC). Absent before 1.39.0 and on `NOT_COUNTED`.
 *
 * 1.51.0, additive (SOL-L6): `claims` — Ryntra's executor claims this market's budget and keeps its ladder: on a market
 * Ryntra launched, and on a person's Micro market while Ryntra's operator keeps people's markets open; false — what it
 * earned waits in Meteora's pools. Absent before 1.51.0 and on `NOT_COUNTED`.
 */
export const LaunchMarketBudgetSchema = z
  .object({
    state: z.enum(["NOT_COUNTED", "IN_POOL", "COUNTED"]),
    earnedRaw: LaunchRaw.nullable(),
    reserveRaw: LaunchRaw.nullable(),
    ladder: z.enum(["NONE", "PLACED", "UNREAD"]),
    /** In Ryntra's steps now: the pair currency, and the token they bought and hold. */
    deployed: z.object({ pairRaw: LaunchRaw, tokensRaw: LaunchRaw }).strict().nullable(),
    sources: z.object({ migration: LaunchRaw, surplus: LaunchRaw, curve: LaunchRaw, lp: LaunchRaw }).strict().nullable().optional(),
    placedRaw: LaunchRaw.nullable().optional(),
    revenueRaw: LaunchRaw.nullable().optional(),
    inPoolRaw: LaunchRaw.nullable().optional(),
    exhausted: z.boolean().optional(),
    claims: z.boolean().optional(),
  })
  .strict();
export type LaunchMarketBudgetView = z.infer<typeof LaunchMarketBudgetSchema>;

/** Executable depth at one drop: the pair currency the market pays out while sales move the price that far down, raw. */
export const LaunchMarketDepthSchema = z
  .object({
    dropBps: z.union([z.literal(DEPTH_DROPS_BPS[0]), z.literal(DEPTH_DROPS_BPS[1]), z.literal(DEPTH_DROPS_BPS[2])]),
    /** The curve's — `"0"` while it is full and takes no sale —, or the DAMM v2 pool's with Ryntra's steps'; null when not read. */
    pairRaw: LaunchRaw.nullable(),
    /** Of it, Ryntra's steps; null when there are none or they were not read. */
    ladderRaw: LaunchRaw.nullable(),
  })
  .strict();
export type LaunchMarketDepthView = z.infer<typeof LaunchMarketDepthSchema>;

/** A rule or a policy that keeps the market now — only what is live on it. */
export const LaunchMarketRuleSchema = z
  .object({
    code: z.enum(MARKET_RULE_CODES),
    /** `rule`: a program enforces it; `policy`: Ryntra's server runs it. */
    enforcement: z.enum(MARKET_ENFORCEMENT),
    by: z.enum(MARKET_KEEPERS),
    /** Where anyone can see it on chain; null for a policy of Ryntra's server. */
    source: z.object({ kind: z.enum(["tx", "account"]), id: z.string().min(32).max(90) }).strict().nullable(),
    /** The figures its words name: shares in basis points, amounts raw, times in unix seconds. */
    values: z.record(z.string().min(1).max(32), z.union([z.number(), z.string().max(40)])),
  })
  .strict();
export type LaunchMarketRuleView = z.infer<typeof LaunchMarketRuleSchema>;

/** The creator's lock as the chain shows it: its escrow and when it frees the tokens (the cliff, then the vesting's end). */
const LaunchMarketLockView = z.object({ escrow: Address, cliffAt: Iso.nullable(), endsAt: Iso.nullable() }).strict();

/** One market of the list. A figure not read is null — never zero; `read: false` — the chain was not read in time, the record's facts only. */
export const LaunchMarketRowSchema = z
  .object({
    token: Address,
    name: z.string().max(64),
    symbol: z.string().max(16),
    image: z.string().url().nullable(),
    preset: z.enum(LAUNCH_PRESET_IDS),
    launchedAt: Iso,
    creator: Address,
    /** The creator is one of Ryntra's own wallets: Ryntra's own launch — technical validation, never demand. */
    technicalValidation: z.boolean(),
    pair: LaunchPairView,
    read: z.boolean(),
    state: MarketStateView.nullable(),
    venue: LaunchTradeVenueSchema.nullable(),
    /** The curve's way to the DEX. */
    progress: z.object({ bps: LaunchBps, migrated: z.boolean() }).strict().nullable(),
    /** The DAMM v2 pool's two sides at the price now, after the DEX; null on the curve or when not read. */
    poolLiquidity: LaunchMoney.nullable(),
    budget: LaunchMarketBudgetSchema,
    /** Executable depth at −5 %, the pair currency, raw. */
    depth5Raw: LaunchRaw.nullable(),
    daysSinceDex: z.number().int().nonnegative().nullable(),
    traded24h: z.boolean().nullable(),
    /** Wallets worth more than a dollar, without pools, locks and Ryntra's wallets. */
    holders: z.number().int().nonnegative().nullable(),
    /** The node would not scan every account of the mint: `holders` counts the ones found — a floor. */
    holdersAtLeast: z.boolean(),
    /** The creator's lock — on a row not read, as Ryntra's record holds it, with no dates; null when there is none, or none known. */
    creatorLock: LaunchMarketLockView.nullable(),
    /** Whether the creator sold any of the token; null when their trades were not read whole and no sale was seen. */
    creatorSold: z.boolean().nullable(),
    observedAt: Iso,
  })
  .strict();
export type LaunchMarketRow = z.infer<typeof LaunchMarketRowSchema>;

/** `GET /api/v1/launch/markets` — every market launched on Ryntra on this network: with a trade in the last day first, then by state and the newest. */
export const LaunchMarketsResponseSchema = z
  .object({
    network: LaunchNetworkId,
    markets: z.array(LaunchMarketRowSchema).max(500),
    /** Every market's chain was read for this answer. */
    complete: z.boolean(),
    observedAt: Iso,
  })
  .strict();
export type LaunchMarketsResponse = z.infer<typeof LaunchMarketsResponseSchema>;

const LaunchSurvivalDays = z.union([z.literal(SURVIVAL_HORIZONS_DAYS[0]), z.literal(SURVIVAL_HORIZONS_DAYS[1]), z.literal(SURVIVAL_HORIZONS_DAYS[2])]);

const LaunchSurvivalTallySchema = z
  .object({
    /** Markets at least this many days old. */
    eligible: z.number().int().nonnegative(),
    /** Someone other than the creator and Ryntra's own wallets traded it in the week up to that day. */
    alive: z.number().int().nonnegative(),
    /** That week was read whole and had no such trade. */
    quiet: z.number().int().nonnegative(),
    /** That week was not read whole — never counted as quiet. */
    unread: z.number().int().nonnegative(),
  })
  .strict();

/**
 * `GET /api/v1/launch/survival` (1.55.0, SOL-L3) — the survival of every market launched on Ryntra on this network at
 * 7, 30 and 90 days, from the chain: alive at day N when someone other than its creator and Ryntra's own wallets traded
 * it in the `windowDays` up to day N, each proven by that trade's transaction; people's markets and Ryntra's own apart.
 */
export const LaunchSurvivalResponseSchema = z
  .object({
    network: LaunchNetworkId,
    windowDays: z.literal(SURVIVAL_WINDOW_DAYS),
    horizons: z
      .array(z.object({ days: LaunchSurvivalDays, people: LaunchSurvivalTallySchema, ryntra: LaunchSurvivalTallySchema }).strict())
      .length(SURVIVAL_HORIZONS_DAYS.length),
    markets: z
      .array(
        z
          .object({
            token: Address,
            symbol: z.string().max(16),
            launchedAt: Iso,
            /** Launched by one of Ryntra's own wallets: technical validation, never demand. */
            own: z.boolean(),
            outcomes: z
              .array(
                z
                  .object({
                    days: LaunchSurvivalDays,
                    state: z.enum(SURVIVAL_STATES),
                    /** The trade that proves «alive»; null otherwise. */
                    proof: z.object({ signature: z.string().min(64).max(90), at: Iso }).strict().nullable(),
                  })
                  .strict(),
              )
              .length(SURVIVAL_HORIZONS_DAYS.length),
          })
          .strict(),
      )
      .max(500),
    /** `markets` names every market counted; false — it names the newest 500, and the tallies count them all. */
    listedAll: z.boolean(),
    /** Every one of Ryntra's own wallets was known: false — a market's own flag and its outcomes may move once they are. */
    ownWalletsComplete: z.boolean(),
    /** No outcome is «not read». */
    complete: z.boolean(),
    observedAt: Iso,
  })
  .strict();
export type LaunchSurvivalResponse = z.infer<typeof LaunchSurvivalResponseSchema>;

/* ---------------------------------------------------------------- 1.74.0 (MC-2): launch windows and crews */

const LaunchWindowId = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:00Z$/);
const LaunchWindowSchema = z
  .object({
    /** The opening to the minute, UTC — one window per hour, so it names the window. */
    id: LaunchWindowId,
    kind: z.enum(WINDOW_KINDS),
    opensAt: Iso,
    closesAt: Iso,
  })
  .strict();

/**
 * `GET /api/v1/launch/windows` (1.74.0, MC-2) — the launch windows' published schedule: a small window at the top of
 * every hour UTC, a big one every evening; the one open now, the next and the next evening. A window is a time only:
 * a launch whose launch time (taken when its creation is sent) falls while one is open is in it. The equal start inside it is each curve's own
 * anti-sniper fee. Public; no read of the chain.
 */
export const LaunchWindowsResponseSchema = z
  .object({
    open: LaunchWindowSchema.nullable(),
    next: LaunchWindowSchema,
    nextEvening: LaunchWindowSchema,
    schedule: z
      .object({
        hourlyMinutes: z.literal(HOURLY_WINDOW_MINUTES),
        eveningHourUtc: z.literal(EVENING_WINDOW_HOUR_UTC),
        eveningMinutes: z.literal(EVENING_WINDOW_MINUTES),
      })
      .strict(),
    observedAt: Iso,
  })
  .strict();
export type LaunchWindowsResponse = z.infer<typeof LaunchWindowsResponseSchema>;

/** X's own handle rule, without the «@». Ryntra does not read X: a handle is the person's word, confirmed by their wallet. */
const XHandle = z.string().regex(/^[A-Za-z0-9_]{1,15}$/);

/** `POST /api/v1/launch/crews` (1.74.0, MC-2) — the creator's proven wallet invites one to four people by X handle. */
export const LaunchCrewCreateRequestSchema = z
  .object({
    creator: Address,
    creatorHandle: XHandle.nullable(),
    symbol: z.string().min(1).max(16),
    name: z.string().min(1).max(64),
    preset: z.enum(CREW_PRESETS),
    /** A launch window still ahead, or null — «now». */
    window: LaunchWindowId.nullable(),
    invites: z
      .array(z.object({ handle: XHandle, bps: z.number().int().min(CREW_MIN_BPS).max(10_000) }).strict())
      .min(CREW_MIN_MEMBERS)
      .max(CREW_MAX_MEMBERS),
  })
  .strict();
export type LaunchCrewCreateRequest = z.infer<typeof LaunchCrewCreateRequestSchema>;

/** `POST /api/v1/launch/crews/{id}/answer` (1.74.0) — an invitee's own yes or no, with their proven wallet. */
export const LaunchCrewAnswerRequestSchema = z.object({ handle: XHandle, answer: z.enum(["accept", "decline"]) }).strict();
export type LaunchCrewAnswerRequest = z.infer<typeof LaunchCrewAnswerRequestSchema>;

const LaunchCrewSchema = z
  .object({
    id: LaunchCrewId,
    creator: Address,
    creatorHandle: XHandle.nullable(),
    symbol: z.string().max(16),
    name: z.string().max(64),
    preset: z.enum(CREW_PRESETS),
    window: LaunchWindowId.nullable(),
    members: z
      .array(
        z
          .object({
            handle: XHandle,
            bps: LaunchBpsShare,
            state: z.enum(CREW_MEMBER_STATES),
            /** The wallet that said yes — the vault's row at liftoff; null otherwise. */
            wallet: Address.nullable(),
            answeredAt: Iso.nullable(),
            /** The words the invitee says yes to, as the page shows them. */
            consent: z.array(z.string().max(600)).max(8),
          })
          .strict(),
      )
      .max(CREW_MAX_MEMBERS),
    /** The creator's part now: everything the members who said yes do not take. */
    creatorBps: LaunchBpsShare,
    createdAt: Iso,
    expiresAt: Iso,
    /** Its week passed before liftoff: nobody answers it, nobody launches with it. */
    expired: z.boolean(),
    /** The token it lifted off with; null until then. */
    token: Address.nullable(),
    launchedAt: Iso.nullable(),
  })
  .strict();

/** A crew as anyone reads it (`GET /api/v1/launch/crews/{id}`), and as a write answers it. */
export const LaunchCrewResponseSchema = z
  .object({
    network: LaunchNetworkId,
    crew: LaunchCrewSchema,
    /** Crews may be made and answered on this network now. */
    open: z.boolean(),
  })
  .strict();
export type LaunchCrewResponse = z.infer<typeof LaunchCrewResponseSchema>;

/**
 * `GET /api/v1/launch/crews` (1.74.0) — the crews in flight on this network: each launch whose Dynamic Fee Sharing
 * vault holds the curve's creator role, with that vault's own rows by wallet and part. No handle: a handle is the
 * person's word, never checked against X, and nothing public names a member by one.
 */
export const LaunchCrewsResponseSchema = z
  .object({
    network: LaunchNetworkId,
    crews: z
      .array(
        z
          .object({
            token: Address,
            symbol: z.string().max(16),
            creator: Address,
            creatorBps: LaunchBpsShare,
            members: z.array(z.object({ wallet: Address, bps: LaunchBpsShare }).strict()).min(1).max(CREW_MAX_MEMBERS),
            window: LaunchWindowId.nullable(),
            launchedAt: Iso.nullable(),
          })
          .strict(),
      )
      .max(500),
    observedAt: Iso,
  })
  .strict();
export type LaunchCrewsResponse = z.infer<typeof LaunchCrewsResponseSchema>;

/** `GET /api/v1/launch/markets/{mint}` — one market's row and the addresses it lives at. */
export const LaunchMarketCardResponseSchema = z
  .object({
    network: LaunchNetworkId,
    market: LaunchMarketRowSchema,
    addresses: z
      .object({
        config: Address,
        curve: Address,
        pairMint: Address,
        /** The DAMM v2 pool it graduated into; null before the DEX or when not read. */
        pool: Address.nullable(),
        /** The pool's positions locked for ever, with their owners; empty before the DEX or when not read. */
        lockedPositions: z.array(z.object({ position: Address, owner: Address }).strict()).max(8),
        /** The creator's lock escrow; null when there is none. */
        creatorLock: Address.nullable(),
        /** The vault sharing the creator's fees; null when they are not shared. */
        feeVault: Address.nullable(),
        /** Ryntra's steps: the DLMM pool and its position; null when there are none. */
        ladder: z.object({ pool: Address, position: Address.nullable() }).strict().nullable(),
        /** Ryntra's executor on this network; null while there is none. */
        executor: Address.nullable(),
      })
      .strict(),
    observedAt: Iso,
  })
  .strict();
export type LaunchMarketCardResponse = z.infer<typeof LaunchMarketCardResponseSchema>;

/** `GET /api/v1/launch/{mint}/health` — the market's health by fixed definitions; a figure not read is null, never zero. */
export const LaunchMarketHealthResponseSchema = z
  .object({
    network: LaunchNetworkId,
    token: Address,
    pair: LaunchPairView,
    tokenDecimals: z.number().int().min(0).max(18),
    state: MarketStateView,
    technicalValidation: z.boolean(),
    venue: LaunchTradeVenueSchema,
    /** The price now: the pair currency per token, and in dollars when the pair is a dollar. */
    price: LaunchMoney,
    /** At −2, −5 and −10 %. */
    depth: z.array(LaunchMarketDepthSchema).length(DEPTH_DROPS_BPS.length),
    budget: LaunchMarketBudgetSchema,
    /**
     * Ryntra's steps as they stand: what they hold, and the lowest and highest price (the pair currency per token) of the
     * steps holding the pair currency — null when none does: sales went through them, and they hold the token. Null
     * when there are none or they were not read (`budget.ladder` says which).
     */
    ladder: z
      .object({ pool: Address, pairRaw: LaunchRaw, tokensRaw: LaunchRaw, pairFrom: z.number().positive().nullable(), pairTo: z.number().positive().nullable() })
      .strict()
      .nullable(),
    survival: z
      .object({
        /** When it reached the DEX; null before it or when not known. */
        graduatedAt: Iso.nullable(),
        daysSinceDex: z.number().int().nonnegative().nullable(),
        /** The price now against the price the pool opened at, basis points, signed. */
        priceVsDexBps: z.number().int().nullable(),
        traded24h: z.boolean().nullable(),
        lastTradeAt: Iso.nullable(),
      })
      .strict(),
    holders: z
      .object({
        /** Wallets worth more than `minUsd` at the price now, without pools, locks and Ryntra's own wallets. */
        count: z.number().int().nonnegative().nullable(),
        /** The node would not scan every account of the mint: `count` is of the holders found — a floor, said «at least». */
        atLeast: z.boolean(),
        minUsd: z.literal(HOLDER_MIN_USD),
      })
      .strict(),
    creator: z
      .object({
        address: Address,
        lock: LaunchMarketLockView.nullable(),
        /**
         * 1.38.0 — the preset requires the creator's first purchase under a lock (Micro) and the creator bought one: with
         * `lock` null the preset's rule was not kept — the lock is a second transaction after the creation, and it did not land.
         */
        lockRequired: z.boolean(),
        /** Whether the creator sold any of the token; null when their trades were not read whole and no sale was seen. */
        sold: z.boolean().nullable(),
        /** How much they sold, of what they bought here or of the supply; null when nothing or not read. */
        soldBps: z.number().int().min(0).max(1_000_000).nullable(),
        soldOf: z.enum(["bought", "supply"]).nullable(),
      })
      .strict(),
    concentration: z
      .object({
        /**
         * The ten largest balances without pools and locks, basis points of the tokens outside them: from every account of
         * the mint, or from its largest accounts over the supply less the pools and the locks; null when neither was read.
         */
        top10Bps: LaunchBps.nullable(),
        /** From the largest accounts: a wallet holding more than one account may hold more — `top10Bps` is a floor. */
        atLeast: z.boolean(),
        /** Above `markBps`: marked on the page, never a pause while the market is young; null when not read, or a floor at or below it. */
        marked: z.boolean().nullable(),
        markBps: z.literal(CONCENTRATION_MARK_BPS),
      })
      .strict(),
    engine: z
      .object({
        /** Ryntra's executor named on this network — the wallet whose acts the log calls Ryntra's; null while there is none. */
        executor: Address.nullable(),
        /** Whether it acts on this network now: its key on this server, Launch's operator stop open, a pass of its own finished in the last 15 minutes, every market not stopped by Ryntra's operator (1.37.0), and the switch read. */
        acts: z.boolean(),
        /** 1.47.0: true when whether it acts could not be read now and no recent read stands in — `acts` is false by not knowing, never a stop; absent when read. */
        actsUnread: z.boolean().optional(),
        /** Its last act on this market, from the flight log. */
        lastAction: z.object({ kind: z.enum(JOURNAL_KINDS), at: Iso.nullable(), signature: LaunchSignature }).strict().nullable(),
        /**
         * A stop of Ryntra's acts on this market — `OPERATOR` (1.37.0): Ryntra's operator stopped the executor on this
         * market or on every market, at `at`; `STOPPED`: Ryntra's steps stand here and its executor does not act or may
         * not move them now; `RISK_LIMIT` (1.39.0): a risk limit of the market's budget holds — `risks`. Null when none.
         */
        pause: z
          .object({
            code: z.enum(["OPERATOR", "STOPPED", "RISK_LIMIT"]),
            at: Iso.nullable(),
            /** 1.39.0, `RISK_LIMIT`: the budget's limits that hold — each stops new money into Ryntra's steps. */
            risks: z.array(z.enum(BUDGET_RISKS)).max(BUDGET_RISKS.length).optional(),
          })
          .strict()
          .nullable(),
      })
      .strict(),
    rules: z.array(LaunchMarketRuleSchema).max(32),
    /** Whether the token's receipt was read: false — its own rules and the pool's locked positions are missing from `rules`. */
    rulesComplete: z.boolean(),
    observedAt: Iso,
  })
  .strict();
export type LaunchMarketHealthResponse = z.infer<typeof LaunchMarketHealthResponseSchema>;

/* ------------------------------------------------------------ «Події ринку» (1.68.0, DSC-1) */

const EventSignature = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,90}$/);
const EventRaw = z.string().regex(/^\d{1,40}$/);

/** One event: one fact with its source, its time, its link on the chain and how final it is — never advice. */
export const MarketEventSchema = z
  .object({
    /** `signature:index` for a fact with a transaction; `source:mint:kind[:key]` for a fact a provider states without one. */
    id: z.string().min(1).max(200),
    kind: z.enum(EVENT_KINDS),
    network: z.enum(["mainnet", "devnet"]),
    token: z
      .object({
        mint: Address,
        symbol: z.string().max(32),
        name: z.string().max(80),
        /** A picture only for a token Jupiter verified. */
        icon: z.string().url().nullable(),
        /** The token's own page on Ryntra — its quote and Review are there. */
        href: z.string().startsWith("/app/").max(200),
        launchedOnRyntra: z.boolean(),
      })
      .strict(),
    /** When it happened — the block's time, a provider's stated time or a lock's cliff; null when no source states it. */
    happenedAt: Iso.nullable(),
    /** A fact stated over a window rather than at a moment. */
    happenedWithin: z.enum(["h1", "h24"]).nullable(),
    /** When this server first saw it — or, for a figure from a held copy of a provider's list, when that list was read. */
    observedAt: Iso,
    sources: z.array(z.enum(EVENT_SOURCES)).min(1).max(EVENT_SOURCES.length),
    /** `confirmed` — its transaction read at confirmed commitment; `reported` — a provider states it; `scheduled` — a time an account on the chain holds. */
    finality: z.enum(EVENT_FINALITY),
    /** Its figures are a held copy from an earlier read. */
    stale: z.boolean(),
    signature: EventSignature.nullable(),
    /** The account to open where there is no transaction: the mint, the pool, the escrow, the vault. */
    account: Address.nullable(),
    /** The explorer's page of the transaction, or of the account where there is none. */
    explorerUrl: z.string().url(),
    route: z.object({ from: z.enum(EVENT_VENUES).nullable(), to: z.enum(["damm-v2"]).nullable() }).strict().nullable(),
    actor: z.enum(JOURNAL_ACTORS).nullable(),
    journalKind: z.enum(JOURNAL_KINDS).nullable(),
    soldBps: z.number().int().min(0).max(1_000_000).nullable(),
    soldOf: z.enum(["bought", "supply"]).nullable(),
    changePct: z.number().finite().nullable(),
    authority: z.enum(["MINT", "FREEZE"]).nullable(),
    unlock: z.enum(["cliff", "end"]).nullable(),
    pairRaw: EventRaw.nullable(),
    tokensRaw: EventRaw.nullable(),
    pair: z.object({ symbol: z.string().min(1).max(12), decimals: z.number().int().min(0).max(18) }).strict().nullable(),
    tokenDecimals: z.number().int().min(0).max(18).nullable(),
    /** The token's risk flags, as Pulse reads them — facts, never a score. */
    flags: z.array(z.enum(EVENT_FLAGS)).max(EVENT_FLAGS.length),
    /** The figures those flags rest on that nobody stated — never counted as passed. */
    unstated: z.array(z.enum(EVENT_UNSTATED)).max(EVENT_UNSTATED.length),
    borrowedLabel: z.string().max(80).nullable(),
    /** Why the event is held below the top of the feed; empty for every other. */
    suspicious: z.array(z.enum(SUSPICION_REASONS)).max(SUSPICION_REASONS.length),
  })
  .strict();
export type MarketEventView = z.infer<typeof MarketEventSchema>;

/** `GET /api/v1/events` — the feed, the newest first, a suspicious token's event never above the first five clean ones; public. */
export const MarketEventsResponseSchema = z
  .object({
    events: z.array(MarketEventSchema).max(EVENTS_MAX),
    /** The feed's events before `limit` — after the kinds and the mint asked for. */
    total: z.number().int().nonnegative(),
    observedAt: Iso,
    stale: z.boolean(),
    /** A source did not answer, or answered in part: events may be missing — never older ones in their place. */
    partial: z.boolean(),
    sources: z.array(z.enum(EVENT_SOURCES)).max(EVENT_SOURCES.length),
    /** The flight logs read for this answer against the people's markets launched on Ryntra — the most active first; null where Launch is not served. */
    logs: z.object({ read: z.number().int().nonnegative(), markets: z.number().int().nonnegative() }).strict().nullable(),
    /** Every kind: read, read in part, or not read yet — a kind not read is never a quiet market. */
    coverage: z.array(z.object({ kind: z.enum(EVENT_KINDS), state: z.enum(["read", "partial", "not-read"]), sources: z.array(z.enum(EVENT_SOURCES)).max(EVENT_SOURCES.length) }).strict()).length(EVENT_KINDS.length),
  })
  .strict();
export type MarketEventsResponse = z.infer<typeof MarketEventsResponseSchema>;

/* ---------------------------------------------------------------- 1.75.0 (TEAM-1): a team's roles and rights */

const TeamId = z.string().regex(/^[0-9a-f]{24}$/);
const TeamNetworkId = z.enum(["solana:devnet", "solana:mainnet"]);
const TeamGrantsSchema = z.record(z.enum(TEAM_PERMISSIONS), z.enum(TEAM_GRANTS));

/**
 * `GET /api/v1/teams/roles` (1.75.0, TEAM-1) — the matrix every team check runs on: nine roles × the nine rights of spec
 * §9.2 and `members`, each `ALLOW`, `MULTISIG` (only as a proposal on the team's Squads treasury, through the EXE-1
 * rows named) or `DENY`. Public; the same on every deployment.
 */
export const TeamRolesResponseSchema = z
  .object({
    kinds: z.array(z.enum(TEAM_KINDS)).length(TEAM_KINDS.length),
    roles: z.array(z.enum(TEAM_ROLES)).length(TEAM_ROLES.length),
    permissions: z
      .array(
        z
          .object({
            id: z.enum(TEAM_PERMISSIONS),
            risk: z.enum(TEAM_RISKS),
            /** The EXE-1 rows a high-risk right runs through — each signed by the multisig; empty for a lower right, and for a high-risk one no team can use yet. */
            authority: z.array(z.string().max(64)).max(8),
            /** The Squads permission the acting wallet must hold on the treasury; null for a lower right. */
            squadsPermission: z.enum(["initiate", "vote"]).nullable(),
          })
          .strict(),
      )
      .length(TEAM_PERMISSIONS.length),
    matrix: z.record(z.enum(TEAM_ROLES), TeamGrantsSchema),
    limits: z
      .object({
        membersPerTeam: z.number().int().positive(),
        teamsCreatedPerWallet: z.number().int().positive(),
        membershipsPerWallet: z.number().int().positive(),
        invitationsPerWallet: z.number().int().positive(),
        inviteDays: z.number().int().positive(),
      })
      .strict(),
    /** Teams are served on this deployment now (the treasury's network named and the TEAM-1 store open). */
    open: z.boolean(),
    network: TeamNetworkId.nullable(),
  })
  .strict();
export type TeamRolesResponse = z.infer<typeof TeamRolesResponseSchema>;

const TeamSummarySchema = z
  .object({
    id: TeamId,
    name: z.string().min(1).max(64),
    kind: z.enum(TEAM_KINDS),
    treasury: Address.nullable(),
    role: z.enum(TEAM_ROLES),
    status: z.enum(TEAM_MEMBER_STATUSES),
    /** The list's length — to an active member; 0 to an invitation. */
    members: z.number().int().nonnegative(),
  })
  .strict();

/** `GET /api/v1/teams` (1.75.0) — the proven wallet's teams on this network, invitations within their week included: one wallet, many teams, a role in each. */
export const TeamsResponseSchema = z.object({ network: TeamNetworkId, teams: z.array(TeamSummarySchema).max(100) }).strict();
export type TeamsResponse = z.infer<typeof TeamsResponseSchema>;

/** `POST /api/v1/teams` (1.75.0) — a team made by the proven wallet, which becomes its first Owner. */
export const TeamCreateRequestSchema = z.object({ name: z.string().min(1).max(64), kind: z.enum(TEAM_KINDS) }).strict();
export type TeamCreateRequest = z.infer<typeof TeamCreateRequestSchema>;

const TeamMemberSchema = z
  .object({
    wallet: Address,
    role: z.enum(TEAM_ROLES),
    status: z.enum(TEAM_MEMBER_STATUSES),
    label: z.string().max(40).nullable(),
    invitedBy: Address,
    invitedAt: Iso,
    joinedAt: Iso.nullable(),
  })
  .strict();

const TeamJournalRowSchema = z
  .object({
    at: Iso,
    actor: Address,
    action: z.enum(TEAM_JOURNAL_ACTIONS),
    subject: Address.nullable(),
    role: z.enum(TEAM_ROLES).nullable(),
    previousRole: z.enum(TEAM_ROLES).nullable(),
  })
  .strict();

const TeamSchema = z
  .object({
    id: TeamId,
    network: TeamNetworkId,
    name: z.string().min(1).max(64),
    kind: z.enum(TEAM_KINDS),
    treasury: Address.nullable(),
    createdBy: Address,
    createdAt: Iso,
    version: z.number().int().nonnegative(),
    you: z.object({ wallet: Address, role: z.enum(TEAM_ROLES), status: z.enum(TEAM_MEMBER_STATUSES), grants: TeamGrantsSchema }).strict(),
    /** The list — to an active member only; null to an invitation. */
    members: z.array(TeamMemberSchema).max(50).nullable(),
    /** The newest rows of the append-only journal — to a member who reads receipts; null otherwise. */
    journal: z.array(TeamJournalRowSchema).max(50).nullable(),
    /**
     * The treasury's members on chain beside the list (spec §9.6): `inTeam: false` is a key still on the multisig whose
     * wallet is not an active member — removed from the team, it is removed from the multisig only by a proposal.
     */
    signers: z
      .discriminatedUnion("read", [
        z
          .object({
            read: z.literal("OK"),
            rows: z
              .array(z.object({ address: Address, initiate: z.boolean(), vote: z.boolean(), execute: z.boolean(), inTeam: z.boolean(), role: z.enum(TEAM_ROLES).nullable() }).strict())
              .max(65),
          })
          .strict(),
        z.object({ read: z.literal("UNREAD") }).strict(),
      ])
      .nullable(),
  })
  .strict();

/** `GET /api/v1/teams/{id}` and every team write (1.75.0) — the team as the proven wallet may read it. */
export const TeamResponseSchema = z.object({ team: TeamSchema }).strict();
export type TeamResponse = z.infer<typeof TeamResponseSchema>;

/** `POST /api/v1/teams/{id}/members` (1.75.0) — an invitation: a role for a wallet, held only once that wallet says yes. */
export const TeamInviteRequestSchema = z.object({ wallet: Address, role: z.enum(TEAM_ROLES), label: z.string().max(40).nullable().optional() }).strict();
export type TeamInviteRequest = z.infer<typeof TeamInviteRequestSchema>;

/** `POST /api/v1/teams/{id}/members/{wallet}` (1.75.0) — the wallet's own yes, a new role, or removal (by the wallet itself: leaving). */
export const TeamMemberChangeRequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("accept") }).strict(),
  z.object({ action: z.literal("role"), role: z.enum(TEAM_ROLES) }).strict(),
  z.object({ action: z.literal("remove") }).strict(),
]);
export type TeamMemberChangeRequest = z.infer<typeof TeamMemberChangeRequestSchema>;

/** The answer to a member change: the team as the wallet reads it after, or null when the wallet left it. */
export const TeamMemberChangeResponseSchema = z.object({ team: TeamSchema.nullable() }).strict();
export type TeamMemberChangeResponse = z.infer<typeof TeamMemberChangeResponseSchema>;

/** `POST /api/v1/teams/{id}/treasury` (1.75.0) — an Owner links, once, a Squads v4 multisig their wallet may propose on; a linked treasury changes only by its own multisig. */
export const TeamTreasuryRequestSchema = z.object({ multisig: Address }).strict();
export type TeamTreasuryRequest = z.infer<typeof TeamTreasuryRequestSchema>;

/**
 * `GET /api/v1/teams/{id}/check?permission=&authority=` (1.75.0) — the server's decision for the proven wallet, the
 * same one every team action takes before anything is built: role, membership, treasury, the EXE-1 row's state on this
 * deployment and, for a high-risk right, the wallet's Squads permission on the treasury read on chain.
 */
export const TeamCheckResponseSchema = z
  .object({
    teamId: TeamId,
    wallet: Address,
    allowed: z.boolean(),
    permission: z.enum(TEAM_PERMISSIONS),
    role: z.enum(TEAM_ROLES).nullable(),
    grant: z.enum(TEAM_GRANTS),
    risk: z.enum(TEAM_RISKS),
    requires: z.enum(["NOTHING", "MULTISIG"]),
    refusal: z.enum(TEAM_REFUSALS).nullable(),
    authority: z.object({ id: z.string().max(64), state: z.enum(HONEST_STATES), enforcement: z.enum(ENFORCEMENT_LEVELS), signer: z.enum(SIGNERS) }).strict().nullable(),
    multisig: Address.nullable(),
    squadsPermission: z.enum(["initiate", "vote"]).nullable(),
  })
  .strict();
export type TeamCheckResponse = z.infer<typeof TeamCheckResponseSchema>;

/* ---------------------------------------------------------------- 1.81.0 (MOS-2): Team Launch */

/** Whole base units as a string of decimal digits: no sign, no comma, no exponent — the chain holds no fraction of a unit. */
const TeamLaunchRaw = z.string().regex(/^(0|[1-9][0-9]*)$/).max(40);

/**
 * `GET /api/v1/launch/team/plan?team=` (1.81.0, MOS-2) — what the wizard draws before anything is typed: the eight
 * steps of spec §7.3 in their order, the TEAM-1 rights each one needs, the
 * bounds the steps obey, and whether Team Launch is open here at all. A proven wallet is required with `team=` and
 * welcome without it: with `team=` each step also carries that wallet's own decision, so the column marks what it may
 * commit and what waits for the treasury, and a canary can answer `open` only to a wallet it can name.
 * The first launch is the owner's canary on named wallets (`open: false` until then; `LAUNCH_TEAM_CLOSED` on a write).
 */
export const TeamLaunchPlanResponseSchema = z
  .object({
    /** Team Launch is served to this wallet on this deployment now. A canary names its wallets; closed is not announced. */
    open: z.boolean(),
    network: z.enum(["devnet", "mainnet"]),
    /**
     * Whether Ryntra's executor claims the market's budget on people's markets on this network now (SOL-L6). False —
     * the fees wait in Meteora's pool, so the review's `budget.fundable` is false and no ladder is promised.
     */
    peopleServed: z.boolean(),
    steps: z
      .array(
        z
          .object({
            n: z.number().int().min(1).max(TEAM_LAUNCH_STEP_KEYS.length),
            key: z.enum(TEAM_LAUNCH_STEP_KEYS),
            /** Every right the step needs — not the first: a step that needs two happens only when both are allowed. */
            permissions: z.array(z.enum(TEAM_PERMISSIONS)).min(1).max(4),
            name: z.object({ uk: z.string().min(1).max(64), en: z.string().min(1).max(64) }).strict(),
            /** With `team=`: the server's decision for the proven wallet, right by right; absent without a team. */
            decisions: z.array(TeamCheckResponseSchema.pick({ permission: true, allowed: true, grant: true, requires: true, refusal: true, multisig: true, squadsPermission: true })).max(4).optional(),
          })
          .strict(),
      )
      .length(TEAM_LAUNCH_STEP_KEYS.length),
    /** The bounds the steps check, so a client never hard-codes them: the tokenomics' and the market budget's own. */
    bounds: z
      .object({
        /** Shares are whole per cent of the supply and add up to this; the base units add up to the supply exactly. */
        allocationTotalPct: z.literal(ALLOCATION_TOTAL_PCT),
        allocationCategories: z.array(z.enum(ALLOCATION_CATEGORIES)).length(ALLOCATION_CATEGORIES.length),
        allocationMaxDays: z.literal(ALLOCATION_MAX_DAYS),
        budgetSources: z.array(z.enum(BUDGET_SOURCES)).length(BUDGET_SOURCES.length),
        /** The most of the market's earned budget the ladder may hold at once, and the fall that stops new money — basis points. */
        deployedBpsMax: z.number().int().positive(),
        pauseOnDropBps: z.number().int().positive(),
        feeShareMaxRecipients: z.literal(FEE_SHARE_MAX_RECIPIENTS),
        feeShareMinBps: z.literal(FEE_SHARE_MIN_BPS),
      })
      .strict(),
    /** The EXE-1 row every step of Team Launch runs through, resolved on this deployment. */
    authority: z.object({ id: z.string().max(64), state: z.enum(HONEST_STATES), enforcement: z.enum(ENFORCEMENT_LEVELS), signer: z.enum(SIGNERS) }).strict(),
  })
  .strict();
export type TeamLaunchPlanResponse = z.infer<typeof TeamLaunchPlanResponseSchema>;

const TeamLaunchAllocationRowSchema = z
  .object({
    category: z.enum(ALLOCATION_CATEGORIES),
    /** Whole per cent of the supply: no fraction anywhere, and the rows add up to 100. */
    pct: z.number().int().min(1).max(ALLOCATION_TOTAL_PCT),
    recipient: Address.nullable(),
    cliffDays: z.number().int().min(0).max(ALLOCATION_MAX_DAYS),
    unlockDays: z.number().int().min(0).max(ALLOCATION_MAX_DAYS),
  })
  .strict();

const MintAuthorityChoice = z.enum(["revoked", "kept"]);

/** The whole of the eight steps in one object: going back and forward loses nothing, because nothing is kept per step. */
export const TeamLaunchDraftSchema = z
  .object({
    teamId: z.string().regex(/^[0-9a-f]{24}$/),
    project: z.object({ name: z.string().max(64), summary: z.string().max(600), website: z.string().max(200), x: z.string().max(16) }).strict(),
    token: z
      .object({
        name: z.string().max(32),
        symbol: z.string().max(10),
        decimals: z.number().int().min(0).max(9),
        supply: z.number().int().min(1).max(1_000_000_000_000),
        authorities: z.object({ mint: MintAuthorityChoice, freeze: MintAuthorityChoice, update: MintAuthorityChoice }).strict(),
      })
      .strict(),
    allocation: z.array(TeamLaunchAllocationRowSchema).max(ALLOCATION_CATEGORIES.length),
    curve: z
      .object({
        preset: z.enum(LAUNCH_PRESET_IDS),
        /** Whole base units of the pair currency the team spends on its first purchase; `"0"` — the market opens with no trade. */
        firstBuyQuoteRaw: TeamLaunchRaw,
        firstBuyLockDays: z.number().int().min(0).max(ALLOCATION_MAX_DAYS),
      })
      .strict(),
    liquidity: z.object({ lpLockedForEver: z.literal(true), budgetSources: z.array(z.enum(BUDGET_SOURCES)).max(BUDGET_SOURCES.length) }).strict(),
    rights: z
      .object({
        /** The team's Squads multisig: step 06 and step 08 happen only through it. */
        treasury: Address.nullable(),
        feeShares: z.array(z.object({ address: Address, bps: z.number().int().min(FEE_SHARE_MIN_BPS).max(FEE_SHARE_TOTAL_BPS - FEE_SHARE_MIN_BPS) }).strict()).max(FEE_SHARE_MAX_RECIPIENTS - 1),
        /** The market's rules are read after the launch, never rewritten: the Constitution is one document per market. */
        rulesChangeable: z.literal(false),
      })
      .strict(),
    automation: z
      .object({
        ladder: z.boolean(),
        deployedBpsMax: z.number().int().min(1).max(FEE_SHARE_TOTAL_BPS),
        pauseOnDropBps: z.number().int().min(1).max(FEE_SHARE_TOTAL_BPS),
        stopByHand: z.boolean(),
      })
      .strict(),
  })
  .strict();
export type TeamLaunchDraftBody = z.infer<typeof TeamLaunchDraftSchema>;

/** `POST /api/v1/launch/team/step` (1.81.0, MOS-2) — one step of the wizard, committed by the proven wallet. */
export const TeamLaunchStepRequestSchema = z.object({ step: z.enum(TEAM_LAUNCH_STEP_KEYS), draft: TeamLaunchDraftSchema }).strict();
export type TeamLaunchStepRequest = z.infer<typeof TeamLaunchStepRequestSchema>;

const TeamLaunchFeeLineSchema = z
  .object({
    /** `curve` — every trade on the curve; `graduation` — once, at the move to the DEX; `pool` — every trade after it. */
    when: z.enum(["curve", "graduation", "pool"]),
    key: z.string().max(48),
    name: z.object({ uk: z.string().min(1).max(80), en: z.string().min(1).max(80) }).strict(),
    /** Basis points of what `of` names — never summed with another row's. */
    bps: z.number().int().min(0).max(FEE_SHARE_TOTAL_BPS),
    party: z.enum(["creator", "team", "ryntra", "meteora", "budget", "pool", "positions"]),
    of: z.enum(["fee", "raised", "liquidity"]),
  })
  .strict();

/** Step 08's review: what the signature would do, before any wallet is asked. No price is promised in it. */
export const TeamLaunchReviewSchema = z
  .object({
    simulation: z
      .object({
        preset: z.enum(LAUNCH_PRESET_IDS),
        supplyRaw: TeamLaunchRaw,
        circulatingRaw: TeamLaunchRaw,
        lockedRaw: TeamLaunchRaw,
        /** The rows as whole base units: they add up to `supplyRaw` exactly. */
        allocation: z
          .array(
            TeamLaunchAllocationRowSchema.extend({ unitsRaw: TeamLaunchRaw, circulating: z.boolean() })
              .strict(),
          )
          .max(ALLOCATION_CATEGORIES.length),
        startMarketCapUsd: z.number().nonnegative(),
        graduationMarketCapUsd: z.number().nonnegative(),
        graduationQuote: z.number().nonnegative().nullable(),
        firstBuyQuoteRaw: TeamLaunchRaw,
        /** The most of the supply that first purchase may receive — the preset's own rule, in base units of the token. */
        firstBuyCapRaw: TeamLaunchRaw,
        sniperFee: z.object({ startBps: z.number().int(), endBps: z.number().int(), seconds: z.number().int() }).strict(),
        exitLiquidity: z.object({ creatorPct: z.number(), ryntraPct: z.number() }).strict(),
        /** What a day-one holder's share becomes once every lock has opened: arithmetic, not a forecast. */
        dilutionBps: z.number().int().min(0).max(FEE_SHARE_TOTAL_BPS),
      })
      .strict(),
    fees: z.array(TeamLaunchFeeLineSchema).max(32),
    budget: z
      .object({
        sources: z.array(z.enum(BUDGET_SOURCES)).max(BUDGET_SOURCES.length),
        feeShareBps: z.number().int().nullable(),
        /** Whether anything funds this market's budget on this preset; false — the ladder does not run, whatever step 07 asked. */
        fundable: z.boolean(),
        deployedBpsMax: z.number().int(),
        minStepRaw: TeamLaunchRaw,
        maxSteps: z.number().int(),
        pauseOnDropBps: z.number().int(),
        ladder: z.boolean(),
        /** The ladder is depth that can be eaten, never a floor under the price. */
        notAFloor: z.literal(true),
      })
      .strict(),
    /** The Market Constitution (MOS-1) as the steps filled it, every field with its enforcement source; null — not named yet. */
    constitution: z
      .array(z.object({ section: z.string().max(32), key: z.string().max(48), value: z.string().max(400).nullable(), enforcement: z.enum(CONSTITUTION_ENFORCEMENT) }).strict())
      .max(64),
    /** The market's chronicle as it will be written: who writes each row, and what nothing writes yet. */
    chronicle: z
      .array(
        z
          .object({ key: z.string().max(32), name: z.object({ uk: z.string().min(1).max(80), en: z.string().min(1).max(80) }).strict(), by: z.enum(["team", "venue", "executor"]), enforcement: z.enum(CONSTITUTION_ENFORCEMENT) })
          .strict(),
      )
      .max(32),
    problems: z.array(z.enum(TEAM_LAUNCH_PROBLEMS)).max(TEAM_LAUNCH_PROBLEMS.length),
  })
  .strict();
export type TeamLaunchReviewBody = z.infer<typeof TeamLaunchReviewSchema>;

/**
 * The answer to a committed step: the one `actionId` the EXE-2 journal recorded for it, whether that row already held
 * these fields (`replay` — nothing was written a second time), the decision for every right the step needed, and on
 * step 08 the review. Nothing is built, signed or sent: `LAUNCH_TEAM_CLOSED` while the owner has not said the word.
 */
export const TeamLaunchStepResponseSchema = z
  .object({
    step: z.enum(TEAM_LAUNCH_STEP_KEYS),
    actionId: z.string().max(64),
    replay: z.boolean(),
    decisions: z.array(TeamCheckResponseSchema.pick({ permission: true, allowed: true, grant: true, requires: true, refusal: true, multisig: true, squadsPermission: true })).max(4),
    review: TeamLaunchReviewSchema.nullable(),
  })
  .strict();
export type TeamLaunchStepResponse = z.infer<typeof TeamLaunchStepResponseSchema>;

/* ---------------------------------------------------------------- 1.86.0 (DEV-2): the developer console */

const DevProjectId = z.string().regex(DEV_PROJECT_ID);
const DevEndpointId = z.string().regex(DEV_ENDPOINT_ID);
const DevKeyId = z.string().regex(DEV_KEY_ID);
const DevName = z.string().min(1).max(DEV_LIMITS.nameMax);
const DevOrigin = z.string().min(1).max(200);

const DevQuotaWindowSchema = z
  .object({
    window: z.enum(DEV_QUOTA_WINDOWS),
    used: z.number().int().nonnegative(),
    /** Null where this deployment states no number for the window: the calls are counted all the same, and nothing is refused on a guess. */
    limit: z.number().int().positive().nullable(),
    /** Null with no limit — what is left of a number nobody set is neither zero nor infinity. */
    left: z.number().int().nonnegative().nullable(),
    resetsAt: Iso,
  })
  .strict();

/**
 * `GET /api/v1/developer/plan` (1.86.0, DEV-2) — what the console is made of, before anything is made in it: the two
 * environments, the scopes a credential may hold, the events an endpoint may subscribe to, the operational bounds,
 * the quota windows with whichever numbers this deployment states, and the *shape* a tariff has. Public.
 */
export const DevPlanResponseSchema = z
  .object({
    open: z.boolean(),
    network: TeamNetworkId.nullable(),
    environments: z.array(z.enum(DEV_ENVIRONMENTS)).length(DEV_ENVIRONMENTS.length),
    kinds: z
      .array(
        z
          .object({
            kind: z.enum(DEV_CREDENTIAL_KINDS),
            /** A secret key is sent whole as `id.secret`; a public key is the id alone. */
            sentAs: z.enum(["id.secret", "id"]),
            /** True only for the secret key: its token is shown once, at the moment it is made, and no read ever carries it again. */
            shownOnce: z.boolean(),
            /** A secret key is refused outright on a request that carries an Origin; a public key answers only the origins it names. */
            browser: z.enum(["REFUSED", "ORIGIN_BOUND"]),
          })
          .strict(),
      )
      .length(DEV_CREDENTIAL_KINDS.length),
    scopes: z.array(z.enum(DEV_SCOPES)).length(DEV_SCOPES.length),
    events: z.array(z.enum(DEV_WEBHOOK_EVENTS)).length(DEV_WEBHOOK_EVENTS.length),
    limits: z
      .object({
        projectsPerTeam: z.number().int().positive(),
        keysPerEnvironment: z.number().int().positive(),
        endpointsPerProject: z.number().int().positive(),
        originsPerKey: z.number().int().positive(),
        rotationGraceHoursMax: z.number().int().nonnegative(),
        webhookWindowSeconds: z.number().int().positive(),
        deliveriesKept: z.number().int().positive(),
        deliveryAttempts: z.number().int().positive(),
      })
      .strict(),
    /** The quota this deployment enforces: a window with a null limit is counted and never refused. */
    quota: z.array(z.object({ window: z.enum(DEV_QUOTA_WINDOWS), limit: z.number().int().positive().nullable() }).strict()).length(DEV_QUOTA_WINDOWS.length),
    /** The signing scheme a receiver implements, stated rather than described in prose only. */
    webhooks: z
      .object({
        idHeader: z.string().max(48),
        timestampHeader: z.string().max(48),
        signatureHeader: z.string().max(48),
        version: z.string().max(8),
        algorithm: z.literal("HMAC-SHA256"),
        /** What is signed, written out: the delivery's id, its second and the exact body. */
        signedPayload: z.literal("{id}.{timestamp}.{body}"),
        windowSeconds: z.number().int().positive(),
        /** The three grounds a receiver refuses on; a signature alone is not replay protection. */
        refusals: z.array(z.string().max(32)).max(8),
      })
      .strict(),
    /**
     * The fields a tariff would have, and nothing filling them. `plans` is the ids of the tariffs this deployment
     * states, and it is empty — that is the whole of it: a price, an included call count and a ceiling are set
     * outside this build, so no figure of that kind is served from here. `stated: false` says so in one field.
     */
    pricing: z.object({ fields: z.array(z.enum(DEV_PLAN_FIELDS)).length(DEV_PLAN_FIELDS.length), plans: z.array(z.string().max(32)).max(0), stated: z.literal(false) }).strict(),
    /** The key header a route reads; never `Authorization`, which is the wallet's. */
    keyHeader: z.string().max(32),
  })
  .strict();
export type DevPlanResponse = z.infer<typeof DevPlanResponseSchema>;

const DevKeySchema = z
  .object({
    id: DevKeyId,
    environment: z.enum(DEV_ENVIRONMENTS),
    kind: z.enum(DEV_CREDENTIAL_KINDS),
    name: DevName,
    scopes: z.array(z.enum(DEV_SCOPES)).min(1).max(DEV_SCOPES.length),
    origins: z.array(DevOrigin).max(DEV_LIMITS.originsPerKey),
    state: z.enum(DEV_KEY_STATES),
    createdAt: Iso,
    createdBy: Address,
    lastUsedAt: Iso.nullable(),
    /** When a rotating key stops answering; null for one that is not rotating. */
    expiresAt: Iso.nullable(),
    revokedAt: Iso.nullable(),
    rotatedTo: DevKeyId.nullable(),
  })
  .strict();

const DevEndpointSchema = z
  .object({
    id: DevEndpointId,
    environment: z.enum(DEV_ENVIRONMENTS),
    url: z.string().max(DEV_LIMITS.urlMax),
    events: z.array(z.enum(DEV_WEBHOOK_EVENTS)).min(1),
    enabled: z.boolean(),
    createdAt: Iso,
    createdBy: Address,
    /** A rotation is in flight until this moment: the old secret signs beside the new one. Null otherwise. */
    previousUntil: Iso.nullable(),
  })
  .strict();

const DevDeliverySchema = z
  .object({
    id: z.string().regex(DEV_DELIVERY_ID),
    endpointId: DevEndpointId,
    event: z.enum(DEV_WEBHOOK_EVENTS),
    at: Iso,
    state: z.enum(["DELIVERED", "FAILED"]),
    attempts: z.number().int().positive(),
    status: z.number().int().nullable(),
    error: z.string().max(200).nullable(),
  })
  .strict();

const DevProjectSchema = z
  .object({
    id: DevProjectId,
    teamId: z.string().regex(/^[0-9a-f]{24}$/),
    network: TeamNetworkId,
    name: DevName,
    createdAt: Iso,
    createdBy: Address,
    version: z.number().int().nonnegative(),
    keys: z.array(DevKeySchema).max(64),
    endpoints: z.array(DevEndpointSchema).max(DEV_LIMITS.endpointsPerProject),
    usage: z.array(z.object({ environment: z.enum(DEV_ENVIRONMENTS), windows: z.array(DevQuotaWindowSchema).length(DEV_QUOTA_WINDOWS.length) }).strict()).length(DEV_ENVIRONMENTS.length),
    /** What the reading wallet may do here — each one the team's own answer (TEAM-1), asked of the server, not guessed from the role. */
    you: z.object({ role: z.enum(TEAM_ROLES).nullable(), may: z.record(z.enum(DEV_ACTIONS), z.boolean()) }).strict(),
  })
  .strict();

/** `GET /api/v1/developer/projects/{id}` and every console write (1.86.0) — the project as the proven wallet may read it. */
export const DevProjectResponseSchema = z.object({ project: DevProjectSchema }).strict();
export type DevProjectResponse = z.infer<typeof DevProjectResponseSchema>;

/** `GET /api/v1/developer/projects?team=` (1.86.0) — the team's projects on this network. */
export const DevProjectsResponseSchema = z
  .object({
    network: TeamNetworkId,
    projects: z.array(z.object({ id: DevProjectId, name: DevName, createdAt: Iso, keys: z.number().int().nonnegative(), endpoints: z.number().int().nonnegative() }).strict()).max(DEV_LIMITS.projectsPerTeam),
  })
  .strict();
export type DevProjectsResponse = z.infer<typeof DevProjectsResponseSchema>;

/** `POST /api/v1/developer/projects` (1.86.0) — a project for a team the proven wallet may draft in. */
export const DevProjectCreateRequestSchema = z.object({ team: z.string().regex(/^[0-9a-f]{24}$/), name: DevName }).strict();
export type DevProjectCreateRequest = z.infer<typeof DevProjectCreateRequestSchema>;

/** `POST /api/v1/developer/projects/{id}/keys` (1.86.0) — a credential. A SECRET key names no origin; a PUBLIC key names at least one. */
export const DevKeyIssueRequestSchema = z
  .object({
    environment: z.enum(DEV_ENVIRONMENTS),
    kind: z.enum(DEV_CREDENTIAL_KINDS),
    name: DevName,
    scopes: z.array(z.enum(DEV_SCOPES)).min(1).max(DEV_SCOPES.length),
    origins: z.array(DevOrigin).max(DEV_LIMITS.originsPerKey).optional(),
  })
  .strict();
export type DevKeyIssueRequest = z.infer<typeof DevKeyIssueRequestSchema>;

/**
 * The answer to issuing or rotating a credential (1.86.0): the project as it now stands, and the token — **once**. A
 * secret key's `secret` is here and nowhere else, ever; a public key's is null, because a public key has none. There
 * is no route that returns it a second time, and no field on a key that could carry it.
 */
export const DevKeyIssuedResponseSchema = z
  .object({ project: DevProjectSchema, issued: z.object({ key: DevKeySchema, secret: z.string().min(1).max(200).nullable(), shownOnce: z.literal(true) }).strict() })
  .strict();
export type DevKeyIssuedResponse = z.infer<typeof DevKeyIssuedResponseSchema>;

/** `POST /api/v1/developer/projects/{id}/keys/{keyId}` (1.86.0) — rotate (a successor, the old one on a clock), revoke, or change the bounds. */
export const DevKeyActionRequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("rotate"), graceHours: z.number().int().min(0).max(DEV_LIMITS.rotationGraceHoursMax) }).strict(),
  z.object({ action: z.literal("revoke") }).strict(),
  z.object({ action: z.literal("change"), scopes: z.array(z.enum(DEV_SCOPES)).min(1).max(DEV_SCOPES.length).optional(), origins: z.array(DevOrigin).max(DEV_LIMITS.originsPerKey).optional() }).strict(),
]);
export type DevKeyActionRequest = z.infer<typeof DevKeyActionRequestSchema>;

/** `POST /api/v1/developer/projects/{id}/endpoints` (1.86.0) — where deliveries go. Made off, and its signing secret shown once. */
export const DevEndpointCreateRequestSchema = z.object({ environment: z.enum(DEV_ENVIRONMENTS), url: z.string().min(1).max(DEV_LIMITS.urlMax), events: z.array(z.enum(DEV_WEBHOOK_EVENTS)).min(1) }).strict();
export type DevEndpointCreateRequest = z.infer<typeof DevEndpointCreateRequestSchema>;

export const DevEndpointCreatedResponseSchema = z.object({ project: DevProjectSchema, endpoint: DevEndpointSchema, secret: z.string().min(1).max(200), shownOnce: z.literal(true) }).strict();
export type DevEndpointCreatedResponse = z.infer<typeof DevEndpointCreatedResponseSchema>;

/**
 * `POST /api/v1/developer/projects/{id}/endpoints/{endpointId}` (1.86.0) — turning it on or off, the events it takes,
 * a new signing secret (the old one signs beside it for one window), removing it, a test delivery, and `verify` —
 * Ryntra's own check of a delivery a receiver got, which is where the replay guard lives.
 */
export const DevEndpointActionRequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("enable") }).strict(),
  z.object({ action: z.literal("disable") }).strict(),
  z.object({ action: z.literal("events"), events: z.array(z.enum(DEV_WEBHOOK_EVENTS)).min(1) }).strict(),
  z.object({ action: z.literal("rotateSecret") }).strict(),
  z.object({ action: z.literal("remove") }).strict(),
  z.object({ action: z.literal("test") }).strict(),
  z.object({ action: z.literal("verify"), body: z.string().max(8_192), headers: z.record(z.string().max(64), z.string().max(512)) }).strict(),
]);
export type DevEndpointActionRequest = z.infer<typeof DevEndpointActionRequestSchema>;

export const DevEndpointActionResponseSchema = z
  .object({
    /** Null when the endpoint was removed and there is nothing left to show. */
    project: DevProjectSchema,
    /** A new signing secret, shown once, only after `rotateSecret`; null otherwise. */
    secret: z.string().min(1).max(200).nullable(),
    /** What a `test` actually sent and what came back; null for every other action. */
    delivery: DevDeliverySchema.nullable(),
    /**
     * What `verify` decided. `verified: false` with `refusal: "REPLAYED"` is the point of the whole scheme: the
     * signature was right and the bytes were Ryntra's, and it is refused anyway because this delivery's id has
     * already been verified for this endpoint.
     */
    verification: z.object({ verified: z.boolean(), refusal: z.enum(["MALFORMED", "TIMESTAMP_OUTSIDE_WINDOW", "SIGNATURE_INVALID", "REPLAYED"]).nullable(), deliveryId: z.string().regex(DEV_DELIVERY_ID).nullable() }).strict().nullable(),
  })
  .strict();
export type DevEndpointActionResponse = z.infer<typeof DevEndpointActionResponseSchema>;

/** `GET /api/v1/developer/projects/{id}/deliveries` (1.86.0) — what was sent and what came back, newest first. The right it needs is `receipts`. */
export const DevDeliveriesResponseSchema = z.object({ deliveries: z.array(DevDeliverySchema).max(DEV_LIMITS.deliveriesKept) }).strict();
export type DevDeliveriesResponse = z.infer<typeof DevDeliveriesResponseSchema>;

/**
 * `GET /api/v1/developer/key` (1.86.0) — the credential as the server reads it, for the credential itself: sent in
 * `X-Ryntra-Key`, never `Authorization`. The answer never carries a secret, because the server holds only a hash of
 * one.
 */
export const DevKeyResponseSchema = z
  .object({
    key: z.object({ id: DevKeyId, environment: z.enum(DEV_ENVIRONMENTS), kind: z.enum(DEV_CREDENTIAL_KINDS), name: DevName, scopes: z.array(z.enum(DEV_SCOPES)).min(1), origins: z.array(DevOrigin).max(DEV_LIMITS.originsPerKey), state: z.enum(DEV_KEY_STATES) }).strict(),
    project: z.object({ id: DevProjectId, name: DevName }).strict(),
    quota: z.array(DevQuotaWindowSchema).length(DEV_QUOTA_WINDOWS.length),
  })
  .strict();
export type DevKeyResponse = z.infer<typeof DevKeyResponseSchema>;

/** `GET /api/v1/developer/usage` (1.86.0) — what the key's own project has spent of its environment's windows, and what is left. Scope `read:usage`. */
export const DevUsageResponseSchema = z.object({ project: z.object({ id: DevProjectId, name: DevName }).strict(), environment: z.enum(DEV_ENVIRONMENTS), windows: z.array(DevQuotaWindowSchema).length(DEV_QUOTA_WINDOWS.length) }).strict();
export type DevUsageResponse = z.infer<typeof DevUsageResponseSchema>;

/** `GET /api/v1/developer/events` (1.86.0) — the key's own project's delivery log. Scope `read:events`. */
export const DevEventsResponseSchema = z.object({ deliveries: z.array(DevDeliverySchema).max(DEV_LIMITS.deliveriesKept) }).strict();
export type DevEventsResponse = z.infer<typeof DevEventsResponseSchema>;
