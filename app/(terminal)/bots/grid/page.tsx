import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { GridScreen } from "@/terminal/bots/GridScreen";
import { botDoors, botOpen } from "@/terminal/bots/kinds";
import { shelfOn } from "@/terminal/shell/shelves";

import { buildTerminalMetadata } from "../../../seo";

export const metadata: Metadata = buildTerminalMetadata({ name: "Grid bot", path: "/bots/grid" });

/* A bot's own page in «Bots»: the frame around it is the terminal's layout. The Grid is a terminal with a
   chart — its page is a desk. It stands on the Agents shelf while this bot's engine runs here; otherwise, and
   with the terminal's switch closed, the address answers 404. */
export default function Page() {
  if (!shelfOn("agents") || !botOpen("grid", botDoors())) notFound();
  return <GridScreen />;
}
