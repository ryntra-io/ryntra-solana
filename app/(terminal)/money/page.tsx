import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { payoutFeeSetting } from "@/lib/privacy/payouts/fee";
import { MoneyScreen } from "@/terminal/money/MoneyScreen";
import { shelfOn } from "@/terminal/shell/shelves";

import { buildTerminalMetadata } from "../../seo";

export const metadata: Metadata = buildTerminalMetadata({ name: "Money", path: "/money", index: false });

/* «Money»: everything a person sends and receives — «Send», «Receive» and «Invoices» as tabs of
   one page (`?tab=receive`, `?tab=invoices`), «Recent transfers» beside them. It stands where the Portfolio's shelf
   does (`/money` is that shelf's own address too); with the terminal's switch closed the address answers 404.
   Ryntra's fee on private payouts is a server setting (`RYNTRA_PRIVATE_PAYOUT_FEE_BPS` and its address), read
   here and handed to «Payouts» as a rate and an address — nothing else of the server crosses. */
export default function Page() {
  if (!shelfOn("portfolio")) notFound();
  return <MoneyScreen payoutFee={payoutFeeSetting(process.env)} />;
}
