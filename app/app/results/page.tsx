import { redirect } from "next/navigation";

/**
 * Since the menu v6.2 (2026-10-06) this address leads to
 * «Термінал → Автоінвест»: the recurring-buy rules and the plans with their results
 * live there. `next.config.ts` sends it first (`lib/product/customer-routing.ts`,
 * temporary); this page answers the same if that row is ever missed.
 */
export default function MovedToBots(): never {
  redirect("/app/bots");
}
