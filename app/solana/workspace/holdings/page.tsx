import { AskRynLens } from "@/app/app/lens/ask-ryn-lens";
import { LensPanel } from "@/app/app/lens/lens-panel";

import { PageHead } from "../hub/parts.tsx";
import { solanaServerLocale, solanaServerText } from "../i18n/server.ts";
import { HoldingsCard } from "./holdings-card.tsx";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function generateMetadata() {
  const { text } = await solanaServerText();
  /* The tab's name is the page's name: H1 and the menu both say «Portfolio / Портфель», and the tab said
     «Holdings · Ryntra» / «Активи портфеля · Ryntra» — the audit's pair 21 (UX-976), found by the live-word
     guard on the page itself. */
  return { title: text("Portfolio") };
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
      {/* Portfolio's four, one tap apart: the positions, Strategies, Results, History. */}
      {/* Ask Ryntra about the portfolio: what changed, which positions have a plan, what needs attention — opens the Brief below, the conversation one press further. */}
      <PageHead title="Portfolio" aside={<AskRynLens subject={{ kind: "portfolio" }} locale={locale} />} />
      <section aria-label={text("Portfolio")}>
        {/* One version: the empty states speak to a beginner, for everyone. */}
        <HoldingsCard />
      </section>
      {/* The Brief on the portfolio, and the Critic on request — closed until *Ask Ryn* is pressed. */}
      <LensPanel subject={{ kind: "portfolio" }} locale={locale} trigger="page" />
      {/* The paper predictions section left with the demo: its component stays in `app/app/predictions/paper-portfolio`. */}
    </>
  );
}
