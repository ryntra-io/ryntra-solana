import Link from "next/link";

import { InfoControl } from "@/app/shell/info-control";
import { AlertStrip, EmptyState, KeyValue, Metric, MetricRow, Panel, PanelGrid } from "@/app/shell/panel";
import { NATIVE_ASSET } from "@/lib/stellar/asset";
import { isResolved } from "@/lib/stellar/evidence";
import { SOROSWAP_GATE, readSoroswapHealth, readSoroswapRoute } from "@/lib/stellar/routes/soroswap";
import { PageHead } from "../hub/parts.tsx";
import { provenanceLine } from "../hub/provenance.ts";

export const revalidate = 60;

export const metadata = { title: "Markets & Liquidity" };

/**
 * Markets & Liquidity.
 *
 * Route evidence from Soroswap, the building block selected for liquidity. **Ryntra normalizes what a provider says and
 * never routes** — a number this product computed and presented beside a
 * provider's would be a recommendation wearing evidence's clothes.
 *
 * ## Why half of this page is a refusal, and why that is the honest half
 *
 * Soroswap's API was read live on 2026-08-14 and it divides in two. `/health` is
 * public and answers: the indexer is reachable and says which venues it covers.
 * `/quote`, `/pools`, `/price`, `/protocols` and `/asset-list` all return 403
 * without an API key, and that key comes from registering an account — which no
 * agent may do.
 *
 * So this page shows the real half, runs the real quote path, and renders its
 * real refusal with the exact next step. It does not show a sample quote, a
 * cached quote or a quote computed here. A route-evidence surface that invents
 * the evidence has inverted its own purpose.
 */
export default async function StellarMarketsPage() {
  const [health, probe] = await Promise.all([
    readSoroswapHealth(),
    /* The real path, run for real. XLM to XLM needs no asset resolution, so what
       comes back is about credentials and reachability rather than about our
       asset handling — which makes the refusal it produces the accurate one. */
    readSoroswapRoute({
      assetIn: NATIVE_ASSET,
      assetOut: NATIVE_ASSET,
      amountIn: "10000000",
      slippageBps: 50,
      network: "mainnet",
    }),
  ]);

  const configured = isResolved(health) ? health.data.configured : false;
  const venues = isResolved(health) ? health.data.indexed.mainnet : [];

  return (
    <>
      <PageHead
        title="Markets & Liquidity"
        module="markets"
        lead={
          <>
            <p>
              What a routing provider says a trade would do, in one shape: expected output, the floor at your stated
              slippage, price impact, every fee and who takes it, every venue the value passes through, and when the
              quote stops being one.
            </p>
            <p>
              Ryntra normalizes and compares. It does not route, does not compute a price, and does not fill a gap in a
              provider&rsquo;s answer with a figure of its own. A quote with no minimum output is refused outright,
              because a floor is what makes a number something you can reconcile against after signing.
            </p>
          </>
        }
      />

      <PanelGrid label="Markets and liquidity">
        <Panel
          id="stellar-markets-provider"
          title="Soroswap"
          w={12}
          h={4}
          metric
          essential
          badge={isResolved(health) ? (configured ? "Integrated" : "Reachable, gated") : "Unavailable"}
          tone={isResolved(health) ? (configured ? "evidence" : "caution") : "muted"}
          headerExtra={
            <InfoControl label="About this provider">
              <p>
                Soroswap is a DEX aggregator on Stellar: it quotes across Soroban venues and the classic DEX and
                returns one route. Its published integration effort is one to two weeks.
              </p>
              <p>
                Its health endpoint is public. Everything that carries a price needs a key, which is why this page
                shows exactly one of those two things.
              </p>
            </InfoControl>
          }
          footer={<span>{provenanceLine(health)}</span>}
        >
          {isResolved(health) ? (
            <MetricRow>
              <Metric
                label="Indexer"
                value={health.data.reachable ? "Reachable" : "Unreachable"}
                dot={health.data.reachable ? "up" : "down"}
                live={health.data.reachable}
                size="lg"
              />
              <Metric
                label="Venues indexed on mainnet"
                value={venues.length}
                sub={venues.join(", ") || "None reported."}
              />
              <Metric
                label="Venues indexed on testnet"
                value={health.data.indexed.testnet.length}
                sub="Route evidence on testnet would have nothing behind it."
              />
              <Metric
                label="Quotes, pools and prices"
                value={configured ? "Available" : "Gated"}
                dot={configured ? "up" : "warn"}
              />
            </MetricRow>
          ) : (
            <p className="rw-lead">{health.reason}</p>
          )}
        </Panel>

        <Panel
          id="stellar-markets-route"
          title="Route evidence"
          w={8}
          h={6}
          essential
          scroll
          badge={isResolved(probe) ? probe.state : "Unavailable"}
          tone={isResolved(probe) ? "evidence" : "caution"}
          headerExtra={
            <InfoControl label="What a route plan carries">
              <p>
                Expected output is what the provider thinks you get. Minimum output is what you are guaranteed at the
                slippage you asked for, and it is never inferred — a delivered amount below the authorized minimum has
                to be reportable as a deviation, which requires the minimum to exist before the signature.
              </p>
              <p>
                A quote with no stated expiry is treated as expired rather than as eternal. That is the pessimistic
                reading on purpose.
              </p>
            </InfoControl>
          }
          footer={<span>{provenanceLine(probe)}</span>}
        >
          {isResolved(probe) ? (
            <>
              <KeyValue label="Expected out">
                <span translate="no">{probe.data.expectedOut}</span>
              </KeyValue>
              <KeyValue label={`Floor at ${probe.data.slippageBps} bps`}>
                <span translate="no">{probe.data.minimumOut}</span>
              </KeyValue>
              <KeyValue label="Price impact">
                {probe.data.priceImpact === null ? "Not stated by the provider." : `${(probe.data.priceImpact * 100).toFixed(3)}%`}
              </KeyValue>
              <KeyValue label="Venues on the path">
                {probe.data.hops.length === 0
                  ? "Not stated by the provider."
                  : probe.data.hops.map((hop) => hop.protocol).join(" → ")}
              </KeyValue>
              <KeyValue label="Expires">{probe.data.expiresAt ?? "Unstated, so treated as expired."}</KeyValue>
            </>
          ) : (
            <>
              <AlertStrip tone="warn">{probe.reason}</AlertStrip>
              <div className="rw-hair" />
              <KeyValue label="What already works">
                The adapter, the normalized shape and the refusals. The quote path above is the real one — it was run
                to build this page and this is what it returned.
              </KeyValue>
              <KeyValue label="What is missing">
                One credential. Every endpoint that carries a price — quotes, pools, prices, the protocol list and the
                asset list — answers 403 without it.
              </KeyValue>
              <KeyValue label="Who can supply it">
                Only a person. Creating the account is outside what any agent here is permitted to do, which is why
                this is a named owner action rather than a task somebody forgot.
              </KeyValue>
            </>
          )}
        </Panel>

        <Panel
          id="stellar-markets-comparison"
          /* "Comparing providers" truncated in a four-column panel at 1280 and
             the rendered sweep caught it. The page is already about providers;
             the word that carries meaning here is the shorter one. */
          title="Comparison"
          w={4}
          h={6}
          scroll
          badge="One integrated"
          tone="muted"
          footer={<span>A comparison that can hold one entry teaches a reader there is nothing to compare.</span>}
        >
          <EmptyState
            title="Nothing to disagree with yet"
            action={
              <Link className="rw-btn" href="/stellar/workspace/map">
                What the second one waits on
              </Link>
            }
          >
            The comparison is built and returns no spread until two providers answer the same trade. That is the whole
            point of comparing: the disagreement between quotes is the evidence, and a single quote presented as a
            comparison would be a rank with one entrant.
          </EmptyState>
          <div className="rw-hair" />
          <KeyValue label="Registered, not integrated">
            Aquarius and Stellar Broker publish integration efforts of under a day and one to five days. Neither is called, and neither is claimed.
          </KeyValue>
        </Panel>

        <Panel
          id="stellar-markets-gate"
          title="The one action that finishes this"
          w={12}
          h={4}
          scroll
          badge="Owner action"
          tone="caution"
          footer={<span>Stated once, quoted everywhere, so no surface invents its own version of the next step.</span>}
        >
          <KeyValue label="Exact step">{SOROSWAP_GATE}</KeyValue>
          <KeyValue label="What changes when it is done">
            This page fills with real quotes, the Passport gains a liquidity section that reads rather than reserves
            space, and Swap &amp; Path Payment stops being gated on route evidence.
          </KeyValue>
          <KeyValue label="What does not change">
            Ryntra still never routes, still never executes here, and still never presents a computed number as a
            provider&rsquo;s. A key buys evidence, not authority.
          </KeyValue>
        </Panel>
      </PanelGrid>
    </>
  );
}
