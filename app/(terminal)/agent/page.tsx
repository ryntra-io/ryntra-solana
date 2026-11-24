import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AgentsScreen } from "@/terminal/agents/AgentsScreen";
import { ScoutScreen } from "@/terminal/agents/scout/ScoutScreen";
import { TraderScreen } from "@/terminal/agents/TraderScreen";
import { shelfOn } from "@/terminal/shell/shelves";

import { buildTerminalMetadata } from "../../seo";

export const metadata: Metadata = buildTerminalMetadata({ name: "Agents", path: "/agent" });

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/* The Agents shelf: «Say what to do», the agents a person hires, the agents at work, and the new agent's card;
   `?ai=scout` — the Scout, the agent that finds new coins by itself; `?ai=trader` — the AI trader's plan. The frame around it — the rail, the header's line,
   the wallet, the phone's tabs — is the terminal's layout; with the switch closed the address answers 404, as every
   address of the terminal does. */
export default async function Page({ searchParams }: Props) {
  if (!shelfOn("agents")) notFound();
  const ai = (await searchParams).ai;
  if (ai === "scout") return <ScoutScreen />;
  if (ai === "trader") return <TraderScreen />;
  return <AgentsScreen />;
}
