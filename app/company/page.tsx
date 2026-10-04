import type { Metadata } from "next";
import { ArrowsClockwise, ChatCircleDots, Coins, FileText } from "@phosphor-icons/react/dist/ssr";

import { pageCard } from "@/app/brand/page-card";
import { pageCardImage } from "@/app/seo";
import { SitePageGraph } from "@/app/site/page-graph";
import { sitePageMetadata } from "@/app/site/seo";
import { ORGANIZATION_ID } from "@/lib/site/structured-data";
import { Checks, InfoBlock, InfoHero, InfoPage, LinkRow, Panel, Rows, Tiles, infoStyles as s } from "@/app/site/info/info";
import { CONTACTS, FOUNDER_ACTIONS } from "@/lib/site/contacts";
import { publicServerLocale } from "@/lib/site/server-locale";

import { companyCopy } from "./company-copy";

/*
 * «Про Ryntra» — who builds Ryntra, the rules it keeps and how it earns.
 * It was a page about a
 * trading platform with a plan until 2026-09-26, when `/company` led into the
 * app instead; it answers again in the words of the new site, English and Ukrainian by
 * the reader's language, every figure read from the policy the product
 * charges with (`company-copy.ts`).
 */

export async function generateMetadata(): Promise<Metadata> {
  const locale = await publicServerLocale();
  const { meta } = companyCopy(locale);
  return sitePageMetadata({
    path: "/company",
    title: meta.title,
    description: meta.description,
    keywords: ["about ryntra", "tokenized stocks from $1", "non-custodial"],
    locale,
    image: pageCardImage(locale, ["page", "company"], pageCard("company", locale)),
  });
}

const TILE_ICONS = [<Coins key="c" size={22} />, <ArrowsClockwise key="a" size={22} />, <FileText key="f" size={22} />, <ChatCircleDots key="r" size={22} />];

export default async function CompanyPage() {
  const locale = await publicServerLocale();
  const copy = companyCopy(locale);
  const founderLinks = FOUNDER_ACTIONS.map((action) => ({
    href: action.href,
    label: locale === "uk" && action.label === "Founder on X" ? "Засновник в X" : action.label,
    external: true,
  }));
  return (
    <InfoPage locale={locale}>
      <SitePageGraph type="AboutPage" path="/company" locale={locale} name={copy.meta.title} description={copy.meta.description} extra={{ mainEntity: { "@id": ORGANIZATION_ID } }} />
      <InfoHero eyebrow={copy.hero.eyebrow} title={copy.hero.title} lead={copy.hero.lead} />

      <InfoBlock id="what" eyebrow={copy.what.eyebrow} title={copy.what.title}>
        <Tiles items={copy.what.tiles.map((tile, index) => ({ ...tile, icon: TILE_ICONS[index] }))} />
      </InfoBlock>

      <InfoBlock id="rules" eyebrow={copy.rules.eyebrow} title={copy.rules.title}>
        <Panel><Checks items={copy.rules.items} /></Panel>
      </InfoBlock>

      <InfoBlock id="earns" eyebrow={copy.earns.eyebrow} title={copy.earns.title} lead={copy.earns.lead}>
        <Panel><Rows rows={copy.earns.rows} /></Panel>
      </InfoBlock>

      <InfoBlock id="who" eyebrow={copy.who.eyebrow} title={copy.who.title}>
        <Panel>
          <p className={s.statement}>{copy.who.founded} {CONTACTS.founder.name}</p>
          <LinkRow locale={locale} links={founderLinks} />
          <p className={s.note}>{copy.who.independent}</p>
          <p className={s.note}>{copy.who.open}</p>
          <LinkRow locale={locale} links={[{ href: "/developers", label: copy.who.openLink }]} />
        </Panel>
      </InfoBlock>

      <InfoBlock id="more" title={copy.more.title}>
        <LinkRow locale={locale} links={copy.more.links} />
      </InfoBlock>
    </InfoPage>
  );
}
