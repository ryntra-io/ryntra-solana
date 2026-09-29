import { z } from "zod";

const CAIP2 = /^[a-z0-9-]+:[A-Za-z0-9-]+$/;
const DECIMAL_STRING = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const timestamp = z.string().datetime({ offset: true });

const AGENT_ACTION_KINDS = [
  "CREATE_JOB_DRAFT",
  "FUND_JOB",
  "SUBMIT_WORK",
  "SETTLE_JOB",
  "TRANSFER",
] as const;

/**
 * Extraction-safe runtime projection of AgentActionIntent 1.0.0.
 *
 * Its JSON Schema is pinned against the Evidence Kernel schema in the MCP
 * parity suite. Keep that parity gate green whenever the canonical contract
 * changes; this package must never silently widen the public tool boundary.
 */
export const McpAgentActionIntentSchema = z
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
