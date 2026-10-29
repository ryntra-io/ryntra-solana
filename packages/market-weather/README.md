# Market Weather

Honest live Solana market data for apps and games: a data contract, read-only adapters for Jupiter and Meteora, and a
one-file city that shows the market's weather in a page or a phone's WebView.

![The city on a desk: a rising market](../../docs/grants/market-weather-shots/desk-sun.jpg)

Apache-2.0 · no runtime dependencies · reads public endpoints with GET and nothing else.

## The contract

Every signal a product shows keeps four promises, enforced in code rather than left to the caller:

| Promise | What the code does |
| --- | --- |
| **Source and time** | Each `Reading` names its `source`, a `url` anyone can read again, and `observedAt` — with `timeFrom: "source"` when the source stated the time, `"read"` when it is the moment of reading. |
| **Minimum liquidity** | A market below `minLiquidityUsd` (default 50 000 USD), or whose depth nobody measured, is `thin`, never `live`. |
| **Two reads** | A value is `live` only when two readings from two different sources agree (prices within 2 %, moves the same way within 1.5 points). One source is `single_read`; two that differ are `disagree`. |
| **Data delayed** | When the freshest reading — or the second source — is older than `maxAgeMs` (default 3 min), the signal is `delayed`; when half the assets are late the whole sky is `fog` with `delayed: true`. |

Under all four: **a figure nobody measured is `not_measured`, never a zero.** A field left out, text, `NaN` or
`Infinity` measured nothing; a `0` measured zero.

```ts
import { readMarketWeather, createWeatherStream } from "@ryntra/market-weather";

const { weather, failures } = await readMarketWeather([
  "So11111111111111111111111111111111111111112",
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh",
]);

weather.state;            // "sun" | "clear" | "cloud" | "rain" | "storm" | "fog" | "not_measured"
weather.assets[0].price;  // { status: "live", value, source, at, reads: [...] }

const stream = createWeatherStream();
for (const event of stream.push(weather)) {
  // { type: "weather" } · { type: "delayed" } · { type: "recovered" }
  // { type: "move", asset, direction } — only after two weathers in a row agree, then a 15-minute cooldown per asset
}
```

Nothing throws. A provider that fails is listed in `failures`, and the weather is judged from what was read.

## Adapters

| Source id | Endpoint (keyless) | Gives |
| --- | --- | --- |
| `jupiter-price-v3` | `https://lite-api.jup.ag/price/v3?ids=…` | dollar price, 24-hour move |
| `jupiter-tokens-v2` | `https://lite-api.jup.ag/tokens/v2/search?query=…` | depth, verified flag, 24-hour move, mint and freeze authority, DBC launchpad and graduation |
| `meteora-dlmm` | `https://dlmm.datapi.meteora.ag/pools?filter_by=…` | the pool's own price, depth, trading, freeze authority |
| `meteora-damm-v2` | `https://damm-v2.datapi.meteora.ag/pools…` | the same for DAMM v2, and the pool a DBC launch graduated into |

Which readings feed which signal:

- **price** — Jupiter Price V3, and the deepest qualifying Meteora pool of each kind: two providers. A pool priced in
  USDC or USDT is a dollar price directly; a pool priced in SOL is converted with SOL's price (`derivation` says so).
- **24-hour move** — Jupiter Price V3 and Jupiter Tokens V2: two separate Jupiter computations. The move counts in the
  sky only when its price is not in dispute across providers.
- **depth** — Jupiter's liquidity; when Jupiter states none, the Meteora pools' summed depth.

Each `read*` function takes `{ fetch, timeoutMs, maxBytes, now }`, so a server, an edge function or a test supplies its
own. The parsers (`parsePriceV3`, `parseTokensV2`, `parseMeteoraPools`) are pure.

## Issuer badges

`badges.mint` and `badges.freeze`: can somebody still mint more of this token, or freeze a holder's balance?

| State | Meaning |
| --- | --- |
| `revoked` | every source that stated it says the authority is gone |
| `active` | every source that stated it names an authority |
| `disputed` | sources disagree — shown as a caution, never as the kinder answer |
| `not_measured` | nobody stated it — never read as «revoked» |

Sources: Jupiter's audit, Meteora's pool record (freeze), and your own chain read through `authorityReadsFromChain`
— for example from `inspectSolanaMint` in `@ryntra/solana-evidence-sdk`. A badge is a fact about the mint, not a
verdict about the token.

## Launch lifecycle (Meteora DBC → DAMM v2)

For a token Jupiter names as a DBC launch (`met-dbc`, `jup-studio`, `believe`): `stage` is `curve` or `graduated`;
the graduated pool is `confirmed` when Meteora's own DAMM v2 record holds the token; survival checks at day 7, 30 and
90 are `pending`, `alive` (the pool holds at least `survivalTvlUsd` and traded in the last day), `quiet` or
`not_measured`. Curve progress is `not_measured` in this version: no keyless endpoint states it.

## The city, embedded

```bash
node scripts/build.mjs   # → dist/market-weather-city.js, one file, ~32 KB before gzip
```

```html
<script src="market-weather-city.js"></script>
<market-weather-city src="/api/market-weather" refresh="60"></market-weather-city>
```

Each asset is a tower, as tall and as broad as the logarithm of its depth. A rising asset's windows burn orange, a
falling one's go cool; a tower whose move is not `live` is lit neither way. An unverified token, or one whose depth
nobody measured, is a scaffold with no name. Issuer badges sit on the roof; a graduated launch carries a mast, a
launch still on its curve a crane. The sky is the weather. A weather that is more than five minutes old when drawn
turns to fog with «Data delayed», so a stopped feed never shows yesterday's sun.

Tap a tower: a small card with the ticker, price, 24-hour move and both badges. The element also raises
`market-weather-select` with `{ asset }` for the host to open its own page.

Three ways in:

```js
city.weather = weather;                                   // a property
// <market-weather-city src="/api/market-weather">        // a JSON file, read with GET every `refresh` seconds (≥ 15)
// <market-weather-city listen>                           // window messages { type: "market-weather", weather }
//                                                        // from the page itself or the frame that embeds it
```

Whatever arrives from outside passes `acceptWeather` first: a wrong shape, an unknown state or a label that is not a
plain ticker is refused, and text is set with `textContent` only. With `prefers-reduced-motion` the city is drawn
still; in still air it draws 12 frames a second, in rain and fog 30, and nothing while the page is hidden.

### In a Seeker app (React Native WebView)

```tsx
import { useEffect, useRef } from "react";
import { WebView } from "react-native-webview";

const html = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body{margin:0;height:100%;background:#07080b}market-weather-city{position:fixed;inset:0;aspect-ratio:auto;border-radius:0}</style>
<script>${CITY_SCRIPT}</script><market-weather-city listen></market-weather-city>`;

export function MarketWeatherCity({ weather }: { weather: unknown }) {
  const ref = useRef<WebView>(null);
  useEffect(() => {
    ref.current?.injectJavaScript(`window.postMessage(${JSON.stringify({ type: "market-weather", weather })}, "*"); true;`);
  }, [weather]);
  return <WebView ref={ref} originWhitelist={["*"]} source={{ html }} style={{ flex: 1, backgroundColor: "#07080b" }} />;
}
```

`CITY_SCRIPT` is the text of `dist/market-weather-city.js`, bundled as an asset. A working page is in
[`examples/webview.html`](examples/webview.html): open it with `?sky=sun|rain|storm|fog` for a demo with made-up
tickers, or `?src=` for your feed.

### A server route

```ts
// e.g. a Next.js route: GET /api/market-weather
import { readMarketWeather } from "@ryntra/market-weather";

export async function GET() {
  const { weather } = await readMarketWeather(MINTS);
  return Response.json(weather, { headers: { "cache-control": "public, max-age=30" } });
}
```

## What this package does not do

It holds no key, signs nothing, builds no transaction, swaps nothing and moves no money. It reads with GET through
one function (`readJson`: https only, a timeout, a byte ceiling, no retry on 429). `test/boundary.test.mjs` asserts
this by reading the sources.

## Tests

```bash
node --test test/*.test.mjs
```

The tests need no network. They cover the contract's rules, the adapters on recorded Meteora answers and documented-shape Jupiter
answers (`fixtures/PROVENANCE.md`), the city's layout and input gate, the one-file build, and the boundary.
`node scripts/record-fixtures.mjs` records fresh live answers on a machine that can reach the endpoints.

## Status

0.1.0. The contract, adapters, badges, lifecycle and embed are built and tested. Not yet: live-recorded Jupiter
fixtures, the DBC curve-progress reader, a second provider for 24-hour moves, and publication to npm.
