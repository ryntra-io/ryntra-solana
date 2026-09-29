import { z } from "zod";

export const CCTP_PRECANARY_STATES = [
  "READY",
  "BURN_SUBMITTED",
  "BURN_CONFIRMED",
  "ATTESTATION_PENDING",
  "ATTESTED",
  "MINT_SUBMITTED",
  "COMPLETED",
  "FAILED",
  "UNKNOWN",
  "RECOVERY",
] as const;
export type CctpPrecanaryState = (typeof CCTP_PRECANARY_STATES)[number];
export type CctpLifecycleStage = "PREPARE" | "BURN" | "ATTESTATION" | "MINT" | "OBSERVATION" | "RECONCILIATION";
export type CctpLifecycleRefusalCode =
  | "TRANSITION_NOT_ALLOWED"
  | "SECOND_BURN_REFUSED"
  | "MISSING_EXISTING_EVIDENCE"
  | "INVALID_EVENT";

const INSTANT = z.string().datetime({ offset: true });
const SIGNATURE = z.string().min(32).max(128);
const RAW_AMOUNT = z.string().regex(/^(0|[1-9][0-9]*)$/);

export const CctpLifecycleRecordSchema = z
  .object({
    schema: z.literal("ryntra.solana.cctp-lifecycle"),
    schemaVersion: z.literal("1.0.0"),
    intentId: z.string().min(1).max(128),
    state: z.enum(CCTP_PRECANARY_STATES),
    burnSignature: SIGNATURE.nullable(),
    sourceObservedAt: INSTANT.nullable(),
    messageHash: z.string().regex(/^0x[0-9a-f]{64}$/).nullable(),
    nonce: z.string().regex(/^(0|[1-9][0-9]*)$/).nullable(),
    attestationRef: z.string().min(1).max(256).nullable(),
    mintSignature: SIGNATURE.nullable(),
    destinationObservedAt: INSTANT.nullable(),
    expectedReceivedRaw: RAW_AMOUNT.nullable(),
    actualReceivedRaw: RAW_AMOUNT.nullable(),
    reconciliation: z.enum(["MATCHED", "DEVIATION_RECORDED"]).nullable(),
    failure: z
      .object({
        stage: z.enum(["PREPARE", "BURN", "ATTESTATION", "MINT", "OBSERVATION", "RECONCILIATION"]),
        reasonCode: z.string().regex(/^[A-Z0-9_:-]{1,96}$/),
      })
      .strict()
      .nullable(),
    createdAt: INSTANT,
    updatedAt: INSTANT,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.state === "COMPLETED") {
      for (const [field, present] of [
        ["burnSignature", value.burnSignature],
        ["sourceObservedAt", value.sourceObservedAt],
        ["messageHash", value.messageHash],
        ["attestationRef", value.attestationRef],
        ["mintSignature", value.mintSignature],
        ["destinationObservedAt", value.destinationObservedAt],
        ["expectedReceivedRaw", value.expectedReceivedRaw],
        ["actualReceivedRaw", value.actualReceivedRaw],
        ["reconciliation", value.reconciliation],
      ] as const) {
        if (present === null) {
          context.addIssue({ code: "custom", path: [field], message: `COMPLETED requires ${field}.` });
        }
      }
    }
  });

export type CctpLifecycleRecord = z.output<typeof CctpLifecycleRecordSchema>;

export type CctpLifecycleEvent =
  | Readonly<{ type: "SUBMIT_BURN"; signature: string }>
  | Readonly<{ type: "CONFIRM_BURN"; observedAt: string }>
  | Readonly<{ type: "WAIT_FOR_ATTESTATION" }>
  | Readonly<{ type: "RECEIVE_ATTESTATION"; messageHash: string; nonce: string; attestationRef: string }>
  | Readonly<{ type: "SUBMIT_MINT"; signature: string }>
  | Readonly<{
      type: "OBSERVE_AND_RECONCILE_MINT";
      observedAt: string;
      expectedReceivedRaw: string;
      actualReceivedRaw: string;
    }>
  | Readonly<{
      type: "MARK_FAILED";
      stage: CctpLifecycleStage;
      reasonCode: string;
    }>
  | Readonly<{
      type: "MARK_UNKNOWN";
      stage: CctpLifecycleStage;
      reasonCode: string;
    }>
  | Readonly<{ type: "START_RECOVERY" }>
  | Readonly<{ type: "RETRY_ATTESTATION_LOOKUP" }>
  | Readonly<{ type: "RETRY_MINT"; signature: string }>;

export type CctpLifecycleTransition =
  | Readonly<{ ok: true; record: CctpLifecycleRecord }>
  | Readonly<{
      ok: false;
      code: CctpLifecycleRefusalCode;
      reason: string;
      record: CctpLifecycleRecord;
    }>;

export function initialCctpLifecycle(args: { intentId: string; at?: string }): CctpLifecycleRecord {
  const at = args.at ?? new Date().toISOString();
  return CctpLifecycleRecordSchema.parse({
    schema: "ryntra.solana.cctp-lifecycle",
    schemaVersion: "1.0.0",
    intentId: args.intentId,
    state: "READY",
    burnSignature: null,
    sourceObservedAt: null,
    messageHash: null,
    nonce: null,
    attestationRef: null,
    mintSignature: null,
    destinationObservedAt: null,
    expectedReceivedRaw: null,
    actualReceivedRaw: null,
    reconciliation: null,
    failure: null,
    createdAt: at,
    updatedAt: at,
  });
}

function refused(
  record: CctpLifecycleRecord,
  code: CctpLifecycleRefusalCode,
  event: CctpLifecycleEvent,
  reason?: string,
): CctpLifecycleTransition {
  return {
    ok: false,
    code,
    reason: reason ?? `${event.type} is not allowed from ${record.state}.`,
    record,
  };
}

function next(record: CctpLifecycleRecord, at: string, patch: Partial<CctpLifecycleRecord>): CctpLifecycleTransition {
  try {
    return {
      ok: true,
      record: CctpLifecycleRecordSchema.parse({ ...record, ...patch, updatedAt: at }),
    };
  } catch {
    return {
      ok: false,
      code: "INVALID_EVENT",
      reason: "The lifecycle event did not provide the evidence required by the next state.",
      record,
    };
  }
}

export function transitionCctpLifecycle(
  input: CctpLifecycleRecord,
  event: CctpLifecycleEvent,
  at = new Date().toISOString(),
): CctpLifecycleTransition {
  const record = CctpLifecycleRecordSchema.parse(input);
  if (event.type === "SUBMIT_BURN" && (record.state !== "READY" || record.burnSignature !== null)) {
    return refused(
      record,
      "SECOND_BURN_REFUSED",
      event,
      "A burn already exists or may exist for this intent; recovery must inspect that burn and can never create a second one.",
    );
  }

  if (event.type === "MARK_FAILED") {
    if (record.state === "COMPLETED") return refused(record, "TRANSITION_NOT_ALLOWED", event);
    return next(record, at, {
      state: "FAILED",
      failure: { stage: event.stage, reasonCode: event.reasonCode },
    });
  }
  if (event.type === "MARK_UNKNOWN") {
    if (record.state === "COMPLETED") return refused(record, "TRANSITION_NOT_ALLOWED", event);
    return next(record, at, {
      state: "UNKNOWN",
      failure: { stage: event.stage, reasonCode: event.reasonCode },
    });
  }

  switch (event.type) {
    case "SUBMIT_BURN":
      if (record.state !== "READY") return refused(record, "TRANSITION_NOT_ALLOWED", event);
      return next(record, at, { state: "BURN_SUBMITTED", burnSignature: event.signature, failure: null });
    case "CONFIRM_BURN":
      if (record.state !== "BURN_SUBMITTED") return refused(record, "TRANSITION_NOT_ALLOWED", event);
      return next(record, at, { state: "BURN_CONFIRMED", sourceObservedAt: event.observedAt });
    case "WAIT_FOR_ATTESTATION":
      if (record.state !== "BURN_CONFIRMED") return refused(record, "TRANSITION_NOT_ALLOWED", event);
      return next(record, at, { state: "ATTESTATION_PENDING" });
    case "RECEIVE_ATTESTATION":
      if (record.state !== "BURN_CONFIRMED" && record.state !== "ATTESTATION_PENDING" && record.state !== "RECOVERY") {
        return refused(record, "TRANSITION_NOT_ALLOWED", event);
      }
      if (!record.burnSignature || !record.sourceObservedAt) {
        return refused(record, "MISSING_EXISTING_EVIDENCE", event, "Attestation cannot be attached without the existing observed burn.");
      }
      return next(record, at, {
        state: "ATTESTED",
        messageHash: event.messageHash,
        nonce: event.nonce,
        attestationRef: event.attestationRef,
        failure: null,
      });
    case "SUBMIT_MINT":
      if (record.state !== "ATTESTED") return refused(record, "TRANSITION_NOT_ALLOWED", event);
      return next(record, at, { state: "MINT_SUBMITTED", mintSignature: event.signature });
    case "OBSERVE_AND_RECONCILE_MINT":
      if (record.state !== "MINT_SUBMITTED") return refused(record, "TRANSITION_NOT_ALLOWED", event);
      if (!record.sourceObservedAt || !record.messageHash || !record.attestationRef || !record.mintSignature) {
        return refused(record, "MISSING_EXISTING_EVIDENCE", event, "Completion requires both-side observations and the existing message binding.");
      }
      return next(record, at, {
        state: "COMPLETED",
        destinationObservedAt: event.observedAt,
        expectedReceivedRaw: event.expectedReceivedRaw,
        actualReceivedRaw: event.actualReceivedRaw,
        reconciliation:
          event.expectedReceivedRaw === event.actualReceivedRaw ? "MATCHED" : "DEVIATION_RECORDED",
        failure: null,
      });
    case "START_RECOVERY":
      if (record.state !== "FAILED" && record.state !== "UNKNOWN") {
        return refused(record, "TRANSITION_NOT_ALLOWED", event);
      }
      return next(record, at, { state: "RECOVERY" });
    case "RETRY_ATTESTATION_LOOKUP":
      if (record.state !== "RECOVERY" || !record.burnSignature || !record.sourceObservedAt) {
        return refused(record, "MISSING_EXISTING_EVIDENCE", event, "Attestation recovery needs the existing confirmed burn.");
      }
      return next(record, at, { state: "ATTESTATION_PENDING", failure: null });
    case "RETRY_MINT":
      if (record.state !== "RECOVERY" || !record.messageHash || !record.attestationRef) {
        return refused(record, "MISSING_EXISTING_EVIDENCE", event, "Mint recovery needs the existing message and attestation.");
      }
      return next(record, at, { state: "MINT_SUBMITTED", mintSignature: event.signature, failure: null });
  }
}

export function isCctpCompleted(record: CctpLifecycleRecord): boolean {
  return record.state === "COMPLETED" && CctpLifecycleRecordSchema.safeParse(record).success;
}

export function cctpFundsInMotion(record: CctpLifecycleRecord): boolean {
  return record.burnSignature !== null && record.state !== "COMPLETED";
}

export type CctpRecovery = Readonly<{
  action: string;
  whereValueIs: string;
  secondBurnAllowed: boolean;
}>;

export function cctpRecovery(record: CctpLifecycleRecord): CctpRecovery {
  if (record.state === "READY") {
    return {
      action: "REVIEW_PRECANARY_PLAN",
      whereValueIs: "SOURCE_WALLET_UNTOUCHED",
      secondBurnAllowed: true,
    };
  }
  if (record.state === "COMPLETED") {
    return {
      action: "NONE_REQUIRED",
      whereValueIs: "DESTINATION_WALLET_OBSERVED",
      secondBurnAllowed: false,
    };
  }
  if (record.mintSignature || record.attestationRef) {
    return {
      action:
        record.state === "MINT_SUBMITTED"
          ? "OBSERVE_EXISTING_DESTINATION_MINT"
          : "RETRY_DESTINATION_MINT_WITH_EXISTING_ATTESTATION",
      whereValueIs: "BURNED_AT_SOURCE_EXISTING_ATTESTATION_OR_MINT",
      secondBurnAllowed: false,
    };
  }
  if (record.burnSignature) {
    return {
      action:
        record.state === "BURN_SUBMITTED"
          ? "OBSERVE_EXISTING_SOURCE_TRANSACTION"
          : "LOOK_UP_EXISTING_MESSAGE_AND_ATTESTATION",
      whereValueIs: "SOURCE_TRANSACTION_EXISTS_OR_MAY_EXIST",
      secondBurnAllowed: false,
    };
  }
  return {
    action: "RETURN_TO_REVIEW_WITHOUT_REUSING_THIS_INTENT",
    whereValueIs: "SOURCE_WALLET_UNTOUCHED",
    secondBurnAllowed: false,
  };
}
