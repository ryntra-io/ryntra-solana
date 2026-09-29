import { InfoControl } from "@/app/shell/info-control";
import { Metric, MetricRow, Panel, PanelGrid } from "@/app/shell/panel";
import { isResolved } from "@/lib/stellar/evidence";
import { readLedgerParameters, readNetworkPulse } from "@/lib/stellar/reads";
import { STELLAR_MAINNET } from "@/lib/stellar/network";
import { PageHead } from "../hub/parts.tsx";
import { provenanceLine } from "../hub/provenance.ts";

export const revalidate = 60;

export const metadata = { title: "Network" };

/**
 * Network.
 *
 * The one page where endpoint detail belongs — the top bar is not a dashboard.
 * It reports the ledger, the protocol, the cost of a transaction and, unusually
 * for a network page, **the endpoint's own horizon**: how far back it can answer
 * at all. Without that, "not found" and "no longer retained" look identical to
 * everything downstream, and only one of them means the thing did not happen.
 *
 * Eight separate cards became three panels. The figures did not change; what
 * changed is that they are now grouped by the question they answer — is it
 * running, how far back can it see, what does it cost — instead of being eight
 * equal boxes that make a reader do the grouping themselves.
 */
export default async function StellarNetworkPage() {
  const [pulse, parameters] = await Promise.all([
    readNetworkPulse(STELLAR_MAINNET),
    readLedgerParameters(STELLAR_MAINNET),
  ]);

  const pulseOk = isResolved(pulse);
  const paramsOk = isResolved(parameters);
  const number = (value: number) => (
    <span translate="no">{value.toLocaleString("en-US")}</span>
  );

  return (
    <>
      <PageHead
        title="Network"
        module="network"
        lead={
          <>
            <p>
              Read live from Stellar RPC and Horizon. Every figure carries the source that answered and how long ago
              it did.
            </p>
            <p>
              Stellar RPC answers the ledger and the endpoint horizon. Horizon answers the base fee, the base reserve,
              issuer flags, trustlines and asset statistics — the facts that are JSON there and XDR everywhere else.
              Horizon is nearing end-of-life in favour of RPC and SDF&rsquo;s Portfolio APIs, so every read records
              which source answered: replacing one later is a source change, not a rewrite.
            </p>
          </>
        }
      />

      <PanelGrid label="Network">
        <Panel
          id="stellar-net-ledger"
          title="Ledger"
          w={12}
          h={2}
          metric
          essential
          badge={pulse.state}
          tone={pulseOk && pulse.state === "FRESH" ? "evidence" : "caution"}
          footer={<span>{provenanceLine(pulse)}</span>}
        >
          {pulseOk ? (
            <MetricRow>
              <Metric label="Latest ledger" value={number(pulse.data.ledgerSequence)} size="lg" />
              <Metric
                label="Closed at"
                value={
                  <span translate="no">
                    {new Date(pulse.data.closedAt).toISOString().replace("T", " ").slice(0, 19)}
                  </span>
                }
                sub="UTC. Ledgers close roughly every five seconds."
              />
              <Metric label="Protocol" value={<span translate="no">v{pulse.data.protocolVersion}</span>} />
              <Metric
                label="Endpoint"
                value={pulse.data.status}
                dot={pulse.state === "FRESH" ? "up" : "warn"}
                live={pulse.state === "FRESH"}
                sub="The endpoint's own word for itself."
              />
            </MetricRow>
          ) : (
            <p className="rw-lead">{pulse.reason}</p>
          )}
        </Panel>

        <Panel
          id="stellar-net-horizon"
          title="How far back this endpoint can answer"
          w={6}
          h={4}
          /* Pro only, and this is the whole reason the mode control exists.
             Guided and Pro rendered a byte-identical canvas until now — a depth
             control that changes nothing is worse than no control, because it
             teaches a person that the product's settings are decorative.
             Retention is an indexer's concern: it decides whether "not found"
             means "never happened", which matters when you are debugging a
             missing receipt and not when you are reading an asset. Fees and the
             reserve stay visible in both, because depth may hide detail and
             never consequence. */
          advanced
          badge={pulseOk && pulse.data.oldestLedger !== null ? "Stated" : "Not stated"}
          tone={pulseOk && pulse.data.oldestLedger !== null ? "evidence" : "muted"}
          headerExtra={
            <InfoControl label="Why the horizon matters">
              <p>
                Below the oldest readable ledger the endpoint has nothing to return. That answer is
                indistinguishable from <em>the event never happened</em> unless the horizon is known — which is why it
                is read and shown rather than assumed, and why a receipt that cannot be found near this boundary is not
                evidence of anything.
              </p>
            </InfoControl>
          }
          footer={<span>{provenanceLine(pulse)}</span>}
        >
          {pulseOk ? (
            <MetricRow>
              <Metric
                label="Oldest readable ledger"
                value={pulse.data.oldestLedger === null ? "Not stated" : number(pulse.data.oldestLedger)}
                size="lg"
              />
              <Metric
                label="Retention window"
                value={pulse.data.retentionLedgers === null ? "Not stated" : number(pulse.data.retentionLedgers)}
                sub="Ledgers kept."
              />
            </MetricRow>
          ) : (
            <p className="rw-lead">{pulse.reason}</p>
          )}
        </Panel>

        <Panel
          id="stellar-net-cost"
          title="What the ledger charges"
          w={6}
          h={4}
          badge={parameters.state}
          tone={paramsOk && parameters.state === "FRESH" ? "evidence" : "caution"}
          headerExtra={
            <InfoControl label="About the reserve">
              <p>
                The base reserve is locked per subentry, and a trustline is one subentry — so holding an issued asset
                costs XLM that stays locked for as long as the trustline exists. It is read from the ledger here rather
                than hardcoded, because it is a network parameter and not a constant.
              </p>
            </InfoControl>
          }
          footer={<span>{provenanceLine(parameters)}</span>}
        >
          {paramsOk ? (
            <MetricRow>
              <Metric
                label="Base fee"
                value={number(parameters.data.baseFeeStroops)}
                size="lg"
                sub="Stroops per operation, at the current ledger."
              />
              <Metric
                label="Base reserve"
                value={<span translate="no">{parameters.data.baseReserveXlm} XLM</span>}
                sub="Locked per subentry. A trustline costs one."
              />
            </MetricRow>
          ) : (
            <p className="rw-lead">{parameters.reason}</p>
          )}
        </Panel>
      </PanelGrid>
    </>
  );
}
