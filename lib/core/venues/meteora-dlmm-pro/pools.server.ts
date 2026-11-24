/**
 * DLMM Pro pools: finding them, reading them, and creating a launch pool.
 *
 * **Reading.** A pool account has a fixed head and a tail whose length depends on the pool's extensions — the reward
 * slots of liquidity mining, then the activation rules. Decoding the head alone loses the tail without an error, so a
 * pool is read only whole: one pool through the SDK's `fetchPoolWithExtensions`, many — a search, a page — through
 * `decodePoolAccount`, which is that call's two decodes on bytes already in hand (`./sdk-compare.test.mjs` holds the
 * two equal). There is no Data API for DLMM Pro: a list of pools is `getProgramAccounts` filtered by the account's
 * discriminator and, when asked, by a mint.
 *
 * **The model** (`DlmmProPool`) is what a caller needs without knowing the program: the two coins, the price, the
 * tick spacing, the kind of pool (from a public config, from a partner's config, or a launch pool), its partner, its
 * extensions, the fee a swap would pay now — the schedule's step and the volatility part, each read at the chain's own
 * clock — and whether swapping and liquidity are open, for everyone and for one wallet.
 *
 * **Creating.** `buildLaunchPool` builds the one pool a pair can have without a config: the caller's fee schedule, the
 * fee's coin, the opening rules. What a pool is created with can never be changed — pair, tick spacing, fees, the
 * fee's coin, opening, extensions — and a pair has one launch pool for ever, so the build refuses, before a signature
 * is asked for, what it can read the program would refuse: a pair that has its pool, a coin the wallet holds none of,
 * a fee coin the mode does not take, an opening behind the clock, too close to it or too far ahead — and a wallet that
 * cannot pay the pool's rent and the fee. Lamports somebody left at the address the pool will live at are not the
 * pair's pool: the program makes its pool there all the same, and so does the build. A coin the program takes only
 * with Meteora's token badge is built with the badge where the coin has one, and refused here where it has none. It
 * decides no product rule: which schedule, which opening and who pays are the caller's.
 *
 * Nothing here signs or sends; every build is unsigned bytes for the wallet (`./tx.server.ts`).
 */

import {
  AccessRegistryIDL,
  ActivationType,
  BITMAP_SIZE,
  BaseFeeMode,
  CollectFeeMode,
  PoolExtension,
  PoolType,
  WHITELISTED_QUOTE_MINTS,
  decodePoolExtensionsFromData,
  deriveLaunchPool,
  derivePool,
  deriveTokenBadge,
  encodePoolExtensions,
  findNftAccount,
  fixedBaseFeeParameters,
  getBaseFeeNumerator,
  getDynamicFeeParams,
  getSqrtPriceFromTickId,
  getTokenProgram,
  isSupportExtension,
  marketCapSchedulerBaseFeeParameters,
  openActivationParameters,
  readClock,
  tickArraysForTickIds,
  tickIdFromSqrtPrice,
  tickIndexFromId,
  timeBasedActivationParameters,
  timeSchedulerBaseFeeParameters,
  type BaseFeeConfigParameters,
  DlmmProClient,
  type DecodedPoolExtensions,
  type InitializePoolWithDynamicParameters,
  type Pool,
} from "@meteora-ag/dlmm-pro-sdk";
import { ASSOCIATED_TOKEN_PROGRAM_ID, AccountState, ExtensionType, NATIVE_MINT, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getAccountLen, getAssociatedTokenAddressSync, getDefaultAccountState, unpackMint, type Mint } from "@solana/spl-token";
import { PublicKey, SystemProgram, type AccountInfo, type Connection, type TransactionInstruction } from "@solana/web3.js";
import { getBase58Decoder } from "@solana/kit";
import BN from "bn.js";

import type { Address } from "../../contracts.ts";
import { activationRulesOf, activationStateOf, type ActionGate, type ActivationAction, type ActivationRules } from "./activation.ts";
import { FEE_SHARES, basePeriodOf, decodeBaseFee, feeBpsOf, sqrtPriceOfPeriod, totalFeeNumerator, variableFeeCeiling, variableFeeNow, type BaseFeeMode as BaseFeeModeName, type BaseFeeSchedule } from "./fee.ts";
import { DLMM_PRO_ACCESS_REGISTRY, DLMM_PRO_PROGRAM, DlmmProRefusal, accountDiscriminator, refusing } from "./sdk.server.ts";
import { MAX_TICK_ID, MAX_TICK_SPACING, MIN_TICK_ID, alignTickDown, priceOfSqrtX64, sqrtPriceX64OfPrice } from "./ticks.ts";
import { DLMM_PRO_UNITS, keyOf, seal, type DlmmProBuild, type DlmmProRent, type SealOptions } from "./tx.server.ts";

export type DlmmProContext = Readonly<{
  connection: Connection;
  client: DlmmProClient;
  /** The address Ryntra's referral token accounts belong to on this network; null — no swap carries a referral, and no order names one. */
  referralOwner: Address | null;
}>;

export const POOL_KINDS = ["static", "dynamic", "launch"] as const;
export type DlmmProPoolKind = (typeof POOL_KINDS)[number];

export type DlmmProCoin = Readonly<{ mint: Address; program: "spl-token" | "token-2022"; decimals: number; reserve: Address }>;

export type DlmmProFee = Readonly<{
  /** How the base fee moves: fixed, or a schedule by time or by price. */
  mode: BaseFeeModeName;
  /** The schedule's first and last steps, basis points. Equal for a fixed fee. */
  startBps: number;
  endBps: number;
  /** The step the pool is on now, of `periods`. */
  period: number;
  periods: number;
  /** The base fee now, the volatility part now and its ceiling, and what a swap would pay — basis points, to two decimals. */
  baseBps: number;
  dynamicBps: number;
  dynamicCeilingBps: number;
  totalBps: number;
  /** The same total over a billion — the program's own number. */
  numerator: string;
  /**
   * When the schedule settles: a price schedule at a price (and, whatever the price, at a time); a time schedule at a
   * time. Points are in the pool's activation unit. Null for a fixed fee.
   */
  settles: Readonly<{ atPrice: number | null; atPoint: number }> | null;
  /** The coin the fee is taken in: the one a swap pays out, or always token Y. */
  collectedIn: "output" | "tokenY";
  /** The protocol's share of what liquidity earns, basis points: a tenth, a fifth in a launch pool. */
  protocolShareBps: number;
}>;

export type DlmmProReward = Readonly<{
  index: number;
  mint: Address;
  program: "spl-token" | "token-2022";
  vault: Address;
  authority: Address;
  /** Atoms a second, Q64.64. */
  emissionPerSecondX64: string;
  /** Unix seconds. An emission never set has both at zero. */
  opensAt: number;
  endsAt: number;
  running: boolean;
  /**
   * Whether anything of the slot's emissions was ever credited to liquidity, as of the pool's last update. A slot's
   * next emission replaces the dates of the one before it, and what that one left positions stays collectable: so
   * «nothing was earned» can be said of a slot only while this is false and its emission has not started.
   */
  credited: boolean;
  /**
   * The seconds of the emission that found no liquidity at the price — the program's own count, as of
   * `updatedAt` (unix seconds, the slot's last update). What those seconds emitted is the authority's to take back once
   * the window is over; the rest went to liquidity.
   */
  idleSeconds: number;
  updatedAt: number;
}>;

export type DlmmProPool = Readonly<{
  address: Address;
  kind: DlmmProPoolKind;
  tokenX: DlmmProCoin;
  tokenY: DlmmProCoin;
  creator: Address;
  /** The partner of a dynamic-config pool and its share of the protocol's fee; null elsewhere. */
  partner: Readonly<{ address: Address; feeBps: number }> | null;
  tickSpacing: number;
  tickId: number;
  sqrtPriceX64: string;
  initSqrtPriceX64: string;
  /** Token Y per token X in whole tokens — a number to show. */
  price: number;
  initPrice: number;
  /** The liquidity in range at the price; limit orders are not part of it. */
  liquidity: string;
  extensions: Readonly<{ liquidityMining: boolean; activationAccess: boolean }>;
  fee: DlmmProFee;
  /** The unit of the pool's points — its opening, its fee schedule, a vesting. */
  unit: "slot" | "timestamp";
  /** When the pool opens, in that unit. */
  activationPoint: number;
  /** The activation rules of an `ActivationAccess` pool; null — open from its first block. */
  rules: ActivationRules | null;
  /** The operator's pause, Meteora's: swaps, and adding liquidity. Taking out is never paused. */
  paused: Readonly<{ swaps: boolean; deposits: boolean }>;
  /** What is open now — for the wallet the pool was read for, or for everyone when none was named. */
  open: Readonly<Record<ActivationAction, ActionGate>>;
  rewards: readonly DlmmProReward[];
  /** The clock the fee and the gates were read at. */
  at: Readonly<{ slot: number; unix: number; point: number }>;
}>;

export type DlmmProClock = Readonly<{ slot: bigint; unix: bigint; epoch: bigint }>;

const big = (value: { toString(): string }) => BigInt(value.toString());
const base58 = getBase58Decoder();
const DEFAULT = PublicKey.default;

/** The eight bytes every DLMM Pro pool account starts with, base58 — the filter of a search. */
export function poolDiscriminator(): string {
  return base58.decode(accountDiscriminator("Pool"));
}

/** A pool account's bytes, whole: the head and the tail of its extensions. */
export function decodePoolAccount(client: DlmmProClient, data: Buffer): Readonly<{ pool: Pool; extensions: DecodedPoolExtensions }> {
  return { pool: client.program.coder.accounts.decode<Pool>("pool", data), extensions: decodePoolExtensionsFromData(data) };
}

/** The chain's clock, read from its sysvar as the program reads it. */
export async function clockOf(context: Pick<DlmmProContext, "connection">): Promise<DlmmProClock> {
  const clock = await readClock(context.connection, "confirmed");
  return { slot: big(clock.slot), unix: big(clock.timestamp), epoch: clock.epoch };
}

/* A mint's decimals do not change: read once for the connection they were read on — two chains never share them. */
const DECIMALS = new WeakMap<object, Map<string, number>>();

/**
 * The decimals of mints, read by their addresses in one request per hundred. A mint that does not read throws — or,
 * with `lenient`, is left out of the answer, for a caller that reads many pools and drops the one it cannot model.
 */
export async function decimalsOf(connection: Pick<Connection, "getMultipleAccountsInfo">, mints: readonly PublicKey[], lenient = false): Promise<ReadonlyMap<string, number>> {
  let known = DECIMALS.get(connection);
  if (!known) {
    known = new Map();
    DECIMALS.set(connection, known);
  }
  const found = new Map<string, number>();
  const missing: PublicKey[] = [];
  for (const mint of mints) {
    const decimals = known.get(mint.toBase58());
    if (decimals !== undefined) found.set(mint.toBase58(), decimals);
    else if (!missing.some((key) => key.equals(mint))) missing.push(mint);
  }
  for (let start = 0; start < missing.length; start += 100) {
    const chunk = missing.slice(start, start + 100);
    const infos = await connection.getMultipleAccountsInfo(chunk, "confirmed");
    infos.forEach((info, index) => {
      const mint = chunk[index]!.toBase58();
      if (!info || info.data.length < 45) {
        if (lenient) return;
        throw new DlmmProRefusal("FAILED", `The mint ${mint} could not be read.`);
      }
      const decimals = Buffer.from(info.data).readUInt8(44);
      known.set(mint, decimals);
      found.set(mint, decimals);
    });
  }
  return found;
}

/**
 * A pool whole — head and tail — or a refusal when no DLMM Pro pool lives at the address. The venue reads a pool no
 * other way: the SDK's `fetchPool` decodes the head alone.
 */
export async function poolWhole(context: Pick<DlmmProContext, "client">, pool: PublicKey): Promise<Readonly<{ pool: Pool; extensions: DecodedPoolExtensions }>> {
  try {
    return await context.client.state.fetchPoolWithExtensions(pool);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    /* Nothing there, another program's account, or an account of this program that is not a pool. */
    if (/Account not found|is not owned by|Invalid account discriminator/i.test(message)) throw new DlmmProRefusal("NO_POOL", `No DLMM Pro pool at ${pool.toBase58()}.`);
    throw error;
  }
}

/**
 * A coin's mint as the SDK's transfer-fee arithmetic takes it: unpacked when the Token-2022 program owns it — where a
 * transfer fee can live — and null under the classic program, which has none.
 */
export async function transferFeeMintOf(connection: Pick<Connection, "getAccountInfo">, mint: PublicKey): Promise<Mint | null> {
  const info = await connection.getAccountInfo(mint, "confirmed");
  if (!info) throw new DlmmProRefusal("FAILED", `The mint ${mint.toBase58()} could not be read.`);
  return info.owner.equals(TOKEN_2022_PROGRAM_ID) ? unpackMint(mint, info, info.owner) : null;
}

/** A token account's bytes before any extension, and where its fields live. */
export const TOKEN_ACCOUNT_BYTES = 165;
/** 1 — initialized, 2 — frozen. */
export const TOKEN_ACCOUNT_STATE_OFFSET = 108;
export const TOKEN_ACCOUNT_DELEGATE_OFFSET = 72;
export const TOKEN_ACCOUNT_DELEGATED_AMOUNT_OFFSET = 121;
/**
 * Whether a token account can be paid `mint` now: owned by `program`, of that coin, initialized and not frozen. What
 * is merely *at* an address — lamports someone sent there, an account of another coin, a frozen one — cannot, and a
 * payment to it would fail the whole transaction.
 */
export function isPayableTokenAccount(info: Readonly<{ owner: PublicKey; data: Uint8Array }> | null, mint: PublicKey, program: PublicKey): boolean {
  if (!info || !info.owner.equals(program) || info.data.length < TOKEN_ACCOUNT_BYTES) return false;
  const data = Buffer.from(info.data);
  return data.subarray(0, 32).equals(mint.toBuffer()) && data.readUInt8(TOKEN_ACCOUNT_STATE_OFFSET) === 1;
}

/**
 * The sizes of what a build creates, in bytes — the rent its wallet must hold besides the coins it moves. Each is what
 * the program as deployed made in the rehearsal's recorded transactions (`./sdk-compare.test.mjs` holds them to those
 * records), rounded up only where a size is not the program's alone to fix — an NFT's metadata, the extensions of a
 * Token-2022 account: the check errs to asking for a little more, never for less.
 */
export const DLMM_PRO_ACCOUNT_BYTES = Object.freeze({
  /** A token account of the classic program, and of Token-2022 with the extensions a coin's account may carry. */
  tokenAccount: 165,
  tokenAccount2022: 200,
  /** The NFT of a position or an order: its mint with its metadata (511 and 514 as made), and its account. */
  nftMint: 600,
  nftAccount: 170,
  /** A position: its head, and a slot for each range — longer on a pool with liquidity mining. */
  positionHead: 144,
  positionSlot: 128,
  positionSlotWithRewards: 192,
  /** An order: its head, and an entry for each tick. */
  orderHead: 144,
  orderEntry: 24,
  /**
   * A tick array's head — paid once, by the build that makes the array — and a tick in it, longer on a pool with
   * liquidity mining. A tick is paid for by every range that ends on it and every order tick that rests on it, whether
   * or not somebody stands there already: the second maker on a tick paid for it again, and a second position on the
   * very same ranges for every one of them. Each gets it back when it leaves.
   */
  tickArrayHead: 64,
  tick: 160,
  tickWithRewards: 192,
  /** A pool: its head, the tail of each extension it is created with, its oracle — and the extension of its tick-array bitmap, made only where its first price lies beyond the bitmap in the pool itself. */
  pool: 648,
  poolActivation: 128,
  poolRewards: 352,
  oracle: 72,
  bitmapExtension: 808,
});

/** What a build takes from its wallet in lamports besides the coins it moves. */
export type LamportsNeed = Readonly<{
  /** The network and priority fees of every transaction of the build. */
  fee: bigint;
  /** The build's own instructions: the token accounts it opens, and those it closes, are read off them. */
  instructions: readonly TransactionInstruction[];
  /** The accounts the program makes for the build, by their size in bytes. */
  accounts?: readonly number[];
  /** Bytes it adds inside accounts that exist, charged at the same rate with no account's overhead. */
  bytes?: number;
  /** The token accounts the build pays into, where they exist already: a frozen one takes nothing, and the build is refused. */
  receives?: readonly PublicKey[];
}>;

const isTokenProgram = (program: PublicKey) => program.equals(TOKEN_PROGRAM_ID) || program.equals(TOKEN_2022_PROGRAM_ID);
/** The token program's `CloseAccount`: one byte, 9. */
const CLOSE_ACCOUNT = 9;

export type OpenedTokenAccount = Readonly<{ address: PublicKey; mint: PublicKey; program: PublicKey }>;

/**
 * The token accounts a build's instructions open — one for each address the associated-token program is asked to make
 * — with the coin each is of: those it leaves standing (`kept`), and those it closes itself before it ends
 * (`temporary`: wrapped SOL, opened for the build). And the accounts it closes that it did not open (`standing`):
 * they were there before.
 */
export function openedTokenAccounts(instructions: readonly TransactionInstruction[]): Readonly<{ kept: OpenedTokenAccount[]; temporary: OpenedTokenAccount[]; standing: PublicKey[] }> {
  const closes = instructions.filter((ix) => isTokenProgram(ix.programId) && ix.data.length === 1 && ix.data[0] === CLOSE_ACCOUNT && ix.keys.length > 0).map((ix) => ix.keys[0]!.pubkey);
  const closed = new Set(closes.map((key) => key.toBase58()));
  const opened = new Map<string, OpenedTokenAccount>();
  for (const ix of instructions) {
    /* Create and create-idempotent alike: payer, the account, its owner, its coin, the system program, the token program. */
    if (!ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID) || ix.keys.length < 6) continue;
    opened.set(ix.keys[1]!.pubkey.toBase58(), { address: ix.keys[1]!.pubkey, mint: ix.keys[3]!.pubkey, program: ix.keys[5]!.pubkey });
  }
  const all = [...opened.values()];
  const isClosed = (entry: OpenedTokenAccount) => closed.has(entry.address.toBase58());
  return { kept: all.filter((entry) => !isClosed(entry)), temporary: all.filter(isClosed), standing: closes.filter((key) => !opened.has(key.toBase58())) };
}

/**
 * The extensions a Token-2022 mint carries, read as the token program reads them: one after another, to the first
 * that is none, or to a tail too short to be one. A mint's bytes may run past its last extension: one whose length
 * would be a multisig's — 355 bytes — is allocated two bytes longer, and those two are no extension.
 */
export function mintExtensionTypes(tlvData: Uint8Array): ExtensionType[] {
  const data = Buffer.from(tlvData);
  const types: ExtensionType[] = [];
  for (let at = 0; at + 4 <= data.length; ) {
    const type = data.readUInt16LE(at);
    if (type === ExtensionType.Uninitialized) break;
    types.push(type);
    at += 4 + data.readUInt16LE(at + 2);
  }
  return types;
}

/**
 * What a coin's extension asks of every account of the coin when the account is made — the token program's own list
 * (`get_required_init_account_extensions`). An account's other extensions — a confidential balance, a memo rule — are
 * added by its owner later, and are no part of what a build pays for.
 */
const ACCOUNT_EXTENSION_OF: ReadonlyMap<ExtensionType, ExtensionType> = new Map([
  [ExtensionType.TransferFeeConfig, ExtensionType.TransferFeeAmount],
  [ExtensionType.NonTransferable, ExtensionType.NonTransferableAccount],
  [ExtensionType.TransferHook, ExtensionType.TransferHookAccount],
  [ExtensionType.PausableConfig, ExtensionType.PausableAccount],
]);

/**
 * The size of a coin's associated token account: 165 bytes under the classic program; under Token-2022, what the
 * coin's own extensions ask of every account of it, and the mark that the account's owner cannot change — as the
 * associated-token program makes it. A coin that cannot be read is given the venue's own allowance.
 */
export function tokenAccountBytesOf(mint: PublicKey, info: AccountInfo<Buffer> | null, program: PublicKey): number {
  if (!program.equals(TOKEN_2022_PROGRAM_ID)) return DLMM_PRO_ACCOUNT_BYTES.tokenAccount;
  if (!info || !info.owner.equals(TOKEN_2022_PROGRAM_ID)) return DLMM_PRO_ACCOUNT_BYTES.tokenAccount2022;
  try {
    const ofAccounts = mintExtensionTypes(unpackMint(mint, info, TOKEN_2022_PROGRAM_ID).tlvData).flatMap((type) => {
      const asked = ACCOUNT_EXTENSION_OF.get(type);
      return asked === undefined ? [] : [asked];
    });
    return getAccountLen([...new Set([ExtensionType.ImmutableOwner, ...ofAccounts])]);
  } catch {
    return DLMM_PRO_ACCOUNT_BYTES.tokenAccount2022;
  }
}

/** Whether a Token-2022 coin makes every new account of it frozen — its default account state. */
function bornFrozen(mint: PublicKey, info: AccountInfo<Buffer>): boolean {
  if (!info.owner.equals(TOKEN_2022_PROGRAM_ID)) return false;
  try {
    return getDefaultAccountState(unpackMint(mint, info, TOKEN_2022_PROGRAM_ID))?.state === AccountState.Frozen;
  } catch {
    return false;
  }
}

/**
 * How many of the tick arrays these ticks fall in are not on chain yet. The build that first stands in such an array
 * makes it and pays for its head; one that is there costs nothing more.
 */
export async function missingTickArrays(context: Pick<DlmmProContext, "connection" | "client">, pool: PublicKey, tickIds: readonly number[], tickSpacing: number): Promise<number> {
  const programId = context.client.program.programId;
  const arrays = tickArraysForTickIds(pool, [...new Set(tickIds)], tickSpacing, programId);
  if (arrays.length === 0) return 0;
  return (await context.connection.getMultipleAccountsInfo(arrays, "confirmed")).filter((info) => !info || !info.owner.equals(programId)).length;
}

export type Spend = Readonly<{ mint: PublicKey; program: PublicKey; amount: bigint }>;

/**
 * Refuses a build its wallet cannot pay for — before a signature, not in the wallet after one — and returns what the
 * build tells of its cost (`DlmmProRent`).
 *
 * `spends` are the coins the build takes from the wallet's associated accounts. `need` is what the build itself
 * takes in lamports: the fees of its transactions and the rent of what it creates, at the cluster's own rate. Wrapped
 * SOL is spent out of the wallet's lamports wherever its wrapped account holds less than the amount, so a build in
 * SOL is held to the amount *and* to its own cost together.
 *
 * What the wallet must hold: the fees, the rent of what stays, the SOL it wraps — and the larger of two things, the
 * rent of what the build opens and closes itself, and what a wallet must keep to exist. The first leaves the wallet in
 * the middle of the transaction and is back at its end; the second is asked of the wallet only at its end. A sum of the
 * two would refuse a wallet the chain takes.
 *
 * A frozen account of the wallet's is refused: nothing leaves it — and so is a frozen account the build pays into
 * (`need.receives`): nothing arrives in it, and the token program would fail the whole transaction there. So is an
 * account the build itself opens of a coin that freezes every new account of it: it would be frozen the moment it is
 * made. A read that fails throws; it is never taken for a balance.
 */
export async function assertAffords(
  connection: Pick<Connection, "getMultipleAccountsInfo" | "getBalance" | "getMinimumBalanceForRentExemption">,
  wallet: PublicKey,
  spends: readonly Spend[],
  need: LamportsNeed,
): Promise<DlmmProRent> {
  const taking = spends.filter((spend) => spend.amount > 0n);
  const opened = openedTokenAccounts(need.instructions);
  /* A Token-2022 account's size is its coin's to say: the coins of the accounts the build opens are read with the rest. */
  const coins = [...new Map([...opened.kept, ...opened.temporary].filter((entry) => entry.program.equals(TOKEN_2022_PROGRAM_ID)).map((entry) => [entry.mint.toBase58(), entry.mint] as const)).values()];
  const receives = need.receives ?? [];
  const read = [...taking.map((spend) => getAssociatedTokenAddressSync(spend.mint, wallet, true, spend.program)), ...opened.standing, ...coins, ...receives];
  const [infos, lamports, bare, oneByte] = await Promise.all([
    read.length ? connection.getMultipleAccountsInfo(read, "confirmed") : Promise.resolve([]),
    connection.getBalance(wallet, "confirmed"),
    connection.getMinimumBalanceForRentExemption(0, "confirmed"),
    connection.getMinimumBalanceForRentExemption(1, "confirmed"),
  ]);
  const perByte = BigInt(oneByte - bare);
  const rentOf = (sizes: readonly number[]) => sizes.reduce((sum, size) => sum + BigInt(bare) + BigInt(size) * perByte, 0n);
  const coinAt = new Map(coins.map((mint, index) => [mint.toBase58(), infos[taking.length + opened.standing.length + index] ?? null] as const));
  const sizeOf = (entry: OpenedTokenAccount) => tokenAccountBytesOf(entry.mint, coinAt.get(entry.mint.toBase58()) ?? null, entry.program);
  for (const entry of opened.kept) {
    const coin = coinAt.get(entry.mint.toBase58()) ?? null;
    if (coin && bornFrozen(entry.mint, coin)) throw new DlmmProRefusal("BAD_INPUT", `The coin ${entry.mint.toBase58()} freezes every new account of it: the account this build opens would take nothing.`);
  }
  receives.forEach((address, index) => {
    const info = infos[taking.length + opened.standing.length + coins.length + index];
    if (info && isTokenProgram(info.owner) && info.data.length >= TOKEN_ACCOUNT_BYTES && Buffer.from(info.data).readUInt8(TOKEN_ACCOUNT_STATE_OFFSET) === 2) {
      throw new DlmmProRefusal("BAD_INPUT", `The token account ${address.toBase58()} is frozen: nothing can be paid into it.`);
    }
  });
  const stays = rentOf([...(need.accounts ?? []), ...opened.kept.map(sizeOf)]) + BigInt(need.bytes ?? 0) * perByte;
  const comesBack = rentOf(opened.temporary.map(sizeOf));
  let fromLamports = need.fee + stays + (comesBack > BigInt(bare) ? comesBack : BigInt(bare));
  taking.forEach((spend, index) => {
    const info = infos[index];
    const account = info && info.owner.equals(spend.program) && info.data.length >= TOKEN_ACCOUNT_BYTES ? Buffer.from(info.data) : null;
    if (account && account.readUInt8(TOKEN_ACCOUNT_STATE_OFFSET) === 2) throw new DlmmProRefusal("BAD_INPUT", `The wallet's account of ${spend.mint.toBase58()} is frozen: nothing can leave it.`);
    const has = account ? account.readBigUInt64LE(64) : 0n;
    if (spend.mint.equals(NATIVE_MINT)) {
      if (spend.amount > has) fromLamports += spend.amount - has;
      return;
    }
    if (has < spend.amount) throw new DlmmProRefusal("BALANCE_LOW", `The wallet holds ${has.toString()} of ${spend.mint.toBase58()}; this takes ${spend.amount.toString()}.`);
  });
  if (BigInt(lamports) < fromLamports) throw new DlmmProRefusal("BALANCE_LOW", `The wallet holds ${lamports} lamports; this takes ${fromLamports.toString()} with its fees and the rent of what it creates.`);
  /* A wrapped-SOL account that was there before and that the build closes: what it holds comes to the wallet as SOL. */
  let unwraps: bigint | null = null;
  opened.standing.forEach((_, index) => {
    const info = infos[taking.length + index];
    if (!info || !isTokenProgram(info.owner) || info.data.length < TOKEN_ACCOUNT_BYTES) return;
    const account = Buffer.from(info.data);
    if (account.subarray(0, 32).equals(NATIVE_MINT.toBuffer())) unwraps = (unwraps ?? 0n) + account.readBigUInt64LE(64);
  });
  return { rentLamports: Number(stays + comesBack), rentReturnedLamports: Number(comesBack), unwrapsLamports: unwraps === null ? null : (unwraps as bigint).toString() };
}

/**
 * The Token-2022 extensions of a mint the program takes as they are. A coin with any other is taken only with the
 * token badge Meteora gives it. As the program deployed on mainnet answered in the rehearsal (`results/REHEARSAL.md`,
 * paths E and F): a launch pool was made of a coin with a transfer fee, with a metadata pointer and its metadata, with a
 * freeze authority, under either token program — and refused (`UnsupportedMint`) for a coin with a permanent
 * delegate, and for one with a mint close authority. A reward's coin is held to more: one with a freeze authority
 * was refused too — but for USDC, which has one and was taken.
 */
const EXTENSIONS_TAKEN = new Set<ExtensionType>([ExtensionType.TransferFeeConfig, ExtensionType.MetadataPointer, ExtensionType.TokenMetadata]);

/** Why the program takes a coin only with Meteora's token badge — as one coin of a pool, or as a reward; null — it takes it as it is. */
export function badgeReasonOf(address: PublicKey, info: AccountInfo<Buffer>, use: "pool" | "reward"): string | null {
  let mint: Mint;
  try {
    mint = unpackMint(address, info, info.owner);
  } catch {
    throw new DlmmProRefusal("BAD_INPUT", `${address.toBase58()} is not a coin.`);
  }
  if (use === "reward" && mint.freezeAuthority !== null && !WHITELISTED_QUOTE_MINTS.some((quote) => quote.equals(address))) return "its freeze authority";
  if (!info.owner.equals(TOKEN_2022_PROGRAM_ID)) return null;
  const others = mintExtensionTypes(mint.tlvData).filter((type) => !EXTENSIONS_TAKEN.has(type));
  return others.length ? `its Token-2022 extension ${others.map((type) => ExtensionType[type] ?? String(type)).join(", ")}` : null;
}

/**
 * The token badge a coin needs, where it needs one: its address when Meteora gave it one, a refusal when not — before
 * a signature, not by the chain after one. Null — the program takes the coin as it is.
 */
export async function tokenBadgeFor(connection: Pick<Connection, "getAccountInfo">, address: PublicKey, info: AccountInfo<Buffer>, use: "pool" | "reward"): Promise<PublicKey | null> {
  const reason = badgeReasonOf(address, info, use);
  if (reason === null) return null;
  const badge = deriveTokenBadge(address);
  const held = await connection.getAccountInfo(badge, "confirmed");
  /* A badge is the registry's own account for this very coin: its mark, then the coin's address. */
  const data = held && held.owner.equals(new PublicKey(DLMM_PRO_ACCESS_REGISTRY)) ? Buffer.from(held.data) : null;
  if (!data || data.length < 40 || !data.subarray(0, 8).equals(TOKEN_BADGE_MARK) || !data.subarray(8, 40).equals(address.toBuffer())) {
    throw new DlmmProRefusal("BAD_INPUT", `The program takes ${address.toBase58()} only with Meteora's token badge, for ${reason}; it has none.`);
  }
  return badge;
}

const TOKEN_BADGE_MARK = Buffer.from(AccessRegistryIDL.accounts.find((entry) => entry.name === "TokenBadge")?.discriminator ?? []);
if (TOKEN_BADGE_MARK.length !== 8) throw new Error("The access registry's IDL has no TokenBadge account.");

/**
 * The pool's tick-array bitmap extension, where a build has to make it.
 *
 * A pool marks which tick arrays hold a tick somebody stands on: 512 either side of tick zero in its own account, the
 * rest in an extension account. A pool whose first price lay inside that span has no extension until somebody makes
 * one — once, for 808 bytes of rent that never come back — and a deposit or a limit order on a tick beyond the span
 * is refused by the program without it (`TickArrayBitmapExtensionAccountIsNotProvided`). Only a spacing of 6 or less
 * reaches that far.
 *
 * `make` is the instruction that makes it, to go first in the same transaction; `extension` is the account to name to
 * the SDK, which names one itself only on a pool that already says it has it. Nothing to make — both are empty, and
 * the SDK is left to itself. Two builds made at once would both carry `make`, and the second to land fails on it: a
 * build made again after that finds the extension there.
 */
export async function bitmapExtensionFor(
  client: DlmmProClient,
  poolKey: PublicKey,
  pool: Pick<Pool, "isBitmapExtensionInitialized" | "tickSpacing">,
  tickIds: readonly number[],
  funder: PublicKey,
): Promise<Readonly<{ extension: PublicKey | undefined; make: readonly TransactionInstruction[]; accounts: readonly number[]; units: number }>> {
  const beyond = (tickId: number) => {
    const index = tickIndexFromId(tickId, pool.tickSpacing);
    return index < -BITMAP_SIZE || index > BITMAP_SIZE - 1;
  };
  if (pool.isBitmapExtensionInitialized === 1 || !tickIds.some(beyond)) return { extension: undefined, make: [], accounts: [], units: 0 };
  const built = await client.pool.initializeTickBitmapExtension({ pool: poolKey, funder });
  return { extension: built.tickArrayBitmapExtension, make: built.tx.instructions, accounts: [DLMM_PRO_ACCOUNT_BYTES.bitmapExtension], units: DLMM_PRO_UNITS.bitmapExtension };
}

/**
 * A client for building on behalf of `wallets` whose associated addresses of `coins` may hold «dust».
 *
 * The SDK creates a wallet's associated token account only where *nothing* is at its address. Lamports anyone sent
 * to such an address before the account was made leave a data-less account there: the SDK would then name it as a
 * token account in the build — which fails on chain every time — or, for wrapped SOL, fail to read it. So a build is
 * made by a client that reads such an address as empty; the SDK then adds its own idempotent create, which the
 * associated-token program carries out at a funded address. Where there is no dust — nearly always — this is the
 * context's own client, and one read.
 */
export async function clientPastDust(context: Pick<DlmmProContext, "connection" | "client">, wallets: readonly PublicKey[], coins: readonly Readonly<{ mint: PublicKey; program: PublicKey }>[]): Promise<DlmmProClient> {
  const addresses = [...new Map(wallets.flatMap((wallet) => coins.map((coin) => getAssociatedTokenAddressSync(coin.mint, wallet, true, coin.program))).map((key) => [key.toBase58(), key] as const)).values()];
  if (addresses.length === 0) return context.client;
  const infos = await context.connection.getMultipleAccountsInfo(addresses, "confirmed");
  const dust = new Set(addresses.filter((_, index) => infos[index] !== null && infos[index]!.owner.equals(SystemProgram.programId) && infos[index]!.data.length === 0).map((key) => key.toBase58()));
  if (dust.size === 0) return context.client;
  const seen = <T>(key: PublicKey, info: T): T | null => (dust.has(key.toBase58()) ? null : info);
  const target = context.connection;
  const view = new Proxy(target, {
    get(_, property) {
      if (property === "getMultipleAccountsInfo") {
        return async (keys: PublicKey[], ...rest: unknown[]) => (await (target.getMultipleAccountsInfo as (...args: unknown[]) => Promise<(AccountInfo<Buffer> | null)[]>)(keys, ...rest)).map((info, index) => seen(keys[index]!, info));
      }
      if (property === "getAccountInfo") {
        return async (key: PublicKey, ...rest: unknown[]) => seen(key, await (target.getAccountInfo as (...args: unknown[]) => Promise<AccountInfo<Buffer> | null>)(key, ...rest));
      }
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
  return new DlmmProClient(view, "confirmed");
}

/**
 * Refuses unless `owner` holds the NFT of a position or an order — its Token-2022 associated account with exactly
 * one — so a build for a wallet that is not the holder is refused here, not in the wallet after a signature.
 */
export async function assertHolds(connection: Pick<Connection, "getAccountInfo">, nftMint: PublicKey, owner: PublicKey, what: string): Promise<void> {
  const info = await connection.getAccountInfo(findNftAccount(nftMint, owner), "confirmed");
  const amount = info && info.data.length >= 72 ? Buffer.from(info.data).readBigUInt64LE(64) : 0n;
  if (amount !== 1n) throw new DlmmProRefusal("BAD_INPUT", `The wallet does not hold the NFT of ${what}.`);
}

/**
 * Refuses a build signed by a wallet the program would refuse. The holder of the NFT signs for itself. Any other
 * wallet signs only as the delegate approved on the NFT's account — with nothing delegated, as the program asks — and
 * only for what the position or the order lets a delegate do (`permitted`). So a stranger, a delegate taken back, or
 * a delegate asking for more than it was given is told here, not by a failed transaction it paid for.
 */
export async function assertSigner(connection: Pick<Connection, "getAccountInfo">, nftMint: PublicKey, owner: PublicKey, signer: PublicKey, permitted: boolean, what: string): Promise<void> {
  const info = await connection.getAccountInfo(findNftAccount(nftMint, owner), "confirmed");
  const data = info && info.data.length >= TOKEN_ACCOUNT_BYTES ? Buffer.from(info.data) : null;
  if (!data || data.readBigUInt64LE(64) !== 1n) throw new DlmmProRefusal("BAD_INPUT", `The wallet does not hold the NFT of ${what}.`);
  if (signer.equals(owner)) return;
  const isDelegate = data.readUInt32LE(TOKEN_ACCOUNT_DELEGATE_OFFSET) === 1 && new PublicKey(data.subarray(TOKEN_ACCOUNT_DELEGATE_OFFSET + 4, TOKEN_ACCOUNT_DELEGATE_OFFSET + 36)).equals(signer);
  if (!isDelegate || data.readBigUInt64LE(TOKEN_ACCOUNT_DELEGATED_AMOUNT_OFFSET) !== 0n) throw new DlmmProRefusal("BAD_INPUT", `The signer is neither the holder of ${what} nor the delegate its holder approved.`);
  if (!permitted) throw new DlmmProRefusal("BAD_INPUT", `The holder of ${what} has not let its delegate do this.`);
}

/**
 * Whether the pool lets `wallet` do `action` now; a refusal that says why when it does not — paused by the operator,
 * or not open yet.
 */
export function assertOpen(model: Pick<DlmmProPool, "open">, action: ActivationAction): void {
  const gate = model.open[action];
  if (gate.open) return;
  if (gate.reason === "paused") throw new DlmmProRefusal("PAUSED", "The pool's operator has paused this.");
  throw new DlmmProRefusal("NOT_OPEN", gate.reason === "price" ? "The pool opens this when its price reaches the target." : `The pool opens this at ${gate.opensAt}.`);
}

const programName = (flag: number): "spl-token" | "token-2022" => (flag === 1 ? "token-2022" : "spl-token");
const KIND_OF: Readonly<Record<number, DlmmProPoolKind>> = { [PoolType.Static]: "static", [PoolType.Dynamic]: "dynamic", [PoolType.LaunchPool]: "launch" };

/** The first point at which a schedule reads as settled whatever the price; null for a fixed fee. */
function scheduleEnd(schedule: BaseFeeSchedule, activationPoint: bigint): bigint | null {
  if (schedule.kind === "fixed") return null;
  if (schedule.kind === "time") return activationPoint + schedule.periodFrequency * BigInt(schedule.periods);
  /* A market cap schedule still charges by the price at the last point of its time, and settles on the next. */
  return activationPoint + BigInt(schedule.expirationDuration) + 1n;
}

/** The fee a swap would pay at `clock`: the schedule's step by the SDK's own arithmetic, the volatility part by the program's. */
export function feeOf(pool: Pool, clock: DlmmProClock, decimalsX: number, decimalsY: number): DlmmProFee {
  const schedule = decodeBaseFee(pool.feeConfig.baseFee.baseFeeMode, pool.feeConfig.baseFee.data);
  const point = pool.activationType === ActivationType.Slot ? clock.slot : clock.unix;
  const activationPoint = big(pool.activationPoint);
  const initSqrtPrice = big(pool.initSqrtPrice);
  const sqrtPrice = big(pool.sqrtPrice);
  const baseAt = (at: bigint, price: BN) => big(getBaseFeeNumerator(pool.feeConfig.baseFee, new BN(at.toString()), pool.activationPoint, pool.initSqrtPrice, price));
  const base = baseAt(point, pool.sqrtPrice);
  const end = scheduleEnd(schedule, activationPoint);
  /* The last step: the point the schedule settles at, at the first price — the price no longer matters there. */
  const settled = end === null ? schedule.cliffNumerator : baseAt(end, pool.initSqrtPrice);
  const dynamic = pool.feeConfig.dynamicFee;
  const config = {
    initialized: dynamic.initialized !== 0,
    maxVolatilityAccumulator: dynamic.maxVolatilityAccumulator,
    variableFeeControl: dynamic.variableFeeControl,
    filterPeriod: dynamic.filterPeriod,
    decayPeriod: dynamic.decayPeriod,
    reductionFactor: dynamic.reductionFactor,
  };
  const variable = variableFeeNow(
    config,
    {
      sqrtPriceReference: big(pool.variableFee.sqrtPriceReference),
      lastSignificantSwapTimestamp: big(pool.variableFee.lastSignificantSwapTimestamp),
      lastReferenceTimestamp: big(pool.variableFee.lastReferenceTimestamp),
      volatilityAccumulator: pool.variableFee.volatilityAccumulator,
      volatilityReference: pool.variableFee.volatilityReference,
    },
    sqrtPrice,
    clock.unix,
  );
  const total = totalFeeNumerator(base, variable.numerator);
  const settlePrice = schedule.kind === "fixed" ? null : sqrtPriceOfPeriod(schedule, initSqrtPrice, schedule.periods);
  return {
    mode: schedule.mode,
    startBps: feeBpsOf(schedule.cliffNumerator),
    endBps: feeBpsOf(settled),
    period: basePeriodOf(schedule, { point, activationPoint, initSqrtPrice, sqrtPrice }),
    periods: schedule.kind === "fixed" ? 0 : schedule.periods,
    baseBps: feeBpsOf(base),
    dynamicBps: feeBpsOf(variable.numerator),
    dynamicCeilingBps: feeBpsOf(variableFeeCeiling(config)),
    totalBps: feeBpsOf(total),
    numerator: total.toString(),
    settles: end === null ? null : { atPrice: settlePrice === null ? null : priceOfSqrtX64(settlePrice, decimalsX, decimalsY), atPoint: Number(end) },
    collectedIn: pool.collectFeeMode === CollectFeeMode.OnlyY ? "tokenY" : "output",
    protocolShareBps: pool.poolType === PoolType.LaunchPool ? FEE_SHARES.protocolOfLiquidityLaunchBps : FEE_SHARES.protocolOfLiquidityBps,
  };
}

/** The pool's reward slots that were set up, from the tail of its account. */
export function rewardsOf(extensions: DecodedPoolExtensions, clock: DlmmProClock): readonly DlmmProReward[] {
  return (extensions.rewards ?? []).flatMap((reward, index): DlmmProReward[] => {
    if (reward.mint.equals(DEFAULT)) return [];
    const opensAt = Number(reward.openTime.toString());
    const endsAt = Number(reward.endTime.toString());
    return [
      {
        index,
        mint: reward.mint.toBase58(),
        program: programName(reward.rewardTokenFlag),
        vault: reward.vault.toBase58(),
        authority: reward.authority.toBase58(),
        emissionPerSecondX64: reward.emissionPerSecond.toString(),
        opensAt,
        endsAt,
        running: endsAt > 0 && clock.unix >= BigInt(opensAt) && clock.unix < BigInt(endsAt),
        credited: !reward.rewardGrowthGlobal.isZero(),
        idleSeconds: Number(reward.cumulativeSecondsWithEmptyLiquidityReward.toString()),
        updatedAt: Number(reward.lastUpdateTime.toString()),
      },
    ];
  });
}

/** One pool as the model, from its decoded account, the chain's clock and its coins' decimals. `wallet` — whose gates are read; null — everyone's. */
export function poolModelOf(
  args: Readonly<{ address: PublicKey; pool: Pool; extensions: DecodedPoolExtensions; clock: DlmmProClock; decimalsX: number; decimalsY: number; wallet: Address | null }>,
): DlmmProPool {
  const { pool, extensions, clock, decimalsX, decimalsY } = args;
  const kind = KIND_OF[pool.poolType];
  if (!kind) throw new DlmmProRefusal("FAILED", `The pool ${args.address.toBase58()} is of a type this release does not have (${pool.poolType}).`);
  const point = pool.activationType === ActivationType.Slot ? clock.slot : clock.unix;
  const rules = extensions.activation
    ? activationRulesOf({
        whitelistedSwap: extensions.activation.whitelistedSwap.toBase58(),
        whitelistedAddLiquidity: extensions.activation.whitelistedAddLiquidity.toBase58(),
        whitelistedRemoveLiquidity: extensions.activation.whitelistedRemoveLiquidity.toBase58(),
        activations: extensions.activation.activations,
      })
    : null;
  return {
    address: args.address.toBase58(),
    kind,
    tokenX: { mint: pool.tokenXMint.toBase58(), program: programName(pool.tokenXFlag), decimals: decimalsX, reserve: pool.reserveX.toBase58() },
    tokenY: { mint: pool.tokenYMint.toBase58(), program: programName(pool.tokenYFlag), decimals: decimalsY, reserve: pool.reserveY.toBase58() },
    creator: pool.creator.toBase58(),
    partner: pool.poolPartner.partner.equals(DEFAULT) ? null : { address: pool.poolPartner.partner.toBase58(), feeBps: pool.partnerFeeBps },
    tickSpacing: pool.tickSpacing,
    tickId: pool.tickCurrentId,
    sqrtPriceX64: pool.sqrtPrice.toString(),
    initSqrtPriceX64: pool.initSqrtPrice.toString(),
    price: priceOfSqrtX64(big(pool.sqrtPrice), decimalsX, decimalsY),
    initPrice: priceOfSqrtX64(big(pool.initSqrtPrice), decimalsX, decimalsY),
    liquidity: pool.liquidity.toString(),
    extensions: {
      liquidityMining: isSupportExtension(pool.extensions, PoolExtension.LiquidityMining),
      activationAccess: isSupportExtension(pool.extensions, PoolExtension.ActivationAccess),
    },
    fee: feeOf(pool, clock, decimalsX, decimalsY),
    unit: pool.activationType === ActivationType.Slot ? "slot" : "timestamp",
    activationPoint: Number(pool.activationPoint.toString()),
    rules,
    paused: { swaps: (pool.poolStatus & 1) !== 0, deposits: (pool.poolStatus & 2) !== 0 },
    open: activationStateOf({ rules, poolStatus: pool.poolStatus, point: Number(point), wallet: args.wallet }),
    rewards: rewardsOf(extensions, clock),
    at: { slot: Number(clock.slot), unix: Number(clock.unix), point: Number(point) },
  };
}

/** One pool read whole and modelled at the chain's clock, with what its model was made from — for a build that needs both. */
export async function modelWith(
  context: Pick<DlmmProContext, "client" | "connection">,
  key: PublicKey,
  wallet: Address | null,
): Promise<Readonly<{ model: DlmmProPool; pool: Pool; extensions: DecodedPoolExtensions; clock: DlmmProClock }>> {
  const [{ pool, extensions }, clock] = await Promise.all([poolWhole(context, key), clockOf(context)]);
  const decimals = await decimalsOf(context.connection, [pool.tokenXMint, pool.tokenYMint]);
  const model = poolModelOf({ address: key, pool, extensions, clock, decimalsX: decimals.get(pool.tokenXMint.toBase58())!, decimalsY: decimals.get(pool.tokenYMint.toBase58())!, wallet });
  return { model, pool, extensions, clock };
}

export async function modelOf(context: Pick<DlmmProContext, "client" | "connection">, key: PublicKey, wallet: Address | null): Promise<DlmmProPool> {
  return (await modelWith(context, key, wallet)).model;
}

export type BaseFeeRequest =
  | Readonly<{ kind: "fixed"; bps: number }>
  | Readonly<{ kind: "time"; curve: "linear" | "exponential"; startBps: number; endBps: number; periods: number; /** Slots or seconds the whole fall takes. */ duration: number }>
  | Readonly<{
      kind: "marketCap";
      curve: "linear" | "exponential";
      startBps: number;
      endBps: number;
      periods: number;
      /** The multiple of the pool's first price at which the fee settles; above one. */
      priceMultiple: number;
      /** Seconds after the pool opens when the fee settles whatever the price. */
      expiresAfter: number;
    }>;

export type OpeningRequest = Readonly<{
  /** Unix seconds: swaps open to everyone. The fee schedule counts from here. */
  swapAt: number;
  /** Unix seconds: liquidity in, and out, opens to everyone. Absent — with the swaps. */
  depositsAt?: number;
  withdrawalsAt?: number;
  /** The one wallet that may do each before its time; absent or null — nobody. */
  depositor?: Address | null;
  swapper?: Address | null;
  withdrawer?: Address | null;
}>;

export type LaunchPoolRequest = Readonly<{
  /** The fee payer and signer; it must hold some of both coins. */
  wallet: Address;
  /** Who the pool records as its creator — the one that may set up reward slot 0. Absent — the wallet. */
  creator?: Address;
  tokenX: Address;
  tokenY: Address;
  tickSpacing: number;
  /** The tick of the pool's first price. */
  initialTickId: number;
  baseFee: BaseFeeRequest;
  /** The volatility fee on top; on unless switched off. */
  dynamicFee?: boolean;
  collectFee: "tokenY" | "output";
  liquidityMining?: boolean;
  /** Absent or null — open from its first block. */
  opening?: OpeningRequest | null;
}>;

/**
 * A pool made from a partner's dynamic config: the same terms as a launch pool, at the config's own address
 * for the pair. The config belongs to the wallet Meteora gave it to (`authority`), and that wallet signs every pool made
 * from it — so the build names it as a signer beside the payer, and whoever holds its key signs once. The protocol
 * keeps a tenth of what liquidity earns here, not a launch pool's fifth, and the config's partner has its share of it.
 */
export type ConfigPoolRequest = LaunchPoolRequest &
  Readonly<{
    /** The dynamic config's address. */
    config: Address;
    /** The wallet the config belongs to: it signs the pool's creation. */
    authority: Address;
  }>;

export type LaunchPoolBuild = DlmmProBuild &
  Readonly<{
    pool: Address;
    oracle: Address;
    reserveX: Address;
    reserveY: Address;
    bitmapExtension: Address | null;
    /**
     * What the pool is created with, as the program is told it: the opening point, the extensions, and the fee the
     * schedule settles at — `endFeeBps`, the number the pool will read for ever, not the number asked for
     * (`askedEndFeeBps`). A schedule's steps are whole numbers the SDK rounds: with few steps the two are a fraction of a
     * basis point apart, with thousands of steps they part by a third and more, and a pool cannot be made again.
     * `settles` — when: a time schedule so many seconds after the opening; a market-cap schedule at that multiple of
     * the first price, or on the second after its time runs out — each as the steps make it.
     */
    parameters: Readonly<{
      activationPoint: number | null;
      extensions: number;
      endFeeBps: number;
      askedEndFeeBps: number;
      settles: Readonly<{ afterSeconds: number; atPriceMultiple: number | null }> | null;
      /** The most the volatility fee adds on top, basis points, as the pool will read it; zero with it switched off. */
      dynamicCeilingBps: number;
    }>;
  }>;

/** The 30 days the program lets an opening lie ahead, seconds. */
export const MAX_OPENING_AHEAD_SECONDS = 2_592_000;
/**
 * The least an opening lies ahead of the chain's clock, seconds: the program refuses a pool whose opening has passed
 * when the transaction lands, and a signed transaction may land any time while its blockhash lives.
 */
export const MIN_OPENING_AHEAD_SECONDS = 120;

/** A fee schedule's request, word for word: a kind or a curve that is not one of the program's is refused, never read as the nearest. */
function assertBaseFee(request: BaseFeeRequest): void {
  const kind = (request as { kind?: unknown } | null)?.kind;
  if (kind !== "fixed" && kind !== "time" && kind !== "marketCap") throw new DlmmProRefusal("BAD_INPUT", "A base fee is fixed, or falls with time, or with the market cap.");
  if (kind === "fixed") return;
  const curve = (request as { curve?: unknown }).curve;
  if (curve !== "linear" && curve !== "exponential") throw new DlmmProRefusal("BAD_INPUT", "A fee schedule falls in a line or exponentially: say which.");
}

type BaseFeeBuilt = Readonly<{
  parameters: BaseFeeConfigParameters;
  /** The fee the schedule settles at, as its own steps make it: what the pool will read. */
  endBps: number;
  askedEndBps: number;
  settles: Readonly<{ afterSeconds: number; atPriceMultiple: number | null }> | null;
}>;

/**
 * A schedule's parameters, and where it really lands. The SDK turns a request into whole steps — an exponential
 * schedule's cut a step is a whole number of basis points, rounded so the fee never falls below what was asked; a
 * market-cap schedule's step of the price likewise — so the fee it settles at is read back off the parameters with the
 * SDK's own arithmetic, as a pool's is.
 */
function baseFeeParametersOf(request: BaseFeeRequest): BaseFeeBuilt {
  if (request.kind === "fixed") return { parameters: fixedBaseFeeParameters(request.bps), endBps: request.bps, askedEndBps: request.bps, settles: null };
  const parameters =
    request.kind === "time"
      ? timeSchedulerBaseFeeParameters({ baseFeeMode: request.curve === "linear" ? BaseFeeMode.TimeSchedulerLinear : BaseFeeMode.TimeSchedulerExponential, startingBaseFeeBps: request.startBps, endingBaseFeeBps: request.endBps, numberOfPeriod: request.periods, totalDuration: request.duration })
      : marketCapSchedulerBaseFeeParameters({ baseFeeMode: request.curve === "linear" ? BaseFeeMode.MarketCapSchedulerLinear : BaseFeeMode.MarketCapSchedulerExponential, startingBaseFeeBps: request.startBps, endingBaseFeeBps: request.endBps, numberOfPeriod: request.periods, priceMultiple: request.priceMultiple, schedulerExpirationDuration: request.expiresAfter });
  const schedule = decodeBaseFee(parameters.baseFeeMode, parameters.data);
  const end = scheduleEnd(schedule, 0n);
  if (schedule.kind === "fixed" || end === null) throw new DlmmProRefusal("FAILED", "A schedule was encoded as a fixed fee.");
  /* Past its end the price no longer matters: any price reads the settled fee. */
  const price = getSqrtPriceFromTickId(0);
  const settled = big(getBaseFeeNumerator(parameters, new BN(end.toString()), new BN(0), price, price));
  const stepsOfPrice = schedule.kind === "marketCap" ? 1 + (schedule.periods * schedule.sqrtPriceStepBps) / 10_000 : null;
  return {
    parameters,
    endBps: feeBpsOf(settled),
    askedEndBps: request.endBps,
    /* The first second at which the schedule reads as settled whatever the price — what a pool's own model calls `settles.atPoint`, counted from its opening. */
    settles: { afterSeconds: Number(end), atPriceMultiple: stepsOfPrice === null ? null : stepsOfPrice * stepsOfPrice },
  };
}

export function createDlmmProPools(context: DlmmProContext) {
  const { connection, client } = context;
  const programId = client.program.programId;

  /** One pool, whole, or null when no DLMM Pro pool lives at the address — nothing, another program's account, or one of this program's that is not a pool. */
  async function read(address: Address, wallet: Address | null = null): Promise<DlmmProPool | null> {
    const key = keyOf(address, "The pool");
    const info = await connection.getAccountInfo(key, "confirmed");
    if (!info || !info.owner.equals(programId)) return null;
    try {
      return await refusing(() => modelOf(context, key, wallet));
    } catch (error) {
      if (error instanceof DlmmProRefusal && error.code === "NO_POOL") return null;
      throw error;
    }
  }

  /**
   * The program's pools, or those of one coin on either side: one `getProgramAccounts` by the pool discriminator (two
   * when a coin is named — it may be X or Y). A pool that cannot be read whole — bytes that do not decode, a coin whose
   * mint does not read, a fee mode or a pool type this release does not have — is left out, never guessed, and never
   * takes the other pools with it.
   */
  async function list(filter: Readonly<{ mint?: Address; wallet?: Address | null }> = {}): Promise<readonly DlmmProPool[]> {
    return refusing(async () => {
      const discriminator = { memcmp: { offset: 0, bytes: poolDiscriminator() } };
      const mint = filter.mint ? keyOf(filter.mint, "The coin").toBase58() : null;
      /* The head starts with the two mints: token X at byte 8, token Y at byte 40. */
      const filters = mint ? [8, 40].map((offset) => [discriminator, { memcmp: { offset, bytes: mint } }]) : [[discriminator]];
      const pages = await Promise.all(filters.map((list) => connection.getProgramAccounts(programId, { commitment: "confirmed", filters: list })));
      const seen = new Set<string>();
      const decoded = pages.flat().flatMap((entry) => {
        const address = entry.pubkey.toBase58();
        if (seen.has(address)) return [];
        seen.add(address);
        try {
          return [{ address: entry.pubkey, ...decodePoolAccount(client, Buffer.from(entry.account.data)) }];
        } catch {
          return [];
        }
      });
      if (decoded.length === 0) return [];
      const [clock, decimals] = await Promise.all([clockOf(context), decimalsOf(connection, decoded.flatMap((entry) => [entry.pool.tokenXMint, entry.pool.tokenYMint]), true)]);
      return decoded.flatMap((entry) => {
        const decimalsX = decimals.get(entry.pool.tokenXMint.toBase58());
        const decimalsY = decimals.get(entry.pool.tokenYMint.toBase58());
        if (decimalsX === undefined || decimalsY === undefined) return [];
        try {
          return [poolModelOf({ ...entry, clock, decimalsX, decimalsY, wallet: filter.wallet ?? null })];
        } catch {
          return [];
        }
      });
    });
  }

  /** Where the one launch pool of a pair lives — whichever coin is named first. */
  function launchPoolAddress(mintA: Address, mintB: Address): Address {
    return deriveLaunchPool(keyOf(mintA, "The coin"), keyOf(mintB, "The pair's coin"), programId).toBase58();
  }

  /** A launch pool of a pair: the caller's fee schedule, the fee's coin and the opening rules — unsigned, for the wallet. */
  function buildLaunchPool(request: LaunchPoolRequest, options: SealOptions = {}): Promise<LaunchPoolBuild> {
    return buildPool(request, null, options);
  }

  /**
   * A pool of a pair from a partner's dynamic config — unsigned: the wallet pays and signs, and the config's own wallet
   * signs beside it (`cosigners` names it). The config is read first: one that is not this program's dynamic config, or
   * that belongs to another wallet than the one named, is refused here.
   */
  async function buildConfigPool(request: ConfigPoolRequest, options: SealOptions = {}): Promise<LaunchPoolBuild> {
    const config = keyOf(request.config, "The config");
    const authority = keyOf(request.authority, "The config's wallet");
    const held = await refusing(async () => {
      const info = await connection.getAccountInfo(config, "confirmed");
      if (!info || !info.owner.equals(programId)) throw new DlmmProRefusal("BAD_INPUT", `No dynamic config of DLMM Pro at ${config.toBase58()}.`);
      try {
        return await client.state.fetchDynamicConfig(config);
      } catch {
        throw new DlmmProRefusal("BAD_INPUT", `No dynamic config of DLMM Pro at ${config.toBase58()}.`);
      }
    });
    if (!held.poolCreatorAuthority.equals(authority)) throw new DlmmProRefusal("BAD_INPUT", "The dynamic config belongs to another wallet than the one named.");
    return buildPool(request, { config, authority }, options);
  }

  async function buildPool(request: LaunchPoolRequest, from: Readonly<{ config: PublicKey; authority: PublicKey }> | null, options: SealOptions): Promise<LaunchPoolBuild> {
    const wallet = keyOf(request.wallet, "The wallet");
    const creator = request.creator ? keyOf(request.creator, "The creator") : wallet;
    const tokenX = keyOf(request.tokenX, "The coin");
    const tokenY = keyOf(request.tokenY, "The pair's coin");
    if (tokenX.equals(tokenY)) throw new DlmmProRefusal("BAD_INPUT", "A pool needs two different coins.");
    if (!Number.isInteger(request.tickSpacing) || request.tickSpacing < 1 || request.tickSpacing > MAX_TICK_SPACING) throw new DlmmProRefusal("BAD_INPUT", `The tick spacing is between 1 and ${MAX_TICK_SPACING}.`);
    if (!Number.isInteger(request.initialTickId) || request.initialTickId < MIN_TICK_ID || request.initialTickId > MAX_TICK_ID) throw new DlmmProRefusal("BAD_INPUT", "The first price's tick is outside the program's range.");
    /* The fee's coin is fixed for ever; «only Y» takes wrapped SOL, USDC, or a coin Meteora gave a badge — which this build does not ask for. */
    /* A pool is made once and for ever: an option that is neither of its words is refused, never read as the other one. */
    if (request.collectFee !== "tokenY" && request.collectFee !== "output") throw new DlmmProRefusal("BAD_INPUT", "A pool collects its fee in token Y only, or in the coin a swap pays out: say which.");
    if (request.dynamicFee !== undefined && typeof request.dynamicFee !== "boolean") throw new DlmmProRefusal("BAD_INPUT", "The volatility fee is on or off.");
    if (request.liquidityMining !== undefined && typeof request.liquidityMining !== "boolean") throw new DlmmProRefusal("BAD_INPUT", "Liquidity mining is on or off.");
    assertBaseFee(request.baseFee);
    if (request.collectFee === "tokenY" && !WHITELISTED_QUOTE_MINTS.some((mint) => mint.equals(tokenY))) throw new DlmmProRefusal("BAD_INPUT", "A pool that collects its fee only in token Y pairs with wrapped SOL or USDC.");

    return refusing(async () => {
      const pool = from ? derivePool(from.config, tokenX, tokenY, programId) : deriveLaunchPool(tokenX, tokenY, programId);
      const [existing, mints, clock] = await Promise.all([connection.getAccountInfo(pool, "confirmed"), connection.getMultipleAccountsInfo([tokenX, tokenY], "confirmed"), clockOf(context)]);
      /* The program's own account at that address is the pair's pool. Lamports anyone sent there are not: the program makes its pool at a funded address. */
      if (existing && existing.owner.equals(programId)) throw new DlmmProRefusal("POOL_EXISTS", from ? "This pair already has its pool from this config; a config has one for a pair." : "This pair already has its launch pool; a pair has one for ever.");
      const [mintX, mintY] = mints;
      if (!mintX || !mintY) throw new DlmmProRefusal("BAD_INPUT", "A coin of the pair does not exist.");
      /* A coin the program takes only with Meteora's badge: the badge where it has one, a refusal here where it has not. */
      const [badgeX, badgeY] = await Promise.all([tokenBadgeFor(connection, tokenX, mintX, "pool"), tokenBadgeFor(connection, tokenY, mintY, "pool")]);

      /* A launch pool: the program takes the payer's balances of both coins as its proof — nothing is moved, neither may be zero. Wrapped SOL the build tops up itself. A config's pool asks no proof: its config's wallet signs instead. */
      if (!from) {
        const held = await connection.getMultipleAccountsInfo([getAssociatedTokenAddressSync(tokenX, wallet, true, mintX.owner), getAssociatedTokenAddressSync(tokenY, wallet, true, mintY.owner)], "confirmed");
        [tokenX, tokenY].forEach((mint, index) => {
          if (mint.equals(NATIVE_MINT)) return;
          const account = held[index];
          if (!account || account.data.length < 72 || Buffer.from(account.data).readBigUInt64LE(64) === 0n) throw new DlmmProRefusal("BALANCE_LOW", `The wallet holds none of ${mint.toBase58()}; a launch pool's creator holds both coins.`);
        });
      }

      const fee = baseFeeParametersOf(request.baseFee);
      const opening = request.opening ?? null;
      let poolActivation: InitializePoolWithDynamicParameters["poolActivation"] = null;
      let activationPoint: BN | null = null;
      if (opening) {
        const points = { swap: opening.swapAt, deposits: opening.depositsAt ?? opening.swapAt, withdrawals: opening.withdrawalsAt ?? opening.swapAt };
        for (const [name, at] of Object.entries(points)) {
          if (!Number.isSafeInteger(at) || BigInt(at) < clock.unix + BigInt(MIN_OPENING_AHEAD_SECONDS)) throw new DlmmProRefusal("BAD_INPUT", `The opening of ${name} is less than ${MIN_OPENING_AHEAD_SECONDS} seconds ahead of the chain's clock.`);
          if (BigInt(at) > clock.unix + BigInt(MAX_OPENING_AHEAD_SECONDS)) throw new DlmmProRefusal("BAD_INPUT", `The opening of ${name} is more than 30 days ahead.`);
        }
        const named = (address: Address | null | undefined, what: string) => (address ? keyOf(address, what) : DEFAULT);
        activationPoint = new BN(points.swap);
        poolActivation = {
          whitelistedSwap: named(opening.swapper, "The early swapper"),
          whitelistedAddLiquidity: named(opening.depositor, "The early depositor"),
          whitelistedRemoveLiquidity: named(opening.withdrawer, "The early withdrawer"),
          activations: [openActivationParameters(), timeBasedActivationParameters({ swapPoint: new BN(points.swap), addLiquidityPoint: new BN(points.deposits), removeLiquidityPoint: new BN(points.withdrawals) })],
        };
      }
      /* The volatility fee is sized from the fee the schedule settles at — as its steps make it, in whole basis points — as Meteora's own launches are: at most a fifth of it. */
      const dynamic = request.dynamicFee === false ? null : getDynamicFeeParams(Math.max(1, Math.floor(fee.endBps)), request.tickSpacing);
      const extensions = encodePoolExtensions([...(request.liquidityMining ? [PoolExtension.LiquidityMining] : []), ...(opening ? [PoolExtension.ActivationAccess] : [])]);
      const parameters: InitializePoolWithDynamicParameters = {
        poolFees: {
          baseFeeParameter: fee.parameters,
          /* The volatility fee is sized from the fee the schedule settles at — as its steps make it, in whole basis points — as Meteora's own launches are: at most a fifth of it. */
          dynamicFeeParameter: dynamic,
        },
        tickSpacing: request.tickSpacing,
        collectFeeMode: request.collectFee === "tokenY" ? CollectFeeMode.OnlyY : CollectFeeMode.OutputToken,
        initialSqrtPrice: getSqrtPriceFromTickId(request.initialTickId),
        activationType: ActivationType.Timestamp,
        activationPoint,
        extensions,
        poolActivation,
      };
      const sdk = await clientPastDust(context, [wallet], [{ mint: tokenX, program: mintX.owner }, { mint: tokenY, program: mintY.owner }]);
      const terms = { tokenXMint: tokenX, tokenYMint: tokenY, creator, payer: wallet, parameters, tokenXProgram: mintX.owner, tokenYProgram: mintY.owner, ...(badgeX ? { tokenBadgeX: badgeX } : {}), ...(badgeY ? { tokenBadgeY: badgeY } : {}) };
      const built = from ? await sdk.pool.initializePoolWithDynamicConfig({ ...terms, config: from.config, poolCreatorAuthority: from.authority }) : await sdk.pool.initializeLaunchPool(terms);
      /* The config's own wallet signs the pool it lets be made: the one signer beside the payer, named to the caller as a cosigner. */
      const sealed = await seal({ connection, wallet, instructions: built.tx.instructions, units: DLMM_PRO_UNITS.createLaunchPool + 2 * DLMM_PRO_UNITS.tokenAccount, fresh: from && !from.authority.equals(wallet) ? [from.authority] : [], options });
      /* What the payer must hold: the fee, and the rent of the pool with the tails it is created with, its oracle, its two vaults, the bitmap's extension where the first price needs one, and any token account the build opens. */
      const sizes = DLMM_PRO_ACCOUNT_BYTES;
      const vault = (program: PublicKey) => (program.equals(TOKEN_2022_PROGRAM_ID) ? sizes.tokenAccount2022 : sizes.tokenAccount);
      /* Against SOL the SDK wraps one lamport where the payer holds no wrapped SOL — the balance the program takes as its proof — and unwraps it at the end. */
      const proofs = from ? [] : [tokenX, tokenY].filter((mint) => mint.equals(NATIVE_MINT)).map((mint) => ({ mint, program: TOKEN_PROGRAM_ID, amount: 1n }));
      const cost = await assertAffords(connection, wallet, proofs, {
        fee: BigInt(sealed.feeLamports),
        instructions: built.tx.instructions,
        accounts: [
          sizes.pool + (opening ? sizes.poolActivation : 0) + (request.liquidityMining ? sizes.poolRewards : 0),
          sizes.oracle,
          vault(mintX.owner),
          vault(mintY.owner),
          ...(built.tickArrayBitmapExtension ? [sizes.bitmapExtension] : []),
        ],
      });
      return {
        ...sealed,
        ...cost,
        pool: built.pool.toBase58(),
        oracle: built.oracle.toBase58(),
        reserveX: built.reserveX.toBase58(),
        reserveY: built.reserveY.toBase58(),
        bitmapExtension: built.tickArrayBitmapExtension?.toBase58() ?? null,
        parameters: {
          activationPoint: activationPoint ? activationPoint.toNumber() : null,
          extensions,
          endFeeBps: fee.endBps,
          askedEndFeeBps: fee.askedEndBps,
          settles: fee.settles,
          dynamicCeilingBps: dynamic ? feeBpsOf(variableFeeCeiling({ initialized: true, maxVolatilityAccumulator: Number(dynamic.maxVolatilityAccumulator), variableFeeControl: Number(dynamic.variableFeeControl), filterPeriod: Number(dynamic.filterPeriod), decayPeriod: Number(dynamic.decayPeriod), reductionFactor: Number(dynamic.reductionFactor) })) : 0,
        },
      };
    });
  }

  /**
   * The tick a pool of this spacing starts on for a price a person names — token Y per token X in whole tokens, a plain
   * decimal string: the price's own tick as the program reads it, aligned down to the spacing.
   */
  function tickOfPrice(price: string, decimalsX: number, decimalsY: number, tickSpacing: number): number {
    let sqrtPrice: bigint;
    try {
      sqrtPrice = sqrtPriceX64OfPrice(price, decimalsX, decimalsY);
    } catch (error) {
      throw new DlmmProRefusal("BAD_INPUT", error instanceof Error ? error.message : "The price is not a number.");
    }
    return alignTickDown(tickIdFromSqrtPrice(new BN(sqrtPrice.toString())), tickSpacing);
  }

  /** The tick a square-root price stands on — a pool's first price, as its account keeps it. */
  function tickOfSqrtPrice(sqrtPriceX64: string): number {
    return tickIdFromSqrtPrice(new BN(sqrtPriceX64));
  }

  /** Where the pool of a pair from a dynamic config lives — whichever coin is named first. */
  function configPoolAddress(config: Address, mintA: Address, mintB: Address): Address {
    return derivePool(keyOf(config, "The config"), keyOf(mintA, "The coin"), keyOf(mintB, "The pair's coin"), programId).toBase58();
  }

  return { read, list, launchPoolAddress, configPoolAddress, tickOfPrice, tickOfSqrtPrice, buildLaunchPool, buildConfigPool };
}

export type DlmmProPools = ReturnType<typeof createDlmmProPools>;

/** The token program of a pool's coin, from the flag the pool keeps. */
export const tokenProgramOf = (flag: number): PublicKey => getTokenProgram(flag);

export { DLMM_PRO_PROGRAM };
