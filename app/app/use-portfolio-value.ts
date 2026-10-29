"use client";

import { useMemo } from "react";

import { usePositions, type PositionsState } from "@/app/app/markets/pools/my-positions";
import { useWalletData } from "@/app/app/wallet-data";
import { useFuturesAccount, type Polled } from "@/app/solana/workspace/futures/use-futures-data";
import { useLimitOrders, type LimitOrdersRead } from "@/app/solana/workspace/spot/use-limit-orders";
import type { FuturesAccount } from "@/lib/phoenix/market-data";

import { portfolioValue, type PortfolioValue } from "./portfolio-value";

/** The Phoenix account read for its collateral: slower than «Perps», which reads it every ten seconds. */
export const COLLATERAL_POLL_MS = 30_000;

/**
 * «Вартість портфеля» for the connected wallet, from the four reads the
 * product already makes — the wallet's tokens (Portfolio's read), its Meteora
 * positions («Мої позиції» in Пули), its limit orders («Мої ордери» in
 * Spot) and its Phoenix account («Your Phoenix account» in Perps) —
 * through the one rule both Home and Portfolio draw (`portfolio-value.ts`).
 * The orders, positions and account it read come back with it, for a page that shows them.
 */
export function usePortfolioValue(owner: string | null): Readonly<{ value: PortfolioValue; limits: LimitOrdersRead; pools: PositionsState; phoenix: Polled<FuturesAccount> }> {
  const { holdings } = useWalletData();
  const limits = useLimitOrders(owner, 0);
  const pools = usePositions(owner);
  const read = useFuturesAccount(owner, COLLATERAL_POLL_MS);
  /* The last wallet's account never stands for the new one's. */
  const phoenix: Polled<FuturesAccount> = read.value && read.value.wallet !== owner ? { value: null, failed: false, loading: true } : read;
  const value = useMemo(
    () =>
      portfolioValue({
        wallet: { status: holdings.status, complete: holdings.complete, holdings: holdings.data },
        pools:
          pools.status === "ready"
            ? {
                status: "ready",
                values: pools.answer.positions.map((position) => position.valueUsd),
                complete: Object.values(pools.answer.venues).every((venue) => venue.ok),
              }
            : { status: pools.status, values: [], complete: true },
        orders: { status: limits.status, complete: limits.complete, orders: limits.orders, tokens: limits.tokens },
        /* A read that failed after a good one keeps the good one, as «Perps» does. */
        collateral: phoenix.value
          ? { status: "ready", state: phoenix.value.state, usd: phoenix.value.collateralUsd, sol: phoenix.value.collateralSol }
          : { status: phoenix.failed ? "failed" : "loading", state: null, usd: null, sol: null },
      }),
    [holdings, pools, limits.status, limits.complete, limits.orders, limits.tokens, phoenix.value, phoenix.failed],
  );
  return { value, limits, pools, phoenix };
}
