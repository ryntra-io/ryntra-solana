import { solanaServerLocale } from "@/app/solana/workspace/i18n/server";

import { PortfolioView } from "./portfolio-view";

export const dynamic = "force-dynamic";
export const metadata = { title: "Predictions · Portfolio" };

/** The paper portfolio: the balance, the positions, the orders and the plans, all simulated. */
export default async function PredictionsPortfolioPage() {
  return <PortfolioView locale={await solanaServerLocale()} />;
}
