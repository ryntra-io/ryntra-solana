/**
 * An agent moves the range of a DLMM Pro position it looks after, inside bounds the person signed once.
 *
 * **What the program gives a delegate** (IDL 0.1.0 of SDK 0.1.2 and 0.1.3, Meteora's reference @41b3a9d): there is no
 * instruction that moves liquidity from one range to another. The right `UpdatePositionRange` (bit 4, mask 16) is two
 * calls — `expand_position`, which appends empty ranges (its signer and payer put up their rent), and
 * `remove_position`, which deletes empty ones (a delegate must name the owner as the rent's receiver). Money moves
 * only by the three calls a care already uses — whatever a delegate takes out the program pays into the owner's own
 * associated accounts (`IncorrectATA` otherwise) — and by a deposit, which the program takes from whatever accounts the
 * signer may move. A delegate with `AddLiquidity` alone pays from its own accounts. To put
 * the *person's* money back, Meteora's own way (`compoundFees` for a delegate) is an SPL approval from the owner on her
 * two accounts, the agent as the transfer authority: the token program holds the approval's total — and nothing ties it
 * to the pool. That is what `approve` builds and what the person is told before the signature
 * (`lib/care/range-limits.ts`, `keeperTermsOf`).
 *
 * **A move** is one approval of the agent's, in up to two transactions, in this order:
 * 1. **out** — the position's fees and the liquidity of every range that is not the one asked for, to the owner's
 *    own accounts (`refresh_fees_and_rewards`, `claim_fee`, `remove_liquidity_by_bps`); the removal is held to a band
 *    of the price like any removal of the venue's;
 * 2. **in** — the range asked for appended (`expand_position`, the agent puts up its rent), up to what the removal
 *    pays at the price the move is built at (and what the caller names from the wallet besides, `topUp`) put back into
 *    it from the owner's accounts (`add_liquidity_imbalance`, sized by the program at the price it lands at, inside a
 *    band), and the emptied ranges deleted, their rent to the owner (`remove_position`).
 * If «in» fails, «out» has already paid the owner: the money is in her wallet, never anywhere else. A keeper whose
 * bounds put nothing back builds «out» alone (`pull`).
 *
 * Nothing is put back on one side only: a range around the price needs both coins, and where the removal paid one (the
 * price had left the range) the money waits in the wallet — the agent does not trade the person's coins. For the same
 * reason a range takes the coins in the proportion its place around the price asks: after the price has walked
 * through a wide range, most of it is one coin, and only the part that fits the new range goes back — the rest waits
 * in the wallet, never anywhere else.
 *
 * **The second lock** (`keeperRefusalOf`) reads the message's own bytes before the agent's key signs, as
 * `./care-rules.server.ts` does for a care: only these calls, on this pool and this position, signed and paid by the
 * agent alone; every payout to the owner's own accounts; a new range one at a time, as wide as the bounds allow and no
 * wider or narrower; a deposit from the owner's own accounts only, capped at the bounds' put-back per move, inside a
 * band of the price no wider than `MAX_KEEPER_BAND_BPS`, and — where the same message lays the range — into a range
 * that holds that band. The program is the first lock; this is the second; the person's approval total is the third.
 *
 * Nothing here signs or sends.
 */

import {
  DlmmProIDL,
  MAX_SQRT_PRICE,
  MIN_SQRT_PRICE,
  PoolExtension,
  PositionDelegatePermission,
  calculateTransferFeeExcludedAmount,
  derivePosition,
  findNftAccount,
  getAmountsFromLiquidity,
  getSqrtPriceFromTickId,
  isSupportExtension,
  liquidityBitmap,
  positionDelegatePermissionMask,
  tickIdFromSqrtPrice,
  type DecodedPosition,
  type DecodedPositionWithReward,
  type Pool,
} from "@meteora-ag/dlmm-pro-sdk";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createApproveCheckedInstruction,
  createApproveInstruction,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  type Mint,
} from "@solana/spl-token";
import { ComputeBudgetProgram, PublicKey, TransactionMessage, VersionedMessage, type TransactionInstruction } from "@solana/web3.js";
import BN from "bn.js";

import type { Address } from "../../contracts.ts";
import type { CareSubject } from "./care-rules.server.ts";
import { CARE_RIGHTS } from "./earn.server.ts";
import {
  DLMM_PRO_ACCOUNT_BYTES,
  TOKEN_ACCOUNT_BYTES,
  TOKEN_ACCOUNT_DELEGATED_AMOUNT_OFFSET,
  TOKEN_ACCOUNT_DELEGATE_OFFSET,
  assertAffords,
  assertHolds,
  assertSigner,
  clientPastDust,
  clockOf,
  decimalsOf,
  missingTickArrays,
  poolWhole,
  tokenProgramOf,
  transferFeeMintOf,
  type DlmmProContext,
} from "./pools.server.ts";
import type { PositionPermission } from "./positions.server.ts";
import { DLMM_PRO_PROGRAM, DlmmProRefusal, refusing } from "./sdk.server.ts";
import { MAX_POSITION_RANGES, MAX_TICK_ID, MIN_TICK_ID, alignTickDown, isqrt } from "./ticks.ts";
import { DLMM_PRO_UNITS, MAX_PRIORITY_FEE_LAMPORTS, MAX_TX_UNITS, bpsOf, keyOf, rawOf, seal, sealPacked, unitsOf, type DlmmProTx, type SealOptions } from "./tx.server.ts";

/** What a keeper that puts back may do: a care's three rights, and laying a range with the person's money. */
export const KEEPER_RIGHTS = [...CARE_RIGHTS, "addLiquidity", "updateRange"] as const satisfies readonly PositionPermission[];

/** The widest band of the price a keeper's removal or deposit may be built for, bps of the price either way. */
export const MAX_KEEPER_BAND_BPS = 200;

/** The bounds of the person's signed once, as the builder and the lock read them (`lib/care/range-limits.ts`). */
export type KeeperBounds = Readonly<{ narrowestBps: number; widestBps: number; maxPutBackPerShift: Readonly<{ xRaw: string; yRaw: string }> }>;

export type TickRangeView = Readonly<{ tickLowerId: number; tickUpperId: number }>;

/* ------------------------------------------------------------------ ticks */

/** A price is 1.0001 to the power of its tick: the ticks a ratio of `1 + bps` spans. */
const ticksOfBps = (bps: number) => Math.log1p(bps / 10_000) / Math.log(1.0001);

/** The multiple of the spacing at or above a tick. */
const alignTickUp = (tickId: number, tickSpacing: number) => Math.ceil(tickId / tickSpacing) * tickSpacing + 0;

/**
 * The range of `halfWidthBps` around a tick, on the pool's spacing: the lower end rounded down and the upper rounded
 * up, so a range is never narrower than asked — and the price at `centerTick` is inside it.
 */
export function keeperTicksOf(centerTick: number, halfWidthBps: number, tickSpacing: number): TickRangeView {
  const span = Math.ceil(ticksOfBps(halfWidthBps));
  const lower = Math.max(alignTickUp(MIN_TICK_ID, tickSpacing), alignTickDown(centerTick - span, tickSpacing));
  const upper = Math.min(alignTickDown(MAX_TICK_ID, tickSpacing), Math.max(alignTickUp(centerTick + span, tickSpacing), lower + tickSpacing));
  /* `+ 0` — never a negative zero. */
  return { tickLowerId: lower + 0, tickUpperId: upper + 0 };
}

/** The half-width of a range in bps of the price, from its ticks. */
export function halfWidthBpsOf(range: TickRangeView): number {
  return Math.round((Math.pow(1.0001, (range.tickUpperId - range.tickLowerId) / 2) - 1) * 10_000);
}

/**
 * The widths a range may have, in ticks, under the bounds: the narrowest half-width's span either way, less the
 * nothing the spacing can take off; the widest's, plus a spacing at each end the alignment can add.
 */
export function keeperWidthTicks(bounds: Pick<KeeperBounds, "narrowestBps" | "widestBps">, tickSpacing: number): Readonly<{ min: number; max: number }> {
  return { min: 2 * Math.floor(ticksOfBps(bounds.narrowestBps)), max: 2 * Math.ceil(ticksOfBps(bounds.widestBps)) + 2 * tickSpacing };
}

/* ------------------------------------------------------------------ the second lock */

type Layout = Readonly<{ discriminator: Uint8Array; index: Readonly<Record<string, number>> }>;
const layoutOf = (name: string): Layout => {
  const instruction = DlmmProIDL.instructions.find((entry) => entry.name === name);
  if (!instruction) throw new Error(`The IDL has no instruction ${name}.`);
  return { discriminator: Uint8Array.from(instruction.discriminator), index: Object.fromEntries(instruction.accounts.map((account, at) => [account.name, at])) };
};

const PAYS_XY = [
  ["user_token_x", "token_x_mint", "token_x_program"],
  ["user_token_y", "token_y_mint", "token_y_program"],
] as const;

/** The calls of a keeper's move, with where each names the pool, the position, its signer, and the accounts it pays into or takes from. */
const CALLS = Object.freeze({
  refresh: { ...layoutOf("refresh_fees_and_rewards"), pays: [] as const },
  claimFee: { ...layoutOf("claim_fee"), pays: PAYS_XY },
  claimReward: { ...layoutOf("claim_reward"), pays: [["user_token_account", "reward_mint", "token_program"]] as const },
  removeLiquidity: { ...layoutOf("remove_liquidity_by_bps"), pays: PAYS_XY },
  expand: { ...layoutOf("expand_position"), pays: [] as const },
  deposit: { ...layoutOf("add_liquidity_imbalance"), pays: PAYS_XY },
  removeRanges: { ...layoutOf("remove_position"), pays: [] as const },
});

export type KeeperCall = keyof typeof CALLS;

const starts = (data: Uint8Array, head: Uint8Array) => head.length <= data.length && head.every((byte, index) => data[index] === byte);
const isTokenProgram = (key: PublicKey) => key.equals(TOKEN_PROGRAM_ID) || key.equals(TOKEN_2022_PROGRAM_ID);

/** Which of a keeper's calls an instruction of the program is; null for any other. */
export function keeperCallOf(data: Uint8Array): KeeperCall | null {
  for (const name of Object.keys(CALLS) as KeeperCall[]) if (starts(data, CALLS[name].discriminator)) return name;
  return null;
}

/** A little reader of the program's own Borsh: what the lock needs of two calls' arguments, and nothing it does not. */
class Reader {
  private at: number;
  private readonly data: Buffer;
  constructor(data: Buffer, start = 8) {
    this.data = data;
    this.at = start;
  }
  private need(bytes: number) {
    if (this.at + bytes > this.data.length) throw new RangeError("short");
  }
  u8() {
    this.need(1);
    return this.data.readUInt8(this.at++);
  }
  u16() {
    this.need(2);
    const value = this.data.readUInt16LE(this.at);
    this.at += 2;
    return value;
  }
  u32() {
    this.need(4);
    const value = this.data.readUInt32LE(this.at);
    this.at += 4;
    return value;
  }
  i32() {
    this.need(4);
    const value = this.data.readInt32LE(this.at);
    this.at += 4;
    return value;
  }
  u64() {
    this.need(8);
    const value = this.data.readBigUInt64LE(this.at);
    this.at += 8;
    return value;
  }
  u128() {
    const low = this.u64();
    return (this.u64() << 64n) | low;
  }
  option<T>(read: () => T): T | null {
    const tag = this.u8();
    if (tag === 0) return null;
    if (tag !== 1) throw new RangeError("tag");
    return read();
  }
}

/** `expand_position`'s ranges. */
export function expandRangesOf(data: Uint8Array): TickRangeView[] {
  const reader = new Reader(Buffer.from(data));
  const count = reader.u32();
  if (count > MAX_POSITION_RANGES) throw new RangeError("count");
  return Array.from({ length: count }, () => ({ tickLowerId: reader.i32(), tickUpperId: reader.i32() }));
}

/** `add_liquidity_imbalance`'s caps and band. */
export function depositTermsOf(data: Uint8Array): Readonly<{ maxAmountX: bigint | null; maxAmountY: bigint | null; band: Readonly<{ min: bigint; max: bigint }> | null; minLiquidity: bigint | null; index: number }> {
  const reader = new Reader(Buffer.from(data));
  const maxAmountX = reader.option(() => reader.u64());
  const maxAmountY = reader.option(() => reader.u64());
  const band = reader.option(() => ({ min: reader.u128(), max: reader.u128() }));
  const minLiquidity = reader.option(() => reader.u128());
  reader.option(() => reader.u16());
  return { maxAmountX, maxAmountY, band, minLiquidity, index: reader.u8() };
}

/** A keeper as its lock reads it: a care's subject, the pool's tick spacing, and the bounds the person signed. */
export type KeeperSubject = CareSubject & Readonly<{ tickSpacing: number; bounds: KeeperBounds }>;

type Subject = Readonly<{ agent: PublicKey; owner: PublicKey; pool: PublicKey; nftAccount: PublicKey; position: PublicKey }>;

function callRefusal(instruction: TransactionInstruction, subject: Subject, keeper: KeeperSubject): string | null {
  const name = keeperCallOf(instruction.data);
  if (!name) return "a call of the program that is not a keeper's";
  const call = CALLS[name];
  const at = (account: string) => instruction.keys[call.index[account] ?? -1]?.pubkey ?? null;
  if (!at("pool")?.equals(subject.pool)) return "a call on another pool";
  if (!at("position")?.equals(subject.position) || !at("nft_account")?.equals(subject.nftAccount)) return "a call on another position";
  if (!at("signer")?.equals(subject.agent)) return "a call the agent does not sign";
  /* Out of the pool — paid to the owner's own accounts; into it — taken from the owner's own accounts, and nobody else's. */
  for (const [account, mint, program] of call.pays) {
    const pays = at(account);
    const coin = at(mint);
    const tokenProgram = at(program);
    if (!pays || !coin || !tokenProgram || !isTokenProgram(tokenProgram)) return "a call that does not name the owner's accounts";
    if (!pays.equals(getAssociatedTokenAddressSync(coin, subject.owner, true, tokenProgram))) return name === "deposit" ? "a deposit from an account other than the owner's own" : "a call that pays an account other than the owner's own";
  }
  if (name === "expand") {
    if (!at("payer")?.equals(subject.agent)) return "a new range the agent does not pay for";
    let ranges: TickRangeView[];
    try {
      ranges = expandRangesOf(instruction.data);
    } catch {
      return "a new range that cannot be read";
    }
    if (ranges.length !== 1) return "more than one new range at a time";
    const width = ranges[0]!.tickUpperId - ranges[0]!.tickLowerId;
    const allowed = keeperWidthTicks(keeper.bounds, keeper.tickSpacing);
    if (width < allowed.min) return "a range narrower than the person allowed";
    if (width > allowed.max) return "a range wider than the person allowed";
  }
  if (name === "deposit") {
    let terms: ReturnType<typeof depositTermsOf>;
    try {
      terms = depositTermsOf(instruction.data);
    } catch {
      return "a deposit that cannot be read";
    }
    const caps = keeper.bounds.maxPutBackPerShift;
    if ((terms.maxAmountX ?? 0n) > BigInt(caps.xRaw) || (terms.maxAmountY ?? 0n) > BigInt(caps.yRaw)) return "a deposit over what the person allowed a move to put back";
    if (!terms.band) return "a deposit with no band of the price";
    /* The band's ends are square-root prices: the ratio of its two prices is their squares', at most (1 + b) / (1 − b). */
    const { min, max } = terms.band;
    if (max < min || max * max * BigInt(10_000 - MAX_KEEPER_BAND_BPS) > min * min * BigInt(10_000 + MAX_KEEPER_BAND_BPS)) return "a deposit with a band of the price wider than a keeper's";
  }
  if (name === "removeRanges") {
    const receiver = instruction.keys[call.index.rent_receiver ?? -1]?.pubkey ?? null;
    if (!receiver?.equals(subject.owner)) return "a deleted range's rent to someone other than the owner";
  }
  return null;
}

/**
 * Why the message is not one a keeper's agent signs; null when it is. Pure but for the SDK's IDL: no I/O, no clock.
 * A keeper whose bounds put nothing back signs no new range and no deposit.
 */
export function keeperRefusalOf(message: Uint8Array, keeper: KeeperSubject): string | null {
  let decoded: VersionedMessage;
  try {
    decoded = VersionedMessage.deserialize(message);
  } catch {
    return "not a transaction message";
  }
  const agent = new PublicKey(keeper.agent);
  const owner = new PublicKey(keeper.owner);
  const nftMint = new PublicKey(keeper.nftMint);
  const program = new PublicKey(DLMM_PRO_PROGRAM);
  const subject: Subject = { agent, owner, pool: new PublicKey(keeper.pool), nftAccount: findNftAccount(nftMint, owner), position: derivePosition(nftMint, program) };
  if (agent.equals(owner)) return "the agent is not the position's owner";
  if (decoded.header.numRequiredSignatures !== 1 || !decoded.staticAccountKeys[0]?.equals(agent)) return "the agent is not the one payer and signer";
  if (decoded.addressTableLookups.length > 0) return "the message reads a lookup table";
  const putsBack = BigInt(keeper.bounds.maxPutBackPerShift.xRaw) > 0n || BigInt(keeper.bounds.maxPutBackPerShift.yRaw) > 0n;
  let instructions: TransactionInstruction[];
  try {
    instructions = TransactionMessage.decompile(decoded).instructions;
  } catch {
    return "the message cannot be read";
  }
  let acts = 0;
  let laid: TickRangeView | null = null;
  const deposits: ReturnType<typeof depositTermsOf>[] = [];
  let units = 200_000n;
  let price = 0n;
  for (const instruction of instructions) {
    const data = Buffer.from(instruction.data);
    if (instruction.programId.equals(ComputeBudgetProgram.programId)) {
      if (data[0] === 2 && data.length === 5) units = BigInt(data.readUInt32LE(1));
      else if (data[0] === 3 && data.length === 9) price = data.readBigUInt64LE(1);
      else return "a compute-budget setting other than the limit and the price";
      continue;
    }
    if (instruction.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)) {
      const [payer, account, holder, mint, , tokenProgram] = instruction.keys.map((key) => key.pubkey);
      if (data.length !== 1 || data[0] !== 1) return "a token account opened other than idempotently";
      if (!payer?.equals(agent)) return "a token account paid by someone other than the agent";
      if (!holder?.equals(owner)) return "a token account opened for someone other than the owner";
      if (!mint || !tokenProgram || !isTokenProgram(tokenProgram) || !account?.equals(getAssociatedTokenAddressSync(mint, owner, true, tokenProgram))) return "a token account that is not the owner's own";
      if (keeper.mints && !keeper.mints.includes(mint.toBase58())) return "a token account of a coin that is not the pool's";
      continue;
    }
    if (!instruction.programId.equals(program)) return "an instruction outside the keeper's";
    const refusal = callRefusal(instruction, subject, keeper);
    if (refusal) return refusal;
    const name = keeperCallOf(instruction.data)!;
    if ((name === "expand" || name === "deposit") && !putsBack) return "a keeper that only takes out lays no range and puts nothing back";
    if (name === "expand") {
      if (laid) return "more than one new range at a time";
      laid = expandRangesOf(instruction.data)[0]!;
    }
    if (name === "deposit") {
      if (deposits.length > 0) return "more than one deposit in a move";
      deposits.push(depositTermsOf(instruction.data));
    }
    if (name !== "refresh") acts += 1;
  }
  /* Where the move lays its range, the deposit's band is inside it: the person's money goes in around the price, nowhere else. */
  if (laid && deposits[0]?.band) {
    const low = tickIdFromSqrtPrice(new BN(deposits[0].band.min.toString()));
    const high = tickIdFromSqrtPrice(new BN(deposits[0].band.max.toString()));
    if (low < laid.tickLowerId || high >= laid.tickUpperId) return "a deposit whose band of the price is outside the range laid";
  }
  if (acts === 0) return "no call of a keeper's move";
  if (units > BigInt(MAX_TX_UNITS) || (units * price) / 1_000_000n > BigInt(MAX_PRIORITY_FEE_LAMPORTS)) return "the compute budget is outside the agent's ceiling";
  return null;
}

/* ------------------------------------------------------------------ the builds */

const bn = (value: bigint | number | string) => new BN(value.toString());
const big = (value: BN) => BigInt(value.toString());

export type KeeperRole = "OUT" | "IN";
export type KeeperStep = DlmmProTx & Readonly<{ roles: readonly KeeperRole[] }>;

export type KeeperMoveBuild = Readonly<{
  /** Signed by the agent alone, sent in order; a step that fails leaves what the steps before it paid in the owner's wallet. */
  steps: readonly KeeperStep[];
  /** The range laid — null when nothing is put back (a keeper that only takes out, or a removal that paid one coin). */
  target: TickRangeView | null;
  halfWidthBps: number | null;
  /** The slots taken out of, and the slots deleted. */
  emptied: readonly number[];
  deleted: readonly number[];
  /** What the removal pays the owner at the price now, and at least anywhere in its band, raw, after transfer fees. */
  takesOut: Readonly<{ expected: Readonly<{ xRaw: string; yRaw: string }>; minimum: Readonly<{ xRaw: string; yRaw: string }> }>;
  /** The fees the move collects to the owner, raw. */
  fees: Readonly<{ xRaw: string; yRaw: string }>;
  /** The most the deposit may take from the owner's accounts, raw, transfer fees included; zero — nothing put back. The program takes the most liquidity both afford: what does not fit the range at the price stays in her wallet. */
  putsBack: Readonly<{ xRaw: string; yRaw: string }>;
  /** Why nothing is put back though the bounds allow it; null — it is, or the bounds put nothing back. */
  heldBack: "one-coin" | "nothing-out" | null;
  /** What the move costs the agent: the network, and the rent it puts up that stays, lamports. */
  costLamports: number;
  rentLamports: number;
}>;

/** The two calls of an SPL approval the person signs for the agent to put her money back — one per coin, only where the bounds put that coin back. */
export type KeeperApprovalBuild = DlmmProTx & Readonly<{ rentLamports: number; rentReturnedLamports: number; unwrapsLamports: string | null; rights: readonly PositionPermission[]; approval: Readonly<{ xRaw: string; yRaw: string }> }>;

export function createDlmmProRange(context: DlmmProContext) {
  const { connection, client } = context;
  const programId = client.program.programId;

  async function loaded(poolKey: PublicKey, nftMint: PublicKey) {
    const { pool } = await poolWhole(context, poolKey);
    const withReward = isSupportExtension(pool.extensions, PoolExtension.LiquidityMining);
    const positionKey = derivePosition(nftMint, programId);
    const missing = (error: unknown) => {
      if (error instanceof Error && /Account not found|is not owned by|Invalid account discriminator/i.test(error.message)) throw new DlmmProRefusal("BAD_INPUT", "No position lives at this NFT.");
      throw error;
    };
    const head = await client.state.fetchPositionArray(positionKey).catch(missing);
    if (!head.pool.equals(poolKey)) throw new DlmmProRefusal("BAD_INPUT", "The position belongs to another pool.");
    const read = await client.state.fetchPositionArrayWithPositions(positionKey, { withReward }).catch(missing);
    return { pool, withReward, head: read.positionArray, slots: read.positions as readonly (DecodedPosition & Partial<DecodedPositionWithReward>)[] };
  }

  const coinsOf = (pool: Pool) => [
    { mint: pool.tokenXMint, program: tokenProgramOf(pool.tokenXFlag) },
    { mint: pool.tokenYMint, program: tokenProgramOf(pool.tokenYFlag) },
  ];
  const mayOf = (delegatePermission: number, name: PositionPermission) => {
    const bit = { addLiquidity: PositionDelegatePermission.AddLiquidity, removeLiquidity: PositionDelegatePermission.RemoveLiquidity, claimFee: PositionDelegatePermission.ClaimFee, claimReward: PositionDelegatePermission.ClaimReward, updateRange: PositionDelegatePermission.UpdatePositionRange }[name];
    return (delegatePermission & (1 << bit)) !== 0;
  };
  /** The two ends of a band of the price around `sqrtPrice`, as square-root prices, inside the program's own limits. */
  const bandOf = (sqrtPrice: bigint, bps: number) => {
    const square = sqrtPrice * sqrtPrice;
    const within = (value: bigint) => (value < big(MIN_SQRT_PRICE) ? big(MIN_SQRT_PRICE) : value > big(MAX_SQRT_PRICE) ? big(MAX_SQRT_PRICE) : value);
    return { low: within(isqrt((square * BigInt(10_000 - bps)) / 10_000n)), high: within(isqrt((square * BigInt(10_000 + bps)) / 10_000n)) };
  };
  const worthAt = (sqrtPrice: bigint, slot: DecodedPosition, liquidity: BN) =>
    getAmountsFromLiquidity({ tickCurrentId: tickIdFromSqrtPrice(bn(sqrtPrice)), tickLowerId: slot.tickLowerId, tickUpperId: slot.tickUpperId, currentSqrtPrice: bn(sqrtPrice), liquidity: liquidity.neg() });
  /** What an amount of a coin is once its own transfer fee is taken: what arrives. */
  const arrives = (amount: bigint, mint: Mint | null, epoch: bigint) => (amount === 0n ? 0n : big(calculateTransferFeeExcludedAmount(mint, epoch, bn(amount)).amount));
  const sameRange = (slot: TickRangeView, range: TickRangeView) => slot.tickLowerId === range.tickLowerId && slot.tickUpperId === range.tickUpperId;
  const locked = (slot: DecodedPosition) => !slot.permanentLockedLiquidity.isZero() || !slot.vestingLiquidity.isZero();

  /** The owner's account of a coin, as the program pays into it and as the agent's approval stands on it. */
  async function approvalOn(owner: PublicKey, mint: PublicKey, program: PublicKey, agent: PublicKey): Promise<Readonly<{ balance: bigint; approved: bigint }>> {
    const info = await connection.getAccountInfo(getAssociatedTokenAddressSync(mint, owner, true, program), "confirmed");
    if (!info || !info.owner.equals(program) || info.data.length < TOKEN_ACCOUNT_BYTES) return { balance: 0n, approved: 0n };
    const data = Buffer.from(info.data);
    const delegated = data.readUInt32LE(TOKEN_ACCOUNT_DELEGATE_OFFSET) === 1 && new PublicKey(data.subarray(TOKEN_ACCOUNT_DELEGATE_OFFSET + 4, TOKEN_ACCOUNT_DELEGATE_OFFSET + 36)).equals(agent);
    return { balance: data.readBigUInt64LE(64), approved: delegated ? data.readBigUInt64LE(TOKEN_ACCOUNT_DELEGATED_AMOUNT_OFFSET) : 0n };
  }

  /**
   * The person's one signature for a keeper: the agent approved on the position's NFT account (amount 0, as the
   * program asks) with the keeper's rights — a care's three where nothing is put back — and, where the bounds put a
   * coin back, an SPL approval of `approval` of it on her own account, the agent its authority. Her accounts that are
   * not there yet are opened by her, so the approval has somewhere to stand.
   *
   * An SPL account has one approval at a time: this replaces any other on the same two accounts.
   */
  async function approve(request: Readonly<{ pool: Address; nftMint: Address; owner: Address; agent: Address; approval: Readonly<{ xRaw: string; yRaw: string }> }>, options: SealOptions = {}): Promise<KeeperApprovalBuild> {
    return refusing(async () => {
      const poolKey = keyOf(request.pool, "The pool");
      const nftMint = keyOf(request.nftMint, "The position's NFT");
      const owner = keyOf(request.owner, "The owner");
      const agent = keyOf(request.agent, "The agent");
      if (agent.equals(owner)) throw new DlmmProRefusal("BAD_INPUT", "The agent is not the position's owner.");
      const x = rawOf(request.approval.xRaw, "The approval of token X");
      const y = rawOf(request.approval.yRaw, "The approval of token Y");
      const { pool } = await loaded(poolKey, nftMint);
      await assertHolds(connection, nftMint, owner, "the position");
      const putsBack = x > 0n || y > 0n;
      const rights: readonly PositionPermission[] = putsBack ? KEEPER_RIGHTS : CARE_RIGHTS;
      const bits = { addLiquidity: PositionDelegatePermission.AddLiquidity, removeLiquidity: PositionDelegatePermission.RemoveLiquidity, claimFee: PositionDelegatePermission.ClaimFee, claimReward: PositionDelegatePermission.ClaimReward, updateRange: PositionDelegatePermission.UpdatePositionRange };
      const permission = await client.position.updatePositionDelegatePermission({ nftMint, owner, permission: positionDelegatePermissionMask(rights.map((name) => bits[name])) });
      const instructions: TransactionInstruction[] = [createApproveInstruction(findNftAccount(nftMint, owner), agent, owner, 0, [], TOKEN_2022_PROGRAM_ID), ...permission.tx.instructions];
      const decimals = await decimalsOf(connection, [pool.tokenXMint, pool.tokenYMint]);
      for (const [index, coin] of coinsOf(pool).entries()) {
        const amount = index === 0 ? x : y;
        if (amount === 0n) continue;
        const account = getAssociatedTokenAddressSync(coin.mint, owner, true, coin.program);
        instructions.push(createAssociatedTokenAccountIdempotentInstruction(owner, account, owner, coin.mint, coin.program, ASSOCIATED_TOKEN_PROGRAM_ID));
        instructions.push(createApproveCheckedInstruction(account, coin.mint, agent, owner, amount, decimals.get(coin.mint.toBase58()) ?? 0, [], coin.program));
      }
      const sealed = await seal({ connection, wallet: owner, instructions, units: DLMM_PRO_UNITS.delegate + 2 * DLMM_PRO_UNITS.tokenAccount, options });
      const cost = await assertAffords(connection, owner, [], { fee: BigInt(sealed.feeLamports), instructions });
      return { ...sealed, ...cost, rights, approval: { xRaw: x.toString(), yRaw: y.toString() } };
    });
  }

  /**
   * One move of the range, for the agent to sign: everything out of the ranges that are not the one asked for, to the
   * owner; and — where `bounds` put anything back — the range asked for laid around the price and the person's money
   * put back into it from her own accounts, inside the bounds and her approval.
   *
   * `halfWidthBps` — the range asked for, inside the bounds; `centerSqrtPriceX64` — its centre (the exchange's reference
   * as the pool's square-root price), absent — the pool's own price; `slippageBps` — the band of the price the removal
   * and the deposit are held to; `topUp` — what the person's wallet holds from an earlier take-out, to put back too.
   * `pull: true` — out only, from every range: the keeper steps out of the pool.
   */
  async function move(
    request: Readonly<{
      pool: Address;
      nftMint: Address;
      owner: Address;
      agent: Address;
      bounds: KeeperBounds;
      halfWidthBps?: number;
      centerSqrtPriceX64?: string;
      slippageBps: number;
      topUp?: Readonly<{ xRaw: string; yRaw: string }>;
      pull?: boolean;
    }>,
    options: SealOptions = {},
  ): Promise<KeeperMoveBuild> {
    return refusing(async () => {
      const poolKey = keyOf(request.pool, "The pool");
      const nftMint = keyOf(request.nftMint, "The position's NFT");
      const owner = keyOf(request.owner, "The owner");
      const agent = keyOf(request.agent, "The agent");
      if (agent.equals(owner)) throw new DlmmProRefusal("BAD_INPUT", "The agent is not the position's owner.");
      const slippageBps = bpsOf(request.slippageBps, "The band of the price", 0, MAX_KEEPER_BAND_BPS);
      const caps = { x: rawOf(request.bounds.maxPutBackPerShift.xRaw, "The put-back of token X"), y: rawOf(request.bounds.maxPutBackPerShift.yRaw, "The put-back of token Y") };
      const topUp = { x: rawOf(request.topUp?.xRaw ?? "0", "The top-up of token X"), y: rawOf(request.topUp?.yRaw ?? "0", "The top-up of token Y") };
      const putsBack = !request.pull && (caps.x > 0n || caps.y > 0n);
      const state = await loaded(poolKey, nftMint);
      const { pool, head, slots } = state;

      /* The range asked for, and that it is one the person allowed. */
      let target: TickRangeView | null = null;
      if (!request.pull) {
        const half = request.halfWidthBps;
        if (typeof half !== "number" || !Number.isFinite(half) || half < request.bounds.narrowestBps || half > request.bounds.widestBps) throw new DlmmProRefusal("BAD_INPUT", "The range asked for is outside the bounds the person signed.");
        let centerTick = pool.tickCurrentId;
        if (request.centerSqrtPriceX64 !== undefined) {
          if (!/^\d{1,40}$/.test(request.centerSqrtPriceX64)) throw new DlmmProRefusal("BAD_INPUT", "The centre is not a square-root price.");
          const center = BigInt(request.centerSqrtPriceX64);
          if (center < big(MIN_SQRT_PRICE) || center > big(MAX_SQRT_PRICE)) throw new DlmmProRefusal("BAD_INPUT", "The centre is outside the program's own limits.");
          centerTick = tickIdFromSqrtPrice(bn(center));
        }
        target = keeperTicksOf(centerTick, half, pool.tickSpacing);
        const width = keeperWidthTicks(request.bounds, pool.tickSpacing);
        const span = target.tickUpperId - target.tickLowerId;
        if (span < width.min || span > width.max) throw new DlmmProRefusal("BAD_INPUT", "The pool's tick spacing cannot lay a range inside the bounds the person signed.");
      }

      /* The rights the move needs, on the position itself, and the agent the approved delegate. */
      const needs: PositionPermission[] = ["removeLiquidity", "claimFee", ...(putsBack ? (["addLiquidity", "updateRange"] as const) : [])];
      await assertSigner(connection, nftMint, owner, agent, needs.every((name) => mayOf(head.delegatePermission, name)), "the position");

      /* Out: every slot that is not the one asked for and holds unlocked liquidity. */
      const keep = target ? slots.findIndex((slot) => sameRange(slot, target!)) : -1;
      const emptied = slots.map((slot, index) => ({ slot, index })).filter(({ slot, index }) => index !== keep && !slot.unlockedLiquidity.isZero()).map(({ index }) => index);
      const coins = coinsOf(pool);
      const [mintX, mintY, clock] = await Promise.all([transferFeeMintOf(connection, pool.tokenXMint), transferFeeMintOf(connection, pool.tokenYMint), clockOf(context)]);
      const out: TransactionInstruction[] = [];
      let outUnits = 0;
      const claimable = await client.position.getClaimableFees({ pool: poolKey, nftMint });
      const sdk = await clientPastDust(context, [owner], coins);
      if (!claimable.feeX.isZero() || !claimable.feeY.isZero()) {
        const claimed = await sdk.position.claimFee({ pool: poolKey, nftMint, owner, signer: agent, tokenXMint: pool.tokenXMint, tokenYMint: pool.tokenYMint, tickRanges: claimable.tickRanges, bitmap: claimable.bitmap });
        out.push(...claimed.tx.instructions);
        outUnits += unitsOf(DLMM_PRO_UNITS.claimFee.base, DLMM_PRO_UNITS.claimFee.perRange, claimable.tickRanges.length, 2 * DLMM_PRO_UNITS.tokenAccount);
      }
      const now = { x: 0n, y: 0n };
      const least = { x: 0n, y: 0n };
      if (emptied.length > 0) {
        const band = bandOf(big(pool.sqrtPrice), slippageBps);
        const paysAt = (sqrtPrice: bigint) =>
          emptied.reduce(
            (sum, index) => {
              const worth = worthAt(sqrtPrice, slots[index]!, slots[index]!.unlockedLiquidity);
              return { x: sum.x + big(worth.amountX), y: sum.y + big(worth.amountY) };
            },
            { x: 0n, y: 0n },
          );
        const here = paysAt(big(pool.sqrtPrice));
        /* Of token X a removal pays least at the band's high end, of token Y at its low end. */
        const low = slippageBps === 0 ? here : { x: paysAt(band.high).x, y: paysAt(band.low).y };
        now.x = arrives(here.x, mintX, clock.epoch);
        now.y = arrives(here.y, mintY, clock.epoch);
        least.x = arrives(low.x, mintX, clock.epoch);
        least.y = arrives(low.y, mintY, clock.epoch);
        const removed = await sdk.position.removeLiquidityByBps({
          pool: poolKey,
          nftMint,
          owner,
          signer: agent,
          tokenXMint: pool.tokenXMint,
          tokenYMint: pool.tokenYMint,
          tickRanges: emptied.map((index) => ({ tickLowerId: slots[index]!.tickLowerId, tickUpperId: slots[index]!.tickUpperId })),
          parameters: { minAmountX: bn(least.x), minAmountY: bn(least.y), expectedLayoutVersion: head.layoutVersion, bps: 10_000, bitmap: liquidityBitmap(emptied) },
        });
        out.push(...removed.tx.instructions);
        outUnits += unitsOf(DLMM_PRO_UNITS.removeLiquidity.base, DLMM_PRO_UNITS.removeLiquidity.perRange, emptied.length, 2 * DLMM_PRO_UNITS.tokenAccount);
      }

      /*
       * In: up to what the removal pays at the price the move is built at, and the wallet's top-up — both coins, or
       * nothing. The program takes the most liquidity both caps afford at the price it lands at; where the removal paid
       * a little less (the price moved inside its band), the difference comes from her wallet, never past the caps.
       */
      const putX = now.x + topUp.x < caps.x ? now.x + topUp.x : caps.x;
      const putY = now.y + topUp.y < caps.y ? now.y + topUp.y : caps.y;
      const heldBack = !putsBack ? null : putX === 0n && putY === 0n ? "nothing-out" : putX === 0n || putY === 0n ? "one-coin" : null;
      const into: TransactionInstruction[] = [];
      let inUnits = 0;
      let deleted: number[] = [];
      let laysNew = false;
      if (putsBack && heldBack === null && target) {
        /* What the person's wallet and approval hold for the deposit, after the removal pays in. */
        const [onX, onY] = await Promise.all([approvalOn(owner, pool.tokenXMint, coins[0]!.program, agent), approvalOn(owner, pool.tokenYMint, coins[1]!.program, agent)]);
        if (onX.approved < putX || onY.approved < putY) throw new DlmmProRefusal("BAD_INPUT", "The person's approval does not cover this move: she renews it, or the money waits in her wallet.");
        if (onX.balance + now.x < putX || onY.balance + now.y < putY) throw new DlmmProRefusal("BALANCE_LOW", "The person's wallet does not hold what this move would put back.");
        laysNew = keep < 0;
        const index = laysNew ? slots.length : keep;
        if (laysNew) {
          if (slots.length >= MAX_POSITION_RANGES) throw new DlmmProRefusal("BAD_INPUT", `The position holds ${MAX_POSITION_RANGES} ranges already: none can be laid.`);
          const expanded = await client.position.expandPosition({ pool: poolKey, signer: agent, payer: agent, nftMint, owner, tickRanges: [target] });
          into.push(...expanded.tx.instructions);
          inUnits += unitsOf(DLMM_PRO_UNITS.openPosition.base, DLMM_PRO_UNITS.openPosition.perTick, 2, 2 * DLMM_PRO_UNITS.openPosition.perArray);
        }
        const band = bandOf(big(pool.sqrtPrice), slippageBps);
        const ownerX = getAssociatedTokenAddressSync(pool.tokenXMint, owner, true, coins[0]!.program);
        const ownerY = getAssociatedTokenAddressSync(pool.tokenYMint, owner, true, coins[1]!.program);
        const deposited = await sdk.position.addLiquidityImbalance({
          pool: poolKey,
          nftMint,
          owner,
          signer: agent,
          tokenXMint: pool.tokenXMint,
          tokenYMint: pool.tokenYMint,
          userTokenX: ownerX,
          userTokenY: ownerY,
          tickRanges: [target],
          parameters: { maxAmountX: bn(putX), maxAmountY: bn(putY), slippage: { sqrtPriceSlippage: { minSqrtPrice: bn(band.low), maxSqrtPrice: bn(band.high) }, minLiquidity: null }, expectedLayoutVersion: null, index },
        });
        into.push(...deposited.tx.instructions);
        inUnits += DLMM_PRO_UNITS.addLiquidityAtLanding.base + 2 * DLMM_PRO_UNITS.tokenAccount;
        /* The ranges emptied, deleted — their rent to the owner. Not on a pool with rewards: a pending reward keeps a range until it is collected. */
        if (!state.withReward) {
          deleted = emptied.filter((index) => !locked(slots[index]!));
          if (deleted.length > 0) {
            const ranges = deleted.map((at) => ({ tickLowerId: slots[at]!.tickLowerId, tickUpperId: slots[at]!.tickUpperId }));
            const removedRanges = await client.position.removePosition({ pool: poolKey, signer: agent, nftMint, owner, rentReceiver: owner, tickRanges: ranges, parameters: { expectedLayoutVersion: null, bitmap: liquidityBitmap(deleted) } });
            into.push(...removedRanges.tx.instructions);
            inUnits += unitsOf(DLMM_PRO_UNITS.closePosition.base, DLMM_PRO_UNITS.closePosition.perRange, deleted.length);
          }
        }
      }
      if (out.length === 0 && into.length === 0) throw new DlmmProRefusal("NOTHING_TO_DO", "The position is already as asked, or holds nothing the agent may move.");

      const parts = [...(out.length ? [{ role: "OUT" as const, instructions: out, units: outUnits }] : []), ...(into.length ? [{ role: "IN" as const, instructions: into, units: inUnits }] : [])];
      const steps = await sealPacked({ connection, wallet: agent, parts, options });
      /* What stays of the rent the agent puts up: a new range's slot and its two ticks, and a head for each tick array that is not there yet. */
      const sizes = DLMM_PRO_ACCOUNT_BYTES;
      const arrays = laysNew && target ? await missingTickArrays(context, poolKey, [target.tickLowerId, target.tickUpperId], pool.tickSpacing) : 0;
      const fee = steps.reduce((sum, step) => sum + BigInt(step.feeLamports), 0n);
      const cost = await assertAffords(connection, agent, [], {
        fee,
        instructions: [...out, ...into],
        accounts: Array.from({ length: arrays }, () => sizes.tickArrayHead),
        bytes: laysNew ? (state.withReward ? sizes.positionSlotWithRewards + 2 * sizes.tickWithRewards : sizes.positionSlot + 2 * sizes.tick) : 0,
      });
      return {
        steps,
        target: putsBack && heldBack === null ? target : null,
        halfWidthBps: putsBack && heldBack === null && target ? halfWidthBpsOf(target) : null,
        emptied,
        deleted,
        takesOut: { expected: { xRaw: now.x.toString(), yRaw: now.y.toString() }, minimum: { xRaw: least.x.toString(), yRaw: least.y.toString() } },
        fees: { xRaw: claimable.feeX.toString(), yRaw: claimable.feeY.toString() },
        putsBack: putsBack && heldBack === null ? { xRaw: putX.toString(), yRaw: putY.toString() } : { xRaw: "0", yRaw: "0" },
        heldBack,
        costLamports: Number(fee) + cost.rentLamports - cost.rentReturnedLamports,
        rentLamports: cost.rentLamports - cost.rentReturnedLamports,
      };
    });
  }

  return { approve, move, sqrtPriceOfTick: (tickId: number) => getSqrtPriceFromTickId(tickId).toString() };
}

export type DlmmProRange = ReturnType<typeof createDlmmProRange>;
