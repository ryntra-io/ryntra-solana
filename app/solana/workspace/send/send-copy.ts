/**
 * Machine answers, said in a person's words.
 *
 * Everything this product knows about a transfer arrives as a code: a policy
 * rule, a capability finding, a readiness verdict, a settlement state. Those
 * codes are exact and they belong in the receipt, where an auditor reads them.
 * They do not belong on the card, where a person is deciding whether to move
 * their money — `SUPPORT NOT ESTABLISHED` above a wallet button tells the one
 * reader who matters nothing at all.
 *
 * So the translation happens here, once, in front of the surface: every code
 * becomes one sentence about the sender's money or the recipient's account,
 * and a code with no sentence falls back to a plain one rather than printing
 * itself. The same shape the Swap card uses (`failureCopy`, `reviewWarningCopies`).
 */

type Text = (english: string) => string;

/**
 * Why a request did not complete.
 *
 * Matched on the code rather than switched, because the same class of answer
 * arrives from four different routes under four different names and a sender
 * does not care which layer produced it.
 */
export function sendFailureCopy(code: string | null, text: Text): string {
  const value = code ?? "";
  if (/RATE_LIMITED/.test(value)) return text("Too many requests. Try again in a moment.");
  if (/INSUFFICIENT|BALANCE|AMOUNT/.test(value)) return text("That amount is unavailable.");
  if (/RECIPIENT|ADDRESS|DESTINATION/.test(value)) return text("Check the recipient address.");
  if (/PLAN_EXPIRED|DUPLICATE_INTENT|EXPIRED|STALE|BLOCKHASH/.test(value)) {
    return text("The transfer window closed. Review it again.");
  }
  if (/WALLET_REFUSED|USER_REJECTED|CANCELLED/.test(value)) return text("Wallet approval was cancelled.");
  if (/BYTES|FINGERPRINT|SIGNED_BYTES/.test(value)) {
    return text("Your wallet returned a different transaction. Nothing was sent.");
  }
  if (/SUBMISSION_UNKNOWN|RECOVERY/.test(value)) {
    return text("An earlier transfer is still being confirmed. Do not send it again.");
  }
  if (/SEND_NOT_PERMITTED|PAUSED/.test(value)) return text("Sending is turned off right now.");
  if (/UNAVAILABLE|STORE|READBACK|PROOF|POLICY/.test(value)) {
    return text("Sending is unavailable right now. Try again later.");
  }
  return text("The transfer could not continue. Try again.");
}

/** What the wallet said, when the wallet is the one that refused. */
export function walletFailureCopy(reason: string, text: Text): string {
  return /reject|denie|cancel|declin/i.test(reason)
    ? text("Wallet approval was cancelled.")
    : text("Your wallet did not approve this transfer.");
}

/**
 * What a person must weigh before signing.
 *
 * Only the named risks: a `PASS` finding is the absence of news and a card
 * that lists its passes teaches people to stop reading it. Every sentence
 * names an authority and what that authority can do, because that — not the
 * extension's name — is the thing a sender is being asked to accept.
 */
export function sendWarningCopy(code: string, text: Text): string | null {
  switch (code) {
    case "NON_TRANSFERABLE":
      return text("This token cannot be transferred at all.");
    case "PAUSED":
      return text("The issuer has paused transfers of this token.");
    case "SOURCE_FROZEN":
      return text("Your account for this token is frozen, so nothing can leave it.");
    case "SOURCE_STATE_UNREADABLE":
      return text("Your account for this token could not be read.");
    case "DESTINATION_FROZEN":
      return text("The recipient's account for this token is frozen.");
    case "DEFAULT_ACCOUNT_STATE_FROZEN":
      return text("New accounts for this token start frozen, so the recipient may not be able to spend it.");
    case "CONFIDENTIAL_TRANSFER_PROOF_REQUIRED":
      return text("This token requires a confidential transfer, which Ryntra cannot build.");
    case "CONFIDENTIAL_TRANSFER_CONFIGURED":
      return text("This token supports hidden balances. This transfer is a public one.");
    case "TRANSFER_HOOK":
      return text("The issuer runs its own code on every transfer of this token.");
    case "HOOK_ACCOUNTS_UNAVAILABLE":
      return text("The issuer runs its own code on this token and it could not be resolved.");
    case "PERMANENT_DELEGATE":
      return text("The issuer can move this token out of any account, including the recipient's.");
    case "FREEZE_AUTHORITY":
      return text("The issuer can freeze this token in any account, including the recipient's.");
    case "TRANSFER_FEE":
      return text("The issuer keeps a fee out of every transfer of this token.");
    case "MEMO_REQUIREMENT_UNREADABLE":
      return text("This token may require a memo, and that could not be read.");
    case "MEMO_TRANSFER_REQUIRED":
      return text("The recipient's account requires a memo with every transfer.");
    case "UNKNOWN_EXTENSION":
      return text("This token has a feature Ryntra does not yet understand.");
    /* The safety verdict's own findings. `NETWORK`, `CAPABILITY` and every
       `PASS` are deliberately absent: the first two restate what the badge and
       the findings below already say, and a pass is not news. */
    case "EMERGENCY_STOP":
      return text("Sending is turned off right now.");
    case "SIMULATION":
      return text("This transfer would fail on the network right now.");
    case "FEE_PRICED":
      return text("The network fee for this transfer could not be read.");
    case "RENT_VISIBLE":
      return text("The cost of setting up the recipient's account could not be read.");
    case "PROGRAMS_SUPPORTED":
      return text("This transfer does something Ryntra cannot explain, so it will not be sent.");
    case "REVIEW_PROOF":
      return text("Ryntra could not produce a signed record for this transfer.");
    case "SETTLEMENT_STORE":
    case "INDEPENDENT_READBACK":
      return text("Sending is unavailable right now. Try again later.");
    default:
      return null;
  }
}

/** Why a reviewed transfer is not ready for a wallet. */
export function sendReadinessCopy(code: string, text: Text): string {
  switch (code) {
    case "SIMULATION_MISSING":
      return text("The network could not check this transfer. Review it again.");
    case "SIMULATION_FAILED":
      return text("This transfer would fail on the network right now.");
    case "POLICY_NOT_CLEAR":
      return text("This transfer did not pass Ryntra's checks.");
    case "SUPPORT_BLOCKED":
      return text("This transfer cannot succeed as built.");
    case "SUPPORT_NOT_ESTABLISHED":
      return text("Ryntra cannot yet explain how this token moves.");
    case "BASE_FEE_UNKNOWN":
      return text("The network fee could not be read. Review it again.");
    case "REVIEW_PROOF_UNSIGNED":
      return text("Ryntra could not produce a signed record for this transfer.");
    default:
      return text("This transfer is not ready to send.");
  }
}

/**
 * A signed transfer whose outcome is not a receipt.
 *
 * Every one of these is a state where money did not move, or where whether it
 * moved is still open. The distinction the sender needs is exactly that, and
 * the one instruction that matters is never to send it again.
 */
export function sendOutcomeCopy(state: string, text: Text): string {
  if (/EXPIRED/.test(state)) return text("This transfer never reached the network. Nothing moved.");
  if (/LANDED_FAILED|FAILED/.test(state)) return text("The network rejected this transfer. Nothing moved.");
  return text("This transfer is not confirmed yet. Open it on the explorer before sending again.");
}

/** Whether a settled state means nothing happened. */
export function nothingMoved(state: string): boolean {
  return /EXPIRED|LANDED_FAILED/.test(state);
}
