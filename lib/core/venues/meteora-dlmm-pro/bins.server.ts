/**
 * A DLMM Pro pool's liquidity by price: the steps of its tick spacing around the price, each with what lies
 * on it of the two coins.
 *
 * DLMM Pro keeps no bins: a position is liquidity between two ticks, and a tick somebody stands on holds how much the
 * liquidity in range changes when the price crosses it (`liquidityNet`). So the read walks from the price both ways —
 * the pool's own liquidity in range where the price stands, plus each crossed tick's change going up, minus it going
 * down, exactly as the program's swap does — and asks the SDK what that liquidity holds of each coin on every step
 * (`getAmountsFromLiquidity`, rounded down like a withdrawal). Nothing is worked out here beyond that walk.
 *
 * Limit orders resting on a tick are not liquidity in range and are not part of a step's amounts.
 *
 * Read-only: one pool account, the mints' decimals and the tick arrays the steps fall in.
 */

import { PoolExtension, decodeTicksFromData, getAmountsFromLiquidity, isSupportExtension, tickArraysForTickIds, tickUiPrice } from "@meteora-ag/dlmm-pro-sdk";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

import type { Address } from "../../contracts.ts";
import { decimalsOf, poolWhole, type DlmmProContext } from "./pools.server.ts";
import { DlmmProRefusal, refusing } from "./sdk.server.ts";
import { MAX_TICK_ID, MIN_TICK_ID, alignTickDown, priceOfSqrtX64 } from "./ticks.ts";

/** The most steps one read walks each side of the price. */
export const MAX_STEPS_HALF = 70;

export type DlmmProStep = Readonly<{
  /** Steps from the one the price stands in: negative below, positive above. */
  offset: number;
  tickLowerId: number;
  tickUpperId: number;
  /** Token Y per token X in whole tokens at the step's lower tick. */
  price: number;
  /** What the liquidity in range holds on the step, base units. */
  xRaw: string;
  yRaw: string;
}>;

export type DlmmProSteps = Readonly<{
  pool: Address;
  tokenX: Readonly<{ mint: Address; decimals: number }>;
  tokenY: Readonly<{ mint: Address; decimals: number }>;
  tickSpacing: number;
  /** The tick the price stands at, and the lower tick of the step it stands in. */
  tickId: number;
  hereTickId: number;
  /** Token Y per token X in whole tokens, the pool's price now. */
  price: number;
  /** Ascending by `offset`; cut where the program's first or last tick ends the pool's prices. */
  steps: readonly DlmmProStep[];
}>;

/**
 * The liquidity in range on every step from `low` to `high` around the step the price stands in: the pool's own where
 * the price is, and each crossed tick's change added going up and taken off going down. A walk that comes out negative
 * — a tick array that did not read — is said as nothing on the step, never as a debt.
 */
export function walkLiquidity(here: number, spacing: number, low: number, high: number, inRange: BN, netOf: (tickId: number) => BN | undefined): Map<number, BN> {
  const zero = new BN(0);
  const out = new Map<number, BN>([[0, inRange]]);
  let up = inRange;
  for (let step = 1; step <= high; step += 1) {
    const net = netOf(here + step * spacing);
    if (net) up = up.add(net);
    out.set(step, up.isNeg() ? zero : up);
  }
  let down = inRange;
  for (let step = -1; step >= low; step -= 1) {
    const net = netOf(here + (step + 1) * spacing);
    if (net) down = down.sub(net);
    out.set(step, down.isNeg() ? zero : down);
  }
  return out;
}

export function createDlmmProBins(context: Pick<DlmmProContext, "connection" | "client">) {
  const { connection, client } = context;
  const programId = client.program.programId;

  /** The pool's steps around its price, `half` each side; a refusal when no DLMM Pro pool lives at the address. */
  async function around(address: Address, half: number): Promise<DlmmProSteps> {
    if (!Number.isInteger(half) || half < 1 || half > MAX_STEPS_HALF) throw new DlmmProRefusal("BAD_INPUT", `A read walks 1 to ${MAX_STEPS_HALF} steps each side of the price.`);
    let key: PublicKey;
    try {
      key = new PublicKey(address);
    } catch {
      throw new DlmmProRefusal("BAD_INPUT", "The pool is not an address.");
    }
    return refusing(async () => {
      const { pool } = await poolWhole(context, key);
      const spacing = pool.tickSpacing;
      const current = pool.tickCurrentId;
      const here = alignTickDown(current, spacing);
      /* The first tick a pool of this spacing can use, and the lower tick of its last step. */
      const first = Math.ceil(MIN_TICK_ID / spacing) * spacing;
      const last = Math.floor(MAX_TICK_ID / spacing) * spacing - spacing;
      const low = Math.max(-half, Math.ceil((first - here) / spacing));
      const high = Math.min(half, Math.floor((last - here) / spacing));

      /* Every tick the walk crosses: the lower tick of each step above the price, the upper tick of each below. */
      const crossed: number[] = [];
      for (let step = low + 1; step <= high; step += 1) crossed.push(here + step * spacing);
      const arrays = crossed.length ? tickArraysForTickIds(key, crossed, spacing, programId) : [];
      const [infos, decimals] = await Promise.all([arrays.length ? connection.getMultipleAccountsInfo(arrays, "confirmed") : Promise.resolve([]), decimalsOf(connection, [pool.tokenXMint, pool.tokenYMint])]);
      const decimalsX = decimals.get(pool.tokenXMint.toBase58())!;
      const decimalsY = decimals.get(pool.tokenYMint.toBase58())!;

      const withReward = isSupportExtension(pool.extensions, PoolExtension.LiquidityMining);
      const net = new Map<number, BN>();
      for (const info of infos) {
        if (!info || !info.owner.equals(programId)) continue;
        for (const tick of decodeTicksFromData(Buffer.from(info.data), withReward)) if (!tick.liquidityGross.isZero()) net.set(tick.tickId, tick.liquidityNet);
      }

      const liquidity = walkLiquidity(here, spacing, low, high, pool.liquidity, (tickId) => net.get(tickId));
      const steps: DlmmProStep[] = [];
      for (let step = low; step <= high; step += 1) {
        const tickLowerId = here + step * spacing;
        const tickUpperId = tickLowerId + spacing;
        const held = liquidity.get(step) ?? new BN(0);
        /* A negative liquidity asks for the amounts a withdrawal pays: rounded down. */
        const amounts = held.isZero() ? { amountX: new BN(0), amountY: new BN(0) } : getAmountsFromLiquidity({ tickCurrentId: current, tickLowerId, tickUpperId, currentSqrtPrice: pool.sqrtPrice, liquidity: held.neg() });
        steps.push({ offset: step, tickLowerId, tickUpperId, price: tickUiPrice(tickLowerId, decimalsX, decimalsY).toNumber(), xRaw: amounts.amountX.toString(), yRaw: amounts.amountY.toString() });
      }
      return {
        pool: key.toBase58(),
        tokenX: { mint: pool.tokenXMint.toBase58(), decimals: decimalsX },
        tokenY: { mint: pool.tokenYMint.toBase58(), decimals: decimalsY },
        tickSpacing: spacing,
        tickId: current,
        hereTickId: here,
        price: priceOfSqrtX64(BigInt(pool.sqrtPrice.toString()), decimalsX, decimalsY),
        steps,
      };
    });
  }

  return { around };
}

export type DlmmProBins = ReturnType<typeof createDlmmProBins>;
