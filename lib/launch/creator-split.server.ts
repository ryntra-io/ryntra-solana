/**
 * «Частка творця за його вибором» — the server's half.
 *
 * 1. **The rule** (`prepareSplitRule` → `submitSplitRule`). Only the token's creator, only the creator's own share: a
 *    rule that holds (`splitProblems`) and, when one is in force, raises it (`splitRaiseProblems`). The creator signs a
 *    transaction that carries the rule as a memo with the creator among its signers — the rule is the creator's own,
 *    on chain, timestamped — and from the moment its fees were read for the build, the share's earnings follow it.
 * 2. **Depth** (`prepareSplitDepth` → `submitSplitDepth`). Once the token is on its DEX, what the rule owes depth
 *    (`splitDue` less what was placed) goes into the creator's own buy steps in the token's DLMM pool, below the lower of
 *    the graduated pool's price and the DLMM pool's own (`CREATOR_DEPTH_RULE`). With no pool yet, the creator's first act
 *    makes it on Ryntra's rule (steps of 1 %, its fee 1 %) — the same pool Ryntra's own ladder takes. One position of the
 *    creator's: moved down to the new steps and added to while it holds only the pair currency; a fresh one once its steps
 *    bought something. The position's fresh key waits sealed with the server's until the creator has signed.
 * 3. **The payout** (`prepareSplitPayout` → `submitSplitPayout`). What the rule owes the community goes to its wallet;
 *    what it owes holders, to the largest holders of a snapshot of the chain by what they hold — without the creator and
 *    the linked wallets, the bundle, every program's address and Ryntra's wallets (`holderSnapshot`), never on a read in
 *    part. The round's root (`splitRoot`) goes on chain first, in a memo the creator signs, then the transfers — all in
 *    one window of signatures, sent in order; after one that did not land the rest are not sent.
 * 4. **The page** (`creatorSplitView`): the rule and its lines, what it owes and what was done, the steps as the chain
 *    holds them, each round with its rows and root. A read that fails is «not read», never zero.
 *
 * Every transaction is the creator's alone to sign and pay; the bytes are checked before they leave — the programs they
 * call, who pays, that the transfers pay the plan and no wallet of Ryntra's. Ryntra holds no money of the creator's,
 * signs nothing of theirs and takes 0. On mainnet all of it stays closed.
 *
 * Server-only. The collections it writes (`launchCreatorSplits`, `launchCreatorSplitBuilds`, `launchCreatorSplitSends`)
 * are in the store's list.
 */

import { createHash, randomBytes } from "node:crypto";

import { CpAmm } from "@meteora-ag/cp-amm-sdk";
import { ASSOCIATED_TOKEN_PROGRAM_ID, NATIVE_MINT, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { getBase58Decoder } from "@solana/kit";
import { ComputeBudgetProgram, PublicKey, SystemProgram, Transaction, TransactionInstruction, VersionedTransaction, type Connection, type Keypair } from "@solana/web3.js";

import type {
  ApiErrorCode,
  LaunchSplitDepthBuildResponse,
  LaunchSplitPayoutBuildResponse,
  LaunchSplitPayoutSubmitResponse,
  LaunchSplitRuleBuildResponse,
  LaunchSplitView,
} from "../api/v1/contract.ts";
import { ATTRIBUTION_REGISTRY } from "../attribution/registry.ts";
import { FLOOR_RULE, binOfPrice } from "../core/launch/autopilot.ts";
import {
  CREATOR_DEPTH_RULE,
  MEMO_PROGRAM,
  SPLIT_GIVEN,
  SPLIT_HOLDERS_PER_ROUND,
  creatorDepthLadder,
  depthRangePct,
  holderSnapshot,
  holdersPayout,
  splitDue,
  splitMinimums,
  splitOutstanding,
  splitProblems,
  splitRaiseProblems,
  splitRoot,
  splitRoundMemo,
  splitRuleLines,
  splitRuleMemo,
  type HolderPayoutRow,
  type HolderSnapshot,
  type SplitGiven,
  type SplitRule,
  type SplitSegment,
  CREATOR_SPLIT_OWNER_WORD,
} from "../core/launch/creator-split.ts";
import { earningsOf } from "../core/venues/meteora-dbc/claim.server.ts";
import { tokenAccountOf } from "../core/venues/meteora-dbc/exit.ts";
import { dammPrice } from "../core/venues/meteora-dbc/market.server.ts";
import type { FloorPool, FloorVenue, StepsRead } from "../core/venues/meteora-dlmm/floor.server.ts";
import { withBoundedCasRetry, type GuardStore } from "../guard/store.ts";
import type { Env } from "../liquidity/studio/gate.ts";
import { openCosigners, reviewedDigest, sealCosigners, ticketKeyConfigured, withoutSignaturesOf } from "../liquidity/studio/ticket.ts";
import { NEXT_TRANSACTION_MARGIN_MS, readBuildWindows, web3ChainReader } from "../solana/blockhash-life.ts";
import { compareWalletTransaction } from "../solana/wallet-modification.ts";
import { buildBoostPayoutTransactions, payoutProblems, signedCommitment } from "./boost.server.ts";
import { launchHistoryConnection, launchPair, launchWritesHere, type LaunchNetwork } from "./config.server.ts";
import { creatorFeesOf } from "./creator.server.ts";
import { accountOnChain, readLaunchRecord, sendOnce, signatureOutcome, type LaunchReadDeps, type LaunchRecord } from "./flow.server.ts";
import { readLaunchMarketFacts, type LaunchMarketFacts } from "./market.server.ts";
import { launchMarketReader } from "./trade-index.server.ts";
import { advanceBoughtLedger, nodeLister } from "./creator-split-history.server.ts";
import { autopilotReceipts } from "./autopilot.server.ts";
import { findMigrationSignature } from "../core/venues/meteora-dbc/exit-positions.server.ts";


export { CREATOR_SPLIT_OWNER_WORD };

/** Whether a split may be written or carried out here: the devnet stand. */
export function creatorSplitOpenFor(network: LaunchNetwork, env: Env = process.env, ownerWord: boolean = CREATOR_SPLIT_OWNER_WORD): boolean {
  if (network.cluster === "devnet") return true;
  return ownerWord === true && launchWritesHere(network, env as NodeJS.ProcessEnv);
}

/* ------------------------------------------------------------ records */

export const LAUNCH_CREATOR_SPLITS = "launchCreatorSplits" as const;
export const LAUNCH_CREATOR_SPLIT_BUILDS = "launchCreatorSplitBuilds" as const;
export const LAUNCH_CREATOR_SPLIT_SENDS = "launchCreatorSplitSends" as const;

export type SplitTxState = "PENDING" | "CONFIRMED" | "FAILED";

/** A rule written: the segment, its transaction and where the chain stands with it — only a CONFIRMED one is in force. */
export type SplitSegmentRow = SplitSegment & Readonly<{ state: SplitTxState; validUntil: string; reason: string | null }>;

/** POOL — the token's DLMM pool made; SYNC — its price taken up to the market's through empty bins; STEPS — the creator's steps placed or added to. */
export type DepthPhase = "POOL" | "SYNC" | "STEPS";

/** One act of depth: the pool made, its price brought to the market's, or the creator's steps placed or added to. `amountRaw`: the pair currency it put in. */
export type DepthPlacement = Readonly<{
  kind: DepthPhase;
  signature: string;
  validUntil: string;
  state: SplitTxState;
  reason: string | null;
  pool: string;
  position: string | null;
  amountRaw: string;
  lowerBinId: number | null;
  upperBinId: number | null;
  at: string;
}>;

/** One transaction of a round: the root's memo, or transfers to some of its wallets. */
export type PayoutTx = Readonly<{
  signature: string;
  validUntil: string;
  state: SplitTxState;
  reason: string | null;
  memo: boolean;
  wallets: readonly string[];
  holdersRaw: string;
  communityRaw: string;
}>;

export type PayoutRound = Readonly<{
  round: number;
  root: string;
  rows: readonly HolderPayoutRow[];
  community: Readonly<{ wallet: string; amountRaw: string }> | null;
  snapshot: Readonly<{ eligible: number; excluded: HolderSnapshot["excluded"] }> | null;
  txs: readonly PayoutTx[];
  at: string;
}>;

export type SplitPairFacts = Readonly<{ mint: string; program: string; decimals: number; symbol: string; usdPrice: number; dollar: boolean }>;

/** A token's split, keyed `<cluster>:<token>`. Every write is a compare-and-set on `version`. */
export type CreatorSplitRecord = Readonly<{
  version: number;
  cluster: LaunchNetwork["cluster"];
  token: string;
  creator: string;
  pair: SplitPairFacts;
  segments: readonly SplitSegmentRow[];
  depth: Readonly<{ pool: string | null; placements: readonly DepthPlacement[] }>;
  rounds: readonly PayoutRound[];
  /**
   * The most the creator's share was ever read to have claimed: what the rules owe never falls — a role or a position
   * moved away, a read that sees less, and the count stays where it was. Absent before the first read.
   */
  peakClaimedRaw?: string;
  createdAt: string;
}>;

type BuildBase = Readonly<{ id: string; cluster: LaunchNetwork["cluster"]; token: string; creator: string; validUntil: string; createdAt: string; expiresAt: string }>;

type RuleBuild = BuildBase &
  Readonly<{ kind: "rule"; wire: string; messageSha256: string; digest: string; rule: SplitRule; fromEarnedRaw: string; pair: SplitPairFacts; confirmedSegments: number }>;

type DepthBuild = BuildBase &
  Readonly<{
    kind: "depth";
    phase: DepthPhase;
    wire: string;
    messageSha256: string;
    digest: string;
    cosign: string | null;
    pool: string;
    position: string | null;
    amountRaw: string;
    lowerBinId: number | null;
    upperBinId: number | null;
    /** What depth had taken — placed or on its way — when this was built: a submit after another moved it is refused. */
    committedRaw: string;
  }>;

type PayoutBuild = BuildBase &
  Readonly<{
    kind: "payout";
    wires: readonly string[];
    parts: readonly Readonly<{ memo: boolean; wallets: readonly string[]; holdersRaw: string; communityRaw: string }>[];
    round: number;
    root: string;
    rows: readonly HolderPayoutRow[];
    community: Readonly<{ wallet: string; amountRaw: string }> | null;
    snapshot: PayoutRound["snapshot"];
    committed: Readonly<{ holdersRaw: string; communityRaw: string }>;
  }>;

type SplitBuild = RuleBuild | DepthBuild | PayoutBuild;

const splitKey = (cluster: string, token: string) => `${cluster}:${token}`;
const buildKey = (cluster: string, id: string) => `${cluster}:${id}`;
const splits = (store: GuardStore) => store.versioned<CreatorSplitRecord>(LAUNCH_CREATOR_SPLITS);
const builds = (store: GuardStore) => store.collection<SplitBuild>(LAUNCH_CREATOR_SPLIT_BUILDS);
const sends = (store: GuardStore) => store.collection<Readonly<{ cluster: string; id: string; at: string }>>(LAUNCH_CREATOR_SPLIT_SENDS);
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const signatureOf = (tx: Transaction) => getBase58Decoder().decode(new Uint8Array(tx.signatures[0]?.signature ?? new Uint8Array(64)));

export async function readCreatorSplit(store: GuardStore, cluster: string, token: string): Promise<CreatorSplitRecord | null> {
  return (await splits(store).get(splitKey(cluster, token))) ?? null;
}

type SplitChange = Omit<CreatorSplitRecord, "version">;

/** A split's read-decide-write as one compare-and-set; `decide` answers the row to write, or the reason nothing is. */
async function changeSplit(
  store: GuardStore,
  cluster: string,
  token: string,
  decide: (current: CreatorSplitRecord | null) => SplitChange | string,
): Promise<Readonly<{ ok: true; row: CreatorSplitRecord }> | Readonly<{ ok: false; reason: string }>> {
  const rows = splits(store);
  const key = splitKey(cluster, token);
  return withBoundedCasRetry(async () => {
    const current = (await rows.get(key)) ?? null;
    if (current && !Number.isInteger(current.version)) return { ok: false as const, reason: "The split's record has no version; nothing was written." };
    const decided = decide(current);
    if (typeof decided === "string") return { ok: false as const, reason: decided };
    const row: CreatorSplitRecord = { ...decided, version: current ? current.version + 1 : 0 };
    return (await rows.compareAndSet(key, current ? current.version : null, row)) ? { ok: true as const, row } : false;
  });
}

/* ------------------------------------------------------------ what the rule owes and what was done */

/** The rules in force, in the order they were written. */
export const inForce = (record: Pick<CreatorSplitRecord, "segments">) => record.segments.filter((segment) => segment.state === "CONFIRMED");

/** What each given bucket has taken: done — landed; committed — landed or still able to land. */
export function splitDone(record: Pick<CreatorSplitRecord, "depth" | "rounds">): Readonly<{ done: Record<SplitGiven, bigint>; committed: Record<SplitGiven, bigint> }> {
  const done: Record<SplitGiven, bigint> = { depth: 0n, community: 0n, holders: 0n };
  const committed: Record<SplitGiven, bigint> = { depth: 0n, community: 0n, holders: 0n };
  for (const placement of record.depth.placements) {
    if (placement.kind !== "STEPS" || placement.state === "FAILED") continue;
    committed.depth += BigInt(placement.amountRaw);
    if (placement.state === "CONFIRMED") done.depth += BigInt(placement.amountRaw);
  }
  for (const round of record.rounds) {
    for (const tx of round.txs) {
      if (tx.state === "FAILED") continue;
      committed.holders += BigInt(tx.holdersRaw);
      committed.community += BigInt(tx.communityRaw);
      if (tx.state === "CONFIRMED") {
        done.holders += BigInt(tx.holdersRaw);
        done.community += BigInt(tx.communityRaw);
      }
    }
  }
  return { done, committed };
}

/* ------------------------------------------------------------ deps and failures */

/** The creator's share as the chain counts it: everything it earned, what it claimed, and the graduated pool once there is one. */
export type CreatorShareRead = Readonly<{
  earnedRaw: string;
  claimedRaw: string;
  migrated: boolean;
  dammPool: string | null;
  /** Who holds the curve's creator role now. */
  roleOwner: string;
  /** After the DEX, whether the role still holds its locked LP position; null before the DEX. */
  lpHeld: boolean | null;
}>;

export type SplitDeps = Pick<LaunchReadDeps, "store" | "connection" | "second" | "adopt"> &
  Readonly<{
    network: LaunchNetwork;
    now: () => Date;
    /** The server's key (`BETA_TOKEN_SECRET`) that seals a position's fresh key until the creator has signed. */
    env?: Env;
    /** Ryntra's own wallets; absent, or read in part, no holders' round is counted. */
    ownWallets?: () => Promise<Readonly<{ wallets: ReadonlySet<string>; complete: boolean }>>;
    /** The creator's share read from the chain — the cabinet's own read by default. A read that fails throws. */
    share?: (record: LaunchRecord) => Promise<CreatorShareRead>;
    /** The token's market read — every account of the mint, the labels — the market's own read by default. */
    market?: (token: string) => Promise<LaunchMarketFacts | null>;
    /**
     * The token's every trade from its creation, with whether every one was read — the market reader's paged window
     * over the curve and the pool, its decoded transactions kept in the store so each read asks only for what is new.
     */
    history?: (record: LaunchRecord, facts: LaunchMarketFacts, budgetMs: number) => Promise<Readonly<{ bought: ReadonlyMap<string, bigint>; creatorPaid: ReadonlySet<string>; complete: boolean }>>;
    /** The DLMM venue — Meteora's by default. */
    venue?: FloorVenue;
    /** The graduated pool's price of the token, with the decimals — read from the pool by default. */
    price?: (dammPool: string, token: string) => Promise<Readonly<{ price: number; tokenDecimals: number; pairDecimals: number }>>;
    /** What a wallet's account of a mint holds, raw — the chain's by default. A read that fails throws. */
    balance?: (owner: string, mint: string, program: string) => Promise<bigint>;
    /** A transaction's simulation: null when it runs, else the reason — the node's by default. */
    simulate?: (tx: Transaction) => Promise<string | null>;
    ownerWord?: boolean;
  }>;

export type SplitFailure = Readonly<{ ok: false; code: ApiErrorCode; message: string; issues?: readonly Readonly<{ path: string; message: string }>[] }>;
const fail = (code: ApiErrorCode, message: string, issues?: SplitFailure["issues"]): SplitFailure => ({ ok: false, code, message, ...(issues ? { issues } : {}) });

const READ_MS = 8_000;
/** The longest a built act waits for the creator's signature: the bytes live as long as their blockhash. */
export const SPLIT_BUILD_TTL_MS = 2 * 60 * 1000;
const SEND_BUDGET = { confirmMs: 20_000, settleMs: 8_000 } as const;
const ROUTE_MS = 50_000;
const PART_MIN_MS = 6_000;
/** The transfers of one round, at most: with the root's memo the wallet signs one window of nine. */
export const SPLIT_PAYOUT_TXS = 8;
/** A position's token below this is dust its steps did not really buy: the steps still move with it. */
const TOKEN_DUST_RAW = 1_000n;

async function within<T>(read: () => Promise<T>, ms = READ_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([read(), new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error("The network did not answer in time.")), ms)))]);
  } finally {
    clearTimeout(timer);
  }
}

/** Ryntra's own addresses on this network: the registry's, the fee wallet, the referral owner. */
function ryntraAddresses(network: LaunchNetwork): Set<string> {
  const own = new Set<string>();
  for (const row of ATTRIBUTION_REGISTRY) if (row.network === "solana" && row.address) own.add(row.address);
  if (network.feeWallet) own.add(network.feeWallet);
  if (network.referralOwner) own.add(network.referralOwner);
  return own;
}

/** The wallets that share the creator's fees on chain, and the vault: linked to the creator, never a community or a holder. */
function linkedOf(record: LaunchRecord): Set<string> {
  const linked = new Set<string>();
  for (const share of record.feeSharing?.state === "FAILED" ? [] : (record.feeSharing?.shares ?? [])) if (share.address !== record.creator) linked.add(share.address);
  if (record.feeSharing?.vault) linked.add(record.feeSharing.vault);
  return linked;
}

async function defaultShare(deps: SplitDeps, record: LaunchRecord): Promise<CreatorShareRead> {
  const observation = await creatorFeesOf({ network: deps.network, connection: deps.connection, store: deps.store, now: deps.now, second: deps.second, adopt: deps.adopt }, record);
  const mine = earningsOf(observation, record.creator).mine;
  return {
    earnedRaw: mine.earnedRaw,
    claimedRaw: mine.claimedRaw,
    migrated: observation.migrated,
    dammPool: observation.graduated?.pool ?? null,
    roleOwner: observation.roleOwner,
    /* Said only where the graduated pool was read: a pool not found is no move of the position. */
    lpHeld: observation.migrated && observation.graduated ? Boolean(observation.graduated.position) : null,
  };
}

async function defaultPrice(connection: Connection, dammPool: string, token: string) {
  const state = await within(() => new CpAmm(connection).fetchPoolState(new PublicKey(dammPool)));
  const tokenIsA = state.tokenAMint.toBase58() === token;
  const pairMint = tokenIsA ? state.tokenBMint : state.tokenAMint;
  const [tokenInfo, pairInfo] = await within(() => connection.getMultipleAccountsInfo([new PublicKey(token), pairMint], "confirmed"));
  if (!tokenInfo || !pairInfo) throw new Error("The pool's mints could not be read.");
  const tokenDecimals = tokenInfo.data[44]!;
  const pairDecimals = pairInfo.data[44]!;
  return { price: dammPrice(state.sqrtPrice.toString(), tokenIsA, tokenDecimals, pairDecimals), tokenDecimals, pairDecimals };
}

async function defaultBalance(connection: Connection, owner: string, mint: string, program: string): Promise<bigint> {
  const account = getAssociatedTokenAddressSync(new PublicKey(mint), new PublicKey(owner), true, new PublicKey(program), ASSOCIATED_TOKEN_PROGRAM_ID);
  const info = await within(() => connection.getAccountInfo(account, "confirmed"));
  if (!info || info.data.length === 0) return 0n;
  return tokenAccountOf(info.data)?.amount ?? 0n;
}

async function defaultSimulate(connection: Connection, tx: Transaction): Promise<string | null> {
  const simulated = await within(() => connection.simulateTransaction(new VersionedTransaction(tx.compileMessage()), { sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" }), 12_000);
  if (!simulated.value.err) return null;
  const logs = (simulated.value.logs ?? []).filter((line) => /Error|insufficient|failed/i.test(line)).slice(0, 2).join(" ");
  return (logs || JSON.stringify(simulated.value.err)).slice(0, 300);
}

/** Meteora's DLMM program — the creator's steps' venue (`floor.server.ts`, loaded only when no venue is given). */
const DLMM_PROGRAM = "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo";

async function venueOf(deps: SplitDeps): Promise<FloorVenue> {
  if (deps.venue) return deps.venue;
  const { createFloorVenue } = await import("../core/venues/meteora-dlmm/floor.server.ts");
  return createFloorVenue({ connection: deps.connection, cluster: deps.network.cluster });
}

async function launchOf(deps: SplitDeps, token: string): Promise<LaunchRecord | SplitFailure> {
  const record = await readLaunchRecord(deps, deps.network.cluster, token).catch(() => null);
  if (!record || record.state === "PENDING") return fail("LAUNCH_NOT_FOUND", "No Ryntra launch of this token here.");
  return record;
}

/** The pair's facts the split speaks in: its mint, token program, decimals, symbol and dollar price. */
async function pairFactsOf(deps: SplitDeps, record: LaunchRecord): Promise<SplitPairFacts> {
  const pair = launchPair(deps.network, record.preset, record.pairMint);
  const info = await within(() => deps.connection.getAccountInfo(new PublicKey(record.pairMint), "confirmed"));
  if (!info || info.data.length < 82) throw new Error("The pair currency could not be read.");
  const program = info.owner.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
  return { mint: record.pairMint, program: program.toBase58(), decimals: info.data[44]!, symbol: pair.symbol, usdPrice: pair.usdPrice, dollar: pair.dollar };
}

async function sweep(deps: SplitDeps): Promise<void> {
  const stale = deps.now().getTime() - 60 * 60 * 1000;
  for (const build of await builds(deps.store).valuesWithPrefix(`${deps.network.cluster}:`)) if (Date.parse(build.expiresAt) < stale) await builds(deps.store).delete(buildKey(build.cluster, build.id));
}

/* ------------------------------------------------------------ settling what was sent */

/**
 * Everything sent that the chain has not answered yet, settled now: a signature that landed is CONFIRMED, one that
 * failed or can no longer land is FAILED. Written on each settled signature of the stored row, still PENDING there.
 */
export async function settleSplit(deps: Pick<SplitDeps, "store" | "connection" | "second">, record: CreatorSplitRecord): Promise<CreatorSplitRecord> {
  const pending = [
    ...record.segments.filter((row) => row.state === "PENDING").map((row) => ({ signature: row.signature, validUntil: row.validUntil })),
    ...record.depth.placements.filter((row) => row.state === "PENDING"),
    ...record.rounds.flatMap((round) => round.txs.filter((tx) => tx.state === "PENDING")),
  ];
  if (!pending.length) return record;
  const settled = new Map<string, "CONFIRMED" | "FAILED">();
  for (const row of pending) {
    const outcome = await signatureOutcome(deps.connection, row.signature, Number(row.validUntil), deps.second ?? null).catch(() => "UNKNOWN" as const);
    if (outcome === "CONFIRMED") settled.set(row.signature, "CONFIRMED");
    else if (outcome === "FAILED" || outcome === "EXPIRED" || outcome === "REJECTED") settled.set(row.signature, "FAILED");
  }
  if (!settled.size) return record;
  const reason = "the network did not take it";
  const written = await changeSplit(deps.store, record.cluster, record.token, (current) => {
    if (!current) return "gone";
    const state = <T extends { state: SplitTxState; signature: string; reason: string | null }>(row: T): T =>
      row.state === "PENDING" && settled.has(row.signature) ? { ...row, state: settled.get(row.signature)!, reason: settled.get(row.signature) === "FAILED" ? (row.reason ?? reason) : null } : row;
    const placements = current.depth.placements.map(state);
    const madePool = placements.find((row) => row.kind === "POOL" && row.state === "CONFIRMED")?.pool ?? null;
    return {
      ...current,
      segments: current.segments.map(state),
      depth: { pool: current.depth.pool ?? madePool, placements },
      rounds: current.rounds.map((round) => ({ ...round, txs: round.txs.map(state) })),
    };
  }).catch(() => null);
  return written?.ok ? written.row : record;
}

/* ------------------------------------------------------------ 1. the rule */

export type PreparedRule = LaunchSplitRuleBuildResponse;

/** The memo instruction the rule or a round's root goes on chain with, the creator among its signers. */
function memoInstruction(text: string, signer: PublicKey): TransactionInstruction {
  return new TransactionInstruction({ programId: new PublicKey(MEMO_PROGRAM), keys: [{ pubkey: signer, isSigner: true, isWritable: false }], data: Buffer.from(text, "utf8") });
}

function linesOf(rule: SplitRule, since: number, pairSymbol: string, raisedAt: number | null = null) {
  return { uk: [...splitRuleLines(rule, { since, raisedAt, pairSymbol }, "uk")], en: [...splitRuleLines(rule, { since, raisedAt, pairSymbol }, "en")] };
}

export async function prepareSplitRule(deps: SplitDeps, input: Readonly<{ token: string; creator: string; rule: SplitRule }>): Promise<Readonly<{ ok: true; build: PreparedRule }> | SplitFailure> {
  if (!creatorSplitOpenFor(deps.network, deps.env ?? {}, deps.ownerWord)) return fail("CAPABILITY_UNAVAILABLE", "The creator's split is not open on this network.");
  const record = await launchOf(deps, input.token);
  if ("ok" in record) return record;
  if (record.creator !== input.creator) return fail("WALLET_MISMATCH", "Only the token's creator divides the creator's share.");
  const rule: SplitRule = { shares: { ...input.rule.shares }, community: input.rule.community ?? null };
  /* A community is no wallet of Ryntra's: its runtime wallets too, read whole, or no rule naming a wallet is built. */
  const own = rule.community ? await deps.ownWallets?.().catch(() => null) : null;
  if (rule.community && (!own || !own.complete)) return fail("UNAVAILABLE", "Ryntra's own wallets could not be read now; nothing was built.");
  const excluded = new Set([...ryntraAddresses(deps.network), ...(own?.wallets ?? []), ...linkedOf(record), record.pool, record.config, record.token, record.pairMint]);
  const problems = splitProblems(rule, record.creator, excluded);
  if (problems.length) return fail("LAUNCH_SHARES_INVALID", `The split does not hold: ${problems.join(", ")}.`, problems.map((code) => ({ path: `rule.${code}`, message: code })));
  let existing = await readCreatorSplit(deps.store, deps.network.cluster, record.token).catch(() => undefined);
  if (existing === undefined) return fail("UNAVAILABLE", "The split could not be read now; nothing was built.");
  if (existing) existing = await settleSplit(deps, existing);
  if (existing?.segments.some((segment) => segment.state === "PENDING")) return fail("LAUNCH_BUILD_USED", "A rule is on its way; build the next one once it lands or its time runs out.");
  const current = existing ? inForce(existing).at(-1) : undefined;
  if (current) {
    const raise = splitRaiseProblems(current.rule, rule);
    if (raise.length) return fail("LAUNCH_SHARES_INVALID", `A rule in force can only be raised: ${raise.join(", ")}.`, raise.map((code) => ({ path: `rule.${code}`, message: code })));
  }
  let share: CreatorShareRead;
  let pair: SplitPairFacts;
  try {
    share = await (deps.share ?? ((launch) => defaultShare(deps, launch)))(record);
    pair = existing?.pair ?? (await pairFactsOf(deps, record));
  } catch {
    return fail("UNAVAILABLE", "The creator's fees could not be read now; nothing was built. Try again.");
  }
  /* A rule counts only what the creator's share earns: with the role or the locked LP moved away there is nothing for it to divide. */
  const roleHolders = new Set([record.creator, ...(record.feeSharing && record.feeSharing.state !== "FAILED" ? [record.feeSharing.vault] : [])]);
  if (!roleHolders.has(share.roleOwner) || share.lpHeld === false) return fail("LAUNCH_SHARES_INVALID", "The creator's role or locked LP is no longer the creator's: there is no share to divide.");
  /* A raise starts where the chain's count is now — never before the rule in force, nor before what was already claimed. */
  const fromEarned = [current?.fromEarnedRaw ?? "0", share.earnedRaw, existing?.peakClaimedRaw ?? "0"].reduce((top, value) => (BigInt(value) > BigInt(top) ? value : top));
  const memo = splitRuleMemo(record.token, rule);
  const creator = new PublicKey(record.creator);
  let latest: Awaited<ReturnType<Connection["getLatestBlockhash"]>>;
  try {
    latest = await within(() => deps.connection.getLatestBlockhash("confirmed"));
  } catch {
    return fail("UNAVAILABLE", "The network could not be read now; nothing was built. Try again.");
  }
  const tx = new Transaction().add(memoInstruction(memo, creator));
  tx.feePayer = creator;
  tx.recentBlockhash = latest.blockhash;
  const wire = Buffer.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false })).toString("base64");
  const validUntil = String(latest.lastValidBlockHeight);
  const windows = await readBuildWindows(web3ChainReader(deps.connection, READ_MS), validUntil, { transactions: 1, capMs: SPLIT_BUILD_TTL_MS });
  const now = deps.now();
  const build: RuleBuild = {
    kind: "rule",
    id: randomBytes(16).toString("hex"),
    cluster: deps.network.cluster,
    token: record.token,
    creator: record.creator,
    wire,
    messageSha256: sha256(tx.serializeMessage()),
    digest: reviewedDigest(tx),
    rule,
    fromEarnedRaw: fromEarned,
    pair,
    confirmedSegments: existing ? inForce(existing).length : 0,
    validUntil,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + windows.lifeMs).toISOString(),
  };
  await sweep(deps).catch(() => undefined);
  await builds(deps.store).insertIfAbsent(buildKey(build.cluster, build.id), build);
  const since = Math.floor(now.getTime() / 1000);
  return { ok: true, build: { buildId: build.id, network: deps.network.chain, unsignedWireBase64: wire, memo, rule: ruleView(rule), lines: linesOf(rule, since, pair.symbol), expiresAt: build.expiresAt, signableMs: windows.signableMs } };
}

export type SplitSubmitted = Readonly<{ state: SplitTxState; signature: string; reason: string | null }>;

async function buildFor<K extends SplitBuild["kind"]>(deps: SplitDeps, input: Readonly<{ token: string; buildId: string; creator: string }>, kind: K): Promise<Extract<SplitBuild, { kind: K }> | SplitFailure> {
  const build = await builds(deps.store).get(buildKey(deps.network.cluster, input.buildId));
  if (!build || build.kind !== kind || build.token !== input.token) return fail("LAUNCH_NOT_FOUND", "This was not built here.");
  if (build.creator !== input.creator) return fail("WALLET_MISMATCH", "This was built for another wallet.");
  if (Date.parse(build.expiresAt) < deps.now().getTime()) return fail("LAUNCH_BUILD_EXPIRED", "It waited too long for the signature; build it again.");
  return build as Extract<SplitBuild, { kind: K }>;
}

export async function submitSplitRule(
  deps: SplitDeps,
  input: Readonly<{ token: string; buildId: string; creator: string; signedWireBase64: string }>,
): Promise<Readonly<{ ok: true; submit: SplitSubmitted }> | SplitFailure> {
  const deadline = deps.now().getTime() + ROUTE_MS;
  if (!creatorSplitOpenFor(deps.network, deps.env ?? {}, deps.ownerWord)) return fail("CAPABILITY_UNAVAILABLE", "The creator's split is not open on this network.");
  const build = await buildFor(deps, input, "rule");
  if ("ok" in build) return build;
  const tx = signedCommitment(input.signedWireBase64, build, []);
  if ("ok" in tx) return { ok: false, code: tx.code, message: tx.message };
  if (!(await sends(deps.store).insertIfAbsent(buildKey(build.cluster, build.id), { cluster: build.cluster, id: build.id, at: deps.now().toISOString() }))) {
    return fail("LAUNCH_BUILD_USED", "This rule was already sent.");
  }
  const signature = signatureOf(tx);
  const segment: SplitSegmentRow = { rule: build.rule, fromEarnedRaw: build.fromEarnedRaw, at: Math.floor(deps.now().getTime() / 1000), signature, state: "PENDING", validUntil: build.validUntil, reason: null };
  /* Written before the send, in one compare-and-set: the rule in force is the one the build was checked against, and no other rule is on its way. */
  const opened = await changeSplit(deps.store, build.cluster, build.token, (current) => {
    if (current?.segments.some((row) => row.state === "PENDING")) return "A rule is on its way; nothing was sent.";
    const confirmed = current ? inForce(current) : [];
    if (confirmed.length !== build.confirmedSegments) return "The rule in force changed since this was built; nothing was sent.";
    const last = confirmed.at(-1);
    if (last && splitRaiseProblems(last.rule, build.rule).length) return "A rule in force can only be raised; nothing was sent.";
    const base: SplitChange = current ?? { cluster: build.cluster, token: build.token, creator: build.creator, pair: build.pair, segments: [], depth: { pool: null, placements: [] }, rounds: [], createdAt: deps.now().toISOString() };
    return { ...base, segments: [...base.segments, segment] };
  }).catch(() => null);
  if (!opened) return fail("UNAVAILABLE", "The split could not be written now; nothing was sent.");
  if (!opened.ok) return fail("LAUNCH_BUILD_USED", opened.reason);
  const sent = await sendOnce(deps.connection, tx, Number(build.validUntil), deps.now, { ...SEND_BUDGET, deadline }, { second: deps.second });
  return { ok: true, submit: await recordOutcome(deps, build.cluster, build.token, signature, sent) };
}

/**
 * A send's answer written on its own signature: CONFIRMED, or FAILED when it failed on chain. One the node refused before
 * the chain answers FAILED to the caller but stays PENDING in the record with its reason: the creator's wallet holds the
 * signed bytes until their blockhash expires, and only the chain's own word — `settleSplit` — frees what they reserve.
 */
async function recordOutcome(deps: SplitDeps, cluster: string, token: string, signature: string, sent: Awaited<ReturnType<typeof sendOnce>>): Promise<SplitSubmitted> {
  const state: SplitTxState = sent.outcome === "CONFIRMED" ? "CONFIRMED" : sent.outcome === "UNKNOWN" ? "PENDING" : "FAILED";
  const reason = state === "FAILED" ? (sent.reason ?? "the network refused it").slice(0, 300) : null;
  const written: SplitTxState = sent.outcome === "REJECTED" ? "PENDING" : state;
  forgetPageSplitView(cluster, token);
  if (state !== "PENDING") {
    await changeSplit(deps.store, cluster, token, (current) => {
      if (!current) return "gone";
      const mark = <T extends { state: SplitTxState; signature: string; reason: string | null }>(row: T): T => (row.signature === signature && row.state === "PENDING" ? { ...row, state: written, reason } : row);
      const placements = current.depth.placements.map(mark);
      const madePool = placements.find((row) => row.kind === "POOL" && row.state === "CONFIRMED")?.pool ?? null;
      return { ...current, segments: current.segments.map(mark), depth: { pool: current.depth.pool ?? madePool, placements }, rounds: current.rounds.map((round) => ({ ...round, txs: round.txs.map(mark) })) };
    }).catch(() => null);
  }
  return { state, signature, reason };
}

/* ------------------------------------------------------------ the ledger */

/** Why what the rules owe may have stopped growing: the creator's role, or their locked LP, is no longer where it was. */
export const SPLIT_WARNINGS = ["ROLE_MOVED", "LP_MOVED"] as const;
export type SplitWarning = (typeof SPLIT_WARNINGS)[number];

export type SplitLedger = Readonly<{
  share: CreatorShareRead;
  /** What the rules count as claimed: the most ever read, never less. */
  claimedRaw: bigint;
  warnings: readonly SplitWarning[];
  subjectRaw: bigint;
  due: Readonly<Record<"self" | SplitGiven, bigint>>;
  done: Readonly<Record<SplitGiven, bigint>>;
  committed: Readonly<Record<SplitGiven, bigint>>;
  /** What is owed and not yet taken by anything landed or still able to land: what a next act may move. */
  open: Readonly<Record<SplitGiven, bigint>>;
}>;

async function ledgerOf(deps: SplitDeps, record: LaunchRecord, split: CreatorSplitRecord): Promise<SplitLedger> {
  const share = await (deps.share ?? ((launch) => defaultShare(deps, launch)))(record);
  /* Never below what was once read: an obligation shown to buyers does not shrink because a role or a position moved. */
  const peak = BigInt(split.peakClaimedRaw ?? "0");
  const read = BigInt(share.claimedRaw);
  const claimed = read > peak ? read : peak;
  if (read > peak) {
    await changeSplit(deps.store, split.cluster, split.token, (current) =>
      current && BigInt(current.peakClaimedRaw ?? "0") < read ? { ...current, peakClaimedRaw: read.toString() } : "kept",
    ).catch(() => null);
  }
  const warnings: SplitWarning[] = [];
  const roleHolders = new Set([record.creator, ...(record.feeSharing && record.feeSharing.state !== "FAILED" ? [record.feeSharing.vault] : [])]);
  if (!roleHolders.has(share.roleOwner)) warnings.push("ROLE_MOVED");
  if (share.lpHeld === false) warnings.push("LP_MOVED");
  const { due, subjectRaw } = splitDue(inForce(split), claimed);
  const { done, committed } = splitDone(split);
  return { share, claimedRaw: claimed, warnings, subjectRaw, due, done, committed, open: splitOutstanding(due, committed) };
}

async function splitOf(deps: SplitDeps, token: string, creator: string): Promise<Readonly<{ record: LaunchRecord; split: CreatorSplitRecord }> | SplitFailure> {
  if (!creatorSplitOpenFor(deps.network, deps.env ?? {}, deps.ownerWord)) return fail("CAPABILITY_UNAVAILABLE", "The creator's split is not open on this network.");
  const record = await launchOf(deps, token);
  if ("ok" in record) return record;
  if (record.creator !== creator) return fail("WALLET_MISMATCH", "Only the token's creator carries out the split.");
  const stored = await readCreatorSplit(deps.store, deps.network.cluster, token).catch(() => undefined);
  if (stored === undefined) return fail("UNAVAILABLE", "The split could not be read now; nothing was built.");
  if (!stored) return fail("LAUNCH_NOT_FOUND", "This token has no split of the creator's share.");
  const split = await settleSplit(deps, stored);
  if (!inForce(split).length) return fail("LAUNCH_NOT_FOUND", "No rule of the creator's split is in force yet.");
  return { record, split };
}

/* ------------------------------------------------------------ 2. depth */

/** The programs a depth act may call: the compute budget, DLMM, the system, the token programs and, for a new pool's proof, DAMM v2. */
const DEPTH_PROGRAMS = new Set([
  ComputeBudgetProgram.programId.toBase58(),
  DLMM_PROGRAM,
  SystemProgram.programId.toBase58(),
  TOKEN_PROGRAM_ID.toBase58(),
  TOKEN_2022_PROGRAM_ID.toBase58(),
  ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(),
]);
const DAMM_V2_PROGRAM = "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG";
/** The pair currency's cent a customizable pool's proof costs the creator when they hold none of the token, raw. */
export const SPLIT_PROOF_RAW = 10_000n;

const SYSTEM_TRANSFER = 2;
const TOKEN_SYNC_NATIVE = 17;
const TOKEN_CLOSE_ACCOUNT = 9;

/**
 * What makes a depth act's bytes other than the creator's own: a payer other than the creator; a program beyond the
 * act's; a top-level transfer of SOL to anything but the creator's own wrapped-SOL account; a top-level token
 * instruction but wrapping (sync) and closing an account back to the creator. The money of the steps moves inside
 * DLMM's own instructions, into the creator's position; nothing else leaves the creator's wallet.
 */
export function depthProblems(tx: Transaction, creator: string, phase: "POOL" | "SYNC" | "STEPS"): readonly string[] {
  const problems: string[] = [];
  const owner = new PublicKey(creator);
  if (tx.feePayer?.toBase58() !== creator) problems.push("The act is paid for by someone other than the creator.");
  const wrapped = new Set([TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].map((program) => getAssociatedTokenAddressSync(NATIVE_MINT, owner, true, program, ASSOCIATED_TOKEN_PROGRAM_ID).toBase58()));
  for (const instruction of tx.instructions) {
    const id = instruction.programId.toBase58();
    if (!DEPTH_PROGRAMS.has(id) && !(phase === "POOL" && id === DAMM_V2_PROGRAM)) {
      problems.push(`An instruction of another program: ${id}.`);
      continue;
    }
    const data = Buffer.from(instruction.data);
    if (instruction.programId.equals(SystemProgram.programId) && data.length >= 4 && data.readUInt32LE(0) === SYSTEM_TRANSFER) {
      const to = instruction.keys[1]?.pubkey.toBase58() ?? "";
      if (!wrapped.has(to)) problems.push(`A transfer of SOL to an account that is not the creator's: ${to}.`);
    }
    if (instruction.programId.equals(TOKEN_PROGRAM_ID) || instruction.programId.equals(TOKEN_2022_PROGRAM_ID)) {
      if (data[0] === TOKEN_SYNC_NATIVE) continue;
      if (data[0] === TOKEN_CLOSE_ACCOUNT && instruction.keys[1]?.pubkey.equals(owner)) continue;
      problems.push("A token instruction that is not the creator's own wrapping.");
    }
  }
  return problems;
}

/** A pool the creator's steps may stand in: the token its X, trading now, nobody able to switch it off, no vault before it. */
export function depthPoolAccepted(pool: FloorPool, now: number): boolean {
  return pool.tokenIsX && pool.binStep >= CREATOR_DEPTH_RULE.minBinStep && pool.enabled && !pool.creatorCanSwitchOff && !pool.alphaVault && pool.activationAt !== null && pool.activationAt <= now;
}

export type PreparedDepth = LaunchSplitDepthBuildResponse;

/** The creator's open position in the pool — the last one placed there that landed. */
function lastPosition(split: CreatorSplitRecord, pool: string): string | null {
  return [...split.depth.placements].reverse().find((row) => row.kind === "STEPS" && row.state === "CONFIRMED" && row.pool === pool && row.position)?.position ?? null;
}

export async function prepareSplitDepth(deps: SplitDeps, input: Readonly<{ token: string; creator: string }>): Promise<Readonly<{ ok: true; build: PreparedDepth }> | SplitFailure> {
  const found = await splitOf(deps, input.token, input.creator);
  if ("ok" in found) return found;
  const { record, split } = found;
  if (split.depth.placements.some((row) => row.state === "PENDING")) return fail("LAUNCH_BUILD_USED", "A depth act is on its way; build the next one once it lands or its time runs out.");
  const env = deps.env ?? {};
  let ledger: SplitLedger;
  try {
    ledger = await ledgerOf(deps, record, split);
  } catch {
    return fail("UNAVAILABLE", "The creator's fees could not be read now; nothing was built.");
  }
  if (!ledger.share.migrated || !ledger.share.dammPool) return fail("LAUNCH_NOT_GRADUATED", "Depth steps stand in the token's DLMM pool once it is on its DEX.");
  const minimums = splitMinimums(split.pair, deps.network.cluster);
  const owed = ledger.open.depth;
  if (owed < minimums.depthRaw) return fail("LAUNCH_NOTHING_TO_CLAIM", "Depth is owed less than the least the steps take now.");
  const venue = await venueOf(deps);
  const nowSeconds = Math.floor(deps.now().getTime() / 1000);
  const creator = new PublicKey(record.creator);
  let pool: FloorPool | null;
  let balance: bigint;
  let price: Awaited<ReturnType<NonNullable<SplitDeps["price"]>>>;
  try {
    pool = await venue.pool(record.token, record.pairMint);
    balance = await (deps.balance ?? ((owner, mint, program) => defaultBalance(deps.connection, owner, mint, program)))(record.creator, record.pairMint, split.pair.program);
    price = await (deps.price ?? ((dammPool, token) => defaultPrice(deps.connection, dammPool, token)))(ledger.share.dammPool, record.token);
  } catch {
    return fail("UNAVAILABLE", "The pool or the creator's balance could not be read now; nothing was built.");
  }
  if (!(price.price > 0)) return fail("UNAVAILABLE", "The token's price could not be read now; nothing was built.");
  let tx: Transaction;
  let phase: DepthPhase;
  let position: Keypair | null = null;
  let positionAddress: string | null = null;
  let amount = 0n;
  let ladder: PreparedDepth["ladder"] = null;
  let poolAddress: string;
  try {
    if (!pool) {
      /* No pool yet: the creator's first act makes it at the price's bin, on Ryntra's rule, so Ryntra's own ladder may stand in it too. */
      phase = "POOL";
      const marketBin = binOfPrice(price.price, FLOOR_RULE.binStep, price.tokenDecimals, price.pairDecimals);
      const holds = await (deps.balance ?? ((owner, mint, program) => defaultBalance(deps.connection, owner, mint, program)))(record.creator, record.token, TOKEN_2022_PROGRAM_ID.toBase58()).catch(() => 0n);
      if (balance < (holds > 0n ? 0n : SPLIT_PROOF_RAW)) return fail("LAUNCH_BALANCE_LOW", "The creator's wallet holds too little of the pair currency for the pool's proof.");
      tx = await venue.createPool({ token: record.token, pair: record.pairMint, activeBinId: marketBin, payer: record.creator, proof: holds > 0n ? null : { dammPool: ledger.share.dammPool, amountRaw: SPLIT_PROOF_RAW }, binStep: FLOOR_RULE.binStep });
      poolAddress = (await venue.pool(record.token, record.pairMint).catch(() => null))?.pool ?? (await derivePool(record));
    } else {
      if (!depthPoolAccepted(pool, nowSeconds)) return fail("CAPABILITY_UNAVAILABLE", "The token's DLMM pool is not one the creator's steps may stand in: it is closed, switchable or behind a vault.");
      poolAddress = pool.pool;
      const marketBin = binOfPrice(price.price, pool.binStep, pool.decimalsX, pool.decimalsY);
      /*
       * A pool whose price lags the market's from below — nothing in it to buy above its active bin, so no trade lifts
       * it — would take the steps far under the market. Its price is first taken up to the market's through its empty
       * bins (`go_to_a_bin`); a pool with liquidity in the way refuses it, and the act says so.
       */
      const gap = marketBin - creatorDepthLadder(marketBin, pool.binStep).upperBinId;
      const sync = marketBin - pool.activeBinId > gap ? await venue.syncSteps({ pool: pool.pool, owner: record.creator, position: null, activeBinId: marketBin }) : null;
      if (sync) {
        phase = "SYNC";
        tx = sync;
      } else {
        phase = "STEPS";
        amount = owed < balance ? owed : balance;
        if (amount < minimums.depthRaw) return fail("LAUNCH_BALANCE_LOW", "The creator's wallet holds less of the pair currency than the least the steps take.");
        /* The lower of the two prices: the steps never stand above the market or above the pool's own price. */
        const reference = Math.min(marketBin, pool.activeBinId);
        const bins = creatorDepthLadder(reference, pool.binStep);
        ladder = { ...bins, ...depthRangePct(bins, marketBin, pool.binStep) };
        const held = lastPosition(split, pool.pool);
        const read: StepsRead | null = held ? await venue.readSteps(pool.pool, held).catch(() => null) : null;
        if (held && read && BigInt(read.tokenRaw) <= TOKEN_DUST_RAW) {
          positionAddress = held;
          tx = await venue.placeSteps({ pool: pool.pool, owner: record.creator, position: held, ladder: bins, amountRaw: amount });
        } else {
          const opened = await venue.openSteps({ pool: pool.pool, owner: record.creator, ladder: bins, amountRaw: amount });
          tx = opened.transactions[0]!;
          position = opened.position;
          positionAddress = position.publicKey.toBase58();
        }
      }
    }
  } catch (error) {
    return fail("UNAVAILABLE", error instanceof Error ? error.message.slice(0, 300) : "The steps could not be built.");
  }
  let latest: Awaited<ReturnType<Connection["getLatestBlockhash"]>>;
  try {
    latest = await within(() => deps.connection.getLatestBlockhash("confirmed"));
  } catch {
    return fail("UNAVAILABLE", "The network could not be read now; nothing was built. Try again.");
  }
  tx.feePayer = creator;
  tx.recentBlockhash = latest.blockhash;
  const problems = depthProblems(tx, record.creator, phase);
  if (problems.length) return fail("UNAVAILABLE", `The act was not built as planned: ${problems[0]}`);
  const simulated = await (deps.simulate ?? ((built) => defaultSimulate(deps.connection, built)))(tx).catch((error: unknown) => (error instanceof Error ? error.message : "The act could not be simulated."));
  if (simulated) return fail("UNAVAILABLE", `The network would refuse the act: ${simulated}`.slice(0, 300));
  let cosign: string | null = null;
  if (position) {
    if (!ticketKeyConfigured(env)) return fail("LAUNCH_PAUSED", "Depth steps are paused; nothing was built.");
    cosign = sealCosigners([{ index: 0, key: position }], env);
    if (!cosign) return fail("LAUNCH_PAUSED", "Depth steps are paused; nothing was built.");
  }
  const raw = Buffer.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false })).toString("base64");
  const wire = position ? withoutSignaturesOf(raw, [position.publicKey.toBase58()]) : raw;
  const validUntil = String(latest.lastValidBlockHeight);
  const windows = await readBuildWindows(web3ChainReader(deps.connection, READ_MS), validUntil, { transactions: 1, capMs: SPLIT_BUILD_TTL_MS });
  const now = deps.now();
  const build: DepthBuild = {
    kind: "depth",
    id: randomBytes(16).toString("hex"),
    cluster: deps.network.cluster,
    token: record.token,
    creator: record.creator,
    phase,
    wire,
    messageSha256: sha256(tx.serializeMessage()),
    digest: reviewedDigest(tx),
    cosign,
    pool: poolAddress,
    position: positionAddress,
    amountRaw: amount.toString(),
    lowerBinId: ladder?.lowerBinId ?? null,
    upperBinId: ladder?.upperBinId ?? null,
    committedRaw: ledger.committed.depth.toString(),
    validUntil,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + windows.lifeMs).toISOString(),
  };
  await sweep(deps).catch(() => undefined);
  await builds(deps.store).insertIfAbsent(buildKey(build.cluster, build.id), build);
  return {
    ok: true,
    build: { buildId: build.id, network: deps.network.chain, phase, unsignedWireBase64: wire, pool: poolAddress, position: positionAddress, amountRaw: build.amountRaw, owedRaw: owed.toString(), ladder, expiresAt: build.expiresAt, signableMs: windows.signableMs },
  };
}

/** The customizable pool's address from the two mints, as the venue finds it. */
async function derivePool(record: LaunchRecord): Promise<string> {
  const { deriveCustomizablePermissionlessLbPair } = await import("@meteora-ag/dlmm");
  return deriveCustomizablePermissionlessLbPair(new PublicKey(record.token), new PublicKey(record.pairMint), new PublicKey(DLMM_PROGRAM))[0].toBase58();
}

export async function submitSplitDepth(
  deps: SplitDeps,
  input: Readonly<{ token: string; buildId: string; creator: string; signedWireBase64: string }>,
): Promise<Readonly<{ ok: true; submit: SplitSubmitted & Readonly<{ phase: DepthPhase; position: string | null; amountRaw: string }> }> | SplitFailure> {
  const deadline = deps.now().getTime() + ROUTE_MS;
  if (!creatorSplitOpenFor(deps.network, deps.env ?? {}, deps.ownerWord)) return fail("CAPABILITY_UNAVAILABLE", "The creator's split is not open on this network.");
  const build = await buildFor(deps, input, "depth");
  if ("ok" in build) return build;
  const keys = openCosigners(build.cosign, deps.env ?? {});
  if (!keys) return fail("LAUNCH_BUILD_EXPIRED", "The act can no longer be signed; build it again.");
  const tx = signedCommitment(input.signedWireBase64, build, keys.map((cosigner) => cosigner.key));
  if ("ok" in tx) return { ok: false, code: tx.code, message: tx.message };
  if (!(await sends(deps.store).insertIfAbsent(buildKey(build.cluster, build.id), { cluster: build.cluster, id: build.id, at: deps.now().toISOString() }))) {
    return fail("LAUNCH_BUILD_USED", "This act was already sent.");
  }
  const signature = signatureOf(tx);
  const placement: DepthPlacement = {
    kind: build.phase,
    signature,
    validUntil: build.validUntil,
    state: "PENDING",
    reason: null,
    pool: build.pool,
    position: build.position,
    amountRaw: build.amountRaw,
    lowerBinId: build.lowerBinId,
    upperBinId: build.upperBinId,
    at: deps.now().toISOString(),
  };
  /* Reserved before the send, in one compare-and-set: no other act on its way, and depth has taken what it had when this was built — two builds of the same owed money, signed both, and the second is refused here. */
  const reserved = await changeSplit(deps.store, build.cluster, build.token, (current) => {
    if (!current) return "This token has no split.";
    if (current.depth.placements.some((row) => row.state === "PENDING")) return "A depth act is on its way; nothing was sent.";
    if (splitDone(current).committed.depth.toString() !== build.committedRaw) return "Depth moved since this was built; nothing was sent. Build it again.";
    return { ...current, depth: { ...current.depth, placements: [...current.depth.placements, placement] } };
  }).catch(() => null);
  if (!reserved) return fail("UNAVAILABLE", "The split could not be written now; nothing was sent.");
  if (!reserved.ok) return fail("LAUNCH_BUILD_USED", reserved.reason);
  const sent = await sendOnce(deps.connection, tx, Number(build.validUntil), deps.now, { ...SEND_BUDGET, deadline }, {
    second: deps.second,
    ...(build.phase === "STEPS" && build.cosign && build.position ? { landed: (minSlot: number | null, cap: () => number) => accountOnChain([deps.connection, deps.second], build.position!, [DLMM_PROGRAM], minSlot, cap) } : {}),
  });
  const answered = await recordOutcome(deps, build.cluster, build.token, signature, sent);
  return { ok: true, submit: { ...answered, phase: build.phase, position: build.position, amountRaw: build.amountRaw } };
}

/* ------------------------------------------------------------ 3. the payout */

export type PreparedPayout = LaunchSplitPayoutBuildResponse;

/**
 * The holders a round may pay now, from a market read whole: every account of the mint and the bundle known in full.
 * Null when either was read in part — nothing is paid on a part.
 */
async function snapshotOf(deps: SplitDeps, record: LaunchRecord, split: CreatorSplitRecord, deadline: number): Promise<HolderSnapshot | null> {
  /* The market's read within the build's time too: past it, no round now — its read goes on and is kept for the next. */
  const marketMs = deadline - Date.now() - 5_000;
  if (marketMs <= 0) return null;
  const facts = await within(() => (deps.market ?? ((token: string) => readLaunchMarketFacts({ network: deps.network, connection: deps.connection, store: deps.store, now: deps.now, second: deps.second, adopt: deps.adopt }, token)))(record.token), marketMs).catch(() => null);
  /* Every account of the mint, and the bundle known in full. */
  if (!facts || !facts.mintAccounts) return null;
  const bundleGroup = facts.response.holders.groups.bundle;
  if (!bundleGroup || bundleGroup.atLeast) return null;
  const own = deps.ownWallets ? await deps.ownWallets().catch(() => null) : null;
  if (!own || !own.complete) return null;
  /*
   * Who bought what: the token's whole history, paged back to its creation — not the market's first page. The decoded
   * transactions are kept, so a round that ran out of time is read further by the next one; read in part, no round.
   */
  /* The history gets what is left of the build's time after the market's read — never past the route's minute. */
  const historyBudgetMs = Math.max(0, Math.min(HISTORY_BUDGET_MS, deadline - Date.now()));
  const history = await (deps.history ?? ((launch: LaunchRecord, read: LaunchMarketFacts, budget: number) => wholeHistory(deps, launch, read, budget)))(record, facts, historyBudgetMs).catch(() => null);
  if (!history || !history.complete) return null;
  const bundle = new Set<string>();
  for (const [wallet, labels] of facts.labels) if (labels.includes("bundle")) bundle.add(wallet);
  /* Tokens the creator's wallet paid for, delivered to another wallet — anywhere in the history: the creator's own. */
  for (const wallet of history.creatorPaid) bundle.add(wallet);
  const linked = linkedOf(record);
  for (const segment of inForce(split)) if (segment.rule.community) linked.add(segment.rule.community);
  return holderSnapshot(facts.mintAccounts, {
    bought: history.bought,
    creator: record.creator,
    linked,
    bundle,
    ryntra: new Set([...ryntraAddresses(deps.network), ...own.wallets]),
    onCurve: (address) => PublicKey.isOnCurve(new PublicKey(address).toBytes()),
  });
}

/** The most a round reads of the token's history; past it the round waits, and the next reads on from the kept part. */
const HISTORY_BUDGET_MS = 30_000;
/** A payout's build ends within this of its start, inside the route's minute: the history gets what is left. */
const PAYOUT_BUILD_MS = 42_000;

/** Who bought what, from the kept ledger read further now — the curve back to the creation, the pool back to the migration. */
async function wholeHistory(deps: SplitDeps, record: LaunchRecord, facts: LaunchMarketFacts, budgetMs: number) {
  const reader = launchMarketReader({ network: deps.network, connection: deps.connection, store: deps.store });
  const { ledger, complete } = await advanceBoughtLedger(
    {
      store: deps.store,
      cluster: deps.network.cluster,
      now: deps.now,
      list: nodeLister(launchHistoryConnection(deps.network)),
      decode: async (signature) => (await reader.transaction({ token: record.token, state: facts.state, signature })) ?? null,
      /* The move to the DEX as the cabinet finds it: the executor's receipt of the graduation first, else the curve's list. */
      migration: async () => {
        const graduated = facts.state.graduated;
        if (!graduated) return null;
        const known = (await autopilotReceipts(deps.store, deps.network.cluster, record.token).catch(() => [])).find((receipt) => receipt.kind === "GRADUATED")?.signature ?? null;
        return findMigrationSignature({ connection: deps.connection, readers: [deps.second ?? null, launchHistoryConnection(deps.network)], curve: record.pool, pool: graduated.pool, finishedAt: facts.state.curve.finishedAt, known }).catch(() => null);
      },
    },
    {
      token: record.token,
      creator: record.creator,
      curve: record.pool,
      creationSignature: record.signature,
      pool: facts.state.graduated ? facts.state.graduated.pool : null,
    },
    budgetMs,
  );
  return { bought: new Map(Object.entries(ledger.bought).map(([wallet, raw]) => [wallet, BigInt(raw)])), creatorPaid: new Set(ledger.creatorPaid), complete };
}

const PAYOUT_MEMO_PROGRAMS = new Set([ComputeBudgetProgram.programId.toBase58(), MEMO_PROGRAM]);

export async function prepareSplitPayout(deps: SplitDeps, input: Readonly<{ token: string; creator: string }>): Promise<Readonly<{ ok: true; build: PreparedPayout }> | SplitFailure> {
  const started = Date.now();
  const found = await splitOf(deps, input.token, input.creator);
  if ("ok" in found) return found;
  const { record, split } = found;
  if (split.rounds.some((round) => round.txs.some((tx) => tx.state === "PENDING"))) return fail("LAUNCH_BUILD_USED", "A payout is on its way; build the next one once it lands or its time runs out.");
  let ledger: SplitLedger;
  try {
    ledger = await ledgerOf(deps, record, split);
  } catch {
    return fail("UNAVAILABLE", "The creator's fees could not be read now; nothing was built.");
  }
  const minimums = splitMinimums(split.pair, deps.network.cluster);
  const communityWallet = inForce(split).at(-1)?.rule.community ?? null;
  const community = communityWallet && ledger.open.community >= minimums.communityRaw ? { wallet: communityWallet, amountRaw: ledger.open.community.toString() } : null;
  let rows: readonly HolderPayoutRow[] = [];
  let snapshot: PayoutRound["snapshot"] = null;
  let holdersUnread = false;
  if (ledger.open.holders >= minimums.holdersRoundRaw) {
    const read = await snapshotOf(deps, record, split, started + PAYOUT_BUILD_MS);
    if (!read) holdersUnread = true;
    else {
      rows = holdersPayout(ledger.open.holders, read, { maxWallets: SPLIT_HOLDERS_PER_ROUND, perHolderRaw: minimums.perHolderRaw }).rows;
      snapshot = { eligible: read.eligible.length, excluded: read.excluded };
    }
  }
  if (!community && !rows.length) {
    if (holdersUnread) return fail("UNAVAILABLE", "The token's holders and history could not be read whole yet; what was read is kept — try again, and the next read goes on from there.");
    return fail("LAUNCH_NOTHING_TO_CLAIM", "The community and the holders are owed less than the least a payout moves.");
  }
  const total = BigInt(community?.amountRaw ?? "0") + rows.reduce((sum, row) => sum + BigInt(row.amountRaw), 0n);
  let balance: bigint;
  try {
    balance = await (deps.balance ?? ((owner, mint, program) => defaultBalance(deps.connection, owner, mint, program)))(record.creator, split.pair.mint, split.pair.program);
  } catch {
    return fail("UNAVAILABLE", "The creator's balance could not be read now; nothing was built.");
  }
  if (balance < total) return fail("LAUNCH_BALANCE_LOW", "The creator's wallet holds less of the pair currency than this payout.");
  const ryntra = new Set([...ryntraAddresses(deps.network), ...((await deps.ownWallets?.().catch(() => null))?.wallets ?? [])]);
  const plan = [...(community ? [{ wallet: community.wallet, bonusRaw: community.amountRaw }] : []), ...rows.map((row) => ({ wallet: row.wallet, bonusRaw: row.amountRaw }))];
  let latest: Awaited<ReturnType<Connection["getLatestBlockhash"]>>;
  let built: Awaited<ReturnType<typeof buildBoostPayoutTransactions>>;
  try {
    latest = await within(() => deps.connection.getLatestBlockhash("confirmed"));
    built = await buildBoostPayoutTransactions({
      connection: deps.connection,
      creator: record.creator,
      currency: { mint: split.pair.mint, program: new PublicKey(split.pair.program), decimals: split.pair.decimals },
      escrow: null,
      rows: plan,
      recentBlockhash: latest.blockhash,
      maxTxs: SPLIT_PAYOUT_TXS,
    });
  } catch (error) {
    return fail("UNAVAILABLE", error instanceof Error ? error.message.slice(0, 300) : "The payout could not be built.");
  }
  const included = new Set(built.parts.flatMap((part) => part.wallets));
  const plannedRows = rows.filter((row) => included.has(row.wallet));
  const plannedCommunity = community && included.has(community.wallet) ? community : null;
  const planned = plan.filter((row) => included.has(row.wallet));
  /* The bytes pay the plan and nothing else — no wallet of Ryntra's, no account but a planned wallet's — or nothing leaves. */
  const problems = payoutProblems(built.txs, { creator: record.creator, mint: split.pair.mint, program: split.pair.program, rows: planned, ryntra });
  if (problems.length) return fail("UNAVAILABLE", `The payout was not built as planned: ${problems[0]}`);
  const round = split.rounds.length + 1;
  const holdersTotal = plannedRows.reduce((sum, row) => sum + BigInt(row.amountRaw), 0n);
  const root = await splitRoot(plannedRows);
  const memo = splitRoundMemo(record.token, round, root, plannedRows.length, holdersTotal);
  const creator = new PublicKey(record.creator);
  const memoTx = new Transaction().add(memoInstruction(memo, creator));
  memoTx.feePayer = creator;
  memoTx.recentBlockhash = latest.blockhash;
  if (memoTx.instructions.some((instruction) => !PAYOUT_MEMO_PROGRAMS.has(instruction.programId.toBase58()))) return fail("UNAVAILABLE", "The root's transaction was not built as planned.");
  const txs = [memoTx, ...built.txs];
  const validUntil = String(latest.lastValidBlockHeight);
  const windows = await readBuildWindows(web3ChainReader(deps.connection, READ_MS), validUntil, { transactions: txs.length, capMs: SPLIT_BUILD_TTL_MS });
  const now = deps.now();
  const communityOf = (wallets: readonly string[]) => (plannedCommunity && wallets.includes(plannedCommunity.wallet) ? BigInt(plannedCommunity.amountRaw) : 0n);
  const build: PayoutBuild = {
    kind: "payout",
    id: randomBytes(16).toString("hex"),
    cluster: deps.network.cluster,
    token: record.token,
    creator: record.creator,
    wires: txs.map((tx) => Buffer.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false })).toString("base64")),
    parts: [
      { memo: true, wallets: [], holdersRaw: "0", communityRaw: "0" },
      ...built.parts.map((part) => {
        const communityRaw = communityOf(part.wallets);
        return { memo: false, wallets: part.wallets, holdersRaw: (BigInt(part.amountRaw) - communityRaw).toString(), communityRaw: communityRaw.toString() };
      }),
    ],
    round,
    root,
    rows: plannedRows,
    community: plannedCommunity,
    snapshot,
    committed: { holdersRaw: ledger.committed.holders.toString(), communityRaw: ledger.committed.community.toString() },
    validUntil,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + Math.max(0, windows.lifeMs - NEXT_TRANSACTION_MARGIN_MS * (txs.length - 1))).toISOString(),
  };
  await sweep(deps).catch(() => undefined);
  await builds(deps.store).insertIfAbsent(buildKey(build.cluster, build.id), build);
  return {
    ok: true,
    build: {
      buildId: build.id,
      network: deps.network.chain,
      unsignedWireBase64: [...build.wires],
      round,
      root,
      memo,
      rows: plannedRows.map((row) => ({ ...row })),
      community: plannedCommunity,
      holdersRaw: holdersTotal.toString(),
      communityRaw: (plannedCommunity?.amountRaw ?? "0").toString(),
      owed: { holdersRaw: ledger.open.holders.toString(), communityRaw: ledger.open.community.toString() },
      snapshot: snapshotView(snapshot),
      pair: split.pair,
      expiresAt: build.expiresAt,
      signableMs: windows.signableMs,
    },
  };
}

export type PayoutSubmitted = LaunchSplitPayoutSubmitResponse;

export async function submitSplitPayout(
  deps: SplitDeps,
  input: Readonly<{ token: string; buildId: string; creator: string; signedWireBase64: readonly string[] }>,
): Promise<Readonly<{ ok: true; submit: PayoutSubmitted }> | SplitFailure> {
  const deadline = deps.now().getTime() + ROUTE_MS;
  if (!creatorSplitOpenFor(deps.network, deps.env ?? {}, deps.ownerWord)) return fail("CAPABILITY_UNAVAILABLE", "The creator's split is not open on this network.");
  const build = await buildFor(deps, input, "payout");
  if ("ok" in build) return build;
  if (input.signedWireBase64.length !== build.wires.length) return fail("LAUNCH_SIGNED_OTHER_BYTES", "The wallet did not sign every transaction of the payout.");
  const txs: Transaction[] = [];
  for (let index = 0; index < build.wires.length; index += 1) {
    /* The wallet's own fee and guard instructions are its right; any other change is not the payout the creator reviewed. */
    const verdict = compareWalletTransaction({ expectedWireBase64: build.wires[index]!, actualWireBase64: input.signedWireBase64[index]!, guardPolicy: "BOUNDED" });
    if (verdict.verdict !== "EXACT" && verdict.verdict !== "WALLET_GUARDS_ONLY") return fail("LAUNCH_SIGNED_OTHER_BYTES", "The wallet signed a different transaction than the one built.");
    let tx: Transaction;
    try {
      tx = Transaction.from(Buffer.from(input.signedWireBase64[index]!, "base64"));
    } catch {
      return fail("LAUNCH_SIGNED_OTHER_BYTES", "The wallet returned bytes that are not a transaction.");
    }
    if (!tx.verifySignatures(true)) return fail("LAUNCH_SIGNED_OTHER_BYTES", "A signature is missing or does not match the transaction.");
    txs.push(tx);
  }
  if (!(await sends(deps.store).insertIfAbsent(buildKey(build.cluster, build.id), { cluster: build.cluster, id: build.id, at: deps.now().toISOString() }))) {
    return fail("LAUNCH_BUILD_USED", "This payout was already sent.");
  }
  const reservedTxs: PayoutTx[] = build.parts.map((part, index) => ({
    signature: signatureOf(txs[index]!),
    validUntil: build.validUntil,
    state: "PENDING",
    reason: null,
    memo: part.memo,
    wallets: part.wallets,
    holdersRaw: part.holdersRaw,
    communityRaw: part.communityRaw,
  }));
  const round: PayoutRound = { round: build.round, root: build.root, rows: build.rows, community: build.community, snapshot: build.snapshot, txs: reservedTxs, at: deps.now().toISOString() };
  /*
   * Reserved PENDING before the first send, in one compare-and-set: no payout on its way, and the community and the
   * holders have taken what they had when this was built — a second build of the same owed money is refused here.
   */
  const reservation = await changeSplit(deps.store, build.cluster, build.token, (current) => {
    if (!current) return "This token has no split.";
    if (current.rounds.some((row) => row.txs.some((tx) => tx.state === "PENDING"))) return "A payout is on its way; nothing was sent.";
    const { committed } = splitDone(current);
    if (committed.holders.toString() !== build.committed.holdersRaw || committed.community.toString() !== build.committed.communityRaw) return "The payouts moved since this was built; nothing was sent. Build it again.";
    if (current.rounds.some((row) => row.round === build.round)) return "This round was already sent.";
    return { ...current, rounds: [...current.rounds, round] };
  }).catch(() => null);
  if (!reservation) return fail("UNAVAILABLE", "The split could not be written now; nothing was sent. Build the payout again.");
  if (!reservation.ok) return fail("LAUNCH_BUILD_USED", reservation.reason);
  const answered: { signature: string; state: SplitTxState; memo: boolean; wallets: number; amountRaw: string; reason: string | null }[] = [];
  for (let index = 0; index < txs.length; index += 1) {
    const part = reservedTxs[index]!;
    const amountRaw = (BigInt(part.holdersRaw) + BigInt(part.communityRaw)).toString();
    /*
     * After one that did not land, the rest are not sent; nor after a root not seen landed: no transfer leaves without
     * the root on chain. What is not sent stays PENDING with its reason — its signed bytes live until their blockhash
     * expires — and `settleSplit` frees it then.
     */
    if (answered.some((tx) => tx.state !== "CONFIRMED") || deadline - deps.now().getTime() < PART_MIN_MS) {
      const reason = "not sent: an earlier part did not land, or the route's time ran out";
      await markRoundTx(deps, build, part.signature, "PENDING", reason);
      answered.push({ signature: part.signature, state: "FAILED", memo: part.memo, wallets: part.wallets.length, amountRaw, reason });
      continue;
    }
    const sent = await sendOnce(deps.connection, txs[index]!, Number(build.validUntil), deps.now, { ...SEND_BUDGET, deadline }, { second: deps.second });
    const outcome = await recordOutcome(deps, build.cluster, build.token, part.signature, sent);
    answered.push({ signature: part.signature, state: outcome.state, memo: part.memo, wallets: part.wallets.length, amountRaw, reason: outcome.reason });
  }
  const paid = answered.filter((tx) => tx.state === "CONFIRMED").reduce((sum, tx) => sum + BigInt(tx.amountRaw), 0n);
  const state = answered.some((tx) => tx.state === "FAILED") ? "PARTIAL" : answered.some((tx) => tx.state === "PENDING") ? "PENDING" : "PAID";
  return { ok: true, submit: { state, round: build.round, txs: answered, paidRaw: paid.toString() } };
}

async function markRoundTx(deps: SplitDeps, build: PayoutBuild, signature: string, state: SplitTxState, reason: string | null): Promise<void> {
  await changeSplit(deps.store, build.cluster, build.token, (current) =>
    current ? { ...current, rounds: current.rounds.map((round) => (round.round === build.round ? { ...round, txs: round.txs.map((tx) => (tx.signature === signature && tx.state === "PENDING" ? { ...tx, state, reason } : tx)) } : round)) } : "gone",
  ).catch(() => null);
}

/* ------------------------------------------------------------ 4. the page */

export type SplitStepsView = Readonly<{
  position: string;
  pool: string;
  lowerBinId: number;
  upperBinId: number;
  /** The pair currency the steps hold, the token they bought, the fees they earned — raw; null when not read. */
  pairRaw: string | null;
  tokenRaw: string | null;
  feePairRaw: string | null;
}>;

export type CreatorSplitView = LaunchSplitView;

function str<K extends string>(amounts: Readonly<Record<K, bigint>>): Record<K, string> {
  return Object.fromEntries(Object.entries<bigint>(amounts).map(([key, value]) => [key, value.toString()])) as Record<K, string>;
}

/**
 * The split as the cabinet and the token's page show it — for a launch with no rule yet, the empty split, so the creator
 * may write one. Null when the token is no Ryntra launch here. What was sent and not answered is settled from the chain
 * first; a read that fails leaves its figures null and `read` NOT_READ. The newest rounds only (`VIEW_ROUNDS`).
 */
export async function creatorSplitView(deps: SplitDeps, token: string, options: Readonly<{ steps?: boolean }> = {}): Promise<CreatorSplitView | null> {
  const record = await launchOf(deps, token);
  if ("ok" in record) return null;
  const stored = await readCreatorSplit(deps.store, deps.network.cluster, token);
  const configured = launchPair(deps.network, record.preset, record.pairMint);
  const pairView = stored ? { mint: stored.pair.mint, symbol: stored.pair.symbol, decimals: stored.pair.decimals, dollar: stored.pair.dollar } : { mint: record.pairMint, symbol: configured.symbol, decimals: configured.decimals, dollar: configured.dollar };
  const minimums = splitMinimums(stored?.pair ?? configured, deps.network.cluster);
  const open = creatorSplitOpenFor(deps.network, deps.env ?? {}, deps.ownerWord);
  if (!stored) {
    return {
      network: deps.network.chain,
      token,
      creator: record.creator,
      open,
      read: "OK",
      rule: null,
      since: null,
      pendingRule: null,
      segments: [],
      lines: { uk: [], en: [] },
      pair: pairView,
      ledger: null,
      minimums: str(minimums),
      depth: { pool: null, rule: { ...CREATOR_DEPTH_RULE }, placements: [], steps: [] },
      rounds: [],
      observedAt: deps.now().toISOString(),
    };
  }
  const split = await settleSplit(deps, stored).catch(() => stored);
  const segments = inForce(split);
  const current = segments.at(-1) ?? null;
  const pending = split.segments.find((segment) => segment.state === "PENDING") ?? null;
  let unread = false;
  let ledger: CreatorSplitView["ledger"] = null;
  if (segments.length) {
    const read = await ledgerOf(deps, record, split).catch(() => null);
    if (!read) unread = true;
    else ledger = { earnedRaw: read.share.earnedRaw, claimedRaw: read.claimedRaw.toString(), subjectRaw: read.subjectRaw.toString(), due: str(read.due), done: str(read.done), owed: str(splitOutstanding(read.due, read.done)), warnings: [...read.warnings] };
  }
  /* The newest positions first; the token's page asks for none of them — the steps are the cabinet's. */
  const positions = options.steps === false ? [] : [...new Set(split.depth.placements.filter((row) => row.kind === "STEPS" && row.state === "CONFIRMED" && row.position).map((row) => `${row.pool}|${row.position}`).reverse())].slice(0, VIEW_STEPS);
  const venue = positions.length ? await venueOf(deps).catch(() => null) : null;
  const steps: SplitStepsView[] = [];
  for (const key of positions) {
    const [pool, position] = key.split("|") as [string, string];
    const last = [...split.depth.placements].reverse().find((row) => row.position === position && row.state === "CONFIRMED");
    let read: StepsRead | null | undefined = venue ? await within(() => venue.readSteps(pool, position)).catch(() => undefined) : undefined;
    /* A position the creator closed reads as nothing — it holds nothing now —, never as a read that failed. */
    if (!read && (await within(() => deps.connection.getAccountInfo(new PublicKey(position), "confirmed")).catch(() => undefined)) === null) read = { position, lowerBinId: last?.lowerBinId ?? 0, upperBinId: last?.upperBinId ?? 0, pairRaw: "0", tokenRaw: "0", feePairRaw: "0" };
    if (!read) unread = true;
    steps.push({
      position,
      pool,
      lowerBinId: read?.lowerBinId ?? last?.lowerBinId ?? 0,
      upperBinId: read?.upperBinId ?? last?.upperBinId ?? 0,
      pairRaw: read ? read.pairRaw : null,
      tokenRaw: read ? read.tokenRaw : null,
      feePairRaw: read ? read.feePairRaw : null,
    });
  }
  return {
    network: deps.network.chain,
    token,
    creator: split.creator,
    open,
    read: unread ? "NOT_READ" : "OK",
    rule: current ? ruleView(current.rule) : null,
    since: segments[0]?.at ?? null,
    pendingRule: pending ? ruleView(pending.rule) : null,
    segments: segments.slice(-VIEW_SEGMENTS).map((segment) => ({ rule: ruleView(segment.rule), since: segment.at, signature: segment.signature, fromEarnedRaw: segment.fromEarnedRaw })),
    lines: current ? linesOf(current.rule, segments[0]!.at, split.pair.symbol, current.at) : { uk: [], en: [] },
    pair: pairView,
    ledger,
    minimums: str(minimums),
    depth: { pool: split.depth.pool, rule: { ...CREATOR_DEPTH_RULE }, placements: split.depth.placements.slice(-VIEW_ROUNDS).map((row) => ({ ...row })), steps },
    rounds: split.rounds.slice(-VIEW_ROUNDS).map(roundView),
    observedAt: deps.now().toISOString(),
  };
}

const ruleView = (rule: SplitRule) => ({ shares: { ...rule.shares }, community: rule.community });
const snapshotView = (snapshot: PayoutRound["snapshot"]) =>
  snapshot ? { eligible: snapshot.eligible, excluded: { creator: { ...snapshot.excluded.creator }, linked: { ...snapshot.excluded.linked }, bundle: { ...snapshot.excluded.bundle }, program: { ...snapshot.excluded.program }, ryntra: { ...snapshot.excluded.ryntra }, unbought: { ...snapshot.excluded.unbought } } } : null;
const roundView = (round: PayoutRound) => ({
  round: round.round,
  root: round.root,
  rows: round.rows.map((row) => ({ ...row })),
  community: round.community ? { ...round.community } : null,
  snapshot: snapshotView(round.snapshot),
  txs: round.txs.map((tx) => ({ ...tx, wallets: [...tx.wallets] })),
  at: round.at,
});

/** How many of the newest rounds and depth acts, positions and rules the view carries — the contract's bounds. */
export const VIEW_ROUNDS = 20;
export const VIEW_STEPS = 20;
export const VIEW_SEGMENTS = 50;

/** How long the token page keeps a split's view: its visitors do not each read the creator's fees from the chain. */
export const PAGE_VIEW_MS = 30_000;
const pageViews = new Map<string, Readonly<{ at: number; view: Promise<CreatorSplitView | null> }>>();

/**
 * The split as the token's page shows it — without the steps' reads —, one read per token and process at a time and its
 * answer kept `PAGE_VIEW_MS`; a read that failed is not kept.
 */
/** A token's kept view let go — after the creator's own act, so the page says it at once. */
export function forgetPageSplitView(cluster: string, token: string): void {
  pageViews.delete(`${cluster}:${token}`);
}

export function pageSplitView(deps: SplitDeps, token: string): Promise<CreatorSplitView | null> {
  const key = `${deps.network.cluster}:${token}`;
  const now = deps.now().getTime();
  const kept = pageViews.get(key);
  if (kept && now - kept.at < PAGE_VIEW_MS) return kept.view;
  const view = creatorSplitView(deps, token, { steps: false });
  pageViews.set(key, { at: now, view });
  /* A read that failed, or read the chain in part, is not kept: the next visitor asks again. */
  view.then((answer) => (answer?.read === "NOT_READ" ? pageViews.delete(key) : undefined)).catch(() => pageViews.delete(key));
  if (pageViews.size > 500) pageViews.delete(pageViews.keys().next().value!);
  return view;
}

/** The lines the token page shows before a purchase, from the split's own record — no read of the chain. Empty without a rule in force. */
export function splitOfferLines(record: CreatorSplitRecord | null, locale: "uk" | "en"): readonly string[] {
  if (!record) return [];
  const segments = inForce(record);
  const current = segments.at(-1);
  if (!current) return [];
  return splitRuleLines(current.rule, { since: segments[0]!.at, raisedAt: current.at, pairSymbol: record.pair.symbol }, locale);
}

export { SPLIT_GIVEN };
