# The agent on its word (CITY-175)

«Say it. Your agent does the rest.» A person says «торгуй на 1 SOL на день» or «запусти мені токен» — in the command
line (⌘K / Ctrl+K, the spark on a phone) or to Ryntra in its panel — and the agent proposes the rest: the budget and the
strategy, or the coin's name, ticker and picture with the launch's rules. The person signs once; from then on the agent
trades by itself within the budget the chain holds, the tower grows in the city, «Mine» shows what the agent earned and
its card goes to X in one tap.

Devnet only, behind `NEXT_PUBLIC_RYNTRA_CITY_AUTOPILOT=devnet` (shut by default). Trading rides on the mandate's own
switches (CITY-174): `NEXT_PUBLIC_RYNTRA_CITY_MANDATE=devnet` in the city, `RYNTRA_AGENT_MANDATE=devnet` with its
`…_POOL` and `…_AGENT` on the server, and — for the agent to act — `RYNTRA_AGENT_MANDATE_KEY`, the devnet key whose public
half is `…_AGENT`, or the same key in KMS (`RYNTRA_AGENT_MANDATE_SIGNER=kms`, `RYNTRA_AGENT_MANDATE_KMS_KEY`)
(`RYNTRA_AGENT_MANDATE_SYMBOL` names the pool's coin on the cards). Launches ride on the launch
district's switch. Mainnet is not a value any of them takes: it opens after the audit of Squads' policy layer and the
agent's key in KMS, only by a release decision, as a change of code.

## What a person says

| Said | The agent |
| --- | --- |
| `торгуй на 1 SOL на день`, `trade 1 SOL a day`, `let my agent trade 0.1 SOL daily`, `запусти бота на 0,5 SOL` | trades within that budget a day — the largest of the city's budgets not above what was said (a new agent starts at 0.5 SOL a day at most; the card says so) |
| `торгуй за мене`, `trade for me`, `запусти бота` | the same, the budget picked with one tap |
| `запусти мені токен`, `launch me a token`, `launch me a coin called Neon Fox`, `запусти токен Moon Cat $MOON` | prepares a launch: the person's name and ticker as said, the agent's for what was left out, and a coin picture it draws |

A question, a refusal, a plain trade of a coin («trade JUP»), a budget in dollars or over a week, a regular purchase
(CITY-176's) — none is the agent's ask; the line reads them as before.

## How it runs

1. **The card** (`store.ts`, `city/components/autopilot/`): the budget a day, the rhythm («5 buys a day · 0.1 SOL each ·
   every 4.8 h»), the limits in one line, «Sign once». Details behind one tap.
2. **One signature** — CITY-174's mandate (`../bots/mandate-sign.ts`): the person's smart account, the budget in its vault
   and the agent's policy, at once. The signed mandate joins **the agent's book** (`POST /api/bots/mandate/agent`), which
   checks it on chain first: the policy, its one signer the agent, the person's account, a budget the city offers.
3. **The agent at work** (`lib/mandate/tick.server.ts`, cron `/api/cron/agent-mandate` every 5 minutes): for each mandate
   in the book, the steady strategy (`lib/mandate/strategy.ts`) spreads the day's budget into equal buys — the first at
   once — each built for the vault, judged and signed by the agent's own signer (CITY-174), the coins straight to the
   person's wallet. A trade outside the limits is never signed; the chain refuses it again. One claim per slot: two
   instances never buy the same slot. Every trade ends with the rule that the money reached her (`lib/mandate/result.ts`).
   It leaves a mandate the person stopped, one that ended or spent its budget, and pauses itself (`AUTOSTOP`,
   `lib/mandate/strategy.ts`): 15 % down, three losing buys in a row, three failed trades in a row, or a figure it cannot read.
4. **What it earned** (`GET /api/bots/mandate/agent`): its own trades — what went in, what came to the person, what that
   is worth at the pool's price now. «Mine» shows it in one row; the card shows it big, with «Share» (the card of
   CITY-145, kind `agent`, marked DEVNET) and «Stop» — one more signature, the rest back to her wallet.
5. **A launch**: «Launch $SYM» fills CITY-143's sheet and opens it on its review; the person's wallet signs the launch
   there, and the tower rises in the docks.

## Selling what the agent bought (CITY-187)

In the tower's window, where the person's agent bought that tower's coin for her, «Your agent holds» offers 25 %, 50 % or
all and one «Sell». Before the press: what she gets at least and Ryntra's fee, one line each (the engine's figures,
`POST /api/bots/mandate/sell`); the rest behind «i». The press is one signature of hers — the coin into her own vault under
a sale's mandate of CITY-184 — and the agent sells at once (`POST /api/bots/mandate/sell/go`); the receipt is one line. A
sale that did not go comes back with one more signature (`/sell/back`). The engine is `lib/mandate/sale.ts` and
`sale.server.ts`; here `sell.ts` (the store), `sell-sign.ts` (the press, loaded on it), `sell.test.mjs`, `sell-shots.mjs`
(→ `docs/shots/city-187/`), and the block `city/components/autopilot/AgentSell.tsx`.

## Strategies (CITY-193)

The same sentence can say how the agent buys: «купуй BONK на просіданнях», «buy the dip −10 %», «торгуй сіткою», «grid
BONK step 4 %», «фіксуй +20 %», «stop loss 10 %», «купуй нові запуски». `read.ts` reads it into a plan of
`lib/mandate/plans.ts` (`steady`, `dip`, `grid`, `early`, with a `take`/`stop` exit); the card says it in one line
(`plan-line.ts`), its rules and its run on history behind «Details». «Practice first» runs the agent on paper with the same
rules (`runs.ts` → `GET /api/bots/mandate/test`), «Go live · sign once» takes the very plan to the mandate. The mandate's
limits never change: a strategy only holds back a buy the mandate allows. Shots — `strategy-shots.mjs` →
`docs/shots/city-193/`; tests — `strategies.test.mjs` here and `lib/mandate/strategies.test.mjs`.

## The agent's day (CITY-194)

The person comes back because the agent works while she is away, and says so once a day: «today 3 trades, +$4». Every
figure is the agent's own book, priced now (`lib/mandate/report.ts` `dayOf`): the trades that landed in the span, what
they spent, the coin they brought, what it is worth at the venue's price, and the result in SOL and dollars. A figure
that was not read is left out — never a zero, never a promise.

- **In the city** (`NEXT_PUBLIC_RYNTRA_CITY_AGENT_REPORT=open`): one quiet line over the tower of the coin the agent buys
  («Today · 3 trades · +0.012 SOL», `AgentTowerTag.tsx`); on her return after 20 minutes or more, one card «While you
  were away: 3 trades, +0.012 SOL» with one «Share» — the agent's card for X over that span (`AgentAway.tsx`); in the
  agent's card, «Today: …» and the daily report's one switch.
- **Telegram and the phone** (`RYNTRA_AGENT_REPORT=on` on the server): the cron `/api/cron/agent-report` (hourly, at
  :07) tells each person once a day at her hour on her clock (20:00 at first) what the agent did since the last report,
  through the engine's inbox and delivery — Telegram where her account has a chat, the app's push, the browser's push,
  quiet hours and retries as every note. The message carries «Turn off daily report»; one tap turns it off (`agr:off:`),
  and the button becomes «Turn it back on». A day without a trade is passed quietly.
- **Her settings** (`/api/bots/mandate/report`): `GET ?owner=` — on and the hour; `POST` — her clock and language, and the
  switch, only under her wallet's own proof. Kept in the Guard store's `agentReports`, `r:<owner>`.

Files: `report.ts` (the switches, the words, her hour, pure), `report-watch.ts` (the pass, the note), `report-watch.server.ts`
(production: the book through `agentResult`, Jupiter's catalogue for the ticker and SOL in dollars, the monitoring
delivery), `report-telegram.ts` and `.server.ts` (the button), `report-client.ts` (the page: when it last saw the agent,
the card, the switch), `report.test.mjs`, `report-shots.mjs` (→ `docs/shots/city-194/`).

## Files

| File | What |
| --- | --- |
| `read.ts` | Pure: the sentence → an `AgentAsk` (`trade` with the day's SOL, or `launch` with the name and ticker said), or null. The command line's own tokens. |
| `plan.ts` | Pure: the budget from the words (never more than said), the rhythm, a launch's proposal and its ticker. |
| `emblem.ts` | The coin's picture the agent draws for a launch, 512 px, through the one `shrinkPicture` every launch picture takes. |
| `store.ts` | The card's state, «Sign once» and «Stop» through the mandate's signing, the launch into the sheet, the book's view. Dev hooks: `window.__autopilot`, `__autopilotMandate`, `__autopilotWallet`, `__autopilotMine`. |
| `flag.ts`, `words.ts` | The switch; the words, EN and UA. |
| `autopilot.test.mjs` | The phrases in both languages (the ambiguous ones too), the budgets, the proposals, the line's gate and door, the agent's share card. |
| `shots.mjs` | Phrase → card → details → at work → «Mine» → launch card → launch review; desk 1440 and phone 375, EN and UA → `docs/shots/city-175/`. |

The engine is `lib/mandate/` (`strategy.ts`, `book.server.ts`, `tick.server.ts`, `agent-service.server.ts`; tests
`lib/mandate/autopilot.test.mjs`); the routes are `app/api/bots/mandate/agent/` and `app/api/cron/agent-mandate/`.
