import type { Metadata } from "next";
import Link from "next/link";

import { sitePageMetadata } from "@/app/site/seo";
import { Chapter } from "../parts";
import { DocsArticle } from "../article";
import { entryFor } from "../nav";
import "@/app/site/frozen/primitives.css";
import "@/app/site/frozen/document.css";
import "../handbook.css";
import "../docs.css";

export const revalidate = 3600;

const HREF = "/docs/faq";

export const metadata: Metadata = sitePageMetadata({
  path: HREF,
  title: `${entryFor(HREF)?.label} — Ryntra Documentation`,
  description: "The questions a reviewer asks first, answered without marketing.",
});

export default function Page() {
  return (
    <DocsArticle href={HREF} reviewed="2026-08-19" lead="The questions a reviewer asks first, answered without marketing.">
        <Chapter
          id="faq"
          n="09"
          heading="FAQ"
          meta="Short answers"
          bare
        source={["Owner: this Handbook"]}
        >
          <div className="rx-hb-block">
            <h3 className="rx-h3 rx-hb-h3">Can Ryntra move my funds?</h3>
            <p className="rx-body">
              No. There is no deposit path, no withdrawal capability and no signing key. Your wallet
              signs; Ryntra records what you authorized and reconciles what the chain confirmed.
            </p>
          </div>
          <div className="rx-hb-block">
            <h3 className="rx-h3 rx-hb-h3">Does an AI decide anything?</h3>
            <p className="rx-body">
              No. Deterministic code returns every policy result. AI may explain, formalize, compare,
              translate and review, and it is never on the decision path.
            </p>
          </div>
          <div className="rx-hb-block">
            <h3 className="rx-h3 rx-hb-h3">What does “Live” actually mean here?</h3>
            <p className="rx-body">
              Usable now, inside exactly the scope on its row in{" "}
              <a className="rx-link" href="#capabilities">
                Current capabilities
              </a>{" "}
              — and nothing outside it. If the claim ages past its review window it downgrades itself to
              re-verifying automatically.
            </p>
          </div>
          <div className="rx-hb-block">
            <h3 className="rx-h3 rx-hb-h3">How do I get access?</h3>
            <p className="rx-body">
              Through one confirmation in the Telegram bot at{" "}
              <Link className="rx-link" href="/beta">
                /beta
              </Link>
              . No email, no password, nothing to deposit. It is a confirmation gate, not a product
              login.
            </p>
          </div>
          <div className="rx-hb-block">
            <h3 className="rx-h3 rx-hb-h3">Can I build on it?</h3>
            <p className="rx-body">
              The public repository — what it holds, how to run it and what it does not claim — is
              listed on{" "}
              <Link className="rx-link" href="/developers">
                Developers
              </Link>
              .
            </p>
          </div>
        </Chapter>
    </DocsArticle>
  );
}
