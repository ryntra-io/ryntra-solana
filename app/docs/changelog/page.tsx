import type { Metadata } from "next";
import { ArrowSquareOut } from "@phosphor-icons/react/dist/ssr";

import { sitePageMetadata } from "@/app/site/seo";
import { getSiteTruth } from "@/app/site/truth";
import { Chapter } from "../parts";
import { REPOSITORY_URL } from "@/app/site/nav";
import { DocsArticle } from "../article";
import { entryFor } from "../nav";
import "@/app/site/frozen/primitives.css";
import "@/app/site/frozen/document.css";
import "../handbook.css";
import "../docs.css";

export const revalidate = 3600;

const HREF = "/docs/changelog";

export const metadata: Metadata = sitePageMetadata({
  path: HREF,
  title: `${entryFor(HREF)?.label} — Ryntra Documentation`,
  description: "Public product-relevant changes, with the capability each one moved.",
});

export default function Page() {
  const truth = getSiteTruth();
  return (
    <DocsArticle href={HREF} reviewed="2026-08-19" lead="Public product-relevant changes, with the capability each one moved.">
        <Chapter
          id="changelog"
          n="10"
          heading="Changelog"
          meta={`Reviewed ${truth.registryVerifiedAt}`}
          lead="What this document is bound to, and how to tell whether it has gone stale."
          bare
          source={["Registry: lib/product/capabilities.ts"]}
        >
          <div className="rx-scroll">
            <table className="rx-table">
              <tbody>
                <tr>
                  <th scope="row">Capability registry</th>
                  <td>
                    {truth.capabilities.length} entries, reviewed {truth.registryVerifiedAt}.{" "}
                    {truth.anyReVerifying
                      ? "At least one claim has aged past its review window and is rendered as re-verifying."
                      : "Every claim is inside its review window."}
                  </td>
                </tr>
                <tr>
                  <th scope="row">Public repository</th>
                  <td>
                    <a className="rx-link" href={REPOSITORY_URL} target="_blank" rel="noreferrer">
                      {REPOSITORY_URL.replace("https://", "")}
                      <ArrowSquareOut size={12} weight="bold" aria-hidden />
                    </a>
                  </td>
                </tr>
                <tr>
                  <th scope="row">Superseded pages</th>
                  <td>
                    <code className="rx-mono">/methodology</code>,{" "}
                    <code className="rx-mono">/status</code> and{" "}
                    <code className="rx-mono">/security</code> were four public documents restating the
                    same boundaries. They now redirect into this one, and their old anchors keep
                    working.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <p className="rx-fine" style={{ marginTop: 20 }}>
            This page has no operational status feed. It reports capability maturity and its review
            dates, which is not the same thing as uptime — and publishing a status page that measures
            nothing would be worse than not having one.
          </p>
        </Chapter>
    </DocsArticle>
  );
}
