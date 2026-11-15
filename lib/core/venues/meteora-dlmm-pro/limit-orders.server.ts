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
import { TOKEN_2022_PROGRAM_ID, createApproveInstruction, createRevokeInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey, type TransactionInstruction } from "@solana/web3.js";
import BN from "bn.js";

import type { Address } from "../../contracts.ts";
import { FEE_SHARES } from "./fee.ts";
import { collectPayoutOf, orderFillOf, orderSummaryOf, type OrderFill, type OrderFillState, type TickOrderState } from "./orders.ts";
import { DLMM_PRO_ACCOUNT_BYTES, assertAffords, assertHolds, assertOpen, assertSigner, bitmapExtensionFor, clientPastDust, clockOf, isPayableTokenAccount, missingTickArrays, modelWith, poolWhole, tokenProgramOf, transferFeeMintOf, type DlmmProContext } from "./pools.server.ts";
import { DlmmProRefusal, refusing } from "./sdk.server.ts";
import { shapeOf, shapeViewOf, type ShapeRequest, type ShapeView } from "./shapes.server.ts";
import { MAX_ORDER_TICKS, MAX_TICK_ID, MIN_TICK_ID, TICKS_PER_ARRAY } from "./ticks.ts";
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
}>;

export type LadderBuild = DlmmProBuild &
  Readonly<{
    order: Address;
    /** The wallet the order names as its referral; null — nobody. */
    referral: Address | null;
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
      const sealed = await seal({
        connection,
        wallet,
        instructions: [...extension.make, ...built.tx.instructions],
        fresh: [nftMint],
        units: unitsOf(DLMM_PRO_UNITS.openLimitOrder.base, DLMM_PRO_UNITS.openLimitOrder.perTick, picked.ticks.length, DLMM_PRO_UNITS.tokenAccount + extension.units),
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
    return { instructions: built.tx.instructions as readonly TransactionInstruction[], signer, owner, tickIds: wanted, payout };
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

  return { read, place, collect, close, delegate };
}

export type DlmmProLimitOrders = ReturnType<typeof createDlmmProLimitOrders>;
