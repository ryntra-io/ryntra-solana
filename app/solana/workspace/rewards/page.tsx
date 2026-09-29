import { PageHead } from "../hub/parts.tsx";
import { MoneyTabs } from "../money/money-tabs.tsx";
import { solanaServerText } from "../i18n/server.ts";
import { RewardsCard } from "./rewards-card.tsx";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function generateMetadata() {
  const { text } = await solanaServerText();
  return { title: text("Rewards") };
}

/**
 * Rewards — thin on the server, like the other two Money pages.
 *
 * Everything on it is scoped to a wallet that has proved it owns itself, and
 * proof lives in a cookie the client route reads on its own behalf. Rendering
 * any of it here would either leak a balance into a cached document or force a
 * per-request read for a page that is about to fetch anyway.
 *
 * No `PanelGrid` and no `ry-money-flow` wrapper: the first drew a titled
 * panel around a page that already has a title, the second narrows a surface
 * to one form column. Rewards is a canvas the way the Portfolio is — the
 * card lays out its own two columns and takes the grid's width.
 */
export default async function SolanaRewardsPage() {
  const { text } = await solanaServerText();
  return (
    <>
      <PageHead title="Rewards" />
      <MoneyTabs current="rewards" />
      <section aria-label={text("Rewards")}>
        <RewardsCard />
      </section>
    </>
  );
}
