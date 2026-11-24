import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { privateNetwork } from "@/lib/privacy/network";
import { PayScreen } from "@/terminal/money/private/PayScreen";
import { shelfOn } from "@/terminal/shell/shelves";

import { buildTerminalMetadata } from "../../../seo";

export const metadata: Metadata = buildTerminalMetadata({ name: "Invoice", path: "/private/pay", index: false });

/* A private invoice's page: the invoice rides in the `#fragment`, which never reaches the server — the page
   is the same for every invoice and holds nothing of one. With the private balance shut (`NEXT_PUBLIC_RYNTRA_PRIVATE`)
   or the Portfolio shelf off the address answers 404. */
export default function Page() {
  if (!privateNetwork() || !shelfOn("portfolio")) notFound();
  return <PayScreen />;
}
