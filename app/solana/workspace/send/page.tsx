import { PanelGrid } from "@/app/shell/panel";
import { PageHead } from "../hub/parts.tsx";
import { solanaServerText } from "../i18n/server.ts";
import { SendCard } from "./send-card.tsx";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function generateMetadata() {
  const { text } = await solanaServerText();
  return { title: text("Send") };
}

/**
 * One real Solana transfer, with the signature where it belongs.
 *
 * The page is thin on purpose: everything here needs a wallet, and a wallet
 * only exists in a browser. What the server contributes are the three routes
 * the card calls — read holdings, build and judge, then submit, observe and
 * mint — none of which can sign anything.
 *
 * It carried a four-sentence lead until now, and that lead named an internal
 * task id, described the machinery in the machinery's own words, and asserted
 * a review-only boundary the code had already stopped enforcing. A paragraph
 * that is wrong is worse than no paragraph; a paragraph nobody reads is only
 * marginally better. The card says what it does.
 */
export default async function SolanaSendPage() {
  const { text } = await solanaServerText();
  return (
    <>
      <PageHead title="Send" />
      <div className="ry-money-flow"><PanelGrid label={text("Send")}>
        <SendCard />
      </PanelGrid></div>
    </>
  );
}
