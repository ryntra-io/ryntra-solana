import { readGuestProgrammeNow } from "@/lib/growth/guest-programme.server";

import { MoneyTabs } from "../money/money-tabs.tsx";
import { solanaServerText } from "../i18n/server.ts";
import { KitView } from "./kit-view.tsx";
import { partnerCopy } from "./partner-copy.ts";
import { PartnerView } from "./partner-view.tsx";
import { RewardsTabs } from "./rewards-tabs.tsx";
import styles from "./rewards.module.css";

/**
 * «Creator partners» and its media kit — thin on the server like the other
 * Rewards pages: the title, the Money tabs, the section's own tabs, and a
 * client view that reads its own data. The routes under
 * `app/app/rewards/partners/` re-export these.
 */

export async function partnersMetadata() {
  const { locale } = await solanaServerText();
  return { title: partnerCopy(locale).title };
}

export async function PartnersPage() {
  const { locale } = await solanaServerText();
  /* The share and whether partner payouts are open — the same for everybody, read once here (Ріст 19). */
  const programme = await readGuestProgrammeNow();
  return (
    /* The title, the tabs and the page in one column in the middle (Ріст 19). */
    <div className={styles.frameWide}>
      <header className="so-head">
        <h1 className="so-title">{partnerCopy(locale).title}</h1>
      </header>
      <MoneyTabs current="rewards" />
      <RewardsTabs current="partners" />
      <PartnerView fact={programme ? { percent: programme.partnerPercent, then: programme.partnerThen, paidAs: programme.partnerPaidAs } : null} />
    </div>
  );
}

export async function kitMetadata() {
  const { locale } = await solanaServerText();
  return { title: partnerCopy(locale).kitTitle };
}

export async function KitPage() {
  const { locale } = await solanaServerText();
  return (
    /* The title, the tabs and the page in one column in the middle (Ріст 19). */
    <div className={styles.frameWide}>
      <header className="so-head">
        <h1 className="so-title">{partnerCopy(locale).kitTitle}</h1>
      </header>
      <MoneyTabs current="rewards" />
      <RewardsTabs current="partners" />
      <KitView />
    </div>
  );
}
