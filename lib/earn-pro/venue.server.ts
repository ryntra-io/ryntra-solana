/**
 * The one door from earning to the DLMM Pro venue.
 *
 * Everything of `lib/earn-pro/` that reads a pool, builds a transaction or asks what a position earned goes through
 * `earnProVenue(network)`; no other file outside the venue's own folder imports it (the venue's guard test names this
 * file and `./gate.ts` and nothing else). So closing the surface is closing one switch (`./gate.ts`), and the venue
 * stays unreachable from every route that does not ask the gate first.
 *
 * A venue is one per connection, kept for the process: making one builds the program's coders from its IDL.
 */

import { Connection } from "@solana/web3.js";

import { ATTRIBUTION_REGISTRY } from "../attribution/registry.ts";
import { DLMM_PRO_PROGRAM, DlmmProRefusal, type DlmmProRefusalCode } from "../core/venues/meteora-dlmm-pro/sdk.server.ts";
import { createDlmmProVenue, type DlmmProVenue } from "../core/venues/meteora-dlmm-pro/venue.server.ts";
import { resolveEndpoint } from "../solana/rpc.ts";
import { earnProGate, type EarnProNetwork } from "./gate.ts";

export { DLMM_PRO_PROGRAM, DlmmProRefusal };
export type { DlmmProRefusalCode, DlmmProVenue };
export { careRefusalOf, type CareSubject } from "../core/venues/meteora-dlmm-pro/care-rules.server.ts";
export { CARE_RIGHTS } from "../core/venues/meteora-dlmm-pro/earn.server.ts";
/** The stock pool's keeper (`lib/care/stock-keeper.server.ts`) reaches its move and its lock only through this door. */
export { KEEPER_RIGHTS, MAX_KEEPER_BAND_BPS, keeperRefusalOf, type KeeperBounds, type KeeperMoveBuild } from "../core/venues/meteora-dlmm-pro/range.server.ts";
/** What a limit order keeps of the fee on what it fills. */
export { makerShareOf } from "../core/venues/meteora-dlmm-pro/ladder.ts";
export type { EarnIncome, EarnOpenBuild } from "../core/venues/meteora-dlmm-pro/earn.server.ts";
export { CUSTOM_GOAL, EARN_GOALS, EARN_STYLES, isEarnGoal, isEarnStyle, isOpenGoal, isShapeColumns, type EarnGoal, type EarnStyle, type OpenGoal } from "../core/venues/meteora-dlmm-pro/goals.ts";
export type { DlmmProSteps } from "../core/venues/meteora-dlmm-pro/bins.server.ts";
export type { DlmmProPool } from "../core/venues/meteora-dlmm-pro/pools.server.ts";
export type { DlmmProBuild, DlmmProTx } from "../core/venues/meteora-dlmm-pro/tx.server.ts";

/** The owner of Ryntra's referral token accounts: Launch's own fee identity on mainnet; on devnet the stand names one or there is none. */
export function referralOwnerOf(network: EarnProNetwork, env: Readonly<Record<string, string | undefined>> = process.env): string | null {
  if (network === "mainnet") return ATTRIBUTION_REGISTRY.find((row) => row.id === "solana-launch-fee-claimer" && row.end === null)?.address ?? null;
  return env.RYNTRA_EARN_PRO_DEVNET_REFERRAL?.trim() || null;
}

const connections = new Map<EarnProNetwork, Readonly<{ url: string; connection: Connection }>>();
/** The connection of a network, kept while its endpoint stays the one configured. */
export function earnProConnection(network: EarnProNetwork): Connection {
  const url = resolveEndpoint(network);
  const kept = connections.get(network);
  if (kept && kept.url === url) return kept.connection;
  const connection = new Connection(url, { commitment: "confirmed", disableRetryOnRateLimit: true });
  connections.set(network, { url, connection });
  return connection;
}

const venues = new WeakMap<Connection, DlmmProVenue>();
/**
 * The venue on a connection — the network's own, or the one a test or a rehearsal hands in — and only where the gate
 * stands open on that very network (`./gate.ts`): a caller that forgot to ask is refused here.
 */
export function earnProVenue(network: EarnProNetwork, connection?: Connection, env: Readonly<Record<string, string | undefined>> = process.env): DlmmProVenue {
  const gate = earnProGate(env);
  if (!gate.open || gate.network !== network) throw new DlmmProRefusal("NOT_OPEN", "Earning on DLMM Pro is not served on this network here.");
  connection ??= earnProConnection(network);
  let venue = venues.get(connection);
  if (!venue) {
    venue = createDlmmProVenue({ connection, referralOwner: referralOwnerOf(network) });
    venues.set(connection, venue);
  }
  return venue;
}
