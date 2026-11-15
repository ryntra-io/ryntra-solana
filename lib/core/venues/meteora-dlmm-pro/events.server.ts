/**
 * The events of a DLMM Pro transaction: what a swap, an order, a position or a reward left on chain, read
 * from the transaction itself.
 *
 * The program has no Data API and no log to trust: almost every event is an **event CPI** — the program calls itself
 * with an inner instruction whose data is Anchor's eight-byte tag, the event's eight-byte discriminator and its Borsh
 * fields. Inner instructions are never truncated, unlike logs, and Anchor's own `EventParser` does not see them. Two
 * events only are written to the log instead (`evtClaimProtocolFee`, `evtInitializeBitmapExtension`) and can be cut
 * off by the log limit — so a log event missing proves nothing.
 *
 * Every event is decoded by the SDK's own coder (the IDL the venue is pinned to) and returned as plain data: keys as
 * base58, numbers wider than a float as decimal strings. With each comes the instruction that emitted it and its
 * accounts, because the events do not name their wallet: a swap's `user` is the signer of the swap instruction — the
 * person, when the wallet calls the program itself; a router's own authority, when another program swaps through
 * accounts it holds for the person.
 *
 * What emits **nothing**, and must be read from accounts instead: a limit order being filled (the fill shows only when
 * the order is collected — `./orders.ts` reads it from the tick), fees and rewards accruing, a vesting release, a pool
 * reaching its opening time or its price target, tick arrays created inside another instruction.
 *
 * Nothing here signs or sends.
 */

import { PublicKey, type Connection, type VersionedTransactionResponse } from "@solana/web3.js";
import { getBase58Encoder } from "@solana/kit";
import BN from "bn.js";

import { getTransactionAnyVersion } from "../../../solana/v1-tx.ts";
import type { Address } from "../../contracts.ts";
import type { DlmmProContext } from "./pools.server.ts";
import { DlmmProRefusal } from "./sdk.server.ts";

/** Anchor's tag on a self-invoked event instruction: the first eight bytes of sha256("anchor:event"). */
export const EVENT_IX_TAG = Buffer.from("e445a52e51cb9a1d", "hex");
/** Where the `swap` instruction names its signer, in the IDL's order of accounts. */
export const SWAP_USER_INDEX = 11;
/** The events the program writes to the log rather than as an inner instruction. */
export const LOG_EVENTS: ReadonlySet<string> = new Set(["evtClaimProtocolFee", "evtInitializeBitmapExtension"]);

export type EvtSwap = Readonly<{
  pool: Address;
  preTickId: number;
  postTickId: number;
  preSqrtPrice: string;
  postSqrtPrice: string;
  swapForY: boolean;
  /** The whole input the wallet paid, its coin's transfer fee and — when the fee is on the input — the trading fee included. */
  amountIn: string;
  amountLeft: string;
  /** What the wallet received, after the trading fee and the output coin's transfer fee. */
  amountOut: string;
  transferFeeIn: string;
  transferFeeOut: string;
  /** The fee's parts, all in the fee's coin: to liquidity, to the protocol, to the limit orders filled, to the referral, to the pool's partner. */
  mmFee: string;
  protocolFee: string;
  limitOrderFee: string;
  hostFee: string;
  partnerFee: string;
  feesOnInput: boolean;
  feesOnTokenX: boolean;
}>;

export type EvtOpenLimitOrder = Readonly<{
  pool: Address;
  owner: Address;
  limitOrder: Address;
  nftMint: Address;
  isAskSide: boolean;
  orderAges: readonly string[];
  referral: Address | null;
  /** The ticks as placed — absolute, a relative order's offsets resolved — and what rests on each. */
  actualTickLimitOrderAmount: readonly Readonly<{ id: number; amount: string }>[];
}>;

export type EvtCancelLimitOrder = Readonly<{
  pool: Address;
  owner: Address;
  referral: Address;
  limitOrder: Address;
  nftMint: Address;
  nftAccount: Address;
  /** What left each reserve for the owner, the owner's fee share included, before transfer fees. */
  ownerAmountX: string;
  ownerAmountY: string;
  ownerFeeX: string;
  ownerFeeY: string;
  referralFee: string;
  referralFeesOnTokenX: boolean;
  tickIds: readonly number[];
}>;

export type EvtLiquidity = Readonly<{
  pool: Address;
  owner: Address;
  position: Address;
  nftMint: Address;
  nftAccount: Address;
  amountX: string;
  amountY: string;
  currentSqrtPrice: string;
  bitmap: string;
  liquidities: readonly string[];
}>;

export type EvtClaimFee = Readonly<{ pool: Address; owner: Address; position: Address; nftMint: Address; nftAccount: Address; amountX: string; amountY: string; currentSqrtPrice: string }>;
export type EvtClaimReward = Readonly<{ pool: Address; owner: Address; position: Address; nftMint: Address; nftAccount: Address; rewardMint: Address; rewardIndex: number; amount: string }>;
export type EvtLockPermanent = Readonly<{ pool: Address; owner: Address; position: Address; nftMint: Address; nftAccount: Address; bps: number; liquidities: readonly string[] }>;
export type EvtOpenPosition = Readonly<{ pool: Address; owner: Address; position: Address; nftMint: Address; nftAccount: Address; tickRanges: readonly Readonly<{ tickLowerId: number; tickUpperId: number }>[] }>;
export type EvtInitializePool = Readonly<{
  pool: Address;
  creator: Address;
  payer: Address;
  tokenXMint: Address;
  tokenYMint: Address;
  poolType: number;
  tickSpacing: number;
  collectFeeMode: number;
  initialSqrtPrice: string;
  activationType: number;
  activationPoint: string;
  extensions: number;
}>;

/** The events this venue names; every other event of the program still decodes, as `data` of plain fields. */
export type DlmmProEventData = Readonly<{
  evtSwap: EvtSwap;
  evtOpenLimitOrder: EvtOpenLimitOrder;
  evtCancelLimitOrder: EvtCancelLimitOrder;
  evtAddLiquidity: EvtLiquidity;
  evtRemoveLiquidity: EvtLiquidity;
  evtClaimFee: EvtClaimFee;
  evtClaimReward: EvtClaimReward;
  evtLockPermanent: EvtLockPermanent;
  evtOpenPosition: EvtOpenPosition;
  evtInitializePool: EvtInitializePool;
}>;

export type DlmmProEvent = Readonly<{
  /** As the SDK's coder names it: `evtSwap`, `evtOpenLimitOrder`, … */
  name: string;
  data: Readonly<Record<string, unknown>>;
  /** How it was delivered: an inner instruction, or a log line. */
  via: "cpi" | "log";
  /** The top-level instruction it happened under. */
  outerIndex: number | null;
  /** The accounts of the program's own instruction that emitted it, in the IDL's order; empty for a log event. */
  accounts: readonly Address[];
  /** The signer of the swap instruction — the trader, or a router's authority when another program swaps for them; null for any other event. */
  user: Address | null;
}>;

const camel = (name: string) => name.replace(/_([a-z0-9])/g, (_, letter: string) => letter.toUpperCase());

/** A decoded value as plain data: keys to base58, big numbers to decimal strings, bytes to hex, names in camel case. */
export function plainEventValue(value: unknown): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (value instanceof PublicKey) return value.toBase58();
  if (BN.isBN(value)) return (value as BN).toString(10);
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(plainEventValue);
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return Buffer.from(value).toString("hex");
  if (typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, inner]) => [camel(key), plainEventValue(inner)]));
  return value;
}

type EventCoder = Readonly<{ decode(base64: string): Readonly<{ name: string; data: unknown }> | null }>;
type InnerInstruction = Readonly<{ programIdIndex: number; accounts: readonly number[]; data: string | Uint8Array }>;

const base58 = getBase58Encoder();
const bytesOf = (data: string | Uint8Array): Buffer => (typeof data === "string" ? Buffer.from(base58.encode(data)) : Buffer.from(data));

/**
 * The program's events in a landed transaction, in the order they happened. `program` — the program's address;
 * `coder` — its events coder. A transaction that failed has none worth reading and returns none; one that names the
 * program and was read without its inner instructions cannot be told, and throws — it is never read as «nothing
 * happened».
 */
export function decodeDlmmProEvents(tx: Pick<VersionedTransactionResponse, "meta" | "transaction">, program: Address, coder: EventCoder): readonly DlmmProEvent[] {
  const meta = tx.meta;
  if (!meta || meta.err) return [];
  const message = tx.transaction.message;
  const keys = message.getAccountKeys({ accountKeysFromLookups: meta.loadedAddresses ?? undefined });
  const keyAt = (index: number): Address => keys.get(index)?.toBase58() ?? "";
  const events: DlmmProEvent[] = [];
  if (meta.innerInstructions === null || meta.innerInstructions === undefined) {
    for (let index = 0; index < keys.length; index += 1) {
      if (keyAt(index) === program) throw new DlmmProRefusal("FAILED", "The transaction was read without its inner instructions: the program's events in it cannot be told.");
    }
  }
  for (const group of meta.innerInstructions ?? []) {
    const outer = message.compiledInstructions[group.index];
    const list = group.instructions as readonly InnerInstruction[];
    for (let position = 0; position < list.length; position += 1) {
      const ix = list[position]!;
      if (keyAt(ix.programIdIndex) !== program) continue;
      const data = bytesOf(ix.data);
      if (data.length < 16 || !data.subarray(0, 8).equals(EVENT_IX_TAG)) continue;
      const event = coder.decode(data.subarray(8).toString("base64"));
      if (!event) continue;
      /* The instruction that wrote it: the program's own just before it when another program called it, else the outer one. */
      let emitter: readonly number[] | null = null;
      for (let back = position - 1; back >= 0 && emitter === null; back -= 1) {
        const prior = list[back]!;
        if (keyAt(prior.programIdIndex) === program && !bytesOf(prior.data).subarray(0, 8).equals(EVENT_IX_TAG)) emitter = prior.accounts;
      }
      if (emitter === null && outer && keyAt(outer.programIdIndex) === program) emitter = outer.accountKeyIndexes;
      const accounts = (emitter ?? []).map(keyAt);
      events.push({ name: event.name, data: plainEventValue(event.data) as Record<string, unknown>, via: "cpi", outerIndex: group.index, accounts, user: event.name === "evtSwap" ? (accounts[SWAP_USER_INDEX] ?? null) : null });
    }
  }
  /* The two log events, read only inside the program's own frames of the log. */
  const stack: string[] = [];
  for (const line of meta.logMessages ?? []) {
    const invoke = /^Program (\S+) invoke \[\d+\]$/.exec(line);
    if (invoke) {
      stack.push(invoke[1]!);
      continue;
    }
    if (/^Program \S+ (success|failed)/.test(line)) {
      stack.pop();
      continue;
    }
    if (stack[stack.length - 1] !== program || !line.startsWith("Program data: ")) continue;
    let event: ReturnType<EventCoder["decode"]> = null;
    try {
      event = coder.decode(line.slice("Program data: ".length).trim());
    } catch {
      event = null;
    }
    if (event && LOG_EVENTS.has(event.name)) events.push({ name: event.name, data: plainEventValue(event.data) as Record<string, unknown>, via: "log", outerIndex: null, accounts: [], user: null });
  }
  return events;
}

/** The events of one name, typed. */
export function eventsNamed<Name extends keyof DlmmProEventData>(events: readonly DlmmProEvent[], name: Name): readonly (DlmmProEvent & Readonly<{ data: DlmmProEventData[Name] }>)[] {
  return events.filter((event) => event.name === name) as unknown as readonly (DlmmProEvent & Readonly<{ data: DlmmProEventData[Name] }>)[];
}

export function createDlmmProEvents(context: Pick<DlmmProContext, "client"> & Readonly<{ connection: Pick<Connection, "getTransaction"> }>) {
  const program = context.client.program.programId.toBase58();
  const coder = context.client.program.coder.events as unknown as EventCoder;

  /** The events of a transaction already read. */
  function decode(tx: Pick<VersionedTransactionResponse, "meta" | "transaction">): readonly DlmmProEvent[] {
    return decodeDlmmProEvents(tx, program, coder);
  }

  /** The events of a landed transaction, by its signature; null when the node does not keep it. */
  async function read(signature: string): Promise<readonly DlmmProEvent[] | null> {
    const tx = await getTransactionAnyVersion(context.connection, signature);
    return tx ? decode(tx) : null;
  }

  return { decode, read };
}

export type DlmmProEvents = ReturnType<typeof createDlmmProEvents>;
