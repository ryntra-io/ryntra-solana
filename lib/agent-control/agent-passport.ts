import { createHash } from "node:crypto";

import { z } from "zod";

import { canonicalJson, compareCanonicalStrings } from "../guard/canonical-json.ts";

const HEX_HASH = /^0x[0-9a-f]{64}$/;
const AGENTVERSE_ADDRESS_SHAPE = "^agent1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{59}$";
const AGENTVERSE_ADDRESS_SHAPE_PATTERN = new RegExp(AGENTVERSE_ADDRESS_SHAPE);
const BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const BECH32_GENERATORS = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3] as const;

export function isAgentverseAddress(value: unknown): value is string {
  if (typeof value !== "string" || !AGENTVERSE_ADDRESS_SHAPE_PATTERN.test(value)) return false;
  const separator = value.lastIndexOf("1");
  if (separator < 1 || value.length - separator - 1 < 6) return false;
  const hrp = value.slice(0, separator);
  const data = [...value.slice(separator + 1)].map((character) => BECH32_CHARSET.indexOf(character));
  if (data.some((entry) => entry < 0)) return false;

  let checksum = 1;
  const values = [
    ...[...hrp].map((character) => character.charCodeAt(0) >> 5),
    0,
    ...[...hrp].map((character) => character.charCodeAt(0) & 31),
    ...data,
  ];
  for (const entry of values) {
    const high = checksum >>> 25;
    checksum = ((checksum & 0x1ffffff) << 5) ^ entry;
    for (let index = 0; index < BECH32_GENERATORS.length; index += 1) {
      if ((high >>> index) & 1) checksum ^= BECH32_GENERATORS[index];
    }
    checksum >>>= 0;
  }
  return checksum === 1;
}

class ChecksummedAgentverseAddressPattern extends RegExp {
  override exec(value: string): RegExpExecArray | null {
    const match = super.exec(value);
    return match && isAgentverseAddress(value) ? match : null;
  }
}

export const AGENTVERSE_ADDRESS_PATTERN = new ChecksummedAgentverseAddressPattern(AGENTVERSE_ADDRESS_SHAPE);
const timestamp = z.string().datetime({ offset: true });

export const AGENTVERSE_SOURCE_KINDS = ["REGISTRY", "SEARCH", "MANIFESTS"] as const;

export const AGENTVERSE_SOURCE_IDS = {
  REGISTRY: "agentverse-registry",
  SEARCH: "agentverse-search",
  MANIFESTS: "agentverse-manifests",
} as const;

export const AGENT_PASSPORT_HASH_DOMAINS = {
  sourcePayload: "ryntra.agent-control.agent-passport.source-payload.v1",
  identity: "ryntra.agent-control.agent-passport.identity.v1",
  passport: "ryntra.agent-control.agent-passport.v1",
  integrity: "ryntra.agent-control.agent-passport.integrity.v1",
} as const;

export type AgentPassportHashDomain =
  (typeof AGENT_PASSPORT_HASH_DOMAINS)[keyof typeof AGENT_PASSPORT_HASH_DOMAINS];

export function hashAgentPassportPayload(domain: AgentPassportHashDomain, value: unknown): string {
  return `0x${createHash("sha256").update(`${domain}\n${canonicalJson(value)}`, "utf8").digest("hex")}`;
}

export const AgentPassportRequestSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    provider: z.literal("AGENTVERSE"),
    address: z.string().regex(AGENTVERSE_ADDRESS_PATTERN),
  })
  .strict();

const SourceMemberAvailabilitySchema = z.enum([
  "AVAILABLE",
  "NOT_FOUND",
  "UNAVAILABLE",
  "SCHEMA_DRIFT",
]);

const SourceReasonSchema = z.enum([
  "NOT_FOUND",
  "HTTP_ERROR",
  "TIMEOUT",
  "NETWORK_ERROR",
  "RESPONSE_TOO_LARGE",
  "INVALID_JSON",
  "SCHEMA_DRIFT",
]);

function parseOfficialAgentverseUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.origin === "https://agentverse.ai" && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}

const OfficialAgentverseUrlSchema = z
  .string()
  .url()
  .max(512)
  .refine((value) => parseOfficialAgentverseUrl(value) !== null, {
    message: "Agentverse evidence URLs must use the fixed official origin.",
  });

export const AgentPassportSourceMemberSchema = z
  .object({
    id: z.string().min(3).max(96),
    url: OfficialAgentverseUrlSchema,
    observedAt: timestamp,
    availability: SourceMemberAvailabilitySchema,
    httpStatus: z.number().int().min(100).max(599).nullable(),
    payloadDigest: z.string().regex(HEX_HASH).nullable(),
    reasonCode: SourceReasonSchema.nullable(),
    schemaDrift: z.array(z.string().min(1).max(512)).max(16),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.availability === "AVAILABLE") {
      if (value.httpStatus !== 200 || value.payloadDigest === null || value.reasonCode !== null) {
        context.addIssue({
          code: "custom",
          path: ["availability"],
          message: "Available source members require HTTP 200, a payload digest and no failure reason.",
        });
      }
      if (value.schemaDrift.length > 0) {
        context.addIssue({ code: "custom", path: ["schemaDrift"], message: "Available source members cannot carry schema drift." });
      }
    }
    if (value.availability === "SCHEMA_DRIFT") {
      if (
        value.httpStatus !== 200 ||
        value.payloadDigest === null ||
        value.reasonCode !== "SCHEMA_DRIFT" ||
        value.schemaDrift.length === 0
      ) {
        context.addIssue({
          code: "custom",
          path: ["availability"],
          message: "Schema drift requires HTTP 200, a digest, a drift reason and at least one issue.",
        });
      }
    }
    if (value.availability === "NOT_FOUND" && value.reasonCode !== "NOT_FOUND") {
      context.addIssue({ code: "custom", path: ["reasonCode"], message: "Not-found source members require a NOT_FOUND reason." });
    }
    if (value.availability === "NOT_FOUND") {
      if (value.httpStatus !== 404 || value.payloadDigest !== null || value.schemaDrift.length > 0) {
        context.addIssue({ code: "custom", path: ["availability"], message: "Not-found source members require only an HTTP 404 observation." });
      }
    }
    if (value.availability === "UNAVAILABLE") {
      if (value.reasonCode === null || ["NOT_FOUND", "SCHEMA_DRIFT"].includes(value.reasonCode) || value.schemaDrift.length > 0) {
        context.addIssue({ code: "custom", path: ["reasonCode"], message: "Unavailable source members require a bounded non-schema failure reason." });
      }
    }
  });

export const AgentPassportSourceSchema = z
  .object({
    id: z.enum([
      AGENTVERSE_SOURCE_IDS.REGISTRY,
      AGENTVERSE_SOURCE_IDS.SEARCH,
      AGENTVERSE_SOURCE_IDS.MANIFESTS,
    ]),
    provider: z.literal("AGENTVERSE"),
    kind: z.enum(AGENTVERSE_SOURCE_KINDS),
    providerScope: z.literal("PROVIDER_GLOBAL"),
    observedAt: timestamp,
    availability: z.enum([
      "AVAILABLE",
      "PARTIAL",
      "NOT_FOUND",
      "UNAVAILABLE",
      "SCHEMA_DRIFT",
      "NOT_REQUESTED",
    ]),
    members: z.array(AgentPassportSourceMemberSchema).max(6),
    payloadDigest: z.string().regex(HEX_HASH).nullable(),
    reasonCode: z.enum(["PARTIAL_FAILURE", "NO_PROTOCOL_DIGESTS", ...SourceReasonSchema.options]).nullable(),
    schemaDrift: z.array(z.string().min(1).max(512)).max(48),
  })
  .strict()
  .superRefine((value, context) => {
    const expectedId = AGENTVERSE_SOURCE_IDS[value.kind];
    if (value.id !== expectedId) {
      context.addIssue({ code: "custom", path: ["id"], message: "Source id and kind do not match." });
    }
    if (value.kind === "MANIFESTS" ? value.members.length > 6 : value.members.length !== 1) {
      context.addIssue({ code: "custom", path: ["members"], message: "Source member count exceeds its bounded contract." });
    }
    if (new Set(value.members.map((member) => member.id)).size !== value.members.length) {
      context.addIssue({ code: "custom", path: ["members"], message: "Source member ids must be unique." });
    }
    for (const [index, member] of value.members.entries()) {
      const url = parseOfficialAgentverseUrl(member.url);
      if (url === null) {
        context.addIssue({ code: "custom", path: ["members", index, "url"], message: "Source member URL is invalid." });
        continue;
      }
      const expectedPath = value.kind === "REGISTRY"
        ? /^\/v2\/almanac\/resolve\/agent1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{59}$/
        : value.kind === "SEARCH"
          ? /^\/v1\/search\/agents\/agent1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{59}$/
          : /^\/v2\/almanac\/manifest\/[0-9a-f]{64}$/;
      if (url.search || url.hash || !expectedPath.test(url.pathname)) {
        context.addIssue({ code: "custom", path: ["members", index, "url"], message: "Source member URL is outside the exact public path contract." });
      }
      const expectedMemberId = value.kind === "REGISTRY"
        ? "registry"
        : value.kind === "SEARCH"
          ? "search"
          : `manifest-${url.pathname.slice(-64, -48)}`;
      if (member.id !== expectedMemberId) {
        context.addIssue({ code: "custom", path: ["members", index, "id"], message: "Source member id does not bind its exact official path." });
      }
    }
    if (value.availability === "AVAILABLE") {
      if (
        value.members.length === 0 ||
        value.members.some((member) => member.availability !== "AVAILABLE") ||
        value.payloadDigest === null ||
        value.reasonCode !== null
      ) {
        context.addIssue({
          code: "custom",
          path: ["availability"],
          message: "Available sources require only available members, an aggregate digest and no failure reason.",
        });
      }
      if (value.schemaDrift.length > 0) {
        context.addIssue({ code: "custom", path: ["schemaDrift"], message: "Available sources cannot carry schema drift." });
      }
    }
    if (value.availability === "PARTIAL") {
      const availableMembers = value.members.filter((member) => member.availability === "AVAILABLE");
      if (
        availableMembers.length === 0 ||
        availableMembers.length === value.members.length ||
        value.payloadDigest === null ||
        value.reasonCode !== "PARTIAL_FAILURE"
      ) {
        context.addIssue({
          code: "custom",
          path: ["availability"],
          message: "Partial sources require both normalized and failed members plus an aggregate digest.",
        });
      }
    }
    if (value.availability === "SCHEMA_DRIFT") {
      if (
        value.payloadDigest === null ||
        value.reasonCode !== "SCHEMA_DRIFT" ||
        value.schemaDrift.length === 0
      ) {
        context.addIssue({
          code: "custom",
          path: ["availability"],
          message: "Schema drift requires HTTP 200, a digest, a drift reason and at least one issue.",
        });
      }
    }
    if (value.availability === "NOT_FOUND" && value.reasonCode !== "NOT_FOUND") {
      context.addIssue({ code: "custom", path: ["reasonCode"], message: "Not-found sources require a NOT_FOUND reason." });
    }
    if (value.availability === "NOT_FOUND") {
      if (value.members.length === 0 || value.members.some((member) => member.availability !== "NOT_FOUND") || value.payloadDigest !== null || value.schemaDrift.length > 0) {
        context.addIssue({ code: "custom", path: ["availability"], message: "Not-found sources require only not-found members and no payload digest." });
      }
    }
    if (value.availability === "UNAVAILABLE") {
      if (value.reasonCode === null || value.members.some((member) => member.availability === "AVAILABLE")) {
        context.addIssue({ code: "custom", path: ["reasonCode"], message: "Unavailable sources cannot contain normalized members." });
      }
    }
    if (value.availability === "NOT_REQUESTED") {
      if (
        value.kind !== "MANIFESTS" || value.members.length !== 0
        || value.payloadDigest !== null || value.reasonCode !== "NO_PROTOCOL_DIGESTS"
        || value.schemaDrift.length > 0
      ) {
        context.addIssue({
          code: "custom",
          path: ["availability"],
          message: "Only an empty manifest set may be explicitly not requested.",
        });
      }
    }
  });

export const AGENT_PASSPORT_FACT_FIELDS = [
  "address",
  "name",
  "description",
  "readme",
  "avatar_url",
  "banner_url",
  "status",
  "agent_type",
  "domain_name",
  "expiry",
  "prefix",
  "handle",
  "domain",
  "category",
  "created_at",
  "last_updated",
  "unresponsive",
  "featured",
  "metadata",
  "system_wide_tags",
  "geo_location",
  "owner",
  "starter_prompts",
  "endpoints",
  "protocols",
  "total_interactions",
  "recent_interactions",
  "rating",
  "recent_success_rate",
  "recent_eval_success_rate",
  "recent_verified_interactions",
  "recent_success_verified_interactions",
  "protocol_manifest_name",
  "protocol_manifest_version",
  "protocol_manifest_digest",
  "protocol_manifest_description",
  "protocol_manifest_models",
] as const;

const PROVIDER_METRIC_FIELDS = new Set<string>([
  "total_interactions",
  "recent_interactions",
  "rating",
  "recent_success_rate",
  "recent_eval_success_rate",
  "recent_verified_interactions",
  "recent_success_verified_interactions",
]);

const FactValueSchema = z.union([
  z.string().max(80_000),
  z.number().finite(),
  z.boolean(),
  z.array(z.string().max(4_096)).max(64),
]);

export const AgentPassportFactSchema = z
  .object({
    id: z.string().min(3).max(160),
    field: z.enum(AGENT_PASSPORT_FACT_FIELDS),
    value: FactValueSchema,
    sourceIds: z.array(AgentPassportSourceSchema.shape.id).min(1).max(3),
    declaration: z.enum(["PROVIDER_DECLARED", "PROVIDER_REPORTED_METRIC"]),
    limitation: z.string().min(1).max(512),
  })
  .strict()
  .superRefine((value, context) => {
    const metric = PROVIDER_METRIC_FIELDS.has(value.field);
    if (metric !== (value.declaration === "PROVIDER_REPORTED_METRIC")) {
      context.addIssue({
        code: "custom",
        path: ["declaration"],
        message: metric
          ? "Provider metrics must remain explicitly provider-reported."
          : "Non-metric declarations cannot be promoted to provider metrics.",
      });
    }
    if (metric && typeof value.value !== "number") {
      context.addIssue({ code: "custom", path: ["value"], message: "Provider metric values must be numeric." });
    }
  });

export const AgentPassportObservationSchema = z
  .object({
    id: z.string().min(3).max(160),
    kind: z.enum([
      "SOURCE_AVAILABILITY",
      "ADDRESS_MATCH",
      "PROVIDER_SCOPE",
      "DECLARED_ENDPOINT_FETCH",
      "PROVIDER_METRIC_AUTHORITY",
      "LIVENESS",
    ]),
    sourceIds: z.array(AgentPassportSourceSchema.shape.id).max(3),
    value: z.union([z.string().max(512), z.boolean(), z.number().finite()]),
    detail: z.string().min(1).max(1_000),
  })
  .strict();

export const AgentPassportConflictSchema = z
  .object({
    id: z.string().min(3).max(160),
    field: z.enum([...AGENT_PASSPORT_FACT_FIELDS, "request_address"]),
    sourceIds: z.array(AgentPassportSourceSchema.shape.id).min(1).max(3),
    values: z.array(z.string().min(1).max(600)).min(2).max(4),
    reason: z.string().min(1).max(1_000),
  })
  .strict();

export const AgentPassportUnknownSchema = z
  .object({
    id: z.string().min(3).max(160),
    field: z.string().min(1).max(128),
    sourceIds: z.array(AgentPassportSourceSchema.shape.id).max(3),
    reasonCode: z.enum([
      "SOURCE_NOT_FOUND",
      "SOURCE_UNAVAILABLE",
      "SOURCE_SCHEMA_DRIFT",
      "FIELD_NOT_DECLARED",
      "CONFLICTING_CLAIMS",
      "PROVIDER_SCOPE_UNAVAILABLE",
    ]),
    detail: z.string().min(1).max(1_000),
  })
  .strict();

export const AGENT_PASSPORT_LIMITATIONS = [
  "Provider-declared profile, registration and endpoint metadata are not Ryntra verification or endorsement.",
  "Agent-declared endpoints are preserved as data and were not fetched by Ryntra.",
  "Provider-reported metrics are not a Ryntra trust, safety, reputation or quality score and are not a recommendation.",
  "No ASI:One invocation, Agentverse account access, agent registration, chat, wallet, signature or external write occurred.",
] as const;

export const AgentPassportSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    kind: z.literal("AGENT_PASSPORT"),
    id: z.string().regex(/^agent-passport_[0-9a-f]{16}$/),
    createdAt: timestamp,
    maturity: z.literal("SOURCE_PREVIEW"),
    request: AgentPassportRequestSchema,
    sources: z.array(AgentPassportSourceSchema).length(3),
    providerClaims: z.array(AgentPassportFactSchema).max(128),
    ryntraObservations: z.array(AgentPassportObservationSchema).min(1).max(32),
    conflicts: z.array(AgentPassportConflictSchema).max(32),
    unknowns: z.array(AgentPassportUnknownSchema).max(32),
    limitations: z.tuple([
      z.literal(AGENT_PASSPORT_LIMITATIONS[0]),
      z.literal(AGENT_PASSPORT_LIMITATIONS[1]),
      z.literal(AGENT_PASSPORT_LIMITATIONS[2]),
      z.literal(AGENT_PASSPORT_LIMITATIONS[3]),
    ]),
    passportHash: z.string().regex(HEX_HASH),
    integrity: z
      .object({ algorithm: z.literal("SHA-256"), hash: z.string().regex(HEX_HASH) })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    const sourceIds = new Set<string>(value.sources.map((source) => source.id));
    if (sourceIds.size !== AGENTVERSE_SOURCE_KINDS.length) {
      context.addIssue({ code: "custom", path: ["sources"], message: "Every official source must have exactly one record." });
    }
    for (const source of value.sources) {
      if (
        (source.kind === "REGISTRY" || source.kind === "SEARCH")
        && source.members.some((member) => {
          const url = parseOfficialAgentverseUrl(member.url);
          return url === null || !url.pathname.endsWith(`/${value.request.address}`);
        })
      ) {
        context.addIssue({
          code: "custom",
          path: ["sources"],
          message: `${source.kind} provenance URL must bind the exact requested address.`,
        });
      }
      if (
        source.availability !== "AVAILABLE" &&
        !value.unknowns.some((unknown) => unknown.sourceIds.includes(source.id))
      ) {
        context.addIssue({
          code: "custom",
          path: ["unknowns"],
          message: `Unavailable source ${source.id} must remain visible as an unknown.`,
        });
      }
    }
    for (const [label, entries] of [
      ["providerClaims", value.providerClaims],
      ["ryntraObservations", value.ryntraObservations],
      ["conflicts", value.conflicts],
      ["unknowns", value.unknowns],
    ] as const) {
      if (new Set(entries.map((entry) => entry.id)).size !== entries.length) {
        context.addIssue({ code: "custom", path: [label], message: `${label} ids must be unique.` });
      }
    }
    const available = new Set(
      value.sources
        .filter((source) => source.availability === "AVAILABLE" || source.availability === "PARTIAL")
        .map((source) => source.id),
    );
    for (const [index, claim] of value.providerClaims.entries()) {
      if (claim.sourceIds.some((sourceId) => !available.has(sourceId))) {
        context.addIssue({
          code: "custom",
          path: ["providerClaims", index, "sourceIds"],
          message: "Provider claims may use only successfully normalized sources.",
        });
      }
    }
    const validateReferences = (
      collection: readonly { sourceIds: readonly string[] }[],
      label: "providerClaims" | "ryntraObservations" | "conflicts" | "unknowns",
    ) => {
      for (const [index, entry] of collection.entries()) {
        if (entry.sourceIds.some((sourceId) => !sourceIds.has(sourceId))) {
          context.addIssue({
            code: "custom",
            path: [label, index, "sourceIds"],
            message: "Evidence references must resolve to a source record.",
          });
        }
      }
    };
    validateReferences(value.providerClaims, "providerClaims");
    validateReferences(value.ryntraObservations, "ryntraObservations");
    validateReferences(value.conflicts, "conflicts");
    validateReferences(value.unknowns, "unknowns");
  });

export type AgentPassportRequest = z.output<typeof AgentPassportRequestSchema>;
export type AgentPassportSource = z.output<typeof AgentPassportSourceSchema>;
export type AgentPassportFact = z.output<typeof AgentPassportFactSchema>;
export type AgentPassportObservation = z.output<typeof AgentPassportObservationSchema>;
export type AgentPassportConflict = z.output<typeof AgentPassportConflictSchema>;
export type AgentPassportUnknown = z.output<typeof AgentPassportUnknownSchema>;
export type AgentPassport = z.output<typeof AgentPassportSchema>;

const SOURCE_ORDER = new Map(AGENTVERSE_SOURCE_KINDS.map((kind, index) => [AGENTVERSE_SOURCE_IDS[kind], index]));

function orderedSources(sources: readonly AgentPassportSource[]): AgentPassportSource[] {
  return [...sources]
    .map((source) => ({
      ...source,
      members: [...source.members]
        .map((member) => ({ ...member, schemaDrift: [...member.schemaDrift].sort(compareCanonicalStrings) }))
        .sort((left, right) => compareCanonicalStrings(left.id, right.id)),
      schemaDrift: [...source.schemaDrift].sort(compareCanonicalStrings),
    }))
    .sort((left, right) => (SOURCE_ORDER.get(left.id) ?? 99) - (SOURCE_ORDER.get(right.id) ?? 99));
}

function orderedById<T extends { id: string }>(values: readonly T[]): T[] {
  return [...values].sort((left, right) => compareCanonicalStrings(left.id, right.id));
}

function orderedSourceIds<T extends { sourceIds: readonly string[] }>(value: T): T {
  return { ...value, sourceIds: [...value.sourceIds].sort(compareCanonicalStrings) };
}

function orderedFact(value: AgentPassportFact): AgentPassportFact {
  return {
    ...orderedSourceIds(value),
    value: Array.isArray(value.value) ? [...value.value].sort(compareCanonicalStrings) : value.value,
  };
}

function orderedConflict(value: AgentPassportConflict): AgentPassportConflict {
  return {
    ...orderedSourceIds(value),
    values: [...value.values].sort(compareCanonicalStrings),
  };
}

export function createAgentPassport({
  request: unsafeRequest,
  sources: unsafeSources,
  providerClaims: unsafeProviderClaims,
  ryntraObservations: unsafeObservations,
  conflicts: unsafeConflicts,
  unknowns: unsafeUnknowns,
  createdAt = new Date(),
}: {
  request: unknown;
  sources: readonly unknown[];
  providerClaims: readonly unknown[];
  ryntraObservations: readonly unknown[];
  conflicts: readonly unknown[];
  unknowns: readonly unknown[];
  createdAt?: Date;
}): AgentPassport {
  if (!(createdAt instanceof Date) || !Number.isFinite(createdAt.getTime())) {
    throw new TypeError("Agent Passport creation time must be a valid Date.");
  }
  const request = AgentPassportRequestSchema.parse(unsafeRequest);
  const sources = orderedSources(unsafeSources.map((source) => AgentPassportSourceSchema.parse(source)));
  const providerClaims = orderedById(
    unsafeProviderClaims.map((claim) => orderedFact(AgentPassportFactSchema.parse(claim))),
  );
  const ryntraObservations = orderedById(
    unsafeObservations.map((observation) => orderedSourceIds(AgentPassportObservationSchema.parse(observation))),
  );
  const conflicts = orderedById(
    unsafeConflicts.map((conflict) => orderedConflict(AgentPassportConflictSchema.parse(conflict))),
  );
  const unknowns = orderedById(
    unsafeUnknowns.map((unknown) => orderedSourceIds(AgentPassportUnknownSchema.parse(unknown))),
  );
  const createdAtValue = createdAt.toISOString();
  const identityHash = hashAgentPassportPayload(AGENT_PASSPORT_HASH_DOMAINS.identity, {
    request,
    sources: sources.map(({ id, payloadDigest, availability }) => ({ id, payloadDigest, availability })),
    createdAt: createdAtValue,
  });
  const core = {
    schemaVersion: "1.0.0" as const,
    kind: "AGENT_PASSPORT" as const,
    id: `agent-passport_${identityHash.slice(2, 18)}`,
    createdAt: createdAtValue,
    maturity: "SOURCE_PREVIEW" as const,
    request,
    sources,
    providerClaims,
    ryntraObservations,
    conflicts,
    unknowns,
    limitations: AGENT_PASSPORT_LIMITATIONS,
  };
  const passportHash = hashAgentPassportPayload(AGENT_PASSPORT_HASH_DOMAINS.passport, core);
  const withoutIntegrity = { ...core, passportHash };
  return AgentPassportSchema.parse({
    ...withoutIntegrity,
    integrity: {
      algorithm: "SHA-256",
      hash: hashAgentPassportPayload(AGENT_PASSPORT_HASH_DOMAINS.integrity, withoutIntegrity),
    },
  });
}

export type AgentPassportVerification = Readonly<{
  valid: boolean;
  verdict: "AGENT_PASSPORT_INTEGRITY_VALID" | "INVALID";
  issues: readonly string[];
}>;

export function verifyAgentPassport(value: unknown): AgentPassportVerification {
  const parsed = AgentPassportSchema.safeParse(value);
  if (!parsed.success) {
    return {
      valid: false,
      verdict: "INVALID",
      issues: parsed.error.issues.map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`),
    };
  }
  const passport = parsed.data;
  const issues: string[] = [];
  if (canonicalJson(passport.sources) !== canonicalJson(orderedSources(passport.sources))) {
    issues.push("SOURCE_ORDER_NONCANONICAL");
  }
  const canonicalCollections: ReadonlyArray<readonly [string, unknown, unknown]> = [
    ["CLAIM", passport.providerClaims, orderedById(passport.providerClaims.map(orderedFact))],
    [
      "OBSERVATION",
      passport.ryntraObservations,
      orderedById(passport.ryntraObservations.map(orderedSourceIds)),
    ],
    ["CONFLICT", passport.conflicts, orderedById(passport.conflicts.map(orderedConflict))],
    ["UNKNOWN", passport.unknowns, orderedById(passport.unknowns.map(orderedSourceIds))],
  ];
  for (const [label, entries, canonicalEntries] of canonicalCollections) {
    if (canonicalJson(entries) !== canonicalJson(canonicalEntries)) {
      issues.push(`${label}_ORDER_NONCANONICAL`);
    }
  }
  const expectedIdentityHash = hashAgentPassportPayload(AGENT_PASSPORT_HASH_DOMAINS.identity, {
    request: passport.request,
    sources: passport.sources.map(({ id, payloadDigest, availability }) => ({ id, payloadDigest, availability })),
    createdAt: passport.createdAt,
  });
  if (passport.id !== `agent-passport_${expectedIdentityHash.slice(2, 18)}`) {
    issues.push("PASSPORT_ID_MISMATCH");
  }
  const { passportHash: _passportHash, integrity: _integrity, ...core } = passport;
  if (passport.passportHash !== hashAgentPassportPayload(AGENT_PASSPORT_HASH_DOMAINS.passport, core)) {
    issues.push("PASSPORT_HASH_MISMATCH");
  }
  const { integrity: _discarded, ...withoutIntegrity } = passport;
  if (
    passport.integrity.hash !==
    hashAgentPassportPayload(AGENT_PASSPORT_HASH_DOMAINS.integrity, withoutIntegrity)
  ) {
    issues.push("INTEGRITY_HASH_MISMATCH");
  }
  return {
    valid: issues.length === 0,
    verdict: issues.length === 0 ? "AGENT_PASSPORT_INTEGRITY_VALID" : "INVALID",
    issues,
  };
}
