import type { Metadata } from "next";

import { StatePill } from "@/app/site/parts";
import { sitePageMetadata } from "@/app/site/seo";
import { Chapter, manifestState, stateLabel } from "../parts";
import { ECOSYSTEMS, isSelectable } from "@/lib/product/ecosystems";
import { STATE_TONE } from "@/app/site/truth-view";
import type { EcosystemManifest } from "@/lib/product/ecosystems";
import { DocsArticle } from "../article";
import { entryFor } from "../nav";
import "@/app/site/frozen/primitives.css";
import "@/app/site/frozen/document.css";
import "../handbook.css";
import "../docs.css";

export const revalidate = 3600;

const HREF = "/docs/ecosystems";

export const metadata: Metadata = sitePageMetadata({
  path: HREF,
  title: `${entryFor(HREF)?.label} — Ryntra Documentation`,
  description: "Every registered chain pack and venue adapter, and the exact point each one stops.",
});

export default function Page() {
  return (
    <DocsArticle href={HREF} reviewed="2026-08-19" lead="Every registered chain pack and venue adapter, and the exact point each one stops.">
        <Chapter
          id="ecosystems"
          n="07"
          heading="Ecosystem workspaces"
          meta={`${ECOSYSTEMS.length} registered · ${ECOSYSTEMS.filter(isSelectable).length} usable`}
          lead="A chain settles. A venue executes. They are listed apart because they are not the same thing — and a direction appears here once it is registered, not once it works."
          bare
          source={["Owner: lib/product/ecosystems.ts", "Not a partner list"]}
        >
          <div className="rx-prose">
            <p>
              Most of these are registered and not built, which is what the state word says. Nothing
              below is a partnership, an endorsement or a claim of support by the named project.
            </p>
          </div>

          {(["chain_pack", "venue_adapter"] as const).map((kind) => (
            <div className="rx-hb-block" key={kind}>
              <h3 className="rx-h3 rx-hb-h3">
                {kind === "chain_pack"
                  ? "Chain packs — where value settles"
                  : "Venue adapters — how an action is quoted or executed"}
              </h3>
              <div className="rx-scroll">
                <table className="rx-table">
                  <thead>
                    <tr>
                      <th scope="col">{kind === "chain_pack" ? "Chain" : "Venue"}</th>
                      <th scope="col">State</th>
                      <th scope="col">Role</th>
                      <th scope="col">Where it stops</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ECOSYSTEMS.filter((entry: EcosystemManifest) => entry.kind === kind).map((entry) => (
                      <tr key={entry.id}>
                        <th scope="row">{entry.name}</th>
                        <td>
                          <span
                            style={{
                              display: "inline-flex",
                              flexWrap: "wrap",
                              alignItems: "center",
                              gap: 8,
                            }}
                          >
                            <StatePill
                              label={stateLabel(manifestState(entry.state))}
                              tone={STATE_TONE[manifestState(entry.state)]}
                            />
                            {entry.state === "read_only" ? (
                              <span className="rx-fine">Read-only</span>
                            ) : null}
                          </span>
                        </td>
                        <td>{entry.role}</td>
                        <td>{entry.gate}</td>
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
