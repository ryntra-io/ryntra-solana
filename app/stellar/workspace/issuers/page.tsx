import Link from "next/link";

import { CheckMark, CrossMark } from "@/app/components/mark";
import { InfoControl } from "@/app/shell/info-control";
import { EmptyState, KeyValue, Panel, PanelGrid } from "@/app/shell/panel";
import { STELLAR_MAINNET } from "@/lib/stellar/network";
import { isResolved, readIssuerProfile } from "@/lib/stellar/observe";
import { assetHref, FEATURED_ASSETS } from "../assets/featured.ts";
import { PageHead } from "../hub/parts.tsx";

export const revalidate = 300;

export const metadata = { title: "Issuers & Anchors" };

/**
 * Issuers & Anchors.
 *
 * The Passport starts from one asset and asks who issued it. This starts from
 * one **issuer** and asks what it has issued, what powers it holds over every
 * holding of those assets at once, and what it says about itself.
 *
 * ## The limit is in the page, not in a footnote
 *
 * There is no asset index on Stellar this product reads, so "every asset by
 * issuer" is not available and is not claimed. What this shows is every asset
 * **we already know about**, grouped by its issuer — which the read layer
 * carries as `scope: "CURATED"` rather than leaving each surface to remember.
 * Calling that a directory would be the overclaim; calling it a set is what it
 * is.
 *
 * ## Anchors
 *
 * An anchor is where onchain value meets an offchain obligation, and reading one
 * means SEP-6 or SEP-24 endpoints this adapter does not call. So the anchor half
 * of this page's name is honest about being unbuilt rather than quietly folded
 * into the issuer half — a domain publishing a `TRANSFER_SERVER` is a fact worth
 * showing, and it is not the same as having read that server.
 */
export default async function StellarIssuersPage() {
  const addresses = [...new Set(FEATURED_ASSETS.map((asset) => asset.issuer))];

  const profiles = await Promise.all(
    addresses.map((issuer) =>
      readIssuerProfile(
        STELLAR_MAINNET,
        issuer,
        FEATURED_ASSETS.filter((asset) => asset.issuer === issuer),
      ),
    ),
  );

  return (
    <>
      <PageHead
        title="Issuers & Anchors"
        module="issuers"
        lead={
          <>
            <p>
              One issuer at a time: the powers its account holds over every holding of its assets, what it has issued
              out of the set this workspace knows about, and what it declares about itself.
            </p>
            <p>
              An issuer&rsquo;s own declaration is the issuer describing itself. It carries no more authority than a
              company&rsquo;s website, which is exactly what it is, and it is labelled that way wherever it appears.
              The account flags beside it are enforced by the network and are a different kind of fact entirely.
            </p>
            <p>
              This is a curated set read live, not a directory of every Stellar issuer. No index exists here that would
              make the stronger claim true.
            </p>
          </>
        }
      />

      <PanelGrid label="Issuers and anchors">
        {profiles.map((profile) => {
          const ok = isResolved(profile.controls);
          const domain = ok ? profile.controls.data.homeDomain : null;
          const power = (held: boolean | null, label: string) =>
            held === null ? (
              <span className="st-power" data-held="unknown">
                Unknown
              </span>
            ) : (
              <span className="st-power" data-held={held ? "yes" : "no"}>
                {held ? <CheckMark size={12} /> : <CrossMark size={12} />}
                <span>{held ? "Yes" : "No"}</span>
                <span className="st-sr">{label}</span>
              </span>
            );

          return (
            <Panel
              key={profile.address}
              id={`stellar-issuer-${profile.address.slice(0, 8)}`}
              title={profile.organization?.name ?? domain ?? "Issuer"}
              w={12}
              h={8}
              essential
              scroll
              badge={ok ? "Ledger fact" : "Unavailable"}
              tone={ok ? "evidence" : "muted"}
              headerExtra={
                <InfoControl label="About this issuer">
                  <p>
                    The powers row is account flags on the issuer, enforced by Stellar itself. The declaration below it
                    is the issuer&rsquo;s own `stellar.toml`, unverified by Ryntra. When the two disagree, the flags are
                    the fact and the document is a claim.
                  </p>
                </InfoControl>
              }
              footer={
                <span>
                  <span className="st-domain" translate="no">
                    {profile.address}
                  </span>
                </span>
              }
            >
              <div className="rw-tablewrap">
                <table className="rw-table">
                  <thead>
                    <tr>
                      <th scope="col">Power over every holding</th>
                      <th scope="col">Prior approval</th>
                      <th scope="col">Freeze</th>
                      <th scope="col">Claw back</th>
                      <th scope="col">Home domain</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <th scope="row">Account flags</th>
                      <td>{power(ok ? profile.controls.data.authRequired : null, "prior approval")}</td>
                      <td>{power(ok ? profile.controls.data.authRevocable : null, "freeze")}</td>
                      <td>{power(ok ? profile.controls.data.clawbackEnabled : null, "clawback")}</td>
                      <td>
                        <span className="st-domain" translate="no">
                          {domain ?? "None declared"}
                        </span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="rw-hair" />

              <KeyValue label="Assets we read from this issuer">
                <span className="st-proof">
                  {profile.assets.map((asset) => (
                    <Link className="st-asset" href={assetHref(asset.id)} key={asset.id}>
                      <span className="st-code" translate="no">
                        {asset.code}
                      </span>
                      <span className="st-note">{asset.note}</span>
                    </Link>
                  ))}
                </span>
              </KeyValue>

              {profile.declarationReason ? (
                <KeyValue label="Issuer declaration">{profile.declarationReason}</KeyValue>
              ) : (
                <>
                  <KeyValue label="Declared name">
                    {profile.organization?.name ?? "The domain publishes a file with no organisation name."}
                  </KeyValue>
                  <KeyValue label="Declared licensing">
                    {profile.organization?.licensingAuthority
                      ? `${profile.organization.licensingAuthority}${profile.organization.licenseNumber ? ` · ${profile.organization.licenseNumber}` : ""}`
                      : "The issuer states no licensing authority in its own file. That is an absence of a claim, not evidence of one either way."}
                  </KeyValue>
                  <KeyValue label="Declared address">
                    {profile.organization?.physicalAddress ?? "Not stated by the issuer."}
                  </KeyValue>
                  <KeyValue label="Declared for each asset">
                    {profile.assets.filter((asset) => asset.declaration !== null).length} of {profile.assets.length}{" "}
                    carry a currency entry in the issuer&rsquo;s own file.
                  </KeyValue>
                </>
              )}

              <KeyValue label="Anchor services">
                Not read. Deposit and withdrawal are SEP-6 and SEP-24 endpoints this adapter does not call, so nothing
                here says whether this issuer operates one.
              </KeyValue>
            </Panel>
          );
        })}

        <Panel
          id="stellar-issuers-scope"
          title="What this page is not"
          w={12}
          h={4}
          scroll
          badge="Curated set"
          tone="muted"
          footer={
            <Link className="rw-btn" href="/stellar/workspace/map">
              What the index would take
            </Link>
          }
        >
          <EmptyState title="Not a directory of Stellar issuers">
            Stellar has no index this product reads, so every asset by issuer is not available and is not claimed. What
            is above is the set this workspace knows about, resolved live against each issuer&rsquo;s own account and
            its own published file. Adding an asset to that set adds it here; it does not make this a market.
          </EmptyState>
        </Panel>
      </PanelGrid>
    </>
  );
}
