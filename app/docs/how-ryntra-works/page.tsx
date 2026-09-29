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

const HREF = "/docs/how-ryntra-works";

export const metadata: Metadata = sitePageMetadata({
  path: HREF,
  title: `${entryFor(HREF)?.label} — Ryntra Documentation`,
  description: "One lifecycle from discovery to journal, and the product model each stage belongs to.",
});

export default function Page() {
  return (
    <DocsArticle href={HREF} reviewed="2026-08-19" lead="One lifecycle from discovery to journal, and the product model each stage belongs to.">
        <Chapter
          id="product-model"
          n="02"
          heading="Product model"
          meta="One kernel · One surface"
          lead="There is one Evidence Kernel. Everything a person sees is a surface over it, which is why a fact cannot be true on one page and false on another."
          bare
        source={["Owner: docs/MASTER-PLAN.md §14", "Surface: /"]}
        >
          <div className="rx-scroll">
            <table className="rx-table">
              <thead>
                <tr>
                  <th scope="col">Surface</th>
                  <th scope="col">Who it is for</th>
                  <th scope="col">What it does</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">Ryntra Workspace</th>
                  <td>Self-directed people</td>
                  <td>
                    Understand risk, plan, check the plan against evidence, authorize a supported action
                    in your own wallet, and review what happened. The human-facing product and the
                    reference implementation of the kernel.
                  </td>
                </tr>
                <tr>
                  <th scope="row">Evidence Kernel</th>
                  <td>Nobody directly — it is underneath the Workspace</td>
                  <td>
                    Intent, evidence status, policy decision, human authorization, settlement,
                    reconciliation and receipt. One implementation, shared.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <Detail summary="Why evidence, policy, authorization and execution are kept separate">
            <div className="rx-prose">
              <p>
                Collapsing them is what makes a system unreviewable after the fact. If the policy result
                and the human act are one object, nobody can later tell whether a person agreed with the
                rule or was simply carried past it. If execution is not separate from authorization, an
                uncertain broadcast has no safe state to fall back to.
              </p>
              <ul>
                <li>
                  Human authorization is bound to the intent revision, the evidence root and the
                  execution fingerprint. Changing the amount, asset, recipient, chain, route or calldata
                  invalidates it.
                </li>
                <li>
                  An uncertain broadcast keeps the captured transaction hash and moves to a
                  reconciliation-required state. It never triggers an automatic second broadcast.
                </li>
                <li>
                  Unknown never renders as complete. Missing, stale or unsupported evidence stays visible
                  instead of being defaulted to zero.
                </li>
              </ul>
            </div>
          </Detail>
        </Chapter>
    </DocsArticle>
  );
}
