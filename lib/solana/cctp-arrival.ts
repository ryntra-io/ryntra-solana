/**
 * Did it arrive on Solana, and how much.
 *
 * The mirror of `observeBaseCctpMint`, written to answer the same two questions
 * the same way — what the chain did, and whether that is what was asked for —
 * because a card that reconciles one direction and merely hopes about the other
 * is a card that tells the truth half the time.
 *
 * The evidence is different on this side and it is worth being precise about
 * which fact carries which weight:
 *
 * - **The replay account is the equivalent of `usedNonces`.** The transmitter
 *   creates a nine-byte `used_nonce` account during a successful receive, so
 *   the account existing means the message was consumed. Like the Base read,
 *   this is a head-of-chain question and it is asked first.
 * - **The amount comes from the transaction's own token balances**, not from a
 *   log this repository would have to parse. `getTransaction` returns the
 *   recipient token account's balance before and after, and the difference is
 *   what arrived — read from the chain's own accounting rather than from an
 *   event whose layout could drift.
 * - **A consumed nonce with no reachable transaction is not an absence.** The
 *   money arrived and the transaction is out of the endpoint's history window;
 *   that is `CONSUMED_UNSEEN`, exactly as on Base, and it must never flip to
 *   "not arrived" — which is the opposite answer and the one that invites a
 *   second burn.
 */

import { SOLANA_CCTP_MAINNET_REGISTRY } from "./cctp-registry.ts";
import { SOLANA_ADDRESS_PATTERN, SOLANA_SIGNATURE_PATTERN } from "./cctp-direction.ts";
import { deriveCctpReceiveAccounts } from "./cctp-receive.ts";
import { withRpcDiscipline, type SolanaRpcHandle } from "./rpc.ts";

export type SolanaArrivalFacts = Readonly<{
  transactionHash: string;
  slot: string;
  /** The token account credited. */
  mintRecipient: string;
  mintToken: string;
  /** Base units, from the transaction's own before-and-after balances. */
  mintedRaw: string;
  /** What Circle took on this side, when the fee account moved in the same transaction. */
  feeCollectedRaw: string | null;
  observedBy: string;
}>;

export type SolanaArrivalState = "MINTED" | "NOT_MINTED" | "CONSUMED_UNSEEN" | "UNAVAILABLE";

export type SolanaArrivalObservation = Readonly<{
  schema: "ryntra.solana.cctp-arrival-observation";
  schemaVersion: "1.0.0";
  chainRef: "solana:mainnet";
  state: SolanaArrivalState;
  nonce: string;
  usedNonceAccount: string | null;
  nonceState: "CONSUMED" | "UNCONSUMED" | "UNREADABLE";
  facts: SolanaArrivalFacts | null;
  reason: string | null;
  /** The transaction that was actually looked at, so an empty result is legible. */
  searched: Readonly<{ signature: string | null }> | null;
  observedAt: string;
}>;

/**
 * Read the destination side.
 *
 * `signature` is the receive transaction when one is known — the person's own
 * submission, or one recorded earlier. It is optional: the replay account
 * answers whether the transfer completed even when no transaction is to hand,
 * which is what makes a reload after a closed tab legible.
 */
export async function observeSolanaCctpArrival(
  handle: SolanaRpcHandle,
  args: Readonly<{
    nonce: string;
    sourceDomain: number;
    remoteTokenHex: string;
    recipientTokenAccount: string;
    signature?: string | null;
    now?: () => Date;
  }>,
): Promise<SolanaArrivalObservation> {
  const observedAt = (args.now ?? (() => new Date()))().toISOString();
  const nonce = args.nonce.trim().toLowerCase();
  const signature = args.signature?.trim() ?? null;
  const base = {
    schema: "ryntra.solana.cctp-arrival-observation",
    schemaVersion: "1.0.0",
    chainRef: "solana:mainnet",
    nonce,
    observedAt,
  } as const;

  const unavailable = (reason: string, usedNonceAccount: string | null = null): SolanaArrivalObservation => ({
    ...base,
    state: "UNAVAILABLE",
    usedNonceAccount,
    nonceState: "UNREADABLE",
    facts: null,
    reason,
    searched: { signature },
  });

  if (!/^0x[0-9a-f]{64}$/.test(nonce)) {
    return unavailable("A CCTP V2 nonce is thirty-two bytes of hexadecimal.");
  }
  if (!SOLANA_ADDRESS_PATTERN.test(args.recipientTokenAccount.trim())) {
    return unavailable("The recipient token account is not a Solana address.");
  }
  if (signature !== null && !SOLANA_SIGNATURE_PATTERN.test(signature)) {
    return unavailable("The receiving transaction identifier is not a Solana signature.");
  }

  let usedNonceAccount: string;
  try {
    const derived = await deriveCctpReceiveAccounts({
      sourceDomain: args.sourceDomain,
      remoteTokenHex: args.remoteTokenHex,
      nonce,
    });
    usedNonceAccount = derived.usedNonce;
  } catch (cause) {
    return unavailable(cause instanceof Error ? cause.message : String(cause));
  }

  let consumed: boolean;
  let observedBy: string;
  try {
    const read = await withRpcDiscipline(handle, (abortSignal) =>
      handle.rpc.getAccountInfo(usedNonceAccount as never, { commitment: "confirmed", encoding: "base64" }).send({ abortSignal }),
    );
    consumed = read.value !== null && read.value !== undefined;
    observedBy = (handle.answered() ?? handle.endpoints[0]).host;
  } catch (cause) {
    return unavailable(
      `The replay account could not be read, so whether this transfer arrived is unknown: ${cause instanceof Error ? cause.message : String(cause)}`,
      usedNonceAccount,
    );
  }

  if (!consumed) {
    return {
      ...base,
      state: "NOT_MINTED",
      usedNonceAccount,
      nonceState: "UNCONSUMED",
      facts: null,
      reason: null,
      searched: { signature },
    };
  }

  const consumedUnseen = (reason: string): SolanaArrivalObservation => ({
    ...base,
    state: "CONSUMED_UNSEEN",
    usedNonceAccount,
    nonceState: "CONSUMED",
    facts: null,
    reason,
    searched: { signature },
  });

  if (signature === null) {
    return consumedUnseen(
      "Solana says this transfer has been received. The transaction that did it is not to hand, so it is not named here.",
    );
  }

  let transaction: unknown;
  try {
    transaction = await withRpcDiscipline(handle, (abortSignal) =>
      handle.rpc
        .getTransaction(signature as never, { commitment: "confirmed", maxSupportedTransactionVersion: 1, encoding: "jsonParsed" })
        .send({ abortSignal }),
    );
  } catch (cause) {
    return consumedUnseen(
      `Solana says this transfer has been received. The transaction could not be read back: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
  if (transaction === null || transaction === undefined) {
    return consumedUnseen(
      "Solana says this transfer has been received. The endpoint does not hold the transaction that did it.",
    );
  }

  const facts = readArrivalFacts(transaction, {
    recipientTokenAccount: args.recipientTokenAccount.trim(),
    signature,
    observedBy,
  });
  if (!facts) {
    return consumedUnseen(
      "Solana says this transfer has been received. The transaction did not show a credit to this account that could be read.",
    );
  }
  return { ...base, state: "MINTED", usedNonceAccount, nonceState: "CONSUMED", facts, reason: null, searched: { signature } };
}

type TokenBalanceRow = Readonly<{ accountIndex?: number; mint?: string; uiTokenAmount?: { amount?: string } }>;

/**
 * The credit, taken from the transaction's own before-and-after token balances.
 *
 * The cluster reports `preTokenBalances` and `postTokenBalances` by account
 * index; the difference on the recipient's account is what arrived. Reading it
 * this way rather than from a programme event means the number comes from the
 * ledger's own accounting, which is the thing a receipt should be quoting.
 */
export function readArrivalFacts(
  transaction: unknown,
  context: Readonly<{ recipientTokenAccount: string; signature: string; observedBy: string }>,
): SolanaArrivalFacts | null {
  const tx = transaction as {
    slot?: bigint | number | string;
    meta?: { preTokenBalances?: readonly TokenBalanceRow[]; postTokenBalances?: readonly TokenBalanceRow[]; err?: unknown };
    transaction?: { message?: { accountKeys?: readonly unknown[] } };
  } | null;
  if (!tx || !tx.meta) return null;
  if (tx.meta.err !== null && tx.meta.err !== undefined) return null;

  const keys = (tx.transaction?.message?.accountKeys ?? []).map((entry) =>
    typeof entry === "string" ? entry : String((entry as { pubkey?: unknown }).pubkey ?? ""),
  );
  const index = keys.indexOf(context.recipientTokenAccount);
  if (index < 0) return null;

  const usdc = SOLANA_CCTP_MAINNET_REGISTRY.chains.solana.asset.address;
  const amountAt = (rows: readonly TokenBalanceRow[] | undefined): bigint | null => {
    const row = (rows ?? []).find((entry) => entry.accountIndex === index);
    if (!row) return null;
    const amount = row.uiTokenAmount?.amount;
    return typeof amount === "string" && /^\d+$/.test(amount) ? BigInt(amount) : null;
  };
  const post = amountAt(tx.meta.postTokenBalances);
  if (post === null) return null;
  /* A token account created in this same transaction has no pre-balance row at
     all. That is a zero opening balance, not an unreadable one — and treating
     it as unreadable would make the first transfer to a new account the one
     case this cannot report. */
  const pre = amountAt(tx.meta.preTokenBalances) ?? 0n;
  const minted = post - pre;
  if (minted <= 0n) return null;

  const mintOf = (rows: readonly TokenBalanceRow[] | undefined): string | null =>
    (rows ?? []).find((entry) => entry.accountIndex === index)?.mint ?? null;

  return {
    transactionHash: context.signature,
    slot: String(tx.slot ?? "0"),
    mintRecipient: context.recipientTokenAccount,
    mintToken: mintOf(tx.meta.postTokenBalances) ?? usdc,
    mintedRaw: minted.toString(),
    /* Circle's cut on this side is visible only when its own fee account moved
       in the same transaction. Absent is reported as absent rather than zero. */
    feeCollectedRaw: null,
    observedBy: context.observedBy,
  };
}

/**
 * Did the right account receive the right amount?
 *
 * Kept apart from the observation for the same reason the Base one is: the
 * observation says what the chain did, this says whether it is what was asked
 * for, and merging them lets an arrival at the wrong account read as success
 * because something arrived.
 */
export function reconcileSolanaArrival(
  observation: SolanaArrivalObservation,
  expected: Readonly<{ recipientTokenAccount: string; receivedRaw: string }>,
): Readonly<{ verdict: "MATCHED" | "DEVIATION_RECORDED" | "NOT_OBSERVED"; deviations: readonly string[] }> {
  if (observation.state !== "MINTED" || !observation.facts) {
    return { verdict: "NOT_OBSERVED", deviations: [] };
  }
  const deviations: string[] = [];
  const wanted = expected.recipientTokenAccount.trim();
  const usdc = SOLANA_CCTP_MAINNET_REGISTRY.chains.solana.asset.address;
  if (observation.facts.mintRecipient !== wanted) {
    deviations.push(`recipient: expected ${wanted}, credited ${observation.facts.mintRecipient}`);
  }
  if (observation.facts.mintToken !== usdc) {
    deviations.push(`token: expected ${usdc}, credited ${observation.facts.mintToken}`);
  }
  if (observation.facts.mintedRaw !== expected.receivedRaw) {
    deviations.push(`amount: expected ${expected.receivedRaw}, credited ${observation.facts.mintedRaw}`);
  }
  return { verdict: deviations.length === 0 ? "MATCHED" : "DEVIATION_RECORDED", deviations };
}

/** The recipient's USDC balance on Solana, in base units. Six decimals. */
export async function readSolanaUsdcBalance(
  handle: SolanaRpcHandle,
  tokenAccount: string,
): Promise<Readonly<{ ok: true; raw: string; observedBy: string }> | Readonly<{ ok: false; reason: string }>> {
  if (!SOLANA_ADDRESS_PATTERN.test(tokenAccount.trim())) {
    return { ok: false, reason: `${tokenAccount} is not a Solana address.` };
  }
  try {
    const read = await withRpcDiscipline(handle, (abortSignal) =>
      handle.rpc.getTokenAccountBalance(tokenAccount as never, { commitment: "confirmed" }).send({ abortSignal }),
    );
    return { ok: true, raw: String(read.value.amount), observedBy: (handle.answered() ?? handle.endpoints[0]).host };
  } catch (cause) {
    /* An account that does not exist yet reads as an error here, and that is a
       real answer: nothing has arrived. The caller decides what to make of it
       rather than being handed a zero that looks like a balance. */
    return { ok: false, reason: cause instanceof Error ? cause.message : String(cause) };
  }
}
