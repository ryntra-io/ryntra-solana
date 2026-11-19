import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { MoneyScreen } from "@/terminal/money/MoneyScreen";
import { shelfOn } from "@/terminal/shell/shelves";

import { buildTerminalMetadata } from "../../seo";

export const metadata: Metadata = buildTerminalMetadata({ name: "Money", path: "/money", index: false });

/* «Money»: everything a person sends and receives — «Send», «Receive» and «Invoices» as tabs of
   one page (`?tab=receive`, `?tab=invoices`), «Recent transfers» beside them. It stands where the Portfolio's shelf
   does (`/money` is that shelf's own address too); with the terminal's switch closed the address answers 404. */
export default function Page() {
  if (!shelfOn("portfolio")) notFound();
  return <MoneyScreen />;
}
