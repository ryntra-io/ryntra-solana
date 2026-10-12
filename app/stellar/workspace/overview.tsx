"use client";

import Link from "next/link";

import { CheckMark, CrossMark } from "@/app/components/mark";
import { InfoControl } from "@/app/shell/info-control";
import { AlertStrip, EmptyState, KeyValue, Metric, MetricRow, Panel, PanelGrid } from "@/app/shell/panel";
import { type Evidence, isResolved } from "@/lib/stellar/evidence";
import type { IssuerControlEvidence, LedgerParameters, NetworkPulse } from "@/lib/stellar/reads";
import { STELLAR_TESTNET, transactionExplorerUrl } from "@/lib/stellar/network";
import { ACTIVITY_COPY } from "@/lib/stellar/activity/record";
import { WALLET_COPY } from "@/lib/stellar/wallets/states";
import { useStellarWallet } from "../components/stellar-wallet-provider.tsx";
import { assetHref, type FeaturedAsset } from "./assets/featured.ts";
import { attentionItems, blockingCount } from "./hub/attention.ts";
import { AttentionRow, PageHead } from "./hub/parts.tsx";
import { provenanceLine } from "./hub/provenance.ts";
import { useStellarActivity } from "./hub/use-activity.ts";

/**
 * Stellar Hub — mission control.
 *
 * This page has been wrong twice, in opposite directions. First it was four
 * cards and two blocks of prose, which correctly read as a test page.
 * Then it became a good single-purpose screen — the network, and what each
 * issuer can do to a holding — with a sentence at the bottom saying *"read one
 * asset completely and say what is unknown about it; that is the whole of it."*
 *
 * That sentence was true when it was written and false two releases later. This
 * workspace now builds, authorizes, signs, submits, observes and reconciles a
 * real Stellar Testnet payment, and verifies its own receipts. A front door that
 * describes a smaller product than the one behind it is not modesty; it is the
 * same drift as an overclaim, pointing the other way.
 *
 * So the page answers four questions in the order a person actually has them:
 *
 * ```text
 * is anything wrong        Attention
 * what do I do next        Next action
 * what has this proven     Proof on record
 * what is true right now   Network, account, issuer powers, sources
 * ```
 *
 * **Three panels are honestly empty**, and they say why rather than pretending.
 * Watched assets and recent activity both need somewhere to keep state between
 * sessions, and this workspace keeps none — so each names the module that would
 * change that and links to what does exist today. An empty state that sells the
 * next step is the contract; a fabricated row would not be.
 *
 * **The middle-right panel is still the argument.** Every other Stellar surface
 * in the world opens with price and supply. On Stellar the fact that decides a
 * holder's outcome is whether the issuer can freeze or claw back what they hold
 * — a power granted by account flags, enforced by the network, and stated
 * nowhere a person would look. A power the issuer holds renders **amber, never
 * green**: green is reserved for a reconciled fact, and colouring the absence of
 * a power as success would be editorial.
 */

type IssuerRow = Readonly<{ asset: FeaturedAsset; controls: Evidence<IssuerControlEvidence> }>;

/** A power the issuer holds over a holding, or the honest absence of an answer. */
function Power({ held, label }: { held: boolean | null; label: string }) {
  if (held === null) {
    return (
      <span className="st-power" data-held="unknown">
        Unknown
      </span>
    );
  }
  return (
    <span className="st-power" data-held={held ? "yes" : "no"}>
      {held ? <CheckMark size={12} /> : <CrossMark size={12} />}
      <span>{held ? "Yes" : "No"}</span>
      <span className="st-sr">{label}</span>
    </span>
  );
}

/**
 * The two transactions this product has actually recorded.
 *
 * They are constants because they are history: two real Stellar Testnet
 * transactions, both reconciled, one of them signed by the owner in their own
 * wallet. They are labelled as the product's record and never as the reader's
 * activity — a page that shows somebody else's proof where a person expects
 * their own is the exact thing the delivery contract forbids.
 */
const PROOF_ON_RECORD = [
  {
    id: "owner-signed",
    hash: "1cf2324346b95d8b350f8316e5aec76063bc827c45819bb7d8cecd4c1a45c95c",
    ledger: "4,126,028",
    closed: "2026-08-13",
    operation: "Payment, XLM",
    reconciliation: "MATCHED",
    note: "Signed by the owner in Freighter. Balances moved exactly as authorized.",
  },
  {
    id: "no-signature",
    hash: "7b0f3ad515e18455cab8abd0749bb7a1ab39c7c3baa85f78f49bfec1a332fd45",
    ledger: "4,124,276",
    closed: "2026-08-13",
    operation: "Payment, classic",
    reconciliation: "MATCHED",
    note: "Reconciled with no signature involved, because the expectation can come from what the ledger stores.",
  },
] as const;

export function StellarOverview({
  pulse,
  parameters,
  issuers,
  moduleCounts,
}: {
  pulse: Evidence<NetworkPulse>;
  parameters: Evidence<LedgerParameters>;
  issuers: readonly IssuerRow[];
  moduleCounts: Readonly<{ available: number; registered: number }>;
}) {
  const { state: walletState, address, connect, installUrl, expectedNetwork } = useStellarWallet();
  const { records, ready: activityReady, retained } = useStellarActivity();

  const pulseTone = isResolved(pulse) ? (pulse.state === "FRESH" ? "evidence" : "caution") : "muted";
  /* Two named reads rather than one compound expression, because the prose gate
     forbids `isResolved(x) && …` anywhere in an evidence surface — the shorthand
     that renders nothing at all when a read fails. Naming them first keeps the
     boolean logic legal and every render position a ternary. */
  const pulseOk = isResolved(pulse);
  const parametersOk = isResolved(parameters);
  const sourcesAnswering = pulseOk && parametersOk;

  /* The same computation the Attention & Recovery page runs, not a second one.
     Every time this repository has had two lists that must agree, they have
     disagreed silently. */
  const attention = attentionItems({
    wallet: walletState,
    expectedNetwork,
    pulse,
    parameters,
    issuers,
    activity: records,
    retained,
  });
  const blocking = blockingCount(attention);
  const connected = walletState === "CONNECTED" || walletState === "SIGNING" || walletState === "SIGNED";

  return (
    <>
      <PageHead
        title="Stellar Hub"
        module="overview"
        lead={
          <>
            <p>
              Understand an asset the way Stellar actually works — its exact identity, the powers its issuer holds over
              your holding, what holding it costs, and what nobody has verified. Then prepare a controlled action and
              verify what the ledger recorded.
            </p>
            <p>
              Two environments, deliberately. Everything you read here is Stellar Mainnet and moves nothing. Everything
              you can sign is Stellar Testnet, where the assets have no worth. Mainnet execution is a separate release
              gate and no setting on this page reaches it.
            </p>
          </>
        }
      />

      <PanelGrid label="Stellar Hub">
        <Panel
          id="stellar-pulse"
          title="Network"
          w={12}
          /* 9px of the strip sat below its own fold in both locales. */
          h={4}
          metric
          essential
          badge={isResolved(pulse) ? pulse.state : "UNAVAILABLE"}
          tone={pulseTone}
          footer={<span>{provenanceLine(pulse)}</span>}
        >
          {isResolved(pulse) ? (
            <MetricRow>
              <Metric
                label="Ledger"
                value={<span translate="no">{pulse.data.ledgerSequence.toLocaleString("en-US")}</span>}
                size="lg"
                sub="Closes roughly every five seconds."
              />
              <Metric label="Protocol" value={<span translate="no">v{pulse.data.protocolVersion}</span>} />
              <Metric
                label="Endpoint"
                value={pulse.data.status}
                dot={pulse.state === "FRESH" ? "up" : "warn"}
                live={pulse.state === "FRESH"}
              />
              <Metric
                label="Readable history"
                value={
                  pulse.data.retentionLedgers === null ? (
                    "Unknown"
                  ) : (
                    <span translate="no">{pulse.data.retentionLedgers.toLocaleString("en-US")}</span>
                  )
                }
                sub="Ledgers this endpoint still answers for."
              />
              <Metric
                label="Base fee"
                value={
                  isResolved(parameters) ? (
                    <span translate="no">{parameters.data.baseFeeStroops.toLocaleString("en-US")}</span>
                  ) : (
                    "Unavailable"
                  )
                }
                sub="Stroops per operation."
              />
              <Metric
                label="Trustline reserve"
                value={
                  isResolved(parameters) ? (
                    <span translate="no">{parameters.data.baseReserveXlm} XLM</span>
                  ) : (
                    "Unavailable"
                  )
                }
                sub="Locked while a trustline exists."
              />
            </MetricRow>
          ) : (
            <p className="rw-lead">{pulse.reason}</p>
          )}
        </Panel>

        <Panel
          id="stellar-attention"
          title="Attention"
          w={4}
          h={4}
          essential
          scroll
          badge={blocking > 0 ? `${blocking} blocking` : attention.length > 0 ? `${attention.length} to note` : "Clear"}
          tone={blocking > 0 ? "caution" : "muted"}
          headerExtra={
            <InfoControl label="About attention">
              <p>
                Every item here is computed from a fact already on this page — the wallet state machine, the evidence
                state of a read, or a source that did not answer — rather than authored by hand. Action required comes
                first, then caution, then context. Nothing is listed that a person cannot act on or does not need to
                know.
              </p>
            </InfoControl>
          }
          footer={
            <Link className="rw-btn" href="/stellar/workspace/attention">
              Attention &amp; Recovery
            </Link>
          }
        >
          {attention.length === 0 ? (
            <EmptyState title="Nothing needs you">
              Every source answered, the wallet is on {expectedNetwork}, and no stored lifecycle is waiting.
            </EmptyState>
          ) : (
            <div className="st-attn">
              {attention.slice(0, 4).map((item) => (
                <AttentionRow key={item.id} item={item} dense />
              ))}
            </div>
          )}
        </Panel>

        <Panel
          id="stellar-next"
          title="Next action"
          w={4}
          h={4}
          essential
          scroll
          badge="One at a time"
          tone="evidence"
          footer={<span>The one thing worth doing from here.</span>}
        >
          {walletState === "WRONG_NETWORK" ? (
            <>
              <AlertStrip tone="warn">
                Freighter is on a different network. Switch it to {expectedNetwork} — Ryntra cannot switch it for you,
                and will not ask for a signature until it matches.
              </AlertStrip>
              <div className="rw-hair" />
              <KeyValue label="Why it is blocked">
                A wallet on the wrong network signs happily, and the signature is valid — over the wrong network.
              </KeyValue>
            </>
          ) : walletState === "NOT_INSTALLED" ? (
            <>
              <KeyValue label="Install the wallet">
                Sending needs a browser extension that holds your key. Reading does not.
              </KeyValue>
              <div className="rw-hair" />
              <a className="rw-btn" href={installUrl} target="_blank" rel="noreferrer noopener">
                Install Freighter
              </a>
            </>
          ) : connected ? (
            <>
              <KeyValue label="Ready">
                A wallet is connected on {expectedNetwork}. Everything after the signature — comparison, submission,
                ledger observation, reconciliation and the receipt — runs on the Send surface.
              </KeyValue>
              <div className="rw-hair" />
              <Link className="rw-btn" href="/stellar/workspace/send">
                Send a testnet payment
              </Link>
            </>
          ) : (
            <>
              <KeyValue label={WALLET_COPY[walletState].title}>{WALLET_COPY[walletState].body}</KeyValue>
              <div className="rw-hair" />
              <button className="rw-btn" type="button" onClick={() => void connect()}>
                {WALLET_COPY[walletState].action ?? "Connect Stellar wallet"}
              </button>
            </>
          )}
        </Panel>

        <Panel
          id="stellar-proof"
          title="Proof on record"
          w={4}
          h={4}
          scroll
          badge="Testnet"
          tone="verified"
          headerExtra={
            <InfoControl label="About this record">
              <p>
                These are the transactions this product has put on a ledger and reconciled, not your activity — this
                workspace retains nothing between sessions. Each one can be checked without trusting Ryntra: paste the
                hash into the Receipts surface, which reads the ledger again from scratch and recomputes every hash on
                the receipt from the document&rsquo;s own contents.
              </p>
            </InfoControl>
          }
          footer={
            <Link className="rw-btn" href="/stellar/workspace/receipts">
              Check one yourself
            </Link>
          }
        >
          {PROOF_ON_RECORD.map((proof) => (
            <KeyValue
              key={proof.id}
              label={
                <a href={transactionExplorerUrl(STELLAR_TESTNET, proof.hash)} target="_blank" rel="noreferrer noopener">
                  <span translate="no">{proof.hash.slice(0, 8)}</span>
                </a>
              }
            >
              <span className="st-proof">
                <span>
                  {proof.operation} &middot; ledger <span translate="no">{proof.ledger}</span> &middot; {proof.closed}
                </span>
                <span className="sh-state" data-state="FRESH">
                  {proof.reconciliation}
                </span>
                <span className="st-note">{proof.note}</span>
              </span>
            </KeyValue>
          ))}
        </Panel>

        <Panel
          id="stellar-account"
          /* `Your Stellar account` did not fit beside its own `Not connected`
             chip in a w=4 header, so it truncated to `Your Stellar accou…`. */
          title="Your account"
          w={4}
          h={4}
          scroll
          badge={connected ? "Connected" : "Not connected"}
          tone={connected ? "evidence" : "muted"}
          footer={<span>{connected ? `Freighter on ${expectedNetwork}` : "Public mainnet reads stay open."}</span>}
        >
          {connected && address ? (
            <>
              <KeyValue label="Address">
                <span translate="no">
                  {address.slice(0, 6)}&hellip;{address.slice(-6)}
                </span>
              </KeyValue>
              <KeyValue label="Wallet network">{expectedNetwork}</KeyValue>
              <KeyValue label="Balances and trustlines">
                Not read yet. Account reads for a connected wallet are registered and not built.
              </KeyValue>
            </>
          ) : (
            <EmptyState
              title="Connect a Stellar Testnet wallet"
              action={
                <button className="rw-btn" type="button" onClick={() => void connect()}>
                  Connect Stellar wallet
                </button>
              }
            >
              Public mainnet intelligence — assets, issuers, ledger state — remains available without one.
            </EmptyState>
          )}
        </Panel>

        <Panel
          id="stellar-watched"
          title="Watched assets"
          w={4}
          h={4}
          scroll
          badge="Not built"
          tone="muted"
          footer={<span>Registered on the Hub Map with its gate.</span>}
        >
          <EmptyState
            title="Nothing is watched"
            action={
              <Link className="rw-btn" href="/stellar/workspace/assets">
                Open an asset
              </Link>
            }
          >
            Watching needs somewhere to keep a list between sessions, and this workspace keeps none. Every asset can be
            read in full today; only the list is missing.
          </EmptyState>
        </Panel>

        <Panel
          id="stellar-activity"
          title="Recent activity"
          w={4}
          h={4}
          scroll
          badge={activityReady ? `${records.length} kept` : "Reading"}
          tone={records.length > 0 ? "evidence" : "muted"}
          footer={
            <Link className="rw-btn" href="/stellar/workspace/activity">
              Open Activity
            </Link>
          }
        >
          {records.length === 0 ? (
            <EmptyState
              title={retained ? "Nothing has been prepared yet" : "This browser keeps nothing"}
              action={
                <Link className="rw-btn" href="/stellar/workspace/send">
                  Prepare a payment
                </Link>
              }
            >
              {retained
                ? "A record appears the moment an intent is checked — including one the preflight refuses, because a payment stopped before a signature is the most useful row there is."
                : "Local storage is unavailable here, so a payment can still be prepared, signed and verified and no record of it will survive the page."}
            </EmptyState>
          ) : (
            <>
              {records.slice(0, 4).map((record) => (
                <KeyValue
                  key={record.id}
                  label={
                    <span translate="no">
                      {record.amount} {record.assetCode}
                    </span>
                  }
                >
                  {ACTIVITY_COPY[record.state].label}
                  {record.transactionHash ? (
                    <span className="st-note">
                      <span translate="no">{record.transactionHash.slice(0, 8)}</span>
                    </span>
                  ) : null}
                </KeyValue>
              ))}
            </>
          )}
        </Panel>

        <Panel
          id="stellar-powers"
          title="What the issuer can do to your holding"
          w={8}
          h={4}
          essential
          scroll
          badge="Ledger fact"
          tone="evidence"
          headerExtra={
            <InfoControl label="About issuer powers">
              <p>
                These are account flags on the issuer, enforced by the network — not a promise in a document. Prior
                approval means the issuer must authorize you before you can hold the asset at all; freeze means it can
                revoke that authorization later; claw back means it can take the asset out of your account. A power the
                issuer holds is shown as a caution whichever way it points, and this table never says whether an asset
                is good.
              </p>
            </InfoControl>
          }
          footer={<span>Read from each issuer&rsquo;s own account on Stellar Mainnet.</span>}
        >
          <div className="rw-tablewrap">
            <table className="rw-table">
              <thead>
                <tr>
                  <th scope="col">Asset</th>
                  <th scope="col">Prior approval</th>
                  <th scope="col">Freeze</th>
                  <th scope="col">Claw back</th>
                  <th scope="col">Domain</th>
                </tr>
              </thead>
              <tbody>
                {issuers.map(({ asset, controls }) => {
                  const ok = isResolved(controls);
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
                      <td>
                        <Power held={ok ? controls.data.authRequired : null} label={`${asset.code} prior approval`} />
                      </td>
                      <td>
                        <Power held={ok ? controls.data.authRevocable : null} label={`${asset.code} freeze`} />
                      </td>
                      <td>
                        <Power held={ok ? controls.data.clawbackEnabled : null} label={`${asset.code} clawback`} />
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
          id="stellar-sources"
          title="Source health"
          w={4}
          h={4}
          scroll
          badge={sourcesAnswering ? "Answering" : "Degraded"}
          tone={sourcesAnswering ? "evidence" : "caution"}
          headerExtra={
            <InfoControl label="About source health">
              <p>
                Health here is the last read rather than a record — nothing is retained, so this says whether each
                source answered the request that built this page, not how it has behaved over time. A failing source
                costs only its own section; it never blanks the page.
              </p>
            </InfoControl>
          }
          footer={
            <Link className="rw-btn" href="/stellar/workspace/developers">
              Every read and its source
            </Link>
          }
        >
          <KeyValue label="Ledger and protocol">
            {isResolved(pulse) ? `${pulse.state} — ${provenanceLine(pulse)}` : pulse.reason}
          </KeyValue>
          <KeyValue label="Fees and reserve">
            {isResolved(parameters) ? `${parameters.state} — ${provenanceLine(parameters)}` : parameters.reason}
          </KeyValue>
          <KeyValue label="Issuer accounts">
            {`${issuers.filter((row) => isResolved(row.controls)).length} of ${issuers.length} answered`}
          </KeyValue>
          <div className="rw-hair" />
          <MetricRow>
            <Metric label="Surfaces you can open" value={moduleCounts.available} size="lg" />
            <Metric label="Registered, not built" value={moduleCounts.registered} />
          </MetricRow>
        </Panel>
      </PanelGrid>
    </>
  );
}
