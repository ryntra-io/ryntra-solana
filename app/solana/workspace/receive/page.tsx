import { PanelGrid } from "@/app/shell/panel";
import { PageHead } from "../hub/parts.tsx";
import { MoneyTabs } from "../money/money-tabs.tsx";
import { solanaServerText } from "../i18n/server.ts";
import { ReceiveCard } from "./receive-card.tsx";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function generateMetadata() {
  const { text } = await solanaServerText();
  return { title: text("Receive") };
}

/**
 * Receive — thin, like Send, and for the same reason.
 *
 * Everything on it needs a wallet, and a wallet exists only in a browser. The
 * server contributes one read: what this address holds, so a request can name a
 * token in words rather than in a mint address.
 */
export default async function SolanaReceivePage() {
  const { text } = await solanaServerText();
  return (
    <>
      <PageHead title="Receive" />
      <MoneyTabs current="receive" />
      <div className="ry-money-flow"><PanelGrid label={text("Receive")}>
        <ReceiveCard />
      </PanelGrid></div>
    </>
  );
}
