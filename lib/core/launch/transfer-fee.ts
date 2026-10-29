/**
 * «Комісія за переказ» — a launch whose token takes a fee on every transfer until it moves to the DEX.
 *
 * Meteora's DBC 0.2.2 can give a launch's Token-2022 mint a `TransferFeeConfig`: the config made by `createConfig2`
 * carries `transferFeeParameters`, and the pool's creation writes them into the mint. Every transfer of the token then
 * withholds a share of the amount in the receiving account; the program pays nobody — the withheld tokens wait until
 * someone harvests them to the mint and the withheld authority withdraws them.
 *
 * What Ryntra allows, and nothing else:
 * - only in «Розширений» — a config made for one launch; Quick Launch and every preset pass no parameters at all, because
 *   any parameters, 0 bps included, create the extension;
 * - only `RevokeZeroFee`: the fee works on the curve; the move to the DEX schedules 0 % — the token program applies a new
 *   fee two epochs later — and revokes the authority, so after it no one can set a fee again. `Partner` is forbidden;
 *   `Creator` and `Immutable` are not made;
 * - the withheld tokens are the creator's: the mint's withdraw-withheld authority is the pool's creator;
 * - at most `TRANSFER_FEE_MAX_BPS` — 2 %, the review's proposal (O-02), kept here as the one constant the operator changes;
 * - only behind `RYNTRA_LAUNCH_TRANSFER_FEE=open` and on DBC SDK 2.0.0 (`RYNTRA_DBC_SDK=2`): 1.5.13 has no
 *   `createConfig2` and does not price a base transfer fee. The flag opens after devnet and the operator's canary.
 *
 * Pure and client-safe: the rule, the numbers, the fee math of the token program and the timeline read from a mint.
 */

/** The environment variable that offers the format; `open` — offered, anything else — not. */
export const TRANSFER_FEE_FLAG = "RYNTRA_LAUNCH_TRANSFER_FEE";

/** The highest rate a creator may set, basis points: 2 % (the review's proposal O-02; the operator's to change). */
export const TRANSFER_FEE_MAX_BPS = 200;

/** DBC 0.2.2's own ceiling for a base transfer fee (`MAX_BASE_TRANSFER_FEE_BPS`): no bound of Ryntra's may pass it. */
export const DBC_TRANSFER_FEE_PROGRAM_MAX_BPS = 1_000;

/** `TransferFeeWithheldAuthority` — who withdraws the withheld tokens. */
export const DBC_TRANSFER_FEE_WITHHELD = { PARTNER: 0, CREATOR: 1 } as const;

/** `MigratedTransferFeeAuthorityOption` — who may change the fee after the move to the DEX. */
export const DBC_MIGRATED_TRANSFER_FEE_AUTHORITY = { IMMUTABLE: 0, REVOKE_ZERO_FEE: 1, CREATOR: 2, PARTNER: 3 } as const;

/** Epochs the token program waits before a new fee applies: `RevokeZeroFee`'s 0 % starts at the move's epoch + 2. */
export const TRANSFER_FEE_NEW_RATE_EPOCHS = 2;

/** The one mode Ryntra offers. */
export const TRANSFER_FEE_MODE = "REVOKE_ZERO_FEE" as const;
/** Who collects what is withheld. */
export const TRANSFER_FEE_WITHHELD_BY = "CREATOR" as const;

/** Whether the format is offered on this deployment: the flag open and the venue on SDK 2.0.0. */
export function transferFeeOffered(env: Readonly<Record<string, string | undefined>>, sdk: string): boolean {
  return (env[TRANSFER_FEE_FLAG] ?? "").trim() === "open" && sdk === "2.0.0";
}

/** What the format tells a form: the ceiling, the mode and who collects; null — not offered here. */
export type TransferFeeFormat = Readonly<{ maxBps: number; mode: typeof TRANSFER_FEE_MODE; withheldBy: typeof TRANSFER_FEE_WITHHELD_BY; newRateEpochs: number }>;

export function transferFeeFormat(offered: boolean): TransferFeeFormat | null {
  return offered ? { maxBps: TRANSFER_FEE_MAX_BPS, mode: TRANSFER_FEE_MODE, withheldBy: TRANSFER_FEE_WITHHELD_BY, newRateEpochs: TRANSFER_FEE_NEW_RATE_EPOCHS } : null;
}

export type TransferFeeProblem = "BPS_NOT_WHOLE" | "BPS_ZERO" | "BPS_ABOVE_CAP";

/** Where a rate leaves the rule; empty — it holds. 0 bps is not «no fee»: no fee is no parameters at all. */
export function transferFeeBpsProblems(bps: number, maxBps: number = TRANSFER_FEE_MAX_BPS): readonly TransferFeeProblem[] {
  if (!Number.isInteger(bps)) return ["BPS_NOT_WHOLE"];
  if (bps <= 0) return ["BPS_ZERO"];
  if (bps > Math.min(maxBps, DBC_TRANSFER_FEE_PROGRAM_MAX_BPS)) return ["BPS_ABOVE_CAP"];
  return [];
}

/** `createConfig2`'s `transferFeeParameters`, as the SDK takes them. */
export type DbcTransferFeeParameters = Readonly<{ transferFeeBasisPoints: number; withheldAuthority: number; migratedTransferFeeAuthorityOption: number }>;

/** The parameters of a rate under Ryntra's rule: the creator collects, `RevokeZeroFee` at the DEX. Throws on a rate outside it. */
export function transferFeeParametersOf(bps: number): DbcTransferFeeParameters {
  const problems = transferFeeBpsProblems(bps);
  if (problems.length) throw new Error(`A transfer fee outside Ryntra's rule: ${problems.join(", ")}.`);
  return { transferFeeBasisPoints: bps, withheldAuthority: DBC_TRANSFER_FEE_WITHHELD.CREATOR, migratedTransferFeeAuthorityOption: DBC_MIGRATED_TRANSFER_FEE_AUTHORITY.REVOKE_ZERO_FEE };
}

/**
 * Why parameters handed to the SDK are not Ryntra's rule, each in a plain line; empty — they are. The last guard before
 * bytes are built: `Partner`, `Creator` and `Immutable` never, no 0 bps, no rate above the cap.
 */
export function transferFeeParametersProblems(params: Readonly<{ transferFeeBasisPoints: number; withheldAuthority: number; migratedTransferFeeAuthorityOption: number }>): readonly string[] {
  const problems: string[] = [];
  for (const problem of transferFeeBpsProblems(params.transferFeeBasisPoints)) problems.push(`the rate: ${problem}`);
  if (params.withheldAuthority !== DBC_TRANSFER_FEE_WITHHELD.CREATOR) problems.push("the withheld tokens would not be the creator's");
  if (params.migratedTransferFeeAuthorityOption !== DBC_MIGRATED_TRANSFER_FEE_AUTHORITY.REVOKE_ZERO_FEE) problems.push("after the DEX the fee would not fall to 0 with the authority revoked");
  return problems;
}

/** A config's transfer-fee fields as the program stores them (DBC 0.2.2 `PoolConfig`). */
export type ConfigTransferFee = Readonly<{ flag: number; bps: number; withheldAuthority: number; migratedAuthorityOption: number }>;

/** Why a config's transfer fee is not Ryntra's rule; empty when it has none or keeps the rule. */
export function configTransferFeeProblems(fee: ConfigTransferFee | null | undefined): readonly string[] {
  if (!fee || fee.flag === 0) return [];
  return transferFeeParametersProblems({ transferFeeBasisPoints: fee.bps, withheldAuthority: fee.withheldAuthority, migratedTransferFeeAuthorityOption: fee.migratedAuthorityOption });
}

/* ------------------------------------------------------------- the token program's math */

/**
 * One transfer of `grossRaw` at `bps`: what is withheld in the receiving account and what arrives. The token program's
 * own rule — basis points of the amount rounded up, capped at the maximum fee, which DBC sets to u64::MAX (no cap).
 */
export function transferFeeOn(grossRaw: bigint, bps: number): Readonly<{ grossRaw: bigint; withheldRaw: bigint; netRaw: bigint }> {
  if (grossRaw <= 0n || bps <= 0) return { grossRaw: grossRaw > 0n ? grossRaw : 0n, withheldRaw: 0n, netRaw: grossRaw > 0n ? grossRaw : 0n };
  const withheldRaw = (grossRaw * BigInt(bps) + 9_999n) / 10_000n;
  return { grossRaw, withheldRaw, netRaw: grossRaw - withheldRaw };
}

/* ------------------------------------------------------------- the mint, read */

/** A mint's `TransferFeeConfig`, plain: the two rates with their epochs, the two authorities and what the mint holds withheld. */
export type MintTransferFee = Readonly<{
  olderBps: number;
  olderEpoch: string;
  newerBps: number;
  newerEpoch: string;
  /** Who may set a new rate; null — revoked. */
  configAuthority: string | null;
  /** Who withdraws what is withheld; null — no one. */
  withdrawAuthority: string | null;
  /** Harvested to the mint and not withdrawn yet. */
  withheldOnMintRaw: string;
}>;

export const TRANSFER_FEE_PHASES = ["CURVE", "ZERO_SCHEDULED", "ZERO", "OUTSIDE_RULE"] as const;
export type TransferFeePhase = (typeof TRANSFER_FEE_PHASES)[number];

/** Where a launch's transfer fee stands now — the RevokeZeroFee timeline. */
export type TransferFeeTimeline = Readonly<{
  phase: TransferFeePhase;
  /** The rate a transfer pays now, basis points. */
  bpsNow: number;
  /** The launch's rate on the curve. */
  curveBps: number;
  /** The first epoch at 0 %; null before the move to the DEX scheduled it. */
  zeroFromEpoch: string | null;
  /** Whether anyone can still set a rate. */
  authorityLive: boolean;
}>;

/** The rate in force at `epoch` — the newer one from its epoch on, the older before it (the token program's rule). */
export function bpsAtEpoch(fee: Pick<MintTransferFee, "olderBps" | "newerBps" | "newerEpoch">, epoch: bigint): number {
  return epoch >= BigInt(fee.newerEpoch) ? fee.newerBps : fee.olderBps;
}

/**
 * The timeline of a RevokeZeroFee launch read from its mint at `epoch`. On the curve the pool's authority (`poolAuthority`)
 * holds the config and the rate is the launch's; the move to the DEX writes 0 % from two epochs on and leaves no
 * authority; anything else — a rate changed on the curve, an authority that is someone else's — is outside the rule.
 */
export function transferFeeTimeline(fee: MintTransferFee, args: Readonly<{ curveBps: number; epoch: bigint; migrated: boolean; poolAuthority: string }>): TransferFeeTimeline {
  const bpsNow = bpsAtEpoch(fee, args.epoch);
  const base = { bpsNow, curveBps: args.curveBps, authorityLive: fee.configAuthority !== null };
  if (!args.migrated) {
    const holds = fee.configAuthority === args.poolAuthority && fee.newerBps === args.curveBps && bpsNow === args.curveBps;
    return { ...base, phase: holds ? "CURVE" : "OUTSIDE_RULE", zeroFromEpoch: null };
  }
  if (fee.configAuthority !== null || fee.newerBps !== 0) return { ...base, phase: "OUTSIDE_RULE", zeroFromEpoch: null };
  return { ...base, phase: bpsNow === 0 ? "ZERO" : "ZERO_SCHEDULED", zeroFromEpoch: fee.newerEpoch };
}

/**
 * Why a launch's mint is not the transfer fee its config promised — the receipt's check; empty — it is. The withheld
 * tokens are the creator's (`creator` — the pool's creator at the creation), the rate is the config's on the curve, and
 * the RevokeZeroFee timeline holds.
 */
export function mintTransferFeeProblems(fee: MintTransferFee, args: Readonly<{ curveBps: number; creator: string; epoch: bigint; migrated: boolean; poolAuthority: string }>): readonly string[] {
  const problems: string[] = [];
  if (fee.withdrawAuthority !== args.creator) problems.push("the withheld transfer fee is not the creator's to withdraw");
  /* The creation writes the rate as both older and newer; the move to the DEX keeps it as the older one until 0 % applies. */
  if (fee.olderBps !== args.curveBps) problems.push("the transfer fee's rate is not the config's");
  if (transferFeeTimeline(fee, args).phase === "OUTSIDE_RULE") problems.push("the transfer fee does not follow RevokeZeroFee");
  return problems;
}

/** The withheld cycle: in holders' accounts → harvested to the mint → withdrawn by the creator. Amounts raw, of the token. */
export type TransferFeeCycle = Readonly<{
  /** Withheld in token accounts, not harvested yet; null — the accounts were not read. */
  inAccountsRaw: string | null;
  /** Accounts that hold some — what one harvest names; the count, not the list. */
  accountsWithWithheld: number | null;
  /** Harvested to the mint, not withdrawn yet. */
  onMintRaw: string;
  /** Withdrawn by the creator through Ryntra, each by its receipt. */
  withdrawnRaw: string;
}>;

/** What the creator can do now: harvest when accounts hold some, withdraw when the mint does. */
export function transferFeeActions(cycle: TransferFeeCycle): Readonly<{ harvest: boolean; withdraw: boolean }> {
  return { harvest: (cycle.accountsWithWithheld ?? 0) > 0, withdraw: BigInt(cycle.onMintRaw) > 0n };
}
