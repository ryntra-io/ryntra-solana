import { Panel, PanelGrid } from "@/app/shell/panel";
import { PageHead } from "../hub/parts.tsx";
import { solanaServerText } from "../i18n/server.ts";
import { accountLoginEnabled } from "@/lib/account/config";
import { LocalReceiptList } from "./local-receipts.tsx";

export const metadata = { title: "Receipts" };

/**
 * Receipts — the immutable record after the first owner-signed lifecycle.
 *
 * A Solana receipt will be the same artifact the rest of the product already
 * mints and verifies: intent, independent observation, expected-versus-actual
 * reconciliation, and an Ed25519 issuer signature over exact bytes. M1B now
 * supplies that first artifact. Its transfer facts match the chain; its
 * historical receipt preserves the software-only fee/program deviation it
 * actually issued instead of being rewritten after the fact.
 *
 * The unified public verifier checks that artifact without trusting this site.
 * The
 * link says where it goes — it opens the Agent Control workspace — because a
 * sidebar destination that silently ejects an operator into different chrome
 * is a recorded defect class in this product.
 */
export default async function SolanaReceiptsPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string }>;
}) {
  const { text } = await solanaServerText();
  const filter = (await searchParams).action?.trim() ?? "";
  return (
    <>
      <PageHead title="Receipts" />

      <PanelGrid label={text("Receipts")} fill>
        <Panel
          id="solana-local-receipts"
          title={text("Your receipts")}
          w={12}
          h={4}
          essential
          scroll
        >
          <LocalReceiptList filter={filter} archiveOn={accountLoginEnabled()} />
        </Panel>

        {/* The M1 card leads, because it is the one a person can read without a
            caveat: expected met observed on every line. The two below it are
            kept exactly as they were issued, deviation and correction included
            — leading with the clean result is ordering, and rewriting the ones
            behind it would be something else. */}
        {/* The three recorded canary receipts that used to sit here belonged
            to one wallet, and were shown in full to every visitor as worked
            examples: amounts, counterparties, signatures. Somebody else's
            transaction history is not example copy, and a receipts page is
            for the person whose receipts they are. They are preserved in the
            task evidence, where they were always the record. The panel above
            lists what this browser holds for the connected wallet, and
            nothing else. */}
      </PanelGrid>
    </>
  );
}
