/**
 * The treasury's bytes and reads on Squads v4 (SOL-4). Every transaction here is for the person's wallet to sign as
 * the fee payer and the acting member; the server signs none of them. A new multisig's `createKey` — a one-time key whose
 * only power is to seed the multisig's address — is made in the person's browser and signs there after the wallet.
 *
 * - A new multisig has no config authority (it is autonomous: every change is a proposal its members vote on) and its
 *   rent goes back to its own vault: Ryntra holds no role in it and takes no fee.
 * - Payouts are one Squads batch under one proposal: each line pays from vault 0, SOL by the System program, USDC by
 *   `TransferChecked` with the recipient's account opened by the vault when it has none.
 * - A spending limit always carries its list of recipients (`model.ts`).
 */

import * as multisig from "@sqds/multisig";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { getBase58Decoder } from "@solana/kit";
import { ComputeBudgetProgram, Keypair, PublicKey, SystemProgram, Transaction, TransactionMessage, VersionedTransaction, type AccountInfo, type Connection, type TransactionInstruction } from "@solana/web3.js";
import BN from "bn.js";

import { readClaimLine } from "../../core/venues/meteora-dbc/partner-claim-lines.ts";
import { isV1Wire, setLoadedAccountsDataSizeLimit, viewOfWire } from "../v1-tx.ts";

import type { ConfigChange, ConfigChangeView, TreasuryLimit, TreasuryMember, TreasuryProposal, TreasuryState } from "./contract.ts";
import {
  AGENT_TIME_LOCK_S,
  NATIVE_MINT_KEY,
  PERIOD_CODE,
  ROLE_BITS,
  TREASURY_ASSETS,
  TREASURY_CHAIN,
  assetMint,
  assetOfMint,
  executableAt,
  periodOfCode,
  rolesOfMask,
  type LimitPeriod,
  type MemberDraft,
  type Payout,
  type TreasuryAssetId,
  type TreasuryNetwork,
} from "./model.ts";

const { Permissions } = multisig.types;
export const SQUADS_PROGRAM_ID = multisig.PROGRAM_ID;

/**
 * A transaction's ceiling is 1,232 bytes; the build keeps under this so a wallet still has room for its own fee and
 * guard instructions (`wallet-modification.ts` admits them) without the transaction growing past the limit.
 */
export const TX_BYTES_CAP = 1_050;
/**
 * Lines of one batch transaction: SOL transfers are light; a USDC line may open the recipient's account, so fewer fit
 * one execution's compute.
 */
const MAX_LINES_PER_ITEM: Readonly<Record<TreasuryAssetId, number>> = { SOL: 8, USDC: 4 };
/** An execution's compute: Squads' own work plus the lines it runs (the default 200,000 is near the edge for USDC). */
export const EXECUTE_COMPUTE_UNITS = 400_000;
const computeLimit = () => ComputeBudgetProgram.setComputeUnitLimit({ units: EXECUTE_COMPUTE_UNITS });
/**
 * The accounts' data a treasury transaction may load, set explicitly as Phantom asks of a dApp («set compute unit and
 * loaded account data limits explicitly», docs.phantom.com, domain and transaction warnings). What it loads is mostly
 * programs: Squads v4's program data is 1.47 MB, the Token program's 109 KB, the token-account program's 105 KB (read
 * on mainnet 21.10.2026); its own accounts are small. A launch's claim line loads more: DBC 2.33 MB, DAMM v2 2.17 MB,
 * Token-2022 1.38 MB (mainnet 1.11.2026), 7.6 MB with Squads. 16 MiB leaves room for an upgrade, far under the runtime's
 * 64 MiB; the limit changes no fee.
 */
export const LOADED_ACCOUNTS_LIMIT = 16 * 1024 * 1024;
/** What the runtime gives an instruction when nothing sets a limit, and the most a transaction may use. */
const UNITS_PER_INSTRUCTION = 200_000;
const MAX_UNITS = 1_400_000;
/**
 * Rent as the network charges it: (128 + bytes) × the rate per byte. The rate is the network's, read from it (it fell
 * from 6,960 to 5,080 lamports a byte in 2026, on devnet and mainnet alike); a figure written here would go stale again.
 */
let rentPerByte = 5_080n;
let rentReadAt = 0;
const RENT_READ_MS = 10 * 60 * 1000;

/** Reads the network's rent rate, at most every ten minutes; a failed read keeps the last one. */
export async function refreshRentRate(connection: Pick<Connection, "getMinimumBalanceForRentExemption">, now = Date.now()): Promise<void> {
  if (now - rentReadAt < RENT_READ_MS) return;
  try {
    const empty = BigInt(await connection.getMinimumBalanceForRentExemption(0, "confirmed"));
    if (empty > 0n && empty % 128n === 0n) {
      rentPerByte = empty / 128n;
      rentReadAt = now;
    }
  } catch {
    /* Not read: the last rate stands. */
  }
}

export function rentExemptLamports(bytes: number): bigint {
  return BigInt(128 + bytes) * rentPerByte;
}

/** A token account's rent (165 bytes), and the least an account with no data holds — a wallet, a vault, a new address. */
export const tokenAccountRent = () => rentExemptLamports(165);
export const emptyAccountRent = () => rentExemptLamports(0);

export class TreasuryRefusal extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

const key = (address: string) => new PublicKey(address);
const b58 = getBase58Decoder();

/* ─── Reads ───────────────────────────────────────────────────────────────── */

export type MultisigRead = Readonly<{
  address: PublicKey;
  account: multisig.accounts.Multisig;
  vault: PublicKey;
  members: readonly TreasuryMember[];
  transactionIndex: bigint;
  staleTransactionIndex: bigint;
  /** The account's size and balance: what a member added costs depends on them (`addMemberRent`). */
  dataLength: number;
  lamports: bigint;
}>;

const MULTISIG_DISCRIMINATOR = Buffer.from(multisig.generated.multisigDiscriminator);

export async function readMultisig(connection: Connection, address: string): Promise<MultisigRead> {
  const pda = key(address);
  const info = await connection.getAccountInfo(pda, "confirmed");
  if (!info) throw new TreasuryRefusal("TREASURY_NOT_FOUND", "No multisig at this address on this network.");
  if (!info.owner.equals(SQUADS_PROGRAM_ID)) throw new TreasuryRefusal("TREASURY_NOT_SQUADS", "This address is not a Squads v4 multisig.");
  /* The account's own kind first: the SDK's decoder takes any Squads account's bytes for a multisig, so a proposal's or
     a batch line's, whose bytes someone chose, would read as a treasury with the reader as its only member — and a
     top-up, which no Squads instruction checks, would go to a vault nobody can ever sign for. */
  if (!Buffer.from(info.data.subarray(0, 8)).equals(MULTISIG_DISCRIMINATOR)) throw new TreasuryRefusal("TREASURY_NOT_SQUADS", "This address is not a Squads v4 multisig.");
  let account: multisig.accounts.Multisig;
  try {
    [account] = multisig.accounts.Multisig.fromAccountInfo(info);
  } catch {
    throw new TreasuryRefusal("TREASURY_NOT_SQUADS", "This address is not a Squads v4 multisig.");
  }
  /* And it sits where Squads puts a multisig: at the address its own createKey derives. */
  if (!multisig.getMultisigPda({ createKey: account.createKey })[0].equals(pda)) throw new TreasuryRefusal("TREASURY_NOT_SQUADS", "This address is not a Squads v4 multisig.");
  const [vault] = multisig.getVaultPda({ multisigPda: pda, index: 0 });
  return {
    address: pda,
    account,
    vault,
    members: account.members.map((member) => ({ address: member.key.toBase58(), ...rolesOfMask(member.permissions.mask) })),
    transactionIndex: BigInt(account.transactionIndex.toString()),
    staleTransactionIndex: BigInt(account.staleTransactionIndex.toString()),
    dataLength: info.data.length,
    lamports: BigInt(info.lamports),
  };
}

/** Where the rent of a proposal's accounts goes once they are closed: the vault, another collector, or nowhere. */
export function rentDestination(read: MultisigRead): "vault" | "collector" | "kept" {
  const collector = read.account.rentCollector;
  if (!collector) return "kept";
  return collector.equals(read.vault) ? "vault" : "collector";
}

export function memberRoles(read: MultisigRead, wallet: string): TreasuryMember | null {
  return read.members.find((member) => member.address === wallet) ?? null;
}

/** Squads' fee for a new multisig and where it goes — the program's own config; 0 today. */
export async function readProgramConfig(connection: Connection): Promise<Readonly<{ treasury: PublicKey; feeLamports: bigint }>> {
  const [pda] = multisig.getProgramConfigPda({});
  const config = await multisig.accounts.ProgramConfig.fromAccountAddress(connection, pda, "confirmed");
  return { treasury: config.treasury, feeLamports: BigInt(config.multisigCreationFee.toString()) };
}

const DISCRIMINATORS = {
  config: Buffer.from(multisig.generated.configTransactionDiscriminator),
  batch: Buffer.from(multisig.generated.batchDiscriminator),
  vault: Buffer.from(multisig.generated.vaultTransactionDiscriminator),
  limit: Buffer.from(multisig.generated.spendingLimitDiscriminator),
};

function kindOf(data: Buffer): "config" | "batch" | "vault" | "unknown" {
  const head = data.subarray(0, 8);
  if (head.equals(DISCRIMINATORS.config)) return "config";
  if (head.equals(DISCRIMINATORS.batch)) return "batch";
  if (head.equals(DISCRIMINATORS.vault)) return "vault";
  return "unknown";
}

type StatusKind = multisig.generated.ProposalStatus["__kind"];
const STATE_OF: Readonly<Record<StatusKind, TreasuryProposal["state"]>> = {
  Draft: "draft",
  Active: "active",
  Rejected: "rejected",
  Approved: "approved",
  Executing: "executing",
  Executed: "executed",
  Cancelled: "cancelled",
};

function statusTime(status: multisig.generated.ProposalStatus): number | null {
  return "timestamp" in status && status.timestamp !== undefined ? Number(status.timestamp.toString()) : null;
}

const SYSTEM_TRANSFER = 2;
const TOKEN_TRANSFER_CHECKED = 12;

/** What one batch line pays: SOL by the System program's transfer, a token by `TransferChecked` (its mint is named). */
export function sumsOfMessage(message: multisig.generated.VaultTransactionMessage, network: TreasuryNetwork): readonly Readonly<{ asset: "SOL" | "USDC" | "OTHER"; raw: bigint }>[] {
  const out: { asset: "SOL" | "USDC" | "OTHER"; raw: bigint }[] = [];
  for (const instruction of message.instructions) {
    const program = message.accountKeys[instruction.programIdIndex];
    const data = Buffer.from(instruction.data);
    if (program?.equals(SystemProgram.programId) && data.length >= 12 && data.readUInt32LE(0) === SYSTEM_TRANSFER) {
      out.push({ asset: "SOL", raw: data.readBigUInt64LE(4) });
    } else if (program?.equals(TOKEN_PROGRAM_ID) && data.length >= 10 && data[0] === TOKEN_TRANSFER_CHECKED) {
      const mint = message.accountKeys[instruction.accountIndexes[1] ?? -1]?.toBase58() ?? "";
      out.push({ asset: assetOfMint(mint, network) === "USDC" ? "USDC" : "OTHER", raw: data.readBigUInt64LE(1) });
    }
  }
  return out;
}

function changeView(action: multisig.generated.ConfigAction, multisigPda: PublicKey, network: TreasuryNetwork): ConfigChangeView {
  switch (action.__kind) {
    case "AddMember":
      return { type: "addMember", member: { address: action.newMember.key.toBase58(), ...rolesOfMask(action.newMember.permissions.mask) } };
    case "RemoveMember":
      return { type: "removeMember", address: action.oldMember.toBase58() };
    case "ChangeThreshold":
      return { type: "threshold", threshold: action.newThreshold };
    case "SetTimeLock":
      return { type: "timeLock", seconds: action.newTimeLock };
    case "AddSpendingLimit": {
      const [limit] = multisig.getSpendingLimitPda({ multisigPda, createKey: action.createKey });
      return {
        type: "addLimit",
        limit: limit.toBase58(),
        /* A limit on another vault is not one of this vault's assets, whatever its mint. */
        asset: action.vaultIndex === 0 ? (assetOfMint(action.mint.toBase58(), network) ?? "OTHER") : "OTHER",
        amountRaw: action.amount.toString(),
        period: periodOfCode(action.period) ?? "once",
        spenders: action.members.map((member) => member.toBase58()),
        destinations: action.destinations.map((destination) => destination.toBase58()),
        mint: action.mint.toBase58(),
        vaultIndex: action.vaultIndex,
      };
    }
    case "RemoveSpendingLimit":
      return { type: "removeLimit", limit: action.spendingLimit.toBase58() };
    case "SetRentCollector":
      return { type: "rentCollector", address: action.newRentCollector?.toBase58() ?? null };
    default:
      return { type: "rentCollector", address: null };
  }
}

/** One batch line as the vault pays it: what it pays, whom, the USDC accounts it opens — or a line this page cannot show. */
export type LineRead = { sol: bigint; usdc: bigint; solLines: number; usdcLines: number; opened: PublicKey[]; recipients: string[]; foreign: boolean };

/**
 * A batch line read for what the vault does in it: SOL by transfer from the vault, USDC by `TransferChecked` from the
 * vault's account with the vault as authority, the recipients' USDC accounts opened by the vault. Anything else —
 * another token, another payer, another program — makes the line foreign: this page neither approves nor runs it.
 */
export function readLine(message: multisig.generated.VaultTransactionMessage, read: Pick<MultisigRead, "vault"> & Partial<Pick<MultisigRead, "address">>, network: TreasuryNetwork): LineRead {
  const out: LineRead = { sol: 0n, usdc: 0n, solLines: 0, usdcLines: 0, opened: [], recipients: [], foreign: false };
  const usdc = assetMint("USDC", network);
  const vaultUsdc = usdc ? getAssociatedTokenAddressSync(key(usdc), read.vault, true) : null;
  const { accountKeys } = message;
  /* Every account the line touches must be named in it: one loaded from a lookup table is an address this page never
     shows, so such a line is foreign whatever it seems to pay. */
  const outside = (index: number) => index < 0 || index >= accountKeys.length;
  if (message.addressTableLookups.length > 0 || message.instructions.some((instruction) => outside(instruction.programIdIndex) || Array.from(instruction.accountIndexes).some(outside))) {
    return { ...out, foreign: true };
  }
  const at = (instruction: (typeof message.instructions)[number], position: number) => accountKeys[instruction.accountIndexes[position] ?? -1];
  /* Whose USDC account each opened one is: the line names the recipient's wallet there. */
  const owners = new Map<string, string>();
  const paid = new Set<string>();
  for (const instruction of message.instructions) {
    const program = accountKeys[instruction.programIdIndex];
    const data = Buffer.from(instruction.data);
    if (program?.equals(SystemProgram.programId) && data.length === 12 && data.readUInt32LE(0) === SYSTEM_TRANSFER && at(instruction, 0)?.equals(read.vault)) {
      out.sol += data.readBigUInt64LE(4);
      out.solLines += 1;
      out.recipients.push(at(instruction, 1)?.toBase58() ?? "");
    } else if (program?.equals(TOKEN_PROGRAM_ID) && data.length === 10 && data[0] === TOKEN_TRANSFER_CHECKED && usdc && at(instruction, 1)?.toBase58() === usdc && vaultUsdc && at(instruction, 0)?.equals(vaultUsdc) && at(instruction, 3)?.equals(read.vault)) {
      /* Paid into an account opened just before it in this line — the recipient's own: whose it is, is then known. */
      const destination = at(instruction, 2)?.toBase58() ?? "";
      const owner = owners.get(destination);
      if (!owner) {
        out.foreign = true;
        continue;
      }
      out.usdc += data.readBigUInt64LE(1);
      out.usdcLines += 1;
      out.recipients.push(owner);
      paid.add(destination);
    } else if (
      program?.equals(ASSOCIATED_TOKEN_PROGRAM_ID) &&
      data.length === 1 &&
      data[0] === 1 &&
      at(instruction, 0)?.equals(read.vault) &&
      /* A USDC account, of the token program USDC lives in: any other is not a line this page pays. */
      usdc !== null &&
      at(instruction, 3)?.toBase58() === usdc &&
      at(instruction, 5)?.equals(TOKEN_PROGRAM_ID)
    ) {
      const account = at(instruction, 1);
      const owner = at(instruction, 2);
      /* The owner's own USDC account, nothing else: the address a payment goes to must be whose it says. */
      if (account && owner && usdc && getAssociatedTokenAddressSync(key(usdc), owner, true).equals(account)) {
        out.opened.push(account);
        owners.set(account.toBase58(), owner.toBase58());
      } else {
        out.foreign = true;
      }
    } else {
      out.foreign = true;
    }
  }
  /* Paid to the treasury's own multisig account, money no Squads instruction gives back: not a payout this page runs. */
  if (read.address && out.recipients.includes(read.address.toBase58())) out.foreign = true;
  /* An account opened with the vault's SOL and paid nothing is rent handed to someone the Review never names. */
  if (out.opened.some((account) => !paid.has(account.toBase58()))) out.foreign = true;
  return out;
}

/** How many of the latest proposals the page shows. */
export const PROPOSALS_SHOWN = 20;
/** How many batches of those have their lines read (one read each). */
const BATCHES_READ = 10;

export async function readProposals(connection: Connection, read: MultisigRead, network: TreasuryNetwork): Promise<readonly TreasuryProposal[]> {
  const top = read.transactionIndex;
  if (top <= 0n) return [];
  const indexes: bigint[] = [];
  for (let index = top; index >= 1n && indexes.length < PROPOSALS_SHOWN; index -= 1n) indexes.push(index);
  const keys = indexes.flatMap((index) => [
    multisig.getTransactionPda({ multisigPda: read.address, index })[0],
    multisig.getProposalPda({ multisigPda: read.address, transactionIndex: index })[0],
  ]);
  const infos = await connection.getMultipleAccountsInfo(keys, "confirmed");
  const timeLock = read.account.timeLock;
  const out: TreasuryProposal[] = [];
  let batchesRead = 0;
  for (let at = 0; at < indexes.length; at += 1) {
    const index = indexes[at]!;
    const transaction = infos[at * 2];
    const proposalInfo = infos[at * 2 + 1];
    /* A transaction and proposal both closed (rent reclaimed after execution) leave nothing to show. */
    if (!transaction && !proposalInfo) continue;
    const kind = transaction ? kindOf(transaction.data) : "unknown";
    let proposal: multisig.accounts.Proposal | null = null;
    if (proposalInfo) {
      try {
        [proposal] = multisig.accounts.Proposal.fromAccountInfo(proposalInfo);
      } catch {
        proposal = null;
      }
    }
    let state: TreasuryProposal["state"] = proposal ? STATE_OF[proposal.status.__kind] : "none";
    /* A proposal not yet decided at or below the stale index can no longer pass: the rules changed under it. */
    if ((state === "active" || state === "draft") && index <= read.staleTransactionIndex) state = "stale";
    /* A change of the rules approved before another one ran can no longer run either: Squads refuses it as stale. */
    if (kind === "config" && state === "approved" && index <= read.staleTransactionIndex) state = "stale";
    const stateAt = proposal ? statusTime(proposal.status) : null;
    let payouts: TreasuryProposal["payouts"] = null;
    let changes: TreasuryProposal["changes"] = null;
    let claims: TreasuryProposal["claims"] = null;
    /* What this page can show in full: its own kinds of lines and changes. A batch whose lines are beyond the read is
       shown by its count; its vote and execution read every line before anything is built. */
    let readable = kind === "batch" || kind === "config";
    if (kind === "batch" && transaction) {
      try {
        const [batch] = multisig.accounts.Batch.fromAccountInfo(transaction);
        const sums = new Map<"SOL" | "USDC" | "OTHER", bigint>();
        /* Payouts counted only from lines read; a batch beyond the read is said by its parts. */
        let count = 0;
        /* A batch of the vault's launch-fee claims (SOL-L1d): every line read is claims into the vault, and nothing else. */
        let claimCount = 0;
        let payLines = 0;
        let claimLines = 0;
        const launchesSeen = new Set<string>();
        if (batchesRead < BATCHES_READ && batch.size > 0) {
          batchesRead += 1;
          const items = Array.from({ length: batch.size }, (_, item) => multisig.getBatchTransactionPda({ multisigPda: read.address, batchIndex: index, transactionIndex: item + 1 })[0]);
          const lines = await connection.getMultipleAccountsInfo(items, "confirmed");
          for (const line of lines) {
            /* A line closed after it ran is no longer there to read; the others still are. */
            if (!line) continue;
            const [decoded] = multisig.accounts.VaultBatchTransaction.fromAccountInfo(line);
            const claimed = readClaimLine(decoded.message, read.vault);
            if (!claimed.foreign) {
              claimLines += 1;
              claimCount += claimed.claims.length;
              for (const claim of claimed.claims) launchesSeen.add(claim.launch);
              continue;
            }
            payLines += 1;
            const seen = readLine(decoded.message, read, network);
            if (seen.foreign) readable = false;
            count += seen.solLines + seen.usdcLines;
            if (seen.sol > 0n) sums.set("SOL", (sums.get("SOL") ?? 0n) + seen.sol);
            if (seen.usdc > 0n) sums.set("USDC", (sums.get("USDC") ?? 0n) + seen.usdc);
          }
        }
        /* Claims and payouts in one batch: neither kind is what it seems — it gets no «for» and no «execute» here. */
        if (claimLines > 0 && payLines > 0) readable = false;
        if (claimLines > 0 && payLines === 0) claims = { count: claimCount, launches: launchesSeen.size, done: batch.executedTransactionIndex, items: batch.size };
        payouts = {
          count,
          done: batch.executedTransactionIndex,
          items: batch.size,
          sums: [...sums].map(([asset, raw]) => ({ asset, raw: raw.toString() })),
        };
      } catch {
        payouts = null;
        readable = false;
      }
    } else if (kind === "config" && transaction) {
      try {
        const [config] = multisig.accounts.ConfigTransaction.fromAccountInfo(transaction);
        changes = config.actions.map((action) => changeView(action, read.address, network));
        /* A limit on another vault, or in a token this page does not name, is not one it can show whole. */
        if (config.actions.some((action) => action.__kind === "AddSpendingLimit" && (action.vaultIndex !== 0 || assetOfMint(action.mint.toBase58(), network) === null))) readable = false;
      } catch {
        changes = null;
        readable = false;
      }
    }
    out.push({
      index: index.toString(),
      type: kind === "batch" ? (claims ? "claims" : "payouts") : kind,
      state,
      stateAt,
      approved: proposal?.approved.map((member) => member.toBase58()) ?? [],
      rejected: proposal?.rejected.map((member) => member.toBase58()) ?? [],
      cancelled: proposal?.cancelled.map((member) => member.toBase58()) ?? [],
      executableAt: executableAt(state, state === "approved" ? stateAt : null, timeLock),
      payouts: claims ? null : payouts,
      changes,
      claims,
      readable,
    });
  }
  return out;
}

/** How far back the rules' own history is read for the limits it made, when a node will not scan. */
export const LIMIT_HISTORY_MAX = 512;
const ACCOUNTS_PER_READ = 100;

/** One spending limit as this page shows it, from its account — or null when the account is not this multisig's limit. */
function limitOf(address: PublicKey, account: AccountInfo<Buffer> | null, read: MultisigRead, network: TreasuryNetwork): TreasuryLimit | null {
  if (!account || !account.owner.equals(SQUADS_PROGRAM_ID) || !account.data.subarray(0, 8).equals(DISCRIMINATORS.limit)) return null;
  let limit: multisig.accounts.SpendingLimit;
  try {
    [limit] = multisig.accounts.SpendingLimit.fromAccountInfo(account);
  } catch {
    return null;
  }
  if (!limit.multisig.equals(read.address)) return null;
  const mint = limit.mint.toBase58();
  return {
    address: address.toBase58(),
    /* A limit on another vault spends money this page does not show: it is listed, never spent from here. */
    asset: limit.vaultIndex === 0 ? (assetOfMint(mint, network) ?? "OTHER") : "OTHER",
    mint,
    amountRaw: limit.amount.toString(),
    remainingRaw: limit.remainingAmount.toString(),
    period: periodOfCode(limit.period),
    lastReset: Number(limit.lastReset.toString()),
    vaultIndex: limit.vaultIndex,
    spenders: limit.members.map((member) => member.toBase58()),
    destinations: limit.destinations.map((destination) => destination.toBase58()),
  };
}

async function readMany(connection: Connection, keys: readonly PublicKey[]): Promise<(AccountInfo<Buffer> | null)[]> {
  const out: (AccountInfo<Buffer> | null)[] = [];
  for (let at = 0; at < keys.length; at += ACCOUNTS_PER_READ) out.push(...(await connection.getMultipleAccountsInfo(keys.slice(at, at + ACCOUNTS_PER_READ), "confirmed")));
  return out;
}

/** One spending limit by its address, checked to be this multisig's: what a spend reads, scan or no scan. */
export async function readLimit(connection: Connection, read: MultisigRead, address: string, network: TreasuryNetwork): Promise<TreasuryLimit | null> {
  const where = key(address);
  return limitOf(where, await connection.getAccountInfo(where, "confirmed"), read, network);
}

/**
 * A signed transaction's instructions, by program and account addresses, in any format: v1 through `viewOfWire`,
 * legacy and v0 through web3.js (the Squads app builds v0). An account reached through a lookup table is not resolved:
 * such a transaction is not read (null).
 */
function instructionsOfWire(wireBase64: string): readonly Readonly<{ programId: string; keys: readonly string[]; data: Buffer }>[] | null {
  try {
    const bytes = Buffer.from(wireBase64, "base64");
    if (isV1Wire(bytes)) return viewOfWire(wireBase64).instructions.map((instruction) => ({ programId: instruction.programId, keys: instruction.keys.map((account) => account.pubkey), data: instruction.data }));
    const { message } = VersionedTransaction.deserialize(bytes);
    const statics = message.staticAccountKeys.map((account) => account.toBase58());
    const out: { programId: string; keys: string[]; data: Buffer }[] = [];
    for (const instruction of message.compiledInstructions) {
      const indexes = [instruction.programIdIndex, ...instruction.accountKeyIndexes];
      if (indexes.some((index) => index >= statics.length)) return null;
      out.push({ programId: statics[instruction.programIdIndex]!, keys: instruction.accountKeyIndexes.map((index) => statics[index]!), data: Buffer.from(instruction.data) });
    }
    return out;
  } catch {
    return null;
  }
}

/** Multisigs read to have been created with no config authority: that never changes, so it is read once. */
const bornAutonomous = new Set<string>();
const SIGNATURE_PAGES = 3;
const SIGNATURES_PER_PAGE = 1000;

/**
 * Whether the multisig was created with no config authority — then it never had one: only that authority can set
 * one, and an autonomous multisig has none to do it. Read from its first transaction on chain, the creation itself.
 * Anything not read for certain — a history longer than is walked, a format not read, a failed creation — is false.
 */
async function createdWithoutAuthority(connection: Connection, address: PublicKey): Promise<boolean> {
  if (bornAutonomous.has(address.toBase58())) return true;
  let before: string | undefined;
  let oldest: string | null = null;
  let whole = false;
  for (let page = 0; page < SIGNATURE_PAGES; page += 1) {
    const signatures = await connection.getSignaturesForAddress(address, { before, limit: SIGNATURES_PER_PAGE }, "confirmed");
    if (signatures.length > 0) oldest = signatures[signatures.length - 1]!.signature;
    before = oldest ?? undefined;
    if (signatures.length < SIGNATURES_PER_PAGE) {
      whole = true;
      break;
    }
  }
  if (!whole || !oldest) return false;
  /* web3.js 1.x reads no v1 transaction: the node is asked for the raw wire, which `viewOfWire` reads in any format. */
  const answer = (await (connection as unknown as { _rpcRequest: (method: string, args: unknown[]) => Promise<{ result?: { meta?: { err: unknown } | null; transaction?: [string, string] } | null }> })._rpcRequest("getTransaction", [oldest, { encoding: "base64", commitment: "confirmed", maxSupportedTransactionVersion: 1 }])).result;
  if (!answer?.transaction || answer.meta?.err !== null) return false;
  const instructions = instructionsOfWire(answer.transaction[0]);
  if (!instructions) return false;
  const discriminator = Buffer.from(multisig.generated.multisigCreateV2InstructionDiscriminator);
  /* The creation of this multisig: the address as the instruction's own `multisig` account (programConfig, treasury,
     multisig, createKey, creator), never merely among its keys — another creation may carry it as an extra account. */
  const creation = instructions.find((instruction) => instruction.programId === SQUADS_PROGRAM_ID.toBase58() && instruction.data.subarray(0, 8).equals(discriminator) && instruction.keys[2] === address.toBase58());
  if (!creation) return false;
  const [{ args }] = multisig.generated.multisigCreateV2Struct.deserialize(creation.data);
  if (args.configAuthority !== null) return false;
  bornAutonomous.add(address.toBase58());
  return true;
}

/**
 * The multisig's spending limits. A node that scans the program's accounts answers all of them. Mainnet's nodes
 * refuse that scan, so the limits are found where they are made. Every limit of a multisig created without a config
 * authority is added by a change of its rules, and that change's account names it.
 *
 * `complete` is false when that history cannot vouch for every limit:
 * - an account where a change of the rules may have been is closed, or holds something that is not Squads';
 * - the history is longer than is read;
 * - the multisig has, or may once have had, a config authority, which adds limits without a vote.
 */
export async function readLimits(connection: Connection, read: MultisigRead, network: TreasuryNetwork): Promise<Readonly<{ rows: readonly TreasuryLimit[]; complete: boolean }>> {
  const sorted = (rows: readonly (TreasuryLimit | null)[]) => rows.filter((row): row is TreasuryLimit => row !== null).sort((a, b) => a.address.localeCompare(b.address));
  try {
    const accounts = await connection.getProgramAccounts(SQUADS_PROGRAM_ID, {
      commitment: "confirmed",
      filters: [{ memcmp: { offset: 0, bytes: b58.decode(DISCRIMINATORS.limit) } }, { memcmp: { offset: 8, bytes: read.address.toBase58() } }],
    });
    return { rows: sorted(accounts.map(({ pubkey, account }) => limitOf(pubkey, account, read, network))), complete: true };
  } catch {
    /* The node refused the scan: the rules' history names the limits. */
  }
  const top = read.transactionIndex;
  const indexes: bigint[] = [];
  for (let index = top; index >= 1n && indexes.length < LIMIT_HISTORY_MAX; index -= 1n) indexes.push(index);
  let complete = top <= BigInt(LIMIT_HISTORY_MAX) && read.account.configAuthority.equals(PublicKey.default);
  const [transactions, autonomous] = await Promise.all([
    readMany(connection, indexes.map((index) => multisig.getTransactionPda({ multisigPda: read.address, index })[0])),
    complete ? createdWithoutAuthority(connection, read.address).catch(() => false) : Promise.resolve(false),
  ]);
  if (!autonomous) complete = false;
  const named = new Map<string, PublicKey>();
  for (const transaction of transactions) {
    /* A closed account may have been a change of the rules: what it added can no longer be read from it. Anything else
       at its address — lamports sent there, another program's account — hides it the same way. */
    if (!transaction || !transaction.owner.equals(SQUADS_PROGRAM_ID) || kindOf(transaction.data) === "unknown") {
      complete = false;
      continue;
    }
    if (kindOf(transaction.data) !== "config") continue;
    try {
      const [config] = multisig.accounts.ConfigTransaction.fromAccountInfo(transaction);
      for (const action of config.actions) {
        if (action.__kind !== "AddSpendingLimit") continue;
        const [limit] = multisig.getSpendingLimitPda({ multisigPda: read.address, createKey: action.createKey });
        named.set(limit.toBase58(), limit);
      }
    } catch {
      complete = false;
    }
  }
  const keys = [...named.values()];
  const accounts = await readMany(connection, keys);
  /* A limit named and gone was removed by a later change: it is simply not listed. */
  return { rows: sorted(keys.map((address, at) => limitOf(address, accounts[at] ?? null, read, network))), complete };
}

/**
 * What an owner holds of a mint in its associated token account, read from the account's own bytes: some mainnet nodes
 * refuse `getTokenAccountBalance`, and every node serves `getAccountInfo`. No account is 0. An account that is not the
 * SPL token account it should be — another program, another mint or owner — throws: it is not read, never guessed.
 */
export async function tokenHeld(connection: Connection, owner: PublicKey, mint: PublicKey): Promise<bigint> {
  const info = await connection.getAccountInfo(getAssociatedTokenAddressSync(mint, owner, true), "confirmed");
  if (!info) return 0n;
  const data = Buffer.from(info.data);
  if (!info.owner.equals(TOKEN_PROGRAM_ID) || data.length < 72 || !data.subarray(0, 32).equals(mint.toBuffer()) || !data.subarray(32, 64).equals(owner.toBuffer())) throw new Error("not this owner's token account of this mint");
  return data.readBigUInt64LE(64);
}

export async function readBalances(connection: Connection, vault: PublicKey, network: TreasuryNetwork): Promise<TreasuryState["balances"]> {
  const usdc = assetMint("USDC", network);
  const [sol, token] = await Promise.all([
    connection.getBalance(vault, "confirmed"),
    usdc
      ? tokenHeld(connection, vault, key(usdc)).then(
          (held) => held.toString(),
          () => null,
        )
      : Promise.resolve(null),
  ]);
  return { solRaw: String(sol), usdcRaw: token };
}

export async function readTreasury(connection: Connection, address: string, network: TreasuryNetwork, now: Date, launchVault: string | null = null): Promise<TreasuryState> {
  const read = await readMultisig(connection, address);
  const [balances, proposals, limits] = await Promise.all([
    readBalances(connection, read.vault, network),
    readProposals(connection, read, network),
    readLimits(connection, read, network).then(
      ({ rows, complete }) => ({ rows, unread: false, partial: !complete }),
      () => ({ rows: [] as TreasuryLimit[], unread: true, partial: false }),
    ),
  ]);
  const authority = read.account.configAuthority;
  return {
    network: TREASURY_CHAIN[network],
    multisig: read.address.toBase58(),
    vault: read.vault.toBase58(),
    autonomous: authority.equals(PublicKey.default),
    configAuthority: authority.equals(PublicKey.default) ? null : authority.toBase58(),
    threshold: read.account.threshold,
    timeLockSeconds: read.account.timeLock,
    transactionIndex: read.transactionIndex.toString(),
    staleTransactionIndex: read.staleTransactionIndex.toString(),
    members: read.members,
    balances,
    proposals,
    limits: limits.rows,
    limitsUnread: limits.unread,
    limitsPartial: limits.partial,
    launchFeeClaimer: launchVault !== null && read.vault.toBase58() === launchVault,
    readAt: now.toISOString(),
  };
}

/* ─── Builders ────────────────────────────────────────────────────────────── */

/** A group of instructions that must land in one transaction. */
export type Group = Readonly<{
  instructions: readonly TransactionInstruction[];
  /** A transaction of its own: an execution carries its compute limit, and a transaction holds one limit at most. */
  alone?: boolean;
}>;

function permissionsOf(member: Pick<MemberDraft, "initiate" | "vote" | "execute">): multisig.types.Permissions {
  const list: multisig.types.Permission[] = [];
  if (member.initiate) list.push(multisig.types.Permission.Initiate);
  if (member.vote) list.push(multisig.types.Permission.Vote);
  if (member.execute) list.push(multisig.types.Permission.Execute);
  return Permissions.fromPermissions(list);
}

/** Squads keeps members in key order; the build does too, so the bytes do not depend on the order typed. */
function sortedMembers(members: readonly MemberDraft[]): multisig.types.Member[] {
  return [...members]
    .sort((a, b) => Buffer.compare(key(a.address).toBuffer(), key(b.address).toBuffer()))
    .map((member) => ({ key: key(member.address), permissions: permissionsOf(member) }));
}

/** Multisig account bytes for `n` members (Squads' `Multisig::size`). */
export function multisigBytes(members: number): number {
  return 8 + 32 + 32 + 2 + 4 + 8 + 8 + 1 + 32 + 1 + 4 + members * 33;
}
/** Batch account bytes (Squads' `Batch::INIT_SPACE`). */
export const BATCH_BYTES = 8 + 32 + 32 + 8 + 1 + 1 + 1 + 4 + 4;
/** Proposal account bytes for `n` members (its three vote lists sized for every member). */
export function proposalBytes(members: number): number {
  return 8 + 32 + 8 + 1 + 8 + 1 + 3 * (4 + members * 32);
}

/** Config transaction bytes for its actions (Squads' `ConfigTransaction::size`): each action as Squads stores it. */
export function configTransactionBytes(actions: readonly multisig.generated.ConfigAction[]): number {
  return 8 + 32 + 32 + 8 + 1 + 4 + actions.reduce((sum, action) => sum + multisig.generated.configActionBeet.toFixedFromValue(action).byteSize, 0);
}

/**
 * A batch line's account bytes (Squads' `VaultBatchTransaction::size`): its message is stored with four-byte lengths,
 * not the compact ones it was added with.
 */
export function batchLineBytes(messageBytes: Uint8Array): number {
  const [message] = multisig.types.transactionMessageBeet.deserialize(Buffer.from(messageBytes));
  const instructions = message.instructions.reduce((sum, instruction) => sum + 1 + 4 + instruction.accountIndexes.length + 4 + instruction.data.length, 0);
  const lookups = message.addressTableLookups.reduce((sum, lookup) => sum + 32 + 4 + lookup.writableIndexes.length + 4 + lookup.readonlyIndexes.length, 0);
  const stored = 3 + 4 + 32 * message.accountKeys.length + 4 + instructions + 4 + lookups;
  return 8 + 1 + 4 + stored;
}

/**
 * What adding a member costs whoever executes it: Squads grows a multisig with no room left ten member places at a
 * time (`Multisig::realloc_if_needed`), topping it up to the rent of its new size.
 */
export function addMemberRent(read: Pick<MultisigRead, "dataLength" | "lamports">, membersAfter: number): bigint {
  const needed = multisigBytes(membersAfter);
  if (read.dataLength >= needed) return 0n;
  const top = rentExemptLamports(Math.max(read.dataLength + 10 * 33, needed)) - read.lamports;
  return top > 0n ? top : 0n;
}

export type CreateBuilt = Readonly<{ groups: readonly Group[]; multisig: PublicKey; vault: PublicKey; rentLamports: bigint }>;

/**
 * A person's treasury: one instruction, the wallet the creator and payer, the one-time `createKey` its co-signer — a key
 * made in the person's browser, which signs after the wallet; the server only names its public half.
 */
export function buildCreate(args: Readonly<{ wallet: string; createKey: PublicKey; members: readonly MemberDraft[]; threshold: number; timeLockSeconds: number; programTreasury: PublicKey }>): CreateBuilt {
  const createKey = args.createKey;
  const [multisigPda] = multisig.getMultisigPda({ createKey });
  const [vault] = multisig.getVaultPda({ multisigPda, index: 0 });
  const instruction = multisig.instructions.multisigCreateV2({
    treasury: args.programTreasury,
    creator: key(args.wallet),
    multisigPda,
    configAuthority: null,
    threshold: args.threshold,
    members: sortedMembers(args.members),
    timeLock: args.timeLockSeconds,
    createKey,
    rentCollector: vault,
  });
  return { groups: [{ instructions: [instruction] }], multisig: multisigPda, vault, rentLamports: rentExemptLamports(multisigBytes(args.members.length)) };
}

function limitAction(args: Readonly<{ network: TreasuryNetwork; asset: TreasuryAssetId; amountRaw: bigint; period: LimitPeriod; spenders: readonly string[]; destinations: readonly string[] }>): {
  action: multisig.generated.ConfigAction;
  createKey: PublicKey;
} {
  const createKey = Keypair.generate().publicKey;
  return {
    createKey,
    action: {
      __kind: "AddSpendingLimit",
      createKey,
      vaultIndex: 0,
      mint: key(assetMint(args.asset, args.network) ?? NATIVE_MINT_KEY),
      amount: new BN(args.amountRaw.toString()),
      period: PERIOD_CODE[args.period],
      members: args.spenders.map(key),
      destinations: args.destinations.map(key),
    },
  };
}

/** Spending limit bytes for its lists (Squads' `SpendingLimit::size`). */
export function limitBytes(spenders: number, destinations: number): number {
  return 8 + 32 + 32 + 1 + 32 + 8 + 1 + 8 + 8 + 1 + 4 + spenders * 32 + 4 + destinations * 32;
}

/**
 * An agent's own multisig, in two transactions signed together: the multisig with the person alone in every role and
 * no delay yet; then one change of its rules, proposed, approved and executed at once — the agent's spending limit and
 * the short delay. From then on, revoking the limit is a vote that waits only that short delay.
 */
export function buildCreateAgent(args: Readonly<{
  network: TreasuryNetwork;
  wallet: string;
  createKey: PublicKey;
  agent: string;
  timeLockSeconds: number;
  asset: TreasuryAssetId;
  amountRaw: bigint;
  period: LimitPeriod;
  destinations: readonly string[];
  programTreasury: PublicKey;
}>): CreateBuilt & Readonly<{ limit: PublicKey }> {
  if (args.timeLockSeconds < AGENT_TIME_LOCK_S.min || args.timeLockSeconds > AGENT_TIME_LOCK_S.max) throw new TreasuryRefusal("VALIDATION_ERROR", "An agent's delay is a minute to an hour.");
  const created = buildCreate({
    wallet: args.wallet,
    createKey: args.createKey,
    members: [{ address: args.wallet, initiate: true, vote: true, execute: true }],
    threshold: 1,
    timeLockSeconds: 0,
    programTreasury: args.programTreasury,
  });
  const wallet = key(args.wallet);
  const index = 1n;
  const { action, createKey } = limitAction({ network: args.network, asset: args.asset, amountRaw: args.amountRaw, period: args.period, spenders: [args.agent], destinations: args.destinations });
  const [limit] = multisig.getSpendingLimitPda({ multisigPda: created.multisig, createKey });
  const actions: multisig.generated.ConfigAction[] = [action, { __kind: "SetTimeLock", newTimeLock: args.timeLockSeconds }];
  const rules: Group = {
    instructions: [
      multisig.instructions.configTransactionCreate({ multisigPda: created.multisig, transactionIndex: index, creator: wallet, actions }),
      multisig.instructions.proposalCreate({ multisigPda: created.multisig, creator: wallet, transactionIndex: index }),
      multisig.instructions.proposalApprove({ multisigPda: created.multisig, transactionIndex: index, member: wallet }),
      multisig.instructions.configTransactionExecute({ multisigPda: created.multisig, transactionIndex: index, member: wallet, rentPayer: wallet, spendingLimits: [limit] }),
    ],
  };
  return {
    ...created,
    groups: [...created.groups, rules],
    limit,
    /* The executed config transaction and its proposal stay open until closed; the limit is the agent's mandate. */
    rentLamports: created.rentLamports + rentExemptLamports(limitBytes(1, args.destinations.length)) + rentExemptLamports(proposalBytes(1)) + rentExemptLamports(configTransactionBytes(actions)),
  };
}

/** A change of the rules: proposed, and voted «for» in the same signature when the proposer is a voter. */
export function buildConfig(args: Readonly<{ network: TreasuryNetwork; read: MultisigRead; wallet: string; change: ConfigChange; alsoApprove: boolean }>): Readonly<{ groups: readonly Group[]; index: bigint; rentLamports: bigint }> {
  const wallet = key(args.wallet);
  const index = args.read.transactionIndex + 1n;
  const change = args.change;
  let action: multisig.generated.ConfigAction;
  switch (change.type) {
    case "addLimit": {
      action = limitAction({ network: args.network, asset: change.asset, amountRaw: BigInt(change.amountRaw), period: change.period, spenders: change.spenders, destinations: change.destinations }).action;
      break;
    }
    case "removeLimit":
      action = { __kind: "RemoveSpendingLimit", spendingLimit: key(change.limit) };
      break;
    case "addMember":
      action = { __kind: "AddMember", newMember: { key: key(change.member.address), permissions: permissionsOf(change.member) } };
      break;
    case "removeMember":
      action = { __kind: "RemoveMember", oldMember: key(change.address) };
      break;
    case "threshold":
      action = { __kind: "ChangeThreshold", newThreshold: change.threshold };
      break;
    case "timeLock":
      action = { __kind: "SetTimeLock", newTimeLock: change.seconds };
      break;
  }
  const instructions: TransactionInstruction[] = [
    multisig.instructions.configTransactionCreate({ multisigPda: args.read.address, transactionIndex: index, creator: wallet, actions: [action] }),
    multisig.instructions.proposalCreate({ multisigPda: args.read.address, creator: wallet, transactionIndex: index }),
  ];
  if (args.alsoApprove) instructions.push(multisig.instructions.proposalApprove({ multisigPda: args.read.address, transactionIndex: index, member: wallet }));
  const members = args.read.members.length;
  return { groups: [{ instructions }], index, rentLamports: rentExemptLamports(proposalBytes(members)) + rentExemptLamports(configTransactionBytes([action])) };
}

/** One batch line's instructions inside the vault: SOL by transfer; USDC with the recipient's account opened if absent. */
export function payoutInstructions(args: Readonly<{ network: TreasuryNetwork; vault: PublicKey; asset: TreasuryAssetId; payout: Payout }>): TransactionInstruction[] {
  const to = key(args.payout.to);
  const mint = assetMint(args.asset, args.network);
  if (!mint) {
    if (args.payout.amountRaw > BigInt(Number.MAX_SAFE_INTEGER)) throw new TreasuryRefusal("VALIDATION_ERROR", "An amount is too large.");
    return [SystemProgram.transfer({ fromPubkey: args.vault, toPubkey: to, lamports: args.payout.amountRaw })];
  }
  const mintKey = key(mint);
  const from = getAssociatedTokenAddressSync(mintKey, args.vault, true);
  const toAccount = getAssociatedTokenAddressSync(mintKey, to, true);
  return [
    createAssociatedTokenAccountIdempotentInstruction(args.vault, toAccount, to, mintKey, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID),
    createTransferCheckedInstruction(from, mintKey, toAccount, args.vault, args.payout.amountRaw, TREASURY_ASSETS[args.asset].decimals),
  ];
}

/** One legacy transaction's instructions: its loaded-data limit first, then the groups' own, in order. */
export function legacyInstructions(groups: readonly Group[]): TransactionInstruction[] {
  return [setLoadedAccountsDataSizeLimit(LOADED_ACCOUNTS_LIMIT), ...groups.flatMap((group) => group.instructions)];
}

/**
 * One v1 transaction's instructions and compute limit: on v1 the budget lives in the message's config, so a group's
 * Compute Budget instruction becomes the limit it set — an execution's — and the rest get what legacy bytes get
 * without one, 200,000 units an instruction up to the runtime's ceiling.
 */
export function v1Parts(groups: readonly Group[]): Readonly<{ instructions: readonly TransactionInstruction[]; computeUnitLimit: number }> {
  const all = groups.flatMap((group) => group.instructions);
  const instructions = all.filter((instruction) => !instruction.programId.equals(ComputeBudgetProgram.programId));
  const set = all.find((instruction) => instruction.programId.equals(ComputeBudgetProgram.programId) && instruction.data[0] === 2 && instruction.data.length === 5);
  return { instructions, computeUnitLimit: set ? Buffer.from(set.data).readUInt32LE(1) : Math.min(MAX_UNITS, UNITS_PER_INSTRUCTION * instructions.length) };
}

/** The size of a legacy transaction carrying these groups for this fee payer, with every signature slot counted. */
export function sizeOf(groups: readonly Group[], feePayer: PublicKey): number {
  const tx = new Transaction({ feePayer, blockhash: PublicKey.default.toBase58(), lastValidBlockHeight: 0 });
  tx.add(...legacyInstructions(groups));
  try {
    return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/**
 * Consecutive groups packed into as few transactions as fit under the cap, in order. A group that does not fit alone
 * is refused: nothing is built that the network would drop for its size.
 */
export function pack(groups: readonly Group[], feePayer: PublicKey, cap = TX_BYTES_CAP): readonly Group[][] {
  const out: Group[][] = [];
  let current: Group[] = [];
  for (const group of groups) {
    if (sizeOf([group], feePayer) > cap) throw new TreasuryRefusal("TREASURY_TOO_LARGE", "One step does not fit in a transaction.");
    if (current.length > 0 && (group.alone || current.some((held) => held.alone) || sizeOf([...current, group], feePayer) > cap)) {
      out.push(current);
      current = [];
    }
    current.push(group);
  }
  if (current.length > 0) out.push(current);
  return out;
}

export type PayoutsBuilt = Readonly<{ groups: readonly Group[]; index: bigint; items: number; rentLamports: bigint }>;

/**
 * Payouts as one proposal: the batch and its proposal (a draft while lines are added), the lines — as many per batch
 * transaction as fit — and the proposal opened for votes, with the proposer's own vote when they are a voter. Every
 * transaction is signed in one prompt and sent in order.
 */
export function buildPayouts(args: Readonly<{ network: TreasuryNetwork; read: MultisigRead; wallet: string; asset: TreasuryAssetId; payouts: readonly Payout[]; alsoApprove: boolean }>): PayoutsBuilt {
  const wallet = key(args.wallet);
  const multisigPda = args.read.address;
  const batchIndex = args.read.transactionIndex + 1n;
  const vault = args.read.vault;
  /* Lines into batch transactions: as many payouts per item as fit in the transaction that adds it. */
  const items: Payout[][] = [];
  let current: Payout[] = [];
  const addGroup = (lines: readonly Payout[], itemIndex: number): Group => {
    const message = new TransactionMessage({
      payerKey: vault,
      recentBlockhash: PublicKey.default.toBase58(),
      instructions: lines.flatMap((payout) => payoutInstructions({ network: args.network, vault, asset: args.asset, payout })),
    });
    return {
      instructions: [
        multisig.instructions.batchAddTransaction({ vaultIndex: 0, multisigPda, member: wallet, batchIndex, transactionIndex: itemIndex, ephemeralSigners: 0, transactionMessage: message }),
      ],
    };
  };
  for (const payout of args.payouts) {
    const candidate = [...current, payout];
    if (current.length > 0 && (candidate.length > MAX_LINES_PER_ITEM[args.asset] || sizeOf([addGroup(candidate, items.length + 1)], wallet) > TX_BYTES_CAP)) {
      items.push(current);
      current = [payout];
    } else {
      current = candidate;
    }
  }
  if (current.length > 0) items.push(current);
  const groups: Group[] = [
    {
      instructions: [
        multisig.instructions.batchCreate({ multisigPda, creator: wallet, batchIndex, vaultIndex: 0 }),
        multisig.instructions.proposalCreate({ multisigPda, creator: wallet, transactionIndex: batchIndex, isDraft: true }),
      ],
    },
    ...items.map((lines, at) => addGroup(lines, at + 1)),
    {
      instructions: [
        multisig.instructions.proposalActivate({ multisigPda, transactionIndex: batchIndex, member: wallet }),
        ...(args.alsoApprove ? [multisig.instructions.proposalApprove({ multisigPda, transactionIndex: batchIndex, member: wallet })] : []),
      ],
    },
  ];
  /* Rent the wallet puts down: the batch, its proposal, and each line-transaction holding its message. */
  const lineRent = items.reduce((sum, lines) => {
    const message = new TransactionMessage({
      payerKey: vault,
      recentBlockhash: PublicKey.default.toBase58(),
      instructions: lines.flatMap((payout) => payoutInstructions({ network: args.network, vault, asset: args.asset, payout })),
    });
    return sum + rentExemptLamports(batchLineBytes(multisig.utils.transactionMessageToMultisigTransactionMessageBytes({ message, vaultPda: vault })));
  }, 0n);
  return {
    groups,
    index: batchIndex,
    items: items.length,
    rentLamports: rentExemptLamports(proposalBytes(args.read.members.length)) + rentExemptLamports(BATCH_BYTES) + lineRent,
  };
}

/** A vote: «for», «against», or cancelling an approved proposal while its delay runs. */
export function buildVote(args: Readonly<{ read: MultisigRead; wallet: string; index: bigint; vote: "approve" | "reject" | "cancel" }>): readonly Group[] {
  const params = { multisigPda: args.read.address, transactionIndex: args.index, member: key(args.wallet) };
  const instruction =
    args.vote === "approve"
      ? multisig.instructions.proposalApprove(params)
      : args.vote === "reject"
        ? multisig.instructions.proposalReject(params)
        : multisig.instructions.proposalCancelV2(params);
  return [{ instructions: [instruction] }];
}

/** `firstItem` — a batch's: the item its first group runs, read in the same read the groups were built from. */
export type ExecuteBuilt = Readonly<{ groups: readonly Group[]; type: TreasuryProposal["type"]; firstItem?: number }>;

/**
 * Running an approved proposal after its delay: a change of the rules in one transaction (with the limits it adds or
 * removes named), a batch one line-transaction at a time from where it stopped, or a vault transaction made elsewhere.
 * A transaction that needs lookup tables is refused here: this page builds legacy transactions only.
 */
export async function buildExecute(connection: Connection, args: Readonly<{ read: MultisigRead; wallet: string; index: bigint }>): Promise<ExecuteBuilt> {
  const wallet = key(args.wallet);
  const multisigPda = args.read.address;
  const [transactionPda] = multisig.getTransactionPda({ multisigPda, index: args.index });
  const info = await connection.getAccountInfo(transactionPda, "confirmed");
  if (!info) throw new TreasuryRefusal("TREASURY_PROPOSAL_NOT_FOUND", "No transaction under this number.");
  const kind = kindOf(info.data);
  if (kind === "config") {
    const [config] = multisig.accounts.ConfigTransaction.fromAccountInfo(info);
    const spendingLimits = config.actions.flatMap((action) => {
      if (action.__kind === "AddSpendingLimit") return [multisig.getSpendingLimitPda({ multisigPda, createKey: action.createKey })[0]];
      if (action.__kind === "RemoveSpendingLimit") return [action.spendingLimit];
      return [];
    });
    return {
      type: "config",
      groups: [{ instructions: [multisig.instructions.configTransactionExecute({ multisigPda, transactionIndex: args.index, member: wallet, rentPayer: wallet, spendingLimits })] }],
    };
  }
  if (kind === "batch") {
    const [batch] = multisig.accounts.Batch.fromAccountInfo(info);
    const groups: Group[] = [];
    for (let item = batch.executedTransactionIndex + 1; item <= batch.size; item += 1) {
      const built = await multisig.instructions.batchExecuteTransaction({ connection, multisigPda, member: wallet, batchIndex: args.index, transactionIndex: item });
      if (built.lookupTableAccounts.length > 0) throw new TreasuryRefusal("TREASURY_NEEDS_LOOKUP_TABLES", "This batch uses lookup tables; run it in Squads' own app.");
      groups.push({ instructions: [computeLimit(), built.instruction], alone: true });
    }
    if (groups.length === 0) throw new TreasuryRefusal("TREASURY_NOTHING_TO_EXECUTE", "Every line of this batch has run.");
    return { type: "payouts", groups, firstItem: batch.executedTransactionIndex + 1 };
  }
  if (kind === "vault") {
    const built = await multisig.instructions.vaultTransactionExecute({ connection, multisigPda, transactionIndex: args.index, member: wallet });
    if (built.lookupTableAccounts.length > 0) throw new TreasuryRefusal("TREASURY_NEEDS_LOOKUP_TABLES", "This transaction uses lookup tables; run it in Squads' own app.");
    return { type: "vault", groups: [{ instructions: [computeLimit(), built.instruction], alone: true }] };
  }
  throw new TreasuryRefusal("TREASURY_PROPOSAL_NOT_FOUND", "No transaction this page can run under this number.");
}

export type BatchRemaining = Readonly<{
  /** Line-transactions still to run. */
  items: number;
  /** What they pay, each asset with its own count of payouts. */
  sums: readonly Readonly<{ asset: "SOL" | "USDC"; raw: bigint; lines: number }>[];
  /** Whom: the recipients' wallets (a USDC line names its account; the account opened beside it names the wallet). */
  recipients: readonly string[];
  /** Recipients' USDC accounts the vault still opens, out of its SOL. */
  newTokenAccounts: number;
  /** A line this page cannot read as the vault paying SOL or USDC: what it does is not shown here, so it is neither approved nor run here. */
  foreign: boolean;
  /** SOL each remaining line-transaction takes from the vault, in order: its transfers and the accounts it opens. */
  itemSol: readonly bigint[];
}>;

/**
 * What a batch still pays when it runs: every line not yet executed, read whatever the page's own list read — a Review
 * that says what leaves the vault must know it, not take it from the latest proposals' summary.
 */
export async function batchRemaining(connection: Connection, read: MultisigRead, index: bigint, network: TreasuryNetwork): Promise<BatchRemaining> {
  const [batchPda] = multisig.getTransactionPda({ multisigPda: read.address, index });
  const info = await connection.getAccountInfo(batchPda, "confirmed");
  if (!info || kindOf(info.data) !== "batch") throw new TreasuryRefusal("TREASURY_PROPOSAL_NOT_FOUND", "No batch under this number.");
  const [batch] = multisig.accounts.Batch.fromAccountInfo(info);
  const items: PublicKey[] = [];
  for (let item = batch.executedTransactionIndex + 1; item <= batch.size; item += 1) items.push(multisig.getBatchTransactionPda({ multisigPda: read.address, batchIndex: index, transactionIndex: item })[0]);
  const lines = items.length ? await connection.getMultipleAccountsInfo(items, "confirmed") : [];
  const total: LineRead = { sol: 0n, usdc: 0n, solLines: 0, usdcLines: 0, opened: [], recipients: [], foreign: false };
  const perItem: { sol: bigint; opened: PublicKey[] }[] = [];
  for (const line of lines) {
    if (!line) {
      total.foreign = true;
      continue;
    }
    const [decoded] = multisig.accounts.VaultBatchTransaction.fromAccountInfo(line);
    const seen = readLine(decoded.message, read, network);
    perItem.push({ sol: seen.sol, opened: seen.opened });
    total.sol += seen.sol;
    total.usdc += seen.usdc;
    total.solLines += seen.solLines;
    total.usdcLines += seen.usdcLines;
    total.opened.push(...seen.opened);
    total.recipients.push(...seen.recipients);
    total.foreign ||= seen.foreign;
  }
  const existing = total.opened.length ? await connection.getMultipleAccountsInfo(total.opened, "confirmed") : [];
  const fresh = new Set(total.opened.filter((_, at) => existing[at] === null).map((account) => account.toBase58()));
  const itemSol = perItem.map((item) => item.sol + BigInt(item.opened.filter((account) => fresh.has(account.toBase58())).length) * tokenAccountRent());
  return {
    itemSol,
    items: items.length,
    sums: [...(total.solLines ? [{ asset: "SOL" as const, raw: total.sol, lines: total.solLines }] : []), ...(total.usdcLines ? [{ asset: "USDC" as const, raw: total.usdc, lines: total.usdcLines }] : [])],
    recipients: total.recipients,
    newTokenAccounts: existing.filter((account) => account === null).length,
    foreign: total.foreign,
  };
}

/** What a batch of claims still takes when it runs: every line not yet executed, each read as claims into the vault. */
export type ClaimsRemaining = Readonly<{
  items: number;
  claims: readonly Readonly<{ source: "curve" | "migration" | "surplus" | "lp"; pool: string; launch: string }>[];
  /** The claims of each remaining line, in order (the first runs next). */
  perLine: readonly (readonly Readonly<{ source: "curve" | "migration" | "surplus" | "lp"; pool: string; launch: string }>[])[];
  /** A line that is not claims into the vault: nothing of this batch is approved or run here. */
  foreign: boolean;
}>;

export async function claimsRemaining(connection: Connection, read: MultisigRead, index: bigint): Promise<ClaimsRemaining> {
  const [batchPda] = multisig.getTransactionPda({ multisigPda: read.address, index });
  const info = await connection.getAccountInfo(batchPda, "confirmed");
  if (!info || kindOf(info.data) !== "batch") throw new TreasuryRefusal("TREASURY_PROPOSAL_NOT_FOUND", "No batch under this number.");
  const [batch] = multisig.accounts.Batch.fromAccountInfo(info);
  const items: PublicKey[] = [];
  for (let item = batch.executedTransactionIndex + 1; item <= batch.size; item += 1) items.push(multisig.getBatchTransactionPda({ multisigPda: read.address, batchIndex: index, transactionIndex: item })[0]);
  const lines = items.length ? await connection.getMultipleAccountsInfo(items, "confirmed") : [];
  const perLine: { source: "curve" | "migration" | "surplus" | "lp"; pool: string; launch: string }[][] = [];
  let foreign = false;
  for (const line of lines) {
    if (!line) {
      foreign = true;
      continue;
    }
    const [decoded] = multisig.accounts.VaultBatchTransaction.fromAccountInfo(line);
    const seen = readClaimLine(decoded.message, read.vault);
    foreign ||= seen.foreign;
    perLine.push(seen.claims.map((claim) => ({ source: claim.source, pool: claim.pool, launch: claim.launch })));
  }
  return { items: items.length, claims: perLine.flat(), perLine, foreign };
}

/** The most lines one claims proposal holds, and the most of them one execution runs. */
export const MAX_CLAIM_LINES = 10;
export const CLAIM_LINES_PER_EXECUTION = 4;

/** One claim of the plan, for the build: the launch it belongs to and its instructions for the vault to sign. */
export type ClaimPart = Readonly<{ token: string; instructions: readonly TransactionInstruction[] }>;

export type ClaimsBuilt = Readonly<{
  groups: readonly Group[];
  index: bigint;
  /** Each line in order (item 1 first): the parts it carries, by their place in `parts`. */
  lines: readonly (readonly number[])[];
  rentLamports: bigint;
}>;

/**
 * The vault's launch-fee claims as one proposal: the vault's missing token accounts opened by the proposer (out of the
 * proposer's SOL, so the vault's pays for nothing), the batch and its draft proposal, the claim lines — a launch's
 * claims together in one line while they fit one transaction —, then the proposal opened for votes, with the proposer's
 * own vote when they vote. The batch's lines run one by one; each line is a claim the program checks on its own.
 */
export function buildLaunchClaims(args: Readonly<{
  read: MultisigRead;
  wallet: string;
  parts: readonly ClaimPart[];
  opens: readonly Readonly<{ account: string; mint: string; program: string }>[];
  alsoApprove: boolean;
}>): ClaimsBuilt {
  const wallet = key(args.wallet);
  const multisigPda = args.read.address;
  const batchIndex = args.read.transactionIndex + 1n;
  const vault = args.read.vault;
  const messageOf = (indexes: readonly number[]) =>
    new TransactionMessage({ payerKey: vault, recentBlockhash: PublicKey.default.toBase58(), instructions: indexes.flatMap((at) => [...args.parts[at]!.instructions]) });
  const addGroup = (indexes: readonly number[], item: number): Group => ({
    instructions: [multisig.instructions.batchAddTransaction({ vaultIndex: 0, multisigPda, member: wallet, batchIndex, transactionIndex: item, ephemeralSigners: 0, transactionMessage: messageOf(indexes) })],
  });
  const lines: number[][] = [];
  let current: number[] = [];
  args.parts.forEach((part, at) => {
    const candidate = [...current, at];
    const sameLaunch = current.length > 0 && args.parts[current[0]!]!.token === part.token;
    if (current.length > 0 && (!sameLaunch || sizeOf([addGroup(candidate, lines.length + 1)], wallet) > TX_BYTES_CAP)) {
      lines.push(current);
      current = [at];
    } else current = candidate;
  });
  if (current.length > 0) lines.push(current);
  if (lines.length === 0) throw new TreasuryRefusal("TREASURY_NOTHING_TO_CLAIM", "No launch fee waits for this vault now.");
  /* Every transaction of a proposal is signed in one prompt and sent inside one route's minute: a plan carries a few
     launches (`LAUNCHES_PER_PROPOSAL`), and a batch longer than this is never built. */
  if (lines.length > MAX_CLAIM_LINES) throw new TreasuryRefusal("TREASURY_TOO_LARGE", "Too many claims for one proposal.");
  const opens: Group[] = args.opens.map((open) => ({
    instructions: [createAssociatedTokenAccountIdempotentInstruction(wallet, key(open.account), vault, key(open.mint), key(open.program))],
  }));
  const groups: Group[] = [
    ...opens,
    {
      instructions: [
        multisig.instructions.batchCreate({ multisigPda, creator: wallet, batchIndex, vaultIndex: 0 }),
        multisig.instructions.proposalCreate({ multisigPda, creator: wallet, transactionIndex: batchIndex, isDraft: true }),
      ],
    },
    ...lines.map((indexes, at) => addGroup(indexes, at + 1)),
    {
      instructions: [
        multisig.instructions.proposalActivate({ multisigPda, transactionIndex: batchIndex, member: wallet }),
        ...(args.alsoApprove ? [multisig.instructions.proposalApprove({ multisigPda, transactionIndex: batchIndex, member: wallet })] : []),
      ],
    },
  ];
  /* Rent the wallet puts down: the vault's new token accounts, the batch, its proposal, and each line holding its message. */
  /* A Token-2022 account carries its owner's lock and, for a mint with a transfer fee, its withheld amount: 182 at most. */
  const openRent = args.opens.reduce((sum, open) => sum + rentExemptLamports(open.program === TOKEN_PROGRAM_ID.toBase58() ? 165 : 182), 0n);
  const lineRent = lines.reduce((sum, indexes) => sum + rentExemptLamports(batchLineBytes(multisig.utils.transactionMessageToMultisigTransactionMessageBytes({ message: messageOf(indexes), vaultPda: vault }))), 0n);
  return { groups, index: batchIndex, lines, rentLamports: openRent + rentExemptLamports(proposalBytes(args.read.members.length)) + rentExemptLamports(BATCH_BYTES) + lineRent };
}

/* ─── Refusals ────────────────────────────────────────────────────────────── */

/** Squads' instructions that pay from the vault; anything else in these transactions spends the wallet's money. */
const VAULT_PAID = [
  multisig.generated.batchExecuteTransactionInstructionDiscriminator,
  multisig.generated.vaultTransactionExecuteInstructionDiscriminator,
  multisig.generated.spendingLimitUseInstructionDiscriminator,
].map((discriminator) => Buffer.from(discriminator));

/** Which instruction the network refused, from its message (`Error processing Instruction 1`) or its error (`[1,…]`). */
export function failedInstructionIndex(text: string): number | null {
  const found = /Error processing Instruction (\d+)/i.exec(text) ?? /"InstructionError":\s*\[\s*(\d+)/.exec(text);
  return found ? Number(found[1]) : null;
}

/**
 * Whose money ran short at the refused instruction of the signed transaction: Squads' executions and spending-limit
 * use pay from the vault; a create, a proposal, a vote, a change's execution (its rent payer is the wallet), a USDC
 * account opened for a recipient and a top-up are the wallet's. Null — the instruction is not known.
 */
export function payerOf(tx: Transaction, index: number | null): "wallet" | "vault" | null {
  if (index === null) return null;
  const instruction = tx.instructions[index];
  if (!instruction) return null;
  if (instruction.programId.equals(SQUADS_PROGRAM_ID) && VAULT_PAID.some((discriminator) => Buffer.from(instruction.data.subarray(0, 8)).equals(discriminator))) return "vault";
  return "wallet";
}

const squadsName = (code: number) => (code >= 6000 ? (multisig.generated.errorFromCode(code)?.name ?? null) : null);

/**
 * Squads' own name for a refusal, only when Squads itself refused: in the logs, the program running when an error is
 * thrown, or the first to fail; without logs, a `{"Custom":N}` of an instruction that is Squads'. Another program's
 * number — the System's or the Token program's small ones, a wallet guard's 6000s — is never read as Squads'.
 */
export function squadsErrorName(text: string, tx: Transaction | null = null, index: number | null = null): string | null {
  const squads = SQUADS_PROGRAM_ID.toBase58();
  const stack: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().replace(/^"|",?$/g, "");
    const invoked = /^Program (\w+) invoke \[\d+\]/.exec(line);
    if (invoked) {
      stack.push(invoked[1]!);
      continue;
    }
    const thrown = /Error Code: (\w+)/.exec(line);
    if (thrown) return stack.at(-1) === squads ? thrown[1]! : null;
    const failed = /^Program (\w+) failed: custom program error: 0x([0-9a-f]+)/i.exec(line);
    if (failed) return failed[1] === squads ? squadsName(Number.parseInt(failed[2]!, 16)) : null;
    if (/^Program \w+ (success|failed)/.test(line)) stack.pop();
  }
  const custom = /"Custom":\s*(\d+)/.exec(text)?.[1];
  if (custom !== undefined && tx && index !== null && tx.instructions[index]?.programId.equals(SQUADS_PROGRAM_ID)) return squadsName(Number(custom));
  return null;
}

const PERIOD_SECONDS: Readonly<Record<LimitPeriod, number | null>> = { once: null, day: 86_400, week: 604_800, month: 2_592_000 };

/**
 * What a spending limit still allows now: its remainder, or its whole amount once its period has turned (Squads
 * resets it at the first use after the period ends).
 */
export function limitAvailable(limit: Pick<TreasuryLimit, "amountRaw" | "remainingRaw" | "period" | "lastReset">, nowSeconds: number): bigint {
  const seconds = limit.period ? PERIOD_SECONDS[limit.period] : null;
  if (seconds !== null && nowSeconds >= limit.lastReset + seconds) return BigInt(limit.amountRaw);
  return BigInt(limit.remainingRaw);
}

/** Spending from a limit — no vote: the limit itself is the mandate. A USDC recipient's account is opened when absent. */
export function buildSpend(args: Readonly<{ network: TreasuryNetwork; read: MultisigRead; wallet: string; limit: TreasuryLimit; amountRaw: bigint; to: string }>): readonly Group[] {
  const asset = args.limit.asset;
  if (asset === "OTHER") throw new TreasuryRefusal("TREASURY_LIMIT_ASSET", "This limit's token is not one this page pays in.");
  if (args.amountRaw > BigInt(Number.MAX_SAFE_INTEGER)) throw new TreasuryRefusal("VALIDATION_ERROR", "The amount is too large.");
  const wallet = key(args.wallet);
  const to = key(args.to);
  const mint = assetMint(asset, args.network);
  const instructions: TransactionInstruction[] = [];
  if (mint) {
    const mintKey = key(mint);
    instructions.push(createAssociatedTokenAccountIdempotentInstruction(wallet, getAssociatedTokenAddressSync(mintKey, to, true), to, mintKey, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID));
  }
  instructions.push(
    multisig.instructions.spendingLimitUse({
      multisigPda: args.read.address,
      member: wallet,
      spendingLimit: key(args.limit.address),
      ...(mint ? { mint: key(mint) } : {}),
      vaultIndex: 0,
      amount: Number(args.amountRaw),
      decimals: TREASURY_ASSETS[asset].decimals,
      destination: to,
    }),
  );
  return [{ instructions }];
}

/**
 * A top-up of the vault from the wallet: SOL by the System program's transfer; USDC by `TransferChecked` from the
 * wallet's own account, the vault's account opened first when it has none (the wallet pays its rent).
 */
export function buildDeposit(args: Readonly<{ network: TreasuryNetwork; vault: PublicKey; wallet: string; asset: TreasuryAssetId; amountRaw: bigint }>): readonly Group[] {
  const wallet = key(args.wallet);
  const mint = assetMint(args.asset, args.network);
  if (!mint) {
    if (args.amountRaw > BigInt(Number.MAX_SAFE_INTEGER)) throw new TreasuryRefusal("VALIDATION_ERROR", "The amount is too large.");
    return [{ instructions: [SystemProgram.transfer({ fromPubkey: wallet, toPubkey: args.vault, lamports: args.amountRaw })] }];
  }
  const mintKey = key(mint);
  const vaultAccount = getAssociatedTokenAddressSync(mintKey, args.vault, true);
  return [
    {
      instructions: [
        createAssociatedTokenAccountIdempotentInstruction(wallet, vaultAccount, args.vault, mintKey, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID),
        createTransferCheckedInstruction(getAssociatedTokenAddressSync(mintKey, wallet, true), mintKey, vaultAccount, wallet, args.amountRaw, TREASURY_ASSETS[args.asset].decimals),
      ],
    },
  ];
}

/** Role bits the wallet holds on this multisig, or zero. */
export function roleBits(read: MultisigRead, wallet: string): number {
  const member = memberRoles(read, wallet);
  if (!member) return 0;
  return (member.initiate ? ROLE_BITS.initiate : 0) | (member.vote ? ROLE_BITS.vote : 0) | (member.execute ? ROLE_BITS.execute : 0);
}
