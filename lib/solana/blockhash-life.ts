/**
 * How long transaction bytes still live — read from the chain, not a clock.
 *
 * Mainnet slots are 200 ms now (measured 2026-10-17: 265–287 slots a minute,
 * ~216 ms), and a recent blockhash is valid for 150 blocks after the block
 * it names. So bytes built a moment ago live about thirty seconds, not the
 * sixty to ninety the older comments in this repository still describe.
 * Every place a person can still sign — a Review, a ticket, a launch build —
 * asks this module how much of that life is left instead of trusting a
 * window it set when the bytes were built.
 *
 * Two readings decide it, and both come from the chain:
 *
 * - **Blocks left** — `lastValidBlockHeight` minus the block height at
 *   `confirmed`. The height is read through `getEpochInfo`, which carries
 *   the slot beside it, because the public PublicNode endpoint answers
 *   `getBlockHeight` with its *slot* (about twenty-two million too high,
 *   `lib/solana/quotes.ts`). A height that is not below its own slot, or
 *   that leaves more blocks than a blockhash can ever have, is not a reading
 *   — it is UNKNOWN, never "expired".
 * - **Milliseconds per slot** — `getRecentPerformanceSamples`, cached for
 *   five minutes, 200 ms when the samples are missing or implausible. Slots,
 *   not blocks: a skipped slot makes a block take longer, so this can only
 *   under-state the life left, which is the safe side for "may still sign".
 *
 * What this module never decides is that sent bytes **will not land**. That
 * answer belongs to the chain alone — the block height past
 * `lastValidBlockHeight`, or `isBlockhashValid` from two independent RPCs —
 * and the 120, 150 and 300-second clocks that guard it elsewhere stay as
 * fallbacks and are never shortened by anything here. Shortening them would
 * let live bytes be declared dead and sent a second time.
 *
 * Client-safe: no value import reaches Node or the RPC transport; the readers
 * take a handle by type only.
 */

import type { SolanaRpcHandle } from "./rpc.ts";

/** A recent blockhash is valid for 150 blocks after the block it names. */
export const BLOCKHASH_LIFE_BLOCKS = 150;

/** Mainnet since October 2026; what the readers fall back to. */
export const FALLBACK_MS_PER_SLOT = 200;

/** One sample read serves every Review for five minutes. */
export const MS_PER_SLOT_CACHE_MS = 5 * 60_000;

/** Readings outside this band are a broken sample, not a cluster speed. */
const MS_PER_SLOT_MIN = 50;
const MS_PER_SLOT_MAX = 1_000;

/**
 * Room kept at the end of the bytes' life for the signed transaction to be
 * sent and land inside the same blockhash.
 */
export const BLOCKHASH_SUBMIT_MARGIN_MS = 5_000;

/**
 * Room for each further transaction sent after the first inside the same blockhash (a launch's lock and fee sharing, a
 * claim of several): the one before it has to confirm first, a second or two on 200 ms slots.
 */
export const NEXT_TRANSACTION_MARGIN_MS = 2_500;

/**
 * The life of bytes built right now on a 200 ms cluster: 150 blocks × 200 ms.
 * Every window a person may still sign inside is bounded by this minus
 * {@link BLOCKHASH_SUBMIT_MARGIN_MS}; `blockhash-windows.test.mjs` holds each
 * signing window in the web to it.
 */
export const BLOCKHASH_LIFE_MS = BLOCKHASH_LIFE_BLOCKS * FALLBACK_MS_PER_SLOT;
export const MAX_SIGNABLE_WINDOW_MS = BLOCKHASH_LIFE_MS - BLOCKHASH_SUBMIT_MARGIN_MS;

/**
 * The least of the bytes' remaining life worth opening a wallet on: a wallet
 * has to raise its prompt and a person has to read and press it. Less than
 * this, and the honest move is fresh bytes before the wallet opens.
 */
export const MIN_WALLET_WINDOW_MS = 10_000;

/**
 * Blocks left above which a reading cannot be true. `lastValidBlockHeight` is
 * the blockhash's own height plus 150, so a fresh one leaves at most ~151; a
 * little slack covers a provider whose `confirmed` is a block behind.
 */
const PLAUSIBLE_BLOCKS_LEFT_MAX = BLOCKHASH_LIFE_BLOCKS + 10;

/** Blocks past beyond which a reading is not this cluster's (~an hour on 200 ms slots); the bytes in this code are minutes old at most. */
const PLAUSIBLE_BLOCKS_PAST_MAX = 20_000;

export type ChainTip = Readonly<{ blockHeight: bigint; absoluteSlot: bigint }>;

export type BlockhashLife = Readonly<
  | {
      state: "LIVE";
      blocksLeft: number;
      msPerSlot: number;
      /** The bytes' remaining life on the chain. */
      msLeft: number;
      /** What is left to sign inside: life minus the submit margin, never below 0. */
      signableMs: number;
    }
  | { state: "EXPIRED"; blocksPast: number; msPerSlot: number }
  | { state: "UNKNOWN"; reason: string; msPerSlot: number }
>;

function toBigInt(value: unknown): bigint | null {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value === "string" && /^\d{1,20}$/.test(value)) return BigInt(value);
  return null;
}

/**
 * Pure: blocks and milliseconds left for bytes whose blockhash expires at
 * `lastValidBlockHeight`, given a chain tip read at `confirmed`.
 */
export function assessBlockhashLife(args: Readonly<{
  lastValidBlockHeight: bigint | number | string;
  tip: ChainTip | null;
  msPerSlot?: number;
  marginMs?: number;
}>): BlockhashLife {
  const msPerSlot = plausibleMsPerSlot(args.msPerSlot) ?? FALLBACK_MS_PER_SLOT;
  const lastValid = toBigInt(args.lastValidBlockHeight);
  if (lastValid === null) return { state: "UNKNOWN", reason: "lastValidBlockHeight is not a block height.", msPerSlot };
  if (!args.tip) return { state: "UNKNOWN", reason: "The chain tip could not be read.", msPerSlot };
  const height = toBigInt(args.tip.blockHeight);
  const slot = toBigInt(args.tip.absoluteSlot);
  if (height === null || slot === null || height <= 0n) {
    return { state: "UNKNOWN", reason: "The chain tip is not a block height.", msPerSlot };
  }
  /* Block height lags the slot by every slot ever skipped — millions. A
     height at or above its own slot is a slot answered as a height. */
  if (height >= slot) {
    return { state: "UNKNOWN", reason: "The endpoint answered the block height with its slot.", msPerSlot };
  }
  const left = lastValid - height;
  if (left > BigInt(PLAUSIBLE_BLOCKS_LEFT_MAX)) {
    return { state: "UNKNOWN", reason: "More blocks left than a blockhash can have; the tip is not this cluster's.", msPerSlot };
  }
  /* Long past, by more than a provider's lag explains: a height from another cluster or a slot-like reading — not a verdict. */
  if (left < -BigInt(PLAUSIBLE_BLOCKS_PAST_MAX)) {
    return { state: "UNKNOWN", reason: "Further past than a reading of this cluster can be; the tip is not a block height.", msPerSlot };
  }
  if (left < 0n) return { state: "EXPIRED", blocksPast: Number(-left), msPerSlot };
  const blocksLeft = Number(left);
  const msLeft = blocksLeft * msPerSlot;
  const margin = args.marginMs ?? BLOCKHASH_SUBMIT_MARGIN_MS;
  return { state: "LIVE", blocksLeft, msPerSlot, msLeft, signableMs: Math.max(0, msLeft - margin) };
}

/**
 * How long a person may still sign bytes, given their life.
 *
 * LIVE → what is left minus the margin. EXPIRED → nothing. UNKNOWN → one
 * full life at the measured slot speed less `spentMs`, the build's own time
 * (`lifeWindowMs`); a blockhash a provider fetched before our build began is
 * the one age this cannot see, so callers that know `lastValidBlockHeight`
 * read it from the chain instead. Whole milliseconds.
 * `cap` bounds the answer by a window the caller wants for other reasons;
 * `transactions` keeps a further margin for each transaction sent after the
 * first inside the same blockhash (a launch, a claim of several).
 */
export function signableWindowMs(life: BlockhashLife, cap = Number.POSITIVE_INFINITY, transactions = 1, spentMs = 0): number {
  const margin = BLOCKHASH_SUBMIT_MARGIN_MS + NEXT_TRANSACTION_MARGIN_MS * Math.max(0, Math.floor(transactions) - 1);
  const full = BLOCKHASH_LIFE_BLOCKS * life.msPerSlot;
  return Math.floor(Math.max(0, Math.min(lifeWindowMs(life, spentMs) - margin, cap, full - BLOCKHASH_SUBMIT_MARGIN_MS)));
}

/**
 * How long the bytes themselves still live — what a server may hold them for before calling them dead. LIVE → the
 * chain's answer; EXPIRED → nothing; UNKNOWN → one full life at the measured speed less `spentMs`, the time the build
 * already took since the blockhash was fetched (it errs short).
 */
export function lifeWindowMs(life: BlockhashLife, spentMs = 0): number {
  const full = BLOCKHASH_LIFE_BLOCKS * life.msPerSlot;
  const left = life.state === "LIVE" ? life.msLeft : life.state === "EXPIRED" ? 0 : full - Math.max(0, spentMs);
  return Math.floor(Math.max(0, Math.min(left, full)));
}

/**
 * Client side: how long until bytes that arrived with `signableMs` are dead on the chain — the signable window plus
 * the margin it kept. Before then, asking the chain whether they are dead only spends requests.
 */
export function msUntilBytesDie(args: Readonly<{ receivedAtMs: number; signableMs: number; nowMs?: number }>): number {
  const now = args.nowMs ?? Date.now();
  if (!Number.isFinite(args.receivedAtMs) || !Number.isFinite(args.signableMs)) return 0;
  return Math.max(0, args.receivedAtMs + args.signableMs + BLOCKHASH_SUBMIT_MARGIN_MS - now);
}

/**
 * Client side: may a wallet open on bytes whose signable window was
 * `signableMs` when they arrived at `receivedAtMs`? Relative, so a skewed
 * browser clock cannot stretch it. False means: fresh bytes first.
 */
export function mayOpenWallet(args: Readonly<{
  receivedAtMs: number;
  signableMs: number;
  nowMs?: number;
  minWindowMs?: number;
}>): boolean {
  const now = args.nowMs ?? Date.now();
  if (!Number.isFinite(args.receivedAtMs) || !Number.isFinite(args.signableMs) || !Number.isFinite(now)) return false;
  const left = args.receivedAtMs + args.signableMs - now;
  return left >= (args.minWindowMs ?? MIN_WALLET_WINDOW_MS);
}

/** Client side: are bytes past their signable window (a signature now would be refused)? */
export function signableWindowClosed(args: Readonly<{
  receivedAtMs: number;
  signableMs: number;
  nowMs?: number;
}>): boolean {
  const now = args.nowMs ?? Date.now();
  if (!Number.isFinite(args.receivedAtMs) || !Number.isFinite(args.signableMs)) return true;
  return now >= args.receivedAtMs + args.signableMs;
}

function plausibleMsPerSlot(value: number | undefined): number | null {
  if (value === undefined || !Number.isFinite(value)) return null;
  return value >= MS_PER_SLOT_MIN && value <= MS_PER_SLOT_MAX ? value : null;
}

/** Pure: milliseconds per slot from `getRecentPerformanceSamples`, or null. */
export function msPerSlotFromSamples(
  samples: readonly Readonly<{ numSlots: bigint | number; samplePeriodSecs: number }>[] | null | undefined,
): number | null {
  if (!Array.isArray(samples) || samples.length === 0) return null;
  let slots = 0;
  let ms = 0;
  for (const sample of samples) {
    const count = Number(sample.numSlots);
    const seconds = Number(sample.samplePeriodSecs);
    if (!Number.isFinite(count) || !Number.isFinite(seconds) || count <= 0 || seconds <= 0) continue;
    slots += count;
    ms += seconds * 1_000;
  }
  if (slots === 0) return null;
  return plausibleMsPerSlot(ms / slots);
}

let slotCache: Readonly<{ value: number; at: number }> | null = null;

/** Tests only: forget the cached slot speed. */
export function resetMsPerSlotCache(): void {
  slotCache = null;
}

/**
 * The two chain reads this module makes, whichever client the caller holds:
 * a `@solana/kit` handle ({@link kitChainReader}) or a web3.js `Connection`
 * ({@link web3ChainReader}).
 */
export type ChainReader = Readonly<{
  /** `getEpochInfo` at `confirmed`: the block height and the slot together. */
  epochInfo: () => Promise<Readonly<{ blockHeight?: unknown; absoluteSlot?: unknown }>>;
  /** `getRecentPerformanceSamples(limit)`. */
  performanceSamples: (limit: number) => Promise<readonly Readonly<{ numSlots: bigint | number; samplePeriodSecs: number }>[]>;
}>;

export function kitChainReader(handle: Pick<SolanaRpcHandle, "rpc" | "timeoutMs" | "endpoints">): ChainReader {
  const signal = () => AbortSignal.timeout(handle.timeoutMs * Math.max(1, handle.endpoints.length) + 1_000);
  return {
    epochInfo: () => handle.rpc.getEpochInfo({ commitment: "confirmed" }).send({ abortSignal: signal() }),
    performanceSamples: (limit) => handle.rpc.getRecentPerformanceSamples(limit).send({ abortSignal: signal() }),
  };
}

/** The web3.js `Connection` shape, by structure: no value import of web3.js here. */
export type Web3ChainConnection = Readonly<{
  getEpochInfo: (commitment?: "confirmed") => Promise<Readonly<{ blockHeight?: number | null; absoluteSlot: number }>>;
  getRecentPerformanceSamples: (limit?: number) => Promise<readonly Readonly<{ numSlots: number; samplePeriodSecs: number }>[]>;
}>;

export function web3ChainReader(connection: Web3ChainConnection, timeoutMs = 8_000): ChainReader {
  const bounded = <T,>(promise: Promise<T>): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error("The endpoint did not answer in time.")), timeoutMs);
    });
    return Promise.race([promise, late]).finally(() => clearTimeout(timer));
  };
  return {
    epochInfo: () => bounded(connection.getEpochInfo("confirmed")),
    performanceSamples: (limit) => bounded(connection.getRecentPerformanceSamples(limit)),
  };
}

type ReadOptions = Readonly<{ nowMs?: () => number }>;

/**
 * Milliseconds per slot, cached five minutes, 200 ms when unreadable. Never
 * throws: a missing sample must not stop a Review from being built.
 */
export async function readMsPerSlot(reader: ChainReader, options: ReadOptions = {}): Promise<number> {
  const now = (options.nowMs ?? Date.now)();
  if (slotCache && now - slotCache.at < MS_PER_SLOT_CACHE_MS) return slotCache.value;
  let value = FALLBACK_MS_PER_SLOT;
  try {
    value = msPerSlotFromSamples(await reader.performanceSamples(5)) ?? FALLBACK_MS_PER_SLOT;
  } catch {
    value = FALLBACK_MS_PER_SLOT;
  }
  slotCache = { value, at: now };
  return value;
}

/** The chain tip at `confirmed`: block height and slot together, or null. */
export async function readChainTip(reader: ChainReader): Promise<ChainTip | null> {
  try {
    const info = await reader.epochInfo();
    const blockHeight = toBigInt(info.blockHeight);
    const absoluteSlot = toBigInt(info.absoluteSlot);
    return blockHeight === null || absoluteSlot === null ? null : { blockHeight, absoluteSlot };
  } catch {
    return null;
  }
}

/** Both readings, then the pure verdict. Never throws. */
export async function readBlockhashLife(
  reader: ChainReader,
  lastValidBlockHeight: bigint | number | string,
  options: ReadOptions = {},
): Promise<BlockhashLife> {
  const [msPerSlot, tip] = await Promise.all([readMsPerSlot(reader, options), readChainTip(reader)]);
  return assessBlockhashLife({ lastValidBlockHeight, tip, msPerSlot });
}

/** A server's two windows over bytes it just built: how long they live, and how long a person may still sign them. */
export type BuildWindows = Readonly<{ lifeMs: number; signableMs: number; state: BlockhashLife["state"] }>;

type WindowOptions = ReadOptions & Readonly<{
  capMs?: number;
  transactions?: number;
  /** When the build began (the blockhash was fetched at or after it) — for an UNKNOWN reading, its time is subtracted. */
  startedAtMs?: number;
}>;

function windowsOf(life: BlockhashLife, options: WindowOptions): BuildWindows {
  const now = (options.nowMs ?? Date.now)();
  const spentMs = options.startedAtMs === undefined ? 0 : Math.max(0, now - options.startedAtMs);
  return {
    state: life.state,
    lifeMs: Math.min(lifeWindowMs(life, spentMs), options.capMs ?? Number.POSITIVE_INFINITY),
    signableMs: signableWindowMs(life, options.capMs, options.transactions, spentMs),
  };
}

/**
 * Both windows for bytes that were just built: the life read from the chain (`lastValidBlockHeight` against the tip),
 * capped by `capMs` and by 150 blocks at the measured speed. Never throws.
 */
export async function readBuildWindows(
  reader: ChainReader,
  lastValidBlockHeight: bigint | number | string,
  options: WindowOptions = {},
): Promise<BuildWindows> {
  return windowsOf(await readBlockhashLife(reader, lastValidBlockHeight, options), options);
}

/** The signing window alone (see {@link readBuildWindows}). */
export async function readSignableWindowMs(
  reader: ChainReader,
  lastValidBlockHeight: bigint | number | string,
  options: WindowOptions = {},
): Promise<number> {
  return (await readBuildWindows(reader, lastValidBlockHeight, options)).signableMs;
}

/**
 * Bytes built whose `lastValidBlockHeight` the builder did not hand back (a Jupiter Trigger order, a limit cancel):
 * one full life at the measured slot speed less the build's own time since `startedAtMs`, less the margin.
 */
export async function readFreshBuildWindows(reader: ChainReader, options: WindowOptions = {}): Promise<BuildWindows> {
  const msPerSlot = await readMsPerSlot(reader, options);
  return windowsOf({ state: "UNKNOWN", reason: "The builder gave no lastValidBlockHeight.", msPerSlot }, options);
}

export async function readFreshBuildWindowMs(reader: ChainReader, options: WindowOptions = {}): Promise<number> {
  return (await readFreshBuildWindows(reader, options)).signableMs;
}
