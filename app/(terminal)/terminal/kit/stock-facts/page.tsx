import { notFound } from "next/navigation";

import { kitOpen } from "@/terminal/shell/flag";
import { StockFactsStand } from "@/terminal/stocks/StockFactsStand";

/* A stock's facts as the pool page will show them, for the eyes on a stand only
   (`NEXT_PUBLIC_RYNTRA_TERMINAL=stand`). People never see it. */
export default function Page() {
  if (!kitOpen()) notFound();
  return <StockFactsStand />;
}
