import type { Metadata } from "next";

import { StatePill } from "@/app/site/parts";
import { sitePageMetadata } from "@/app/site/seo";
import { getSiteTruth } from "@/app/site/truth";
import { Chapter, STATE_MEANING, STATE_ORDER, stateLabel } from "../parts";
import { DocsArticle } from "../article";
import { entryFor } from "../nav";
import "@/app/site/frozen/primitives.css";
import "@/app/site/frozen/document.css";
import "../handbook.css";
import "../docs.css";

export const revalidate = 3600;

const HREF = "/docs/current-capabilities";

export const metadata: Metadata = sitePageMetadata({
  path: HREF,
  title: `${entryFor(HREF)?.label} — Ryntra Documentation`,
  description: "Every registered capability with its state, scope and evidence — read from the registry, not written here.",
});

export default function Page() {
  const truth = getSiteTruth();
  const groups = STATE_ORDER.map((state) => ({
    state,
    label: stateLabel(state),
    rows: truth.capabilities.filter((row) => row.state === state),
  })).filter((group) => group.rows.length > 0);
  return (
    <DocsArticle href={HREF} reviewed="2026-08-19" lead="Every registered capability with its state, scope and evidence — read from the registry, not written here.">
        <Chapter
          id="capabilities"
          n="03"
          heading="Current capabilities"
          meta={`Reviewed ${truth.registryVerifiedAt}`}
          lead="The register the rest of the site reads from. A badge that says “Live” elsewhere is only honest because the scope behind it is here: what the claim covers, where it stops, and when it was last checked."
          bare
          source={[
            "Owner: lib/product/capabilities.ts",
            "Rendered live from the registry",
            `Reviewed ${truth.registryVerifiedAt}`,
          ]}
        >
          {groups.map((group) => (
            <div className="rx-hb-block" key={group.state}>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 14 }}>
                <StatePill label={group.label} tone={group.rows[0].tone} />
                <p className="rx-fine" style={{ maxWidth: "62ch" }}>
                  {STATE_MEANING[group.state]}
                </p>
              </div>
              <div className="rx-scroll">
                <table className="rx-table rx-table--wide">
                  <thead>
                    <tr>
                      <th scope="col">Capability</th>
                      <th scope="col">Scope</th>
                      <th scope="col">Stated limitation</th>
                      <th scope="col">Reviewed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.rows.map((row) => (
                      <tr key={row.id}>
                        <th scope="row">{row.label}</th>
                        <td>{row.scope}</td>
                        <td>{row.limitation}</td>
                        <td style={{ whiteSpace: "nowrap" }}>{row.lastVerifiedAt}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </Chapter>
    </DocsArticle>
  );
}
