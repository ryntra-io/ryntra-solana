import type { Metadata } from "next";
import { Bug, Receipt, ShieldWarning, WarningCircle } from "@phosphor-icons/react/dist/ssr";

import { pageCard } from "@/app/brand/page-card";
import { pageCardImage } from "@/app/seo";
import { SitePageGraph } from "@/app/site/page-graph";
import { sitePageMetadata } from "@/app/site/seo";
import { ORGANIZATION_ID } from "@/lib/site/structured-data";
import { Checks, InfoBlock, InfoHero, InfoPage, LinkRow, Panel, PrimaryAction, SecondaryAction, Tiles, infoStyles as s } from "@/app/site/info/info";
import { PRIMARY_CONTACT_ACTIONS, contactMailto } from "@/lib/site/contacts";
import { publicServerLocale } from "@/lib/site/server-locale";

import { contactCopy } from "./contact-copy";

/*
 * «Контакти» — one inbox, three subjects that sort it, what helps an answer
 * and what never to send. The page's own action — the letter — is the one
 * orange on the screen, so the header's «Open the app» steps back. Every
 * address comes from `lib/site/contacts.ts`, the one place that knows them.
 */

export async function generateMetadata(): Promise<Metadata> {
  const locale = await publicServerLocale();
  const { meta } = contactCopy(locale);
  return sitePageMetadata({
    path: "/contact",
    title: meta.title,
    description: meta.description,
    keywords: ["contact ryntra", "ryntra support", "ryntra security"],
    locale,
    image: pageCardImage(locale, ["page", "contact"], pageCard("contact", locale)),
  });
}

const TOPIC_ICONS = [<Bug key="b" size={22} />, <Receipt key="r" size={22} />, <ShieldWarning key="s" size={22} />];

export default async function ContactPage() {
  const locale = await publicServerLocale();
  const copy = contactCopy(locale);
  /* The two ways the owner fixed — the letter and the company's X — their addresses from the contacts module. */
  const [email, x] = PRIMARY_CONTACT_ACTIONS;
  return (
    <InfoPage locale={locale} quietHeaderAction>
      <SitePageGraph type="ContactPage" path="/contact" locale={locale} name={copy.meta.title} description={copy.meta.description} extra={{ mainEntity: { "@id": ORGANIZATION_ID } }} />
      <InfoHero
        eyebrow={copy.hero.eyebrow}
        title={copy.hero.title}
        lead={copy.hero.lead}
        actions={
          <>
            <PrimaryAction href={email.href}>{copy.hero.email}</PrimaryAction>
            <SecondaryAction href={x.href} external>{copy.hero.x}</SecondaryAction>
          </>
        }
      />

      <InfoBlock id="topics" eyebrow={copy.topics.eyebrow} title={copy.topics.title}>
        <Tiles items={copy.topics.items.map((topic, index) => ({ title: topic.label, body: topic.body, href: contactMailto(topic.subject), icon: TOPIC_ICONS[index] }))} />
      </InfoBlock>

      <InfoBlock id="send" eyebrow={copy.send.eyebrow} title={copy.send.title}>
        <Panel>
          <Checks items={copy.send.items} />
          <p className={s.note}><WarningCircle className={s.cautionIcon} size={16} weight="bold" aria-hidden />{copy.send.never}</p>
        </Panel>
      </InfoBlock>

      <InfoBlock id="more" title={copy.more.title}>
        <LinkRow locale={locale} links={copy.more.links} />
      </InfoBlock>
    </InfoPage>
  );
}
