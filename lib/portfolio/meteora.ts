/**
 * Meteora pools: DLMM, DAMM v2 and DLMM Pro positions, as positions of the portfolio.
 *
 * - **DLMM and DAMM v2** — every position the wallet holds on either program, whoever opened it, read from the programs'
 *   accounts by the engine's pools reader (`lib/liquidity/catalog/chain.server.ts` `readWalletPositions`, through the
 *   pinned Meteora SDKs): amounts and unclaimed fees in base units, rewards, the range against the price, the locked
 *   share. A position leaves in one step — all liquidity out, fees and rewards collected, closed (the engine's own
 *   remove and claim, `lib/liquidity/studio/`) — unless a part is locked (`LOCKED`, `partBps` what can leave).
 * - **DLMM Pro** — read only through earning's door (`lib/earn-pro/service.server.ts`: the venue's guard lets nothing
 *   else reach the program), so only where that surface is served, and only the positions at its piers — pools of SOL.
 *   Their worth is the program's own, in lamports; leaving is earning's own `leave` and `close`.
 *
 * Pure: the engine's reads in, positions out.
 */

import type { EarnProPier, EarnProPosition } from "../api/v1/contract.ts";
import type { LiquidityPosition } from "../liquidity/studio/contract.ts";
import { NATIVE_SOL_MINT, exitBlocked, exitWhole, refs, unitsOf, type PortfolioPosition, type PortfolioToken } from "./model.ts";

type Amount = LiquidityPosition["amounts"]["x"];

const DIGITS = /^\d+$/;
const amountOf = (amount: Amount): string => (DIGITS.test(amount.units) ? amount.units : "0");

function token(amount: Amount, role: PortfolioToken["role"], symbols: ReadonlyMap<string, string>): PortfolioToken {
  return { mint: amount.asset, symbol: symbols.get(amount.asset) ?? null, decimals: amount.decimals, amountRaw: amountOf(amount), usd: null, role };
}

const nonZero = (t: PortfolioToken): boolean => t.amountRaw !== null && t.amountRaw !== "0";

/** A DLMM or DAMM v2 position. `symbols` names the mints the caller knows; the rest are named by the prices read later. */
export function liquidityPosition(position: LiquidityPosition, symbols: ReadonlyMap<string, string> = new Map()): PortfolioPosition {
  const protocol = position.venue === "meteora-dlmm" ? "meteora-dlmm" : "meteora-damm-v2";
  const held = [token(position.amounts.x, "held", symbols), token(position.amounts.y, "held", symbols)];
  const fees = [token(position.unclaimedFees.x, "fee", symbols), token(position.unclaimedFees.y, "fee", symbols)].filter(nonZero);
  const rewards = position.unclaimedRewards.map((reward) => token(reward, "reward", symbols)).filter(nonZero);
  const locked = Math.max(0, Math.min(10_000, Math.round(position.lockedBps)));
  const label = held.every((t) => t.symbol) ? `${held[0]!.symbol}–${held[1]!.symbol}` : null;
  return {
    id: `${protocol}:${position.address}`,
    protocol,
    platform: null,
    kind: "pool",
    state: "read",
    origin: "chain",
    label,
    value: { usd: null, sol: null },
    earned: null,
    tokens: [...held, ...fees, ...rewards],
    inRange: position.rangeState === "in_range",
    exit: locked === 0 ? exitWhole("pool-withdraw") : exitBlocked("pool-withdraw", "LOCKED", { partBps: 10_000 - locked }),
    refs: refs({ program: position.source.program, pool: position.pool, position: position.address, nftMint: position.nftMint }),
    readAt: new Date(position.source.at).toISOString(),
  };
}

/**
 * The DLMM Pro program, named for the exit: the `address` of the program's IDL in the SDK the repository pins. The
 * engine's own constant sits behind the venue's guard, which lets nothing outside earning's door load it.
 */
export const DLMM_PRO_PROGRAM_ID = "dPro1D5wiqnGMH8vMDG23jh35btTHoWdyqXjqkqxe8n";

/**
 * A DLMM Pro position at a pier. Its worth and fees are the program's own, counted in SOL at the pool's price
 * (`lamports`); the pier names the two coins. Where the pier is not known, the worth in SOL still stands.
 */
export function dlmmProPosition(position: EarnProPosition, pier: EarnProPier | null, readAt: string, program: string = DLMM_PRO_PROGRAM_ID): PortfolioPosition | null {
  if (position.empty) return null;
  const sol = unitsOf(position.worth.lamports, 9);
  const feesSol = unitsOf(position.fees.lamports, 9);
  const tokens: PortfolioToken[] = [];
  if (pier) {
    const coin = (side: "x" | "y", raw: string, role: PortfolioToken["role"]): PortfolioToken => ({ mint: pier[side].mint, symbol: pier[side].symbol, decimals: pier[side].decimals, amountRaw: raw, usd: null, role });
    tokens.push(coin("x", position.worth.xRaw, "held"), coin("y", position.worth.yRaw, "held"));
    for (const [side, raw] of [["x", position.fees.xRaw], ["y", position.fees.yRaw]] as const) if (raw !== "0") tokens.push(coin(side, raw, "fee"));
  } else {
    tokens.push({ mint: NATIVE_SOL_MINT, symbol: "SOL", decimals: 9, amountRaw: position.worth.lamports, usd: null, role: "held" });
  }
  for (const reward of position.rewards) {
    if (reward.accruedRaw !== "0") tokens.push({ mint: reward.mint, symbol: reward.symbol, decimals: null, amountRaw: reward.accruedRaw, usd: null, role: "reward" });
  }
  return {
    id: `meteora-dlmm-pro:${position.nftMint}`,
    protocol: "meteora-dlmm-pro",
    platform: null,
    kind: "pool",
    state: "read",
    origin: "chain",
    label: pier ? `${pier.x.symbol}–${pier.y.symbol}` : null,
    /* The pool's own figures in SOL, the fees to collect with them: the portfolio counts the dollars from these, not from two prices that may disagree with the pool's. */
    value: { usd: null, sol: sol + feesSol },
    earned: feesSol > 0 ? { usd: null, sol: feesSol } : null,
    /* Without the pier, the held side is one figure in SOL: the dollars come from it, so it is not counted again from the coins. */
    tokens: pier ? tokens : tokens.map((t) => (t.role === "held" ? { ...t, role: "share" as const } : t)),
    inRange: position.inRange,
    exit: exitWhole("pool-withdraw"),
    refs: refs({ program, pool: position.pool, nftMint: position.nftMint }),
    readAt,
  };
}
