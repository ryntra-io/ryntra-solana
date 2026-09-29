import type { Metadata } from "next";

import { pageCard } from "@/app/brand/page-card";
import { pageCardImage } from "@/app/seo";
import { SitePageGraph } from "@/app/site/page-graph";
import { sitePageMetadata } from "@/app/site/seo";
import { Checks, InfoBlock, InfoHero, InfoPage, LinkRow, Panel, Rows, infoStyles as s } from "@/app/site/info/info";
import { publicServerLocale } from "@/lib/site/server-locale";

import { methodologyCopy } from "./methodology-copy";

/*
 * «Звідки цифри» — every figure a person sees in Ryntra, the source it is read
 * from and when (the new site of canon v5.5, `RYN-SITE-V5-001` subtask 3).
 * From 2026-08-19 this address was a permanent redirect into the handbook and
 * this directory held only the old summary's translations as data; it is a
 * page again, and those translations stay beside it (`content.ts`, `copy.ts`)
 * for the tests that hold them.
 */

export async function generateMetadata(): Promise<Metadata> {
  const locale = await publicServerLocale();
  const { meta } = methodologyCopy(locale);
  return sitePageMetadata({
    path: "/methodology",
    title: meta.title,
    description: meta.description,
    keywords: ["ryntra sources", "tokenized stock price source", "sec filings", "prestocks valuation"],
    locale,
    image: pageCardImage(locale, ["page", "methodology"], pageCard("methodology", locale)),
  });
}

export default async function MethodologyPage() {
  const locale = await publicServerLocale();
  const copy = methodologyCopy(locale);
  return (
    <InfoPage locale={locale}>
      <SitePageGraph type="WebPage" path="/methodology" locale={locale} name={copy.meta.title} description={copy.meta.description} />
      <InfoHero eyebrow={copy.hero.eyebrow} title={copy.hero.title} lead={copy.hero.lead} />

      {copy.groups.map((group) => (
        <InfoBlock id={group.id} title={group.title} key={group.id}>
          <Panel>
            <Rows rows={group.rows} head={[copy.head.figure, copy.head.source, copy.head.when]} />
          </Panel>
        </InfoBlock>
      ))}

      <InfoBlock id="rules" eyebrow={copy.rules.eyebrow} title={copy.rules.title}>
        <Panel><Checks items={copy.rules.items} /></Panel>
      </InfoBlock>

      <InfoBlock id="more" title={copy.more.title}>
        <div className={s.stack}><LinkRow locale={locale} links={copy.more.links} /></div>
      </InfoBlock>
    </InfoPage>
  );
}
