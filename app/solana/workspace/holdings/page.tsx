import { AskRynLens } from "@/app/app/lens/ask-ryn-lens";
import { LensPanel } from "@/app/app/lens/lens-panel";
import { PortfolioTabs } from "@/app/app/portfolio/portfolio-tabs";

import { PageHead } from "../hub/parts.tsx";
import { solanaServerLocale, solanaServerText } from "../i18n/server.ts";
import { HoldingsCard } from "./holdings-card.tsx";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function generateMetadata() {
  const { text } = await solanaServerText();
  return { title: text("Holdings") };
}

/**
 * Holdings — what the connected wallet owns.
 *
 * Thin for the same reason Send and Receive are: the answer depends entirely on
 * which wallet is connected, and that only exists in a browser. The server's
 * contribution is the balance read, which is public by address and therefore
 * needs no signature.
 */
export default async function SolanaHoldingsPage() {
  const { text } = await solanaServerText();
  const locale = await solanaServerLocale();
  return (
    <>
      {/* Portfolio's four, one tap apart: the positions, Strategies, Results, History (canon v5.3 В28). */}
      <PortfolioTabs locale={locale} />
      {/* Ask Ryntra about the portfolio: what changed, which positions have a plan, what needs attention (RYN-AGENT-TEXT-001) — opens the Brief below, the conversation one press further (RYN-FIRST-SCREEN-001). */}
      <PageHead title="Portfolio" aside={<AskRynLens subject={{ kind: "portfolio" }} locale={locale} />} />
      <section aria-label={text("Portfolio")}>
        {/* One version (canon v5.3 В28): the empty states speak to a beginner, for everyone. */}
        <HoldingsCard />
      </section>
      {/* The Brief on the portfolio, and the Critic on request (RYN-BRIEF-CRITIC-001) — closed until *Ask Ryn* is pressed (RYN-FIRST-SCREEN-001). */}
      <LensPanel subject={{ kind: "portfolio" }} locale={locale} trigger="page" />
      {/* The paper predictions section left with the demo (canon v5.4 В32): its component stays in `app/app/predictions/paper-portfolio`. */}
    </>
  );
}
