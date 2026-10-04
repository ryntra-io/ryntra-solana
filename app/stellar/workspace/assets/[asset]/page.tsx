import Link from "next/link";
import { notFound } from "next/navigation";

import { ArrowMark, ExternalMark } from "@/app/components/mark";
import { InfoControl } from "@/app/shell/info-control";
import { KeyValue, Panel, PanelGrid } from "@/app/shell/panel";
import { assetExplorerUrl, STELLAR_MAINNET } from "@/lib/stellar/network";
import { parseAsset, type AssetIdentity } from "@/lib/stellar/asset";
import { isResolved } from "@/lib/stellar/evidence";
import { buildAssetPassport } from "@/lib/stellar/passport";
import { StateChip } from "../../hub/parts.tsx";
import { provenanceLine } from "../../hub/provenance.ts";

import styles from "./passport.module.css";

/**
 * The Asset Passport — the Passport template of the Stellar workspace design.
 *
 * The order is the argument: identity, then **what the issuer can do to what you
 * hold**, then what holding it costs, then what the chain records, then what the
 * issuer says about itself. Price and liquidity come last and are currently
 * absent, which the page states rather than hides.
 *
 * Four things the previous version got wrong, each measured on the live page
 * before it was changed:
 *
 * **Identity did not survive scrolling.** It was two cards at the top of a
 * 3,207px document, so 400px down nothing on screen said which asset you were
 * reading. It is a sticky header now — the one element the template fixes in place.
 *
 * **The unknowns rail was the last thing on the page**, roughly 2,700px below
 * the fold, which is the one position that makes a permanent honesty rail
 * pointless. It sits beside the issuer's powers, on the first screen, and it is
 * `essential` so no layout preference can hide it.
 *
 * **Three reasons were printed twice** — once under "Price and liquidity" and
 * again in the rail, about 600 duplicated characters. A reason is now written in
 * exactly one place, the rail; the market panel names each field and its state
 * and says nothing the rail already says.
 *
 * **A ledger fact and the issuer's own marketing wore the same cyan chip.** What
 * the network enforces and what a company publishes about itself on its own
 * domain are different kinds of claim, and rendering them identically is the
 * quiet failure this whole product exists to avoid. The declaration panel now
 * carries an amber `Issuer-declared` badge, and the sentence that used to carry
 * that distinction alone stays beneath it.
 *
 * Nothing here is an action. There is no buy, no swap, no connect — the page
 * exists to be read before any of those become possible.
 */

export const revalidate = 300;

const NETWORK = STELLAR_MAINNET;

function readAsset(raw: string): AssetIdentity | null {
  const parsed = parseAsset(decodeURIComponent(raw));
  return parsed.ok ? parsed.asset : null;
}

export async function generateMetadata({ params }: { params: Promise<{ asset: string }> }) {
  const asset = readAsset((await params).asset);
  return { title: asset ? `${asset.code} passport` : "Asset passport" };
}

/**
 * A ledger amount, grouped.
 *
 * Horizon returns balances as decimal strings and the previous page rendered
 * them raw, so `Holder addresses 842` sat directly above
 * `Held in accounts 10427520.8383549` — two number formats inside one list. The
 * fraction is kept exactly as the ledger stated it; only the integer side is
 * grouped, because rounding a balance to look tidy is the kind of helpfulness a
 * money surface may not offer.
 */
function amount(value: string): string {
  const [whole, fraction] = value.split(".");
  const parsed = Number(whole);
  if (!Number.isFinite(parsed)) return value;
  const grouped = parsed.toLocaleString("en-US");
  return fraction ? `${grouped}.${fraction}` : grouped;
}

function Mono({ children }: { children: React.ReactNode }) {
  return (
    <span className={styles.mono} translate="no">
      {children}
    </span>
  );
}

const yesNo = (value: boolean) => (value ? "Yes" : "No");

/** A power the issuer holds is amber whichever way it points. Green is a
    reconciled fact, and this is not one. */
function Power({ held, yes, no }: { held: boolean; yes: string; no: string }) {
  return (
    <span className="st-power" data-held={held ? "yes" : "no"}>
      {yesNo(held)} — {held ? yes : no}
    </span>
  );
}

export default async function StellarAssetPassportPage({ params }: { params: Promise<{ asset: string }> }) {
  const asset = readAsset((await params).asset);
  /* A malformed or code-only identifier is a 404 rather than a best guess.
     Many different assets share a code on Stellar, and picking one for the
     reader is the single most damaging thing this page could do. */
  if (!asset || asset.native || !asset.issuer) notFound();

  const passport = await buildAssetPassport(NETWORK, asset);
  const controls = passport.issuerControls;
  const demand = passport.holdingDemand;
  const stats = passport.statistics;
  const declaration = passport.declaration;

  const model =
    passport.asset.model === "SAC"
      ? "Classic asset, also reachable as a Soroban contract"
      : passport.asset.model === "CLASSIC"
        ? "Classic asset"
        : "Contract token";

  const openUnknowns = passport.unknowns.length;

  const market = [
    { field: "Oracle", evidence: passport.oracle, clause: "No price source is wired for Stellar." },
    { field: "Liquidity and routes", evidence: passport.liquidity, clause: "No route provider is integrated." },
    { field: "Portfolio impact", evidence: passport.portfolioImpact, clause: "Needs a connected wallet." },
  ];

  return (
    <>
      {/* The template's one fixed element. Code, model, issuer and claimed
          domain stay on screen for the whole page, because a passport you have
          scrolled into is a passport whose subject you can no longer see. */}
      <header className={styles.identity}>
        <span className={styles.identityCode} translate="no">
          {asset.code}
        </span>
        <span className={styles.identityModel}>{model}</span>
        <Mono>{passport.assetId}</Mono>
        <StateChip state={controls.state} />
        <InfoControl label="About this passport">
          <p>
            What this asset is, who controls it, what holding it requires, what its issuer says about it — and what is
            not known. A code is not an identity: many different assets share a code on Stellar, so this page is only
            ever the code together with its issuer.
          </p>
        </InfoControl>
        <span className={styles.identityMeta}>
          {passport.networkLabel} · read-only · {passport.asset.decimals ?? "unknown"} decimal places ·{" "}
          {controls.data?.homeDomain ?? "no domain published"}
        </span>
        <a
          className={styles.identityLink}
          href={assetExplorerUrl(NETWORK, asset.code, asset.issuer)}
          target="_blank"
          rel="noreferrer"
        >
          stellar.expert
          <ExternalMark size={12} />
        </a>
      </header>

      <PanelGrid label={`${asset.code} passport`}>
        {/* First, and deliberately ahead of supply, description and price: on
            Stellar this is the most consequential fact about an asset and the
            one no surface tells a person plainly. */}
        <Panel
          id="passport-controls"
          title="What the issuer can do to what you hold"
          w={8}
          /* Six rows measured 14px past a four-row panel, so the sixth sat under
             a scrollbar. The one fact this page exists to state is not something
             a reader should have to scroll a panel to finish. */
          h={6}
          essential
          scroll
          badge="Ledger fact"
          tone="evidence"
          headerExtra={
            <InfoControl label="Where these powers come from">
              <p>
                Account flags on the issuer, enforced by the network — not claims by anyone. They are read from the
                issuer&rsquo;s own account on each visit, and a power the issuer holds is shown as a caution whichever
                way it points.
              </p>
            </InfoControl>
          }
          footer={<span>{provenanceLine(controls)}</span>}
        >
          {isResolved(controls) ? (
            <>
              <KeyValue label="Can require permission to hold it">
                <Power
                  held={controls.data.authRequired}
                  yes="a holder must be authorized before they can receive it"
                  no="anyone may hold it without asking"
                />
              </KeyValue>
              <KeyValue label="Can freeze a holding">
                <Power
                  held={controls.data.authRevocable}
                  yes="authorization can be revoked after the fact"
                  no="authorization cannot be revoked"
                />
              </KeyValue>
              <KeyValue label="Can take it back">
                <Power
                  held={controls.data.clawbackEnabled}
                  yes="clawback can remove the asset from a holder's account"
                  no="clawback is not enabled"
                />
              </KeyValue>
              <KeyValue label="Can these powers still change">
                {controls.data.authImmutable
                  ? "No — the flags are locked permanently"
                  : "Yes — the issuer may set them later"}
              </KeyValue>
              <KeyValue label="Issuer account">
                <Mono>{controls.data.issuer}</Mono>
              </KeyValue>
              <KeyValue label="Claimed home domain">{controls.data.homeDomain ?? "None published"}</KeyValue>
            </>
          ) : (
            <p className={styles.absent}>{controls.reason}</p>
          )}
        </Panel>

        {/* Permanent, never collapsed, and beside the powers rather than at the
            foot of the document. It is the visible proof that the page does not
            fill gaps, and a proof nobody scrolls to is not one. */}
        <Panel
          id="passport-unknowns"
          title="What we do not know"
          w={4}
          /* Matches the powers panel beside it. A shorter span would leave the
             rail floating above a gap in the same grid row. */
          h={6}
          essential
          scroll
          badge={`${openUnknowns} open`}
          tone={openUnknowns === 0 ? "muted" : "caution"}
          headerExtra={
            <InfoControl label="How this list is built">
              <p>
                Computed from the sections on this page, not written by hand. A field that stops resolving appears here
                on the next read, and this is the only place a reason is written — no section repeats it.
              </p>
            </InfoControl>
          }
        >
          {openUnknowns === 0 ? (
            <p className={styles.absent}>
              Every section resolved on this read. That is a statement about this read, not a guarantee about the
              asset.
            </p>
          ) : (
            <ul className={styles.unknowns}>
              {passport.unknowns.map((item) => (
                <li className={styles.unknown} key={item.field}>
                  <span className={styles.unknownField}>
                    {item.field} <StateChip state={item.state} />
                  </span>
                  <span className={styles.unknownReason}>{item.reason}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          id="passport-holding"
          title="What holding it demands"
          w={6}
          h={4}
          scroll
          badge="Ledger fact"
          tone="evidence"
          headerExtra={
            <InfoControl label="Requirement, not your position">
              <p>
                What the asset requires of any account. No wallet is connected, so this is the requirement rather than
                anything about a holding of yours.
              </p>
            </InfoControl>
          }
          footer={<span>{provenanceLine(demand)}</span>}
        >
          {isResolved(demand) ? (
            <>
              <KeyValue label="Trustline required">
                {yesNo(demand.data.trustlineRequired)}
                {demand.data.trustlineRequired
                  ? " — an account must open one before it can receive this asset"
                  : ""}
              </KeyValue>
              <KeyValue label="Issuer authorization required">{yesNo(demand.data.authorizationRequired)}</KeyValue>
              <KeyValue label="XLM locked while the trustline exists">
                {demand.data.reserveXlm ? <Mono>{demand.data.reserveXlm} XLM</Mono> : "Not read"}
              </KeyValue>
              <KeyValue label="Exposure once held">
                {demand.data.freezable || demand.data.clawbackable
                  ? [
                      demand.data.freezable ? "can be frozen" : null,
                      demand.data.clawbackable ? "can be clawed back" : null,
                    ]
                      .filter(Boolean)
                      .join(" and ")
                  : "Neither freezable nor clawbackable by the issuer"}
              </KeyValue>
            </>
          ) : (
            <p className={styles.absent}>{demand.reason}</p>
          )}
        </Panel>

        <Panel
          id="passport-chain"
          title="What the chain records"
          w={6}
          h={4}
          scroll
          badge="Ledger fact"
          tone="evidence"
          headerExtra={
            <InfoControl label="Addresses, never people">
              <p>
                One person may control many addresses and one address may belong to a service, so this page counts
                addresses and never claims a number of holders.
              </p>
            </InfoControl>
          }
          footer={<span>{provenanceLine(stats)}</span>}
        >
          {isResolved(stats) ? (
            <>
              <KeyValue label="Holder addresses">
                <Mono>{stats.data.holderAddresses.toLocaleString("en-US")}</Mono>
              </KeyValue>
              <KeyValue label="Held in accounts">
                <Mono>{amount(stats.data.authorizedBalance)}</Mono>
              </KeyValue>
              <KeyValue label="Held by contracts">
                <Mono>{amount(stats.data.contractBalance)}</Mono> across{" "}
                <Mono>{stats.data.contractHoldings.toLocaleString("en-US")}</Mono> contracts
              </KeyValue>
              <KeyValue label="Liquidity pools holding it">
                <Mono>{stats.data.liquidityPools.toLocaleString("en-US")}</Mono>
              </KeyValue>
              <KeyValue label="Stellar Asset Contract">
                {stats.data.contractId ? (
                  <Mono>{stats.data.contractId}</Mono>
                ) : (
                  "None — this asset has no contract wrapper"
                )}
              </KeyValue>
            </>
          ) : (
            <p className={styles.absent}>{stats.reason}</p>
          )}
        </Panel>

        {/* Amber, not cyan. Everything in this panel is the issuer describing
            itself on its own domain; wearing the same evidence chip as a
            network-enforced fact is precisely the confusion this product
            exists to remove. */}
        <Panel
          id="passport-declaration"
          title="What the issuer says about it"
          w={12}
          /* Measured 128px past a four-row panel: the caveat, five declared
             fields and the attestation link do not fit, and the caveat is the
             part that must never be the thing scrolled past. */
          h={6}
          scroll
          badge="Issuer-declared"
          tone="caution"
          headerExtra={
            <InfoControl label="Why this is separated">
              <p>
                A ledger fact is enforced by the network. Everything in this panel is published by the issuer on its
                own domain and is unverified by Ryntra — a different kind of claim, so it never wears the evidence
                chip.
              </p>
            </InfoControl>
          }
          footer={<span>{provenanceLine(declaration)}</span>}
        >
          {isResolved(declaration) ? (
            <>
              <p className={styles.declared}>
                Everything below is published by the issuer on <strong>{declaration.data.homeDomain}</strong>, the
                domain its ledger account claims. It is the issuer describing itself. Ryntra has not verified any
                reserve, licence or redemption path stated here.
              </p>
              {!declaration.data.declaresThisAsset ? (
                <p className={styles.absent}>
                  The domain serves a valid stellar.toml, but it does not declare this asset. The issuer publishes no
                  description, backing claim or redemption path for it.
                </p>
              ) : (
                <>
                  <KeyValue label="Organization">{declaration.data.organization.name ?? "Not stated"}</KeyValue>
                  <KeyValue label="Asset name">{declaration.data.currency?.name ?? "Not stated"}</KeyValue>
                  <KeyValue label="Claimed backing">
                    {declaration.data.currency?.isAssetAnchored === true
                      ? `Claimed to be backed by ${declaration.data.currency.anchorAsset ?? "an unnamed asset"}${declaration.data.currency.anchorAssetType ? ` (${declaration.data.currency.anchorAssetType})` : ""}`
                      : declaration.data.currency?.isAssetAnchored === false
                        ? "The issuer states it is not backed by an off-chain asset"
                        : "Not stated"}
                  </KeyValue>
                  <KeyValue label="Redemption, as described by the issuer">
                    {declaration.data.currency?.redemptionInstructions ?? "Not stated"}
                  </KeyValue>
                  <KeyValue label="Description">{declaration.data.currency?.desc ?? "Not stated"}</KeyValue>
                </>
              )}
              {/* A wrapper around a link is not a paragraph. It was a `<p>`,
                  which put a link block in the same element the prose gate
                  polices — correctly, because that is how prose creeps back. */}
              {declaration.data.currency?.attestationOfReserve ? (
                <div className={styles.linksBlock}>
                  <a
                    className={styles.identityLink}
                    href={declaration.data.currency.attestationOfReserve}
                    target="_blank"
                    rel="noreferrer nofollow"
                  >
                    Reserve attestation the issuer published
                    <ExternalMark size={12} />
                  </a>
                </div>
              ) : null}
            </>
          ) : (
            <p className={styles.absent}>{declaration.reason}</p>
          )}
        </Panel>

        {/* Named because the Passport template names them, and short because
            the rail already carries every reason. Three sentences of
            explanation used to live here and again in the rail. */}
        <Panel
          id="passport-market"
          title="Price, liquidity and exposure"
          w={12}
          /* This one was the worst of the three: 40px of content past a
             two-row panel with `scroll` off, so it was clipped with no
             scrollbar and no way to reach it. Absent evidence that is itself
             invisible is the exact failure this panel exists to prevent. */
          h={4}
          badge="Not built"
          tone="muted"
          headerExtra={
            <InfoControl label="Why these are empty">
              <p>
                Each one needs something this workspace does not have yet — a price source, a route provider, or a
                connected wallet. The exact reason for each is in the unknowns panel above, written once.
              </p>
            </InfoControl>
          }
        >
          {market.map((row) => (
            <KeyValue key={row.field} label={row.field}>
              <StateChip state={row.evidence.state} /> {row.clause}
            </KeyValue>
          ))}
        </Panel>
      </PanelGrid>

      <div className={styles.back}>
        <Link className="rw-btn" href="/stellar/workspace/assets">
          <ArrowMark size={12} className={styles.backArrow} />
          All assets
        </Link>
      </div>
    </>
  );
}
