import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AgentsScreen } from "@/terminal/agents/AgentsScreen";
import { shelfOn } from "@/terminal/shell/shelves";

import { buildTerminalMetadata } from "../../seo";

export const metadata: Metadata = buildTerminalMetadata({ name: "Agents", path: "/agent" });

/* The Agents shelf: «Say what to do», the agents a person hires, the agents at work, and the new agent's card. The
   frame around it — the rail, the header's line, the wallet, the phone's tabs — is the terminal's layout; with the
   switch closed the address answers 404, as every address of the terminal does. */
export default function Page() {
  if (!shelfOn("agents")) notFound();
  return <AgentsScreen />;
}
