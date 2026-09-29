import { xdr } from "@stellar/stellar-sdk";

import { horizonGet, type ClientLimits } from "../client.ts";
import { resolved, unavailable, unknown, type Evidence } from "../evidence.ts";
import { stellarSourceRef, type StellarNetwork } from "../network.ts";
import type { TransactionFingerprint } from "./fingerprint.ts";

/**
 * What was meant to happen, and what the ledger says happened.
 *
 * Two sides of the same shape on purpose. Reconciliation is only meaningful if
 * both sides are expressed in the same vocabulary, and the way that quietly
 * fails is to compare an intent's fields against a ledger's fields and call the
 * translation obvious. It is not: an intent says "pay 3 USDC to G…", a ledger
 * says "G… was credited 3.0000000 of credit_alphanum4 USDC issued by GBBD…".
 * So both are projected into movements first, and the comparison happens after
 * the translation rather than inside it.
 *
 * **Amounts are compared in stroops.** Stellar carries seven decimal places, so
 * `3` and `3.0000000` are the same amount written two ways, and a string
 * comparison would call them a deviation. Parsing to a float would introduce a
 * rounding at the fifteenth digit. An integer count of the smallest unit is
 * exact and is what the ledger itself stores.
 *
 * **Freshness here means the observation, not the fact.** A ledger entry is
 * immutable; it does not go stale. What can be stale is our last look at it, so
 * `observedAt` is the moment the read returned and the age is the age of the
 * check. The ledger's own close time travels inside the data, where it belongs.
 */

export type MovementKind = "CREDIT" | "DEBIT";

export type Movement = Readonly<{
  kind: MovementKind;
  account: string;
  /** `native`, or `CODE:ISSUER`. One spelling, whichever side produced it. */
  asset: string;
  /** Integer count of stroops. The exact comparison key. */
  stroops: string;
  /** As the source wrote it, kept for display and for the receipt. */
  amount: string;
}>;

export type ExpectedEffects = Readonly<{
  source: string;
  memo: string;
  /** The ceiling a signature authorized, not a prediction of what is charged. */
  maxFeeStroops: string;
  movements: readonly Movement[];
  /**
   * Operations this projection does not model.
   *
   * Non-empty means the expectation is incomplete, and reconciliation must
   * refuse to say `MATCHED` rather than matching the part it understood.
   */
  unprojectedOperations: readonly string[];
}>;

/**
 * Why the network did what it did.
 *
 * Reconciliation without this says what did not happen and never why, which is
 * the difference between a report and a diagnosis. The first owner-signed run
 * landed here: the ledger rejected the payment, the surface correctly recorded
 * a deviation and said *"the ledger recorded no such movement"* — true, and
 * useless. The actual answer, `paymentNoDestination`, was sitting in the result
 * XDR that nothing read.
 *
 * On Stellar the negative case is the product, and a negative case that cannot
 * explain itself is half of one.
 */
export type LedgerOutcome = Readonly<{
  /** The transaction-level result, e.g. `txSuccess`, `txFailed`, `txTooLate`. */
  code: string;
  /** One per operation, in order, e.g. `paymentNoDestination`. */
  operations: readonly string[];
  /** The same thing in a sentence, when this module knows one. */
  explanation: string | null;
}>;

export type ActualEffects = Readonly<{
  transactionHash: string;
  ledger: number;
  closedAt: string;
  successful: boolean;
  feeChargedStroops: string;
  movements: readonly Movement[];
  /** What the network decided, and why. */
  outcome: LedgerOutcome;
  /** Effect types the ledger recorded that this projection does not model. */
  unmodelledEffects: readonly string[];
  /**
   * The ledger's own copy of what was signed.
   *
   * Carried so a receipt can be checked by someone who has only the receipt.
   * Without it, the expectation on a receipt is Ryntra's word for what was
   * authorized; with it, a reader can re-derive the expectation from the bytes
   * the network recorded and compare the two. It is the difference between
   * "verify our claim" and "verify it yourself".
   */
  envelopeXdr: string;
}>;

const STROOPS_PER_UNIT = 10_000_000n;

/** Exact, or `null`. A number that cannot be parsed is never guessed at. */
export function toStroops(amount: string): string | null {
  const match = /^(\d+)(?:\.(\d{1,7}))?$/.exec(amount.trim());
  if (!match) return null;
  const fraction = (match[2] ?? "").padEnd(7, "0");
  return (BigInt(match[1]) * STROOPS_PER_UNIT + BigInt(fraction)).toString();
}

function movement(kind: MovementKind, account: string, asset: string, amount: string): Movement | null {
  const stroops = toStroops(amount);
  if (stroops === null) return null;
  return { kind, account, asset, stroops, amount };
}

/**
 * One spelling for an asset, whichever side named it.
 *
 * The SDK writes `native` for XLM and `CODE:ISSUER` otherwise; Horizon writes a
 * type plus two fields. Normalising both here means the comparison never has to
 * know which source it is looking at.
 */
export function canonicalAsset(input: { assetType?: string; code?: string; issuer?: string } | string): string {
  if (typeof input === "string") return input === "native" ? "native" : input;
  if (input.assetType === "native" || (!input.code && !input.issuer)) return "native";
  return `${input.code}:${input.issuer}`;
}

/**
 * The expectation, taken from what the person authorized.
 *
 * From the fingerprint rather than from the form fields: the fingerprint is
 * what was compared against the signature, so an expectation derived from it is
 * an expectation about the exact transaction that was signed. Rebuilding it
 * from the inputs would reconcile against what someone typed.
 */
export function expectedFromFingerprint(fingerprint: TransactionFingerprint): ExpectedEffects {
  const movements: Movement[] = [];
  const unprojected: string[] = [];

  for (const operation of fingerprint.operations) {
    const from = operation.source ?? fingerprint.source;
    if (operation.type === "payment") {
      const asset = canonicalAsset(operation.fields.asset ?? "native");
      const amount = operation.fields.amount ?? "";
      const credit = movement("CREDIT", operation.fields.destination ?? "", asset, amount);
      const debit = movement("DEBIT", from, asset, amount);
      if (credit && debit) {
        movements.push(credit, debit);
        continue;
      }
    }
    /* Anything this does not model — including a payment whose amount could not
       be parsed — is named rather than dropped. A silently skipped operation is
       an expectation that quietly stops covering what was signed. */
    unprojected.push(operation.type);
  }

  return {
    source: fingerprint.source,
    memo: fingerprint.memo,
    maxFeeStroops: fingerprint.fee,
    movements,
    unprojectedOperations: unprojected,
  };
}

/**
 * The result codes this module can put into words.
 *
 * A deliberate short list rather than an exhaustive one: these are the ways a
 * payment built by this product actually fails, and each sentence names the
 * next action. Anything absent keeps its raw code, which is still far better
 * than silence — a code can be searched, "no such movement" cannot.
 */
const OUTCOME_EXPLANATIONS: Readonly<Record<string, string>> = {
  paymentNoDestination:
    "The destination account does not exist on this network. Stellar will not create an account by paying it — it has to exist first, funded by someone or created by a create-account operation.",
  paymentUnderfunded: "The source account did not hold enough of this asset when the ledger applied the transaction.",
  paymentSrcNoTrust: "The source account has no trustline for this asset.",
  paymentNoTrust: "The destination account has no trustline for this asset, so it cannot receive it.",
  paymentNotAuthorized: "The issuer has not authorized one of these accounts to hold this asset.",
  paymentSrcNotAuthorized: "The issuer has not authorized the source account to hold this asset.",
  paymentLineFull: "The destination's trustline limit would be exceeded by this amount.",
  txInsufficientBalance: "The source account could not cover the fee.",
  txBadSeq: "The sequence number was no longer current when the network applied it — another transaction from this account went first.",
  txTooLate: "The authorization window closed before the network applied it.",
  txNoAccount: "The source account does not exist on this network.",
};

/**
 * What the network decided, read from the only place it is recorded.
 *
 * Defensive throughout: a result XDR that cannot be decoded produces an unknown
 * outcome rather than an exception. This runs while a person is looking at a
 * failed payment, and the one thing worse than an unexplained failure is a
 * blank screen where the explanation was supposed to be.
 */
export function decodeOutcome(resultXdr: string): LedgerOutcome {
  try {
    const decoded = xdr.TransactionResult.fromXDR(resultXdr, "base64");
    const code = decoded.result().switch().name;

    const operations: string[] = [];
    /* `results()` exists only on the branches that carry per-operation results;
       a fee-bump or a pre-application failure has none. */
    const inner = (decoded.result() as { results?: () => readonly unknown[] }).results?.() ?? [];
    for (const operation of inner) {
      const entry = operation as { switch: () => { name: string }; value?: () => unknown };
      const wrapped = entry.value?.() as { value?: () => { switch?: () => { name: string } } } | undefined;
      const detail = wrapped?.value?.()?.switch?.().name;
      operations.push(detail ?? entry.switch().name);
    }

    const named = operations.find((entry) => OUTCOME_EXPLANATIONS[entry]) ?? (OUTCOME_EXPLANATIONS[code] ? code : null);
    return { code, operations, explanation: named ? OUTCOME_EXPLANATIONS[named] : null };
  } catch {
    return { code: "UNREADABLE", operations: [], explanation: "The network's own result could not be decoded." };
  }
}

type HorizonTransaction = {
  hash?: string;
  ledger?: number;
  created_at?: string;
  successful?: boolean;
  fee_charged?: string | number;
  envelope_xdr?: string;
  result_xdr?: string;
};

type HorizonEffect = {
  type?: string;
  account?: string;
  amount?: string;
  asset_type?: string;
  asset_code?: string;
  asset_issuer?: string;
};

export type ObserveOptions = Readonly<{
  limits?: ClientLimits;
  fetchImpl?: typeof globalThis.fetch;
  now?: Date;
  /** How old an observation may be before it is reported as stale. */
  maxAgeSeconds?: number;
}>;

/**
 * What the ledger recorded, read back independently.
 *
 * Horizon rather than RPC, and for a stated reason: RPC returns the result as
 * XDR, while the credits and debits a person needs to check are already JSON on
 * Horizon. Canon permits Horizon for exactly this kind of classic gap and
 * forbids depending on it alone forever — every value carries the source that
 * answered, so replacing it later is a source change and not a rewrite.
 *
 * A probe on 2026-08-13 measured the two reads at 3,830 and 2,542 bytes for a
 * real classic payment, and confirmed that a payment produces exactly two
 * effects — `account_credited` and `account_debited` — with no effect for the
 * fee.
 */
export async function observeActualEffects(
  network: StellarNetwork,
  transactionHash: string,
  options: ObserveOptions = {},
): Promise<Evidence<ActualEffects>> {
  const now = options.now ?? new Date();
  const transactionRef = stellarSourceRef(network, "horizon", `transactions/${transactionHash}`);
  const effectsRef = stellarSourceRef(network, "horizon", `transactions/${transactionHash}/effects`);
  const sources = [
    { ref: transactionRef, label: `${network.label} Horizon transaction` },
    { ref: effectsRef, label: `${network.label} Horizon effects` },
  ] as const;

  const transaction = await horizonGet(network.horizonUrl, `transactions/${transactionHash}`, {}, options);
  if (!transaction.ok) {
    /* A 404 is the ordinary case here — the transaction is not on a ledger, or
       not indexed yet — so it reads as unknown rather than as a broken source.
       Either way the reason is the endpoint's own words. */
    return unknown(
      `The ledger has no record of ${transactionHash} that Horizon could return: ${transaction.reason}`,
      [sources[0]],
      now,
    );
  }

  const record = transaction.value as HorizonTransaction;
  const ledger = Number(record.ledger);
  if (!Number.isFinite(ledger) || typeof record.created_at !== "string") {
    return unavailable("Horizon returned a transaction without a readable ledger or close time.", [sources[0]], now);
  }

  const effects = await horizonGet(network.horizonUrl, `transactions/${transactionHash}/effects`, {}, options);
  if (!effects.ok) {
    /* The transaction is a fact and the effects are not readable. Reporting the
       half we have as though it were the whole would be exactly the shape of a
       receipt that says more than it knows. */
    return unavailable(`The transaction is on ledger ${ledger}, but its effects could not be read: ${effects.reason}`, [...sources], now);
  }

  const records = ((effects.value as { _embedded?: { records?: HorizonEffect[] } })._embedded?.records ?? []) as HorizonEffect[];
  const movements: Movement[] = [];
  const unmodelled: string[] = [];
  for (const effect of records) {
    const kind = effect.type === "account_credited" ? "CREDIT" : effect.type === "account_debited" ? "DEBIT" : null;
    const projected =
      kind && effect.account && effect.amount
        ? movement(kind, effect.account, canonicalAsset({ assetType: effect.asset_type, code: effect.asset_code, issuer: effect.asset_issuer }), effect.amount)
        : null;
    if (projected) movements.push(projected);
    else unmodelled.push(effect.type ?? "(untyped effect)");
  }

  /* No default. A missing fee is a source that did not answer the question, and
     writing `0` there would put a number Ryntra invented onto a receipt. */
  const feeCharged = record.fee_charged === undefined || record.fee_charged === null ? null : String(record.fee_charged);
  if (feeCharged === null || !/^\d+$/.test(feeCharged)) {
    return unavailable(
      `Horizon returned transaction ${transactionHash} without a readable fee, so what it cost cannot be reconciled.`,
      [...sources],
      now,
    );
  }

  return resolved({
    data: {
      transactionHash,
      ledger,
      closedAt: new Date(record.created_at).toISOString(),
      successful: record.successful === true,
      feeChargedStroops: feeCharged,
      movements,
      unmodelledEffects: unmodelled,
      outcome: decodeOutcome(typeof record.result_xdr === "string" ? record.result_xdr : ""),
      envelopeXdr: typeof record.envelope_xdr === "string" ? record.envelope_xdr : "",
    },
    sources,
    observedAt: now,
    maxAgeSeconds: options.maxAgeSeconds ?? 300,
    now,
  });
}
