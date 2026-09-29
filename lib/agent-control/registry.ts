import { z } from "zod";

import { compareCanonicalStrings } from "../guard/canonical-json.ts";
import { REGISTERED_ADAPTER_DEFINITIONS } from "./adapters/index.ts";
import { AGENT_HASH_DOMAINS_V2, hashAgentPayloadV2 } from "./canonical.ts";

/**
 * The allowlisted, versioned, hash-pinned registry that replaces Agent
 * Control's closed enums.
 *
 * Before this module, the only way to support a new request origin, a new
 * external system or a new action was to edit the central artifact schema:
 * `source.kind`, `action.provider` and the flat action-kind list were all
 * `z.enum` literals inside `contracts.ts`. That makes every extension a
 * breaking change to the one file every artifact depends on, which is exactly
 * the shape Release D has to prove it has escaped.
 *
 * Three things make this a registry rather than a longer list:
 *
 * 1. **Allowlisted.** A reference that is not present resolves to a named
 *    refusal. Nothing falls through to a default.
 * 2. **Versioned.** A reference carries `@version`, so an artifact records the
 *    exact entry it resolved rather than "whatever `bnb-apex` meant that day".
 * 3. **Hash-pinned.** Each entry carries a content hash over its own
 *    definition, and the registry carries a digest over all of them. An
 *    artifact that records both can be checked against a registry a verifier
 *    reproduces independently.
 *
 * Action kinds are two-layer on purpose. The canonical class says what an
 * action *does* to value or to a record, in a vocabulary that does not grow;
 * the provider-scoped subtype says what a specific system calls it. A verifier
 * that has never heard of a provider can still tell that an action commits
 * value, which is the property that has to survive new integrations.
 */

const REF_SOURCE = /^source:[a-z0-9][a-z0-9-]*@[1-9]\d*$/;
const REF_ADAPTER = /^adapter:[a-z0-9][a-z0-9-]*@[1-9]\d*$/;
const REF_ACTION = /^action:[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*@[1-9]\d*$/;
const CAIP2 = /^[a-z0-9-]+:[A-Za-z0-9-]+$/;
const HEX_HASH = /^0x[0-9a-f]{64}$/;

/**
 * The closed canonical action classes. **This vocabulary does not grow.**
 *
 * A new provider action is a new registry subtype pointing at one of these; if
 * a proposed action genuinely does not fit, that is a canon change with its own
 * decision, not a registry entry.
 */
export const AGENT_ACTION_CLASSES = [
  "RECORD_ONLY",
  "VALUE_COMMIT",
  "VALUE_RELEASE",
  "VALUE_TRANSFER",
  "WORK_DELIVERY",
] as const;

export type AgentActionClass = (typeof AGENT_ACTION_CLASSES)[number];

/** What an action subtype does about a budget, carried as data rather than as a branch. */
export const AGENT_BUDGET_RULES = ["REQUIRED", "FORBIDDEN", "OPTIONAL"] as const;

export const REGISTRY_REFUSALS = [
  "REGISTRY_REF_MALFORMED",
  "REGISTRY_REF_UNKNOWN",
  "REGISTRY_REF_RETIRED",
  "REGISTRY_REF_WRONG_KIND",
  "REGISTRY_ENTRY_HASH_MISMATCH",
] as const;

export type RegistryRefusal = (typeof REGISTRY_REFUSALS)[number];

export class RegistryResolutionError extends Error {
  readonly reasonCode: RegistryRefusal;
  readonly ref: string;

  constructor(reasonCode: RegistryRefusal, ref: string, detail: string) {
    super(`${reasonCode}: ${detail}`);
    this.name = "RegistryResolutionError";
    this.reasonCode = reasonCode;
    this.ref = ref;
  }
}

const StatusSchema = z.enum(["ALLOWED", "RETIRED"]);

const SourceDefinitionSchema = z
  .object({
    kind: z.literal("SOURCE"),
    ref: z.string().regex(REF_SOURCE),
    displayName: z.string().min(1).max(64),
    /** Whether Ryntra authenticated the origin. Today nothing here is authenticated. */
    originTrust: z.enum(["UNAUTHENTICATED", "AUTHENTICATED"]),
    status: StatusSchema,
  })
  .strict();

const AdapterDefinitionSchema = z
  .object({
    kind: z.literal("ADAPTER"),
    ref: z.string().regex(REF_ADAPTER),
    displayName: z.string().min(1).max(64),
    /**
     * Every adapter shipped today is `READ_ONLY`. The value is recorded per
     * entry rather than assumed globally so that the day one is not, the
     * artifact says which one and a policy can refuse it by data.
     */
    capability: z.enum(["READ_ONLY", "OBSERVE_AND_RECONCILE"]),
    chainRefs: z.array(z.string().regex(CAIP2)).max(8),
    status: StatusSchema,
  })
  .strict();

const ActionDefinitionSchema = z
  .object({
    kind: z.literal("ACTION_SCHEMA"),
    ref: z.string().regex(REF_ACTION),
    displayName: z.string().min(1).max(64),
    adapterRef: z.string().regex(REF_ADAPTER),
    canonicalClass: z.enum(AGENT_ACTION_CLASSES),
    budget: z.enum(AGENT_BUDGET_RULES),
    status: StatusSchema,
  })
  .strict();

const DefinitionSchema = z.discriminatedUnion("kind", [
  SourceDefinitionSchema,
  AdapterDefinitionSchema,
  ActionDefinitionSchema,
]);

export type RegistryDefinition = z.output<typeof DefinitionSchema>;
export type RegistryEntry = RegistryDefinition & { readonly contentHash: string };
export type RegistryEntryKind = RegistryDefinition["kind"];

export type AgentControlRegistry = Readonly<{
  schemaVersion: "2.0.0";
  digest: string;
  entries: readonly RegistryEntry[];
}>;

function entryContentHash(definition: RegistryDefinition): string {
  return hashAgentPayloadV2(AGENT_HASH_DOMAINS_V2.registry, definition);
}

/**
 * Build a registry from definitions, refusing anything a verifier could not
 * reproduce: a malformed reference, a duplicate, or an action bound to an
 * adapter that is not in the same registry.
 *
 * Exported rather than private because extensibility has to be testable. The
 * proof that adding a provider needs no central-schema edit is a test that
 * builds a registry containing a provider the schema has never heard of.
 */
export function buildRegistry(definitions: readonly unknown[]): AgentControlRegistry {
  const parsed = definitions.map((definition) => DefinitionSchema.parse(definition));

  const refs = new Set<string>();
  for (const definition of parsed) {
    if (refs.has(definition.ref)) {
      throw new RegistryResolutionError(
        "REGISTRY_REF_MALFORMED",
        definition.ref,
        "a registry cannot carry one reference twice",
      );
    }
    refs.add(definition.ref);
  }

  for (const definition of parsed) {
    if (definition.kind !== "ACTION_SCHEMA") continue;
    if (!refs.has(definition.adapterRef)) {
      throw new RegistryResolutionError(
        "REGISTRY_REF_UNKNOWN",
        definition.adapterRef,
        `action ${definition.ref} is bound to an adapter this registry does not carry`,
      );
    }
    const [adapterId] = definition.ref.slice("action:".length).split("/");
    if (!definition.adapterRef.startsWith(`adapter:${adapterId}@`)) {
      throw new RegistryResolutionError(
        "REGISTRY_REF_MALFORMED",
        definition.ref,
        `action ${definition.ref} is namespaced under ${adapterId} but bound to ${definition.adapterRef}`,
      );
    }
  }

  const entries = parsed
    .map((definition) => ({ ...definition, contentHash: entryContentHash(definition) }))
    .sort((left, right) => compareCanonicalStrings(left.ref, right.ref));

  return Object.freeze({
    schemaVersion: "2.0.0" as const,
    digest: hashAgentPayloadV2(
      AGENT_HASH_DOMAINS_V2.registry,
      entries.map((entry) => ({ ref: entry.ref, contentHash: entry.contentHash })),
    ),
    entries: Object.freeze(entries),
  });
}

/**
 * Resolve one reference, failing closed with a named reason.
 *
 * `expectedKind` is required rather than optional: every call site knows which
 * kind it wants, and a resolver that happily returns an adapter where an action
 * was expected re-creates the ambiguity the two-layer model exists to remove.
 */
export function resolveRegistryRef<K extends RegistryEntryKind>(
  registry: AgentControlRegistry,
  ref: string,
  expectedKind: K,
): Extract<RegistryEntry, { kind: K }> {
  const pattern =
    expectedKind === "SOURCE" ? REF_SOURCE : expectedKind === "ADAPTER" ? REF_ADAPTER : REF_ACTION;
  if (!pattern.test(ref)) {
    throw new RegistryResolutionError("REGISTRY_REF_MALFORMED", ref, `not a ${expectedKind} reference`);
  }

  const entry = registry.entries.find((candidate) => candidate.ref === ref);
  if (!entry) {
    throw new RegistryResolutionError("REGISTRY_REF_UNKNOWN", ref, "not allowlisted in this registry");
  }
  if (entry.kind !== expectedKind) {
    throw new RegistryResolutionError(
      "REGISTRY_REF_WRONG_KIND",
      ref,
      `resolved a ${entry.kind} where a ${expectedKind} was required`,
    );
  }
  if (entry.status === "RETIRED") {
    throw new RegistryResolutionError("REGISTRY_REF_RETIRED", ref, "retired references cannot back a new artifact");
  }

  const { contentHash, ...definition } = entry;
  if (!HEX_HASH.test(contentHash) || contentHash !== entryContentHash(definition as RegistryDefinition)) {
    throw new RegistryResolutionError(
      "REGISTRY_ENTRY_HASH_MISMATCH",
      ref,
      "the entry does not hash to the pin it carries",
    );
  }

  return entry as Extract<RegistryEntry, { kind: K }>;
}

/**
 * The pin an artifact records: which registry it was produced against, and the
 * exact entry versions it resolved. It is what lets a verifier say "I rebuilt
 * this registry and got the same digest" instead of trusting a provider name.
 */
export const RegistryPinSchema = z
  .object({
    registryDigest: z.string().regex(HEX_HASH),
    refs: z
      .array(
        z
          .object({
            ref: z.string().min(3).max(128),
            contentHash: z.string().regex(HEX_HASH),
          })
          .strict(),
      )
      .min(1)
      .max(16),
  })
  .strict();

export type RegistryPin = z.output<typeof RegistryPinSchema>;

export function registryPin(
  registry: AgentControlRegistry,
  refs: readonly string[],
): RegistryPin {
  const ordered = [...new Set(refs)].sort(compareCanonicalStrings);
  return RegistryPinSchema.parse({
    registryDigest: registry.digest,
    refs: ordered.map((ref) => {
      const entry = registry.entries.find((candidate) => candidate.ref === ref);
      if (!entry) {
        throw new RegistryResolutionError("REGISTRY_REF_UNKNOWN", ref, "cannot pin a reference the registry lacks");
      }
      return { ref: entry.ref, contentHash: entry.contentHash };
    }),
  });
}

/**
 * The shipped registry.
 *
 * Every adapter here is read-only, which is why `capability` never says
 * otherwise: Ryntra observes and reconciles, and nothing in this list can sign,
 * submit, fund or execute. The five action subtypes reproduce exactly the five
 * kinds the v1 schema hard-coded, including their budget rules, so the two-layer
 * model is a change of mechanism rather than of meaning.
 */
export const AGENT_CONTROL_REGISTRY = buildRegistry([
  { kind: "SOURCE", ref: "source:asi-one@1", displayName: "ASI:One", originTrust: "UNAUTHENTICATED", status: "ALLOWED" },
  { kind: "SOURCE", ref: "source:agentverse@1", displayName: "Agentverse", originTrust: "UNAUTHENTICATED", status: "ALLOWED" },
  { kind: "SOURCE", ref: "source:mcp@1", displayName: "MCP client", originTrust: "UNAUTHENTICATED", status: "ALLOWED" },
  { kind: "SOURCE", ref: "source:api@1", displayName: "Direct API", originTrust: "UNAUTHENTICATED", status: "ALLOWED" },
  { kind: "SOURCE", ref: "source:demo@1", displayName: "Source preview", originTrust: "UNAUTHENTICATED", status: "ALLOWED" },

  {
    kind: "ADAPTER",
    ref: "adapter:bnb-apex@1",
    displayName: "BNB APEX",
    capability: "READ_ONLY",
    chainRefs: ["eip155:97"],
    status: "ALLOWED",
  },
  {
    kind: "ADAPTER",
    ref: "adapter:agent-launch@1",
    displayName: "Agent Launch",
    capability: "READ_ONLY",
    chainRefs: ["eip155:56"],
    status: "ALLOWED",
  },
  {
    kind: "ADAPTER",
    ref: "adapter:agentverse@1",
    displayName: "Agentverse",
    capability: "READ_ONLY",
    chainRefs: [],
    status: "ALLOWED",
  },
  {
    kind: "ADAPTER",
    ref: "adapter:demo@1",
    displayName: "Source preview",
    capability: "READ_ONLY",
    chainRefs: ["eip155:97"],
    status: "ALLOWED",
  },

  {
    kind: "ACTION_SCHEMA",
    ref: "action:bnb-apex/create-job-draft@1",
    displayName: "Create job draft",
    adapterRef: "adapter:bnb-apex@1",
    canonicalClass: "RECORD_ONLY",
    budget: "FORBIDDEN",
    status: "ALLOWED",
  },
  {
    kind: "ACTION_SCHEMA",
    ref: "action:bnb-apex/fund-job@1",
    displayName: "Fund job",
    adapterRef: "adapter:bnb-apex@1",
    canonicalClass: "VALUE_COMMIT",
    budget: "REQUIRED",
    status: "ALLOWED",
  },
  {
    kind: "ACTION_SCHEMA",
    ref: "action:bnb-apex/submit-work@1",
    displayName: "Submit work",
    adapterRef: "adapter:bnb-apex@1",
    canonicalClass: "WORK_DELIVERY",
    budget: "OPTIONAL",
    status: "ALLOWED",
  },
  {
    kind: "ACTION_SCHEMA",
    ref: "action:bnb-apex/settle-job@1",
    displayName: "Settle job",
    adapterRef: "adapter:bnb-apex@1",
    canonicalClass: "VALUE_RELEASE",
    budget: "OPTIONAL",
    status: "ALLOWED",
  },
  {
    kind: "ACTION_SCHEMA",
    ref: "action:demo/transfer@1",
    displayName: "Transfer",
    adapterRef: "adapter:demo@1",
    canonicalClass: "VALUE_TRANSFER",
    budget: "OPTIONAL",
    status: "ALLOWED",
  },

  /* Networks registered after Release B arrive through the adapter manifest,
     never by name in this file: this file is itself a central schema source
     the no-central-edit test reads from disk, so a provider named here would
     mean extension still costs a central edit. The manifest is the wiring
     point; each adapter is its own module beside it. */
  ...REGISTERED_ADAPTER_DEFINITIONS,
]);
