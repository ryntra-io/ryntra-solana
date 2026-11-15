/**
 * The bytes a DLMM Pro build hands back: unsigned, versioned, with their compute budget.
 *
 * The SDK returns instructions and nothing else — no compute budget, no blockhash, a legacy transaction. Every build of
 * this venue goes through `seal`:
 *
 * - the compute-unit limit is put first (and a price, when the caller names one). The limit is the venue's own ceiling
 *   for the action (`DLMM_PRO_UNITS`, measured in the rehearsal of 14.11 — `docs/research/meteora-dlmm-pro-2026-11-14/
 *   results/REHEARSAL.md` — with room on top), or the caller's own number;
 * - the message is version 0, compiled against whatever lookup tables the caller passes (none is needed for one
 *   action; a transaction of several steps may want one);
 * - **the wallet is the fee payer, and no key of Ryntra's signs.** The only other signer a build may name is a fresh
 *   key the caller made for this build — the mint of a new position's or a new order's NFT, which the program creates
 *   and which therefore has to sign once. The venue never makes or holds that key: it takes its address, and returns it
 *   as a `cosigner`. A message that would need any other signature is refused (`FOREIGN_SIGNER`);
 * - a message over the network's 1 232 bytes is refused (`TX_TOO_LARGE`) rather than returned to fail in a wallet.
 *
 * Nothing here signs or sends. The one simulation (`simulationOf`) is a question a build asks before it leans on
 * something it can do without.
 */

import { ComputeBudgetProgram, PublicKey, TransactionMessage, VersionedTransaction, type AddressLookupTableAccount, type Connection, type Transaction, type TransactionInstruction } from "@solana/web3.js";

import type { Address, UnsignedTx } from "../../contracts.ts";
import { DlmmProRefusal } from "./sdk.server.ts";

/** The network's limit on a transaction's wire size. */
export const MAX_TX_BYTES = 1_232;
/** The network's limit on one transaction's compute units. */
export const MAX_TX_UNITS = 1_400_000;
/** The most a build's priority price may cost over its whole compute limit, lamports: a price past it is a slip of units, not a choice. */
export const MAX_PRIORITY_FEE_LAMPORTS = 20_000_000;
/** The largest raw amount the program takes: an unsigned 64-bit number. */
const MAX_RAW = (1n << 64n) - 1n;

export type DlmmProTx = UnsignedTx &
  Readonly<{
    /** The fresh keys that sign beside the wallet — a new NFT's mint; the caller holds them. Empty for most builds. */
    cosigners: readonly Address[];
    /** The compute-unit limit the bytes carry. */
    units: number;
    /** The wire size, signatures' room included. */
    bytes: number;
    /** What the network takes for it, lamports: its signatures, and its priority price over the whole compute limit. */
    feeLamports: number;
  }>;

/**
 * A build: its transaction, and what it tells of its cost besides the network fee the transaction carries.
 *
 * - `rentLamports` — the rent of everything the build creates, at the cluster's own rate: the venue's reckoning, never
 *   below what the chain takes;
 * - `rentReturnedLamports` — of that, the rent of what the build closes itself before it ends: a wrapped-SOL account
 *   it opened. The wallet puts it up and has it back within the same transaction; what it is out of is the difference;
 * - `unwrapsLamports` — the wrapped SOL held in an account of the wallet's that was there before and that the build
 *   closes at its end, as every build of the SDK's that touches SOL does when its owner signs: what the build does not
 *   spend of it comes to the wallet as SOL, with the account's own rent, and an approval on that account ends with
 *   it. Null — the build closes no such account.
 *
 * A wallet that cannot pay for a build is refused before a signature: its fees, the rent that stays, the SOL it wraps —
 * and the larger of the rent that comes back and what a wallet must keep to exist. What an account that was there
 * before returns when the build closes it is not counted towards that: the check asks for a little more there, never
 * for less.
 */
export type DlmmProRent = Readonly<{ rentLamports: number; rentReturnedLamports: number; unwrapsLamports: string | null }>;
export type DlmmProBuild = DlmmProTx & DlmmProRent;

/** The network's fee for one signature, lamports. */
export const LAMPORTS_PER_SIGNATURE = 5_000;

/**
 * Compute-unit ceilings per action: what the action used in the rehearsal on the build deployed on mainnet
 * (`results/rehearsal-mainnet.json`), with about half as much again on top — a limit costs nothing unless a priority
 * price is set, and a limit too low costs the person a failed transaction. The `per…` numbers grow the ceiling with
 * the size of the request. A caller that sets a priority price pays for the limit, not for what was used: it should
 * simulate and pass its own `units`. Measured on 14.11.2026, each as base + per item:
 *
 * | Action | Used |
 * |---|---|
 * | launch pool | 46–48 thousand |
 * | swap | 39 thousand, and some 4.4 more for each tick it crosses that somebody stands on — 7 where limit orders fill there; 13–20 more when it opens a token account |
 * | open or widen a position | by the ticks its ranges stand on: 237 for 46 ticks in five new tick arrays, 240 for 63 in one, 264 for 91 in two, 159 where every tick was there already |
 * | deposit by weight | 13 + 4.4 a range (210 for 45) |
 * | lock for ever | 16 for 45 ranges |
 * | collect fees · compound | 76 · 99 for 45 ranges |
 * | close an empty position | 22 + 1.5 a range |
 * | place a limit order | 83 + 3.8 a tick |
 * | collect · close a limit order | 12 + 2.3 a tick · 15 + 1.6 a tick |
 * | reward: set up · fund · collect | 19 · 14 · 23 |
 */
export const DLMM_PRO_UNITS = Object.freeze({
  /* A token account a build may have to open first (and wrapping SOL into one). */
  tokenAccount: 25_000,
  createLaunchPool: 90_000,
  /* Making a pool's tick-array bitmap extension, ahead of the deposit or the order that needs it. */
  bitmapExtension: 30_000,
  /*
   * A swap's cost follows the ticks it crosses that somebody stands on — the ends of ranges, the prices of limit
   * orders: a step of the spacing with nobody on it costs next to nothing (57 steps with six such ticks used 61
   * thousand; 15 steps with one, 45). So the ceiling counts the ticks that are in the walk's tick arrays between the
   * price now and the price the quote ends at, each as a tick whose limit orders fill, and some more for ticks that
   * may be stood on before the swap lands (`spare`).
   */
  swap: Object.freeze({ base: 90_000, perArray: 25_000, perTick: 7_500, spareTicks: 3, referral: 15_000 }),
  /* An opening writes each new tick into its tick array: its cost follows the distinct ticks of its ranges — two a range where they nest — and the arrays they fall in. */
  openPosition: Object.freeze({ base: 130_000, perTick: 3_500, perArray: 12_000 }),
  addLiquidity: Object.freeze({ base: 40_000, perRange: 6_500 }),
  removeLiquidity: Object.freeze({ base: 50_000, perRange: 6_500 }),
  claimFee: Object.freeze({ base: 45_000, perRange: 2_500 }),
  compound: Object.freeze({ base: 80_000, perRange: 2_500 }),
  lockPermanent: Object.freeze({ base: 15_000, perRange: 600 }),
  closePosition: Object.freeze({ base: 40_000, perRange: 2_500 }),
  delegate: 20_000,
  openLimitOrder: Object.freeze({ base: 125_000, perTick: 6_000 }),
  cancelLimitOrder: Object.freeze({ base: 40_000, perTick: 5_000 }),
  closeLimitOrder: Object.freeze({ base: 35_000, perTick: 3_000 }),
  initializeReward: 40_000,
  fundReward: 40_000,
  claimReward: Object.freeze({ base: 45_000, perRange: 2_500 }),
  withdrawIneligibleReward: 40_000,
});

/** A ceiling that grows with a count, never past the network's own. */
export function unitsOf(base: number, per: number, count: number, extra = 0): number {
  return Math.min(MAX_TX_UNITS, base + per * Math.max(0, count) + extra);
}

export type SealOptions = Readonly<{
  /**
   * The caller's own compute-unit limit; absent, the action's ceiling. A build of several program calls — a position's
   * opening — keeps the venue's ceiling for each of them: one number is not the limit of several.
   */
  units?: number;
  /** A priority price, micro-lamports per compute unit; absent, none is set. */
  priorityMicroLamports?: number;
  /** Lookup tables to compile the message against. */
  lookupTables?: readonly AddressLookupTableAccount[];
  /** A blockhash the caller already read, so the steps of one build share it. */
  blockhash?: Readonly<{ blockhash: string; lastValidBlockHeight: number }>;
}>;

const COMPUTE_BUDGET = ComputeBudgetProgram.programId;

/** The instructions of whatever the SDK built, without any compute-budget instruction it might carry one day. */
export function instructionsOf(built: Transaction | readonly TransactionInstruction[]): TransactionInstruction[] {
  const list = Array.isArray(built) ? (built as readonly TransactionInstruction[]) : (built as Transaction).instructions;
  return list.filter((ix) => !ix.programId.equals(COMPUTE_BUDGET));
}

/**
 * Seals instructions into unsigned version-0 bytes. `fresh` are the keys made for this build; a signer that is neither
 * the wallet nor one of them refuses the build.
 */
export async function seal(
  args: Readonly<{
    connection: Pick<Connection, "getLatestBlockhash">;
    wallet: PublicKey;
    instructions: readonly TransactionInstruction[];
    units: number;
    fresh?: readonly PublicKey[];
    options?: SealOptions;
  }>,
): Promise<DlmmProTx> {
  const { wallet, options = {} } = args;
  if (args.instructions.length === 0) throw new DlmmProRefusal("NOTHING_TO_DO", "The build has no instruction.");
  if (options.units !== undefined && (!Number.isInteger(options.units) || options.units < 1 || options.units > MAX_TX_UNITS)) throw new DlmmProRefusal("BAD_INPUT", `The compute limit is a whole number between 1 and ${MAX_TX_UNITS}.`);
  if (!Number.isFinite(args.units)) throw new DlmmProRefusal("FAILED", "The build's compute limit could not be worked out.");
  const units = Math.min(MAX_TX_UNITS, Math.max(1, Math.floor(options.units ?? args.units)));
  const budget = [ComputeBudgetProgram.setComputeUnitLimit({ units })];
  if (options.priorityMicroLamports !== undefined) {
    if (!Number.isSafeInteger(options.priorityMicroLamports) || options.priorityMicroLamports < 0) throw new DlmmProRefusal("BAD_INPUT", "The priority price is not a whole number of micro-lamports.");
    /* Micro-lamports a unit over the whole limit, in lamports: a number of lamports typed as micro-lamports lands a million times over. */
    if ((BigInt(units) * BigInt(options.priorityMicroLamports)) / 1_000_000n > BigInt(MAX_PRIORITY_FEE_LAMPORTS)) throw new DlmmProRefusal("BAD_INPUT", `The priority price would cost more than ${MAX_PRIORITY_FEE_LAMPORTS} lamports over the build's compute limit.`);
    budget.push(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: options.priorityMicroLamports }));
  }
  const latest = options.blockhash ?? (await args.connection.getLatestBlockhash("confirmed"));
  const message = new TransactionMessage({ payerKey: wallet, recentBlockhash: latest.blockhash, instructions: [...budget, ...instructionsOf(args.instructions)] }).compileToV0Message([...(options.lookupTables ?? [])]);
  const signers = message.staticAccountKeys.slice(0, message.header.numRequiredSignatures);
  if (!signers[0]?.equals(wallet)) throw new DlmmProRefusal("FOREIGN_SIGNER", "The wallet is not the fee payer of the built message.");
  const fresh = args.fresh ?? [];
  const cosigners: Address[] = [];
  for (const signer of signers.slice(1)) {
    if (!fresh.some((key) => key.equals(signer))) throw new DlmmProRefusal("FOREIGN_SIGNER", `The built message asks ${signer.toBase58()} to sign: neither the wallet nor a key made for this build.`);
    cosigners.push(signer.toBase58());
  }
  let wire: Uint8Array;
  try {
    wire = new VersionedTransaction(message).serialize();
  } catch {
    throw new DlmmProRefusal("TX_TOO_LARGE", "The built transaction does not fit a network message.");
  }
  if (wire.length > MAX_TX_BYTES) throw new DlmmProRefusal("TX_TOO_LARGE", `The built transaction is ${wire.length} bytes; the network takes ${MAX_TX_BYTES}.`);
  const priority = options.priorityMicroLamports === undefined ? 0n : (BigInt(units) * BigInt(options.priorityMicroLamports) + 999_999n) / 1_000_000n;
  const feeLamports = Number(BigInt(LAMPORTS_PER_SIGNATURE * message.header.numRequiredSignatures) + priority);
  return { network: "solana", wireBase64: Buffer.from(wire).toString("base64"), validUntil: String(latest.lastValidBlockHeight), cosigners, units, bytes: wire.length, feeLamports };
}

export type SealPart<Role extends string> = Readonly<{ role: Role; instructions: readonly TransactionInstruction[]; units: number; fresh?: readonly PublicKey[] }>;

/**
 * Parts of one build, in order, sealed into the fewest transactions that hold them: a part joins the transaction
 * before it while the two fit a message and the network's compute limit, and starts the next when they do not. The
 * order is never changed and a part is never split. Each transaction says which parts it carries, shares one
 * blockhash with the others, and has the limit of its own parts — a caller's single `units` is not applied to several.
 * A priority price is paid over a transaction's whole limit, so parts whose joined limit would carry it past the
 * venue's ceiling are kept apart like parts that do not fit a message.
 */
export async function sealPacked<Role extends string>(
  args: Readonly<{ connection: Pick<Connection, "getLatestBlockhash">; wallet: PublicKey; parts: readonly SealPart<Role>[]; options?: SealOptions }>,
): Promise<readonly (DlmmProTx & Readonly<{ roles: readonly Role[] }>)[]> {
  const blockhash = args.options?.blockhash ?? (await args.connection.getLatestBlockhash("confirmed"));
  const options = { ...args.options, blockhash, units: undefined };
  const sealGroup = (group: readonly SealPart<Role>[]) =>
    seal({ connection: args.connection, wallet: args.wallet, instructions: group.flatMap((part) => part.instructions), units: group.reduce((sum, part) => sum + part.units, 0), fresh: group.flatMap((part) => part.fresh ?? []), options });
  const packed: (DlmmProTx & Readonly<{ roles: readonly Role[] }>)[] = [];
  let group: SealPart<Role>[] = [];
  let sealed: DlmmProTx | null = null;
  for (const part of args.parts) {
    const wider = [...group, part];
    const joined = wider.reduce((sum, entry) => sum + entry.units, 0);
    const price = args.options?.priorityMicroLamports;
    const dear = typeof price === "number" && Number.isSafeInteger(price) && price > 0 && group.length > 0 && (BigInt(joined) * BigInt(price)) / 1_000_000n > BigInt(MAX_PRIORITY_FEE_LAMPORTS);
    const fits = joined <= MAX_TX_UNITS && !dear;
    const next = fits
      ? await sealGroup(wider).catch((error: unknown) => {
          if (error instanceof DlmmProRefusal && error.code === "TX_TOO_LARGE") return null;
          throw error;
        })
      : null;
    if (next) {
      group = wider;
      sealed = next;
      continue;
    }
    if (sealed) packed.push({ ...sealed, roles: group.map((entry) => entry.role) });
    group = [part];
    /* A part that does not fit a message alone is refused as it is. */
    sealed = await sealGroup(group);
  }
  if (sealed) packed.push({ ...sealed, roles: group.map((entry) => entry.role) });
  return packed;
}

/**
 * How a build fares in a simulation as it stands: unsigned, at the node's own blockhash. `passes` and `fails` are the
 * node's own word; `unavailable` — the node could not be asked. Whoever asks is deciding whether to lean on something
 * a build can do without, and leans on it only where it was shown to hold.
 */
export async function simulationOf(connection: Pick<Connection, "simulateTransaction">, build: Pick<DlmmProTx, "wireBase64">): Promise<"passes" | "fails" | "unavailable"> {
  try {
    const tx = VersionedTransaction.deserialize(Buffer.from(build.wireBase64, "base64"));
    const result = await connection.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" });
    return result.value.err === null ? "passes" : "fails";
  } catch {
    return "unavailable";
  }
}

/** The message of sealed bytes, for a caller that reads back what it is about to hand a wallet. */
export function messageOf(tx: Pick<UnsignedTx, "wireBase64">): VersionedTransaction {
  return VersionedTransaction.deserialize(Buffer.from(tx.wireBase64, "base64"));
}

/** An address as a key; a refusal when it is not one. */
export function keyOf(address: Address, what: string): PublicKey {
  try {
    return new PublicKey(address);
  } catch {
    throw new DlmmProRefusal("BAD_INPUT", `${what} is not an address.`);
  }
}

/** A raw amount — a decimal string of base units, within the program's 64 bits — as a `bigint`; a refusal when it is not one. */
export function rawOf(value: string, what: string): bigint {
  if (typeof value !== "string" || !/^\d{1,20}$/.test(value)) throw new DlmmProRefusal("BAD_INPUT", `${what} is not a raw amount.`);
  const amount = BigInt(value);
  if (amount > MAX_RAW) throw new DlmmProRefusal("BAD_INPUT", `${what} is more than the program can hold.`);
  return amount;
}

/** Basis points within a range; a refusal otherwise. */
export function bpsOf(value: number, what: string, min = 0, max = 10_000): number {
  if (!Number.isInteger(value) || value < min || value > max) throw new DlmmProRefusal("BAD_INPUT", `${what} is not between ${min} and ${max} basis points.`);
  return value;
}

/** The least of `amount` after `slippageBps`, rounded down. */
export function minimumAfterSlippage(amount: bigint, slippageBps: number): bigint {
  return (amount * BigInt(10_000 - slippageBps)) / 10_000n;
}
