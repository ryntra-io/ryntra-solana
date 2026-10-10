/**
 * Where each Ryntra Launch identity started — read from the chain, never
 * written in the registry.
 *
 * A fee identity starts at its first credit (`registryFacts`). A launch
 * identity is not credited, so its start is the transaction that created it:
 * the oldest transaction of its address, taken only when that transaction
 * proves it — the account held nothing before it and something after. A config
 * and the pool payer were created for Launch. The partner's vault is a Squads
 * vault that existed before Launch; it is Launch's from the first config that
 * names it, so it starts at the earliest config's creation, and what it did
 * before is not Launch's.
 *
 * The list comes from the endpoint whose history is whole — a provider's when
 * one is configured, else Solana's own: a public node keeps a day or two of an
 * address's signatures. Once read a start never changes: it is kept a day in
 * the platform's shared cache. A read that did not answer is kept an hour by
 * the instance as not known, and a page never waits for it more than a few
 * seconds.
 *
 * Server-only.
 */

import { Connection, PublicKey } from "@solana/web3.js";
import { unstable_cache } from "next/cache.js";

import { resolveEndpoints } from "../solana/rpc.ts";
import { ATTRIBUTION_REGISTRY, publicRegistry, type RegistryEntry, type RegistryMoment } from "./registry.ts";

/** A thousand signatures a page; past this many the start is left unknown rather than read for ever. */
const PAGES = 20;
const DAY_S = 24 * 60 * 60;
/** How long a page waits for a read that is not cached; the read goes on and the next page has it. */
const WAIT_MS = 4_000;
/** How long an instance keeps a read that did not answer before it asks the chain again. */
const RETRY_AFTER_MS = 60 * 60 * 1000;

type Start = Readonly<{ id: string; moment: RegistryMoment }>;
type Reader = Pick<Connection, "getSignaturesForAddress" | "getTransaction">;

/** The rows read here: Launch's identities that are published. */
export function launchRows(rows: readonly RegistryEntry[] = ATTRIBUTION_REGISTRY): readonly RegistryEntry[] {
  return publicRegistry(rows).filter((row) => row.network === "solana" && row.role.startsWith("LAUNCH_"));
}

/** The endpoint whose signature lists are whole. */
function historyEndpoint(): string {
  const [primary] = resolveEndpoints("mainnet");
  return primary!.fromEnv ? primary!.url : "https://api.mainnet-beta.solana.com";
}

/** The oldest transaction an address took part in, or null when its history runs past the pages read. */
export async function oldestTransaction(connection: Pick<Connection, "getSignaturesForAddress">, address: string): Promise<RegistryMoment | null> {
  let before: string | undefined;
  for (let page = 0; page < PAGES; page += 1) {
    const batch = await connection.getSignaturesForAddress(new PublicKey(address), { before, limit: 1_000 }, "confirmed");
    if (batch.length === 0) return null;
    if (batch.length < 1_000) {
      const oldest = batch.at(-1)!;
      return { network: "solana", block: oldest.slot, time: oldest.blockTime ? new Date(oldest.blockTime * 1000).toISOString() : null, tx: oldest.signature };
    }
    before = batch.at(-1)!.signature;
  }
  return null;
}

/**
 * The transaction that created an address: its oldest, when that one shows the account holding nothing before it and
 * something after. A list cut short by a node gives a later transaction, which shows a balance before it — no start.
 */
export async function createdAt(connection: Reader, address: string): Promise<RegistryMoment | null> {
  const oldest = await oldestTransaction(connection, address);
  if (!oldest) return null;
  const tx = await connection.getTransaction(oldest.tx, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  if (!tx?.meta) throw new Error(`The transaction ${oldest.tx} was not read.`);
  const keys = tx.transaction.message.getAccountKeys({ accountKeysFromLookups: tx.meta.loadedAddresses });
  const index = keys.staticAccountKeys.findIndex((key) => key.toBase58() === address);
  if (index < 0) return null;
  return tx.meta.preBalances[index] === 0 && (tx.meta.postBalances[index] ?? 0) > 0 ? oldest : null;
}

/**
 * The partner's vault starts at the earliest creation of the configs it claims for, and Ryntra's revenue from Micro at the
 * earliest of the configs the executor claims for — each only when every such config's start is known.
 */
export function withFeeClaimer(rows: readonly RegistryEntry[], starts: readonly Start[]): readonly Start[] {
  const earliestOf = (configs: readonly RegistryEntry[]): RegistryMoment | null => {
    const read = configs.map((row) => starts.find((start) => start.id === row.id)?.moment ?? null);
    if (read.length === 0 || read.some((moment) => moment === null)) return null;
    return (read as RegistryMoment[]).reduce((first, moment) => ((moment.block ?? Infinity) < (first.block ?? Infinity) ? moment : first));
  };
  const configs = rows.filter((row) => row.role === "LAUNCH_CONFIG");
  const vault = earliestOf(configs.filter((row) => row.parent === null));
  const executor = earliestOf(configs.filter((row) => row.parent !== null && row.countedAs === "FEES"));
  return [
    ...starts,
    ...(vault ? rows.filter((row) => row.role === "LAUNCH_FEE_CLAIMER").map((row) => ({ id: row.id, moment: vault })) : []),
    ...(executor ? rows.filter((row) => row.role === "LAUNCH_REVENUE").map((row) => ({ id: row.id, moment: executor })) : []),
  ];
}

/** A read in which some row did not answer: answered, never kept for a day. */
class PartialStarts extends Error {
  readonly starts: readonly Start[];
  constructor(starts: readonly Start[]) {
    super("partial");
    this.starts = starts;
  }
}

async function readStarts(): Promise<readonly Start[]> {
  const connection = new Connection(historyEndpoint(), { commitment: "confirmed", disableRetryOnRateLimit: true });
  const rows = launchRows();
  const starts: Start[] = [];
  let failed = false;
  /* One at a time, and a refusal asked again once after a pause: a public endpoint answers a burst with 429. */
  for (const row of rows.filter((entry) => entry.role !== "LAUNCH_FEE_CLAIMER" && entry.role !== "LAUNCH_REVENUE")) {
    let read = false;
    for (let attempt = 0; attempt < 2 && !read; attempt += 1) {
      try {
        if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 1_000));
        const moment = await createdAt(connection, row.address!);
        if (moment) starts.push({ id: row.id, moment });
        read = moment !== null;
      } catch {
        /* asked again */
      }
    }
    if (!read) failed = true;
  }
  const all = withFeeClaimer(rows, starts);
  if (failed) throw new PartialStarts(all);
  return all;
}

const readShared = unstable_cache(readStarts, ["attribution-launch-starts-v2", launchRows().map((row) => row.address).join(",")], { revalidate: DAY_S, tags: ["attribution"] });

const byId = (starts: readonly Start[]) => new Map(starts.map((start) => [start.id, start.moment]));

async function readOnce(): Promise<Readonly<{ starts: ReadonlyMap<string, RegistryMoment>; whole: boolean }>> {
  try {
    return { starts: byId(await readShared()), whole: true };
  } catch (failure) {
    if (failure instanceof PartialStarts) return { starts: byId(failure.starts), whole: false };
    /* Next refuses the platform layer outside a request: read directly then. Any other failure is no start, never a wrong one. */
    if (failure instanceof Error && /incrementalCache missing/.test(failure.message)) {
      try {
        return { starts: byId(await readStarts()), whole: true };
      } catch (partial) {
        return { starts: partial instanceof PartialStarts ? byId(partial.starts) : new Map(), whole: false };
      }
    }
    return { starts: new Map(), whole: false };
  }
}

let known: Readonly<{ at: number; starts: ReadonlyMap<string, RegistryMoment>; whole: boolean }> | null = null;
let pending: Promise<ReadonlyMap<string, RegistryMoment>> | null = null;

/** Each published Launch identity's start, by row id — what the chain says, or nothing for a row it did not answer. */
export async function readLaunchStarts(): Promise<ReadonlyMap<string, RegistryMoment>> {
  if (known && (known.whole || Date.now() - known.at < RETRY_AFTER_MS)) return known.starts;
  pending ??= readOnce()
    .then((result) => {
      known = { at: Date.now(), ...result };
      return result.starts;
    })
    .finally(() => {
      pending = null;
    });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const waited = new Promise<ReadonlyMap<string, RegistryMoment>>((resolve) => {
    timer = setTimeout(() => resolve(known?.starts ?? new Map()), WAIT_MS);
  });
  try {
    return await Promise.race([pending, waited]);
  } finally {
    clearTimeout(timer);
  }
}
