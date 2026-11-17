import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PortfolioScreen } from "@/terminal/portfolio/PortfolioScreen";
import { shelfOn } from "@/terminal/shell/shelves";

import { buildTerminalMetadata } from "../../seo";

export const metadata: Metadata = buildTerminalMetadata({ name: "Portfolio", path: "/portfolio", index: false });

/* The Portfolio shelf — «Everything in Solana»: whatever a wallet holds across Solana, by its address alone or
   connected (`?owner=<address>` opens on a wallet, read only): the total with its parts, «Collect fees», «Exit
   everything» and «Clean wallet» on top, then pools, staking, deposits and loans, the agents, the coins and the dust.
   The frame around it — the rail, the agent's line, the wallet, the phone's tabs — is the terminal's layout; with the
   switch closed the address answers 404, as every address of the terminal does. */
export default function Page() {
  if (!shelfOn("portfolio")) notFound();
  return <PortfolioScreen />;
}
