import type { Metadata } from "next";

import { StatePill, StatedGap } from "@/app/site/parts";
import { sitePageMetadata } from "@/app/site/seo";
import { getSiteTruth } from "@/app/site/truth";
import { Chapter, stateLabel } from "../parts";
import { DocsArticle } from "../article";
import { entryFor } from "../nav";
import "@/app/site/frozen/primitives.css";
import "@/app/site/frozen/document.css";
import "../handbook.css";
import "../docs.css";

export const revalidate = 3600;

const HREF = "/docs/roadmap";

export const metadata: Metadata = sitePageMetadata({
  path: HREF,
  title: `${entryFor(HREF)?.label} — Ryntra Documentation`,
  description: "What is being built next, gated by capability rather than by date.",
});

export default function Page() {
  const truth = getSiteTruth();
  return (
    <DocsArticle href={HREF} reviewed="2026-08-19" lead="What is being built next, gated by capability rather than by date.">
        <Chapter
          id="roadmap"
          n="08"
          heading="Roadmap"
          meta="Gate-based · No dates"
          lead="What is being built, kept apart from what is live. Nothing here carries a date, a percentage or a countdown — a capability moves when its evidence exists, and it moves in the register above first."
          bare
        source={["Owner: lib/product/capabilities.ts", "Rendered live from the registry"]}
        >
          <div className="rx-scroll">
            <table className="rx-table rx-table--wide">
              <thead>
                <tr>
                  <th scope="col">Direction</th>
                  <th scope="col">State</th>
                  <th scope="col">What it means today</th>
                  <th scope="col">Stated limitation</th>
                </tr>
              </thead>
              <tbody>
                {truth.next.map((row) => (
                  <tr key={row.id}>
                    <th scope="row">{row.title}</th>
                    <td>
                      <StatePill label={stateLabel(row.state)} tone={row.tone} />
                    </td>
                    <td>{row.body}</td>
                    <td>{row.limitation}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="rx-fine" style={{ marginTop: 20 }}>
            <StatedGap>
              Ryntra has no token promise, no airdrop and no allocation. A token remains optional only
              through a future readiness gate, and no evidence, policy or safety behaviour will ever
              depend on one.
            </StatedGap>
          </p>
        </Chapter>
    </DocsArticle>
  );
}
