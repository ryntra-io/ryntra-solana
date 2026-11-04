/**
 * The ladder composer on devnet (B5, CITY-135) — the server's part: read a
 * pool, build a ladder's `place_limit_order` transactions for the person's
 * wallet to sign, build the cancellations that take the money back, read the
 * orders back.
 *
 * Nothing here signs. A placement needs two signatures — the person's wallet
 * and the fresh order account's — and neither key is ever here: the window
 * makes the order accounts' keys in the browser and sends only their public
 * addresses; the wallet signs; the window adds the order accounts' own
 * signatures over the exact message the wallet signed (`city/lib/bots/ladder-sign.ts`);
 * the relay (`relay.server.ts`) only checks and forwards. No server secret is
 * read, no keypair is made, no transaction is signed in this file.
 *
 * The network is devnet by construction: every read and build goes through
 * `ladderConnection()` (`connection.server.ts`), devnet's endpoint and nothing else. The
 * mainnet limits lane (`lib/solana/limits/**`) is called, not changed — its
 * cancel builder takes the connection it is given.
 */

import DLMM, { deriveBinArray, isSupportLimitOrder, LimitOrderStatus } from "@meteora-ag/dlmm";
import { ExtensionType, getExtensionTypes, TOKEN_2022_PROGRAM_ID, type Mint } from "@solana/spl-token";
import { ComputeBudgetProgram, Connection, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import BN from "bn.js";

import { mintSafety } from "../backtest/mint-safety.ts";
import { buildDlmmCancel } from "../../solana/limits/dlmm.server.ts";
import { DLMM_PROGRAM } from "../../solana/limits/model.ts";
import { ladderConnection, onDevnet } from "./connection.server.ts";
import { canDoFromOrders, type LadderCanDo } from "./decode.ts";
import { BIN_ARRAY_RENT_LAMPORTS, BITMAP_EXTENSION_RENT_LAMPORTS, ladderCosts, type LadderCosts } from "./costs.ts";
import { WRAPPED_SOL } from "./network.ts";
import { binArrayIndex, binPrice, chunkRungs, legIssues, planIssues, planLeg, type LadderIssue, type LadderLeg, type LadderPool, type LegPlan, type Rung } from "./plan.ts";
import type { LadderOrderRead } from "./orders.ts";
import { readLadderTransaction, isAddress } from "./tx.ts";

/** A legacy transaction's limit, bytes. */
export const TX_MAX_BYTES = 1_232;
/** Compute units a placement may use: opening bin arrays costs more than the default 200 000. A limit, not a price — no priority fee is set. */
export const LADDER_COMPUTE_UNITS = 400_000;
/** Bin arrays read around the active one to tell which a ladder would open. */
const ARRAYS_AROUND = 8;
const DLMM_KEY = new PublicKey(DLMM_PROGRAM);
const INIT_BIN_ARRAY = "235613b94ed44bd3";
const INIT_BITMAP_EXTENSION = "2f9de2b40cf02147";

export type LadderFailure = Readonly<{ ok: false; code: string; reason: string }>;

export { ladderConnection };

const NOT_DEVNET: LadderFailure = { ok: false, code: "NOT_DEVNET", reason: "The endpoint does not serve devnet." };

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
 * A mint's facts as the bots' filter reads them, from the mint account on devnet: the token program, the freeze
 * authority and which of the dangerous Token-2022 extensions the mint carries (their presence is what the filter
 * reads; their settings are not needed to leave the mint out).
 */
export function devnetMintFacts(mint: Mint, program: PublicKey): Facts {
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

const pools = new Map<string, Readonly<{ at: number; dlmm: DLMM }>>();
const POOL_TTL_MS = 30_000;

async function loadPool(connection: Connection, address: string, now: number): Promise<DLMM> {
  const kept = pools.get(address);
  if (kept && now - kept.at < POOL_TTL_MS) {
    await kept.dlmm.refetchStates();
    return kept.dlmm;
  }
  const dlmm = await DLMM.create(connection, new PublicKey(address), { cluster: "devnet" });
  pools.set(address, { at: now, dlmm });
  return dlmm;
}

/**
 * A devnet pool as the composer needs it. The quote must be one of the dollar tokens the deployment lists, the base
 * must pass the bots' mint filter (no permanent delegate, transfer hook, freeze authority or transfer fee).
 */
export async function readLadderPool(
  address: string,
  quotes: readonly string[],
  deps: Readonly<{ connection?: Connection; now?: number }> = {},
): Promise<LadderPoolRead | LadderFailure> {
  const connection = deps.connection ?? ladderConnection();
  if (!(await onDevnet(connection))) return NOT_DEVNET;
  let dlmm: DLMM;
  try {
    dlmm = await loadPool(connection, address, deps.now ?? Date.now());
  } catch (failure) {
    return { ok: false, code: "UNREACHABLE", reason: failure instanceof Error ? failure.message : String(failure) };
  }
  const x = dlmm.tokenX.mint.address.toBase58();
  const y = dlmm.tokenY.mint.address.toBase58();
  const quoteIsY = quotes.includes(y);
  if (!quoteIsY && !quotes.includes(x)) return { ok: false, code: "NOT_DOLLAR_QUOTED", reason: "The pool is not quoted in a dollar token." };
  const base = quoteIsY ? dlmm.tokenX : dlmm.tokenY;
  const quote = quoteIsY ? dlmm.tokenY : dlmm.tokenX;
  const safety = mintSafety(devnetMintFacts(base.mint, base.owner));
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
  pool: LadderPoolRead;
  plans: readonly LegPlan[];
  transactions: readonly BuiltLeg[];
  costs: LadderCosts;
  canDo: readonly LadderCanDo[];
}>;

/**
 * Build a ladder's transactions: each leg planned (`plan.ts`), cut by bin array, one `place_limit_order` per cut with
 * the next of the order accounts the window named, each simulated before it is shown. Any leg that does not plan,
 * any transaction that does not fit or does not simulate, stops the whole ladder: never half of it.
 */
export async function buildLadder(
  args: Readonly<{ owner: string; pool: string; legs: readonly LadderLeg[]; orderKeys: readonly string[]; pools: readonly string[]; quotes: readonly string[] }>,
  deps: Readonly<{ connection?: Connection; now?: number }> = {},
): Promise<LadderBuilt | LadderFailure> {
  if (!isAddress(args.owner)) return { ok: false, code: "VALIDATION_ERROR", reason: "The wallet is not an address." };
  if (!args.pools.includes(args.pool)) return { ok: false, code: "POOL_NOT_LISTED", reason: "This pool is not open to ladders." };
  const keys = [...new Set(args.orderKeys)];
  if (keys.length !== args.orderKeys.length || !keys.every(isAddress) || keys.includes(args.owner) || keys.includes(args.pool)) {
    return { ok: false, code: "VALIDATION_ERROR", reason: "The order accounts must be fresh, distinct addresses." };
  }
  const connection = deps.connection ?? ladderConnection();
  const pool = await readLadderPool(args.pool, args.quotes, { connection, now: deps.now });
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
  const chunks = plans.flatMap((plan) => chunkRungs(plan.rungs).map((rungs) => ({ plan, rungs })));
  if (chunks.length > keys.length) return { ok: false, code: "NOT_ENOUGH_ORDER_KEYS", reason: `The ladder needs ${chunks.length} order accounts.` };

  let dlmm: DLMM;
  try {
    dlmm = await loadPool(connection, args.pool, deps.now ?? Date.now());
  } catch (failure) {
    return { ok: false, code: "UNREACHABLE", reason: failure instanceof Error ? failure.message : String(failure) };
  }
  const owner = new PublicKey(args.owner);
  const before = await connection.getBalance(owner, "confirmed").catch(() => null);
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
        params: { isAskSide: plan.isAskSide, relativeBin: null, bins: rungs.map((rung) => ({ id: rung.binId, amount: new BN(rung.amountRaw) })) },
      });
    } catch (failure) {
      return { ok: false, code: "BUILD_FAILED", reason: failure instanceof Error ? failure.message : String(failure) };
    }
    /* The limit first, then the SDK's instructions as they are. */
    const withLimit = new Transaction({ feePayer: owner, blockhash: built.recentBlockhash as string, lastValidBlockHeight: built.lastValidBlockHeight as number });
    withLimit.add(ComputeBudgetProgram.setComputeUnitLimit({ units: LADDER_COMPUTE_UNITS }), ...built.instructions);
    built = withLimit;
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
    const simulated = await connection
      .simulateTransaction(new VersionedTransaction(built.compileMessage()), {
        sigVerify: false,
        replaceRecentBlockhash: true,
        commitment: "confirmed",
        accounts: { encoding: "base64", addresses: [owner.toBase58()] },
      })
      .catch((failure: unknown) => ({ failure }));
    if ("failure" in simulated) return { ok: false, code: "SIMULATION_UNAVAILABLE", reason: simulated.failure instanceof Error ? simulated.failure.message : String(simulated.failure) };
    if (simulated.value.err) {
      const logs = (simulated.value.logs ?? []).filter((line) => /Error|insufficient/i.test(line)).slice(0, 2).join(" ");
      return { ok: false, code: "SIMULATION_FAILED", reason: logs || JSON.stringify(simulated.value.err) };
    }
    const after = simulated.value.accounts?.[0]?.lamports;
    const fee = 5_000 * built.compileMessage().header.numRequiredSignatures;
    /* SOL placed as the order's own input is wrapped and leaves the wallet as the amount, not as a cost. */
    const wrapped = plan.inputMint === WRAPPED_SOL ? rungs.reduce((sum, rung) => sum + Number(rung.amountRaw), 0) : 0;
    transactions.push({
      side: plan.side,
      wireBase64: serialized.toString("base64"),
      limitOrder: limitOrder.toBase58(),
      rungs,
      depositLamports: before !== null && typeof after === "number" ? Math.max(0, before - after - fee - wrapped) : null,
    });
  }
  const costs = ladderCosts(plans, { existingArrays: new Set(pool.existingArrays), bitmapExtension: pool.bitmapExtension });
  /* The arrays the SDK actually opens decide what the pool keeps: the reading of nearby arrays only estimated it. */
  const exact: LadderCosts = { ...costs, newArrays: opened, rentKeptLamports: opened * BIN_ARRAY_RENT_LAMPORTS + (extension ? BITMAP_EXTENSION_RENT_LAMPORTS : 0) };
  const canDo: LadderCanDo[] = [];
  for (const plan of plans) {
    const read = transactions.filter((tx) => tx.side === plan.side).map((tx) => readLadderTransaction(tx.wireBase64));
    const card = read.every((tx) => tx !== null) ? canDoFromOrders(read.flatMap((tx) => tx!.orders), pool.facts.baseIsX, read.flatMap((tx) => tx!.programs)) : null;
    if (!card || card.owner !== args.owner || card.side !== plan.side || card.maxInputRaw !== plan.totalRaw) {
      return { ok: false, code: "CAN_DO_MISMATCH", reason: "The transactions do not say what the plan says." };
    }
    canDo.push(card);
  }
  return { ok: true, pool, plans, transactions, costs: exact, canDo };
}

/* ------------------------------------------------------------------ cancel */

/**
 * The cancellations that take a ladder's money back: per order account, cancel every open bin and close the account,
 * the deposit, what converted and the rent back to the wallet — the limits lane's own builder, on devnet's
 * connection. Never restricted to listed pools: a person can always take back what is theirs.
 */
export async function buildLadderCancel(
  args: Readonly<{ owner: string; orders: readonly string[] }>,
  deps: Readonly<{ connection?: Connection }> = {},
): Promise<Readonly<{ ok: true; transactions: readonly Readonly<{ limitOrder: string; wireBase64: string }>[] }> | LadderFailure> {
  if (!isAddress(args.owner) || !args.orders.every(isAddress)) return { ok: false, code: "VALIDATION_ERROR", reason: "Addresses only." };
  const connection = deps.connection ?? ladderConnection();
  if (!(await onDevnet(connection))) return NOT_DEVNET;
  const transactions: { limitOrder: string; wireBase64: string }[] = [];
  for (const limitOrder of args.orders) {
    const built = await buildDlmmCancel({ owner: args.owner, limitOrder }, { connection });
    if (!built.ok) return { ok: false, code: built.code, reason: built.reason };
    transactions.push({ limitOrder, wireBase64: built.transactionBase64 });
  }
  return { ok: true, transactions };
}

/* ------------------------------------------------------------------ orders */

/**
 * The ladder's order accounts as devnet holds them now. An account that is gone was cancelled and closed (or never
 * landed — the window knows which from the relay's answer); one of another wallet is refused.
 */
export async function readLadderOrders(
  args: Readonly<{ owner: string; orders: readonly string[] }>,
  deps: Readonly<{ connection?: Connection; now?: number }> = {},
): Promise<Readonly<{ ok: true; orders: readonly LadderOrderRead[]; prices: Readonly<Record<string, number>> }> | LadderFailure> {
  if (!isAddress(args.owner) || !args.orders.every(isAddress)) return { ok: false, code: "VALIDATION_ERROR", reason: "Addresses only." };
  const connection = deps.connection ?? ladderConnection();
  if (!(await onDevnet(connection))) return NOT_DEVNET;
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
      const dlmm = await loadPool(connection, pool, deps.now ?? Date.now());
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
  return { ok: true, orders: out, prices };
}
