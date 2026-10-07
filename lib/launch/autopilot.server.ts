/**
 * Ryntra Launch's executor — the wallet that acts on launched tokens after
 * their curve, by Meteora's own programs, and keeps a receipt of each act.
 *
 * One pass over Ryntra's launches on this network (`runAutopilot`), in two
 * loops so a graduation never waits on liquidity:
 * - **curves first** — a curve that holds its threshold and has not graduated
 *   is graduated: the executor sends Meteora's migration to DAMM v2 and pays
 *   its rent. A graduation sent by anyone else is recorded with whoever sent
 *   it, from the graduated pool's first transaction once that transaction is
 *   shown to be the curve's migration;
 * - **then Ryntra's liquidity** (`FLOOR_RULE`), when its own operator stop is
 *   open, the executor holds the pair currency for it and SOL for its rent:
 *   the DLMM pool (with the cent's proof the pool asks for), the steps below
 *   the price, moved up after the price, topped up when more is free for them.
 *
 * Every act is sent once and written down before the send; its receipt comes
 * from the confirmed transaction — its time, its amounts, the executor's SOL
 * it took — and nothing is written from a transaction that could not be read.
 * An act whose answer was lost is settled from the chain by the next pass; a
 * move up whose steps were emptied is finished by the next pass, never left
 * with the money in the wallet.
 *
 * What the executor never does: claim the partner's fees (they go to the
 * partner's multisig, on the curve and from the locked LP), pay any holder,
 * move the pair currency anywhere but into its own steps and back, or act on a
 * token another instance is acting on (a lease per token, compare-and-set).
 *
 * The chain is reached only through `AutopilotChain` — the real one in
 * `./autopilot-chain.server.ts` — so every money path here is tested against a
 * chain that answers on purpose.
 */

import type { Keypair, Transaction } from "@solana/web3.js";
import { randomUUID } from "node:crypto";

import { FLOOR_RULE, addSample, binOfPrice, floorBudgetRaw, floorLadder, floorRaise, graduationActor, priceOfBin, readyToPlace, referenceBin, type FloorLadder, type FloorSample, type JournalActor } from "../core/launch/autopilot.ts";
import type { FloorPool, FloorVenue } from "../core/venues/meteora-dlmm/floor.server.ts";
import { withBoundedCasRetry, type GuardStore } from "../guard/store.ts";
import type { LaunchNetwork } from "./config.server.ts";
import type { LaunchRecord, Sent } from "./flow.server.ts";
import { noteGraduation } from "./graduation.server.ts";

export type AutopilotKind = "GRADUATED" | "FLOOR_POOL" | "FLOOR_PLACED" | "FLOOR_WITHDRAWN" | "FLOOR_RAISED" | "FLOOR_ADDED";

/** One act on a token, as the confirmed transaction shows it. */
export type AutopilotReceipt = Readonly<{
  cluster: LaunchNetwork["cluster"];
  token: string;
  kind: AutopilotKind;
  signature: string;
  at: string | null;
  slot: number;
  actor: JournalActor;
  /** The pair currency the act moved, raw: the curve's threshold for a graduation, what went into or came out of the steps, what they hold after a move. */
  pairRaw: string | null;
  /** The token the act moved, raw: what the pool's proof bought. */
  tokensRaw: string | null;
  pool: string | null;
  position: string | null;
  lowerBinId: number | null;
  upperBinId: number | null;
  priceLow: number | null;
  priceHigh: number | null;
  /** The executor's SOL the act took — fees and rent; null for an act someone else sent. */
  lamports: string | null;
}>;

type Pending = Readonly<{
  kind: "FLOOR_PLACED" | "FLOOR_RAISED" | "FLOOR_ADDED";
  signature: string;
  validUntil: number;
  position: string | null;
  lowerBinId: number;
  upperBinId: number;
  /** A placement: what it puts in; a move or a top-up: only its top-up — the rest is the steps' own money. */
  pairRaw: string;
  sentAt: string;
}>;

type Redeposit = Readonly<{
  syncSignature: string;
  validUntil: number;
  /** What emptying the steps took out of them, read from that transaction; null until it is read. */
  raw: string | null;
  lowerBinId: number;
  upperBinId: number;
}>;

/** Ryntra's liquidity on one token, and what the executor has read and sent for it. */
export type FloorRecord = Readonly<{
  version: number;
  cluster: LaunchNetwork["cluster"];
  token: string;
  state: "WATCHING" | "PLACED";
  pool: string | null;
  position: string | null;
  lowerBinId: number | null;
  upperBinId: number | null;
  /** Every amount the executor put into the steps from outside them, raw. */
  placedRaw: string;
  /** The price's bin as the executor read it, at most once in `FLOOR_RULE.sampleSpacingSeconds`, within the window. */
  samples: readonly FloorSample[];
  raiseSeen: Readonly<{ at: number; marketBinId: number }> | null;
  /** Why the steps cannot be placed on this token at all — the pair's pool made by someone else on other terms. */
  blocked: string | null;
  pending: Pending | null;
  /**
   * A move up under way: the steps were emptied and the pool's price moved (`syncSignature`), and what that took out
   * of them goes back into the steps of `lowerBinId`…`upperBinId`. Kept until the steps hold it again. Absent on older
   * records.
   */
  redeposit?: Redeposit | null;
  /** The pool's creation, written down before its send: a creation whose answer was lost still gets its receipt. */
  poolSent?: Readonly<{ signature: string; validUntil: number }> | null;
  updatedAt: string;
}>;

/** What a confirmed transaction shows. */
export type TxFacts = Readonly<{
  feePayer: string;
  at: string | null;
  slot: number;
  logs: readonly string[];
  /** The executor's SOL the transaction took; null when the executor is not in it. */
  lamportsSpent: bigint | null;
  /** Whether the transaction failed on chain: a failed one proves nothing and is no receipt. */
  failed: boolean;
  /** The executor's own change of a mint, raw. */
  delta(mint: string): bigint;
}>;

export type CurveRead = Readonly<{
  migrated: boolean;
  reserveRaw: bigint;
  thresholdRaw: bigint;
  /** `finish_curve_timestamp`, unix seconds; null while the curve is not full. */
  finishedAt: number | null;
  /** The graduated pool the curve migrates into. */
  dammPool: string | null;
}>;

/** Everything the executor asks of the chain; the real one signs with the executor's key. */
export type AutopilotChain = Readonly<{
  executor: string;
  curve(record: LaunchRecord): Promise<CurveRead | null>;
  /** The migration built, signed by the executor and its positions' new keys, and sent once. */
  migrate(record: LaunchRecord): Promise<Sent>;
  /** An account's first transaction that did not fail, or null when its history could not be read to the start. */
  oldestSignature(address: string): Promise<string | null>;
  transaction(signature: string): Promise<TxFacts | null>;
  price(dammPool: string, token: string): Promise<Readonly<{ price: number; pairMint: string; tokenDecimals: number; pairDecimals: number }> | null>;
  partnerEarned(record: LaunchRecord): Promise<bigint>;
  /** A mint's decimals; they never change. */
  decimals(mint: string): Promise<number>;
  held(mint: string): Promise<bigint>;
  lamports(): Promise<bigint>;
  floor: FloorVenue;
  /** Signs with the executor (and a new account's key) on a fresh blockhash. */
  prepare(tx: Transaction, extra: readonly Keypair[]): Promise<Readonly<{ signature: string; validUntil: number }>>;
  send(tx: Transaction, validUntil: number): Promise<Sent>;
  outcome(signature: string, validUntil: number): Promise<Sent["outcome"] | "EXPIRED">;
}>;

export type AutopilotDeps = Readonly<{
  network: Pick<LaunchNetwork, "cluster">;
  store: GuardStore;
  chain: AutopilotChain;
  floorOpen: boolean;
  now: () => Date;
}>;

export type AutopilotStep = Readonly<{ token: string; step: string; signature?: string }>;
export type AutopilotReport = Readonly<{ state: "RAN"; executor: string; steps: readonly AutopilotStep[] }>;

/** The fewest lamports the executor keeps; below it it sends nothing — a graduation costs about 0.024 SOL of rent. */
export const EXECUTOR_FLOOR_LAMPORTS = 30_000_000n;
/**
 * The lamports Ryntra's liquidity on one token needs before the executor starts it: the pool (≈ 0.025 SOL), the
 * position and its bin arrays (≈ 0.146 SOL), the token account of the pool's proof — measured on devnet 2026-10-07 —
 * and the reserve below which nothing is sent, so a graduation is never starved by liquidity.
 */
export const FLOOR_START_LAMPORTS = 230_000_000n;
/** A move up may open a new bin array (≈ 0.072 SOL) and grow the position: it starts only above the reserve plus this. */
export const FLOOR_MOVE_LAMPORTS = 90_000_000n;
/** The pair currency's cent the pool's proof costs, raw (6 decimals). */
export const PROOF_RAW = 10_000n;
/** Below this the steps are said to hold none of the token: a raw unit or two left by rounding is not a holding. */
const TOKEN_DUST_RAW = 1_000n;
const LEASE_MS = 120_000;
const DBC_PROGRAM = "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN";

const RECEIPTS = "launchAutopilot";
const FLOORS = "launchFloors";
const LEASES = "launchAutopilotLeases";
const receiptKey = (cluster: string, token: string, signature = "") => `solana:${cluster}:${token}:${signature}`;
const floorKey = (cluster: string, token: string) => `solana:${cluster}:${token}`;

type Lease = Readonly<{ version: number; holder: string; until: number }>;

/** One pass over the network's launches, or over one token; stops starting new acts at `budgetMs`. */
export async function runAutopilot(deps: AutopilotDeps, options: Readonly<{ only?: string; budgetMs?: number }> = {}): Promise<AutopilotReport> {
  const end = deps.now().getTime() + (options.budgetMs ?? 45_000);
  const records = options.only
    ? [await deps.store.collection<LaunchRecord>("launches").get(`solana:${deps.network.cluster}:${options.only}`)].filter((row): row is LaunchRecord => row != null)
    : await deps.store.collection<LaunchRecord>("launches").valuesWithPrefix(`solana:${deps.network.cluster}:`);
  /* A record written before launches had a state is a launch the chain confirmed. */
  const launched = records.filter((record) => record.state !== "PENDING").sort((a, b) => Date.parse(a.launchedAt) - Date.parse(b.launchedAt));
  const steps: AutopilotStep[] = [];
  const graduated: Array<Readonly<{ record: LaunchRecord; curve: CurveRead }>> = [];

  /* Curves first: a full curve is graduated before any liquidity is touched. */
  for (const record of launched) {
    if (deps.now().getTime() > end) break;
    steps.push(
      ...(await leased(deps, record.token, async () => {
        const curve = await deps.chain.curve(record);
        if (!curve) return [{ token: record.token, step: "NO_CURVE" }];
        if (!curve.migrated) {
          if (curve.reserveRaw < curve.thresholdRaw) return [{ token: record.token, step: "ON_CURVE" }];
          return [await graduate(deps, record, curve)];
        }
        graduated.push({ record, curve });
        await noteGraduation(deps.store, record, curve.finishedAt, deps.now()).catch(() => undefined);
        return [await recordGraduation(deps, record, curve).catch((error: unknown) => ({ token: record.token, step: `GRADUATION_ERROR: ${message(error)}` }))];
      })),
    );
  }

  /* Then Ryntra's liquidity, oldest launch first. */
  if (deps.floorOpen) {
    for (const { record, curve } of graduated) {
      if (deps.now().getTime() > end) break;
      if (!curve.dammPool) continue;
      const dammPool = curve.dammPool;
      steps.push(...(await leased(deps, record.token, () => floor(deps, record, dammPool, end))));
    }
  } else if (graduated.length) steps.push({ token: "*", step: "FLOOR_CLOSED" });
  return { state: "RAN", executor: deps.chain.executor, steps };
}

const message = (error: unknown) => (error instanceof Error ? error.message.slice(0, 160) : "unknown");

async function leased(deps: AutopilotDeps, token: string, act: () => Promise<AutopilotStep[]>): Promise<AutopilotStep[]> {
  const holder = randomUUID();
  if (!(await takeLease(deps, token, holder))) return [{ token, step: "LEASED" }];
  try {
    return await act();
  } catch (error) {
    return [{ token, step: `ERROR: ${message(error)}` }];
  } finally {
    await dropLease(deps, token, holder).catch(() => undefined);
  }
}

async function takeLease(deps: AutopilotDeps, token: string, holder: string): Promise<boolean> {
  const leases = deps.store.versioned<Lease>(LEASES);
  const key = floorKey(deps.network.cluster, token);
  const now = deps.now().getTime();
  /* `false` asks the store again (the record moved under the write); a lease another instance holds is an answer. */
  return withBoundedCasRetry(async () => {
    const current = await leases.get(key);
    if (current && current.until > now && current.holder !== holder) return { taken: false };
    return (await leases.compareAndSet(key, current ? current.version : null, { version: (current?.version ?? -1) + 1, holder, until: now + LEASE_MS })) ? { taken: true } : false;
  })
    .then((answer) => answer.taken)
    .catch(() => false);
}

async function dropLease(deps: AutopilotDeps, token: string, holder: string): Promise<void> {
  const leases = deps.store.versioned<Lease>(LEASES);
  const key = floorKey(deps.network.cluster, token);
  const current = await leases.get(key);
  if (current?.holder === holder) await leases.compareAndSet(key, current.version, { version: current.version + 1, holder, until: 0 });
}

/* ------------------------------------------------------------------ graduation */

async function graduate(deps: AutopilotDeps, record: LaunchRecord, curve: CurveRead): Promise<AutopilotStep> {
  if ((await deps.chain.lamports()) < EXECUTOR_FLOOR_LAMPORTS) return { token: record.token, step: "LOW_SOL" };
  const sent = await deps.chain.migrate(record);
  if (sent.outcome !== "CONFIRMED") return { token: record.token, step: `GRADUATION_${sent.outcome}`, signature: sent.signature };
  /* Read back; a transaction not read yet is recorded by the next pass from the pool's first transaction — never guessed. */
  const facts = await deps.chain.transaction(sent.signature);
  if (facts && !facts.failed) await writeReceipt(deps, receiptOf(deps, { kind: "GRADUATED", token: record.token, signature: sent.signature, facts, actor: "ryntra", pairRaw: curve.thresholdRaw.toString() }));
  return { token: record.token, step: "GRADUATED", signature: sent.signature };
}

/**
 * A graduation recorded once, whoever sent it: the graduated pool's first transaction, when it is the curve's own
 * migration — the curve's program called at the top with its migration instruction — and its fee payer sent it.
 */
async function recordGraduation(deps: AutopilotDeps, record: LaunchRecord, curve: CurveRead): Promise<AutopilotStep> {
  const known = (await autopilotReceipts(deps.store, deps.network.cluster, record.token)).find((row) => row.kind === "GRADUATED");
  if (known) return { token: record.token, step: "GRADUATED_KNOWN", signature: known.signature };
  if (!curve.dammPool) return { token: record.token, step: "GRADUATION_UNREAD" };
  const first = await deps.chain.oldestSignature(curve.dammPool);
  if (!first) return { token: record.token, step: "GRADUATION_UNREAD" };
  const facts = await deps.chain.transaction(first);
  if (!facts) return { token: record.token, step: "GRADUATION_UNREAD" };
  if (facts.failed || !isMigration(facts.logs)) return { token: record.token, step: "GRADUATION_UNPROVEN", signature: first };
  const actor = graduationActor(facts.feePayer, deps.chain.executor);
  await writeReceipt(deps, receiptOf(deps, { kind: "GRADUATED", token: record.token, signature: first, facts, actor, pairRaw: curve.thresholdRaw.toString() }));
  return { token: record.token, step: "GRADUATION_RECORDED", signature: first };
}

/** Whether a transaction's logs show the curve's own migration to DAMM v2, called at the top level. */
export function isMigration(logs: readonly string[]): boolean {
  const at = logs.findIndex((line) => line === `Program ${DBC_PROGRAM} invoke [1]`);
  return at >= 0 && logs.slice(at + 1, at + 4).some((line) => line === "Program log: Instruction: MigrationDammV2");
}

/* ------------------------------------------------------------------ Ryntra's liquidity */

type Save = (next: Omit<FloorRecord, "version" | "updatedAt">) => Promise<FloorRecord>;

async function floor(deps: AutopilotDeps, record: LaunchRecord, dammPool: string, end: number): Promise<AutopilotStep[]> {
  const token = record.token;
  const floors = deps.store.versioned<FloorRecord>(FLOORS);
  const key = floorKey(deps.network.cluster, token);
  const now = Math.floor(deps.now().getTime() / 1000);
  let current: FloorRecord =
    (await floors.get(key)) ??
    { version: -1, cluster: deps.network.cluster, token, state: "WATCHING", pool: null, position: null, lowerBinId: null, upperBinId: null, placedRaw: "0", samples: [], raiseSeen: null, blocked: null, pending: null, redeposit: null, updatedAt: deps.now().toISOString() };
  const save: Save = async (next) => {
    const written: FloorRecord = { ...next, version: current.version + 1, updatedAt: deps.now().toISOString() };
    if (!(await floors.compareAndSet(key, current.version < 0 ? null : current.version, written))) throw new Error("The liquidity's record changed under this pass.");
    current = written;
    return written;
  };
  if (current.blocked) return [{ token, step: `FLOOR_BLOCKED_${current.blocked}` }];

  /* An act whose answer was lost is settled from the chain before anything new is sent. */
  if (current.pending) {
    const settled = await settle(deps, current);
    if (settled === "WAIT") return [{ token, step: "FLOOR_PENDING", signature: current.pending.signature }];
    await save(settled);
  }

  const price = await deps.chain.price(dammPool, token);
  if (!price || !(price.price > 0)) return [{ token, step: "NO_PRICE" }];
  const marketBin = binOfPrice(price.price, FLOOR_RULE.binStep, price.tokenDecimals, price.pairDecimals);
  const samples = addSample(current.samples, now, marketBin);
  const reference = referenceBin(marketBin, samples);
  const earned = await deps.chain.partnerEarned(record);
  /*
   * What emptying the steps took out sits in the wallet but is owed back to them: never free for a top-up. While the
   * amount is not read yet, nothing is free.
   */
  const owed = current.redeposit ? (current.redeposit.raw === null ? null : BigInt(current.redeposit.raw)) : 0n;
  const held = await deps.chain.held(price.pairMint);
  const free = owed === null ? 0n : held > owed ? held - owed : 0n;
  const budget = floorBudgetRaw({ partnerEarnedRaw: earned, placedRaw: BigInt(current.placedRaw), freeRaw: free });
  const owner = deps.chain.executor;

  if (current.state === "WATCHING") {
    if (!readyToPlace(samples, now)) {
      await save({ ...current, samples });
      return [{ token, step: "FLOOR_SAMPLING" }];
    }
    if (budget === 0n) {
      await save({ ...current, samples });
      return [{ token, step: "FLOOR_NO_BUDGET" }];
    }
    if ((await deps.chain.lamports()) < FLOOR_START_LAMPORTS) {
      await save({ ...current, samples });
      return [{ token, step: "FLOOR_LOW_SOL" }];
    }
    let pool = await deps.chain.floor.pool(token, price.pairMint);
    /* A creation whose answer was lost: its receipt from the chain now that the pool is there. */
    if (pool && current.poolSent) {
      const outcome = await deps.chain.outcome(current.poolSent.signature, current.poolSent.validUntil);
      const facts = outcome === "CONFIRMED" ? await deps.chain.transaction(current.poolSent.signature) : null;
      if (facts && !facts.failed) await writeReceipt(deps, receiptOf(deps, { kind: "FLOOR_POOL", token, signature: current.poolSent.signature, facts, actor: "ryntra", pairMint: price.pairMint }));
      if (outcome !== "UNKNOWN" && (outcome !== "CONFIRMED" || facts)) await save({ ...current, poolSent: null });
    }
    /* No second creation while the first may still land — its receipt would be lost; one that never landed is let go. */
    if (!pool && current.poolSent) {
      const outcome = await deps.chain.outcome(current.poolSent.signature, current.poolSent.validUntil);
      if (outcome === "UNKNOWN" || outcome === "CONFIRMED") {
        await save({ ...current, samples });
        return [{ token, step: "FLOOR_POOL_PENDING", signature: current.poolSent.signature }];
      }
      await save({ ...current, samples, poolSent: null });
    }
    if (pool && !poolAccepted(pool, owner, now)) {
      await save({ ...current, samples, blocked: "POOL_TAKEN" });
      return [{ token, step: "FLOOR_BLOCKED_POOL_TAKEN" }];
    }
    const steps: AutopilotStep[] = [];
    if (!pool) {
      const proof = (await deps.chain.held(token)) > 0n ? null : { dammPool, amountRaw: PROOF_RAW };
      const tx = await deps.chain.floor.createPool({ token, pair: price.pairMint, activeBinId: reference, payer: owner, proof });
      const prepared = await deps.chain.prepare(tx, []);
      const sentDown = await save({ ...current, samples, poolSent: { signature: prepared.signature, validUntil: prepared.validUntil } });
      const sent = await deps.chain.send(tx, prepared.validUntil);
      /* A pool whose answer was lost is found by its address next pass, and its receipt written then; nothing else is sent now. */
      if (sent.outcome !== "CONFIRMED") {
        if (sent.outcome !== "UNKNOWN") await save({ ...sentDown, poolSent: null });
        return [{ token, step: `FLOOR_POOL_${sent.outcome}`, signature: sent.signature }];
      }
      const facts = await deps.chain.transaction(sent.signature);
      if (facts && !facts.failed) {
        await writeReceipt(deps, receiptOf(deps, { kind: "FLOOR_POOL", token, signature: sent.signature, facts, actor: "ryntra", pairMint: price.pairMint }));
        await save({ ...sentDown, poolSent: null });
      }
      steps.push({ token, step: "FLOOR_POOL", signature: sent.signature });
      pool = await deps.chain.floor.pool(token, price.pairMint);
      if (!pool) return [...steps, { token, step: "FLOOR_POOL_UNREAD" }];
      if (deps.now().getTime() > end) {
        await save({ ...current, samples, pool: pool.pool });
        return steps;
      }
    }
    /* Our pool's price taken to the price that held, through its empty bins, before the steps go in below it. */
    if (pool.activeBinId !== reference) {
      const tx = await deps.chain.floor.syncSteps({ pool: pool.pool, owner, position: null, activeBinId: reference });
      if (tx) {
        const prepared = await deps.chain.prepare(tx, []);
        const sent = await deps.chain.send(tx, prepared.validUntil);
        if (sent.outcome !== "CONFIRMED") return [...steps, { token, step: `FLOOR_SYNC_${sent.outcome}`, signature: sent.signature }];
      }
      pool = { ...pool, activeBinId: reference };
    }
    const ladder = floorLadder(pool.activeBinId);
    const opened = await deps.chain.floor.openSteps({ pool: pool.pool, owner, ladder, amountRaw: budget });
    const tx = opened.transactions[0]!;
    const prepared = await deps.chain.prepare(tx, [opened.position]);
    const position = opened.position.publicKey.toBase58();
    /* The position's address is kept before the send: an answer lost still leaves the steps findable. */
    const pending: Pending = { kind: "FLOOR_PLACED", signature: prepared.signature, validUntil: prepared.validUntil, position, lowerBinId: ladder.lowerBinId, upperBinId: ladder.upperBinId, pairRaw: budget.toString(), sentAt: deps.now().toISOString() };
    const saved = await save({ ...current, samples, pool: pool.pool, pending });
    const sent = await deps.chain.send(tx, prepared.validUntil);
    return [...steps, ...(await afterSend(deps, saved, sent, "FLOOR_PLACED", save))];
  }

  /* The steps stand. A move up whose steps were emptied is finished before anything else. */
  if (!current.pool || !current.position) return [{ token, step: "FLOOR_INCOMPLETE" }];
  if (current.redeposit) return finishMove(deps, current, samples, budget, save);
  const read = await deps.chain.floor.readSteps(current.pool, current.position);
  if (!read) return [{ token, step: "FLOOR_UNREAD" }];
  const holdsToken = BigInt(read.tokenRaw) > TOKEN_DUST_RAW;
  const decision = floorRaise({ ladder: { lowerBinId: read.lowerBinId, upperBinId: read.upperBinId }, marketBinId: reference, holdsToken, seen: current.raiseSeen, at: now });
  if (decision.raise) {
    if ((await deps.chain.lamports()) < EXECUTOR_FLOOR_LAMPORTS + FLOOR_MOVE_LAMPORTS) {
      await save({ ...current, samples });
      return [{ token, step: "FLOOR_LOW_SOL" }];
    }
    return startMove(deps, current, decision.ladder, samples, budget, save);
  }
  /* More is free for these steps: added to them where they stand, the position holding only the pair currency. */
  if (budget > 0n && !holdsToken && (await deps.chain.lamports()) >= EXECUTOR_FLOOR_LAMPORTS + FLOOR_MOVE_LAMPORTS) {
    const ladder = { lowerBinId: read.lowerBinId, upperBinId: read.upperBinId };
    return place(deps, current, ladder, budget, "FLOOR_ADDED", samples, save);
  }
  await save({ ...current, samples, raiseSeen: decision.seen });
  return [{ token, step: decision.seen ? "FLOOR_RAISE_SEEN" : "FLOOR_HOLDS" }];
}

/** A pool of the pair the steps may stand in: ours, or one made on the same terms — open now, nobody able to switch it off. */
export function poolAccepted(pool: FloorPool, executor: string, now: number): boolean {
  if (!pool.tokenIsX || pool.binStep !== FLOOR_RULE.binStep) return false;
  if (pool.creator === executor) return true;
  return pool.baseFeeBps === FLOOR_RULE.feeBps && pool.collectsFeeInY && pool.enabled && !pool.creatorCanSwitchOff && !pool.alphaVault && pool.activationAt !== null && pool.activationAt <= now;
}

/**
 * A move up, first half: the steps emptied and the pool's price taken to the new level in one transaction, written
 * down before the send — whatever happens to its answer, the next pass finishes it.
 */
async function startMove(deps: AutopilotDeps, current: FloorRecord, ladder: FloorLadder, samples: readonly FloorSample[], budget: bigint, save: Save): Promise<AutopilotStep[]> {
  const token = current.token;
  const activeBinId = ladder.upperBinId + FLOOR_RULE.topGapBins;
  const tx = await deps.chain.floor.syncSteps({ pool: current.pool!, owner: deps.chain.executor, position: current.position!, activeBinId });
  if (!tx) return place(deps, current, ladder, budget, "FLOOR_RAISED", samples, save);
  const prepared = await deps.chain.prepare(tx, []);
  const redeposit: Redeposit = { syncSignature: prepared.signature, validUntil: prepared.validUntil, raw: null, lowerBinId: ladder.lowerBinId, upperBinId: ladder.upperBinId };
  const saved = await save({ ...current, samples, raiseSeen: null, redeposit });
  const sent = await deps.chain.send(tx, prepared.validUntil);
  if (sent.outcome === "UNKNOWN") return [{ token, step: "FLOOR_SYNC_PENDING", signature: sent.signature }];
  if (sent.outcome !== "CONFIRMED") {
    await save({ ...saved, redeposit: null });
    return [{ token, step: `FLOOR_SYNC_${sent.outcome}`, signature: sent.signature }];
  }
  return [{ token, step: "FLOOR_SYNCED", signature: sent.signature }, ...(await finishMove(deps, saved, samples, budget, save))];
}

/**
 * A move up, second half: what emptying took out — read from that transaction, its own receipt — goes back into the
 * new steps, with the pool's price taken there again if anyone moved it meanwhile.
 */
async function finishMove(deps: AutopilotDeps, current: FloorRecord, samples: readonly FloorSample[], budget: bigint, save: Save): Promise<AutopilotStep[]> {
  const token = current.token;
  let record = current;
  let redeposit = current.redeposit!;
  const ladder = { lowerBinId: redeposit.lowerBinId, upperBinId: redeposit.upperBinId };
  const pairMint = await pairOf(deps, token);
  if (redeposit.raw === null) {
    const outcome = await deps.chain.outcome(redeposit.syncSignature, redeposit.validUntil);
    if (outcome === "UNKNOWN") return [{ token, step: "FLOOR_SYNC_PENDING", signature: redeposit.syncSignature }];
    if (outcome !== "CONFIRMED") {
      await save({ ...record, redeposit: null });
      return [{ token, step: `FLOOR_SYNC_${outcome}`, signature: redeposit.syncSignature }];
    }
    const facts = await deps.chain.transaction(redeposit.syncSignature);
    if (!facts) return [{ token, step: "FLOOR_SYNC_UNREAD", signature: redeposit.syncSignature }];
    if (facts.failed) {
      await save({ ...record, redeposit: null });
      return [{ token, step: "FLOOR_SYNC_FAILED", signature: redeposit.syncSignature }];
    }
    const taken = facts.delta(pairMint);
    const withdrawn = taken > 0n ? taken : 0n;
    await writeReceipt(deps, receiptOf(deps, { kind: "FLOOR_WITHDRAWN", token, signature: redeposit.syncSignature, facts, actor: "ryntra", pairRaw: withdrawn.toString(), pool: record.pool, position: record.position }));
    redeposit = { ...redeposit, raw: withdrawn.toString() };
    record = await save({ ...record, samples, redeposit });
  }
  /* The pool's price may have been moved since — `go_to_a_bin` asks no signature: taken back first, through empty bins. */
  const pool = await deps.chain.floor.pool(token, pairMint);
  const target = ladder.upperBinId + FLOOR_RULE.topGapBins;
  if (pool && pool.activeBinId !== target) {
    const tx = await deps.chain.floor.syncSteps({ pool: record.pool!, owner: deps.chain.executor, position: record.position, activeBinId: target });
    if (tx) {
      const prepared = await deps.chain.prepare(tx, []);
      const sent = await deps.chain.send(tx, prepared.validUntil);
      if (sent.outcome !== "CONFIRMED") return [{ token, step: `FLOOR_SYNC_${sent.outcome}`, signature: sent.signature }];
    }
  }
  return place(deps, record, ladder, budget, "FLOOR_RAISED", samples, save, BigInt(redeposit.raw ?? "0"));
}

/** One `rebalance_liquidity` into `ladder`: what the steps hold, what came back from emptying them, and the top-up. */
async function place(
  deps: AutopilotDeps,
  current: FloorRecord,
  ladder: FloorLadder,
  topUpRaw: bigint,
  kind: "FLOOR_RAISED" | "FLOOR_ADDED",
  samples: readonly FloorSample[],
  save: Save,
  returningRaw = 0n,
): Promise<AutopilotStep[]> {
  const tx = await deps.chain.floor.placeSteps({ pool: current.pool!, owner: deps.chain.executor, position: current.position!, ladder, amountRaw: returningRaw + topUpRaw });
  const prepared = await deps.chain.prepare(tx, []);
  const pending: Pending = { kind, signature: prepared.signature, validUntil: prepared.validUntil, position: current.position, lowerBinId: ladder.lowerBinId, upperBinId: ladder.upperBinId, pairRaw: topUpRaw.toString(), sentAt: deps.now().toISOString() };
  const saved = await save({ ...current, samples, raiseSeen: null, pending });
  const sent = await deps.chain.send(tx, prepared.validUntil);
  return afterSend(deps, saved, sent, kind, save);
}

async function afterSend(deps: AutopilotDeps, current: FloorRecord, sent: Sent, kind: Pending["kind"], save: Save): Promise<AutopilotStep[]> {
  const token = current.token;
  if (sent.outcome === "UNKNOWN") return [{ token, step: `${kind}_PENDING`, signature: sent.signature }];
  const settled = await settle(deps, current, sent.outcome);
  if (settled === "WAIT") return [{ token, step: `${kind}_PENDING`, signature: sent.signature }];
  await save(settled);
  return [{ token, step: sent.outcome === "CONFIRMED" ? kind : `${kind}_${sent.outcome}`, signature: sent.signature }];
}

/**
 * An act's outcome applied to the record: landed and read — its receipt written and the steps where it put them;
 * refused, failed or expired unseen — forgotten, to be decided again (a move's emptied money stays owed to the steps);
 * not known yet, or landed but not read — wait.
 */
async function settle(deps: AutopilotDeps, current: FloorRecord, known?: Sent["outcome"]): Promise<Omit<FloorRecord, "version" | "updatedAt"> | "WAIT"> {
  const pending = current.pending!;
  const outcome = known && known !== "UNKNOWN" ? known : await deps.chain.outcome(pending.signature, pending.validUntil);
  if (outcome === "UNKNOWN") return "WAIT";
  if (outcome !== "CONFIRMED") return { ...current, pending: null };
  const facts = await deps.chain.transaction(pending.signature);
  if (!facts) return "WAIT";
  if (facts.failed) return { ...current, pending: null };
  const pairMint = await pairOf(deps, current.token);
  const decimals = await decimalsOf(deps, current.token);
  const steps = current.pool && pending.position ? await deps.chain.floor.readSteps(current.pool, pending.position).catch(() => null) : null;
  /* A placement: what went in, from the transaction. A move or a top-up: what the steps hold after it — unread, unknown. */
  const putIn = -facts.delta(pairMint);
  const pairRaw = pending.kind === "FLOOR_PLACED" ? (putIn > 0n ? putIn : 0n).toString() : (steps?.pairRaw ?? null);
  await writeReceipt(
    deps,
    receiptOf(deps, {
      kind: pending.kind,
      token: current.token,
      signature: pending.signature,
      facts,
      actor: "ryntra",
      pairRaw,
      pool: current.pool,
      position: pending.position,
      ladder: { lowerBinId: pending.lowerBinId, upperBinId: pending.upperBinId, priceLow: priceOfBin(pending.lowerBinId, FLOOR_RULE.binStep, decimals.token, decimals.pair), priceHigh: priceOfBin(pending.upperBinId, FLOOR_RULE.binStep, decimals.token, decimals.pair) },
    }),
  );
  /* What was ever placed grows by money from outside the steps only: a placement's amount, a move's or a top-up's top-up. */
  const added = pending.kind === "FLOOR_PLACED" ? (putIn > 0n ? putIn : 0n) : BigInt(pending.pairRaw);
  return {
    ...current,
    state: "PLACED",
    position: pending.position ?? current.position,
    lowerBinId: pending.lowerBinId,
    upperBinId: pending.upperBinId,
    placedRaw: (BigInt(current.placedRaw) + added).toString(),
    pending: null,
    redeposit: null,
  };
}

/* ------------------------------------------------------------------ receipts */

function receiptOf(
  deps: AutopilotDeps,
  args: Readonly<{
    kind: AutopilotKind;
    token: string;
    signature: string;
    facts: TxFacts;
    actor: JournalActor;
    pairRaw?: string | null;
    pairMint?: string;
    pool?: string | null;
    position?: string | null;
    ladder?: Readonly<{ lowerBinId: number; upperBinId: number; priceLow: number; priceHigh: number }> | null;
  }>,
): AutopilotReceipt {
  const pairDelta = args.pairMint ? args.facts.delta(args.pairMint) : null;
  const tokenDelta = args.facts.delta(args.token);
  return {
    cluster: deps.network.cluster,
    token: args.token,
    kind: args.kind,
    signature: args.signature,
    at: args.facts.at,
    slot: args.facts.slot,
    actor: args.actor,
    pairRaw: args.pairRaw !== undefined ? args.pairRaw : pairDelta === null ? null : (pairDelta < 0n ? -pairDelta : pairDelta).toString(),
    tokensRaw: tokenDelta === 0n ? null : (tokenDelta < 0n ? -tokenDelta : tokenDelta).toString(),
    pool: args.pool ?? null,
    position: args.position ?? null,
    lowerBinId: args.ladder?.lowerBinId ?? null,
    upperBinId: args.ladder?.upperBinId ?? null,
    priceLow: args.ladder?.priceLow ?? null,
    priceHigh: args.ladder?.priceHigh ?? null,
    lamports: args.actor === "ryntra" && args.facts.lamportsSpent !== null ? args.facts.lamportsSpent.toString() : null,
  };
}

async function writeReceipt(deps: AutopilotDeps, receipt: AutopilotReceipt): Promise<void> {
  await deps.store.collection<AutopilotReceipt>(RECEIPTS).set(receiptKey(deps.network.cluster, receipt.token, receipt.signature), receipt);
}

/** Every receipt of a token's acts, the oldest first. */
export async function autopilotReceipts(store: GuardStore, cluster: string, token: string): Promise<readonly AutopilotReceipt[]> {
  const rows = await store.collection<AutopilotReceipt>(RECEIPTS).valuesWithPrefix(receiptKey(cluster, token));
  return [...rows].filter((row) => row.token === token).sort((a, b) => (Date.parse(a.at ?? "") || 0) - (Date.parse(b.at ?? "") || 0));
}

/** Ryntra's liquidity record on a token, as the executor last wrote it. */
export async function floorRecord(store: GuardStore, cluster: string, token: string): Promise<FloorRecord | null> {
  return (await store.versioned<FloorRecord>(FLOORS).get(floorKey(cluster, token))) ?? null;
}

async function pairOf(deps: AutopilotDeps, token: string): Promise<string> {
  const record = await deps.store.collection<LaunchRecord>("launches").get(`solana:${deps.network.cluster}:${token}`);
  if (!record) throw new Error(`No launch ${token}.`);
  return record.pairMint;
}

/** The token's and the pair currency's decimals. */
async function decimalsOf(deps: AutopilotDeps, token: string): Promise<Readonly<{ token: number; pair: number }>> {
  return { token: await deps.chain.decimals(token), pair: await deps.chain.decimals(await pairOf(deps, token)) };
}
