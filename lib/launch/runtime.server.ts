/**
 * What every Launch route needs: the network Launch runs on here, its
 * connection, the store, Ryntra's pool payer, the public origin, and the
 * routes' own limits. Absent a network — every production deployment until
 * Launch opens to people — the routes answer `LAUNCH_UNAVAILABLE`.
 */

import type { LaunchPresetsResponse } from "../api/v1/contract.ts";
import { CREATOR_LOCK_IDS, CREATOR_LOCK_SCHEDULES } from "../core/launch/creator-lock.ts";
import { LAUNCH_PRESET_IDS, LAUNCH_PRESETS } from "../core/venues/meteora-dbc/presets.ts";
import { getGuardRuntime } from "../guard/runtime.ts";
import { FixedWindowLimiter, clientIp } from "../http-control.ts";
import { LAUNCHES_PER_CREATOR_PER_DAY, launchConnection, launchNetwork, launchPoolPayer, type LaunchNetwork } from "./config.server.ts";
import type { LaunchDeps } from "./flow.server.ts";
import { DESCRIPTION_MAX, IMAGE_MAX_BYTES, IMAGE_TYPES, NAME_MAX, SYMBOL_MAX } from "./form.ts";

export function launchDeps(): LaunchDeps | null {
  const network = launchNetwork();
  const poolPayer = launchPoolPayer();
  if (!network || !poolPayer) return null;
  return { network, connection: launchConnection(network), store: getGuardRuntime().store, poolPayer, origin: network.origin, now: () => new Date() };
}

/** What reading a launch's market and trading on it need — no key of Ryntra's: the person's wallet signs and pays. */
export function launchMarketDeps(): Pick<LaunchDeps, "network" | "connection" | "store" | "now"> | null {
  const network = launchNetwork();
  if (!network) return null;
  return { network, connection: launchConnection(network), store: getGuardRuntime().store, now: () => new Date() };
}

/** The presets this network has configs for, with the numbers the form shows. */
export function launchPresetsView(network: LaunchNetwork): LaunchPresetsResponse {
  return {
    network: network.chain,
    presets: LAUNCH_PRESET_IDS.filter((id) => network.configs[id]).map((id) => {
      const preset = LAUNCH_PRESETS[id];
      const pair = network.pairs[id];
      return {
        id,
        name: { uk: preset.name.uk, en: preset.name.en },
        pair: { mint: pair.mint, symbol: pair.symbol, decimals: pair.decimals },
        startMarketCapUsd: preset.curve.startMarketCapUsd,
        graduationMarketCapUsd: preset.curve.graduationMarketCapUsd,
        sniperFee: { startBps: preset.sniperFee.startBps, endBps: preset.sniperFee.endBps, seconds: preset.sniperFee.seconds },
        creatorTradingFeePct: preset.creatorTradingFeePct,
        graduationFee: { pct: preset.graduationFee.pct, creatorPct: preset.graduationFee.creatorPct },
        firstBuyCapBps: preset.creatorFirstBuyCapBps,
        lpLockedForeverPct: 100,
      };
    }),
    locks: CREATOR_LOCK_IDS.map((id) => ({ id, cliffDays: CREATOR_LOCK_SCHEDULES[id].cliffDays, vestDays: CREATOR_LOCK_SCHEDULES[id].vestDays })),
    limits: { nameMax: NAME_MAX, symbolMax: SYMBOL_MAX, descriptionMax: DESCRIPTION_MAX, imageMaxBytes: IMAGE_MAX_BYTES, imageTypes: [...IMAGE_TYPES], launchesPerDay: LAUNCHES_PER_CREATOR_PER_DAY },
  };
}

/*
 * Each route has its own window per address: a picture stored, a launch built, a launch sent; a trade quoted (the page
 * asks again as the amount is typed), a trade built, a trade sent; a creator's cabinet read, a claim built, a claim sent.
 */
const LIMITERS = {
  metadata: new FixedWindowLimiter({ limit: 20, windowMs: 60 * 60 * 1000, maxKeys: 5_000 }),
  build: new FixedWindowLimiter({ limit: 30, windowMs: 60 * 60 * 1000, maxKeys: 5_000 }),
  submit: new FixedWindowLimiter({ limit: 20, windowMs: 60 * 60 * 1000, maxKeys: 5_000 }),
  tradeQuote: new FixedWindowLimiter({ limit: 600, windowMs: 60 * 60 * 1000, maxKeys: 5_000 }),
  tradeBuild: new FixedWindowLimiter({ limit: 120, windowMs: 60 * 60 * 1000, maxKeys: 5_000 }),
  tradeSubmit: new FixedWindowLimiter({ limit: 120, windowMs: 60 * 60 * 1000, maxKeys: 5_000 }),
  claimBuild: new FixedWindowLimiter({ limit: 60, windowMs: 60 * 60 * 1000, maxKeys: 5_000 }),
  claimSubmit: new FixedWindowLimiter({ limit: 30, windowMs: 60 * 60 * 1000, maxKeys: 5_000 }),
  cabinet: new FixedWindowLimiter({ limit: 240, windowMs: 60 * 60 * 1000, maxKeys: 5_000 }),
} as const;

export function consumeLaunchWrite(kind: keyof typeof LIMITERS, headers: Headers) {
  return LIMITERS[kind].consume(`launch-${kind}:${clientIp(headers)}`);
}

/** A refusal of the flow in the contract's codes. */
export const LAUNCH_FAILURE_CODES = {
  METADATA_NOT_FOUND: "LAUNCH_NOT_FOUND",
  NAME_BORROWED: "LAUNCH_NAME_BORROWED",
  CREATOR_LIMIT: "LAUNCH_LIMIT",
  PAYER_LOW: "LAUNCH_PAUSED",
  PRESET_UNAVAILABLE: "VALIDATION_ERROR",
  FIRST_BUY_ABOVE_CAP: "LAUNCH_FIRST_BUY_ABOVE_CAP",
  LOCK_NEEDS_PURCHASE: "VALIDATION_ERROR",
  SHARES_INVALID: "LAUNCH_SHARES_INVALID",
  NOT_BUILT: "LAUNCH_NOT_FOUND",
  BUILD_EXPIRED: "LAUNCH_BUILD_EXPIRED",
  BUILD_USED: "LAUNCH_BUILD_USED",
  WRONG_CREATOR: "WALLET_MISMATCH",
  SIGNED_OTHER_BYTES: "LAUNCH_SIGNED_OTHER_BYTES",
  SIGNATURE_MISSING: "LAUNCH_SIGNED_OTHER_BYTES",
  SUBMIT_FAILED: "LAUNCH_SUBMIT_FAILED",
  BUILD_FAILED: "UNAVAILABLE",
} as const satisfies Record<import("./flow.server.ts").LaunchFailureCode, import("../api/v1/contract.ts").ApiErrorCode>;
