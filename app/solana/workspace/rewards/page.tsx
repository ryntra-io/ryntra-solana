import { redirect } from "next/navigation";

import { readGuestProgrammeNow } from "@/lib/growth/guest-programme.server";
import { refParamRedirect } from "@/lib/growth/ref-param";

import { PageHead } from "../hub/parts.tsx";
import { MoneyTabs } from "../money/money-tabs.tsx";
import { solanaServerText } from "../i18n/server.ts";
import { RewardsCard } from "./rewards-card.tsx";
import { RewardsTabs } from "./rewards-tabs.tsx";
import styles from "./rewards.module.css";

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
 * panel around a page that already has a title. The card sets its own column
 * — the core's action width, in the middle (Ріст 19).
 *
 * One thing is read here, because it is the same for everybody and belongs to no wallet: what the programme pays
 * under the rules in force and whether partner payouts are open (Ріст 19) — the guest's card, never a balance.
 */
export default async function SolanaRewardsPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  /* `?ref=CODE` here leads to the friend's page (`/r/<code>`) even before the address layer does it for every page. */
  const params = (await searchParams) ?? {};
  const asked = new URL("/app/rewards", "https://ryntra.invalid");
  for (const [name, value] of Object.entries(params)) for (const one of [value ?? []].flat()) asked.searchParams.append(name, one);
  const invited = asked.searchParams.has("ref") ? refParamRedirect(asked) : null;
  if (invited) redirect(`${invited.pathname}${invited.search}`);
  const { text } = await solanaServerText();
  const programme = await readGuestProgrammeNow();
  return (
    /* One column for the title, the tabs and the card — the core's action width, in the middle (Ріст 19). */
    <div className={styles.frameAction}>
      <PageHead title="Rewards" />
      <MoneyTabs current="rewards" />
      <RewardsTabs current="overview" />
      <section aria-label={text("Rewards")}>
        <RewardsCard programme={programme} />
      </section>
    </div>
  );
}
