/**
 * The reader behind `GET /api/v1/earn/pools/bins`: a Meteora DLMM pool's bins around its active bin
 * (`./dlmm-bins.ts`), read from the configured mainnet endpoint and kept twenty seconds for every visitor. A pool that
 * could not be read is said as failed, never drawn as an empty one; a failed read is asked again after five seconds.
 *
 * Read-only: nothing here builds, signs or moves anything, and nothing throws.
 */

import "server-only";

import { getBinArrayLowerUpperBinId, getBinArraysRequiredByPositionRange2 } from "@meteora-ag/dlmm";
import { PublicKey, type Connection } from "@solana/web3.js";
import BN from "bn.js";

import { poolKindOf, poolsConnection } from "../liquidity/catalog/chain.server.ts";
import { DLMM_PROGRAM } from "../liquidity/studio/dlmm.ts";
import { DLMM_SDK } from "../liquidity/studio/venues.server.ts";
import { EARN_BINS_HALF } from "./bins.ts";
import { readDlmmBinsAnswer, withTimeout, type BinsRead, type DlmmBinsDeps, type DlmmPairLike } from "./dlmm-bins.ts";
import { jupiterUsd } from "./market-price.ts";

export const BINS_TTL_MS = 20_000;
/** A failed read is asked again this soon, so a pool that does not exist costs one read a while. */
const BINS_NEGATIVE_TTL_MS = 5_000;
const BINS_KEPT = 128;
const READ_DEADLINE_MS = 15_000;

/** What the program's two accounts cost to keep: their sizes are the program's own, the rent the network's — both read once an hour. */
const RENT_TTL_MS = 60 * 60 * 1000;
let rentKept: Readonly<{ connection: Connection; at: number; lamports: Partial<Record<"positionV2" | "binArray", bigint>>; sizes: Readonly<Record<"positionV2" | "binArray", number>> }> | null = null;

function liveDeps(connection: Connection): DlmmBinsDeps {
  return {
    open: async (pool) => {
      try {
        return (await DLMM_SDK.DLMM.create(connection, pool, { cluster: "mainnet-beta" })) as unknown as DlmmPairLike;
      } catch (error) {
        /* Nothing there, another program's account, or an account of DLMM's that is no pool (a position, a ledger). */
        const kind = await poolKindOf(pool.toBase58(), connection);
        if (kind.ok && kind.value !== "dlmm") return null;
        throw error;
      }
    },
    ledgers: (pool, lower, upper) =>
      getBinArraysRequiredByPositionRange2(pool, new BN(lower), new BN(upper), new PublicKey(DLMM_PROGRAM)).map((entry) => {
        const [from, to] = getBinArrayLowerUpperBinId(entry.index);
        return { key: entry.key, lower: from!.toNumber(), upper: to!.toNumber() };
      }),
    exist: async (keys) => (keys.length ? (await connection.getMultipleAccountsInfo([...keys], "confirmed")).map((info) => info !== null) : []),
    rentOf: async (account) => {
      if (!rentKept || rentKept.connection !== connection || Date.now() - rentKept.at > RENT_TTL_MS) {
        const program = DLMM_SDK.createProgram(connection, { cluster: "mainnet-beta" });
        rentKept = { connection, at: Date.now(), lamports: {}, sizes: { positionV2: program.account.positionV2.size, binArray: program.account.binArray.size } };
      }
      const known = rentKept.lamports[account];
      if (known !== undefined) return known;
      const lamports = BigInt(await connection.getMinimumBalanceForRentExemption(rentKept.sizes[account], "confirmed"));
      rentKept = { ...rentKept, lamports: { ...rentKept.lamports, [account]: lamports } };
      return lamports;
    },
    market: (mints) => jupiterUsd(mints),
  };
}

const kept = new Map<string, Readonly<{ until: number; read: BinsRead }>>();
const inflight = new Map<string, Promise<BinsRead>>();

/** A DLMM pool's bins around the price, kept briefly; one read at a time per pool and width. Never throws. */
export function readDlmmBins(address: string, half: number = EARN_BINS_HALF, given: Readonly<{ deps?: DlmmBinsDeps; now?: () => number }> = {}): Promise<BinsRead> {
  const now = given.now ?? Date.now;
  const key = `${address}:${half}`;
  const hit = kept.get(key);
  if (hit && now() < hit.until) return Promise.resolve(hit.read);
  const pending = inflight.get(key);
  if (pending) return pending;
  const read = Promise.resolve()
    .then(() => withTimeout(readDlmmBinsAnswer(address, half, given.deps ?? liveDeps(poolsConnection()), now), READ_DEADLINE_MS, "Solana"))
    .catch((error: unknown): BinsRead => ({ ok: false, code: "UNAVAILABLE", reason: error instanceof Error ? error.message.slice(0, 160) : "The chain did not answer." }))
    .then((answer) => {
      if (kept.size >= BINS_KEPT) kept.delete(kept.keys().next().value!);
      kept.set(key, { until: now() + (answer.ok ? BINS_TTL_MS : BINS_NEGATIVE_TTL_MS), read: answer });
      return answer;
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, read);
  return read;
}
