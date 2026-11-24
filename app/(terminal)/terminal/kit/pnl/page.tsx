import { notFound } from "next/navigation";

import { kitOpen } from "@/terminal/shell/flag";
import { PnlStand } from "@/terminal/portfolio/pnl/PnlStand";

/* The Portfolio's «Result» in every state, for the eyes on a stand only
   (`NEXT_PUBLIC_RYNTRA_TERMINAL=stand`). People never see it. */
export default function Page() {
  if (!kitOpen()) notFound();
  return <PnlStand />;
}
