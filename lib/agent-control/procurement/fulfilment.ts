/**
 * One payment, at most one execution.
 *
 * This is the invariant the x402 security notes put first and the one the
 * registry row names twice: a single payment never buys the resource twice, and
 * a settlement nobody can confirm never becomes a second charge. Both halves
 * are properties of a durable, atomically claimed row rather than of a caller's
 * discipline, because a caller that retries is exactly the caller this has to
 * survive.
 *
 * ## Two keys, claimed together
 *
 * A purchase is claimed on **two** keys in one atomic insert:
 *
 * - `…:payment:<paymentId>` — the authorization. A retry of the same signed
 *   payload lands on the row it already wrote, and the answer is the outcome
 *   that row holds. Not an error: a buyer whose connection dropped is entitled
 *   to the report they paid for, and charging them again to get it is the
 *   defect.
 * - `…:quote:<nonce>` — the quote. One `402` is one sale. Without this key a
 *   buyer could sign two different authorizations against one quote, pay twice
 *   and receive two reports, and each payment would individually satisfy
 *   "one payment, one resource" while the buyer was charged double.
 *
 * `insertAllIfAbsent` writes both or neither, so two requests arriving together
 * cannot each win one key.
 *
 * ## Unknown is a state, not a retry
 *
 * When the facilitator's answer is lost — a timeout after it settled, a
 * connection reset, an unreadable body — the payment is `UNKNOWN` and the sale
 * is `AWAITING_RECONCILIATION`. Nothing is delivered (fail closed) and nothing
 * is charged again. A later confirmation may move `UNKNOWN` to `SETTLED` or
 * `FAILED`; no path moves a settled payment back to unsettled, and no path
 * takes a second authorization for the same quote.
 *
 * ## The two axes stay the kernel's
 *
 * Payment status, delivery status, their disjoint admissible sources and the
 * `PAID_BUT_UNSERVED` pairing all come from `../payments/vocabulary.ts`. This
 * module stores them and refuses transitions; it does not define a second
 * vocabulary for the same facts.
 */

import type { GuardStore } from "../../guard/store.ts";
import {
  settlementPairing,
  type EvidenceSourceKind,
  type PaymentStatus,
  type ReconciliationStatus,
  type ServiceDeliveryStatus,
  type SettlementPairingCode,
} from "../payments/vocabulary.ts";
import type { X402Facilitator } from "./protocol.ts";

const COLLECTION = "agentProcurementPayments" as const;

/** Which side of the hub a row belongs to. Ryntra sells and Ryntra buys. */
export const PROCUREMENT_SIDES = ["SALE", "PURCHASE"] as const;

export type ProcurementSide = (typeof PROCUREMENT_SIDES)[number];

/** Whether anything is owed back, and why. Separate from whether it worked. */
export const REFUND_STATES = ["NOT_DUE", "DUE", "REQUESTED", "SETTLED", "UNAVAILABLE"] as const;

export type RefundState = (typeof REFUND_STATES)[number];

export type FulfilmentRecord = Readonly<{
  kind: "PAYMENT";
  version: number;
  paymentId: string;
  side: ProcurementSide;
  /** The quote this answers. One quote, one sale. */
  nonce: string;
  requirementsDigest: string;
  resourceDigest: string;
  network: string;
  assetRef: string;
  amountBaseUnits: string;
  payer: string;
  payTo: string;
  facilitator: X402Facilitator;
  paymentStatus: PaymentStatus;
  paymentSource: EvidenceSourceKind | null;
  serviceDeliveryStatus: ServiceDeliveryStatus;
  serviceDeliverySource: EvidenceSourceKind | null;
  reconciliation: ReconciliationStatus;
  pairing: SettlementPairingCode | null;
  refund: RefundState;
  /** The facilitator's transaction reference, when it gave one. */
  transaction: string | null;
  claimedAtMs: number;
  updatedAtMs: number;
}>;

/** A quote's single-use marker. It holds no money facts, only a pointer. */
export type QuoteClaim = Readonly<{
  kind: "QUOTE";
  version: number;
  nonce: string;
  side: ProcurementSide;
  paymentId: string;
  claimedAtMs: number;
}>;

export type FulfilmentRow = FulfilmentRecord | QuoteClaim;

export const FULFILMENT_REFUSALS = [
  "PAYMENT_ALREADY_CLAIMED",
  "QUOTE_ALREADY_ANSWERED",
  "PAYMENT_UNKNOWN",
  "CLAIM_CONTENDED",
  "SETTLEMENT_ALREADY_FINAL",
  "SETTLEMENT_NOT_PENDING",
  "DELIVERY_ALREADY_RECORDED",
  "DELIVERY_BEFORE_SETTLEMENT",
  "AMOUNT_MALFORMED",
] as const;

export type FulfilmentRefusal = (typeof FULFILMENT_REFUSALS)[number];

const BASE_UNITS = /^(?:0|[1-9]\d*)$/;

const paymentKey = (side: ProcurementSide, paymentId: string) =>
  `${side.toLowerCase()}:payment:${paymentId}`;
const quoteKey = (side: ProcurementSide, nonce: string) => `${side.toLowerCase()}:quote:${nonce}`;

export type ClaimInput = Readonly<{
  side: ProcurementSide;
  paymentId: string;
  nonce: string;
  requirementsDigest: string;
  resourceDigest: string;
  network: string;
  assetRef: string;
  amountBaseUnits: string;
  payer: string;
  payTo: string;
  facilitator: X402Facilitator;
  nowMs: number;
}>;

export type ClaimOutcome =
  | Readonly<{ ok: true; record: FulfilmentRecord }>
  | Readonly<{
      ok: false;
      reasonCode: FulfilmentRefusal;
      detail: string;
      /** Present when the loser is a retry of a purchase that already exists. */
      record: FulfilmentRecord | null;
    }>;

export type SettlementReport = Readonly<{
  /** What the facilitator said, or that nobody could say. */
  status: "SETTLED" | "FAILED" | "UNKNOWN";
  transaction: string | null;
  /** Which admissible source said so. A facilitator report is not a chain read. */
  source: EvidenceSourceKind;
  detail: string;
}>;

export type SettlementOutcome =
  | Readonly<{ ok: true; record: FulfilmentRecord }>
  | Readonly<{ ok: false; reasonCode: FulfilmentRefusal; detail: string }>;

export type FulfilmentLedger = Readonly<{
  /**
   * Claim one payment and its quote, atomically.
   *
   * The only operation that cannot be composed from the others, for the same
   * reason `insertIfAbsent` exists in the Guard port: read-then-write is a
   * race, and two instances both seeing a free payment identifier is two
   * executions of one payment.
   */
  claim(input: ClaimInput): Promise<ClaimOutcome>;
  /** Record what the facilitator reported, once. */
  recordSettlement(input: {
    side: ProcurementSide;
    paymentId: string;
    report: SettlementReport;
    nowMs: number;
  }): Promise<SettlementOutcome>;
  /**
   * Move a payment out of `UNKNOWN` once somebody could finally say. It is a
   * separate operation from a settlement because it may only act on a row that
   * is pending, and because it never charges — it records a fact about a charge
   * that already happened.
   */
  reconcileSettlement(input: {
    side: ProcurementSide;
    paymentId: string;
    report: SettlementReport;
    nowMs: number;
  }): Promise<SettlementOutcome>;
  /** Record whether the resource actually went out. Once. */
  recordDelivery(input: {
    side: ProcurementSide;
    paymentId: string;
    delivered: boolean;
    source: EvidenceSourceKind;
    nowMs: number;
  }): Promise<SettlementOutcome>;
  read(side: ProcurementSide, paymentId: string): Promise<FulfilmentRecord | null>;
  readQuote(side: ProcurementSide, nonce: string): Promise<QuoteClaim | null>;
}>;

/** How many times a lost compare-and-set is re-attempted before it is reported. */
const MAX_ATTEMPTS = 5;

export function createFulfilmentLedger(store: GuardStore): FulfilmentLedger {
  const rows = store.versioned<FulfilmentRow>(COLLECTION);

  const readPayment = async (
    side: ProcurementSide,
    paymentId: string,
  ): Promise<FulfilmentRecord | null> => {
    const row = await rows.get(paymentKey(side, paymentId));
    return row && row.kind === "PAYMENT" ? row : null;
  };

  /**
   * Read, decide, write — and give up after a bounded number of attempts.
   *
   * The bound is the point: an unbounded retry under contention is a request
   * that never returns. A loser re-reads and decides again, because the row it
   * lost to may have made its decision wrong.
   */
  const update = async (
    side: ProcurementSide,
    paymentId: string,
    decide: (current: FulfilmentRecord) => SettlementOutcome,
  ): Promise<SettlementOutcome> => {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const current = await readPayment(side, paymentId);
      if (!current) {
        return Object.freeze({
          ok: false as const,
          reasonCode: "PAYMENT_UNKNOWN" as const,
          detail: `no claim exists for ${paymentId}`,
        });
      }
      const decided = decide(current);
      if (!decided.ok) return decided;
      const won = await rows.compareAndSet(
        paymentKey(side, paymentId),
        current.version,
        decided.record,
      );
      if (won) return decided;
    }
    return Object.freeze({
      ok: false as const,
      reasonCode: "CLAIM_CONTENDED" as const,
      detail: `the row for ${paymentId} did not settle within ${MAX_ATTEMPTS} attempts`,
    });
  };

  /** Recompute the pairing and what it implies about a refund. Never asserted. */
  const withPairing = (record: Omit<FulfilmentRecord, "pairing" | "refund"> & {
    refund: RefundState;
  }): FulfilmentRecord => {
    const pairing = settlementPairing({
      paymentStatus: record.paymentStatus,
      serviceDeliveryStatus: record.serviceDeliveryStatus,
    });
    /* A settled payment with nothing delivered is money owed back, and it is
       the pair that says so — neither axis names it alone. */
    const refund = pairing.code === "PAID_BUT_UNSERVED" && record.refund === "NOT_DUE" ? "DUE" : record.refund;
    return Object.freeze({ ...record, pairing: pairing.code, refund });
  };

  return Object.freeze({
    async claim(input: ClaimInput): Promise<ClaimOutcome> {
      if (!BASE_UNITS.test(input.amountBaseUnits) || BigInt(input.amountBaseUnits) === 0n) {
        return Object.freeze({
          ok: false as const,
          reasonCode: "AMOUNT_MALFORMED" as const,
          detail: "an amount is whole base units as digits, above zero",
          record: null,
        });
      }

      const record = withPairing({
        kind: "PAYMENT" as const,
        version: 1,
        paymentId: input.paymentId,
        side: input.side,
        nonce: input.nonce,
        requirementsDigest: input.requirementsDigest,
        resourceDigest: input.resourceDigest,
        network: input.network,
        assetRef: input.assetRef,
        amountBaseUnits: input.amountBaseUnits,
        payer: input.payer,
        payTo: input.payTo,
        facilitator: input.facilitator,
        /* Signed and presented, and nothing more. The buyer's signature is not
           a settlement and this row never pretends it is. */
        paymentStatus: "AUTHORIZATION_SIGNED" as PaymentStatus,
        paymentSource: null,
        serviceDeliveryStatus: "REQUESTED" as ServiceDeliveryStatus,
        serviceDeliverySource: null,
        reconciliation: "PENDING" as ReconciliationStatus,
        refund: "NOT_DUE" as RefundState,
        transaction: null,
        claimedAtMs: input.nowMs,
        updatedAtMs: input.nowMs,
      });

      const claim: QuoteClaim = Object.freeze({
        kind: "QUOTE" as const,
        version: 1,
        nonce: input.nonce,
        side: input.side,
        paymentId: input.paymentId,
        claimedAtMs: input.nowMs,
      });

      const won = await rows.insertAllIfAbsent([
        { key: paymentKey(input.side, input.paymentId), value: record },
        { key: quoteKey(input.side, input.nonce), value: claim },
      ]);
      if (won) return Object.freeze({ ok: true as const, record });

      /* Somebody got here first. Which of the two keys they took decides what
         this caller is: a retry of the same purchase, or a second payment
         against one quote. */
      const existing = await readPayment(input.side, input.paymentId);
      if (existing) {
        return Object.freeze({
          ok: false as const,
          reasonCode: "PAYMENT_ALREADY_CLAIMED" as const,
          detail: "this authorization has already been claimed; its outcome is the answer, never a second charge",
          record: existing,
        });
      }
      return Object.freeze({
        ok: false as const,
        reasonCode: "QUOTE_ALREADY_ANSWERED" as const,
        detail: `quote ${input.nonce} has already been answered by another authorization; one 402 is one sale`,
        record: null,
      });
    },

    recordSettlement({ side, paymentId, report, nowMs }) {
      return update(side, paymentId, (current) => {
        if (current.paymentStatus === "SETTLED" || current.paymentStatus === "FAILED") {
          return Object.freeze({
            ok: false as const,
            reasonCode: "SETTLEMENT_ALREADY_FINAL" as const,
            detail: `the payment already reads ${current.paymentStatus}`,
          });
        }
        if (current.paymentStatus === "UNKNOWN") {
          return Object.freeze({
            ok: false as const,
            reasonCode: "SETTLEMENT_ALREADY_FINAL" as const,
            detail: "an unknown settlement is reconciled, never settled a second time",
          });
        }
        const paymentStatus: PaymentStatus =
          report.status === "SETTLED" ? "SETTLED" : report.status === "FAILED" ? "FAILED" : "UNKNOWN";
        return Object.freeze({
          ok: true as const,
          record: withPairing({
            ...current,
            version: current.version + 1,
            paymentStatus,
            /* Even `UNKNOWN` names who was asked: the refusal that matters is
               claiming a source that never saw a payment. */
            paymentSource: report.source,
            transaction: report.transaction,
            reconciliation: paymentStatus === "UNKNOWN" ? "UNKNOWN" : current.reconciliation,
            refund: current.refund,
            updatedAtMs: nowMs,
          }),
        });
      });
    },

    reconcileSettlement({ side, paymentId, report, nowMs }) {
      return update(side, paymentId, (current) => {
        if (current.paymentStatus !== "UNKNOWN") {
          return Object.freeze({
            ok: false as const,
            reasonCode: "SETTLEMENT_NOT_PENDING" as const,
            detail: `only an unknown settlement is reconciled; this one reads ${current.paymentStatus}`,
          });
        }
        if (report.status === "UNKNOWN") {
          return Object.freeze({
            ok: false as const,
            reasonCode: "SETTLEMENT_NOT_PENDING" as const,
            detail: "a reconciliation that still does not know changes nothing, and it never charges again",
          });
        }
        return Object.freeze({
          ok: true as const,
          record: withPairing({
            ...current,
            version: current.version + 1,
            paymentStatus: report.status === "SETTLED" ? "SETTLED" : "FAILED",
            paymentSource: report.source,
            transaction: report.transaction ?? current.transaction,
            reconciliation: "PENDING" as ReconciliationStatus,
            refund: current.refund,
            updatedAtMs: nowMs,
          }),
        });
      });
    },

    recordDelivery({ side, paymentId, delivered, source, nowMs }) {
      return update(side, paymentId, (current) => {
        if (current.serviceDeliveryStatus !== "REQUESTED") {
          return Object.freeze({
            ok: false as const,
            reasonCode: "DELIVERY_ALREADY_RECORDED" as const,
            detail: `the delivery already reads ${current.serviceDeliveryStatus}; one payment is at most one execution`,
          });
        }
        /* Fail closed: a resource is never handed over against a payment
           nobody has confirmed. The x402 flow's own rule, and the reason a
           timeout after settlement leaves the sale pending rather than served. */
        if (delivered && current.paymentStatus !== "SETTLED") {
          return Object.freeze({
            ok: false as const,
            reasonCode: "DELIVERY_BEFORE_SETTLEMENT" as const,
            detail: `the payment reads ${current.paymentStatus}, so the resource is not served`,
          });
        }
        return Object.freeze({
          ok: true as const,
          record: withPairing({
            ...current,
            version: current.version + 1,
            serviceDeliveryStatus: delivered ? "DELIVERED" : "NOT_DELIVERED",
            serviceDeliverySource: source,
            refund: current.refund,
            updatedAtMs: nowMs,
          }),
        });
      });
    },

    read(side, paymentId) {
      return readPayment(side, paymentId);
    },

    async readQuote(side, nonce) {
      const row = await rows.get(quoteKey(side, nonce));
      return row && row.kind === "QUOTE" ? row : null;
    },
  });
}
