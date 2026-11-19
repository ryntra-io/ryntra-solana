import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { BotsScreen } from "@/terminal/bots/BotsScreen";
import { botDoors, botOpen } from "@/terminal/bots/kinds";
import { shelfOn } from "@/terminal/shell/shelves";

import { buildTerminalMetadata } from "../../../seo";

export const metadata: Metadata = buildTerminalMetadata({ name: "Order ladder", path: "/bots/ladder" });

/* A bot's own page in «Bots»: the frame around it is the terminal's layout. It stands on the Agents shelf
   while this bot's engine runs here; otherwise, and with the terminal's switch closed, the address answers 404. */
export default function Page() {
  if (!shelfOn("agents") || !botOpen("ladder", botDoors())) notFound();
  return <BotsScreen bot="ladder" />;
}
