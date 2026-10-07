/**
 * What every Launch route needs: the network Launch runs on here, its
 * connection, the store, Ryntra's pool payer, the public origin, and the
 * routes' own limits. Absent a network — a devnet stand without its origin —
 * the routes answer `LAUNCH_UNAVAILABLE`; with the Launch lane's operator stop
 * closed, or no pool payer for a launch, whatever builds or sends answers
 * `LAUNCH_PAUSED` and the reads go on.
 */

import type { Connection } from "@solana/web3.js";

import type { LaunchPresetsResponse } from "../api/v1/contract.ts";
import { CREATOR_LOCK_IDS, CREATOR_LOCK_SCHEDULES } from "../core/launch/creator-lock.ts";
import { configsOfPreset } from "../core/venues/meteora-dbc/launch.server.ts";
import { LAUNCH_PRESET_IDS, LAUNCH_PRESETS } from "../core/venues/meteora-dbc/presets.ts";
import { getGuardRuntime } from "../guard/runtime.ts";
import { storeSupportsConcurrentInstances, withBoundedCasRetry, type GuardStore } from "../guard/store.ts";
import { FixedWindowLimiter, clientIp, type RateLimitDecision } from "../http-control.ts";
import { adoptLaunch } from "./adopt.server.ts";
import {
  LAUNCHES_PER_CREATOR_PER_DAY,
  launchArchiveConnection,
  launchConnection,
  launchHistoryConnection,
  launchNetwork,
  launchOpen,
  launchPair,
  launchPoolPayer,
  launchPoolPayerAddress,
  launchWritesHere,
  type LaunchNetwork,
} from "./config.server.ts";
import type { LaunchDeps, LaunchReadDeps } from "./flow.server.ts";
import { DESCRIPTION_MAX, IMAGE_MAX_BYTES, IMAGE_TYPES, NAME_MAX, SYMBOL_MAX } from "./form.ts";

/**
 * What building and sending a launch needs; null — paused — while the lane is closed, there is no pool payer, this
 * deployment does not write launches on its network (a mainnet preview or a local server), or its store is not one every
 * instance shares: a launch's metadata must outlive the request that stored it, wherever the mint is read from.
 */
export function launchDeps(): LaunchDeps | null {
  const network = launchNetwork();
  if (!network || !launchOpen() || !launchWritesHere(network)) return null;
  const store = getGuardRuntime().store;
  if (network.cluster === "mainnet" && !storeSupportsConcurrentInstances(store)) return null;
  const poolPayer = launchPoolPayer(process.env, network);
  if (!poolPayer) return null;
  return { network, connection: launchConnection(network), store, poolPayer, origin: network.origin, now: () => new Date(), second: launchArchiveConnection(network) };
}

/**
 * What reading a launch's record needs beyond the store and the main node: the second operator asked before a
 * signature is called absent, and adopting a launch the chain shows Ryntra's pool payer created when the store has no
 * record of it.
 */
export function launchReadHooks(network: LaunchNetwork, connection: Connection, store: GuardStore): Pick<LaunchReadDeps, "second" | "adopt"> {
  const second = launchArchiveConnection(network);
  const poolPayer = launchPoolPayerAddress(network);
  const adopt = poolPayer
    ? (token: string) => adoptLaunch({ network, connection, store, poolPayer, history: launchHistoryConnection(network), archive: second, now: () => new Date() }, token)
    : null;
  return { second, adopt };
}

/** What reading a launch's market needs — no key of Ryntra's, and no switch: a token's page reads while the lane is paused. */
export function launchMarketDeps(): (Pick<LaunchDeps, "network" | "connection" | "store" | "now"> & Pick<LaunchReadDeps, "second" | "adopt">) | null {
  const network = launchNetwork();
  if (!network) return null;
  const connection = launchConnection(network);
  const store = getGuardRuntime().store;
  return { network, connection, store, now: () => new Date(), ...launchReadHooks(network, connection, store) };
}

/** What reading a launch's page needs: the pool payer's address its receipt asks for, never its key. */
export function launchViewDeps(): (Omit<LaunchDeps, "poolPayer"> & Readonly<{ poolPayer: string }> & Pick<LaunchReadDeps, "adopt">) | null {
  const network = launchNetwork();
  const poolPayer = network ? launchPoolPayerAddress(network) : null;
  if (!network || !poolPayer) return null;
  const connection = launchConnection(network);
  const store = getGuardRuntime().store;
  return { network, connection, store, poolPayer, origin: network.origin, now: () => new Date(), ...launchReadHooks(network, connection, store) };
}

/** What building and sending a trade or a claim needs: the market's, while the lane is open — the person's wallet signs and pays. */
export function launchTradingDeps(): ReturnType<typeof launchMarketDeps> {
  return launchOpen() ? launchMarketDeps() : null;
}

/** Whether a launch can be built here now — exactly when `launchDeps` would answer. The form says so before it is filled. */
export function launchAccepting(network: LaunchNetwork): boolean {
  return launchDeps()?.network.cluster === network.cluster;
}

/** Whether trades and claims can be built here now — the lane open. Their panels say so before a press. */
export function launchTrading(): boolean {
  return launchOpen();
}

/** The presets this network has configs for, with the numbers the form shows. */
export function launchPresetsView(network: LaunchNetwork): LaunchPresetsResponse {
  return {
    network: network.chain,
    presets: LAUNCH_PRESET_IDS.filter((id) => configsOfPreset(network.configs, id).length > 0 && network.pairs[id]).map((id) => {
      const preset = LAUNCH_PRESETS[id];
      const pair = launchPair(network, id);
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
  /* A holder's position in the pool: its quote as the amount is typed, an entry or a permission built, one sent. */
  holderQuote: new FixedWindowLimiter({ limit: 600, windowMs: 60 * 60 * 1000, maxKeys: 5_000 }),
  holderBuild: new FixedWindowLimiter({ limit: 60, windowMs: 60 * 60 * 1000, maxKeys: 5_000 }),
  holderSubmit: new FixedWindowLimiter({ limit: 30, windowMs: 60 * 60 * 1000, maxKeys: 5_000 }),
} as const;

export function consumeLaunchWrite(kind: keyof typeof LIMITERS, headers: Headers) {
  return LIMITERS[kind].consume(`launch-${kind}:${limitSubject(clientIp(headers))}`);
}

type SharedWindow = Readonly<{ version: number; kind: string; ip: string; windowStart: number; count: number }>;

/**
 * Whose window a request counts in: an IPv4 address as it is, an IPv6 address by its /64 — one household or one machine
 * holds a whole /64, and a key per /128 would let it take a window per address.
 */
export function limitSubject(ip: string): string {
  /* An IPv4 address carried in IPv6 is the IPv4 address: its own window, not one shared by every such address. */
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (mapped) return mapped[1]!;
  if (!ip.includes(":")) return ip;
  const [head = "", tail = ""] = ip.toLowerCase().split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups = ip.includes("::") ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right] : left;
  return `${groups.slice(0, 4).map((group) => group.replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

/* When this instance last removed every address's windows older than the current one, per route. */
const SWEPT = new Map<string, number>();

/**
 * The same windows, shared by every instance: one count per route, address and window in the store, raised with
 * compare-and-set. Each instance's own window is asked first and costs nothing; a store that does not answer leaves
 * that one in force rather than refusing everybody. Older windows of the address are removed as it writes.
 */
export async function consumeSharedLaunchWrite(kind: keyof typeof LIMITERS, headers: Headers, store: GuardStore = getGuardRuntime().store, now: number = Date.now()): Promise<RateLimitDecision> {
  const local = consumeLaunchWrite(kind, headers);
  if (!local.allowed) return local;
  const limiter = LIMITERS[kind];
  const ip = limitSubject(clientIp(headers));
  const windowStart = Math.floor(now / limiter.windowMs) * limiter.windowMs;
  const resetAfterSeconds = Math.max(1, Math.ceil((windowStart + limiter.windowMs - now) / 1000));
  const windows = store.versioned<SharedWindow>("launchLimits");
  const key = `${kind}:${ip}:${windowStart}`;
  try {
    const count = await withBoundedCasRetry(async () => {
      const current = await windows.get(key);
      if (current && current.count >= limiter.limit) return current.count + 1;
      const next: SharedWindow = { version: (current?.version ?? -1) + 1, kind, ip, windowStart, count: (current?.count ?? 0) + 1 };
      return (await windows.compareAndSet(key, current ? current.version : null, next)) ? next.count : false;
    });
    /* Once a window per route and instance, every address's older windows go: the collection holds the current windows only. */
    if (SWEPT.get(kind) !== windowStart) {
      SWEPT.set(kind, windowStart);
      for (const old of await windows.valuesWithPrefix(`${kind}:`)) if (old.kind === kind && old.windowStart < windowStart) await windows.delete(`${kind}:${old.ip}:${old.windowStart}`);
    }
    const allowed = count <= limiter.limit;
    return { allowed, limit: limiter.limit, remaining: Math.max(0, limiter.limit - count), resetAfterSeconds, retryAfterSeconds: allowed ? 0 : resetAfterSeconds };
  } catch {
    return local;
  }
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
