# The agent from one sentence (CITY-176)

«Say it. Your agent does the rest.» — the step of the agent that needs no new mechanism: from one sentence the agent
sets a regular purchase, a limit or a stop, and the person signs once in their own wallet. Ryntra holds nothing and
signs nothing for them.

Behind `NEXT_PUBLIC_RYNTRA_CITY_ONE_SENTENCE=open` (shut by default; it moves money through the existing engines, so it
opens only with a release decision). Shut, the command line and «Ask Ryntra» read every sentence as before.

## What a person says

In the command line (⌘K / Ctrl+K, or the spark on a phone) or to Ryntra in its panel — English or Ukrainian:

| Said | The agent sets |
| --- | --- |
| `buy $20 of SOL every week`, `купуй SOL на $20 щотижня`, `щопонеділка купуй SOL на 10` | a regular purchase |
| `buy JUP if it drops to 0.7`, `купи JUP на $50, якщо впаде до 0,7`, `buy BONK if it dips 10%` | a limit buy |
| `sell WIF if it rises to 3.5`, `take profit on WIF at 4`, `sell half my JUP when it rises 20%` | a limit sale |
| `продай половину BONK, якщо впаде на 10 %`, `стоп на JUP по 0,8`, `stop loss on all my WIF at 2.5` | a stop (sale) |
| `купи SOL на $30, якщо виросте до 200` | a stop (buy) |
| `sell JUP when it hits 1.2` | a limit or a stop — the price now decides |

The agent's row stands first in the command line; the window the line would open for the same words (a plain buy, the
Spot ticket on a stop) stays under it. A question, a refusal, «unless», a regular sale, two coins at once, a ticker the
city has no tower for — none is an instruction: the line reads them as before.

## The card

One headline — what the agent will do, with the amount and how often or at what price — the price now, the fee and the
least in one line, and «Sign». A word not said (how much, how often, at what price, which coin) is one question with
taps: `$10 $20 $50 $100`, `25% · Half · All`, `−5% −10% −20%`, `Every day · week · month`, the coins on screen. Two
prices said («до 0,7 або 0,6») are offered as exactly those two. «Details» opens the words said, the price now, where
the money is, and how it runs.

## The engines (nothing new)

| Instruction | Engine | The person signs | Fee |
| --- | --- | --- | --- |
| regular purchase | the rules engine, `POST /api/v1/rules` (`lib/autoinvest/**`, «Регулярна купівля для всього») — a reminder on the schedule | once to set it: the wallet's proof (a message, no money); each purchase in their wallet | the swap path's fee on each purchase |
| limit | the spot limits engine, `/api/solana/limits/*` (CITY-62): a Jupiter Trigger V1 order, the coins in a program account of that order alone | once: the order, after the engine's Review is on the card | the limits engine's fee policy (Review) |
| stop | the stops engine, `/api/v1/stops` (CITY-149): watched with the swap quote; the person is told when it is reached | once to set it: the wallet's proof; the sale in their wallet | the swap path's fee on the sale |

**Why not Jupiter's own recurring orders.** Recurring V1 is no longer maintained, and DCA now lives in Trigger V2, which
keeps the coins in Jupiter's custodial vault (one per wallet) and pays no integrator fee (Jupiter's docs, read 29.10;
`docs/research/ryntra-bots-2026-10-29/sources/r-onchain.md`). Neither keeps the money in the person's hands, and the
second would take no Ryntra fee — so the regular purchase runs on Ryntra's rules engine, the same way the stops do: a
reminder, and the person's own signature on each purchase. A purchase that runs by itself within a budget is the
agent's wallet (CITY-174, CITY-175).

The stops and limits need their own switches too: a stop sets nothing while `NEXT_PUBLIC_RYNTRA_CITY_STOPS` is shut
(the card says stops are coming); limits ride on `NEXT_PUBLIC_RYNTRA_CITY_SPOT`'s engine. Jupiter Trigger and the
rules are mainnet-only: the tests and the shots run on fixtures and place no order.

## «My instructions»

What the agent set from sentences, kept on this device under the wallet (`ryntra.city.instructions.v1:<owner>`: the
engine's id and the words said — public facts only), each one's state read from its engine every 30 seconds: the next
purchase, «Time to buy» (a reminder open — «Buy» opens the trade window filled), «Waiting for the price» (a limit),
«Watching the price» / «Price reached» (a stop — «Sell» opens its sale), done, ended. «Cancel» is one tap: a limit's
cancellation is signed in the wallet; a stop or a rule is let go on the wallet's proof. Opens from the card after
signing, from the command line («my instructions», «мої доручення») and its ready picks.

## Files

| File | What |
| --- | --- |
| `read.ts` | Pure: the sentence → an `Instruction` (or null); `coinChoices` for the coin taps. Uses the command line's own tokens, coins and units (`../command/parse.ts` `LINE_WORDS`). |
| `types.ts` | The `Instruction`, and `missingOf` — what the card asks next. |
| `plan.ts` | Pure: instruction + the engines' facts → the exact request (`POST /api/v1/rules` body, the limit's `LimitIntent` fields, `POST /api/v1/stops` body) or what it needs or why it cannot stand; `answer` — a tap's answer. |
| `face.ts` | Pure: the headline, the figure under it, the fee line, «My instructions» rows — English and Ukrainian. |
| `store.ts` | The card and the list: facts from the engines, the Review, «Sign», the kept list, the states, «Cancel». Dev hook: `window.__instruct`. |
| `rules-api.ts` | The city's line to `/api/v1/rules`. |
| `flag.ts`, `words.ts` | The switch; the words. |
| `read.test.mjs`, `instruct.test.mjs` | 40+ sentences in both languages (the ambiguous ones too); plans; the store on fixtures — the wallet asked only by «Sign», the limit's bytes signed once, nothing set on a declined proof. |
| `shots.mjs` | Phrase → card → «My instructions», desk 1440 and phone 375, English and Ukrainian → `docs/shots/city-176/`. |

The faces are `city/components/instruct/` — `InstructLayer` (mounted once in `CityApp`, two windows in the frame:
`agent` and `instructions`), `AgentCard`, `Instructions`.
