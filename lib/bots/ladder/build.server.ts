/**
 * The ladder composer (B5, CITY-135; mainnet CITY-219) — the server's part:
 * read a pool, build a ladder's `place_limit_order` transactions for the
 * person's wallet to sign, build the cancellations that take the money back,
 * read the orders back.
 *
 * Nothing here signs. A placement needs two signatures — the person's wallet
 * and the fresh order account's — and neither key is ever here: the window
 * makes the order accounts' keys in the browser and sends only their public
 * addresses; the wallet signs; the window adds the order accounts' own
 * signatures over the exact message the wallet signed (`city/lib/bots/ladder-sign.ts`);
 * the relay (`relay.server.ts`) only checks and forwards. No server secret is
 * read, no keypair is made, no transaction is signed in this file.
 *
 * The network is the one the request names, and its own switch opened it
 * (`network.ts`): every read and build goes through `ladderConnection(network)`,
 * whose chain is asked its genesis first. On mainnet the pool is the deepest
 * USDC pool of the coin that takes limit orders (the limits lane's own finder,
 * called, not changed), each ladder stays under the deployment's cap, and every
 * transaction is simulated before it is shown and judged by what the person
 * gets against what was promised (`promise.ts`).
 */

import DLMM, { deriveBinArray, isSupportLimitOrder, LimitOrderStatus } from "@meteora-ag/dlmm";
import { ExtensionType, getAssociatedTokenAddressSync, getExtensionTypes, TOKEN_2022_PROGRAM_ID, type Mint } from "@solana/spl-token";
import { ComputeBudgetProgram, Connection, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import BN from "bn.js";

import { mintSafety } from "../backtest/mint-safety.ts";
import { findDlmmLimitPool } from "../../solana/limits/dlmm.server.ts";
import { DLMM_PROGRAM } from "../../solana/limits/model.ts";
import { ladderConnection, onNetwork } from "./connection.server.ts";
import { binIsEmpty, canDoFromOrders, decodeLimitOrderAccount, type LadderCanDo } from "./decode.ts";
import {
  binArrayRent,
  bitmapExtensionRent,
  LADDER_MAINNET_CU_PRICE,
  ladderCosts,
  orderAccountRent,
  priorityLamports,
  SIGNATURE_LAMPORTS,
  type ChainTerms,
  type LadderCosts,
} from "./costs.ts";
import { WRAPPED_SOL, type LadderNetwork } from "./network.ts";
import { binArrayIndex, binPrice, chunkRungs, legIssues, legUsd, planIssues, planLeg, type LadderIssue, type LadderLeg, type LadderPool, type LegPlan, type Rung } from "./plan.ts";
import type { LadderOrderRead } from "./orders.ts";
import { judgeCancel, judgePlacement, tokenAmountOf, type SimAccount } from "./promise.ts";
import { readLadderTransaction, isAddress } from "./tx.ts";

/** A legacy transaction's limit, bytes. */
export const TX_MAX_BYTES = 1_232;
/** Compute units a placement may use: opening bin arrays costs more than the default 200 000. */
export const LADDER_COMPUTE_UNITS = 400_000;
/** And a cancellation: every bin of one order taken back, the account closed, the wallet's token accounts opened if missing. */
export const CANCEL_COMPUTE_UNITS = 400_000;
/** A token account's data, bytes: a cancellation may open the wallet's own for the pair's other token. */
const TOKEN_ACCOUNT_BYTES = 165;
/** Bin arrays read around the active one to tell which a ladder would open. */
const ARRAYS_AROUND = 8;
const DLMM_KEY = new PublicKey(DLMM_PROGRAM);
const INIT_BIN_ARRAY = "235613b94ed44bd3";
const INIT_BITMAP_EXTENSION = "2f9de2b40cf02147";

export type LadderFailure = Readonly<{ ok: false; code: string; reason: string }>;

export { ladderConnection };

const notOn = (network: LadderNetwork): LadderFailure => ({ ok: false, code: network === "devnet" ? "NOT_DEVNET" : "NOT_MAINNET", reason: `The endpoint does not serve ${network}.` });
const cluster = (network: LadderNetwork) => (network === "mainnet" ? "mainnet-beta" : "devnet");

/* ---------------------------------------------------------------- the chain */

const terms = new Map<object, Readonly<{ at: number; rentPerByte: number }>>();
const TERMS_TTL_MS = 10 * 60_000;

/**
 * The chain's terms a cost line stands on: its rent per byte, read from the chain (the minimum balance of an empty
 * account is 128 header bytes of rent), and on mainnet the priority one transaction pays.
 */
export async function chainTerms(connection: Pick<Connection, "getMinimumBalanceForRentExemption">, network: LadderNetwork, now = Date.now()): Promise<ChainTerms> {
  const priorityLamportsPerTx = network === "mainnet" ? priorityLamports(LADDER_COMPUTE_UNITS, LADDER_MAINNET_CU_PRICE) : 0;
  const kept = terms.get(connection);
  if (kept && now - kept.at < TERMS_TTL_MS) return { rentPerByte: kept.rentPerByte, priorityLamportsPerTx };
  const empty = await connection.getMinimumBalanceForRentExemption(0);
  const rentPerByte = Math.ceil(empty / 128);
  terms.set(connection, { at: now, rentPerByte });
  return { rentPerByte, priorityLamportsPerTx };
}

/** The compute-budget instructions a ladder's transaction starts with: the limit, and on mainnet its priority. */
function budget(network: LadderNetwork, units: number) {
  const limit = ComputeBudgetProgram.setComputeUnitLimit({ units });
  return network === "mainnet" ? [limit, ComputeBudgetProgram.setComputeUnitPrice({ microLamports: LADDER_MAINNET_CU_PRICE })] : [limit];
}

/* ---------------------------------------------------------------- the pool */

export type LadderPoolRead = Readonly<{
  ok: true;
  facts: LadderPool;
  name: string;
  /** Quote per base at the active bin. */
  activePrice: number;
  takesLimitOrders: boolean;
  /** Indexes of the pool's bin arrays that exist around the active one. */
  existingArrays: readonly number[];
  bitmapExtension: boolean;
}>;

type Facts = NonNullable<Parameters<typeof mintSafety>[0]>;

/**
 * A mint's facts as the bots' filter reads them, from the mint account: the token program, the freeze authority and
 * which of the dangerous Token-2022 extensions the mint carries (their presence is what the filter reads; their
 * settings are not needed to leave the mint out).
 */
export function mintFacts(mint: Mint, program: PublicKey): Facts {
  const is2022 = program.equals(TOKEN_2022_PROGRAM_ID);
  const types = is2022 && mint.tlvData.length > 0 ? getExtensionTypes(mint.tlvData) : [];
  const has = (type: ExtensionType) => types.includes(type);
  return {
    program: is2022 ? "spl-token-2022" : "spl-token",
    freeze_authority: mint.freezeAuthority ? mint.freezeAuthority.toBase58() : null,
    permanent_delegate: has(ExtensionType.PermanentDelegate) ? "extension" : null,
    transfer_hook: has(ExtensionType.TransferHook) ? { program: "extension", authority: null } : null,
    transfer_fee: has(ExtensionType.TransferFeeConfig) ? { in_force: null, in_force_why: "extension" } : null,
  };
}
/** CITY-135's name for it. */
export const devnetMintFacts = mintFacts;

const pools = new Map<string, Readonly<{ at: number; dlmm: DLMM }>>();
const POOL_TTL_MS = 30_000;

async function loadPool(connection: Connection, network: LadderNetwork, address: string, now: number): Promise<DLMM> {
  const key = `${network}:${address}`;
  const kept = pools.get(key);
  if (kept && now - kept.at < POOL_TTL_MS) {
    await kept.dlmm.refetchStates();
    return kept.dlmm;
  }
  const dlmm = await DLMM.create(connection, new PublicKey(address), { cluster: cluster(network) });
  pools.set(key, { at: now, dlmm });
  return dlmm;
}

type Deps = Readonly<{ connection?: Connection; now?: number; network?: LadderNetwork }>;

/**
 * A pool as the composer needs it. The quote must be one of the dollar tokens the network takes, the base must pass
 * the bots' mint filter (no permanent delegate, transfer hook, freeze authority or transfer fee).
 */
export async function readLadderPool(address: string, quotes: readonly string[], deps: Deps = {}): Promise<LadderPoolRead | LadderFailure> {
  const network = deps.network ?? "devnet";
  const connection = deps.connection ?? ladderConnection(network);
  if (!(await onNetwork(connection, network))) return notOn(network);
  let dlmm: DLMM;
  try {
    dlmm = await loadPool(connection, network, address, deps.now ?? Date.now());
  } catch (failure) {
    return { ok: false, code: "UNREACHABLE", reason: failure instanceof Error ? failure.message : String(failure) };
  }
  const x = dlmm.tokenX.mint.address.toBase58();
  const y = dlmm.tokenY.mint.address.toBase58();
  const quoteIsY = quotes.includes(y);
  if (!quoteIsY && !quotes.includes(x)) return { ok: false, code: "NOT_DOLLAR_QUOTED", reason: "The pool is not quoted in a dollar token." };
  const base = quoteIsY ? dlmm.tokenX : dlmm.tokenY;
  const quote = quoteIsY ? dlmm.tokenY : dlmm.tokenX;
  const safety = mintSafety(mintFacts(base.mint, base.owner));
  if (!safety.ok) return { ok: false, code: "MINT_EXCLUDED", reason: `The token is left out of bots: ${safety.reasons.join(", ") as string}.` };
  const facts: LadderPool = {
    pool: address,
    binStep: dlmm.lbPair.binStep,
    activeId: dlmm.lbPair.activeId,
    baseIsX: quoteIsY,
    baseMint: base.mint.address.toBase58(),
    quoteMint: quote.mint.address.toBase58(),
    baseDecimals: base.mint.decimals,
    quoteDecimals: quote.mint.decimals,
  };
  const activeIndex = binArrayIndex(facts.activeId);
  const indexes = Array.from({ length: ARRAYS_AROUND * 2 + 1 }, (_, i) => activeIndex - ARRAYS_AROUND + i);
  const keys = indexes.map((index) => deriveBinArray(new PublicKey(address), new BN(index), DLMM_KEY)[0]);
  const infos = await connection.getMultipleAccountsInfo(keys, { commitment: "confirmed", dataSlice: { offset: 0, length: 0 } }).catch(() => null);
  return {
    ok: true,
    facts,
    name: `${base.mint.address.toBase58().slice(0, 4)}/${quote.mint.address.toBase58().slice(0, 4)}`,
    activePrice: binPrice(facts.activeId, facts),
    takesLimitOrders: isSupportLimitOrder(dlmm.lbPair),
    existingArrays: infos ? indexes.filter((_, i) => infos[i] !== null) : [],
    bitmapExtension: dlmm.binArrayBitmapExtension !== null,
  };
}

/** Mainnet's pool of a coin: the deepest of its USDC pools that takes limit orders. Null — none. */
export type PoolFinder = (baseMint: string, quoteMint: string, connection: Connection) => Promise<string | null>;

export const findMainnetPool: PoolFinder = async (baseMint, quoteMint, connection) => {
  const found = await findDlmmLimitPool(baseMint, quoteMint, { connection });
  return found.ok ? found.pool : null;
};

type Gate = Readonly<{ network: LadderNetwork; pools: readonly string[] | null; quotes: readonly string[] }>;

/**
 * Whether a pool is open to ladders, read: on devnet one of the listed pools; on mainnet the very pool the finder
 * names for its coin. Answers the pool read, or why not.
 */
export async function ladderPoolOpen(
  address: string,
  gate: Gate,
  deps: Readonly<{ connection?: Connection; now?: number; findPool?: PoolFinder }> = {},
): Promise<LadderPoolRead | LadderFailure> {
  if (gate.network === "devnet" && !(gate.pools ?? []).includes(address)) return { ok: false, code: "POOL_NOT_LISTED", reason: "This pool is not open to ladders." };
  const connection = deps.connection ?? ladderConnection(gate.network);
  const pool = await readLadderPool(address, gate.quotes, { connection, now: deps.now, network: gate.network });
  if (!pool.ok || gate.network === "devnet") return pool;
  const named = await (deps.findPool ?? findMainnetPool)(pool.facts.baseMint, pool.facts.quoteMint, connection).catch(() => null);
  if (named !== address) return { ok: false, code: "POOL_NOT_LISTED", reason: "This pool is not the coin's ladder pool." };
  return pool;
}

/** The coin's pool on a network: devnet's listed pool of the coin, mainnet's found pool. Null — none open. */
export async function ladderPoolOf(
  mint: string,
  gate: Gate,
  deps: Readonly<{ connection?: Connection; now?: number; findPool?: PoolFinder }> = {},
): Promise<LadderPoolRead | null> {
  const connection = deps.connection ?? ladderConnection(gate.network);
  if (gate.network === "devnet") {
    for (const address of gate.pools ?? []) {
      const pool = await readLadderPool(address, gate.quotes, { connection, now: deps.now, network: "devnet" });
      if (pool.ok && pool.facts.baseMint === mint) return pool;
    }
    return null;
  }
  for (const quote of gate.quotes) {
    const address = await (deps.findPool ?? findMainnetPool)(mint, quote, connection).catch(() => null);
    if (!address) continue;
    const pool = await readLadderPool(address, gate.quotes, { connection, now: deps.now, network: "mainnet" });
    if (pool.ok && pool.facts.baseMint === mint) return pool;
  }
  return null;
}

/* ------------------------------------------------------------------- build */

export type BuiltLeg = Readonly<{
  side: LegPlan["side"];
  /** Unsigned: the wallet signs first, the order account after it, in the browser. */
  wireBase64: string;
  limitOrder: string;
  rungs: readonly Rung[];
  /** The owner's lamports the simulation saw leave, beyond the fee and any SOL wrapped into the order. */
  depositLamports: number | null;
}>;

export type LadderBuilt = Readonly<{
  ok: true;
  network: LadderNetwork;
  pool: LadderPoolRead;
  plans: readonly LegPlan[];
  transactions: readonly BuiltLeg[];
  costs: LadderCosts;
  canDo: readonly LadderCanDo[];
  /** Dollars the ladder places at today's price. */
  amountUsd: number;
  terms: ChainTerms;
}>;

/** What a transaction may take out of the wallet in SOL: its fees, the order's rent, the arrays it opens, SOL it places. */
function placementSolLimit(transaction: Transaction, bins: number, wrapped: number, chain: ChainTerms): number {
  let arrays = 0;
  let extension = false;
  for (const instruction of transaction.instructions) {
    if (!instruction.programId.equals(DLMM_KEY)) continue;
    const discriminator = Buffer.from(instruction.data.subarray(0, 8)).toString("hex");
    if (discriminator === INIT_BIN_ARRAY) arrays += 1;
    if (discriminator === INIT_BITMAP_EXTENSION) extension = true;
  }
  const signatures = transaction.compileMessage().header.numRequiredSignatures;
  return (
    signatures * SIGNATURE_LAMPORTS +
    chain.priorityLamportsPerTx +
    orderAccountRent(bins, chain.rentPerByte) +
    arrays * binArrayRent(chain.rentPerByte) +
    (extension ? bitmapExtensionRent(chain.rentPerByte) : 0) +
    wrapped
  );
}

const simAccount = (value: { lamports: number; data: unknown } | null | undefined): SimAccount =>
  value && Array.isArray(value.data) ? { lamports: value.lamports, data: value.data as string[] } : null;

/**
 * Build a ladder's transactions: each leg planned (`plan.ts`), cut by bin array, one `place_limit_order` per cut with
 * the next of the order accounts the window named, each simulated and judged before it is shown. Any leg that does
 * not plan, any transaction that does not fit, does not simulate or does not keep its promise, and a ladder over the
 * network's cap, stops the whole ladder: never half of it.
 */
export async function buildLadder(
  args: Readonly<{
    owner: string;
    pool: string;
    legs: readonly LadderLeg[];
    orderKeys: readonly string[];
    network?: LadderNetwork;
    pools: readonly string[] | null;
    quotes: readonly string[];
    /** The most the ladder may place, dollars; null — no cap. */
    maxUsd?: number | null;
  }>,
  deps: Readonly<{ connection?: Connection; now?: number; findPool?: PoolFinder }> = {},
): Promise<LadderBuilt | LadderFailure> {
  const network = args.network ?? "devnet";
  if (!isAddress(args.owner)) return { ok: false, code: "VALIDATION_ERROR", reason: "The wallet is not an address." };
  const keys = [...new Set(args.orderKeys)];
  if (keys.length !== args.orderKeys.length || !keys.every(isAddress) || keys.includes(args.owner) || keys.includes(args.pool)) {
    return { ok: false, code: "VALIDATION_ERROR", reason: "The order accounts must be fresh, distinct addresses." };
  }
  const connection = deps.connection ?? ladderConnection(network);
  const pool = await ladderPoolOpen(args.pool, { network, pools: args.pools, quotes: args.quotes }, { connection, now: deps.now, findPool: deps.findPool });
  if (!pool.ok) return pool;
  if (!pool.takesLimitOrders) return { ok: false, code: "NO_LIMIT_POOL", reason: "This pool does not take limit orders." };
  if (args.legs.length === 0 || args.legs.length > 2 || new Set(args.legs.map((leg) => leg.side)).size !== args.legs.length) {
    return { ok: false, code: "VALIDATION_ERROR", reason: "One buy leg, one exit leg, or both." };
  }
  const plans: LegPlan[] = [];
  for (const leg of args.legs) {
    const own = legIssues(leg);
    const plan = own.length ? null : planLeg(leg, pool.facts);
    const issues: LadderIssue[] = plan ? planIssues(plan, pool.facts) : own;
    if (!plan || issues.length) return { ok: false, code: "PLAN_REFUSED", reason: issues.join(",") || "steps" };
    plans.push(plan);
  }
  const amountUsd = plans.reduce((sum, plan) => sum + legUsd(plan.side, plan.totalRaw, pool.activePrice, pool.facts), 0);
  const maxUsd = args.maxUsd ?? null;
  if (maxUsd !== null && !(amountUsd <= maxUsd + 1e-9)) return { ok: false, code: "OVER_LIMIT", reason: `A ladder places up to $${maxUsd} for now.` };
  const chunks = plans.flatMap((plan) => chunkRungs(plan.rungs).map((rungs) => ({ plan, rungs })));
  if (chunks.length > keys.length) return { ok: false, code: "NOT_ENOUGH_ORDER_KEYS", reason: `The ladder needs ${chunks.length} order accounts.` };

  let dlmm: DLMM;
  let chain: ChainTerms;
  try {
    dlmm = await loadPool(connection, network, args.pool, deps.now ?? Date.now());
    chain = await chainTerms(connection, network, deps.now);
  } catch (failure) {
    return { ok: false, code: "UNREACHABLE", reason: failure instanceof Error ? failure.message : String(failure) };
  }
  const owner = new PublicKey(args.owner);
  const transactions: BuiltLeg[] = [];
  let opened = 0;
  let extension = false;
  for (const [index, { plan, rungs }] of chunks.entries()) {
    const limitOrder = new PublicKey(keys[index]!);
    let built: Transaction;
    try {
      built = await dlmm.placeLimitOrder({
        owner,
        payer: owner,
        sender: owner,
        limitOrder,
        /* The program takes an order's bins in rising order only («InvalidPlaceLimitOrderParameters» otherwise). */
        params: { isAskSide: plan.isAskSide, relativeBin: null, bins: [...rungs].sort((a, b) => a.binId - b.binId).map((rung) => ({ id: rung.binId, amount: new BN(rung.amountRaw) })) },
      });
    } catch (failure) {
      return { ok: false, code: "BUILD_FAILED", reason: failure instanceof Error ? failure.message : String(failure) };
    }
    /* The budget first, then the SDK's instructions as they are. */
    const withBudget = new Transaction({ feePayer: owner, blockhash: built.recentBlockhash as string, lastValidBlockHeight: built.lastValidBlockHeight as number });
    withBudget.add(...budget(network, LADDER_COMPUTE_UNITS), ...built.instructions);
    built = withBudget;
    for (const instruction of built.instructions) {
      if (!instruction.programId.equals(DLMM_KEY)) continue;
      const discriminator = Buffer.from(instruction.data.subarray(0, 8)).toString("hex");
      if (discriminator === INIT_BIN_ARRAY) opened += 1;
      if (discriminator === INIT_BITMAP_EXTENSION) extension = true;
    }
    let serialized: Buffer;
    try {
      serialized = built.serialize({ requireAllSignatures: false, verifySignatures: false });
    } catch {
      return { ok: false, code: "TOO_LARGE", reason: "A step of the ladder does not fit one transaction." };
    }
    if (serialized.length > TX_MAX_BYTES) return { ok: false, code: "TOO_LARGE", reason: "A step of the ladder does not fit one transaction." };
    const inputIsSol = plan.inputMint === WRAPPED_SOL;
    const inputProgram = (plan.isAskSide ? dlmm.tokenX.owner : dlmm.tokenY.owner) as PublicKey;
    const inputAccount = getAssociatedTokenAddressSync(new PublicKey(plan.inputMint), owner, true, inputProgram);
    const beforeRead = await connection.getMultipleAccountsInfo([owner, inputAccount], "confirmed").catch(() => null);
    if (!beforeRead) return { ok: false, code: "UNREACHABLE", reason: "The wallet could not be read." };
    const beforeInput = beforeRead[1] ? tokenAmountOf({ lamports: beforeRead[1].lamports, data: [Buffer.from(beforeRead[1].data).toString("base64"), "base64"] }) : null;
    const simulated = await connection
      .simulateTransaction(new VersionedTransaction(built.compileMessage()), {
        sigVerify: false,
        replaceRecentBlockhash: true,
        commitment: "confirmed",
        accounts: { encoding: "base64", addresses: [owner.toBase58(), inputAccount.toBase58(), limitOrder.toBase58()] },
      })
      .catch((failure: unknown) => ({ failure }));
    if ("failure" in simulated) return { ok: false, code: "SIMULATION_UNAVAILABLE", reason: simulated.failure instanceof Error ? simulated.failure.message : String(simulated.failure) };
    if (simulated.value.err) {
      const logs = (simulated.value.logs ?? []).filter((line) => /Error|insufficient/i.test(line)).slice(0, 2).join(" ");
      return { ok: false, code: "SIMULATION_FAILED", reason: logs || JSON.stringify(simulated.value.err) };
    }
    /* SOL placed as the order's own input is wrapped and leaves the wallet as the amount, not as a cost. */
    const wrapped = inputIsSol ? rungs.reduce((sum, rung) => sum + Number(rung.amountRaw), 0) : 0;
    const after = simulated.value.accounts ?? [];
    const verdict = judgePlacement(
      {
        owner: args.owner,
        pool: args.pool,
        limitOrder: limitOrder.toBase58(),
        isAskSide: plan.isAskSide,
        bins: rungs.map((rung) => ({ id: rung.binId, amount: BigInt(rung.amountRaw) })),
        inputIsSol,
        maxSolOutLamports: placementSolLimit(built, rungs.length, wrapped, chain),
      },
      { lamports: beforeRead[0]?.lamports ?? 0, input: beforeInput },
      { wallet: simAccount(after[0]), input: simAccount(after[1]), order: simAccount(after[2]) },
    );
    if (!verdict.ok) return { ok: false, code: "PROMISE_BROKEN", reason: `${verdict.code}: ${verdict.reason}` };
    const fee = SIGNATURE_LAMPORTS * built.compileMessage().header.numRequiredSignatures + chain.priorityLamportsPerTx;
    transactions.push({
      side: plan.side,
      wireBase64: serialized.toString("base64"),
      limitOrder: limitOrder.toBase58(),
      rungs,
      depositLamports: Math.max(0, verdict.solOutLamports - fee - wrapped),
    });
  }
  const costs = ladderCosts(plans, { existingArrays: new Set(pool.existingArrays), bitmapExtension: pool.bitmapExtension }, chain);
  /* The arrays the SDK actually opens decide what the pool keeps: the reading of nearby arrays only estimated it. */
  const exact: LadderCosts = { ...costs, newArrays: opened, rentKeptLamports: opened * binArrayRent(chain.rentPerByte) + (extension ? bitmapExtensionRent(chain.rentPerByte) : 0) };
  const canDo: LadderCanDo[] = [];
  for (const plan of plans) {
    const read = transactions.filter((tx) => tx.side === plan.side).map((tx) => readLadderTransaction(tx.wireBase64));
    const card = read.every((tx) => tx !== null) ? canDoFromOrders(read.flatMap((tx) => tx!.orders), pool.facts.baseIsX, read.flatMap((tx) => tx!.programs)) : null;
    if (!card || card.owner !== args.owner || card.side !== plan.side || card.maxInputRaw !== plan.totalRaw) {
      return { ok: false, code: "CAN_DO_MISMATCH", reason: "The transactions do not say what the plan says." };
    }
    canDo.push(card);
  }
  return { ok: true, network, pool, plans, transactions, costs: exact, canDo, amountUsd, terms: chain };
}

/* ------------------------------------------------------------------ cancel */

/**
 * The cancellations that take a ladder's money back: per order account, one transaction that takes back every bin
 * still holding something — the deposit and what converted — and closes the account, its rent back to the wallet;
 * an order with nothing left is only closed. Built here, on the network's connection: the SDK's `cancelLimitOrder`
 * already closes the emptied account (SDK 1.9.14), so a second close after it would fail the whole transaction.
 * Each is simulated and judged: the order gone, SOL out only as fees and the wallet's own token accounts. Never
 * restricted to listed pools: a person can always take back what is theirs.
 */
export async function buildLadderCancel(
  args: Readonly<{ owner: string; orders: readonly string[]; network?: LadderNetwork }>,
  deps: Readonly<{ connection?: Connection; now?: number }> = {},
): Promise<Readonly<{ ok: true; transactions: readonly Readonly<{ limitOrder: string; wireBase64: string }>[] }> | LadderFailure> {
  const network = args.network ?? "devnet";
  if (!isAddress(args.owner) || !args.orders.every(isAddress)) return { ok: false, code: "VALIDATION_ERROR", reason: "Addresses only." };
  const connection = deps.connection ?? ladderConnection(network);
  if (!(await onNetwork(connection, network))) return notOn(network);
  const owner = new PublicKey(args.owner);
  const transactions: { limitOrder: string; wireBase64: string }[] = [];
  try {
    const chain = await chainTerms(connection, network, deps.now);
    for (const limitOrder of args.orders) {
      const orderKey = new PublicKey(limitOrder);
      const info = await connection.getAccountInfo(orderKey, "confirmed");
      if (!info || !info.owner.equals(DLMM_KEY)) return { ok: false, code: "ORDER_NOT_FOUND", reason: "The order account is not on chain." };
      const order = decodeLimitOrderAccount(Uint8Array.from(info.data));
      if (!order) return { ok: false, code: "NOT_AN_ORDER", reason: "An address is not a limit order." };
      if (order.owner !== args.owner) return { ok: false, code: "NOT_YOURS", reason: "The order belongs to another wallet." };
      const dlmm = await loadPool(connection, network, order.pool, deps.now ?? Date.now());
      const binIds = order.bins.filter((bin) => !binIsEmpty(bin)).map((bin) => bin.id);
      const built = binIds.length
        ? await dlmm.cancelLimitOrder({ limitOrderPubkey: orderKey, owner, rentReceiver: owner, binIds })
        : await dlmm.closeLimitOrderIfEmpty({ limitOrder: orderKey, owner, rentReceiver: owner });
      const transaction = new Transaction({ feePayer: owner, blockhash: built.recentBlockhash as string, lastValidBlockHeight: built.lastValidBlockHeight as number });
      transaction.add(...budget(network, CANCEL_COMPUTE_UNITS), ...built.instructions);
      const before = await connection.getBalance(owner, "confirmed");
      const simulated = await connection.simulateTransaction(new VersionedTransaction(transaction.compileMessage()), {
        sigVerify: false,
        replaceRecentBlockhash: true,
        commitment: "confirmed",
        accounts: { encoding: "base64", addresses: [owner.toBase58(), limitOrder] },
      });
      if (simulated.value.err) {
        const logs = (simulated.value.logs ?? []).filter((line) => /Error/i.test(line)).slice(0, 2).join(" ");
        return { ok: false, code: "SIMULATION_FAILED", reason: logs || JSON.stringify(simulated.value.err) };
      }
      const after = simulated.value.accounts ?? [];
      const verdict = judgeCancel(
        { maxSolOutLamports: SIGNATURE_LAMPORTS + chain.priorityLamportsPerTx + 2 * (TOKEN_ACCOUNT_BYTES + 128) * chain.rentPerByte },
        { lamports: before },
        { wallet: simAccount(after[0]), order: simAccount(after[1]) },
      );
      if (!verdict.ok) return { ok: false, code: "PROMISE_BROKEN", reason: `${verdict.code}: ${verdict.reason}` };
      const serialized = transaction.serialize({ requireAllSignatures: false, verifySignatures: false });
      transactions.push({ limitOrder, wireBase64: Buffer.from(serialized).toString("base64") });
    }
  } catch (failure) {
    return { ok: false, code: "BUILD_FAILED", reason: failure instanceof Error ? failure.message : String(failure) };
  }
  return { ok: true, transactions };
}

/* ------------------------------------------------------------------ orders */

/** A signature's word from the chain: it landed, or it landed as a failure. One the chain does not know is left out. */
export type LandedState = "confirmed" | "failed";

/**
 * Which of a ladder's sent transactions the chain knows (CITY-231): the relay answers as soon as it sends, and this
 * reading is the confirmation. A transaction that failed on chain is `failed`; one not yet seen is left out, and the
 * window waits for it to show — or for its blockhash to run out.
 */
export async function readSignatures(connection: Pick<Connection, "getSignatureStatuses">, signatures: readonly string[]): Promise<Record<string, LandedState>> {
  const out: Record<string, LandedState> = {};
  if (!signatures.length) return out;
  const answer = await connection.getSignatureStatuses([...signatures], { searchTransactionHistory: true }).catch(() => null);
  answer?.value.forEach((status, index) => {
    if (!status) return;
    if (status.err) out[signatures[index]!] = "failed";
    else if (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized") out[signatures[index]!] = "confirmed";
  });
  return out;
}

/**
 * The ladder's order accounts as the network holds them now, and the word of the chain on any signatures the window
 * still waits for. An account that is gone was cancelled and closed (or never landed — the signature says which); one
 * of another wallet is refused.
 */
export async function readLadderOrders(
  args: Readonly<{ owner: string; orders: readonly string[]; network?: LadderNetwork; signatures?: readonly string[] }>,
  deps: Readonly<{ connection?: Connection; now?: number }> = {},
): Promise<Readonly<{ ok: true; orders: readonly LadderOrderRead[]; prices: Readonly<Record<string, number>>; landed: Readonly<Record<string, LandedState>> }> | LadderFailure> {
  const network = args.network ?? "devnet";
  if (!isAddress(args.owner) || !args.orders.every(isAddress)) return { ok: false, code: "VALIDATION_ERROR", reason: "Addresses only." };
  const connection = deps.connection ?? ladderConnection(network);
  if (!(await onNetwork(connection, network))) return notOn(network);
  const owner = new PublicKey(args.owner);
  const out: LadderOrderRead[] = [];
  const prices: Record<string, number> = {};
  try {
    const infos = await connection.getMultipleAccountsInfo(args.orders.map((order) => new PublicKey(order)), "confirmed");
    for (const [index, info] of infos.entries()) {
      const limitOrder = args.orders[index]!;
      if (!info) {
        out.push({ limitOrder, pool: null, state: "closed", rungs: 0, filled: 0, partial: 0 });
        continue;
      }
      if (!info.owner.equals(DLMM_KEY)) return { ok: false, code: "NOT_AN_ORDER", reason: "An address is not a limit order." };
      const pool = new PublicKey(info.data.subarray(8, 40)).toBase58();
      if (!new PublicKey(info.data.subarray(40, 72)).equals(owner)) return { ok: false, code: "NOT_YOURS", reason: "An order belongs to another wallet." };
      const dlmm = await loadPool(connection, network, pool, deps.now ?? Date.now());
      const order = await dlmm.getLimitOrder(new PublicKey(limitOrder));
      const bins = order.limitOrderData.limitOrderBinData.filter((bin) => !bin.empty);
      const filled = bins.filter((bin) => bin.status === LimitOrderStatus.Fulfilled).length;
      const partial = bins.filter((bin) => bin.status === LimitOrderStatus.PartialFilled).length;
      out.push({
        limitOrder,
        pool,
        state: bins.length > 0 && filled === bins.length ? "filled" : filled + partial > 0 ? "partial" : "open",
        rungs: bins.length,
        filled,
        partial,
      });
      if (!(pool in prices)) {
        const x = dlmm.tokenX.mint;
        const y = dlmm.tokenY.mint;
        /* Y per X at the active bin, in whole tokens; the window turns it to quote per base. */
        prices[pool] = (1 + dlmm.lbPair.binStep / 10_000) ** dlmm.lbPair.activeId * 10 ** (x.decimals - y.decimals);
      }
    }
  } catch (failure) {
    return { ok: false, code: "UNREACHABLE", reason: failure instanceof Error ? failure.message : String(failure) };
  }
  const landed = await readSignatures(connection, (args.signatures ?? []).slice(0, 24));
  return { ok: true, orders: out, prices, landed };
}
