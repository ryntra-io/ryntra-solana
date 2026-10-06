import { PanelGrid } from "@/app/shell/panel";
import { PageHead } from "../hub/parts.tsx";
import { solanaServerText } from "../i18n/server.ts";
import { HistoryCard } from "./history-card.tsx";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function generateMetadata() {
  const { text } = await solanaServerText();
  return { title: text("History") };
}

/**
 * History — what this wallet did here.
 *
 * Thin for the same reason Holdings, Send and Receive are: the answer depends
 * entirely on which wallet is connected, and that only exists in a browser. The
 * server's contribution is the read, which is public by address and therefore
 * needs no signature.
 */
export default async function SolanaHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; filter?: string }>;
}) {
  const { text } = await solanaServerText();
  const query = await searchParams;
  const selected = query.action?.trim() || null;
  const filter = query.filter === "pending" ? "NEEDS_YOU" : "ALL";
  return (
    <>
      {/* History is Portfolio's: the shell draws its tabs, this one current. */}
      <PageHead title="History" />
      <PanelGrid label={text("History")}>
        <HistoryCard key={filter} selectedAction={selected} initialFilter={filter} />
      </PanelGrid>
      {/* The paper operations left with the demo: their component stays in `app/app/predictions/paper-history`. */}
    </>
  );
}
