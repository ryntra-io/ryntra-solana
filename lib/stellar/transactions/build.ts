import { Account, Asset, BASE_FEE, Memo, Operation, TransactionBuilder, type Transaction } from "@stellar/stellar-sdk";

import type { AssetIdentity } from "../asset.ts";
import type { StellarNetwork } from "../network.ts";
import { fingerprintTransaction, type TransactionFingerprint } from "./fingerprint.ts";

/**
 * Building the exact bytes a person is asked to authorize.
 *
 * Pure by construction: the source account and its sequence number are inputs,
 * not something this reaches out and fetches. That is what makes the whole
 * builder testable without a network, and it keeps the read layer the only
 * place that talks to Stellar.
 *
 * It builds and returns the fingerprint together, because those are one act.
 * A builder that returns bytes and leaves the caller to remember to fingerprint
 * them is a builder whose safety depends on a caller remembering.
 */

export type BuiltTransaction = Readonly<{
  /** The unsigned XDR, which is what a wallet is asked to sign. */
  unsignedXdr: string;
  /** What the person is authorizing, captured before the bytes leave. */
  fingerprint: TransactionFingerprint;
  transaction: Transaction;
}>;

/**
 * How long the authorization is good for.
 *
 * A transaction with no upper time bound can be submitted at any point in the
 * future by anyone holding the signed bytes. Bounding it means a signature that
 * was never submitted expires instead of waiting indefinitely for a moment
 * nobody intended.
 */
export const AUTHORIZATION_WINDOW_SECONDS = 300;

/**
 * The fee ceiling a build uses when a caller supplies none.
 *
 * Re-exported so a surface can name the same number without importing the SDK.
 * A first attempt had the Authorize console import `BASE_FEE` directly, and the
 * boundary test caught it — the SDK belongs to this layer and nowhere above,
 * which is the property that keeps the public read surface free of it.
 */
export const DEFAULT_FEE_STROOPS = BASE_FEE;

function toAsset(asset: AssetIdentity): Asset {
  if (asset.native) return Asset.native();
  if (!asset.issuer) {
    throw new Error(`${asset.code} has no issuer, so it cannot be built into an operation.`);
  }
  return new Asset(asset.code, asset.issuer);
}

export type PaymentIntent = Readonly<{
  network: StellarNetwork;
  /** The signing account, and the sequence it is currently at. */
  source: string;
  sequence: string;
  destination: string;
  asset: AssetIdentity;
  /** A decimal string, exactly as it will appear on the ledger. */
  amount: string;
  memo?: string;
  /** Stroops. Read from the ledger by the caller rather than assumed here. */
  baseFee?: string;
  /** Unix seconds. Passed in so a build is deterministic and testable. */
  now?: number;
}>;

/**
 * One payment, unsigned.
 *
 * The amount is taken as a string and passed through untouched. Converting it
 * to a number on the way in would round at the fifteenth digit, and Stellar
 * amounts carry seven decimals — a rounding no one asked for, applied to money,
 * invisible until it reaches a ledger.
 */
export function buildPayment(intent: PaymentIntent): BuiltTransaction {
  if (!/^\d+(\.\d{1,7})?$/.test(intent.amount)) {
    throw new Error(
      `"${intent.amount}" is not a Stellar amount. It must be a decimal string with at most seven places.`,
    );
  }

  const account = new Account(intent.source, intent.sequence);
  const startedAt = intent.now ?? Math.floor(Date.now() / 1000);

  const builder = new TransactionBuilder(account, {
    fee: intent.baseFee ?? BASE_FEE,
    networkPassphrase: intent.network.passphrase,
  })
    .addOperation(
      Operation.payment({
        destination: intent.destination,
        asset: toAsset(intent.asset),
        amount: intent.amount,
      }),
    )
    .setTimebounds(startedAt, startedAt + AUTHORIZATION_WINDOW_SECONDS);

  if (intent.memo) builder.addMemo(Memo.text(intent.memo));

  const transaction = builder.build();
  return {
    unsignedXdr: transaction.toXDR(),
    fingerprint: fingerprintTransaction(transaction),
    transaction,
  };
}
