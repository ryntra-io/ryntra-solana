import type { GuardReconciliationStatus } from "../../guard/status-values.ts";
import type { ActualEffects, ExpectedEffects, Movement } from "./effects.ts";

/**
 * Expected against actual, with the third answer kept.
 *
 * Most reconciliation is written as a boolean and that is where it goes wrong.
 * There are three outcomes, not two: it matched, it deviated, or something
 * could not be checked — and the third is the one that matters, because it is
 * the one a green tick would hide. A transaction carrying an operation this
 * projection does not model, or an effect it does not recognise, has not
 * matched; it has been partially examined, and saying so is the whole point.
 *
 * The vocabulary is the Guard kernel's own `GuardReconciliationStatus`, not a
 * Stellar copy of it. There is one reconciliation vocabulary in this product
 * and a second one written for a second chain is how two chains end up meaning
 * different things by the same word on the same receipt.
 */

export type CheckOutcome = "MATCHED" | "DEVIATION" | "UNCHECKABLE";

export type ReconciliationCheck = Readonly<{
  id: string;
  label: string;
  outcome: CheckOutcome;
  expected: string;
  actual: string;
}>;

export type Reconciliation = Readonly<{
  status: GuardReconciliationStatus;
  checks: readonly ReconciliationCheck[];
}>;

const describeMovement = (movement: Movement) =>
  `${movement.kind === "CREDIT" ? "credit" : "debit"} ${movement.amount} ${movement.asset} · ${movement.account}`;

const sameMovement = (left: Movement, right: Movement) =>
  left.kind === right.kind &&
  left.account === right.account &&
  left.asset === right.asset &&
  /* Stroops, so `3` and `3.0000000` are one amount rather than a deviation. */
  left.stroops === right.stroops;

export function reconcile(expected: ExpectedEffects, actual: ActualEffects): Reconciliation {
  const checks: ReconciliationCheck[] = [];

  /* The network's own result code, not a restatement of `successful`. A
     rejection reported as "rejected" tells a person nothing they cannot see;
     `paymentNoDestination` tells them what to do next. */
  const refusal = [actual.outcome.code, ...actual.outcome.operations].filter(
    (code, index, all) => code && code !== "opInner" && all.indexOf(code) === index,
  );
  checks.push({
    id: "ledger.outcome",
    label: "The ledger applied the transaction",
    outcome: actual.successful ? "MATCHED" : "DEVIATION",
    expected: "applied",
    actual: actual.successful
      ? `applied in ledger ${actual.ledger}`
      : `rejected in ledger ${actual.ledger} — ${refusal.join(" · ") || "no result code"}`,
  });

  /* Consumed as they match, so two identical movements need two on the other
     side. Matching by search alone would let one actual credit satisfy two
     expected ones and report a half-executed transaction as complete. */
  const remaining = [...actual.movements];
  for (const [index, want] of expected.movements.entries()) {
    const found = remaining.findIndex((candidate) => sameMovement(candidate, want));
    if (found >= 0) {
      remaining.splice(found, 1);
      checks.push({
        id: `movement.${index}`,
        label: want.kind === "CREDIT" ? "The destination was credited" : "The source was debited",
        outcome: "MATCHED",
        expected: describeMovement(want),
        actual: describeMovement(want),
      });
      continue;
    }
    /* Named against the closest thing the ledger did to the same account, so a
       deviation reads as "5 arrived, not 3" rather than "not found". */
    const near = remaining.find((candidate) => candidate.account === want.account && candidate.kind === want.kind);
    checks.push({
      id: `movement.${index}`,
      label: want.kind === "CREDIT" ? "The destination was credited" : "The source was debited",
      outcome: "DEVIATION",
      expected: describeMovement(want),
      actual: near ? describeMovement(near) : "the ledger recorded no such movement",
    });
    if (near) remaining.splice(remaining.indexOf(near), 1);
  }

  for (const extra of remaining) {
    checks.push({
      id: `movement.extra.${extra.account}.${extra.asset}.${extra.stroops}`,
      label: "The ledger recorded a movement nobody authorized",
      outcome: "DEVIATION",
      expected: "no further movement",
      actual: describeMovement(extra),
    });
  }

  /*
   * The fee is a ceiling, not a prediction.
   *
   * A signature authorizes *at most* the fee in the transaction; the network
   * charges what the ledger's surge pricing decided, which is normally less.
   * Comparing them for equality would report a deviation on almost every honest
   * transaction, and the check that cries wolf is the check nobody reads.
   */
  const ceiling = BigInt(/^\d+$/.test(expected.maxFeeStroops) ? expected.maxFeeStroops : "0");
  const charged = BigInt(/^\d+$/.test(actual.feeChargedStroops) ? actual.feeChargedStroops : "0");
  checks.push({
    id: "fee.ceiling",
    label: "The fee stayed inside what was authorized",
    outcome: charged <= ceiling ? "MATCHED" : "DEVIATION",
    expected: `at most ${expected.maxFeeStroops} stroops`,
    actual: `${actual.feeChargedStroops} stroops`,
  });

  for (const operation of expected.unprojectedOperations) {
    checks.push({
      id: `unprojected.${operation}`,
      label: "An authorized operation this reconciliation does not model",
      outcome: "UNCHECKABLE",
      expected: operation,
      actual: "not compared",
    });
  }
  for (const effect of actual.unmodelledEffects) {
    checks.push({
      id: `unmodelled.${effect}`,
      label: "A ledger effect this reconciliation does not model",
      outcome: "UNCHECKABLE",
      expected: "not compared",
      actual: effect,
    });
  }

  const deviated = checks.some((check) => check.outcome === "DEVIATION");
  const uncheckable = checks.some((check) => check.outcome === "UNCHECKABLE");
  /* An expectation with nothing in it must never read as matched. Zero
     comparisons is the state of not having reconciled, and the difference
     between that and agreement is the difference a receipt exists to record. */
  const compared = expected.movements.length > 0;

  const status: GuardReconciliationStatus = deviated
    ? "DEVIATION_RECORDED"
    : uncheckable || !compared
      ? "RECONCILIATION_REQUIRED"
      : "MATCHED";

  return { status, checks };
}
