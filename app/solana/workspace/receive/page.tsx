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
 * token in words rather than in a mint address. Since B18 the card draws the
 * whole page — the heading once, the address or the request, and beside them
 * the payment requests and the latest incoming money (`../money/money-page.tsx`).
 */
export default function SolanaReceivePage() {
  return <ReceiveCard />;
}
