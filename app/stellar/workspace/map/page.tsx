import Link from "next/link";

import { ArrowMark } from "@/app/components/mark";
import { PageHead, environmentChip } from "../hub/parts.tsx";
import { STELLAR_MAP_GROUPS, STELLAR_MODULES } from "../hub/modules.ts";

export const metadata = { title: "Hub Map" };

/**
 * The Stellar Hub Map.
 *
 * The whole product architecture, with each module's real state and the exact
 * condition it waits on. This is where unbuilt capability lives so that the rail
 * can contain only pages that exist — a destination that is not built belongs
 * somewhere it can be described honestly, not in navigation where it reads as a
 * feature someone forgot to finish.
 *
 * It flows down the page as a document rather than living inside a fixed-height
 * panel. An earlier hub's map once rendered 6,118px of content into a 672px
 * scroller, and that defect is not worth repeating.
 *
 * **Each card now answers five questions rather than one.** A state word on its
 * own — `PLANNED`, `GATED` — tells a reader nothing they can check: it does not
 * say which parts already work, which are absent, or what would move it. Those
 * are three different facts and they are three fields, so a card that overstates
 * itself has to do it in a sentence somebody can disagree with rather than in a
 * word nobody can.
 */
export default function StellarHubMapPage() {
  const built = STELLAR_MODULES.filter((entry) => entry.route !== null).length;

  return (
    <>
      <PageHead
        title="Stellar Hub Map"
        lead={`Every module this workspace registers: ${built} with a page you can open, ${
          STELLAR_MODULES.length - built
        } registered with the condition each one waits on. Nothing here is a link to something unbuilt. A state word on this page is workspace module maturity — it is not the Capability Registry, and it is never a public claim on its own.`}
      />

      {STELLAR_MAP_GROUPS.map((zone) => {
        const rows = STELLAR_MODULES.filter((entry) => entry.group === zone.group);
        if (rows.length === 0) return null;
        return (
          <section className="sh-map-group" key={zone.group}>
            <h2 className="sh-map-title">{zone.title}</h2>
            <ul className="sh-map-list">
              {rows.map((entry) => (
                <li className="sh-map-card" key={entry.id}>
                  <span className="sh-map-head">
                    <span className="sh-map-name">{entry.label}</span>
                    {/* Its own chip, not the evidence chip. Module maturity and
                        the five evidence states are different vocabularies, and
                        only one of them is about whether a number can be
                        trusted. */}
                    <span className="st-mat" data-maturity={entry.maturity}>
                      {entry.maturity.replace("_", " ")}
                    </span>
                  </span>
                  <span className="sh-map-env" data-env={entry.environment}>
                    {environmentChip(entry.environment, entry.mode)}
                  </span>
                  <span className="sh-map-purpose">{entry.purpose}</span>
                  <span className="sh-map-detail">{entry.detail}</span>
                  <dl className="sh-map-facts">
                    <div>
                      <dt>Exists</dt>
                      <dd>{entry.exists}</dd>
                    </div>
                    <div>
                      <dt>Missing</dt>
                      <dd>{entry.missing}</dd>
                    </div>
                    <div>
                      <dt>Gate</dt>
                      <dd>{entry.gate}</dd>
                    </div>
                    <div>
                      <dt>Last verified</dt>
                      <dd>
                        {entry.lastVerifiedAt === null ? (
                          "Never — nothing to verify yet."
                        ) : (
                          <span translate="no">{entry.lastVerifiedAt}</span>
                        )}
                      </dd>
                    </div>
                  </dl>
                  {entry.route ? (
                    <Link className="st-open" href={entry.route}>
                      Open
                      <ArrowMark size={12} />
                    </Link>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      {/* The state key stays visible rather than moving behind the info control.
          It is not an explanation of the page — it is the legend for a word
          printed on every card above, and a legend a reader has to open is a
          legend that does not work. What did move is the sentence about what
          these words are not, which is a scope note and belongs with the rest. */}
      <section className="sh-map-group">
        <h2 className="sh-map-title">What a state word means here</h2>
        <dl className="st-legend">
          <div>
            <dt>Available</dt>
            <dd>A real page that reads and moves nothing.</dd>
          </div>
          <div>
            <dt>Testnet verified</dt>
            <dd>Its lifecycle ran on Stellar Testnet and reconciled, for the one operation named on the card.</dd>
          </div>
          <div>
            <dt>Preview</dt>
            <dd>Built enough to open, not proven against a live source.</dd>
          </div>
          <div>
            <dt>In build</dt>
            <dd>Active work with a registered task.</dd>
          </div>
          <div>
            <dt>Planned</dt>
            <dd>An accepted direction with no active work.</dd>
          </div>
          <div>
            <dt>Gated</dt>
            <dd>Blocked on a named condition, stated on the card.</dd>
          </div>
        </dl>
      </section>

      <section className="sh-map-group">
        <h2 className="sh-map-title">And what an environment word means</h2>
        <dl className="st-legend">
          <div>
            <dt>Mainnet · read only</dt>
            <dd>Real assets, issuers and ledger state. Moves nothing and needs no wallet.</dd>
          </div>
          <div>
            <dt>Testnet · user-signed</dt>
            <dd>Prepares an action you sign in your own wallet, on a network where the assets have no worth.</dd>
          </div>
          <div>
            <dt>Testnet · verification</dt>
            <dd>Checks what a testnet action actually did, without signing anything.</dd>
          </div>
          <div>
            <dt>Mainnet · separate release gate</dt>
            <dd>Would move real value. No setting in this workspace reaches it.</dd>
          </div>
          <div>
            <dt>Workspace</dt>
            <dd>Touches no network — preferences, documentation, this map.</dd>
          </div>
        </dl>
      </section>
    </>
  );
}
