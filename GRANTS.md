# Grants and hackathons

What Ryntra entered and applied for, what each application says Ryntra will build, and where that stands in this
code. A promise that is not built yet says so. Paths are in this repository unless a link says otherwise.

- [Colosseum Crypto World's Fair](#colosseum-crypto-worlds-fair), October 2026 — what was built during the
  hackathon. *Judging.*
- [Meteora's Dynamic Bonding Curve track](#meteora), October 2026 — launches on DBC, graduating into DAMM v2.
  *Submitted; launches live on mainnet.*
- [Clock In by Solana Mobile](#clock-in-by-solana-mobile), October 2026 — the Android app. *Live in the Solana dApp
  Store.*
- [Solana Foundation, AI](#solana-foundation-ai), November 2026 — the agent's safety layer as open code. *Applied.*
- [Solana Mobile Builder Grants](#solana-mobile-builder-grants), November 2026 — the phone made native. *Applied.*

## Colosseum Crypto World's Fair

The code as it stood before the hackathon is tagged in the development repository. The
[README](README.md#built-during-the-hackathon) counts the files that are new and changed since, and
[BOUNDARY.md](BOUNDARY.md) lists every one of them. Each update of this repository recounts it from the development
history.

## Meteora

A coin launched on a curve starts on a Meteora Dynamic Bonding Curve config Ryntra created as the partner; at about $75K the
curve graduates into a DAMM v2 pool whose liquidity is locked for ever. It runs on Solana mainnet. The whole lifecycle,
file by file, with the tests that prove it: [METEORA.md](METEORA.md).

Since then Ryntra has built on Meteora DLMM Pro — positions in a shape, limit orders with a maker bonus, a grid on
those orders, a launch straight into a pool and an agent that looks after a position — rehearsed on the program's own
binary and open to everyone in the terminal on mainnet since 18 November 2026:
[METEORA.md — DLMM Pro](METEORA.md#dlmm-pro).

## Clock In by Solana Mobile

The Android app, `io.ryntra.app`, is live in the Solana dApp Store since 8 October 2026. It opens ryntra.io full screen
and signs every transaction through Mobile Wallet Adapter — Phantom, Solflare or the Seeker's own wallet, with Sign In
With Solana and `.skr` names. The app: [`apps/mobile/`](apps/mobile); the page in the app and the bridge between them:
[`apps/mobile/src/features/city/`](apps/mobile/src/features/city).

## Solana Foundation, AI

**What the application says.** Ryntra's agent trades inside a budget the chain enforces. The grant would pay for opening
the layer that makes an agent safe to fund, as standalone packages under Apache-2.0 that any wallet, agent framework or
app can use without Ryntra, and for adoption of agents with on-chain budgets.

**1 · The limits as an on-chain policy** — per trade, per day, the venues, the receiver and the expiry, compiled to a
Squads smart-account spending policy, with the rule that the coins must arrive in the owner's account or the trade
fails.
- *Today:* [`lib/mandate/terms.ts`](lib/mandate/terms.ts) (`mandatePolicy`) and [`lib/mandate/ssa.ts`](lib/mandate/ssa.ts),
  with golden bytes from the program's own coder in [`lib/mandate/ssa.golden.json`](lib/mandate/ssa.golden.json). On
  mainnet since 4 November 2026.
- *Not yet:* a standalone package under Apache-2.0, with a devnet test in its own CI and a quickstart.

**2 · The agent's trade read before its key signs**, the way the chain will read it.
- *Today:* [`lib/mandate/judge.ts`](lib/mandate/judge.ts); on mainnet the agent's key lives in Google Cloud KMS
  ([`lib/mandate/agent-service.server.ts`](lib/mandate/agent-service.server.ts)).
- *Not yet:* part of the standalone package.

**3 · A check of any transaction before a signature** — intent, policy and verdict.
- *Today:* [`lib/ward/`](lib/ward) reads the bytes — every program called, and the authority instructions of the
  System, Stake, Upgradeable Loader and both token programs — then simulates those exact bytes and diffs them account
  by account, and answers `allow`, `warn` or `block` with its reasons. Served at `POST /api/v1/ward/check`
  ([`app/api/v1/ward/check/`](app/api/v1/ward/check)).
- *Not yet:* the spec as JSON Schema, a decoder for Jupiter swaps, 150 test vectors, a public benchmark on labelled
  drain and honeypot transactions, and a standalone package under Apache-2.0.

**4 · Adoption** — integrations in unrelated open-source projects; 300 wallets running an agent, 50 of them with a
budget signed on mainnet.
- *Not yet:* it follows the packages.

The layer runs in production today, and its code is here to read under this repository's licence. The standalone
Apache-2.0 packages are not published yet.

## Solana Mobile Builder Grants

**What the application says.** Today the app is ryntra.io in a WebView with Mobile Wallet Adapter. The grant would make
it native in four milestones. None is finished; where a part already exists, it says so.

**1 · The agent in your pocket** — the agent's evening report as a native notification, with Freeze and Resume on it.
- *Today:* the report reaches the person inside the product; the phone stays silent.

**2 · Launch from the camera** — a photo, a name, a ticker and one Seed Vault signature; the new coin's card to the
system share sheet.
- *Today:* launches from the phone through Mobile Wallet Adapter.

**3 · Seeker first** — tuned on real Seeker devices, one-tap sign-in for Seeker owners, `.skr` names wherever a wallet is
shown.
- *Today:* tested on an emulator; Sign In With Solana and `.skr` names are already in the app.

**4 · An open kit** — the Market Weather kit on npm under Apache-2.0: a data contract and read-only Jupiter and Meteora
adapters any Seeker app can embed.
- *Today:* [`packages/market-weather/`](packages/market-weather), a read-only market-data kit; not on npm yet.

## Open source today

[ryntra-solana-evidence](https://github.com/ryntra-io/ryntra-solana-evidence) — Ryntra's TypeScript kit for Solana
tokens, published under Apache-2.0.
