# The bots hub in the city (CITY-134, B4)

One window over the city — Start · My bots · Strategies · History — in the city's frame (CITY-65, CITY-75). The way in is
the Deck's «Agents» tray (decision 86: Agents — Hangar · Bots): its «Bots» door opens and closes the window. Anything
else opens it the same way, without loading the hub:

```ts
import { openBots } from '@/city/lib/bots/open';

openBots('launch'); // or 'hangar', 'strategies', 'history'; without a tab — where it was
```

The old addresses of the bots, the strategies and the agents (`/app/bots`, `/app/strategies`, `/agents` … → `/?open=agents`,
CITY-13) open it too, behind the same switch as the door (`NEXT_PUBLIC_RYNTRA_CITY_AGENTS=open`).

**Practice, and live ladders.** The practice bots sign nothing; «Cancel orders» and «Withdraw all» stand in them
switched off with one honest line. The one live path is the ladder composer (CITY-135, below): a buy or an exit ladder,
or Smart DCA's ladder leg, placed as DLMM limit orders, signed once in the person's own wallet — on the network
`NEXT_PUBLIC_RYNTRA_CITY_LADDER` names (`devnet`, or `mainnet` behind its own server switch, CITY-219); practice only
otherwise. A ladder is kept in this browser the moment it is signed, before the relay is asked, and the chain's reading
says which legs landed (CITY-231). Taking back never depends on this browser: on a mainnet window every DLMM order or
ladder the Hangar reads from the chain carries «Cancel» — from the app, another device, a cleared browser.

**Reconciled with the Deck.** «Hangar» on the Deck is the agent's home in the quarter (CITY-50); the bots' own place in
the window says «My bots», so the tray never shows two different «Hangars». The scout — the city's own read-only agent —
is one of the bots in the catalogue: its card opens the scout's rule, as the Deck's door did before. One assistant in the
city: the window keeps no second ask box; the bots' assistant tools are the assistant line's (CITY-133).

**Ryntra in the window (CITY-133).** On «Start», under the weather, Ryntra names the week's bot for the coin in one line
and what it did against holding; the horizon and the amount are taps, never words. «Set it up for me» asks the tools for
a draft and opens it in the window's own review — «Start» there stays the person's tap, on paper. Behind «Details»: the
reasons, the alternative and the replay over 7, 30 and 180 days. On «My bots», over the wallet's bots on the chain,
Ryntra's report in a line or two, and «Why?» on each bot. The tools are `POST /api/v1/assistant/bots`
(`lib/assistant/bots/**`, the assistant line): every figure read there from the engine, drafts only.

## The engine underneath (read only)

| Engine | What the window takes |
| --- | --- |
| `lib/bots/weather/**` (CITY-132) | The week's weather — trend, range or chop — and each bot's fit, on the same hourly bars a draft is tried on. |
| `lib/bots/hangar/**` (CITY-131), `GET /api/bots/hangar?wallet=` | The connected wallet's own bots on the chain — status, against holding, last fill's receipt, loose ends — at the top of «My bots». |
| `/api/spot/candles` (the chart's read) | The hourly week. A coin without one says so: no price is ever made up. |

The live grid of B10 (`lib/bots/grid.ts`) is not touched.

## The ladder on devnet (CITY-135, B5)

The engine is `lib/bots/ladder/**` and `app/api/bots/ladder/**` (each route answers 404 while `RYNTRA_BOTS_LADDER` is not
`devnet`). The plan and the cost line are the engine's pure modules, shared by the window and the server:

| Engine | What |
| --- | --- |
| `plan.ts` | Steps (percents from the price) → DLMM bins on the person's side, the amount split exactly (`even` / `deeper`), cut into transactions by bin array. |
| `costs.ts` | The one line before the signature: network, rent back on cancel, rent the pool keeps, no minimum, SOL to keep; «not advised» over 3 %. |
| `exit.ts` | Stop · Sell all · Rebuild · Wait, chosen before the start: what each proposes when the price leaves the band or every step fills — never `auto`, always built at the tap. |
| `smart.ts` | Smart DCA: the ladder's share, the reminders leaning into dips and stopping over the ceiling. |
| `venue.ts` | DLMM limit orders first; Jupiter Trigger V1 as the fallback — mainnet-only, so refused on devnet. |
| `decode.ts`, `tx.ts` | «What this bot can do» read from the transaction's own bytes. |
| `build.server.ts`, `relay.server.ts`, `connection.server.ts` | Build and simulate on devnet; check every signature and forward. Nothing on the server signs; the chain's genesis hash must be devnet's. |

In the window: `ladder.ts` (the switch, the composer, the placed ladders kept in this browser as public facts),
`ladder-sign.ts` (loaded on the tap: the order accounts' keys are made in the browser for one tap and only their
addresses leave it; the wallet is asked once; nothing changed or unsigned is sent), `ladder-actions.ts` (place, take
back, finish), `components/bots/Ladder.tsx` (the start block and the «On devnet» rows of «My bots»). The pass on devnet
for a local session: `docs/city/bots/LADDER-DEVNET.md`. Shots: `ladder-shots.mjs` over `ladder-demo.ts` →
`docs/shots/city-135/`.

## Files

| File | What |
| --- | --- |
| `open.ts` | The light store: open, tab, the running count for the drones. The Deck and the frame's layer import only this. |
| `kinds.ts` | The bots of stage A and «Next», the four goals, where each bot's money sits (a position, orders on the chain, the wallet — never a custodial vault), whether it works without Ryntra. |
| `words.ts`, `format.ts` | Every word in English and Ukrainian, in the city's language (CITY-79, `city/lib/i18n/lang.ts`); numbers. |
| `path.ts` | The week a draft is tried on: the engine's hourly candles. |
| `weather.ts` | The engine's weather in the hub's words, each bot's fit, and the week's own size (day's move, low, high). |
| `draft.ts` | A bot's settings, defaults from the week, what is wrong with them, levels and the band. |
| `sim.ts` | A draft played on paper: fills, value by the hour, against holding, drawdown, the exit policy. |
| `stress.ts` | The dollar stress test and the start's cost line. |
| `decode.ts` | «What this bot can do» — from the draft now, from the transaction later (`sameCanDo`). |
| `recommend.ts` | The newcomer's second tap: one bot for a goal, chosen by the engine's fit, with its reasons. |
| `hangar.ts` | Practice bots: status (running, paused, stopped, not finished, orphaned), controls. |
| `chain.ts` | The wallet's own bots from the engine's Hangar: the read, checked and sorted. A read only. |
| `strategies.ts`, `lineage.ts` | Saved strategies on Strategy Lab's lineage (`lib/strategy-lab/lineage.ts`, loaded only on save): versions, forks, copy after 14 days of history, age buckets; closed and losing kept. |
| `receipts.ts` | A receipt for every fill, and the CSV. |
| `store.ts` | The window's store; the practice bots and the strategies kept in this browser (`ryntra.city.bots.*.v1`). |
| `demo.ts` | The review stand — hangar, shared strategies, the wallet's chain answer and the sample week of prices — fixtures for the tests and `shots.mjs` only. |
| `ryntra.ts` | Ryntra's tools asked with the window's taps: the pick, the replay, «Why?» and the report, and the draft opened in the review (`toCityDraft`). |
| `shots.mjs` | The screens for review: `NEXT_PUBLIC_RYNTRA_CITY_AGENTS=open npm run dev -- -p 3137`, then `node city/lib/bots/shots.mjs [out] [baseUrl]`. |

The window is `city/components/bots/` (`BotsLayer` is mounted once in `CityApp`, its contents load the first time it
opens); the drones over the person's quarter are `BotDrones` in the city's scene — one per running practice bot, up to
four, still with «reduce motion».
