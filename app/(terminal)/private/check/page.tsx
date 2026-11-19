import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { privateNetwork } from "@/lib/privacy/network";
import { WalletCheckScreen } from "@/terminal/portfolio/private/WalletCheckScreen";
import { shelfOn } from "@/terminal/shell/shelves";

import { buildTerminalMetadata } from "../../../seo";

export const metadata: Metadata = buildTerminalMetadata({ name: "Wallet check", path: "/private/check", index: false });

/* The wallet check for the private balance: the owner's hands, a test wallet, the test network. In no menu; with the
   private balance shut (`NEXT_PUBLIC_RYNTRA_PRIVATE`) or the Portfolio shelf off the address answers 404. */
export default function Page() {
  if (!privateNetwork() || !shelfOn("portfolio")) notFound();
  return <WalletCheckScreen />;
}
