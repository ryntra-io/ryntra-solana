import type { Metadata } from "next";

import { sitePageMetadata } from "@/app/site/seo";
import { Chapter, Detail } from "../parts";
import { DocsArticle } from "../article";
import { entryFor } from "../nav";
import "@/app/site/frozen/primitives.css";
import "@/app/site/frozen/document.css";
import "../handbook.css";
import "../docs.css";

export const revalidate = 3600;

const HREF = "/docs/receipts-journal";

export const metadata: Metadata = sitePageMetadata({
  path: HREF,
  title: `${entryFor(HREF)?.label} — Ryntra Documentation`,
  description: "What a receipt binds, why a transaction hash is not one, and how a past decision is reviewed.",
});

export default function Page() {
  return (
    <DocsArticle href={HREF} reviewed="2026-08-19" lead="What a receipt binds, why a transaction hash is not one, and how a past decision is reviewed.">
        <Chapter
          id="evidence"
          n="05"
          heading="Evidence & receipts"
          meta="What a receipt binds"
          lead="A transaction hash says that something settled. A receipt binds what was decided, on which evidence and under which policy, to what actually happened."
          bare
          source={["Owner: this Handbook"]}
        >
          <Detail summary="What a receipt contains">
            <div className="rx-prose">
              <ul>
                <li>The versioned intent and its revision.</li>
                <li>
                  The evidence root, with provider, source reference, observation time, validity and
                  coverage for every input.
                </li>
                <li>The policy version, its digest and the deterministic decision it returned.</li>
                <li>The human authorization, recorded as a separate act with its own binding.</li>
                <li>The execution fingerprint — exact target, calldata and native value.</li>
                <li>Expected effects, actual effects, and any drift between them.</li>
                <li>A receipt hash and an integrity digest, both checkable outside the application.</li>
              </ul>
              <p className="rx-fine">
                No personal data and no full receipt is written onchain. Public proof may redact
                privacy-sensitive fields, but never so far that the run stops being verifiable against
                the chain.
              </p>
            </div>
          </Detail>
        </Chapter>
    </DocsArticle>
  );
}
