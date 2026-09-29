import Link from "next/link";

import { CheckMark, CrossMark } from "@/app/components/mark";
import { InfoControl } from "@/app/shell/info-control";
import { EmptyState, Panel, PanelGrid } from "@/app/shell/panel";
import { STELLAR_MAINNET } from "@/lib/stellar/network";
import { isResolved } from "@/lib/stellar/evidence";
import { readAssetStatistics, readIssuerControls } from "@/lib/stellar/reads";
import { parseAsset } from "@/lib/stellar/asset";
import { assetHref, FEATURED_ASSETS } from "../assets/featured.ts";
import { PageHead } from "../hub/parts.tsx";

export const revalidate = 900;

export const metadata = { title: "RWA & tokenized assets" };

/**
 * RWA and tokenized assets.
 *
 * Tokenized treasuries, money-market instruments and stablecoins side by side,
 * with the fact that actually decides a holder's outcome in the first columns:
 * what the issuer can do to what you hold.
 *
 * ## It is called a set, not a market, and the difference is real
 *
 * A market implies coverage. There is no asset index on Stellar this product
 * reads, so coverage is exactly what this cannot claim — what it has is a
 * curated set, resolved live, one row per asset we already know about. The Hub
 * Map registers the index as the gate on the stronger surface rather than
 * letting this page quietly become it.
 *
 * Every number here is read at request time from the ledger and from each
 * issuer's own account. Nothing is cached into a table and nothing is ranked:
 * ordering by any column would be an opinion, and the note on each row states
 * what the asset **is** rather than whether it is good.
 */
export default async function StellarRwaPage() {
  const rows = await Promise.all(
    FEATURED_ASSETS.map(async (asset) => {
      const parsed = parseAsset(asset.id);
      const [controls, statistics] = await Promise.all([
        readIssuerControls(STELLAR_MAINNET, asset.issuer),
        parsed.ok ? readAssetStatistics(STELLAR_MAINNET, parsed.asset) : Promise.resolve(null),
      ]);
      return { asset, controls, statistics };
    }),
  );

  const readable = rows.filter((row) => isResolved(row.controls)).length;

  return (
    <>
      <PageHead
        title="RWA & tokenized assets"
        module="rwa-market"
        lead={
          <>
            <p>
              Tokenized real-world assets and stablecoins side by side, with issuer powers first — on Stellar, whether
              an issuer can freeze or claw back what you hold is the fact that decides the outcome, and it sits above
              supply for that reason.
            </p>
            <p>
              A curated set resolved live, not a market. Stellar has no asset index this product reads, so coverage is
              not claimed. Nothing here is ranked, and each note states what an asset is rather than whether it is
              good.
            </p>
          </>
        }
      />

      <PanelGrid label="RWA and tokenized assets">
        <Panel
          id="stellar-rwa-table"
          title="What the issuer can do, and what the ledger shows"
          w={12}
          h={8}
          essential
          scroll
          badge={`${readable} of ${rows.length} read`}
          tone={readable === rows.length ? "evidence" : "caution"}
          headerExtra={
            <InfoControl label="About these columns">
              <p>
                Prior approval, freeze and claw back are account flags on the issuer, enforced by Stellar. A power the
                issuer holds is shown as a caution whichever way it points — this table never says whether an asset is
                good.
              </p>
              <p>
                Holder addresses are addresses, not people: one person can hold many and one address can hold for many.
                The figure is what the ledger reports and nothing more.
              </p>
            </InfoControl>
          }
          footer={<span>Read from the ledger and from each issuer&rsquo;s own account on {STELLAR_MAINNET.label}.</span>}
        >
          <div className="rw-tablewrap">
            <table className="rw-table">
              <thead>
                <tr>
                  <th scope="col">Asset</th>
                  <th scope="col">Prior approval</th>
                  <th scope="col">Freeze</th>
                  <th scope="col">Claw back</th>
                  <th scope="col">Holder addresses</th>
                  <th scope="col">Issuer domain</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ asset, controls, statistics }) => {
                  const ok = isResolved(controls);
                  const power = (held: boolean | null, label: string) =>
                    held === null ? (
                      <span className="st-power" data-held="unknown">
                        Unknown
                      </span>
                    ) : (
                      <span className="st-power" data-held={held ? "yes" : "no"}>
                        {held ? <CheckMark size={12} /> : <CrossMark size={12} />}
                        <span>{held ? "Yes" : "No"}</span>
                        <span className="st-sr">{`${asset.code} ${label}`}</span>
                      </span>
                    );

                  return (
                    <tr key={asset.id}>
                      <th scope="row">
                        <Link className="st-asset" href={assetHref(asset.id)}>
                          <span className="st-code" translate="no">
                            {asset.code}
                          </span>
                          <span className="st-note">{asset.note}</span>
                        </Link>
                      </th>
                      <td>{power(ok ? controls.data.authRequired : null, "prior approval")}</td>
                      <td>{power(ok ? controls.data.authRevocable : null, "freeze")}</td>
                      <td>{power(ok ? controls.data.clawbackEnabled : null, "clawback")}</td>
                      <td>
                        {statistics && isResolved(statistics) ? (
                          <span translate="no">{statistics.data.holderAddresses.toLocaleString("en-US")}</span>
                        ) : (
                          <span className="st-note">Unavailable</span>
                        )}
                      </td>
                      <td>
                        <span className="st-domain" translate="no">
                          {ok ? (controls.data.homeDomain ?? "None declared") : "Unavailable"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel
          id="stellar-rwa-scope"
          title="Why this is a set and not a market"
          w={12}
          h={4}
          scroll
          badge="Curated"
          tone="muted"
          footer={
            <Link className="rw-btn" href="/stellar/workspace/issuers">
              The same assets, by issuer
            </Link>
          }
        >
          <EmptyState title="Coverage is the thing that is missing">
            Every field a market row would carry already resolves — identity, issuer powers, holding requirements,
            supply, the issuer&rsquo;s own declaration. What does not exist is the index: a set of assets to iterate
            rather than one identity to resolve. Until there is one, listing four assets and calling it a market would
            be the overclaim, so it is a set, and adding an asset to it adds a row rather than coverage.
          </EmptyState>
        </Panel>
      </PanelGrid>
    </>
  );
}
