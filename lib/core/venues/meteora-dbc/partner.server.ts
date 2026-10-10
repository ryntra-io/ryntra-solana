/**
 * The partner's fees of a launch — read from Meteora's programs, and claimed
 * only where Ryntra's executor is the config's fee claimer itself.
 *
 * - `readPartnerFees` — the programs' own counters for the partner's role:
 *   the curve's unclaimed partner fee, the partner's migration fee with the
 *   curve's withdrawal flag, the partner's share of the surplus by Meteora's
 *   formula with its flag, and the partner's locked position in the graduated
 *   DAMM v2 pool with its unclaimed fees.
 * - `buildPartnerClaim` — one claim of one source, for the fee claimer to sign
 *   as its only signer and fee payer. It refuses unless the config's fee
 *   claimer on chain is the wallet asked to sign: the partner's vault on the
 *   Classic and Protected configs is a multisig, and nothing here ever builds
 *   a claim for it.
 *
 * Server-only. Nothing here signs.
 */

import { CpAmm, getUnClaimLpFee } from "@meteora-ag/cp-amm-sdk";
import { DAMM_V2_MIGRATION_FEE_ADDRESS, DynamicBondingCurveClient, deriveDammV2PoolAddress } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey, Transaction, type Connection } from "@solana/web3.js";
import BN from "bn.js";

import { partnerMigrationFeeRaw, partnerSurplusRaw, type BudgetSource } from "../../launch/budget.ts";

/** The program's mask of the partner's withdrawal in `migration_fee_withdraw_status` (DBC: bit 2, 0b100). */
export const PARTNER_MIGRATION_FEE_MASK = 0b100;
const U64_MAX = new BN("18446744073709551615");

export type PartnerFeesRead = Readonly<{
  token: string;
  curve: string;
  config: string;
  /** The config's fee claimer on chain — the wallet a claim pays and the only one that may sign it. */
  feeClaimer: string;
  pairMint: string;
  migrated: boolean;
  /** The curve's unclaimed partner fee, in the pair currency and in the token. */
  curveRaw: bigint;
  curveTokenRaw: bigint;
  /** The partner's migration fee, and whether the curve's flag says it was withdrawn. */
  migration: Readonly<{ raw: bigint; withdrawn: boolean }>;
  /** The partner's share of the surplus by Meteora's formula, and whether it was withdrawn. */
  surplus: Readonly<{ raw: bigint; withdrawn: boolean }>;
  /** The graduated pool and the fee claimer's locked position in it with its unclaimed fees; null before graduation or when it holds none. */
  lp: Readonly<{ pool: string; position: string; positionNftAccount: string; pairRaw: bigint; tokenRaw: bigint }> | null;
  /** The graduated pool's address; null before graduation. */
  dammPool: string | null;
}>;

export async function readPartnerFees(connection: Connection, args: Readonly<{ token: string; pool: string }>): Promise<PartnerFeesRead> {
  const client = new DynamicBondingCurveClient(connection, "confirmed");
  const virtual = await client.state.getPool(new PublicKey(args.pool));
  if (!virtual) throw new Error(`No curve at ${args.pool}.`);
  const state = virtual.poolState;
  const config = await client.state.getPoolConfig(state.config);
  if (!config) throw new Error(`No config at ${state.config.toBase58()}.`);
  const migrated = state.isMigrated === 1;
  const threshold = BigInt(config.migrationQuoteThreshold.toString());
  const full = migrated || Number(state.finishCurveTimestamp.toString()) > 0;
  const surplusWithdrawn = (state as unknown as { isPartnerWithdrawSurplus: number }).isPartnerWithdrawSurplus === 1;
  let lp: PartnerFeesRead["lp"] = null;
  let dammPool: string | null = null;
  if (migrated) {
    const dammConfig = DAMM_V2_MIGRATION_FEE_ADDRESS[config.migrationFeeOption];
    if (dammConfig) {
      const cpAmm = new CpAmm(connection);
      const address = deriveDammV2PoolAddress(dammConfig, new PublicKey(args.token), config.quoteMint);
      dammPool = address.toBase58();
      const poolState = await cpAmm.fetchPoolState(address);
      const found = (await cpAmm.getUserPositionByPool(address, config.feeClaimer))[0] ?? null;
      if (found) {
        const pairIsB = poolState.tokenBMint.equals(config.quoteMint);
        const unclaimed = getUnClaimLpFee(poolState, found.positionState);
        lp = {
          pool: dammPool,
          position: found.position.toBase58(),
          positionNftAccount: found.positionNftAccount.toBase58(),
          pairRaw: BigInt((pairIsB ? unclaimed.feeTokenB : unclaimed.feeTokenA).toString()),
          tokenRaw: BigInt((pairIsB ? unclaimed.feeTokenA : unclaimed.feeTokenB).toString()),
        };
      }
    }
  }
  return {
    token: args.token,
    curve: args.pool,
    config: state.config.toBase58(),
    feeClaimer: config.feeClaimer.toBase58(),
    pairMint: config.quoteMint.toBase58(),
    migrated,
    curveRaw: BigInt(state.partnerQuoteFee.toString()),
    curveTokenRaw: BigInt(state.partnerBaseFee.toString()),
    migration: {
      raw: migrated ? partnerMigrationFeeRaw({ thresholdRaw: threshold, feePct: config.migrationFeePercentage, creatorPct: config.creatorMigrationFeePercentage }) : 0n,
      withdrawn: (state.migrationFeeWithdrawStatus & PARTNER_MIGRATION_FEE_MASK) !== 0,
    },
    surplus: {
      raw: full ? partnerSurplusRaw({ reserveRaw: BigInt(state.quoteReserve.toString()), thresholdRaw: threshold, creatorPct: config.creatorTradingFeePercentage }) : 0n,
      withdrawn: surplusWithdrawn,
    },
    lp,
    dammPool,
  };
}

/** Refused: the wallet asked to sign is not the config's fee claimer, or the source holds nothing to claim now. */
export class PartnerClaimRefusal extends Error {
  readonly code: "NOT_THE_CLAIMER" | "NOTHING_TO_CLAIM";
  constructor(code: PartnerClaimRefusal["code"], message: string) {
    super(message);
    this.name = "PartnerClaimRefusal";
    this.code = code;
  }
}

/**
 * One source's claim for the fee claimer itself — its only signer and fee payer, paid to its own token accounts. Built
 * only when the config's fee claimer on chain is `claimer`.
 */
export async function buildPartnerClaim(connection: Connection, args: Readonly<{ read: PartnerFeesRead; source: BudgetSource; claimer: string }>): Promise<Transaction> {
  const { read, source } = args;
  if (read.feeClaimer !== args.claimer) throw new PartnerClaimRefusal("NOT_THE_CLAIMER", "Only a config whose fee claimer is this wallet is claimed by it.");
  const claimer = new PublicKey(args.claimer);
  const pool = new PublicKey(read.curve);
  const client = new DynamicBondingCurveClient(connection, "confirmed");
  if (source === "curve") {
    if (read.curveRaw <= 0n && read.curveTokenRaw <= 0n) throw new PartnerClaimRefusal("NOTHING_TO_CLAIM", "No partner fee waits on the curve.");
    return client.partner.claimPartnerTradingFee({ feeClaimer: claimer, payer: claimer, pool, maxBaseAmount: U64_MAX, maxQuoteAmount: U64_MAX });
  }
  if (source === "migration") {
    if (!read.migrated || read.migration.withdrawn || read.migration.raw <= 0n) throw new PartnerClaimRefusal("NOTHING_TO_CLAIM", "No partner migration fee waits.");
    return client.partner.partnerWithdrawMigrationFee({ pool, sender: claimer });
  }
  if (source === "surplus") {
    if (read.surplus.withdrawn || read.surplus.raw <= 0n) throw new PartnerClaimRefusal("NOTHING_TO_CLAIM", "No partner surplus waits.");
    return client.partner.partnerWithdrawSurplus({ feeClaimer: claimer, pool });
  }
  const lp = read.lp;
  if (!lp || (lp.pairRaw <= 0n && lp.tokenRaw <= 0n)) throw new PartnerClaimRefusal("NOTHING_TO_CLAIM", "No fee waits on the partner's locked position.");
  const cpAmm = new CpAmm(connection);
  const poolState = await cpAmm.fetchPoolState(new PublicKey(lp.pool));
  const programOf = async (mint: PublicKey) => ((await connection.getAccountInfo(mint, "confirmed"))?.owner.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID);
  const tx = await cpAmm.claimPositionFee({
    owner: claimer,
    position: new PublicKey(lp.position),
    pool: new PublicKey(lp.pool),
    positionNftAccount: new PublicKey(lp.positionNftAccount),
    tokenAMint: poolState.tokenAMint,
    tokenBMint: poolState.tokenBMint,
    tokenAVault: poolState.tokenAVault,
    tokenBVault: poolState.tokenBVault,
    tokenAProgram: await programOf(poolState.tokenAMint),
    tokenBProgram: await programOf(poolState.tokenBMint),
    feePayer: claimer,
  });
  return new Transaction().add(...tx.instructions);
}
