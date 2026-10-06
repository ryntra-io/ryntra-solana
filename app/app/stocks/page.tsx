import { redirect } from "next/navigation";

/**
 * `/app/stocks` leads to «Ринки» on its «Акції» tab since the menu v6.2
 * (2026-10-06): one screener for every asset. A company's
 * page, `/app/stocks/<ticker>`, stays where it is. `next.config.ts` sends this
 * address first (`lib/product/customer-routing.ts`); the page answers the same.
 */
export default function StocksMovedToMarkets(): never {
  redirect("/app/markets?tab=stocks");
}
