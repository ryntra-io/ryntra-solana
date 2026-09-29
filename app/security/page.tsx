import type { Metadata } from "next";

import { pageCard } from "@/app/brand/page-card";
import { pageCardImage } from "@/app/seo";
import { SitePageGraph } from "@/app/site/page-graph";
import { sitePageMetadata } from "@/app/site/seo";
import { Checks, Disclosures, InfoBlock, InfoHero, InfoPage, Panel, ProseBody, SecondaryAction, infoStyles as s } from "@/app/site/info/info";
import { contactMailto } from "@/lib/site/contacts";
import {
  BOUNDARIES,
  NO_AUDIT_STATEMENT,
  NO_AUDIT_STATEMENT_UK,
  SECURITY_AS_OF,
  SECURITY_REPORT_SUBJECT,
} from "@/lib/site/security";
import { publicServerLocale } from "@/lib/site/server-locale";

import { securityCopy } from "./security-copy";
import "./security.css";

/**
 * The security page — the boundary of the product, checked against the code
 * on `SECURITY_AS_OF` (the new site of canon v5.5, `RYN-SITE-V5-001`
 * subtask 3, English and Ukrainian by the reader's language).
 *
 * At rest the page is what a reader asks first: what Ryntra cannot do and what
 * it can, and what has not been reviewed — the audit sentence read from
 * `lib/site/security.ts`, never retyped, so a copy edit cannot soften it. The
 * twelve sections of the founder's specification keep their ids, their
 * numbers and their order a tap deeper, each a disclosure, so a link to any
 * of them still lands on it and no technical paragraph stands on the page
 * uninvited.
 */

export async function generateMetadata(): Promise<Metadata> {
  const locale = await publicServerLocale();
  const { meta } = securityCopy(locale);
  return sitePageMetadata({
    path: "/security",
    title: meta.title,
    description: meta.description,
    keywords: ["ryntra security", "non-custodial", "key custody", "vulnerability disclosure", "audit status"],
    locale,
    image: pageCardImage(locale, ["page", "security"], pageCard("security", locale)),
  });
}

function checkedOn(locale: "en" | "uk"): string {
  return new Intl.DateTimeFormat(locale === "uk" ? "uk-UA" : "en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${SECURITY_AS_OF}T00:00:00Z`));
}

export default async function SecurityPage() {
  const locale = await publicServerLocale();
  const copy = securityCopy(locale);
  const line = (boundary: (typeof BOUNDARIES)[number]) => (locale === "uk" ? boundary.uk : boundary.text);
  const noAudit = locale === "uk" ? NO_AUDIT_STATEMENT_UK : NO_AUDIT_STATEMENT;

  return (
    <InfoPage locale={locale}>
      <SitePageGraph type="WebPage" path="/security" locale={locale} name={copy.meta.title} description={copy.meta.description} />
      <InfoHero eyebrow={copy.hero.eyebrow} title={copy.hero.title} lead={copy.hero.lead} chips={copy.hero.chips} />

      <InfoBlock id="boundary" eyebrow={copy.boundary.eyebrow} title={copy.boundary.title} meta={`${copy.boundary.checked} ${checkedOn(locale)}`}>
        <div className="sec-bounds">
          <Panel title={copy.boundary.cannot}>
            <Checks items={BOUNDARIES.filter((b) => b.kind === "cannot").map(line)} tone="cannot" />
          </Panel>
          <Panel title={copy.boundary.can}>
            <Checks items={BOUNDARIES.filter((b) => b.kind === "can").map(line)} />
          </Panel>
        </div>
      </InfoBlock>

      <InfoBlock id="known" eyebrow={copy.known.eyebrow} title={copy.known.title}>
        <Panel>
          <p className={s.statement}>{noAudit}</p>
          <Checks items={copy.known.facts} tone="cannot" />
          <div className="sec-report">
            <SecondaryAction href={contactMailto(SECURITY_REPORT_SUBJECT)}>{copy.known.report}</SecondaryAction>
          </div>
          <p className={s.note}>{copy.known.noCommitment}</p>
        </Panel>
      </InfoBlock>

      <InfoBlock id="sections" eyebrow={copy.sections.eyebrow} title={copy.sections.title} lead={copy.sections.lead}>
        <Disclosures
          items={copy.sections.items.map((section, index) => ({
            id: section.id,
            number: `${index + 1} ·`,
            title: section.title,
            hint: section.hint,
            body: (
              <>
                {section.id === "assurance" ? <p><strong>{noAudit}</strong></p> : null}
                <ProseBody blocks={section.body} />
                {section.id === "report" ? <p><SecondaryAction href={contactMailto(SECURITY_REPORT_SUBJECT)}>{copy.known.report}</SecondaryAction></p> : null}
              </>
            ),
          }))}
        />
      </InfoBlock>
    </InfoPage>
  );
}
