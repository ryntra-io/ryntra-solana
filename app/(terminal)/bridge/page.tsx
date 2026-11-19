import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { flowLive } from "@/city/lib/money/flag";
import { shelfOn } from "@/terminal/shell/shelves";
import { BridgeScreen } from "@/terminal/swap/BridgeScreen";

import { buildTerminalMetadata } from "../../seo";

export const metadata: Metadata = buildTerminalMetadata({ name: "Bridge", path: "/bridge" });

/* The Bridge: money between Solana and another network, both ways, on a page of its own in
   «Trade» — no longer a tab of the Swap. It stands where the Swap's shelf does and only while the engine lets money
   move between networks; otherwise, and with the terminal's switch closed, the address answers 404. */
export default function Page() {
  if (!shelfOn("swap") || !(flowLive("bridge") || flowLive("deposit"))) notFound();
  return <BridgeScreen />;
}
