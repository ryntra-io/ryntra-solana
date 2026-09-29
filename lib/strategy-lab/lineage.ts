import { z } from "zod";
import type { StrategySpec } from "./types.ts";

const ChangedFieldsSchema = z.array(
  z.string().trim().min(1).max(120),
)
  .max(64)
  .transform((fields) => [...new Set(fields)]
    .sort((left, right) => left < right ? -1 : left > right ? 1 : 0))
  .pipe(z.array(z.string().min(1).max(120)).max(32));

export const ExperimentLineageSchema = z.object({
  parentRunId: z.string().trim().uuid().nullable(),
  hypothesis: z.string().trim().max(500),
  changedFields: ChangedFieldsSchema,
  userAttestedTestWindowSeenBeforeChange: z.boolean(),
  iterationNumber: z.number().finite().int().min(1).refine(Number.isSafeInteger),
}).strict().superRefine((lineage, context) => {
  if (lineage.parentRunId === null) {
    if (lineage.iterationNumber !== 1) {
      context.addIssue({ code: "custom", path: ["iterationNumber"], message: "Root lineage must be iteration 1." });
    }
    if (lineage.hypothesis !== "") {
      context.addIssue({ code: "custom", path: ["hypothesis"], message: "Root lineage hypothesis must be empty." });
    }
    if (lineage.changedFields.length !== 0) {
      context.addIssue({ code: "custom", path: ["changedFields"], message: "Root lineage changed fields must be empty." });
    }
    if (lineage.userAttestedTestWindowSeenBeforeChange) {
      context.addIssue({
        code: "custom",
        path: ["userAttestedTestWindowSeenBeforeChange"],
        message: "Root lineage cannot have seen a parent test window.",
      });
    }
    return;
  }

  if (lineage.iterationNumber < 2) {
    context.addIssue({ code: "custom", path: ["iterationNumber"], message: "Child lineage must be iteration 2 or later." });
  }
  if (lineage.hypothesis.length === 0) {
    context.addIssue({ code: "custom", path: ["hypothesis"], message: "Child lineage requires a hypothesis." });
  }
  if (lineage.changedFields.length === 0) {
    context.addIssue({ code: "custom", path: ["changedFields"], message: "Child lineage requires changed fields." });
  }
});

const ParentIterationSchema = z.number()
  .finite()
  .int()
  .min(1)
  .max(Number.MAX_SAFE_INTEGER - 1)
  .refine(Number.isSafeInteger);

export type ExperimentLineage = z.infer<typeof ExperimentLineageSchema>;

function canonicalJsonValue(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("StrategySpec must contain only finite JSON values.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJsonValue).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJsonValue(child)}`)
      .join(",")}}`;
  }
  throw new TypeError("StrategySpec must contain only JSON-safe values.");
}

/** Exact, deterministic top-level StrategySpec delta used by persisted experiment lineage. */
export function changedStrategySpecTopLevelFields(parent: StrategySpec, child: StrategySpec): string[] {
  const keys = new Set([...Object.keys(parent), ...Object.keys(child)]);
  return [...keys]
    .filter((key) => canonicalJsonValue(
      (parent as unknown as Record<string, unknown>)[key],
    ) !== canonicalJsonValue((child as unknown as Record<string, unknown>)[key]))
    .sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
}
export function createRootLineage(): ExperimentLineage {
  return ExperimentLineageSchema.parse({
    parentRunId: null,
    hypothesis: "",
    changedFields: [],
    userAttestedTestWindowSeenBeforeChange: false,
    iterationNumber: 1,
  });
}

export function createNextLineage(input: {
  parentRunId: string;
  parentIteration: number;
  hypothesis: string;
  changedFields: string[];
  parentTestWindowStatus: "sealed" | "revealed";
}): ExperimentLineage {
  const parentIteration = ParentIterationSchema.parse(input.parentIteration);
  const parentTestWindowStatus = z.enum(["sealed", "revealed"]).parse(input.parentTestWindowStatus);
  return ExperimentLineageSchema.parse({
    parentRunId: input.parentRunId,
    hypothesis: input.hypothesis,
    changedFields: input.changedFields,
    userAttestedTestWindowSeenBeforeChange: parentTestWindowStatus === "revealed",
    iterationNumber: parentIteration + 1,
  });
}
