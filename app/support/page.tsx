import type { Metadata } from "next";
import { ArrowRight, Bug, ChatCircleText, ClockCounterClockwise, Lifebuoy, ListChecks, Receipt, ShieldWarning, WarningCircle } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";

import { pageCard } from "@/app/brand/page-card";
import { pageCardImage } from "@/app/seo";
import { SitePageGraph } from "@/app/site/page-graph";
import { sitePageMetadata } from "@/app/site/seo";
import { ORGANIZATION_ID } from "@/lib/site/structured-data";
import { Checks, InfoBlock, InfoHero, InfoPage, Panel, PrimaryAction, SecondaryAction, Tiles, infoStyles as s } from "@/app/site/info/info";
import { contactMailto } from "@/lib/site/contacts";
import { localizedPath } from "@/lib/site/localized";
import { publicServerLocale } from "@/lib/site/server-locale";

import { SUPPORT_PRIVACY_ANDROID, SUPPORT_TROUBLESHOOTING, supportCopy } from "./support-copy";

/*
 * «Підтримка» — how to get help with what production already has: the guides
 * that answer most questions, History with its receipts, the Android app's own
 * facts, and one inbox for the rest. Every store portal asks for a support
 * address beside the privacy policy; the Android app's listing names this one.
 * The letter is the page's own action — the one orange on the screen — so the
 * header's «Open the app» steps back, as on `/contact`.
 */

export async function generateMetadata(): Promise<Metadata> {
  const locale = await publicServerLocale();
  const { meta } = supportCopy(locale);
  return sitePageMetadata({
    path: "/support",
    title: meta.title,
    description: meta.description,
    keywords: ["ryntra support", "ryntra help", "ryntra android app"],
    locale,
    image: pageCardImage(locale, ["page", "support"], pageCard("support", locale)),
  });
}

const ANSWER_ICONS = [<Lifebuoy key="l" size={22} />, <ListChecks key="s" size={22} />, <ClockCounterClockwise key="h" size={22} />, <ChatCircleText key="q" size={22} />];
/* The same three the contact page draws for the same three subjects. */
const TOPIC_ICONS = [<Bug key="b" size={22} />, <Receipt key="r" size={22} />, <ShieldWarning key="s" size={22} />];

export default async function SupportPage() {
  const locale = await publicServerLocale();
  const copy = supportCopy(locale);
  return (
    <InfoPage locale={locale} quietHeaderAction>
      <SitePageGraph type="WebPage" path="/support" locale={locale} name={copy.meta.title} description={copy.meta.description} extra={{ about: { "@id": ORGANIZATION_ID } }} />
      <InfoHero
        eyebrow={copy.hero.eyebrow}
        title={copy.hero.title}
        lead={copy.hero.lead}
        note={copy.hero.note}
        actions={
          <>
            <PrimaryAction href={contactMailto(copy.hero.subject)}>{copy.hero.write}</PrimaryAction>
            <SecondaryAction href={localizedPath(SUPPORT_TROUBLESHOOTING, locale)}>{copy.hero.guide}</SecondaryAction>
          </>
        }
      />

      <InfoBlock id="answers" eyebrow={copy.answers.eyebrow} title={copy.answers.title}>
        <Tiles items={copy.answers.items.map((item, index) => ({ title: item.title, body: item.body, href: localizedPath(item.href, locale), icon: ANSWER_ICONS[index] }))} />
      </InfoBlock>

      <InfoBlock id="android" eyebrow={copy.android.eyebrow} title={copy.android.title} lead={copy.android.lead}>
        <Panel>
          <Checks items={copy.android.items} />
          <p className={s.note}>
            <Link className={s.link} href={SUPPORT_PRIVACY_ANDROID} prefetch={false}>{copy.android.privacy}<ArrowRight size={16} aria-hidden /></Link>
          </p>
        </Panel>
      </InfoBlock>

      <InfoBlock id="write" eyebrow={copy.write.eyebrow} title={copy.write.title} lead={copy.write.lead}>
        <Tiles items={copy.write.topics.map((topic, index) => ({ title: topic.label, body: topic.body, href: contactMailto(topic.subject), icon: TOPIC_ICONS[index] }))} />
      </InfoBlock>

      <InfoBlock id="helps" eyebrow={copy.helps.eyebrow} title={copy.helps.title}>
        <Panel>
          <Checks items={copy.helps.items} />
          <p className={s.note}><WarningCircle className={s.cautionIcon} size={16} weight="bold" aria-hidden />{copy.helps.never}</p>
        </Panel>
      </InfoBlock>
    </InfoPage>
  );
}
