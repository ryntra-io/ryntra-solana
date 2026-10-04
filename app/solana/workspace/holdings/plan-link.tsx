"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import type { TradingPlan, PlanListResponse } from "@/lib/api/v1/contract";

import styles from "./holdings.module.css";

/**
 * A holding's link to the plan it belongs to.
 *
 * Portfolio answers *what do I hold*; a plan answers *why*. Until now the two
 * did not meet on the page, so a person holding NVDAx had no way to reach the
 * plan they bought it under without remembering it existed.
 *
 * **No second calculation.** This reads the wallet's own plans — the same
 * list My strategies reads — and matches by mint. It computes no value, no
 * position and no result of its own: the chip is a door, and everything
 * behind it is computed once, on the server, by the plan's own service.
 *
 * The read needs the wallet's proof. A wallet that has not proved itself on
 * this page simply has no chips, which is correct: Portfolio is readable by
 * address and a plan is not.
 */
export function usePlansByMint(address: string | null): ReadonlyMap<string, readonly TradingPlan[]> {
  const [plans, setPlans] = useState<ReadonlyMap<string, readonly TradingPlan[]>>(new Map());

  useEffect(() => {
    if (!address) {
      setPlans(new Map());
      return;
    }
    let live = true;
    void (async () => {
      try {
        const response = await fetch("/api/v1/plans", { headers: { accept: "application/json", "X-Ryntra-API": "1" } });
        if (!response.ok) {
          /* Not proved, or the store did not answer: no chips, and nothing said about it on a page that is not about plans. */
          if (live) setPlans(new Map());
          return;
        }
        const body = (await response.json()) as PlanListResponse;
        const byMint = new Map<string, TradingPlan[]>();
        for (const plan of body.plans) {
          if (plan.status === "cancelled") continue;
          const list = byMint.get(plan.asset.mint) ?? [];
          list.push(plan);
          byMint.set(plan.asset.mint, list);
        }
        if (live) setPlans(byMint);
      } catch {
        if (live) setPlans(new Map());
      }
    })();
    return () => {
      live = false;
    };
  }, [address]);

  return plans;
}

/** The chip itself: one plan opens that plan, several open Results, where each is a row of its own. */
export function PlanLink({ plans, text }: { plans: readonly TradingPlan[]; text: (value: string) => string }) {
  if (plans.length === 0) return null;
  const only = plans.length === 1 ? plans[0] : null;
  const href = only ? `/app/strategies/plans/${only.id}` : "/app/results";
  const label = only ? text("Under a plan") : `${plans.length} ${text("plans")}`;
  return (
    <Link className={styles.planChip} href={href} prefetch={false} title={text("What you planned, and what actually happened")}>
      {label}
    </Link>
  );
}
