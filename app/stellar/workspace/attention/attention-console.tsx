"use client";

import Link from "next/link";

import { InfoControl } from "@/app/shell/info-control";
import { EmptyState, Panel, PanelGrid } from "@/app/shell/panel";
import type { Evidence } from "@/lib/stellar/evidence";
import type { IssuerControlEvidence, LedgerParameters, NetworkPulse } from "@/lib/stellar/reads";
import { STELLAR_TESTNET } from "@/lib/stellar/network";
import { useStellarWallet } from "../../components/stellar-wallet-provider.tsx";
import type { FeaturedAsset } from "../assets/featured.ts";
import { attentionItems, blockingCount, type AttentionSeverity } from "../hub/attention.ts";
import { AttentionRow, PageHead } from "../hub/parts.tsx";
import { useStellarActivity } from "../hub/use-activity.ts";

/**
 * Attention & Recovery.
 *
 * The Overview shows the same list in a panel; this shows all of it, grouped by
 * severity, with the observation time and the exact recovery step on every row.
 * Both read `attentionItems` — one list, because a workspace that can disagree
 * with itself about whether something is blocked has taught nobody to trust
 * either surface.
 *
 * **The empty state is a real answer, not a placeholder.** "Nothing needs you"
 * is a statement about the wallet, every source and every stored lifecycle, and
 * it names what was checked so a reader can tell it apart from a page that
 * failed to load.
 */

const GROUPS: readonly { id: AttentionSeverity; title: string; blurb: string }[] = [
  {
    id: "action",
    title: "Action required",
    blurb: "Something is blocked, and there is a step that unblocks it.",
  },
  {
    id: "caution",
    title: "Caution",
    blurb: "Degraded, in flight, or finished in a way worth reading.",
  },
  {
    id: "context",
    title: "Context",
    blurb: "True and worth knowing. Not a task.",
  },
];

export function AttentionConsole({
  pulse,
  parameters,
  issuers,
}: {
  pulse: Evidence<NetworkPulse>;
  parameters: Evidence<LedgerParameters>;
  issuers: readonly Readonly<{ asset: FeaturedAsset; controls: Evidence<IssuerControlEvidence> }>[];
}) {
  const { state: wallet, expectedNetwork } = useStellarWallet();
  const { records, ready, retained } = useStellarActivity();

  const items = attentionItems({
    wallet,
    expectedNetwork,
    pulse,
    parameters,
    issuers,
    activity: records,
    retained,
  });
  const blocking = blockingCount(items);

  return (
    <>
      <PageHead
        title="Attention & Recovery"
        module="attention"
        lead={
          <>
            <p>
              Everything currently blocking, degraded or worth knowing, with the exact step that clears each one. Every
              item is computed from a fact this workspace already holds — the wallet state machine, the evidence state
              of a read, a source that did not answer, or a stored lifecycle — rather than from a list somebody
              maintains by hand.
            </p>
            <p>
              A row without a recovery step is a complaint, so every row has one. Where the step happens inside this
              workspace there is a link; where it happens in your wallet there is not, because Ryntra cannot reach
              into Freighter and pretending otherwise would waste a press.
            </p>
          </>
        }
      />

      <PanelGrid label="Attention and recovery">
        {GROUPS.map((group) => {
          const rows = items.filter((item) => item.severity === group.id);
          return (
            <Panel
              key={group.id}
              id={`stellar-attention-${group.id}`}
              title={group.title}
              w={12}
              h={4}
              scroll
              essential={group.id === "action"}
              badge={rows.length > 0 ? String(rows.length) : "None"}
              tone={rows.length === 0 ? "muted" : group.id === "action" ? "caution" : "evidence"}
              footer={<span>{group.blurb}</span>}
            >
              {rows.length === 0 ? (
                <EmptyState title={group.id === "action" ? "Nothing is blocked" : `No ${group.title.toLowerCase()}`}>
                  {group.id === "action"
                    ? `The wallet is usable on ${expectedNetwork}, every source answered, and no stored lifecycle is waiting on a decision.`
                    : "Checked against the wallet, every read on this page, and every stored lifecycle."}
                </EmptyState>
              ) : (
                <div className="st-attn">
                  {rows.map((item) => (
                    <AttentionRow key={item.id} item={item} />
                  ))}
                </div>
              )}
            </Panel>
          );
        })}

        <Panel
          id="stellar-attention-scope"
          title="What was checked"
          w={12}
          h={4}
          scroll
          badge={blocking > 0 ? `${blocking} blocking` : "Clear"}
          tone={blocking > 0 ? "caution" : "evidence"}
          headerExtra={
            <InfoControl label="About this list">
              <p>
                This page and the Overview&rsquo;s Attention panel are the same computation, so they cannot disagree.
                Conditions that are true right now carry no observation time; conditions read from a stored lifecycle
                carry the moment that lifecycle last changed.
              </p>
              <p>
                Nothing here is retained on a Ryntra server. Stored lifecycles live in this browser and are listed on
                the Activity surface, where they can also be deleted.
              </p>
            </InfoControl>
          }
          footer={
            <Link className="rw-btn" href="/stellar/workspace/activity">
              Open Activity
            </Link>
          }
        >
          <div className="st-attn">
            <div className="st-attn-row" data-severity="context" data-dense="true">
              <span className="st-attn-sev">Wallet</span>
              <b>{expectedNetwork}</b>
              <span className="st-note">
                The state machine has twelve states; a signature is refused in seven of them, and the wrong network is
                the one that matters.
              </span>
            </div>
            <div className="st-attn-row" data-severity="context" data-dense="true">
              <span className="st-attn-sev">Sources</span>
              <b>Stellar RPC, Horizon, and each issuer account</b>
              <span className="st-note">
                Read on Stellar Mainnet for this page. A source that did not answer appears above rather than being
                rendered as an absence of facts.
              </span>
            </div>
            <div className="st-attn-row" data-severity="context" data-dense="true">
              <span className="st-attn-sev">Stored lifecycles</span>
              <b>
                {ready ? `${records.length} kept in this browser` : "Reading this browser"}
                {retained ? "" : " — storage unavailable"}
              </b>
              <span className="st-note">
                Anything awaiting authorization, signed, submitted, failed or needing reconciliation appears above until
                it is finished or deleted.
              </span>
            </div>
            <div className="st-attn-row" data-severity="context" data-dense="true">
              <span className="st-attn-sev">Not checked</span>
              <b>Owner-defined policy</b>
              <span className="st-note">
                Policy evaluation is registered and not built, which is why every receipt this workspace produces
                carries a null policy version with its reason. It is on the Hub Map with its gate.
              </span>
            </div>
          </div>
        </Panel>
      </PanelGrid>

      <span className="st-sr">{STELLAR_TESTNET.label} is the network any action here would be prepared for.</span>
    </>
  );
}
