/**
 * What went wrong on a Solana swap, and whether pressing the button again could
 * possibly help.
 *
 * Lifted out of `swap-card.tsx` for one reason: it is the map from every code
 * the swap routes can emit to the sentence a person reads, and a map like that
 * has to be **testable against the routes themselves**. Inside a `.tsx` it could
 * only ever be grepped.
 *
 * A person met the cost of that on production on 2026-09-10. Ten distinct
 * failures — the provider unreachable, the provider refusing, a token that
 * could not be checked, a wallet that does not cover the amount, and a request
 * the platform killed for want of a declared time budget — all printed the same
 * five words, beside a button that was still enabled. `failure-copy.test.mjs`
 * now reads the route sources, collects the codes they can actually return, and
 * fails if any of them falls through to the catch-all.
 */

/**
 * What went wrong, and whether pressing the button again could possibly help.
 *
 * The second half is the part that was missing. Every refusal the server can
 * return used to fall through to "Swap could not continue. Try again." with the
 * button still reading **Review swap** and still enabled — so a person who could
 * never swap, because the lane was closed or the deployment had no signing key,
 * was invited to keep pressing a control that was guaranteed to fail. A wrong
 * sentence is bad; a wrong sentence next to a live button is a trap.
 *
 * `retryable: false` means *this deployment cannot do this right now* — nothing
 * the person does in the next minute changes it.
 */
export function swapFailureCopy(
  code: string,
  text: (english: string) => string,
): Readonly<{ message: string; retryable: boolean }> {
  const retry = (message: string) => ({ message, retryable: true });
  const stop = (message: string) => ({ message, retryable: false });

  /* Turned off on purpose, by an operator. */
  if (/SWAP_PAUSED/.test(code)) return stop(text("Swapping is turned off right now."));

  /* The issuer no longer offers this token for purchase — redemption open, the window closed. Nothing a person does changes it. */
  if (/^ASSET_NOT_OFFERED$/.test(code)) return stop(text("The issuer no longer offers this token for purchase."));

  /* This deployment is missing something it needs in order to sign at all. A
     person cannot fix any of these and should not be asked to try. */
  if (/PROOF_NOT_SIGNED|ISSUER_KEY_MISSING|STORE_NOT_DURABLE|PROVIDER_KEY_MISSING|NO_INDEPENDENT_RPC/.test(code)) {
    return stop(text("This site is not set up to sign swaps right now."));
  }

  /* The bytes were built and then refused before they could reach a wallet. */
  if (/SWAP_PRE_SIGN_REFUSED/.test(code)) {
    return stop(text("This swap was checked and not offered for signing."));
  }
  if (/^ADOPTED_SIMULATION_(FAILED|UNAVAILABLE)$/.test(code)) {
    return retry(text("The signed transaction failed its final check. Nothing was sent. Get a new quote."));
  }
  if (/^SIMULATION_(FAILED|UNAVAILABLE)$/.test(code)) {
    return retry(text("This route could not be confirmed. Nothing was sent. Get a new quote."));
  }
  if (code === "BLOCKHASH_STILL_VALID") {
    return retry(text("The previous transaction can still reach the network. Wait for it to expire, then get a new quote."));
  }
  if (/SIMULATION/.test(code)) {
    return stop(text("This swap did not simulate cleanly, so it was not offered for signing."));
  }

  /* A price that did not agree with itself, and no other route answered better.
     Retryable on purpose, and it is the one case here where trying again is a
     reasonable thing to do: the quote was wrong rather than the pair impossible,
     and the next one usually is not. Showing the number instead would have been
     the defect — a person pressing a price nothing can fill. */
  if (/IMPLAUSIBLE_QUOTE/.test(code)) {
    return retry(text("This price did not check out, so it was not offered. Try again in a moment."));
  }

  /* The one refusal this card raises about itself, and the only one a person
     can meet before a wallet exists. The card already built the exact sentence
     and this function threw it away, because copy is derived from the code so
     that no server-authored string ever reaches the screen — a rule worth
     keeping, which is why the sentence is written here rather than passed
     through. Reached by editing a link or by swapping the legs of one, so it
     is rarer than the pairs below and worse when it happens: "try again" is
     advice that cannot work, on the only failure the person can actually fix. */
  if (/SAME_MINT/.test(code)) return stop(text("Both sides are the same asset. Change one of them."));

  /* The provider quoted the pair and then refused to build it. Overwhelmingly
     this is the wallet not covering the swap — Jupiter's own words for it are
     "Insufficient funds", which is a thing a person can act on and was being
     told to them as "Swap could not continue. Try again." */
  if (/ORDER_BUILD_FAILED/.test(code)) {
    return retry(text("The provider priced this and would not build it — usually the wallet does not cover the amount plus its fee."));
  }

  /* The provider itself: unreachable, refusing, or answering something this
     product cannot read. None is the person's doing and none of them is fixed
     by a fourth press, but all three can pass, so they retry. */
  if (/ORDER_UNREACHABLE|ORDER_HTTP_ERROR|EXECUTE_UNREACHABLE|EXECUTE_HTTP_ERROR/.test(code)) {
    return retry(text("The swap provider could not be reached just now. Nothing was sent."));
  }
  if (/ORDER_REFUSED|ORDER_MALFORMED|EXECUTE_REFUSED|EXECUTE_MALFORMED/.test(code)) {
    return retry(text("The swap provider refused this request. Nothing was sent."));
  }
  /* A deployment with no Jupiter access cannot swap at all, and no amount of
     pressing changes it. */
  if (/PRODUCTION_KEY_REQUIRED/.test(code)) {
    return stop(text("This site is not set up to sign swaps right now."));
  }

  /* The two mints are read and vouched for before anything is built. A refusal
     here is about the token, not the swap, and "try again" is advice that
     cannot work. */
  if (/PASSPORT_REFUSED|MINT_UNREADABLE/.test(code)) {
    return stop(text("One of these tokens could not be checked, so no swap was offered for it."));
  }
  if (/INTENT_REFUSED|SWAP_POLICY_BLOCKED|PREFLIGHT_REFUSED/.test(code)) {
    return stop(text("This swap did not pass Ryntra's own checks, so it was not offered."));
  }

  /* An order under a Trading Plan. The plan's block is drawn beside the
     sentence; the sentence says what to do. Another amount or a new version
     can change the plan's verdict, so those retry; the wallet and the plan
     itself are facts the button cannot change. */
  if (/^PLAN_REVIEW_BLOCKED$/.test(code)) return retry(text("This order is outside the plan, so it was not offered. Change the amount, or the plan."));
  if (/^PLAN_VERSION_CONFLICT$/.test(code)) return retry(text("The plan changed since this Review. Nothing was sent — review again on the current version."));
  if (/^PLAN_STATE_REFUSED$/.test(code)) return stop(text("The plan is no longer active, so nothing was sent under it."));
  if (/^PLAN_NOT_FOUND$/.test(code)) return stop(text("No such plan for this wallet."));
  if (/^UNAUTHORIZED$/.test(code)) return stop(text("Confirm your wallet to trade under the plan."));
  if (/^WALLET_MISMATCH$/.test(code)) return stop(text("The confirmed wallet is not the one placing this order."));
  if (/^UNAVAILABLE$/.test(code)) return retry(text("The plan could not record the Review. Nothing was sent — try again."));
  if (/TRANSACTION_|REVIEWED_BYTES_MISMATCH|WALLET_MODIFIED_BYTES|WALLET_GUARDS/.test(code)) {
    return stop(text("The transaction that came back was not the one that was reviewed, so it was not sent."));
  }
  if (/DURABLE_MULTI_WRITER/.test(code)) {
    return stop(text("This site is not set up to sign swaps right now."));
  }
  /* The platform ended the request before the route could answer for itself.
     A bare `HTTP_5xx` is exactly that and nothing else: every refusal this
     product writes carries a body with a code, so a code shaped like this one
     means no function ever returned. It is a timeout wearing a gateway's
     clothes, and saying so beats a sentence that describes the swap — which
     did nothing, because nothing was ever signed.

     This is the code the founder's screen actually produced on 2026-09-10:
     `/api/solana/swap/order` declared no time budget, blew the platform
     default, and five presses in twenty-four seconds each got a bodyless 502
     that no log recorded and no sentence named. */
  if (/^HTTP_(502|503|504)$/.test(code) || /TIMEOUT|GATEWAY/.test(code)) {
    return retry(text("That took too long and was stopped. Nothing was sent — try again."));
  }
  if (/^NETWORK$/.test(code)) return retry(text("Ryntra could not be reached. Nothing was sent."));

  if (/NO_ROUTE/.test(code)) return retry(text("No route for this pair right now."));
  if (/INSUFFICIENT|BALANCE/.test(code)) return retry(text("This wallet does not hold enough for this swap."));
  if (/AMOUNT/.test(code)) return retry(text("This amount cannot be swapped."));
  if (/EXPIRED|STALE|BLOCKHASH/.test(code)) return retry(text("The quote expired. Get a new quote."));
  if (/WALLET_REFUSED|USER_REJECTED|CANCELLED/.test(code)) return retry(text("Wallet approval was cancelled."));
  /* Ryntra's own limiter, not the venue's. Blaming Jupiter for our rate limit
     sent people to look for a problem at the wrong company. */
  if (/RATE_LIMITED/.test(code)) return retry(text("Too many requests just now. Try again in a moment."));
  if (/OWNER.*LOCK|SUBMISSION_UNKNOWN|RECOVERY/.test(code)) {
    return retry(text("Checking the previous swap. Try again in a moment."));
  }
  if (/VALIDATION|FORBIDDEN_ORIGIN/.test(code)) return stop(text("This request was not accepted."));
  return retry(text("Swap could not continue. Try again."));
}
