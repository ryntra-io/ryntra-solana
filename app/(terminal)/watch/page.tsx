import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { shelfOn } from "@/terminal/shell/shelves";
import { WatchScreen } from "@/terminal/watch/WatchScreen";

import { buildTerminalMetadata } from "../../seo";

export const metadata: Metadata = buildTerminalMetadata({ name: "Watch", path: "/watch", index: false });

/* «Watch» — the wallets a person watches and what they buy and sell, each trade with «Buy» on the coin's own page, and
   the coins' alerts («tell me when the price or the cap crosses X»). A page of the Market's shelf; with the switch
   closed the address answers 404, as every address of the terminal does. A person's own list: never offered to the
   index. */
export default function Page() {
  if (!shelfOn("market")) notFound();
  return <WatchScreen />;
}
