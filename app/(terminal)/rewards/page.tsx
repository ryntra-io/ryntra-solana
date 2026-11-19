import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { RewardsScreen } from "@/terminal/rewards/RewardsScreen";
import { REWARDS_PATH, shelfOn } from "@/terminal/shell/shelves";

import { buildTerminalMetadata } from "../../seo";

export const metadata: Metadata = buildTerminalMetadata({ name: "Rewards", path: REWARDS_PATH, index: false });

/* «Rewards» — the menu's last group as one page: points, level, rank and cashback; the link to invite a friend and what
   friends brought. A page of the Portfolio shelf (its own figures are a wallet's): with the shelf off, or the switch
   closed, the address answers 404 and the city's own redirect keeps leading where it did. */
export default function Page() {
  if (!shelfOn("portfolio")) notFound();
  return <RewardsScreen />;
}
