/**
 * Limit orders of DLMM Pro: a ladder placed from a shape, read, collected in part or whole, and closed.
 *
 * An order is one coin resting on up to 25 ticks of one side — an **ask** puts token X above the price and is filled
 * by buyers, a **bid** puts token Y at or below it and is filled by sellers — held as a Token-2022 NFT whose holder is
 * the owner. A swap that reaches a tick fills its orders at the tick's exact price, and the makers share half of the
 * fee the swap paid on what they filled.
 *
 * - **place** — the ladder's ticks and amounts come from a liquidity shape (`./shapes.server.ts`): Spot spreads the
 *   amount evenly, Curve and Bid-Ask by their weights, Custom by the caller's. With `slippageTicks` the order is
 *   *relative*: each tick is an offset from where the price stands when the transaction lands, and the program refuses
 *   it if the price has moved outside the band — so an order never rests on the wrong side of a moved price;
 * - **read** — how much of each tick has filled (`./orders.ts`; the program emits nothing on a fill);
 * - **collect** — the program's `cancel_limit_order`: for the ticks named, or all that are left, the unfilled amount
 *   back, the filled part in the other coin at the tick's price, and the maker's share of the fee. This is the only
 *   way proceeds leave the pool; a tick stays in the order, empty, until the order is closed;
 * - **close** — burns the NFT and returns the rent of the order and of its ticks. Ticks not yet collected are collected
 *   in the same transaction.
 *
 * **The referral of an order** is a wallet named when it is placed; a fifth of the maker's fee goes to it when the
 * order is collected — out of the person's own bonus. An order placed through the venue names the venue's own referral
 * owner — the one its swaps name — unless the caller names another or says none; with no referral owner configured it
 * names nobody. The surface that places an order for a person shows that line before the signature.
 *
 * **A referral never holds a collect up.** The program pays it only where whoever collects passes its token account in
 * the fee's coin, and fails the whole collect if that payment fails. So the account is passed only where it can be
 * paid — on chain, of that coin, not frozen — *and* the collect with it passes a simulation. Anything else — nothing at
 * the address, lamports someone sent there, a frozen account, an account that refuses the transfer — is left out, and
 * the owner is paid the whole fee. What a collect says the owner receives is after the referral's fifth where it is
 * paid, and says why where it is not.
 *
 * **A delegate** — a wallet approved on the NFT's account (amount 0) and given the one permission there is — may
 * collect and nothing else, and the program pays what it collects only into the owner's own associated accounts.
 *
 * **What the wallet must hold** is checked before bytes are returned: the coin, and what the build itself takes in
 * lamports — its fee and the rent of the order, of its ticks and of any token account it opens. An order in SOL needs
 * both together.
 *
 * The NFT's mint is a fresh key the program creates the mint at, so it signs the placing once; the caller makes it and
 * passes its address — the venue holds no key. Everything else the wallet signs alone.
 *
 * **What a person says** — «buy cheaper», «sell higher», how far from the price — becomes a ladder in
 * `./ladder.ts`. `quote` tells it before anything is built: the prices, what rests on each, what the whole of it pays
 * once filled, and the maker's share of the fee as one number with Ryntra's part of it. `placeIntent` is that quote
 * placed — the same `place`, relative to the price at landing unless the caller asked for fixed ticks.
 */

import {
  CollectFeeMode,
  LimitOrderDelegatePermission,
  PoolExtension,
  calculateTransferFeeExcludedAmount,
  calculateTransferFeeIncludedAmount,
  decodeLimitOrderDataFromData,
  deriveLimitOrder,
  findNftAccount,
  getSqrtPriceFromTickId,
  isSupportExtension,
  limitOrderDelegatePermissionMask,
  limitOrderTicksFromShape,
  relativeTickFromSlippage,
  tickArraysForTickIds,
  type DecodedTick,
  type LimitOrder,
  type OpenLimitOrderParameters,
  type Pool,
} from "@meteora-ag/dlmm-pro-sdk";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, createApproveInstruction, createAssociatedTokenAccountIdempotentInstruction, createRevokeInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey, VersionedTransaction, type TransactionInstruction } from "@solana/web3.js";
import BN from "bn.js";

import type { Address } from "../../contracts.ts";
import type { CollectorFacts } from "./collector.ts";
import { FEE_SHARES } from "./fee.ts";
import { LadderRefusal, ladderPlanOf, ladderReachOf, makerShareOf, type LadderIntent, type LadderPlan } from "./ladder.ts";
import { collectPayoutOf, orderFillOf, orderSummaryOf, xForY, yForX, type OrderFill, type OrderFillState, type TickOrderState } from "./orders.ts";
import { DLMM_PRO_ACCOUNT_BYTES, TOKEN_ACCOUNT_BYTES, TOKEN_ACCOUNT_DELEGATED_AMOUNT_OFFSET, TOKEN_ACCOUNT_DELEGATE_OFFSET, assertAffords, assertHolds, assertOpen, assertSigner, bitmapExtensionFor, clientPastDust, clockOf, isPayableTokenAccount, missingTickArrays, modelWith, poolWhole, tokenProgramOf, transferFeeMintOf, type DlmmProContext } from "./pools.server.ts";
import { DlmmProRefusal, refusing } from "./sdk.server.ts";
import { shapeOf, shapeViewOf, type ShapeRequest, type ShapeView } from "./shapes.server.ts";
import { MAX_ORDER_TICKS, MAX_TICK_ID, MIN_TICK_ID, TICKS_PER_ARRAY, priceOfSqrtX64 } from "./ticks.ts";
import { DLMM_PRO_UNITS, keyOf, rawOf, seal, simulationOf, unitsOf, type DlmmProBuild, type DlmmProTx, type SealOptions } from "./tx.server.ts";

export type LadderRequest = Readonly<{
  pool: Address;
  /** The owner of the order: it pays the coin and the rent, and signs. */
  wallet: Address;
  /** The address of the fresh key the order's NFT is minted at; the caller holds the key and signs with it once. */
  nftMint: Address;
  side: "bid" | "ask";
  /** How the amount is spread over the ladder's ticks. Only the ticks on the order's side of the price are used. */
  shape: ShapeRequest;
  /** Of the coin the order rests in — token X for an ask, token Y for a bid — before its own transfer fee. */
  totalAmountRaw: string;
  /**
   * How many ticks the price may move, either way, between the build and the landing; a multiple of the pool's
   * spacing. Null — the ticks are fixed, and a price that crossed them refuses the order.
   */
  slippageTicks: number | null;
  /** A bid only: also rest on the tick the price stands on. */
  includeActiveTick?: boolean;
  /**
   * The wallet that takes a fifth of the maker's fee when the order is collected. Absent — the venue's own referral
   * owner, where one is configured; null — nobody.
   */
  referralWallet?: Address | null;
  /**
   * A wallet let to collect the order — and nothing else — from the moment it rests: the approval on the NFT's account
   * and the order's permission bit, in the placing itself, so the order never rests without the collector the person
   * asked for. Absent or null — nobody; the owner may still name one later (`delegate`).
   */
  delegate?: Address | null;
}>;

export type LadderBuild = DlmmProBuild &
  Readonly<{
    order: Address;
    /** The wallet the order names as its referral; null — nobody. */
    referral: Address | null;
    /** The wallet the placing lets collect the order; null — nobody. */
    delegate: Address | null;
    nftMint: Address;
    nftAccount: Address;
    side: "bid" | "ask";
    /** The ticks as of the build — absolute — and what rests on each. A relative order may land shifted with the price. */
    ticks: readonly Readonly<{ tickId: number; amountRaw: string }>[];
    /** What rests in the order, and the most the wallet pays for it (its coin's transfer fee on top). */
    amountRaw: string;
    maximumPaidRaw: string;
    /** The band the price must still be in at landing; null for fixed ticks. */
    band: Readonly<{ minTickId: number; maxTickId: number }> | null;
    shape: ShapeView;
  }>;

/** What a person asks for: a side, a coin of the pool, how far from the price, and how much. */
export type IntentRequest = Readonly<{
  pool: Address;
  /** The person's coin — one of the pool's two. «Cheaper» and «higher» are of this coin's price in the other. */
  coin: Address;
  /** Of the coin the order rests in — what a buy spends, what a sell sells — before its own transfer fee. */
  amountRaw: string;
  /** The wallet that takes a fifth of the maker's fee. Absent — the venue's own referral owner; null — nobody. */
  referralWallet?: Address | null;
}> &
  Omit<LadderIntent, "coin">;

/** A ladder to place: what was asked, who pays and owns it, the fresh key of its NFT, and who may collect it. */
export type IntentPlacing = IntentRequest & Readonly<{ wallet: Address; nftMint: Address; delegate?: Address | null }>;

/** A ladder told before it is built: what would rest where, what it pays filled, and what the maker keeps of the fee. */
export type LadderQuote = Readonly<{
  pool: Address;
  action: "buy" | "sell";
  side: "bid" | "ask";
  /** The coin the order rests in and the coin a fill pays. */
  restsIn: Address;
  paysIn: Address;
  /** Nearest the price first. `price` — the coin's price in the other coin at the rung, whole tokens: a number to show. */
  rungs: readonly Readonly<{ tickId: number; awayBps: number; price: number; amountRaw: string; paysRaw: string }>[];
  /** What rests in the order — the asked amount less what its weights cannot split — and what it pays once every rung is filled, at the rungs' exact prices. */
  amountRaw: string;
  paysRaw: string;
  /** The coin's price now and the average price of the whole ladder filled — numbers to show. */
  price: number;
  averagePrice: number;
  nearBps: number;
  farBps: number;
  /** How far the price may move before the ladder lands; null — fixed ticks. */
  corridorBps: number | null;
  slippageTicks: number | null;
  /** The farthest this side may reach on this pool, basis points of the coin's price: a slider's end. */
  reachBps: number;
  /**
   * The maker's share of the fee, basis points of what fills, at the pool's fee now: `ownerBps` is the person's,
   * `referralBps` Ryntra's fifth of the maker's half (D-M3), `referral` the wallet named — null — nobody, and the
   * person keeps the whole of it. `feeIn` — the coin it is paid in.
   */
  bonus: Readonly<{ feeBps: number; makerBps: number; ownerBps: number; referralBps: number; referral: Address | null; feeIn: Address }>;
  plan: LadderPlan;
}>;

export type IntentBuild = LadderBuild & Readonly<{ quote: LadderQuote }>;

export type OrderTickView = Readonly<{
  tickId: number;
  state: OrderFillState;
  amountRaw: string;
  filledRaw: string;
  unfilledRaw: string;
  /** In the other coin, at the tick's price. */
  proceedsRaw: string;
  /** The maker's share of the fee were the tick collected now, before a referral's fifth. */
  feeShareRaw: string;
}>;

export type OrderView = Readonly<{
  order: Address;
  nftMint: Address;
  pool: Address;
  side: "bid" | "ask" | null;
  /** The coin the order rests in, the coin a fill pays, and the coin its fee share is in. */
  restsIn: Address | null;
  paysIn: Address | null;
  feeIn: Address | null;
  /** The wallet named when the order was placed; null — nobody. */
  referral: Address | null;
  /** Whether a delegate may collect: the permission bit on the order. The delegate itself is the NFT account's. */
  delegateMayCollect: boolean;
  ticks: readonly OrderTickView[];
  amountRaw: string;
  filledRaw: string;
  unfilledRaw: string;
  proceedsRaw: string;
  feeShareRaw: string;
  /** What collecting everything left would pay, per coin, before transfer fees and a referral's share. */
  payout: Readonly<{ xRaw: string; yRaw: string }>;
  bonus: OrderBonus;
  /** Every tick collected: closing returns the rent. */
  closable: boolean;
}>;

/**
 * The maker's fee of what is left to collect — the owner's bonus — and how a collect would share it now, before the
 * coin's own transfer fee. `referralPaid` — the order names a referral and its token account in the fee's coin can be
 * paid as it stands; then a fifth is the referral's. A collect confirms it by simulating, and leaves the referral out
 * if the payment would fail — the owner then keeps all of it.
 */
export type OrderBonus = Readonly<{
  /** The coin the fee is in; null once every tick is collected. */
  mint: Address | null;
  raw: string;
  ownerRaw: string;
  referralRaw: string;
  referralPaid: boolean;
}>;

export type CollectRequest = Readonly<{
  pool: Address;
  nftMint: Address;
  /** The holder of the order's NFT; what is collected goes to its accounts. */
  owner: Address;
  /** Who signs: the owner, or its delegate. Absent — the owner. */
  signer?: Address;
  /** The ticks to collect; absent — every tick that is left. */
  tickIds?: readonly number[];
  /** The least to receive, per coin, after transfer fees. Absent — none: a payout is at fixed prices and moves only as more of the order fills. */
  minimumXRaw?: string;
  minimumYRaw?: string;
  /**
   * The signer opens nothing: the holder's accounts of both coins must stand already, and a build that would open one
   * on the signer's rent is refused instead. For a collector that pays its own fees and must not be made to pay rent.
   */
  opensNothing?: boolean;
}>;

/** What a collect pays, and to whom. */
export type CollectPayout = Readonly<{
  /** What the owner's accounts receive, per coin: after the referral's fifth of the fee and after each coin's own transfer fee. */
  expected: Readonly<{ xRaw: string; yRaw: string }>;
  /** The same before the referral's share and the transfer fees: what the ticks' fills add up to. */
  gross: Readonly<{ xRaw: string; yRaw: string }>;
  /**
   * The referral token account the collect pays and its coin; `raw` — what the collect pays it, `receivedRaw` — what
   * the account receives of that after the coin's own transfer fee. Null — the order names none, or its account cannot
   * be paid.
   */
  referral: Readonly<{ account: Address; mint: Address; raw: string; receivedRaw: string }> | null;
  /**
   * Why the referral the order names is not paid by this collect: `noAccount` — what stands at its token account's
   * address cannot be paid; `simulationFailed` — the node ran the collect with it and it did not pass;
   * `simulationUnavailable` — the node could not be asked, so nothing showed that it would. Null — it is paid, or the
   * order names none. The collect built without it is not simulated again: one that fails for a reason of its own is
   * still handed out, and fails in the wallet's own simulation.
   */
  referralLeftOut: "noAccount" | "simulationFailed" | "simulationUnavailable" | null;
}>;

export type CollectBuild = DlmmProBuild & Readonly<{ order: Address; tickIds: readonly number[] }> & CollectPayout;

const big = (value: { toString(): string }) => BigInt(value.toString());
const DEFAULT = PublicKey.default;

/** The token accounts a built transaction closes (the token programs' CloseAccount), by address. */
export function closedTokenAccounts(wireBase64: string): readonly string[] {
  return [...tokenAccountsAfter([wireBase64])].filter(([, stands]) => !stands).map(([address]) => address);
}

/**
 * What a series of built transactions leaves of the token accounts they open or close, in order: an associated
 * account created stands, one closed is gone — the last word on each address wins. Addresses neither opens nor
 * closes are not in the map.
 */
export function tokenAccountsAfter(wires: readonly string[]): ReadonlyMap<string, boolean> {
  const programs = new Set([TOKEN_PROGRAM_ID.toBase58(), TOKEN_2022_PROGRAM_ID.toBase58()]);
  const ata = ASSOCIATED_TOKEN_PROGRAM_ID.toBase58();
  const after = new Map<string, boolean>();
  for (const wire of wires) {
    const tx = VersionedTransaction.deserialize(Buffer.from(wire, "base64"));
    const keys = tx.message.staticAccountKeys.map((key) => key.toBase58());
    for (const ix of tx.message.compiledInstructions) {
      const program = keys[ix.programIdIndex] ?? "";
      const at = (index: number) => keys[ix.accountKeyIndexes[index] ?? -1] ?? "";
      if (program === ata && (ix.data.length === 0 || (ix.data.length === 1 && ix.data[0] === 1)) && at(1)) after.set(at(1), true);
      else if (programs.has(program) && ix.data.length === 1 && ix.data[0] === 9 && at(0)) after.set(at(0), false);
    }
  }
  return after;
}

const emptyTick = (tickId: number): TickOrderState => ({
  tickId,
  sqrtPrice: 0n,
  orderAge: 0n,
  openOrderAmount: 0n,
  totalProcessingOrderAmount: 0n,
  processedOrderRemainingAmount: 0n,
  fulfilledOrderAmountX: 0n,
  fulfilledOrderAmountY: 0n,
  limitOrderFeeAskSide: 0n,
  limitOrderFeeBidSide: 0n,
});

function tickStateOf(tick: DecodedTick): TickOrderState {
  return {
    tickId: tick.tickId,
    sqrtPrice: big(tick.sqrtPrice),
    orderAge: big(tick.orderAge),
    openOrderAmount: big(tick.openOrderAmount),
    totalProcessingOrderAmount: big(tick.totalProcessingOrderAmount),
    processedOrderRemainingAmount: big(tick.processedOrderRemainingAmount),
    fulfilledOrderAmountX: big(tick.fulfilledOrderAmountX),
    fulfilledOrderAmountY: big(tick.fulfilledOrderAmountY),
    limitOrderFeeAskSide: big(tick.limitOrderFeeAskSide),
    limitOrderFeeBidSide: big(tick.limitOrderFeeBidSide),
  };
}

const tickView = (fill: OrderFill): OrderTickView => ({
  tickId: fill.tickId,
  state: fill.state,
  amountRaw: fill.amountRaw.toString(),
  filledRaw: fill.filledRaw.toString(),
  unfilledRaw: fill.unfilledRaw.toString(),
  proceedsRaw: fill.proceedsRaw.toString(),
  feeShareRaw: fill.feeShareRaw.toString(),
});

export function createDlmmProLimitOrders(context: DlmmProContext) {
  const { connection, client } = context;
  const programId = client.program.programId;
  /** The two coins of a pool with their token programs, for whoever receives them. */
  const coinsOf = (pool: Pool) => [
    { mint: pool.tokenXMint, program: tokenProgramOf(pool.tokenXFlag) },
    { mint: pool.tokenYMint, program: tokenProgramOf(pool.tokenYFlag) },
  ];
  /** Refuses a build whose signer cannot pay its fee and the rent of the token accounts it opens — or that pays into a frozen account. */
  const assertPaysFor = (signer: PublicKey, sealed: Pick<DlmmProTx, "feeLamports">, instructions: readonly TransactionInstruction[], receives: readonly PublicKey[] = []) =>
    assertAffords(connection, signer, [], { fee: BigInt(sealed.feeLamports), instructions, receives });
  /** The owner's own accounts of the pool's coins that a collect pays anything into: a frozen one takes nothing. */
  const receivingOf = (pool: Pool, owner: PublicKey, payout: Pick<CollectPayout, "gross">) =>
    coinsOf(pool)
      .filter((_, index) => BigInt(index === 0 ? payout.gross.xRaw : payout.gross.yRaw) > 0n)
      .map((coin) => getAssociatedTokenAddressSync(coin.mint, owner, true, coin.program));

  /** An order's account whole — its head and its ticks — with the fills of each tick against the pool's tick arrays. */
  async function loaded(poolKey: PublicKey, nftMint: PublicKey) {
    const orderKey = deriveLimitOrder(nftMint, programId);
    const [info, { pool }] = await Promise.all([connection.getAccountInfo(orderKey, "confirmed"), poolWhole(context, poolKey)]);
    if (!info || !info.owner.equals(programId)) throw new DlmmProRefusal("BAD_INPUT", "No limit order lives at this NFT.");
    const data = Buffer.from(info.data);
    const head = client.program.coder.accounts.decode<LimitOrder>("limitOrder", data);
    if (!head.pool.equals(poolKey)) throw new DlmmProRefusal("BAD_INPUT", "The order belongs to another pool.");
    const entries = decodeLimitOrderDataFromData(data);
    const live = entries.filter((entry) => !entry.amount.isZero());
    const arrays = live.length
      ? await client.state.fetchTickArraysWithTicks(tickArraysForTickIds(poolKey, live.map((entry) => entry.tickId), pool.tickSpacing, programId), {
          withReward: isSupportExtension(pool.extensions, PoolExtension.LiquidityMining),
        })
      : [];
    const ticks = new Map(arrays.flatMap((array) => array.ticks.map((tick) => [tick.tickId, tick] as const)));
    const fills = entries.map((entry) => {
      const order = { tickId: entry.tickId, isAsk: entry.isAsk === 1, amount: big(entry.amount), age: big(entry.age) };
      /* A collected tick is read without its tick: the tick may be gone, and its counter no longer says anything of this order. */
      if (order.amount === 0n) return orderFillOf(order, emptyTick(entry.tickId));
      const tick = ticks.get(entry.tickId);
      if (!tick) throw new DlmmProRefusal("FAILED", `The order's tick ${entry.tickId} is not in the pool's tick arrays.`);
      return orderFillOf(order, tickStateOf(tick));
    });
    return { orderKey, pool, head, fills };
  }

  /** The coin an order's fee is in, and its token program: token Y on a pool that collects only in Y and for every bid, token X for an ask elsewhere. */
  const feeCoinOf = (pool: Pool, side: "ask" | "bid") => {
    const isX = pool.collectFeeMode !== CollectFeeMode.OnlyY && side === "ask";
    return { isX, mint: isX ? pool.tokenXMint : pool.tokenYMint, program: tokenProgramOf(isX ? pool.tokenXFlag : pool.tokenYFlag) };
  };
  /**
   * The token account of the order's referral in the fee's coin, when what stands there can be paid now; null when the
   * order names none, names its own owner, or the account cannot be paid. A read that fails throws; it is never taken
   * for «no referral».
   */
  async function payableReferralOf(pool: Pool, head: LimitOrder, side: "ask" | "bid", owner: PublicKey | null): Promise<Readonly<{ named: boolean; account: PublicKey | null }>> {
    if (head.referral.equals(DEFAULT) || (owner !== null && head.referral.equals(owner))) return { named: false, account: null };
    const coin = feeCoinOf(pool, side);
    const account = getAssociatedTokenAddressSync(coin.mint, head.referral, true, coin.program);
    return { named: true, account: isPayableTokenAccount(await connection.getAccountInfo(account, "confirmed"), coin.mint, coin.program) ? account : null };
  }
  /** A fifth of a maker's fee, rounded down once over the whole of it — as the program pays it. */
  const referralShareOf = (fee: bigint) => (fee * BigInt(FEE_SHARES.referralOfOrderFeeBps)) / 10_000n;

  function viewOf(poolKey: PublicKey, nftMint: PublicKey, state: Awaited<ReturnType<typeof loaded>>, referralPaid: boolean): OrderView {
    const { pool, head, fills } = state;
    const summary = orderSummaryOf(fills);
    const onlyY = pool.collectFeeMode === CollectFeeMode.OnlyY;
    const payout = collectPayoutOf(fills, onlyY);
    const x = pool.tokenXMint.toBase58();
    const y = pool.tokenYMint.toBase58();
    const side = summary.side;
    return {
      order: state.orderKey.toBase58(),
      nftMint: nftMint.toBase58(),
      pool: poolKey.toBase58(),
      side,
      restsIn: side === null ? null : side === "ask" ? x : y,
      paysIn: side === null ? null : side === "ask" ? y : x,
      feeIn: side === null ? null : onlyY || side === "bid" ? y : x,
      referral: head.referral.equals(DEFAULT) ? null : head.referral.toBase58(),
      delegateMayCollect: (head.delegatePermission & (1 << LimitOrderDelegatePermission.CancelLimitOrder)) !== 0,
      ticks: fills.map(tickView),
      amountRaw: summary.amountRaw.toString(),
      filledRaw: summary.filledRaw.toString(),
      unfilledRaw: summary.unfilledRaw.toString(),
      proceedsRaw: summary.proceedsRaw.toString(),
      feeShareRaw: summary.feeShareRaw.toString(),
      payout: { xRaw: payout.xRaw.toString(), yRaw: payout.yRaw.toString() },
      bonus: {
        mint: side === null ? null : onlyY || side === "bid" ? y : x,
        raw: summary.feeShareRaw.toString(),
        ownerRaw: (summary.feeShareRaw - (referralPaid ? referralShareOf(summary.feeShareRaw) : 0n)).toString(),
        referralRaw: (referralPaid ? referralShareOf(summary.feeShareRaw) : 0n).toString(),
        referralPaid,
      },
      closable: summary.closable,
    };
  }

  /** An order and how much of each of its ticks has filled. */
  async function read(request: Readonly<{ pool: Address; nftMint: Address }>): Promise<OrderView> {
    return refusing(async () => {
      const poolKey = keyOf(request.pool, "The pool");
      const nftMint = keyOf(request.nftMint, "The order's NFT");
      const state = await loaded(poolKey, nftMint);
      const side = orderSummaryOf(state.fills).side;
      /* The model does not know who holds the order: a referral that is the holder itself is told at the collect. */
      const referral = side === null ? { named: false, account: null } : await payableReferralOf(state.pool, state.head, side, null);
      return viewOf(poolKey, nftMint, state, referral.account !== null);
    });
  }

  /** A ladder of limit orders from a shape — unsigned; the wallet and the fresh NFT mint sign. */
  async function place(request: LadderRequest, options: SealOptions = {}): Promise<LadderBuild> {
    return refusing(async () => {
      const poolKey = keyOf(request.pool, "The pool");
      const wallet = keyOf(request.wallet, "The wallet");
      const nftMint = keyOf(request.nftMint, "The order's NFT mint");
      const total = rawOf(request.totalAmountRaw, "The amount");
      if (total <= 0n) throw new DlmmProRefusal("AMOUNT_ZERO", "The amount is zero.");
      /* A side that is neither would be read as a bid and spend the other coin. */
      if (request.side !== "ask" && request.side !== "bid") throw new DlmmProRefusal("BAD_INPUT", "An order is an ask or a bid.");
      const { model, pool } = await modelWith(context, poolKey, wallet.toBase58());
      assertOpen(model, "addLiquidity");
      const shape = shapeOf(request.shape, pool);
      const relative = request.slippageTicks !== null;
      const picked = limitOrderTicksFromShape({ shape, side: request.side, totalAmount: new BN(total.toString()), relative, includeActiveTick: request.includeActiveTick ?? false });
      if (picked.ticks.length > MAX_ORDER_TICKS) throw new DlmmProRefusal("BAD_INPUT", `An order rests on at most ${MAX_ORDER_TICKS} ticks.`);
      const isAsk = request.side === "ask";
      const tokenMint = isAsk ? pool.tokenXMint : pool.tokenYMint;
      const [mint, clock] = await Promise.all([transferFeeMintOf(connection, tokenMint), clockOf(context)]);
      /* The order is credited the tick amounts exactly; the wallet pays the coin's own transfer fee on top. */
      const maximumPaid = calculateTransferFeeIncludedAmount(mint, clock.epoch, picked.amount).amount;
      const tokenProgram = tokenProgramOf(isAsk ? pool.tokenXFlag : pool.tokenYFlag);
      const band = relative ? relativeTickFromSlippage({ currentTickId: pool.tickCurrentId, tickSpacing: pool.tickSpacing, slippageTicks: request.slippageTicks! }) : null;
      const parameters: OpenLimitOrderParameters = { isAskSide: isAsk, maxAmount: maximumPaid, relativeTick: band, ticks: picked.ticks };
      /* The order names the venue's own referral owner unless the caller names another, or says none. */
      const named = request.referralWallet === undefined ? context.referralOwner : request.referralWallet;
      const referral = named ? keyOf(named, "The referral wallet") : null;
      const collector = request.delegate ? keyOf(request.delegate, "The delegate") : null;
      if (collector?.equals(wallet)) throw new DlmmProRefusal("BAD_INPUT", "The owner collects its own order without being named.");
      const aligned = Math.floor(pool.tickCurrentId / pool.tickSpacing) * pool.tickSpacing;
      const tickIds = picked.ticks.map((tick) => (relative ? aligned + tick.id * pool.tickSpacing : tick.id));
      /* A relative order lands shifted with the price, by up to its band either way: every tick its ticks may then stand on — the two ends, and one in every tick array between. */
      const within = (tickId: number) => Math.min(MAX_TICK_ID, Math.max(MIN_TICK_ID, tickId));
      const reach = (tickId: number, slip: number) => {
        const ids = [within(tickId + slip)];
        for (let at = tickId - slip; at < tickId + slip; at += TICKS_PER_ARRAY * pool.tickSpacing) ids.push(within(at));
        return ids;
      };
      const reached = relative ? tickIds.flatMap((tickId) => reach(tickId, request.slippageTicks!)) : tickIds;
      const sdk = await clientPastDust(context, [wallet], [{ mint: tokenMint, program: tokenProgram }]);
      /* A tick beyond the pool's own bitmap of tick arrays, on a pool with no extension yet: the order makes it first. */
      const extension = await bitmapExtensionFor(client, poolKey, pool, reached, wallet);
      const built = await sdk.limitOrder.openLimitOrder({
        pool: poolKey,
        nftMint,
        owner: wallet,
        payer: wallet,
        tokenMint,
        parameters,
        referral,
        ...(extension.extension ? { tickArrayBitmapExtension: extension.extension } : {}),
      });
      /* The collector, named in the placing itself: approved on the NFT's account the order has just made (amount 0) and given the one permission there is. */
      const handover = collector
        ? [
            createApproveInstruction(built.nftAccount, collector, wallet, 0, [], TOKEN_2022_PROGRAM_ID),
            ...(await client.limitOrder.updateLimitOrderDelegatePermission({ nftMint, owner: wallet, permission: limitOrderDelegatePermissionMask([LimitOrderDelegatePermission.CancelLimitOrder]) })).tx.instructions,
          ]
        : [];
      const sealed = await seal({
        connection,
        wallet,
        instructions: [...extension.make, ...built.tx.instructions, ...handover],
        fresh: [nftMint],
        units: unitsOf(DLMM_PRO_UNITS.openLimitOrder.base, DLMM_PRO_UNITS.openLimitOrder.perTick, picked.ticks.length, DLMM_PRO_UNITS.tokenAccount + extension.units + (collector ? DLMM_PRO_UNITS.delegate : 0)),
        options,
      });
      /*
       * What the wallet must hold: the coin, the fee, and the rent of the order — its NFT, its head, an entry and a tick
       * for each of its ticks, a head for every tick array it makes, any token account the build opens, and the pool's
       * bitmap extension where the order makes it. A relative order makes the tick arrays that are missing where it
       * lands: of those missing anywhere in its reach, no more than its ticks can stand in at once.
       */
      const sizes = DLMM_PRO_ACCOUNT_BYTES;
      const withRewards = model.extensions.liquidityMining;
      const missing = await missingTickArrays(context, poolKey, reached, pool.tickSpacing);
      const atOnce = Math.floor((Math.max(...tickIds) - Math.min(...tickIds)) / (TICKS_PER_ARRAY * pool.tickSpacing)) + 2;
      const arrays = relative ? Math.min(missing, atOnce) : missing;
      const cost = await assertAffords(connection, wallet, [{ mint: tokenMint, program: tokenProgram, amount: big(maximumPaid) }], {
        fee: BigInt(sealed.feeLamports),
        instructions: built.tx.instructions,
        accounts: [sizes.nftMint, sizes.nftAccount, sizes.orderHead, ...Array.from({ length: arrays }, () => sizes.tickArrayHead), ...extension.accounts],
        bytes: tickIds.length * (sizes.orderEntry + (withRewards ? sizes.tickWithRewards : sizes.tick)),
      });
      return {
        ...sealed,
        ...cost,
        order: built.limitOrder.toBase58(),
        referral: referral ? referral.toBase58() : null,
        delegate: collector ? collector.toBase58() : null,
        nftMint: nftMint.toBase58(),
        nftAccount: built.nftAccount.toBase58(),
        side: request.side,
        ticks: picked.ticks.map((tick, index) => ({ tickId: tickIds[index]!, amountRaw: tick.amount.toString() })),
        amountRaw: picked.amount.toString(),
        maximumPaidRaw: maximumPaid.toString(),
        band: band ? { minTickId: band.spacingAlignedMinTickId, maxTickId: band.spacingAlignedMaxTickId } : null,
        shape: shapeViewOf(request.shape.strategy, shape),
      };
    });
  }

  /**
   * The instructions that collect the ticks named, and what they pay to whom. `withoutReferral` — the collect with the
   * order's referral was not shown to land (it failed a simulation, or none could be run): it is built without it.
   */
  async function collectInstructions(request: CollectRequest, pool: Pool, state: Awaited<ReturnType<typeof loaded>>, poolKey: PublicKey, nftMint: PublicKey, withoutReferral: false | "simulationFailed" | "simulationUnavailable" = false) {
    const owner = keyOf(request.owner, "The owner");
    const signer = request.signer ? keyOf(request.signer, "The signer") : owner;
    await assertSigner(connection, nftMint, owner, signer, (state.head.delegatePermission & (1 << LimitOrderDelegatePermission.CancelLimitOrder)) !== 0, "the order");
    const live = state.fills.filter((fill) => fill.state !== "collected");
    const wanted = request.tickIds ? [...new Set(request.tickIds)].sort((a, b) => a - b) : live.map((fill) => fill.tickId).sort((a, b) => a - b);
    if (wanted.length === 0) throw new DlmmProRefusal("NOTHING_TO_DO", "Every tick of the order is collected already.");
    const chosen = wanted.map((tickId) => {
      const fill = live.find((entry) => entry.tickId === tickId);
      if (!fill) throw new DlmmProRefusal("BAD_INPUT", `The order holds nothing at tick ${tickId}.`);
      return fill;
    });
    const onlyY = pool.collectFeeMode === CollectFeeMode.OnlyY;
    const gross = collectPayoutOf(chosen, onlyY);
    const { isX: feeIsX, mint: feeMint } = feeCoinOf(pool, chosen[0]!.side);
    /*
     * The order's own referral — passed only when its account in the fee's coin can be paid now. Whatever else stands at
     * that address is not passed: the program would fail the whole collect on it, and anyone can put lamports there.
     */
    const referral = await payableReferralOf(pool, state.head, chosen[0]!.side, owner);
    const referralToken = withoutReferral ? null : referral.account;
    const referralLeftOut: CollectPayout["referralLeftOut"] = !referral.named ? null : referral.account === null ? "noAccount" : withoutReferral || null;
    /* With a referral paid, a fifth of the maker's fee of these ticks goes to it, rounded down; the owner keeps the rest. */
    const fee = chosen.reduce((sum, fill) => sum + fill.feeShareRaw, 0n);
    const referralRaw = referralToken ? referralShareOf(fee) : 0n;
    const [mintX, mintY, clock] = await Promise.all([transferFeeMintOf(connection, pool.tokenXMint), transferFeeMintOf(connection, pool.tokenYMint), clockOf(context)]);
    const received = (amount: bigint, mint: Awaited<ReturnType<typeof transferFeeMintOf>>) => big(calculateTransferFeeExcludedAmount(mint, clock.epoch, new BN(amount.toString())).amount);
    const payout: CollectPayout = {
      expected: { xRaw: received(gross.xRaw - (feeIsX ? referralRaw : 0n), mintX).toString(), yRaw: received(gross.yRaw - (feeIsX ? 0n : referralRaw), mintY).toString() },
      gross: { xRaw: gross.xRaw.toString(), yRaw: gross.yRaw.toString() },
      referral: referralToken ? { account: referralToken.toBase58(), mint: feeMint.toBase58(), raw: referralRaw.toString(), receivedRaw: received(referralRaw, feeIsX ? mintX : mintY).toString() } : null,
      referralLeftOut,
    };
    const sdk = await clientPastDust(context, [owner], coinsOf(pool));
    const built = await sdk.limitOrder.cancelLimitOrder({
      pool: poolKey,
      nftMint,
      owner,
      signer,
      tokenXMint: pool.tokenXMint,
      tokenYMint: pool.tokenYMint,
      tickIds: wanted,
      minAmountX: new BN(request.minimumXRaw ? rawOf(request.minimumXRaw, "The least of token X").toString() : "0"),
      minAmountY: new BN(request.minimumYRaw ? rawOf(request.minimumYRaw, "The least of token Y").toString() : "0"),
      referralToken,
    });
    let instructions = built.tx.instructions as readonly TransactionInstruction[];
    if (request.opensNothing) {
      /* The program reads both of the holder's accounts, whichever coin it pays: each must stand, of its coin and not frozen. */
      const accounts = coinsOf(pool).map((coin) => ({ coin, address: getAssociatedTokenAddressSync(coin.mint, owner, true, coin.program) }));
      const infos = await connection.getMultipleAccountsInfo(accounts.map((entry) => entry.address), "confirmed");
      const missing = accounts.find((entry, index) => !isPayableTokenAccount(infos[index] ?? null, entry.coin.mint, entry.coin.program));
      if (missing) throw new DlmmProRefusal("BAD_INPUT", `The holder has no account of ${missing.coin.mint.toBase58()} to be paid into; the holder opens it, not the signer.`);
      instructions = instructions.filter((instruction) => !instruction.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID));
    }
    return { instructions, signer, owner, tickIds: wanted, payout };
  }

  /** Collects ticks of an order — some, or all that are left: unfilled back, proceeds and the maker's fee out. */
  async function collect(request: CollectRequest, options: SealOptions = {}): Promise<CollectBuild> {
    return refusing(async () => {
      const poolKey = keyOf(request.pool, "The pool");
      const nftMint = keyOf(request.nftMint, "The order's NFT");
      const state = await loaded(poolKey, nftMint);
      const { model } = await modelWith(context, poolKey, request.owner);
      assertOpen(model, "removeLiquidity");
      let part = await collectInstructions(request, state.pool, state, poolKey, nftMint);
      const units = unitsOf(DLMM_PRO_UNITS.cancelLimitOrder.base, DLMM_PRO_UNITS.cancelLimitOrder.perTick, part.tickIds.length, 2 * DLMM_PRO_UNITS.tokenAccount);
      let sealed = await seal({ connection, wallet: part.signer, instructions: part.instructions, units, options });
      /* The referral is paid only where the collect with it is shown to land: it never holds the person's collect up. */
      const shown = part.payout.referral === null ? "passes" : await simulationOf(connection, sealed);
      if (shown !== "passes") {
        part = await collectInstructions(request, state.pool, state, poolKey, nftMint, shown === "fails" ? "simulationFailed" : "simulationUnavailable");
        sealed = await seal({ connection, wallet: part.signer, instructions: part.instructions, units, options });
      }
      const cost = await assertPaysFor(part.signer, sealed, part.instructions, receivingOf(state.pool, part.owner, part.payout));
      return { ...sealed, ...cost, order: state.orderKey.toBase58(), tickIds: part.tickIds, ...part.payout };
    });
  }

  /**
   * Closes an order and returns its rent to the owner (or to `rentReceiver`). Ticks not yet collected are collected
   * first, in the same transaction. Only the owner closes.
   */
  async function close(
    request: Readonly<{ pool: Address; nftMint: Address; owner: Address; rentReceiver?: Address }>,
    options: SealOptions = {},
  ): Promise<DlmmProBuild & Readonly<{ order: Address; collected: readonly number[] }> & CollectPayout> {
    return refusing(async () => {
      const poolKey = keyOf(request.pool, "The pool");
      const nftMint = keyOf(request.nftMint, "The order's NFT");
      const owner = keyOf(request.owner, "The owner");
      const state = await loaded(poolKey, nftMint);
      await assertHolds(connection, nftMint, owner, "the order");
      const live = state.fills.filter((fill) => fill.state !== "collected");
      let before: readonly TransactionInstruction[] = [];
      let collected: readonly number[] = [];
      let payout: CollectPayout = { expected: { xRaw: "0", yRaw: "0" }, gross: { xRaw: "0", yRaw: "0" }, referral: null, referralLeftOut: null };
      const collecting = async (withoutReferral: false | "simulationFailed" | "simulationUnavailable") => {
        const part = await collectInstructions({ pool: request.pool, nftMint: request.nftMint, owner: request.owner }, state.pool, state, poolKey, nftMint, withoutReferral);
        before = part.instructions;
        collected = part.tickIds;
        payout = part.payout;
      };
      if (live.length > 0) {
        const { model } = await modelWith(context, poolKey, request.owner);
        assertOpen(model, "removeLiquidity");
        await collecting(false);
      }
      /* Every tick the order was ever placed on, collected or not: the close releases each one's reference. */
      const tickArrays = tickArraysForTickIds(poolKey, state.fills.map((fill) => fill.tickId), state.pool.tickSpacing, programId);
      const built = await client.limitOrder.closeLimitOrder({ pool: poolKey, nftMint, owner, rentReceiver: request.rentReceiver ? keyOf(request.rentReceiver, "The rent's receiver") : owner, tickArrays });
      const units =
        unitsOf(DLMM_PRO_UNITS.closeLimitOrder.base, DLMM_PRO_UNITS.closeLimitOrder.perTick, state.fills.length) +
        (collected.length ? unitsOf(DLMM_PRO_UNITS.cancelLimitOrder.base, DLMM_PRO_UNITS.cancelLimitOrder.perTick, collected.length, 2 * DLMM_PRO_UNITS.tokenAccount) : 0);
      let sealed = await seal({ connection, wallet: owner, instructions: [...before, ...built.tx.instructions], units, options });
      /* As in a collect: the referral only where the whole of it is shown to land with it. */
      const shown = payout.referral === null ? "passes" : await simulationOf(connection, sealed);
      if (shown !== "passes") {
        await collecting(shown === "fails" ? "simulationFailed" : "simulationUnavailable");
        sealed = await seal({ connection, wallet: owner, instructions: [...before, ...built.tx.instructions], units, options });
      }
      const cost = await assertPaysFor(owner, sealed, before, receivingOf(state.pool, owner, payout));
      return { ...sealed, ...cost, order: state.orderKey.toBase58(), collected, ...payout };
    });
  }

  /** The wallet an order would name as its referral: the caller's, the venue's own, or nobody. */
  const referralNamed = (asked: Address | null | undefined): Address | null => (asked === undefined ? context.referralOwner : asked);

  /**
   * A ladder for what a person asked, told before anything is built: the same ticks and amounts `place` would hand the
   * program for this pool as it stands now. A relative ladder lands shifted with the price — its rungs keep their
   * distances from it.
   */
  async function quote(request: IntentRequest): Promise<LadderQuote> {
    return refusing(async () => {
      const poolKey = keyOf(request.pool, "The pool");
      const coin = keyOf(request.coin, "The coin");
      const total = rawOf(request.amountRaw, "The amount");
      if (total <= 0n) throw new DlmmProRefusal("AMOUNT_ZERO", "The amount is zero.");
      const { model, pool } = await modelWith(context, poolKey, null);
      const isX = coin.equals(pool.tokenXMint);
      if (!isX && !coin.equals(pool.tokenYMint)) throw new DlmmProRefusal("BAD_INPUT", "The coin is not one of the pool's two.");
      const at = { tickSpacing: pool.tickSpacing, tickId: pool.tickCurrentId };
      let plan: LadderPlan;
      try {
        plan = ladderPlanOf({ action: request.action, coin: isX ? "x" : "y", nearBps: request.nearBps, farBps: request.farBps, rungs: request.rungs, spread: request.spread, corridorBps: request.corridorBps }, at);
      } catch (error) {
        if (error instanceof LadderRefusal) throw new DlmmProRefusal("BAD_INPUT", error.message);
        throw error;
      }
      const isAsk = plan.side === "ask";
      const relative = plan.slippageTicks !== null;
      /* A budget is split by whole weights: less than their sum would leave a price with nothing on it. */
      if (total < BigInt(plan.rungs.reduce((sum, rung) => sum + rung.weight, 0))) throw new DlmmProRefusal("BAD_INPUT", "The amount is too small to rest on every price of the ladder.");
      const picked = limitOrderTicksFromShape({ shape: shapeOf(plan.shape, pool), side: plan.side, totalAmount: new BN(total.toString()), relative });
      const aligned = Math.floor(pool.tickCurrentId / pool.tickSpacing) * pool.tickSpacing;
      const amounts = new Map(picked.ticks.map((tick) => [relative ? aligned + tick.id * pool.tickSpacing : tick.id, big(tick.amount)] as const));
      /* The coin's price in the other coin, whole tokens: the pool's own price where the coin is token X, one over it where it is token Y. */
      const shown = (sqrtPrice: bigint) => {
        const price = priceOfSqrtX64(sqrtPrice, model.tokenX.decimals, model.tokenY.decimals);
        return isX ? price : 1 / price;
      };
      const rungs = plan.rungs.map((rung) => {
        const amount = amounts.get(rung.tickId);
        if (amount === undefined) throw new DlmmProRefusal("FAILED", `The ladder's tick ${rung.tickId} is not among the ticks the order would rest on.`);
        const sqrtPrice = big(getSqrtPriceFromTickId(rung.tickId));
        /* What the rung pays filled whole — at its tick's exact price, rounded down, as the program settles it. */
        const pays = isAsk ? yForX(amount, sqrtPrice) : xForY(amount, sqrtPrice);
        return { tickId: rung.tickId, awayBps: rung.awayBps, price: shown(sqrtPrice), amountRaw: amount.toString(), paysRaw: pays.toString() };
      });
      const rests = rungs.reduce((sum, rung) => sum + BigInt(rung.amountRaw), 0n);
      const pays = rungs.reduce((sum, rung) => sum + BigInt(rung.paysRaw), 0n);
      /* Whole tokens of each side of the ladder, to tell its average price: the other coin per coin. */
      const restsWhole = Number(rests) / 10 ** (isAsk ? model.tokenX.decimals : model.tokenY.decimals);
      const paysWhole = Number(pays) / 10 ** (isAsk ? model.tokenY.decimals : model.tokenX.decimals);
      /* The coin is what rests in a sell and what a buy is paid in. */
      const coinRests = isAsk === isX;
      const averagePrice = pays === 0n || rests === 0n ? 0 : coinRests ? paysWhole / restsWhole : restsWhole / paysWhole;
      const referral = referralNamed(request.referralWallet);
      const share = makerShareOf(model.fee.totalBps, referral !== null);
      return {
        pool: poolKey.toBase58(),
        action: request.action,
        side: plan.side,
        restsIn: (isAsk ? pool.tokenXMint : pool.tokenYMint).toBase58(),
        paysIn: (isAsk ? pool.tokenYMint : pool.tokenXMint).toBase58(),
        rungs,
        amountRaw: rests.toString(),
        paysRaw: pays.toString(),
        price: shown(big(pool.sqrtPrice)),
        averagePrice,
        nearBps: plan.nearBps,
        farBps: plan.farBps,
        corridorBps: plan.corridorBps,
        slippageTicks: plan.slippageTicks,
        reachBps: ladderReachOf(request.action, isX ? "x" : "y", at),
        bonus: { feeBps: model.fee.totalBps, ...share, referral, feeIn: feeCoinOf(pool, plan.side).mint.toBase58() },
        plan,
      };
    });
  }

  /**
   * Places the ladder a person asked for — unsigned; the wallet and the fresh NFT mint sign. The quote it comes back
   * with is the one the build stands on: where the price moved a spacing between the two, the ladder is refused as
   * stale rather than handed out with a quote that is not its own.
   */
  async function placeIntent(request: IntentPlacing, options: SealOptions = {}): Promise<IntentBuild> {
    /* Twice at the most: a price that crossed a spacing between the quote and the build is quoted and built once more. */
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const told = await quote(request);
      const built = await place(
        { pool: request.pool, wallet: request.wallet, nftMint: request.nftMint, side: told.side, shape: told.plan.shape, totalAmountRaw: request.amountRaw, slippageTicks: told.slippageTicks, referralWallet: told.bonus.referral, delegate: request.delegate ?? null },
        options,
      );
      const same = built.ticks.length === told.rungs.length && built.ticks.every((tick) => told.rungs.some((rung) => rung.tickId === tick.tickId && rung.amountRaw === tick.amountRaw));
      if (same) return { ...built, quote: told };
    }
    throw new DlmmProRefusal("FAILED", "The price moved while the ladder was being built. Ask again.");
  }

  /**
   * Lets `delegate` collect the order — and nothing else — or takes that back (`delegate` null): the approval on the
   * NFT's account (amount 0: a delegated amount fails every delegated call) and the order's own permission bit, in one
   * transaction. What a delegate collects the program pays only into the owner's associated accounts.
   */
  async function delegate(request: Readonly<{ nftMint: Address; owner: Address; delegate: Address | null }>, options: SealOptions = {}): Promise<DlmmProBuild> {
    return refusing(async () => {
      const nftMint = keyOf(request.nftMint, "The order's NFT");
      const owner = keyOf(request.owner, "The owner");
      const nftAccount = findNftAccount(nftMint, owner);
      await assertHolds(connection, nftMint, owner, "the order");
      const to = request.delegate ? keyOf(request.delegate, "The delegate") : null;
      const permission = to ? limitOrderDelegatePermissionMask([LimitOrderDelegatePermission.CancelLimitOrder]) : 0;
      const built = await client.limitOrder.updateLimitOrderDelegatePermission({ nftMint, owner, permission });
      const approval = to ? createApproveInstruction(nftAccount, to, owner, 0, [], TOKEN_2022_PROGRAM_ID) : createRevokeInstruction(nftAccount, owner, [], TOKEN_2022_PROGRAM_ID);
      const sealed = await seal({ connection, wallet: owner, instructions: [approval, ...built.tx.instructions], units: DLMM_PRO_UNITS.delegate, options });
      return { ...sealed, ...(await assertPaysFor(owner, sealed, [])) };
    });
  }

  /**
   * Opens the holder's own accounts of the pool's two coins where they are missing — unsigned, the holder pays and
   * signs. A collector opens nothing (`opensNothing`), so the holder who names one opens these itself. Null — both
   * stand already. An account that stands and cannot be paid into — frozen, or not a token account — is refused.
   */
  async function prepare(request: Readonly<{ pool: Address; owner: Address; after?: readonly string[] }>, options: SealOptions = {}): Promise<DlmmProBuild | null> {
    return refusing(async () => {
      const poolKey = keyOf(request.pool, "The pool");
      const owner = keyOf(request.owner, "The owner");
      const { pool } = await poolWhole(context, poolKey);
      const accounts = coinsOf(pool).map((coin) => ({ coin, address: getAssociatedTokenAddressSync(coin.mint, owner, true, coin.program) }));
      const infos = await connection.getMultipleAccountsInfo(accounts.map((entry) => entry.address), "confirmed");
      /*
       * What the transactions signed before this one close, it opens again: a build the owner signs closes its
       * wrapped-SOL account at its end (the SDK unwraps), and a collector opens nothing — so it is opened again here,
       * after them, in the same approval.
       */
      const after = tokenAccountsAfter(request.after ?? []);
      /* Lamports somebody left at the address are not an account: the token program makes one there all the same. What the builds before open or close is what stands when this one runs. */
      const stands = (index: number) => after.get(accounts[index]!.address.toBase58()) ?? (infos[index] != null && infos[index]!.data.length > 0);
      /* Only an account on the chain now that no build before opens or closes can be one that refuses to be paid into: what a build opens is opened right. */
      const broken = accounts.find((entry, index) => !after.has(entry.address.toBase58()) && infos[index] != null && infos[index]!.data.length > 0 && !isPayableTokenAccount(infos[index]!, entry.coin.mint, entry.coin.program));
      if (broken) throw new DlmmProRefusal("BAD_INPUT", `The holder's account of ${broken.coin.mint.toBase58()} cannot be paid into.`);
      const missing = accounts.filter((_, index) => !stands(index));
      if (missing.length === 0) return null;
      const instructions = missing.map((entry) => createAssociatedTokenAccountIdempotentInstruction(owner, entry.address, owner, entry.coin.mint, entry.coin.program));
      const sealed = await seal({ connection, wallet: owner, instructions, units: missing.length * DLMM_PRO_UNITS.tokenAccount, options });
      return { ...sealed, ...(await assertPaysFor(owner, sealed, instructions)) };
    });
  }

  /** Whether the holder's own accounts of both coins of a pool stand to be paid into — all a collector's collect needs of them. */
  async function accountsReady(request: Readonly<{ pool: Address; owner: Address }>): Promise<boolean> {
    return refusing(async () => {
      const owner = keyOf(request.owner, "The owner");
      const { pool } = await poolWhole(context, keyOf(request.pool, "The pool"));
      const coins = coinsOf(pool);
      const infos = await connection.getMultipleAccountsInfo(coins.map((coin) => getAssociatedTokenAddressSync(coin.mint, owner, true, coin.program)), "confirmed");
      return coins.every((coin, index) => isPayableTokenAccount(infos[index] ?? null, coin.mint, coin.program));
    });
  }

  /**
   * Who may collect an order beside its holder: the delegate approved on the holder's NFT account with nothing
   * delegated, where the order's own bit lets a delegate collect. Null — nobody.
   */
  async function collectorOf(request: Readonly<{ nftMint: Address; owner: Address }>): Promise<Address | null> {
    return refusing(async () => {
      const nftMint = keyOf(request.nftMint, "The order's NFT");
      const owner = keyOf(request.owner, "The owner");
      const [nft, order] = await connection.getMultipleAccountsInfo([findNftAccount(nftMint, owner), deriveLimitOrder(nftMint, programId)], "confirmed");
      if (!nft || !order || !order.owner.equals(programId) || nft.data.length < TOKEN_ACCOUNT_BYTES) return null;
      const data = Buffer.from(nft.data);
      if (data.readBigUInt64LE(64) !== 1n || data.readUInt32LE(TOKEN_ACCOUNT_DELEGATE_OFFSET) !== 1 || data.readBigUInt64LE(TOKEN_ACCOUNT_DELEGATED_AMOUNT_OFFSET) !== 0n) return null;
      const head = client.program.coder.accounts.decode<LimitOrder>("limitOrder", Buffer.from(order.data));
      if ((head.delegatePermission & (1 << LimitOrderDelegatePermission.CancelLimitOrder)) === 0) return null;
      return new PublicKey(data.subarray(TOKEN_ACCOUNT_DELEGATE_OFFSET + 4, TOKEN_ACCOUNT_DELEGATE_OFFSET + 36)).toBase58();
    });
  }

  /**
   * What a collector's judge holds a collect to (`./collector.ts`), read from the chain and derived — never from the
   * build it will judge: the order and its NFT account, the pool's coins, and the referral accounts a collect of this
   * order may pay — the order's own referral, in each of the two coins a fee can be in.
   */
  async function collectorFacts(request: Readonly<{ pool: Address; nftMint: Address; owner: Address; collector: Address }>): Promise<CollectorFacts> {
    return refusing(async () => {
      const poolKey = keyOf(request.pool, "The pool");
      const nftMint = keyOf(request.nftMint, "The order's NFT");
      const owner = keyOf(request.owner, "The owner");
      const state = await loaded(poolKey, nftMint);
      const [x, y] = coinsOf(state.pool);
      const named = !state.head.referral.equals(DEFAULT) && !state.head.referral.equals(owner);
      return {
        program: programId.toBase58(),
        collector: keyOf(request.collector, "The collector").toBase58(),
        owner: owner.toBase58(),
        pool: poolKey.toBase58(),
        order: state.orderKey.toBase58(),
        nftAccount: findNftAccount(nftMint, owner).toBase58(),
        tokenX: { mint: x!.mint.toBase58(), program: x!.program.toBase58() },
        tokenY: { mint: y!.mint.toBase58(), program: y!.program.toBase58() },
        referralAccounts: named ? [x!, y!].map((coin) => getAssociatedTokenAddressSync(coin.mint, state.head.referral, true, coin.program).toBase58()) : [],
      };
    });
  }

  return { read, quote, place, placeIntent, prepare, accountsReady, collect, close, delegate, collectorOf, collectorFacts };
}

export type DlmmProLimitOrders = ReturnType<typeof createDlmmProLimitOrders>;
