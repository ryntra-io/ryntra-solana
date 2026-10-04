import type { Metadata } from "next";
import Link from "next/link";

import { sitePageMetadata } from "@/app/site/seo";
import "@/app/site/frozen/primitives.css";
import "@/app/site/frozen/document.css";

import { DocsArticle } from "../article";
import { entryFor } from "../nav";
import "../docs.css";
import { PAPER_CHAPTERS, PAPER_NOTICE } from "./chapters";
import "./paper.css";

const HREF = "/docs/product-paper";


export const metadata: Metadata = sitePageMetadata({
  path: HREF,
  title: `${entryFor(HREF)?.label} — Ryntra`,
  description:
    "The whole system in one document: thesis, principles, the Evidence Kernel, the canonical lifecycle, every product archetype, every ecosystem pack, and the boundaries.",
  keywords: ["ryntra architecture", "product paper", "evidence kernel", "decision lifecycle"],
});

/**
 * The Ryntra Product & Architecture Paper.
 *
 * Named a paper rather than a whitepaper, a litepaper or a protocol paper, all
 * of which carry a token connotation this company has nothing to attach it to.
 * Twenty-nine chapters in a fixed order, each drawn from a product document
 * rather than written fresh — which is why it can be this compact and still
 * describe the whole system.
 */
export default function Page() {
  return (
    <DocsArticle
      href={HREF}
      reviewed="2026-08-19"
      lead="The whole system in one document — thesis, principles, the kernel, the lifecycle, every archetype, every ecosystem pack, and the boundaries it will not cross."
    >
      <aside className="rx-pp-notice" role="note" aria-label="Scope of this document">
        <p>{PAPER_NOTICE}</p>
        <Link className="rx-btn rx-btn--ghost rx-btn--sm" href="/docs/current-capabilities">
          Current capabilities
        </Link>
      </aside>

      {PAPER_CHAPTERS.map((chapter, index) => (
        <section className="rx-pp-ch" id={`ch-${index + 1}`} key={chapter.title}>
          <h2 className="rx-h3 rx-pp-h">
            <span className="rx-pp-n">{String(index + 1).padStart(2, "0")}</span>
            {chapter.title}
          </h2>
          <p className="rx-body">{chapter.body}</p>
        </section>
      ))}
    </DocsArticle>
  );
}
