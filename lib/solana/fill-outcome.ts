/**
 * What a settled answer means to the person who signed.
 *
 * The engine answers in the ledger's words — `MATCHED`, `DEVIATION_RECORDED`,
 * `RECOVERY`, `FAILED`, `EXPIRED_AFTER_SUBMIT` — and every one of them is
 * exact and belongs in the Receipt. On the ticket they said the wrong thing:
 * a fill whose output differed from the quote by one raw unit, which is what
 * a market order does, was `DEVIATION_RECORDED` and painted amber as
 * *Finished with a note*; the Owner's first Spot fill (finalized, the fee
 * collected) read as a warning, and an expired attempt read as a warning with
 * no sentence at all. The ledger's state machine is untouched here; this is
 * the one place that turns its states into the sentence a trader needs —
 * *Bought*, *Nothing happened*, *Not filled* — and keeps the note for the
 * cases that are actually a note.
 */

export type SpotFillReconciliation = Readonly<{
  state: string;
  minimumMet?: boolean;
  deviations?: readonly string[];
}>;

export type SpotFillAnswer = Readonly<{
  state: string;
  observation: Readonly<{ actualInputRaw: string; actualOutputRaw: string }> | null;
  facts: Readonly<{ reconciliation: SpotFillReconciliation }> | null;
  receipt: unknown;
}>;

export type SpotFillOutcome =
  /** Landed, at or above the reviewed minimum, receipted: a fill. */
  | Readonly<{ kind: "FILLED"; note: null }>
  /** Landed and receipted, but the chain's numbers are not the Review's. */
  | Readonly<{ kind: "FILLED"; note: "BELOW_MINIMUM" | "NOT_AS_REVIEWED" }>
  /** The transaction never reached the chain and no longer can; nothing moved. */
  | Readonly<{ kind: "NOTHING_HAPPENED"; state: "EXPIRED_BEFORE_SUBMIT" | "EXPIRED_AFTER_SUBMIT" | "UNKNOWN_TO_CHAIN" }>
  /** Landed with a chain error: only the network fee was spent. */
  | Readonly<{ kind: "NOT_FILLED" }>
  /** An answer this classifier will not name: the ledger's sentence stands. */
  | Readonly<{ kind: "UNPLACED" }>;

const NOTHING_HAPPENED = new Set(["EXPIRED_BEFORE_SUBMIT", "EXPIRED_AFTER_SUBMIT", "UNKNOWN_TO_CHAIN"]);
/* The route's own top-level states that mean the swap landed and was
   reconciled — the recovery answers, and the execute answer that carries the
   reconciliation state itself. */
const LANDED = new Set(["MATCHED", "DEVIATION_RECORDED", "RECOVERY", "RECOVERED", "ALREADY_RECEIPTED", "RECEIPTED"]);

export function classifySpotFill(answer: SpotFillAnswer): SpotFillOutcome {
  if (NOTHING_HAPPENED.has(answer.state)) return { kind: "NOTHING_HAPPENED", state: answer.state as "EXPIRED_AFTER_SUBMIT" };
  const reconciliation = answer.facts?.reconciliation ?? null;
  if (answer.state === "FAILED" || reconciliation?.state === "FAILED") return { kind: "NOT_FILLED" };
  if (!LANDED.has(answer.state) && !(reconciliation && LANDED.has(reconciliation.state))) return { kind: "UNPLACED" };
  if (reconciliation) {
    const deviations = reconciliation.deviations ?? [];
    if (reconciliation.minimumMet === false || deviations.includes("BELOW_MINIMUM")) return { kind: "FILLED", note: "BELOW_MINIMUM" };
    if (reconciliation.state === "RECOVERY" || reconciliation.state === "UNKNOWN") return { kind: "FILLED", note: "NOT_AS_REVIEWED" };
    return { kind: "FILLED", note: null };
  }
  /* A Receipt already minted for this signature says the swap landed and was
     reconciled once; the amounts live in the Receipt rather than here. */
  if (answer.receipt || answer.observation) return { kind: "FILLED", note: null };
  return { kind: "UNPLACED" };
}

/**
 * The price a fill achieved, in the quote asset per unit of the market —
 * what was paid over what was received on a buy, the reverse on a sell.
 */
export function achievedPrice(baseAmount: number | null, quoteAmount: number | null): number | null {
  if (baseAmount === null || quoteAmount === null || !(baseAmount > 0) || !(quoteAmount > 0)) return null;
  return quoteAmount / baseAmount;
}
