import { createHash } from "node:crypto";
import { z } from "zod";

import { canonicalJson, compareCanonicalStrings } from "../../guard/canonical-json.ts";

export const POSITION_RECORD_VERSION = "1.0.0" as const;

export const POSITION_TYPES = [
  "WALLET_ASSET",
  "SPOT",
  "PERP",
  "LENDING_SUPPLY",
  "DEBT",
  "LP",
  "VAULT",
  "STAKING",
  "RWA",
  "PRIVATE",
  "ESCROW",
  "FUNDS_IN_MOTION",
  "AGENT_COMMITMENT",
  "PAPER",
] as const;

export const VALUATION_STATES = [
  "PRICED",
  "ESTIMATED",
  "STALE",
  "UNPRICED",
  "CONFLICTING",
  "PRIVATE_HIDDEN",
] as const;

export const ACCOUNTING_ROLES = ["PRIMARY", "RESERVATION", "REFERENCE", "PAPER"] as const;
export const BOOKS = ["LIVE", "PAPER"] as const;
export const CASH_STATES = [
  "NOT_CASH",
  "SPENDABLE",
  "PENDING",
  "FUNDS_IN_MOTION",
  "COMMITTED",
  "LOCKED_COLLATERAL",
  "PRIVATE_HIDDEN",
] as const;

export const VALUATION_CONTRIBUTIONS = ["ASSET", "LIABILITY", "NONE"] as const;
export const EXPOSURE_ROLES = [
  "PRINCIPAL",
  "DERIVATIVE_NOTIONAL",
  "COMPONENT",
  "COLLATERAL",
  "CASH_FLOW",
] as const;
export const EXPOSURE_PHASES = ["SETTLED", "PENDING", "COMMITTED", "PAPER", "REFERENCE"] as const;
export const EXPOSURE_DIRECTIONS = ["LONG", "SHORT", "LIABILITY", "NEUTRAL"] as const;

const IDENTIFIER = /^[^\u0000-\u001f\u007f]{1,256}$/;
const UNIT_REF = /^[A-Za-z0-9][A-Za-z0-9._:/%-]{0,255}$/;
const NONNEGATIVE_INTEGER = /^(?:0|[1-9]\d*)$/;
const POSITION_ID = /^pos_v1_[0-9a-f]{64}$/;

const identifier = z.string().regex(IDENTIFIER);
const timestamp = z.string().datetime({ offset: true }).max(40);
const evidenceRefs = z
  .array(identifier)
  .min(1)
  .max(64)
  .transform((items) => [...new Set(items)].sort(compareCanonicalStrings));

const conflictRefs = z
  .array(identifier)
  .max(64)
  .transform((items) => [...new Set(items)].sort(compareCanonicalStrings));

const DecimalMagnitudeSchema = z
  .object({
    units: z.string().regex(NONNEGATIVE_INTEGER, "amount must be a non-negative canonical integer"),
    scale: z.number().int().min(0).max(18),
  })
  .strict();

const MoneyValueSchema = z
  .object({
    amount: DecimalMagnitudeSchema,
    currency: z.string().regex(UNIT_REF),
  })
  .strict();

const FreshnessPolicySchema = z
  .object({ maxAgeSeconds: z.number().int().nonnegative().nullable() })
  .strict();

const QuantitySchema = z
  .object({ amount: DecimalMagnitudeSchema, unitRef: identifier })
  .strict();

const EconomicLotSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("VERIFIED"), lotId: identifier, evidenceRefs }).strict(),
  z.object({ state: z.literal("SOURCE_SCOPED"), sourceId: identifier, lotKey: identifier, evidenceRefs }).strict(),
  z.object({ state: z.literal("UNKNOWN"), reason: z.string().min(1).max(500), evidenceRefs }).strict(),
]);

const ExposureLegSchema = z
  .object({
    legId: identifier,
    underlyingKey: identifier,
    role: z.enum(EXPOSURE_ROLES),
    phase: z.enum(EXPOSURE_PHASES),
    direction: z.enum(EXPOSURE_DIRECTIONS),
    notional: MoneyValueSchema.nullable(),
    unknownReason: z.string().min(1).max(500).nullable(),
    observedAt: timestamp,
    validUntil: timestamp.nullable(),
    freshnessPolicy: FreshnessPolicySchema,
    evidenceRefs,
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.notional === null) === (value.unknownReason === null)) {
      context.addIssue({
        code: "custom",
        path: [value.notional === null ? "unknownReason" : "notional"],
        message: "exposure leg requires either notional or unknownReason, never both",
      });
    }
    if (value.validUntil !== null && Date.parse(value.validUntil) < Date.parse(value.observedAt)) {
      context.addIssue({
        code: "custom",
        path: ["validUntil"],
        message: "exposure validity cannot end before observation",
      });
    }
  });

const ValuationSchema = z
  .object({
    state: z.enum(VALUATION_STATES),
    value: MoneyValueSchema.nullable(),
    sourceRef: identifier.nullable(),
    observedAt: timestamp.nullable(),
    validUntil: timestamp.nullable(),
    freshnessPolicy: FreshnessPolicySchema.nullable(),
    reason: z.string().min(1).max(500).nullable(),
    conflictRefs,
  })
  .strict()
  .superRefine((value, context) => {
    const measured = value.state === "PRICED" || value.state === "ESTIMATED" || value.state === "STALE";
    if (measured) {
      for (const [field, present] of [
        ["value", value.value !== null],
        ["sourceRef", value.sourceRef !== null],
        ["observedAt", value.observedAt !== null],
        ["freshnessPolicy", value.freshnessPolicy !== null],
      ] as const) {
        if (!present) context.addIssue({ code: "custom", path: [field], message: `${value.state} requires ${field}` });
      }
      if (value.conflictRefs.length !== 0) {
        context.addIssue({ code: "custom", path: ["conflictRefs"], message: `${value.state} cannot carry conflicts` });
      }
    } else {
      if (value.value !== null) {
        context.addIssue({ code: "custom", path: ["value"], message: `${value.state} cannot carry a selected value` });
      }
      if (value.sourceRef !== null) {
        context.addIssue({ code: "custom", path: ["sourceRef"], message: `${value.state} cannot select one source` });
      }
      if (value.reason === null) {
        context.addIssue({ code: "custom", path: ["reason"], message: `${value.state} requires a reason` });
      }
      if (value.state === "CONFLICTING" && value.conflictRefs.length < 2) {
        context.addIssue({ code: "custom", path: ["conflictRefs"], message: "CONFLICTING requires two distinct conflict refs" });
      }
      if (value.state !== "CONFLICTING" && value.conflictRefs.length !== 0) {
        context.addIssue({ code: "custom", path: ["conflictRefs"], message: `${value.state} cannot carry conflict refs` });
      }
    }
    if (value.validUntil !== null && value.observedAt === null) {
      context.addIssue({ code: "custom", path: ["validUntil"], message: "validUntil requires observedAt" });
    }
    if (
      value.validUntil !== null &&
      value.observedAt !== null &&
      Date.parse(value.validUntil) < Date.parse(value.observedAt)
    ) {
      context.addIssue({ code: "custom", path: ["validUntil"], message: "valuation validity cannot end before observation" });
    }
  });

const SourceSchema = z
  .object({
    sourceId: identifier,
    connectionId: identifier.nullable(),
    sourcePositionKey: identifier,
    sourceVersion: identifier.nullable(),
    observedAt: timestamp,
    evidenceRefs,
  })
  .strict();

const draftShape = {
  schemaVersion: z.literal(POSITION_RECORD_VERSION),
  ownerRef: identifier,
  source: SourceSchema,
  accountRef: identifier,
  networkRef: identifier,
  venueRef: identifier.nullable(),
  protocolRef: identifier.nullable(),
  instrumentKey: identifier,
  underlyingKey: identifier,
  representationKey: identifier,
  positionType: z.enum(POSITION_TYPES),
  positionSlotKey: identifier,
  book: z.enum(BOOKS),
  accountingRole: z.enum(ACCOUNTING_ROLES),
  economicLot: EconomicLotSchema,
  quantity: QuantitySchema.nullable(),
  valuation: ValuationSchema,
  valuationContribution: z.enum(VALUATION_CONTRIBUTIONS),
  cashState: z.enum(CASH_STATES),
  settlementState: identifier,
  custodyClass: identifier,
  exposureLegs: z.array(ExposureLegSchema).max(128),
};

function addRecordIssues(value: z.infer<z.ZodObject<typeof draftShape>>, context: z.RefinementCtx): void {
  const paper = value.positionType === "PAPER";
  if (paper !== (value.book === "PAPER" && value.accountingRole === "PAPER")) {
    context.addIssue({ code: "custom", path: ["book"], message: "PAPER positions require PAPER book and accounting" });
  }
  if (!paper && (value.book === "PAPER" || value.accountingRole === "PAPER")) {
    context.addIssue({ code: "custom", path: ["accountingRole"], message: "only PAPER positions enter the PAPER book" });
  }
  const reservationType = value.positionType === "ESCROW"
    || value.positionType === "FUNDS_IN_MOTION"
    || value.positionType === "AGENT_COMMITMENT";
  if (reservationType && value.accountingRole !== "RESERVATION" && value.accountingRole !== "REFERENCE") {
    context.addIssue({ code: "custom", path: ["accountingRole"], message: `${value.positionType} requires RESERVATION or REFERENCE accounting` });
  }
  if (reservationType && value.valuationContribution !== "NONE") {
    context.addIssue({ code: "custom", path: ["valuationContribution"], message: `${value.positionType} requires NONE valuationContribution` });
  }
  if (!reservationType && !paper && value.accountingRole === "RESERVATION") {
    context.addIssue({ code: "custom", path: ["accountingRole"], message: "RESERVATION accounting requires a reservation position type" });
  }
  const legIds = value.exposureLegs.map((leg) => leg.legId);
  if (new Set(legIds).size !== legIds.length) {
    context.addIssue({ code: "custom", path: ["exposureLegs"], message: "duplicate legId" });
  }
}

const DraftSchema = z.object(draftShape).strict().superRefine(addRecordIssues);
const RecordSchema = z.object({ ...draftShape, positionId: z.string().regex(POSITION_ID) }).strict().superRefine(addRecordIssues);

function sortedLegs(legs: readonly z.infer<typeof ExposureLegSchema>[]): z.infer<typeof ExposureLegSchema>[] {
  return [...legs].sort((left, right) => compareCanonicalStrings(
    [left.underlyingKey, left.phase, left.direction, left.role, left.legId].join("\u0000"),
    [right.underlyingKey, right.phase, right.direction, right.role, right.legId].join("\u0000"),
  ));
}

function normalizedDraft(value: z.infer<typeof DraftSchema>): z.infer<typeof DraftSchema> {
  return { ...value, exposureLegs: sortedLegs(value.exposureLegs) };
}

function positionId(value: z.infer<typeof DraftSchema>): string {
  const identity = {
    ownerRef: value.ownerRef,
    accountRef: value.accountRef,
    networkRef: value.networkRef,
    instrumentKey: value.instrumentKey,
    representationKey: value.representationKey,
    positionType: value.positionType,
    positionSlotKey: value.positionSlotKey,
  };
  const digest = createHash("sha256")
    .update(`RYNTRA_HOME_POSITION_ID_V1\n${canonicalJson(identity)}`, "utf8")
    .digest("hex");
  return `pos_v1_${digest}`;
}

export type PositionDraft = z.output<typeof DraftSchema>;
export type PositionRecord = PositionDraft & Readonly<{ positionId: string }>;
export type ExposureLeg = z.output<typeof ExposureLegSchema>;
export type EconomicLotRef = z.output<typeof EconomicLotSchema>;
export type Valuation = z.output<typeof ValuationSchema>;

function withoutUndefinedPositionId(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  if (!("positionId" in record) || record.positionId !== undefined) return value;
  const { positionId: _ignored, ...rest } = record;
  return rest;
}

export function createPositionRecord(value: unknown): PositionRecord {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const supplied = (value as Record<string, unknown>).positionId;
    if (typeof supplied === "string") return parsePositionRecord(value);
  }
  const draft = normalizedDraft(DraftSchema.parse(withoutUndefinedPositionId(value)));
  return { ...draft, positionId: positionId(draft) };
}

export function parsePositionRecord(value: unknown): PositionRecord {
  const parsed = RecordSchema.parse(value);
  const { positionId: supplied, ...rawDraft } = parsed;
  const draft = normalizedDraft(DraftSchema.parse(rawDraft));
  const expected = positionId(draft);
  if (supplied !== expected) throw new TypeError("positionId does not match active position identity");
  return { ...draft, positionId: expected };
}
