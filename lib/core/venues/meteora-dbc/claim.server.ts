/**
 * The creator's «Забрати» — what the creator's side of a launch earned, read
 * from the chain, and the transactions that take it.
 *
 * - `readCreatorFees` — the programs' own counters for the creator's role:
 *   the curve's trading fee and its unclaimed creator part, the graduation
 *   fee's flag, the creator role's position in the graduated pool, and when
 *   «Спільнота» shares the fees the vault holding the role.
 * - `buildCreatorClaim` — one transaction for the wallet to sign that takes
 *   every source holding a fee now: straight to the creator's wallet, or —
 *   shared — into the vault and the wallet's own share out of it. Built for
 *   the wallet as the only signer and fee payer; nothing here signs.
 * - `observeCreatorClaim` — the claim's receipt: what each program said it
 *   paid in its own events, and what the wallet's account of the pair
 *   currency received, from the chain's record of the transaction.
 *
 * Server-only.
 */

import { CpAmm, getUnClaimLpFee } from "@meteora-ag/cp-amm-sdk";
import { DynamicFeeSharingClient } from "@meteora-ag/dynamic-fee-sharing-sdk";
import { DAMM_V2_MIGRATION_FEE_ADDRESS, DynamicBondingCurveClient, deriveDammV2PoolAddress } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { getBase58Encoder } from "@solana/kit";
import { PublicKey, Transaction, VersionedTransaction, type Connection, type TransactionInstruction } from "@solana/web3.js";

import type { Address, UnsignedTx } from "../../contracts.ts";
import { creatorEarnings, type CreatorEarnings, type CreatorFeesRead, type FeeSource } from "../../launch/creator-earnings.ts";
import { FEE_SHARING_PROGRAM, feeSharingClaimInstructions, feeSharingVaultOf, observeFeeSharing, type FeeSharingObservation } from "./fee-sharing.server.ts";
import { createMeteoraDbcLaunchVenue, type PresetConfigs } from "./launch.server.ts";

const DBC_PROGRAM = "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN";
const DAMM_V2_PROGRAM = "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG";
/** Anchor's tag on a self-invoked event instruction. */
const EVENT_IX_TAG = Buffer.from("e445a52e51cb9a1d", "hex");
/** The program's mask of the creator's withdrawal in `migration_fee_withdraw_status` (DBC `CREATOR_MIGRATION_FEE_MASK`). */
export const CREATOR_MIGRATION_FEE_MASK = 0b010;
/** The most bytes one transaction may carry on Solana, less room for the compute-budget instructions a wallet may add. */
const PACKET_BYTES = 1232 - 112;

/** The chain's read of one launch's creator side. */
export type CreatorFeesObservation = Readonly<{
  token: Address;
  pool: Address;
  config: Address;
  pairMint: Address;
  /** Who holds the curve's creator role: the creator's wallet, or the vault sharing its fees. */
  roleOwner: Address;
  migrated: boolean;
  /** The curve's reserve of the pair currency now — its way to the threshold. */
  reserveRaw: string;
  /** When the curve was filled (`finish_curve_timestamp`, unix seconds); null while it is not. */
  graduatedAt: number | null;
  /** The graduated pool and the creator role's position in it, when there is one. */
  graduated: Readonly<{ pool: Address; position: Address | null; positionNftAccount: Address | null }> | null;
  sharing: FeeSharingObservation | null;
  read: CreatorFeesRead;
}>;

const str = (value: { toString(): string } | number | bigint) => value.toString();

export async function readCreatorFees(connection: Connection, args: Readonly<{ token: Address; pool: Address }>): Promise<CreatorFeesObservation> {
  const client = new DynamicBondingCurveClient(connection, "confirmed");
  const virtual = await client.state.getPool(new PublicKey(args.pool));
  if (!virtual) throw new Error(`No curve at ${args.pool}.`);
  const state = virtual.poolState;
  const config = await client.state.getPoolConfig(state.config);
  if (!config) throw new Error(`No config at ${state.config.toBase58()}.`);
  const roleOwner = state.creator.toBase58();
  const pairMint = config.quoteMint.toBase58();
  /* A Ryntra launch's shared fees sit in the vault found from its own mint: any other creator is a wallet. */
  const isVault = roleOwner === feeSharingVaultOf(args.token, pairMint);
  const sharing = isVault ? await observeFeeSharing(connection, roleOwner) : null;
  /* The role is this launch's vault, so its account exists: not found here is a read gone wrong, said as unread. */
  if (isVault && !sharing) throw new Error("The vault sharing the creator's fees could not be read.");
  const migrated = state.isMigrated === 1;
  let graduated: CreatorFeesObservation["graduated"] = null;
  let lp: CreatorFeesRead["lp"] = null;
  if (migrated) {
    const dammConfig = DAMM_V2_MIGRATION_FEE_ADDRESS[config.migrationFeeOption];
    if (dammConfig) {
      const cpAmm = new CpAmm(connection);
      const dammPool = deriveDammV2PoolAddress(dammConfig, new PublicKey(args.token), config.quoteMint);
      const poolState = await cpAmm.fetchPoolState(dammPool);
      const found = (await cpAmm.getUserPositionByPool(dammPool, state.creator))[0] ?? null;
      graduated = { pool: dammPool.toBase58(), position: found?.position.toBase58() ?? null, positionNftAccount: found?.positionNftAccount.toBase58() ?? null };
      if (found) {
        /* The pair currency is the pool's B side when the token is A: a preset's pool collects its fee in the pair alone. */
        const pairIsB = poolState.tokenBMint.equals(config.quoteMint);
        const unclaimed = getUnClaimLpFee(poolState, found.positionState);
        const metrics = found.positionState.metrics;
        lp = {
          claimedRaw: str(pairIsB ? metrics.totalClaimedBFee : metrics.totalClaimedAFee),
          unclaimedRaw: str(pairIsB ? unclaimed.feeTokenB : unclaimed.feeTokenA),
        };
      }
    }
  }
  return {
    token: args.token,
    pool: args.pool,
    config: state.config.toBase58(),
    pairMint,
    roleOwner,
    migrated,
    reserveRaw: str(state.quoteReserve),
    graduatedAt: Number(str(state.finishCurveTimestamp)) > 0 ? Number(str(state.finishCurveTimestamp)) : null,
    graduated,
    sharing,
    read: {
      roleOwner,
      curve: { totalTradingRaw: str(state.metrics.totalTradingQuoteFee), creatorPct: config.creatorTradingFeePercentage, unclaimedRaw: str(state.creatorQuoteFee) },
      graduation: {
        migrated,
        thresholdRaw: str(config.migrationQuoteThreshold),
        feePct: config.migrationFeePercentage,
        creatorPct: config.creatorMigrationFeePercentage,
        withdrawn: (state.migrationFeeWithdrawStatus & CREATOR_MIGRATION_FEE_MASK) !== 0,
      },
      lp,
      sharing: sharing ? { vault: sharing.vault, totalShare: sharing.totalShare, fundedRaw: sharing.fundedRaw, feePerShare: sharing.feePerShare, users: sharing.users } : null,
    },
  };
}

/** Whether a wallet may take from this launch: the creator holding the role, or one of the vault's wallets. */
export function mayClaim(observation: CreatorFeesObservation, wallet: Address): boolean {
  return observation.sharing ? observation.sharing.users.some((user) => user.address === wallet) : observation.roleOwner === wallet;
}

export function earningsOf(observation: CreatorFeesObservation, wallet: Address): CreatorEarnings {
  return creatorEarnings(observation.read, wallet);
}

export type CreatorClaimBuild = Readonly<{
  txs: readonly (UnsignedTx & Readonly<{ sources: readonly FeeSource[] }>)[];
  sources: readonly FeeSource[];
  /** The wallet's SOL the network simulated the claim taking (fees, and the rent of any account it opens); null when it could not be simulated. */
  costLamports: string | null;
}>;

export class ClaimRefusal extends Error {
  readonly code: "NOT_YOURS" | "NOTHING_TO_CLAIM";
  constructor(code: ClaimRefusal["code"], message: string) {
    super(message);
    this.name = "ClaimRefusal";
    this.code = code;
  }
}

/**
 * The wallet's claim: every source holding a fee now. Straight to the creator
 * in as few transactions as fit (one, unless a pool's accounts make it too
 * long), or — shared — one transaction that funds the vault from each source
 * and pays the wallet its share.
 */
export async function buildCreatorClaim(connection: Connection, args: Readonly<{ observation: CreatorFeesObservation; wallet: Address; configs: PresetConfigs }>): Promise<CreatorClaimBuild> {
  const { observation, wallet } = args;
  if (!mayClaim(observation, wallet)) throw new ClaimRefusal("NOT_YOURS", "This wallet takes no part of this launch's creator fees.");
  const earnings = earningsOf(observation, wallet);
  const holding = (source: FeeSource) => BigInt(earnings.role[source].unclaimedRaw) > 0n;
  const sources = (["curve", "graduation", "lp"] as const).filter(holding);
  const payer = new PublicKey(wallet);
  if (observation.sharing) {
    const inVault = BigInt(earnings.mine.unclaimedRaw) > 0n;
    if (!inVault) throw new ClaimRefusal("NOTHING_TO_CLAIM", "Nothing to take now.");
    const lp = sources.includes("lp") && observation.graduated?.position && observation.graduated.positionNftAccount
      ? { pool: observation.graduated.pool, position: observation.graduated.position, positionNftAccount: observation.graduated.positionNftAccount }
      : null;
    const shared = await feeSharingClaimInstructions({
      connection,
      vault: observation.sharing.vault,
      wallet,
      sources: {
        curve: sources.includes("curve") ? { pool: observation.pool, config: observation.config } : null,
        graduation: sources.includes("graduation") ? { pool: observation.pool, config: observation.config } : null,
        lp,
      },
    });
    /* The vault is funded first, then the wallet's share paid out — the last part, in the last transaction. */
    const parts = [...shared.funding.map((part) => ({ sources: [part.source] as FeeSource[], instructions: part.instructions })), { sources: [] as FeeSource[], instructions: shared.claim }];
    return finish(connection, pack(parts, payer), payer, sources);
  }
  if (sources.length === 0) throw new ClaimRefusal("NOTHING_TO_CLAIM", "Nothing to take now.");
  const venue = createMeteoraDbcLaunchVenue({ connection, configs: args.configs });
  const parts: { sources: FeeSource[]; instructions: readonly TransactionInstruction[] }[] = [];
  for (const source of sources) parts.push({ sources: [source], instructions: await venue.claimFeeInstructions("creator", observation.token, source) });
  return finish(connection, pack(parts, payer), payer, sources);
}

/** As few transactions as fit, in order: a part joins the last one while the bytes stay under a packet, with room for a wallet's own instructions. */
function pack(parts: readonly Readonly<{ sources: FeeSource[]; instructions: readonly TransactionInstruction[] }>[], payer: PublicKey) {
  const groups: { sources: FeeSource[]; instructions: TransactionInstruction[] }[] = [];
  for (const part of parts) {
    const last = groups[groups.length - 1];
    const joined = last ? [...last.instructions, ...dedupeAccountCreation(last.instructions, part.instructions)] : null;
    if (last && joined && sizeOf(joined, payer) <= PACKET_BYTES) {
      last.sources.push(...part.sources);
      last.instructions = joined;
    } else groups.push({ sources: [...part.sources], instructions: [...part.instructions] });
  }
  return groups;
}

/** The groups sealed for the wallet, and what the network simulates them taking from it. */
async function finish(connection: Connection, groups: readonly Readonly<{ sources: FeeSource[]; instructions: readonly TransactionInstruction[] }>[], payer: PublicKey, sources: readonly FeeSource[]): Promise<CreatorClaimBuild> {
  const txs = [];
  for (const group of groups) txs.push({ ...(await seal(connection, group.instructions, payer)), sources: group.sources });
  let cost: bigint | null = 0n;
  try {
    const before = BigInt(await connection.getBalance(payer, "confirmed"));
    for (const tx of txs) {
      const simulated = await connection.simulateTransaction(new VersionedTransaction(Transaction.from(Buffer.from(tx.wireBase64, "base64")).compileMessage()), {
        sigVerify: false,
        replaceRecentBlockhash: true,
        commitment: "confirmed",
        accounts: { encoding: "base64", addresses: [payer.toBase58()] },
      });
      const after = simulated.value.accounts?.[0]?.lamports;
      if (simulated.value.err || after === undefined || after === null) throw new Error("not simulated");
      cost = (cost ?? 0n) + (before - BigInt(after));
    }
  } catch {
    /* Not simulated is not free: the cost is said as unknown. */
    cost = null;
  }
  return { txs, sources, costLamports: cost === null ? null : cost.toString() };
}

/* Two claims in one transaction may each open the same account of the pair currency: the idempotent opening stays, a second plain one would fail. */
function dedupeAccountCreation(have: readonly TransactionInstruction[], next: readonly TransactionInstruction[]): TransactionInstruction[] {
  const ATA_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
  const opened = new Set(have.filter((ix) => ix.programId.toBase58() === ATA_PROGRAM).map((ix) => ix.keys[1]?.pubkey.toBase58()));
  return next.filter((ix) => !(ix.programId.toBase58() === ATA_PROGRAM && opened.has(ix.keys[1]?.pubkey.toBase58())));
}

function sizeOf(instructions: readonly TransactionInstruction[], payer: PublicKey): number {
  const tx = new Transaction().add(...instructions);
  tx.feePayer = payer;
  tx.recentBlockhash = PublicKey.default.toBase58();
  try {
    return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

async function seal(connection: Connection, instructions: readonly TransactionInstruction[], payer: PublicKey): Promise<UnsignedTx> {
  const latest = await connection.getLatestBlockhash("confirmed");
  const tx = new Transaction().add(...instructions);
  tx.feePayer = payer;
  tx.recentBlockhash = latest.blockhash;
  return { network: "solana", wireBase64: Buffer.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false })).toString("base64"), validUntil: String(latest.lastValidBlockHeight) };
}

/** A claim as the chain recorded it: what each source paid by its program's own event, and what the wallet received. */
export type CreatorClaimObservation = Readonly<{
  signature: string;
  slot: number;
  at: number | null;
  failed: boolean;
  /** By source, raw in the pair currency, from the programs' events: to the creator's wallet, or into the vault when shared. */
  paid: Readonly<Record<FeeSource, string>>;
  /** What the vault paid the wallet out of its share, when shared; null otherwise. */
  vaultPaidRaw: string | null;
  /** The change of the wallet's own balance of the pair currency in this transaction. */
  receivedRaw: string;
}>;

type EventCoder = { events: { decode(data: string): { name: string; data: Record<string, unknown> } | null } };

export async function observeCreatorClaim(connection: Connection, args: Readonly<{ signature: string; wallet: Address; pairMint: Address; pool: Address; graduatedPool: Address | null }>): Promise<CreatorClaimObservation | null> {
  const tx = await connection.getTransaction(args.signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  if (!tx?.meta) return null;
  const dbc = (new DynamicBondingCurveClient(connection, "confirmed").state.getProgram() as unknown as { coder: EventCoder }).coder;
  const damm = (new CpAmm(connection)._program as unknown as { coder: EventCoder }).coder;
  const dfs = (new DynamicFeeSharingClient(connection, "confirmed").program as unknown as { coder: EventCoder }).coder;
  const message = tx.transaction.message;
  const keys = message.getAccountKeys({ accountKeysFromLookups: tx.meta.loadedAddresses });
  const keyAt = (index: number) => keys.get(index)?.toBase58() ?? "";
  const paid: Record<FeeSource, bigint> = { curve: 0n, graduation: 0n, lp: 0n };
  let vaultPaid: bigint | null = null;
  const amount = (value: unknown) => BigInt((value as { toString(): string } | undefined)?.toString() ?? "0");
  const pubkey = (value: unknown) => (value as PublicKey | undefined)?.toBase58?.() ?? "";
  for (const group of tx.meta.innerInstructions ?? []) {
    for (const ix of group.instructions) {
      const program = keyAt(ix.programIdIndex);
      const coder = program === DBC_PROGRAM ? dbc : program === DAMM_V2_PROGRAM ? damm : program === FEE_SHARING_PROGRAM ? dfs : null;
      if (!coder) continue;
      const data = Buffer.from(getBase58Encoder().encode(ix.data));
      if (data.length < 16 || !data.subarray(0, 8).equals(EVENT_IX_TAG)) continue;
      const event = coder.events.decode(data.subarray(8).toString("base64"));
      if (!event) continue;
      const fields = event.data;
      if (event.name === "evtClaimCreatorTradingFee" && pubkey(fields.pool) === args.pool) paid.curve += amount(fields.tokenQuoteAmount);
      /* The flag is the program's: 1 is the creator's withdrawal. */
      else if (event.name === "evtWithdrawMigrationFee" && pubkey(fields.pool) === args.pool && Number(fields.flag) === 1) paid.graduation += amount(fields.fee);
      else if (event.name === "evtClaimPositionFee" && args.graduatedPool !== null && pubkey(fields.pool) === args.graduatedPool) paid.lp += amount(fields.feeBClaimed);
      else if (event.name === "evtClaimFee" && pubkey(fields.user) === args.wallet) vaultPaid = (vaultPaid ?? 0n) + amount(fields.claimedFee);
    }
  }
  const held = (list: typeof tx.meta.postTokenBalances) => (list ?? []).filter((entry) => entry.owner === args.wallet && entry.mint === args.pairMint).reduce((total, entry) => total + BigInt(entry.uiTokenAmount.amount), 0n);
  return {
    signature: args.signature,
    slot: tx.slot,
    at: tx.blockTime ?? null,
    failed: tx.meta.err !== null,
    paid: { curve: paid.curve.toString(), graduation: paid.graduation.toString(), lp: paid.lp.toString() },
    vaultPaidRaw: vaultPaid === null ? null : vaultPaid.toString(),
    receivedRaw: (held(tx.meta.postTokenBalances) - held(tx.meta.preTokenBalances)).toString(),
  };
}
