/**
 * What prepared actions need on this deployment (CITY-161), or why they are not served.
 *
 * `RYNTRA_INTENTS`:
 * - `open` — the Postgres table in
 *   the engine's Postgres store; a receipt is checked on mainnet: landed after the
 *   intent was made, paid by the confirming wallet, spending the intent's amount of what leaves and bringing what
 *   arrives (`movesFit`). Until the migration runs, every route answers CAPABILITY_UNAVAILABLE.
 * - `memory` — a local stand: per-process memory, only where one instance serves (never behind several, where an
 *   intent made on one would be unknown to the next); a receipt is recorded `UNCHECKED`.
 * - anything else, or unset — closed: every intent route answers CAPABILITY_UNAVAILABLE and `/i/<id>` is the city.
 *
 * `RYNTRA_INTENTS_TRANSFER=open` lets outside clients prepare a transfer to another address. Phase 1 keeps it closed
 * (the engineering review of 31.10, M1): only swaps, whose coins land in the signing wallet itself.
 *
 * Server only.
 */

import { randomBytes } from "node:crypto";

import { resolveGuardDeployment, resolveGuardStoreConfig } from "../guard/runtime-config.ts";
import { createSolanaRpcHandle, withRpcDiscipline } from "../solana/rpc.ts";
import type { ChainRead, IntentDeps } from "./service.ts";
import { readSignedBy } from "./signed.ts";
import { MemoryIntentStore, type IntentStore } from "./store.ts";
import { createPostgresIntentStore } from "./store-postgres.server.ts";

export type IntentsMode = "open" | "memory" | "closed";

export function intentsMode(env: Readonly<Record<string, string | undefined>> = process.env): IntentsMode {
  const value = env.RYNTRA_INTENTS?.trim().toLowerCase();
  return value === "open" ? "open" : value === "memory" ? "memory" : "closed";
}

export type IntentsServed = Readonly<{ served: true; mode: "open" | "memory"; deps: IntentDeps }> | Readonly<{ served: false; reason: "CLOSED" | "NO_STORE" }>;

/* One store per process. On `globalThis` because a stand's dev server may load this module more than once (a route
   and a page), and an intent made through one must be the one the other reads. */
type Cached = { key: string; store: IntentStore };
const MEMORY_SHAPE = 3;
const SLOT = Symbol.for("ryntra.intents.store");
const holder = globalThis as unknown as Record<symbol, Cached | undefined>;

function storeFor(mode: "open" | "memory", env: Readonly<Record<string, string | undefined>>): IntentStore | null {
  let key: string;
  let make: () => IntentStore;
  if (mode === "memory") {
    let shape;
    try {
      shape = resolveGuardDeployment(env);
    } catch {
      return null;
    }
    if (shape !== "SINGLE_INSTANCE") return null;
    // The shape of the record is part of the key: a stand's dev server that reloads this code never keeps a store
    // of the older shape.
    key = `memory:${MEMORY_SHAPE}`;
    make = () => new MemoryIntentStore();
  } else {
    let config;
    try {
      config = resolveGuardStoreConfig(env);
    } catch {
      return null;
    }
    if (config.kind !== "postgres") return null;
    const connectionString = config.connectionString;
    key = `postgres:${connectionString}`;
    make = () => createPostgresIntentStore({ connectionString });
  }
  const cached = holder[SLOT];
  if (cached?.key === key) return cached.store;
  const store = make();
  holder[SLOT] = { key, store };
  return store;
}

type TokenRow = Readonly<{ owner?: unknown; mint?: unknown; uiTokenAmount?: Readonly<{ amount?: unknown }> }>;

/** The raw token balances one owner holds in a transaction's balance rows, summed by mint. */
function byMint(rows: readonly TokenRow[] | undefined, owner: string): Map<string, bigint> {
  const out = new Map<string, bigint>();
  for (const row of rows ?? []) {
    const amount = row.uiTokenAmount?.amount;
    if (row.owner !== owner || typeof row.mint !== "string" || typeof amount !== "string" || !/^\d+$/.test(amount)) continue;
    out.set(row.mint, (out.get(row.mint) ?? 0n) + BigInt(amount));
  }
  return out;
}

const big = (value: unknown): bigint | null => (typeof value === "bigint" ? value : typeof value === "number" && Number.isSafeInteger(value) ? BigInt(value) : null);

/**
 * A landed transaction on mainnet, read at `confirmed`: who paid, whether it failed, when, and what it did to the payer
 * — its lamports and its tokens by mint. Never throws.
 */
async function readOnChain(signature: string): Promise<ChainRead> {
  const handle = createSolanaRpcHandle({ network: "mainnet", timeoutMs: 4_000, retries: 1 });
  let response: unknown;
  try {
    response = await withRpcDiscipline(handle, (abortSignal) =>
      handle.rpc.getTransaction(signature as never, { encoding: "json", commitment: "confirmed", maxSupportedTransactionVersion: 0 }).send({ abortSignal }),
    );
  } catch {
    return { state: "UNREADABLE" };
  }
  if (response === null || response === undefined) return { state: "UNSEEN" };
  const value = response as {
    blockTime?: unknown;
    meta?: { err?: unknown; fee?: unknown; preBalances?: readonly unknown[]; postBalances?: readonly unknown[]; preTokenBalances?: readonly TokenRow[]; postTokenBalances?: readonly TokenRow[] } | null;
    transaction?: { message?: { accountKeys?: readonly unknown[] } };
  };
  const first = value.transaction?.message?.accountKeys?.[0];
  const feePayer = typeof first === "string" ? first : first && typeof first === "object" && "pubkey" in first ? String((first as { pubkey: unknown }).pubkey) : null;
  const meta = value.meta;
  const pre = big(meta?.preBalances?.[0]);
  const post = big(meta?.postBalances?.[0]);
  const fee = big(meta?.fee);
  if (!feePayer || !meta || pre === null || post === null || fee === null) return { state: "UNREADABLE" };
  const before = byMint(meta.preTokenBalances, feePayer);
  const after = byMint(meta.postTokenBalances, feePayer);
  const tokens = new Map<string, { pre: bigint; post: bigint }>();
  for (const mint of new Set([...before.keys(), ...after.keys()])) tokens.set(mint, { pre: before.get(mint) ?? 0n, post: after.get(mint) ?? 0n });
  const blockTime = big(value.blockTime);
  return {
    state: "LANDED",
    feePayer,
    failed: meta.err !== null && meta.err !== undefined,
    blockTime: blockTime === null ? null : Number(blockTime),
    moves: { lamports: { pre, post, fee }, tokens },
  };
}

/** Whether outside clients may prepare a transfer to another address: only where the owner opened it. */
export function intentTransfersOpen(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return env.RYNTRA_INTENTS_TRANSFER?.trim().toLowerCase() === "open";
}

export function intentsServed(env: Readonly<Record<string, string | undefined>> = process.env): IntentsServed {
  const mode = intentsMode(env);
  if (mode === "closed") return { served: false, reason: "CLOSED" };
  const store = storeFor(mode, env);
  if (!store) return { served: false, reason: "NO_STORE" };
  return {
    served: true,
    mode,
    deps: {
      store,
      now: () => new Date(),
      newId: () => randomBytes(16).toString("base64url"),
      newKey: () => randomBytes(24).toString("base64url"),
      chain: mode === "open" ? readOnChain : null,
      transfers: intentTransfersOpen(env),
      readSigned: readSignedBy,
    },
  };
}
