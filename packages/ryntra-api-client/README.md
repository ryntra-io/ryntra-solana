# @ryntra/api-client

Typed client for the Ryntra API v1 native contract (`openapi/ryntra-api-v1.yaml`,
schemas in `lib/api/v1/contract.ts`). Contract version **1.23.0**, major **1**;
the package's own version is the contract's, and `API_CONTRACT_VERSION` is the
same string (a test holds the three equal).

Since 1.1.0 the package carries the **types** of the Trading Plan
(`TradingPlan`, `PlanRules`, `PlanSizing`, the requests and responses), the
Review's Strategy block (`PlanReview`), the execution binding an order names
(`ExecutionPlanBinding`) and the notification device registry
(`DeviceRegistration*`). Since 1.2.0 the plan routes are live and the client
calls them — `api.plans.list()`, `create(request)`, `get(id)`, `update(id,
request)`, `setStatus(id, request)`, `version(id, n)` — every one behind the
bearer; a `PLAN_INVALID` refusal carries `error.issues` for the form. The
Review block and the binding are consumed by the web's order route; the device
route came in a later release — a shape without a route is built against
(fixtures labelled *Sample*), never called. The private read routes the phone
consumes (`/api/rewards`, `/api/solana/activity`,
`/api/solana/receipts/archive`) accept the bearer since 1.1.0 and keep their
own answer shapes; the swap routes that act or rescue
(`/api/solana/swap/order`, `/execute`, `/cancel-review`, `/recover`) accept it
since 2026-09-16 for the session's own wallet (`WALLET_MISMATCH` for any
other), in place of the site's origin check a browser needs. Since 1.5.0
`api.research.evidence(mint, window)` reads the observation a plan's evidence
conditions are judged on — public, no bearer — and `capabilities.research`
names the provider, its attribution, the windows and the metric registry a
condition may name (`metric`, `window`, `operator`, `threshold`, `mode`); the
Review carries one `evidence` check per condition and an `evidence` block of
what it judged. Since 1.8.0 `api.agent.*` is Ryntra, the AI assistant:
`openSession({ context, locale })` opens or resumes the wallet's conversation
for a context (an asset, a plan, the portfolio, a note, a page) and answers
the session with its budget state and suggested questions; `message({
sessionId, text, locale })` sends the words and answers the two turns — the
assistant's with the structured `answer` (observation → meaning → counter →
risks → checks → actions), the `citations` every figure stands on, the typed
`cards` and the `handoffs` to the builder, the Review, a plan or Monitoring;
`draft(id)` reads a plan, monitoring or trade draft a turn prepared;
`budget()` the wallet's meter; `suggestions(context, locale)` is public. There
is no execute call and no execute tool: a request to trade comes back refused
and prepared as a `tradeDraft` for the Review.

Since 1.9.0 `api.plans.allResults()` answers more than the trades: each
`PlanResult` says which `leg` the operation was (`entry` or `exit`, off the
signed bundle's own side) and how it came to be there (`matchedBy`), keeps the
difference in parts that are never added together (`costs.marketMove`,
`costs.execution`, `costs.fee`, each with a `basis` of `known`, `estimated` or
`unknown`) and judges an exit only against the rules that existed before it
(`exit.ruledByVersion`, `exit.notBackdated`). Beside them the answer carries
`outcomes` — the plans that made no trade, with the rule that refused them and
whether it refused **every** Review (`everyReview`) — `positions`, which state
a realised figure only with `realisedMethod` beside it and `unknowns` empty,
and a counted `summary`. `api.plans.memory()` answers `PlanMemoryFact`s: a
kind, a scope, the figures, and `cites` — the plan, version, Review, operation
or note each fact stands on. Nothing there is prose: the client composes the
sentence.

Since 1.10.0 `api.agent.brief()` and `api.agent.critic()` answer the two
formats over the one agent engine.

Since the AI-13 commit on 1.64.0 (the mobile line's request 68; the contract did
not change, so the package keeps its number — pin it by commit) `api.assistant.*` calls
the assistant's own surfaces on the web's routes, behind the bearer:
`brief(locale, day)` and `setBrief(request, locale)` — «Ранковий огляд»; `credits.get()`,
`credits.welcome()`, `credits.openOrder({ package })`, `credits.order(id)`
and `credits.orders()` — the balance, the prices and a package for USDC (an
order is a `lib/pay` request under the same id, paid with
`api.pay.transaction(order.id, { payer })`, the wallet's signature over MWA
and `api.pay.submit`); `watches.*` — «Стежу»; `profile()` and `setProfile()`
— «Знайомство»; `memory.*` — what Ryntra knows about the person; `tasks.*` —
«Доручення»; `plans.*` — a plan with its critic, approved or watched (a trade
only in the person's own plan and Review); `voice()` — the server's
speech-to-text for a recording, words for the field. A price is spent only
by a call that carries the `acceptCredits` the person was shown; the client
adds none. Web Push (`/api/v1/assistant/push`) is a browser's and has no
method here: the phone's push is its device registration.

Since 1.11.0 the routes the phone already consumes outside `/api/v1` are typed
as they are served and called by name — `api.markets.*`, `api.stocks.*` (the
slim row names a pending multiplier and when the session next changes),
`api.holdings()`, `api.activity()`, `api.receipts.*`, `api.rewards.*`
(read-only; no claim), `api.monitoring.*`, `api.swap.*` (`recover` answers
`ALREADY_RECEIPTED` with the sealed `observation` and `facts`) and
`api.predictions.*` (paper) — and `api.notifications.*` connects the Telegram
channel over the bearer. A refusal from a route outside `/api/v1` is a
`RyntraRouteError`: the route's own `code`, and `details` — the whole refusal
as it came.

Since 1.20.0 «Перевірка» is counted by the server: `api.swap.quote()` and
`api.swap.order()` answer `check` (`SwapCheck`) — for a company bought with
USDC or sold into it, Спишеться (`spend`) · Отримаєш (`get`, `atLeast` the
chain's minimum) · Усі витрати (`costs`, the issuer's fee inside it said
alone) · Що це (`what`, both languages) and the account's one-time reserve
(`reserve`, on the order only, `first` when a purchase's reserve is more than
the purchase); null on any other pair. Draw these figures and count none of
them — the web does the same, so one sum shows one set of lines.
`api.stocks.popular({ limit, exclude })` is «Популярні компанії» as the server
lists them (`/api/v1/stocks/popular`, a v1 path): the listed companies by the
day's trading, the same for everyone, the company of `exclude` left out beside
its own page.

Since 1.21.0 Нагляд over positions: `api.positions.list()` answers every
company the proven wallet holds with its exit, the state the server judged —
`on-plan` «Все за планом», `attention` «Увага», `action` «Дія»,
`issuer-paused` «Пауза емітента», `exit-not-set` «Увага: куплено — вихід не
налаштований», `unknown` — and its one action (`look`, `open-sale`, `details`,
`warn`, `connect-telegram`); draw them and decide none. `api.positions.watch({
mint, preset, locale })` turns «Ryntra попередить» on with a published preset
(`careful`, `balanced`): the server counts the loss limit and the target from
the price now, and refuses without a connected Telegram (`CHANNEL_REQUIRED`)
or a fresh price (`PRICE_UNAVAILABLE`).

Since 1.22.0 «Гроші», so the phone counts nothing itself. **Payment links:**
`api.pay.create({ mint, amount, description, expiration })` makes one for the
session's wallet (the recipient is always that wallet), `api.pay.list()` lists
its own, `api.pay.get(id)` reads one as its page does — each a `PayLink` with
the page's `url`, the Solana Pay `payUrl` a wallet scans, the `status` and
what arrived. **The recipient check:** `api.money.recipient({ to, mint, from
})` reads what was typed, pasted or scanned and answers `next` — `transfer`,
`pay-link` or `none` with its `problem`; ask
`api.research.addressEvidence(address)` beside it for the security source's
line. **Send** runs on the web's own transfer routes: `api.transfer.plan({
input })` answers the Review with `check` («Перевірка» counted by the server —
the lines, `signable`, `blocked`, `warnings` in both languages); the wallet
signs `plan.unsignedWireBase64`; `api.money.returned({ plan, signedWireBase64
})` says `settle` or `adopt` (then settle the adopted Review) or `stop`, with
the signature to keep; `api.transfer.settle(request)` submits once (202 while
open — never send again); `api.transfer.recover({ network, signature })` reads
it with the bearer. **A Ryntra link** is paid through `api.pay.transaction(id,
{ payer })` and `api.pay.submit(id, { intentId, signedWireBase64 })`, the
bearer paying as its own wallet.

Since 1.23.0 «Ризик портфеля»: `api.positions.risk()` answers one word for the
wallet as a whole — `normal` «Нормальний», `attention` «Увага: <причина>» with
`findings` (every rule broken, the most urgent first: `action`,
`weekend-no-limit`, `concentration`, `private-share`, each with what it names
and its share and cap) or `unknown` «Не вдалося перевірити» with `gaps` (what
could not be read). Draw the first finding and decide none; the caps are
`capabilities.positions`.

- No runtime dependency: `fetch` in, typed answers out.
- No cookie is read or sent. The bearer comes from the `token` provider the app
  wires to its secure storage.
- Every refusal on a v1 path is a `RyntraApiError` with the server's stable
  `code`; `error.needsSignIn` says when to ask the wallet for a signature
  again. A consumed route (1.11.0) refuses with a `RyntraRouteError`.

```ts
import { createRyntraApiClient, RyntraApiError } from "@ryntra/api-client";

const api = createRyntraApiClient({ baseUrl: "https://ryntra.io", token: () => secureStorage.get("session") });
const caps = await api.capabilities();
const challenge = await api.auth.challenge({ address, client: { platform: "android", appVersion: "1.0.0", package: "io.ryntra.app" } });
// hand challenge.input to solana:signIn (or sign challenge.message with signMessage)
const { accessToken, session } = await api.auth.verify({ address, signedMessage, signature, client });
```

## How the mobile app pins it

The mobile app lives in the same repository, but its checkout is sparse to
`apps/mobile/`, so the package is taken by content at a named commit rather
than by path:

```
git fetch origin
git show <sha>:packages/ryntra-api-client/src/types.ts  > apps/mobile/src/lib/api/v1/types.ts
git show <sha>:packages/ryntra-api-client/src/client.ts > apps/mobile/src/lib/api/v1/client.ts
```

with `<sha>` and the contract version recorded beside the copies. The
`.ts` import suffixes are the repository's convention; adjust to the app's
resolver if it differs. Never edit the copies; take a new commit instead.
