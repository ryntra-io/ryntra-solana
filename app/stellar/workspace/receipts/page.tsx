import { AdapterProjectionSummary } from "@/app/agents/components/adapter-projection-summary";
import { Panel, PanelGrid } from "@/app/shell/panel";
import { STELLAR_ADAPTER_PROJECTION } from "@/lib/agent-control/adapter-projection-current";
import { PageHead } from "../hub/parts.tsx";
import { VerifyConsole } from "./verify-console.tsx";

export const metadata = { title: "Receipts" };

/**
 * Receipts, as a page.
 *
 * Thin on purpose: everything here happens in the browser — a receipt is read
 * where the person holding it is, and the ledger is read straight from the
 * public endpoint — so the console is the client component and this is the
 * route around it.
 */
export default function StellarReceiptsPage() {
  return (
    <>
      <PageHead
        title="Receipts"
        module="receipts"
        lead={
          <>
            <p>
              A document that says a payment happened is a claim by whoever wrote it. What makes a Ryntra receipt
              different is that every link in it can be recomputed by somebody who does not trust Ryntra: the intent,
              the authorization, the transaction, the effects the ledger recorded, and the receipt hash over all of
              them.
            </p>
            <p>
              This page does that recomputation in your browser and then reads the ledger again to see whether it still
              agrees. A transaction hash works here too, with no receipt at all — the expectation is taken from the
              envelope the ledger stores, which proves the network did what the transaction announced without proving
              anybody authorized it.
            </p>
          </>
        }
      />
      <PanelGrid label="Agent Control projection">
        <Panel
          id="stellar-agent-control-projection"
          title="Agent Control projection"
          w={12}
          h={8}
          essential
          scroll
        >
          <AdapterProjectionSummary
            projection={STELLAR_ADAPTER_PROJECTION}
            counterpartHref={STELLAR_ADAPTER_PROJECTION.adapter.agentControlPath}
          />
        </Panel>
      </PanelGrid>
      <VerifyConsole />
    </>
  );
}
