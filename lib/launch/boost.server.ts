/**
 * Launch Boost — the server's half of a creator's campaign for buyers.
 *
 * 1. **Commit** (`prepareBoost` → `submitBoost`). The token must be a Ryntra
 *    launch of this creator, the rules inside the bounds the operator approved
 *    (`RYNTRA_LAUNCH_BOOST_BOUNDS` on mainnet; the stand's own on devnet), and
 *    the token without a campaign. The whole budget goes into Met Lock's vesting
 *    escrow from the creator to the creator, everything unlocking at once when
 *    the campaign and its hold are over; nobody may cancel it or change its
 *    recipient (`cancelMode`, `updateRecipientMode` 0), so the creator cannot
 *    take the budget out before the buyers are counted. The escrow's base is a
 *    fresh key, sealed with the build until the creator has signed, as a
 *    launch's lock is (`flow.server.ts`); the signed bytes must be the built
 *    message, or the same instructions with what a wallet may add.
 * 2. **Payout** (`prepareBoostPayout` → `submitBoostPayout`). Once the hold is
 *    over and the token's history from the campaign's start was read whole,
 *    `boostPayouts` counts who is paid; the creator's transactions claim the
 *    escrow back to the creator and pay each wallet from there, in as many
 *    transactions as the payout needs, all signed in one window. Every
 *    instruction is checked before the bytes leave: only the planned wallets
 *    receive anything, the creator pays, and no wallet of Ryntra's is among them.
 * 3. **The page** (`boostView`): the rules and their lines, what the escrow
 *    holds as the chain says, what was paid. A read that fails is «not read»,
 *    never zero.
 *
 * Ryntra takes 0 of a campaign, holds no key of the creator's and signs nothing
 * of theirs; a creator who never signs the payout keeps the money.
 *
 * Server-only. The collections it writes (`launchBoosts`, `launchBoostBuilds`,
 * `launchBoostSends`) join the store's list with the integration.
 */

import { createHash, randomBytes } from "node:crypto";

import { LOCK_PROGRAM_ID, LockClient, deriveEscrow } from "@meteora-ag/met-lock-sdk";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { getBase58Decoder } from "@solana/kit";
import { ComputeBudgetProgram, Keypair, PublicKey, Transaction, VersionedTransaction, type Connection, type TransactionInstruction } from "@solana/web3.js";
import BN from "bn.js";

import type { ApiErrorCode } from "../api/v1/contract.ts";
import { ATTRIBUTION_REGISTRY } from "../attribution/registry.ts";
import {
  DEVNET_BOOST_BOUNDS,
  boostBoundsHold,
  boostPayouts,
  boostRuleLines,
  boostRuleProblems,
  boostUnlocksAt,
  type BoostBounds,
  type BoostPayoutRow,
  type BoostPayouts,
  type BoostRules,
  type BoostTrade,
} from "../core/launch/boost.ts";
import { MET_LOCK_NOBODY } from "../core/launch/creator-lock.ts";
import { tokenAccountOf } from "../core/venues/meteora-dbc/exit.ts";
import { launchPreset } from "../core/venues/meteora-dbc/presets.ts";
import { withBoundedCasRetry, type GuardStore } from "../guard/store.ts";
import type { Env } from "../liquidity/studio/gate.ts";
import { openCosigners, reviewedDigest, sealCosigners, ticketKeyConfigured, walletAdditionsAllowed, withoutSignaturesOf } from "../liquidity/studio/ticket.ts";
import { NEXT_TRANSACTION_MARGIN_MS, readBuildWindows, web3ChainReader } from "../solana/blockhash-life.ts";
import { ed25519Valid } from "../solana/limits/trigger-tx.ts";
import { compareWalletTransaction } from "../solana/wallet-modification.ts";
import type {
  LaunchBoostBuildResponse,
  LaunchBoostPayoutBuildResponse,
  LaunchBoostPayoutSubmitResponse,
  LaunchBoostRules,
  LaunchBoostSubmitResponse,
  LaunchBoostView,
} from "../api/v1/contract.ts";
import { launchPair, launchWritesHere, type LaunchNetwork } from "./config.server.ts";
import { accountOnChain, readLaunchRecord, sendOnce, signatureOutcome, type LaunchReadDeps, type LaunchRecord } from "./flow.server.ts";
import { readLaunchTradeRecord } from "./record.server.ts";
import { launchMarketReader } from "./trade-index.server.ts";

/* ------------------------------------------------------------ bounds */

/** The operator's bounds for mainnet campaigns, as JSON of `BoostBounds`. Absent or invalid, no campaign opens on mainnet. */
export const BOOST_BOUNDS_ENV = "RYNTRA_LAUNCH_BOOST_BOUNDS";

/**
 * The bounds campaigns stay inside here; null — Launch Boost is not open. The devnet stand has its own; mainnet only the
 * Owner's, through `RYNTRA_LAUNCH_BOOST_BOUNDS`, and only on the deployment that writes launches there (its store is the
 * one the token page reads).
 */
export function boostBounds(network: LaunchNetwork, env: Env = process.env): BoostBounds | null {
  if (network.cluster === "devnet") return DEVNET_BOOST_BOUNDS;
  if (!launchWritesHere(network, env as NodeJS.ProcessEnv)) return null;
  const raw = env[BOOST_BOUNDS_ENV]?.trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<BoostBounds> | null;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const budget = parsed.maxBudgetRaw as Partial<BoostBounds["maxBudgetRaw"]> | undefined;
    const bounds: BoostBounds = {
      currencies: Array.isArray(parsed.currencies) ? parsed.currencies : [],
      routes: Array.isArray(parsed.routes) ? parsed.routes : [],
      minBonusBps: Number(parsed.minBonusBps),
      maxBonusBps: Number(parsed.maxBonusBps),
      minMinutes: Number(parsed.minMinutes),
      maxDays: Number(parsed.maxDays),
      maxStartDays: Number(parsed.maxStartDays),
      minHoldHours: Number(parsed.minHoldHours),
      maxHoldHours: Number(parsed.maxHoldHours),
      minBuyFloorRaw: String(parsed.minBuyFloorRaw ?? ""),
      maxCapShareBps: Number(parsed.maxCapShareBps),
      maxBudgetRaw: { PAIR: budget?.PAIR === undefined ? null : budget.PAIR, TOKEN: budget?.TOKEN === undefined ? null : budget.TOKEN },
    };
    for (const value of [bounds.maxBudgetRaw.PAIR, bounds.maxBudgetRaw.TOKEN]) if (value !== null && typeof value !== "string") return null;
    return boostBoundsHold(bounds) ? Object.freeze(bounds) : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------ records */

export const LAUNCH_BOOSTS = "launchBoosts" as const;
export const LAUNCH_BOOST_BUILDS = "launchBoostBuilds" as const;
export const LAUNCH_BOOST_SENDS = "launchBoostSends" as const;

export type BoostCurrencyFacts = Readonly<{ mint: string; program: string; decimals: number; symbol: string }>;

export type BoostPayoutTx = Readonly<{
  signature: string;
  wallets: readonly string[];
  amountRaw: string;
  state: "CONFIRMED" | "PENDING" | "FAILED";
  reason: string | null;
  validUntil: string;
}>;

/**
 * A token's campaign, keyed `<cluster>:<token>`. Every write is a compare-and-set on `version`: the commitment opened
 * once, its settling and each payout's reservation never lost under a concurrent write.
 */
export type BoostCampaign = Readonly<{
  version: number;
  cluster: LaunchNetwork["cluster"];
  token: string;
  creator: string;
  currency: BoostCurrencyFacts;
  rules: BoostRules;
  /**
   * Purchases count from here: the rules' start, or the moment the budget was first seen locked — from then the page
   * says the rules — if later. Before LOCKED, the moment the commitment was sent.
   */
  countsFrom: number;
  unlocksAt: number;
  escrow: string;
  commitment: Readonly<{ buildId: string; signature: string; state: "PENDING" | "LOCKED" | "FAILED"; reason: string | null; validUntil: string }>;
  /** Every payout transaction sent, in order; a wallet in a CONFIRMED or PENDING one is never planned again. */
  payouts: readonly BoostPayoutTx[];
  createdAt: string;
}>;

type CommitBuild = Readonly<{
  kind: "commit";
  id: string;
  cluster: LaunchNetwork["cluster"];
  token: string;
  creator: string;
  wire: string;
  messageSha256: string;
  digest: string;
  cosign: string;
  escrow: string;
  currency: BoostCurrencyFacts;
  rules: BoostRules;
  validUntil: string;
  createdAt: string;
  expiresAt: string;
}>;

type PayoutBuild = Readonly<{
  kind: "payout";
  id: string;
  cluster: LaunchNetwork["cluster"];
  token: string;
  creator: string;
  wires: readonly string[];
  /** The wallets and the amount each transaction pays. */
  parts: readonly Readonly<{ wallets: readonly string[]; amountRaw: string }>[];
  /** Eligible wallets this build leaves for a next one. */
  remaining: number;
  validUntil: string;
  createdAt: string;
  expiresAt: string;
}>;

type BoostBuild = CommitBuild | PayoutBuild;

const campaignKey = (cluster: string, token: string) => `${cluster}:${token}`;
const buildKey = (cluster: string, id: string) => `${cluster}:${id}`;
const campaigns = (store: GuardStore) => store.versioned<BoostCampaign>(LAUNCH_BOOSTS);
const builds = (store: GuardStore) => store.collection<BoostBuild>(LAUNCH_BOOST_BUILDS);
const sends = (store: GuardStore) => store.collection<Readonly<{ cluster: string; id: string; at: string }>>(LAUNCH_BOOST_SENDS);
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const signatureOf = (tx: Transaction) => getBase58Decoder().decode(new Uint8Array(tx.signatures[0]?.signature ?? new Uint8Array(64)));

export async function readBoostCampaign(store: GuardStore, cluster: string, token: string): Promise<BoostCampaign | null> {
  return (await campaigns(store).get(campaignKey(cluster, token))) ?? null;
}

type CampaignChange = Omit<BoostCampaign, "version">;

/**
 * A campaign's read-decide-write as one compare-and-set: `decide` sees the stored row (null when there is none) and
 * answers the row to write, or a string — the reason nothing is written. A write that lost the race reads again.
 */
async function changeCampaign(
  store: GuardStore,
  cluster: string,
  token: string,
  decide: (current: BoostCampaign | null) => CampaignChange | string,
): Promise<Readonly<{ ok: true; row: BoostCampaign }> | Readonly<{ ok: false; reason: string }>> {
  const rows = campaigns(store);
  const key = campaignKey(cluster, token);
  return withBoundedCasRetry(async () => {
    const current = (await rows.get(key)) ?? null;
    /* A row written without a version is no row a compare-and-set can move: refused, never written as NaN. */
    if (current && !Number.isInteger(current.version)) return { ok: false as const, reason: "The campaign's record has no version; nothing was written." };
    const decided = decide(current);
    if (typeof decided === "string") return { ok: false as const, reason: decided };
    const row: BoostCampaign = { ...decided, version: current ? current.version + 1 : 0 };
    return (await rows.compareAndSet(key, current ? current.version : null, row)) ? { ok: true as const, row } : false;
  });
}

/* ------------------------------------------------------------ deps and failures */

export type BoostEscrowObservation = Readonly<{
  escrow: string;
  mint: string;
  creator: string;
  recipient: string;
  totalRaw: string;
  claimedRaw: string;
  heldRaw: string;
  cliffAt: number;
  cancelMode: number;
  updateRecipientMode: number;
}>;

export type BoostDeps = Pick<LaunchReadDeps, "store" | "connection" | "second" | "adopt"> &
  Readonly<{
    network: LaunchNetwork;
    now: () => Date;
    /** The bounds' variable and the server's key (`BETA_TOKEN_SECRET`) that seals the escrow's base until the creator has signed. */
    env?: Env;
    /** The token's trades in `[from, to]` (unix seconds), with whether every one was read — the market reader's by default. */
    trades?: (args: Readonly<{ record: LaunchRecord; from: number; to: number; budgetMs: number }>) => Promise<Readonly<{ trades: readonly BoostTrade[]; complete: boolean }>>;
    /** Ryntra's own wallets; absent, or read in part, the payout is not counted. */
    ownWallets?: () => Promise<Readonly<{ wallets: ReadonlySet<string>; complete: boolean }>>;
    /** The escrow as the chain stores it, null when there is none — Met Lock's own read by default. A read that fails throws. */
    observe?: (escrow: string) => Promise<BoostEscrowObservation | null>;
    /** Whether Ryntra's trade route sent this purchase — Launch's trade records by default. */
    sentByRyntra?: (signature: string) => Promise<boolean>;
  }>;

export type BoostFailure = Readonly<{ ok: false; code: ApiErrorCode; message: string; issues?: readonly Readonly<{ path: string; message: string }>[] }>;
const fail = (code: ApiErrorCode, message: string, issues?: BoostFailure["issues"]): BoostFailure => ({ ok: false, code, message, ...(issues ? { issues } : {}) });

/** Rules as the request carries them, made whole: routes default to Ryntra's. */
export function rulesOf(input: LaunchBoostRules | BoostRules): BoostRules {
  return {
    currency: input.currency,
    bonusBps: input.bonusBps,
    minBuyRaw: input.minBuyRaw,
    capPerWalletRaw: input.capPerWalletRaw,
    budgetRaw: input.budgetRaw,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    holdHours: input.holdHours,
    routes: input.routes ?? "ryntra",
  };
}

const READ_MS = 8_000;
/** The longest a built commitment or payout waits for the creator's signature: the bytes live as long as their blockhash. */
export const BOOST_BUILD_TTL_MS = 2 * 60 * 1000;
/** The most transactions one payout build carries — one wallet window; wallets past them go into a next build. */
export const PAYOUT_TXS_PER_BUILD = 8;
/** The most wallets one transaction pays, whatever else fits. */
export const PAYOUT_WALLETS_PER_TX = 12;
/** A transaction's whole wire, signatures included, at most. */
export const TX_MAX_BYTES = 1_232;
const SEND_BUDGET = { confirmMs: 20_000, settleMs: 8_000 } as const;
/** How long the page's count may read the token's history; past it the count is «not read». */
const VIEW_HISTORY_MS = 8_000;
const ROUTE_MS = 50_000;
const PART_MIN_MS = 6_000;

async function within<T>(read: () => Promise<T>, ms = READ_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([read(), new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error("The network did not answer in time.")), ms)))]);
  } finally {
    clearTimeout(timer);
  }
}

/** The units the lines speak in, from the launch's preset and pair. */
function unitsOf(network: LaunchNetwork, record: LaunchRecord) {
  const pair = launchPair(network, record.preset, record.pairMint);
  return { symbol: record.symbol, decimals: launchPreset(record.preset)?.token.decimals ?? 6, pairSymbol: pair.symbol, pairDecimals: pair.decimals, dollar: pair.dollar };
}

function linesOf(network: LaunchNetwork, record: LaunchRecord, rules: BoostRules) {
  const units = unitsOf(network, record);
  return { uk: [...boostRuleLines(rules, units, "uk")], en: [...boostRuleLines(rules, units, "en")] };
}

/** A mint's token program and decimals as the chain stores it; null when the account is not a mint. */
async function mintFacts(connection: Connection, mint: string): Promise<Readonly<{ program: PublicKey; decimals: number }> | null> {
  const info = await within(() => connection.getAccountInfo(new PublicKey(mint), "confirmed"));
  if (!info || info.data.length < 82) return null;
  if (info.owner.equals(TOKEN_PROGRAM_ID)) return { program: TOKEN_PROGRAM_ID, decimals: info.data[44]! };
  if (info.owner.equals(TOKEN_2022_PROGRAM_ID)) return { program: TOKEN_2022_PROGRAM_ID, decimals: info.data[44]! };
  return null;
}

/** What a token account holds, raw; 0 when it is not there. A read that fails throws. */
async function heldBy(connection: Connection, account: PublicKey): Promise<bigint> {
  const info = await within(() => connection.getAccountInfo(account, "confirmed"));
  if (!info || info.data.length === 0) return 0n;
  return tokenAccountOf(info.data)?.amount ?? 0n;
}

/** Ryntra's own addresses on this network, whatever else the caller knows: the registry's, the fee wallet, the referral owner. */
function ryntraAddresses(network: LaunchNetwork): Set<string> {
  const own = new Set<string>();
  for (const row of ATTRIBUTION_REGISTRY) if (row.network === "solana" && row.address) own.add(row.address);
  if (network.feeWallet) own.add(network.feeWallet);
  if (network.referralOwner) own.add(network.referralOwner);
  return own;
}

/* ------------------------------------------------------------ chain: the escrow */

/** The commitment: the creator's budget into Met Lock's escrow from the creator to the creator, all of it unlocking at `cliffSeconds`. */
export async function buildBoostEscrowTransaction(args: Readonly<{
  connection: Connection;
  mint: string;
  program: PublicKey;
  creator: string;
  amountRaw: bigint;
  startSeconds: number;
  cliffSeconds: number;
  recentBlockhash: string;
}>): Promise<Readonly<{ wireBase64: string; escrow: string; baseKey: Keypair }>> {
  if (args.amountRaw <= 0n) throw new Error("A campaign needs a budget to lock.");
  const lock = new LockClient(args.connection, "confirmed");
  const mint = new PublicKey(args.mint);
  const creator = new PublicKey(args.creator);
  const base = Keypair.generate();
  const escrow = deriveEscrow(base.publicKey);
  const senderToken = getAssociatedTokenAddressSync(mint, creator, false, args.program, ASSOCIATED_TOKEN_PROGRAM_ID);
  const escrowToken = getAssociatedTokenAddressSync(mint, escrow, true, args.program, ASSOCIATED_TOKEN_PROGRAM_ID);
  const instruction = await lock.program.methods
    .createVestingEscrowV2(
      {
        vestingStartTime: new BN(Math.min(args.startSeconds, args.cliffSeconds)),
        cliffTime: new BN(args.cliffSeconds),
        frequency: new BN(1),
        /* Everything at the cliff, nothing before: no periods. */
        cliffUnlockAmount: new BN(args.amountRaw.toString()),
        amountPerPeriod: new BN(0),
        numberOfPeriod: new BN(0),
        updateRecipientMode: MET_LOCK_NOBODY,
        cancelMode: MET_LOCK_NOBODY,
      },
      null,
    )
    .accountsPartial({ base: base.publicKey, senderToken, recipient: creator, tokenMint: mint, sender: creator, tokenProgram: args.program })
    .instruction();
  const tx = new Transaction().add(createAssociatedTokenAccountIdempotentInstruction(creator, escrowToken, escrow, mint, args.program), instruction);
  tx.feePayer = creator;
  tx.recentBlockhash = args.recentBlockhash;
  tx.partialSign(base);
  return { wireBase64: Buffer.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false })).toString("base64"), escrow: escrow.toBase58(), baseKey: base };
}

/** The escrow as Met Lock stores it, with what its token account holds; null when there is none. A read that fails throws. */
export async function observeBoostEscrow(connection: Connection, escrow: string): Promise<BoostEscrowObservation | null> {
  const info = await within(() => connection.getAccountInfo(new PublicKey(escrow), "confirmed"));
  if (!info || !info.owner.equals(LOCK_PROGRAM_ID)) return null;
  const state = await within(() => new LockClient(connection, "confirmed").getEscrow(new PublicKey(escrow)));
  const program = state.tokenProgramFlag === 1 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
  const held = await heldBy(connection, getAssociatedTokenAddressSync(state.tokenMint, new PublicKey(escrow), true, program, ASSOCIATED_TOKEN_PROGRAM_ID));
  const total = BigInt(state.cliffUnlockAmount.toString()) + BigInt(state.amountPerPeriod.toString()) * BigInt(state.numberOfPeriod.toString());
  return {
    escrow,
    mint: state.tokenMint.toBase58(),
    creator: state.creator.toBase58(),
    recipient: state.recipient.toBase58(),
    totalRaw: total.toString(),
    claimedRaw: state.totalClaimedAmount.toString(),
    heldRaw: held.toString(),
    cliffAt: Number(state.cliffTime.toString()),
    cancelMode: state.cancelMode,
    updateRecipientMode: state.updateRecipientMode,
  };
}

/* ------------------------------------------------------------ chain: the payout */

export type PayoutPlanRow = Pick<BoostPayoutRow, "wallet" | "bonusRaw">;

/**
 * The payout's transactions for the creator to sign: the escrow claimed back to the creator first when it still holds
 * the budget, then a transfer to each wallet's own token account (opened where it is not there, the creator paying), as
 * many to a transaction as fit its 1 232 bytes.
 */
export async function buildBoostPayoutTransactions(args: Readonly<{
  connection: Connection;
  creator: string;
  currency: Readonly<{ mint: string; program: PublicKey; decimals: number }>;
  escrow: string | null;
  rows: readonly PayoutPlanRow[];
  recentBlockhash: string;
  maxTxs?: number;
}>): Promise<Readonly<{ txs: readonly Transaction[]; parts: readonly Readonly<{ wallets: readonly string[]; amountRaw: string }>[] }>> {
  const creator = new PublicKey(args.creator);
  const mint = new PublicKey(args.currency.mint);
  const program = args.currency.program;
  const source = getAssociatedTokenAddressSync(mint, creator, false, program, ASSOCIATED_TOKEN_PROGRAM_ID);
  const claim: TransactionInstruction[] = [];
  if (args.escrow) {
    const escrow = new PublicKey(args.escrow);
    const lock = new LockClient(args.connection, "confirmed");
    claim.push(
      createAssociatedTokenAccountIdempotentInstruction(creator, source, creator, mint, program),
      await lock.program.methods
        .claimV2(new BN("18446744073709551615"), null)
        .accountsPartial({
          escrow,
          tokenMint: mint,
          escrowToken: getAssociatedTokenAddressSync(mint, escrow, true, program, ASSOCIATED_TOKEN_PROGRAM_ID),
          recipient: creator,
          recipientToken: source,
          memoProgram: new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"),
          tokenProgram: program,
        })
        .instruction(),
    );
  }
  const transfer = (row: PayoutPlanRow) => {
    const wallet = new PublicKey(row.wallet);
    const destination = getAssociatedTokenAddressSync(mint, wallet, true, program, ASSOCIATED_TOKEN_PROGRAM_ID);
    return [
      createAssociatedTokenAccountIdempotentInstruction(creator, destination, wallet, mint, program),
      createTransferCheckedInstruction(source, mint, destination, creator, BigInt(row.bonusRaw), args.currency.decimals, [], program),
    ];
  };
  /* The compute a transaction asks for: the claim's, and each wallet's account and transfer; Token-2022 costs more. */
  const units = (wallets: number, claims: boolean) => Math.min(1_400_000, 20_000 + (claims ? 80_000 : 0) + wallets * (program.equals(TOKEN_2022_PROGRAM_ID) ? 45_000 : 32_000));
  const assemble = (head: readonly TransactionInstruction[], rows: readonly PayoutPlanRow[]) => {
    const tx = new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: units(rows.length, head.length > 0) }), ...head, ...rows.flatMap(transfer));
    tx.feePayer = creator;
    tx.recentBlockhash = args.recentBlockhash;
    return tx;
  };
  const size = (tx: Transaction) => {
    try {
      return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).length;
    } catch {
      return Number.POSITIVE_INFINITY;
    }
  };
  const txs: Transaction[] = [];
  const parts: { wallets: string[]; amountRaw: string }[] = [];
  let head = claim;
  let batch: PayoutPlanRow[] = [];
  const close = () => {
    if (!batch.length && !head.length) return;
    txs.push(assemble(head, batch));
    parts.push({ wallets: batch.map((row) => row.wallet), amountRaw: batch.reduce((sum, row) => sum + BigInt(row.bonusRaw), 0n).toString() });
    head = [];
    batch = [];
  };
  const maxTxs = args.maxTxs ?? PAYOUT_TXS_PER_BUILD;
  for (const row of args.rows) {
    if (txs.length >= maxTxs) break;
    const next = [...batch, row];
    if (next.length <= PAYOUT_WALLETS_PER_TX && size(assemble(head, next)) <= TX_MAX_BYTES) {
      batch = next;
      continue;
    }
    close();
    if (txs.length >= maxTxs) break;
    batch = [row];
    if (size(assemble(head, batch)) > TX_MAX_BYTES) throw new Error("One wallet's transfer does not fit a transaction.");
  }
  if (txs.length < maxTxs) close();
  return { txs, parts };
}

const ALLOWED_PAYOUT_PROGRAMS = new Set([ComputeBudgetProgram.programId.toBase58(), ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(), TOKEN_PROGRAM_ID.toBase58(), TOKEN_2022_PROGRAM_ID.toBase58(), LOCK_PROGRAM_ID.toBase58()]);
const TRANSFER_CHECKED = 12;

/**
 * What would make a payout's bytes other than its plan: a program beyond the token programs, Met Lock and the compute
 * budget; a transfer from anyone but the creator, to an account that is not a planned wallet's own, or of another
 * amount; a planned wallet paid twice or not at all; a wallet of Ryntra's paid anything; an account opened for anyone
 * but a planned wallet or the creator; a payer other than the creator. Empty when the bytes pay exactly the plan.
 */
export function payoutProblems(
  txs: readonly Transaction[],
  plan: Readonly<{ creator: string; mint: string; program: string; rows: readonly PayoutPlanRow[]; ryntra: ReadonlySet<string> }>,
): readonly string[] {
  const problems: string[] = [];
  const mint = new PublicKey(plan.mint);
  const program = new PublicKey(plan.program);
  const creator = new PublicKey(plan.creator);
  const source = getAssociatedTokenAddressSync(mint, creator, false, program, ASSOCIATED_TOKEN_PROGRAM_ID).toBase58();
  const planned = new Map(plan.rows.map((row) => [getAssociatedTokenAddressSync(mint, new PublicKey(row.wallet), true, program, ASSOCIATED_TOKEN_PROGRAM_ID).toBase58(), row]));
  const owners = new Set([plan.creator, ...plan.rows.map((row) => row.wallet)]);
  const paid = new Map<string, bigint>();
  for (const row of plan.rows) if (plan.ryntra.has(row.wallet)) problems.push(`A wallet of Ryntra's is in the plan: ${row.wallet}.`);
  for (const tx of txs) {
    if (!tx.feePayer?.equals(creator)) problems.push("A transaction is paid for by someone other than the creator.");
    for (const instruction of tx.instructions) {
      const id = instruction.programId.toBase58();
      if (!ALLOWED_PAYOUT_PROGRAMS.has(id)) {
        problems.push(`An instruction of another program: ${id}.`);
        continue;
      }
      if (instruction.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)) {
        const owner = instruction.keys[2]?.pubkey.toBase58() ?? "";
        if (!owners.has(owner)) problems.push(`An account opened for a wallet outside the plan: ${owner}.`);
        if (plan.ryntra.has(owner)) problems.push(`An account opened for a wallet of Ryntra's: ${owner}.`);
        continue;
      }
      if (instruction.programId.equals(TOKEN_PROGRAM_ID) || instruction.programId.equals(TOKEN_2022_PROGRAM_ID)) {
        const data = Buffer.from(instruction.data);
        if (data[0] !== TRANSFER_CHECKED || data.length < 10) {
          problems.push("A token instruction that is not a transfer.");
          continue;
        }
        const [from, mintKey, to, authority] = instruction.keys.map((key) => key.pubkey.toBase58());
        if (from !== source || authority !== plan.creator) problems.push("A transfer from an account that is not the creator's.");
        if (mintKey !== plan.mint) problems.push("A transfer of another token.");
        const row = to ? planned.get(to) : undefined;
        if (!row) {
          problems.push(`A transfer to an account outside the plan: ${to}.`);
          continue;
        }
        const amount = data.readBigUInt64LE(1);
        if (amount !== BigInt(row.bonusRaw)) problems.push(`A transfer of another amount to ${row.wallet}.`);
        paid.set(row.wallet, (paid.get(row.wallet) ?? 0n) + 1n);
      }
    }
  }
  for (const row of plan.rows) {
    const times = paid.get(row.wallet) ?? 0n;
    if (times !== 1n) problems.push(`${row.wallet} is paid ${times} times.`);
  }
  return problems;
}

/* ------------------------------------------------------------ the commitment */

async function launchOf(deps: BoostDeps, token: string): Promise<LaunchRecord | BoostFailure> {
  const record = await readLaunchRecord(deps, deps.network.cluster, token).catch(() => null);
  if (!record || record.state === "PENDING") return fail("LAUNCH_NOT_FOUND", "No Ryntra launch of this token here.");
  return record;
}

async function sweep(deps: BoostDeps): Promise<void> {
  const stale = deps.now().getTime() - 60 * 60 * 1000;
  for (const build of await builds(deps.store).valuesWithPrefix(`${deps.network.cluster}:`)) if (Date.parse(build.expiresAt) < stale) await builds(deps.store).delete(buildKey(build.cluster, build.id));
}

export type PreparedBoost = Readonly<{ ok: true; build: LaunchBoostBuildResponse }>;

export async function prepareBoost(deps: BoostDeps, input: Readonly<{ token: string; creator: string; rules: LaunchBoostRules | BoostRules }>): Promise<PreparedBoost | BoostFailure> {
  const env = deps.env ?? {};
  const bounds = boostBounds(deps.network, env);
  if (!bounds) return fail("CAPABILITY_UNAVAILABLE", "Creator campaigns are not open on this network.");
  const record = await launchOf(deps, input.token);
  if ("ok" in record) return record;
  if (record.creator !== input.creator) return fail("WALLET_MISMATCH", "Only the token's creator opens its campaign.");
  const rules = rulesOf(input.rules);
  const now = deps.now();
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const problems = boostRuleProblems(rules, bounds, nowSeconds);
  if (problems.length) return fail("VALIDATION_ERROR", problems.map((problem) => problem.message).join(" "), problems.map((problem) => ({ path: `rules.${problem.code}`, message: problem.message })));
  const existing = await readBoostCampaign(deps.store, deps.network.cluster, input.token);
  if (existing && existing.commitment.state !== "FAILED") return fail("LAUNCH_BUILD_USED", "This token already has a campaign.");
  if (!ticketKeyConfigured(env)) return fail("LAUNCH_PAUSED", "Campaigns are paused; nothing was built.");
  const currencyMint = rules.currency === "PAIR" ? record.pairMint : record.token;
  let mint: Awaited<ReturnType<typeof mintFacts>>;
  try {
    mint = await mintFacts(deps.connection, currencyMint);
  } catch {
    return fail("UNAVAILABLE", "The network could not be read now; nothing was built. Try again.");
  }
  if (!mint) return fail("MINT_UNREADABLE", "The campaign's currency is not a token mint.");
  const budget = BigInt(rules.budgetRaw);
  try {
    const held = await heldBy(deps.connection, getAssociatedTokenAddressSync(new PublicKey(currencyMint), new PublicKey(input.creator), false, mint.program, ASSOCIATED_TOKEN_PROGRAM_ID));
    if (held < budget) return fail("LAUNCH_BALANCE_LOW", "The creator's wallet holds less than the budget.");
  } catch {
    return fail("UNAVAILABLE", "The network could not be read now; nothing was built. Try again.");
  }
  await sweep(deps).catch(() => undefined);
  let built: Awaited<ReturnType<typeof buildBoostEscrowTransaction>>;
  let validUntil: string;
  try {
    const latest = await within(() => deps.connection.getLatestBlockhash("confirmed"));
    validUntil = String(latest.lastValidBlockHeight);
    built = await buildBoostEscrowTransaction({
      connection: deps.connection,
      mint: currencyMint,
      program: mint.program,
      creator: input.creator,
      amountRaw: budget,
      startSeconds: nowSeconds,
      cliffSeconds: boostUnlocksAt(rules),
      recentBlockhash: latest.blockhash,
    });
  } catch (error) {
    return fail("UNAVAILABLE", error instanceof Error ? error.message.slice(0, 300) : "The campaign could not be built.");
  }
  const cosign = sealCosigners([{ index: 0, key: built.baseKey }], env);
  if (!cosign) return fail("LAUNCH_PAUSED", "Campaigns are paused; nothing was built.");
  const tx = Transaction.from(Buffer.from(built.wireBase64, "base64"));
  const windows = await readBuildWindows(web3ChainReader(deps.connection, READ_MS), validUntil, { transactions: 1, capMs: BOOST_BUILD_TTL_MS });
  const pair = launchPair(deps.network, record.preset, record.pairMint);
  const currency: BoostCurrencyFacts = { mint: currencyMint, program: mint.program.toBase58(), decimals: mint.decimals, symbol: rules.currency === "PAIR" ? pair.symbol : record.symbol.slice(0, 24) };
  const build: CommitBuild = {
    kind: "commit",
    id: randomBytes(16).toString("hex"),
    cluster: deps.network.cluster,
    token: record.token,
    creator: input.creator,
    wire: withoutSignaturesOf(built.wireBase64, [built.baseKey.publicKey.toBase58()]),
    messageSha256: sha256(tx.serializeMessage()),
    digest: reviewedDigest(tx),
    cosign,
    escrow: built.escrow,
    currency,
    rules,
    validUntil,
    createdAt: now.toISOString(),
    expiresAt: new Date(deps.now().getTime() + windows.lifeMs).toISOString(),
  };
  await builds(deps.store).insertIfAbsent(buildKey(build.cluster, build.id), build);
  return {
    ok: true,
    build: {
      buildId: build.id,
      network: deps.network.chain,
      unsignedWireBase64: build.wire,
      escrow: build.escrow,
      currency,
      budgetRaw: rules.budgetRaw,
      countsFrom: Math.max(rules.startsAt, nowSeconds),
      unlocksAt: boostUnlocksAt(rules),
      lines: linesOf(deps.network, record, rules),
      expiresAt: build.expiresAt,
      signableMs: windows.signableMs,
    },
  };
}

/**
 * The creator's signed commitment against the build: the built message byte for byte, or the same instructions paid by
 * the creator with only what a wallet may add; the creator's signature valid; then the escrow's base signs over the
 * exact message the creator signed, and every signature must hold.
 */
export function signedCommitment(wireBase64: string, build: Pick<CommitBuild, "messageSha256" | "digest" | "creator">, keys: readonly Keypair[]): Transaction | BoostFailure {
  let tx: Transaction;
  let exact: VersionedTransaction;
  try {
    tx = Transaction.from(Buffer.from(wireBase64, "base64"));
    exact = VersionedTransaction.deserialize(Buffer.from(wireBase64, "base64"));
  } catch {
    return fail("LAUNCH_SIGNED_OTHER_BYTES", "The wallet returned bytes that are not a transaction.");
  }
  if (exact.version !== "legacy") return fail("LAUNCH_SIGNED_OTHER_BYTES", "The wallet signed a different transaction than the one built.");
  const same = sha256(tx.serializeMessage()) === build.messageSha256;
  const added = !same && tx.feePayer?.toBase58() === build.creator && reviewedDigest(tx) === build.digest && walletAdditionsAllowed(tx);
  if (!same && !added) return fail("LAUNCH_SIGNED_OTHER_BYTES", "The wallet signed a different transaction than the one built.");
  const message = exact.message.serialize();
  const signers = exact.message.staticAccountKeys.slice(0, exact.message.header.numRequiredSignatures);
  const real = (at: number) => {
    const signature = exact.signatures[at];
    return Boolean(signature) && signature!.some((byte) => byte !== 0) && ed25519Valid(message, signature!, signers[at]!);
  };
  const creatorAt = signers.findIndex((signer) => signer.toBase58() === build.creator);
  if (creatorAt < 0 || !real(creatorAt)) return fail("LAUNCH_SIGNED_OTHER_BYTES", "The transaction is not signed by the creator.");
  try {
    if (keys.length) exact.sign([...keys]);
  } catch {
    return fail("LAUNCH_SIGNED_OTHER_BYTES", "The wallet signed a different transaction than the one built.");
  }
  if (signers.some((_, at) => !real(at))) return fail("LAUNCH_SIGNED_OTHER_BYTES", "A signature does not match the transaction.");
  return Transaction.from(exact.serialize());
}

export async function submitBoost(
  deps: BoostDeps,
  input: Readonly<{ token: string; buildId: string; creator: string; signedWireBase64: string }>,
): Promise<Readonly<{ ok: true; submit: LaunchBoostSubmitResponse }> | BoostFailure> {
  const deadline = deps.now().getTime() + ROUTE_MS;
  const build = await builds(deps.store).get(buildKey(deps.network.cluster, input.buildId));
  if (!build || build.kind !== "commit" || build.token !== input.token) return fail("LAUNCH_NOT_FOUND", "This campaign was not built here.");
  if (build.creator !== input.creator) return fail("WALLET_MISMATCH", "This campaign was built for another wallet.");
  if (Date.parse(build.expiresAt) < deps.now().getTime()) return fail("LAUNCH_BUILD_EXPIRED", "The campaign waited too long for the signature; build it again.");
  const keys = openCosigners(build.cosign, deps.env ?? {});
  if (!keys) return fail("LAUNCH_BUILD_EXPIRED", "The campaign can no longer be signed; build it again.");
  const tx = signedCommitment(input.signedWireBase64, build, keys.map((cosigner) => cosigner.key));
  if ("ok" in tx) return tx;
  if (!(await sends(deps.store).insertIfAbsent(buildKey(build.cluster, build.id), { cluster: build.cluster, id: build.id, at: deps.now().toISOString() }))) {
    return fail("LAUNCH_BUILD_USED", "This campaign was already sent.");
  }
  const signature = signatureOf(tx);
  const nowSeconds = Math.floor(deps.now().getTime() / 1000);
  /* Written before the send, in one compare-and-set: a token without a campaign, or one whose last commitment failed, is
     opened once — two commitments sent for one token at once, one of them is refused before it leaves. */
  const pending: CampaignChange = {
    cluster: build.cluster,
    token: build.token,
    creator: build.creator,
    currency: build.currency,
    rules: build.rules,
    countsFrom: Math.max(build.rules.startsAt, nowSeconds),
    unlocksAt: boostUnlocksAt(build.rules),
    escrow: build.escrow,
    commitment: { buildId: build.id, signature, state: "PENDING", reason: null, validUntil: build.validUntil },
    payouts: [],
    createdAt: deps.now().toISOString(),
  };
  const opened = await changeCampaign(deps.store, build.cluster, build.token, (current) => (current && current.commitment.state !== "FAILED" ? "taken" : pending)).catch(() => null);
  if (!opened?.ok) return fail("LAUNCH_BUILD_USED", "This token already has a campaign.");
  const sent = await sendOnce(deps.connection, tx, Number(build.validUntil), deps.now, { ...SEND_BUDGET, deadline }, {
    second: deps.second,
    landed: (minSlot, cap) => accountOnChain([deps.connection, deps.second], build.escrow, [LOCK_PROGRAM_ID.toBase58()], minSlot, cap),
  });
  if (sent.outcome === "CONFIRMED") {
    /* Landed is not yet locked as built: the escrow is read and must be the commitment, or the campaign waits for it. */
    const observe = deps.observe ?? ((escrow: string) => observeBoostEscrow(deps.connection, escrow));
    const observation = await observe(build.escrow).catch(() => undefined);
    const settled = observation === undefined || observation === null ? opened.row : await settleCommitment(deps, opened.row, observation).catch(() => opened.row);
    const { state, reason } = settled.commitment;
    return { ok: true, submit: { state, signature, escrow: build.escrow, reason } };
  }
  const state = sent.outcome === "UNKNOWN" ? "PENDING" : "FAILED";
  const reason = state === "FAILED" ? (sent.reason ?? "The network refused the campaign.").slice(0, 300) : null;
  if (state === "FAILED") {
    await changeCampaign(deps.store, build.cluster, build.token, (current) =>
      current && current.commitment.buildId === build.id && current.commitment.state === "PENDING" ? { ...current, commitment: { ...current.commitment, state, reason } } : "moved",
    ).catch(() => null);
  }
  return { ok: true, submit: { state, signature, escrow: build.escrow, reason } };
}

/**
 * What makes an escrow on the chain other than the campaign's commitment: another token, a recipient or sender other
 * than the creator, another amount or unlock, a mode that lets anyone cancel it or change its recipient. Empty when the
 * escrow holds the campaign's budget as built.
 */
export function escrowProblems(campaign: Pick<BoostCampaign, "creator" | "currency" | "rules" | "unlocksAt">, observation: BoostEscrowObservation): readonly string[] {
  const problems: string[] = [];
  if (observation.mint !== campaign.currency.mint) problems.push("the escrow holds another token");
  if (observation.recipient !== campaign.creator) problems.push("the escrow pays someone other than the creator");
  if (observation.creator !== campaign.creator) problems.push("the escrow was funded by someone other than the creator");
  /* Amounts compared as numbers, never as their spelling. */
  if (BigInt(observation.totalRaw) !== BigInt(campaign.rules.budgetRaw)) problems.push("the escrow holds another amount than the budget");
  if (observation.cliffAt !== campaign.unlocksAt) problems.push("the escrow unlocks at another time");
  if (observation.cancelMode !== MET_LOCK_NOBODY || observation.updateRecipientMode !== MET_LOCK_NOBODY) problems.push("someone may cancel the escrow or change its recipient");
  return problems;
}

/** A PENDING commitment as the chain settles it: the escrow found is LOCKED; a signature that failed or expired is FAILED. */
/**
 * A campaign as the token's page shows it: one still PENDING is settled now from its escrow's account — LOCKED once the
 * chain holds it, FAILED once its signature can no longer land — so the page never calls a budget locked that is not.
 */
export async function settledBoostCampaign(
  deps: Pick<BoostDeps, "store" | "connection" | "second"> & Partial<Pick<BoostDeps, "now">>,
  campaign: BoostCampaign,
): Promise<BoostCampaign> {
  if (campaign.commitment.state !== "PENDING") return campaign;
  /* An escrow not read is no answer: the campaign stays as it is, never settled FAILED on a failed read. */
  const observation = await observeBoostEscrow(deps.connection, campaign.escrow).catch(() => undefined);
  if (observation === undefined) return campaign;
  return settleCommitment({ ...deps, now: deps.now ?? (() => new Date()) } as BoostDeps, campaign, observation).catch(() => campaign);
}

/**
 * A PENDING commitment settled from its escrow: one that holds the budget as built is LOCKED, and purchases count from
 * this first sight at the earliest — before it the page said no rule; one that is not the commitment is FAILED; none
 * with a signature that failed or expired is FAILED. Written by compare-and-set on the same commitment only.
 */
async function settleCommitment(deps: BoostDeps, campaign: BoostCampaign, observation: BoostEscrowObservation | null): Promise<BoostCampaign> {
  if (campaign.commitment.state !== "PENDING") return campaign;
  let state: "LOCKED" | "FAILED" | null = null;
  let reason: string | null = null;
  if (observation) {
    const problems = escrowProblems(campaign, observation);
    state = problems.length ? "FAILED" : "LOCKED";
    reason = problems.length ? `the escrow is not the campaign's: ${problems.join("; ")}`.slice(0, 300) : null;
  } else {
    const outcome = await signatureOutcome(deps.connection, campaign.commitment.signature, Number(campaign.commitment.validUntil), deps.second ?? null).catch(() => "UNKNOWN" as const);
    if (outcome === "FAILED" || outcome === "EXPIRED") {
      state = "FAILED";
      reason = "the network did not take the campaign";
    }
  }
  if (!state) return campaign;
  const seenSeconds = Math.floor(deps.now().getTime() / 1000);
  const written = await changeCampaign(deps.store, campaign.cluster, campaign.token, (current) => {
    if (!current || current.commitment.buildId !== campaign.commitment.buildId || current.commitment.state !== "PENDING") return "moved";
    return { ...current, countsFrom: state === "LOCKED" ? Math.max(current.rules.startsAt, seenSeconds) : current.countsFrom, commitment: { ...current.commitment, state: state!, reason } };
  });
  if (written.ok) return written.row;
  return (await readBoostCampaign(deps.store, campaign.cluster, campaign.token)) ?? campaign;
}

/* ------------------------------------------------------------ the payout */

/** The campaign's payouts as the chain shows them now — from the token's own trades, read whole or not at all. */
export async function countBoost(deps: BoostDeps, campaign: BoostCampaign, record: LaunchRecord, budgetMs = 40_000): Promise<BoostPayouts> {
  const rules: BoostRules = { ...campaign.rules, startsAt: campaign.countsFrom };
  const notRead = boostPayouts(rules, [], { excluded: new Set(), historyComplete: false, now: 0 });
  const nowSeconds = Math.floor(deps.now().getTime() / 1000);
  const read = deps.trades ?? ((args) => chainTrades(deps, args));
  const history = await read({ record, from: campaign.countsFrom, to: Math.min(nowSeconds, campaign.unlocksAt), budgetMs }).catch(() => null);
  if (!history) return notRead;
  const own = deps.ownWallets ? await deps.ownWallets().catch(() => null) : null;
  if (!own || !own.complete) return notRead;
  const excluded = new Set<string>([record.creator, ...ryntraAddresses(deps.network), ...own.wallets]);
  for (const share of record.feeSharing?.shares ?? []) excluded.add(share.address);
  if (record.feeSharing?.vault) excluded.add(record.feeSharing.vault);
  if (campaign.escrow) excluded.add(campaign.escrow);
  let viaRyntra: Set<string> | null = null;
  if (rules.routes === "ryntra") {
    const sentBy = deps.sentByRyntra ?? (async (signature: string) => {
      const sent = await readLaunchTradeRecord(deps.store, deps.network.cluster, signature);
      return Boolean(sent && sent.side === "buy" && sent.state !== "FAILED");
    });
    viaRyntra = new Set();
    try {
      for (const trade of history.trades) if (trade.side === "buy" && trade.at >= rules.startsAt && trade.at < rules.endsAt && (await sentBy(trade.signature))) viaRyntra.add(trade.signature);
    } catch {
      return notRead;
    }
  }
  return boostPayouts(rules, history.trades, { excluded, historyComplete: history.complete, now: nowSeconds, viaRyntra });
}

async function chainTrades(deps: BoostDeps, args: Readonly<{ record: LaunchRecord; from: number; to: number; budgetMs: number }>) {
  const reader = launchMarketReader({ network: deps.network, connection: deps.connection, store: deps.store });
  const state = await reader.state({ token: args.record.token, pool: args.record.pool });
  return reader.windowTrades({ token: args.record.token, state, from: args.from, to: args.to + 1, budgetMs: args.budgetMs });
}

/** What sent payouts that landed or may still land pay, raw. */
const committedRaw = (payouts: readonly BoostPayoutTx[]) => payouts.filter((tx) => tx.state !== "FAILED").reduce((sum, tx) => sum + BigInt(tx.amountRaw), 0n);

/** Wallets a sent payout already covers — landed, or still able to land. */
const coveredBy = (payouts: readonly BoostPayoutTx[]) => new Set(payouts.filter((tx) => tx.state !== "FAILED").flatMap((tx) => tx.wallets));

export async function prepareBoostPayout(deps: BoostDeps, input: Readonly<{ token: string; creator: string }>): Promise<Readonly<{ ok: true; build: LaunchBoostPayoutBuildResponse }> | BoostFailure> {
  const found = await readBoostCampaign(deps.store, deps.network.cluster, input.token);
  if (!found) return fail("LAUNCH_NOT_FOUND", "This token has no campaign.");
  if (found.creator !== input.creator) return fail("WALLET_MISMATCH", "Only the campaign's creator signs its payout.");
  const record = await launchOf(deps, input.token);
  if ("ok" in record) return record;
  const observe = deps.observe ?? ((escrow: string) => observeBoostEscrow(deps.connection, escrow));
  let observation: BoostEscrowObservation | null;
  try {
    observation = await observe(found.escrow);
  } catch {
    return fail("UNAVAILABLE", "The campaign's escrow could not be read now; nothing was built.");
  }
  /* A payout sent earlier that the chain never took frees its wallets for this one; one that may still land does not. */
  const campaign = await settlePayouts(deps, await settleCommitment(deps, found, observation));
  if (campaign.commitment.state !== "LOCKED") return fail("LAUNCH_NOTHING_TO_CLAIM", "The campaign's budget is not locked; there is nothing to pay out.");
  if (Math.floor(deps.now().getTime() / 1000) < campaign.unlocksAt) return fail("LAUNCH_NOTHING_TO_CLAIM", "The campaign and its hold are not over yet.");
  /* A payout that may still land is waited out: the next one is built once it landed or its time ran out. */
  if (campaign.payouts.some((tx) => tx.state === "PENDING")) return fail("LAUNCH_BUILD_USED", "A payout is on its way; build the next one once it lands or its time runs out.");
  const counted = await countBoost(deps, campaign, record);
  if (counted.state === "NOT_READ") return fail("UNAVAILABLE", "The token's history could not be read whole; nothing is paid on a part of it.");
  if (counted.state !== "READY") return fail("LAUNCH_NOTHING_TO_CLAIM", "The campaign and its hold are not over yet.");
  const covered = coveredBy(campaign.payouts);
  /* Never past the budget across builds: what landed or may land is counted first, and the rows fit what is left. */
  let budgetLeft = BigInt(campaign.rules.budgetRaw) - committedRaw(campaign.payouts);
  const rows = counted.rows.filter((row) => {
    if (covered.has(row.wallet) || BigInt(row.bonusRaw) > budgetLeft) return false;
    budgetLeft -= BigInt(row.bonusRaw);
    return true;
  });
  const claims = observation !== null && BigInt(observation.heldRaw) > 0n;
  if (!rows.length && !claims) return fail("LAUNCH_NOTHING_TO_CLAIM", "Every wallet the campaign pays is paid.");
  const ryntra = new Set([...ryntraAddresses(deps.network), ...((await deps.ownWallets?.().catch(() => null))?.wallets ?? [])]);
  let built: Awaited<ReturnType<typeof buildBoostPayoutTransactions>>;
  let validUntil: string;
  try {
    const latest = await within(() => deps.connection.getLatestBlockhash("confirmed"));
    validUntil = String(latest.lastValidBlockHeight);
    built = await buildBoostPayoutTransactions({
      connection: deps.connection,
      creator: campaign.creator,
      currency: { mint: campaign.currency.mint, program: new PublicKey(campaign.currency.program), decimals: campaign.currency.decimals },
      escrow: claims ? campaign.escrow : null,
      rows,
      recentBlockhash: latest.blockhash,
    });
  } catch (error) {
    return fail("UNAVAILABLE", error instanceof Error ? error.message.slice(0, 300) : "The payout could not be built.");
  }
  const included = new Set(built.parts.flatMap((part) => part.wallets));
  const planned = rows.filter((row) => included.has(row.wallet));
  /* The bytes pay the plan and nothing else — no wallet of Ryntra's, no account but a planned wallet's — or nothing leaves. */
  const problems = payoutProblems(built.txs, { creator: campaign.creator, mint: campaign.currency.mint, program: campaign.currency.program, rows: planned, ryntra });
  if (problems.length) return fail("UNAVAILABLE", `The payout was not built as planned: ${problems[0]}`);
  const windows = await readBuildWindows(web3ChainReader(deps.connection, READ_MS), validUntil, { transactions: built.txs.length, capMs: BOOST_BUILD_TTL_MS });
  const now = deps.now();
  const build: PayoutBuild = {
    kind: "payout",
    id: randomBytes(16).toString("hex"),
    cluster: deps.network.cluster,
    token: campaign.token,
    creator: campaign.creator,
    wires: built.txs.map((tx) => Buffer.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false })).toString("base64")),
    parts: built.parts,
    remaining: rows.length - planned.length,
    validUntil,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + Math.max(0, windows.lifeMs - NEXT_TRANSACTION_MARGIN_MS * (built.txs.length - 1))).toISOString(),
  };
  await sweep(deps).catch(() => undefined);
  await builds(deps.store).insertIfAbsent(buildKey(build.cluster, build.id), build);
  const total = planned.reduce((sum, row) => sum + BigInt(row.bonusRaw), 0n);
  return {
    ok: true,
    build: {
      buildId: build.id,
      network: deps.network.chain,
      unsignedWireBase64: [...build.wires],
      rows: planned.map((row) => ({ wallet: row.wallet, bonusRaw: row.bonusRaw, firstBuyAt: row.firstBuyAt, signature: row.signature })),
      remaining: rows.length - planned.length,
      totalRaw: total.toString(),
      leftoverRaw: counted.leftoverRaw,
      claimsEscrow: claims,
      currency: campaign.currency,
      expiresAt: build.expiresAt,
      signableMs: windows.signableMs,
    },
  };
}

export async function submitBoostPayout(
  deps: BoostDeps,
  input: Readonly<{ token: string; buildId: string; creator: string; signedWireBase64: readonly string[] }>,
): Promise<Readonly<{ ok: true; submit: LaunchBoostPayoutSubmitResponse }> | BoostFailure> {
  const deadline = deps.now().getTime() + ROUTE_MS;
  const build = await builds(deps.store).get(buildKey(deps.network.cluster, input.buildId));
  if (!build || build.kind !== "payout" || build.token !== input.token) return fail("LAUNCH_NOT_FOUND", "This payout was not built here.");
  if (build.creator !== input.creator) return fail("WALLET_MISMATCH", "This payout was built for another wallet.");
  if (Date.parse(build.expiresAt) < deps.now().getTime()) return fail("LAUNCH_BUILD_EXPIRED", "The payout waited too long for the signature; build it again.");
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
  /*
   * Every part reserved PENDING before the first send, in one compare-and-set with the check that no wallet of the
   * build is covered by a payout that landed or may still land. Two builds of the same wallets — a double click, a
   * retry, a second tab — and the creator signing both: the second is refused here and nothing of it leaves.
   */
  const reserved: BoostPayoutTx[] = build.parts.map((part, index) => ({
    signature: signatureOf(txs[index]!),
    wallets: part.wallets,
    amountRaw: part.amountRaw,
    state: "PENDING",
    reason: null,
    validUntil: build.validUntil,
  }));
  const wallets = build.parts.flatMap((part) => part.wallets);
  const reservation = await changeCampaign(deps.store, build.cluster, build.token, (current) => {
    if (!current || current.commitment.state !== "LOCKED") return "The campaign's budget is not locked; there is nothing to pay out.";
    const covered = coveredBy(current.payouts);
    if (wallets.some((wallet) => covered.has(wallet))) return "A wallet of this payout is already paid or on its way; nothing was sent.";
    if (committedRaw(current.payouts) + committedRaw(reserved) > BigInt(current.rules.budgetRaw)) return "This payout would pay more than the campaign's budget; nothing was sent.";
    if (current.payouts.some((tx) => reserved.some((own) => own.signature === tx.signature))) return "This payout was already sent.";
    return { ...current, payouts: [...current.payouts, ...reserved] };
  }).catch(() => null);
  if (!reservation) return fail("UNAVAILABLE", "The campaign could not be written now; nothing was sent. Build the payout again.");
  if (!reservation.ok) return fail("LAUNCH_BUILD_USED", reservation.reason);
  /*
   * A part's state as the send answers it, written on the part's own signature: a concurrent write is never lost. Only
   * what can no longer land frees its wallets — landed, or landed with an error. A part not sent, or refused before the
   * network, stays PENDING until its blockhash expires: its signed bytes are with the creator's wallet too.
   */
  const record = (tx: BoostPayoutTx) =>
    changeCampaign(deps.store, build.cluster, build.token, (current) =>
      current ? { ...current, payouts: current.payouts.map((own) => (own.signature === tx.signature && own.state === "PENDING" ? tx : own)) } : "gone",
    ).catch(() => null);
  const sent: BoostPayoutTx[] = [];
  for (let index = 0; index < txs.length; index += 1) {
    const base = reserved[index]!;
    /* After one that did not land, the rest are not sent: the first claims the escrow the others pay from. */
    if (sent.some((tx) => tx.state === "FAILED") || deadline - deps.now().getTime() < PART_MIN_MS) {
      const reason = "not sent: an earlier part did not land, or the route's time ran out";
      sent.push({ ...base, state: "FAILED", reason });
      await record({ ...base, reason });
      continue;
    }
    const outcome = await sendOnce(deps.connection, txs[index]!, Number(build.validUntil), deps.now, { ...SEND_BUDGET, deadline }, { second: deps.second });
    const answered: BoostPayoutTx = {
      ...base,
      state: outcome.outcome === "CONFIRMED" ? "CONFIRMED" : outcome.outcome === "UNKNOWN" ? "PENDING" : "FAILED",
      reason: outcome.outcome === "REJECTED" || outcome.outcome === "FAILED" ? (outcome.reason ?? "the network refused it").slice(0, 300) : null,
    };
    sent.push(answered);
    if (outcome.outcome === "CONFIRMED" || outcome.outcome === "FAILED") await record(answered);
    else if (outcome.outcome === "REJECTED") await record({ ...base, reason: answered.reason });
  }
  const paid = sent.filter((tx) => tx.state === "CONFIRMED").reduce((sum, tx) => sum + BigInt(tx.amountRaw), 0n);
  /* PAID only when every transaction landed and the build left no eligible wallet for a next one. */
  const state = sent.some((tx) => tx.state === "FAILED") ? "PARTIAL" : sent.some((tx) => tx.state === "PENDING") ? "PENDING" : build.remaining > 0 ? "PARTIAL" : "PAID";
  return {
    ok: true,
    submit: { state, txs: sent.map((tx) => ({ signature: tx.signature, state: tx.state, wallets: tx.wallets.length, amountRaw: tx.amountRaw, reason: tx.reason })), paidRaw: paid.toString() },
  };
}

/** Sent payouts as the chain settles them: a PENDING one whose signature failed or expired is FAILED, a confirmed one CONFIRMED. */
async function settlePayouts(deps: BoostDeps, campaign: BoostCampaign): Promise<BoostCampaign> {
  if (!campaign.payouts.some((tx) => tx.state === "PENDING")) return campaign;
  const settled = new Map<string, BoostPayoutTx>();
  for (const tx of campaign.payouts) {
    if (tx.state !== "PENDING") continue;
    const outcome = await signatureOutcome(deps.connection, tx.signature, Number(tx.validUntil), deps.second ?? null).catch(() => "UNKNOWN" as const);
    if (outcome === "CONFIRMED") settled.set(tx.signature, { ...tx, state: "CONFIRMED", reason: null });
    else if (outcome === "FAILED" || outcome === "EXPIRED") settled.set(tx.signature, { ...tx, state: "FAILED", reason: tx.reason ?? "the network did not take it" });
  }
  if (!settled.size) return campaign;
  /* Written on each settled signature of the stored row, still PENDING there: a reservation made meanwhile stays. */
  const written = await changeCampaign(deps.store, campaign.cluster, campaign.token, (current) =>
    current ? { ...current, payouts: current.payouts.map((tx) => (tx.state === "PENDING" ? (settled.get(tx.signature) ?? tx) : tx)) } : "gone",
  );
  return written.ok ? written.row : campaign;
}

/* ------------------------------------------------------------ the page */

/**
 * The campaign as the token page shows it: its rules and lines, what the escrow holds as the chain says, and the
 * payout — counted from the chain while the campaign runs and its hold lasts, as signed after. Null when the token has
 * no campaign here. A read that fails leaves its figures null and `read` NOT_READ.
 */
export async function boostView(deps: BoostDeps, token: string): Promise<LaunchBoostView | null> {
  const found = await readBoostCampaign(deps.store, deps.network.cluster, token);
  if (!found) return null;
  const record = await launchOf(deps, token);
  if ("ok" in record) return null;
  const observe = deps.observe ?? ((escrow: string) => observeBoostEscrow(deps.connection, escrow));
  let unread = false;
  const observation = await observe(found.escrow).catch(() => {
    unread = true;
    return null;
  });
  let campaign = unread ? found : await settleCommitment(deps, found, observation).catch(() => found);
  campaign = await settlePayouts(deps, campaign).catch(() => campaign);
  const confirmed = campaign.payouts.filter((tx) => tx.state === "CONFIRMED");
  const pending = campaign.payouts.filter((tx) => tx.state === "PENDING");
  const paidRaw = confirmed.reduce((sum, tx) => sum + BigInt(tx.amountRaw), 0n);
  let payout: LaunchBoostView["payout"];
  const counted = campaign.commitment.state === "LOCKED" ? await countBoost(deps, campaign, record, VIEW_HISTORY_MS).catch(() => null) : null;
  if (campaign.commitment.state === "LOCKED" && (!counted || counted.state === "NOT_READ")) unread = true;
  const signatures = campaign.payouts.filter((tx) => tx.state !== "FAILED").map((tx) => tx.signature);
  if (campaign.payouts.length && counted && counted.state === "READY") {
    const covered = coveredBy(campaign.payouts);
    const left = counted.rows.filter((row) => !covered.has(row.wallet)).length;
    payout = {
      state: left === 0 && !pending.length ? "PAID" : left === 0 ? "PENDING" : "PARTIAL",
      recipients: counted.rows.length,
      plannedRaw: counted.totalRaw,
      paidRaw: paidRaw.toString(),
      leftoverRaw: counted.leftoverRaw,
      signatures,
    };
  } else {
    payout = {
      state: campaign.payouts.length ? (pending.length ? "PENDING" : "PARTIAL") : (counted?.state ?? "NOT_READ"),
      recipients: counted && counted.state !== "NOT_READ" ? counted.rows.length : null,
      plannedRaw: counted && counted.state !== "NOT_READ" ? counted.totalRaw : null,
      paidRaw: paidRaw.toString(),
      leftoverRaw: counted && counted.state !== "NOT_READ" ? counted.leftoverRaw : null,
      signatures,
    };
  }
  return {
    network: deps.network.chain,
    token,
    state: campaign.commitment.state,
    read: unread ? "NOT_READ" : "OK",
    rules: campaign.rules,
    /* The rules are said once the budget is seen locked — never «locked» before the chain shows it. */
    lines: campaign.commitment.state === "LOCKED" ? linesOf(deps.network, record, { ...campaign.rules, startsAt: campaign.countsFrom }) : { uk: [], en: [] },
    escrow: campaign.escrow,
    currency: campaign.currency,
    countsFrom: campaign.countsFrom,
    unlocksAt: campaign.unlocksAt,
    funded: observation ? { totalRaw: observation.totalRaw, heldRaw: observation.heldRaw, claimedRaw: observation.claimedRaw } : null,
    payout,
    observedAt: deps.now().toISOString(),
  };
}
