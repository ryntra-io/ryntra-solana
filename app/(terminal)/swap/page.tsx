import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { flowLive } from "@/city/lib/money/flag";
import { SOLANA_NATIVE_SOL_MINT } from "@/lib/swap/catalog";
import { coinHref, shelfOn } from "@/terminal/shell/shelves";
import { BRIDGE_PATH, leaveOf } from "@/terminal/swap/leave";
import { SwapScreen } from "@/terminal/swap/SwapScreen";

import { buildTerminalMetadata } from "../../seo";

export const metadata: Metadata = buildTerminalMetadata({ name: "Swap", path: "/swap" });

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/* The Swap shelf: one big form in the middle — any coin for any coin — and under it the pair's two coins. The old tabs' addresses lead on in one step: `?tab=limit` to the coin's own page (the spot, where the limit
   is), `?tab=bridge` to the Bridge's page; `?tab=send` opens the Portfolio's transfer from the screen itself. The frame
   around it — the rail, the agent's line, the wallet, the phone's tabs — is the terminal's layout; with the switch
   closed the address answers 404, as every address of the terminal does. */
export default async function Page({ searchParams }: Props) {
  if (!shelfOn("swap")) notFound();
  const tab = (await searchParams).tab;
  const leave = leaveOf(typeof tab === "string" ? tab : null);
  if (leave === "coin" && shelfOn("market")) redirect(coinHref(SOLANA_NATIVE_SOL_MINT, "live"));
  if (leave === "bridge" && (flowLive("bridge") || flowLive("deposit"))) redirect(BRIDGE_PATH);
  return <SwapScreen />;
}
