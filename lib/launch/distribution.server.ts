/**
 * The server's half of a distribution campaign: the chain read, the three
 * transactions built, and every byte checked before it leaves.
 *
 * 1. **Commit** (`prepareDistribution` → `submitDistribution`). The owner's
 *    draft becomes a list: the snapshot's candidates judged by the protection
 *    rules of the Ryntra Network, the pot divided, every allocation a row of Met
 *    Lock's tree. One transaction the owner signs writes the root
 *    (`create_root_escrow`, with the whole it may ever pay and how many escrows
 *    it may ever make) and funds it with exactly what the list adds up to
 *    (`fund_root_escrow`). The root escrow's base is a fresh key sealed with the
 *    build until the owner has signed, as a launch's lock is.
 * 2. **Claim** (`prepareDistributionClaim` → `submitDistributionClaim`). The
 *    recipient's own transaction, paid and signed by the recipient and nobody
 *    else: their row and its proof make their escrow
 *    (`create_vesting_escrow_from_root`) and `claim_v2` pays what has vested. A
 *    second one cannot exist — the escrow's address is derived from the root
 *    escrow and the recipient and is created, not written to — so a repeated
 *    claim is refused by the chain, not by this file.
 * 3. **Recover** (`prepareDistributionRecover` → `submitDistributionRecover`).
 *    Where the campaign published that its owner may cancel a row, the owner's
 *    transaction returns what has not vested and leaves the recipient everything
 *    that has.
 *
 * Ryntra signs nothing of anybody's, holds no key of a campaign and takes 0. The
 * owner signs once, at the start; after that the campaign runs without them.
 *
 * What this file refuses to do is as important as what it does: it never builds
 * a claim against an escrow that does not hold the list's promise, never funds a
 * root escrow above the list (Met Lock has no instruction that takes money back
 * out of one), and never counts a campaign whose protection facts could not be
 * read — an unread check is not a pass.
 *
 * Server-only. The collections it writes (`launchDistributions`,
 * `launchDistributionBuilds`, `launchDistributionSends`) join the store's list
 * with the integration.
 */

import { createHash, randomBytes } from "node:crypto";

import { LOCK_PROGRAM_ID, LockClient, deriveBase, deriveEscrow, deriveRootEscrow } from "@meteora-ag/met-lock-sdk";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { getBase58Decoder } from "@solana/kit";
import { ComputeBudgetProgram, Keypair, PublicKey, Transaction, type Connection } from "@solana/web3.js";
import BN from "bn.js";

import type {
  ApiErrorCode,
  LaunchDistributionBuildResponse,
  LaunchDistributionClaimBuildResponse,
  LaunchDistributionClaimPanel,
  LaunchDistributionClaimSubmitResponse,
  LaunchDistributionClaimView,
  LaunchDistributionRecoverBuildResponse,
  LaunchDistributionRecoverSubmitResponse,
  LaunchDistributionReview,
  LaunchDistributionSubmitResponse,
  LaunchDistributionView,
} from "../api/v1/contract.ts";
import { ATTRIBUTION_REGISTRY } from "../attribution/registry.ts";
import {
  eligibilityRows,
  snapshotDigest,
  type Candidate,
  type EligibilityReason,
  type EligibilityRow,
  type SnapshotRow,
  type SnapshotSpec,
} from "../core/launch/distribution-audience.ts";
import {
  claimableRaw,
  nodeTotalRaw,
  rootPlan,
  unlockedRaw,
  vestingProof,
  type VestingNode,
} from "../core/launch/distribution-merkle.ts";
import {
  claimPanel,
  distributionPlan,
  distributionReconcile,
  distributionReportLines,
  distributionReview,
  launchToRewardsGate,
  leftoverPlan,
  protocolFor,
  type ClaimPanel,
  type DistributionDraft,
  type DistributionReview,
  type DistributionStage,
  type LeftoverRow,
  type Reconciliation,
} from "../core/launch/distribution.ts";
import { needsReview, trustScore } from "../growth/protect.ts";
import { withBoundedCasRetry, type GuardStore } from "../guard/store.ts";
import type { Env } from "../liquidity/studio/gate.ts";
import { openCosigners, reviewedDigest, sealCosigners, ticketKeyConfigured, withoutSignaturesOf } from "../liquidity/studio/ticket.ts";
import { readBuildWindows, web3ChainReader } from "../solana/blockhash-life.ts";
import { tokenAccountOf } from "../core/venues/meteora-dbc/exit.ts";
import { accountOnChain, readLaunchRecord, sendOnce, type LaunchReadDeps, type LaunchRecord } from "./flow.server.ts";
import type { LaunchNetwork } from "./config.server.ts";
import { signedCommitment } from "./boost.server.ts";

/* ------------------------------------------------------------ records */

export const LAUNCH_DISTRIBUTIONS = "launchDistributions" as const;
export const LAUNCH_DISTRIBUTION_BUILDS = "launchDistributionBuilds" as const;
export const LAUNCH_DISTRIBUTION_SENDS = "launchDistributionSends" as const;

export type CampaignCurrency = Readonly<{ mint: string; program: string; decimals: number; symbol: string }>;

/** One claim the chain recorded, kept so a panel can show a receipt without reading every transaction again. */
export type CampaignClaim = Readonly<{ wallet: string; signature: string; amountRaw: string; at: string; state: "CONFIRMED" | "PENDING" | "FAILED" }>;

/**
 * A campaign, keyed `<cluster>:<id>`. Every write is a compare-and-set on `version`: the commitment opened once, each
 * claim recorded once, and no concurrent write lost.
 */
export type DistributionCampaign = Readonly<{
  version: number;
  cluster: LaunchNetwork["cluster"];
  id: string;
  token: string;
  owner: string;
  draft: DistributionDraft;
  currency: CampaignCurrency;
  /** The published list, in its own order — the order the root was built in. */
  nodes: readonly VestingNode[];
  root: string;
  maxClaimAmountRaw: string;
  maxEscrow: number;
  /** The snapshot's digest, so the list can be checked against a snapshot taken again; null for a campaign over a list. */
  snapshotDigest: string | null;
  /** The rows a person still has to look at: they are not in this root and keep nothing from it. */
  heldBack: readonly Readonly<{ wallet: string; reasons: readonly EligibilityReason[] }>[];
  rootEscrow: string;
  escrowVersion: number;
  commitment: Readonly<{ buildId: string; signature: string; state: "PENDING" | "FUNDED" | "FAILED"; reason: string | null; validUntil: string }>;
  claims: readonly CampaignClaim[];
  /** The owner's cancellations, each one a row returned. */
  recovered: readonly Readonly<{ wallet: string; signature: string; toOwnerRaw: string; at: string }>[];
  createdAt: string;
}>;

type CommitBuild = Readonly<{
  kind: "commit";
  id: string;
  cluster: LaunchNetwork["cluster"];
  campaign: string;
  token: string;
  owner: string;
  wire: string;
  messageSha256: string;
  digest: string;
  cosign: string;
  rootEscrow: string;
  escrowVersion: number;
  currency: CampaignCurrency;
  draft: DistributionDraft;
  nodes: readonly VestingNode[];
  root: string;
  maxClaimAmountRaw: string;
  maxEscrow: number;
  snapshotDigest: string | null;
  heldBack: readonly Readonly<{ wallet: string; reasons: readonly EligibilityReason[] }>[];
  validUntil: string;
  createdAt: string;
  expiresAt: string;
}>;

type ClaimBuild = Readonly<{
  kind: "claim";
  id: string;
  cluster: LaunchNetwork["cluster"];
  campaign: string;
  token: string;
  /** The recipient is the only signer and the only payer. */
  wallet: string;
  wire: string;
  messageSha256: string;
  digest: string;
  amountRaw: string;
  escrow: string;
  validUntil: string;
  createdAt: string;
  expiresAt: string;
}>;

type RecoverBuild = Readonly<{
  kind: "recover";
  id: string;
  cluster: LaunchNetwork["cluster"];
  campaign: string;
  token: string;
  owner: string;
  wallet: string;
  wire: string;
  messageSha256: string;
  digest: string;
  escrow: string;
  toOwnerRaw: string;
  toRecipientRaw: string;
  validUntil: string;
  createdAt: string;
  expiresAt: string;
}>;

type DistributionBuild = CommitBuild | ClaimBuild | RecoverBuild;

const campaignKey = (cluster: string, id: string) => `${cluster}:${id}`;
const campaigns = (store: GuardStore) => store.versioned<DistributionCampaign>(LAUNCH_DISTRIBUTIONS);
const builds = (store: GuardStore) => store.collection<DistributionBuild>(LAUNCH_DISTRIBUTION_BUILDS);
const sends = (store: GuardStore) => store.collection<Readonly<{ cluster: string; id: string; at: string }>>(LAUNCH_DISTRIBUTION_SENDS);
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const signatureOf = (tx: Transaction) => getBase58Decoder().decode(new Uint8Array(tx.signatures[0]?.signature ?? new Uint8Array(64)));

export async function readCampaign(store: GuardStore, cluster: string, id: string): Promise<DistributionCampaign | null> {
  return (await campaigns(store).get(campaignKey(cluster, id))) ?? null;
}

/** Every campaign of one token on this network, newest first. */
export async function readCampaignsOfToken(store: GuardStore, cluster: string, token: string): Promise<readonly DistributionCampaign[]> {
  const rows = await campaigns(store).valuesWithPrefix(`${cluster}:`);
  return rows.filter((row) => row.token === token).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

type CampaignChange = Omit<DistributionCampaign, "version">;

async function changeCampaign(
  store: GuardStore,
  cluster: string,
  id: string,
  decide: (current: DistributionCampaign | null) => CampaignChange | string,
): Promise<Readonly<{ ok: true; row: DistributionCampaign }> | Readonly<{ ok: false; reason: string }>> {
  const rows = campaigns(store);
  const key = campaignKey(cluster, id);
  return withBoundedCasRetry(async () => {
    const current = (await rows.get(key)) ?? null;
    if (current && !Number.isInteger(current.version)) return { ok: false as const, reason: "The campaign's record has no version; nothing was written." };
    const decided = decide(current);
    if (typeof decided === "string") return { ok: false as const, reason: decided };
    const row: DistributionCampaign = { ...decided, version: current ? current.version + 1 : 0 };
    return (await rows.compareAndSet(key, current ? current.version : null, row)) ? { ok: true as const, row } : false;
  });
}

/* ------------------------------------------------------------ deps and failures */

export type RootEscrowObservation = Readonly<{
  rootEscrow: string;
  mint: string;
  creator: string;
  root: string;
  maxClaimAmountRaw: string;
  maxEscrow: number;
  fundedRaw: string;
  escrowsMade: number;
  distributedRaw: string;
  /** What the root escrow's own token account holds now. */
  heldRaw: string;
}>;

export type RowEscrowObservation = Readonly<{ escrow: string; recipient: string; claimedRaw: string; cancelledAt: number }>;

/** What the protection rules know about a wallet — read through `lib/growth/protect.ts`'s own hashing, never restated here. */
export type ProtectionFacts = Readonly<{ fundingHashes: readonly string[]; deviceHashes: readonly string[]; signals: readonly Candidate["signals"][number][]; kyc: boolean | null }>;

export type DistributionDeps = Pick<LaunchReadDeps, "store" | "connection" | "second" | "adopt"> &
  Readonly<{
    network: LaunchNetwork;
    now: () => Date;
    env?: Env;
    /** Ryntra's own wallets, so a campaign's leftovers never come to us. */
    ownWallets?: () => Promise<Readonly<{ wallets: ReadonlySet<string>; complete: boolean }>>;
    /**
     * The snapshot's rows at a finalized slot, what each wallet bought on the market and, where the campaign asks for a
     * holding age, the slot each has held since. A read in part is no snapshot.
     */
    snapshot?: (
      spec: SnapshotSpec,
    ) => Promise<Readonly<{ rows: readonly SnapshotRow[]; bought: ReadonlyMap<string, bigint>; heldSince?: ReadonlyMap<string, number>; complete: boolean }>>;
    /** What protection knows about each wallet; absent, a campaign that asks for cluster rules cannot be counted. */
    protection?: (wallets: readonly string[]) => Promise<ReadonlyMap<string, ProtectionFacts>>;
    /** The token's exit to a DEX as the chain shows it, for a campaign that waits for one. */
    exit?: (token: string) => Promise<Readonly<{ read: boolean; migrated: boolean; pool: string | null; graduation: Readonly<{ signature: string; at: number }> | null }>>;
    observeRoot?: (rootEscrow: string) => Promise<RootEscrowObservation | null>;
    observeRow?: (escrow: string) => Promise<RowEscrowObservation | null>;
  }>;

export type DistributionFailure = Readonly<{ ok: false; code: ApiErrorCode; message: string; issues?: readonly Readonly<{ path: string; message: string }>[] }>;
const fail = (code: ApiErrorCode, message: string, issues?: DistributionFailure["issues"]): DistributionFailure => ({ ok: false, code, message, ...(issues ? { issues } : {}) });

const READ_MS = 8_000;
/** The longest a built transaction waits for its signature: the bytes live as long as their blockhash. */
export const DISTRIBUTION_BUILD_TTL_MS = 2 * 60 * 1000;
const SEND_BUDGET = { confirmMs: 20_000, settleMs: 8_000 } as const;
const ROUTE_MS = 50_000;
/** The most rows one campaign's list holds — a root escrow bounded by what one commit can state and one page can read. */
export const CAMPAIGN_MAX_ROWS = 2_000;

async function within<T>(read: () => Promise<T>, ms = READ_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([read(), new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error("The network did not answer in time.")), ms)))]);
  } finally {
    clearTimeout(timer);
  }
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

/** Ryntra's own addresses on this network: the registry's, the fee wallet, the referral owner. */
function ryntraAddresses(network: LaunchNetwork): Set<string> {
  const own = new Set<string>();
  for (const row of ATTRIBUTION_REGISTRY) if (row.network === "solana" && row.address) own.add(row.address);
  if (network.feeWallet) own.add(network.feeWallet);
  if (network.referralOwner) own.add(network.referralOwner);
  return own;
}

const hexOf = (bytes: readonly number[] | Uint8Array) => [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
const bytesOf = (hex: string) => [...(hex.match(/../g) ?? [])].map((pair) => parseInt(pair, 16));

/* ------------------------------------------------------------ chain: the reads */

/** A campaign's root escrow as Met Lock stores it, with what its token account holds; null when there is none. */
export async function observeRootEscrow(connection: Connection, rootEscrow: string): Promise<RootEscrowObservation | null> {
  const address = new PublicKey(rootEscrow);
  const info = await within(() => connection.getAccountInfo(address, "confirmed"));
  if (!info || !info.owner.equals(LOCK_PROGRAM_ID)) return null;
  const state = await within(() => new LockClient(connection, "confirmed").getRootEscrow(address));
  const program = state.tokenProgramFlag === 1 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
  const held = await heldBy(connection, getAssociatedTokenAddressSync(state.tokenMint, address, true, program, ASSOCIATED_TOKEN_PROGRAM_ID));
  return {
    rootEscrow,
    mint: state.tokenMint.toBase58(),
    creator: state.creator.toBase58(),
    root: hexOf(state.root),
    maxClaimAmountRaw: state.maxClaimAmount.toString(),
    maxEscrow: Number(state.maxEscrow.toString()),
    fundedRaw: state.totalFundedAmount.toString(),
    escrowsMade: Number(state.totalEscrowCreated.toString()),
    distributedRaw: state.totalDistributeAmount.toString(),
    heldRaw: held.toString(),
  };
}

/** One row's escrow as Met Lock stores it; null when the recipient has not made it yet. */
export async function observeRowEscrow(connection: Connection, escrow: string): Promise<RowEscrowObservation | null> {
  const address = new PublicKey(escrow);
  const info = await within(() => connection.getAccountInfo(address, "confirmed"));
  if (!info || !info.owner.equals(LOCK_PROGRAM_ID)) return null;
  const state = await within(() => new LockClient(connection, "confirmed").getEscrow(address));
  return { escrow, recipient: state.recipient.toBase58(), claimedRaw: state.totalClaimedAmount.toString(), cancelledAt: Number(state.cancelledAt.toString()) };
}

/** The addresses a row's claim uses: the base the program derives, and the escrow derived from it. */
export function rowAddresses(rootEscrow: string, recipient: string): Readonly<{ base: string; escrow: string }> {
  const base = deriveBase(new PublicKey(rootEscrow), new PublicKey(recipient));
  return { base: base.toBase58(), escrow: deriveEscrow(base).toBase58() };
}

/* ------------------------------------------------------------ chain: the three transactions */

/**
 * The commitment: one transaction the owner signs that writes the root and funds it with exactly the list's total.
 * Nothing above the list is ever funded — a root escrow has no instruction that gives money back.
 */
export async function buildCommitTransaction(args: Readonly<{
  connection: Connection;
  mint: string;
  program: PublicKey;
  owner: string;
  root: string;
  maxClaimAmountRaw: bigint;
  maxEscrow: number;
  escrowVersion: number;
  recentBlockhash: string;
}>): Promise<Readonly<{ wireBase64: string; rootEscrow: string; baseKey: Keypair }>> {
  if (args.maxClaimAmountRaw <= 0n) throw new Error("A campaign needs a list to fund.");
  if (args.maxEscrow <= 0) throw new Error("A campaign needs rows to pay.");
  const lock = new LockClient(args.connection, "confirmed");
  const mint = new PublicKey(args.mint);
  const owner = new PublicKey(args.owner);
  const base = Keypair.generate();
  const rootEscrow = deriveRootEscrow(base.publicKey, mint, args.escrowVersion);
  const ownerToken = getAssociatedTokenAddressSync(mint, owner, false, args.program, ASSOCIATED_TOKEN_PROGRAM_ID);

  const create = await lock.program.methods
    .createRootEscrow({
      maxClaimAmount: new BN(args.maxClaimAmountRaw.toString()),
      maxEscrow: new BN(args.maxEscrow),
      version: new BN(args.escrowVersion),
      root: bytesOf(args.root),
    })
    .accountsPartial({ base: base.publicKey, rootEscrow, tokenMint: mint, payer: owner, creator: owner })
    .instruction();
  const fund = await lock.program.methods
    .fundRootEscrow(new BN(args.maxClaimAmountRaw.toString()), null)
    .accountsPartial({ rootEscrow, tokenMint: mint, payer: owner, payerToken: ownerToken, tokenProgram: args.program })
    .instruction();

  const tx = new Transaction().add(create, fund);
  tx.feePayer = owner;
  tx.recentBlockhash = args.recentBlockhash;
  tx.partialSign(base);
  return { wireBase64: Buffer.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false })).toString("base64"), rootEscrow: rootEscrow.toBase58(), baseKey: base };
}

/**
 * A recipient's own claim: their row and its proof make their escrow, and `claim_v2` pays what has vested into their
 * own token account. The recipient is the only signer and the only payer — the campaign's owner is not in it at all.
 */
export async function buildClaimTransaction(args: Readonly<{
  connection: Connection;
  mint: string;
  program: PublicKey;
  rootEscrow: string;
  node: VestingNode;
  proof: readonly string[];
  maxAmountRaw: bigint;
  recentBlockhash: string;
}>): Promise<Readonly<{ wireBase64: string; escrow: string }>> {
  const lock = new LockClient(args.connection, "confirmed");
  const mint = new PublicKey(args.mint);
  const recipient = new PublicKey(args.node.recipient);
  const rootEscrow = new PublicKey(args.rootEscrow);
  const base = deriveBase(rootEscrow, recipient);
  const escrow = deriveEscrow(base);
  const escrowToken = getAssociatedTokenAddressSync(mint, escrow, true, args.program, ASSOCIATED_TOKEN_PROGRAM_ID);
  const rootEscrowToken = getAssociatedTokenAddressSync(mint, rootEscrow, true, args.program, ASSOCIATED_TOKEN_PROGRAM_ID);
  const recipientToken = getAssociatedTokenAddressSync(mint, recipient, false, args.program, ASSOCIATED_TOKEN_PROGRAM_ID);

  const make = await lock.program.methods
    .createVestingEscrowFromRoot(
      {
        vestingStartTime: new BN(args.node.vestingStartTime),
        cliffTime: new BN(args.node.cliffTime),
        frequency: new BN(args.node.frequency),
        cliffUnlockAmount: new BN(args.node.cliffUnlockRaw),
        amountPerPeriod: new BN(args.node.amountPerPeriodRaw),
        numberOfPeriod: new BN(args.node.numberOfPeriod),
        updateRecipientMode: args.node.updateRecipientMode,
        cancelMode: args.node.cancelMode,
      },
      args.proof.map((sibling) => bytesOf(sibling)),
      null,
    )
    .accountsPartial({ rootEscrow, base, escrow, escrowToken, rootEscrowToken, tokenMint: mint, payer: recipient, recipient, tokenProgram: args.program })
    .instruction();
  const claim = await lock.program.methods
    .claimV2(new BN(args.maxAmountRaw.toString()), null)
    .accountsPartial({ escrow, tokenMint: mint, escrowToken, recipient, recipientToken, tokenProgram: args.program })
    .instruction();

  const tx = new Transaction().add(createAssociatedTokenAccountIdempotentInstruction(recipient, recipientToken, recipient, mint, args.program), make, claim);
  tx.feePayer = recipient;
  tx.recentBlockhash = args.recentBlockhash;
  return { wireBase64: Buffer.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false })).toString("base64"), escrow: escrow.toBase58() };
}

/**
 * The owner's cancellation of one row, where the campaign published that they may: what has vested goes to the
 * recipient, the rest to the owner, and the rent of the escrow to the owner who asked for it back.
 */
export async function buildRecoverTransaction(args: Readonly<{
  connection: Connection;
  mint: string;
  program: PublicKey;
  owner: string;
  recipient: string;
  escrow: string;
  recentBlockhash: string;
}>): Promise<Readonly<{ wireBase64: string }>> {
  const lock = new LockClient(args.connection, "confirmed");
  const mint = new PublicKey(args.mint);
  const owner = new PublicKey(args.owner);
  const recipient = new PublicKey(args.recipient);
  const escrow = new PublicKey(args.escrow);
  const escrowToken = getAssociatedTokenAddressSync(mint, escrow, true, args.program, ASSOCIATED_TOKEN_PROGRAM_ID);
  const ownerToken = getAssociatedTokenAddressSync(mint, owner, false, args.program, ASSOCIATED_TOKEN_PROGRAM_ID);
  const recipientToken = getAssociatedTokenAddressSync(mint, recipient, false, args.program, ASSOCIATED_TOKEN_PROGRAM_ID);
  const cancel = await lock.program.methods
    .cancelVestingEscrow(null)
    .accountsPartial({ escrow, tokenMint: mint, escrowToken, creatorToken: ownerToken, recipientToken, rentReceiver: owner, signer: owner, tokenProgram: args.program })
    .instruction();
  const tx = new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(owner, ownerToken, owner, mint, args.program),
    createAssociatedTokenAccountIdempotentInstruction(owner, recipientToken, recipient, mint, args.program),
    cancel,
  );
  tx.feePayer = owner;
  tx.recentBlockhash = args.recentBlockhash;
  return { wireBase64: Buffer.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false })).toString("base64") };
}

/* ------------------------------------------------------------ the bytes against the plan */

const ALLOWED_PROGRAMS = new Set([
  ComputeBudgetProgram.programId.toBase58(),
  ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(),
  TOKEN_PROGRAM_ID.toBase58(),
  TOKEN_2022_PROGRAM_ID.toBase58(),
  LOCK_PROGRAM_ID.toBase58(),
  "11111111111111111111111111111111",
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
]);

/**
 * What would make a transaction other than its plan: an instruction of a program outside the token programs, Met Lock,
 * the system, the memo and the compute budget; a payer other than the one the plan names; an account opened for anyone
 * outside the plan; a wallet of Ryntra's anywhere in it. Empty when the bytes are the plan's.
 */
export function transactionProblems(tx: Transaction, plan: Readonly<{ payer: string; owners: ReadonlySet<string>; ryntra: ReadonlySet<string> }>): readonly string[] {
  const problems: string[] = [];
  if (tx.feePayer?.toBase58() !== plan.payer) problems.push("The transaction is paid for by someone other than the wallet it was built for.");
  for (const instruction of tx.instructions) {
    const id = instruction.programId.toBase58();
    if (!ALLOWED_PROGRAMS.has(id)) {
      problems.push(`An instruction of another program: ${id}.`);
      continue;
    }
    if (instruction.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)) {
      const owner = instruction.keys[2]?.pubkey.toBase58() ?? "";
      if (!plan.owners.has(owner)) problems.push(`An account opened for a wallet outside the plan: ${owner}.`);
      if (plan.ryntra.has(owner)) problems.push(`An account opened for a wallet of Ryntra's: ${owner}.`);
    }
  }
  for (const key of tx.instructions.flatMap((instruction) => instruction.keys.map((entry) => entry.pubkey.toBase58()))) {
    if (plan.ryntra.has(key)) problems.push(`A wallet of Ryntra's is in the transaction: ${key}.`);
  }
  return problems;
}

/* ------------------------------------------------------------ the list */

async function launchOf(deps: DistributionDeps, token: string): Promise<LaunchRecord | DistributionFailure> {
  const record = await readLaunchRecord(deps, deps.network.cluster, token).catch(() => null);
  if (!record || record.state === "PENDING") return fail("LAUNCH_NOT_FOUND", "No Ryntra launch of this token here.");
  return record;
}

async function sweep(deps: DistributionDeps): Promise<void> {
  const stale = deps.now().getTime() - 60 * 60 * 1000;
  for (const build of await builds(deps.store).valuesWithPrefix(`${deps.network.cluster}:`)) {
    if (Date.parse(build.expiresAt) < stale) await builds(deps.store).delete(campaignKey(build.cluster, build.id));
  }
}

/**
 * The campaign's candidates with their verdicts. A campaign over a snapshot reads it at its finalized slot; a campaign
 * over a list takes the owner's own rows. Where the campaign asks for the cluster rules or an identity check and
 * protection could not be read, every row carries `UNVERIFIED` — protection's own hard signal — so nothing is counted
 * against a check that did not run.
 */
export async function distributionCandidates(
  deps: DistributionDeps,
  draft: DistributionDraft,
  list: readonly SnapshotRow[],
): Promise<Readonly<{ ok: true; rows: readonly EligibilityRow[]; digest: string | null }> | DistributionFailure> {
  let rows: readonly SnapshotRow[] = list;
  let bought: ReadonlyMap<string, bigint> = new Map(list.map((row) => [row.wallet, BigInt(row.holdingRaw)]));
  let heldSince: ReadonlyMap<string, number> | null = null;
  let digest: string | null = null;
  if (draft.snapshot) {
    const read = deps.snapshot ? await deps.snapshot(draft.snapshot).catch(() => null) : null;
    if (!read) return fail("UNAVAILABLE", "The snapshot could not be read now; nothing was counted.");
    /* A snapshot read in part is no snapshot: a root published over it would be a root over a guess. */
    if (!read.complete) return fail("UNAVAILABLE", "The snapshot was read in part; nothing was counted.");
    rows = read.rows;
    bought = read.bought;
    heldSince = read.heldSince ?? null;
    digest = await snapshotDigest(draft.snapshot, read.rows);
  }
  /* A campaign asking how long a wallet has held needs that read; without it every row would fall to the rule, which
     is a refusal dressed as a result. */
  if (draft.eligibility.heldSinceSlot !== null && !heldSince) {
    return fail("CAPABILITY_UNAVAILABLE", "This campaign asks how long each wallet has held, and that is not read here; nothing was counted.");
  }
  if (!rows.length) return fail("VALIDATION_ERROR", "The campaign has nobody to pay.");
  if (rows.length > CAMPAIGN_MAX_ROWS) return fail("VALIDATION_ERROR", `A campaign's list holds at most ${CAMPAIGN_MAX_ROWS} wallets.`);

  const wallets = rows.map((row) => row.wallet);
  const asksProtection = draft.eligibility.oneWalletPerFundingSource || draft.eligibility.oneWalletPerDevice || draft.kyc || draft.eligibility.minTrust > 0;
  const facts = deps.protection ? await deps.protection(wallets).catch(() => null) : null;
  const ryntra = deps.ownWallets ? await deps.ownWallets().catch(() => null) : null;

  const candidates: Candidate[] = rows.map((row) => {
    const known = facts?.get(row.wallet);
    const unread = asksProtection && !known;
    return {
      wallet: row.wallet,
      holdingRaw: row.holdingRaw,
      boughtRaw: (bought.get(row.wallet) ?? 0n).toString(),
      heldSinceSlot: heldSince?.get(row.wallet) ?? null,
      fundingHashes: known?.fundingHashes ?? [],
      deviceHashes: known?.deviceHashes ?? [],
      signals: unread ? ["UNVERIFIED"] : (known?.signals ?? []),
      kyc: known?.kyc ?? null,
      excluded: row.wallet === draft.owner ? "creator" : ryntra?.wallets.has(row.wallet) ? "ryntra" : null,
    };
  });
  return { ok: true, rows: eligibilityRows(candidates, draft.eligibility, { needsReview, trustScore }), digest };
}

/* ------------------------------------------------------------ the commitment */

export type PreparedCommit = Readonly<{ ok: true; build: LaunchDistributionBuildResponse }>;

/** The Review in the contract's own shape — the campaign's figures, with nothing added and nothing rounded. */
function reviewOf(review: DistributionReview): LaunchDistributionReview {
  return {
    protocol: { protocol: review.protocol.protocol, why: review.protocol.why, open: review.protocol.open, missing: [...review.protocol.missing] },
    root: review.root,
    maxClaimAmountRaw: review.maxClaimAmountRaw,
    maxEscrow: review.maxEscrow,
    allocatedRaw: review.allocatedRaw,
    fundingRaw: review.fundingRaw,
    leftoverRaw: review.leftoverRaw,
    wallets: review.wallets,
    fees: review.fees.map((fee) => ({ ...fee })),
    enforced: review.enforced.map((row) => ({ ...row })),
    warnings: [...review.warnings],
  };
}

const panelShape = (panel: ClaimPanel): LaunchDistributionClaimPanel => ({ ...panel, receipts: panel.receipts.map((receipt) => ({ ...receipt })) });
const leftoverShape = (rows: readonly LeftoverRow[]) => rows.map((row) => ({ ...row }));
const heldBackShape = (rows: readonly Readonly<{ wallet: string; reasons: readonly EligibilityReason[] }>[]) => rows.map((row) => ({ wallet: row.wallet, reasons: [...row.reasons] }));

/**
 * The owner's draft into one transaction: the list counted, the Review stated, the root and the funding built. Nothing
 * is signed and nothing is sent here.
 */
export async function prepareDistribution(
  deps: DistributionDeps,
  input: Readonly<{ token: string; owner: string; draft: DistributionDraft; list?: readonly SnapshotRow[] }>,
): Promise<PreparedCommit | DistributionFailure> {
  const env = deps.env ?? {};
  const record = await launchOf(deps, input.token);
  if ("ok" in record) return record;
  if (input.draft.token !== input.token) return fail("VALIDATION_ERROR", "The draft is for another token.");
  if (input.draft.owner !== input.owner) return fail("WALLET_MISMATCH", "Only the campaign's owner builds it.");
  if (!ticketKeyConfigured(env)) return fail("LAUNCH_PAUSED", "Campaigns are paused; nothing was built.");

  const now = deps.now();
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const ryntra = ryntraAddresses(deps.network);
  const own = deps.ownWallets ? await deps.ownWallets().catch(() => null) : null;
  for (const wallet of own?.wallets ?? []) ryntra.add(wallet);

  const protocol = protocolFor(input.draft.scenario, { expiry: input.draft.expiry !== null, kyc: input.draft.kyc }, env);
  if (!protocol.open) {
    return fail("CAPABILITY_UNAVAILABLE", `This campaign needs a protocol that is not open here. Still missing: ${protocol.missing.join("; ")}.`);
  }

  /* Launch-to-Rewards: a reserved share becomes a campaign only on the chain's own answer about the exit to a DEX. */
  if (input.draft.afterDex) {
    const exit = deps.exit ? await deps.exit(input.token).catch(() => null) : null;
    const gate = launchToRewardsGate(exit);
    if (!gate.open) return fail("LAUNCH_NOT_GRADUATED", `The campaign waits for the token's proven exit to a DEX (${gate.reason}).`);
  }

  const counted = await distributionCandidates(deps, input.draft, input.list ?? []);
  if (!("ok" in counted) || counted.ok !== true) return counted;
  const plan = distributionPlan(input.draft, counted.rows, nowSeconds, ryntra, env);
  if (plan.problems.length) {
    return fail("VALIDATION_ERROR", `The campaign's draft does not hold: ${plan.problems.join(", ")}.`, plan.problems.map((problem) => ({ path: "draft", message: problem })));
  }
  if (!plan.rows.length) {
    return fail("VALIDATION_ERROR", plan.heldBack > 0 ? "Every wallet of this campaign waits for a person to look at it; nothing was built." : "The campaign has nobody to pay.");
  }
  const published = await rootPlan(plan.nodes);
  if (published.problems.length || !published.root) {
    return fail("VALIDATION_ERROR", `The list cannot be published: ${published.problems.join(", ")}.`);
  }

  let mint: Awaited<ReturnType<typeof mintFacts>>;
  try {
    mint = await mintFacts(deps.connection, input.draft.currency.mint);
  } catch {
    return fail("UNAVAILABLE", "The network could not be read now; nothing was built. Try again.");
  }
  if (!mint) return fail("MINT_UNREADABLE", "The campaign's currency is not a token mint.");
  const funding = BigInt(published.maxClaimAmountRaw);
  try {
    const held = await heldBy(deps.connection, getAssociatedTokenAddressSync(new PublicKey(input.draft.currency.mint), new PublicKey(input.owner), false, mint.program, ASSOCIATED_TOKEN_PROGRAM_ID));
    if (held < funding) return fail("LAUNCH_BALANCE_LOW", "The owner's wallet holds less than the list adds up to.");
  } catch {
    return fail("UNAVAILABLE", "The network could not be read now; nothing was built. Try again.");
  }

  await sweep(deps).catch(() => undefined);
  const escrowVersion = Math.floor(now.getTime() / 1000);
  let built: Awaited<ReturnType<typeof buildCommitTransaction>>;
  let validUntil: string;
  try {
    const latest = await within(() => deps.connection.getLatestBlockhash("confirmed"));
    validUntil = String(latest.lastValidBlockHeight);
    built = await buildCommitTransaction({
      connection: deps.connection,
      mint: input.draft.currency.mint,
      program: mint.program,
      owner: input.owner,
      root: published.root,
      maxClaimAmountRaw: funding,
      maxEscrow: published.maxEscrow,
      escrowVersion,
      recentBlockhash: latest.blockhash,
    });
  } catch (error) {
    return fail("UNAVAILABLE", error instanceof Error ? error.message.slice(0, 300) : "The campaign could not be built.");
  }

  const tx = Transaction.from(Buffer.from(built.wireBase64, "base64"));
  const problems = transactionProblems(tx, { payer: input.owner, owners: new Set([input.owner, built.rootEscrow]), ryntra });
  if (problems.length) return fail("UNAVAILABLE", `The campaign was not built: ${problems.join(" ")}`);

  const cosign = sealCosigners([{ index: 0, key: built.baseKey }], env);
  if (!cosign) return fail("LAUNCH_PAUSED", "Campaigns are paused; nothing was built.");
  const windows = await readBuildWindows(web3ChainReader(deps.connection, READ_MS), validUntil, { transactions: 1, capMs: DISTRIBUTION_BUILD_TTL_MS });
  const currency: CampaignCurrency = {
    mint: input.draft.currency.mint,
    program: mint.program.toBase58(),
    decimals: mint.decimals,
    symbol: input.draft.currency.symbol.slice(0, 24),
  };
  const heldBack = counted.rows.filter((row) => row.verdict === "REVIEW").map((row) => ({ wallet: row.wallet, reasons: row.reasons }));
  const review = distributionReview(input.draft, plan.nodes, {
    root: published.root,
    maxClaimAmountRaw: published.maxClaimAmountRaw,
    maxEscrow: published.maxEscrow,
    leftoverRaw: plan.leftoverRaw,
    heldBack: plan.heldBack,
    belowFloor: plan.belowFloor,
  }, env);

  const build: CommitBuild = {
    kind: "commit",
    id: randomBytes(16).toString("hex"),
    cluster: deps.network.cluster,
    campaign: randomBytes(16).toString("hex"),
    token: record.token,
    owner: input.owner,
    wire: withoutSignaturesOf(built.wireBase64, [built.baseKey.publicKey.toBase58()]),
    messageSha256: sha256(tx.serializeMessage()),
    digest: reviewedDigest(tx),
    cosign,
    rootEscrow: built.rootEscrow,
    escrowVersion,
    currency,
    draft: input.draft,
    nodes: plan.nodes,
    root: published.root,
    maxClaimAmountRaw: published.maxClaimAmountRaw,
    maxEscrow: published.maxEscrow,
    snapshotDigest: counted.digest,
    heldBack,
    validUntil,
    createdAt: now.toISOString(),
    expiresAt: new Date(deps.now().getTime() + windows.lifeMs).toISOString(),
  };
  await builds(deps.store).insertIfAbsent(campaignKey(build.cluster, build.id), build);
  return {
    ok: true,
    build: {
      buildId: build.id,
      campaignId: build.campaign,
      network: deps.network.chain,
      unsignedWireBase64: build.wire,
      rootEscrow: build.rootEscrow,
      root: build.root,
      wallets: build.maxEscrow,
      fundingRaw: build.maxClaimAmountRaw,
      review: reviewOf(review),
      snapshotDigest: build.snapshotDigest,
      heldBack: heldBackShape(heldBack),
      expiresAt: build.expiresAt,
      signableMs: windows.signableMs,
    },
  };
}

export async function submitDistribution(
  deps: DistributionDeps,
  input: Readonly<{ token: string; buildId: string; owner: string; signedWireBase64: string }>,
): Promise<Readonly<{ ok: true; submit: LaunchDistributionSubmitResponse }> | DistributionFailure> {
  const deadline = deps.now().getTime() + ROUTE_MS;
  const build = await builds(deps.store).get(campaignKey(deps.network.cluster, input.buildId));
  if (!build || build.kind !== "commit" || build.token !== input.token) return fail("LAUNCH_NOT_FOUND", "This campaign was not built here.");
  if (build.owner !== input.owner) return fail("WALLET_MISMATCH", "This campaign was built for another wallet.");
  if (Date.parse(build.expiresAt) < deps.now().getTime()) return fail("LAUNCH_BUILD_EXPIRED", "The campaign waited too long for the signature; build it again.");
  const keys = openCosigners(build.cosign, deps.env ?? {});
  if (!keys) return fail("LAUNCH_BUILD_EXPIRED", "The campaign can no longer be signed; build it again.");
  const tx = signedCommitment(input.signedWireBase64, { messageSha256: build.messageSha256, digest: build.digest, creator: build.owner }, keys.map((cosigner) => cosigner.key));
  if ("ok" in tx) return tx;
  if (!(await sends(deps.store).insertIfAbsent(campaignKey(build.cluster, build.id), { cluster: build.cluster, id: build.id, at: deps.now().toISOString() }))) {
    return fail("LAUNCH_BUILD_USED", "This campaign was already sent.");
  }
  const signature = signatureOf(tx);
  const pending: CampaignChange = {
    cluster: build.cluster,
    id: build.campaign,
    token: build.token,
    owner: build.owner,
    draft: build.draft,
    currency: build.currency,
    nodes: build.nodes,
    root: build.root,
    maxClaimAmountRaw: build.maxClaimAmountRaw,
    maxEscrow: build.maxEscrow,
    snapshotDigest: build.snapshotDigest,
    heldBack: build.heldBack,
    rootEscrow: build.rootEscrow,
    escrowVersion: build.escrowVersion,
    commitment: { buildId: build.id, signature, state: "PENDING", reason: null, validUntil: build.validUntil },
    claims: [],
    recovered: [],
    createdAt: deps.now().toISOString(),
  };
  const opened = await changeCampaign(deps.store, build.cluster, build.campaign, (current) => (current ? "taken" : pending)).catch(() => null);
  if (!opened?.ok) return fail("LAUNCH_BUILD_USED", "This campaign was already opened.");

  const sent = await sendOnce(deps.connection, tx, Number(build.validUntil), deps.now, { ...SEND_BUDGET, deadline }, {
    second: deps.second,
    landed: (minSlot: number | null, cap: () => number) => accountOnChain([deps.connection, deps.second], build.rootEscrow, [LOCK_PROGRAM_ID.toBase58()], minSlot, cap),
  });
  if (sent.outcome === "CONFIRMED") {
    const settled = await settleCommitment(deps, opened.row).catch(() => opened.row);
    return { ok: true, submit: { state: settled.commitment.state, campaignId: build.campaign, signature, rootEscrow: build.rootEscrow, reason: settled.commitment.reason } };
  }
  const state = sent.outcome === "UNKNOWN" ? "PENDING" : "FAILED";
  const reason = state === "FAILED" ? (sent.reason ?? "The network refused the campaign.").slice(0, 300) : null;
  if (state === "FAILED") {
    await changeCampaign(deps.store, build.cluster, build.campaign, (current) =>
      current && current.commitment.buildId === build.id && current.commitment.state === "PENDING" ? { ...current, commitment: { ...current.commitment, state, reason } } : "moved",
    ).catch(() => null);
  }
  return { ok: true, submit: { state, campaignId: build.campaign, signature, rootEscrow: build.rootEscrow, reason } };
}

/**
 * What makes a root escrow on the chain other than the campaign it was built for: another token, another owner, another
 * root, another bound, or less funded than the list promises. Empty when the chain holds the campaign as published.
 */
export function rootEscrowProblems(campaign: Pick<DistributionCampaign, "owner" | "currency" | "root" | "maxClaimAmountRaw" | "maxEscrow">, observation: RootEscrowObservation): readonly string[] {
  const problems: string[] = [];
  if (observation.mint !== campaign.currency.mint) problems.push("the root escrow holds another token");
  if (observation.creator !== campaign.owner) problems.push("the root escrow was opened by another wallet");
  if (observation.root !== campaign.root) problems.push("the root escrow carries another root than the published list");
  if (BigInt(observation.maxClaimAmountRaw) !== BigInt(campaign.maxClaimAmountRaw)) problems.push("the root escrow may pay another amount than the list");
  if (observation.maxEscrow !== campaign.maxEscrow) problems.push("the root escrow may make another number of escrows than the list has rows");
  if (BigInt(observation.fundedRaw) < BigInt(campaign.maxClaimAmountRaw)) problems.push("the root escrow holds less than the list promises");
  return problems;
}

/** A PENDING commitment settled from the chain: FUNDED when the root escrow is the campaign's, FAILED when it is not. */
export async function settleCommitment(deps: DistributionDeps, campaign: DistributionCampaign): Promise<DistributionCampaign> {
  if (campaign.commitment.state !== "PENDING") return campaign;
  const observe = deps.observeRoot ?? ((address: string) => observeRootEscrow(deps.connection, address));
  const observation = await observe(campaign.rootEscrow).catch(() => undefined);
  if (observation === undefined) return campaign;
  if (observation === null) {
    /* Not there yet: a signature that can no longer land is a campaign that never opened. */
    const height = await within(() => deps.connection.getBlockHeight("confirmed")).catch(() => null);
    if (height === null || height <= Number(campaign.commitment.validUntil)) return campaign;
    const written = await changeCampaign(deps.store, campaign.cluster, campaign.id, (current) =>
      current && current.commitment.state === "PENDING" ? { ...current, commitment: { ...current.commitment, state: "FAILED", reason: "The campaign's signature could no longer land." } } : "moved",
    ).catch(() => null);
    return written?.ok ? written.row : campaign;
  }
  const problems = rootEscrowProblems(campaign, observation);
  const written = await changeCampaign(deps.store, campaign.cluster, campaign.id, (current) =>
    current && current.commitment.state === "PENDING"
      ? { ...current, commitment: { ...current.commitment, state: problems.length ? "FAILED" : "FUNDED", reason: problems.length ? problems.join("; ").slice(0, 300) : null } }
      : "moved",
  ).catch(() => null);
  return written?.ok ? written.row : campaign;
}

/* ------------------------------------------------------------ the claim */

export type PreparedClaim = Readonly<{ ok: true; build: LaunchDistributionClaimBuildResponse }>;

/**
 * One wallet's own claim. Built only against a root escrow the chain shows holding the list's promise, and only for the
 * wallet asking — the recipient is the sole signer, so Ryntra could not claim for anybody even if it wanted to.
 */
export async function prepareDistributionClaim(
  deps: DistributionDeps,
  input: Readonly<{ campaignId: string; wallet: string }>,
): Promise<PreparedClaim | DistributionFailure> {
  const campaign = await readCampaign(deps.store, deps.network.cluster, input.campaignId);
  if (!campaign) return fail("LAUNCH_NOT_FOUND", "No such campaign here.");
  const settled = await settleCommitment(deps, campaign).catch(() => campaign);
  if (settled.commitment.state !== "FUNDED") return fail("LAUNCH_NOT_FOUND", "This campaign is not funded; nothing was built.");
  const node = settled.nodes.find((row) => row.recipient === input.wallet);
  if (!node) return fail("WALLET_MISMATCH", "This wallet is not in the campaign's list.");

  const observe = deps.observeRoot ?? ((address: string) => observeRootEscrow(deps.connection, address));
  const root = await observe(settled.rootEscrow).catch(() => undefined);
  if (root === undefined) return fail("UNAVAILABLE", "The network could not be read now; nothing was built. Try again.");
  if (!root) return fail("LAUNCH_NOT_FOUND", "The campaign's root escrow is not on chain.");
  const mismatch = rootEscrowProblems(settled, root);
  if (mismatch.length) return fail("LAUNCH_PAUSED", `Nothing was built: ${mismatch.join("; ")}.`);

  const { escrow } = rowAddresses(settled.rootEscrow, input.wallet);
  const observeRow = deps.observeRow ?? ((address: string) => observeRowEscrow(deps.connection, address));
  const existing = await observeRow(escrow).catch(() => undefined);
  if (existing === undefined) return fail("UNAVAILABLE", "The network could not be read now; nothing was built. Try again.");
  /* A row's escrow already made is the chain's own answer to a second claim of the whole row: this build only ever
     claims what has vested since, and when nothing has, nothing is built. */
  const nowSeconds = Math.floor(deps.now().getTime() / 1000);
  const claimed = existing ? BigInt(existing.claimedRaw) : 0n;
  const amount = claimableRaw(node, claimed, nowSeconds);
  if (existing && existing.cancelledAt > 0) return fail("LAUNCH_NOT_FOUND", "This row was cancelled; nothing is left to claim.");
  if (amount <= 0n) {
    return fail("VALIDATION_ERROR", claimed >= nodeTotalRaw(node) ? "This row was already claimed in full." : "Nothing of this row has unlocked yet.");
  }

  const proof = await vestingProof(settled.nodes, input.wallet);
  if (!proof) return fail("WALLET_MISMATCH", "This wallet is not in the campaign's list.");
  await sweep(deps).catch(() => undefined);

  let built: Awaited<ReturnType<typeof buildClaimTransaction>>;
  let validUntil: string;
  try {
    const latest = await within(() => deps.connection.getLatestBlockhash("confirmed"));
    validUntil = String(latest.lastValidBlockHeight);
    built = await buildClaimTransaction({
      connection: deps.connection,
      mint: settled.currency.mint,
      program: new PublicKey(settled.currency.program),
      rootEscrow: settled.rootEscrow,
      node,
      proof,
      maxAmountRaw: amount,
      recentBlockhash: latest.blockhash,
    });
  } catch (error) {
    return fail("UNAVAILABLE", error instanceof Error ? error.message.slice(0, 300) : "The claim could not be built.");
  }
  const tx = Transaction.from(Buffer.from(built.wireBase64, "base64"));
  const ryntra = ryntraAddresses(deps.network);
  const problems = transactionProblems(tx, { payer: input.wallet, owners: new Set([input.wallet, built.escrow, settled.rootEscrow]), ryntra });
  if (problems.length) return fail("UNAVAILABLE", `The claim was not built: ${problems.join(" ")}`);

  const windows = await readBuildWindows(web3ChainReader(deps.connection, READ_MS), validUntil, { transactions: 1, capMs: DISTRIBUTION_BUILD_TTL_MS });
  const build: ClaimBuild = {
    kind: "claim",
    id: randomBytes(16).toString("hex"),
    cluster: deps.network.cluster,
    campaign: settled.id,
    token: settled.token,
    wallet: input.wallet,
    wire: built.wireBase64,
    messageSha256: sha256(tx.serializeMessage()),
    digest: reviewedDigest(tx),
    amountRaw: amount.toString(),
    escrow: built.escrow,
    validUntil,
    createdAt: deps.now().toISOString(),
    expiresAt: new Date(deps.now().getTime() + windows.lifeMs).toISOString(),
  };
  await builds(deps.store).insertIfAbsent(campaignKey(build.cluster, build.id), build);
  return {
    ok: true,
    build: {
      buildId: build.id,
      network: deps.network.chain,
      unsignedWireBase64: build.wire,
      escrow: build.escrow,
      amountRaw: build.amountRaw,
      panel: panelShape(panelOf(settled, node, existing, nowSeconds, { read: true, funded: true, underReview: false, afterDex: false })),
      expiresAt: build.expiresAt,
      signableMs: windows.signableMs,
    },
  };
}

export async function submitDistributionClaim(
  deps: DistributionDeps,
  input: Readonly<{ campaignId: string; buildId: string; wallet: string; signedWireBase64: string }>,
): Promise<Readonly<{ ok: true; submit: LaunchDistributionClaimSubmitResponse }> | DistributionFailure> {
  const deadline = deps.now().getTime() + ROUTE_MS;
  const build = await builds(deps.store).get(campaignKey(deps.network.cluster, input.buildId));
  if (!build || build.kind !== "claim" || build.campaign !== input.campaignId) return fail("LAUNCH_NOT_FOUND", "This claim was not built here.");
  if (build.wallet !== input.wallet) return fail("WALLET_MISMATCH", "This claim was built for another wallet.");
  if (Date.parse(build.expiresAt) < deps.now().getTime()) return fail("LAUNCH_BUILD_EXPIRED", "The claim waited too long for the signature; build it again.");
  const tx = signedCommitment(input.signedWireBase64, { messageSha256: build.messageSha256, digest: build.digest, creator: build.wallet }, []);
  if ("ok" in tx) return tx;
  if (!(await sends(deps.store).insertIfAbsent(campaignKey(build.cluster, build.id), { cluster: build.cluster, id: build.id, at: deps.now().toISOString() }))) {
    return fail("LAUNCH_BUILD_USED", "This claim was already sent.");
  }
  const signature = signatureOf(tx);
  const sent = await sendOnce(deps.connection, tx, Number(build.validUntil), deps.now, { ...SEND_BUDGET, deadline }, {
    second: deps.second,
    landed: (minSlot: number | null, cap: () => number) => accountOnChain([deps.connection, deps.second], build.escrow, [LOCK_PROGRAM_ID.toBase58()], minSlot, cap),
  });
  const state = sent.outcome === "CONFIRMED" ? "CLAIMED" : sent.outcome === "UNKNOWN" ? "PENDING" : "FAILED";
  const reason = state === "FAILED" ? (sent.reason ?? "The network refused the claim.").slice(0, 300) : null;
  await changeCampaign(deps.store, build.cluster, build.campaign, (current) => {
    if (!current) return "gone";
    if (current.claims.some((claim) => claim.signature === signature)) return "recorded";
    return { ...current, claims: [...current.claims, { wallet: build.wallet, signature, amountRaw: build.amountRaw, at: deps.now().toISOString(), state: state === "CLAIMED" ? "CONFIRMED" : state === "PENDING" ? "PENDING" : "FAILED" }] };
  }).catch(() => null);
  return { ok: true, submit: { state, signature, amountRaw: build.amountRaw, escrow: build.escrow, reason } };
}

/* ------------------------------------------------------------ the leftovers */

export async function prepareDistributionRecover(
  deps: DistributionDeps,
  input: Readonly<{ campaignId: string; owner: string; wallet: string }>,
): Promise<Readonly<{ ok: true; build: LaunchDistributionRecoverBuildResponse }> | DistributionFailure> {
  const campaign = await readCampaign(deps.store, deps.network.cluster, input.campaignId);
  if (!campaign) return fail("LAUNCH_NOT_FOUND", "No such campaign here.");
  if (campaign.owner !== input.owner) return fail("WALLET_MISMATCH", "Only the campaign's owner may cancel a row.");
  if (campaign.draft.cancel !== "owner" && campaign.draft.cancel !== "either") {
    return fail("CAPABILITY_UNAVAILABLE", "This campaign published that nobody may cancel a row; nothing was built.");
  }
  const node = campaign.nodes.find((row) => row.recipient === input.wallet);
  if (!node) return fail("WALLET_MISMATCH", "This wallet is not in the campaign's list.");
  const { escrow } = rowAddresses(campaign.rootEscrow, input.wallet);
  const observeRow = deps.observeRow ?? ((address: string) => observeRowEscrow(deps.connection, address));
  const row = await observeRow(escrow).catch(() => undefined);
  if (row === undefined) return fail("UNAVAILABLE", "The network could not be read now; nothing was built. Try again.");
  if (!row) return fail("LAUNCH_NOT_FOUND", "This row has no escrow yet: nothing was funded into it to return.");
  if (row.cancelledAt > 0) return fail("LAUNCH_BUILD_USED", "This row was already cancelled.");

  const nowSeconds = Math.floor(deps.now().getTime() / 1000);
  const claimed = BigInt(row.claimedRaw);
  const toRecipient = claimableRaw(node, claimed, nowSeconds);
  const toOwner = nodeTotalRaw(node) - claimed - toRecipient;
  await sweep(deps).catch(() => undefined);

  let built: Awaited<ReturnType<typeof buildRecoverTransaction>>;
  let validUntil: string;
  try {
    const latest = await within(() => deps.connection.getLatestBlockhash("confirmed"));
    validUntil = String(latest.lastValidBlockHeight);
    built = await buildRecoverTransaction({
      connection: deps.connection,
      mint: campaign.currency.mint,
      program: new PublicKey(campaign.currency.program),
      owner: input.owner,
      recipient: input.wallet,
      escrow,
      recentBlockhash: latest.blockhash,
    });
  } catch (error) {
    return fail("UNAVAILABLE", error instanceof Error ? error.message.slice(0, 300) : "The cancellation could not be built.");
  }
  const tx = Transaction.from(Buffer.from(built.wireBase64, "base64"));
  const ryntra = ryntraAddresses(deps.network);
  const problems = transactionProblems(tx, { payer: input.owner, owners: new Set([input.owner, input.wallet, escrow]), ryntra });
  if (problems.length) return fail("UNAVAILABLE", `The cancellation was not built: ${problems.join(" ")}`);

  const windows = await readBuildWindows(web3ChainReader(deps.connection, READ_MS), validUntil, { transactions: 1, capMs: DISTRIBUTION_BUILD_TTL_MS });
  const build: RecoverBuild = {
    kind: "recover",
    id: randomBytes(16).toString("hex"),
    cluster: deps.network.cluster,
    campaign: campaign.id,
    token: campaign.token,
    owner: input.owner,
    wallet: input.wallet,
    wire: built.wireBase64,
    messageSha256: sha256(tx.serializeMessage()),
    digest: reviewedDigest(tx),
    escrow,
    toOwnerRaw: (toOwner > 0n ? toOwner : 0n).toString(),
    toRecipientRaw: toRecipient.toString(),
    validUntil,
    createdAt: deps.now().toISOString(),
    expiresAt: new Date(deps.now().getTime() + windows.lifeMs).toISOString(),
  };
  await builds(deps.store).insertIfAbsent(campaignKey(build.cluster, build.id), build);
  return {
    ok: true,
    build: {
      buildId: build.id,
      network: deps.network.chain,
      unsignedWireBase64: build.wire,
      escrow,
      toOwnerRaw: build.toOwnerRaw,
      toRecipientRaw: build.toRecipientRaw,
      expiresAt: build.expiresAt,
      signableMs: windows.signableMs,
    },
  };
}

export async function submitDistributionRecover(
  deps: DistributionDeps,
  input: Readonly<{ campaignId: string; buildId: string; owner: string; signedWireBase64: string }>,
): Promise<Readonly<{ ok: true; submit: LaunchDistributionRecoverSubmitResponse }> | DistributionFailure> {
  const deadline = deps.now().getTime() + ROUTE_MS;
  const build = await builds(deps.store).get(campaignKey(deps.network.cluster, input.buildId));
  if (!build || build.kind !== "recover" || build.campaign !== input.campaignId) return fail("LAUNCH_NOT_FOUND", "This cancellation was not built here.");
  if (build.owner !== input.owner) return fail("WALLET_MISMATCH", "This cancellation was built for another wallet.");
  if (Date.parse(build.expiresAt) < deps.now().getTime()) return fail("LAUNCH_BUILD_EXPIRED", "The cancellation waited too long for the signature; build it again.");
  const tx = signedCommitment(input.signedWireBase64, { messageSha256: build.messageSha256, digest: build.digest, creator: build.owner }, []);
  if ("ok" in tx) return tx;
  if (!(await sends(deps.store).insertIfAbsent(campaignKey(build.cluster, build.id), { cluster: build.cluster, id: build.id, at: deps.now().toISOString() }))) {
    return fail("LAUNCH_BUILD_USED", "This cancellation was already sent.");
  }
  const signature = signatureOf(tx);
  const sent = await sendOnce(deps.connection, tx, Number(build.validUntil), deps.now, { ...SEND_BUDGET, deadline }, { second: deps.second });
  const state = sent.outcome === "CONFIRMED" ? "RETURNED" : sent.outcome === "UNKNOWN" ? "PENDING" : "FAILED";
  if (state === "RETURNED") {
    await changeCampaign(deps.store, build.cluster, build.campaign, (current) => {
      if (!current) return "gone";
      if (current.recovered.some((row) => row.signature === signature)) return "recorded";
      return { ...current, recovered: [...current.recovered, { wallet: build.wallet, signature, toOwnerRaw: build.toOwnerRaw, at: deps.now().toISOString() }] };
    }).catch(() => null);
  }
  return {
    ok: true,
    submit: { state, signature, toOwnerRaw: build.toOwnerRaw, toRecipientRaw: build.toRecipientRaw, reason: state === "FAILED" ? (sent.reason ?? "The network refused it.").slice(0, 300) : null },
  };
}

/* ------------------------------------------------------------ the reads a page makes */

function panelOf(
  campaign: DistributionCampaign,
  node: VestingNode | null,
  escrow: RowEscrowObservation | null,
  nowSeconds: number,
  state: Readonly<{ read: boolean; funded: boolean; underReview: boolean; afterDex: boolean }>,
): ClaimPanel {
  const receipts = campaign.claims
    .filter((claim) => claim.wallet === node?.recipient && claim.state === "CONFIRMED")
    .map((claim) => ({ signature: claim.signature, amountRaw: claim.amountRaw, at: Math.floor(Date.parse(claim.at) / 1000) }));
  return claimPanel({
    node,
    escrow: escrow ? { address: escrow.escrow, claimedRaw: escrow.claimedRaw, cancelled: escrow.cancelledAt > 0 } : null,
    receipts,
    read: state.read,
    funded: state.funded,
    underReview: state.underReview,
    afterDex: state.afterDex,
    now: nowSeconds,
  });
}

/** Which stage a campaign stands at, from what the chain and the store say. */
export function stageOf(campaign: DistributionCampaign, reconcile: Reconciliation): DistributionStage {
  if (campaign.commitment.state === "PENDING") return "funding";
  if (campaign.commitment.state === "FAILED") return "review";
  if (campaign.recovered.length) return "recover";
  if (reconcile.state === "NOT_READ") return "claim";
  if (campaign.claims.some((claim) => claim.state === "CONFIRMED")) {
    return BigInt(reconcile.distributedRaw ?? "0") >= BigInt(campaign.maxClaimAmountRaw) ? "report" : "claim";
  }
  return "root";
}

/** One campaign as a page reads it: the Review, the chain against the list, what is left, and the report. */
export async function campaignView(deps: DistributionDeps, campaignId: string): Promise<LaunchDistributionView | null> {
  const stored = await readCampaign(deps.store, deps.network.cluster, campaignId);
  if (!stored) return null;
  const campaign = await settleCommitment(deps, stored).catch(() => stored);
  const observe = deps.observeRoot ?? ((address: string) => observeRootEscrow(deps.connection, address));
  const chain = await observe(campaign.rootEscrow).catch(() => undefined);
  const reconcile = distributionReconcile(
    { root: campaign.root, totalRaw: campaign.maxClaimAmountRaw, wallets: campaign.maxEscrow },
    chain ? { root: chain.root, fundedRaw: chain.fundedRaw, distributedRaw: chain.distributedRaw, escrowsMade: chain.escrowsMade } : null,
  );
  const review = distributionReview(campaign.draft, campaign.nodes, {
    root: campaign.root,
    maxClaimAmountRaw: campaign.maxClaimAmountRaw,
    maxEscrow: campaign.maxEscrow,
    leftoverRaw: "0",
    heldBack: campaign.heldBack.length,
    belowFloor: 0,
  }, deps.env ?? {});

  /* What the owner could still take back: the unvested part of every row whose escrow exists and is not cancelled. */
  const nowSeconds = Math.floor(deps.now().getTime() / 1000);
  let cancellable = 0n;
  if (campaign.draft.cancel === "owner" || campaign.draft.cancel === "either") {
    for (const node of campaign.nodes) cancellable += nodeTotalRaw(node) - unlockedRaw(node, nowSeconds);
  }
  const stranded = chain ? BigInt(chain.fundedRaw) - BigInt(campaign.maxClaimAmountRaw) : 0n;
  const leftovers = leftoverPlan({
    unspentPotRaw: "0",
    cancellableUnvestedRaw: cancellable.toString(),
    strandedRaw: (stranded > 0n ? stranded : 0n).toString(),
    cancel: campaign.draft.cancel,
    leftoverRecipient: campaign.draft.leftoverRecipient,
  });
  const confirmed = campaign.claims.filter((claim) => claim.state === "CONFIRMED");
  const claimed = {
    wallets: new Set(confirmed.map((claim) => claim.wallet)).size,
    amountRaw: confirmed.reduce((sum, claim) => sum + BigInt(claim.amountRaw), 0n).toString(),
  };
  const report = { draft: campaign.draft, review, reconcile, leftovers, claimed, at: nowSeconds };
  return {
    campaignId: campaign.id,
    token: campaign.token,
    owner: campaign.owner,
    stage: stageOf(campaign, reconcile),
    protocol: review.protocol.protocol,
    state: campaign.commitment.state,
    read: chain === undefined ? "NOT_READ" : "OK",
    currency: campaign.currency,
    root: campaign.root,
    rootEscrow: campaign.rootEscrow,
    snapshotDigest: campaign.snapshotDigest,
    wallets: campaign.maxEscrow,
    fundingRaw: campaign.maxClaimAmountRaw,
    review: reviewOf(review),
    reconcile,
    leftovers: leftoverShape(leftovers),
    heldBack: heldBackShape(campaign.heldBack),
    claimed,
    report: { uk: [...distributionReportLines(report, "uk")], en: [...distributionReportLines(report, "en")] },
    observedAt: deps.now().toISOString(),
  };
}

/** One wallet's claim panel: what belongs to it, what it took, what is left, with the chain's own receipts. */
export async function claimView(deps: DistributionDeps, campaignId: string, wallet: string): Promise<LaunchDistributionClaimView | null> {
  const stored = await readCampaign(deps.store, deps.network.cluster, campaignId);
  if (!stored) return null;
  const campaign = await settleCommitment(deps, stored).catch(() => stored);
  const node = campaign.nodes.find((row) => row.recipient === wallet) ?? null;
  const held = campaign.heldBack.find((row) => row.wallet === wallet);
  const observe = deps.observeRoot ?? ((address: string) => observeRootEscrow(deps.connection, address));
  const chain = await observe(campaign.rootEscrow).catch(() => undefined);
  const funded = chain !== undefined && chain !== null && rootEscrowProblems(campaign, chain).length === 0;
  const observeRow = deps.observeRow ?? ((address: string) => observeRowEscrow(deps.connection, address));
  const escrow = node ? await observeRow(rowAddresses(campaign.rootEscrow, wallet).escrow).catch(() => undefined) : null;
  const nowSeconds = Math.floor(deps.now().getTime() / 1000);
  const panel = panelOf(campaign, node, escrow ?? null, nowSeconds, {
    read: chain !== undefined && escrow !== undefined,
    funded,
    underReview: Boolean(held),
    afterDex: campaign.draft.afterDex && campaign.commitment.state !== "FUNDED",
  });
  return { campaignId: campaign.id, wallet, currency: { ...campaign.currency }, panel: panelShape(panel), reviewReasons: [...(held?.reasons ?? [])] };
}
