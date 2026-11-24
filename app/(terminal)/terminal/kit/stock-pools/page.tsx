import { notFound } from "next/navigation";

import { kitOpen } from "@/terminal/shell/flag";
import { StockPoolsStand } from "@/terminal/stocks/pools/StockPoolsStand";

/* A stock's pools as its page will show them, on the recorded reads, for the eyes on a stand only
   (`NEXT_PUBLIC_RYNTRA_TERMINAL=stand`). People never see it. */
export default function Page() {
  if (!kitOpen()) notFound();
  return <StockPoolsStand />;
}
