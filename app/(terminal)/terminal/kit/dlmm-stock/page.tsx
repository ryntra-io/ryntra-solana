import { notFound } from "next/navigation";

import { kitOpen } from "@/terminal/shell/flag";
import { DlmmStockStand } from "@/terminal/stocks/dlmm/DlmmStockStand";

/* The ticket of a stock's DLMM pool, two coins in, in its states, for the eyes on a stand only
   (`NEXT_PUBLIC_RYNTRA_TERMINAL=stand`). People never see it. */
export default function Page() {
  if (!kitOpen()) notFound();
  return <DlmmStockStand />;
}
