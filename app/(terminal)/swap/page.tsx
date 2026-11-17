import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { shelfOn } from "@/terminal/shell/shelves";
import { SwapScreen } from "@/terminal/swap/SwapScreen";

import { buildTerminalMetadata } from "../../seo";

export const metadata: Metadata = buildTerminalMetadata({ name: "Swap", path: "/swap" });

/* The Swap shelf: one card in the middle with its tabs — Swap · Limit · Bridge · Send, `?tab=` naming one — and under
   it the pair's coins, the popular ones and the wallet's recent swaps and transfers. The frame around it —
   the rail, the agent's line, the wallet, the phone's tabs — is the terminal's layout; with the switch closed the
   address answers 404, as every address of the terminal does. */
export default function Page() {
  if (!shelfOn("swap")) notFound();
  return <SwapScreen />;
}
