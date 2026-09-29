import type { Metadata } from "next";
import Link from "next/link";

import { sitePageMetadata } from "@/app/site/seo";
import { HOME_AFTER_GATE, HOME_SURFACES, HOME_WRITE_AUTHORITY } from "@/lib/product/home-surfaces";
import { Chapter } from "../parts";
import { DocsArticle } from "../article";
import { entryFor } from "../nav";
import "@/app/site/frozen/primitives.css";
import "@/app/site/frozen/document.css";
import "../handbook.css";
import "../docs.css";

export const revalidate = 3600;

const HREF = "/docs/ryntra-home";

export const metadata: Metadata = sitePageMetadata({
  path: HREF,
  title: `${entryFor(HREF)?.label} — Ryntra Documentation`,
  description: "Every Ryntra Home surface, the question it answers, what it refuses to do, and the three capabilities that are not enabled.",
});

/**
 * The public product page for Ryntra Home.
 *
 * It renders `lib/product/home-surfaces.ts` and adds no claim of its own. That
 * is the whole design: the finish line's last condition is *no sentence a
 * person can read that a test cannot check*, and a page of hand-written prose
 * about a product cannot satisfy it — every paragraph would be a claim with
 * nothing behind it but the day somebody wrote it. Every row below names a
 * route a test opens and a module a test finds on disk, and the superlatives a
 * marketing page reaches for are refused by that same test.
 *
 * The gated capabilities are published rather than omitted. A reader deciding
 * whether to trust this product is better served by the named gap than by
 * silence, and the named gap is what stops a later surface implying one of them
 * works.
 */
export default function Page() {
  return (
    <DocsArticle
      href={HREF}
      reviewed="2026-08-24"
      lead="Every Ryntra Home surface, the question it answers, and what it refuses to do."
    >
      <Chapter
        id="surfaces"
        n="08"
        heading="Ryntra Home"
        meta={`${HOME_SURFACES.length} surfaces · write authority ${HOME_WRITE_AUTHORITY}`}
        lead="Home is the human-facing product: what you hold, what changed, what needs deciding, and what you decided before. Every surface listed here reads. None of them writes, signs, authorizes, executes or moves anything."
        bare
        source={[
          "Owner: lib/product/home-surfaces.ts",
          "Rendered from the register, not written here",
          "Checked by lib/home/finish-battery.test.mjs",
        ]}
      >
        <div className="rx-prose">
          <p>
            Each row names the module that owns what its facts mean and the delivery wave that
            built it. The <em>refuses</em> column is the useful half: it is where the product
            states what it will not do, which is the part a reader cannot check by looking at a
            screenshot.
          </p>
        </div>

        <div className="rx-scroll">
          <table className="rx-table">
            <thead>
              <tr>
                <th scope="col">Surface</th>
                <th scope="col">The question it answers</th>
                <th scope="col">Refuses</th>
                <th scope="col">Wave</th>
              </tr>
            </thead>
            <tbody>
              {HOME_SURFACES.map((surface) => (
                <tr key={surface.id}>
                  <th scope="row">
                    <Link href={surface.href}>{surface.label}</Link>
                    <br />
                    <code className="rx-fine">{surface.href}</code>
                  </th>
                  <td>{surface.question}</td>
                  <td>
                    <ul>
                      {surface.refuses.map((line) => <li key={line}>{line}</li>)}
                    </ul>
                  </td>
                  <td><code>{surface.wave}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Chapter>

      <Chapter
        id="not-enabled"
        n="09"
        heading="What is not enabled"
        meta={`${HOME_AFTER_GATE.length} gated capabilities`}
        lead="Three things Home deliberately does not do, and the exact record that would have to exist before any of them could change."
        bare
        source={[
          "Owner: lib/product/home-surfaces.ts",
          "Gate: lib/home/regulatory/capability-state.ts",
        ]}
      >
        <div className="rx-prose">
          <p>
            These are published rather than omitted. The gate is a{" "}
            <code>RegulatoryCapabilityState</code> record — an actual provider contract, counsel
            opinion, product-perimeter statement or regulator publication, for one context
            version, one instrument class and one operation. Missing, stale, expired or
            conflicting state fails closed, and interface copy and a generic jurisdiction label
            are refused as sources by name: what a product says about itself cannot authorize
            the product.
          </p>
        </div>

        <div className="rx-scroll">
          <table className="rx-table">
            <thead>
              <tr>
                <th scope="col">Capability</th>
                <th scope="col">What would have to exist</th>
              </tr>
            </thead>
            <tbody>
              {HOME_AFTER_GATE.map((entry) => (
                <tr key={entry.id}>
                  <th scope="row">{entry.label}</th>
                  <td>{entry.gate}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="rx-prose">
          <p>
            The current state of all three is readable inside the product at{" "}
            <Link href="/app/operations">Operations</Link>, where they are drawn as kill switches
            that are shown and never thrown. The registered maturity of every Ryntra capability
            is at <Link href="/docs/current-capabilities">Current capabilities</Link>.
          </p>
        </div>
      </Chapter>
    </DocsArticle>
  );
}
