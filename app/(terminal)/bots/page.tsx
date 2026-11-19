import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { BotsScreen } from "@/terminal/bots/BotsScreen";
import { botDoors, botsOpen } from "@/terminal/bots/kinds";
import { shelfOn } from "@/terminal/shell/shelves";

import { buildTerminalMetadata } from "../../seo";

export const metadata: Metadata = buildTerminalMetadata({ name: "Bots", path: "/bots" });

/* «Bots» itself: the catalogue of the bots that stand here — a card a bot, each opening the bot's
   own page. With the terminal's switch closed, or no bot open, the address answers 404. */
export default function Page() {
  if (!shelfOn("agents") || !botsOpen(botDoors()).length) notFound();
  return <BotsScreen bot={null} />;
}
