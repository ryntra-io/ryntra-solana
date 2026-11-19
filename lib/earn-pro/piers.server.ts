/**
 * The piers of DLMM Pro and a wallet's boats at them, read from the chain.
 *
 * DLMM Pro has no Data API: the pools are the program's own accounts (`getProgramAccounts`, the venue's `pools.list`),
 * and a wallet's positions are the NFTs it holds (`holdings.ofWallet`). Both are indexed reads a public node may
 * refuse; a refusal is an error the route says — never an empty list.
 *
 * A pier is a pool of SOL against a coin Earn knows (`./coins.ts`) — or, where a deployment opened any pool, against any other coin, named from Jupiter's catalogue. What a pier says of itself is only what the chain
 * holds now: its price, its fee, how deep it is (the two reserves, said in SOL at its own price) and its reward's
 * emission. There are no «fees of the last day» here — nobody keeps that history for DLMM Pro yet, and it is not made up.
 */

import { PublicKey, type Connection } from "@solana/web3.js";

import { fetchTokenCatalog } from "../solana/catalog.ts";
import { isOffensiveName } from "../spot/offensive-names.ts";
import { earnProCoins, pierPairOf, shortMint, type EarnProCoin } from "./coins.ts";
import { earnProAnyPool, type EarnProNetwork } from "./gate.ts";
import { earnProConnection, earnProVenue, CARE_RIGHTS, type DlmmProPool, type DlmmProVenue, type EarnIncome } from "./venue.server.ts";

export type PierCoin = Readonly<{ mint: string; symbol: string; decimals: number }>;

export type ProPier = Readonly<{
  address: string;
  x: PierCoin;
  y: PierCoin;
  /** Which side SOL is on: amounts are typed and told in SOL. */
  solIsX: boolean;
  /** Token Y per token X, in whole coins. */
  price: number;
  /** What a swap pays now, basis points to two decimals. */
  feeBps: number;
  tickSpacing: number;
  tickId: number;
  /** The two reserves in SOL at the pool's own price, lamports; null where a reserve did not read. */
  depthLamports: string | null;
  /** The pool's rewards that are set up: the coin, what is emitted a day, whether it runs now. */
  rewards: readonly Readonly<{ index: number; mint: string; symbol: string | null; perDayRaw: string; running: boolean; endsAt: number }>[];
  /** Whether a deposit is open to everyone now (not before its opening, not paused). */
  takesDeposits: boolean;
}>;

export type ProBoat = Readonly<{
  nftMint: string;
  pool: string;
  /** Whether the price is inside the position: only then does it earn. */
  inRange: boolean;
  ranges: number;
  /** The whole position's range as prices, token Y per token X. */
  lowerPrice: number;
  upperPrice: number;
  worth: Readonly<{ xRaw: string; yRaw: string; lamports: string }>;
  /** First line of income: the fees to take now. */
  fees: Readonly<{ xRaw: string; yRaw: string; lamports: string }>;
  /** Second line: the pool's rewards the position already shows. */
  rewards: readonly Readonly<{ index: number; mint: string; symbol: string | null; accruedRaw: string; running: boolean }>[];
  /** Nothing left in it: its rent can be taken back. */
  empty: boolean;
  /** An agent looks after it: approved on the NFT with exactly a care's rights. */
  cared: boolean;
}>;

const TOKEN_AMOUNT_OFFSET = 64;
const PIERS_FRESH_MS = 60_000;
const kept = new Map<string, Readonly<{ at: number; piers: readonly ProPier[] }>>();

/** A tick as a price in whole coins: 1.0001^tick, moved by the coins' decimals. */
export const priceOfTick = (tickId: number, decimalsX: number, decimalsY: number): number => Math.pow(1.0001, tickId) * 10 ** (decimalsX - decimalsY);

/** Raw amounts of a pool's two coins as lamports of SOL at the pool's price; null where the price is not a number to divide by. */
export function lamportsOf(pier: Pick<ProPier, "solIsX" | "price" | "x" | "y">, xRaw: bigint, yRaw: bigint): bigint | null {
  if (!(pier.price > 0) || !Number.isFinite(pier.price)) return null;
  const x = Number(xRaw) / 10 ** pier.x.decimals;
  const y = Number(yRaw) / 10 ** pier.y.decimals;
  /* SOL as X: Y's worth in X is y / price. SOL as Y: X's worth in Y is x × price. */
  const sol = pier.solIsX ? x + y / pier.price : y + x * pier.price;
  return Number.isFinite(sol) ? BigInt(Math.round(sol * 1e9)) : null;
}

/** Names of the coins a network's piers are made of beyond the coins Earn knows; null — only the known ones. */
type NameOf = ((mint: string) => string) | null;

function pierOf(pool: DlmmProPool, coins: readonly EarnProCoin[], reserves: Readonly<{ x: bigint | null; y: bigint | null }>, nameOf: NameOf = null): ProPier | null {
  const pair = pierPairOf(coins, pool.tokenX.mint, pool.tokenY.mint, nameOf);
  if (!pair) return null;
  const symbolOf = (mint: string) => coins.find((coin) => coin.mint === mint)?.symbol ?? (mint === pair.x.mint ? pair.x.symbol : mint === pair.y.mint ? pair.y.symbol : null);
  const base = {
    address: pool.address,
    x: { mint: pair.x.mint, symbol: pair.x.symbol, decimals: pool.tokenX.decimals },
    y: { mint: pair.y.mint, symbol: pair.y.symbol, decimals: pool.tokenY.decimals },
    solIsX: pair.solIsX,
    price: pool.price,
  };
  const depth = reserves.x === null || reserves.y === null ? null : lamportsOf(base, reserves.x, reserves.y);
  return {
    ...base,
    feeBps: pool.fee.totalBps,
    tickSpacing: pool.tickSpacing,
    tickId: pool.tickId,
    depthLamports: depth === null ? null : depth.toString(),
    rewards: pool.rewards.map((reward) => ({ index: reward.index, mint: reward.mint, symbol: symbolOf(reward.mint), perDayRaw: ((BigInt(reward.emissionPerSecondX64) * 86_400n) >> 64n).toString(), running: reward.running, endsAt: reward.endsAt })),
    takesDeposits: pool.open.addLiquidity.open && !pool.paused.deposits,
  };
}

/** The vaults' amounts of pools, base units — 100 accounts a read; null where a vault did not read. */
export async function reservesOf(connection: Pick<Connection, "getMultipleAccountsInfo">, pools: readonly DlmmProPool[]): Promise<ReadonlyMap<string, bigint | null>> {
  const addresses = [...new Set(pools.flatMap((pool) => [pool.tokenX.reserve, pool.tokenY.reserve]))];
  const out = new Map<string, bigint | null>();
  for (let start = 0; start < addresses.length; start += 100) {
    const chunk = addresses.slice(start, start + 100);
    const infos = await connection.getMultipleAccountsInfo(chunk.map((address) => new PublicKey(address)), "confirmed");
    chunk.forEach((address, index) => {
      const data = infos[index]?.data;
      out.set(address, data && data.length >= TOKEN_AMOUNT_OFFSET + 8 ? Buffer.from(data).readBigUInt64LE(TOKEN_AMOUNT_OFFSET) : null);
    });
  }
  return out;
}

/** `names` — the catalogue a deployment that opened any pool names the other coins from; a test or a rehearsal hands its own. */
export type PierDeps = Readonly<{
  env?: Readonly<Record<string, string | undefined>>;
  connection?: Connection;
  venue?: DlmmProVenue;
  now?: () => number;
  fresh?: boolean;
  names?: (mints: readonly string[]) => Promise<Readonly<Record<string, Readonly<{ symbol: string | null; name: string | null }>>>>;
}>;

/** The longest ticker a pier carries — the contract's own bound; a longer one is cut: a name is a courtesy. */
const SYMBOL_MAX = 10;

/** Jupiter's names of mainnet's coins; nothing on devnet, and nothing where the catalogue did not answer. */
async function catalogNames(network: EarnProNetwork, mints: readonly string[]): Promise<Readonly<Record<string, Readonly<{ symbol: string | null; name: string | null }>>>> {
  if (network !== "mainnet" || mints.length === 0) return {};
  /* The catalogue answers fifty coins a call. */
  const chunks: string[][] = [];
  for (let start = 0; start < mints.length; start += 50) chunks.push(mints.slice(start, start + 50));
  const reads = await Promise.all(chunks.map((chunk) => fetchTokenCatalog(chunk, 6_000).catch(() => null)));
  return Object.assign({}, ...reads.map((read) => (read && read.ok ? read.byMint : {})));
}

/**
 * Where any pool is open: the other coins of the network's pools of SOL, named — the catalogue's ticker, else
 * the start of the address — and the mints whose names carry a hate word, which make no pier (as on the Market). Null
 * where only the coins Earn knows make piers.
 */
async function otherNames(network: EarnProNetwork, pools: readonly DlmmProPool[], coins: readonly EarnProCoin[], deps: PierDeps): Promise<Readonly<{ nameOf: (mint: string) => string; barred: ReadonlySet<string> }> | null> {
  if (!earnProAnyPool(deps.env ?? process.env)) return null;
  const known = new Set(coins.map((coin) => coin.mint));
  const mints = [...new Set(pools.flatMap((pool) => [pool.tokenX.mint, pool.tokenY.mint]))].filter((mint) => !known.has(mint));
  const names = await (deps.names ?? ((asked: readonly string[]) => catalogNames(network, asked)))(mints).catch(() => ({}) as Readonly<Record<string, Readonly<{ symbol: string | null; name: string | null }>>>);
  const barred = new Set(mints.filter((mint) => isOffensiveName(names[mint]?.symbol, names[mint]?.name)));
  return { nameOf: (mint) => names[mint]?.symbol?.trim().slice(0, SYMBOL_MAX) || shortMint(mint), barred };
}

/** The piers of a network, deepest first; kept a minute. Throws where the chain did not answer. */
export async function readPiers(network: EarnProNetwork, deps: PierDeps = {}): Promise<Readonly<{ piers: readonly ProPier[]; at: number }>> {
  const now = deps.now?.() ?? Date.now();
  const any = earnProAnyPool(deps.env ?? process.env);
  const cacheKey = `${network}:${any ? "any" : "known"}:${deps.connection ? "given" : "own"}`;
  const cached = deps.fresh || deps.connection ? undefined : kept.get(cacheKey);
  if (cached && now - cached.at < PIERS_FRESH_MS) return cached;
  const connection = deps.connection ?? earnProConnection(network);
  const venue = deps.venue ?? earnProVenue(network, connection, deps.env ?? process.env);
  const coins = earnProCoins(network, deps.env ?? process.env);
  const sol = coins.find((coin) => coin.kind === "sol")!;
  /* Every pier has SOL on one side: one read by the coin, not the whole program. */
  const withSol = await venue.pools.list({ mint: sol.mint });
  const names = await otherNames(network, withSol, coins, deps);
  const nameOf = names?.nameOf ?? null;
  const pools = withSol.filter((pool) => pierPairOf(coins, pool.tokenX.mint, pool.tokenY.mint, nameOf) !== null && !names?.barred.has(pool.tokenX.mint) && !names?.barred.has(pool.tokenY.mint));
  const reserves = await reservesOf(connection, pools);
  const piers = pools
    .flatMap((pool) => pierOf(pool, coins, { x: reserves.get(pool.tokenX.reserve) ?? null, y: reserves.get(pool.tokenY.reserve) ?? null }, nameOf) ?? [])
    .sort((a, b) => Number(BigInt(b.depthLamports ?? "0") - BigInt(a.depthLamports ?? "0")));
  const answer = { piers, at: now };
  if (!deps.connection) kept.set(cacheKey, answer);
  return answer;
}

/**
 * One pier, read now — for a Review, which never stands on a kept list. `served` — whether new money may go in here: a
 * pool of a coin Earn knows, or, where any pool is open, of any other coin whose name bars nothing. For what
 * takes money out, any pool of SOL is read as a pier whatever the switch says: a switch closed again, or a name barred
 * later, never holds a position in. Null — no pool at the address, or no SOL on a side.
 */
export async function readPier(network: EarnProNetwork, address: string, deps: PierDeps = {}): Promise<Readonly<{ pier: ProPier; pool: DlmmProPool; served: boolean }> | null> {
  const env = deps.env ?? process.env;
  const connection = deps.connection ?? earnProConnection(network);
  const venue = deps.venue ?? earnProVenue(network, connection, env);
  const pool = await venue.pools.read(address);
  if (!pool) return null;
  const coins = earnProCoins(network, env);
  const sol = coins.find((coin) => coin.kind === "sol")!.mint;
  /* A pool without SOL on a side is no pier for anything: nothing more is asked of it. */
  if (pool.tokenX.mint !== sol && pool.tokenY.mint !== sol) return null;
  const known = pierPairOf(coins, pool.tokenX.mint, pool.tokenY.mint) !== null;
  let nameOf: NameOf = null;
  let barred = false;
  if (!known) {
    const own = new Set(coins.map((coin) => coin.mint));
    const mints = [pool.tokenX.mint, pool.tokenY.mint].filter((mint) => !own.has(mint));
    const names = await (deps.names ?? ((asked: readonly string[]) => catalogNames(network, asked)))(mints).catch(() => ({}) as Readonly<Record<string, Readonly<{ symbol: string | null; name: string | null }>>>);
    barred = mints.some((mint) => isOffensiveName(names[mint]?.symbol, names[mint]?.name));
    nameOf = (mint) => (barred ? shortMint(mint) : names[mint]?.symbol?.trim().slice(0, SYMBOL_MAX) || shortMint(mint));
  }
  const reserves = await reservesOf(connection, [pool]);
  const pier = pierOf(pool, coins, { x: reserves.get(pool.tokenX.reserve) ?? null, y: reserves.get(pool.tokenY.reserve) ?? null }, nameOf);
  return pier ? { pier, pool, served: known || (earnProAnyPool(env) && !barred) } : null;
}

export function boatOf(pier: ProPier, income: EarnIncome, cared: boolean): ProBoat {
  const position = income.position;
  const lower = Math.min(...position.slots.map((slot) => slot.tickLowerId));
  const upper = Math.max(...position.slots.map((slot) => slot.tickUpperId));
  const inLamports = (xRaw: string, yRaw: string) => (lamportsOf(pier, BigInt(xRaw), BigInt(yRaw)) ?? 0n).toString();
  const symbolOf = (mint: string) => (mint === pier.x.mint ? pier.x.symbol : mint === pier.y.mint ? pier.y.symbol : null);
  return {
    nftMint: position.nftMint,
    pool: position.pool,
    inRange: income.inRange,
    ranges: position.slots.length,
    lowerPrice: priceOfTick(lower, pier.x.decimals, pier.y.decimals),
    upperPrice: priceOfTick(upper, pier.x.decimals, pier.y.decimals),
    worth: { xRaw: position.xRaw, yRaw: position.yRaw, lamports: inLamports(position.xRaw, position.yRaw) },
    fees: { xRaw: income.fees.xRaw, yRaw: income.fees.yRaw, lamports: inLamports(income.fees.xRaw, income.fees.yRaw) },
    rewards: income.rewards.map((reward) => ({ index: reward.index, mint: reward.mint, symbol: symbolOf(reward.mint) ?? pier.rewards.find((entry) => entry.index === reward.index)?.symbol ?? null, accruedRaw: reward.accruedRaw, running: reward.running })),
    empty: position.empty,
    cared,
  };
}

/**
 * A wallet's boats at the network's piers. `agent` — the address a care is given to here, or null where none is. A
 * position in a pool of SOL that is no pier on the list (one opened while any pool was open) is read as its
 * own pier: what a person holds is always shown, and always taken out.
 */
export async function readBoats(network: EarnProNetwork, owner: string, agent: string | null, deps: PierDeps = {}): Promise<readonly ProBoat[]> {
  const connection = deps.connection ?? earnProConnection(network);
  const venue = deps.venue ?? earnProVenue(network, connection, deps.env ?? process.env);
  const held = await venue.holdings.ofWallet(owner);
  if (held.positions.length === 0) return [];
  const { piers } = await readPiers(network, deps);
  const byPool = new Map<string, ProPier | null>(piers.map((pier) => [pier.address, pier]));
  const positions = held.positions.slice(0, 24);
  /* The pools of the list's piers at once; any other pool of SOL a position stands in, read once each, side by side and kept a minute. */
  const others = [...new Set(positions.map((entry) => entry.pool).filter((pool) => !byPool.has(pool)))];
  const read = await Promise.all(others.map((pool) => takeOutPier(network, pool, { ...deps, connection, venue })));
  others.forEach((pool, index) => byPool.set(pool, read[index] ?? null));
  const boats: ProBoat[] = [];
  for (const entry of positions) {
    const pier = byPool.get(entry.pool);
    if (!pier) continue;
    const [income, care] = await Promise.all([venue.earn.income({ pool: entry.pool, nftMint: entry.nftMint }), venue.earn.care({ pool: entry.pool, nftMint: entry.nftMint, owner, agent })]);
    boats.push(boatOf(pier, income, agent !== null && care.cares));
  }
  return boats;
}

/** Piers read for what a person holds outside the list — a pool and what it is made of change slowly: a minute each. */
const TAKE_OUT_FRESH_MS = 60_000;
const takeOutKept = new Map<string, Readonly<{ at: number; pier: ProPier | null }>>();

async function takeOutPier(network: EarnProNetwork, address: string, deps: PierDeps): Promise<ProPier | null> {
  const now = deps.now?.() ?? Date.now();
  const key = `${network}:${address}`;
  /* A read a test or a rehearsal hands its own chain to is never kept. */
  const kept = deps.connection ? undefined : takeOutKept.get(key);
  if (kept && now - kept.at < TAKE_OUT_FRESH_MS) return kept.pier;
  const pier = (await readPier(network, address, deps))?.pier ?? null;
  if (!deps.connection) {
    if (takeOutKept.size >= 500) takeOutKept.delete(takeOutKept.keys().next().value!);
    takeOutKept.set(key, { at: now, pier });
  }
  return pier;
}

export { CARE_RIGHTS };
