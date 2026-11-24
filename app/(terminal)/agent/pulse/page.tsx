import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PulseScreen } from "@/terminal/agents/drive/PulseScreen";
import { shelfOn } from "@/terminal/shell/shelves";

import { buildTerminalMetadata } from "../../../seo";

export const metadata: Metadata = buildTerminalMetadata({ name: "Your agent", path: "/agent/pulse", index: false });

type Props = { searchParams: Promise<{ p?: string; x?: string; do?: string }> };

const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const CARD = /^[a-f0-9]{20}$/;

/* The agent's own page — where every note of its moves opens and «Stop» lands (`?p=` its mandate, `&x=` a closed
   trade's card, `&do=stop` from the message's «Stop»). A person's own page: never offered to the index. */
export default async function Page({ searchParams }: Props) {
  if (!shelfOn("agents")) notFound();
  const asked = await searchParams;
  const policy = typeof asked.p === "string" && ADDRESS.test(asked.p) ? asked.p : null;
  const card = typeof asked.x === "string" && CARD.test(asked.x) ? asked.x : null;
  return <PulseScreen key={policy ?? "none"} policy={policy} card={card} stop={asked.do === "stop"} />;
}
