/**
 * Liquidity Studio's two Solana venues, wired for the server: DLMM through the
 * SDK's ESM build (the one Next bundles, as the launch engine already does) and
 * DAMM v2. The connection is the caller's — the reader decides the RPC and its
 * fallback (`lib/solana/rpc.ts`); this module holds no endpoint and no key.
 *
 * Actions stay closed to people until a first live check with the smallest
 * amount: the capabilities say `later` and no route builds for a person before then.
 */

import "server-only";

import DLMM, { createProgram, ClockLayout, DEFAULT_BIN_PER_POSITION, getPriceOfBinByBinId, wrapPosition } from "@meteora-ag/dlmm";
import type { Connection, Keypair } from "@solana/web3.js";

import type { LiquidityVenueAdapter, LiquidityVenueId } from "./contract.ts";
import { createDammV2Venue } from "./damm-v2.ts";
import { createDlmmVenue, type DlmmSdk } from "./dlmm.ts";

export const DLMM_SDK: DlmmSdk = { DLMM, createProgram, ClockLayout, DEFAULT_BIN_PER_POSITION, getPriceOfBinByBinId, wrapPosition };

/** `newKeypair`: where a build gets the fresh key of a new position (or its NFT) — the actions keep it for the relay. */
export function liquidityVenues(connection: Connection, newKeypair?: () => Keypair): Readonly<Record<LiquidityVenueId, LiquidityVenueAdapter>> {
  return {
    "meteora-dlmm": createDlmmVenue({ connection, sdk: DLMM_SDK, ...(newKeypair ? { newKeypair } : {}) }),
    "meteora-damm2": createDammV2Venue({ connection, ...(newKeypair ? { newKeypair } : {}) }),
  };
}
