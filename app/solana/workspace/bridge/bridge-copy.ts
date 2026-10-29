/**
 * Machine codes, said once, in a sentence.
 *
 * The Bridge card renders none of the codes the routes emit. Every one of them
 * is translated here into something a person can act on, and a code with no
 * sentence falls back to a plain line rather than printing itself — a screen
 * that shows `CCTP_BURN_ALREADY_STARTED` has told the reader nothing except
 * that they are not the audience.
 *
 * ## Whole sentences per chain, on purpose
 *
 * Every sentence that names a chain exists once per chain it can name, as a
 * literal, rather than as a template with the chain's name glued in. Two
 * reasons. Ukrainian inflects around the noun, so "arrived on" + "Ethereum"
 * is not a translation; and the catalogue test can only check a literal, so a
 * template is a sentence that renders in English on a Ukrainian page the day
 * it is first reached. Since 2026-09-05 the chains are Solana, Base and
 * Ethereum, and a sentence that used to say "Base" for every non-Solana end
 * now says which one.
 */

type Text = (english: string) => string;

/** The chain a sentence is about. The card passes the lane's own label. */
export type BridgeChainLabel = "Solana" | "Base" | "Ethereum";

/** Why a Review could not be built. */
export function bridgePlanFailureCopy(code: string | null, text: Text, destination: BridgeChainLabel = "Base"): string {
  switch (code) {
    case "BALANCE_INSUFFICIENT":
      return text("This wallet holds less USDC than this transfer would send.");
    case "LAMPORTS_INSUFFICIENT":
      return text("This wallet holds too little SOL for the network fee and the one-time message account.");
    case "AMOUNT_OUT_OF_RANGE":
      return text("Enter an amount greater than zero.");
    case "RECIPIENT_INVALID":
      return destination === "Solana"
        ? text("That is not a Solana address. An address for another network here would send the money nowhere.")
        : destination === "Ethereum"
          ? text("That is not an Ethereum address. A Solana address here would send the money nowhere.")
          : text("That is not a Base address. A Solana address here would send the money nowhere.");
    case "EPHEMERAL_ACCOUNT_EXISTS":
      return text("This transfer needs a fresh one-time account. Try again.");
    case "PROVIDER_FACTS_UNAVAILABLE":
      return text("Circle's fee for this route could not be read just now, so nothing can be quoted.");
    case "TOKEN_ACCOUNT_MISSING":
      return text("This wallet's USDC account could not be read.");
    case "BLOCKHASH_UNAVAILABLE":
    case "FEE_UNAVAILABLE":
    case "RENT_UNAVAILABLE":
      return text("The network did not answer in time. Nothing was sent.");
    case "CANARY_POLICY_UNAVAILABLE":
      return text("The owner rules could not be read, so nothing may be prepared.");
    case "ROUTE_NOT_OPEN":
      return destination === "Ethereum"
        ? text("Bridging with Ethereum is not open yet. Nothing was sent.")
        : text("Bridging with this network is not open yet. Nothing was sent.");
    case "RATE_LIMITED":
      return text("Too many requests. Wait a moment and try again.");
    default:
      return text("This transfer could not be prepared. Nothing was sent.");
  }
}

/** Why a burn was refused, or what happened to one. */
export function bridgeBurnFailureCopy(code: string | null, text: Text): string {
  switch (code) {
    case "BURN_ALREADY_STARTED":
    case "CCTP_BURN_ALREADY_STARTED":
      return text("This exact transfer has already been started. Open recovery below — it is never started twice.");
    case "CCTP_BURN_UNKNOWN":
      return text("The transfer was sent and the answer was lost. Your money may already be moving; recovery below reads where it is.");
    case "CCTP_BURN_FAILED_BEFORE_BOUNDARY":
      return text("The transfer stopped before anything was sent. Nothing moved.");
    case "PLAN_EXPIRED":
      return text("This review is too old to send. Prepare it again.");
    case "BURN_NOT_PERMITTED":
      return text("This transfer is not permitted right now.");
    case "ROUTE_NOT_OPEN":
      return text("Bridging with this network is not open yet. Nothing was sent.");
    case "REVIEW_PROOF_REFUSED":
      return text("The review changed after it was signed. Prepare it again.");
    case "SIGNED_BYTES_CHANGED":
    case "SIGNED_UNREVIEWED_CHANGE":
      return text("Your wallet returned a different transaction. Nothing was sent.");
    case "ADOPTED_SIMULATION_FAILED":
    case "ADOPTED_SIMULATION_UNAVAILABLE":
      return text("The network would not accept the transfer your wallet returned. Nothing was sent.");
    case "SIGNED_OWNER_SIGNATURE_MISSING":
    case "SIGNED_OWNER_SIGNATURE_INVALID":
      return text("Your wallet did not sign this transaction. Nothing was sent.");
    case "SIGNED_MESSAGE_SIGNATURE_MISSING":
    case "SIGNED_MESSAGE_SIGNATURE_INVALID":
      return text("The one-time signature in this tab did not complete. Nothing was sent.");
    case "INDEPENDENT_READ_UNAVAILABLE":
      return text("Only one network provider answered, so this transfer could not be checked twice. Nothing was sent.");
    case "FORBIDDEN_ORIGIN":
      return text("This request did not come from this site. Nothing was sent.");
    default:
      return text("This transfer did not go through. Nothing was sent.");
  }
}

/** What the wallet said when it refused. */
export function bridgeWalletFailureCopy(reason: string, text: Text): string {
  if (/reject|denied|declin|4001/i.test(reason)) return text("You declined in your wallet. Nothing was sent.");
  if (/timeout|timed out/i.test(reason)) return text("The wallet did not answer. Nothing was sent.");
  if (/lock/i.test(reason)) return text("Your wallet is locked. Unlock it and try again.");
  return text("Your wallet could not complete this. Nothing was sent.");
}

/**
 * What the destination read found, in a sentence, about the chain it read.
 *
 * The card handled exactly one of these — `MINTED` — and returned silently for
 * every other answer, so the last button did nothing at all and said nothing
 * about why. That is the worst place on the card to go quiet: the money has
 * already left the source chain.
 *
 * `CONSUMED_UNSEEN` matters most and must never be reported as not arrived.
 * The nonce is spent, which means the destination accepted the message and
 * the money is there; only the transaction that did it could not be found in
 * the window searched, because anyone may relay a CCTP mint and it may have
 * landed outside it.
 */
export function bridgeObservationCopy(state: string, text: Text, destination: BridgeChainLabel = "Base"): string {
  switch (state) {
    case "MINTED":
      return destination === "Solana"
        ? text("The money arrived on Solana.")
        : destination === "Ethereum"
          ? text("The money arrived on Ethereum.")
          : text("The money arrived on Base.");
    case "CONSUMED_UNSEEN":
      return destination === "Solana"
        ? text(
            "Solana has accepted this transfer — the message is spent, so the money is there. The transaction that did it was not found in the range read, because anyone may relay it. Read the recipient's balance on Solana.",
          )
        : destination === "Ethereum"
          ? text(
              "Ethereum has accepted this transfer — the message is spent, so the money is there. The transaction that did it was not found in the range read, because anyone may relay it. Widen the search or read the recipient's balance on Ethereum.",
            )
          : text(
              "Base has accepted this transfer — the message is spent, so the money is there. The transaction that did it was not found in the range read, because anyone may relay it. Widen the search or read the recipient's balance on Base.",
            );
    case "NOT_MINTED":
      return destination === "Solana"
        ? text("Solana has not received this transfer yet. Nothing is lost; the message is still waiting to be used.")
        : destination === "Ethereum"
          ? text("Ethereum has not received this transfer yet. Nothing is lost; the message is still waiting to be used.")
          : text("Base has not received this transfer yet. Nothing is lost; the message is still waiting to be used.");
    case "UNAVAILABLE":
      return destination === "Solana"
        ? text("Solana could not be read just now. Nothing changed on either chain — this is a read, and it can be repeated.")
        : destination === "Ethereum"
          ? text("Ethereum could not be read just now. Nothing changed on either chain — this is a read, and it can be repeated.")
          : text("Base could not be read just now. Nothing changed on either chain — this is a read, and it can be repeated.");
    case "UNREADABLE":
      return destination === "Solana"
        ? text("The answer from Solana could not be understood, so nothing is claimed about where the money is. Try the read again.")
        : destination === "Ethereum"
          ? text("The answer from Ethereum could not be understood, so nothing is claimed about where the money is. Try the read again.")
          : text("The answer from Base could not be understood, so nothing is claimed about where the money is. Try the read again.");
    default:
      return destination === "Solana"
        ? text("Solana returned a state this page does not recognise, so nothing is claimed about where the money is.")
        : destination === "Ethereum"
          ? text("Ethereum returned a state this page does not recognise, so nothing is claimed about where the money is.")
          : text("Base returned a state this page does not recognise, so nothing is claimed about where the money is.");
  }
}

/** Where the money is, in one sentence, for a transfer that is not finished. */
export function bridgeRecoveryCopy(
  action: string,
  text: Text,
  lane: Readonly<{ source: BridgeChainLabel; destination: BridgeChainLabel }> = { source: "Solana", destination: "Base" },
): string {
  switch (action) {
    case "CONTINUE_TO_REVIEW":
      return text("Nothing has been sent yet.");
    case "PLAN_A_FRESH_TRANSFER":
      return text("Nothing moved. You can prepare this transfer again.");
    case "READ_THE_BURN_SIGNATURE_ON_SOLANA":
      return text("The transaction was sent to Solana. Reading it now.");
    case "READ_THE_BURN_SIGNATURE_ON_BASE":
      return text("The transaction was sent to Base. Reading it now.");
    case "READ_THE_BURN_SIGNATURE_ON_ETHEREUM":
      return text("The transaction was sent to Ethereum. Reading it now.");
    case "ASK_CIRCLE_FOR_THE_MESSAGE_AND_ATTESTATION":
      return lane.source === "Base"
        ? text("Your USDC has left Base and Circle is signing for it.")
        : lane.source === "Ethereum"
          ? text("Your USDC has left Ethereum and Circle is signing for it.")
          : text("Your USDC has left Solana and Circle is signing for it.");
    case "COMPLETE_THE_DESTINATION_MINT_WITH_THE_EXISTING_ATTESTATION":
      return lane.destination === "Solana"
        ? text("Circle has signed. The last step is to receive it on Solana.")
        : lane.destination === "Ethereum"
          ? text("Circle has signed. The last step is to receive it on Ethereum.")
          : text("Circle has signed. The last step is to receive it on Base.");
    case "INSPECT_BURN_THEN_MESSAGE_THEN_DESTINATION_MINT":
      return lane.source === "Base"
        ? text("Something was interrupted. Reading Base, then Circle, then Solana — in that order.")
        : lane.source === "Ethereum"
          ? text("Something was interrupted. Reading Ethereum, then Circle, then Solana — in that order.")
          : lane.destination === "Ethereum"
            ? text("Something was interrupted. Reading Solana, then Circle, then Ethereum — in that order.")
            : text("Something was interrupted. Reading Solana, then Circle, then Base — in that order.");
    case "DESTINATION_SENT_READING_BOTH_CHAINS":
      return lane.destination === "Solana"
        ? text("The transaction on Solana was sent. Reading both chains now.")
        : lane.destination === "Ethereum"
          ? text("The transaction on Ethereum was sent. Reading both chains now.")
          : text("The transaction on Base was sent. Reading both chains now.");
    case "ISSUE_THE_BRIDGE_RECEIPT":
      return lane.destination === "Solana"
        ? text("The money arrived on Solana. Writing your receipt.")
        : lane.destination === "Ethereum"
          ? text("The money arrived on Ethereum. Writing your receipt.")
          : text("The money arrived on Base. Writing your receipt.");
    case "NONE_REQUIRED":
      return text("Finished. Both sides were read and they agree.");
    default:
      return text("Reading where this transfer stands.");
  }
}

/** The waiting line while Circle signs. */
export function bridgeAttestationCopy(
  state: string,
  text: Text,
  lane: Readonly<{ source: BridgeChainLabel; destination: BridgeChainLabel }> = { source: "Solana", destination: "Base" },
): string {
  switch (state) {
    case "PENDING_INDEXING":
      return text("Circle has not seen the transaction yet. This is normal and it is still on its way.");
    case "PENDING_CONFIRMATIONS":
      return lane.source === "Base"
        ? text("Circle has the transaction and is waiting for Base to settle it.")
        : lane.source === "Ethereum"
          ? text("Circle has the transaction and is waiting for Ethereum to settle it.")
          : text("Circle has the transaction and is waiting for Solana to settle it.");
    case "ATTESTED":
      return lane.destination === "Solana"
        ? text("Circle has signed. You can receive it on Solana.")
        : lane.destination === "Ethereum"
          ? text("Circle has signed. You can receive it on Ethereum.")
          : text("Circle has signed. You can receive it on Base.");
    default:
      return text("Circle could not be reached just now. Your transfer is unaffected and this will retry.");
  }
}

/**
 * Why a network on the chooser cannot be chosen, in one sentence.
 *
 * The chooser draws the deployment's own route matrix, and each row that is
 * not open carries a reason code. This is the only place those codes become
 * words a person reads.
 */
export function bridgeNetworkReasonCopy(reason: string | null, text: Text, network: "base" | "ethereum" | "robinhood-chain"): string | null {
  switch (reason) {
    case "LANE_PAUSED":
      return text("Bridging is paused right now.");
    case "AWAITING_FIRST_VERIFIED_TRANSFER":
      return network === "ethereum"
        ? text("Ethereum opens after its first transfer is verified on both chains.")
        : text("This network opens after its first transfer is verified on both chains.");
    case "NO_NATIVE_USDC_ROUTE":
      return network === "robinhood-chain"
        ? /* True before and true now: there is no USDC on that chain, so nothing
             bridges there as itself. What changed on 2026-09-09 is that the
             swap into its own money exists, so the sentence names where it
             lives instead of ending on a refusal. */
          text("Robinhood Chain has no USDC route. Its money is USDG, which Swap reaches as a swap between networks.")
        : text("This network has no USDC route.");
    default:
      return null;
  }
}
