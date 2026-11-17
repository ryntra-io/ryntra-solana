import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { MarketScreen } from "@/terminal/market/MarketScreen";
import { shelfOn } from "@/terminal/shell/shelves";

import { buildTerminalMetadata } from "../../seo";

export const metadata: Metadata = buildTerminalMetadata();

/* The Market: every coin of the market read, its moves, a sort by any column; a row opens the coin's own screen. The
   frame around it — the rail, the agent's line, the wallet, the market read — is the terminal's layout. */
export default function Page() {
  if (!shelfOn("market")) notFound();
  return <MarketScreen />;
}
