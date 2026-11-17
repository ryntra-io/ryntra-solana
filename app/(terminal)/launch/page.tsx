import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { LaunchScreen } from "@/terminal/launch/LaunchScreen";
import { shelfOn } from "@/terminal/shell/shelves";

import { buildTerminalMetadata } from "../../seo";

export const metadata: Metadata = buildTerminalMetadata({ name: "Launch", path: "/launch" });

/* The Launch shelf: a new coin's picture, name and ticker, how it starts trading, and one action. The frame around it —
   the rail, the header's line, the wallet, the phone's tabs — is the terminal's layout; with the switch closed the
   address answers 404, as every address of the terminal does. */
export default function Page() {
  if (!shelfOn("launch")) notFound();
  return <LaunchScreen />;
}
