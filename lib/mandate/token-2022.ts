/**
 * CITY-184 — the coins of the Token-2022 program the agent trades, and those it does not.
 *
 * Every coin of Ryntra's launchpad is a Token-2022 mint (read from mainnet 02.11.2026: metadata pointer and metadata, no
 * mint or freeze authority), and so are pump.fun's new coins. Token-2022 lets an issuer bolt features onto a mint, and
 * some of them turn a coin into a trap for a wallet that cannot look twice: the issuer runs its own program on every
 * transfer, takes the coin out of any wallet, freezes new wallets, pauses every transfer, hides amounts. The agent buys
 * and sells for a person who has walked away, so it trades a Token-2022 coin only when every feature of its mint is on
 * the list below; anything else — a feature named here or one the list does not know — is a refusal in one sentence.
 *
 * A transfer fee is on the list with a condition: the coin's fee is counted into what reaches the person. The minimum
 * the agent holds a trade to — the rule after the swap (`./result.ts`) — is what is left after the coin withholds its fee
 * on every transfer into her account, at the rate in force this epoch, and the coin's rate is at most what Ryntra's own
 * launchpad lets a creator set (`TRANSFER_FEE_MAX_BPS`, 2 %). The budget's caps count what leaves the budget, the coin's
 * fee inside it, never on top.
 *
 * Pure: the mint is read from its own bytes — the token program's layout — with no SDK and no network.
 */

import { PublicKey } from "@solana/web3.js";

import { TRANSFER_FEE_MAX_BPS } from "../core/launch/transfer-fee.ts";
import { TOKEN_PROGRAM_ID } from "./ssa.ts";

export const TOKEN_2022_PROGRAM_ID = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

/** The two token programs a coin the agent trades may belong to. */
export const TOKEN_PROGRAMS: readonly PublicKey[] = Object.freeze([TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]);

export const isTokenProgram = (program: PublicKey): boolean => TOKEN_PROGRAMS.some((known) => known.equals(program));

/**
 * Circle's USDC, mainnet and devnet: its issuer can freeze a wallet of it, and a budget of USDC lives with that — the
 * one coin the agent takes with a freeze authority.
 */
export const USDC_MINTS: readonly PublicKey[] = Object.freeze([
  new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
  new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"),
]);

/** The highest transfer fee of a coin the agent trades, basis points: the launchpad's own ceiling. */
export const AGENT_TRANSFER_FEE_MAX_BPS = TRANSFER_FEE_MAX_BPS;

/** Token-2022's extension numbers, as the program writes them. */
export const EXTENSION = Object.freeze({
  TransferFeeConfig: 1,
  MintCloseAuthority: 3,
  ConfidentialTransferMint: 4,
  DefaultAccountState: 6,
  NonTransferable: 9,
  InterestBearingConfig: 10,
  PermanentDelegate: 12,
  TransferHook: 14,
  ConfidentialTransferFeeConfig: 16,
  MetadataPointer: 18,
  TokenMetadata: 19,
  GroupPointer: 20,
  TokenGroup: 21,
  GroupMemberPointer: 22,
  TokenGroupMember: 23,
  ConfidentialMintBurn: 24,
  ScaledUiAmountConfig: 25,
  PausableConfig: 26,
});

/**
 * Every mint feature the agent trades a coin with. Names and pictures, groups — nothing that moves or holds a coin;
 * the transfer fee, under the rule above.
 */
export const ALLOWED_MINT_EXTENSIONS: readonly number[] = Object.freeze([
  EXTENSION.MetadataPointer,
  EXTENSION.TokenMetadata,
  EXTENSION.GroupPointer,
  EXTENSION.TokenGroup,
  EXTENSION.GroupMemberPointer,
  EXTENSION.TokenGroupMember,
  EXTENSION.TransferFeeConfig,
]);

const HIDDEN = "the coin can hide its amounts, so what reaches you cannot be checked";
const FREEZABLE = "its issuer can freeze your wallet of it, and a frozen coin cannot be sold";

/**
 * Why the agent does not trade a coin with this feature, in one sentence a person reads — the gravest first: a mint with
 * several is refused for the first of them here.
 */
const REFUSED: readonly (readonly [number, string])[] = Object.freeze([
  [EXTENSION.PermanentDelegate, "its issuer can take the coin out of any wallet"],
  [EXTENSION.TransferHook, "the coin runs its issuer's own program on every transfer"],
  [EXTENSION.NonTransferable, "the coin cannot be moved, so it could never be sold"],
  [EXTENSION.PausableConfig, "its issuer can stop every transfer of the coin"],
  [EXTENSION.ConfidentialTransferMint, HIDDEN],
  [EXTENSION.ConfidentialTransferFeeConfig, HIDDEN],
  [EXTENSION.ConfidentialMintBurn, HIDDEN],
  [EXTENSION.InterestBearingConfig, "the coin's shown amount changes on its own"],
  [EXTENSION.ScaledUiAmountConfig, "the coin's shown amount changes on its own"],
  [EXTENSION.MintCloseAuthority, "its issuer can close the coin itself"],
]);

/* ------------------------------------------------------------------ the mint, read from its bytes */

/** A mint's base layout is 82 bytes; Token-2022 pads it to an account's 165, writes the account type, then its extensions. */
const MINT_BASE = 82;
const ACCOUNT_TYPE_AT = 165;
const ACCOUNT_TYPE_MINT = 1;
const DECIMALS_AT = 44;
const INITIALIZED_AT = 45;
/** The freeze authority's option tag: 1 when the mint names one. */
const FREEZE_AUTHORITY_AT = 46;

const u16 = (data: Uint8Array, at: number) => data[at]! | (data[at + 1]! << 8);
const u64 = (data: Uint8Array, at: number) => Buffer.from(data.buffer, data.byteOffset, data.byteLength).readBigUInt64LE(at);

export type MintExtension = Readonly<{ type: number; data: Uint8Array }>;

/** The extensions written after a Token-2022 mint's base; throws on bytes that are not a whole mint. */
export function mintExtensions(data: Uint8Array): readonly MintExtension[] {
  if (data.length === MINT_BASE) return [];
  if (data.length <= ACCOUNT_TYPE_AT || data[ACCOUNT_TYPE_AT] !== ACCOUNT_TYPE_MINT) throw new Error("not a mint");
  const extensions: MintExtension[] = [];
  let at = ACCOUNT_TYPE_AT + 1;
  while (at + 4 <= data.length) {
    const type = u16(data, at);
    const length = u16(data, at + 2);
    /* The program leaves zeroes after the last extension. */
    if (type === 0) break;
    if (at + 4 + length > data.length) throw new Error("an extension runs past the mint");
    extensions.push({ type, data: data.subarray(at + 4, at + 4 + length) });
    at += 4 + length;
  }
  return extensions;
}

/** One rate of a transfer fee: from which epoch, at most how much, at what rate. */
export type TransferFeeRate = Readonly<{ epoch: bigint; maximumFee: bigint; bps: number }>;
export type CoinTransferFee = Readonly<{ older: TransferFeeRate; newer: TransferFeeRate }>;

function transferFeeOf(data: Uint8Array): CoinTransferFee {
  if (data.length < 108) throw new Error("a transfer fee too short");
  const rate = (at: number): TransferFeeRate => ({ epoch: u64(data, at), maximumFee: u64(data, at + 8), bps: u16(data, at + 16) });
  return { older: rate(72), newer: rate(90) };
}

/** What the agent knows of a coin it may trade: its program, its decimals and, where it has one, its transfer fee. */
export type Coin = Readonly<{ mint: PublicKey; program: PublicKey; decimals: number; transferFee: CoinTransferFee | null }>;

export type CoinReading = Readonly<{ ok: true; coin: Coin }> | Readonly<{ ok: false; reason: string }>;

const refused = (reason: string): CoinReading => ({ ok: false, reason: `the agent does not trade this coin: ${reason}` });

/**
 * The coin as the agent trades it, or why it does not: a mint of Token or Token-2022 and, for Token-2022, nothing but
 * the features on the list — a transfer fee no higher than the launchpad's ceiling: at `epoch`, the rate in force and
 * any rate already set to come; with no epoch, either of its rates.
 */
export function readCoin(mint: PublicKey, info: Readonly<{ owner: PublicKey; data: Uint8Array }> | null | undefined, epoch?: bigint): CoinReading {
  if (!info) return { ok: false, reason: "the coin's mint could not be read" };
  if (!isTokenProgram(info.owner)) return refused("it is not a token of the token programs");
  const data = info.data;
  if (data.length < MINT_BASE || data[INITIALIZED_AT] !== 1) return refused("it is not a coin's mint");
  const decimals = data[DECIMALS_AT]!;
  /* A wallet its issuer can freeze is a coin she may never sell; the launchpad's coins name no freeze authority. */
  const freezable = data[FREEZE_AUTHORITY_AT] === 1 && !USDC_MINTS.some((usdc) => usdc.equals(mint));
  if (info.owner.equals(TOKEN_PROGRAM_ID)) {
    if (data.length !== MINT_BASE) return refused("it is not a coin's mint");
    return freezable ? refused(FREEZABLE) : { ok: true, coin: { mint, program: TOKEN_PROGRAM_ID, decimals, transferFee: null } };
  }
  let extensions: readonly MintExtension[];
  try {
    extensions = mintExtensions(data);
  } catch {
    return refused("its mint cannot be read whole");
  }
  const has = (type: number) => extensions.find((extension) => extension.type === type);
  for (const [type, reason] of REFUSED) if (has(type)) return refused(reason);
  if (freezable) return refused(FREEZABLE);
  const frozen = has(EXTENSION.DefaultAccountState);
  if (frozen) return refused(frozen.data[0] === 2 ? "new wallets of this coin start frozen" : "its issuer can make new wallets of this coin start frozen");
  if (extensions.some((extension) => !ALLOWED_MINT_EXTENSIONS.includes(extension.type))) return refused("it carries a Token-2022 feature the agent does not know");
  let transferFee: CoinTransferFee | null = null;
  const fee = has(EXTENSION.TransferFeeConfig);
  if (fee) {
    try {
      transferFee = transferFeeOf(fee.data);
    } catch {
      return refused("its transfer fee cannot be read");
    }
    /* Once the newer rate's epoch has come, the older one is history. */
    const highest = epoch !== undefined && epoch >= transferFee.newer.epoch ? transferFee.newer.bps : Math.max(transferFee.older.bps, transferFee.newer.bps);
    if (highest > AGENT_TRANSFER_FEE_MAX_BPS) return refused(`it takes ${highest / 100}% on every transfer, above the ${AGENT_TRANSFER_FEE_MAX_BPS / 100}% the agent pays`);
  }
  return { ok: true, coin: { mint, program: TOKEN_2022_PROGRAM_ID, decimals, transferFee } };
}

/** Why the agent does not trade this coin; null when it does. */
export const coinRefusal = (mint: PublicKey, info: Readonly<{ owner: PublicKey; data: Uint8Array }> | null | undefined, epoch?: bigint): string | null => {
  const reading = readCoin(mint, info, epoch);
  return reading.ok ? null : reading.reason;
};

/* ------------------------------------------------------------------ the transfer fee, counted */

/** The rate in force at `epoch`: the newer one from its epoch on, the older before it (the token program's rule). */
export const rateAt = (fee: CoinTransferFee, epoch: bigint): TransferFeeRate => (epoch >= fee.newer.epoch ? fee.newer : fee.older);

/** What one transfer of `amount` withholds at `epoch`: its rate of the amount rounded up, at most the rate's maximum. */
export function withheldOn(amount: bigint, fee: CoinTransferFee | null, epoch: bigint): bigint {
  if (!fee || amount <= 0n) return 0n;
  const rate = rateAt(fee, epoch);
  if (rate.bps === 0) return 0n;
  const share = (amount * BigInt(rate.bps) + 9_999n) / 10_000n;
  return share < rate.maximumFee ? share : rate.maximumFee;
}

/**
 * What reaches the person of `amount` after `transfers` transfers of the coin, each withholding its fee at `epoch`. A coin
 * without a transfer fee arrives whole.
 *
 * Between a venue's minimum and her account the coin crosses one transfer: Jupiter holds its minimum on the vault's own
 * account — the pool's transfer into it already counted — and then hands the coin on to hers; DLMM pays it to her
 * straight. Measured on the mainnet fork (CITY-184 report §3): a rule asking the minimum less one fee passes, the
 * minimum itself never.
 */
export function afterTransferFee(amount: bigint, coin: Pick<Coin, "transferFee">, epoch: bigint, transfers = 1): bigint {
  let left = amount;
  for (let i = 0; i < transfers; i += 1) left -= withheldOn(left, coin.transferFee, epoch);
  return left > 0n ? left : 0n;
}
