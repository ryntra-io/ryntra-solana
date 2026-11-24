import { notFound } from "next/navigation";

import { privateNetwork } from "@/lib/privacy/network";
import { kitOpen } from "@/terminal/shell/flag";
import { PrivateStockStand } from "@/terminal/stocks/private/PrivateStockStand";

/* A stock from the private balance and a pool's fees back into it, in every state, for the eyes on a stand only:
   `NEXT_PUBLIC_RYNTRA_TERMINAL=stand` and `NEXT_PUBLIC_RYNTRA_PRIVATE=devnet`. People never see it. */
export default function Page() {
  if (!kitOpen() || !privateNetwork()) notFound();
  return <PrivateStockStand />;
}
