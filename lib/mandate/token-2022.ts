/**
 * The coins of the Token-2022 program the agent trades, and those it does not.
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
 * A tokenized stock is the one coin taken with its issuer's rights (`./mint-features.ts` `STOCK_MINT_EXTENSIONS`): a mint
 * the caller found, by its address, on the shelf of verified companies is read with `stock`, and passes only while its
 * own bytes say the rights are not in use against a buyer — no program on transfers, not paused, new wallets not frozen.
 * Any other mint with the very same features is refused as before: `stock` is the caller's statement about the shelf,
 * never something a mint can say of itself.
 *
 * Pure: the mint is read from its own bytes — the token program's layout — with no SDK and no network.
 */

import { PublicKey } from "@solana/web3.js";

import { TRANSFER_FEE_MAX_BPS } from "../core/launch/transfer-fee.ts";
import { ALLOWED_MINT_EXTENSIONS, EXTENSION, STOCK_MINT_EXTENSIONS } from "./mint-features.ts";
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

export { ALLOWED_MINT_EXTENSIONS, EXTENSION, STOCK_MINT_EXTENSIONS };

/** How every refusal of a coin begins — the signer tells such a refusal from any other by it. */
export const COIN_REFUSED = "the agent does not trade this coin: ";

const HIDDEN = "the coin can hide its amounts, so what reaches you cannot be checked";
const FREEZABLE = "its issuer can freeze your wallet of it, and a frozen coin cannot be sold";
const STARTS_FROZEN = "new wallets of this coin start frozen";

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

/*
 * Every right of a stock is one the strict rule refuses by name — so `readCoin` meets it there, and takes it for a stock
 * only on its condition — or the state new wallets start in, which has its own line. A feature put on the stocks' list
 * that were neither would pass a stock with no condition read: the module does not load with one.
 */
for (const type of STOCK_MINT_EXTENSIONS) {
  if (type !== EXTENSION.DefaultAccountState && !REFUSED.some(([refusedType]) => refusedType === type)) throw new Error(`a stock's feature ${type} has no condition in the agent's rule`);
}

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

const refused = (reason: string): CoinReading => ({ ok: false, reason: `${COIN_REFUSED}${reason}` });

/** How the caller reads a mint: `stock` — it found the mint, by its address, on the shelf of verified companies. */
export type CoinAs = Readonly<{ stock?: boolean }>;

/** A new wallet's state as `DefaultAccountState` writes it, and a token account's own: 1 — open, 2 — frozen. */
const STATE_OPEN = 1;
const STATE_FROZEN = 2;

const zeroes = (data: Uint8Array) => data.every((byte) => byte === 0);

/**
 * Whether a stock's feature, as its bytes stand now, leaves a buyer alone — the issuer keeps the right, and is not using
 * it. Anything of another length than the program writes is not read as a pass.
 * - a transfer hook: the authority, then the program — none named;
 * - a pause: the authority, then the switch — off;
 * - a permanent delegate, hidden amounts, a scaled amount: rights that move no coin by standing there. Hidden amounts
 *   need her own account set up for them — a plain transfer lands in the plain amount whatever the mint says — and a
 *   scaled amount changes the number shown, never the base units the agent's rules count.
 */
function stockFeatureHolds(type: number, data: Uint8Array): boolean {
  switch (type) {
    case EXTENSION.TransferHook:
      return data.length === 64 && zeroes(data.subarray(32));
    case EXTENSION.PausableConfig:
      return data.length === 33 && data[32] === 0;
    case EXTENSION.PermanentDelegate:
      return data.length === 32;
    case EXTENSION.ConfidentialTransferMint:
      return data.length === 65;
    case EXTENSION.ScaledUiAmountConfig:
      return data.length === 56;
    default:
      return false;
  }
}

/**
 * The coin as the agent trades it, or why it does not: a mint of Token or Token-2022 and, for Token-2022, nothing but
 * the features on the list — a transfer fee no higher than the launchpad's ceiling: at `epoch`, the rate in force and
 * any rate already set to come; with no epoch, either of its rates.
 *
 * `as.stock` — the mint is a stock of the shelf: its issuer's rights (`STOCK_MINT_EXTENSIONS`) and its freeze authority
 * are taken while the bytes read now say none of them is in use against a buyer; one that is, is refused with the very
 * reason any coin is.
 */
export function readCoin(mint: PublicKey, info: Readonly<{ owner: PublicKey; data: Uint8Array }> | null | undefined, epoch?: bigint, as?: CoinAs): CoinReading {
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
  /* The token program writes a feature once: a mint that names one twice is not one it made, and which copy counts is nobody's to guess. */
  if (new Set(extensions.map((extension) => extension.type)).size !== extensions.length) return refused("its mint cannot be read whole");
  const stock = as?.stock === true;
  const has = (type: number) => extensions.find((extension) => extension.type === type);
  for (const [type, reason] of REFUSED) {
    const found = has(type);
    if (found && !(stock && STOCK_MINT_EXTENSIONS.includes(type) && stockFeatureHolds(type, found.data))) return refused(reason);
  }
  if (freezable && !stock) return refused(FREEZABLE);
  const frozen = has(EXTENSION.DefaultAccountState);
  if (frozen && !(stock && frozen.data.length === 1 && frozen.data[0] === STATE_OPEN)) return refused(frozen.data[0] === STATE_FROZEN ? STARTS_FROZEN : "its issuer can make new wallets of this coin start frozen");
  if (extensions.some((extension) => !ALLOWED_MINT_EXTENSIONS.includes(extension.type) && !(stock && STOCK_MINT_EXTENSIONS.includes(extension.type)))) return refused("it carries a Token-2022 feature the agent does not know");
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
export const coinRefusal = (mint: PublicKey, info: Readonly<{ owner: PublicKey; data: Uint8Array }> | null | undefined, epoch?: bigint, as?: CoinAs): string | null => {
  const reading = readCoin(mint, info, epoch, as);
  return reading.ok ? null : reading.reason;
};

/**
 * Whether a mint's issuer has every transfer of it paused now; null — the mint cannot be read whole. A coin of Token, or
 * one with no pause, is never paused.
 */
export function pausedNow(info: Readonly<{ owner: PublicKey; data: Uint8Array }>): boolean | null {
  if (!info.owner.equals(TOKEN_2022_PROGRAM_ID)) return false;
  try {
    const pause = mintExtensions(info.data).find((extension) => extension.type === EXTENSION.PausableConfig);
    return pause ? !(pause.data.length === 33 && pause.data[32] === 0) : false;
  } catch {
    return null;
  }
}

/* A token account: its state after the owner, the amount and the delegate; Token-2022 writes the account type, then its extensions. */
const ACCOUNT_STATE_AT = 108;
const ACCOUNT_TYPE_ACCOUNT = 2;
/* `ConfidentialTransferAccount`: whether the account takes plain amounts — its 263rd byte, after the keys and the hidden balances. */
const PLAIN_CREDITS_AT = 262;

/**
 * Why a buy of a stock could not reach the person's own account of it, read from the account's bytes now; null when it
 * can — or when the account is not opened yet: a new one starts open (`readCoin` saw to that) and plain. Its issuer has
 * frozen this very account, or she set it to take hidden amounts only, which no rule of the agent's could count.
 */
export function stockAccountRefusal(data: Uint8Array | null | undefined): string | null {
  if (!data || data.length <= ACCOUNT_STATE_AT) return null;
  if (data[ACCOUNT_STATE_AT] === STATE_FROZEN) return `${COIN_REFUSED}${FREEZABLE}`;
  if (data.length <= ACCOUNT_TYPE_AT || data[ACCOUNT_TYPE_AT] !== ACCOUNT_TYPE_ACCOUNT) return null;
  for (let at = ACCOUNT_TYPE_AT + 1; at + 4 <= data.length; ) {
    const type = u16(data, at);
    const length = u16(data, at + 2);
    if (type === 0 || at + 4 + length > data.length) break;
    if (type === EXTENSION.ConfidentialTransferAccount && !(length > PLAIN_CREDITS_AT && data[at + 4 + PLAIN_CREDITS_AT] === 1)) return `${COIN_REFUSED}${HIDDEN}`;
    at += 4 + length;
  }
  return null;
}

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
 * straight. Measured on the mainnet fork: a rule asking the minimum less one fee passes, the
 * minimum itself never.
 */
export function afterTransferFee(amount: bigint, coin: Pick<Coin, "transferFee">, epoch: bigint, transfers = 1): bigint {
  let left = amount;
  for (let i = 0; i < transfers; i += 1) left -= withheldOn(left, coin.transferFee, epoch);
  return left > 0n ? left : 0n;
}
