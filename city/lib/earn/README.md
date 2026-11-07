# Earn in the city (CITY-92, with CITY-93 Piers, CITY-94, CITY-95 first pass, CITY-97 Sell Higher, CITY-98 Stock Pier, CITY-99 Like the Captain and CITY-192 Dollar Saver)

One window on the city's frame (CITY-65) with three tabs — **Shelf · Piers · Mine** (UA: Полиця · Причали · Моє) —
for the owner's Earn strategy (`docs/research/ryntra-earn-2026-10-29/SPEC.md`, decision 77). Results are said in SOL
and always against just holding. This first pass changes no engine and no money logic: the one product that moves money, the
SOL Saver, is the trade card's own swap.

## Opening it

```ts
import { openEarn } from '@/city/lib/earn/open';

openEarn();                 // where it was last
openEarn('mine');           // a tab: shelf · piers · mine
openEarn('shelf', 'saver'); // a product of the Shelf
```

The one door for every entry: the ☰ menu row, the Harbor in the dock (on Piers), and the Helm's «Earn» verb (CITY-89).
While a signature is out the window stays on it and its frame holds.

**Switch:** `NEXT_PUBLIC_RYNTRA_CITY_EARN=open` (exactly). Closed, nothing of Earn is drawn — no menu row, the Harbor
keeps its own behaviour — and the routes below answer 404.

## The Shelf

| Product | Now | Its live number |
| --- | --- | --- |
| SOL Saver (SOL-скарбничка) | acts: SOL → JupSOL / INF / JitoSOL | the best LST's last-epoch rate |
| SOL Pier | the Piers tab (below): acts where the Harbor's switch admits the wallet | the top SOL pier's fees, 24 h |
| Dollar Saver | acts where its own switch is open and the engine admits the wallet (CITY-192, below); else a calm window | USDC lending rate from SOL-3's read |
| Sell Higher | acts where its own switch admits the wallet (CITY-97, below); else a calm window | SOL's price from the city's tower |
| Stock Pier (Причал акцій) | builds where its own switch admits the wallet (below); else its verified pairs and «Tell me when it opens» | the busiest verified stock's 7 days of trading |
| Dollars for Stocks | calm window (CITY-101 — paused 4.11: «лишаємося в Юпітері», Kamino is not wired) | the most traded stock tower's price |
| Like the Captain | strategies with a proven record (CITY-99, below); calm window until one has it | the best proven record against holding |

A calm window is a real card: a frame of the live 3D city, the live context, and one switch «Tell me when it opens»
kept on the device. A number that was not read is hidden — never a made-up rate, never «Soon».

## The SOL Saver

`saver-store.ts` drives the trade card's flow (`city/lib/trade/flow.ts`): `/api/solana/swap/quote` → `/order` (the
engine's checks, its fee policy — 0.10 % on a major) → the person's signature → `/execute` → read back by signature.
The open-signature record is the one every trade surface shares (`browserAttempts`). Before the signature, one line:
the fee · the least that arrives · network + rent · the main risk; its «i» holds the rest — the network fee and the
account deposit apart, the cost on the way in and the spread back to SOL now (a reverse quote), the pool's share of
rewards, the route, and how the rate is read. A landed purchase with its amounts is kept on the device as a lot
(`ryntra.city.earn.saver.v1:<owner>`) so «Mine» can say what it earned; a signature read back by recovery never is.

## The Dollar Saver (CITY-192)

USDC or SOL lent at Jupiter Lend's floating rate (spec E5), on SOL-3's engine as it stands (`lib/earn`,
`app/api/solana/earn/**`). `dollar-store.ts`: `GET /api/solana/earn?owner=` (the markets, the wallet's position read
from the chain, whether actions are open) → one tap: `POST /review` (the server reads the market again, builds the
deposit or withdrawal at Jupiter Lend with the server's key, seals it) → the wallet signs those bytes (`citySigner`) →
`POST /submit` (the gate, the market and the seal again; the bytes sent once) → a signature with no answer is read
back on `/status`, never called «nothing happened». Before the tap, one line: «Ryntra 0%» · the minimum ($1 at the
market's price) · the risk; its «i» holds the rest. SOL is Jupiter's wrapped-SOL market: a deposit counts the
wallet's native SOL beyond 0.01 for the network (`lib/earn/actions.ts` `solSpendable`). The position and what it
earned stand on the card and in «Mine», in their own coin — never added to the SOL headline.

| | |
| --- | --- |
| Switch | `NEXT_PUBLIC_RYNTRA_CITY_EARN_DOLLAR=open` (exactly; default closed) — on top of the engine's `RYNTRA_EARN_ACTIONS` (`CLOSED` · `CANARY` with `RYNTRA_EARN_CANARY_WALLET`, $5 a move · `OPEN`) |
| Key | the server's `RYNTRA_JUPITER_LEND_API_KEY`, else `RYNTRA_JUPITER_API_KEY` — never in the browser |
| One sentence | `dollar-read.ts`: «поклади мої USDC працювати», «put my USDC to work», «поклади 50 USDC під відсоток», «lend 2 SOL», «забери мої USDC зі скарбнички» — in ⌘K and «Ask Ryntra» they open the card with the coin, the side and the amount; the person taps and signs there |
| Shots | `node city/lib/earn/dollar-shots.mjs <out> <base> [before\|after]` on a production build — no dev hooks (`docs/shots/city-192/`) |

## The LST feed — `GET /api/city/earn`

`feed.server.ts`, cached two minutes. JupSOL and JitoSOL: their SPL stake pool accounts on chain (`stake-pool.ts`) —
the token's worth in SOL now and at the epoch before; the yield is that move compounded over the epochs of a year at
the slot time the network kept lately (`getRecentPerformanceSamples`). The pool must name the LST's own mint and be
updated this epoch or the last. INF (a pool of LSTs, not a stake pool): Sanctum's public `apy/latest` and
`sol-value/current`. A figure that fails is null and hidden.

## The Piers (CITY-93)

The Harbor inside the window (spec E2). A **pier** is a Meteora DLMM pool of SOL against an LST of the SOL Saver
(JupSOL, INF, JitoSOL) or against USDC (`pier.ts`); `GET /api/city/earn/piers` lists them from the engine's catalogue
(each LST looked up by its mint too). Fees and depth are said in SOL at the venue's own SOL price.

- **Amount in SOL, three styles.** Half the worth goes in as SOL, half as the other coin at the pool's price. Calm ·
  Balanced · Dense are 34 · 16 · 5 bins each side of the price — the engine's own `range.half`. Risk dots follow the
  style.
- **A goal, not a shape (CITY-210).** Even · Near price · Catch moves are the engine's `spot` · `curve` · `bid_ask`, for
  the Zap and for the agent's care alike. Until the person picks, a staked SOL pair stands near the price and SOL
  against dollars even. A copy of «Like the Captain» stays even: a recipe is a pool and a style.
- **Past 30 days** (`pier-history.ts`): the engine's candle read (`/api/spot/candles`, 4 h) as the pool's price; the
  style's band around where the month began; the share of closes inside it; and the end against just holding, in SOL,
  before fees (Meteora states fees for the last day only — they are never invented). The past, never a forecast.
- **One line before the signature**: Fee 0 · Min (live: ≥ 0.05 SOL, and what never comes back — the pool's shared
  rent and the network, from the Review — at most a twentieth) · out of range → stops earning. Its «i» holds the range
  prices, bins, the account deposit and whether it comes back, the network, slippage, the trade fee, the day gone's
  share of fees for this amount, and how fees are counted.
- **SOL alone is enough (CITY-198)**: the add is the engine's Zap (`lib/liquidity/studio/zap.ts`, Meteora's Zap program
  through `@meteora-ag/zap-sdk` 2.0.0) — the part of the SOL the other coin needs is swapped (Jupiter `/swap/v2/build`
  with Ryntra's fee of the table, or the pool itself with none, whichever brings more) and the position opened, in one
  approval of the wallet for up to three version-0 transactions. The city's door is `POST /api/city/earn/piers/zap`; the
  Review holds every instruction to the wallet's own accounts and the swap's floor to the venue's price
  (`zap-check.ts`). A Zap that lands in part says so and offers «Take back as SOL» (`zap_rest`): one more approval, and
  what the Zap left in the wallet is SOL again.
- **Boats**: your positions (SOL-2b's read) as boats at the pier — lit while in range, dark out of it. A boat's card says
  what it earned and stands against holding in SOL, with Take fees · Leave (the engine's claim and full exit).
- **The flow** is the Harbor's own (`districts/harbor/flow.ts`): the Review built while the card is read, one wallet
  prompt, the engine's relay once, the chain asked about a lost answer — never sent twice. While the wallet signs or
  bytes travel, the window holds (`useEarn.setBusy`).

### The Harbor's switch, ceiling and stop (`pier-gate.ts`)

| | Where | What |
| --- | --- | --- |
| Switch | `NEXT_PUBLIC_RYNTRA_CITY_HARBOR` = `closed` (default) · `canary` · `open` | closed: the Piers read and show, offer nothing. canary: one wallet adds, up to $5; to everyone else it looks closed. open: everyone the engine admits. (`open` also keeps the Harbor's own district behaviour.) |
| Canary wallet | `RYNTRA_CITY_HARBOR_CANARY_WALLET` (server only) | Compared character for character; never in the repository or the page. |
| Ceiling | `PIER_CEILING_USD` — DLMM $1,000 for one add; canary $5 | Checked on the server before anything is built, on the most the add can put in at the venue's prices of those very mints; a pool without a price is refused. |
| Stop | `RYNTRA_CITY_HARBOR_STOP` set to anything (server only) | New money stops at once, no new build. Taking fees and leaving stay open — the stop never holds money in. |

`GET /api/city/earn/piers/admit?owner=` joins this with the engine's gate (`lib/liquidity/studio/gate.ts`, read only);
`POST /api/city/earn/piers/review` is the city's door in front of the engine's unchanged Review (`reviewLiquidityAction`):
an add only where the Harbor admits the wallet, only on a SOL pier, only under the ceiling, and the ticket dropped if
the Review's coins are not the ones priced. The relay and the chain's word are the engine's own routes.

## Like the Captain (CITY-99)

Spec E8: copy a strategy with a proven record. A **strategy** is one of the city's own pier recipes — a SOL pier and a
style (`captain.ts`, `recipeId`); the recipe is internal and never a screen. A **copy** is a position opened through the
city with that recipe; any add that lands from the Piers or from a copy is one.

- **The ledger** (`captain-store.ts`, `captain-db.ts`, `captain-ledger.ts`, `captain.server.ts`): after an add lands the
  window tells `POST /api/city/earn/captain/copies` (the session's own wallet, a SOL pier, twelve a day). Nothing is
  believed until the chain shows it — the wallet's own DLMM position, in that pool, exactly the style's width
  (`styleOfBins`); its amounts at that read are where its record starts. Not seen in a day, or seen as something else:
  dropped.
- **The daily pass** (`GET /api/cron/city-earn-captain`, 03:41 UTC, the cron's bearer): every open copy read once from
  the chain (`readWalletPositions`, `readPoolRecord`, SOL-2b's `positionView`) — fees unclaimed plus fees seen leaving
  (a fall in unclaimed between passes is a claim), the price's move, against keeping the entry's coins. A position gone,
  narrowed, widened, withdrawn from (both coins short) or added to (worth more than keeping could be) is closed: its last
  result stays and it stops counting live. Then one point a day per strategy: its live copies summed.
- **The gate** (`provenStrategies`): a line covering at least **30 days**, measured in the last three, and copies from at
  least **5 wallets**, each worth at least 0.1 SOL at its first read. The deepest fall of the line (from its highest point
  before, a record starting level with holding) is always beside the result. Ranked by result less fall. The page holds
  the same gate on what it reads (`readCaptainAnswer`).
- **`GET /api/city/earn/captain`**: the proven strategies only, cached five minutes. Where the ledger is not shared
  (production before the migration) it answers an empty list — no card, never a made-up record.
- **The window** (`components/earn/Captain.tsx`): the Shelf card carries the best proven record; the product shows each
  strategy — its pier and style, the result against holding at full size, a line of the days, the deepest fall, the
  copies and the fees — and one action, **Copy**. Losses are the same size as gains. Before any record: a calm window
  that says when one will show, and «Tell me when».
- **Copy** (`PierCard` with `copy`, `pier-store.openCopy`): the strategy's pier with its style fixed and its record in
  place of the month gone; the person types the amount in SOL; the same Harbor door, the engine's Zap Review, one
  approval — the same Zap from SOL as every pier add (CITY-198).

| | Where | What |
| --- | --- | --- |
| Switch | `NEXT_PUBLIC_RYNTRA_CITY_EARN=open` | Earn's own; closed, the routes answer 404 and the cron reads nothing. Copying acts where the Harbor's switch admits the wallet. |
| Store | `supabase/migrations/20261031120000_city_earn_captain_v1.sql` (prepared, **not applied**) | Production counts only on the database (`captainReady`); rollback `supabase/prepared/20261031_city_earn_captain_v1_rollback.sql`. A developer's machine keeps it in memory (`RYNTRA_CITY_CAPTAIN_STORE=database` to use the database there). |
| Stop | the Harbor's `RYNTRA_CITY_HARBOR_STOP` | Stops the add of a copy as it stops every pier add; the record keeps being read. |

## Sell Higher · Buy Lower · the Wheel (CITY-97)

Spec E6. A real Meteora DLMM **limit order** — it sits in the pool, fills only at the person's price or better and stays
filled (a one-sided range would buy back when the price returns). Built by the engine's new Studio action
(`lib/liquidity/studio/limit-orders.ts`, SDK 1.9.14's own place / cancel / close), reviewed, sealed and relayed exactly as a
pool action (`reviewLimitAction` → ticket → the wallet's one prompt → `/api/liquidity/submit`).

- **Three actions.** Place (one price, or a ladder of ten bins beyond it); Take — everything the order holds back, the
  account closed, its deposit back (one action for "take what sold" and "cancel"); the **Wheel** — a filled order taken
  and the other side placed with what it brought, a step past the fill, in one wallet prompt of two transactions.
- **No Ryntra fee.** `fees` is empty; Meteora charges nothing to place or cancel; the maker earns half the pool's swap
  fee on what fills, said in Details, never as a yield. The fill bypasses the 0.25 % xStocks swap fee — the owner's
  decision; nothing is added quietly.
- **Every mint checked** (`limit-check.ts`): a stock is a stock universe row named by its issuer's catalogue, a listed
  share (never pre-IPO), verified, not halted, still supported; the chain shows only Token-2022 extensions a limit order
  is safe with (an unknown one is refused); the pool is the program's own, enabled, and takes limit orders.
- **Prices through the live Scaled UI multiplier** (`limit.ts`): a target per share becomes a base-token price through
  the multiplier in force; an order set before the multiplier moved is offered «set it again» (`device.ts` keeps the
  target and multiplier it was set at).
- **The eve of a corporate action**: from a day before a scheduled multiplier until the issuer's quarter of an hour after,
  a new sale near the price (a purchase, before a reverse split) is not placed — checked on the card and again on the
  server against the engine's preview (`/api/city/earn/limits/review`).

| | Where | What |
| --- | --- | --- |
| Switch | `NEXT_PUBLIC_RYNTRA_CITY_EARN_LIMITS` = `closed` (default) · `canary` · `open` | closed: the calm card. canary: one wallet places, up to $5; to everyone else it looks closed. open: everyone the engine admits. |
| Owner's wallet | `RYNTRA_CITY_EARN_LIMITS_CANARY_WALLET` (server only) | compared character for character |
| Ceiling | `LIMIT_CEILING_USD` $1,000 one order; $5 for the one wallet | at the venue's own prices, on the server |
| Stop | `RYNTRA_CITY_EARN_LIMITS_STOP` set to anything | new orders stop at once; taking orders back stays open |

Routes: `GET /api/city/earn/limits` (the checked markets), `…/admit?owner=`, `…/orders?owner=`, `POST …/review`. The
devnet pass and the release steps: `docs/city/earn/CITY-97-DEVNET.md`.

## The Stock Pier (CITY-98)

Spec E7 («Мій причал» in the spec's table). In the city the name «Мій причал» is the creator's window of the Launch
(CITY-141, live), so this product is the **Stock Pier** — «Причал акцій» — beside the Shelf's «SOL Pier». A person
builds their own pool of a verified stock against SOL or USDC, with the first liquidity, in one signature — or moors
beside the pair's pier where it already stands.

- **Verified pairs** (`GET /api/city/earn/stock-piers`, `stock-pier.server.ts`, kept ten minutes): the city's avenue
  towers that the stocks engine's universe has from the issuer's catalogue with a price, that Jupiter marks verified,
  whose mint on chain is a Scaled UI token the venue takes as it is — a Token-2022 extension other than transfer fee
  and metadata needs the venue's badge to stand on chain already; Ryntra asks Meteora for none (a badge for a
  stock mint is a decision of its own) — that are not paused, halted or allow-listed, and whose market traded at least $5,000 over seven days
  (the engine's daily candles, at the page's priority). A pair that fails any of it is not offered.
- **The template «Exchange hours»** (`stock-pier-venue.ts`): a customizable Meteora DAMM v2 pool of the stock (A) and
  the quote coin (B) — the whole curve (a gap over a close never leaves its range), a 0.30 % base fee with the venue's
  volatility part (it rises when the price jumps, at the open most of all), fees collected in the quote coin only,
  active at once, nothing locked. The pool's price is set from the live market per base token (the shown price times
  the multiplier), read on the server at the Review. The pool's accounts stay the pool's; the position's come back.
- **The hours** come from the issuer's own trading period (`lib/stocks/session.ts`), never from a weekday rule; the
  **plan for the close** — Stay (earns through the gap) or Step out (the boat card says it is due while the exchange
  closes or is closed, one tap to leave) — is kept on the device per pier (`ryntra.city.earn.stockpier.v1:<owner>`).
  Nothing moves by itself; Ryntra holds no key.
- **Dividend guard** (`stock-pier-hours.ts`): a scheduled step of the token's multiplier (the Scaled UI Amount
  extension's pending multiplier) read for what it is (`corporate.ts`). A dividend holds new liquidity from a day before
  the step to the issuer's quarter of an hour after (the pool's price can lag the market between the step and the
  share's drop at the open); a split only the quarter of an hour either side. The door refuses inside the window.
- **The door** (`POST /api/city/earn/stock-piers/review`, `stock-pier-door.ts`): the product's switch, the verified
  pair read again now, the guard, the live price, the ceiling at those prices — then the engine's own Review
  (`reviewLiquidityAction`), unchanged, with the Stock Pier's venue in front of its DAMM v2 adapter: its gate, the fresh
  NFT key sealed for the relay, the signer check, «venue and the wallet's plumbing only», the simulation, the blockhash's
  life and the ticket. A standing pier was made by someone else, so mooring also needs its own price within 1 % of the
  market's and the add in range — a pool made at a crooked price is refused. The relay is the engine's own
  `/api/liquidity/submit`. Taking fees and leaving go straight to
  the engine's Review wherever the product is not closed to the wallet. The engine's own code is not changed; its
  contract gained one rent kind, `pool`, for a new pool's own accounts.

### The Stock Pier's switch, ceiling and stop (`stock-pier-gate.ts`)

| | Where | What |
| --- | --- | --- |
| Switch | `NEXT_PUBLIC_RYNTRA_CITY_STOCK_PIER` = `closed` (default) · `canary` · `open` | closed: the verified pairs read and show, nothing is offered. canary: one wallet builds, up to $5; to everyone else it looks closed. open: everyone the engine admits. |
| Canary wallet | `RYNTRA_CITY_STOCK_PIER_CANARY_WALLET` (server only) | Compared character for character; never in the repository or the page. |
| Ceiling | `STOCK_PIER_CEILING_USD` — $1,000 one build; canary $5 | Checked on the server at the very prices the pool is made at; a deposit without a price is refused. The engine's own canary ceiling applies on top. |
| Stop | `RYNTRA_CITY_STOCK_PIER_STOP` set to anything (server only) | New money stops at once. Taking fees and leaving stay open. |

Both the product's switch and the engine's gate (`RYNTRA_LIQUIDITY_ACTIONS`) must admit the wallet; Earn's own switch
closes everything.

### Devnet

`node city/lib/earn/stock-pier-devnet.mjs --step all` with `RYNTRA_STOCK_PIER_QA_KEY` naming a devnet key file outside
the repository (it refuses an endpoint whose genesis is not devnet's): `guard` (a Token-2022 «stock» with Scaled UI
Amount and a dividend step in 6 h — the door holds), `build` (a stand-in stock at 2 SOL: the door, the engine's Review
with the Stock Pier's venue, the key signs, the engine's relay sends once, the pool read back through the engine's
DAMM v2 adapter), `moor` (a second add on the standing pier — the engine's own add), `exit` (the engine takes every
position out and closes it). The journal of signatures goes to `docs/shots/city-98/devnet/journal.json`.

## Mine

- **Staked SOL** valued in SOL at each LST's worth; what the device's lots cost against their worth now.
- **Piers** from SOL-2b's read (`/api/liquidity/positions`) and its arithmetic (`lib/liquidity/catalog/track.ts`):
  in range or out, fees, and the position against the same tokens kept — dollars to SOL at today's price.
- **Stocks** — the dividend line (`corporate.ts`): an xStock's Scaled UI multiplier moves on a corporate event; the
  reader tells a reinvested dividend (a small rise that is no clean ratio) from a split or reverse split (a clean
  ratio of small whole numbers) and from anything else. Only dividends are added; a split is shown as «not income».
  The history: the step the extension keeps (`GET /api/city/earn/stocks?mints=…`), kept on the device as it is seen.
- **The headline** adds only SOL figures: «Earned» (lots' gain, piers' fees) and «Vs holding» (lots' gain, piers'
  SOL-2b net), the same size, mint for a gain and flare for a loss; nothing ticks between real reads.

## Notes (CITY-100)

Spec E9: four things Earn tells — **out of range** (a pool position stopped earning), the **stock exchange's weekend**
(a stock the wallet holds or pools can jump when the exchange opens on Monday; from Friday noon in New York to Sunday's
end), a **dividend date** (a Scaled UI change the chain already schedules within a week that reads as a dividend, never
a split — and the day it was added), and **loan health** (half of the live maximum, a buffer on the weekend for stock
collateral; Guard's, never off). One judge for every path: `notes.ts`.

| Path | How |
| --- | --- |
| The city | `notes-source.ts`, started by `EarnLayer` after the first paint: the wallet's positions (through this store, every 5 min — 30 for a wallet with none — while in view) and its stocks (once a visit, hourly while the window is closed) → `notify()` (CITY-87), where the person chose: a banner, the computer, off. What was told is kept per wallet on the device (`ryntra.city.earn.told.v1:<owner>`). |
| The phone and Telegram | The city asks the server to watch the proven wallet once it has something in Earn (`POST /api/city/earn/notes`, the wallet's own proof; never asks the wallet itself). `/api/cron/city-earn-notes` every 5 min reads a few watches, each at most every 15 min (`notes-watch.ts`, `notes-watch.server.ts`): SOL-2b's positions, the Token-2022 coins and their Scaled UI configuration. What is new becomes a note in the engine's inbox with one delivery per channel the wallet's preferences carry — Telegram, the Ryntra app's push, the browser's push — quiet hours and retries the engine's (`lib/monitoring/deliver.ts`). The first positions read is known; a watch with nothing for 30 days ends. |
| Where it opens | `/?open=earn&tab=mine` — the banner, the computer's notification, Telegram's button and the phone. |

Notes can come late (the server reads now and then): the notification window says so behind its «i», never on the
screen. All of it is closed with `NEXT_PUBLIC_RYNTRA_CITY_EARN`. Loan health waits for E10's first loan read.

## Files

| File | What |
| --- | --- |
| `flag.ts` | The switch, the tabs, the products and their risk dots. |
| `open.ts` | The window's store and `openEarn(tab, product)`. |
| `words.ts` | English and Ukrainian, until CITY-79's dictionaries. |
| `lst.ts`, `stake-pool.ts`, `feed.ts`, `feed.server.ts` | The LSTs, the pool decoder, the feed and its server read. |
| `saver.ts`, `saver-store.ts` | The Saver's line and its flow over the trade engine. |
| `mine.ts`, `corporate.ts`, `stocks.ts`, `stocks.server.ts` | «Mine» in SOL, the corporate-action reader, the multipliers. |
| `engine.ts`, `store.ts`, `device.ts` | The reads, their store, what is kept on the device. |
| `pier.ts`, `pier-gate.ts`, `pier-history.ts` | The SOL piers, styles and amounts; the Harbor's switch, ceiling and stop; «Past 30 days». |
| `pier-engine.ts`, `pier-store.ts` | The Piers' line to the server and their state and flow. |
| `captain.ts` | Recipes, copies held to the chain, the daily point, the line, the fall, the gate, the answer. |
| `captain-store.ts`, `captain-db.ts`, `captain-ledger.ts`, `captain.server.ts` | The ledger: memory and the database, the report, the daily pass, the record; the server's wiring. |
| `zap-shots.mjs` | The Zap's screens for review (`docs/shots/city-198/`): `LANG_EARN=uk\|en node city/lib/earn/zap-shots.mjs [out] [baseUrl]` with Earn and the Harbor open on a dev stand. |
| `captain-shots.mjs` | «Like the Captain»'s screens for review (`docs/shots/city-99/`): `node city/lib/earn/captain-shots.mjs [out] [baseUrl]` with both switches open on a dev stand; `LANG_EARN=en` for English. |
| `notes.ts` | Earn's notes: the four judges, their words in both languages, the engine's trigger and Telegram line. |
| `notes-source.ts` | The city's source of them, through the notification centre. |
| `notes-watch.ts`, `notes-watch.server.ts` | The server's watch for the phone and Telegram, and its production reads. |
| `notes-shots.mjs` | The notes' screens for review (`docs/shots/city-100/`). |
| `pier-shots.mjs`, `pier-fixtures.mjs` | The Piers' screens for review (`docs/shots/city-93/`): `node city/lib/earn/pier-shots.mjs [out] [baseUrl]` with both switches open on a dev stand. |
| `limit.ts`, `limit-check.ts`, `limit-gate.ts` | Sell Higher: price ↔ bin through the multiplier, the eve guard, the Wheel; every mint's check; the switch, ceiling and stop. |
| `limit-markets.server.ts`, `limit-engine.ts`, `limit-store.ts`, `limit-words.ts` | The checked markets; the window's line to the server; its state and flow; its words. |
| `limit-shots.mjs` | Sell Higher's screens (`docs/shots/city-97/`): `LANG_EARN=en node city/lib/earn/limit-shots.mjs [out] [baseUrl]` with both switches open on a dev stand. |
| `stock-pier.ts`, `stock-pier-hours.ts`, `stock-pier-gate.ts` | The Stock Pier: verified pairs, prices and amounts; the hours, the plan for the close and the dividend guard; its switch, ceiling and stop. |
| `stock-pier-venue.ts`, `stock-pier-door.ts`, `stock-pier.server.ts` | The pool's build in front of the engine's DAMM v2 adapter; the city's door in front of the engine's Review; the verified list and the Review's wiring on the server. |
| `stock-pier-engine.ts`, `stock-pier-store.ts` | The Stock Pier's line to the server and its state and flow. |
| `stock-pier-shots.mjs`, `stock-pier-fixtures.mjs`, `stock-pier-devnet.mjs` | The screens for review (`docs/shots/city-98/`), their fixtures, the devnet pass. |
| `shots.mjs` | The screens for review (`docs/shots/city-92/`): `node city/lib/earn/shots.mjs [out] [baseUrl]` with `NEXT_PUBLIC_RYNTRA_CITY_EARN=open npm run dev`; `LANG_EARN=en` for English. |

The window's contents are `city/components/earn/` (`EarnLayer` is mounted once in `CityApp`).
