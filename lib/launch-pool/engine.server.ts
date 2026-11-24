/**
 * A launch straight into a pool on Meteora DLMM Pro — the server's half: who may launch, the build and the
 * send of each step, the record, and what a tower reads. The terms are `lib/core/launch/dlmm-pro.ts`; every
 * transaction is the venue's own build (`lib/core/venues/meteora-dlmm-pro/`).
 *
 * **Gating.** On the devnet stand the format is open. On mainnet it is closed
 * (`DLMM_PRO_LAUNCH_OWNER_WORD`, D-M4 of the review of 14.11.2026) — whatever a deployment's configuration says. The
 * live Launch on DBC is another set of routes and another record, and nothing here touches it.
 *
 * **Three steps, each built from the chain.** A build asks the chain what of the launch is there and builds the step
 * that is not:
 *
 * 1. `COIN` — the honest Token-2022 mint with the whole supply in the creator's account, as the live Launch mints it;
 * 2. `POOL` — the pair's pool with the fee against snipers, the opening time and the creator as the one wallet that may
 *    put liquidity in before it. A launch pool; from Ryntra's dynamic config only once Meteora gives one (D-M1) —
 *    built here, switched off (`DLMM_PRO_LAUNCH_POOL_SOURCE`);
 * 3. `SUPPLY` — the whole supply above the first price as locked liquidity: the creator's position, and — with the
 *    split of D-M2 — Ryntra's, which the creator opens, locks and hands over in the same step; the creator's ladder
 *    where asked; and — where asked — the reward for the pool's liquidity: one more transaction of the same
 *    approval that sets up the pool's creator reward slot with the launch's coin and funds its emission from the
 *    opening (`./reward.server.ts`). Its pool is made with liquidity mining at the pool's step; without a reward, never.
 *
 * Each step is its own build and its own approval in the creator's wallet: a pool cannot be built before its coin is
 * on chain, nor a position before its pool. A step whose answer did not come is settled from the chain's own accounts
 * by the next build, and a launch left half-way is taken up where the chain shows it — by its creator alone.
 *
 * **Keys.** The creator's wallet pays every fee and rent and signs every step. The only other signatures are fresh
 * keys' — the coin's mint, each position's NFT mint — made here at the first build, sealed with the server's key
 * (`sealCosigners`) and used once each, over the exact message the creator signed. No key of Ryntra's signs a launch;
 * Ryntra's side of the split is an address — the partner vault — that the second position is handed to.
 *
 * **What a person is told before a signature**: the launch's whole cost — an estimate at the first step, the venue's
 * own numbers at each — the fee the schedule really settles at (`endFeeBps`, the pool's own number), and the opening
 * time. A wallet that cannot pay for the whole launch is refused before the coin is minted, not after.
 */

import { randomBytes } from "node:crypto";

import { ExtensionType, TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync, getExtensionData, getMintLen, unpackMint } from "@solana/spl-token";
import { Keypair, PublicKey, VersionedTransaction, type Connection } from "@solana/web3.js";

import type { ApiErrorCode } from "../api/v1/contract.ts";
import {
  DLMM_PRO_LAUNCH_TERMS,
  DLMM_PRO_SUPPLY_RAW,
  WRAPPED_SOL_MINT,
  dlmmProHonestProblems,
  dlmmProLadderRaw,
  dlmmProPoolProblems,
  dlmmProNextStage,
  dlmmProOpensAt,
  dlmmProPhase,
  dlmmProStartPrice,
  dlmmProEmission,
  dlmmProRewardLockedShare,
  dlmmProRewardPerDayRaw,
  dlmmProRewardProblem,
  dlmmProRewardRaw,
  dlmmProRewardSeconds,
  dlmmProRewardSpent,
  dlmmProSupplyParts,
  type DlmmProLaunchChain,
  type DlmmProRewardAsk,
  type DlmmProLaunchFacts,
  type DlmmProPoolFacts,
  type DlmmProLaunchPair,
  type DlmmProLaunchPhase,
  type DlmmProLaunchStage,
} from "../core/launch/dlmm-pro.ts";
import { metadataBytesOf, mintInstructions } from "../core/venues/meteora-alpha-vault/early-access.server.ts";
import { DLMM_PRO_ACCOUNT_BYTES, assertAffords, mintExtensionTypes, type DlmmProPool, type DlmmProReward } from "../core/venues/meteora-dlmm-pro/pools.server.ts";
import type { OrderView } from "../core/venues/meteora-dlmm-pro/limit-orders.server.ts";
import { DLMM_PRO_PROGRAM, DlmmProRefusal } from "../core/venues/meteora-dlmm-pro/sdk.server.ts";
import { TICKS_PER_ARRAY } from "../core/venues/meteora-dlmm-pro/ticks.ts";
import { LAMPORTS_PER_SIGNATURE, seal, type DlmmProTx } from "../core/venues/meteora-dlmm-pro/tx.server.ts";
import { createDlmmProVenue, type DlmmProVenue } from "../core/venues/meteora-dlmm-pro/venue.server.ts";
import type { GuardCollection, GuardStore } from "../guard/store.ts";
import type { Env } from "../liquidity/studio/gate.ts";
import { openCosigners, sealCosigners, ticketKeyConfigured, type Cosigner } from "../liquidity/studio/ticket.ts";
import { NEXT_TRANSACTION_MARGIN_MS, readBuildWindows, web3ChainReader } from "../solana/blockhash-life.ts";
import { ed25519Valid } from "../solana/limits/trigger-tx.ts";
import { compareWalletTransaction } from "../solana/wallet-modification.ts";
import { LAUNCHES_PER_CREATOR_PER_DAY, launchPartnerVault, type LaunchCluster, type LaunchNetwork } from "../launch/config.server.ts";
import { DLMM_PRO_LAUNCH_OWNER_WORD, DLMM_PRO_LAUNCH_POOL_SOURCE, DLMM_PRO_LAUNCH_REWARD_MAINNET, dlmmProLaunchOpenFor, dlmmProLaunchRewardOpenFor } from "./gate.ts";
import { REWARD_START_MARGIN_SECONDS, buildLaunchReward } from "./reward.server.ts";
import { accountOnChain, budgetLeft, sendOnce, type Sendable, type Sent } from "../launch/flow.server.ts";
import { checkLaunchForm } from "../launch/form.ts";
import { isTakenDown, metadataOfUri } from "../launch/metadata.server.ts";

/* ------------------------------------------------------------- gating */

export { DLMM_PRO_LAUNCH_OWNER_WORD, DLMM_PRO_LAUNCH_POOL_SOURCE, DLMM_PRO_LAUNCH_REWARD_MAINNET, dlmmProLaunchOpenFor, dlmmProLaunchRewardOpenFor };

/** The wallet a dynamic config belongs to, as a signer the server holds: it signs a pool's creation and nothing else. */
export type DlmmProConfigSigner = Readonly<{ address: string; signMessage: (message: Uint8Array) => Promise<Uint8Array> }>;

export const DLMM_PRO_CONFIG_ENV = "RYNTRA_DLMM_PRO_LAUNCH_CONFIG";

/* -------------------------------------------------------------- store */

/** The record per coin (`<cluster>:<mint>`), the builds waiting for a signature and the one send of each (`<cluster>:<id>`). A value in the same column, no DDL. */
export const DLMM_PRO_LAUNCH_COLLECTIONS = { records: "launchDlmmPro", builds: "launchDlmmProBuilds", sends: "launchDlmmProSends" } as const;
const collection = <T,>(store: GuardStore, name: (typeof DLMM_PRO_LAUNCH_COLLECTIONS)[keyof typeof DLMM_PRO_LAUNCH_COLLECTIONS]): GuardCollection<T> => store.collection<T>(name);

export type DlmmProLaunchDeps = Readonly<{
  network: LaunchNetwork;
  connection: Connection;
  store: GuardStore;
  now: () => Date;
  /** The server's environment: its key (`BETA_TOKEN_SECRET`) seals the fresh keys until the creator has signed. */
  env: Env;
  /** The public origin the metadata lives on. */
  origin: string;
  second?: Connection | null;
  ownerWord?: boolean;
  /** Ryntra's side of the split of D-M2 — the wallet the second position is handed to. Absent — the partner vault of the network; null — no split: one position, the creator's. */
  ryntra?: string | null;
  /** Where the pool comes from, injectable for a rehearsal; absent — `DLMM_PRO_LAUNCH_POOL_SOURCE`. */
  poolSource?: "launch" | "config";
  /** The dynamic config and the signer of its wallet; needed only for `config`. */
  config?: Readonly<{ address: string; signer: DlmmProConfigSigner }> | null;
  /** How long one send may take, for a stand whose chain answers at once; absent — the route's budgets. */
  sendBudget?: Readonly<{ confirmMs: number; settleMs: number }>;
  /** Whether a read may write what the chain shows landed into the record; absent — it may. A deployment that writes no launches says no. */
  settle?: boolean;
  /** The deployment's switch is read from `env`. */
  rewardWord?: boolean;
}>;

export type DlmmProLaunchFailure = Readonly<{ ok: false; code: ApiErrorCode; message: string }>;
const fail = (code: ApiErrorCode, message: string): DlmmProLaunchFailure => ({ ok: false, code, message });

export type DlmmProStepState = "CONFIRMED" | "PENDING" | "FAILED" | "NOT_SENT";
export type DlmmProStep = Readonly<{ signatures: readonly string[]; state: DlmmProStepState; reason: string | null; /** What the step's build told of its cost: the network's fees, and the rent that stays on chain. */ feeLamports: number; rentLamports: number }>;

export type DlmmProFeeRecord = Readonly<{ startBps: number; /** The fee the pool reads for ever, as its build said it. */ endBps: number; askedEndBps: number; settles: Readonly<{ afterSeconds: number; atPriceMultiple: number | null }> | null; /** The volatility fee's most, as the build sized it; absent on a record made before it was kept. */ dynamicCeilingBps?: number }>;

/**
 * The reward for the pool's liquidity as the record keeps it: what was asked — a share of the supply over
 * whole days —, its coins, and the window the supply's step built it for (null until then). The chain's own slot is
 * what a tower and the honest check read; the window here is what the creator was told at the signature.
 */
export type DlmmProRewardRecord = Readonly<{ shareBps: number; days: number; amountRaw: string; opensAt: number | null; endsAt: number | null }>;

/** The creator's ladder as the record keeps it; `signature` — its transaction's, once sent: the chain's word that it rested, after its owner took it down. */
export type DlmmProLadderRecord = Readonly<{ nftMint: string; amountRaw: string; order: string | null; signature?: string | null }>;

export type DlmmProLaunchRecord = Readonly<{
  cluster: LaunchCluster;
  mint: string;
  creator: string;
  pair: DlmmProLaunchPair;
  quoteMint: string;
  name: string;
  symbol: string;
  metadataUri: string;
  pool: string;
  poolSource: "launch" | "config";
  config: string | null;
  /** Unix seconds: trading opens to everyone. */
  opensAt: number;
  initialTickId: number;
  /** Known once the pool is built: the schedule as the program was told it. */
  fee: DlmmProFeeRecord | null;
  /** Ryntra's side of the split; null — one position. */
  ryntra: string | null;
  positions: Readonly<{ creator: string; ryntra: string | null }>;
  /**
   * The creator's take-profit ladder (the order, placed before the opening): its NFT, the part of the supply it
   * rests, and its order's address once the supply's step is built. Null or absent — the launch has none.
   */
  ladder?: DlmmProLadderRecord | null;
  /** The reward for the pool's liquidity. Null or absent — the launch has none. */
  reward?: DlmmProRewardRecord | null;
  /** The coin's mint key (0), the creator's position's NFT (1), Ryntra's (2) and the ladder's (3, where there is one), sealed. */
  cosign: string;
  steps: Readonly<Record<DlmmProLaunchStage, DlmmProStep>>;
  createdAt: string;
}>;

type BuiltTx = Readonly<{
  /** The unsigned bytes the wallet was handed. */
  wireBase64: string;
  validUntil: string;
  role: string;
  /** The account the transaction makes: on chain, the transaction landed — whatever a node says of a signature. */
  makes: Readonly<{ address: string; owner: string; /** A hand-over: the account must hold the NFT — an account anybody made beforehand is not the hand-over landed. */ holdsOne?: boolean }>;
  /** Whether the dynamic config's wallet signs it beside the creator. */
  config: boolean;
}>;

export type DlmmProBuildRecord = Readonly<{
  id: string;
  cluster: LaunchCluster;
  creator: string;
  mint: string;
  stage: DlmmProLaunchStage;
  txs: readonly BuiltTx[];
  feeLamports: number;
  rentLamports: number;
  /** The launch as it will be recorded when this step is sent: the first step carries it whole, later ones what they learn. */
  launch: Omit<DlmmProLaunchRecord, "steps" | "createdAt">;
  createdAt: string;
  expiresAt: string;
}>;

type LaunchSend = Readonly<{ cluster: string; id: string; at: string }>;

const recordKey = (cluster: string, mint: string) => `${cluster}:${mint}`;
const buildKey = (cluster: string, id: string) => `${cluster}:${id}`;

/** The longest a build waits for the signature; the bytes' own life is shorter. */
export const DLMM_PRO_LAUNCH_BUILD_TTL_MS = 2 * 60 * 1000;
const ROUTE_MS = 50_000;
const FIRST_BUDGET = { confirmMs: 18_000, settleMs: 6_000 } as const;

export async function readDlmmProLaunchRecord(store: GuardStore, cluster: string, mint: string): Promise<DlmmProLaunchRecord | null> {
  return (await collection<DlmmProLaunchRecord>(store, DLMM_PRO_LAUNCH_COLLECTIONS.records).get(recordKey(cluster, mint))) ?? null;
}

/** Every launch on DLMM Pro on a network, as Ryntra keeps it — read-only, for the city's towers. */
export async function listDlmmProLaunchRecords(store: GuardStore, cluster: string): Promise<readonly DlmmProLaunchRecord[]> {
  return collection<DlmmProLaunchRecord>(store, DLMM_PRO_LAUNCH_COLLECTIONS.records).valuesWithPrefix(`${cluster}:`);
}

async function writeRecord(store: GuardStore, record: DlmmProLaunchRecord): Promise<void> {
  await collection<DlmmProLaunchRecord>(store, DLMM_PRO_LAUNCH_COLLECTIONS.records).set(recordKey(record.cluster, record.mint), record);
}

async function sweep(deps: DlmmProLaunchDeps): Promise<void> {
  const stale = deps.now().getTime() - 60 * 60 * 1000;
  const builds = collection<DlmmProBuildRecord>(deps.store, DLMM_PRO_LAUNCH_COLLECTIONS.builds);
  for (const build of await builds.valuesWithPrefix(`${deps.network.cluster}:`)) if (Date.parse(build.expiresAt) < stale) await builds.delete(buildKey(build.cluster, build.id));
  const sends = collection<LaunchSend>(deps.store, DLMM_PRO_LAUNCH_COLLECTIONS.sends);
  for (const send of await sends.valuesWithPrefix(`${deps.network.cluster}:`)) if (Date.parse(send.at) < stale) await sends.delete(buildKey(send.cluster, send.id));
}

/* ------------------------------------------------------------- the terms on a network */

/** The pair coin's mint on a network: wrapped SOL, or the network's own USDC — the one the Launch presets trade against. */
export function dlmmProQuoteMint(network: Pick<LaunchNetwork, "pairs" | "cluster">, pair: DlmmProLaunchPair): string | null {
  if (pair === "SOL") return WRAPPED_SOL_MINT;
  return Object.values(network.pairs).find((candidate) => candidate?.symbol === "USDC" && candidate.dollar)?.mint ?? null;
}

/** The tick a launch's first price lands on: the price's own tick, aligned down to the pool's spacing — as the program reads it. */
export function dlmmProInitialTick(venue: Pick<DlmmProVenue, "pools">, pair: DlmmProLaunchPair): number {
  const terms = DLMM_PRO_LAUNCH_TERMS;
  return venue.pools.tickOfPrice(dlmmProStartPrice(pair), terms.coin.decimals, terms.pairDecimals[pair], terms.tickSpacing);
}

/** The supply's shape on a launch's pool: from the first price up. */
export function dlmmProSupplyShape(initialTickId: number) {
  const terms = DLMM_PRO_LAUNCH_TERMS;
  return { strategy: terms.shape.strategy, minTickId: initialTickId, maxTickId: initialTickId + (terms.shape.columns - 1) * terms.tickSpacing } as const;
}

const ryntraOf = (deps: Pick<DlmmProLaunchDeps, "ryntra" | "network" | "env">): string | null => (deps.ryntra === undefined ? launchPartnerVault(deps.network, deps.env as NodeJS.ProcessEnv) : deps.ryntra);
const sourceOf = (deps: Pick<DlmmProLaunchDeps, "poolSource">): "launch" | "config" => deps.poolSource ?? DLMM_PRO_LAUNCH_POOL_SOURCE;
const venueOf = (deps: Pick<DlmmProLaunchDeps, "connection" | "network">): DlmmProVenue => createDlmmProVenue({ connection: deps.connection, referralOwner: deps.network.referralOwner });

/**
 * What a whole launch takes from its creator in lamports, reckoned before anything is on chain: the fees of its
 * transactions and the rent of everything it makes, at the cluster's own rate — never below what the three steps then
 * tell, which is held by the rehearsal. A position's rent never comes back: it is locked for ever.
 */
export async function dlmmProLaunchEstimate(
  connection: Pick<Connection, "getMinimumBalanceForRentExemption">,
  args: Readonly<{ name: string; symbol: string; uri: string; split: boolean; ladder?: boolean; /** The pool mines, its positions' slots and ticks are longer, and the supply's step sets the reward up. */ reward?: boolean }>,
): Promise<Readonly<{ feeLamports: number; rentLamports: number; /** Each step's own: its fees and the rent it leaves on chain. */ stages: Readonly<Record<DlmmProLaunchStage, number>> }>> {
  const [bare, oneByte] = await Promise.all([connection.getMinimumBalanceForRentExemption(0, "confirmed"), connection.getMinimumBalanceForRentExemption(1, "confirmed")]);
  const perByte = oneByte - bare;
  const sizes = DLMM_PRO_ACCOUNT_BYTES;
  const terms = DLMM_PRO_LAUNCH_TERMS;
  const account = (bytes: number) => bare + bytes * perByte;
  const positions = args.split ? 2 : 1;
  /* The tick arrays the shape stands in: its width over an array's, and one more for where it starts within one. */
  const arrays = Math.ceil((terms.shape.columns * terms.tickSpacing) / (TICKS_PER_ARRAY * terms.tickSpacing)) + 1;
  const coin = account(getMintLen([ExtensionType.MetadataPointer]) + metadataBytesOf(args.name, args.symbol, args.uri)) + account(sizes.tokenAccount2022);
  /* A pool that mines is longer by its reward slots, and so is every slot of a position and every tick on it. */
  const mines = args.reward === true;
  const slot = mines ? sizes.positionSlotWithRewards : sizes.positionSlot;
  const tick = mines ? sizes.tickWithRewards : sizes.tick;
  const pool = account(sizes.pool + sizes.poolActivation + (mines ? sizes.poolRewards : 0)) + account(sizes.oracle) + account(sizes.tokenAccount2022) + account(sizes.tokenAccount2022);
  const position = account(sizes.nftMint) + account(sizes.nftAccount) + account(sizes.positionHead) + terms.maxRanges * (slot + 2 * tick) * perByte;
  /* The creator's ladder: its NFT, its head, an entry and a tick for each price — inside the supply's tick arrays, which the positions make. */
  const ladder = args.ladder ? account(sizes.nftMint) + account(sizes.nftAccount) + account(sizes.orderHead) + terms.ladder.rungs * (sizes.orderEntry + tick) * perByte : 0;
  /* The reward: its slot's vault, a token account of the launch's coin. */
  const reward = mines ? account(sizes.tokenAccount2022) : 0;
  const supply = positions * position + arrays * account(sizes.tickArrayHead) + (args.split ? account(sizes.tokenAccount2022) : 0) + ladder + reward;
  /* Signatures: the coin (wallet and mint), the pool, each position (wallet and its NFT), the hand-over, the ladder (wallet and its NFT), the reward (wallet). */
  const supplySignatures = 2 * positions + (args.split ? 1 : 0) + (args.ladder ? 2 : 0) + (mines ? 1 : 0);
  const signatures = 2 + 1 + supplySignatures;
  const fee = (count: number) => count * LAMPORTS_PER_SIGNATURE;
  return {
    feeLamports: fee(signatures),
    rentLamports: coin + pool + supply,
    stages: { COIN: coin + fee(2), POOL: pool + fee(1), SUPPLY: supply + fee(supplySignatures) },
  };
}

/* ------------------------------------------------------------- the chain's word */

const REFUSALS: Partial<Record<DlmmProRefusal["code"], ApiErrorCode>> = { BALANCE_LOW: "LAUNCH_BALANCE_LOW", BAD_INPUT: "VALIDATION_ERROR", POOL_EXISTS: "VALIDATION_ERROR", AMOUNT_ZERO: "VALIDATION_ERROR" };

/** A venue's refusal in the contract's words; anything else is a read that failed. */
function refusalOf(error: unknown, what: string): DlmmProLaunchFailure {
  if (error instanceof DlmmProRefusal) return fail(REFUSALS[error.code] ?? "UNAVAILABLE", `${what}: ${error.message}`);
  return fail("UNAVAILABLE", error instanceof Error ? `${what}: ${error.message.slice(0, 300)}` : `${what}.`);
}

/** Who holds a position's NFT of the two the launch knows; null — neither, or it could not be read. */
async function holderOf(connection: Connection, nftMint: string, candidates: readonly string[]): Promise<string | null> {
  const mint = new PublicKey(nftMint);
  const accounts = candidates.map((owner) => getAssociatedTokenAddressSync(mint, new PublicKey(owner), true, TOKEN_2022_PROGRAM_ID));
  const infos = await connection.getMultipleAccountsInfo(accounts, "confirmed");
  const at = infos.findIndex((info) => info !== null && info.owner.equals(TOKEN_2022_PROGRAM_ID) && info.data.length >= 72 && Buffer.from(info.data).readBigUInt64LE(64) === 1n);
  return at < 0 ? null : candidates[at]!;
}

type PositionOnChain = Readonly<{ whole: boolean; lockedBps: number; liquidity: string; holder: string | null }>;

/** A launch's position as the chain holds it; null — no position lives at its NFT yet. */
async function positionOnChain(deps: Pick<DlmmProLaunchDeps, "connection">, venue: DlmmProVenue, record: Pick<DlmmProLaunchRecord, "pool" | "creator" | "ryntra">, nftMint: string): Promise<PositionOnChain | null> {
  let view;
  try {
    view = await venue.positions.read({ pool: record.pool, nftMint });
  } catch (error) {
    /* Nothing at the NFT's position address, or no pool yet: the position is not made. Anything else is a read that failed, and is said. */
    if (error instanceof DlmmProRefusal && (error.code === "BAD_INPUT" || error.code === "NO_POOL")) return null;
    throw error;
  }
  const liquidity = view.slots.reduce((sum, slot) => sum + BigInt(slot.liquidity), 0n);
  const holder = await holderOf(deps.connection, nftMint, [record.creator, ...(record.ryntra ? [record.ryntra] : [])]);
  return { whole: liquidity > 0n && view.lockedBps === 10_000, lockedBps: view.lockedBps, liquidity: liquidity.toString(), holder };
}

type ChainRead = Readonly<{ chain: DlmmProLaunchChain; pool: DlmmProPool | null; creatorPosition: PositionOnChain | null; ryntraPosition: PositionOnChain | null; ladder: OrderView | null; /** The pool's creator reward slot, as the pool reads; null — never set up, or no pool. */ rewardSlot: DlmmProReward | null }>;

/** The pool's creator reward slot, where it was set up. */
const rewardSlotOf = (pool: DlmmProPool | null): DlmmProReward | null => pool?.rewards.find((entry) => entry.index === DLMM_PRO_LAUNCH_TERMS.reward.slot) ?? null;

/** Whether a launch's reward is on chain: the creator slot pays the launch's coin and an emission is funded on it. */
const rewardFunded = (slot: DlmmProReward | null, mint: string): boolean => slot !== null && slot.mint === mint && slot.endsAt > 0 && BigInt(slot.emissionPerSecondX64) > 0n;

/** A launch's ladder as the chain holds it; null — no order lives at its NFT (not placed yet, or closed by its owner). */
async function ladderOnChain(venue: DlmmProVenue, pool: string, nftMint: string): Promise<OrderView | null> {
  try {
    return await venue.orders.read({ pool, nftMint });
  } catch (error) {
    if (error instanceof DlmmProRefusal && (error.code === "BAD_INPUT" || error.code === "NO_POOL")) return null;
    throw error;
  }
}

/**
 * What of a launch is on chain now: its coin, its pool, each position, the creator's ladder — read, never assumed from
 * the record's steps. The one thing the chain cannot say is whether an order no longer there ever rested: once trading
 * is open the order is its owner's to close, so a ladder gone from an open pool counts as rested only where the step
 * that placed it landed.
 */
async function chainOf(
  deps: Pick<DlmmProLaunchDeps, "connection" | "network"> & Partial<Pick<DlmmProLaunchDeps, "second">>,
  record: Pick<DlmmProLaunchRecord, "mint" | "pool" | "creator" | "ryntra" | "positions" | "ladder" | "opensAt"> & Partial<Pick<DlmmProLaunchRecord, "steps" | "reward">>,
): Promise<ChainRead> {
  const venue = venueOf(deps);
  const mintInfo = await deps.connection.getAccountInfo(new PublicKey(record.mint), "confirmed");
  const coin = mintInfo !== null && mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID);
  const pool = coin ? await venue.pools.read(record.pool, record.creator) : null;
  const creatorPosition = pool ? await positionOnChain(deps, venue, record, record.positions.creator) : null;
  const ryntraPosition = pool && record.positions.ryntra ? await positionOnChain(deps, venue, record, record.positions.ryntra) : null;
  const ladder = pool && record.ladder ? await ladderOnChain(venue, record.pool, record.ladder.nftMint) : null;
  const open = pool !== null && pool.at.unix >= record.opensAt;
  /* An order gone from an open pool rested if the step that placed it landed: the record's word for it, or — not settled yet — the chain's own word on the ladder's transaction. */
  let rested = record.ladder ? ladder !== null || (open && record.steps?.SUPPLY.state === "CONFIRMED") : false;
  if (record.ladder && !rested && open && record.ladder.signature) {
    const landed = (status: Awaited<ReturnType<Connection["getSignatureStatuses"]>>["value"][number] | undefined) => Boolean(status && status.err === null && (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized"));
    rested = landed((await deps.connection.getSignatureStatuses([record.ladder.signature], { searchTransactionHistory: true })).value[0]);
    /* A node that keeps no history says nothing of an old transaction: the archive is asked too, where there is one. */
    if (!rested && deps.second) rested = landed((await deps.second.getSignatureStatuses([record.ladder.signature], { searchTransactionHistory: true })).value[0]);
  }
  return {
    chain: {
      coin,
      pool: pool !== null,
      creatorPosition: creatorPosition?.whole === true,
      ryntraPosition: record.ryntra === null ? null : { made: ryntraPosition?.whole === true, handed: ryntraPosition?.whole === true && ryntraPosition.holder === record.ryntra },
      ladder: record.ladder ? rested : null,
      reward: record.reward ? rewardFunded(rewardSlotOf(pool), record.mint) : null,
    },
    pool,
    creatorPosition,
    ryntraPosition,
    ladder,
    rewardSlot: rewardSlotOf(pool),
  };
}

/* ------------------------------------------------------------ the build */

export type PrepareDlmmProLaunchInput = Readonly<{
  creator: string;
  /** A new launch: the stored metadata, the pair, and — optionally — when trading opens (unix seconds). */
  metadataUri?: string;
  pair?: DlmmProLaunchPair;
  opensAt?: number | null;
  /** A new launch: whether the creator's take-profit ladder rests a twentieth of the supply before the opening. Absent — no ladder. */
  ladder?: boolean;
  /**
   * A new launch: the reward for the pool's liquidity — a share of the supply, basis points, paid to the
   * liquidity at the price over whole days from the opening. Absent or null — none. Asked only where the switch is open.
   */
  reward?: DlmmProRewardAsk | null;
  /** A launch already begun: its coin. The build is then the step the chain shows is next. */
  mint?: string;
}>;

export type PreparedDlmmProLaunch = Readonly<{
  ok: true;
  buildId: string;
  stage: DlmmProLaunchStage;
  /** The step's transactions, for the creator's wallet to sign in one go; no other signature on them yet. */
  unsignedWireBase64: readonly string[];
  mint: string;
  pool: string;
  pair: DlmmProLaunchPair;
  opensAt: number;
  /** This step's own cost, as its build tells it. */
  feeLamports: number;
  rentLamports: number;
  /** The whole launch: what is left to pay from this step on — this step's own numbers, and the reckoning of the steps after it. */
  remainingLamports: string;
  /** The fee against snipers: where it starts and — once the pool is built — where it really settles. */
  fee: Readonly<{ startBps: number; endBps: number | null; askedEndBps: number; priceMultiple: number }>;
  /** The creator's and Ryntra's parts of the locked liquidity's fees; null — the launch has no split. */
  split: Readonly<{ creatorBps: number; ryntraBps: number }> | null;
  /** The creator's ladder: its share of the supply and where it sells, multiples of the first price; null — none. */
  ladder: DlmmProLadderTold | null;
  /** The reward for the pool's liquidity, as the creator is told it before signing; null — none. */
  reward: DlmmProRewardTold | null;
  expiresAt: string;
  signableMs: number;
}>;

/**
 * The reward for the pool's liquidity as a person is told it before signing: its share of the supply, its
 * coins, its days, and — from the supply's step on — the window it runs for, unix seconds. To whom and whether it
 * comes back are the program's, the same for every launch: the liquidity at the price, the launch's own locked
 * liquidity among it; never back, but for what was emitted while nobody's liquidity stood at the price.
 */
export type DlmmProRewardTold = Readonly<{
  shareBps: number;
  amountRaw: string;
  days: number;
  opensAt: number | null;
  endsAt: number | null;
  /** A day of it, base units. */
  perDayRaw: string;
  /**
   * Who earns it while the launch's own locked liquidity is the only liquidity at the price — the creator's
   * position and Ryntra's, basis points (`dlmmProRewardLockedShare`): the program cannot leave a position out.
   */
  locked: Readonly<{ creatorBps: number; ryntraBps: number }>;
}>;

const rewardTold = (reward: DlmmProRewardRecord | null | undefined, split: boolean): DlmmProRewardTold | null =>
  reward
    ? { shareBps: reward.shareBps, amountRaw: reward.amountRaw, days: reward.days, opensAt: reward.opensAt, endsAt: reward.endsAt, perDayRaw: dlmmProRewardPerDayRaw(BigInt(reward.amountRaw), reward.days).toString(), locked: dlmmProRewardLockedShare(split) }
    : null;

/** The creator's ladder as a person is told it before signing: its share of the supply, the coins, and the prices it sells at — multiples of the first. */
export type DlmmProLadderTold = Readonly<{ shareBps: number; amountRaw: string; nearMultiple: number; farMultiple: number; rungs: number }>;

/** The creator's ladder told, where the launch has one. */
function ladderTold(ladder: DlmmProLadderRecord | null | undefined): DlmmProLadderTold | null {
  if (!ladder) return null;
  const terms = DLMM_PRO_LAUNCH_TERMS.ladder;
  return { shareBps: terms.shareBps, amountRaw: ladder.amountRaw, nearMultiple: 1 + terms.nearBps / 10_000, farMultiple: 1 + terms.farBps / 10_000, rungs: terms.rungs };
}

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** A sealed transaction as the build record keeps it. */
const builtOf = (tx: DlmmProTx, role: string, makes: BuiltTx["makes"], config = false): BuiltTx => ({ wireBase64: tx.wireBase64, validUntil: tx.validUntil ?? "0", role, makes, config });

const stepsOf = (): Record<DlmmProLaunchStage, DlmmProStep> => {
  const none: DlmmProStep = { signatures: [], state: "NOT_SENT", reason: null, feeLamports: 0, rentLamports: 0 };
  return { COIN: none, POOL: none, SUPPLY: none };
};

/** The steps after `stage`, reckoned: each later step's own estimate. */
function laterLamports(stages: Readonly<Record<DlmmProLaunchStage, number>>, stage: DlmmProLaunchStage): number {
  const order: readonly DlmmProLaunchStage[] = ["COIN", "POOL", "SUPPLY"];
  return order.slice(order.indexOf(stage) + 1).reduce((sum, later) => sum + stages[later], 0);
}

/**
 * The steps the chain shows as landed, written into a launch's record — a step that was sent and not answered for in
 * time, or finished by a later send, is settled here. Returns the record as written; the same record where nothing
 * changed.
 */
async function settleSteps(store: GuardStore, cluster: string, mint: string, chain: DlmmProLaunchChain): Promise<DlmmProLaunchRecord | null> {
  const landed: Readonly<Record<DlmmProLaunchStage, boolean>> = { COIN: chain.coin, POOL: chain.pool, SUPPLY: dlmmProNextStage(chain) === null };
  /* The record as it is now, read just before the write: only its steps' states change — never a field another send wrote meanwhile. */
  const record = await readDlmmProLaunchRecord(store, cluster, mint);
  if (!record) return null;
  let steps = record.steps;
  for (const stage of ["COIN", "POOL", "SUPPLY"] as const) {
    if (landed[stage] && steps[stage].state !== "CONFIRMED") steps = { ...steps, [stage]: { ...steps[stage], state: "CONFIRMED", reason: null } };
  }
  if (steps === record.steps) return record;
  const settled = { ...record, steps };
  await writeRecord(store, settled);
  return settled;
}

/** The least an opening lies ahead of the chain when the pool is built: the program's two minutes, and room for the supply's step. */
const POOL_OPENING_MARGIN_SECONDS = 180;

export async function prepareDlmmProLaunch(deps: DlmmProLaunchDeps, input: PrepareDlmmProLaunchInput): Promise<PreparedDlmmProLaunch | DlmmProLaunchFailure> {
  if (!dlmmProLaunchOpenFor(deps.network, deps.ownerWord)) return fail("LAUNCH_PAUSED", "A launch into a pool is not open here; nothing was built.");
  if (!BASE58.test(input.creator)) return fail("VALIDATION_ERROR", "The creator is not an address.");
  if (!ticketKeyConfigured(deps.env)) return fail("LAUNCH_PAUSED", "Launching is paused; nothing was built.");
  await sweep(deps).catch(() => undefined);
  const venue = venueOf(deps);
  const terms = DLMM_PRO_LAUNCH_TERMS;

  /* ---- a launch already begun: the step the chain shows is next ---- */
  let record: DlmmProLaunchRecord | null = null;
  if (input.mint !== undefined) {
    if (!BASE58.test(input.mint)) return fail("VALIDATION_ERROR", "The coin is not an address.");
    if (input.reward) return fail("VALIDATION_ERROR", "A launch already begun keeps the reward it was begun with.");
    record = await readDlmmProLaunchRecord(deps.store, deps.network.cluster, input.mint);
    if (!record) return fail("LAUNCH_NOT_FOUND", "No launch of this coin here.");
    if (record.creator !== input.creator) return fail("WALLET_MISMATCH", "This launch is another wallet's.");
    if (await isTakenDown(deps.store, "mint", record.mint)) return fail("VALIDATION_ERROR", "Ryntra took this launch down; nothing was built.");
  }

  let clock: Awaited<ReturnType<DlmmProVenue["positions"]["clockOf"]>>;
  try {
    clock = await venue.positions.clockOf();
  } catch (error) {
    return refusalOf(error, "The chain's clock could not be read");
  }
  const chainNow = Number(clock.unix);

  let draft: Omit<DlmmProLaunchRecord, "steps" | "createdAt">;
  let stage: DlmmProLaunchStage;
  let read: ChainRead | null = null;
  if (record) {
    try {
      read = await chainOf(deps, record);
    } catch (error) {
      return refusalOf(error, "The launch could not be read from the chain");
    }
    const next = dlmmProNextStage(read.chain);
    /* What the chain shows landed is written as landed — a step whose send was not answered for is settled here too. */
    await settleSteps(deps.store, record.cluster, record.mint, read.chain).catch(() => null);
    if (next === null) return fail("VALIDATION_ERROR", "This launch is on chain whole; there is nothing left to sign.");
    /* A coin that is not on chain under a record means its creation never landed: the launch is begun anew, with a new coin. */
    if (next === "COIN") return fail("LAUNCH_NOT_FOUND", "This launch's coin never reached the chain; start the launch again.");
    stage = next;
    const { steps: _steps, createdAt: _createdAt, ...rest } = record;
    draft = rest;
    if (stage === "POOL" && draft.opensAt < chainNow + POOL_OPENING_MARGIN_SECONDS) {
      /*
       * The pool is still to be built and its opening is too close for it — the creator came back late. The opening is
       * the pool's to fix, not the coin's: it moves to the creator's new moment, or a quarter of an hour from now, and
       * the build says the new time before the signature.
       */
      const moved = dlmmProOpensAt(chainNow, input.opensAt);
      if (moved === null) return fail("VALIDATION_ERROR", `Trading opens no sooner than ${terms.opening.minAfter / 60} minutes from now and no later than ${terms.opening.maxAfter / 86_400} days.`);
      draft = { ...draft, opensAt: moved };
    }
    /* The supply goes only into the pool this launch's own step made: a pool made some other way is not the launch its creator was shown. */
    if (stage === "SUPPLY") {
      /* The supply goes only into the pool this launch's own step made, on the launch's own terms — the pool's half of the honest check, asked of the chain now. */
      if (draft.fee === null) return fail("VALIDATION_ERROR", "This launch's pool was not made by its own step; the supply does not go into it.");
      const wrong = dlmmProPoolProblems(poolFactsOf(venue, record, read.pool!));
      if (wrong.length) return fail("VALIDATION_ERROR", `This launch's pool is not the one its creator was shown (${wrong.join("; ")}); the supply does not go into it.`);
    }
  } else {
    /* ---- a new launch: its details, its pair, its opening ---- */
    if (!input.metadataUri) return fail("VALIDATION_ERROR", "A launch needs its coin's details.");
    const pair = input.pair ?? "SOL";
    if (pair !== "SOL" && pair !== "USDC") return fail("VALIDATION_ERROR", "A launch pairs with SOL or USDC.");
    const quoteMint = dlmmProQuoteMint(deps.network, pair);
    if (!quoteMint) return fail("LAUNCH_PAUSED", "This pair is not offered here; nothing was built.");
    const opensAt = dlmmProOpensAt(chainNow, input.opensAt);
    if (opensAt === null) return fail("VALIDATION_ERROR", `Trading opens no sooner than ${terms.opening.minAfter / 60} minutes from now and no later than ${terms.opening.maxAfter / 86_400} days.`);
    const stored = await metadataOfUri(deps.store, input.metadataUri, deps.origin);
    if (!stored) return fail("LAUNCH_NOT_FOUND", "The coin's details were not found; fill the form again.");
    if (stored.takenDown) return fail("VALIDATION_ERROR", "Ryntra does not launch a coin with these details.");
    const check = checkLaunchForm({ name: stored.metadata.name, symbol: stored.metadata.symbol, description: stored.metadata.description, website: "", x: "", telegram: "" });
    if (check.problems.name === "OFFENSIVE" || check.problems.symbol === "OFFENSIVE") return fail("VALIDATION_ERROR", "Ryntra does not launch a coin under this name or ticker.");
    if (check.hits.length) return fail("LAUNCH_NAME_BORROWED", `The name or ticker reads as ${check.hits.map((hit) => hit.label).join(", ")}.`);
    const day = deps.now().getTime() - 24 * 60 * 60 * 1000;
    const mine = (await listDlmmProLaunchRecords(deps.store, deps.network.cluster)).filter((entry) => entry.creator === input.creator && Date.parse(entry.createdAt) >= day);
    if (mine.length >= LAUNCHES_PER_CREATOR_PER_DAY) return fail("LAUNCH_LIMIT", `One wallet launches at most ${LAUNCHES_PER_CREATOR_PER_DAY} coins a day.`);
    const source = sourceOf(deps);
    if (source === "config" && !deps.config) return fail("LAUNCH_PAUSED", "Launching is paused; nothing was built.");
    /* The reward: only where its switch is open, only on a launch pool — the one it was rehearsed on —, and only as the terms allow. */
    const reward = input.reward ?? null;
    if (reward) {
      if (!dlmmProLaunchRewardOpenFor(deps.network, deps.env, deps.rewardWord ?? DLMM_PRO_LAUNCH_REWARD_MAINNET)) return fail("LAUNCH_PAUSED", "The reward for the pool's liquidity is not offered here; nothing was built.");
      if (source !== "launch") return fail("LAUNCH_PAUSED", "The reward for the pool's liquidity is not offered here; nothing was built.");
      const problem = dlmmProRewardProblem(reward);
      if (problem) return fail("VALIDATION_ERROR", problem);
    }
    const ryntra = ryntraOf(deps);
    if (ryntra !== null && (!BASE58.test(ryntra) || ryntra === input.creator)) return fail("LAUNCH_PAUSED", "Launching is paused; nothing was built.");
    /* The fresh keys of the whole launch, made once: the coin's mint, each position's NFT, and the ladder's where the creator asked for one. */
    const keys = { mint: Keypair.generate(), creator: Keypair.generate(), ryntra: Keypair.generate(), ladder: input.ladder === true ? Keypair.generate() : null };
    const cosigners: Cosigner[] = [
      { index: 0, key: keys.mint },
      { index: 1, key: keys.creator },
      { index: 2, key: keys.ryntra },
      ...(keys.ladder ? [{ index: 3, key: keys.ladder }] : []),
    ];
    const cosign = sealCosigners(cosigners, deps.env);
    if (!cosign) return fail("LAUNCH_PAUSED", "Launching is paused; nothing was built.");
    const mint = keys.mint.publicKey.toBase58();
    const config = source === "config" ? deps.config!.address : null;
    draft = {
      cluster: deps.network.cluster,
      mint,
      creator: input.creator,
      pair,
      quoteMint,
      name: stored.metadata.name,
      symbol: stored.metadata.symbol,
      metadataUri: input.metadataUri,
      pool: config ? venue.pools.configPoolAddress(config, mint, quoteMint) : venue.pools.launchPoolAddress(mint, quoteMint),
      poolSource: source,
      config,
      opensAt,
      initialTickId: dlmmProInitialTick(venue, pair),
      fee: null,
      ryntra,
      positions: { creator: keys.creator.publicKey.toBase58(), ryntra: ryntra ? keys.ryntra.publicKey.toBase58() : null },
      ladder: keys.ladder ? { nftMint: keys.ladder.publicKey.toBase58(), amountRaw: dlmmProLadderRaw(true).toString(), order: null } : null,
      reward: reward ? { shareBps: reward.shareBps, days: reward.days, amountRaw: dlmmProRewardRaw(reward.shareBps).toString(), opensAt: null, endsAt: null } : null,
      cosign,
    };
    stage = "COIN";
  }

  const creator = new PublicKey(draft.creator);
  const split = draft.ryntra !== null;
  let estimate: Awaited<ReturnType<typeof dlmmProLaunchEstimate>>;
  let blockhash: Readonly<{ blockhash: string; lastValidBlockHeight: number }>;
  try {
    [estimate, blockhash] = await Promise.all([dlmmProLaunchEstimate(deps.connection, { name: draft.name, symbol: draft.symbol, uri: draft.metadataUri, split, ladder: Boolean(draft.ladder), reward: Boolean(draft.reward) }), deps.connection.getLatestBlockhash("confirmed")]);
  } catch (error) {
    return refusalOf(error, "The network could not be read");
  }

  const txs: BuiltTx[] = [];
  let feeLamports = 0;
  let rentLamports = 0;
  /* How the estimate divides between the steps, basis points: the coin and the pool are small, the positions are the launch's rent. */
  try {
    if (stage === "COIN") {
      const mint = new PublicKey(draft.mint);
      const mintBytes = getMintLen([ExtensionType.MetadataPointer]) + metadataBytesOf(draft.name, draft.symbol, draft.metadataUri);
      const instructions = mintInstructions({ creator, mint, rules: { supply: terms.coin.supply }, name: draft.name, symbol: draft.symbol, uri: draft.metadataUri, rentLamports: await deps.connection.getMinimumBalanceForRentExemption(mintBytes, "confirmed") });
      /* The mint used thirty thousand units in the rehearsal of 14.11: twice that is its ceiling. */
      const sealed = await seal({ connection: deps.connection, wallet: creator, instructions, units: 60_000, fresh: [mint], options: { blockhash } });
      const cost = await assertAffords(deps.connection, creator, [], { fee: BigInt(sealed.feeLamports), instructions, accounts: [mintBytes] });
      feeLamports = sealed.feeLamports;
      rentLamports = cost.rentLamports - cost.rentReturnedLamports;
      /* The whole launch before its first signature: a wallet that cannot pay for the pool and the supply is told now — never left with a coin and no pool. */
      const whole = BigInt(estimate.feeLamports + estimate.rentLamports);
      const holds = BigInt(await deps.connection.getBalance(creator, "confirmed"));
      if (holds < whole) return fail("LAUNCH_BALANCE_LOW", `The wallet holds ${holds.toString()} lamports; the whole launch takes about ${whole.toString()} with its fees and the rent of what it creates.`);
      txs.push(builtOf(sealed, "COIN", { address: draft.mint, owner: TOKEN_2022_PROGRAM_ID.toBase58() }));
    } else if (stage === "POOL") {
      /* The opening is the launch's own, said at its first step: a pool is never made for a time nobody was shown. */
      const request = {
        wallet: draft.creator,
        tokenX: draft.mint,
        tokenY: draft.quoteMint,
        tickSpacing: terms.tickSpacing,
        initialTickId: draft.initialTickId,
        baseFee: terms.fee,
        dynamicFee: true,
        collectFee: "tokenY",
        opening: { swapAt: draft.opensAt, depositor: draft.creator },
        /* The pool mines only where the launch pays a reward: a pool is made once and for ever. */
        liquidityMining: Boolean(draft.reward),
      } as const;
      const built = draft.poolSource === "config" ? await venue.pools.buildConfigPool({ ...request, config: draft.config!, authority: deps.config!.signer.address }, { blockhash }) : await venue.pools.buildLaunchPool(request, { blockhash });
      if (built.pool !== draft.pool) return fail("UNAVAILABLE", "The pool was built at another address than the launch's; nothing was built.");
      feeLamports = built.feeLamports;
      rentLamports = built.rentLamports - built.rentReturnedLamports;
      draft = { ...draft, fee: { startBps: terms.fee.startBps, endBps: built.parameters.endFeeBps, askedEndBps: built.parameters.askedEndFeeBps, settles: built.parameters.settles, dynamicCeilingBps: built.parameters.dynamicCeilingBps } };
      txs.push(builtOf(built, "POOL", { address: draft.pool, owner: DLMM_PRO_PROGRAM }, draft.poolSource === "config"));
    } else {
      const parts = dlmmProSupplyParts(split, Boolean(draft.ladder), draft.reward ? BigInt(draft.reward.amountRaw) : 0n);
      const shape = dlmmProSupplyShape(draft.initialTickId);
      const pool = read!.pool!;
      /* The supply goes in above a price that has not moved: exactly what each position takes, no band. A pool that has traded is not this launch any more. */
      if (pool.tickId !== draft.initialTickId || pool.sqrtPriceX64 !== pool.initSqrtPriceX64) return fail("VALIDATION_ERROR", "The pool's price has moved before the supply went in; this launch cannot be completed here.");
      const open = (nftMint: string, amountRaw: bigint, handOverTo: string | null) =>
        venue.positions.open({ pool: draft.pool, wallet: draft.creator, nftMint, shape, amountXRaw: amountRaw.toString(), amountYRaw: "0", slippageBps: 0, lockBps: 10_000, maxRanges: terms.maxRanges, ...(handOverTo ? { handOverTo } : {}) }, { blockhash });
      /* A tick array's head, in lamports: what the second of two positions on the same ticks is told and does not pay — the first has made the arrays. */
      const arrayHead = await deps.connection.getMinimumBalanceForRentExemption(DLMM_PRO_ACCOUNT_BYTES.tickArrayHead, "confirmed");
      let made = 0;
      const position = (nftMint: string, built: Awaited<ReturnType<typeof open>>) => {
        /* A position is on chain whole or not at all: opened, filled and locked by one transaction. */
        const first = built.packed[0];
        if (!first || !(["OPEN", "DEPOSIT", "LOCK"] as const).every((role) => first.roles.includes(role))) throw new DlmmProRefusal("TX_TOO_LARGE", "The position does not open, fill and lock in one transaction.");
        feeLamports += built.packed.reduce((sum, tx) => sum + tx.feeLamports, 0);
        rentLamports += built.rentLamports - built.rentReturnedLamports - (made > 0 ? Math.min(made, built.newTickArrays) * arrayHead : 0);
        made += built.newTickArrays;
        built.packed.forEach((tx, index) => {
          const makes = index === 0 ? { address: built.position, owner: DLMM_PRO_PROGRAM } : { address: built.handedTo!.nftAccount, owner: TOKEN_2022_PROGRAM_ID.toBase58(), holdsOne: true };
          txs.push(builtOf(tx, tx.roles.join("+"), makes));
        });
        return nftMint;
      };
      if (!read!.chain.creatorPosition) {
        if (read!.creatorPosition) return fail("UNAVAILABLE", "The creator's position is on chain half-made; this launch cannot be completed here.");
        position(draft.positions.creator, await open(draft.positions.creator, parts.creatorRaw, null));
      }
      if (split) {
        const theirs = read!.chain.ryntraPosition!;
        if (!theirs.made) {
          if (read!.ryntraPosition) return fail("UNAVAILABLE", "The second position is on chain half-made; this launch cannot be completed here.");
          position(draft.positions.ryntra!, await open(draft.positions.ryntra!, parts.ryntraRaw, draft.ryntra));
        } else if (!theirs.handed) {
          const handed = await venue.positions.handOver({ pool: draft.pool, nftMint: draft.positions.ryntra!, owner: draft.creator, to: draft.ryntra! }, { blockhash });
          feeLamports += handed.feeLamports;
          rentLamports += handed.rentLamports - handed.rentReturnedLamports;
          txs.push(builtOf(handed, "HANDOVER", { address: handed.handedTo.nftAccount, owner: TOKEN_2022_PROGRAM_ID.toBase58(), holdsOne: true }));
        }
      }
      if (draft.ladder && read!.chain.ladder === false) {
        /*
         * The creator's take-profit ladder: the creator's twentieth of the supply, resting before the
         * opening as a sell order on fixed ticks — the price stands still until then — from twice the first price to
         * ten times it. The creator collects what fills; Ryntra's fifth of the maker's share comes from the order's own
         * referral. Only the creator may place it before the opening; the order's NFT is the launch's own fresh key.
         */
        const ladder = DLMM_PRO_LAUNCH_TERMS.ladder;
        const built = await venue.orders.placeIntent(
          { pool: draft.pool, coin: draft.mint, action: "sell", nearBps: ladder.nearBps, farBps: ladder.farBps, rungs: ladder.rungs, spread: ladder.spread, corridorBps: null, amountRaw: draft.ladder.amountRaw, wallet: draft.creator, nftMint: draft.ladder.nftMint, delegate: null },
          { blockhash },
        );
        feeLamports += built.feeLamports;
        rentLamports += built.rentLamports - built.rentReturnedLamports;
        /* The ladder's prices lie inside the supply's shape: where the positions make their tick arrays in this same step, the ladder's build counted them too. */
        if (made > 0) {
          const span = TICKS_PER_ARRAY * terms.tickSpacing;
          rentLamports -= Math.min(made, new Set(built.ticks.map((tick) => Math.floor(tick.tickId / span))).size) * arrayHead;
        }
        draft = { ...draft, ladder: { ...draft.ladder, order: built.order } };
        txs.push(builtOf(built, "LADDER", { address: built.order, owner: DLMM_PRO_PROGRAM }));
      }
      if (draft.reward && read!.chain.reward === false) {
        /*
         * The reward for the pool's liquidity: the pool's creator slot set up with the launch's coin and its
         * emission funded, in one transaction of this same approval — from the opening, or two minutes past the chain's
         * clock where the creator signs this late, for the days asked. A slot set up some other way is not this launch.
         */
        if (read!.rewardSlot) return fail("UNAVAILABLE", "The pool's reward was set up outside this launch; this launch cannot be completed here.");
        const opensAt = Math.max(draft.opensAt, chainNow + REWARD_START_MARGIN_SECONDS);
        const built = await buildLaunchReward(deps.connection, { pool: draft.pool, creator: draft.creator, mint: draft.mint, amountRaw: BigInt(draft.reward.amountRaw), seconds: dlmmProRewardSeconds(draft.reward.days), opensAt }, { blockhash });
        feeLamports += built.feeLamports;
        rentLamports += built.rentLamports - built.rentReturnedLamports;
        draft = { ...draft, reward: { ...draft.reward, opensAt: built.opensAt, endsAt: built.endsAt } };
        txs.push(builtOf(built, "REWARD", { address: built.vault, owner: TOKEN_2022_PROGRAM_ID.toBase58() }));
      }
      /* Each position's build was held to the wallet on its own; together they are held to it once more. */
      const holds = BigInt(await deps.connection.getBalance(creator, "confirmed"));
      if (holds < BigInt(feeLamports + rentLamports)) return fail("LAUNCH_BALANCE_LOW", `The wallet holds ${holds.toString()} lamports; the supply takes ${feeLamports + rentLamports} with its fees and the rent of what it creates.`);
    }
  } catch (error) {
    return refusalOf(error, "The launch was not built");
  }
  if (txs.length === 0) return fail("VALIDATION_ERROR", "There is nothing left to sign for this launch.");

  const windows = await readBuildWindows(web3ChainReader(deps.connection), txs[0]!.validUntil, { transactions: txs.length, capMs: DLMM_PRO_LAUNCH_BUILD_TTL_MS });
  const now = deps.now();
  const build: DlmmProBuildRecord = {
    id: randomBytes(16).toString("hex"),
    cluster: deps.network.cluster,
    creator: draft.creator,
    mint: draft.mint,
    stage,
    txs,
    feeLamports,
    rentLamports,
    launch: draft,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + Math.max(0, windows.lifeMs - NEXT_TRANSACTION_MARGIN_MS * (txs.length - 1))).toISOString(),
  };
  await collection<DlmmProBuildRecord>(deps.store, DLMM_PRO_LAUNCH_COLLECTIONS.builds).insertIfAbsent(buildKey(build.cluster, build.id), build);
  return {
    ok: true,
    buildId: build.id,
    stage,
    unsignedWireBase64: txs.map((tx) => tx.wireBase64),
    mint: draft.mint,
    pool: draft.pool,
    pair: draft.pair,
    opensAt: draft.opensAt,
    feeLamports,
    rentLamports,
    remainingLamports: (feeLamports + rentLamports + laterLamports(estimate.stages, stage)).toString(),
    fee: { startBps: terms.fee.startBps, endBps: draft.fee?.endBps ?? null, askedEndBps: terms.fee.endBps, priceMultiple: terms.fee.priceMultiple },
    split: split ? { creatorBps: terms.split.creatorBps, ryntraBps: terms.split.ryntraBps } : null,
    ladder: ladderTold(draft.ladder),
    reward: rewardTold(draft.reward, split),
    expiresAt: build.expiresAt,
    signableMs: windows.signableMs,
  };
}

/* ------------------------------------------------------------- the send */

/**
 * The creator's signed bytes against a built transaction: the same message, or the same with only what a wallet may
 * add on signing (`compareWalletTransaction`); the creator the fee payer, its signature real. Then the fresh keys the
 * message names sign over the exact message the creator signed — and, for a pool from a config, the config's wallet —
 * and every signature must be real.
 */
export async function signedAsBuilt(signedWireBase64: string, built: Pick<BuiltTx, "wireBase64" | "config">, creator: string, keys: readonly Keypair[], config: DlmmProConfigSigner | null): Promise<VersionedTransaction | DlmmProLaunchFailure> {
  const other = () => fail("LAUNCH_SIGNED_OTHER_BYTES", "The wallet signed a different transaction than the one built.");
  const verdict = compareWalletTransaction({ expectedWireBase64: built.wireBase64, actualWireBase64: signedWireBase64, guardPolicy: "BOUNDED" });
  if (verdict.verdict !== "EXACT" && verdict.verdict !== "WALLET_GUARDS_ONLY") return other();
  let tx: VersionedTransaction;
  try {
    tx = VersionedTransaction.deserialize(Buffer.from(signedWireBase64, "base64"));
  } catch {
    return fail("LAUNCH_SIGNED_OTHER_BYTES", "The wallet returned bytes that are not a transaction.");
  }
  const message = tx.message.serialize();
  const signers = tx.message.staticAccountKeys.slice(0, tx.message.header.numRequiredSignatures);
  const real = (at: number) => {
    const signature = tx.signatures[at];
    return Boolean(signature) && signature!.some((byte) => byte !== 0) && ed25519Valid(message, signature!, signers[at]!);
  };
  /* The creator first: the fee payer, its signature over these very bytes, before any key of the server's signs them. */
  if (signers[0]?.toBase58() !== creator || !real(0)) return fail("LAUNCH_SIGNED_OTHER_BYTES", "The transaction is not signed by the creator.");
  const needed = keys.filter((key) => signers.some((signer) => signer.equals(key.publicKey)));
  try {
    if (needed.length) tx.sign(needed);
    if (built.config) {
      if (!config) return fail("LAUNCH_PAUSED", "Launching is paused; nothing was sent.");
      tx.addSignature(new PublicKey(config.address), await config.signMessage(message));
    }
  } catch {
    return other();
  }
  if (signers.some((_, at) => !real(at))) return fail("LAUNCH_SIGNED_OTHER_BYTES", "A signature does not match the transaction.");
  return tx;
}

const sendableOf = (tx: VersionedTransaction): Sendable => ({ serialize: () => tx.serialize(), signatures: tx.signatures.map((signature) => ({ signature })), recentBlockhash: tx.message.recentBlockhash });

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
/** A signature's 64 bytes as base58 — a transaction's id. */
function base58Of(bytes: Uint8Array): string {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  let text = "";
  while (value > 0n) {
    text = ALPHABET[Number(value % 58n)] + text;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    text = `1${text}`;
  }
  return text;
}

export type SubmittedDlmmProLaunch = Readonly<{
  ok: true;
  mint: string;
  pool: string;
  stage: DlmmProLaunchStage;
  /** CONFIRMED — the step is on chain; PENDING — sent and not answered for in time, the next build settles it from the chain; FAILED — a transaction of the step did not land. */
  state: "CONFIRMED" | "PENDING" | "FAILED";
  signatures: readonly string[];
  reason: string | null;
  /** The step the launch waits for now; null — it is on chain whole. */
  next: DlmmProLaunchStage | null;
  opensAt: number;
}>;

export async function submitDlmmProLaunch(deps: DlmmProLaunchDeps, input: Readonly<{ buildId: string; creator: string; signedWireBase64: readonly string[] }>): Promise<SubmittedDlmmProLaunch | DlmmProLaunchFailure> {
  if (!dlmmProLaunchOpenFor(deps.network, deps.ownerWord)) return fail("LAUNCH_PAUSED", "A launch into a pool is not open here; nothing was sent.");
  const deadline = deps.now().getTime() + ROUTE_MS;
  const build = await collection<DlmmProBuildRecord>(deps.store, DLMM_PRO_LAUNCH_COLLECTIONS.builds).get(buildKey(deps.network.cluster, input.buildId));
  if (!build || build.cluster !== deps.network.cluster) return fail("LAUNCH_NOT_FOUND", "This launch was not built here.");
  if (build.creator !== input.creator) return fail("WALLET_MISMATCH", "This launch was built for another wallet.");
  if (Date.parse(build.expiresAt) < deps.now().getTime()) return fail("LAUNCH_BUILD_EXPIRED", "The launch waited too long for the signature; build it again.");
  if (await isTakenDown(deps.store, "mint", build.mint)) return fail("VALIDATION_ERROR", "Ryntra took this launch down; nothing was sent.");
  if (input.signedWireBase64.length !== build.txs.length) return fail("LAUNCH_SIGNED_OTHER_BYTES", "The wallet did not sign every transaction of the step.");
  const sealed = openCosigners(build.launch.cosign, deps.env);
  if (!sealed) return fail("LAUNCH_BUILD_EXPIRED", "The launch can no longer be signed; build it again.");
  const keys = sealed.map((cosigner) => cosigner.key);
  const config = build.launch.poolSource === "config" ? (deps.config?.signer ?? null) : null;
  const txs: VersionedTransaction[] = [];
  for (const [index, built] of build.txs.entries()) {
    const signed = await signedAsBuilt(input.signedWireBase64[index]!, built, build.creator, keys, config);
    if ("ok" in signed) return signed;
    txs.push(signed);
  }
  const sends = collection<LaunchSend>(deps.store, DLMM_PRO_LAUNCH_COLLECTIONS.sends);
  if (!(await sends.insertIfAbsent(buildKey(build.cluster, build.id), { cluster: build.cluster, id: build.id, at: deps.now().toISOString() }))) return fail("LAUNCH_BUILD_USED", "This step was already sent.");

  const existing = await readDlmmProLaunchRecord(deps.store, build.cluster, build.mint);
  const base: Omit<DlmmProLaunchRecord, "steps"> = { ...build.launch, createdAt: existing?.createdAt ?? deps.now().toISOString() };
  /* A build made before an earlier send wrote the ladder's signature does not carry it: what the record already keeps of the ladder stays. */
  if (base.ladder && !base.ladder.signature && existing?.ladder?.signature && existing.ladder.nftMint === base.ladder.nftMint) Object.assign(base, { ladder: { ...base.ladder, signature: existing.ladder.signature } });
  let steps: Record<DlmmProLaunchStage, DlmmProStep> = { ...(existing?.steps ?? stepsOf()) };
  const signatures = txs.map((tx) => base58Of(tx.signatures[0]!));
  /*
   * A step may take more than one send — the supply whose hand-over did not land is finished by a second one — so what
   * the record keeps of a step adds up: the signatures that landed before stay, and the cost its builds told is the
   * sum of them.
   */
  const earlier = existing?.steps[build.stage];
  const kept = earlier && earlier.state !== "NOT_SENT" ? earlier : null;
  const stepWith = (state: DlmmProStepState, reason: string | null, sent: readonly string[]): DlmmProStep => ({
    signatures: [...(kept?.signatures ?? []), ...sent.filter((signature) => !(kept?.signatures ?? []).includes(signature))],
    state,
    reason,
    feeLamports: (kept?.feeLamports ?? 0) + build.feeLamports,
    rentLamports: (kept?.rentLamports ?? 0) + build.rentLamports,
  });
  steps = { ...steps, [build.stage]: stepWith("PENDING", null, signatures.slice(0, 1)) };
  const write = () => writeRecord(deps.store, { ...base, steps });
  /* Written before the first send: a launch the network has not answered for yet is still found, and the next build settles it. */
  await write();

  let state: SubmittedDlmmProLaunch["state"] = "CONFIRMED";
  let reason: string | null = null;
  /* What this send put on chain, or may have: a transaction the network refused is not the launch's. */
  const sentSignatures: string[] = [];
  for (const [index, tx] of txs.entries()) {
    const built = build.txs[index]!;
    const budget = index === 0 ? (deps.sendBudget ?? FIRST_BUDGET) : (deps.sendBudget ?? budgetLeft(deadline, deps.now().getTime()));
    if (!budget) {
      state = "PENDING";
      reason = "not sent: the step took the route's time";
      break;
    }
    const sent: Sent = await sendOnce(deps.connection, sendableOf(tx), Number(built.validUntil), deps.now, { ...budget, deadline }, {
      second: deps.second,
      landed: (minSlot, cap) => (built.makes.holdsOne ? nftHeldOnChain(deps.connection, built.makes.address, minSlot) : accountOnChain([deps.connection, deps.second], built.makes.address, [built.makes.owner], minSlot, cap)),
    });
    if (sent.outcome === "CONFIRMED" || sent.outcome === "UNKNOWN") sentSignatures.push(sent.signature);
    if (sent.outcome === "CONFIRMED") continue;
    state = sent.outcome === "UNKNOWN" ? "PENDING" : "FAILED";
    reason = sent.outcome === "UNKNOWN" ? null : (sent.reason ?? "the network refused it").slice(0, 300);
    break;
  }
  steps = { ...steps, [build.stage]: stepWith(state, reason, sentSignatures) };
  /* The ladder's own transaction, once sent: what says it rested once its owner may take it down. */
  const ladderAt = build.txs.findIndex((tx) => tx.role === "LADDER");
  if (ladderAt >= 0 && base.ladder && sentSignatures.includes(signatures[ladderAt]!)) Object.assign(base, { ladder: { ...base.ladder, signature: signatures[ladderAt]! } });
  /*
   * A pool step that did not land changes nothing of the launch's terms: the opening and the fee stay what they were —
   * another build may have made the pool, or will — so the record never names a pool that is not there.
   */
  if (build.stage === "POOL" && state === "FAILED" && existing) {
    Object.assign(base, { opensAt: existing.opensAt, fee: existing.fee });
  }

  if (build.stage === "COIN" && state === "FAILED" && !existing) {
    /* Nothing landed: no launch of this coin exists. A refusal before the chain saw it costs nobody and is not counted. */
    await collection<DlmmProLaunchRecord>(deps.store, DLMM_PRO_LAUNCH_COLLECTIONS.records).delete(recordKey(build.cluster, build.mint));
    await sends.delete(buildKey(build.cluster, build.id));
    return fail("LAUNCH_SUBMIT_FAILED", reason ?? "The network refused the coin.");
  }
  await write();
  /* The step the launch waits for now is the chain's word, not this send's: a step sent and unanswered may be there. */
  let next: DlmmProLaunchStage | null = build.stage;
  try {
    const chain = (await chainOf(deps, { ...base, steps })).chain;
    next = dlmmProNextStage(chain);
    /* What the chain shows landed is written as landed: a step sent and not answered for, or finished by this send. */
    await settleSteps(deps.store, build.cluster, build.mint, chain);
  } catch {
    next = state === "CONFIRMED" ? nextAfter(build.stage, base.ryntra !== null) : build.stage;
  }
  return { ok: true, mint: build.mint, pool: base.pool, stage: build.stage, state, signatures: sentSignatures, reason, next, opensAt: base.opensAt };
}

/** Whether an NFT's account holds it on chain: true, false — read from `minSlot` or later and it does not —, or null when not read. */
async function nftHeldOnChain(connection: Connection, address: string, minSlot: number | null): Promise<boolean | null> {
  try {
    const read = await connection.getAccountInfoAndContext(new PublicKey(address), { commitment: "confirmed", ...(minSlot !== null ? { minContextSlot: minSlot } : {}) });
    const info = read.value;
    return Boolean(info && info.owner.equals(TOKEN_2022_PROGRAM_ID) && info.data.length >= 72 && Buffer.from(info.data).readBigUInt64LE(64) === 1n);
  } catch {
    return null;
  }
}

/** The step after a confirmed one, where the chain could not be read back: the supply is one step whatever it holds. */
function nextAfter(stage: DlmmProLaunchStage, _split: boolean): DlmmProLaunchStage | null {
  return stage === "COIN" ? "POOL" : stage === "POOL" ? "SUPPLY" : null;
}

/* ------------------------------------------------------------- the view */

export type DlmmProLaunchView = Readonly<{
  mint: string;
  pool: string;
  creator: string;
  name: string;
  symbol: string;
  metadataUri: string;
  pair: DlmmProLaunchPair;
  opensAt: number;
  phase: DlmmProLaunchPhase;
  /** The step its creator still has to sign; null — the launch is on chain whole. */
  next: DlmmProLaunchStage | null;
  /** The fee against snipers: where it starts, where it really settles, and what a purchase would pay now; null where the pool is not readable. */
  fee: Readonly<{ startBps: number; endBps: number | null; nowBps: number | null }>;
  /** The pair's coin per coin: the first price, and the price now. */
  price: Readonly<{ start: number | null; now: number | null }>;
  split: Readonly<{ creatorBps: number; ryntraBps: number }> | null;
  /**
   * The creator's ladder: what was told before signing, what still rests on sale, and its state — WAITING, the supply's
   * step has not placed it yet; RESTING, every price unfilled; SELLING, a price has filled; CLOSED, its owner took it
   * down once trading was open; null — not read. Null — the launch has none.
   */
  ladder: (DlmmProLadderTold & Readonly<{ leftRaw: string | null; state: "WAITING" | "RESTING" | "SELLING" | "CLOSED" | null }>) | null;
  /**
   * The reward for the pool's liquidity: what was told, with its window as the chain holds it, and its state
   * — WAITING, not funded yet or not started; PAYING, the emission runs; ENDED, its days are over; null — not read.
   * Null — the launch has none.
   */
  reward: (DlmmProRewardTold &
    Readonly<{
      state: "WAITING" | "PAYING" | "ENDED" | null;
      /**
       * What the creator has spent of it so far, from the pool's own slot — `flowedRaw`, paid to the liquidity
       * at the price; `idleRaw`, what found none there and comes back to the creator once its days are over; `leftRaw`,
       * still to flow. Null — not funded yet, or not read.
       */
      spent: Readonly<{ flowedRaw: string; idleRaw: string; leftRaw: string }> | null;
    }>) | null;
  /**
   * The honest-launch check, from the chain: `true` — the coin, the pool and the locked supply are exactly the launch
   * its creator was shown; `false` — they are not, and `problems` says how; `null` — the launch is not on chain whole
   * yet, or the chain could not be read: nothing is said either way.
   */
  honest: boolean | null;
  problems: readonly string[];
  /** The launch's own transactions, by step. */
  receipt: Readonly<Record<DlmmProLaunchStage, readonly string[]>>;
  /** What the launch cost its creator, as its builds told it: fees, and rent that stays on chain. */
  costLamports: string;
  at: number;
}>;

/** A launch's pool as the honest check reads it — the pool's half, from the venue's model of it; no other read. */
function poolFactsOf(venue: DlmmProVenue, record: DlmmProLaunchRecord, pool: DlmmProPool): DlmmProPoolFacts {
  const rules = pool.rules;
  const timed = rules?.slots.find((slot) => slot.mode === "timeBased") ?? null;
  const initialTickId = venue.pools.tickOfSqrtPrice(pool.initSqrtPriceX64);
  return {
    creator: record.creator,
    terms: { pair: record.pair, quoteMint: record.quoteMint, opensAt: record.opensAt, initialTickId: record.initialTickId, endFeeBps: record.fee?.endBps ?? null, settlesAtPriceMultiple: record.fee?.settles?.atPriceMultiple ?? null, dynamicCeilingBps: record.fee?.dynamicCeilingBps ?? null, ryntra: record.ryntra, poolSource: record.poolSource, config: record.config, ladder: Boolean(record.ladder), reward: record.reward ? { amountRaw: record.reward.amountRaw, seconds: dlmmProRewardSeconds(record.reward.days) } : null },
    pool: {
      kind: pool.kind,
      creator: pool.creator,
      tokenX: pool.tokenX.mint,
      tokenY: pool.tokenY.mint,
      tickSpacing: pool.tickSpacing,
      initialTickId,
      feeMode: pool.fee.mode,
      periods: pool.fee.periods,
      settlesAfter: pool.fee.settles ? pool.fee.settles.atPoint - pool.activationPoint : null,
      settlesAtPriceMultiple: pool.fee.settles?.atPrice != null && pool.initPrice > 0 ? pool.fee.settles.atPrice / pool.initPrice : null,
      liquidityMining: pool.extensions.liquidityMining,
      dynamicCeilingBps: pool.fee.dynamicCeilingBps,
      startBps: pool.fee.startBps,
      endBps: pool.fee.endBps,
      collectedIn: pool.fee.collectedIn,
      partner: pool.partner?.address ?? null,
      rules: rules && timed && timed.mode === "timeBased" ? { swapAt: timed.swapPoint, withdrawAt: timed.removeLiquidityPoint, depositor: rules.whitelistedAddLiquidity, swapper: rules.whitelistedSwap, withdrawer: rules.whitelistedRemoveLiquidity } : null,
    },
  };
}

/** A launch's facts for the honest check, read from the chain. Throws where a read fails: a check is never made of a guess. */
async function factsOf(deps: Pick<DlmmProLaunchDeps, "connection" | "network">, record: DlmmProLaunchRecord, read: ChainRead): Promise<DlmmProLaunchFacts> {
  const mintKey = new PublicKey(record.mint);
  const info = await deps.connection.getAccountInfo(mintKey, "confirmed");
  if (!info) throw new Error("The coin could not be read.");
  const token2022 = info.owner.equals(TOKEN_2022_PROGRAM_ID);
  const mint = unpackMint(mintKey, info, info.owner);
  const extensions = token2022 ? mintExtensionTypes(mint.tlvData).map((type) => ExtensionType[type] ?? String(type)) : [];
  /* The metadata's update authority is the first field of the extension: thirty-two zero bytes — nobody. */
  const metadata = token2022 ? getExtensionData(ExtensionType.TokenMetadata, mint.tlvData) : null;
  const authority = metadata && metadata.length >= 32 ? new PublicKey(metadata.subarray(0, 32)) : null;
  const pool = read.pool!;
  /*
   * The supply that went in is what the launch's own locked positions hold, at the pool's first price: a position's
   * liquidity does not change when the pool trades, so the same read holds before the opening and after it — and it
   * is the chain's own state, not a transaction a node may no longer keep. Each range rounds down by under an atom.
   */
  const venue = venueOf(deps);
  let suppliedRaw = 0n;
  for (const nftMint of [record.positions.creator, ...(record.positions.ryntra ? [record.positions.ryntra] : [])]) {
    suppliedRaw += BigInt((await venue.positions.worthAtPrice({ pool: record.pool, nftMint, sqrtPriceX64: pool.initSqrtPriceX64 })).xRaw);
  }
  const positions: DlmmProLaunchFacts["positions"][number][] = [];
  if (read.creatorPosition) positions.push({ role: "creator", holder: read.creatorPosition.holder, lockedBps: read.creatorPosition.lockedBps, liquidity: read.creatorPosition.liquidity });
  if (read.ryntraPosition) positions.push({ role: "ryntra", holder: read.ryntraPosition.holder, lockedBps: read.ryntraPosition.lockedBps, liquidity: read.ryntraPosition.liquidity });
  const shape = poolFactsOf(venue, record, pool);
  return {
    creator: shape.creator,
    terms: shape.terms,
    mint: {
      token2022,
      mintAuthority: mint.mintAuthority?.toBase58() ?? null,
      freezeAuthority: mint.freezeAuthority?.toBase58() ?? null,
      supplyRaw: mint.supply.toString(),
      decimals: mint.decimals,
      extensions,
      metadataAuthority: authority && !authority.equals(PublicKey.default) ? authority.toBase58() : null,
    },
    pool: { ...shape.pool, suppliedRaw: suppliedRaw.toString() },
    positions,
    ...(record.ladder
      ? {
          ladder: read.ladder
            ? {
                amountRaw: read.ladder.amountRaw,
                nearestTickId: read.ladder.ticks.length ? Math.min(...read.ladder.ticks.map((tick) => tick.tickId)) : null,
                resting: read.ladder.ticks.length > 0 && read.ladder.ticks.every((tick) => tick.state === "resting"),
                holder: await holderOf(deps.connection, record.ladder.nftMint, [record.creator]),
              }
            : null,
        }
      : {}),
    ...(record.reward ? { reward: read.rewardSlot ? { mint: read.rewardSlot.mint, authority: read.rewardSlot.authority, emissionPerSecondX64: read.rewardSlot.emissionPerSecondX64, opensAt: read.rewardSlot.opensAt, endsAt: read.rewardSlot.endsAt } : null } : {}),
    open: pool.at.unix >= record.opensAt,
  };
}

/** The reward as its tower reads it: the chain's own window where the slot is funded; null — the launch has none. */
function rewardView(record: DlmmProLaunchRecord, read: ChainRead | null): DlmmProLaunchView["reward"] {
  const told = rewardTold(record.reward, record.ryntra !== null);
  if (!told) return null;
  if (!read || !read.pool) return { ...told, state: null, spent: null };
  const slot = read.rewardSlot;
  if (!slot || !rewardFunded(slot, record.mint)) return { ...told, state: "WAITING", spent: null };
  const now = read.pool.at.unix;
  /* The vault was funded with the rate over the window, rounded up (`./reward.server.ts`): the same arithmetic here. */
  const fundedRaw = dlmmProEmission(BigInt(told.amountRaw), slot.endsAt - slot.opensAt).fundedRaw;
  const spent = dlmmProRewardSpent({ perSecondX64: BigInt(slot.emissionPerSecondX64), fundedRaw, opensAt: slot.opensAt, endsAt: slot.endsAt, idleSeconds: slot.idleSeconds, updatedAt: slot.updatedAt, liquidityNow: BigInt(read.pool.liquidity) > 0n, now });
  return { ...told, opensAt: slot.opensAt, endsAt: slot.endsAt, state: now < slot.opensAt ? "WAITING" : now < slot.endsAt ? "PAYING" : "ENDED", spent: { flowedRaw: spent.flowedRaw.toString(), idleRaw: spent.idleRaw.toString(), leftRaw: spent.leftRaw.toString() } };
}

/** The creator's ladder as its tower reads it; null — the launch has none. */
function ladderView(record: DlmmProLaunchRecord, read: ChainRead | null): DlmmProLaunchView["ladder"] {
  const told = ladderTold(record.ladder);
  if (!told) return null;
  if (!read || !read.pool) return { ...told, leftRaw: null, state: null };
  const order = read.ladder;
  if (!order) return { ...told, leftRaw: read.chain.ladder ? "0" : null, state: read.chain.ladder ? "CLOSED" : "WAITING" };
  return { ...told, leftRaw: order.unfilledRaw, state: order.ticks.every((tick) => tick.state === "resting") ? "RESTING" : "SELLING" };
}

/** A launch as its tower reads it; null — no launch of this coin here, or Ryntra took it down. */
export async function dlmmProLaunchView(deps: Pick<DlmmProLaunchDeps, "connection" | "network" | "store" | "now" | "settle"> & Partial<Pick<DlmmProLaunchDeps, "second">>, mint: string): Promise<DlmmProLaunchView | null> {
  if (!BASE58.test(mint)) return null;
  const record = await readDlmmProLaunchRecord(deps.store, deps.network.cluster, mint);
  if (!record || (await isTakenDown(deps.store, "mint", record.mint))) return null;
  const terms = DLMM_PRO_LAUNCH_TERMS;
  const receipt = { COIN: record.steps.COIN.signatures, POOL: record.steps.POOL.signatures, SUPPLY: record.steps.SUPPLY.signatures };
  const cost = Object.values(record.steps).reduce((sum, step) => sum + (step.state === "NOT_SENT" ? 0 : step.feeLamports + step.rentLamports), 0);
  const split = record.ryntra ? { creatorBps: terms.split.creatorBps, ryntraBps: terms.split.ryntraBps } : null;
  const wall = Math.floor(deps.now().getTime() / 1_000);
  const shared = { mint: record.mint, pool: record.pool, creator: record.creator, name: record.name, symbol: record.symbol, metadataUri: record.metadataUri, pair: record.pair, opensAt: record.opensAt, split, receipt, costLamports: String(cost) };
  let read: ChainRead;
  try {
    read = await chainOf(deps, record);
  } catch {
    /* The chain could not be read: the record's own word for where the launch stands, and nothing said of its honesty. */
    const next = record.steps.COIN.state !== "CONFIRMED" ? "COIN" : record.steps.POOL.state !== "CONFIRMED" ? "POOL" : record.steps.SUPPLY.state !== "CONFIRMED" ? "SUPPLY" : null;
    return { ...shared, phase: dlmmProPhase({ next, opensAt: record.opensAt, now: wall }), next, fee: { startBps: terms.fee.startBps, endBps: record.fee?.endBps ?? null, nowBps: null }, price: { start: null, now: null }, ladder: ladderView(record, null), reward: rewardView(record, null), honest: null, problems: [], at: wall };
  }
  const next = dlmmProNextStage(read.chain);
  const now = read.pool?.at.unix ?? wall;
  /*
   * What the chain shows landed is written as landed: a step whose send was not answered for is settled the first time
   * anybody reads the launch — so the list counts it, and a ladder its owner takes down once trading is open still
   * counts as having rested. The record is read afresh before the write; only the steps' states change.
   */
  if (deps.settle !== false) await settleSteps(deps.store, record.cluster, record.mint, read.chain).catch(() => null);
  let honest: boolean | null = null;
  let problems: readonly string[] = [];
  /* A launch whose pool trades without its whole supply locked in it is not the launch its creator was shown. */
  if (next !== null && read.chain.pool && now >= record.opensAt) {
    honest = false;
    problems = ["the launch was not finished before trading opened"];
  }
  if (next === null) {
    try {
      problems = dlmmProHonestProblems(await factsOf(deps, record, read));
      honest = problems.length === 0;
    } catch {
      honest = null;
    }
  }
  return {
    ...shared,
    phase: dlmmProPhase({ next, opensAt: record.opensAt, now }),
    next,
    fee: { startBps: terms.fee.startBps, endBps: read.pool?.fee.endBps ?? record.fee?.endBps ?? null, nowBps: read.pool ? read.pool.fee.totalBps : null },
    price: { start: read.pool?.initPrice ?? null, now: read.pool?.price ?? null },
    ladder: ladderView(record, read),
    reward: rewardView(record, read),
    honest,
    problems,
    at: now,
  };
}

export type DlmmProLaunchListed = Readonly<{ mint: string; pool: string; creator: string; name: string; symbol: string; metadataUri: string; pair: DlmmProLaunchPair; opensAt: number; phase: DlmmProLaunchPhase; createdAt: string }>;

/**
 * The launches Ryntra keeps on a network, newest first — by their own records and the clock, with no read of the
 * chain: a launch whose every step is confirmed counts down to its opening or is open; any other is still being built.
 * One Ryntra took down is left out.
 */
export async function listDlmmProLaunches(deps: Pick<DlmmProLaunchDeps, "network" | "store" | "now">): Promise<readonly DlmmProLaunchListed[]> {
  const now = Math.floor(deps.now().getTime() / 1_000);
  const records = [...(await listDlmmProLaunchRecords(deps.store, deps.network.cluster))].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const listed: DlmmProLaunchListed[] = [];
  for (const record of records) {
    if (await isTakenDown(deps.store, "mint", record.mint)) continue;
    const whole = DLMM_PRO_LAUNCH_STAGE_ORDER.every((stage) => record.steps[stage].state === "CONFIRMED");
    listed.push({
      mint: record.mint,
      pool: record.pool,
      creator: record.creator,
      name: record.name,
      symbol: record.symbol,
      metadataUri: record.metadataUri,
      pair: record.pair,
      opensAt: record.opensAt,
      phase: whole ? (now >= record.opensAt ? "OPEN" : "COUNTDOWN") : "BUILDING",
      createdAt: record.createdAt,
    });
  }
  return listed;
}

const DLMM_PRO_LAUNCH_STAGE_ORDER: readonly DlmmProLaunchStage[] = ["COIN", "POOL", "SUPPLY"];

export { DLMM_PRO_SUPPLY_RAW };
