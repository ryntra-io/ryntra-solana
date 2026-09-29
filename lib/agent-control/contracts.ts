import { z } from "zod";

import { EvidenceItemSchema, PolicyResultSchema } from "../guard/contracts.ts";

const CAIP2 = /^[a-z0-9-]+:[A-Za-z0-9-]+$/;
const DECIMAL_STRING = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const HEX_HASH = /^0x[0-9a-f]{64}$/;
const timestamp = z.string().datetime({ offset: true });

export const AGENT_ACTION_KINDS = [
  "CREATE_JOB_DRAFT",
  "FUND_JOB",
  "SUBMIT_WORK",
  "SETTLE_JOB",
  "TRANSFER",
] as const;

export const AgentActionIntentSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    id: z.string().min(3).max(128),
    source: z
      .object({
        kind: z.enum(["ASI_ONE", "AGENTVERSE", "MCP", "API", "DEMO"]),
        agentId: z.string().min(1).max(256),
        agentName: z.string().min(1).max(128).nullable(),
        requestId: z.string().min(1).max(256),
      })
      .strict(),
    subjectRef: z.string().min(1).max(256),
    requestText: z.string().min(1).max(2_000),
    action: z
      .object({
        kind: z.enum(AGENT_ACTION_KINDS),
        provider: z.enum(["BNB_APEX", "AGENT_LAUNCH", "DEMO"]),
        chainRef: z.string().regex(CAIP2),
        jobType: z.string().min(1).max(128),
        deliverable: z.string().min(1).max(1_000),
        budget: z
          .object({
            amount: z.string().regex(DECIMAL_STRING).max(128),
            assetRef: z.string().min(3).max(256),
          })
          .strict()
          .nullable(),
        providerRef: z.string().min(1).max(256).nullable(),
        evaluatorRef: z.string().min(1).max(256).nullable(),
        deadline: timestamp,
        expectedEffects: z.array(z.string().min(1).max(512)).min(1).max(32),
      })
      .strict(),
    policyRef: z
      .object({
        id: z.string().min(1).max(128),
        version: z.number().int().positive(),
      })
      .strict(),
    evidenceRequirements: z.array(z.string().min(1).max(128)).min(1).max(32),
    humanAuthorizationRequired: z.literal(true),
    createdAt: timestamp,
    expiresAt: timestamp,
    revision: z.number().int().positive(),
    idempotencyKey: z.string().min(8).max(256),
  })
  .strict()
  .superRefine((value, context) => {
    if (Date.parse(value.expiresAt) <= Date.parse(value.createdAt)) {
      context.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: "Intent expiry must be after creation.",
      });
    }
    if (Date.parse(value.action.deadline) > Date.parse(value.expiresAt)) {
      context.addIssue({
        code: "custom",
        path: ["action", "deadline"],
        message: "The job deadline cannot outlive the intent.",
      });
    }
    if (Date.parse(value.action.deadline) <= Date.parse(value.createdAt)) {
      context.addIssue({
        code: "custom",
        path: ["action", "deadline"],
        message: "The job deadline must be after intent creation.",
      });
    }
    if (value.action.kind === "CREATE_JOB_DRAFT" && value.action.budget !== null) {
      context.addIssue({
        code: "custom",
        path: ["action", "budget"],
        message: "A draft creates no funded job and therefore carries no budget asset.",
      });
    }
    if (value.action.kind === "FUND_JOB" && value.action.budget === null) {
      context.addIssue({
        code: "custom",
        path: ["action", "budget"],
        message: "A funding proposal must name an exact amount and asset.",
      });
    }
  });

export const AgentControlPolicySchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    id: z.string().min(1).max(128),
    version: z.number().int().positive(),
    publishedAt: timestamp,
    immutable: z.literal(true),
    allowedChains: z.array(z.string().regex(CAIP2)).min(1).max(16),
    allowedActions: z.array(z.enum(AGENT_ACTION_KINDS)).min(1).max(16),
    maxBudget: z
      .object({
        amount: z.string().regex(DECIMAL_STRING).max(128),
        assetRef: z.string().min(3).max(256),
      })
      .strict()
      .nullable(),
    evidenceMaxAgeSeconds: z.number().int().positive().max(86_400),
    requireHumanAuthorization: z.literal(true),
    executionEnabled: z.literal(false),
  })
  .strict();

export const DemoHumanDecisionSchema = z
  .object({
    status: z.enum(["NOT_RECORDED", "RECORDED_DEMO_ONLY"]),
    demoOnly: z.literal(true),
    subjectRef: z.string().min(1).max(256).nullable(),
    method: z.literal("LOCAL_DEMO_ACK").nullable(),
    intentHash: z.string().regex(HEX_HASH).nullable(),
    evidenceRoot: z.string().regex(HEX_HASH).nullable(),
    policyDigest: z.string().regex(HEX_HASH).nullable(),
    recordedAt: timestamp.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    const bound = [
      value.subjectRef,
      value.method,
      value.intentHash,
      value.evidenceRoot,
      value.policyDigest,
      value.recordedAt,
    ];
    const shouldBeBound = value.status === "RECORDED_DEMO_ONLY";
    if (bound.some((entry) => (shouldBeBound ? entry === null : entry !== null))) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: shouldBeBound
          ? "A recorded demo decision must bind every decision input."
          : "An unrecorded decision cannot carry authorization bindings.",
      });
    }
  });

export const ACTION_PASSPORT_PREVIEW_LIMITATIONS = [
  "ACTION PASSPORT PREVIEW — NOT AN OUTCOME RECEIPT",
  "No provider action, wallet signature or transaction was submitted.",
  "No independently observed outcome exists.",
  "External Agentverse, Agent Launch, ERC-8183 and BNB capabilities are not Ryntra maturity.",
] as const;

export const ActionPassportPreviewSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    kind: z.literal("ACTION_PASSPORT_PREVIEW"),
    id: z.string().min(3).max(128),
    createdAt: timestamp,
    maturity: z.literal("SOURCE_PREVIEW"),
    intent: AgentActionIntentSchema,
    intentHash: z.string().regex(HEX_HASH),
    evidence: z
      .object({
        items: z.array(EvidenceItemSchema).min(1).max(16),
        root: z.string().regex(HEX_HASH),
      })
      .strict(),
    policy: z
      .object({
        definition: AgentControlPolicySchema,
        result: PolicyResultSchema,
      })
      .strict(),
    authorization: DemoHumanDecisionSchema,
    execution: z
      .object({
        status: z.literal("UNAVAILABLE"),
        reasonCode: z.enum([
          "SOURCE_PREVIEW_ONLY",
          "NO_PROVIDER_SIGNER",
          "NO_WALLET_AUTHORIZATION",
          "EXTERNAL_CONTRACT_UNVERIFIED",
        ]),
        jobId: z.null(),
        transactionHash: z.null(),
      })
      .strict(),
    outcome: z
      .object({
        status: z.literal("OUTCOME_NOT_OBSERVED"),
        observedEffects: z.array(z.unknown()).length(0),
        sourceRefs: z.array(z.string()).length(0),
      })
      .strict(),
    limitations: z.tuple([
      z.literal(ACTION_PASSPORT_PREVIEW_LIMITATIONS[0]),
      z.literal(ACTION_PASSPORT_PREVIEW_LIMITATIONS[1]),
      z.literal(ACTION_PASSPORT_PREVIEW_LIMITATIONS[2]),
      z.literal(ACTION_PASSPORT_PREVIEW_LIMITATIONS[3]),
    ]),
    passportHash: z.string().regex(HEX_HASH),
    integrity: z
      .object({
        algorithm: z.literal("SHA-256"),
        hash: z.string().regex(HEX_HASH),
      })
      .strict(),
  })
  .strict();

export type AgentActionIntent = z.output<typeof AgentActionIntentSchema>;
export type AgentControlPolicy = z.output<typeof AgentControlPolicySchema>;
export type ActionPassportPreview = z.output<typeof ActionPassportPreviewSchema>;
