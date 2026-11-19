/**
 * Earning on a DLMM Pro pool: a position from a goal, what it earned in two lines, and the one approval
 * that lets an agent look after it.
 *
 * Everything here is put together from the venue's own parts — `./goals.ts`, `./swap.server.ts`,
 * `./positions.server.ts`, `./rewards.server.ts` — and adds no instruction of its own.
 *
 * - **open** — a goal (or a shape of the person's own, painted on a grid) and a width become one position,
 *   one NFT. The wallet pays in both of the pool's coins, or in
 *   one: then the part the shape needs of the other is swapped **in this very pool**, first, and the opening is built
 *   for the pool as that swap leaves it — its ranges and its deposit stand at the price the swap's quote ends at. The
 *   wallet is asked once for both transactions; they are sent in order. The swap's fee is the pool's own — Ryntra adds
 *   none, and the swap carries Ryntra's referral where its account exists, out of the protocol's share;
 * - **the band of the price** (`bandBps`) — how far the price may stand from where the opening was built for when it
 *   lands, basis points either way: the person's tolerance, never wider than an eighth of the way to the range's
 *   nearer edge (`./goals.ts` says why: the wider the band, the more of the money stays out of the position) — a
 *   quarter for «Even», whose one range the program sizes itself at the price the deposit lands at, so that next to
 *   nothing stays out (`positions.open`, `sizing: "landing"`).
 *   Inside it the deposit lands; outside it the chain refuses the deposit and the coins stay in the wallet. It is the
 *   same number the venue's own `slippageBps` is for a deposit, a removal and a compound — a band of the price, not a
 *   margin of an amount — and it is what a person is told, in one line;
 * - **income** — what a position has earned, as two lines: the fees a collect would pay now, and the pool's rewards
 *   its slots already show (`accruedRaw` per reward slot: what is written, the least a collect pays);
 * - **care** — the rights an agent is given to look after a position and nothing more: collect the fees, collect the
 *   rewards, take the liquidity out. The program pays all three into the owner's own associated accounts, whoever
 *   signs; adding liquidity and changing the ranges are not among them, so an agent with these rights can never move
 *   a coin of its own into the position or of the owner's anywhere but to the owner. The approval is one transaction
 *   of the owner's; taking it back is another. What the agent then signs is built by `positions.collect`,
 *   `rewards.collect` and `positions.remove` with the agent as `signer`.
 *
 * A build for a wallet that cannot pay for it is refused before a signature, as everywhere in the venue. Nothing here
 * signs, sends or holds a key.
 */

import { amountsFromShape, findNftAccount, tickIdFromSqrtPrice, type LiquidityRange } from "@meteora-ag/dlmm-pro-sdk";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

import type { Address } from "../../contracts.ts";
import { CUSTOM_GOAL, CUSTOM_MAX_RANGES, GOAL_BAND_SHARE, GOAL_BAND_SHARE_AT_LANDING, goalBandBps, isEarnStyle, isOpenGoal, isShapeColumns, openPlanOf, sizedAtLanding, type EarnStyle, type GoalPlan, type OpenGoal } from "./goals.ts";
import { poolWhole, type DlmmProContext, type DlmmProPool, type DlmmProPools } from "./pools.server.ts";
import type { DepositView, DlmmProPositions, OpenRole, PositionPermission, PositionView } from "./positions.server.ts";
import { DlmmProRefusal, refusing } from "./sdk.server.ts";
import { shapeOf, type ShapeView } from "./shapes.server.ts";
import type { DlmmProSwap } from "./swap.server.ts";
import { bpsOf, keyOf, rawOf, type DlmmProBuild, type DlmmProRent, type DlmmProTx, type SealOptions } from "./tx.server.ts";

/** What an agent that looks after a position may do: take what it earned and take it out — each only to the owner. */
export const CARE_RIGHTS = ["claimFee", "claimReward", "removeLiquidity"] as const satisfies readonly PositionPermission[];

/** The widest band of the price a goal's deposit is built for, basis points either way. */
export const MAX_EARN_BAND_BPS = 500;

/** A token account's delegate, as the token programs lay an account out: an option at byte 72, the amount it may move at byte 121. */
const DELEGATE_OFFSET = 72;
const DELEGATED_AMOUNT_OFFSET = 121;

const big = (value: { toString(): string }) => BigInt(value.toString());

export type EarnPay =
  /** One of the pool's two coins: the venue swaps the part the shape needs of the other, in this pool. */
  | Readonly<{ mint: Address; amountRaw: string }>
  /** Both coins, as the wallet holds them: the most of each to deposit. */
  | Readonly<{ amountXRaw: string; amountYRaw: string }>;

export type EarnOpenRequest = Readonly<{
  pool: Address;
  wallet: Address;
  /** The address of the fresh key the position's NFT is minted at; the caller holds the key. */
  nftMint: Address;
  /** One of the three goals, or `custom` — the person's own painted grid, in `columns`. */
  goal: OpenGoal;
  style: EarnStyle;
  /** For `custom` only: 32 columns, 16 under the price and 16 over it, each 0 to 8 cells (`./goals.ts`). */
  columns?: readonly number[];
  pay: EarnPay;
  /** How far the price may move before the deposit lands, basis points either way; held to an eighth of the way to the range's nearer edge. */
  slippageBps: number;
}>;

export type EarnRole = "SWAP" | OpenRole;

export type EarnOpenBuild = DlmmProRent &
  Readonly<{
    /** The transactions in the order they are sent, each saying what it carries: the swap first, when there is one, then the opening. */
    steps: readonly (DlmmProTx & Readonly<{ roles: readonly EarnRole[] }>)[];
    plan: GoalPlan;
    /** The band of the price the deposit is built for — what `slippageBps` came to. */
    bandBps: number;
    /** The swap sent ahead of the opening; null when the wallet pays in both coins. */
    swap: Readonly<{
      inputMint: Address;
      outputMint: Address;
      amountInRaw: string;
      expectedOutRaw: string;
      minimumOutRaw: string;
      /** The pool's own fee on it: its coin, its amount, basis points of what it is charged on. */
      feeMint: Address;
      feeRaw: string;
      feeBps: number;
      /** Whether Ryntra's referral account is in the swap. */
      referral: boolean;
    }> | null;
    position: Address;
    nftMint: Address;
    shape: ShapeView;
    deposit: DepositView;
    /** The network's fee for every step together, lamports. */
    feeLamports: number;
  }>;

export type EarnIncome = Readonly<{
  position: PositionView;
  /** Whether the price stands inside any of the position's ranges: only then does it earn. */
  inRange: boolean;
  /** First line: the fees a collect would pay now, before the coins' own transfer fees. */
  fees: Readonly<{ xRaw: string; yRaw: string }>;
  /** Second line: the pool's rewards, a reward slot each — what the position's slots already show. */
  rewards: readonly Readonly<{ index: number; mint: Address; accruedRaw: string; running: boolean; endsAt: number }>[];
}>;

export type EarnCare = Readonly<{
  /** The wallet approved on the NFT's account, with nothing delegated — as the program asks; null — nobody. */
  delegate: Address | null;
  /** What the position lets a delegate do. */
  may: readonly PositionPermission[];
  /** `delegate` is the agent asked about, and it may do exactly what a care needs — no more. */
  cares: boolean;
}>;

export function createDlmmProEarn(context: DlmmProContext, venue: Readonly<{ pools: DlmmProPools; swap: DlmmProSwap; positions: DlmmProPositions }>) {
  const { connection } = context;

  /**
   * The share of the paid coin a shape needs turned into the other, parts of a million: what the ranges take of each
   * coin at the pool's price, the other coin's worth told in the paid one at that same price.
   */
  function otherShare(ranges: LiquidityRange[], pool: Readonly<{ sqrtPrice: BN; tickCurrentId: number }>, payingX: boolean): bigint {
    /* A multiplier large enough that the rounding of each range's amounts is lost in them. */
    const taken = amountsFromShape({ ranges, currentTickId: pool.tickCurrentId, currentSqrtPrice: pool.sqrtPrice, multiplier: new BN(1).shln(48) });
    const x = taken.reduce((sum, item) => sum + big(item.amountX), 0n);
    const y = taken.reduce((sum, item) => sum + big(item.amountY), 0n);
    /* Token Y's worth in X is y over the price; the price is the square of the square-root price over 2^128. */
    const square = big(pool.sqrtPrice) * big(pool.sqrtPrice);
    const yInX = (y << 128n) / square;
    const whole = x + yInX;
    if (whole === 0n) return 0n;
    return ((payingX ? yInX : x) * 1_000_000n) / whole;
  }

  /** A position from a goal — unsigned steps in the order they are sent; the wallet signs each, the fresh NFT key the opening. */
  async function open(request: EarnOpenRequest, options: SealOptions = {}): Promise<EarnOpenBuild> {
    return refusing(async () => {
      if (!isOpenGoal(request.goal) || !isEarnStyle(request.style)) throw new DlmmProRefusal("BAD_INPUT", "The goal is Even, Near price, Catch moves or a shape of one's own; the width Calm, Balanced or Dense.");
      const custom = request.goal === CUSTOM_GOAL;
      if (custom ? !isShapeColumns(request.columns) : request.columns !== undefined) throw new DlmmProRefusal("BAD_INPUT", "A shape of one's own is 32 columns of 0 to 8 cells, painted on both sides of the price; a goal takes none.");
      const planAt = (at: Readonly<{ tickSpacing: number; tickCurrentId: number }>) => {
        const plan = openPlanOf(request.goal, request.style, at, custom ? request.columns! : null);
        /* Never coarsened behind the person's back: a shape that needs more ranges than a position of one's own takes is refused, as the ticket said. */
        if (plan && custom && (plan.ranges ?? Infinity) > CUSTOM_MAX_RANGES) throw new DlmmProRefusal("BAD_INPUT", `This shape needs ${plan.ranges} ranges; a shape of one's own takes at most ${CUSTOM_MAX_RANGES}.`);
        return plan;
      };
      /*
       * A shape of one's own opens together with its deposit, in one transaction: an opening sent apart from its deposit
       * is left empty — its rent held — when the price leaves the band between the two. Its ranges are held to what fits.
       */
      const oneOpening = (transactions: number) => {
        if (custom && transactions > 1) throw new DlmmProRefusal("TX_TOO_LARGE", "A shape of one's own opens with its deposit in one transaction; this one does not fit.");
      };
      const poolKey = keyOf(request.pool, "The pool");
      const asked = bpsOf(request.slippageBps, "The band of the price", 0, MAX_EARN_BAND_BPS);
      const { pool } = await poolWhole(context, poolKey);
      const blockhash = options.blockhash ?? (await connection.getLatestBlockhash("confirmed"));
      const shared: SealOptions = { ...options, blockhash };

      if ("mint" in request.pay) {
        const payMint = keyOf(request.pay.mint, "The coin paid in");
        const payingX = payMint.equals(pool.tokenXMint);
        if (!payingX && !payMint.equals(pool.tokenYMint)) throw new DlmmProRefusal("BAD_INPUT", "The coin paid in is not one of the pool's two.");
        const amount = rawOf(request.pay.amountRaw, "The amount");
        if (amount === 0n) throw new DlmmProRefusal("AMOUNT_ZERO", "The amount is zero.");
        /* The split is read at the pool's price now; the opening itself is built at the price the swap ends at. */
        const first = planAt(pool);
        if (!first) throw new DlmmProRefusal("BAD_INPUT", "The pool's price stands too close to the program's last tick for a range around it.");
        const share = otherShare(shapeOf(first.shape, pool, first.maxRanges, "ranges").ranges, pool, payingX);
        const swapIn = (amount * share) / 1_000_000n;
        if (swapIn === 0n || swapIn >= amount) throw new DlmmProRefusal("AMOUNT_ZERO", "The amount is too small to stand on both sides of the price.");
        const sizing = sizedAtLanding(first) ? "landing" : "band";
        const bandShare = sizing === "landing" ? GOAL_BAND_SHARE_AT_LANDING : GOAL_BAND_SHARE;
        const band = goalBandBps(first, asked, bandShare);
        const swap = await venue.swap.build({ pool: request.pool, inputMint: payMint.toBase58(), amountInRaw: swapIn.toString(), slippageBps: band, wallet: request.wallet }, shared);
        const after = { tickSpacing: pool.tickSpacing, tickCurrentId: tickIdFromSqrtPrice(new BN(swap.quote.sqrtPriceAfterX64)) };
        const plan = planAt(after);
        if (!plan) throw new DlmmProRefusal("BAD_INPUT", "The pool's price stands too close to the program's last tick for a range around it.");
        const bandBps = goalBandBps(plan, asked, bandShare);
        const left = amount - swapIn;
        const opened = await venue.positions.open(
          {
            pool: request.pool,
            wallet: request.wallet,
            nftMint: request.nftMint,
            shape: plan.shape,
            /* The other coin's budget is the least the swap pays: what is surely there when the deposit lands. */
            amountXRaw: (payingX ? left : BigInt(swap.quote.minimumOutRaw)).toString(),
            amountYRaw: (payingX ? BigInt(swap.quote.minimumOutRaw) : left).toString(),
            slippageBps: bandBps,
            maxRanges: plan.maxRanges,
            sizing,
            ahead: {
              sqrtPriceX64: swap.quote.sqrtPriceAfterX64,
              tickId: after.tickCurrentId,
              spendsXRaw: payingX ? swapIn.toString() : "0",
              spendsYRaw: payingX ? "0" : swapIn.toString(),
              bringsXRaw: payingX ? "0" : swap.quote.minimumOutRaw,
              bringsYRaw: payingX ? swap.quote.minimumOutRaw : "0",
              /* The rent of an account the swap opens is the opening's own reckoning too — both read the wallet as it is now — so only the swap's fee is added. */
              lamports: swap.feeLamports,
            },
          },
          shared,
        );
        oneOpening(opened.packed.length);
        const steps = [{ ...txOf(swap), roles: ["SWAP"] as readonly EarnRole[] }, ...opened.packed.map((step) => ({ ...txOf(step), roles: step.roles as readonly EarnRole[] }))];
        return {
          steps,
          plan,
          bandBps,
          swap: {
            inputMint: swap.quote.inputMint,
            outputMint: swap.quote.outputMint,
            amountInRaw: swap.quote.amountInRaw,
            expectedOutRaw: swap.quote.amountOutRaw,
            minimumOutRaw: swap.quote.minimumOutRaw,
            feeMint: swap.quote.fee.mint,
            feeRaw: swap.quote.fee.totalRaw,
            feeBps: swap.quote.fee.bps,
            referral: swap.quote.referral,
          },
          position: opened.position,
          nftMint: opened.nftMint,
          shape: opened.shape,
          deposit: opened.deposit,
          feeLamports: steps.reduce((sum, step) => sum + step.feeLamports, 0),
          /* A wrapped-SOL account each step opens and closes is put up twice, one after the other; what stays is the opening's reckoning. */
          rentLamports: opened.rentLamports,
          rentReturnedLamports: opened.rentReturnedLamports,
          unwrapsLamports: opened.unwrapsLamports ?? swap.unwrapsLamports,
        };
      }

      const plan = planAt(pool);
      if (!plan) throw new DlmmProRefusal("BAD_INPUT", "The pool's price stands too close to the program's last tick for a range around it.");
      const sizing = sizedAtLanding(plan) ? "landing" : "band";
      const bandBps = goalBandBps(plan, asked, sizing === "landing" ? GOAL_BAND_SHARE_AT_LANDING : GOAL_BAND_SHARE);
      const opened = await venue.positions.open(
        { pool: request.pool, wallet: request.wallet, nftMint: request.nftMint, shape: plan.shape, amountXRaw: request.pay.amountXRaw, amountYRaw: request.pay.amountYRaw, slippageBps: bandBps, maxRanges: plan.maxRanges, sizing },
        shared,
      );
      oneOpening(opened.packed.length);
      const steps = opened.packed.map((step) => ({ ...txOf(step), roles: step.roles as readonly EarnRole[] }));
      return {
        steps,
        plan,
        bandBps,
        swap: null,
        position: opened.position,
        nftMint: opened.nftMint,
        shape: opened.shape,
        deposit: opened.deposit,
        feeLamports: steps.reduce((sum, step) => sum + step.feeLamports, 0),
        rentLamports: opened.rentLamports,
        rentReturnedLamports: opened.rentReturnedLamports,
        unwrapsLamports: opened.unwrapsLamports,
      };
    });
  }

  /** What a position has earned, in two lines, and whether it is earning now. */
  async function income(request: Readonly<{ pool: Address; nftMint: Address }>, known: DlmmProPool | null = null): Promise<EarnIncome> {
    return refusing(async () => {
      const [position, pool] = await Promise.all([venue.positions.read(request), known ? Promise.resolve(known) : venue.pools.read(request.pool)]);
      if (!pool) throw new DlmmProRefusal("NO_POOL", "No DLMM Pro pool lives at this address.");
      const rewards = pool.rewards.map((reward) => ({
        index: reward.index,
        mint: reward.mint,
        accruedRaw: position.slots.reduce((sum, slot) => sum + BigInt(slot.rewardsAccruedRaw[reward.index] ?? "0"), 0n).toString(),
        running: reward.running,
        endsAt: reward.endsAt,
      }));
      return { position, inRange: position.slots.some((slot) => slot.inRange && slot.liquidity !== "0"), fees: { xRaw: position.feeXRaw, yRaw: position.feeYRaw }, rewards };
    });
  }

  /** Who is approved on a position's NFT and what the position lets them do — and whether that is `agent` with a care's rights. */
  async function care(request: Readonly<{ pool: Address; nftMint: Address; owner: Address; agent: Address | null }>): Promise<EarnCare> {
    return refusing(async () => {
      const nftMint = keyOf(request.nftMint, "The position's NFT");
      const owner = keyOf(request.owner, "The owner");
      const [info, position] = await Promise.all([connection.getAccountInfo(findNftAccount(nftMint, owner), "confirmed"), venue.positions.read({ pool: request.pool, nftMint: request.nftMint })]);
      const data = info && info.data.length >= DELEGATED_AMOUNT_OFFSET + 8 ? Buffer.from(info.data) : null;
      if (!data || data.readBigUInt64LE(64) !== 1n) throw new DlmmProRefusal("BAD_INPUT", "The wallet does not hold the NFT of the position.");
      /* A delegate with an amount delegated is one the program refuses: it is told as nobody. */
      const approved = data.readUInt32LE(DELEGATE_OFFSET) === 1 && data.readBigUInt64LE(DELEGATED_AMOUNT_OFFSET) === 0n;
      const delegate = approved ? new PublicKey(data.subarray(DELEGATE_OFFSET + 4, DELEGATE_OFFSET + 36)).toBase58() : null;
      const may = position.delegateMay;
      /* Exactly a care's rights: one with more — adding, changing ranges — is another approval, not a care. */
      return { delegate, may, cares: delegate !== null && delegate === request.agent && may.length === CARE_RIGHTS.length && CARE_RIGHTS.every((right) => may.includes(right)) };
    });
  }

  /** The one approval of a care: `agent` may collect the fees and the rewards and take the liquidity out — each only to the owner. */
  const approveCare = (request: Readonly<{ nftMint: Address; owner: Address; agent: Address }>, options: SealOptions = {}): Promise<DlmmProBuild> =>
    venue.positions.delegate({ nftMint: request.nftMint, owner: request.owner, delegate: request.agent, may: CARE_RIGHTS }, options);

  /** Takes the care back: the approval and every right, in one transaction. */
  const endCare = (request: Readonly<{ nftMint: Address; owner: Address }>, options: SealOptions = {}): Promise<DlmmProBuild> =>
    venue.positions.delegate({ nftMint: request.nftMint, owner: request.owner, delegate: null }, options);

  return { open, income, care, approveCare, endCare };
}

/** A build's transaction alone, without what it tells of its rent. */
function txOf(build: DlmmProTx): DlmmProTx {
  return { network: build.network, wireBase64: build.wireBase64, validUntil: build.validUntil, cosigners: build.cosigners, units: build.units, bytes: build.bytes, feeLamports: build.feeLamports };
}

export type DlmmProEarn = ReturnType<typeof createDlmmProEarn>;
