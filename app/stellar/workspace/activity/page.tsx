import { PageHead } from "../hub/parts.tsx";
import { ActivityConsole } from "./activity-console.tsx";

export const metadata = { title: "Activity" };

/**
 * Activity.
 *
 * Thin on purpose: every record lives in this browser, so the whole surface is
 * client-side and there is nothing for a server component to read. That is the
 * storage decision made visible — a page with no server call is a page with no
 * server record.
 */
export default function StellarActivityPage() {
  return (
    <>
      <PageHead
        title="Activity"
        module="activity"
        lead={
          <>
            <p>
              Every action this workspace prepared, and what became of it: the intent, the evidence it was checked
              against, the authorization, what the ledger recorded, whether expected matched actual, and the receipt.
            </p>
            <p>
              Kept in this browser and nowhere else. Ryntra has no account for this workspace and keeps no server-side
              record of anyone using it — a payment history is the most sensitive thing this surface could hold, and
              the honest place for it is the machine you are sitting at. Clearing site data clears this list; the
              receipt you downloaded and the public ledger are unaffected.
            </p>
          </>
        }
      />
      <ActivityConsole />
    </>
  );
}
