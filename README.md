# Ryntra on Solana — source

**Trade, launch and run your money.** Ryntra is one app for active money on
Solana, on the web and on Android: trade coins, memes and tokenized stocks from
one list, launch a token on a Meteora bonding curve, put your buying on a
schedule, and keep a receipt for every operation — every transaction reviewed
before it is signed, and signed in your own wallet. Ryntra never holds keys or
money. It runs at [ryntra.io](https://ryntra.io/app) and as **Ryntra for
Android, live in the Solana dApp Store** (1.12.0, since 12 October 2026).

## The Android app at a glance

`apps/mobile/` — a native React Native / Expo app, not a WebView or a PWA,
started on 14 September 2026 and shipped as signed releases (1.9.0 → 1.12.0),
tested on a Solana Seeker with real mainnet purchases.

- **The wallet is the account:** Mobile Wallet Adapter connect and Sign-In With
  Solana; the Seeker's wallet signs every transaction, the app never sees a key,
  and a signed operation is recovered after the app closes instead of being
  sent twice.
- **Trade:** one screener for coins, memes, tokenized stocks and private-company
  tokens, every figure with the time it was read; buy, sell and swap with a
  Review of everything that leaves and arrives and every fee; a receipt for
  every operation, shareable as a picture without the wallet address.
- **Launch:** a token from the phone on a Meteora bonding curve — the rules,
  fees and market caps shown before signing; every market launched through
  Ryntra in one list read from the chain, with its health and flight log.
- **Recurring buys:** daily, weekly, monthly, on a price drop or from each USDC
  payment, under a price condition and a monthly budget; the wallet signs each
  purchase.
- **Built for the phone:** camera and QR, payment links, haptics, light and dark
  themes, English and Ukrainian; account-data deletion and «Report» / «Hide»
  for launched tokens, as the dApp Store asks.

The signed APK: [android-v1.12.0](https://github.com/ryntra-io/ryntra-solana-evidence/releases/download/android-v1.12.0/ryntra-1.12.0.apk).
How to build it yourself: [The Android app](#the-android-app) below.

This repository is the product's source code as released — the web app, the
Android app, the Evidence Kernel and the database schema, with their tests. It
is private and shared read-only with invited reviewers. Every update is one
commit, named for what it released; the latest is from 2026-10-12.

## What is here

| Path | What it is |
|---|---|
| `app/` | The web app and its API — Next.js App Router: the pages people use and the routes behind them |
| `lib/` | The product's logic: `solana/` execution, receipts and recovery, `stocks/` tokenized equities, `plans/` and `autoinvest/` the person's own rules, `guard/` the Evidence Kernel that records and proves each operation, `home/` Portfolio and risk, `agent/` the assistant |
| `packages/` | Libraries with their own interface: the API client the phone uses, the tokenized-stocks and trading-plans models, the evidence SDK and its MCP servers |
| `apps/mobile/` | The Android app — React Native with Expo; it reads the same versioned API and signs in the person's wallet through Mobile Wallet Adapter |
| `supabase/migrations/`, `supabase/prepared/` | The database schema migration by migration, and the prepared SQL that is applied by hand (corrections and rollbacks) |
| `public/` | Static assets |

3,126 files come from the development repository as released, and each test
sits beside the code it tests (`*.test.mjs`); `README.md`, `BOUNDARY.md`,
`LICENSE`, `.gitignore` and the scripts of `package.json` are written for this
snapshot.

## Run the web app

Node >=22 <25, 22.18 or later — the tests import TypeScript directly.

```bash
npm ci
npm run dev          # http://localhost:3000 — the app is at /app
```

```bash
npm test             # the unit and contract tests
npm run typecheck
npm run lint
npm run build        # the production build
```

The app starts with no environment variables. What needs a provider or a
database says so on its page instead of pretending: trading asks for a Jupiter
API key (`RYNTRA_JUPITER_API_KEY`), accounts and saved plans for Supabase
(`SUPABASE_URL`, `SUPABASE_ANON_KEY`). Put them in `.env.local`; no secret is
ever committed here.

A few tests hold the code to documents the development repository keeps beside
it — the product specification, the work tracker, the evidence archive. Here
they are reported as skipped, each naming what it reads.

## The Android app

Node >=22 <25, JDK 17 and the Android SDK (platform 36, build-tools 36.0.0,
NDK 27.1), with `JAVA_HOME` and `ANDROID_HOME` pointing at them.

```bash
cd apps/mobile
npm ci
npm test
npx uniwind generate-artifacts --css ./src/global.css --dts ./src/uniwind-types.d.ts
npm run typecheck    # after the style types above, which Metro otherwise writes on its first bundle
```

With a phone or an emulator connected, `npx expo run:android` builds a
development build, installs it and starts Metro beside it.

A standalone APK, JavaScript bundled in, without the release key:

```bash
npm run release:android -- --unsigned --abi=arm64-v8a
```

It lands in `apps/mobile/dist/` as `ryntra-<version>-vc<code>-<commit>-unsigned.apk`.
Android installs only a signed APK: sign it with your own key before
`adb install` (`apksigner sign --ks <your.keystore> <apk>`, from the SDK's
build-tools).

## Hackathon boundary

The code as it stood before the hackathon is tagged
`pre-hackathon-baseline-2026-09-11` in the development repository — commit `7fc5776f`,
2026-09-11. Measured against that tag, path by path, for the 3,126 files
that come from the development repository:

| Since the tag | Files |
|---|---|
| New | 1,391 |
| Changed | 825 |
| Unchanged | 910 |
| Lines added / removed | +365,296 / −20,560 |

[BOUNDARY.md](BOUNDARY.md) lists every new and every changed file. Shipped since
then, as the public build log records it:

| Date | What shipped |
|---|---|
| 2026-09-12 | Spot fills, and the Portfolio as a statement |
| 2026-09-14 | Evidence kit 1.1.0 |
| 2026-09-14 | Public site, documentation and one navigation |
| 2026-09-14 | Tokenized stocks on Solana |
| 2026-09-15 | The stock desk: Discover, the screener, one shared universe |
| 2026-09-15 | A versioned API contract for native clients |
| 2026-09-15 | Deal terms and token alternatives on the asset page |
| 2026-09-15 | Trading plans bound to the deal |
| 2026-09-16 | Operations ledger behind the public statistics |
| 2026-09-16 | The plan builder in three steps |
| 2026-09-16 | Pre-IPO stock instruments |
| 2026-09-16 | Onchain evidence inside the trading plan |
| 2026-09-16 | Risk & due diligence: how the token is built, as a rule of the plan |
| 2026-09-17 | Predictions: markets on outcomes, with a plan, a Review and paper trading |
| 2026-09-22 | Trading Plans on SOL, crypto and memes — the same engine, the planning price with its time |
| 2026-09-22 | Ryntra, the AI assistant — it researches and prepares, and it never executes |
| 2026-09-22 | Results — what actually happened, against what you planned |
| 2026-09-23 | Buy a tokenized stock with a loss limit you set |
| 2026-09-25 | Buy a piece of a company from one dollar |
| 2026-09-25 | The IPO and conversion watch — a pre-IPO token never left to expire |
| 2026-09-25 | Private companies through PreStocks only — Tessera disconnected |
| 2026-09-25 | A company page that says what the company is |
| 2026-09-25 | The company's path — from a private company to its token on Solana |
| 2026-09-26 | A price condition on every Autoinvest rule |
| 2026-09-26 | Autoinvest from every payment |
| 2026-09-27 | Sell from your position |
| 2026-09-28 | Buy and sell a company in under a minute |
| 2026-09-28 | Ryntra will warn you: every position watched |
| 2026-09-29 | Help and privacy for the Android app |
| 2026-09-29 | Portfolio risk on Home |
| 2026-09-29 | Lighter Home and Portfolio |
| 2026-10-04 | Stats by product and the public fee addresses |
| 2026-10-04 | The Ryntra fee by what you trade, shown as an amount before you sign |
| 2026-10-05 | Rewards ranks: a share of the fee Ryntra receives, growing with your rank |
| 2026-10-06 | Ryntra Launch: your Solana token on a Meteora bonding curve in one signature |
| 2026-10-06 | One menu around launch, trade and bots, and one screener for every asset |
| 2026-10-06 | A launch that lands is always shown, and every launched token can be bought and sold |
| 2026-10-06 | Every page takes the width of the screen it is on |
| 2026-10-06 | Share a trade: a card of your result with your invite link |
| 2026-10-07 | A recurring buy for any token with liquidity, next to Market in every order |
| 2026-10-07 | Every launched token keeps a flight log: each event with its time, amount and transaction |
| 2026-10-08 | A launched token's trades in History, each with its signed receipt and a link to share |
| 2026-10-09 | One wallet signature per visit: sign in once and every page is yours |
| 2026-10-09 | The trading terminal fits a laptop: the chart first, the order always in reach |
| 2026-10-09 | A shared trade shows up on X and Telegram as a large card, and Rewards sits in the header |
| 2026-10-09 | Every market launched on Ryntra on one public page, and each token's market health |
| 2026-10-09 | The launch executor runs on mainnet, every step in the market's flight log |
| 2026-10-10 | Micro: a small market that reaches the DEX at 750 USDC, its launch fee all for the market |
| 2026-10-10 | A market's budget from its own fees |
| 2026-10-10 | A market's whole cycle on mainnet: launch, the DEX, its budget and its ladder |
| 2026-10-11 | Earn from a launched token's pool — open to everyone |
| 2026-10-11 | Swap and Spot Review works on the first press |
| 2026-10-11 | A coin gets what a stock has: your position and «Sell», what it is, its market cap |
| 2026-10-12 | The token page: who bought and sold, who holds, the risk facts and the chart's marks |
| 2026-10-12 | Quick buy and quick sell: one tap to the Review, on every token, stock and launch |
| 2026-10-12 | Pulse on Home: new tokens, curves close to the DEX and the market's moves, live |

## What is not here

- The open-source developer kit — read-only tools for tokenized stocks and
  Token-2022 on Solana, with a build log of every shipped slice — is public:
  [ryntra-io/ryntra-solana-evidence](https://github.com/ryntra-io/ryntra-solana-evidence).
- Internal documents stay in the development repository: the product
  specification and the task tracker. The code's comments give their reasons in
  their own words.
- Secrets and keys: environment only.

## Licence

Proprietary — see [LICENSE](LICENSE). Shared for review; no licence to use,
copy or distribute is granted.
