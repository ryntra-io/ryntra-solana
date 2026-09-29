import type { Metadata } from "next";
import { GithubLogo } from "@phosphor-icons/react/dist/ssr";

import { sitePageMetadata } from "@/app/site/seo";
import { Checks, InfoBlock, InfoHero, InfoPage, LinkRow, Panel, PrimaryAction, ProseBody, Tiles, infoStyles as s } from "@/app/site/info/info";
import { SOLANA_EVIDENCE_REPOSITORY_URL } from "@/lib/site/contacts";
import { publicServerLocale } from "@/lib/site/server-locale";

import { RUN_COMMANDS, developersCopy } from "./developers-copy";

/*
 * «Відкритий код» — the one public repository (canon §0.0 rule 8), what it
 * holds, how to run it and what it does not claim (the new site of canon
 * v5.5, `RYN-SITE-V5-001` subtask 3). Until 2026-09-26 this address led to
 * the developer references by a permanent redirect and this file drew a
 * platform hub no link reached; the references stay at `/docs/developers`
 * for whoever holds their link, and the hub's data stays in `platform.ts`.
 *
 * Out of the index by the plan's map: the page answers for whoever is sent
 * here, and the site tells search engines about the product people use.
 */

export async function generateMetadata(): Promise<Metadata> {
  const { meta } = developersCopy(await publicServerLocale());
  return sitePageMetadata({
    path: "/developers",
    title: meta.title,
    description: meta.description,
    keywords: ["ryntra open source", "solana evidence kit", "ryntra-solana-evidence"],
    index: false,
  });
}

export default async function DevelopersPage() {
  const locale = await publicServerLocale();
  const copy = developersCopy(locale);
  return (
    <InfoPage locale={locale} quietHeaderAction>
      <InfoHero
        eyebrow={copy.hero.eyebrow}
        title={copy.hero.title}
        lead={copy.hero.lead}
        actions={<PrimaryAction href={SOLANA_EVIDENCE_REPOSITORY_URL} external><GithubLogo size={18} aria-hidden />{copy.hero.open}</PrimaryAction>}
      />

      <InfoBlock id="open" eyebrow={copy.open.eyebrow} title={copy.open.title} lead={copy.open.lead}>
        <Tiles items={copy.open.tiles} />
      </InfoBlock>

      <InfoBlock id="run" eyebrow={copy.run.eyebrow} title={copy.run.title} lead={copy.run.lead}>
        <Panel>
          <ProseBody blocks={[{ code: RUN_COMMANDS }]} />
          <p className={s.note}>{copy.run.after}</p>
        </Panel>
      </InfoBlock>

      <InfoBlock id="limits" eyebrow={copy.limits.eyebrow} title={copy.limits.title}>
        <Panel><Checks items={copy.limits.items} tone="cannot" /></Panel>
      </InfoBlock>

      <InfoBlock id="more" title={copy.more.title}>
        <LinkRow links={copy.more.links} />
      </InfoBlock>
    </InfoPage>
  );
}
