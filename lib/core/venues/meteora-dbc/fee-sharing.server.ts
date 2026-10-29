/**
 * «Спільнота» shares the creator's fees — Meteora's Dynamic Fee Sharing as the
 * creator of the curve.
 *
 * How it holds: right after the token is created, the creator's wallet hands
 * the curve's creator role to a fee vault (`transfer_pool_creator`, allowed
 * while the token is on its curve). From then on every fee of the creator's
 * side — the curve's creator share, the creator's part of the graduation fee,
 * and after graduation the fees of the creator's locked LP, whose position the
 * migration gives to the curve's creator — can be claimed only into the
 * vault, and the vault pays each wallet its share. The shares are written when
 * the vault is made; the program has no instruction that changes them.
 *
 * The vault is a PDA of Meteora's program from the token's own mint and the
 * pair currency: one per launch, found from the token alone. Funding a vault
 * from a source (`fund_by_claiming_fee`) is signed by any of its wallets and
 * moves nothing but the source's fee into the vault; a wallet's claim
 * (`claim_fee`) pays only that wallet.
 *
 * Server-only: it reads the chain through the connection it is given and
 * returns instructions for a wallet to sign.
 */

import {
  DYNAMIC_FEE_SHARING_PROGRAM_ID,
  DynamicFeeSharingClient,
  deriveFeeVaultPdaAddress,
  deriveTokenVaultAddress,
} from "@meteora-ag/dynamic-fee-sharing-sdk";
import { DYNAMIC_BONDING_CURVE_PROGRAM_ID, DynamicBondingCurveIdl, deriveDbcEventAuthority, deriveDbcPoolAuthority } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { PublicKey, type Connection, type TransactionInstruction } from "@solana/web3.js";

import { dbcClientOf } from "../meteora-clients.server.ts";
import type { Address } from "../../contracts.ts";
import type { FeeShare } from "../../launch/fee-shares.ts";

export const FEE_SHARING_PROGRAM = DYNAMIC_FEE_SHARING_PROGRAM_ID.toBase58();

/** The vault that holds a launch's creator role when its fees are shared: from the token's mint and the pair currency. */
export function feeSharingVaultOf(token: Address, pairMint: Address): Address {
  return deriveFeeVaultPdaAddress(new PublicKey(token), new PublicKey(pairMint)).toBase58();
}

/** A vault as the chain stores it: its owner, the pair currency, the fixed shares and what each wallet took. */
export type FeeSharingObservation = Readonly<{
  vault: Address;
  owner: Address;
  tokenMint: Address;
  /** The seed the vault's address comes from — the launch's own mint for a Ryntra launch. */
  base: Address;
  totalShare: number;
  fundedRaw: string;
  /** The cumulative fee per share, Q64.64, as a decimal string. */
  feePerShare: string;
  /** Each wallet's share, what it took, and the fee per share it was paid up to. */
  users: readonly Readonly<{ address: Address; share: number; claimedRaw: string; checkpoint: string }>[];
}>;

/**
 * The instructions that share a fresh launch's creator fees: the vault, made by
 * the creator with the shares written for ever, and the curve's creator role
 * handed to it. The new mint signs as the vault's seed — it signs the creation
 * too, so the vault is found from the token alone.
 */
export async function feeSharingSplitInstructions(args: Readonly<{
  connection: Connection;
  token: Address;
  pairMint: Address;
  pairProgram: Address;
  creator: Address;
  pool: Address;
  config: Address;
  shares: readonly FeeShare[];
}>): Promise<readonly TransactionInstruction[]> {
  const dfs = new DynamicFeeSharingClient(args.connection, "confirmed");
  const dbc = dbcClientOf(args.connection);
  const creator = new PublicKey(args.creator);
  const base = new PublicKey(args.token);
  const vault = deriveFeeVaultPdaAddress(base, new PublicKey(args.pairMint));
  const init = await dfs.createFeeVaultPda({
    base,
    tokenMint: new PublicKey(args.pairMint),
    tokenProgram: new PublicKey(args.pairProgram),
    owner: creator,
    payer: creator,
    userShare: args.shares.map((share) => ({ address: new PublicKey(share.address), share: share.bps })),
  });
  /* The curve does not exist yet when this is built: its handover is made from the accounts it will have. */
  const handover = await dbc.state.program.methods
    .transferPoolCreator()
    .accountsPartial({ virtualPool: new PublicKey(args.pool), config: new PublicKey(args.config), creator, newCreator: vault })
    .instruction();
  return [...init.instructions, handover];
}

/**
 * The vault at an address as the chain stores it; null only when no account is there. A read that fails throws: a
 * vault that could not be read is never taken for no vault — its figures would read as zero.
 */
export async function observeFeeSharing(connection: Connection, vault: Address): Promise<FeeSharingObservation | null> {
  const account = await connection.getAccountInfo(new PublicKey(vault), "confirmed");
  if (!account) return null;
  const dfs = new DynamicFeeSharingClient(connection, "confirmed");
  const state = await dfs.getFeeVault(new PublicKey(vault));
  const users = (state.users as unknown as readonly { address: PublicKey; share: number; feeClaimed: { toString(): string }; feePerShareCheckpoint: { toString(): string } }[])
    .filter((user) => user.share > 0)
    .map((user) => ({ address: user.address.toBase58(), share: Number(user.share), claimedRaw: user.feeClaimed.toString(), checkpoint: user.feePerShareCheckpoint.toString() }));
  return {
    vault,
    owner: state.owner.toBase58(),
    tokenMint: state.tokenMint.toBase58(),
    base: state.base.toBase58(),
    totalShare: Number(state.totalShare),
    fundedRaw: state.totalFundedFee.toString(),
    feePerShare: state.feePerShare.toString(),
    users,
  };
}

/** Which of the creator role's sources hold a fee now, and what a funding of each needs. */
export type FeeSharingSources = Readonly<{
  curve: Readonly<{ pool: Address; config: Address }> | null;
  graduation: Readonly<{ pool: Address; config: Address }> | null;
  lp: Readonly<{ pool: Address; position: Address; positionNftAccount: Address }> | null;
  /** The curve's surplus, the creator's part — once the curve is full; absent where a caller names none. */
  surplus?: Readonly<{ pool: Address; config: Address }> | null;
}>;

/**
 * A wallet's «Забрати» from a shared launch, in parts: each source that holds a
 * fee claimed into the vault (signed by the wallet, one of the vault's), then
 * the wallet's own share paid out of the vault to its account. The parts go
 * into as few transactions as fit, in this order, so what the wallet takes is
 * what the sources had plus what the vault held for it.
 *
 * A source's claim sends any fee in the launched token to an account of the
 * vault's own (a preset collects its fees in the pair currency, so nothing
 * lands there): opened once for the launch, not for every wallet that claims.
 */
export async function feeSharingClaimInstructions(args: Readonly<{ connection: Connection; vault: Address; wallet: Address; sources: FeeSharingSources }>): Promise<Readonly<{ funding: readonly Readonly<{ source: "curve" | "graduation" | "lp" | "surplus"; instructions: readonly TransactionInstruction[] }>[]; claim: readonly TransactionInstruction[] }>> {
  const dfs = new DynamicFeeSharingClient(args.connection, "confirmed");
  const vault = new PublicKey(args.vault);
  const wallet = new PublicKey(args.wallet);
  const funding: { source: "curve" | "graduation" | "lp" | "surplus"; instructions: readonly TransactionInstruction[] }[] = [];
  if (args.sources.curve) {
    /* The program's whitelist names `claim_creator_trading_fee`; the SDK's `…2` wrapper calls `claim_creator_trading_fee2`,
       which the program refuses as InvalidAction (0x1779) — proven on devnet 06.10. */
    const tx = await dfs.fundByClaimDbcCreatorTradingFee({ signer: wallet, creator: vault, feeVault: vault, poolConfig: new PublicKey(args.sources.curve.config), virtualPool: new PublicKey(args.sources.curve.pool) });
    funding.push({ source: "curve", instructions: tx.instructions });
  }
  if (args.sources.graduation) funding.push({ source: "graduation", instructions: [await fundByCreatorMigrationFee(args.connection, dfs, vault, wallet, args.sources.graduation)] });
  if (args.sources.lp) {
    const tx = await dfs.fundByClaimDammV2Fee({
      signer: wallet,
      owner: vault,
      feeVault: vault,
      dammV2Pool: new PublicKey(args.sources.lp.pool),
      dammV2Position: new PublicKey(args.sources.lp.position),
      dammV2PositionNftAccount: new PublicKey(args.sources.lp.positionNftAccount),
    });
    funding.push({ source: "lp", instructions: tx.instructions });
  }
  if (args.sources.surplus) {
    /* The creator's part of the surplus into the vault: `creator_withdraw_surplus` through the vault, as the SDK builds it. */
    const tx = await dfs.fundByWithdrawDbcCreatorSurplus({ signer: wallet, feeVault: vault, poolConfig: new PublicKey(args.sources.surplus.config), virtualPool: new PublicKey(args.sources.surplus.pool) });
    funding.push({ source: "surplus", instructions: tx.instructions });
  }
  const claim = await dfs.claimUserFee2({ feeVault: vault, user: wallet, payer: wallet, receiver: wallet });
  return { funding, claim: claim.instructions };
}

/**
 * The creator's graduation fee into the vault. Built here, not by the SDK: its
 * wrapper (1.1.0) checks the partner's claimer for the creator's withdrawal and
 * the creator for the partner's. The flag is the program's — 1 for the creator.
 */
async function fundByCreatorMigrationFee(connection: Connection, dfs: DynamicFeeSharingClient, vault: PublicKey, wallet: PublicKey, source: Readonly<{ pool: Address; config: Address }>): Promise<TransactionInstruction> {
  const dbc = dbcClientOf(connection);
  const config = await dbc.state.getPoolConfig(new PublicKey(source.config));
  const pool = await dbc.state.getPool(new PublicKey(source.pool));
  if (!config || !pool) throw new Error("The curve or its config could not be read.");
  if (!pool.poolState.creator.equals(vault)) throw new Error("The vault is not the curve's creator.");
  const discriminator = DynamicBondingCurveIdl.instructions.find((instruction) => instruction.name === "withdraw_migration_fee")!.discriminator;
  const tokenVault = deriveTokenVaultAddress(vault);
  const quoteProgram = (await connection.getAccountInfo(config.quoteMint, "confirmed"))?.owner;
  if (!quoteProgram) throw new Error("The pair currency could not be read.");
  return dfs.program.methods
    .fundByClaimingFee(Buffer.concat([Buffer.from(discriminator), Buffer.from([1])]))
    .accountsPartial({ feeVault: vault, tokenVault, signer: wallet, sourceProgram: DYNAMIC_BONDING_CURVE_PROGRAM_ID })
    .remainingAccounts([
      { pubkey: deriveDbcPoolAuthority(), isSigner: false, isWritable: false },
      { pubkey: new PublicKey(source.config), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(source.pool), isSigner: false, isWritable: true },
      { pubkey: tokenVault, isSigner: false, isWritable: true },
      { pubkey: pool.poolState.quoteVault, isSigner: false, isWritable: true },
      { pubkey: config.quoteMint, isSigner: false, isWritable: false },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: quoteProgram, isSigner: false, isWritable: false },
      { pubkey: deriveDbcEventAuthority(), isSigner: false, isWritable: false },
      { pubkey: DYNAMIC_BONDING_CURVE_PROGRAM_ID, isSigner: false, isWritable: false },
    ])
    .instruction();
}
