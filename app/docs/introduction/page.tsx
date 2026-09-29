import type { Metadata } from "next";

import { StatedGap } from "@/app/site/parts";
import { sitePageMetadata } from "@/app/site/seo";
import { getSiteTruth } from "@/app/site/truth";
import { Chapter } from "../parts";
import { DocsArticle } from "../article";
import { entryFor } from "../nav";
import "@/app/site/frozen/primitives.css";
import "@/app/site/frozen/document.css";
import "../handbook.css";
import "../docs.css";

export const revalidate = 3600;

const HREF = "/docs/introduction";

export const metadata: Metadata = sitePageMetadata({
  path: HREF,
  title: `${entryFor(HREF)?.label} — Ryntra Documentation`,
  description: "What Ryntra is, who it is for, and the four commitments that bound it.",
});

export default function Page() {
  const truth = getSiteTruth();
  const liveCount = truth.capabilities.filter((row) => row.state === "live").length;
  return (
    <DocsArticle href={HREF} reviewed="2026-08-19" lead="What Ryntra is, who it is for, and the four commitments that bound it.">
        <Chapter
          id="overview"
          n="01"
          heading="Overview"
          meta="Start here"
          lead="Ryntra is a venue-neutral Risk, Strategy & Evidence OS for programmable assets. It helps a person understand what they are about to do, write the rule down before acting, check it against evidence that carries its own freshness, authorize it in their own wallet, and keep a record that survives the outcome."
          bare
        source={["Owner: docs/MASTER-PLAN.md", "Rendered from: lib/product/canon.ts"]}
        >
          <div className="rx-hb-block">
            <h3 className="rx-h3 rx-hb-h3">What it is for</h3>
            <div className="rx-prose">
              <ul>
                <li>
                  <strong>Before an action</strong> — the evidence a decision depends on, with its
                  provider, observation time and validity stated rather than assumed.
                </li>
                <li>
                  <strong>At the moment of authorization</strong> — one deterministic policy result and
                  one human act, recorded separately from each other.
                </li>
                <li>
                  <strong>After settlement</strong> — what the chain actually confirmed, compared with
                  what was authorized, and a receipt that can be checked independently.
                </li>
              </ul>
            </div>
          </div>

          <div className="rx-hb-block">
            <h3 className="rx-h3 rx-hb-h3">What it is not</h3>
            <div className="rx-prose">
              <ul>
                <li>Not an exchange, broker, custodian or adviser.</li>
                <li>Not a compliance certification, and not legal or tax advice.</li>
                <li>Not a guarantee of safety, execution success or profit.</li>
                <li>
                  Not an autonomous system. No model sits on the decision path; deterministic code
                  returns the outcome and a person authorizes it.
                </li>
              </ul>
            </div>
          </div>

          <div className="rx-hb-block">
            <h3 className="rx-h3 rx-hb-h3">Current stage, stated plainly</h3>
            <p className="rx-body">
              Ryntra is founder-led and pre-release. {liveCount} capabilities are live inside exactly the
              scope listed in <a className="rx-link" href="#capabilities">Current capabilities</a>. One
              complete lifecycle has been proven end to end on a public testnet, once, for one exact
              operation. Everything else is paper, preview, in build or behind a gate, and the register
              says which.
            </p>
            <p className="rx-fine">
              <StatedGap>
                No independent security audit has been performed, and reliability work — idempotency
                under load, replay and time-of-check-to-time-of-use protection, RPC failure handling,
                recovery and monitoring — is a separate gate that is not complete.
              </StatedGap>
            </p>
          </div>
        </Chapter>
    </DocsArticle>
  );
}
