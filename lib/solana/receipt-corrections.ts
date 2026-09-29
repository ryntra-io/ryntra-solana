/**
 * Receipt corrections, resolved for a receipt by its exact hashes.
 *
 * A correction is a later, hash-bound statement by the issuer that a
 * limitation or action reference in an original signed receipt was
 * inaccurate; the original stays immutable and the verifier reports both.
 * The verifier knows nothing about which receipts exist — it asks this
 * registry. The toolkit ships the registry empty; an application that issues
 * receipts registers a resolver for each correction it has published.
 */
export type ReceiptCorrection = Readonly<{
  schema: string;
  schemaVersion: string;
  codes: readonly string[];
  correctionHash: string;
  receipt: Readonly<{
    id: string;
    contentHash: string;
    integrityHash: string;
    transactionSignature: string;
  }>;
}>;

export type ReceiptCorrectionResolver = (receipt: unknown) => ReceiptCorrection | null;

const resolvers: ReceiptCorrectionResolver[] = [];

/** Registers a resolver once; registering the same function twice is a no-op. */
export function registerReceiptCorrection(resolver: ReceiptCorrectionResolver): void {
  if (!resolvers.includes(resolver)) resolvers.push(resolver);
}

export function correctionForReceipt(receipt: unknown): ReceiptCorrection | null {
  for (const resolve of resolvers) {
    const correction = resolve(receipt);
    if (correction) return correction;
  }
  return null;
}
