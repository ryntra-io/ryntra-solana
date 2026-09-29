import { PageHead } from "../hub/parts.tsx";
import { SendConsole } from "./send-console.tsx";

export const metadata = { title: "Send" };

/**
 * Sending, as a page.
 *
 * Thin on purpose: everything here needs a wallet, and a wallet is client-side,
 * so the console is the client component and this is the route around it.
 *
 * **It used to be called Authorize**, which named a stage of the lifecycle
 * rather than the job somebody came here to do. Nobody opens a workspace to
 * authorize; they open it to send, and authorization is one of the eight things
 * that happens on the way. The old name also left the registry describing one
 * capability twice — a built `Authorize` and a gated future `Send` — with two
 * different states for the same code.
 */
export default function StellarSendPage() {
  return (
    <>
      <PageHead
        title="Send XLM"
        module="send"
        lead={
          <>
            <p>
              A wallet signature is not a Ryntra authorization, and a signature is not a submission. This surface makes
              both visible: you authorize an exact intent here, Freighter signs it, and what comes back is compared
              field by field against what you authorized. Only bytes that matched can be submitted — the submit
              function takes the cleared verdict rather than an XDR, so there is no way to hand it anything else.
            </p>
            <p>
              Then the lifecycle finishes rather than stopping: the ledger is read back from Horizon independently,
              what it actually did is compared against what was authorized, and the result is a receipt whose every
              hash you can recompute on the Receipts page.
            </p>
            <p>
              Fixed to Stellar Testnet, where the assets have no worth. Ryntra holds no key, signs nothing, and never
              relays a signed transaction — the signature happens inside Freighter and the submission goes from your
              browser straight to the public Stellar endpoint.
            </p>
          </>
        }
      />
      <SendConsole />
    </>
  );
}
