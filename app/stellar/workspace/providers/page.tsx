import { InfoControl } from "@/app/shell/info-control";
import { KeyValue, Metric, MetricRow, Panel, PanelGrid } from "@/app/shell/panel";
import { STELLAR_MAINNET } from "@/lib/stellar/network";
import { issuerProviderRows, providerSummary, readIssuerProfile, readProviderReport } from "@/lib/stellar/observe";
import { FEATURED_ASSETS } from "../assets/featured.ts";
import { PageHead } from "../hub/parts.tsx";

export const revalidate = 60;

export const metadata = { title: "Providers" };

/**
 * Providers.
 *
 * Every external source this workspace depends on, whether it answered the
 * request that built this page, and what breaks when it does not. It is the
 * surface that turns "the page looks empty" into "Horizon is down and here is
 * what that costs".
 *
 * **`GATED` is its own state and not a failure.** Soroswap is reachable and
 * answers its health endpoint without a credential; its quotes need an API key
 * this deployment does not hold. Reporting that as an outage would send somebody
 * looking for a problem that does not exist, so it says what is true: reachable,
 * indexing four venues, and one named action away from being useful.
 *
 * Health here is **the last read, not a record**. Nothing is retained, so this
 * says whether each source answered a moment ago rather than how it has behaved
 * over time — and it says that rather than implying the stronger thing.
 */
export default async function StellarProvidersPage() {
  const issuerAddresses = [...new Set(FEATURED_ASSETS.map((asset) => asset.issuer))];

  const [report, ...profiles] = await Promise.all([
    readProviderReport(STELLAR_MAINNET),
    ...issuerAddresses.map((issuer) =>
      readIssuerProfile(
        STELLAR_MAINNET,
        issuer,
        FEATURED_ASSETS.filter((asset) => asset.issuer === issuer),
      ),
    ),
  ]);

  const rows = [...report.providers, ...issuerProviderRows(profiles)];
  const summary = providerSummary(rows);

  return (
    <>
      <PageHead
        title="Providers"
        module="providers"
        lead={
          <>
            <p>
              Every external source this workspace reads, what it is for, and whether it answered the request that
              built this page. A failing source costs only its own section — it never blanks a page and never turns
              into an invented value.
            </p>
            <p>
              This is the last read rather than a record. Nothing is retained on a Ryntra server, so there is no
              history here to trend and none is implied.
            </p>
          </>
        }
      />

      <PanelGrid label="Providers">
        <Panel
          id="stellar-providers-summary"
          title="Right now"
          w={12}
          h={2}
          metric
          essential
          badge={summary.down > 0 ? `${summary.down} degraded` : summary.gated > 0 ? `${summary.gated} gated` : "All answering"}
          tone={summary.tone}
          footer={<span>Read on {STELLAR_MAINNET.label} for this page.</span>}
        >
          <MetricRow>
            <Metric label="Answering" value={summary.answering} size="lg" />
            <Metric label="Gated on a credential" value={summary.gated} />
            <Metric label="Degraded or down" value={summary.down} dot={summary.down > 0 ? "warn" : "up"} />
          </MetricRow>
        </Panel>

        <Panel
          id="stellar-providers-list"
          title="Every source, and what breaks without it"
          w={12}
          h={8}
          essential
          scroll
          badge={`${rows.length} sources`}
          tone="evidence"
          headerExtra={
            <InfoControl label="About these states">
              <p>
                <b>Answering</b> means it returned what this page asked for. <b>Degraded</b> means it answered and the
                answer is older than its own freshness window. <b>Unavailable</b> means it did not answer at all.
              </p>
              <p>
                <b>Gated</b> is different from all three: the provider is reachable and working, and the part this
                product wants needs a credential this deployment does not hold. That is a decision somebody has to
                make, not an incident somebody has to fix.
              </p>
            </InfoControl>
          }
        >
          <div className="st-attn">
            {rows.map((row) => (
              <div className="st-attn-row" key={row.id} data-severity={row.state === "ANSWERING" ? "context" : row.state === "GATED" ? "caution" : "action"}>
                <span className="st-attn-sev">{row.state.toLowerCase()}</span>
                <b>{row.label}</b>
                <span className="st-note">{row.role}</span>
                <span className="st-attn-meta">
                  <span className="st-domain">{row.detail}</span>
                </span>
                {row.recovery ? (
                  <span className="st-attn-fix">
                    <span>{row.recovery}</span>
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        </Panel>

        <Panel
          id="stellar-providers-boundary"
          title="What a provider is never allowed to be"
          w={12}
          h={4}
          scroll
          badge="Construction"
          tone="verified"
          footer={<span>Each of these is absent from the code rather than switched off in the interface.</span>}
        >
          <KeyValue label="Never the authority on a claim">
            A provider answering is not evidence that its answer is right. Every figure carries which source produced
            it and when, so a reader can disagree with the source rather than with the page.
          </KeyValue>
          <KeyValue label="Never a router">
            Ryntra normalizes and compares what a routing provider says. It does not compute a route, and a number this
            product derived would be a recommendation wearing evidence&rsquo;s clothes.
          </KeyValue>
          <KeyValue label="Never a reason to invent a value">
            A read that fails resolves to UNAVAILABLE with its reason. It never falls back to a default, a zero, a
            cached figure or a blank.
          </KeyValue>
          <KeyValue label="Never a credential in your browser">
            Provider keys are read on the server only, and a test fails if a client component imports a module that
            reads one.
          </KeyValue>
        </Panel>
      </PanelGrid>
    </>
  );
}
