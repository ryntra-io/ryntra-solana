"use client";

import Link from "next/link";
import { useMemo, type ReactNode } from "react";

import type { LegalBlock, LegalLine } from "@/lib/legal/texts/model";
import { privacyPolicy } from "@/lib/legal/texts/privacy";
import { termsOfUse } from "@/lib/legal/texts/terms";

import { useDocsLang } from "../../docs/_book/parts";
import { LegalPage } from "./LegalPage";
import { LEGAL_WORDS, publishedDoors } from "./words";

/**
 * `/legal/terms` and `/legal/privacy` in the terminal's frame: the published words exactly
 * (`lib/legal/texts/*`, held to the published text by `lib/legal/texts/legal.test.mjs`). The documents are English;
 * the part written for a Ukrainian reader — the tokens a person launches, the phone app — follows the reader's language,
 * as published.
 */
export function PublishedView({ id }: { id: "terms" | "privacy" }) {
  const lang = useDocsLang();
  const w = LEGAL_WORDS[lang];
  const doc = useMemo(() => (id === "terms" ? termsOfUse(lang) : privacyPolicy(lang)), [id, lang]);
  return (
    <LegalPage
      lang={lang}
      mark={id}
      here={w[id]}
      title={doc.title}
      titleLang="en"
      docLang="en"
      date={doc.effective}
      intro={doc.intro.map((block, i) => (
        <Block key={i} block={block} lang={block.lang} />
      ))}
      parts={doc.sections.map((section) => ({
        id: section.id,
        heading: section.heading,
        lang: section.lang,
        body: section.blocks.map((block, i) => <Block key={i} block={block} />),
      }))}
      doors={publishedDoors(w, id)}
    />
  );
}

function Block({ block, lang }: { block: LegalBlock; lang?: string }) {
  if (block.kind === "p") return <p lang={lang}>{runs(block.line)}</p>;
  return (
    <ul lang={lang}>
      {block.items.map((item, i) => (
        <li key={i}>{runs(item)}</li>
      ))}
    </ul>
  );
}

/** A line's runs: words, words in bold, links — the site's own pages in place, another site beside the document. */
function runs(line: LegalLine): ReactNode[] {
  return line.map((run, i) => {
    if (typeof run === "string") return run;
    if ("strong" in run) return <strong key={i}>{run.strong}</strong>;
    if (run.href.startsWith("/")) {
      return (
        <Link key={i} href={run.href}>
          {run.link}
        </Link>
      );
    }
    const away = /^https?:/.test(run.href);
    return (
      <a key={i} href={run.href} target={away ? "_blank" : undefined} rel={away ? "noopener" : undefined}>
        {run.link}
      </a>
    );
  });
}
