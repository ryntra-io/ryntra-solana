/**
 * What the pools pages read from the chain itself, where ownership and the
 * price live: which venue a pool address belongs to (the account's owning
 * program), the pool's state through the venue adapters, a DLMM pool's bins
 * around the price, and the positions a wallet holds on both venues. Each read
 * carries its slot and time; a public endpoint's refusal ends the read with a
 * reason, never with a guess.
 */

import "server-only";

import { Connection, PublicKey } from "@solana/web3.js";

import { resolveEndpoint, resolveEndpoints } from "@/lib/solana/rpc";

import type { LiquidityPool as ChainPool, LiquidityPosition, LiquidityVenueAdapter, LiquidityVenueId } from "../studio/contract.ts";
import { DLMM_SDK, liquidityVenues } from "../studio/venues.server.ts";
import type { LiquidityPoolKind } from "./model.ts";

let cached: { url: string; connection: Connection } | null = null;

/** One connection per process to the configured mainnet endpoint; a rate limit is answered at once, not waited out. */
export function poolsConnection(): Connection {
  const url = resolveEndpoint("mainnet");
  if (!cached || cached.url !== url) cached = { url, connection: new Connection(url, { commitment: "confirmed", disableRetryOnRateLimit: true }) };
  return cached.connection;
}

/** Solana's own public endpoint: it answers the owner-indexed reads the default public operator refuses. */
export const SOLANA_PUBLIC_RPC = "https://api.mainnet-beta.solana.com";
/* The default public operator refuses `getProgramAccounts` and `getTokenAccountsByOwner` without a personal token (410 and
   -32602, 2026-10-16); its second operator and Solana's own endpoint answer both. */
const REFUSES_INDEXED = new Set(["solana-rpc.publicnode.com"]);

const indexed = new Map<string, Connection>();
/** The endpoints a wallet's positions are read from, in order: a configured one first, then public ones that answer owner-indexed reads. */
export function positionsConnections(): readonly Connection[] {
  const urls = [...resolveEndpoints("mainnet").filter((endpoint) => endpoint.fromEnv || !REFUSES_INDEXED.has(endpoint.host)).map((endpoint) => endpoint.url), SOLANA_PUBLIC_RPC];
  return [...new Set(urls)].map((url) => {
    const known = indexed.get(url) ?? new Connection(url, { commitment: "confirmed", disableRetryOnRateLimit: true });
    indexed.set(url, known);
    return known;
  });
}

let venues: { connection: Connection; byId: Readonly<Record<LiquidityVenueId, LiquidityVenueAdapter>> } | null = null;
function venuesFor(connection: Connection): Readonly<Record<LiquidityVenueId, LiquidityVenueAdapter>> {
  if (!venues || venues.connection !== connection) venues = { connection, byId: liquidityVenues(connection) };
  return venues.byId;
}

const byEndpoint = new Map<Connection, Readonly<Record<LiquidityVenueId, LiquidityVenueAdapter>>>();
function positionVenues(connection: Connection): Readonly<Record<LiquidityVenueId, LiquidityVenueAdapter>> {
  const known = byEndpoint.get(connection) ?? liquidityVenues(connection);
  byEndpoint.set(connection, known);
  return known;
}

export const VENUE_OF_KIND: Readonly<Record<LiquidityPoolKind, LiquidityVenueId>> = { dlmm: "meteora-dlmm", "damm-v2": "meteora-damm2" };
export const KIND_OF_VENUE: Readonly<Record<LiquidityVenueId, LiquidityPoolKind>> = { "meteora-dlmm": "dlmm", "meteora-damm2": "damm-v2" };

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} did not answer within ${ms} ms.`)), ms);
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

export type ChainRead<T> = Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; reason: string }>;

const failed = (error: unknown): Readonly<{ ok: false; reason: string }> => ({ ok: false, reason: error instanceof Error ? error.message : String(error) });

/**
 * The first eight bytes of a pool account: Anchor's discriminator, `sha256("account:<Name>")`. A program owns positions,
 * bin arrays and configs too; only these accounts are pools (checked against live pools on 2026-10-16).
 */
const POOL_DISCRIMINATOR: Readonly<Record<LiquidityPoolKind, readonly number[]>> = {
  dlmm: [33, 11, 49, 98, 181, 101, 177, 13],
  "damm-v2": [241, 154, 109, 4, 17, 177, 109, 188],
};

/** Which venue the address is a pool of: the program that owns the account and the account's own kind; null — not a pool. */
export async function poolKindOf(address: string, connection = poolsConnection()): Promise<ChainRead<LiquidityPoolKind | null>> {
  try {
    const info = await withTimeout(connection.getAccountInfo(new PublicKey(address), { commitment: "confirmed", dataSlice: { offset: 0, length: 8 } }), 8_000, "Solana");
    if (!info) return { ok: true, value: null };
    const byId = venuesFor(connection);
    for (const venue of Object.values(byId)) {
      if (info.owner.toBase58() !== venue.program) continue;
      const kind = KIND_OF_VENUE[venue.id];
      const head = [...info.data.subarray(0, 8)];
      return { ok: true, value: POOL_DISCRIMINATOR[kind].every((byte, i) => head[i] === byte) ? kind : null };
    }
    return { ok: true, value: null };
  } catch (error) {
    return failed(error);
  }
}

const pools = new Map<string, Readonly<{ at: number; read: ChainRead<ChainPool> }>>();
const POOL_TTL_MS = 20_000;

/** The pool as its program holds it now: price, bins or range, fee schedule, reserves. */
export async function readChainPool(kind: LiquidityPoolKind, address: string, connection = poolsConnection()): Promise<ChainRead<ChainPool>> {
  const key = `${kind}:${address}`;
  const hit = pools.get(key);
  if (hit && Date.now() - hit.at < POOL_TTL_MS) return hit.read;
  let read: ChainRead<ChainPool>;
  try {
    read = { ok: true, value: await withTimeout(venuesFor(connection)[VENUE_OF_KIND[kind]].pool(address), 12_000, "Solana") };
  } catch (error) {
    read = failed(error);
  }
  if (pools.size > 256) pools.delete(pools.keys().next().value!);
  pools.set(key, { at: Date.now(), read });
  return read;
}

/** One bin as a chart draws it: its price and what it holds, in the tokens' own units. */
export type BinRow = Readonly<{ binId: number; price: number; x: number; y: number }>;
export type BinsRead = Readonly<{ activeBin: number; bins: readonly BinRow[]; slot: number | null; at: number }>;

const bins = new Map<string, Readonly<{ at: number; read: ChainRead<BinsRead> }>>();
export const BINS_AROUND = 35;

const human = (units: { toString(): string }, decimals: number): number => Number(units.toString()) / 10 ** decimals;

/** A DLMM pool's bins around the price — where the liquidity sits. */
export async function readDlmmBins(address: string, connection = poolsConnection()): Promise<ChainRead<BinsRead>> {
  const hit = bins.get(address);
  if (hit && Date.now() - hit.at < POOL_TTL_MS) return hit.read;
  let read: ChainRead<BinsRead>;
  try {
    read = await withTimeout(
      (async (): Promise<ChainRead<BinsRead>> => {
        const pair = await DLMM_SDK.DLMM.create(connection, new PublicKey(address), { cluster: "mainnet-beta" });
        const [around, slot] = await Promise.all([pair.getBinsAroundActiveBin(BINS_AROUND, BINS_AROUND), connection.getSlot("confirmed").catch(() => null)]);
        const dx = pair.tokenX.mint.decimals;
        const dy = pair.tokenY.mint.decimals;
        return {
          ok: true,
          value: {
            activeBin: around.activeBin,
            bins: around.bins.map((bin) => ({ binId: bin.binId, price: Number(bin.pricePerToken), x: human(bin.xAmount, dx), y: human(bin.yAmount, dy) })),
            slot,
            at: Date.now(),
          },
        };
      })(),
      15_000,
      "Solana",
    );
  } catch (error) {
    read = failed(error);
  }
  if (bins.size > 128) bins.delete(bins.keys().next().value!);
  bins.set(address, { at: Date.now(), read });
  return read;
}

export type PositionsRead = Readonly<Record<LiquidityPoolKind, ChainRead<readonly LiquidityPosition[]>>>;

/** One endpoint's turn, and the whole read's: a hung endpoint gives way to the next, and the answer leaves in time for the route. */
const ENDPOINT_MS = 8_000;
const POSITIONS_DEADLINE_MS = 20_000;
/** A wallet's positions kept briefly, so a page's two blocks and a reload cost one scan. */
const POSITIONS_TTL_MS = 25_000;
const walletReads = new Map<string, Readonly<{ at: number; read: PositionsRead }>>();
const walletInflight = new Map<string, Promise<PositionsRead>>();

/**
 * Every position the wallet holds on both venues, read from the programs' accounts; one venue's failure leaves the
 * other's. An endpoint that refuses is followed by the next one — the same read again, never a different answer.
 */
/** A whole answer for this wallet is still fresh: a view served from it costs no scan, and the route charges nothing for it. */
export function hasFreshPositions(owner: string): boolean {
  const hit = walletReads.get(owner);
  return Boolean(hit && Date.now() - hit.at < POSITIONS_TTL_MS);
}

/** After the wallet acted on a pool: its kept answer no longer holds, and the next view reads the chain. */
export function forgetWalletPositions(owner: string): void {
  walletReads.delete(owner);
  /* A read already on its way began before the action: it is answered, but neither kept nor shared. */
  walletInflight.delete(owner);
}

export function readWalletPositions(owner: string, connections = positionsConnections()): Promise<PositionsRead> {
  const hit = walletReads.get(owner);
  if (hit && Date.now() - hit.at < POSITIONS_TTL_MS) return Promise.resolve(hit.read);
  const pending = walletInflight.get(owner);
  if (pending) return pending;
  const deadline = Date.now() + POSITIONS_DEADLINE_MS;
  const read = async (kind: LiquidityPoolKind): Promise<ChainRead<readonly LiquidityPosition[]>> => {
    let last: ChainRead<readonly LiquidityPosition[]> = { ok: false, reason: "No endpoint to read from." };
    for (const connection of connections) {
      const left = Math.min(ENDPOINT_MS, deadline - Date.now());
      if (left <= 500) break;
      try {
        return { ok: true, value: await withTimeout(positionVenues(connection)[VENUE_OF_KIND[kind]].positions(owner), left, "Solana") };
      } catch (error) {
        last = failed(error);
      }
    }
    return last;
  };
  /* The read's own promise, set before its first answer arrives: the test of whether it is still the wallet's read out. */
  let promise: Promise<PositionsRead> | null = null;
  promise = (async (): Promise<PositionsRead> => {
    const [dlmm, damm] = await Promise.all([read("dlmm"), read("damm-v2")]);
    const result: PositionsRead = { dlmm: dlmm!, "damm-v2": damm! };
    /*
     * Only a whole answer is kept, and only while it is still the wallet's read out: an action since (`forgetWalletPositions`)
     * took it off, so a read that began before the action is answered but never kept. A venue that failed is asked again.
     */
    if (result.dlmm.ok && result["damm-v2"].ok && walletInflight.get(owner) === promise) {
      if (walletReads.size > 512) walletReads.delete(walletReads.keys().next().value!);
      walletReads.set(owner, { at: Date.now(), read: result });
    }
    return result;
  })().finally(() => {
    if (walletInflight.get(owner) === promise) walletInflight.delete(owner);
  });
  walletInflight.set(owner, promise);
  return promise;
}
