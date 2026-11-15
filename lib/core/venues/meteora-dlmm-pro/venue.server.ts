/**
 * Meteora DLMM Pro in Ryntra's engine: one venue on one connection.
 *
 * DLMM Pro is Meteora's tick-based concentrated-liquidity program — its own program, beside DLMM, DAMM v2 and DBC,
 * open as a beta since 12.11.2026. This folder is everything the engine knows of it:
 *
 * | Part | File | What it does |
 * |---|---|---|
 * | the SDK, pinned | `./sdk.server.ts` | one client per connection; refusals |
 * | pools | `./pools.server.ts` | find, read whole, model; build a launch pool |
 * | swap | `./swap.server.ts` | quote now, build from a fresh quote, Ryntra's referral where it exists |
 * | limit orders | `./limit-orders.server.ts` | a ladder from a shape; read fills; collect; close; delegate |
 * | positions | `./positions.server.ts` | open from a shape; add; remove; collect; compound; lock for ever; delegate |
 * | rewards | `./rewards.server.ts` | set a slot up; fund an emission; collect |
 * | events | `./events.server.ts` | a transaction's events, from its inner instructions |
 * | holdings | `./owned.server.ts` | a wallet's positions and orders; a pool's |
 * | arithmetic | `./fee.ts`, `./activation.ts`, `./orders.ts`, `./ticks.ts` | pure: the fee now, who may act when, how much of an order filled |
 *
 * **Every build is unsigned bytes for the person's wallet**, version 0, with its compute budget (`./tx.server.ts`). The
 * wallet is the fee payer; the only other signature a build can need is a fresh key's — the mint of a new position's
 * or order's NFT — which the caller makes and holds. No key of Ryntra's signs anything here, and the venue holds none.
 *
 * **Closed to people** (`./gate.ts`): no route, no window and no agent tool stands on this venue yet. The live Launch
 * on DBC does not load it and is not changed by it.
 *
 * `referralOwner` is the address Ryntra's referral token accounts belong to on the network — the same owner as on DBC
 * (`lib/launch/config.server.ts`). A swap carries the referral only where the owner's account in the swap's fee coin
 * exists on chain; an order placed through the venue names the owner as its referral unless the caller says otherwise,
 * and a collect pays it only where that cannot hold the collect up. Null — no swap carries a referral and no order
 * names one.
 */

import type { Connection } from "@solana/web3.js";

import type { Address } from "../../contracts.ts";
import { createDlmmProEvents } from "./events.server.ts";
import { createDlmmProLimitOrders } from "./limit-orders.server.ts";
import { createDlmmProHoldings } from "./owned.server.ts";
import { createDlmmProPools, type DlmmProContext } from "./pools.server.ts";
import { createDlmmProPositions } from "./positions.server.ts";
import { createDlmmProRewards } from "./rewards.server.ts";
import { dlmmProClientOf } from "./sdk.server.ts";
import { createDlmmProSwap } from "./swap.server.ts";

export function createDlmmProVenue(args: Readonly<{ connection: Connection; referralOwner: Address | null }>) {
  const context: DlmmProContext = { connection: args.connection, client: dlmmProClientOf(args.connection), referralOwner: args.referralOwner };
  return {
    venue: "meteora-dlmm-pro" as const,
    program: context.client.program.programId.toBase58(),
    pools: createDlmmProPools(context),
    swap: createDlmmProSwap(context),
    orders: createDlmmProLimitOrders(context),
    positions: createDlmmProPositions(context),
    rewards: createDlmmProRewards(context),
    events: createDlmmProEvents(context),
    holdings: createDlmmProHoldings(context),
  };
}

export type DlmmProVenue = ReturnType<typeof createDlmmProVenue>;
