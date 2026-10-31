# Earn in the city (CITY-92, with CITY-94 and CITY-95 first pass)

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
| SOL Pier | the Harbor's flow where `NEXT_PUBLIC_RYNTRA_CITY_HARBOR=open`, else a calm window | the top SOL pier's fees, 24 h |
| Dollar Saver | calm window (CITY-96 waits for the owner's key, switch, canary) | USDC lending rate from SOL-3's read |
| Sell Higher | calm window (CITY-97) | SOL's price from the city's tower |
| Dollars for Stocks | calm window (CITY-101) | the most traded stock tower's price |
| Like the Captain | calm window (CITY-99) | how many piers are listed |

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

## The LST feed — `GET /api/city/earn`

`feed.server.ts`, cached two minutes. JupSOL and JitoSOL: their SPL stake pool accounts on chain (`stake-pool.ts`) —
the token's worth in SOL now and at the epoch before; the yield is that move compounded over the epochs of a year at
the slot time the network kept lately (`getRecentPerformanceSamples`). The pool must name the LST's own mint and be
updated this epoch or the last. INF (a pool of LSTs, not a stake pool): Sanctum's public `apy/latest` and
`sol-value/current`. A figure that fails is null and hidden.

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
| `shots.mjs` | The screens for review (`docs/shots/city-92/`): `node city/lib/earn/shots.mjs [out] [baseUrl]` with `NEXT_PUBLIC_RYNTRA_CITY_EARN=open npm run dev`; `LANG_EARN=en` for English. |

The window's contents are `city/components/earn/` (`EarnLayer` is mounted once in `CityApp`).
