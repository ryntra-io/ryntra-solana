/**
 * Where a cross-chain swap is, in the one shape every provider answers in.
 *
 * Moved out of `lib/mayan/explorer-api.ts` by `RYN-SOL-MONEY-FLOWS-001H` for
 * the same reason the quote shape moved: a second provider has to produce this
 * shape, and a shape that lives inside one provider is one the other must
 * import from its competitor. `explorer-api.ts` re-exports it, so nothing that
 * already imported it from there had to change.
 *
 * `clientStatus` is the only tri-state a person is ever shown. Everything else
 * — the provider's own granular status, the hashes, the refund detail — is for
 * the order record and the Pro disclosure. A provider that has not yet indexed
 * a transaction is `found: false` with reason `NOT_INDEXED`: not an error, and
 * never a reason to submit anything a second time.
 */

/** In progress, paid, or refunded. The three things a person needs to know. */
export type CrossSwapClientStatus = "INPROGRESS" | "COMPLETED" | "REFUNDED";

export type CrossSwapProviderStatus = Readonly<{
  found: true;
  clientStatus: CrossSwapClientStatus | null;
  status: string | null;
  service: string | null;
  orderId: string | null;
  sourceTxHash: string | null;
  /** The transaction that paid the person on the destination chain, when there is one. */
  destinationTxHash: string | null;
  refundTxHash: string | null;
  /** Human decimal of the output token, as the provider reports it. */
  toAmount: string | null;
  /**
   * What the provider says about Ryntra's service fee on the finished operation.
   *
   * `null` when the provider was not asked or has nothing to say yet. Present, it
   * is the difference between a fee that was quoted and one that was **taken** —
   * Relay is explicit that an unsupported operation collects nothing and reports
   * no error, so this is read rather than inferred. `collected: false` with a
   * quoted figure beside it is a legitimate and important answer.
   */
  serviceFee: Readonly<{
    collected: boolean;
    quotedUsd: number | null;
    paidUsd: number | null;
    paidAmountRaw: string | null;
    /** Provider-reported fee units; null explicitly means unknown, never input units. */
    currency?: Readonly<{ address: string | null; symbol: string; decimals: number }> | null;
    basisPoints?: number | null;
    /**
     * Who ended up with what, in raw units, and keyed by the operation so a
     * second read of the same request is the same income rather than new income.
     * Absent where the provider states a rate but no amount.
     */
    settlement?: Readonly<{
      userPaidRaw: string | null;
      providerRaw: string | null;
      ryntraRaw: string | null;
      basis: "OBSERVED" | "RYNTRA_OBSERVED_SPLIT_DOCUMENTED";
      operationRef: string;
    }>;
  }> | null;
  refund: Readonly<{ chain: string | null; tokenAddress: string | null; tokenSymbol: string | null; amount: string | null }> | null;
  completedAt: string | null;
  statusUpdatedAt: string | null;
  observedAt: string;
}>;

export type CrossSwapProviderLookup =
  | CrossSwapProviderStatus
  | Readonly<{ found: false; reason: "NOT_INDEXED"; observedAt: string }>
  | Readonly<{ found: false; reason: "RATE_LIMITED" | "HTTP_ERROR" | "TRANSPORT" | "UNREADABLE"; status: number | null; message: string; observedAt: string }>;
