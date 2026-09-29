import type { Metadata } from "next";

import { sitePageMetadata } from "@/app/site/seo";
import { getSiteTruth } from "@/app/site/truth";
import { Chapter, Detail, STATE_MEANING, STATE_ORDER, stateLabel } from "../parts";
import { DocsArticle } from "../article";
import { entryFor } from "../nav";
import "@/app/site/frozen/primitives.css";
import "@/app/site/frozen/document.css";
import "../handbook.css";
import "../docs.css";

export const revalidate = 3600;

const HREF = "/docs/core-principles";

export const metadata: Metadata = sitePageMetadata({
  path: HREF,
  title: `${entryFor(HREF)?.label} — Ryntra Documentation`,
  description: "How a decision is evaluated before anything is signed, and what a refusal means.",
});

export default function Page() {
  const truth = getSiteTruth();
  return (
    <DocsArticle href={HREF} reviewed="2026-08-19" lead="How a decision is evaluated before anything is signed, and what a refusal means.">
        <Chapter
          id="methodology"
          n="04"
          heading="Decision method"
          meta={`${truth.circuit.length} stages`}
          lead="How a decision is made, and how the words describing it are defined. This section is the reason a state word on any Ryntra surface means the same thing on every other one."
          bare
          source={["Owner: lib/product/capabilities.ts", "Stages: lib/guard — the Evidence Kernel"]}
        >
          {/* An anchor for the canon's alternative name for this section, so
              `/docs#decision-method` reaches it as well as `#methodology`. */}
          <span id="decision-method" aria-hidden />

          <div className="rx-hb-block">
            <h3 className="rx-h3 rx-hb-h3">The stages</h3>
            <div className="rx-scroll">
              <table className="rx-table rx-table--wide">
                <thead>
                  <tr>
                    <th scope="col">Stage</th>
                    <th scope="col">Takes</th>
                    <th scope="col">Produces</th>
                    <th scope="col">Never</th>
                  </tr>
                </thead>
                <tbody>
                  {truth.circuit.map((stage) => (
                    <tr key={stage.id}>
                      <th scope="row">{stage.name}</th>
                      <td>{stage.takes}</td>
                      <td>{stage.makes}</td>
                      <td>{stage.never}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rx-hb-block">
            <h3 className="rx-h3 rx-hb-h3">Five independent axes</h3>
            <p className="rx-body">
              A decision has five states, and they are tracked separately on purpose. Collapsing them
              into one verdict is the specific way a missing input disappears: a run with unresolved
              evidence and a clean policy result would read the same as a run with both.
            </p>
            <div className="rx-axes">
              <div className="rx-axis">
                <span className="rx-axis-name">Tracked separately</span>
                <span className="rx-axis-values">
                  <span>Evidence status</span>
                  <span>Policy decision</span>
                  <span>Authorization status</span>
                  <span>Execution status</span>
                  <span>Reconciliation status</span>
                </span>
              </div>
            </div>
            <p className="rx-fine">
              <strong>Allowed by policy does not mean safe, legal or profitable.</strong> It means the
              action matched the configured rules against the evidence available at that moment — two
              things a reader can check, and neither of which is a promise about what happens next.
            </p>
          </div>

          <div className="rx-hb-block">
            <h3 className="rx-h3 rx-hb-h3">How maturity is defined</h3>
            <div className="rx-prose">
              <ul>
                {STATE_ORDER.filter((state) => state !== "re_verifying").map((state) => (
                  <li key={state}>
                    <strong>{stateLabel(state)}</strong> — {STATE_MEANING[state]}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="rx-hb-block">
            <h3 className="rx-h3 rx-hb-h3">Rules that run without anyone editing a page</h3>
            <div className="rx-prose">
              <ul>
                <li>
                  Every claim carries a review window — 30 days for live and route claims, 90 for
                  roadmap claims. Past it, the claim renders as re-verifying rather than at its old
                  confidence, on every surface at once.
                </li>
                <li>
                  Route-bound claims are re-checked against the route registry at read time. A route
                  that drifts downgrades the claim automatically.
                </li>
                <li>
                  Missing, stale, conflicting or unsupported evidence makes the system{" "}
                  <strong>fail closed</strong>: the action is refused or held rather than proceeding
                  on an assumption. An unknown never renders as a complete or green result.
                </li>
                <li>
                  A capability is never promoted by copy. Marketing text is not the source of product
                  truth, and the tests fail a page that tries.
                </li>
                <li>
                  No entry carries a delivery date, a percentage or a countdown. Progress is gate-based:
                  a capability moves when its evidence exists.
                </li>
              </ul>
            </div>
          </div>

          <Detail summary="Where the decision method stops today">
            <div className="rx-prose">
              <p>
                The complete StrategySpec → readiness → disposition → DecisionReceipt → ReviewRecord loop
                is the target model. It is not shipped end to end today, and the register above is where
                the boundary between the model and the product is drawn.
              </p>
              <p>
                AI may explain, formalize, compare, translate and review. It never supplies a missing
                fact, decides policy, authorizes, signs or executes. Strategy Lab is a preview and is not
                publicly released.
              </p>
            </div>
          </Detail>
        </Chapter>
    </DocsArticle>
  );
}
