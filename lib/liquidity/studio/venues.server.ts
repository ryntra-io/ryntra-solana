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

import DLMM, {
  createProgram,
  ClockLayout,
  DEFAULT_BIN_PER_POSITION,
  deriveBinArrayBitmapExtension,
  deriveEventAuthority,
  deriveOracle,
  getBinArraysRequiredByPositionRange,
  getPriceOfBinByBinId,
  isSupportLimitOrder,
  limitOrderFilter,
  limitOrderOwnerFilter,
  wrapPosition,
} from "@meteora-ag/dlmm";
import { AMOUNT_IN_DLMM_OFFSET, createDlmmSwapPayload, estimateDlmmDirectSwap, Zap } from "@meteora-ag/zap-sdk-v2";
import type { Connection, Keypair } from "@solana/web3.js";

import type { LiquidityVenueAdapter, LiquidityVenueId } from "./contract.ts";
import { createDammV2Venue } from "./damm-v2.ts";
import { createDlmmVenue, type DlmmSdk } from "./dlmm.ts";
import { createLimitVenue, type DlmmLimitSdk, type LimitVenue } from "./limit-orders.ts";
import { createZapVenue, type ZapDlmmSdk, type ZapSdk, type ZapVenue } from "./zap.ts";

export const DLMM_SDK: DlmmSdk = { DLMM, createProgram, ClockLayout, DEFAULT_BIN_PER_POSITION, getPriceOfBinByBinId, wrapPosition };
export const DLMM_LIMIT_SDK: DlmmLimitSdk = { DLMM, createProgram, getPriceOfBinByBinId, isSupportLimitOrder, limitOrderFilter, limitOrderOwnerFilter };

export const ZAP_SDK: ZapSdk = { Zap, estimateDlmmDirectSwap, createDlmmSwapPayload, AMOUNT_IN_DLMM_OFFSET };
export const ZAP_DLMM_SDK: ZapDlmmSdk = { ...DLMM_SDK, getBinArraysRequiredByPositionRange, deriveOracle, deriveEventAuthority, deriveBinArrayBitmapExtension };

/** The Zap (CITY-198) on the caller's connection, asking Jupiter with the server's key; `newKeypair` as for the venues. */
export function zapVenue(connection: Connection, jupiter: Readonly<{ apiUrl: string; apiKey: string }> | null, newKeypair?: () => Keypair): ZapVenue {
  return createZapVenue({ connection, sdk: ZAP_SDK, dlmm: ZAP_DLMM_SDK, jupiter, ...(newKeypair ? { newKeypair } : {}) });
}

/** DLMM's limit orders on the caller's connection (CITY-97); `newKeypair` as for the venues. */
export function limitVenue(connection: Connection, newKeypair?: () => Keypair): LimitVenue {
  return createLimitVenue({ connection, sdk: DLMM_LIMIT_SDK, ...(newKeypair ? { newKeypair } : {}) });
}

/** `newKeypair`: where a build gets the fresh key of a new position (or its NFT) — the actions keep it for the relay. */
export function liquidityVenues(connection: Connection, newKeypair?: () => Keypair): Readonly<Record<LiquidityVenueId, LiquidityVenueAdapter>> {
  return {
    "meteora-dlmm": createDlmmVenue({ connection, sdk: DLMM_SDK, ...(newKeypair ? { newKeypair } : {}) }),
    "meteora-damm2": createDammV2Venue({ connection, ...(newKeypair ? { newKeypair } : {}) }),
  };
}
